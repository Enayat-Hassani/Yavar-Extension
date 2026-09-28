// Reading a local git repository without git: a Chrome extension can't run
// programs, so the changes you haven't committed or pushed are found by
// reading .git directly. Objects are read loose or from pack files (deltas
// included), the base commit's files are compared with the files on disk by
// their git hashes, and the files that differ get a unified diff in git's
// format, which changes.js splits into parts like any commit.
//
// `git` is { file(path) -> Blob | null, list(dir) -> names } over the .git
// folder; `work` is { paths() -> [path], file(path) -> Blob | null } over the
// folder's files. Both are plain interfaces so tests can use real repos.

const dec = new TextDecoder();

async function inflate(stream, size = Infinity) {
  const reader = stream.pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let got = 0;
  try {
    while (got < size) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});   // a packed object is followed by the next one
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return size === Infinity ? out : out.subarray(0, size);
}

const hex = (bytes) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// The sha git gives a file's content
export async function blobSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', all)));
}

const TYPES = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

// Apply a git delta to its base
function applyDelta(base, delta) {
  let p = 0;
  const varint = () => { let n = 0; let s = 0; let b; do { b = delta[p++]; n |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return n; };
  varint();                         // the base's size
  const out = new Uint8Array(varint());
  let at = 0;
  while (p < delta.length) {
    const op = delta[p++];
    if (op & 0x80) {
      let off = 0;
      let len = 0;
      for (let i = 0; i < 4; i++) if (op & (1 << i)) off |= delta[p++] << (8 * i);
      for (let i = 0; i < 3; i++) if (op & (0x10 << i)) len |= delta[p++] << (8 * i);
      off >>>= 0;
      out.set(base.subarray(off, off + (len || 0x10000)), at);
      at += len || 0x10000;
    } else {
      out.set(delta.subarray(p, p + op), at);
      at += op;
      p += op;
    }
  }
  return out;
}

export function gitRepo(git) {
  let packs = null;
  const cache = new Map();

  // Each pack's index (version 2): its shas and where each object starts
  async function loadPacks() {
    if (packs) return packs;
    packs = [];
    for (const name of await git.list('objects/pack')) {
      if (!name.endsWith('.idx')) continue;
      const idx = new Uint8Array(await (await git.file(`objects/pack/${name}`)).arrayBuffer());
      const view = new DataView(idx.buffer);
      if (view.getUint32(0) !== 0xff744f63 || view.getUint32(4) !== 2) continue;
      const count = view.getUint32(8 + 255 * 4);
      packs.push({ pack: `objects/pack/${name.replace(/\.idx$/, '.pack')}`, idx, view, count,
        shas: 8 + 256 * 4, offsets: 8 + 256 * 4 + count * 24, large: 8 + 256 * 4 + count * 28 });
    }
    return packs;
  }

  function findIn(p, sha) {
    const want = sha.match(/../g).map(h => parseInt(h, 16));
    let lo = want[0] ? p.view.getUint32(8 + (want[0] - 1) * 4) : 0;
    let hi = p.view.getUint32(8 + want[0] * 4);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      let cmp = 0;
      for (let i = 0; i < 20 && !cmp; i++) cmp = p.idx[p.shas + mid * 20 + i] - want[i];
      if (!cmp) {
        const off = p.view.getUint32(p.offsets + mid * 4);
        return off & 0x80000000 ? Number(p.view.getBigUint64(p.large + (off & 0x7fffffff) * 8)) : off;
      }
      if (cmp < 0) lo = mid + 1; else hi = mid;
    }
    return -1;
  }

  async function readPacked(file, offset) {
    const head = new Uint8Array(await file.slice(offset, offset + 32).arrayBuffer());
    let p = 0;
    let b = head[p++];
    const type = (b >> 4) & 7;
    let size = b & 15;
    for (let s = 4; b & 0x80; s += 7) { b = head[p++]; size += (b & 0x7f) * 2 ** s; }
    if (type === 6) {                  // delta against an object earlier in this pack
      b = head[p++];
      let back = b & 0x7f;
      while (b & 0x80) { b = head[p++]; back = ((back + 1) * 128) + (b & 0x7f); }
      const base = await readPacked(file, offset - back);
      const delta = await inflate(file.slice(offset + p).stream(), size);
      return { type: base.type, data: applyDelta(base.data, delta) };
    }
    if (type === 7) {                  // delta against an object named by its sha
      const base = await read(hex(head.subarray(p, p + 20)));
      const delta = await inflate(file.slice(offset + p + 20).stream(), size);
      return { type: base.type, data: applyDelta(base.data, delta) };
    }
    return { type: TYPES[type], data: await inflate(file.slice(offset + p).stream(), size) };
  }

  // { type, data } for an object, or an error when it can't be found
  async function read(sha) {
    if (cache.has(sha)) return cache.get(sha);
    let obj = null;
    const loose = await git.file(`objects/${sha.slice(0, 2)}/${sha.slice(2)}`);
    if (loose) {
      const raw = await inflate(loose.stream());
      const nul = raw.indexOf(0);
      obj = { type: dec.decode(raw.subarray(0, nul)).split(' ')[0], data: raw.subarray(nul + 1) };
    } else {
      for (const p of await loadPacks()) {
        const at = findIn(p, sha);
        if (at >= 0) { obj = await readPacked(await git.file(p.pack), at); break; }
      }
    }
    if (!obj) throw new Error(`git object ${sha.slice(0, 7)} is missing`);
    if (obj.type !== 'blob') cache.set(sha, obj);
    return obj;
  }

  async function text(path) {
    const f = await git.file(path);
    return f ? (await f.text()).trim() : null;
  }

  // A ref's sha: a loose ref file, else a line of packed-refs
  async function resolve(ref) {
    const loose = await text(ref);
    if (loose) return loose.startsWith('ref: ') ? resolve(loose.slice(5)) : loose;
    const packed = (await text('packed-refs')) || '';
    const line = packed.split('\n').find(l => l.endsWith(' ' + ref));
    return line ? line.slice(0, 40) : null;
  }

  // Every file of a commit, path -> sha (submodules left out)
  async function commitFiles(sha) {
    const commit = dec.decode((await read(sha)).data);
    const files = new Map();
    const walk = async (treeSha, prefix) => {
      const data = (await read(treeSha)).data;
      for (let p = 0; p < data.length;) {
        const sp = data.indexOf(32, p);
        const nul = data.indexOf(0, sp);
        const mode = dec.decode(data.subarray(p, sp));
        const name = dec.decode(data.subarray(sp + 1, nul));
        const entry = hex(data.subarray(nul + 1, nul + 21));
        p = nul + 21;
        if (mode === '40000') await walk(entry, prefix + name + '/');
        else if (mode !== '160000') files.set(prefix + name, entry);
      }
    };
    await walk(/^tree ([0-9a-f]{40})/m.exec(commit)[1], '');
    return files;
  }

  // The branch checked out, HEAD's sha, and the remote branch it pushes to
  async function state() {
    const head = await text('HEAD');
    if (!head) throw new Error('this folder is not a git repository');
    const branch = head.startsWith('ref: refs/heads/') ? head.slice(16) : null;
    const sha = await resolve('HEAD');
    let upstream = null;
    if (branch) {
      const config = (await text('config')) || '';
      const section = new RegExp(`\\[branch "${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]([^[]*)`).exec(config)?.[1] || '';
      const remote = /^\s*remote\s*=\s*(\S+)/m.exec(section)?.[1] || 'origin';
      const merge = /^\s*merge\s*=\s*refs\/heads\/(\S+)/m.exec(section)?.[1] || branch;
      const ref = `refs/remotes/${remote}/${merge}`;
      const upSha = await resolve(ref);
      if (upSha) upstream = { name: `${remote}/${merge}`, sha: upSha };
    }
    return { branch, sha, upstream };
  }

  return { read, resolve, commitFiles, state };
}

// ---- Diffs ----

const splitLines = (t) => { const l = t.split('\n'); if (l.at(-1) === '') l.pop(); return l; };

// The shortest edit from a to b (Myers), as ' ', '-' and '+' steps. Past
// `limit` differences the whole file counts as replaced.
export function lineEdits(a, b, limit = 4000) {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, limit);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return [...a.map(() => '-'), ...b.map(() => '+')];
  const steps = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = pv[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { steps.push(' '); x--; y--; }
    if (prevK === k + 1) { steps.push('+'); y--; } else { steps.push('-'); x--; }
  }
  while (x > 0 && y > 0) { steps.push(' '); x--; y--; }
  return steps.reverse();
}

// One file's change as git would print it, 3 lines of context
export function fileDiff(path, before, after, status = 'modified') {
  const a = before == null ? [] : splitLines(before);
  const b = after == null ? [] : splitLines(after);
  const rows = [];
  let i = 0;
  let j = 0;
  for (const s of lineEdits(a, b)) {
    rows.push(s === '+' ? { s, text: b[j], o: i, n: ++j } : s === '-' ? { s, text: a[i], o: ++i, n: j } : { s, text: a[i], o: ++i, n: ++j });
  }
  const changed = rows.map((r, k) => (r.s !== ' ' ? k : -1)).filter(k => k >= 0);
  if (!changed.length) return '';
  const hunks = [];
  for (const k of changed) {
    const last = hunks.at(-1);
    if (last && k - last.end <= 6) last.end = k;
    else hunks.push({ start: k, end: k });
  }
  const head = `diff --git a/${path} b/${path}\n` +
    (status === 'added' ? 'new file mode 100644\n' : status === 'deleted' ? 'deleted file mode 100644\n' : '') +
    `--- ${status === 'added' ? '/dev/null' : `a/${path}`}\n+++ ${status === 'deleted' ? '/dev/null' : `b/${path}`}\n`;
  return head + hunks.map(({ start, end }) => {
    const part = rows.slice(Math.max(0, start - 3), Math.min(rows.length, end + 4));
    const olds = part.filter(r => r.s !== '+');
    const news = part.filter(r => r.s !== '-');
    // An empty side starts at the line before it, as git prints it
    const oStart = olds.length ? olds[0].o : part[0].o;
    const nStart = news.length ? news[0].n : part[0].n;
    // Like git, name the hunk after the nearest line above it that starts a
    // declaration (one that begins at the margin with a letter, _ or $)
    const above = a.slice(0, Math.max(0, oStart - 1)).reverse().find(l => /^[A-Za-z_$]/.test(l)) || '';
    return `@@ -${oStart},${olds.length} +${nStart},${news.length} @@${above ? ' ' + above.slice(0, 80) : ''}\n` +
      part.map(r => r.s + r.text).join('\n') + '\n';
  }).join('');
}

const MAX_FILE = 1024 * 1024;
const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);

// .gitignore patterns (the root file, .git/info/exclude, and nested ones),
// enough of git's rules for deciding whether a new file is worth reviewing.
// sources: [{ dir: '' | 'sub/dir', text }]. Later rules win, as in git.
const escapeRe = (t) => t.replace(/[.+^${}()|[\]\\]/g, '\\$&');
function globRe(glob) {
  let out = '';
  for (let k = 0; k < glob.length; k++) {
    if (glob.startsWith('**/', k)) { out += '(?:.*/)?'; k += 2; }
    else if (glob.startsWith('**', k)) { out += '.*'; k += 1; }
    else if (glob[k] === '*') out += '[^/]*';
    else if (glob[k] === '?') out += '[^/]';
    else out += escapeRe(glob[k]);
  }
  return out;
}

export function ignoreRules(sources) {
  const rules = [];
  for (const { dir, text } of sources) {
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      if (negate) line = line.slice(1);
      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.slice(0, -1);
      const anchored = line.includes('/');
      line = line.replace(/^\//, '');
      rules.push({ negate, re: new RegExp(`^${dir ? escapeRe(dir) + '/' : ''}${anchored ? '' : '(?:.*/)?'}${globRe(line)}${dirOnly ? '/' : '(?:/|$)'}`) });
    }
  }
  return (path) => {
    let ignored = false;
    for (const r of rules) if (r.re.test(path)) ignored = !r.negate;
    return ignored;
  };
}

// The diff between a commit and the files on disk: the files git tracks that
// changed or went missing, and new files .gitignore doesn't exclude. A
// private file (a key, an .env) is never read, tracked or not. Returns
// { diff, files } where files counts what changed.
export async function workingDiff(repo, baseSha, work, { isIgnored = () => false, isPrivate = () => false } = {}) {
  const base = await repo.commitFiles(baseSha);
  const onDisk = new Set(await work.paths());
  const out = [];
  let files = 0;
  const readText = async (blob) => {
    if (!blob || blob.size > MAX_FILE) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return isBinary(bytes) ? null : { bytes, text: dec.decode(bytes) };
  };
  for (const path of [...new Set([...base.keys(), ...onDisk])].sort()) {
    const sha = base.get(path);
    if (isPrivate(path) || (!sha && isIgnored(path))) continue;
    // A tracked file is looked up even where the folder scan doesn't go
    const blob = sha || onDisk.has(path) ? await work.file(path) : null;
    if (sha && blob) {
      if (blob.size > MAX_FILE) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (await blobSha(bytes) === sha) continue;
      files++;
      const before = (await repo.read(sha)).data;
      out.push(isBinary(bytes) || isBinary(before)
        ? `diff --git a/${path} b/${path}\nBinary files a/${path} and b/${path} differ\n`
        : fileDiff(path, dec.decode(before), dec.decode(bytes)));
    } else if (sha) {
      files++;
      const before = (await repo.read(sha)).data;
      out.push(isBinary(before) ? `diff --git a/${path} b/${path}\ndeleted file mode 100644\nBinary files a/${path} and /dev/null differ\n`
        : fileDiff(path, dec.decode(before), null, 'deleted'));
    } else {
      const now = await readText(blob);
      if (!now) continue;
      files++;
      out.push(fileDiff(path, null, now.text, 'added'));
    }
  }
  return { diff: out.join(''), files };
}
