// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture

class YavarContentHandler {
  constructor() {
    this.floatingMenu = null;
    this.selectedText = '';
    this.init();
  }

  init() {
    this.createFloatingMenu();
    this.addEventListeners();
    this.loadSettings();
  }

  async loadSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    this.enabled = !(settings?.disabledSites?.some(site => 
      window.location.href.includes(site)
    ));
    this.enableFloatingMenu = settings?.enableFloatingMenu ?? true;
  }

  createFloatingMenu() {
    const menu = document.createElement('div');
    menu.id = 'ai-sidebar-floating-menu';
    menu.className = 'ai-sidebar-menu';
    menu.style.display = 'none';
    
    menu.innerHTML = `
      <div class="ai-sidebar-menu-content">
        <button class="ai-menu-btn" data-action="copy" title="Copy to clipboard (Cmd+H)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="ai-menu-btn" data-action="explain" title="Explain this">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
        <button class="ai-menu-btn" data-action="summarize" title="Summarize">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
        <button class="ai-menu-btn" data-action="translate" title="Translate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 8l6 6"></path>
            <path d="M4 14h6l2-2H2"></path>
            <path d="M2 5h12"></path>
            <path d="M7 2h1"></path>
            <path d="M22 22l-5-10-5 10"></path>
            <path d="M14 18h6"></path>
          </svg>
        </button>
        <button class="ai-menu-btn" data-action="rewrite" title="Rewrite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      </div>
    `;
    
    document.body.appendChild(menu);
    this.floatingMenu = menu;
    
    // Add click handlers
    menu.querySelectorAll('.ai-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        this.handleMenuAction(action);
      });
    });
  }

  addEventListeners() {
    // Selection change handler
    document.addEventListener('selectionchange', () => {
      if (!this.enabled || !this.enableFloatingMenu) return;
      
      const selection = window.getSelection();
      this.selectedText = selection.toString().trim();
      
      if (this.selectedText.length > 0) {
        this.showFloatingMenu(selection);
      } else {
        this.hideFloatingMenu();
      }
    });

    // Hide menu on click elsewhere
    document.addEventListener('click', (e) => {
      if (!this.floatingMenu?.contains(e.target)) {
        this.hideFloatingMenu();
      }
    });

    // Keyboard shortcut listener
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      
      // Cmd+H (Mac) or Ctrl+H (Windows) - Copy selection
      if ((e.metaKey || e.ctrlKey) && e.key === 'H') {
        e.preventDefault();
        this.copySelection();
      }
      
      // Cmd+Shift+I (Mac) or Ctrl+Shift+I (Windows) - Trigger screenshot
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        this.triggerScreenshot();
      }
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SEND_SELECTION') {
        this.copySelection();
        sendResponse({ success: true });
      }
      return true;
    });
  }

  showFloatingMenu(selection) {
    if (!this.floatingMenu || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    const menu = this.floatingMenu;
    menu.style.display = 'block';
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 200)}px`;
    menu.style.top = `${rect.top + window.scrollY - 50}px`;
    menu.style.zIndex = '2147483647';
  }

  hideFloatingMenu() {
    if (this.floatingMenu) {
      this.floatingMenu.style.display = 'none';
    }
  }

  async handleMenuAction(action) {
    this.hideFloatingMenu();
    
    const promptMap = {
      'copy': '',
      'explain': 'Explain this in simple terms:',
      'summarize': 'Summarize this concisely:',
      'translate': 'Translate this to English:',
      'rewrite': 'Rewrite this to be clearer and more professional:'
    };
    
    // Copy the text to clipboard
    await this.copySelection();
    
    // Show notification via sidebar
    const message = {
      type: 'TEXT_SELECTION',
      text: this.selectedText,
      action: action,
      prompt: promptMap[action] || '',
      url: window.location.href,
      title: document.title
    };
    
    // Send to background script which forwards to sidebar
    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log('[Yavar] Could not send to sidebar:', error);
    }
  }

  async copySelection() {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    
    if (text.length === 0) {
      this.showBriefNotification('⚠️ No text selected');
      return;
    }
    
    try {
      await navigator.clipboard.writeText(text);
      this.selectedText = text;
      
      // Show brief notification
      const preview = text.substring(0, 40) + (text.length > 40 ? '...' : '');
      this.showBriefNotification(`📋 "${preview}" copied!`);
      
      // Also store for sidebar to pick up
      await chrome.storage.session.set({ pendingText: text });
      
    } catch (error) {
      console.error('[Yavar] Failed to copy:', error);
    }
  }

  async triggerScreenshot() {
    // Send message to background to capture screenshot
    try {
      await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
    } catch (error) {
      console.log('[Yavar] Could not trigger screenshot:', error);
    }
  }

  showBriefNotification(text) {
    // Create a brief inline notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      background: rgba(26, 26, 46, 0.95);
      color: white;
      border: 1px solid rgba(99, 102, 241, 0.5);
      border-radius: 8px;
      font-size: 13px;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideUp 0.2s ease;
      backdrop-filter: blur(8px);
    `;
    notification.textContent = text;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new YavarContentHandler());
} else {
  new YavarContentHandler();
}
