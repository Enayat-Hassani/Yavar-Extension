import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_STEPS, reviewSteps, reviewText } from '../src/utils/review.js';
import { changeBlocks, parseDiff, linesPrompt } from '../src/utils/changes.js';

test('edits replace only the prompts they name; blank ones keep the default', () => {
  const steps = reviewSteps({ bugs: 'Only security, please.', tests: '  ' });
  assert.deepEqual(steps.filter(s => s.edited).map(s => s.id), ['bugs']);
  assert.equal(reviewText({ bugs: 'Only security, please.' }, 'bugs'), 'Only security, please.');
  assert.equal(reviewText(null, 'better'), REVIEW_STEPS.find(s => s.id === 'better').body);
});

test('an edited Line by line goes into the message, with the part headings kept', () => {
  const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';
  const { blocks } = changeBlocks(parseDiff(diff));
  const p = linesPrompt({ blocks, nums: [1], what: 'commit x', repo: 'r', howTo: 'One sentence per part, nothing more.' });
  assert.match(p, /heading "### Part N"\. Under it: One sentence per part, nothing more\./);
  assert.match(p, /### Part 1 · `a\.js`/);
});
