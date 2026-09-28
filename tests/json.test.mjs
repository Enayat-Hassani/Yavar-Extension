import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonCandidates } from '../src/utils/json.js';

test('JSON is found in a fence, in plain text, and past common slips', () => {
  assert.deepEqual(jsonCandidates('Here you go:\n```json\n{"a": 1}\n```\nDone.'), [{ a: 1 }, { a: 1 }]);
  assert.deepEqual(jsonCandidates('Plan: {"steps": [1, 2,],} thanks'), [{ steps: [1, 2] }]);
  assert.deepEqual(jsonCandidates('{\u201ca\u201d: 2}'), [{ a: 2 }]);
  assert.deepEqual(jsonCandidates('no json here'), []);
});
