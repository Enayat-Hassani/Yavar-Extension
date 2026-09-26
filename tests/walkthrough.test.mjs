import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkPrompt, parseWalkthrough, compareTyped, stripComments } from '../src/utils/walkthrough.js';

const reply = (blocks, summary = 'Parses things.') => '```json\n' + JSON.stringify({ summary, blocks }) + '\n```';

test('prompt names the file, the lines and the reply shape', () => {
  const p = walkPrompt({ path: 'src/a.js', repo: 'o/r', range: { start: 1, end: 120 }, source: 'The attached file is' });
  assert.match(p, /`src\/a\.js` from o\/r \(lines 1-120\)/);
  assert.match(p, /about 6 blocks/);
  assert.match(p, /"blocks"/);
});

test('reads blocks and keeps them in order', () => {
  const w = parseWalkthrough(reply([
    { start: 11, end: 30, title: 'Main', explain: 'Does the work.' },
    { start: 1, end: 10, title: 'Imports', explain: 'Loads helpers.' }
  ]), { start: 1, end: 30 });
  assert.equal(w.summary, 'Parses things.');
  assert.deepEqual(w.blocks.map(b => [b.start, b.end, b.title]), [[1, 10, 'Imports'], [11, 30, 'Main']]);
});

test('clamps to the range, trims overlaps and fills gaps', () => {
  const w = parseWalkthrough(reply([
    { start: 1, end: 8, title: 'A', explain: 'a' },
    { start: 5, end: 12, title: 'B', explain: 'b' },      // overlaps A
    { start: 14, end: 20, title: 'C', explain: 'c' },     // 1-line gap: joins B
    { start: 40, end: 99, title: 'D', explain: 'd' }      // 19-line gap; runs past the end
  ]), { start: 1, end: 50 });
  assert.deepEqual(w.blocks.map(b => [b.start, b.end, b.title]),
    [[1, 8, 'A'], [9, 13, 'B'], [14, 20, 'C'], [21, 39, 'Lines 21-39'], [40, 50, 'D']]);
  assert.equal(w.blocks[3].explain, '', 'a filled gap has no explanation yet');
});

test('walks a selected range, not the whole file', () => {
  const w = parseWalkthrough(reply([{ start: 1, end: 200, title: 'All', explain: 'x' }]), { start: 40, end: 60 });
  assert.deepEqual(w.blocks.map(b => [b.start, b.end]), [[40, 60]]);
});

test('no usable blocks gives null', () => {
  assert.equal(parseWalkthrough('Sure! Here is the walkthrough in prose.', { start: 1, end: 10 }), null);
  assert.equal(parseWalkthrough(reply([{ start: 'x', end: 3 }]), { start: 1, end: 10 }), null);
});

test('typing compare ignores indentation and blank lines', () => {
  const r = compareTyped('def f(x):\n    return x + 1\n', 'def f(x):\n\n  return  x + 1');
  assert.equal(r.accuracy, 100);
  assert.ok(r.ops.every(o => o.type === 'same'));
});

test('typing compare catches a changed line and a missing one', () => {
  const r = compareTyped('a = 1\nb = 2\nc = 3\nd = 4', 'a = 1\nb = 3\nd = 4');
  assert.equal(r.accuracy, 50);
  assert.deepEqual(r.ops.filter(o => o.type !== 'same').map(o => [o.type, o.text]).sort(),
    [['extra', 'b = 3'], ['missing', 'b = 2'], ['missing', 'c = 3']]);
});

test('typing nothing scores zero', () => {
  assert.equal(compareTyped('x = 1', '').accuracy, 0);
});

test('typing compare leaves comments and docstrings out', () => {
  const original = 'def f(x):\n    """Add one."""\n    # the next number\n    return x + 1  # simple\n';
  const r = compareTyped(original, 'def f(x):\n    return x + 1', 'python');
  assert.equal(r.accuracy, 100);
  assert.ok(r.ops.every(o => o.type === 'same'));
  // Comments you add yourself don't count against you either
  assert.equal(compareTyped('const a = 1;\n/* two\n   lines */\nlet b = 2; // b', '// mine\nconst a = 1;\nlet b = 2;', 'javascript').accuracy, 100);
});

test('comment markers inside strings are code', () => {
  assert.equal(stripComments('url = "http://x.org" // site', 'javascript'), 'url = "http://x.org" ');
  assert.equal(stripComments("tag = '#main'  # id", 'python'), "tag = '#main'  ");
  // A triple-quoted string that is a value, not a docstring, stays
  assert.equal(stripComments('q = """\nselect 1 # not a comment\n"""', 'python'), 'q = """\nselect 1 # not a comment\n"""');
  assert.equal(stripComments('select 1 -- one', 'sql'), 'select 1 ');
});

test('comments are compared when the language is unknown', () => {
  assert.equal(compareTyped('x = 1\n# note', 'x = 1').accuracy, 50);
  assert.equal(stripComments('<a href="//x">//</a>', 'html'), '<a href="//x">//</a>');
});

import { quizPrompt, parseQuiz } from '../src/utils/walkthrough.js';

test('quiz prompt carries the code and asks for JSON', () => {
  const p = quizPrompt('lines 1-3 of `a.py`', '```python\n1│ x = 1\n```');
  assert.match(p, /lines 1-3 of `a\.py`/);
  assert.match(p, /1│ x = 1/);
  assert.match(p, /"questions"/);
});

test('parses quiz questions and drops ones without an answer', () => {
  const reply = 'Here you go:\n```json\n{"questions": [{"q": "What is x?", "a": "One."}, {"question": "Why?", "answer": "Because."}, {"q": "No answer"}]}\n```';
  assert.deepEqual(parseQuiz(reply), [{ q: 'What is x?', a: 'One.' }, { q: 'Why?', a: 'Because.' }]);
  assert.equal(parseQuiz('1. What is x?\nAnswer: one'), null);
});

test('chat citation markers do not reach the walkthrough', () => {
  const w = parseWalkthrough('```json\n{"summary": "Prepares PDFs. :contentReference[oaicite:0]{index=0}", "blocks": [{"start": 1, "end": 2, "title": "A", "explain": "B:contentReference[oaicite:1]{index=1}"}]}\n```', { start: 1, end: 2 });
  assert.equal(w.summary, 'Prepares PDFs.');
  assert.equal(w.blocks[0].explain, 'B');
});
