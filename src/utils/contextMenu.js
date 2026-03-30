// Context Menu Handler

export const ContextMenuHandler = {
  async createMenus() {
    // Remove existing menus first
    await chrome.contextMenus.removeAll();

    // Create context menu items
    chrome.contextMenus.create({
      id: 'yavar-copy-selection',
      title: 'Copy to Yavar',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'yavar-copy-page',
      title: 'Copy page content to Yavar',
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
      await chrome.storage.session.set({
        pendingText: prompt,
        pendingNotification: '📋 Code copied! Press Cmd+V to paste into Yavar'
      });

      // Open Yavar sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[Yavar] Explain code failed:', error);
    }
  },



  async sendSelectionToYavar(text, tab) {
    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(text);

      // Store for Yavar
      await chrome.storage.session.set({ pendingText: text });

      // Open Yavar sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[Yavar] Failed to send selection:', error);
    }
  },

  async copyPageToYavar(tab) {
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
      console.error('[Yavar] Failed to copy page:', error);
    }
  },

  async captureAndSend(tab) {
    try {
      // Capture visible tab
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 90
      });

      // Store for Yavar
      await chrome.storage.session.set({ pendingScreenshot: dataUrl });

      // Open Yavar sidebar
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
    }
  }
};
