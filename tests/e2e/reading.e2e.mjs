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

test('a change leads with judging it, and what the bar has no room for waits in the ⋯ menu', async () => {
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
    // Each change is explained line by line as it opens, so Lines comes after judging it
    assert.deepEqual(r.dock, ['Bugs', 'Improve', 'Explain', 'Lines']);
    assert.deepEqual(r.more, ['Bugs', 'Improve', 'Explain', 'Lines', 'How to test it', 'Quiz me', 'Write it yourself']);
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
    assert.deepEqual(r.dock, ['Explain', 'Type', 'Quiz', 'Lines', 'Bugs']);
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

test('the chat button unrolls a field that names the lines, and Escape rolls it up before closing the sheet', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'Because it adds.');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up."},{"start":7,"end":9,"title":"count()","explain":"Counts."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    const fieldOpen = () => page.evaluate(() => !document.querySelector('.wk-ask').hidden);
    const dockHeight = () => page.evaluate(() => document.querySelector('.wk-dock').offsetHeight);
    assert.equal(await fieldOpen(), false);
    const before = await dockHeight();
    await page.click('.wk-ask-open');
    assert.equal(await fieldOpen(), true);
    // The field covers the actions' row; the dock doesn't grow
    assert.equal(await dockHeight(), before);
    const field = page.locator('.wk-ask-input');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'wk-ask-input');
    assert.equal(await field.getAttribute('placeholder'), 'Ask about lines 1–6…');
    await field.fill('Why a loop?');
    await field.press('Enter');
    await page.waitForFunction(() => window.__asks.length);
    assert.equal(await page.evaluate(() => window.__asks[0].label), 'Why a loop?');
    await field.focus();
    await page.keyboard.press('Escape');
    assert.equal(await fieldOpen(), false);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'wk-ask-open');
    const open = () => page.evaluate(() => !document.getElementById('walk-panel').classList.contains('hidden'));
    assert.equal(await open(), true);
    await page.keyboard.press('Escape');
    assert.equal(await open(), false);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the bar shows as many actions as the panel is wide, and ⋯ holds the rest', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html', { width: 340, height: 700 });
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    await page.evaluate(async () => {
      const p = window.__panel;
      const fence = '`'.repeat(3);
      p.askForJson = async (prompt, o) => ({ value: o.parse(`${fence}json\n{"summary":"Cart totals.","blocks":[{"start":1,"end":5,"title":"total()","explain":"Adds up."}]}\n${fence}`), text: '', tried: 1 });
      await p.startWalk('src/cart.js');
    });
    const split = () => page.evaluate(() => ({
      bar: [...document.querySelectorAll('.wk-acts > .run-ask')].map(x => x.textContent),
      menu: [...document.querySelectorAll('.wk-extra .run-ask')].map(x => x.textContent),
      more: !document.querySelector('.wk-more-toggle').hidden
    }));
    const narrow = await split();
    assert.deepEqual(narrow.bar, ['Explain', 'Type', 'Quiz', 'Lines']);
    assert.deepEqual(narrow.menu, ['Find bugs', 'Better ways', 'How to test it']);
    assert.equal(narrow.more, true);
    // Wide enough for all of them: no ⋯
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForFunction(() => document.querySelector('.wk-more-toggle').hidden);
    assert.deepEqual(await split(), { bar: ['Explain', 'Type', 'Quiz', 'Lines', 'Bugs', 'Improve', 'Tests'], menu: [], more: false });
    await page.setViewportSize({ width: 340, height: 700 });
    await page.waitForFunction(() => !document.querySelector('.wk-more-toggle').hidden);
    assert.deepEqual(await split(), narrow);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a saved reading can be deleted, with its file walks but not the walks of its changes', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    const left = await page.evaluate(async () => {
      const p = window.__panel;
      await p.saveJourney({ summary: 'A cart.', path: [{ file: 'src/cart.js', why: '' }], parts: [], done: ['src/cart.js'] });
      await chrome.storage.local.set({ 'readMarks:local/shop': ['src/cart.js'], 'walk:local/shop:src/cart.js': { blocks: [] },
        'walk:local/shop:@uncommitted': { blocks: [] }, 'walk:local/other:src/a.js': { blocks: [] } });
      p.walkPanel.classList.remove('hidden');
      p.showJourneyMap();
      const del = () => p.walkBody.querySelector('[data-wk="journey-delete"]').click();
      del();
      await new Promise(x => setTimeout(x, 100));
      const kept = !!(await chrome.storage.local.get('journey:local/shop'))['journey:local/shop'];
      del();   // asks twice
      for (let t = 0; t < 30 && p.walkView !== 'folders'; t++) await new Promise(x => setTimeout(x, 100));
      return { kept, view: p.walkView, journey: p.journey, keys: Object.keys(await chrome.storage.local.get(null)).filter(k => /^(journey|readMarks|walk):/.test(k)).sort() };
    });
    assert.equal(left.kept, true);
    assert.equal(left.view, 'folders');
    assert.equal(left.journey, null);
    assert.deepEqual(left.keys, ['walk:local/other:src/a.js', 'walk:local/shop:@uncommitted']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the reading order can be edited: moved, dragged, taken out and added to', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo({ ...BEFORE, 'README.md': '# Shop\n', 'plan.md': '# Plan\n' }, AFTER)));
    await stubChat(page, () => 'ok');
    await page.evaluate(async () => {
      const p = window.__panel;
      await p.saveJourney({ summary: 'A cart.', path: ['src/cart.js', 'src/tax.js', 'README.md'].map(file => ({ file, why: '' })), parts: [], done: [] });
      p.walkPanel.classList.remove('hidden');
      p.showJourneyMap();
    });
    const order = () => page.evaluate(async () => (await window.__panel.loadJourney()).path.map(p => p.file));
    await page.click('[data-wk="jr-edit"]');
    // README.md up twice: first
    await page.click('[aria-label="Move README.md up"]');
    await page.click('[aria-label="Move README.md up"]');
    assert.deepEqual(await order(), ['README.md', 'src/cart.js', 'src/tax.js']);
    await page.dragAndDrop('.jr-path li[data-k="2"]', '.jr-path li[data-k="1"]');
    assert.deepEqual(await order(), ['README.md', 'src/tax.js', 'src/cart.js']);
    await page.click('[aria-label="Take src/tax.js out of the order"]');
    await page.fill('.jr-add-input', 'plan.md');
    await page.press('.jr-add-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.jr-path li').length === 3);
    assert.deepEqual(await order(), ['README.md', 'src/cart.js', 'plan.md']);
    // Only files of the project can be added
    await page.fill('.jr-add-input', 'nope.js');
    await page.press('.jr-add-input', 'Enter');
    assert.deepEqual(await order(), ['README.md', 'src/cart.js', 'plan.md']);
    // Done: the order is the way to read, starting with the README
    await page.click('[data-wk="jr-edit"]');
    assert.equal(await page.textContent('.jr-actions .jr-primary'), 'Start with README.md →');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a document in the reading order is summed up, not walked line by line', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo({ ...BEFORE, 'plan.md': '# Plan\n\nFirst the cart, then tax.\n' }, AFTER)));
    await stubChat(page, () => 'ok');
    const r = await page.evaluate(async () => {
      const p = window.__panel;
      const asked = [];
      p.askForJson = async () => { asked.push('blocks'); return { value: null, text: '', tried: 1 }; };
      p.askInPanel = async (prompt, o) => { asked.push({ prompt, files: o.attachments.map(a => a.filename) }); return '**A plan.** Cart first, then tax.'; };
      await p.saveJourney({ summary: 'A cart.', path: [{ file: 'plan.md', why: '' }, { file: 'src/cart.js', why: '' }], parts: [], done: [] });
      await p.startWalk('plan.md');
      const view = (await chrome.storage.session.get('readerView')).readerView;
      return {
        asked,
        explain: document.querySelector('.wk-explain').innerHTML,
        dock: [...document.querySelectorAll('.wk-acts > .run-ask, .wk-extra .run-ask')].map(x => x.textContent),
        shown: view?.path, lines: view?.lines || null,
        finish: document.querySelector('[data-wk="finish"]')?.textContent
      };
    });
    assert.equal(r.asked.length, 1);
    assert.match(r.asked[0].prompt, /its document `plan\.md`\. Sum up this document/);
    assert.deepEqual(r.asked[0].files, ['plan.md']);
    assert.match(r.explain, /<strong>A plan\.<\/strong>/);
    assert.deepEqual(r.dock, ['Quiz']);
    // The reader shows the whole document, nothing highlighted
    assert.equal(r.shown, 'plan.md');
    assert.equal(r.lines, null);
    assert.equal(r.finish, 'Finish file');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
