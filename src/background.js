// Background Service Worker - AI Sidebar
// Handles extension lifecycle, context menus, commands, and message routing

import { ContextMenuHandler } from './utils/contextMenu.js';
import { CommandHandler } from './utils/commands.js';
import { MessageHandler } from './utils/messageHandler.js';
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

  // Handle area selection request from sidepanel
  if (message.action === 'start_area_select') {
    (async () => {
      try {
        const tab = await getUserTab();
        if (!tab) { sendResponse({ success: false }); return; }

        // Inject the area selection overlay into the active tab
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: injectAreaSelector
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
          pendingScreenshotRect: message.rect
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
  
  // Let MessageHandler handle OTHER messages (not GitHub API)
  // Only call MessageHandler if message has a type we don't handle above
  if (message.type) {
    MessageHandler.handle(message, sender, sendResponse);
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

// Injected into the active tab to let the user draw a selection rectangle
function injectAreaSelector() {
  // Prevent double-injection
  if (document.getElementById('yavar-area-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'yavar-area-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    z-index: 2147483647; cursor: crosshair;
    background: rgba(0, 0, 0, 0.3);
  `;

  const selection = document.createElement('div');
  selection.style.cssText = `
    position: absolute; border: 2px solid #0071e3;
    background: rgba(0, 113, 227, 0.08);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
    border-radius: 4px; display: none;
  `;
  overlay.appendChild(selection);

  const hint = document.createElement('div');
  hint.textContent = 'Drag to select area — press Esc to cancel';
  hint.style.cssText = `
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    padding: 8px 16px; background: rgba(0, 0, 0, 0.7); color: white;
    border-radius: 8px; font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none; white-space: nowrap;
  `;
  overlay.appendChild(hint);

  let startX, startY, dragging = false;

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', escHandler, true);
  }

  function escHandler(e) {
    if (e.key === 'Escape') cleanup();
  }

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0';
    selection.style.height = '0';
    hint.style.display = 'none';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    // Ignore tiny selections (accidental clicks)
    if (w < 10 || h < 10) {
      cleanup();
      return;
    }

    const rect = { x, y, width: w, height: h, dpr: window.devicePixelRatio || 1 };
    cleanup();

    // Tell background we have our selection
    chrome.runtime.sendMessage({ action: 'area_selected', rect });
  });

  document.addEventListener('keydown', escHandler, true);

  document.body.appendChild(overlay);
}

console.log('[Yavar] Background service worker initialized');
