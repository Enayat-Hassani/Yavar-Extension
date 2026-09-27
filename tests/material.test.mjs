import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { materialFile, materialFilename } from '../src/utils/material.js';

// The same file Morfia's tests read (tests/fixtures/material/article-v1.json there)
const fixture = JSON.parse(readFileSync(new URL('./fixtures/material-v1.json', import.meta.url)));

test('builds the file Morfia expects, field for field', () => {
  const file = materialFile({
    title: fixture.title, url: fixture.url, text: `# ${fixture.title}\n\n${fixture.text}`,
    quote: fixture.start_quote, producer: fixture.producer, capturedAt: fixture.captured_at
  });
  assert.deepEqual(file, fixture);
});

test('keeps a first line that is not the page title', () => {
  assert.equal(materialFile({ title: 'T', text: '# Other\n\nBody' }).text, '# Other\n\nBody');
});

test('caps the quote and title at what Morfia accepts', () => {
  const file = materialFile({ title: 't'.repeat(400), text: 'x', quote: 'q'.repeat(1200) });
  assert.equal(file.title.length, 300);
  assert.equal(file.start_quote.length, 1000);
});

test('sends no url that is not http or https', () => {
  assert.equal(materialFile({ url: 'file:///Users/me/a.html', text: 'x' }).url, '');
});

test('names the file after the title', () => {
  assert.equal(materialFilename('The Patience of Bees!'), 'The-Patience-of-Bees.morfia.json');
  assert.equal(materialFilename('***'), 'article.morfia.json');
});
