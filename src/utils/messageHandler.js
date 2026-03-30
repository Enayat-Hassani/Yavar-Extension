// Message Handler - Routes messages between components

export const MessageHandler = {
  async handle(message, sender, sendResponse) {
    console.log('[AI Sidebar] Message received:', message.type);
    
    try {
      switch (message.type) {
        case 'GET_SETTINGS':
          const { settings } = await chrome.storage.sync.get('settings');
          sendResponse({ settings });
          break;
          
        case 'UPDATE_SETTINGS':
          await chrome.storage.sync.set({ settings: message.settings });
          sendResponse({ success: true });
          break;
          
        case 'TEXT_SELECTION':
        case 'PAGE_SUMMARY':
          // Store for sidebar to pick up
          if (message.text) {
            await chrome.storage.session.set({ pendingText: message.text });
          }
          sendResponse({ success: true });
          break;
          
        case 'IS_SITE_DISABLED':
          const disabled = await this.isSiteDisabled(message.url);
          sendResponse({ disabled });
          break;
          
        case 'TOGGLE_SITE_DISABLE':
          await this.toggleSiteDisabled(message.url);
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[AI Sidebar] Message handler error:', error);
      sendResponse({ error: error.message });
    }
  },

  async isSiteDisabled(url) {
    const { settings } = await chrome.storage.sync.get('settings');
    return settings?.disabledSites?.some(site => url.includes(site)) || false;
  },

  async toggleSiteDisabled(url) {
    const { settings } = await chrome.storage.sync.get('settings');
    if (!settings.disabledSites) {
      settings.disabledSites = [];
    }
    
    const index = settings.disabledSites.findIndex(site => url.includes(site));
    if (index >= 0) {
      settings.disabledSites.splice(index, 1);
    } else {
      // Extract domain
      const domain = new URL(url).hostname;
      settings.disabledSites.push(domain);
    }
    
    await chrome.storage.sync.set({ settings });
  }
};
