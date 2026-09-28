// Reading, with your eyes on the code: the reader draws a part's diff in the
// file, line numbers in an explanation open the reader, ‹ › and the arrow
// keys step the walk from either side, and a file walk offers the same help
// as a change, with typing practice kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, makeRepo, filesOf, openFolder, stubChat, wait } from './harness.mjs';

const BEFORE = {
  'src/cart.js': 'export function total(items) {\n  let sum = 0;\n  for (const i of items) sum += i.price;\n  return sum;\n}\n\nexport function count(items) {\n  return items.length;\n}\n'
};
const AFTER = {
  'src/cart.js': 'export function total(items, tax = 0) {\n  let sum = 0;\n  for (const i of items) sum += i.price * i.qty;\n  return sum * (1 + tax);\n}\n\nexport function count(items) {\n  return items.length;\n}\n',
  'src/tax.js': 'export const TAX = 0.2;\n'
};
const LINES = (label, prompt) => label === 'Line by line'
  ? [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- **1** takes a \`tax\` rate.\n- **3-4** multiply by quantity, then add tax.`).join('\n\n')
  : 'ok';

async function startReview(page) {
  await page.evaluate(async () => {
    const p = window.__panel;
    await p.startReview();
    p._folderReview = true;
    await p.showReviewChoice();
    document.querySelector('[data-wk="review"][data-base="head"]').click();
  });
  await page.waitForFunction(() => window.__panel.walk?.notes?.[0]);
  await wait(page, 300);
}

test('a part shows three actions, with the rest under More', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, LINES);
    await startReview(page);
    const r = await page.evaluate(() => {
      const shown = () => [...document.querySelectorAll('.wk-dock .run-ask')].filter(x => x.offsetParent).map(x => x.textContent);
      const dock = shown();
      document.querySelector('[data-wk="moreacts"]').click();
      return { dock, more: shown() };
    });
    assert.deepEqual(r.dock, ['Line by line', 'Find bugs', 'Better ways', 'More']);
    assert.deepEqual(r.more, ['Line by line', 'Find bugs', 'Better ways', 'Less', 'Explain more', 'How to test it', 'Quiz me', 'Write it yourself']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('line numbers in an explanation open the reader, and the walk steps from both sides', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, LINES);
    await startReview(page);
    const refs = await page.evaluate(() => [...document.querySelectorAll('.walk-notes .line-ref')].map(r => `${r.dataset.start}-${r.dataset.end}`));
    assert.deepEqual(refs, ['1-1', '3-4']);
    await page.evaluate(() => document.querySelector('.walk-notes .line-ref[data-start="3"]').click());
    await wait(page, 300);
    const view = await page.evaluate(async () => (await chrome.storage.session.get('readerView')).readerView);
    assert.deepEqual([view.lines, view.focus, view.nav], [{ start: 3, end: 4 }, true, { prev: false, next: true }]);

    // The reader's › steps the panel; ← in the panel steps back
    const reader = await b.open('reader.html', { width: 1000, height: 500 });
    await wait(reader, 400);
    await reader.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__panel.walk.current === 1);
    await page.evaluate(() => document.querySelector('.wk-title').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await page.waitForFunction(() => window.__panel.walk.current === 0);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the reader draws a part as a diff inside the file', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, LINES);
    await startReview(page);
    const reader = await b.open('reader.html', { width: 1000, height: 500 });
    await wait(reader, 500);
    const r = await reader.evaluate(() => ({
      label: document.getElementById('rd-label').textContent,
      gutter: document.getElementById('rd-gutter').textContent.split('\n').slice(0, 9),
      marks: [...document.querySelectorAll('.rd-mark')].map(m => `${m.dataset.kind} ${m.dataset.start}-${m.dataset.end}`),
      text: document.getElementById('rd-text').textContent.split('\n').slice(0, 3)
    }));
    // The change starts on the function's own line, so nothing above names it: the file does
    assert.equal(r.label, 'Part 1 of 2 · cart.js');
    // Old line 1 in red above new line 1 in green; lines 3-4 likewise
    assert.deepEqual(r.gutter, ['−', '1', '2', '−', '−', '3', '4', '5', '6']);
    assert.deepEqual(r.marks, ['del 0-0', 'add 1-1', 'del 3-4', 'add 5-6']);
    assert.deepEqual(r.text, ['export function total(items) {', 'export function total(items, tax = 0) {', '  let sum = 0;']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a file walk offers the same help as a change, and typing practice compares', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'Nothing real.');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up the items."},{"start":7,"end":9,"title":"count()","explain":"Counts them."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    await page.waitForFunction(() => window.__panel.walk?.blocks);
    const r = await page.evaluate(async () => {
      const dock = [...document.querySelectorAll('.wk-dock .run-ask')].filter(x => x.offsetParent).map(x => x.textContent);
      document.querySelector('[data-wk="bugs"]').click();
      for (let t = 0; t < 50 && !window.__asks.length; t++) await new Promise(x => setTimeout(x, 100));
      // Typing practice: open it, type the block with one line wrong, compare
      document.querySelector('[data-wk="moreacts"]').click();
      document.querySelector('[data-wk="type"]').click();
      await new Promise(x => setTimeout(x, 200));
      const p = window.__panel;
      p._walkCode.setValue('export function total(items, tax = 0) {\n  let sum = 0;\n  for (const i of items) sum += i.price;\n  return sum * (1 + tax);\n}');
      document.querySelector('[data-wk="compare"]').click();
      for (let t = 0; t < 50 && !document.querySelector('.walk-score'); t++) await new Promise(x => setTimeout(x, 100));
      return { dock, asked: window.__asks.map(a => a.label), bugsPrompt: window.__asks[0].prompt.slice(0, 80),
        score: document.querySelector('.walk-score')?.textContent || '', best: p.walk.typed?.[0]?.best };
    });
    assert.deepEqual(r.dock, ['Line by line', 'Find bugs', 'Better ways', 'More']);
    assert.deepEqual(r.asked, ['Find bugs']);
    // A one-line gap joins the block before it (walkthrough.js)
    assert.match(r.bugsPrompt, /^I'm reading lines 1-6 of `src\/cart\.js` from shop\. Review this code for bugs/);
    assert.match(r.score, /^80% match/);
    assert.equal(r.best, 80);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
