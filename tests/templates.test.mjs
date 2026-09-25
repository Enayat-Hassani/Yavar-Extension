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

// content.js can't import modules (a failed import would kill the whole
// content script), so it carries a copy of the defaults. Keep them in sync.
test('content.js DEFAULT_TEMPLATES matches utils/templates.js', () => {
  const src = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const m = src.match(/const DEFAULT_TEMPLATES = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'DEFAULT_TEMPLATES not found in content.js');
  const copy = new Function(`return ${m[1]}`)();
  assert.deepEqual(copy, DEFAULT_TEMPLATES);
});
