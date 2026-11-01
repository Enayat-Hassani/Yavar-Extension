// In the chat view, what comes from outside the panel goes straight into the
// chat and the chat stays on screen; in the Yavar view it joins the message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

const setup = (page) => page.evaluate(() => {
  const p = window.__panel;
  window.__posted = [];
  p.postToChat = (m) => window.__posted.push(m);
  p.showNotification = () => {};
});
const view = (page) => page.evaluate(() => window.__panel._view);
const posted = (page) => page.evaluate(() => window.__posted.map(m => ({ action: m.action, name: m.filename, prompt: m.prompt })));

test('selections, pages, screenshots and prompts go into the chat without leaving it', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await setup(page);
    await page.evaluate(() => window.__panel.setView('chat'));

    await page.evaluate(() => window.__panel.attachSelection({ text: 'the quick fox', title: 'Foxes', url: 'https://x.test/f' }));
    await page.evaluate(() => window.__panel.addComposerItem({ kind: 'page', label: 'P', filename: 'p.txt', content: 'body', mime: 'text/plain', what: 'a page' }));
    await page.evaluate(() => window.__panel.addComposerItem({ kind: 'image', label: 'Screenshot', image: 'data:image/png;base64,AAAA', filename: 'screenshot.png', what: 'a shot' }));
    await page.evaluate(() => window.__panel.fillComposer('explain this'));
    await page.evaluate(() => window.__panel.runPendingAction('screenshot'));

    const sent = await posted(page);
    assert.deepEqual(sent.map(m => m.action), ['AUTO_PASTE_PROMPT', 'AUTO_ATTACH_FILE', 'AUTO_PASTE_SCREENSHOT', 'AUTO_PASTE_PROMPT']);
    assert.match(sent[0].prompt, /the quick fox/);
    assert.match(sent[0].prompt, /Foxes/);
    assert.equal(sent[1].name, 'p.txt');
    assert.equal(sent[3].prompt, 'explain this');
    assert.equal(await view(page), 'chat', 'the chat is still showing');
    assert.equal(await page.evaluate(() => window.__panel.composerItems.length), 0, 'nothing waits in the Yavar message box');

    // A floating-menu prompt sent right away is submitted in the chat
    await page.evaluate(async () => {
      await chrome.storage.sync.set({ settings: { autoSubmit: true } });
      await window.__panel.handlePendingPrompt('Summarize: foo', 'Summarize');
    });
    assert.equal((await posted(page)).at(-1).action, 'AUTO_SUBMIT_PROMPT');
    assert.equal(await view(page), 'chat');

    // The Yavar view still collects attachments in its message box
    await page.evaluate(() => window.__panel.setView('app'));
    await page.evaluate(() => window.__panel.attachSelection({ text: 'kept here', title: '', url: '' }));
    assert.equal(await page.evaluate(() => window.__panel.composerItems.length), 1);
    assert.equal(await view(page), 'app');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
