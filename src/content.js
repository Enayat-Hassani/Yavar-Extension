// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture
//
// NOTE: this runs on EVERY page, so it must never fail to load. We inline the
// template helpers here (rather than `import`-ing utils/templates.js) because a
// module content script whose import fails to resolve executes nothing at all.
// Keep DEFAULT_TEMPLATES in sync with src/utils/templates.js (used by the
// options page and sidepanel, which are regular extension pages).

const DEFAULT_TEMPLATES = [
  { id: 'send',      name: 'Send',            icon: '➤', menu: true,  body: '{{selection}}' },
  { id: 'explain',   name: 'Explain',         icon: '?', menu: true,  primary: true, body: 'Explain this to me using "Guided Learning" mode:\n\n{{selection}}' },
  { id: 'summarize', name: 'Summarize',       icon: '≡', menu: true,  body: 'Summarize the key points of this clearly and concisely:\n\n{{selection}}' },
  { id: 'improve',   name: 'Improve writing', icon: '✎', menu: false, body: 'Improve the clarity, grammar and flow of this text. Return only the rewritten version:\n\n{{selection}}' },
  { id: 'translate', name: 'Translate → EN',  icon: '文', menu: false, body: 'Translate this into natural English. Return only the translation:\n\n{{selection}}' },
  { id: 'ask-page',  name: 'Ask about page',  icon: '◆', menu: false, body: 'Here is the page I\'m reading:\n\n{{page}}\n\n---\nAnswer my question about it: ' },
];

function varsInTemplate(body) {
  return [...new Set([...String(body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
}

async function expandTemplate(body, ctx = {}) {
  const getters = {
    selection: () => ctx.selection ?? '',
    page:      () => ctx.page ?? '',
    repo:      () => ctx.repo ?? '',
    url:       () => ctx.url ?? '',
    title:     () => ctx.title ?? '',
    clipboard: async () => {
      if (ctx.clipboard != null) return ctx.clipboard;
      try { return await navigator.clipboard.readText(); } catch { return ''; }
    },
  };
  // Resolve every referenced value first, then substitute in ONE pass, so
  // text inside a value (e.g. a selection containing "{{page}}") is never expanded.
  const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
  const values = {};
  for (const name of new Set([...body.matchAll(PLACEHOLDER)].map(m => m[1]))) {
    const getter = getters[name];
    values[name] = getter ? String(await getter() ?? '') : '';
  }
  const out = body.replace(PLACEHOLDER, (_, name) => values[name]);
  return out.trim();
}

async function loadTemplates() {
  try {
    const { promptTemplates } = await chrome.storage.sync.get('promptTemplates');
    if (Array.isArray(promptTemplates) && promptTemplates.length) return promptTemplates;
  } catch { /* fall through to defaults */ }
  return DEFAULT_TEMPLATES.slice();
}

// Crisp line icons for the built-in templates. Custom templates fall back to
// their glyph. Keyed by template id; each is the inner markup of a 24-box SVG.
const TEMPLATE_ICONS = {
  send:      '<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path>',
  explain:   '<circle cx="12" cy="12" r="10"></circle><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
  summarize: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
  improve:   '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>',
  translate: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
  more:      '<circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle>',
  'ask-page':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>',
};

function iconSvg(id) {
  const inner = TEMPLATE_ICONS[id];
  if (!inner) return null;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">${inner}</svg>`;
}

class YavarContentHandler {
  constructor() {
    this.floatingMenu = null;
    this.currentText = '';
    this.hideTimeout = null;
    this.isInteracting = false;
    this.enabled = true;
    this.enableFloatingMenu = true;
    this.templates = [];
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.templates = await loadTemplates();
    // Listeners check this.enabled on each event, so settings changes apply
    // live without reloading the page. The menu itself is created lazily.
    this.addEventListeners();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.promptTemplates) {
        this.templates = changes.promptTemplates.newValue || DEFAULT_TEMPLATES.slice();
        this.rebuildFloatingMenu();
      }
      if (changes.settings) {
        this.loadSettings().then(() => {
          if (!this.enabled || !this.enableFloatingMenu) this.forceHide();
        });
      }
    });
  }

  async loadSettings() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      this.enabled = !(settings?.disabledSites?.some(site =>
        window.location.href.includes(site)
      ));
      this.enableFloatingMenu = settings?.enableFloatingMenu ?? true;
    } catch (error) {
      console.error('[Yavar] Failed to load settings:', error);
      this.enabled = true;
      this.enableFloatingMenu = true;
    }
  }

  // Tear down and recreate the menu (e.g. after templates change). It will
  // lazy-rebuild on the next selection.
  rebuildFloatingMenu() {
    if (this.floatingMenu) {
      this.floatingMenu.remove();
      this.floatingMenu = null;
    }
    const existing = document.getElementById('yavar-floating-menu');
    if (existing) existing.remove();
  }

  ensureFloatingMenu() {
    if (this.floatingMenu) return;
    if (document.getElementById('yavar-floating-menu')) return;

    const menu = document.createElement('div');
    menu.id = 'yavar-floating-menu';
    menu.className = 'yavar-menu';
    menu.style.display = 'none';
    menu.style.position = 'fixed';
    menu.style.top = '0';
    menu.style.left = '0';
    menu.style.zIndex = '2147483647';
    menu.style.userSelect = 'none';

    const menuContent = document.createElement('div');
    menuContent.className = 'yavar-menu-content';

    // One icon button per menu-flagged template (styling lives in content.css)
    const menuTemplates = (this.templates || []).filter(t => t.menu);
    if (!menuTemplates.length) menuTemplates.push({ id: 'send', name: 'Send', icon: '➤', body: '{{selection}}' });

    const makeBtn = (tpl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yavar-menu-btn' + (tpl.primary ? ' primary' : '');
      btn.dataset.templateId = tpl.id;
      btn.title = tpl.name;
      btn.setAttribute('aria-label', tpl.name);
      const svg = iconSvg(tpl.id);
      btn.innerHTML = svg
        ? svg
        : `<span class="yavar-glyph" style="pointer-events:none;">${this.escapeHtml(tpl.icon || '•')}</span>`;
      return btn;
    };
    for (const tpl of menuTemplates) menuContent.appendChild(makeBtn(tpl));
    menu.appendChild(menuContent);

    // Templates not pinned to the pill live behind a "more" button, so every
    // template is reachable from the page without a trip to Settings.
    const extraTemplates = (this.templates || []).filter(t => !t.menu);
    if (extraTemplates.length) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'yavar-menu-btn';
      moreBtn.dataset.yavarMore = '1';
      moreBtn.title = 'More prompts';
      moreBtn.setAttribute('aria-label', 'More prompts');
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.innerHTML = iconSvg('more');
      menuContent.appendChild(moreBtn);

      const list = document.createElement('div');
      list.className = 'yavar-menu-more';
      list.setAttribute('role', 'menu');
      list.hidden = true;
      for (const tpl of extraTemplates) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'yavar-menu-item';
        item.setAttribute('role', 'menuitem');
        item.dataset.templateId = tpl.id;
        const svg = iconSvg(tpl.id);
        item.innerHTML =
          `<span class="yavar-menu-item-icon">${svg || this.escapeHtml(tpl.icon || '•')}</span>` +
          `<span class="yavar-menu-item-name">${this.escapeHtml(tpl.name)}</span>`;
        list.appendChild(item);
      }
      menu.appendChild(list);
      this.moreList = list;
      this.moreBtn = moreBtn;
    } else {
      this.moreList = null;
      this.moreBtn = null;
    }

    document.body.appendChild(menu);
    this.floatingMenu = menu;

    // Hovering the menu should keep it open; leaving arms a hide.
    menu.addEventListener('mouseenter', () => {
      this.isInteracting = true;
      if (this.hideTimeout) clearTimeout(this.hideTimeout);
    });
    menu.addEventListener('mouseleave', () => {
      this.isInteracting = false;
    });

    // Use pointerdown + preventDefault so the text selection isn't lost before
    // we read it, and the click always lands even on a quick tap.
    menu.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-yavar-more]')) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMoreList();
        return;
      }
      const button = e.target.closest('[data-template-id]');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      this.runTemplate(button.dataset.templateId);
    });
  }

  // Open the overflow list on the side away from the selection (so it never
  // covers the text), falling back to the other side when there's no room.
  toggleMoreList(force) {
    if (!this.moreList) return;
    const open = force ?? this.moreList.hidden;
    this.moreList.hidden = !open;
    this.moreBtn?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const menuRect = this.floatingMenu.getBoundingClientRect();
    const listHeight = this.moreList.offsetHeight;
    const fitsAbove = menuRect.top > listHeight + 12;
    const fitsBelow = window.innerHeight - menuRect.bottom > listHeight + 12;
    const above = this.menuAboveSelection ? (fitsAbove || !fitsBelow) : (!fitsBelow && fitsAbove);
    this.moreList.classList.toggle('above', above);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  menuVisible() {
    return this.floatingMenu && this.floatingMenu.style.display !== 'none';
  }

  addEventListeners() {
    document.addEventListener('mouseup', (e) => {
      if (!this.enabled || !this.enableFloatingMenu) return;
      if (this.floatingMenu && this.floatingMenu.contains(e.target)) return;

      // Let the selection settle after the mouse is released
      setTimeout(() => {
        // Read-only textareas first (GitHub's code view selects inside one):
        // the page selection has no usable rect there, so read the textarea
        // directly and place the menu at the mouse.
        const ta = this.readOnlyTextareaSelection();
        if (ta) {
          this.currentText = ta.text;
          this.textareaSel = ta;
          this.showFloatingMenuAt({ left: e.clientX, right: e.clientX, top: e.clientY - 12, bottom: e.clientY + 12, width: 1, height: 24 });
          return;
        }

        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : '';
        if (text.length > 0 && text.length < 20000) {
          this.currentText = text;
          this.textareaSel = null;
          this.showFloatingMenu(selection);
          return;
        }
        this.forceHide();
      }, 10);
    });

    // Clicking anywhere outside the menu dismisses it right away
    document.addEventListener('mousedown', (e) => {
      if (!this.menuVisible()) return;
      if (this.floatingMenu.contains(e.target)) return;
      this.forceHide();
    }, true);

    // If the selection is cleared or changed away, drop the menu
    document.addEventListener('selectionchange', () => {
      if (!this.menuVisible() || this.isInteracting) return;
      const text = this.textareaSel
        ? this.hasTextareaSelection()
        : (window.getSelection()?.toString() || '').trim();
      if (!text) this.forceHide();
    });

    // The menu is pinned to a selection rect, so any scroll/resize invalidates it
    let scrollTimeout;
    const dropOnMove = () => {
      if (!this.menuVisible() || this.isInteracting) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => this.forceHide(), 120);
    };
    document.addEventListener('scroll', dropOnMove, { passive: true, capture: true });
    window.addEventListener('resize', () => this.forceHide());

    // Esc dismisses
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.menuVisible()) this.forceHide();
    });
  }

  // Selected text in the focused read-only textarea (GitHub's code view)
  readOnlyTextareaSelection() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'TEXTAREA' || !el.readOnly) return null;
    const { selectionStart: a, selectionEnd: b } = el;
    if (a == null || b == null || a === b || b - a >= 20000) return null;
    const text = el.value.slice(a, b).trim();
    return text ? { text, el, a, b } : null;
  }

  // Cheap check for selectionchange (fires on every drag step)
  hasTextareaSelection() {
    const el = document.activeElement;
    return !!(el && el.tagName === 'TEXTAREA' && el.selectionStart !== el.selectionEnd);
  }

  // 1-based line range of a textarea selection, computed only when needed
  textareaLines({ el, a, b }) {
    const v = el.value;
    let start = 1;
    for (let i = v.indexOf('\n'); i !== -1 && i < a; i = v.indexOf('\n', i + 1)) start++;
    let end = start;
    const last = v.slice(a, b).replace(/\n+$/, '');
    for (let i = last.indexOf('\n'); i !== -1; i = last.indexOf('\n', i + 1)) end++;
    return { startLine: start, endLine: end };
  }

  showFloatingMenu(selection) {
    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      // Degenerate rect (e.g. selection inside an input) → skip
      if (rect.width === 0 && rect.height === 0) return;
      this.showFloatingMenuAt(rect);
    } catch (error) {
      console.error('[Yavar] Error positioning menu:', error);
    }
  }

  // Place the menu above (or below) a rect in viewport coordinates
  showFloatingMenuAt(rect) {
    // Lazy-init: create menu on first use
    this.ensureFloatingMenu();
    if (!this.floatingMenu) return;

    try {

      if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }

      // Reveal (still transparent) so we can measure the real size, then place it
      this.floatingMenu.style.visibility = 'hidden';
      this.floatingMenu.style.display = 'block';
      const { offsetWidth: w, offsetHeight: h } = this.floatingMenu;
      const menuWidth = w || 120;
      const menuHeight = h || 40;
      const pad = 8;

      let top = rect.top - menuHeight - 8;
      let left = rect.left + rect.width / 2 - menuWidth / 2;

      this.menuAboveSelection = top >= pad;
      if (!this.menuAboveSelection) top = rect.bottom + 8;       // flip below if no room above
      top = Math.min(top, window.innerHeight - menuHeight - pad); // clamp to viewport
      left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));

      this.floatingMenu.style.top = `${Math.round(top)}px`;
      this.floatingMenu.style.left = `${Math.round(left)}px`;

      // Replay the entrance animation on every show (not just first insert)
      const content = this.floatingMenu.firstElementChild;
      if (content) {
        content.style.animation = 'none';
        void content.offsetWidth; // reflow
        content.style.animation = '';
      }

      this.floatingMenu.style.visibility = 'visible';
    } catch (error) {
      console.error('[Yavar] Error positioning menu:', error);
    }
  }

  // Arm a hide unless the user is actively hovering the menu.
  hideFloatingMenu() {
    if (this.isInteracting) return;
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.forceHide(), 180);
  }

  // Hide immediately, regardless of hover state (used after an action runs).
  forceHide() {
    if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }
    this.isInteracting = false;
    if (this.floatingMenu) this.floatingMenu.style.display = 'none';
    this.toggleMoreList(false);
    this.currentText = '';
    this.textareaSel = null;
  }

  async runTemplate(templateId) {
    if (!this.currentText) return;
    const tpl = (this.templates || []).find(t => t.id === templateId);
    if (!tpl) return;

    try {
      if (!chrome.runtime?.id) {
        this.showButtonFeedback(templateId, 'Reload page');
        return;
      }

      // Only gather the context the template actually references
      const vars = varsInTemplate(tpl.body);
      const ctx = { selection: this.currentText };
      if (vars.includes('page')) ctx.page = this.getReadablePageText();
      if (vars.includes('url')) ctx.url = window.location.href;
      if (vars.includes('title')) ctx.title = document.title;

      let prompt = await expandTemplate(tpl.body, ctx);
      // On a GitHub file page, say where the code came from so the AI can
      // reason about it (and you can find it again).
      const source = vars.includes('selection') ? this.githubSourceNote() : '';
      if (source) prompt += '\n\n' + source;
      chrome.runtime.sendMessage({ action: 'trigger_auto_submit', prompt });
      this.forceHide();
    } catch (err) {
      console.error('[Yavar Content] Template failed:', err);
      this.showButtonFeedback(templateId,
        err.message?.includes('Extension context invalidated') ? 'Reload page' : 'Failed');
    }
  }

  // "(Lines 12-20 of `src/app.ts` in owner/repo)" on github.com/…/blob/… pages
  githubSourceNote() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/);
    if (location.hostname !== 'github.com' || !m) return '';
    let path;
    try { path = decodeURIComponent(m[3]); } catch { path = m[3]; }
    let lines = 'From ';
    if (this.textareaSel) {
      const { startLine, endLine } = this.textareaLines(this.textareaSel);
      lines = (startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`) + ' of ';
    }
    return `(${lines}\`${path}\` in ${m[1]}/${m[2]})`;
  }

  // Best-effort readable text of the live page (mirror of the sidepanel's htmlToText).
  getReadablePageText(maxChars = 12000) {
    try {
      const root = document.querySelector('article') || document.querySelector('main') || document.body;
      if (!root) return '';
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer,header,form,button,aside').forEach(el => el.remove());
      let text = (clone.innerText || clone.textContent || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const title = document.title ? `# ${document.title}\n\n` : '';
      text = title + text;
      if (text.length > maxChars) text = text.slice(0, maxChars) + '\n… [truncated]';
      return text;
    } catch (e) {
      return '';
    }
  }

  // Briefly replace the pill with a short message (used for errors).
  showButtonFeedback(templateId, message) {
    if (!this.floatingMenu) return;
    const content = this.floatingMenu.querySelector('.yavar-menu-content');
    if (!content) return;

    if (this._savedMenuHTML == null) this._savedMenuHTML = content.innerHTML;
    content.innerHTML = `<div class="yavar-menu-msg">${this.escapeHtml(message)}</div>`;

    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => {
      if (this._savedMenuHTML != null) {
        content.innerHTML = this._savedMenuHTML;
        this._savedMenuHTML = null;
      }
    }, 1600);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.__yavarHandler = new YavarContentHandler(); });
} else {
  window.__yavarHandler = new YavarContentHandler();
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_selection') {
    const selection = window.getSelection().toString();
    sendResponse({ selection });
    return true;
  }
  if (request.action === 'get_page_text') {
    try {
      const handler = window.__yavarHandler;
      const text = handler
        ? handler.getReadablePageText(request.maxChars || 40000)
        : (document.body?.innerText || '').slice(0, request.maxChars || 40000);
      sendResponse({ text, title: document.title, url: window.location.href });
    } catch (e) {
      sendResponse({ text: '', title: document.title, url: window.location.href, error: e.message });
    }
    return true;
  }
});
