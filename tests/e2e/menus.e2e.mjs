// The menus say each thing once: ⋯ does not repeat the start page, + lists
// only what can be added, and a fresh chat is offered only with a conversation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

const ids = (page) => page.evaluate(() => [...document.querySelectorAll('#tool-menu-list .lens-item')].map(x => x.dataset.tool));

test('⋯ leaves out what the start page shows, and + leaves out what cannot be added', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    const home = await page.evaluate(() => [...document.querySelectorAll('.home [data-home]')].map(x => x.dataset.home));
    assert.deepEqual(home, ['read_folder', 'review_changes', 'ideas']);

    await page.click('#app-more');
    const more = await ids(page);
    assert.deepEqual(more, ['library', 'settings'], 'no start-page row, no fresh chat without a conversation');
    assert.equal(await page.evaluate(() => document.querySelector('#tool-menu-list .lens-divider:first-child') === null), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('tool-menu').classList.add('hidden'));

    await page.click('#composer-add');
    assert.deepEqual(await ids(page), ['pick_local'], 'no tab open: only the folder can be added, and no prompts row');
    assert.match(await page.textContent('#tool-menu-list .lens-note'), /Open a web page/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#tool-menu-list [disabled]').length), 0);
    await page.evaluate(() => document.getElementById('tool-menu').classList.add('hidden'));

    // With a conversation, the project tools come back to ⋯ and a fresh chat is offered
    await page.evaluate(() => {
      const p = window.__panel;
      p.threadBody.innerHTML = '<div class="thread-q"></div>';
      p._turns = [{ q: 'hi', a: 'hello', by: 'x', el: p.threadBody.firstChild }];
    });
    await page.click('#app-more');
    assert.deepEqual(await ids(page), ['read_folder', 'review_changes', 'ideas', 'library', 'carry_over', 'settings']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
