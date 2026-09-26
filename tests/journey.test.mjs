import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyPrompt, parseJourney, nextCandidates, nextPrompt, parseNext } from '../src/utils/journey.js';

const files = new Set(['README.md', 'src/index.js', 'src/net.js', 'src/utils/parse.js', 'lib/parse.js', 'src/app.js']);

test('journey prompt names the attachment and the reply shape', () => {
  const p = journeyPrompt('o/r', 'r-overview.md');
  assert.match(p, /attached "r-overview\.md"/);
  assert.match(p, /"path"/);
  assert.match(p, /entry point/);
});

test('keeps only real files in the reading order, once each', () => {
  const reply = '```json\n' + JSON.stringify({
    summary: 'A small HTTP client.',
    parts: [{ name: 'Core', role: 'Makes requests', files: ['src/net.js', 'nope.js'] }, { role: 'no name' }],
    path: [
      { file: 'src/index.js', why: 'Where it starts' },
      { file: 'net.js', why: 'The requests' },           // unique partial path
      { file: 'parse.js', why: 'Ambiguous' },            // two files: dropped
      { file: 'src/index.js', why: 'Repeat' },
      { file: 'missing.js', why: 'Not in the repo' },
      '`src/app.js`'
    ]
  }) + '\n```';
  const j = parseJourney(reply, files);
  assert.equal(j.summary, 'A small HTTP client.');
  assert.deepEqual(j.path.map(p => p.file), ['src/index.js', 'src/net.js', 'src/app.js']);
  assert.deepEqual(j.parts, [{ name: 'Core', role: 'Makes requests', files: ['src/net.js'] }]);
});

test('a reading order of one file is not a journey', () => {
  assert.equal(parseJourney('```json\n{"path": [{"file": "src/index.js"}]}\n```', files), null);
  assert.equal(parseJourney('Here is an overview in prose.', files), null);
});

const path = [{ file: 'a.js', why: 'Start' }, { file: 'b.js', why: 'The core' }, { file: 'c.js', why: 'Helpers' }];

test('next comes from the reading order, then imports, then importers', () => {
  const next = nextCandidates({ path, current: 'a.js', done: new Set(['a.js']), imports: ['x.js', 'b.js'], importedBy: ['main.js'] });
  assert.deepEqual(next, [
    { file: 'b.js', reason: 'The core' },
    { file: 'x.js', reason: 'a.js uses it' },
    { file: 'main.js', reason: 'It uses a.js' }
  ]);
});

test('skips files already read, and wraps to earlier unread ones', () => {
  const next = nextCandidates({ path, current: 'c.js', done: new Set(['b.js', 'c.js']) });
  assert.deepEqual(next, [{ file: 'a.js', reason: 'Start' }]);
  assert.deepEqual(nextCandidates({ path, current: 'c.js', done: new Set(['a.js', 'b.js', 'c.js']) }), []);
});

test('the model may only pick one of the candidates', () => {
  const candidates = [{ file: 'b.js', reason: 'The core' }, { file: 'x.js', reason: 'a.js uses it' }];
  const p = nextPrompt({ summary: 'A client.', current: 'a.js', done: new Set(['a.js']), candidates });
  assert.match(p, /- `x\.js`: a\.js uses it/);
  assert.deepEqual(parseNext('{"file": "x.js", "why": "It explains the parsing."}', candidates), { file: 'x.js', why: 'It explains the parsing.' });
  assert.deepEqual(parseNext('{"file": "`b.js`"}', candidates), { file: 'b.js', why: 'The core' });
  assert.equal(parseNext('{"file": "z.js", "why": "made up"}', candidates), null);
});

import { connectionTree } from '../src/utils/journey.js';

test('connections start at the entry point and follow imports', () => {
  const importsOf = new Map([
    ['index.js', ['core.js']],
    ['core.js', ['merge.js', 'errors.js']],
    ['errors.js', ['core.js']]            // a cycle back to core
  ]);
  const tree = connectionTree(['index.js', 'core.js', 'errors.js'], importsOf);
  assert.equal(tree.length, 1);
  const [root] = tree;
  assert.equal(root.file, 'index.js');
  assert.deepEqual(root.children[0].children.map(c => c.file), ['merge.js', 'errors.js']);
  const back = root.children[0].children[1].children[0];
  assert.deepEqual(back, { file: 'core.js', repeat: true, children: [] });
});

test('files nothing imports each start their own branch; depth is capped', () => {
  const importsOf = new Map([['a.js', ['b.js']], ['b.js', ['c.js']], ['c.js', ['d.js']], ['d.js', ['e.js']]]);
  const tree = connectionTree(['a.js', 'x.js'], importsOf, { maxDepth: 2 });
  assert.deepEqual(tree.map(t => t.file), ['a.js', 'x.js']);
  assert.deepEqual(tree[0].children[0].children[0], { file: 'c.js', repeat: false, children: [] });
});
