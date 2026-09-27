import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { materialFile, addToMorfia, pingMorfia } from '../src/utils/material.js';

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

function serve(fn) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url, init }); return fn(url, init); };
  return calls;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('posts the article to the bridge with the connection code', async () => {
  const calls = serve(() => json(201, { id: 7, title: 'Bees', already: false }));
  const added = await addToMorfia(fixture, { base: 'http://localhost:8000/', token: 'abc' });
  assert.equal(added.id, 7);
  assert.equal(calls[0].url, 'http://localhost:8000/bridge/v1/article');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc');
  assert.deepEqual(JSON.parse(calls[0].init.body), fixture);
});

test("says Morfia isn't running when nothing answers", async () => {
  serve(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(addToMorfia(fixture, { base: 'http://localhost:8000', token: 'abc' }),
    /Morfia isn't running at http:\/\/localhost:8000/);
});

test("passes on Morfia's own reason for a refusal", async () => {
  serve(() => json(401, { error: 'Not connected.' }));
  await assert.rejects(addToMorfia(fixture, { base: 'http://x', token: 'bad' }), /Not connected\./);
  await assert.rejects(pingMorfia({ base: 'http://x', token: 'bad' }), /Not connected\./);
});
