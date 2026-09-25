// Command Handler (Keyboard Shortcuts)

import { openPanel } from './panel.js';

export const CommandHandler = {
  // `tab` comes with the command event; only query when it's missing, since
  // an await before opening the panel loses the shortcut's user gesture.
  async handleCommand(command, tab) {
    if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
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
        this.toggleNotes(tab);
        break;
    }
  },

  async toggleSidebar(tab) {
    if (tab) {
      await openPanel({ windowId: tab.windowId });
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

  // Queue the request for the panel, which runs it on open (or at once if
  // it's already open). A message sent after opening would reach a panel
  // that isn't listening yet.
  toggleNotes(tab) {
    if (!tab) return;
    openPanel({ windowId: tab.windowId });
    chrome.storage.session.set({ pendingAction: 'notes' });
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
    
    openPanel({ windowId: tab.windowId });
    chrome.storage.session.set({ pendingAction: 'explain_repo' });
  }
};
