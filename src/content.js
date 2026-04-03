// Content Script - Text Selection & Keyboard Shortcuts
// Runs on all pages to handle text selection and capture

class YavarContentHandler {
  constructor() {
    this.floatingMenu = null;
    this.currentText = '';
    this.hideTimeout = null;
    this.isInteracting = false;  // Track if user is interacting with menu
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

    // Inline critical styles to ensure they work
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

    // Create Send button (icon only) - sends text as-is
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

    // Create Explain button (icon only) - sends with guided learning prompt
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
    
    // OBVIOUS DEBUG: Log to prove code is running
    console.log('🔴 YAVAR DEBUG: Menu created! If you see this, code IS loading!');
    console.log('🔴 YAVAR DEBUG: Menu element:', menu);
    
    // Set up interaction tracking AFTER menu is in DOM
    const menuContent = menu.querySelector('.yavar-menu-content');
    
    // Track interaction state - mouse enters menu area
    menuContent.addEventListener('mouseenter', () => {
      this.isInteracting = true;
      console.log('[Yavar] Mouse entered menu - isInteracting = true');
      if (this.hideTimeout) clearTimeout(this.hideTimeout);
    });

    menuContent.addEventListener('mouseleave', () => {
      this.isInteracting = false;
      console.log('[Yavar] Mouse left menu - isInteracting = false');
    });

    // Button handlers - use pointerdown for immediate response
    menuContent.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const action = button.dataset.action;
      console.log('[Yavar] Button pointerdown:', action);
      this.handleAction(action);
    });

    // Add hover effects inline (CSS file might not load properly)
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
        if (!isPrimary) {
          btn.style.color = '#1d1d1f';
        } else {
          btn.style.color = 'white';
        }
        console.log('[Yavar] Button hover:', btn.dataset.action);
      });

      btn.addEventListener('mouseleave', () => {
        const isPrimary = btn.classList.contains('primary');
        if (isPrimary) {
          btn.style.background = 'rgba(0, 113, 227, 0.15)';
          btn.style.borderColor = 'rgba(0, 113, 227, 0.3)';
          btn.style.color = '#1d1d1f';
        } else {
          btn.style.background = 'transparent';
          btn.style.borderColor = 'transparent';
          btn.style.color = '#1d1d1f';
        }
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = 'none';
      });
    });

    console.log('[Yavar] Floating menu created with interaction tracking');
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

    // Hide when clicking outside the menu
    document.addEventListener('mousedown', (e) => {
      if (!this.floatingMenu || this.floatingMenu.style.display === 'none') return;
      // Don't hide if clicking on the menu itself
      if (this.floatingMenu.contains(e.target)) return;
      // Don't hide if user is interacting with menu
      if (this.isInteracting) return;
      // Delay hide to allow button clicks to process
      this.hideTimeout = setTimeout(() => {
        if (!this.isInteracting) {
          this.hideFloatingMenu();
        }
      }, 100);
    });

    // Handle scroll - hide menu with debounce
    let scrollTimeout;
    document.addEventListener('scroll', () => {
      if (!this.floatingMenu || this.floatingMenu.style.display === 'none') return;
      if (this.isInteracting) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.hideFloatingMenu();
      }, 150);
    }, { passive: true });

    console.log('[Yavar] Event listeners added');
  }

  showFloatingMenu(selection) {
    if (!this.floatingMenu) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Menu dimensions (smaller for icon-only buttons)
      const menuHeight = 40;
      const menuWidth = 80;

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

      console.log('[Yavar] Menu is now VISIBLE at position', top, left);
    } catch (error) {
      console.error('[Yavar] Error positioning menu:', error);
    }
  }

  hideFloatingMenu() {
    console.log('[Yavar] hideFloatingMenu called, isInteracting:', this.isInteracting);
    // Don't hide if user is interacting with the menu
    if (this.isInteracting) {
      console.log('[Yavar] NOT hiding menu - user is interacting');
      return;
    }
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      console.log('[Yavar] Hiding menu now');
      if (this.floatingMenu) {
        this.floatingMenu.style.display = 'none';
        this.currentText = '';
      }
    }, 200);
  }

  async handleAction(action) {
    if (!this.currentText) {
      console.warn('[Yavar] No text selected for action:', action);
      return;
    }

    console.log('[Yavar Content] Button clicked:', action, 'Text length:', this.currentText.length);

    if (action === 'send') {
      // Send text as-is to AI
      try {
        const prompt = this.currentText;

        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
          console.warn('[Yavar Content] Extension context invalidated — reload the page');
          this.showButtonFeedback('send', '✗ Reload page');
          return;
        }

        // Show immediate feedback
        this.showButtonFeedback('send', '✓ ...');

        // Send to background (this will open sidebar + trigger auto-submit)
        chrome.runtime.sendMessage({
          action: 'trigger_auto_submit',
          prompt: prompt
        }, (response) => {
          console.log('[Yavar Content] Background responded:', response);
        });

        this.hideFloatingMenu();
        console.log('[Yavar Content] Send triggered');
      } catch (err) {
        console.error('[Yavar Content] Send action failed:', err);
        if (err.message?.includes('Extension context invalidated')) {
          this.showButtonFeedback('send', '✗ Reload page');
        } else {
          this.showButtonFeedback('send', '✗ Failed');
        }
      }
    } else if (action === 'explain') {
      // Send with Guided Learning prompt
      try {
        const prompt = `Explain this to me using "Guided Learning" Mode:\n\n${this.currentText}`;

        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
          console.warn('[Yavar Content] Extension context invalidated — reload the page');
          this.showButtonFeedback('explain', '✗ Reload page');
          return;
        }

        // Show immediate feedback
        this.showButtonFeedback('explain', '✓ ...');

        // Send to background (this will open sidebar + trigger auto-submit)
        chrome.runtime.sendMessage({
          action: 'trigger_auto_submit',
          prompt: prompt
        }, (response) => {
          console.log('[Yavar Content] Background responded:', response);
        });

        this.hideFloatingMenu();
        console.log('[Yavar Content] Explain triggered');
      } catch (err) {
        console.error('[Yavar Content] Explain action failed:', err);
        if (err.message?.includes('Extension context invalidated')) {
          this.showButtonFeedback('explain', '✗ Reload page');
        } else {
          this.showButtonFeedback('explain', '✗ Failed');
        }
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
