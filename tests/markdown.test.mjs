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
  assert.match(html, /<pre><code>if a &lt; b and &quot;x&quot;:/);
  assert.equal(runnableLang('JS'), 'javascript');
  assert.equal(runnableLang('ts'), null);
});

test('inline code contents are not formatted', () => {
  assert.match(renderMarkdown('use `**not bold**` here').html, /<code>\*\*not bold\*\*<\/code>/);
});
