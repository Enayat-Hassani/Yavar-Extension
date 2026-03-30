// Background Service Worker - AI Sidebar
// Handles extension lifecycle, context menus, commands, and message routing

import { ContextMenuHandler } from './utils/contextMenu.js';
import { CommandHandler } from './utils/commands.js';
import { MessageHandler } from './utils/messageHandler.js';

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

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  MessageHandler.handle(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

// Side panel setup - open on action click
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle screenshot capture from content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREENSHOT') {
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
    return true;
  }
});

console.log('[Yavar] Background service worker initialized');
