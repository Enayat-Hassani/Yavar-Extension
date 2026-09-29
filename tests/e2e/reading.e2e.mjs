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

test('a change leads with judging it, with the rest in the ⋯ menu', async () => {
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
    // Each change is explained line by line as it opens, so Line by line waits under More
    assert.deepEqual(r.dock, ['Find bugs', 'Better ways', 'Explain more']);
    assert.deepEqual(r.more, ['Find bugs', 'Better ways', 'Explain more', 'Line by line', 'How to test it', 'Quiz me', 'Write it yourself']);
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
    assert.equal(r.label, 'File 1 of 2 · cart.js');
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
    // A block is already explained line by line, so learning it leads
    assert.deepEqual(r.dock, ['Explain more', 'Type it', 'Quiz me']);
    assert.deepEqual(r.asked, ['Find bugs']);
    // A one-line gap joins the block before it (walkthrough.js)
    assert.match(r.bugsPrompt, /^I'm reading lines 1-6 of `src\/cart\.js` from shop\. Review this code for bugs/);
    assert.match(r.score, /^80% match/);
    assert.equal(r.best, 80);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the reader brings back the walk its highlight belongs to, even after the panel moved on', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up the items."},{"start":7,"end":9,"title":"count()","explain":"Counts them."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    await page.waitForFunction(() => window.__panel.walk?.blocks);
    const reader = await b.open('reader.html', { width: 1000, height: 500 });
    await wait(reader, 400);
    assert.equal(await reader.evaluate(() => document.getElementById('rd-explain').hidden), false, 'the sign shows by the highlight');

    // The panel moved on to another walk and closed the sheet: › in the reader
    // reopens the file's walk and steps it, not the other one
    await page.evaluate(() => {
      const p = window.__panel;
      p.walkPanel.classList.add('hidden');
      p.walk = { key: 'walk:other', path: 'other.js', blocks: [{ start: 1, end: 1 }, { start: 2, end: 2 }], current: 0 };
    });
    await reader.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__panel.walk.path === 'src/cart.js' && window.__panel.walk.current === 1);
    assert.equal(await page.evaluate(() => window.__panel.walkPanel.classList.contains('hidden')), false);
    await wait(page, 300);

    // Closed again, and forgotten in memory: the sign opens it at the block the reader shows
    await page.evaluate(() => { const p = window.__panel; p.walkPanel.classList.add('hidden'); p.walk = null; });
    await reader.evaluate(() => document.getElementById('rd-explain').click());
    await page.waitForFunction(() => window.__panel.walk?.path === 'src/cart.js' && !window.__panel.walkPanel.classList.contains('hidden'));
    const r = await page.evaluate(() => ({ current: window.__panel.walk.current, title: document.querySelector('.wk-title').textContent }));
    assert.deepEqual(r, { current: 1, title: 'count()' });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a file walk says so when its file changed since, and can be walked again', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      window.__walks = 0;
      p.askForJson = async (prompt, o) => (window.__walks++, { value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up the items."},{"start":7,"end":9,"title":"count()","explain":"Counts them."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    await page.waitForFunction(() => window.__panel.walk?.blocks);
    // Opened again unchanged: no notice
    await page.evaluate(() => window.__panel.startWalk('src/cart.js'));
    await wait(page, 400);
    assert.equal(await page.evaluate(() => !!document.querySelector('.wk-stale')), false);
    // Edited in another editor: two lines added at the top
    await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop');
      const f = await (await root.getDirectoryHandle('src')).getFileHandle('cart.js');
      const text = await (await f.getFile()).text();
      const w = await f.createWritable();
      await w.write(`// Cart\n\n${text}`);
      await w.close();
      const p = window.__panel;
      p.clearFileCache('local:');
      await p.startWalk('src/cart.js');
    });
    await page.waitForSelector('.wk-stale');
    assert.match(await page.evaluate(() => document.querySelector('.wk-stale').textContent), /cart\.js changed since this walk/);
    await page.evaluate(() => document.querySelector('[data-wk="rewalk"]').click());
    await page.waitForFunction(() => window.__walks === 2 && window.__panel.walk?.blocks);
    await wait(page, 300);
    assert.equal(await page.evaluate(() => !!document.querySelector('.wk-stale')), false);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('saved walks make room for themselves: the ones unused longest go, and only when storage fills', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    const r = await page.evaluate(async () => {
      const p = window.__panel;
      p.showNotification = (t) => { window.__note = t; };
      const day = 24 * 60 * 60 * 1000;
      const pad = 'x'.repeat(120 * 1024);
      const walk = (ago) => ({ blocks: [{ start: 1, end: 2 }], pad, opened: Date.now() - ago * day });
      // A few old walks and little else: nothing goes
      await chrome.storage.local.set({ 'walk:o/r:a.js': walk(200), 'journey:o/r': { path: [], pad } });
      await p.pruneWalks();
      const light = Object.keys(await chrome.storage.local.get(null)).length;
      // 20 walks unused for 200 days and 40 recent ones, about 7.2 MB
      const many = {};
      for (let k = 0; k < 20; k++) many[`walk:o/r:old${k}.js`] = walk(200 + k);
      for (let k = 0; k < 40; k++) many[`walk:o/r:new${k}.js`] = walk(k);
      await chrome.storage.local.set(many);
      await p.pruneWalks();
      const keys = Object.keys(await chrome.storage.local.get(null));
      return { light, old: keys.filter(k => k.includes(':old') || k === 'walk:o/r:a.js').length,
        recent: keys.filter(k => k.includes(':new')).length, journey: keys.includes('journey:o/r'), note: window.__note };
    });
    assert.equal(r.light, 2);
    assert.deepEqual({ old: r.old, recent: r.recent, journey: r.journey }, { old: 0, recent: 40, journey: true });
    assert.match(r.note, /^Made room: 21 saved walks/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('reaching the last block of a file marks it read on the reading map', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    const done = await page.evaluate(async () => {
      const p = window.__panel;
      await p.saveJourney({ summary: 'A cart.', path: [{ file: 'src/cart.js', why: '' }, { file: 'src/tax.js', why: '' }], parts: [], done: [] });
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"a"},{"start":7,"end":9,"title":"count()","explain":"b"}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
      const before = [...(p.journey.done || [])];
      await p.gotoWalk(1);
      return { before, after: (await p.loadJourney()).done };
    });
    assert.deepEqual(done, { before: [], after: ['src/cart.js'] });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the reading map gives the big picture and the README before the code, and where you are once reading', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo({ ...BEFORE, 'README.md': '# Shop\n\nA cart.\n' }, AFTER)));
    await stubChat(page, () => 'ok');
    const order = (done) => page.evaluate(async (done) => {
      const p = window.__panel;
      await p.saveJourney({ summary: 'A cart.', path: [{ file: 'src/cart.js', why: '' }, { file: 'src/tax.js', why: '' }],
        parts: [{ name: 'Cart', role: 'Adds things up.', files: ['src/cart.js'] }], done });
      p.renderJourney();
      const body = p.walkBody;
      return {
        sections: [...body.querySelectorAll('.sheet-label')].map(l => l.textContent),
        docs: [...body.querySelectorAll('.jr-docs .jr-file')].map(d => d.dataset.path),
        docsBeforeFiles: !!body.querySelector('.jr-docs + .jr-path')
      };
    }, done);
    assert.deepEqual(await order([]), { sections: ['How it is organised', 'Reading order'], docs: ['README.md'], docsBeforeFiles: true });
    assert.deepEqual((await order(['src/cart.js'])).sections, ['Reading order', 'How it is organised']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('in a file walk, Explain more studies the block and Line by line waits in the ⋯ menu', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    const asked = await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up the items."},{"start":7,"end":9,"title":"count()","explain":"Counts them."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
      const ask = async (act) => {
        const n = window.__asks.length;
        document.querySelector(`.wk-dock [data-wk="${act}"]`).click();
        for (let t = 0; t < 50 && window.__asks.length === n; t++) await new Promise(x => setTimeout(x, 100));
        const a = window.__asks.at(-1);
        return { label: a.label, prompt: a.prompt.slice(0, 200) };
      };
      const more = await ask('more');
      document.querySelector('[data-wk="moreacts"]').click();
      return { more, lines: await ask('lines') };
    });
    assert.equal(asked.more.label, 'Explain more');
    assert.match(asked.more.prompt, /Explain what this does and how it works, step by step/);
    assert.equal(asked.lines.label, 'Line by line');
    assert.match(asked.lines.prompt, /Go through it line by line/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the ⋯ menu keeps the bar one row, and closes on a choice, a click elsewhere or Escape', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html', { width: 340, height: 700 });
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up."},{"start":7,"end":9,"title":"count()","explain":"Counts."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    const menuOpen = () => page.evaluate(() => !document.querySelector('.wk-extra').hidden);
    // Every control of the bar sits on one row, even this narrow
    const tops = await page.evaluate(() => [...document.querySelectorAll('.wk-acts > button')].map(x => Math.round(x.getBoundingClientRect().top + x.offsetHeight / 2)));
    assert.equal(new Set(tops).size, 1);
    await page.click('[data-wk="moreacts"]');
    assert.equal(await menuOpen(), true);
    await page.click('.wk-title');
    assert.equal(await menuOpen(), false);
    await page.click('[data-wk="moreacts"]');
    await page.keyboard.press('Escape');
    assert.equal(await menuOpen(), false);
    assert.equal(await page.evaluate(() => document.getElementById('walk-panel').classList.contains('hidden')), false);
    await page.click('[data-wk="moreacts"]');
    await page.click('.wk-extra [data-wk="tests"]');
    assert.equal(await menuOpen(), false);
    await page.waitForFunction(() => window.__asks.length);
    assert.equal(await page.evaluate(() => window.__asks.at(-1).label), 'How to test it');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
