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
  
  // Handle auto-submit: store prompt, open sidebar, notify sidepanel
  if (message.action === 'trigger_auto_submit') {
    const tabId = sender.tab?.id;
    console.log('[Yavar BG] trigger_auto_submit received, prompt length:', message.prompt?.length);

    // CRITICAL: Store prompt FIRST (sync-safe), then open panel SYNCHRONOUSLY
    // sidePanel.open() must be called without any await before it to preserve user gesture
    chrome.storage.session.set({
      pendingAutoSubmit: message.prompt,
      lastSubmitTime: Date.now()
    });

    // Open sidepanel synchronously — no await before this call
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(err => {
        console.error('[Yavar BG] sidePanel.open failed:', err);
      });
    }

    // Staggered messages to sidepanel — it may not have its listener ready yet
    const payload = { action: 'AUTO_SUBMIT_PROMPT', prompt: message.prompt };
    const delays = [300, 800, 1500, 3000];
    delays.forEach(delay => {
      setTimeout(() => {
        chrome.runtime.sendMessage(payload).catch(() => {});
      }, delay);
    });

    sendResponse({ success: true });
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

  // Handle opening sidebar — must be synchronous to preserve user gesture
  if (message.action === 'open_sidebar') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(err => {
        console.error('[Background] Failed to open sidebar:', err);
      });
    }
    sendResponse({ success: true });
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
