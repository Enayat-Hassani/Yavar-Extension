// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture

import { loadTemplates, expandTemplate, varsInTemplate } from './utils/templates.js';

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
    menu.style.zIndex = '2147483647';
    menu.style.userSelect = 'none';
    menu.style.pointerEvents = 'auto';

    const menuContentDiv = document.createElement('div');
    menuContentDiv.className = 'yavar-menu-content';
    menuContentDiv.style.cssText = `
      display: flex;
      gap: 4px;
      padding: 6px;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
    `;

    // One button per menu-flagged template
    const menuTemplates = (this.templates || []).filter(t => t.menu);
    if (!menuTemplates.length) menuTemplates.push({ id: 'send', name: 'Send', icon: '➤', body: '{{selection}}' });

    for (const tpl of menuTemplates) {
      const btn = document.createElement('button');
      const isPrimary = !!tpl.primary;
      btn.className = 'yavar-menu-btn' + (isPrimary ? ' primary' : '');
      btn.dataset.templateId = tpl.id;
      btn.title = tpl.name;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-width: 30px;
        padding: 6px 9px;
        font-size: 13px;
        font-weight: 600;
        background: ${isPrimary ? 'rgba(0, 113, 227, 0.15)' : 'transparent'};
        border: 1px solid ${isPrimary ? 'rgba(0, 113, 227, 0.3)' : 'transparent'};
        border-radius: 6px;
        color: #1d1d1f;
        cursor: pointer;
        transition: all 0.12s ease;
        pointer-events: auto;
        white-space: nowrap;
      `;
      btn.innerHTML =
        `<span style="font-size:14px;pointer-events:none;line-height:1;">${this.escapeHtml(tpl.icon || '•')}</span>` +
        `<span style="pointer-events:none;">${this.escapeHtml(tpl.name)}</span>`;
      menuContentDiv.appendChild(btn);
    }

    menu.appendChild(menuContentDiv);

    document.body.appendChild(menu);
    this.floatingMenu = menu;

    // Interaction tracking
    const menuContent = menu.querySelector('.yavar-menu-content');

    menuContent.addEventListener('mouseenter', () => {
      this.isInteracting = true;
      if (this.hideTimeout) clearTimeout(this.hideTimeout);
    });

    menuContent.addEventListener('mouseleave', () => {
      this.isInteracting = false;
    });

    menuContent.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('[data-template-id]');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      this.runTemplate(button.dataset.templateId);
    });

    // Hover effects
    const buttons = menuContent.querySelectorAll('.yavar-menu-btn');
    buttons.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const isPrimary = btn.classList.contains('primary');
        btn.style.background = isPrimary ? '#0071e3' : 'rgba(0, 113, 227, 0.12)';
        btn.style.borderColor = 'rgba(0, 113, 227, 0.4)';
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = isPrimary
          ? '0 4px 12px rgba(0, 113, 227, 0.3)'
          : '0 2px 8px rgba(0, 113, 227, 0.15)';
        btn.style.color = isPrimary ? 'white' : '#1d1d1f';
      });

      btn.addEventListener('mouseleave', () => {
        const isPrimary = btn.classList.contains('primary');
        btn.style.background = isPrimary ? 'rgba(0, 113, 227, 0.15)' : 'transparent';
        btn.style.borderColor = isPrimary ? 'rgba(0, 113, 227, 0.3)' : 'transparent';
        btn.style.color = '#1d1d1f';
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = 'none';
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  addEventListeners() {
    document.addEventListener('mouseup', (e) => {
      if (!this.enabled || !this.enableFloatingMenu) return;
      if (this.floatingMenu && this.floatingMenu.contains(e.target)) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text.length > 0 && text.length < 5000) {
          this.currentText = text;
          this.showFloatingMenu(selection);
        } else {
          this.hideFloatingMenu();
        }
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.floatingMenu || this.floatingMenu.style.display === 'none') return;
      if (this.floatingMenu.contains(e.target)) return;
      if (this.isInteracting) return;
      this.hideTimeout = setTimeout(() => {
        if (!this.isInteracting) {
          this.hideFloatingMenu();
        }
      }, 100);
    });

    let scrollTimeout;
    document.addEventListener('scroll', () => {
      if (!this.floatingMenu || this.floatingMenu.style.display === 'none') return;
      if (this.isInteracting) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.hideFloatingMenu();
      }, 150);
    }, { passive: true });
  }

  showFloatingMenu(selection) {
    // Lazy-init: create menu on first use
    this.ensureFloatingMenu();
    if (!this.floatingMenu) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Show first (off-screen) so we can measure the real, variable width
      this.floatingMenu.style.visibility = 'hidden';
      this.floatingMenu.style.display = 'block';
      const menuWidth = this.floatingMenu.offsetWidth || 120;
      const menuHeight = this.floatingMenu.offsetHeight || 40;

      let top = rect.top - menuHeight - 10;
      let left = rect.left + (rect.width / 2) - (menuWidth / 2);

      if (top < 10) top = rect.bottom + 10;
      if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
      if (left < 10) left = 10;

      this.floatingMenu.style.top = `${Math.round(top)}px`;
      this.floatingMenu.style.left = `${Math.round(left)}px`;
      this.floatingMenu.style.visibility = 'visible';
    } catch (error) {
      console.error('[Yavar] Error positioning menu:', error);
    }
  }

  hideFloatingMenu() {
    if (this.isInteracting) return;
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      if (this.floatingMenu) {
        this.floatingMenu.style.display = 'none';
        this.currentText = '';
      }
    }, 200);
  }

  async runTemplate(templateId) {
    if (!this.currentText) return;
    const tpl = (this.templates || []).find(t => t.id === templateId);
    if (!tpl) return;

    try {
      if (!chrome.runtime?.id) {
        this.showButtonFeedback(templateId, '✗ Reload page');
        return;
      }

      // Only gather the context the template actually references
      const vars = varsInTemplate(tpl.body);
      const ctx = { selection: this.currentText };
      if (vars.includes('page')) ctx.page = this.getReadablePageText();
      if (vars.includes('url')) ctx.url = window.location.href;
      if (vars.includes('title')) ctx.title = document.title;

      const prompt = await expandTemplate(tpl.body, ctx);
      this.showButtonFeedback(templateId, '✓ ...');

      chrome.runtime.sendMessage({ action: 'trigger_auto_submit', prompt });
      this.hideFloatingMenu();
    } catch (err) {
      console.error('[Yavar Content] Template failed:', err);
      this.showButtonFeedback(templateId,
        err.message?.includes('Extension context invalidated') ? '✗ Reload page' : '✗ Failed');
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

  showButtonFeedback(templateId, message) {
    if (!this.floatingMenu) return;

    const btn = this.floatingMenu.querySelector(`[data-template-id="${templateId}"]`);
    if (!btn) return;

    const originalHTML = btn.innerHTML;
    const originalWidth = btn.offsetWidth;

    btn.innerHTML = `<span style="font-size: 12px; font-weight: 600;">${message}</span>`;
    btn.style.width = `${originalWidth}px`;

    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.width = '';
    }, 1200);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new YavarContentHandler());
} else {
  new YavarContentHandler();
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_selection') {
    const selection = window.getSelection().toString();
    sendResponse({ selection });
    return true;
  }
});
