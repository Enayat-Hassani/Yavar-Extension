import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, changeBlocks, changePack, diffRows, partTitle, orderParts, linesBatch, linesPrompt, splitParts } from '../src/utils/changes.js';

const DIFF = `diff --git a/src/app.js b/src/app.js
index 111..222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,4 +10,5 @@ function start() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;

 run(a, b);
@@ -40,3 +41,2 @@ function stop() {
 halt();
-log('stopped');
 done();
diff --git a/src/new.js b/src/new.js
new file mode 100644
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-too
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-"a"
+"b"
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
diff --git a/a/name.js b/b/name.js
similarity index 100%
rename from a/name.js
rename to b/name.js
`;

test('parses files, statuses and line numbers, with trimmed blank context lines', () => {
  const files = parseDiff(DIFF);
  assert.deepEqual(files.map(f => [f.path, f.status, f.binary]), [
    ['src/app.js', 'modified', false], ['src/new.js', 'added', false], ['old.txt', 'deleted', false],
    ['package-lock.json', 'modified', false], ['logo.png', 'modified', true], ['b/name.js', 'renamed', false]
  ]);
  const [h1, h2] = files[0].hunks;
  assert.deepEqual(h1.lines.map(l => [l.type, l.old ?? null, l.new ?? null]), [
    [' ', 10, 10], ['-', 11, null], ['+', null, 11], ['+', null, 12], [' ', 12, 13], [' ', 13, 14]
  ]);
  assert.equal(h1.context, 'function start() {');
  assert.deepEqual(h2.lines.map(l => l.type), [' ', '-', ' ']);
  assert.equal(files[5].oldPath, 'a/name.js');
});

test('one part per hunk; noise is skipped; removals point at where they were', () => {
  const { blocks, skipped } = changeBlocks(parseDiff(DIFF));
  assert.deepEqual(skipped, ['package-lock.json', 'logo.png', 'b/name.js']);
  assert.deepEqual(blocks.map(b => [b.id, b.path, b.start, b.end, b.added, b.removed]), [
    [1, 'src/app.js', 11, 12, 2, 1],
    [2, 'src/app.js', 42, 42, 0, 1],       // only a removal: the line after it
    [3, 'src/new.js', 1, 2, 2, 0],
    [4, 'old.txt', null, null, 0, 2]       // deleted file: nothing to show in the reader
  ]);
  assert.equal(blocks[3].removedText, 'gone\ntoo');
  // Numbered: after the change, and a removed line by its number before it
  assert.match(blocks[0].diff, /^@@ -10 \+10 @@ function start\(\) \{\n   10 \| const a = 1;\n-  11 \| const b = 2;\n\+  11 \| const b = 3;/);
});

test('the reader gets the added lines and where each removed line sits', () => {
  const { blocks } = changeBlocks(parseDiff(DIFF));
  assert.deepEqual(blocks.map(b => [b.add, b.del]), [
    [[11, 12], [[11, 11, 'const b = 2;']]],        // above the line that replaced it
    [[], [[42, 41, "log('stopped');"]]],           // above the next line still there
    [[1, 2], []],
    [[], []]                                         // deleted file: nothing in the reader
  ]);
  const onlyRemoves = `diff --git a/f.js b/f.js
--- a/f.js
+++ b/f.js
@@ -5,2 +4,0 @@
-a
-b
`;
  // Git's "+4,0": the lines went after line 4, so they sit above line 5
  assert.deepEqual(changeBlocks(parseDiff(onlyRemoves)).blocks[0].del, [[5, 5, 'a'], [5, 6, 'b']]);
});

const big = (tail) => `diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -1,2 +1,${20 + tail.filter(t => t[0] !== '-').length} @@
${Array.from({ length: 20 }, (_, k) => `+a${k + 1}`).join('\n')}
${tail.join('\n')}
`;

test('a big hunk is split at an unchanged line after about 20 changes', () => {
  const { blocks } = changeBlocks(parseDiff(big([' c1', '+b1', '+b2', ' c2'])));
  assert.deepEqual(blocks.map(b => [b.start, b.end, b.added]), [[1, 20, 20], [22, 23, 2]]);
  assert.match(blocks[1].diff, /^@@ -1 \+21 @@\n   21 \| c1\n\+  22 \| b1/);
});

test('a split never leaves a part with only unchanged lines', () => {
  const { blocks } = changeBlocks(parseDiff(big([' c1', ' c2'])));
  assert.deepEqual(blocks.map(b => [b.start, b.end, b.added]), [[1, 20, 20]]);
});

test('over the cap, the busiest file is joined into one part', () => {
  const { blocks } = changeBlocks(parseDiff(DIFF), { max: 3 });
  assert.deepEqual(blocks.map(b => [b.path, b.start, b.end]), [['src/app.js', 11, 42], ['src/new.js', 1, 2], ['old.txt', null, null]]);
});

test('a part is named after its function, else what happened to the file', () => {
  const { blocks } = changeBlocks(parseDiff(DIFF));
  assert.deepEqual(blocks.map(partTitle), ['start()', 'stop()', 'New file', 'Deleted file']);
  // Long names are cut at 48 characters
  assert.equal(partTitle({ context: 'export default async function load(url, { retries = 3, timeout = 5000, signal } = {}) {', path: 'a.js' }),
    'load(url, { retries = 3, timeout = 5000, signal…');
  assert.equal(partTitle({ context: 'class Cart:', path: 'cart.py' }), 'class Cart');
  assert.equal(partTitle({ context: '', status: 'modified', path: 'src/app.js' }), 'app.js');
});

test('reading order: code, then tests, then config, then docs', () => {
  const parts = ['README.md', 'src/app.test.js', 'package.json', 'src/app.js', 'tests/cart.py', 'docs/guide.txt', 'src/cart.py', '.github/ci.yml']
    .map(path => ({ path }));
  assert.deepEqual(orderParts(parts).map(p => p.path),
    ['src/app.js', 'src/cart.py', 'src/app.test.js', 'tests/cart.py', 'package.json', '.github/ci.yml', 'README.md', 'docs/guide.txt']);
});

test('one message covers the next small parts, up to 30 changed lines', () => {
  const parts = [[3, 1], [2, 2], [20, 0], [1, 1], [1, 0]].map(([added, removed]) => ({ added, removed }));
  assert.deepEqual(linesBatch(parts, 0), [0, 1, 2, 3]);         // 4 + 4 + 20 + 2 = 30, the most
  assert.deepEqual(linesBatch(parts, 2), [2, 3, 4]);
  assert.deepEqual(linesBatch(parts, 0, k => k === 1), [0]);    // an explained part ends the run
  assert.deepEqual(linesBatch([{ added: 90, removed: 0 }, { added: 1, removed: 0 }], 0), [0]);   // a big one goes alone
});

test('the first message carries the whole diff; each part is asked by its number', () => {
  const { blocks, skipped } = changeBlocks(parseDiff(DIFF));
  const first = linesPrompt({ blocks, nums: [1, 2], what: 'commit abc1234', repo: 'o/r', title: 'Tidy', fname: 'r.md', skipped });
  assert.match(first, /attached "r\.md" is the whole diff of commit abc1234 in o\/r \("Tidy"\), in 4 numbered parts \(left out: 3 lockfile/);
  assert.match(first, /### Part 1 · `src\/app\.js`[^\n]*\n\n```diff\n@@ -10 \+10 @@/);
  assert.match(first, /### Part 2 · `src\/app\.js`/);
  assert.doesNotMatch(first, /### Part 3/);
  const later = linesPrompt({ blocks, nums: [3], what: 'commit abc1234', repo: 'o/r' });
  assert.doesNotMatch(later, /attached/);
  const pack = changePack(blocks, 'commit abc1234');
  assert.match(pack, /## Part 4 · `old\.txt` \(deleted\)\n/);
});

test('a reply is cut at its part headings', () => {
  const reply = 'The change adds tax.\n\n### Part 2 · cart.js\n- **3** now multiplies.\n\n## **Part 3**\n- **1** new file.\n\n### Part 9\nnot asked';
  const { intro, parts } = splitParts(reply, [2, 3]);
  assert.equal(intro, 'The change adds tax.');
  assert.deepEqual([...parts], [[2, '- **3** now multiplies.'], [3, '- **1** new file.']]);
  // No headings: all of it is the first part's
  assert.deepEqual([...splitParts('- **4** renamed.', [5]).parts], [[5, '- **4** renamed.']]);
});

test('the reader rows put removed lines back where they were', () => {
  const rows = diffRows(4, [2], [[2, 2, 'old two'], [9, 7, 'old end']]);
  assert.deepEqual(rows.map(r => r.kind === 'del' ? `-${r.old} ${r.text}` : `${r.kind === 'add' ? '+' : ' '}${r.n}`), [
    ' 1', '-2 old two', '+2', ' 3', ' 4', '-7 old end'
  ]);
});
