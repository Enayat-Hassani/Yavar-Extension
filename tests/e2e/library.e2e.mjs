// The Library: saved answers and notes in one sheet, one entry in ⋯, and one
// export that holds both. Settings: the prompts a review asks, and Labs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, wait } from './harness.mjs';

test('saved answers and notes are one Library with two tabs, exported together', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html', { height: 700 });
    const r = await page.evaluate(async () => {
      const p = window.__panel;
      const shown = (el) => !el.classList.contains('hidden');
      const pause = (ms) => new Promise(x => setTimeout(x, ms));
      await p.addHistoryEntry({ id: 'h1', ts: Date.now(), platform: 'ChatGPT', url: '', prompt: 'What is a closure?', answer: 'A function with its scope.' });
      document.getElementById('app-more').click();
      const menu = [...document.querySelectorAll('#tool-menu-list .lens-item')].map(x => x.dataset.tool);
      document.querySelector('#tool-menu-list [data-tool="library"]').click();
      await pause(200);
      const opened = shown(p.historyPanel) ? 'answers' : 'notes';
      document.querySelector('#history-panel [data-lib="notes"]').click();
      await pause(200);
      const onNotes = [shown(p.historyPanel), shown(p.notesPanel)];
      p.cmEditor.setValue('Closures keep scope.');
      await pause(600);
      document.querySelector('#notes-panel [data-lib="answers"]').click();
      await pause(200);
      let file = '';
      p.downloadText = (name, text) => { file = `${name}\n${text}`; };
      await p.exportHistory();
      return { menu, opened, onNotes, back: [shown(p.historyPanel), shown(p.notesPanel)], file };
    });
    assert.ok(r.menu.includes('library') && !r.menu.includes('history') && !r.menu.includes('notes'), r.menu.join(', '));
    assert.equal(r.opened, 'answers');
    assert.deepEqual(r.onNotes, [false, true]);
    assert.deepEqual(r.back, [true, false]);
    assert.match(r.file, /^yavar-library-[\d-]+\.md\n# Yavar Library/);
    assert.match(r.file, /\*\*Prompt:\*\*\n\nWhat is a closure\?/);
    assert.match(r.file, /# Notes\n\nClosures keep scope\.\n$/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a review prompt edited in Settings is kept alone, and can be reset', async () => {
  const b = await launch();
  try {
    const page = await b.open('options.html#prompts', { width: 900, height: 800 });
    await wait(page, 800);
    const names = await page.locator('#review-steps .coach-step-name').allInnerTexts();
    assert.deepEqual(names, ['Explain', 'Overview', 'Syntax', 'Syntax across the project', 'Line by line', 'Find bugs', 'Better ways', 'How to test it']);
    await page.locator('[data-review="bugs"]').fill('Only security problems, please.');
    await wait(page, 700);
    const saved = await page.evaluate(async () => (await chrome.storage.sync.get('review')).review);
    assert.deepEqual(saved, { bugs: 'Only security problems, please.' });
    await page.locator('[data-reset-review="bugs"]').click();
    await wait(page, 700);
    assert.deepEqual(await page.evaluate(async () => (await chrome.storage.sync.get('review')).review), {});
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('an Ideas round edited in Settings is kept alone, can be reset, and keeps {{text}} when you answer it', async () => {
  const b = await launch();
  try {
    const page = await b.open('options.html#prompts', { width: 900, height: 800 });
    await wait(page, 800);
    const names = (await page.locator('#ideas-steps .coach-step-name').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(names, ['1. Scan', '2. Diverge runs on its own', '3. Critique', '4. Deepen runs on its own']);
    const stored = () => page.evaluate(async () => (await chrome.storage.sync.get('ideas')).ideas);
    // A round you answer without {{text}} is refused, and nothing is saved
    await page.locator('[data-idea="critique"]').fill('Develop these, whatever they are.');
    await wait(page, 700);
    assert.equal(await page.locator('#ideas-steps .coach-step-error').nth(2).isVisible(), true);
    assert.equal(await stored(), undefined);
    await page.locator('[data-idea="critique"]').fill('Develop these: {{text}}. Be brief.');
    // A round that runs on its own needs no {{text}}
    await page.locator('[data-idea="diverge"]').fill('Two ideas.');
    await wait(page, 700);
    assert.deepEqual(await stored(), { prompts: { critique: 'Develop these: {{text}}. Be brief.', diverge: 'Two ideas.' } });
    await page.locator('[data-reset-idea="diverge"]').click();
    await wait(page, 700);
    assert.deepEqual(await stored(), { prompts: { critique: 'Develop these: {{text}}. Be brief.' } });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the extras live on the Labs page, off until turned on', async () => {
  const b = await launch();
  try {
    const page = await b.open('options.html#labs', { width: 900, height: 800 });
    await wait(page, 600);
    assert.deepEqual(await page.locator('#page-labs h2').allInnerTexts(), ['IELTS coach', 'Morfia']);
    assert.equal(await page.locator('#setting-ielts-coach').isChecked(), false);
    assert.equal(await page.locator('#setting-morfia').isChecked(), false);
    const general = await page.evaluate(() => [...document.querySelectorAll('#page-general h2')].map(h => h.textContent));
    assert.ok(!general.includes('Morfia') && !general.includes('IELTS coach'), general.join(', '));
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
