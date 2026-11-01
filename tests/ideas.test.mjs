import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDEA_STEPS, ideasPrompt, ideaSteps, lacksText } from '../src/utils/ideas.js';

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

test('ideaSteps applies only the edits, and an empty edit keeps the default', () => {
  const steps = ideaSteps({ critique: 'Pick: {{text}}', scan: '   ', nope: 'x' });
  assert.deepEqual(steps.map(s => s.id), IDEA_STEPS.map(s => s.id));
  const by = Object.fromEntries(steps.map(s => [s.id, s]));
  assert.deepEqual([by.critique.body, by.critique.edited], ['Pick: {{text}}', true]);
  assert.deepEqual([by.scan.body, by.scan.edited], [IDEA_STEPS[0].body, false]);
  assert.equal(by.diverge.edited, false);
  assert.equal(by.critique.auto, undefined);   // the rest of the round is kept
  assert.equal(ideaSteps().some(s => s.edited), false);
});

test('a round you answer needs {{text}}; a round that runs on its own does not', () => {
  const ask = IDEA_STEPS.find(s => !s.auto);
  const auto = IDEA_STEPS.find(s => s.auto);
  assert.equal(lacksText(ask, 'No placeholder here'), true);
  assert.equal(lacksText(ask, 'Develop {{ text }}'), false);
  assert.equal(lacksText(auto, 'No placeholder here'), false);
});
