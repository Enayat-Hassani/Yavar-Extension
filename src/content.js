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
  const used = new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]));
  let out = body;
  for (const name of used) {
    const getter = getters[name];
    const value = getter ? await getter() : '';
    out = out.replace(new RegExp('\\{\\{\\s*' + name + '\\s*\\}\\}', 'g'), value);
  }
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
    if (this.enabled) {
      // Don't create menu here — lazy-init on first text selection
      this.addEventListeners();
      // Rebuild the menu if the user edits their templates in options
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.promptTemplates) {
          this.templates = changes.promptTemplates.newValue || this.templates;
          this.rebuildFloatingMenu();
        }
      });
    }
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

    for (const tpl of menuTemplates) {
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
      menuContent.appendChild(btn);
    }

    menu.appendChild(menuContent);
    document.body.appendChild(menu);
    this.floatingMenu = menu;

    // Hovering the menu should keep it open; leaving arms a hide.
    menuContent.addEventListener('mouseenter', () => {
      this.isInteracting = true;
      if (this.hideTimeout) clearTimeout(this.hideTimeout);
    });
    menuContent.addEventListener('mouseleave', () => {
      this.isInteracting = false;
    });

    // Use pointerdown + preventDefault so the text selection isn't lost before
    // we read it, and the click always lands even on a quick tap.
    menuContent.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('[data-template-id]');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      this.runTemplate(button.dataset.templateId);
    });
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
        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : '';

        if (text.length > 0 && text.length < 5000) {
          this.currentText = text;
          this.showFloatingMenu(selection);
        } else {
          this.forceHide();
        }
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
      const text = (window.getSelection()?.toString() || '').trim();
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

  showFloatingMenu(selection) {
    // Lazy-init: create menu on first use
    this.ensureFloatingMenu();
    if (!this.floatingMenu) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // Degenerate rect (e.g. selection inside an input) → skip
      if (rect.width === 0 && rect.height === 0) return;

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

      if (top < pad) top = rect.bottom + 8;                       // flip below if no room above
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
    this.currentText = '';
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

      const prompt = await expandTemplate(tpl.body, ctx);
      chrome.runtime.sendMessage({ action: 'trigger_auto_submit', prompt });
      this.forceHide();
    } catch (err) {
      console.error('[Yavar Content] Template failed:', err);
      this.showButtonFeedback(templateId,
        err.message?.includes('Extension context invalidated') ? 'Reload page' : 'Failed');
    }
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
