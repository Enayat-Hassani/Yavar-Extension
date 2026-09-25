import { test } from 'node:test';
import assert from 'node:assert/strict';

// A chrome.* mock; `sidePanel` is left out to behave like Opera
function mockChrome({ sidePanel } = {}) {
  const calls = { created: [], updated: [], opened: [], behavior: [] };
  const session = {};
  const listeners = { action: null, connect: null };
  globalThis.chrome = {
    runtime: { getURL: p => 'chrome-extension://x/' + p, onConnect: { addListener: fn => { listeners.connect = fn; } } },
    action: { onClicked: { addListener: fn => { listeners.action = fn; } } },
    storage: { session: { get: async k => ({ [k]: session[k] }), set: async o => Object.assign(session, o) } },
    windows: {
      get: async id => ({ id, left: 100, top: 50, width: 1400, height: 900 }),
      getLastFocused: async () => ({ id: 1, left: 0, top: 0, width: 1200, height: 800 }),
      create: async o => { calls.created.push(o); return { id: 77 }; },
      update: async (id, o) => { calls.updated.push([id, o]); if (id !== 77) throw new Error('No window'); }
    }
  };
  if (sidePanel) {
    chrome.sidePanel = {
      open: async o => { calls.opened.push(o); },
      setPanelBehavior: async o => { calls.behavior.push(o); }
    };
  }
  return { calls, listeners };
}

const load = () => import('../src/utils/panel.js?' + Math.random());

test('Opera-like browser: no crash, toolbar click opens a docked window once', async () => {
  const { calls, listeners } = mockChrome();
  const panel = await load();
  panel.trackPanels();
  panel.setupActionClick();                       // used to throw: sidePanel undefined
  await listeners.action({ windowId: 5 });
  assert.equal(calls.created.length, 1);
  assert.deepEqual(calls.created[0], {
    url: 'chrome-extension://x/sidepanel.html', type: 'popup', width: 440, focused: true,
    left: 100 + 1400 - 440, top: 50, height: 900
  });
  // Second click focuses the same window instead of opening another
  await panel.openPanel({ windowId: 5 });
  assert.equal(calls.created.length, 1);
  assert.deepEqual(calls.updated.at(-1), [77, { focused: true }]);
});

test('an open panel page (e.g. Opera sidebar) is reused, not duplicated', async () => {
  const { calls, listeners } = mockChrome();
  const panel = await load();
  panel.trackPanels();
  const port = { name: 'yavar-panel', onDisconnect: { addListener() {} } };
  listeners.connect(port);
  assert.equal(panel.panelIsOpen(), true);
  await panel.openPanel({});
  assert.equal(calls.created.length, 0);
});

test('Chrome: uses the side panel API', async () => {
  const { calls, listeners } = mockChrome({ sidePanel: true });
  const panel = await load();
  panel.setupActionClick();
  assert.deepEqual(calls.behavior, [{ openPanelOnActionClick: true }]);
  await panel.openPanel({ tabId: 9 });
  await panel.openPanel({ windowId: 3 });
  assert.deepEqual(calls.opened, [{ tabId: 9 }, { windowId: 3 }]);
  assert.equal(calls.created.length, 0);
});
