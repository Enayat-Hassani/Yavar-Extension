// Background Service Worker - AI Sidebar
// Handles extension lifecycle, context menus, commands, and message routing

import { ContextMenuHandler } from './utils/contextMenu.js';
import { CommandHandler } from './utils/commands.js';
import { syncFrameRules } from './utils/frameRules.js';
import { openPanel, trackPanels, setupActionClick } from './utils/panel.js';

trackPanels();
setupActionClick();

// Session rules are cleared when the browser restarts, so register them on
// every worker start (cheap and idempotent), and again when models change.
syncFrameRules();
chrome.runtime.onStartup.addListener(syncFrameRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.aiModels) syncFrameRules();
});

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Yavar] Extension installed:', details.reason);
  
  // Initialize default settings
  const defaultSettings = {
    defaultAI: 'chatgpt',
    enableFloatingMenu: true,
    disabledSites: []
  };
  
  // Only set if not already set
  const existing = await chrome.storage.sync.get('settings');
  if (!existing.settings) {
    await chrome.storage.sync.set({ settings: defaultSettings });
  }
  
  // Create context menus
  await ContextMenuHandler.createMenus();
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ContextMenuHandler.handleClick(info, tab);
});

// Command handler (keyboard shortcuts)
chrome.commands.onCommand.addListener((command, tab) => {
  CommandHandler.handleCommand(command, tab);
});

// Message routing - single listener for all messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message.action || message.type);
  
  // Handle ping to keep service worker awake
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    return true;
  }

  // Handle auto-submit: store prompt, open sidebar, notify sidepanel
  // A prompt from the floating menu: store it and open the panel. The panel
  // drains pending items from session storage on open and on every change,
  // so no follow-up messages are needed.
  if (message.action === 'trigger_auto_submit') {
    const tabId = sender.tab?.id;
    chrome.storage.session.set({ pendingAutoSubmit: message.prompt, pendingPromptLabel: message.label || '', lastSubmitTime: Date.now() });
    // Open synchronously: an await before this would lose the user gesture
    if (tabId) openPanel({ tabId, windowId: sender.tab?.windowId });
    sendResponse({ success: true });
    return true;
  }

  // Text selected on a page, sent as-is: it joins the message as a chip
  if (message.action === 'send_selection') {
    const tab = sender.tab;
    chrome.storage.session.set({ pendingSelection: { text: message.text, title: tab?.title || '', url: tab?.url || '' } });
    // Open synchronously: an await before this would lose the user gesture
    if (tab?.id) openPanel({ tabId: tab.id, windowId: tab.windowId });
    sendResponse({ success: true });
    return true;
  }

  // Handle area selection request from sidepanel
  if (message.action === 'start_area_select') {
    (async () => {
      try {
        const tab = await getUserTab();
        if (!tab) { sendResponse({ success: false }); return; }

        // Inject the area selection overlay into the active tab
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: injectPicker
        });
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Yavar BG] Failed to inject area selector:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle area selected — capture tab then send cropped rect to sidepanel
  if (message.action === 'area_selected') {
    console.log('[Yavar BG] area_selected received, rect:', message.rect);
    (async () => {
      try {
        const tab = sender.tab;
        console.log('[Yavar BG] Tab:', tab?.id);
        // Small delay to let the overlay removal render
        await new Promise(r => setTimeout(r, 80));

        console.log('[Yavar BG] Capturing visible tab...');
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 100
        });
        console.log('[Yavar BG] Captured, length:', dataUrl?.length);

        // Store in session storage for sidepanel to pick up (more reliable than sendMessage)
        await chrome.storage.session.set({
          pendingScreenshot: dataUrl,
          pendingScreenshotRect: message.rect,
          pendingCapture: message.capture || null
        });
        console.log('[Yavar BG] Stored screenshot in session storage');

        // Open sidebar to show the screenshot
        const tabId = sender.tab?.id;
        if (tabId) {
          openPanel({ tabId, windowId: sender.tab?.windowId });
        }

        // An already-open panel picks this up via its storage listener

        sendResponse({ success: true });
      } catch (error) {
        console.error('[Yavar BG] Screenshot after selection failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle opening sidebar — must be synchronous to preserve user gesture
  if (message.action === 'open_sidebar') {
    const tabId = sender.tab?.id;
    if (tabId) {
      openPanel({ tabId, windowId: sender.tab?.windowId });
    }
    sendResponse({ success: true });
    return true;
  }
  
  // If no handler matched
  sendResponse({ error: 'No handler for message' });
  return true;
});

// The tab the user is looking at. When Yavar runs as its own window
// (browsers without a side panel), the "current window" is Yavar itself, so
// fall back to the last focused normal browser window.
async function getUserTab() {
  const own = chrome.runtime.getURL('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !(tab.url || '').startsWith(own)) return tab;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [t] = await chrome.tabs.query({ active: true, windowId: win.id });
    return t || null;
  } catch (e) {
    return null;
  }
}

// Injected into the active tab: pick what to send to Yavar. Hover outlines
// the element under the cursor and a click picks it; a drag picks an area.
// ↑ widens the pick to the parent. ✓ (or Enter) sends a screenshot of it
// plus what's in it (text, table cells, links, image descriptions, the
// heading above it); the panel turns those into the message's attachment.
// Self-contained: executeScript serializes only this function.
function injectPicker() {
  if (document.getElementById('yavar-area-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'yavar-area-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: transparent;
  `;

  // The picked (or hovered) box; its huge shadow dims everything else
  const box = document.createElement('div');
  box.style.cssText = `
    position: absolute; border: 2px solid #0071e3; background: rgba(0, 113, 227, 0.08);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35); border-radius: 4px; display: none; pointer-events: none;
  `;
  overlay.appendChild(box);

  const tag = document.createElement('div');
  tag.style.cssText = `
    position: absolute; display: none; padding: 2px 7px; border-radius: 5px; pointer-events: none;
    background: #0071e3; color: #fff; font: 600 11px/18px -apple-system, BlinkMacSystemFont, sans-serif;
    white-space: nowrap;
  `;
  overlay.appendChild(tag);

  const hint = document.createElement('div');
  hint.textContent = 'Click an element or drag an area · ↑ selects around it · Esc cancels';
  hint.style.cssText = `
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    padding: 8px 16px; background: rgba(0, 0, 0, 0.75); color: white;
    border-radius: 8px; font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none; white-space: nowrap;
  `;
  overlay.appendChild(hint);

  // After a pick: ✓ takes it, ✕ cancels, clicking or dragging again redoes it
  const bar = document.createElement('div');
  bar.style.cssText = `
    position: absolute; display: none; gap: 4px; padding: 4px;
    background: rgba(28, 28, 30, 0.92); border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); cursor: default;
  `;
  const barBtn = (label, title, bg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = `
      all: unset; box-sizing: border-box; width: 30px; height: 28px; border-radius: 7px;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      font: 600 15px -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; background: ${bg};
    `;
    bar.appendChild(b);
    return b;
  };
  const cancelBtn = barBtn('✕', 'Cancel (Esc)', 'transparent');
  const okBtn = barBtn('✓', 'Use this (Enter)', '#0071e3');
  overlay.appendChild(bar);

  let startX, startY, dragging = false, moved = false;
  let hovered = null;              // element under the cursor
  let picked = null;               // { el } or { area: rect }

  const clampRect = (r) => {
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right), bottom = Math.min(window.innerHeight, r.bottom);
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  };
  const place = (el, r) => Object.assign(el.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });

  const elementAt = (x, y) => document.elementsFromPoint(x, y).find(el => !overlay.contains(el) && el !== document.documentElement) || null;

  const describe = (el) => {
    const t = el.tagName.toLowerCase();
    const r = el.getBoundingClientRect();
    return `${t}${el.id ? '#' + el.id : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  };

  const showElement = (el) => {
    const r = clampRect(el.getBoundingClientRect());
    place(box, r);
    tag.textContent = describe(el);
    tag.style.display = 'block';
    tag.style.left = r.x + 'px';
    tag.style.top = Math.max(0, r.y - 22) + 'px';
  };

  const showBar = (r) => {
    bar.style.display = 'flex';
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const below = r.y + r.height + 8 + bh <= window.innerHeight;
    bar.style.left = Math.max(8, Math.min(r.x + r.width - bw, window.innerWidth - bw - 8)) + 'px';
    bar.style.top = (below ? r.y + r.height + 8 : Math.max(8, r.y + r.height - bh - 8)) + 'px';
    okBtn.focus();
  };

  const pickElement = (el) => {
    picked = { el };
    showElement(el);
    hint.style.display = 'none';
    showBar(clampRect(el.getBoundingClientRect()));
  };

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler, true);
  }

  // ---- What's in the pick ----
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n… [cut]' : s);
  const visibleText = (el) => clip((el.innerText || el.textContent || '').replace(/\n{3,}/g, '\n\n').trim(), 12000);

  const tableRows = (table) => [...table.rows].slice(0, 60)
    .map(tr => [...tr.cells].slice(0, 12).map(td => (td.innerText || '').trim()));

  const headingAbove = (el) => {
    let found = '';
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (h === el || h.contains(el)) continue;
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = (h.innerText || '').trim();
      else break;
    }
    return found.slice(0, 200);
  };

  // HTML only where the markup itself is the question (a control, a form) and small
  const INTERACTIVE = /^(button|a|input|select|textarea|form|label|details|dialog)$/;
  const markup = (el) => {
    const t = el.tagName.toLowerCase();
    if (!INTERACTIVE.test(t) && !el.querySelector('button, input, select, textarea')) return '';
    const copy = el.cloneNode(true);
    copy.querySelectorAll('script, style, svg').forEach(n => n.remove());
    const html = copy.outerHTML;
    return html.length <= 4000 ? html : '';
  };

  const linksIn = (root, keep = () => true) => [...root.querySelectorAll('a[href]')]
    .filter(a => /^https?:/.test(a.href) && keep(a))
    .slice(0, 25).map(a => ({ text: (a.innerText || '').trim().slice(0, 120), href: a.href }));
  const imagesIn = (root, keep = () => true) => [...root.querySelectorAll('img')]
    .filter(keep).slice(0, 10).map(i => ({ alt: (i.alt || '').trim().slice(0, 200), src: i.currentSrc || i.src }));

  // Does a box (DOMRect) overlap the picked area r?
  const overlaps = (r, b) => b.width && b.height && b.left < r.x + r.width && b.right > r.x && b.top < r.y + r.height && b.bottom > r.y;

  const collectElement = (el) => {
    const t = el.tagName.toLowerCase();
    const table = t === 'table' ? el : (el.querySelectorAll('table').length === 1 ? el.querySelector('table') : null);
    return {
      mode: 'element', tag: t, text: visibleText(el), rows: table ? tableRows(table) : [],
      links: t === 'a' && el.href ? [{ text: (el.innerText || '').trim(), href: el.href }] : linksIn(el),
      images: t === 'img' ? [{ alt: el.alt || '', src: el.currentSrc || el.src }] : imagesIn(el),
      heading: headingAbove(el), html: markup(el), url: location.href, title: document.title
    };
  };

  // For an area: the text nodes it covers, and the links and images in it
  const collectArea = (r) => {
    const hit = (el) => overlaps(r, el.getBoundingClientRect());
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.textContent.trim();
      if (!s || !n.parentElement || overlay.contains(n.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if ([...range.getClientRects()].some(b => overlaps(r, b))) parts.push(s);
    }
    const first = elementAt(r.x + r.width / 2, r.y + r.height / 2);
    return {
      mode: 'area', tag: '', text: clip(parts.join(' ').replace(/\s+/g, ' '), 12000), rows: [],
      links: linksIn(document.body, hit), images: imagesIn(document.body, hit),
      heading: first ? headingAbove(first) : '', html: '', url: location.href, title: document.title
    };
  };

  function confirm() {
    if (!picked) return;
    const rect = picked.el ? clampRect(picked.el.getBoundingClientRect()) : picked.area;
    if (rect.width < 4 || rect.height < 4) return;
    let capture = null;
    try {
      capture = picked.el ? collectElement(picked.el) : collectArea(rect);
    } catch (e) { /* the screenshot still goes */ }
    cleanup();
    chrome.runtime.sendMessage({ action: 'area_selected', rect: { ...rect, dpr: window.devicePixelRatio || 1 }, capture });
  }

  function keyHandler(e) {
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
    else if (e.key === 'Enter' && picked) { e.preventDefault(); confirm(); }
    else if (e.key === 'ArrowUp') {
      // Widen to the parent: of the pick, or else of what's hovered
      e.preventDefault();
      const el = picked?.el || hovered;
      const up = el?.parentElement;
      if (up && up !== document.documentElement) {
        if (picked) pickElement(up); else { hovered = up; showElement(up); }
      }
    }
  }

  bar.addEventListener('mousedown', (e) => e.stopPropagation());
  okBtn.addEventListener('click', confirm);
  cancelBtn.addEventListener('click', cleanup);

  overlay.addEventListener('mousemove', (e) => {
    if (dragging) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) moved = true;
      if (!moved) return;
      tag.style.display = 'none';
      place(box, { x: Math.min(e.clientX, startX), y: Math.min(e.clientY, startY),
        width: Math.abs(e.clientX - startX), height: Math.abs(e.clientY - startY) });
      return;
    }
    if (picked) return;
    const el = elementAt(e.clientX, e.clientY);
    if (el && el !== hovered) { hovered = el; showElement(el); }
  });

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    moved = false;
    picked = null;
    bar.style.display = 'none';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) {
      // A click: pick the element under it
      const el = elementAt(e.clientX, e.clientY);
      if (el) pickElement(el);
      return;
    }
    const area = { x: Math.min(e.clientX, startX), y: Math.min(e.clientY, startY),
      width: Math.abs(e.clientX - startX), height: Math.abs(e.clientY - startY) };
    if (area.width < 10 || area.height < 10) { box.style.display = 'none'; return; }
    picked = { area };
    hint.style.display = 'none';
    showBar(area);
  });

  document.addEventListener('keydown', keyHandler, true);
  document.body.appendChild(overlay);
}

console.log('[Yavar] Background service worker initialized');
