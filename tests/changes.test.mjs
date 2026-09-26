import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, changeBlocks, changeWalkPrompt, parseChangeWalk, changePack } from '../src/utils/changes.js';

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
  assert.match(blocks[0].diff, /^@@ -10 \+10 @@ function start\(\) \{\n const a = 1;\n-const b = 2;\n\+const b = 3;/);
});

test('over the cap, the busiest file is joined into one part', () => {
  const { blocks } = changeBlocks(parseDiff(DIFF), { max: 3 });
  assert.deepEqual(blocks.map(b => [b.path, b.start, b.end]), [['src/app.js', 11, 42], ['src/new.js', 1, 2], ['old.txt', null, null]]);
});

test('the AI orders and explains the parts; unknown ids go, missing ones follow', () => {
  const { blocks } = changeBlocks(parseDiff(DIFF));
  const reply = '```json\n' + JSON.stringify({
    summary: 'Adds x and y, and stops logging.',
    parts: [{ id: 3, title: 'New exports', explain: 'Two constants.' }, { id: 99, title: 'made up' }, { id: '1', title: 'Bump b' }, { id: 3, title: 'repeat' }]
  }) + '\n```';
  const r = parseChangeWalk(reply, blocks);
  assert.equal(r.summary, 'Adds x and y, and stops logging.');
  assert.deepEqual(r.blocks.map(b => [b.id, b.title]), [[3, 'New exports'], [1, 'Bump b'], [2, 'app.js: −1'], [4, 'old.txt: −2']]);
  assert.equal(r.blocks[0].path, 'src/new.js');
  assert.equal(parseChangeWalk('The change adds two constants.', blocks), null);
});

test('the prompt and pack name the parts and what was left out', () => {
  const { blocks, skipped } = changeBlocks(parseDiff(DIFF));
  const p = changeWalkPrompt({ what: 'commit abc1234', repo: 'o/r', title: 'Tidy', fname: 'r-abc1234.md', skipped });
  assert.match(p, /attached "r-abc1234\.md" is the diff of commit abc1234 in o\/r \("Tidy"\)/);
  assert.match(p, /left out: 3 lockfile, generated or binary files/);
  const pack = changePack(blocks, 'commit abc1234');
  assert.match(pack, /## Part 1 · `src\/app\.js` \(modified\), lines 11-12 after the change\n\n```diff\n@@/);
  assert.match(pack, /## Part 4 · `old\.txt` \(deleted\)\n/);
});
