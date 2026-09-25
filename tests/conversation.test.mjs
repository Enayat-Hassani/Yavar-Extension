import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptMarkdown, turnsToMessages } from '../src/utils/conversation.js';

const turns = [
  { q: 'What is a closure?', a: 'A function that keeps its scope.', by: 'ChatGPT' },
  { q: 'Show one in JS', a: '```js\nconst f = () => x;\n```', by: 'qwen/qwen:free' }
];

test('the transcript names who wrote each answer', () => {
  assert.equal(transcriptMarkdown(turns),
    '# Our conversation so far\n\n## Me\n\nWhat is a closure?\n\n## ChatGPT\n\nA function that keeps its scope.\n\n' +
    '## Me\n\nShow one in JS\n\n## qwen/qwen:free\n\n```js\nconst f = () => x;\n```\n');
});

test('API models get the turns as their own messages', () => {
  assert.deepEqual(turnsToMessages(turns).map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(turnsToMessages(turns)[3].content, turns[1].a);
});

test('a long conversation keeps its newest turns and says what it left out', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ q: `q${i}`, a: 'x'.repeat(100), by: 'A' }));
  const md = transcriptMarkdown(many, 350);
  assert.match(md, /\(7 earlier turns left out\)/);
  assert.match(md, /q9/);
  assert.doesNotMatch(md, /q6\b/);
  assert.equal(turnsToMessages(many, 350).length, 6);
  // The newest turn is kept even when it alone is over the limit
  assert.equal(turnsToMessages([{ q: 'big', a: 'y'.repeat(1000) }], 10).length, 2);
});
