// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture

class YavarContentHandler {
  constructor() {
    this.floatingMenu = null;
    this.currentText = '';
    this.hideTimeout = null;
    this.isInteracting = false;
    this.enabled = true;
    this.enableFloatingMenu = true;
    this.init();
  }

  async init() {
    await this.loadSettings();
    if (this.enabled) {
      // Don't create menu here — lazy-init on first text selection
      this.addEventListeners();
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

    // Send button
    const sendBtn = document.createElement('button');
    sendBtn.className = 'yavar-menu-btn';
    sendBtn.dataset.action = 'send';
    sendBtn.title = 'Send to AI';
    sendBtn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: #1d1d1f;
      cursor: pointer;
      transition: all 0.12s ease;
      pointer-events: auto;
    `;
    sendBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
        <path d="M22 2L11 13"></path>
        <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
      </svg>
    `;

    // Explain button
    const explainBtn = document.createElement('button');
    explainBtn.className = 'yavar-menu-btn primary';
    explainBtn.dataset.action = 'explain';
    explainBtn.title = 'Explain with Guided Learning';
    explainBtn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      background: rgba(0, 113, 227, 0.15);
      border: 1px solid rgba(0, 113, 227, 0.3);
      border-radius: 6px;
      color: #1d1d1f;
      cursor: pointer;
      transition: all 0.12s ease;
      pointer-events: auto;
    `;
    explainBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
        <circle cx="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;

    menuContentDiv.appendChild(sendBtn);
    menuContentDiv.appendChild(explainBtn);
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
      const button = e.target.closest('[data-action]');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      this.handleAction(button.dataset.action);
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

      const menuHeight = 40;
      const menuWidth = 80;

      let top = rect.top - menuHeight - 10;
      let left = rect.left + (rect.width / 2) - (menuWidth / 2);

      if (top < 10) top = rect.bottom + 10;
      if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
      if (left < 10) left = 10;

      this.floatingMenu.style.top = `${Math.round(top)}px`;
      this.floatingMenu.style.left = `${Math.round(left)}px`;
      this.floatingMenu.style.display = 'block';
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

  async handleAction(action) {
    if (!this.currentText) return;

    if (action === 'send') {
      try {
        const prompt = this.currentText;

        if (!chrome.runtime?.id) {
          this.showButtonFeedback('send', '✗ Reload page');
          return;
        }

        this.showButtonFeedback('send', '✓ ...');

        chrome.runtime.sendMessage({
          action: 'trigger_auto_submit',
          prompt: prompt
        });

        this.hideFloatingMenu();
      } catch (err) {
        console.error('[Yavar Content] Send failed:', err);
        this.showButtonFeedback('send', err.message?.includes('Extension context invalidated') ? '✗ Reload page' : '✗ Failed');
      }
    } else if (action === 'explain') {
      try {
        const prompt = `Explain this to me using "Guided Learning" Mode:\n\n${this.currentText}`;

        if (!chrome.runtime?.id) {
          this.showButtonFeedback('explain', '✗ Reload page');
          return;
        }

        this.showButtonFeedback('explain', '✓ ...');

        chrome.runtime.sendMessage({
          action: 'trigger_auto_submit',
          prompt: prompt
        });

        this.hideFloatingMenu();
      } catch (err) {
        console.error('[Yavar Content] Explain failed:', err);
        this.showButtonFeedback('explain', err.message?.includes('Extension context invalidated') ? '✗ Reload page' : '✗ Failed');
      }
    }
  }

  showButtonFeedback(action, message) {
    if (!this.floatingMenu) return;

    const btn = this.floatingMenu.querySelector(`[data-action="${action}"]`);
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
