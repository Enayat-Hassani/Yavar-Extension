// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture

class YavarContentHandler {
  constructor() {
    this.floatingMenu = null;
    this.currentText = '';
    this.hideTimeout = null;
    this.enabled = true;
    this.enableFloatingMenu = true;
    this.init();
  }

  async init() {
    await this.loadSettings();
    if (this.enabled) {
      this.createFloatingMenu();
      this.addEventListeners();
      console.log('[Yavar] Content handler initialized');
    } else {
      console.log('[Yavar] Content handler disabled for this site');
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
      // Default to enabled if storage fails
      this.enabled = true;
      this.enableFloatingMenu = true;
    }
  }

  createFloatingMenu() {
    // Check if menu already exists
    if (document.getElementById('yavar-floating-menu')) {
      console.log('[Yavar] Menu already exists, skipping creation');
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'yavar-floating-menu';
    menu.className = 'yavar-menu';
    menu.style.display = 'none';
    menu.style.position = 'fixed';
    menu.style.zIndex = '2147483647';
    menu.style.userSelect = 'none';
    menu.style.pointerEvents = 'auto';

    menu.innerHTML = `
      <div class="yavar-menu-content">
        <button class="yavar-menu-btn" data-action="copy" title="Copy to clipboard">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy</span>
        </button>
        <button class="yavar-menu-btn primary" data-action="learn" title="Learn it with AI">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
          <span>Learn it with AI</span>
        </button>
      </div>
    `;

    // Button handlers
    menu.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.handleAction(action);
    });

    // Prevent menu clicks from triggering selection loss
    menu.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    document.body.appendChild(menu);
    this.floatingMenu = menu;
    console.log('[Yavar] Floating menu created');
  }

  addEventListeners() {
    // Primary trigger: mouseup (stable, used by production extensions)
    document.addEventListener('mouseup', (e) => {
      if (!this.enabled || !this.enableFloatingMenu) return;

      // Don't trigger if clicking on the menu itself
      if (this.floatingMenu && this.floatingMenu.contains(e.target)) return;

      // Small delay to ensure selection is complete
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

    // Fallback for keyboard selection
    document.addEventListener('selectionchange', () => {
      if (!this.enabled || !this.enableFloatingMenu) return;

      const text = window.getSelection().toString().trim();
      if (text.length === 0 && this.floatingMenu && this.floatingMenu.style.display !== 'none') {
        this.hideFloatingMenu();
      }
    });

    // Hide when clicking outside the menu
    document.addEventListener('mousedown', (e) => {
      if (!this.floatingMenu || this.floatingMenu.style.display === 'none') return;
      // Don't hide if clicking on the menu itself
      if (this.floatingMenu.contains(e.target)) return;
      this.hideFloatingMenu();
    });

    // Handle scroll - hide menu
    document.addEventListener('scroll', () => {
      this.hideFloatingMenu();
    }, { passive: true });

    console.log('[Yavar] Event listeners added');
  }

  showFloatingMenu(selection) {
    if (!this.floatingMenu) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Menu dimensions
      const menuHeight = 56;
      const menuWidth = 220;

      // Calculate position - use viewport coordinates directly
      let top = rect.top - menuHeight - 10;
      let left = rect.left + (rect.width / 2) - (menuWidth / 2); // Center on selection

      // Edge-of-screen guard - if not enough space above, show below
      if (top < 10) {
        top = rect.bottom + 10;
      }

      // Edge-of-screen guard - right
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
      }

      // Edge-of-screen guard - left
      if (left < 10) {
        left = 10;
      }

      // Apply styles
      this.floatingMenu.style.top = `${Math.round(top)}px`;
      this.floatingMenu.style.left = `${Math.round(left)}px`;
      this.floatingMenu.style.display = 'block';
    } catch (error) {
      console.error('[Yavar] Error positioning menu:', error);
    }
  }

  hideFloatingMenu() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      if (this.floatingMenu) {
        this.floatingMenu.style.display = 'none';
        this.currentText = '';
      }
    }, 100);
  }

  async handleAction(action) {
    if (!this.currentText) {
      console.warn('[Yavar] No text selected for action:', action);
      return;
    }

    console.log('[Yavar] Handling action:', action, 'Text length:', this.currentText.length);

    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(this.currentText);
        this.showButtonFeedback('copy', '✓ Copied!');
        this.hideFloatingMenu();
        console.log('[Yavar] Text copied to clipboard');
      } catch (err) {
        console.error('[Yavar] Copy failed:', err);
        this.showButtonFeedback('copy', '✗ Failed');
      }
    } else if (action === 'learn') {
      try {
        // Build the guided study prompt
        const prompt = `Explain this to me using "Guided Learning" Mode:\n\n${this.currentText}`;

        // Copy to clipboard locally
        await navigator.clipboard.writeText(prompt);

        // Send to background to store in session (content scripts can't use chrome.storage.session directly)
        chrome.runtime.sendMessage({
          action: 'store_pending_text',
          text: prompt,
          notification: '📋 Text ready! Press Cmd+V to paste into Yavar'
        }, () => {
          // Open sidebar after storing
          chrome.runtime.sendMessage({ action: 'open_sidebar' });
        });

        this.showButtonFeedback('learn', '✓ Ready!');
        this.hideFloatingMenu();
        console.log('[Yavar] Learn prompt prepared and sidebar opening');
      } catch (err) {
        console.error('[Yavar] Learn action failed:', err);
        this.showButtonFeedback('learn', '✗ Failed');
      }
    }
  }

  showButtonFeedback(action, message) {
    if (!this.floatingMenu) return;

    const btn = this.floatingMenu.querySelector(`[data-action="${action}"]`);
    if (!btn) return;

    const originalHTML = btn.innerHTML;
    const originalWidth = btn.offsetWidth;

    // Show feedback
    btn.innerHTML = `<span style="font-size: 12px; font-weight: 600;">${message}</span>`;
    btn.style.width = `${originalWidth}px`; // Prevent layout shift

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

// Listen for messages from background/script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Yavar Content] Message received:', request);

  if (request.action === 'get_selection') {
    const selection = window.getSelection().toString();
    sendResponse({ selection });
    return true;
  }

  if (request.action === 'trigger_menu') {
    // Force show menu for testing
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text && this.floatingMenu) {
      this.currentText = text;
      this.showFloatingMenu(selection);
    }
    sendResponse({ success: true });
    return true;
  }
});

console.log('[Yavar] Content script loaded');
