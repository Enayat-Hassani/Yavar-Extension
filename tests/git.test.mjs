import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, openAsBlob, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { gitRepo, workingDiff, commitDiff, ignoreRules, fileDiff, lineEdits, blobSha } from '../src/utils/git.js';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const put = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };

// The same interfaces the panel builds over a folder handle
const gitOf = (dir) => ({
  file: async (p) => (existsSync(join(dir, '.git', p)) ? openAsBlob(join(dir, '.git', p)) : null),
  list: async (p) => (existsSync(join(dir, '.git', p)) ? readdirSync(join(dir, '.git', p)) : [])
});
const workOf = (dir, skip = new Set(['.git'])) => ({
  paths: async () => {
    const out = [];
    const walk = (rel) => {
      for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p); else out.push(p);
      }
    };
    walk('');
    return out;
  },
  file: async (p) => (existsSync(join(dir, p)) ? openAsBlob(join(dir, p)) : null)
});

const lines = (n, tag) => Array.from({ length: n }, (_, k) => `line ${k + 1} ${tag}`).join('\n') + '\n';

function makeRepo({ pack }) {
  const dir = mkdtempSync(join(tmpdir(), 'yavar-git-'));
  run(dir, 'init', '-q', '-b', 'main');
  put(dir, 'src/app.js', lines(60, 'a'));
  put(dir, 'src/gone.js', 'bye\n');
  put(dir, 'build/tool.sh', 'echo tracked in a folder the scan skips\n');
  put(dir, '.env', 'SECRET=1\n');
  put(dir, '.gitignore', '*.log\n/tmp/\n');
  put(dir, 'logo.bin', 'a\0b');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-q', '-m', 'one');
  // More versions, so a packed repo holds deltas
  for (let v = 0; v < 3; v++) {
    put(dir, 'src/app.js', lines(60, 'a').replace('line 30 a', `line 30 v${v}`));
    run(dir, 'commit', '-q', '-am', `v${v}`);
  }
  if (pack) run(dir, 'gc', '-q', '--aggressive');
  // Work not committed yet
  put(dir, 'src/app.js', lines(60, 'a').replace('line 5 a', 'line 5 changed').replace('line 50 a\n', '') + 'line 61 new\n');
  rmSync(join(dir, 'src/gone.js'));
  put(dir, 'src/new.js', 'export const n = 1;\n');
  put(dir, 'debug.log', 'ignored\n');
  put(dir, 'tmp/scratch.js', 'ignored too\n');
  put(dir, '.env', 'SECRET=2\n');
  put(dir, 'logo.bin', 'a\0c');
  return dir;
}

for (const pack of [false, true]) {
  test(`the working diff applies to the commit and gives the files on disk (${pack ? 'packed' : 'loose'} objects)`, async () => {
    const dir = makeRepo({ pack });
    if (pack) assert.equal(readdirSync(join(dir, '.git/objects/pack')).filter(n => n.endsWith('.pack')).length, 1);
    const repo = gitRepo(gitOf(dir));
    const { branch, sha } = await repo.state();
    assert.equal(branch, 'main');
    assert.equal(sha, run(dir, 'rev-parse', 'HEAD').trim());

    const isIgnored = ignoreRules([{ dir: '', text: readFileSync(join(dir, '.gitignore'), 'utf8') }]);
    const { diff, files } = await workingDiff(repo, sha, workOf(dir, new Set(['.git', 'build'])),
      { isIgnored, isPrivate: (p) => p === '.env' });
    assert.equal(files, 4);   // app.js, gone.js, new.js, logo.bin
    assert.doesNotMatch(diff, /SECRET|debug\.log|scratch|tool\.sh/);
    assert.match(diff, /Binary files a\/logo\.bin/);

    // A clean copy at the commit, with the diff applied, matches what's on disk
    const copy = mkdtempSync(join(tmpdir(), 'yavar-git-copy-'));
    run(copy, 'clone', '-q', dir, '.');
    writeFileSync(join(copy, 'p.diff'), diff.replace(/diff --git a\/logo\.bin[^]*?differ\n/, ''));
    run(copy, 'apply', 'p.diff');
    for (const p of ['src/app.js', 'src/new.js']) assert.equal(readFileSync(join(copy, p), 'utf8'), readFileSync(join(dir, p), 'utf8'), p);
    assert.equal(existsSync(join(copy, 'src/gone.js')), false);
    rmSync(dir, { recursive: true });
    rmSync(copy, { recursive: true });
  });
}

test('the upstream is the branch the config says it pushes to', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'yavar-git-remote-'));
  run(remote, 'init', '-q', '--bare', '-b', 'main');
  const dir = makeRepo({ pack: false });
  run(dir, 'remote', 'add', 'origin', remote);
  run(dir, 'push', '-q', '-u', 'origin', 'main');
  const pushed = run(dir, 'rev-parse', 'HEAD').trim();
  run(dir, 'commit', '-q', '-am', 'local only');
  run(dir, 'pack-refs', '--all');   // refs from packed-refs as well as loose files
  const { sha, upstream } = await gitRepo(gitOf(dir)).state();
  assert.notEqual(sha, pushed);
  assert.deepEqual(upstream, { name: 'origin/main', sha: pushed });
  rmSync(dir, { recursive: true });
  rmSync(remote, { recursive: true });
});

test('blobSha is the sha git gives the content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yavar-git-sha-'));
  writeFileSync(join(dir, 'f'), 'hello\n');
  assert.equal(await blobSha(new TextEncoder().encode('hello\n')), execFileSync('git', ['hash-object', join(dir, 'f')], { encoding: 'utf8' }).trim());
  rmSync(dir, { recursive: true });
});

test('ignore rules: globs, folders, anchoring, nesting and negation', () => {
  const ignored = ignoreRules([
    { dir: '', text: '*.log\n!keep.log\n/dist\nbuild/\ndocs/**/draft.md\n' },
    { dir: 'pkg', text: 'local.js\n' }
  ]);
  const check = (p) => [p, ignored(p)];
  assert.deepEqual(['a.log', 'x/b.log', 'keep.log', 'dist/a.js', 'src/dist/a.js', 'build/a', 'x/build/a',
    'docs/a/b/draft.md', 'docs/draft.md', 'pkg/local.js', 'local.js', 'src/app.js'].map(check), [
    ['a.log', true], ['x/b.log', true], ['keep.log', false], ['dist/a.js', true], ['src/dist/a.js', false],
    ['build/a', true], ['x/build/a', true], ['docs/a/b/draft.md', true], ['docs/draft.md', true],
    ['pkg/local.js', true], ['local.js', false], ['src/app.js', false]
  ]);
});

test('lineEdits finds the shortest edit', () => {
  assert.deepEqual(lineEdits(['a', 'b', 'c'], ['a', 'x', 'c', 'd']), [' ', '-', '+', ' ', '+']);
  assert.deepEqual(lineEdits([], ['a']), ['+']);
  assert.deepEqual(lineEdits(['a'], []), ['-']);
});

test('far-apart changes are separate hunks; close ones share one', () => {
  const before = lines(40, 'a');
  const far = fileDiff('f.js', before, before.replace('line 2 a', 'line 2 b').replace('line 30 a', 'line 30 b'));
  assert.equal((far.match(/^@@/gm) || []).length, 2);
  const near = fileDiff('f.js', before, before.replace('line 2 a', 'line 2 b').replace('line 8 a', 'line 8 b'));
  assert.equal((near.match(/^@@/gm) || []).length, 1);
  assert.equal(fileDiff('f.js', before, before), '');
});

test('a hunk is named after the declaration above it, as git does', () => {
  const before = 'import x from "y";\n\nexport function total(items) {\n  let sum = 0;\n  a();\n  b();\n  c();\n  return sum;\n}\n';
  const diff = fileDiff('f.js', before, before.replace('  return sum;', '  return sum * 2;'));
  assert.match(diff, /^@@ -5,5 \+5,5 @@ export function total\(items\) \{$/m);
  // At the top there is nothing above to name it after
  assert.match(fileDiff('f.js', before, 'import z from "y";' + before.slice(18)), /^@@ -1,\d+ \+1,\d+ @@$/m);
});

test('a hunk is named after the declaration above its first change, not an import above the hunk', () => {
  const before = "import { x } from './x.js';\n\nexport function total(items) {\n  let sum = 0;\n  return sum;\n}\n";
  const diff = fileDiff('f.js', before, before.replace('  return sum;', '  return sum * 2;'));
  assert.match(diff, /^@@ -2,5 \+2,5 @@ export function total\(items\) \{$/m);
});

for (const pack of [false, true]) {
  test(`recent commits follow the branch's own line, as git log does (${pack ? 'packed' : 'loose'} objects)`, async () => {
    const dir = makeRepo({ pack });
    run(dir, 'stash', '-q', '-u');
    run(dir, 'checkout', '-q', '-b', 'side', 'HEAD~2');
    put(dir, 'side.txt', 'side\n');
    run(dir, 'add', 'side.txt');
    run(dir, 'commit', '-q', '-m', 'on the side');
    run(dir, 'checkout', '-q', 'main');
    run(dir, 'merge', '-q', '--no-ff', 'side', '-m', 'Merge side\n\nWith a body');
    const repo = gitRepo(gitOf(dir));
    const log = await repo.log((await repo.state()).sha, 4);
    const want = run(dir, 'log', '--first-parent', '-n', '4', '--format=%H|%an|%at|%s').trim().split('\n')
      .map(l => { const [sha, author, at, title] = l.split('|'); return { sha, author, date: new Date(at * 1000).toISOString(), title }; });
    assert.deepEqual(log.map(({ sha, author, date, title }) => ({ sha, author, date, title })), want);
    assert.equal(log[0].title, 'Merge side');
    assert.equal(log[0].parents.length, 2);
    rmSync(dir, { recursive: true });
  });
}

test('a commit\'s diff turns its parent into it: added, changed and deleted files, private ones left out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yavar-git-'));
  run(dir, 'init', '-q', '-b', 'main');
  put(dir, 'a.js', lines(40, 'a'));
  put(dir, 'gone.js', 'bye\n');
  put(dir, '.env', 'SECRET=1\n');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-q', '-m', 'one');
  put(dir, 'a.js', lines(40, 'a').replace('line 3 a', 'line 3 b').replace('line 30 a\n', ''));
  rmSync(join(dir, 'gone.js'));
  put(dir, 'dir/new.js', 'export const n = 1;\n');
  put(dir, '.env', 'SECRET=2\n');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-q', '-m', 'two');
  const repo = gitRepo(gitOf(dir));
  const [two, one] = await repo.log((await repo.state()).sha, 5);
  assert.equal(one.parents.length, 0);
  const diff = await commitDiff(repo, one.sha, two.sha, { isPrivate: (p) => p === '.env' });
  assert.doesNotMatch(diff, /SECRET/);
  const copy = mkdtempSync(join(tmpdir(), 'yavar-git-copy-'));
  run(copy, 'clone', '-q', dir, '.');
  run(copy, 'checkout', '-q', one.sha);
  writeFileSync(join(copy, '..', `${one.sha}.diff`), diff);
  run(copy, 'apply', join(copy, '..', `${one.sha}.diff`));
  for (const p of ['a.js', 'dir/new.js']) assert.equal(readFileSync(join(copy, p), 'utf8'), readFileSync(join(dir, p), 'utf8'), p);
  assert.equal(existsSync(join(copy, 'gone.js')), false);
  // The first commit: everything it added
  assert.match(await commitDiff(repo, null, one.sha), /new file mode[^]*\+line 1 a/);
  rmSync(dir, { recursive: true });
  rmSync(copy, { recursive: true });
});
