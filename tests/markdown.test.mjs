import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, runnableLang } from '../src/utils/markdown.js';

test('escapes HTML and never produces script or handlers', () => {
  const { html } = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('href="javascript'), html);
  assert.match(html, /&lt;script&gt;/);
});

test('headings, lists, emphasis, inline code and links', () => {
  const { html } = renderMarkdown('## Plan\n\n- **Bold** and *em*\n- `a < b`\n\n1. one\n2. [docs](https://x.dev/a)\n\n> note');
  assert.match(html, /<h4>Plan<\/h4>/);
  assert.match(html, /<ul><li><strong>Bold<\/strong> and <em>em<\/em><\/li><li><code>a &lt; b<\/code><\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li><a href="https:\/\/x\.dev\/a" target="_blank" rel="noopener noreferrer">docs<\/a><\/li><\/ol>/);
  assert.match(html, /<blockquote>note<\/blockquote>/);
});

test('code blocks keep raw code and get run buttons for Python/JS only', () => {
  const md = 'Try:\n```python\nif a < b and "x":\n    print(a & b)\n```\n```bash\nls\n```';
  const { html, code } = renderMarkdown(md);
  assert.deepEqual(code, [
    { lang: 'python', code: 'if a < b and "x":\n    print(a & b)' },
    { lang: 'bash', code: 'ls' }
  ]);
  assert.equal((html.match(/data-md-act="run"/g) || []).length, 1);
  // Coloured, but the text of the code is intact and escaped
  const text = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(text, 'if a &lt; b and &quot;x&quot;:\n    print(a &amp; b)');
  assert.equal(runnableLang('JS'), 'javascript');
  assert.equal(runnableLang('ts'), null);
});

test('inline code contents are not formatted', () => {
  assert.match(renderMarkdown('use `**not bold**` here').html, /<code>\*\*not bold\*\*<\/code>/);
});

import { highlight, FOLD_LINES } from '../src/utils/markdown.js';

test('highlight colours keywords, strings, comments and numbers, and escapes the rest', () => {
  assert.equal(highlight('const x = "a<b"; // hi', 'js'),
    '<span class="tok-k">const</span> x = <span class="tok-s">&quot;a&lt;b&quot;</span>; <span class="tok-c">// hi</span>');
  assert.equal(highlight('def f(): return 1  # one', 'python'),
    '<span class="tok-k">def</span> f(): <span class="tok-k">return</span> <span class="tok-n">1</span>  <span class="tok-c"># one</span>');
  assert.equal(highlight('SELECT a FROM t', 'sql'), '<span class="tok-k">SELECT</span> a <span class="tok-k">FROM</span> t');
  // A keyword inside a string stays part of the string
  assert.equal(highlight("'if'", 'js'), '<span class="tok-s">&#39;if&#39;</span>');
  assert.equal(highlight('<b>if</b>', 'text'), '&lt;b&gt;if&lt;/b&gt;');
});

test('tables, with alignment and inline formatting in cells', () => {
  const { html } = renderMarkdown('| Region | Growth |\n| :--- | ---: |\n| **EU** | 9% |\n| US | 14% |\n\nAfter');
  assert.match(html, /<div class="md-table"><table><thead><tr><th>Region<\/th><th style="text-align:right">Growth<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><td><strong>EU<\/strong><\/td><td style="text-align:right">9%<\/td><\/tr><tr><td>US<\/td>/);
  assert.match(html, /<\/table><\/div>\n<p>After<\/p>/);
});

test('a pipe in a sentence is not a table', () => {
  assert.doesNotMatch(renderMarkdown('a | b\nnext line').html, /<table/);
});

test('nested lists and checklists', () => {
  const { html } = renderMarkdown('- one\n  - one.a\n  - one.b\n- two\n\n- [x] done\n- [ ] todo');
  assert.match(html, /<ul><li>one<ul><li>one\.a<\/li><li>one\.b<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ul class="md-tasks"><li><span class="md-task is-done" aria-hidden="true"><\/span><span class="md-task-text">done<\/span><\/li><li><span class="md-task"/);
});

test('strikethrough and bare links, without double-linking', () => {
  const { html } = renderMarkdown('~~old~~ see https://x.dev/a. Or [docs](https://x.dev/b)');
  assert.match(html, /<del>old<\/del> see <a href="https:\/\/x\.dev\/a" [^>]*>https:\/\/x\.dev\/a<\/a>\./);
  assert.equal((html.match(/<a /g) || []).length, 2);
});

test('long code blocks start folded', () => {
  const long = '```js\n' + Array.from({ length: FOLD_LINES + 1 }, (_, i) => `x${i}`).join('\n') + '\n```';
  assert.match(renderMarkdown(long).html, /class="md-code is-folded"[\s\S]*Show all 25 lines/);
  assert.doesNotMatch(renderMarkdown('```js\nx\n```').html, /is-folded/);
});

import { stripChatArtifacts } from '../src/utils/markdown.js';

test('drops ChatGPT citation markers', () => {
  assert.equal(stripChatArtifacts('Uses Ghostscript and qpdf. :contentReference[oaicite:0]{index=0}'), 'Uses Ghostscript and qpdf. ');
  assert.ok(!renderMarkdown('A fact.contentReference[oaicite:12]{index=12}').html.includes('oaicite'));
});
