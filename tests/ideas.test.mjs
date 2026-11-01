import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDEA_STEPS, ideasPrompt } from '../src/utils/ideas.js';

test('a round you answer carries your text; a round that runs on its own needs none', () => {
  for (const s of IDEA_STEPS) {
    assert.equal(/\{\{\s*text\s*\}\}/.test(s.body), !s.auto, s.id);
    assert.equal(!!s.ask, !s.auto, s.id);
  }
});

test('the first round asks for what you want ideas for, and ideas come only after research', () => {
  assert.equal(IDEA_STEPS[0].auto, undefined);
  assert.match(IDEA_STEPS[0].body, /No ideas yet/);
  // You pick what to develop before the critique, so the rounds pause there
  assert.equal(IDEA_STEPS.findIndex(s => s.id === 'critique'), 2);
  assert.equal(IDEA_STEPS[2].auto, undefined);
});

test('ideasPrompt puts the text in place, $ signs and all', () => {
  const p = ideasPrompt(IDEA_STEPS[0], '  cheaper bus tickets for $2 $& less  ');
  assert.match(p, /^I want genuinely new ideas for: cheaper bus tickets for \$2 \$& less\n/);
  assert.doesNotMatch(p, /\{\{/);
});
