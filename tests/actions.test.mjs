import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemKind, looksLikeCode, suggestActions } from '../src/utils/actions.js';

const capture = (c) => ({ kind: 'capture', image: 'data:x', capture: { tag: 'div', text: '', rows: [], html: '', ...c } });
const selection = (text) => ({ kind: 'selection', content: text });
const ids = (items) => suggestActions(items).map(a => a.id);

test('sorts captures by what they contain', () => {
  assert.equal(itemKind(capture({ rows: [['a', 'b']] })), 'table');
  assert.equal(itemKind(capture({ tag: 'button', text: 'Save' })), 'control');
  assert.equal(itemKind(capture({ tag: 'div', html: '<form>…</form>', text: 'Name' })), 'control');
  assert.equal(itemKind(capture({ tag: 'pre', text: 'ls -la' })), 'code');
  assert.equal(itemKind(capture({ text: '' })), 'image');
  assert.equal(itemKind({ kind: 'image', image: 'data:x' }), 'image');
});

test('sorts selected text: errors, code, prose, short phrases', () => {
  assert.equal(itemKind(selection('Traceback (most recent call last):\n  File "a.py", line 3\nKeyError: \'x\'')), 'error');
  assert.equal(itemKind(selection("TypeError: Cannot read properties of undefined (reading 'map')")), 'error');
  assert.equal(itemKind(selection('const a = 1;\nfunction f(x) {\n  return x * 2;\n}')), 'code');
  assert.equal(itemKind(selection('ubiquitous')), 'short');
  assert.equal(itemKind({ kind: 'file', content: 'import os\nprint(os.getcwd())' }), 'code');
  const para = 'The committee concluded that the proposal, although ambitious, lacked the funding and the public support it would need to succeed in the coming decade, and asked for a revised plan.';
  assert.equal(itemKind(selection(para)), 'prose');
  // An English sentence that mentions an error is not a stack trace
  assert.equal(itemKind(selection('There was an error in the report, so we fixed it.')), 'short');
});

test('looksLikeCode needs most lines to read like code', () => {
  assert.equal(looksLikeCode('def f(x):\n    return x'), true);
  assert.equal(looksLikeCode('Dear team,\nThanks for the update.\nBest, A'), false);
  assert.equal(looksLikeCode('x = 1;'), false);   // one line is not enough to tell
});

test('actions per kind; files keep the reading modes; several items get compare', () => {
  assert.deepEqual(ids([capture({ rows: [['a']] })]), ['explain', 'takeaways', 'csv']);
  assert.deepEqual(ids([{ kind: 'files' }]), ['explain', 'lines', 'fit', 'review', 'quiz']);
  assert.equal(suggestActions([{ kind: 'files' }])[0].readMode, 'explain');
  assert.deepEqual(ids([selection('ubiquitous'), capture({ rows: [['a']] })]), ['compare', 'summarize']);
  assert.deepEqual(ids([{ kind: 'page' }]), ['summarize', 'questions', 'vocab']);
  assert.deepEqual(ids([]), []);
});
