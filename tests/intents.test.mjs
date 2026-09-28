import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, intentText, editableIntents } from '../src/utils/intents.js';
import { suggestActions, actionPrompt } from '../src/utils/actions.js';
import { readingPrompt, READ_MODES } from '../src/utils/github.js';
import { changeBlocks, parseDiff, linesPrompt } from '../src/utils/changes.js';

const edits = { bugs: 'Only security problems, please.' };

test('every action and reading mode asks an intent that exists', () => {
  const ids = new Set(INTENTS.map(i => i.id));
  const kinds = [{ capture: { rows: [[1]] } }, { kind: 'selection', content: 'const a = 1;\nreturn a;' }, { kind: 'selection', content: 'TypeError: x' },
    { capture: { tag: 'button', text: 'Go' } }, { kind: 'selection', content: 'word '.repeat(30) }, { kind: 'selection', content: 'hello' },
    { image: true }, { kind: 'page' }];
  for (const it of kinds) for (const a of suggestActions([it])) assert.ok(ids.has(a.intent), `${a.id} → ${a.intent}`);
  for (const a of suggestActions(kinds.slice(0, 2))) assert.ok(ids.has(a.intent));
  for (const m of READ_MODES.filter(m => m.id !== 'add')) assert.ok(ids.has(m.id), m.id);
});

test('one edit reaches the message box, file packs and walks alike', () => {
  const code = suggestActions([{ kind: 'selection', content: 'const a = 1;\nreturn a;' }]).find(a => a.id === 'bugs');
  assert.equal(actionPrompt(code, edits), 'Only security problems, please.');
  assert.match(readingPrompt('bugs', { what: '`a.js`', repo: 'o/r' }, edits), /^I'm reading `a\.js` from the o\/r repository\. Only security problems, please\./);
  assert.equal(intentText(edits, 'bugs'), 'Only security problems, please.');
  // Unedited intents keep their text; an intent that isn't editable ignores edits
  assert.equal(intentText(edits, 'better'), INTENTS.find(i => i.id === 'better').body);
  assert.equal(intentText({ summarize: 'x' }, 'summarize'), INTENTS.find(i => i.id === 'summarize').body);
  assert.throws(() => intentText({}, 'nope'), /no intent/);
});

test('a subject adds only what fits the job to it', () => {
  const table = suggestActions([{ capture: { rows: [[1]] } }]).find(a => a.id === 'explain');
  assert.match(actionPrompt(table, {}), /^It is a table: say what each column means and what stands out\. Explain what this does/);
  assert.equal(readingPrompt('add', { what: 'x' }), '');
});

test('Line by line on a change is the intent plus what a change needs', () => {
  const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';
  const { blocks } = changeBlocks(parseDiff(diff));
  const p = linesPrompt({ blocks, nums: [1], what: 'commit x', repo: 'r', edits: { lines: 'One sentence per part.' } });
  assert.match(p, /Under it: One sentence per part\. For a changed line, say what it did before and what it does now, and why\./);
});

test('only the code-reading intents are editable, and blank edits keep the default', () => {
  assert.deepEqual(editableIntents().map(i => i.id), ['explain', 'lines', 'bugs', 'better', 'tests']);
  assert.deepEqual(editableIntents({ bugs: 'x', tests: '  ' }).filter(i => i.edited).map(i => i.id), ['bugs']);
});
