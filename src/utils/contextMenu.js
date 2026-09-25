// Context Menu Handler

import { openPanel } from './panel.js';

export const ContextMenuHandler = {
  async createMenus() {
    // Remove existing menus first
    await chrome.contextMenus.removeAll();

    // Create context menu items
    chrome.contextMenus.create({
      id: 'yavar-copy-selection',
      title: 'Send selection to Yavar',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'yavar-copy-page',
      title: 'Add this page to the Yavar chat',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'yavar-screenshot',
      title: 'Capture screenshot for Yavar',
      contexts: ['page']
    });

    // GitHub-specific: Explain code with Guided Study mode
    chrome.contextMenus.create({
      id: 'yavar-explain-code',
      title: '🎓 Explain Code with Yavar',
      contexts: ['selection'],
      documentUrlPatterns: ['https://github.com/*']
    });
  },

  async handleClick(info, tab) {
    switch (info.menuItemId) {
      case 'yavar-copy-selection':
        await this.sendSelectionToYavar(info.selectionText, tab);
        break;

      case 'yavar-copy-page':
        await this.copyPageToYavar(tab);
        break;

      case 'yavar-screenshot':
        await this.captureAndSend(tab);
        break;

      case 'yavar-explain-code':
        await this.explainCodeWithGuidedStudy(info.selectionText, tab);
        break;
    }
  },

  async explainCodeWithGuidedStudy(selectionText, tab) {
    try {
      // Wrap code in Guided Study template
      const prompt = `Explain this to me using your guided study mode:

\`\`\`
${selectionText}
\`\`\``;

      // Copy to clipboard via Yavar
      // Open first: sidePanel.open() must run before any await to keep the
      // user gesture from the menu click.
      const opening = openPanel({ windowId: tab.windowId });
      await chrome.storage.session.set({ pendingText: prompt });
      await opening;
    } catch (error) {
      console.error('[Yavar] Explain code failed:', error);
    }
  },



  async sendSelectionToYavar(text, tab) {
    try {
      // The panel adds it to the message as a chip that remembers the page
      const opening = openPanel({ windowId: tab.windowId });
      await chrome.storage.session.set({ pendingSelection: { text, title: tab.title || '', url: tab.url || '' } });
      await opening;
    } catch (error) {
      console.error('[Yavar] Failed to send selection:', error);
    }
  },

  // The side panel's "Add page" flow extracts readable text and attaches long
  // pages as a file, so hand off to it rather than pasting raw innerText.
  async copyPageToYavar(tab) {
    try {
      const opening = openPanel({ windowId: tab.windowId });
      await chrome.storage.session.set({ pendingAction: 'add_page' });
      await opening;
    } catch (error) {
      console.error('[Yavar] Failed to send page:', error);
    }
  },

  async captureAndSend(tab) {
    try {
      // Open first (needs the menu click's user gesture), then capture
      const opening = openPanel({ windowId: tab.windowId });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await chrome.storage.session.set({ pendingScreenshot: dataUrl });
      await opening;
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
    }
  }
};
