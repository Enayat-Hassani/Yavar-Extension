// Context Menu Handler

export const ContextMenuHandler = {
  async createMenus() {
    // Remove existing menus first
    await chrome.contextMenus.removeAll();

    // Create context menu items
    chrome.contextMenus.create({
      id: 'ai-sidebar-selection',
      title: 'Copy to AI Sidebar',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'ai-sidebar-copy-page',
      title: 'Copy page content to AI',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'ai-sidebar-screenshot',
      title: 'Capture screenshot for AI',
      contexts: ['page']
    });

    // GitHub-specific: Explain code with AI
    chrome.contextMenus.create({
      id: 'explain-code',
      title: '🎓 Explain with AI',
      contexts: ['selection']
    });
  },

  async handleClick(info, tab) {
    switch (info.menuItemId) {
      case 'ai-sidebar-selection':
        await this.sendSelectionToSidebar(info.selectionText, tab);
        break;

      case 'ai-sidebar-copy-page':
        await this.copyPageToSidebar(tab);
        break;

      case 'ai-sidebar-screenshot':
        await this.captureAndSend(tab);
        break;

      case 'explain-code':
        await this.explainCode(info.selectionText, tab);
        break;
    }
  },

  async explainCode(selectionText, tab) {
    try {
      // Generate prompt for explaining code
      const prompt = `Explain this code like I'm a beginner:\n\n${selectionText}`;

      // Copy to clipboard via sidebar
      await chrome.storage.session.set({ 
        pendingText: prompt,
        pendingNotification: '✍️ Code copied! Press Cmd+V to explain.'
      });

      // Open sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[AI Sidebar] Explain code failed:', error);
    }
  },

  async sendSelectionToSidebar(text, tab) {
    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(text);

      // Store for sidebar
      await chrome.storage.session.set({ pendingText: text });

      // Open sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[AI Sidebar] Failed to send selection:', error);
    }
  },

  async copyPageToSidebar(tab) {
    try {
      // Execute script to extract page content
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const article = document.querySelector('article');
          if (article) return article.innerText;
          const main = document.querySelector('main');
          if (main) return main.innerText;
          return document.body.innerText;
        }
      });

      const content = result[0]?.result || '';

      if (content) {
        await chrome.storage.session.set({ pendingText: content });
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch (error) {
      console.error('[AI Sidebar] Failed to copy page:', error);
    }
  },

  async captureAndSend(tab) {
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
      console.error('[AI Sidebar] Screenshot capture failed:', error);
    }
  }
};
