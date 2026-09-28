// Walking through a change (a commit, a pull request, or your own changes)
// the way a file is walked: the diff is split here into parts (a hunk, or a
// slice of a big one) and put in reading order, the chat explains them line
// by line, a few small parts to a message, and the reader shows each part as
// a diff inside the file as it is after the change. Pure functions (tested).

import { intentText } from './intents.js';

// What Line by line adds for a change, whatever the intent's wording
const CHANGED = 'For a changed line, say what it did before and what it does now, and why. Put changes that are only formatting or renaming into one item, and skip unchanged lines.';

// A unified diff (git's) as files with their hunks. Each hunk line is
// { type: '+' | '-' | ' ', text, old?, new? } with its line numbers.
// Returns [{ path, oldPath, status, binary, hunks: [{ oldStart, newStart, context, lines }] }].
export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      f = { path: m ? m[2] : '', oldPath: m ? m[1] : '', status: 'modified', binary: false, hunks: [] };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (hm) {
      h = { oldStart: +hm[1], newStart: +hm[3], context: hm[5].trim(), lines: [], oldLeft: hm[2] == null ? 1 : +hm[2], newLeft: hm[4] == null ? 1 : +hm[4] };
      f.hunks.push(h);
      oldNo = h.oldStart;
      newNo = h.newStart;
      continue;
    }
    if (!h) {
      if (line.startsWith('new file mode')) f.status = 'added';
      else if (line.startsWith('deleted file mode')) f.status = 'deleted';
      else if (line.startsWith('rename from ')) { f.status = 'renamed'; f.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('Binary files ')) f.binary = true;
      continue;
    }
    // A blank line inside a hunk is a blank context line whose space was trimmed
    const c = line === '' && h.oldLeft > 0 && h.newLeft > 0 ? ' ' : line[0];
    if (c === '+' && h.newLeft > 0) { h.lines.push({ type: '+', text: line.slice(1), new: newNo++ }); h.newLeft--; }
    else if (c === '-' && h.oldLeft > 0) { h.lines.push({ type: '-', text: line.slice(1), old: oldNo++ }); h.oldLeft--; }
    else if (c === ' ' && h.oldLeft > 0 && h.newLeft > 0) {
      h.lines.push({ type: ' ', text: line.slice(1), old: oldNo++, new: newNo++ });
      h.oldLeft--;
      h.newLeft--;
    }
  }
  files.forEach(file => file.hunks.forEach(x => { delete x.oldLeft; delete x.newLeft; }));
  return files;
}

// Files that say little about what the change does: lockfiles, generated
// and vendored code, snapshots, binaries, and renames without edits
const NOISE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(dist|build|vendor|node_modules|__snapshots__)\//;
const isNoise = (file) => file.binary || !file.hunks.length || NOISE.test(file.path);

const DIFF_CHARS = 8000;   // per part, kept with the walkthrough for follow-up questions
const PART_CHANGES = 20;   // changed lines in a part before a big hunk is split

// A big hunk as slices of about PART_CHANGES changed lines, cut at unchanged
// lines, so no part is too long to explain line by line. A slice never holds
// only unchanged lines.
function splitHunk(h) {
  let lastChange = -1;
  h.lines.forEach((l, k) => { if (l.type !== ' ') lastChange = k; });
  const out = [];
  let cur = [];
  let changed = 0;
  h.lines.forEach((l, k) => {
    if (l.type === ' ' && changed >= PART_CHANGES && k < lastChange) { out.push(cur); cur = []; changed = 0; }
    cur.push(l);
    if (l.type !== ' ') changed++;
  });
  if (cur.length) out.push(cur);
  return out.map((lines, k) => k === 0 ? { ...h, lines }
    : { oldStart: lines[0].old, newStart: lines[0].new, context: h.context, lines });
}

// A hunk's lines numbered, so answers can name them: the number after the
// change, and on a removed line its number before the change
const numbered = (l) => `${l.type}${String(l.type === '-' ? l.old : l.new).padStart(4)} | ${l.text}`;
export const NUMBERS_NOTE = 'Each diff line shows its line number after the change; a removed (-) line shows its number before the change.';

// The parts to read: one per hunk (a big hunk in slices), in diff order.
// Over `max`, the file with the most parts has them joined into one, until
// it fits. Returns { blocks, skipped }: skipped names the files left out as
// noise or over the cap. A part is { id, path, oldPath, status, start, end,
// added, removed, removedText, diff, add, del }: start-end are the new lines
// it spans (null for a deleted file), `add` the added lines' numbers and
// `del` the removed lines as [line they now sit above, old number, text],
// which the reader draws inside the file.
export function changeBlocks(files, { max = 40 } = {}) {
  const skipped = files.filter(isNoise).map(f => f.path);
  const groups = files.filter(f => !isNoise(f)).map(f => ({ f, parts: f.hunks.flatMap(x => splitHunk(x).map(y => [y])) }));
  const count = () => groups.reduce((n, g) => n + g.parts.length, 0);
  while (count() > max) {
    const g = groups.reduce((a, b) => (b.parts.length > a.parts.length ? b : a));
    if (g.parts.length === 1) break;
    g.parts = [g.parts.flat()];
  }
  const blocks = [];
  for (const { f, parts } of groups) {
    for (const hunks of parts) {
      if (blocks.length >= max) { skipped.push(f.path); break; }
      const lines = hunks.flatMap(x => x.lines);
      const added = lines.filter(l => l.type === '+');
      const removed = lines.filter(l => l.type === '-');
      // A removed line sits above the next line still in the file, or below
      // the last one; a hunk that only removes sits below its newStart
      const del = hunks.flatMap(x => x.lines.flatMap((l, k) => {
        if (l.type !== '-') return [];
        const next = x.lines.slice(k).find(y => y.new != null);
        const prev = x.lines.slice(0, k).reverse().find(y => y.new != null);
        return [[next ? next.new : prev ? prev.new + 1 : x.newStart + 1, l.old, l.text]];
      }));
      // The new lines it spans: added lines, and for removed ones the line
      // now where they were (the next line in the new file, else the last)
      let start = null;
      let end = null;
      if (f.status !== 'deleted') {
        const at = [];
        lines.forEach((l, k) => {
          if (l.type === '+') at.push(l.new);
          else if (l.type === '-') {
            const near = lines.slice(k).find(x => x.new != null) || lines.slice(0, k).reverse().find(x => x.new != null);
            at.push(near ? near.new : hunks[0].newStart);
          }
        });
        start = Math.max(1, Math.min(...at));
        end = Math.max(start, ...at);
      }
      const diff = hunks.map(x => `@@ -${x.oldStart} +${x.newStart} @@${x.context ? ' ' + x.context : ''}\n` +
        x.lines.map(numbered).join('\n')).join('\n');
      blocks.push({
        id: blocks.length + 1, path: f.path, oldPath: f.oldPath, status: f.status, start, end,
        added: added.length, removed: removed.length, removedText: removed.map(l => l.text).join('\n'),
        diff: diff.length > DIFF_CHARS ? diff.slice(0, DIFF_CHARS) + '\n… (cut)' : diff,
        add: f.status === 'deleted' ? [] : added.map(l => l.new), del: f.status === 'deleted' ? [] : del,
        context: hunks[0].context || ''
      });
    }
  }
  return { blocks, skipped: [...new Set(skipped)] };
}

const where = (b) => `\`${b.path}\` (${b.status}${b.status === 'renamed' ? ` from \`${b.oldPath}\`` : ''})` +
  (b.start ? `, lines ${b.start}${b.end > b.start ? `-${b.end}` : ''} after the change` : '');

// The part's name in lists: the function or class it is in, as git shows
// it above the hunk, else what happened to the file, else the file's name
export function partTitle(b) {
  const ctx = (b.context || '').trim()
    .replace(/^(export\s+)?(default\s+)?(async\s+)?(def|function|fn|func)\s+/, '')
    .replace(/\s*[{:]\s*$/, '');
  if (ctx) return ctx.length > 48 ? ctx.slice(0, 47) + '…' : ctx;
  return b.status === 'added' ? 'New file' : b.status === 'deleted' ? 'Deleted file' : b.path.split('/').pop();
}

// Reading order: the code first, then its tests, then config and build
// files, then docs; diff order within each
const TESTS = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.[a-z]+$/i;
const DOCS = /\.(md|mdx|rst|txt|adoc)$|(^|\/)docs?\//i;
const CONFIG = /\.(json|ya?ml|toml|ini|cfg|lock|env\.example)$|(^|\/)\.github\/|(^|\/)(Dockerfile|Makefile|\.[\w-]+rc)$/i;
const rank = (p) => (DOCS.test(p) ? 3 : CONFIG.test(p) ? 2 : TESTS.test(p) ? 1 : 0);
export function orderParts(blocks) {
  return blocks.map((b, k) => [b, k]).sort((x, y) => rank(x[0].path) - rank(y[0].path) || x[1] - y[1]).map(([b]) => b);
}

// The parts one line-by-line message covers, from part `i`: the next small
// ones too, while they add up to at most `maxLines` changed lines. Parts
// that `done(k)` already explained end the run.
export function linesBatch(blocks, i, done = () => false, { maxLines = 30, maxParts = 4 } = {}) {
  const out = [i];
  let total = blocks[i].added + blocks[i].removed;
  for (let k = i + 1; k < blocks.length && out.length < maxParts && !done(k); k++) {
    const n = blocks[k].added + blocks[k].removed;
    if (total + n > maxLines) break;
    out.push(k);
    total += n;
  }
  return out;
}

// The parts as one Markdown file for the chat, numbered as the walk shows them
export function changePack(blocks, what) {
  return `# The changes in ${what}\n\n${NUMBERS_NOTE}\n\n` +
    blocks.map((b, k) => `## Part ${k + 1} · ${where(b)}\n\n\`\`\`diff\n${b.diff}\n\`\`\``).join('\n\n') + '\n';
}

// Line by line, for the parts `nums` (1-based) of the walk. The first
// message also carries the whole diff and opens with what the change does.
export function linesPrompt({ blocks, nums, what, repo, title = '', fname = '', skipped = [], edits = {}, brief = '' }) {
  const head = fname
    ? `The attached "${fname}" is the whole diff of ${what} in ${repo}${title ? ` ("${title}")` : ''}, in ${blocks.length} numbered parts` +
      `${skipped.length ? ` (left out: ${skipped.length} lockfile, generated or binary file${skipped.length === 1 ? '' : 's'})` : ''}. ` +
      `I'm reading it part by part. Begin with two or three sentences on what the change does as a whole and why. Then go through the parts below.`
    : `I'm reading ${what} in ${repo}${title ? ` ("${title}")` : ''} part by part. Go through the parts below.`;
  return `${brief ? `${brief}\n\n` : ''}${head}\n\n` +
    `Put each part under a heading "### Part N". Under it: ${intentText(edits, 'lines')} ${CHANGED} ${NUMBERS_NOTE}\n\n` +
    nums.map(n => `### Part ${n} · ${where(blocks[n - 1])}\n\n\`\`\`diff\n${blocks[n - 1].diff}\n\`\`\``).join('\n\n');
}

// A line-by-line reply cut at its "### Part N" headings: { intro, parts }
// where parts maps each asked number to its text. Without headings, the
// whole reply belongs to the first part asked.
export function splitParts(text, nums) {
  const heads = [...String(text || '').matchAll(/^#{1,4}\s*\**\s*Part\s+(\d+)\b[^\n]*$/gim)];
  const parts = new Map();
  if (!heads.length) {
    if (nums.length) parts.set(nums[0], String(text || '').trim());
    return { intro: '', parts };
  }
  heads.forEach((h, k) => {
    const n = Number(h[1]);
    const body = text.slice(h.index + h[0].length, heads[k + 1]?.index ?? text.length).trim();
    if (nums.includes(n) && body) parts.set(n, parts.has(n) ? `${parts.get(n)}\n\n${body}` : body);
  });
  return { intro: text.slice(0, heads[0].index).trim(), parts };
}

// What a part is, for a question about it: where it is and its diff
// (A walk saved before diffs were numbered has no numbers to explain.)
export function partContext(b) {
  const note = /^[+\- ] *\d+ \| /m.test(b.diff) ? ` ${NUMBERS_NOTE}` : '';
  return `Part of the change: ${where(b)}.${note}\n\n\`\`\`diff\n${b.diff}\n\`\`\``;
}

// The rows the reader shows for a part: the file's `count` lines after the
// change, with the removed lines put back where they were. A row is
// { n, kind: '' | 'add' } for a line of the file, or { n: null, old, text,
// kind: 'del' } for a removed one. Removed lines at the end go last.
export function diffRows(count, add = [], del = []) {
  const added = new Set(add);
  const above = new Map();
  for (const [at, old, text] of del) {
    const k = Math.min(at, count + 1);
    if (!above.has(k)) above.set(k, []);
    above.get(k).push({ n: null, old, text, kind: 'del' });
  }
  const rows = [];
  for (let n = 1; n <= count + 1; n++) {
    rows.push(...(above.get(n) || []));
    if (n <= count) rows.push({ n, kind: added.has(n) ? 'add' : '' });
  }
  return rows;
}
