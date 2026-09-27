import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COACH_STEPS, coachSteps, lacksAttempt, coachPrompt } from '../src/utils/coach.js';

test('every default step carries the attempt', () => {
  for (const s of COACH_STEPS) assert.equal(lacksAttempt(s.body), false, s.id);
});

test('default prompts stay short enough for free chat sites', () => {
  for (const s of COACH_STEPS) assert.ok(s.body.length <= 700, `${s.id}: ${s.body.length} characters`);
});

test('edits replace only the steps they name', () => {
  const steps = coachSteps({ answers: 'Mine: {{selection}}', nope: 'ignored' });
  assert.equal(steps.length, COACH_STEPS.length);
  assert.deepEqual(steps.filter(s => s.edited).map(s => s.id), ['answers']);
  assert.equal(steps.find(s => s.id === 'answers').body, 'Mine: {{selection}}');
  assert.equal(steps[0].body, COACH_STEPS[0].body);
});

test('an empty edit leaves the default in place', () => {
  assert.equal(coachSteps({ thesis: '' })[0].edited, false);
});

test('lacksAttempt tolerates spaces inside the braces', () => {
  assert.equal(lacksAttempt('x {{ selection }} y'), false);
  assert.equal(lacksAttempt('x {{title}} y'), true);
});

test('the prompt carries the attempt and the title', async () => {
  const out = await coachPrompt(COACH_STEPS[0], 'Bees plan ahead.', { title: 'Patient Bees' });
  assert.match(out, /Bees plan ahead\./);
  assert.match(out, /"Patient Bees"/);
});

test('"about you" goes with the first step only', async () => {
  const about = 'Target band 8, first language Dari';
  assert.match(await coachPrompt(COACH_STEPS[0], 'a', { about }), /About me: Target band 8/);
  assert.doesNotMatch(await coachPrompt(COACH_STEPS[1], 'a', { about }), /About me/);
  assert.doesNotMatch(await coachPrompt(COACH_STEPS[0], 'a', { about: '  ' }), /About me/);
});
