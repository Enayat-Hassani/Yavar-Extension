// "Walk through a file": the AI splits a file into blocks of related lines,
// the panel shows them one at a time (and highlights each in your tab), and
// you can retype a block from memory to practise. Pure functions (tested).

import { jsonCandidates } from './rebuild.js';
import { keywordInfo } from './markdown.js';

// A gap the AI left between two blocks that is at most this many lines
// (usually blank lines) joins the block before it instead of becoming its own
const SMALL_GAP = 2;

// `range` is the { start, end } of the lines to walk (the whole file, or the
// lines selected on GitHub); `source` says where the code is in the message.
export function walkPrompt({ path, repo, range, source }) {
  const count = range.end - range.start + 1;
  const blocks = Math.min(15, Math.max(3, Math.round(count / 20)));
  const lines = `lines ${range.start}-${range.end}`;
  return `${source} \`${path}\`${repo ? ` from ${repo}` : ''} (${lines}). I'm reading it for the first time and want to go through it line by line.\n\n` +
    `Split ${lines} into about ${blocks} blocks of consecutive lines that belong together (the imports, one function, one step of the logic). ` +
    `Cover every line in order, without gaps or overlaps; blank lines and comments go with the code they belong to.\n\n` +
    `For each block, give a short title and 2 to 4 sentences for a beginner: what the block does, why it is there, ` +
    `and any unfamiliar term, explained simply. Use the line numbers shown in the code.\n\n` +
    `Reply with ONLY one JSON code block, exactly in this shape:\n` +
    '```json\n' +
    `{"summary": "one or two sentences on what the file does",\n` +
    ` "blocks": [{"start": ${range.start}, "end": ${Math.min(range.end, range.start + 9)}, "title": "short title", "explain": "what it does and why"}]}\n` +
    '```';
}

// Parse the AI's blocks, keep them inside `range`, sort them and remove
// overlaps. Lines the AI skipped become blocks with no explanation (small
// gaps join the previous block), so the walk still covers every line.
// Returns { summary, blocks: [{ start, end, title, explain }] } or null.
export function parseWalkthrough(text, range) {
  const str = v => (v == null ? '' : String(v)).trim();
  for (const obj of jsonCandidates(text)) {
    const raw = Array.isArray(obj) ? obj : obj?.blocks;
    if (!Array.isArray(raw)) continue;
    const parsed = raw
      .map(b => {
        let a = Math.round(Number(b?.start));
        let z = Math.round(Number(b?.end ?? b?.start));
        if (!Number.isFinite(a) || !Number.isFinite(z)) return null;
        if (a > z) [a, z] = [z, a];
        a = Math.max(a, range.start);
        z = Math.min(z, range.end);
        return a <= z ? { start: a, end: z, title: str(b.title || b.name), explain: str(b.explain || b.explanation) } : null;
      })
      .filter(Boolean)
      .sort((x, y) => x.start - y.start);

    const blocks = [];
    let covered = range.start - 1;   // last line already in a block
    for (const b of parsed) {
      if (b.end <= covered) continue;                       // inside an earlier block
      const start = Math.max(b.start, covered + 1);
      const gap = start - covered - 1;
      if (gap > 0 && gap <= SMALL_GAP && blocks.length) blocks[blocks.length - 1].end = start - 1;
      else if (gap > 0) blocks.push({ start: covered + 1, end: start - 1, title: '', explain: '' });
      blocks.push({ ...b, start });
      covered = b.end;
    }
    if (!blocks.length) continue;
    const tail = range.end - covered;
    if (tail > 0 && tail <= SMALL_GAP) blocks[blocks.length - 1].end = range.end;
    else if (tail > 0) blocks.push({ start: covered + 1, end: range.end, title: '', explain: '' });

    blocks.forEach(b => { if (!b.title) b.title = `Lines ${b.start}-${b.end}`; });
    return { summary: str(obj.summary), blocks };
  }
  return null;
}

// The code without its comments, and in Python its docstrings (a string
// alone on its lines), so practice asks for the code only. Strings are kept
// whole, so a # or // inside one stays. The comment syntax is the one the
// highlighter uses; markup and unknown languages are left as they are.
export function stripComments(code, lang) {
  const l = String(lang || '').toLowerCase();
  if (!l || /^(html|xml|vue|svelte|markdown|md|json)$/.test(l)) return String(code || '');
  const { fam, lineComment } = keywordInfo(l);
  const comment = lineComment === '#' ? '#[^\\n]*' : lineComment === '--' ? '--[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const triple = fam === 'py' ? `"{3}[\\s\\S]*?"{3}|'{3}[\\s\\S]*?'{3}` : '(?!)';
  const re = new RegExp(`(${comment})|(${triple})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)`, 'g');
  const blankLines = (t) => t.replace(/[^\n]/g, '');   // keeps the line count
  return String(code || '').replace(re, (tok, com, doc, str, at, all) => {
    if (com) return blankLines(com);
    if (!doc) return tok;
    const lineStart = all.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = all.indexOf('\n', at + tok.length);
    const alone = !all.slice(lineStart, at).trim() && !all.slice(at + tok.length, lineEnd < 0 ? undefined : lineEnd).trim();
    return alone ? blankLines(doc) : tok;
  });
}

// Compare code you typed from memory with the original, line by line,
// ignoring comments (for a known `lang`), indentation, spacing and blank lines.
// Returns { accuracy: 0-100, ops: [{ type: 'same' | 'missing' | 'extra', text }] }
// where 'missing' lines are in the original only and 'extra' in yours only.
export function compareTyped(original, typed, lang = '') {
  const norm = l => l.trim().replace(/\s+/g, ' ');
  const lines = s => stripComments(s, lang).split('\n').map(l => ({ text: l.trim(), key: norm(l) })).filter(l => l.key);
  const a = lines(original);
  const b = lines(typed);

  // Longest common subsequence of the normalised lines
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i].key === b[j].key ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) { ops.push({ type: 'same', text: a[i].text }); i++; j++; }
    else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) { ops.push({ type: 'extra', text: b[j].text }); j++; }
    else { ops.push({ type: 'missing', text: a[i].text }); i++; }
  }
  const total = Math.max(a.length, b.length);
  return { accuracy: total ? Math.round((100 * lcs[0][0]) / total) : 100, ops };
}

// Three questions on one block, with answers the panel keeps hidden until
// you ask for them
export function quizPrompt(where, block) {
  return `Quiz me on ${where}:\n\n${block}\n\n` +
    `Write 3 short questions, from what a line does to why it is written this way or what would break if it changed, ` +
    `each with a short answer. Reply with ONLY one JSON code block, exactly in this shape:\n` +
    '```json\n{"questions": [{"q": "the question", "a": "the answer"}]}\n```';
}

// [{ q, a }] from the AI's reply, or null
export function parseQuiz(text) {
  for (const obj of jsonCandidates(text)) {
    const raw = Array.isArray(obj) ? obj : obj?.questions;
    if (!Array.isArray(raw)) continue;
    const items = raw
      .map(x => ({ q: String(x?.q ?? x?.question ?? '').trim(), a: String(x?.a ?? x?.answer ?? '').trim() }))
      .filter(x => x.q && x.a);
    if (items.length) return items;
  }
  return null;
}
