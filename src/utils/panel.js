// Opening the Yavar panel on every Chromium browser.
//
// Chrome/Edge/Brave have chrome.sidePanel. Opera doesn't (it shows the
// manifest's sidebar_action in its own sidebar instead), and calling the
// missing API used to crash the whole service worker there. Where there is
// no side panel API, Yavar opens as a slim window docked to the right of
// the browser window, reusing it if it's already open.

const POPUP_KEY = 'yavarPopupWindowId';
const openPanels = new Set();   // ports from open Yavar panel pages

export const hasSidePanel = () => typeof chrome.sidePanel?.open === 'function';

// Panel pages connect a port so we know one is open (any browser)
export function trackPanels() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'yavar-panel') return;
    openPanels.add(port);
    port.onDisconnect.addListener(() => openPanels.delete(port));
  });
}

export const panelIsOpen = () => openPanels.size > 0;

// Must be called synchronously from a user gesture (click, shortcut, menu):
// sidePanel.open() fails once an await has happened.
export function openPanel({ tabId, windowId } = {}) {
  if (hasSidePanel()) {
    const opts = tabId != null ? { tabId } : { windowId };
    return chrome.sidePanel.open(opts).catch(err => {
      console.warn('[Yavar] sidePanel.open failed:', err?.message);
    });
  }
  if (panelIsOpen()) return focusPopup();
  return openPopup(windowId);
}

async function focusPopup() {
  try {
    const { [POPUP_KEY]: id } = await chrome.storage.session.get(POPUP_KEY);
    if (id != null) await chrome.windows.update(id, { focused: true });
  } catch (e) { /* the panel may be Opera's sidebar, which can't be focused */ }
}

async function openPopup(windowId) {
  try {
    const { [POPUP_KEY]: existing } = await chrome.storage.session.get(POPUP_KEY);
    if (existing != null) {
      try {
        await chrome.windows.update(existing, { focused: true });
        return;
      } catch (e) { /* closed: make a new one */ }
    }
    let base = null;
    try {
      base = windowId != null ? await chrome.windows.get(windowId) : await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    } catch (e) { /* no reference window */ }
    const width = 440;
    const opts = { url: chrome.runtime.getURL('sidepanel.html'), type: 'popup', width, focused: true };
    if (base && base.width) {
      opts.left = Math.max(0, base.left + base.width - width);
      opts.top = base.top;
      opts.height = base.height;
    }
    const win = await chrome.windows.create(opts);
    await chrome.storage.session.set({ [POPUP_KEY]: win.id });
  } catch (e) {
    console.error('[Yavar] Could not open the panel window:', e);
  }
}

// Open the side panel when the toolbar icon is clicked (Chrome), or fall
// back to the window on browsers without the API.
export function setupActionClick() {
  if (typeof chrome.sidePanel?.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  chrome.action.onClicked.addListener((tab) => openPanel({ windowId: tab?.windowId }));
}
