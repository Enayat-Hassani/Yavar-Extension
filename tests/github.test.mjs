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
