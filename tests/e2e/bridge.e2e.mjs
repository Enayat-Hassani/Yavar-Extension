// Reading an answer back from a chat site: the rendered answer's HTML turns
// back into Markdown (src/bridge-markdown.js), which the panel renders again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';
import { renderMarkdown } from '../../src/utils/markdown.js';

// Shaped like ChatGPT's rendering of an answer
const ANSWER = `
  <h3>2. Your source design is good</h3>
  <p>The three main voices are a particularly good idea:</p>
  <div class="_tableContainer"><div><table>
    <thead><tr><th>Voice</th><th>What it potentially captures</th></tr></thead>
    <tbody>
      <tr><td>Vendor/analyst</td><td>How AI is <strong>marketed</strong>, explained | sold</td></tr>
      <tr><td>BPO executive</td><td>How AI is discussed in commercial terms</td></tr>
    </tbody>
  </table></div></div>
  <p>The plan's framing—</p>
  <blockquote><p>which consequences each voice makes visible or leaves out</p></blockquote>
  <p>—is much better.</p>
  <ol start="3"><li><p>Pilot corpus</p><ul><li>Reddit</li><li>YouTube <code>talks</code></li></ul></li><li>Collectors</li></ol>
  <hr>
  <p>Done <button>Copy</button></p>`;

test('an answer read back from the chat keeps its tables, quotes and nested lists', async () => {
  const b = await launch();
  try {
    const page = await b.open('reader.html');
    await page.addScriptTag({ url: 'src/bridge-markdown.js' });   // as the chat frames load it
    const md = await page.evaluate((html) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      document.body.append(el);
      return window.yavarAnswerMarkdown(el);
    }, ANSWER);
    assert.equal(md, [
      '### 2. Your source design is good',
      '',
      'The three main voices are a particularly good idea:',
      '',
      '| Voice | What it potentially captures |',
      '| --- | --- |',
      '| Vendor/analyst | How AI is **marketed**, explained \\| sold |',
      '| BPO executive | How AI is discussed in commercial terms |',
      '',
      "The plan's framing—",
      '',
      '> which consequences each voice makes visible or leaves out',
      '',
      '—is much better.',
      '',
      '3. Pilot corpus',
      '   - Reddit',
      '   - YouTube `talks`',
      '4. Collectors',
      '',
      '---',
      '',
      'Done'
    ].join('\n'));
    // …and the panel draws them as a table and a quote again
    const html = renderMarkdown(md).html;
    assert.match(html, /<th>Voice<\/th>/);
    assert.match(html, /<td>BPO executive<\/td>/);
    assert.match(html, /<blockquote>which consequences/);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
