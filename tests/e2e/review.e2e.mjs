// Reviewing your own changes: the walk opens at once in reading order, a few
// parts are explained in one message, the files a part needs go with it, the
// AI can ask for more, and the walk ends with a review summary.

import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { launch, makeRepo, filesOf, openFolder, stubChat, wait, git } from './harness.mjs';

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
    await p.showChanges();
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
    assert.deepEqual(r.found, ['src/cart.js']);
    assert.match(r.prompt, /## Before you commit/);
    assert.match(r.prompt, /## Commit message\nIn a code block/);
    assert.match(r.prompt, /qty may be undefined on old items/);
    assert.deepEqual(r.attached, ['shop-uncommitted-changes.md']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('the project reviewed last opens at its choice, which says how far each walk got', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, (label, prompt) => [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- ok`).join('\n'));
    await reviewUncommitted(page);
    const rows = await page.evaluate(async () => {
      const p = window.__panel;
      p.walkPanel.classList.add('hidden');
      p.walk = null;
      const names = [...document.querySelectorAll('.home-row .home-name')].map(e => e.textContent);
      document.querySelector('[data-home="review_last"]').click();
      return names;
    });
    assert.ok(rows.includes('Changes · shop'), rows.join(', '));
    // The choice, not straight into the walk
    await page.waitForSelector('[data-wk="review"][data-base="head"]');
    const choice = await page.evaluate(() => ({
      status: document.querySelector('[data-base="head"] .jr-folder-status').textContent,
      restart: !!document.querySelector('[data-wk="review-restart"][data-base="head"]'),
      walk: !!window.__panel.walk
    }));
    assert.deepEqual(choice, { status: 'All 3 files read · Continue', restart: true, walk: false });
    // Continue reopens the walk as it was, without asking again
    const asked = await page.evaluate(() => window.__asks.length);
    await page.evaluate(() => document.querySelector('[data-wk="review"][data-base="head"]').click());
    await page.waitForFunction(() => window.__panel.walk?.blocks?.length === 3);
    await wait(page, 300);
    assert.equal(await page.evaluate(() => window.__asks.length), asked);
    // ‹ goes back to the choice; Start over (clicked twice) forgets the walk and reads again
    await page.evaluate(() => document.querySelector('[data-wk="review-back"]').click());
    await page.waitForSelector('[data-wk="review-restart"]');
    await page.evaluate(() => {
      document.querySelector('[data-wk="review-restart"]').click();
      document.querySelector('[data-wk="review-restart"]').click();
    });
    await page.waitForFunction((n) => window.__panel.walk?.blocks && window.__asks.length > n, asked);
    const fresh = await page.evaluate(() => ({ notes: Object.keys(window.__panel.walk.notes || {}).length, first: window.__asks.at(-1).attached }));
    assert.ok(fresh.first.includes('shop-uncommitted-changes.md'), 'the first message of a new walk carries the whole diff');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('changes that moved on are read again, keeping what was said about the parts that did not', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await stubChat(page, (label, prompt) => [...prompt.matchAll(/^### Part (\d+) · `([^`]+)`/gm)].map(m => `### Part ${m[1]}\n- about ${m[2]}`).join('\n'));
    await reviewUncommitted(page);
    const oldKey = await page.evaluate(() => window.__panel.walk.key);
    // Edit the test file on disk, then choose Not committed yet again
    await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop');
      const f = await (await root.getDirectoryHandle('tests')).getFileHandle('cart.test.js');
      const w = await f.createWritable();
      await w.write('test("total", () => expect(total([], 0.25)).toBe(0));\n');
      await w.close();
      const p = window.__panel;
      p.walk = null;
      p._asksBefore = window.__asks.length;
      await p.showChanges();
      document.querySelector('[data-wk="review"][data-base="head"]').click();
    });
    await page.waitForFunction(() => window.__panel.walk?.blocks);
    await wait(page, 300);
    // Part 1 kept its notes, so nothing is asked until the edited part opens
    assert.equal(await page.evaluate(() => window.__asks.length - window.__panel._asksBefore), 0);
    await page.evaluate(() => document.querySelector('[data-wk="next"]').click());
    await page.waitForFunction(() => window.__asks.length > window.__panel._asksBefore);
    await wait(page, 300);
    const r = await page.evaluate(() => {
      const w = window.__panel.walk;
      return { key: w.key, notes: w.blocks.map((x, k) => [x.path, (w.notes?.[k] || []).map(n => n.text).join()]) };
    });
    assert.equal(r.key, oldKey, 'one walk per kind of change');
    // cart.js and README kept their notes; the edited test was asked again
    assert.deepEqual(r.notes, [
      ['src/cart.js', '- about src/cart.js'],
      ['tests/cart.test.js', '- about tests/cart.test.js'],
      ['README.md', '- about README.md']
    ]);
    const last = await page.evaluate(() => window.__asks.at(-1).prompt);
    assert.match(last, /### Part 2 · `tests\/cart\.test\.js`/);
    assert.doesNotMatch(last, /### Part 1 ·/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a chat holds one thing: another thing, or a long chat, goes on in a new one', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    const r = await page.evaluate(() => {
      const p = window.__panel;
      p.showNotification = () => {};
      const out = [];
      const fresh = () => { const f = !!p._freshChatNext; p._freshChatNext = false; return f; };
      const thread = p.claimChat();
      p._turns = [{ q: 'q', a: 'a', el: document.body }];   // the conversation has a turn
      out.push(['thread', fresh()]);
      const walk = p.claimChat('walk:local/shop:@uncommitted');
      out.push(['to a walk', fresh(), walk !== thread]);
      walk.sent.add('diff');
      out.push(['same walk', fresh(), p.claimChat('walk:local/shop:@uncommitted') === walk]);
      walk.asks = 3;
      walk.chars = 200000;
      const next = p.claimChat('walk:local/shop:@uncommitted');
      out.push(['too long', fresh(), next !== walk && !next.sent.has('diff')]);
      p._handoff = false;
      p.claimChat();
      out.push(['back to the thread', fresh(), p._handoff]);
      p.newConversation();
      out.push(['new conversation', p.threadTopic(), p._chatSession]);
      return out;
    });
    assert.deepEqual(r, [
      ['thread', false],
      ['to a walk', true, true],
      ['same walk', false, true],
      ['too long', true, true],
      ['back to the thread', true, true],
      ['new conversation', 'thread:1', null]
    ]);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

// A file changed in three places, a small file and a doc
const SPREAD_BEFORE = {
  'src/shop.js': Array.from({ length: 40 }, (_, k) => `line${k + 1}();`).join('\n') + '\n',
  'src/tax.js': 'export const RATE = 0.2;\n',
  'NOTES.md': '# Notes\n\nOld words.\n'
};
const SPREAD_AFTER = {
  'src/shop.js': SPREAD_BEFORE['src/shop.js'].replace('line2();', 'first();').replace('line20();', 'middle();').replace('line38();', 'last();'),
  'src/tax.js': 'export const RATE = 0.25;\n',
  'NOTES.md': '# Notes\n\nNew words.\n'
};

test('a change is read file by file, and in a file change by change', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(SPREAD_BEFORE, SPREAD_AFTER)));
    await stubChat(page, (label, prompt) => label === 'Line by line'
      ? [...prompt.matchAll(/^### (?:File `([^`]+)`|Part (\d+))/gm)]
        .map(m => m[1] ? `### File \`${m[1]}\`\nRenames three calls.` : `### Part ${m[2]}\n- change ${m[2]}`).join('\n\n')
      : label === 'Find bugs' ? 'middle() is never defined.' : 'ok');
    await reviewUncommitted(page);
    const see = () => page.evaluate(() => ({
      where: document.querySelector('.wk-pos').textContent,
      dots: document.querySelectorAll('.wk-dot').length,
      current: [...document.querySelectorAll('.wk-dot')].findIndex(d => d.classList.contains('is-current')),
      pos: document.querySelector('.wk-change-pos')?.textContent || '',
      about: document.querySelector('.wk-about')?.textContent || '',
      note: document.querySelector('.wk-change .walk-notes')?.textContent || '',
      files: document.querySelector('.wk-file-notes')?.textContent || '',
      enter: document.querySelector('.wk-change')?.dataset.enter || '',
      asks: window.__asks.length
    }));
    let s = await see();
    // One message for all of shop.js and the small files after it; the doc is summed up
    const first = await page.evaluate(() => window.__asks[0].prompt);
    assert.match(first, /^### File `src\/shop\.js`$/m);
    assert.deepEqual([...first.matchAll(/^### Part (\d+)/gm)].map(m => m[1]), ['1', '2', '3', '4', '5']);
    assert.match(first, /^### Part 5 · `NOTES\.md`[^\n]*\(prose\)$/m);
    assert.deepEqual({ where: s.where, dots: s.dots, current: s.current, about: s.about, asks: s.asks },
      { where: 'File 1 of 3', dots: 3, current: 0, about: 'Renames three calls.', asks: 1 });
    assert.match(s.note, /change 1/);
    assert.match(s.pos, /^Change 1 of 3 · line 2$/);
    // → goes to the next change, sliding in from the right, without asking again
    await page.evaluate(() => document.querySelector('.wk-dot').focus());
    await page.keyboard.press('ArrowRight');
    await wait(page, 200);
    s = await see();
    assert.deepEqual([s.current, s.enter, s.asks], [1, 'next', 1]);
    assert.match(s.note, /change 2/);
    // The reader keeps the whole file's diff and marks this change
    const view = await page.evaluate(async () => (await chrome.storage.session.get('readerView')).readerView);
    assert.deepEqual(view.diff.part.add, [20]);
    assert.deepEqual(view.diff.add, [2, 20, 38]);
    assert.match(view.label, /^File 1 of 3 · Change 2 of 3 · /);
    // Find bugs is about the whole file, and stays with it from change to change
    await page.evaluate(() => document.querySelector('[data-wk="bugs"]').click());
    await page.waitForFunction(() => window.__asks.length === 2);
    const bugs = await page.evaluate(() => window.__asks[1].prompt);
    assert.match(bugs, /The changes to `src\/shop\.js` \(modified\), in 3 parts/);
    await page.keyboard.press('ArrowLeft');
    await wait(page, 200);
    s = await see();
    assert.deepEqual([s.current, s.enter], [0, 'prev']);
    assert.match(s.files, /middle\(\) is never defined/);
    // ] jumps to the next file, then the doc, which is summed up in brief
    await page.keyboard.press(']');
    await wait(page, 200);
    s = await see();
    assert.deepEqual([s.where, s.dots], ['File 2 of 3', 0]);
    assert.match(s.note, /change 4/);
    await page.keyboard.press(']');
    await wait(page, 200);
    s = await see();
    assert.deepEqual([s.where, s.asks], ['File 3 of 3', 2]);
    assert.match(s.note, /change 5/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-wk="lines"]').textContent), 'In brief');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('a pull request that gained commits is read again, keeping what was said about unchanged parts', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await stubChat(page, (label, prompt) => [...prompt.matchAll(/^### Part (\d+) · `([^`]+)`/gm)].map(m => `### Part ${m[1]}\n- about ${m[2]}`).join('\n'));
    const diff = (b) => `diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -1 +1 @@\n-x\n+${b}\n`;
    const open = async (text) => {
      await page.evaluate(async (text) => {
        const p = window.__panel;
        p.fetchDiff = async () => text;
        p.openRepoFile = async () => {};   // the reader is checked on its own page
        p.walk = null;
        await p.walkChange({ owner: 'o', repo: 'r', kind: 'pull', number: 7, title: 'Tidy' });
      }, text);
      await page.waitForFunction(() => window.__panel.walk?.blocks && window.__panel.walk.notes?.[0]);
      await wait(page, 300);
    };
    await open(diff('one'));
    const asks = await page.evaluate(() => window.__asks.length);
    // The same diff reopens as it was
    await open(diff('one'));
    assert.equal(await page.evaluate(() => window.__asks.length), asks);
    // A new commit changed b.js: a.js keeps its note, b.js is asked again when it opens
    await open(diff('two'));
    const r = await page.evaluate(() => ({ notes: Object.keys(window.__panel.walk.notes || {}), asks: window.__asks.length }));
    assert.deepEqual(r, { notes: ['0'], asks });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('while several parts are explained in one reply, a part shows only its own section as it arrives', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    await openFolder(page, 'shop', filesOf(makeRepo(BEFORE, AFTER)));
    await page.evaluate(() => {
      const p = window.__panel;
      p.showReaderTab = async () => {};
      window.__seen = [];
      window.__asks = [];
      p.askInPanel = async (prompt, { onProgress }) => {
        window.__asks.push(prompt);
        const reply = 'The change adds tax to totals.\n\n' +
          [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- **${m[1]}** explained part ${m[1]}`).join('\n\n');
        // Streamed a few words at a time; what the open part's card shows is recorded after each
        const words = reply.split(' ');
        for (let k = 1; k <= words.length; k++) {
          onProgress?.(words.slice(0, k).join(' '));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const body = document.querySelector('.walk-notes .answer-card .answer-body');
          if (body) window.__seen.push(body.textContent);
        }
        return reply;
      };
    });
    await reviewUncommitted(page);
    const r = await page.evaluate(() => ({ seen: window.__seen, parts: (window.__asks[0].match(/^### Part \d+/gm) || []).length,
      shown: document.querySelector('.walk-notes .answer-card .answer-body').textContent }));
    assert.ok(r.parts > 1, 'several parts in one message');
    assert.ok(r.seen.length > 5);
    // Never the overview, and never another part's section
    assert.ok(r.seen.every(t => !t.includes('adds tax') && !/part [2-9]/.test(t)), r.seen.find(t => t.includes('adds tax') || /part [2-9]/.test(t)));
    assert.match(r.shown, /explained part 1/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test('Changes shows your work and the recent commits together, and a commit reads with its files as they were', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    const dir = makeRepo(BEFORE, {});
    // A second commit, then work on top of it not committed yet
    writeFileSync(join(dir, 'src/cart.js'), AFTER['src/cart.js']);
    git(dir, 'commit', '-q', '-am', 'Add tax to the total');
    writeFileSync(join(dir, 'src/cart.js'), AFTER['src/cart.js'].replace('i.price * i.qty', 'i.price * i.qty * 2'));
    await openFolder(page, 'shop', filesOf(dir));
    await stubChat(page, (label, prompt) => [...prompt.matchAll(/^### Part (\d+)/gm)].map(m => `### Part ${m[1]}\n- ok`).join('\n'));
    await page.evaluate(async () => { const p = window.__panel; p._folderReview = true; p.walkPanel.classList.remove('hidden'); await p.showChanges(); });
    const sheet = await page.evaluate(() => ({
      title: document.getElementById('walk-title').textContent,
      labels: [...document.querySelectorAll('#walk-body .sheet-label')].map(x => x.textContent),
      work: [...document.querySelectorAll('[data-wk="review"] .jr-folder-name')].map(x => x.textContent),
      commits: [...document.querySelectorAll('[data-wk="commit"] .jr-folder-name')].map(x => x.textContent)
    }));
    assert.deepEqual(sheet, { title: 'Changes', labels: ['Your work on main', 'Recent commits'], work: ['Not committed yet'],
      commits: ['Add tax to the total', 'one'] });
    await page.evaluate(() => document.querySelector('[data-wk="commit"]').click());
    await page.waitForFunction(() => window.__panel.walk?.blocks && window.__asks?.length);
    const r = await page.evaluate(async () => {
      const w = window.__panel.walk;
      const view = (await chrome.storage.session.get('readerView')).readerView;
      return { label: w.change.label, paths: w.blocks.map(x => x.path), diff: w.blocks[0].diff,
        reader: view.content, ref: view.repo.ref, editable: view.walkKey, attached: window.__asks[0].attached };
    });
    assert.match(r.label, /^Commit [0-9a-f]{7}$/);
    assert.deepEqual(r.paths, ['src/cart.js']);
    // The commit's own change, not the work on top of it
    assert.match(r.diff, /\+.*i\.price \* i\.qty;/);
    assert.doesNotMatch(r.diff, /\* 2/);
    // The reader shows the file as the commit left it, and not for editing
    assert.equal(r.reader, AFTER['src/cart.js']);
    assert.match(r.ref, /^[0-9a-f]{40}$/);
    assert.equal(r.editable, null);
    assert.ok(r.attached.some(f => /^shop-[0-9a-f]{7}-changes\.md$/.test(f)), r.attached.join(', '));
    // ‹ goes back to Changes, where the commit says how far it was read
    await page.evaluate(() => document.querySelector('[data-wk="review-back"]').click());
    await page.waitForSelector('[data-wk="commit"] .rv-done');
    assert.equal(await page.textContent('[data-wk="commit"] .rv-done'), 'Read');
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
