// GitHub helpers for the Repo Reader: URL parsing, file filters, import
// resolution, reading order and "pack" building. Pure functions (no chrome.*,
// no fetch) so they can be unit-tested; network code lives in the side panel.

const RESERVED_OWNERS = new Set(['settings', 'notifications', 'orgs', 'features', 'marketplace',
  'explore', 'topics', 'sponsors', 'about', 'pricing', 'enterprise', 'login', 'join', 'search',
  'new', 'codespaces', 'apps', 'collections', 'events', 'trending', 'dashboard', 'pulls', 'issues']);

// Parse a github.com URL into what the reader needs.
//   kind: 'repo' | 'tree' | 'blob' | 'pull' | 'commit' | 'other'
//   rest: path segments after blob/ or tree/ (ref + path; the split between
//         them is ambiguous when a branch name has slashes, see refCandidates)
//   lines: { start, end } from a #L10-L25 fragment
export function parseGitHubUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'github.com') return null;
  const seg = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  if (seg.length < 2 || RESERVED_OWNERS.has(seg[0].toLowerCase())) return null;

  const [owner, rawRepo, section, ...rest] = seg;
  const repo = rawRepo.replace(/\.git$/, '');
  const out = { owner, repo, kind: 'repo', rest: [], lines: null };

  const lm = u.hash.match(/^#L(\d+)(?:C\d+)?(?:-L(\d+))?/);
  if (lm) {
    const a = Number(lm[1]);
    const b = Number(lm[2] || lm[1]);
    out.lines = { start: Math.min(a, b), end: Math.max(a, b) };
  }

  if ((section === 'blob' || section === 'tree') && rest.length) {
    out.kind = section;
    out.rest = rest;
  } else if (section === 'pull' && /^\d+$/.test(rest[0] || '')) {
    out.kind = 'pull';
    out.number = Number(rest[0]);
  } else if (section === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] || '')) {
    out.kind = 'commit';
    out.sha = rest[0];
  } else if (section) {
    out.kind = 'other';
  }
  return out;
}

// Possible { ref, path } splits of blob/tree segments, shortest ref first.
// "main/src/a.js" → main + src/a.js, then main/src + a.js, …
export function refCandidates(rest, maxRefParts = 4) {
  const out = [];
  for (let i = 1; i <= Math.min(maxRefParts, rest.length); i++) {
    out.push({ ref: rest.slice(0, i).join('/'), path: rest.slice(i).join('/') });
  }
  return out;
}

export function rawFileUrl(owner, repo, ref, path) {
  const enc = s => s.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${enc(ref)}/${enc(path)}`;
}

// Files that are useless (or harmful) to paste into a chat.
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'psd', 'svgz',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'ogg', 'flac', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz',
  '7z', 'rar', 'jar', 'war', 'class', 'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'wasm', 'pyc',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'db', 'sqlite', 'pkl', 'npy', 'npz', 'onnx', 'pt', 'h5',
  'ckpt', 'safetensors', 'parquet', 'xlsx', 'xls', 'docx', 'pptx', 'keystore', 'jks', 'p12']);
const NOISE_NAMES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
  'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'go.sum', 'uv.lock', 'bun.lockb', '.DS_Store']);
const NOISE_DIRS = ['node_modules/', 'vendor/', 'dist/', 'build/', '.git/', '__pycache__/', '.next/', 'coverage/'];

export function isBinaryPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return BINARY_EXT.has(ext);
}

// Readable = worth sending to the AI (text, not a lockfile/minified/vendored blob)
export function isReadablePath(path) {
  const name = path.split('/').pop();
  if (isBinaryPath(path) || NOISE_NAMES.has(name)) return false;
  if (/\.min\.(js|css)$|\.map$/i.test(name)) return false;
  const p = path + '/';
  return !NOISE_DIRS.some(d => p.startsWith(d) || p.includes('/' + d));
}

// Rough token estimate (~4 chars/token for code and English).
export function estimateTokens(chars) {
  return Math.ceil((chars || 0) / 4);
}

export function formatCount(n) {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
}

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace(/\.0$/, '') + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function langFromPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript',
    tsx: 'tsx', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', c: 'c',
    h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', dart: 'dart',
    sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', json: 'json', md: 'markdown',
    html: 'html', vue: 'vue', svelte: 'svelte', css: 'css', scss: 'scss', sql: 'sql', toml: 'toml',
    lua: 'lua', r: 'r', scala: 'scala', ex: 'elixir', exs: 'elixir', zig: 'zig'
  };
  return map[ext] || '';
}

// Pull the lines [start, end] (1-based, inclusive) out of a file.
export function sliceLines(content, start, end) {
  const lines = content.split('\n');
  const s = Math.max(1, start);
  const e = Math.min(lines.length, end);
  return lines.slice(s - 1, e).join('\n');
}

// ---- Imports ----

// Module specifiers a file imports (only the ones that could be repo files).
export function extractImports(content, path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const specs = new Set();
  const add = s => { if (s) specs.add(s.trim()); };

  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte'].includes(ext)) {
    for (const m of content.matchAll(/\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of content.matchAll(/\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of content.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]);
  } else if (ext === 'py') {
    for (const m of content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([\w, ()*]+)/gm)) {
      add(m[1]);
      // "from . import utils" / "from pkg import mod" may name submodules
      for (const name of m[2].replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+/)[0])) {
        if (name && name !== '*') add(m[1].endsWith('.') ? m[1] + name : m[1] + '.' + name);
      }
    }
    for (const m of content.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
      m[1].split(',').forEach(s => add(s.trim()));
    }
  } else if (['css', 'scss', 'less'].includes(ext)) {
    for (const m of content.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) add(m[1]);
  } else if (['c', 'h', 'cpp', 'cc', 'hpp'].includes(ext)) {
    for (const m of content.matchAll(/#include\s+"([^"]+)"/g)) add(m[1]);
  } else if (ext === 'rs') {
    for (const m of content.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm)) add('mod:' + m[1]);
  }
  return [...specs];
}

function joinPath(dir, rel) {
  const parts = dir ? dir.split('/') : [];
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && p !== '') parts.push(p);
  }
  return parts.join('/');
}

// Map import specifiers to files that exist in the repo tree.
export function resolveImports(specs, fromPath, fileSet) {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const ext = (fromPath.split('.').pop() || '').toLowerCase();
  const found = new Set();
  const tryPaths = (base, suffixes) => {
    for (const s of suffixes) {
      const p = base + s;
      if (fileSet.has(p)) { found.add(p); return true; }
    }
    return false;
  };
  const JS_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
    '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  for (const spec of specs) {
    if (ext === 'py') {
      // Relative: leading dots climb packages; absolute: try from root and src/
      const dots = spec.match(/^\.*/)[0].length;
      const mod = spec.slice(dots).replace(/\./g, '/');
      let bases;
      if (dots) {
        let base = dir;
        for (let i = 1; i < dots; i++) base = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
        bases = [joinPath(base, mod)];
      } else {
        bases = [mod, 'src/' + mod, joinPath(dir, mod)];
      }
      for (const b of bases) if (b && tryPaths(b, ['.py', '/__init__.py'])) break;
    } else if (spec.startsWith('mod:')) {
      const name = spec.slice(4);
      tryPaths(joinPath(dir, name), ['.rs', '/mod.rs']);
    } else if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? spec.slice(1) : joinPath(dir, spec);
      tryPaths(base, JS_SUFFIXES.concat(['.css', '.scss', '.h', '.hpp']));
    } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
      // Common alias for src/
      tryPaths('src/' + spec.slice(2), JS_SUFFIXES);
    } else if (['c', 'h', 'cpp', 'cc', 'hpp'].includes(ext)) {
      tryPaths(joinPath(dir, spec), ['']) || tryPaths(spec, ['']) || tryPaths('include/' + spec, ['']);
    }
  }
  found.delete(fromPath);
  return [...found];
}

// ---- Reading order ----

// A short "start here" list: docs, manifests, then likely entry points.
export function suggestStartFiles(paths, limit = 6) {
  const files = paths.filter(isReadablePath);
  const depth = p => p.split('/').length;
  const byName = (re, maxDepth = 1) => files.filter(p => depth(p) <= maxDepth && re.test(p.split('/').pop()));

  const picks = [];
  const push = list => list.forEach(p => { if (!picks.includes(p)) picks.push(p); });

  push(byName(/^readme(\.\w+)?$/i).slice(0, 1));
  push(byName(/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|composer\.json|gemfile|requirements\.txt|setup\.py|manifest\.json)$/i).slice(0, 1));
  push(byName(/^(architecture|contributing|design)\.md$/i, 2).slice(0, 1));

  const entryRe = /^(main|index|app|server|cli|__main__|lib|mod|program|manage|background)\.(py|js|ts|tsx|jsx|go|rs|java|kt|rb|php|cs|swift|dart|mjs)$/i;
  const entries = files
    .filter(p => entryRe.test(p.split('/').pop()) && depth(p) <= 3)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  push(entries.slice(0, 3));

  return picks.slice(0, limit);
}

// ---- Prompts & packing ----

export const READ_MODES = [
  { id: 'explain', label: 'Explain', hint: 'What it does and how it works' },
  { id: 'lines',   label: 'Line by line', hint: 'Walk through the code slowly' },
  { id: 'fit',     label: 'How it fits', hint: 'Its role in the whole repo' },
  { id: 'review',  label: 'Review', hint: 'Bugs, risks, improvements' },
  { id: 'quiz',    label: 'Quiz me', hint: 'Test your understanding' },
  { id: 'add',     label: 'Just add', hint: 'Attach without a question' }
];

export function readingPrompt(mode, { what, repo }) {
  const where = repo ? ` from the ${repo} repository` : '';
  switch (mode) {
    case 'explain':
      return `I'm learning from ${what}${where}. Explain it for someone reading this codebase for the first time:\n` +
        `1. A 2-3 sentence summary of its purpose.\n2. The key parts (functions, classes, data flow) and how they work together, citing names and line numbers.\n` +
        `3. Any patterns or techniques worth learning, and unfamiliar terms defined simply.\n4. End with 2 short questions that check my understanding.`;
    case 'lines':
      return `Walk me through ${what}${where} step by step, in order. Group lines into small blocks, quote each block briefly, and explain what it does and why. Point out anything clever, surprising, or error-prone.`;
    case 'fit':
      return `Explain how ${what}${where} fits into the rest of the project: what calls it, what it depends on, and where data comes from and goes. Use the repository map to name the related files, and suggest which file I should read next and why.`;
    case 'review':
      return `Review ${what}${where} like a senior engineer mentoring a junior: likely bugs, edge cases, security or performance risks, and readability issues. For each, cite the line, explain the problem, and show a small fix. Also note what is done well.`;
    case 'quiz':
      return `Quiz me on ${what}${where}. Ask 5 questions, one at a time, from basic (what does X do) to deeper (why was it designed this way, what breaks if Y changes). Wait for my answer before giving feedback and the next question.`;
    default:
      return '';
  }
}

// Compact tree outline for the pack header: every directory that contains a
// selected file is expanded one level; everything else is summarised.
export function outlineTree(paths, selected, maxLines = 120) {
  const keepDirs = new Set(['']);
  for (const s of selected) {
    const parts = s.split('/');
    for (let i = 1; i < parts.length; i++) keepDirs.add(parts.slice(0, i).join('/'));
  }
  const lines = [];
  const children = new Map();
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      const self = parts.slice(0, i + 1).join('/');
      if (!children.has(parent)) children.set(parent, new Map());
      children.get(parent).set(self, i < parts.length - 1);
    }
  }
  const selectedSet = new Set(selected);
  const walk = (dir, depth) => {
    const kids = [...(children.get(dir) || new Map())].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    for (const [path, isDir] of kids) {
      if (lines.length >= maxLines) return;
      const name = path.split('/').pop();
      const mark = selectedSet.has(path) ? '  ← included' : '';
      lines.push('  '.repeat(depth) + (isDir ? name + '/' : name) + mark);
      if (isDir && keepDirs.has(path)) walk(path, depth + 1);
    }
  };
  walk('', 0);
  if (lines.length >= maxLines) lines.push('  …');
  return lines.join('\n');
}

// One Markdown document holding several files, so a single chat message (and
// a single attachment) carries them all.
export function buildPack({ owner, repo, ref, files, treePaths = [] }) {
  const name = owner ? `${owner}/${repo}` : repo;   // local folders have no owner
  const head = `# ${name}${ref ? ' @ ' + ref : ''}: ${files.length} file${files.length === 1 ? '' : 's'}\n`;
  const map = treePaths.length
    ? `\n## Repository map\n\n\`\`\`\n${outlineTree(treePaths, files.map(f => f.path))}\n\`\`\`\n`
    : '';
  const body = files.map(f => {
    const range = f.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : '';
    const fence = f.content.includes('```') ? '~~~~' : '```';
    return `\n## ${f.path}${range}\n\n${fence}${langFromPath(f.path)}\n${f.content.replace(/\n$/, '')}\n${fence}\n`;
  }).join('');
  return head + map + body;
}

// ---- Recent changes & READMEs ----

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

// Parse github.com/<o>/<r>/commits/<ref>.atom (no API quota) into
// [{ sha, title, author, date, url }].
export function parseCommitsAtom(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const pick = re => (e.match(re) || [])[1] || '';
    const url = decodeXml(pick(/<link[^>]*href="([^"]+)"/));
    const sha = (pick(/Commit\/([0-9a-f]{7,40})/) || (url.match(/\/commit\/([0-9a-f]{7,40})/) || [])[1] || '');
    const title = decodeXml(pick(/<title[^>]*>([\s\S]*?)<\/title>/)).trim().split('\n')[0].trim();
    if (!sha || !title) continue;
    out.push({
      sha, title, url,
      author: decodeXml(pick(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)).trim(),
      date: pick(/<updated>([^<]+)<\/updated>/).trim()
    });
  }
  return out;
}

// Same shape from the REST API's /commits response.
export function commitsFromApi(list) {
  return (Array.isArray(list) ? list : []).map(c => ({
    sha: c.sha,
    title: String(c.commit?.message || '').split('\n')[0],
    author: c.commit?.author?.name || c.author?.login || '',
    date: c.commit?.author?.date || '',
    url: c.html_url || ''
  })).filter(c => c.sha && c.title);
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, n] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

// The README directly inside a folder ('' = repo root), if any.
export function folderReadme(dir, fileSet) {
  const prefix = dir ? dir + '/' : '';
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'README.txt', 'README']) {
    if (fileSet.has(prefix + name)) return prefix + name;
  }
  return null;
}

// First meaningful paragraph(s) of a README as plain text, for a preview.
export function readmeSnippet(md, max = 280) {
  const text = String(md || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(#|!\[|\[!\[|[-=]{3,}|\|)/.test(l))   // headings, badges, rules, tables
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)) + '…';
}

// Directories not worth walking in a local folder (huge, generated, or private)
export const LOCAL_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage', '__pycache__', '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.pytest_cache', '.idea', '.vscode', 'target', 'vendor', '.gradle', 'Pods', '.terraform']);

// Files that may hold secrets: never list them from a local folder
export function isSecretPath(path) {
  const name = path.split('/').pop().toLowerCase();
  return /^\.env(\.(?!example|sample|template|dist)[\w.-]+)?$/.test(name) || /\.(pem|key|p12|pfx|keystore|jks)$/.test(name) ||
    /^(id_rsa|id_ed25519|id_ecdsa|credentials|\.npmrc|\.pypirc|\.netrc)$/.test(name);
}
