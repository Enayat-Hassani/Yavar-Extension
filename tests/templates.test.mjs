import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandTemplate, varsInTemplate, DEFAULT_TEMPLATES } from '../src/utils/templates.js';

test('fills placeholders, tolerating inner spaces', async () => {
  const out = await expandTemplate('A {{ selection }} B {{title}}', { selection: 'sel', title: 'T' });
  assert.equal(out, 'A sel B T');
});

test('unknown and missing placeholders expand to empty', async () => {
  assert.equal(await expandTemplate('x {{nope}} {{url}} y'), 'x   y');
});

test('$ patterns in values are inserted literally', async () => {
  const sel = "echo $1 $& $$ $' $`";
  assert.equal(await expandTemplate('{{selection}}', { selection: sel }), sel);
});

test('placeholders inside values are not expanded again', async () => {
  const out = await expandTemplate('{{selection}} / {{page}}', { selection: '{{page}}', page: 'PAGE' });
  assert.equal(out, '{{page}} / PAGE');
});

test('clipboard is only read when referenced', async () => {
  let reads = 0;
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { readText: async () => { reads++; return 'clip'; } } }
  });
  try {
    await expandTemplate('{{selection}}', { selection: 's' });
    assert.equal(reads, 0);
    assert.equal(await expandTemplate('{{clipboard}}'), 'clip');
    assert.equal(reads, 1);
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
  }
});

test('varsInTemplate lists each placeholder once', () => {
  assert.deepEqual(varsInTemplate('{{a}} {{ b }} {{a}}'), ['a', 'b']);
});

// content.js can't import modules, so the manifest loads the shared core
// (a classic script) just before it. Guard that wiring and the single copy.
test('content script gets templates from the shared core', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const js = manifest.content_scripts.find(cs => cs.js.includes('src/content.js')).js;
  assert.ok(js.indexOf('src/utils/template-core.js') > -1, 'core not loaded');
  assert.ok(js.indexOf('src/utils/template-core.js') < js.indexOf('src/content.js'), 'core must load first');
  const content = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  assert.match(content, /globalThis\.YavarTemplateCore/);
  assert.doesNotMatch(content, /const DEFAULT_TEMPLATES = \[/, 'content.js must not carry its own copy');
  assert.equal(DEFAULT_TEMPLATES.length, 6);
});
