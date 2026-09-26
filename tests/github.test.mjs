import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGitHubUrl, refCandidates, rawFileUrl, isReadablePath, estimateTokens, sliceLines,
  extractImports, resolveImports, suggestStartFiles, buildPack, outlineTree, readingPrompt, READ_MODES
} from '../src/utils/github.js';

test('parses repo, blob with lines, tree, PR and commit URLs', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/a/b'), { owner: 'a', repo: 'b', kind: 'repo', rest: [], lines: null });
  const blob = parseGitHubUrl('https://github.com/a/b/blob/main/src/x.js#L20-L10');
  assert.equal(blob.kind, 'blob');
  assert.deepEqual(blob.rest, ['main', 'src', 'x.js']);
  assert.deepEqual(blob.lines, { start: 10, end: 20 });
  assert.deepEqual(parseGitHubUrl('https://github.com/a/b/blob/main/x.py#L7').lines, { start: 7, end: 7 });
  assert.equal(parseGitHubUrl('https://github.com/a/b/tree/dev/src').kind, 'tree');
  assert.equal(parseGitHubUrl('https://github.com/a/b/pull/42/files').number, 42);
  assert.equal(parseGitHubUrl('https://github.com/a/b/commit/abc1234').sha, 'abc1234');
  assert.equal(parseGitHubUrl('https://github.com/a/b.git').repo, 'b');
  assert.equal(parseGitHubUrl('https://github.com/settings/profile'), null);
  assert.equal(parseGitHubUrl('https://gitlab.com/a/b'), null);
});

test('ref candidates cover branch names with slashes', () => {
  assert.deepEqual(refCandidates(['feature', 'x', 'src', 'a.js']).slice(0, 2), [
    { ref: 'feature', path: 'x/src/a.js' },
    { ref: 'feature/x', path: 'src/a.js' }
  ]);
});

test('raw URL encodes each segment', () => {
  assert.equal(rawFileUrl('o', 'r', 'feat/x', 'a b/c#.js'),
    'https://raw.githubusercontent.com/o/r/feat/x/a%20b/c%23.js');
});

test('filters binary, lock and vendored files', () => {
  for (const p of ['src/a.ts', 'README.md', 'Makefile', 'lib/x.py']) assert.ok(isReadablePath(p), p);
  for (const p of ['logo.png', 'package-lock.json', 'node_modules/x/index.js', 'web/dist/app.js', 'a.min.js', 'm.wasm'])
    assert.ok(!isReadablePath(p), p);
});

test('token estimate and line slicing', () => {
  assert.equal(estimateTokens(4001), 1001);
  assert.equal(sliceLines('a\nb\nc\nd', 2, 3), 'b\nc');
  assert.equal(sliceLines('a\nb', 0, 99), 'a\nb');
});

test('resolves JS/TS relative imports and aliases', () => {
  const files = new Set(['src/app.ts', 'src/utils/net.ts', 'src/components/index.tsx', 'src/lib/db.js', 'src/styles.css']);
  const code = `import { x } from './utils/net';\nimport C from "./components";\nconst db = require('./lib/db.js');\nimport React from 'react';\nexport * from '@/styles.css';\nimport('./utils/net')`;
  const specs = extractImports(code, 'src/app.ts');
  assert.deepEqual(resolveImports(specs, 'src/app.ts', files).sort(),
    ['src/components/index.tsx', 'src/lib/db.js', 'src/styles.css', 'src/utils/net.ts']);
});

test('resolves Python absolute, relative and submodule imports', () => {
  const files = new Set(['pkg/__init__.py', 'pkg/core.py', 'pkg/sub/helpers.py', 'src/tool/cli.py', 'pkg/sub/__init__.py']);
  const code = 'import os\nfrom pkg import core\nfrom .sub import helpers\nfrom tool.cli import main\nfrom .. import nothing';
  const got = resolveImports(extractImports(code, 'pkg/main.py'), 'pkg/main.py', files).sort();
  assert.deepEqual(got, ['pkg/__init__.py', 'pkg/core.py', 'pkg/sub/__init__.py', 'pkg/sub/helpers.py', 'src/tool/cli.py']);
});

test('suggests docs, manifest and entry points first', () => {
  const picks = suggestStartFiles(['README.md', 'package.json', 'src/index.ts', 'src/deep/a/b/main.ts', 'docs/x.md', 'logo.png', 'src/app.tsx']);
  assert.deepEqual(picks, ['README.md', 'package.json', 'src/app.tsx', 'src/index.ts']);
});

test('pack holds every file, marks them in the map, and survives inner fences', () => {
  const pack = buildPack({
    owner: 'o', repo: 'r', ref: 'main',
    files: [{ path: 'src/a.js', content: 'let a = 1;\n' }, { path: 'README.md', content: '```js\nx\n```', lines: { start: 1, end: 3 } }],
    treePaths: ['README.md', 'src/a.js', 'src/b.js', 'test/t.js']
  });
  assert.match(pack, /^# o\/r @ main: 2 files/);
  assert.match(pack, /a\.js {2}← included/);
  assert.match(pack, /## README\.md \(lines 1-3\)\n\n~~~~markdown/);
  assert.match(pack, /```javascript\n1│ let a = 1;\n```/);
  assert.ok(!outlineTree(['test/t.js', 'src/a.js'], ['src/a.js']).includes('t.js'), 'unrelated dirs stay collapsed');
});

test('every mode except "add" produces a prompt naming the target', () => {
  for (const m of READ_MODES) {
    const p = readingPrompt(m.id, { what: '`x.js`', repo: 'o/r' });
    if (m.id === 'add') assert.equal(p, '');
    else assert.ok(p.includes('`x.js`') && p.includes('o/r'), m.id);
  }
});

import { parseCommitsAtom, commitsFromApi, timeAgo } from '../src/utils/github.js';

test('parses the commits Atom feed', () => {
  const xml = `<?xml version="1.0"?><feed><entry>
    <id>tag:github.com,2008:Grit::Commit/0123456789abcdef0123456789abcdef01234567</id>
    <link type="text/html" rel="alternate" href="https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567"/>
    <title>
        Fix &quot;parser&quot; &amp; tests
    </title>
    <updated>2026-09-20T10:00:00Z</updated>
    <author><name>Ada</name><uri>https://github.com/ada</uri></author>
  </entry><entry><id>x</id><title>no sha</title></entry></feed>`;
  assert.deepEqual(parseCommitsAtom(xml), [{
    sha: '0123456789abcdef0123456789abcdef01234567', title: 'Fix "parser" & tests',
    url: 'https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567',
    author: 'Ada', date: '2026-09-20T10:00:00Z'
  }]);
});

test('normalises API commits and formats age', () => {
  const [c] = commitsFromApi([{ sha: 'abc1234', html_url: 'u', commit: { message: 'Add x\n\nbody', author: { name: 'B', date: '2026-01-01T00:00:00Z' } } }]);
  assert.deepEqual(c, { sha: 'abc1234', title: 'Add x', author: 'B', date: '2026-01-01T00:00:00Z', url: 'u' });
  const now = Date.parse('2026-01-03T00:00:00Z');
  assert.equal(timeAgo('2026-01-01T00:00:00Z', now), '2d ago');
  assert.equal(timeAgo('2026-01-02T23:30:00Z', now), '30m ago');
  assert.equal(timeAgo('nope', now), '');
});

import { isSecretPath } from '../src/utils/github.js';

test('local packs have no owner prefix; secrets are recognised', () => {
  assert.match(buildPack({ owner: '', repo: 'my-app', files: [{ path: 'a.py', content: 'x' }] }), /^# my-app: 1 file/);
  for (const p of ['.env', 'app/.env.local', 'certs/server.key', 'id_rsa', '.npmrc']) assert.ok(isSecretPath(p), p);
  for (const p of ['env.py', 'src/keys.ts', 'README.md', '.env.example.md']) assert.ok(!isSecretPath(p), p);
});

import { blobUrl, parseFileRef, fencedFile, CITE_RULE } from '../src/utils/github.js';

test('numbers each line from where the slice starts', () => {
  assert.equal(fencedFile({ path: 'a.py', content: 'x = 1\n\ny = 2\n' }), '```python\n1│ x = 1\n2│\n3│ y = 2\n```');
  const out = fencedFile({ path: 'a.js', content: 'a\nb\nc', lines: { start: 98, end: 100 } });
  assert.match(out, /^```javascript\n 98│ a\n 99│ b\n100│ c\n```$/);
});

test('blob URL highlights one line or a range', () => {
  assert.equal(blobUrl('o', 'r', 'HEAD', 'src/a b.js'), 'https://github.com/o/r/blob/HEAD/src/a%20b.js');
  assert.equal(blobUrl('o', 'r', 'feat/x', 'a.js', { start: 7, end: 7 }), 'https://github.com/o/r/blob/feat/x/a.js#L7');
  assert.equal(blobUrl('o', 'r', 'main', 'a.js', { start: 12, end: 30 }), 'https://github.com/o/r/blob/main/a.js#L12-L30');
});

test('reads file references in the forms answers use', () => {
  const files = new Set(['src/app.js', 'src/utils/net.js', 'lib/net.js', 'README.md', 'Makefile']);
  assert.deepEqual(parseFileRef('src/app.js', files), { path: 'src/app.js', lines: null });
  assert.deepEqual(parseFileRef('src/app.js:12-30', files), { path: 'src/app.js', lines: { start: 12, end: 30 } });
  assert.deepEqual(parseFileRef('./src/app.js:40', files), { path: 'src/app.js', lines: { start: 40, end: 40 } });
  assert.deepEqual(parseFileRef('src/app.js#L30-L12', files), { path: 'src/app.js', lines: { start: 12, end: 30 } });
  assert.deepEqual(parseFileRef('src/app.js (lines 5–9)', files), { path: 'src/app.js', lines: { start: 5, end: 9 } });
  assert.deepEqual(parseFileRef('app.js:3', files), { path: 'src/app.js', lines: { start: 3, end: 3 } });
  assert.deepEqual(parseFileRef('utils/net.js', files), { path: 'src/utils/net.js', lines: null });
  assert.deepEqual(parseFileRef('Makefile', files), { path: 'Makefile', lines: null });
});

test('ignores code that is not a file of the repo, and ambiguous names', () => {
  const files = new Set(['src/utils/net.js', 'lib/net.js', 'src/app.js']);
  assert.equal(parseFileRef('net.js', files), null, 'two files are called net.js');
  assert.equal(parseFileRef('app', files), null);
  assert.equal(parseFileRef('const x = 1', files), null);
  assert.equal(parseFileRef('other/app.js', files), null);
  assert.equal(parseFileRef('', files), null);
});

test('reading prompts ask for citations the panel can link', () => {
  assert.ok(readingPrompt('explain', { what: '`x.js`', repo: 'o/r' }).endsWith(CITE_RULE));
});
