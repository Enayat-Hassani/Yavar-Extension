// Background Service Worker - AI Sidebar
// Handles extension lifecycle, context menus, commands, and message routing

import { ContextMenuHandler } from './utils/contextMenu.js';
import { CommandHandler } from './utils/commands.js';
import { MessageHandler } from './utils/messageHandler.js';
import { githubAPI } from './github-api.js';

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Yavar] Extension installed:', details.reason);
  
  // Initialize default settings
  const defaultSettings = {
    defaultAI: 'chatgpt',
    enableFloatingMenu: true,
    disabledSites: []
  };
  
  // Only set if not already set
  const existing = await chrome.storage.sync.get('settings');
  if (!existing.settings) {
    await chrome.storage.sync.set({ settings: defaultSettings });
  }
  
  // Create context menus
  await ContextMenuHandler.createMenus();
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ContextMenuHandler.handleClick(info, tab);
});

// Command handler (keyboard shortcuts)
chrome.commands.onCommand.addListener(async (command) => {
  await CommandHandler.handleCommand(command);
});

// Message routing - single listener for all messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message.action || message.type);
  
  // Handle ping to keep service worker awake
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    return true;
  }
  
  // Handle GitHub API fetch request (MUST be before MessageHandler)
  if (message.action === 'fetch_github_data') {
    console.log('[Background] Fetching GitHub data for:', message.owner, message.repo);
    
    githubAPI.fetchAllData(message.owner, message.repo)
      .then(data => {
        console.log('[Background] GitHub API response:', data.success ? 'success' : 'failed', data);
        sendResponse(data);
      })
      .catch(err => {
        console.error('[Background] GitHub API error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
  
  // Handle rate limit check
  if (message.action === 'check_github_rate_limit') {
    githubAPI.checkRateLimit()
      .then(limits => sendResponse(limits))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  
  // Handle storing pending text (content scripts can't use chrome.storage.session)
  if (message.action === 'store_pending_text') {
    (async () => {
      try {
        await chrome.storage.session.set({
          pendingText: message.text,
          pendingNotification: message.notification
        });
        console.log('[Background] Stored pending text in session');
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Background] Failed to store pending text:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // Handle opening sidebar
  if (message.action === 'open_sidebar') {
    (async () => {
      try {
        const tab = sender.tab || await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
        if (tab) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
          console.log('[Background] Sidebar opened');
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Background] Failed to open sidebar:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // Handle screenshot capture from content script
  if (message.type === 'CAPTURE_SCREENSHOT') {
    (async () => {
      try {
        // Get the tab where the request originated
        const tab = sender.tab || await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);

        // Capture visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 90
        });

        // Store for sidebar to pick up
        await chrome.storage.session.set({ pendingScreenshot: dataUrl });

        // Notify sidebar if open
        const views = chrome.extension.getViews({ type: 'panel' });
        views.forEach(view => {
          if (view.panel?.handleScreenshotCapture) {
            view.panel.handleScreenshotCapture(dataUrl);
          }
        });

        sendResponse({ success: true, imageData: dataUrl });
      } catch (error) {
        console.error('[Yavar] Screenshot capture failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // Let MessageHandler handle OTHER messages (not GitHub API)
  // Only call MessageHandler if message has a type we don't handle above
  if (message.type && !['CAPTURE_SCREENSHOT'].includes(message.type)) {
    MessageHandler.handle(message, sender, sendResponse);
    return true;
  }
  
  // If no handler matched
  sendResponse({ error: 'No handler for message' });
  return true;
});

// Side panel setup - open on action click
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

console.log('[Yavar] Background service worker initialized');
