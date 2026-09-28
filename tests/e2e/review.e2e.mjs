// Reviewing your own changes: the walk opens at once in reading order, a few
// parts are explained in one message, the files a part needs go with it, the
// AI can ask for more, and the walk ends with a review summary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, makeRepo, filesOf, openFolder, stubChat, wait } from './harness.mjs';

const BEFORE = {
  'README.md': '# Shop\n\nA cart.\n',
  'src/tax.js': 'export const RATE = 0.2;\nexport function withTax(x) {\n  return x * (1 + RATE);\n}\n',
  'src/cart.js': "import { withTax } from './tax.js';\n\nexport function total(items) {\n  let sum = 0;\n  for (const i of items) sum += i.price;\n  return sum;\n}\n",
  'tests/cart.test.js': 'test("total", () => expect(total([])).toBe(0));\n',
  '.gitignore': '*.log\n'
};
const AFTER = {
  'README.md': '# Shop\n\nA cart with tax.\n',
  'src/cart.js': "import { withTax } from './tax.js';\n\nexport function total(items) {\n  let sum = 0;\n  for (const i of items) sum += i.price * i.qty;\n  return withTax(sum);\n}\n",
  'tests/cart.test.js': 'test("total", () => expect(total([], 0.2)).toBe(0));\n',
  'debug.log': 'ignored\n',
  '.env': 'SECRET=1\n'
};

async function reviewUncommitted(page) {
  await page.evaluate(async () => {
    const p = window.__panel;
    await p.startReview();
    p._folderReview = true;
    await p.showReviewChoice();
    document.querySelector('[data-wk="review"][data-base="head"]').click();
  });
  await page.waitForFunction(() => window.__panel.walk?.blocks && window.__asks?.length);
  await wait(page, 400);
}

test('a review opens in reading order and explains small parts in one message', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, (label, prompt, opts) => label === 'Line by line'
      ? (opts.attachments.some(a => a.filename.endsWith('-changes.md')) ? 'The change adds tax to totals.\n\n' : '') +
        [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- **${m[1]}** explained`).join('\n\n')
      : 'ok');
    await reviewUncommitted(page);
    const r = await page.evaluate(() => {
      const w = window.__panel.walk;
      return { paths: w.blocks.map(x => x.path), summary: w.summary, notes: Object.keys(w.notes || {}).length,
        asks: window.__asks.map(a => ({ label: a.label, attached: a.attached })),
        first: window.__asks[0].prompt };
    });
    // Code first, then its test, then docs; ignored and private files never appear
    assert.deepEqual(r.paths, ['src/cart.js', 'tests/cart.test.js', 'README.md']);
    // One message for all three small parts, with the whole diff and the files cart.js needs
    assert.equal(r.asks.length, 1);
    assert.deepEqual(r.asks[0].attached, ['shop-uncommitted-changes.md', 'context-files.md']);
    // The brief reads the README as it is on disk
    assert.match(r.first, /About the project, for context: A cart with tax\./);
    assert.match(r.first, /The project's files:/);
    assert.match(r.first, /NEED: path\/to\/file/);
    assert.equal(r.summary, 'The change adds tax to totals.');
    assert.equal(r.notes, 3);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the files a part needs go with it, once, and more are sent when asked', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, (label) => label === 'Line by line'
      ? '### Part 1\n- **5** by quantity\n\nNEED: README.md\nNEED: src/tax.js\nNEED: .env'
      : label.startsWith('Line by line ·') ? '### Part 1\n- **5** by quantity, now with the README' : 'Nothing real.');
    await reviewUncommitted(page);
    await page.waitForFunction(() => window.__asks.length >= 2);
    await page.evaluate(() => document.querySelector('[data-wk="bugs"]').click());
    await page.waitForFunction(() => window.__asks.length >= 3);
    const r = await page.evaluate(() => ({
      asks: window.__asks.map(a => ({ label: a.label, attached: a.attached })),
      context: window.__asks[0].attachments.find(a => a.filename === 'context-files.md').content.match(/^## .*$/gm),
      note: window.__panel.walk.notes[0].map(n => n.text),
      status: document.querySelectorAll('.work-status').length
    }));
    // cart.js whole and the tax.js it imports, up front
    assert.deepEqual(r.context, ['## Repository map', '## src/cart.js', '## src/tax.js']);
    // Asked for README (new), tax.js (already sent) and .env (private): only the README goes
    assert.deepEqual(r.asks[1], { label: 'Line by line · with README.md', attached: ['README.md'] });
    // The fuller answer is the one kept; nothing is sent again for Find bugs
    assert.match(r.note[0], /now with the README/);
    assert.deepEqual(r.asks[2], { label: 'Find bugs', attached: [] });
    assert.equal(r.status, 0);   // the "gathering files" line gives way to the answer
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the walk ends with a review summary and a commit message', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, (label, prompt) => label === 'Line by line'
      ? [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- ok`).join('\n')
      : label === 'Find bugs' ? 'qty may be undefined on old items.'
      : '## What it does\nAdds tax.\n\n## Commit message\n```\nAdd tax to cart totals\n```');
    await reviewUncommitted(page);
    await page.evaluate(async () => {
      const click = async (sel) => { document.querySelector(sel).click(); await new Promise(r => setTimeout(r, 300)); };
      await click('[data-wk="bugs"]');
      await click('[data-wk="next"]');
      await click('[data-wk="next"]');
      await click('[data-wk="summary"]');
    });
    await page.waitForFunction(() => window.__panel.walk.review);
    const r = await page.evaluate(() => ({
      found: [...document.querySelectorAll('.wk-found li')].map(l => l.textContent),
      prompt: window.__asks.at(-1).prompt, attached: window.__asks.at(-1).attached
    }));
    assert.deepEqual(r.found, ['Part 1 · total(items)']);
    assert.match(r.prompt, /## Before you commit/);
    assert.match(r.prompt, /## Commit message\nIn a code block/);
    assert.match(r.prompt, /qty may be undefined on old items/);
    assert.deepEqual(r.attached, ['shop-uncommitted-changes.md']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the project reviewed last is one click away on the start page', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, () => 'ok');
    await reviewUncommitted(page);
    const rows = await page.evaluate(async () => {
      const p = window.__panel;
      p.walkPanel.classList.add('hidden');
      p.walk = null;
      const names = [...document.querySelectorAll('.home-row .home-name')].map(e => e.textContent);
      document.querySelector('[data-home="review_last"]').click();
      return names;
    });
    assert.ok(rows.includes('Review my changes · shop'), rows.join(', '));
    await page.waitForFunction(() => window.__panel.walk?.blocks?.length === 3);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
