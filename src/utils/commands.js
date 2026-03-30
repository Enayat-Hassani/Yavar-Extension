// Command Handler (Keyboard Shortcuts)

export const CommandHandler = {
  async handleCommand(command) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    switch (command) {
      case 'toggle-sidebar':
        await this.toggleSidebar(tab);
        break;
      case 'copy-selection':
        await this.copySelection(tab);
        break;
      case 'capture-screenshot':
        await this.captureScreenshot(tab);
        break;
      case 'trigger-learn':
        await this.triggerLearn(tab);
        break;
    }
  },

  async toggleSidebar(tab) {
    if (tab) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  },

  async copySelection(tab) {
    if (!tab) return;
    
    try {
      // Execute script to get selection and copy it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const selection = window.getSelection();
          const text = selection.toString().trim();
          if (text) {
            navigator.clipboard.writeText(text);
            return { success: true, text: text.substring(0, 50) };
          }
          return { success: false, error: 'No selection' };
        }
      });
      
      // Open sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[Yavar] Failed to copy selection:', error);
    }
  },

  async captureScreenshot(tab) {
    if (!tab) return;
    
    try {
      // Capture visible tab
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 90
      });
      
      // Store for sidebar
      await chrome.storage.session.set({ pendingScreenshot: dataUrl });
      
      // Open sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
    }
  },

  async triggerLearn(tab) {
    if (!tab) return;
    
    // Check if on GitHub
    if (!tab.url.includes('github.com')) {
      // Show notification that it only works on GitHub
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Show brief notification
          const notification = document.createElement('div');
          notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #1a1a2e;
            color: white;
            border: 1px solid #ef4444;
            border-radius: 8px;
            font-size: 13px;
            z-index: 2147483647;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          `;
          notification.textContent = '⚠️ Open a GitHub repository to use this feature';
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 3000);
        }
      });
      return;
    }
    
    try {
      // Open sidebar - the sidepanel.js will handle the analysis
      await chrome.sidePanel.open({ windowId: tab.windowId });
      
      // Send message to sidepanel to trigger analysis
      setTimeout(async () => {
        await chrome.runtime.sendMessage({ action: 'trigger_learn' });
      }, 300);
    } catch (error) {
      console.error('[Yavar] Trigger learn failed:', error);
    }
  }
};
