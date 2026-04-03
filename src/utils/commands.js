// Command Handler (Keyboard Shortcuts)

export const CommandHandler = {
  async handleCommand(command) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    switch (command) {
      case 'toggle-sidebar':
        await this.toggleSidebar(tab);
        break;
      case 'capture-screenshot':
        await this.captureScreenshot(tab);
        break;
      case 'trigger-learn':
        await this.triggerLearn(tab);
        break;
      case 'toggle-notes':
        await this.toggleNotes(tab);
        break;
    }
  },

  async toggleSidebar(tab) {
    if (tab) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  },

  async captureScreenshot(tab) {
    if (!tab) return;

    try {
      // Inject area selection overlay — background handles the rest
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Trigger the same area selector injection via message
          chrome.runtime.sendMessage({ action: 'start_area_select' });
        }
      });
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
    }
  },

  async toggleNotes(tab) {
    if (!tab) return;
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'toggle_notes' });
      }, 300);
    } catch (error) {
      console.error('[Yavar] Toggle notes failed:', error);
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
