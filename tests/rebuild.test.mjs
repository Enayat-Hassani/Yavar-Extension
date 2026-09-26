import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCoreFiles, parseRebuildPlan, planPrompt, hintPrompt, askPrompt, checkPrompt } from '../src/utils/rebuild.js';

test('picks docs and shallow source within budget, skipping tests and big files', () => {
  const items = [
    { path: 'README.md', type: 'blob', size: 2000 },
    { path: 'package.json', type: 'blob', size: 500 },
    { path: 'src/index.ts', type: 'blob', size: 3000 },
    { path: 'src/core/engine.ts', type: 'blob', size: 8000 },
    { path: 'src/huge.ts', type: 'blob', size: 90000 },
    { path: 'tests/engine.test.ts', type: 'blob', size: 1000 },
    { path: 'src/types.d.ts', type: 'blob', size: 100 },
    { path: 'logo.png', type: 'blob', size: 10 },
    { path: 'src', type: 'tree' }
  ];
  assert.deepEqual(pickCoreFiles(items, 20000), ['README.md', 'package.json', 'src/index.ts', 'src/core/engine.ts']);
});

test('parses a fenced JSON plan and normalises fields', () => {
  const reply = 'Sure!\n```json\n{"project":"tinyhttp","language":"TypeScript","summary":"A router.",' +
    '"steps":[{"title":"Server","goal":"sockets","study":["./src/server.ts","`src/app.ts`"],"task":"Start a server","done_when":"curl works"},' +
    '{"name":"Routing","files":"src/router.ts, src/app.ts","description":"Match paths","check":"tests pass"},]}\n```';
  const plan = parseRebuildPlan(reply);
  assert.equal(plan.project, 'tinyhttp');
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0].study, ['src/server.ts', 'src/app.ts']);
  assert.deepEqual(plan.steps[1], { title: 'Routing', goal: '', study: ['src/router.ts', 'src/app.ts'], task: 'Match paths', done_when: 'tests pass' });
});

test('falls back to Markdown steps', () => {
  const plan = parseRebuildPlan('## Step 1: Parse input\nRead `src/parse.py` and write a tokenizer.\n\n## Step 2: Evaluate\nUse `src/eval.py`.');
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].title, 'Parse input');
  assert.deepEqual(plan.steps[0].study, ['src/parse.py']);
  assert.equal(parseRebuildPlan('no plan here'), null);
});

test('prompts mention the project, step and code', () => {
  const plan = { project: 'demo', language: 'Python', steps: [{ title: 'A', task: 'do a', done_when: 'runs', study: ['a.py'] }] };
  assert.match(planPrompt('acme/demo'), /acme\/demo[\s\S]*```json/);
  assert.match(hintPrompt(plan, 0), /step 1 of 1: "A"[\s\S]*a\.py/);
  assert.match(checkPrompt(plan, 0, 'print(1)\n', true), /```python\nprint\(1\)\n```[\s\S]*attached pack/);
});

test('a question of your own carries the step, your code and the question', () => {
  const plan = { project: 'tiny-http', language: 'Python', steps: [{ title: 'Parse the request line', task: 'Split method, path and version' }] };
  const p = askPrompt(plan, 0, 'def parse(line):\n    return line.split()\n', 'Why not use a regex?');
  assert.match(p, /step 1 of 1: "Parse the request line"/);
  assert.match(p, /```python\ndef parse\(line\):\n    return line\.split\(\)\n```/);
  assert.match(p, /My question: Why not use a regex\?/);
  assert.doesNotMatch(askPrompt(plan, 0, '  \n', 'What is a request line?'), /My code so far/);
});
