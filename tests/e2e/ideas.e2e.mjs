// Ideas: a creative search in rounds. Your topic runs the scan and then the
// ideas round on its own; it waits for your pick before the critique, which
// runs the last round on its own and ends the tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

test('Ideas scans, makes ideas, waits for your pick, then critiques and deepens', async () => {
  const b = await launch();
  try {
    const page = await b.open('sidepanel.html');
    const r = await page.evaluate(async () => {
      const p = window.__panel;
      const pause = (ms) => new Promise(x => setTimeout(x, ms));
      const asks = [];
      p.askInThread = async (o) => { asks.push(o); return 'ok'; };
      const chip = () => document.querySelector('.composer-tool .composer-item-name')?.textContent || '';
      const send = async (text) => { p.threadInput.value = text; p.sendComposer(); await pause(200); };
      document.getElementById('app-more').click();
      document.querySelector('#tool-menu-list [data-tool="ideas"]').click();
      const start = { chip: chip(), placeholder: p.threadInput.placeholder };
      await send('cheaper bus tickets');
      const paused = { chip: chip(), placeholder: p.threadInput.placeholder, asked: asks.length };
      await send('I2 and I5');
      return { start, paused, end: chip(), prompts: asks.map(a => a.prompt.split('\n')[0]), labels: asks.map(a => a.label) };
    });
    assert.deepEqual(r.start, { chip: 'Ideas 1/4 · Scan', placeholder: 'What do you want ideas for?' });
    assert.equal(r.paused.asked, 2);
    assert.equal(r.paused.chip, 'Ideas 3/4 · Critique');
    assert.match(r.paused.placeholder, /Which ideas or directions/);
    assert.equal(r.end, '');
    assert.deepEqual(r.prompts, ['I want genuinely new ideas for: cheaper bus tickets', 'Now make ideas with these methods, 2 or 3 ideas each:',
      'Develop these: I2 and I5', 'Take the three strongest that survived. For each:']);
    assert.deepEqual(r.labels, ['cheaper bus tickets', 'Diverge (next round)', 'I2 and I5', 'Deepen (next round)']);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
