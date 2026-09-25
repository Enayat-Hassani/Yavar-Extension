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
  assert.match(pack, /```javascript\nlet a = 1;\n```/);
  assert.ok(!outlineTree(['test/t.js', 'src/a.js'], ['src/a.js']).includes('t.js'), 'unrelated dirs stay collapsed');
});

test('every mode except "add" produces a prompt naming the target', () => {
  for (const m of READ_MODES) {
    const p = readingPrompt(m.id, { what: '`x.js`', repo: 'o/r' });
    if (m.id === 'add') assert.equal(p, '');
    else assert.ok(p.includes('`x.js`') && p.includes('o/r'), m.id);
  }
});

import { parseCommitsAtom, commitsFromApi, timeAgo, folderReadme, readmeSnippet } from '../src/utils/github.js';

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

test('finds folder READMEs and extracts a clean snippet', () => {
  const files = new Set(['README.md', 'src/lib/README.md', 'src/a.js']);
  assert.equal(folderReadme('', files), 'README.md');
  assert.equal(folderReadme('src/lib', files), 'src/lib/README.md');
  assert.equal(folderReadme('src', files), null);
  const md = '# Title\n[![ci](x)](y)\n<p align="center"><img src="x"></p>\n\nA **fast** [parser](http://x) for `toml`.\n\n```js\ncode\n```\n| a | b |';
  assert.equal(readmeSnippet(md), 'A fast parser for toml.');
  assert.ok(readmeSnippet('word '.repeat(100), 50).endsWith('…'));
});
