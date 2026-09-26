// "Read this repository": the big picture first (what it does, its parts, a
// reading order), then each file block by block, and after each file a
// suggestion for the next one. Pure functions (tested).

import { jsonCandidates } from './rebuild.js';
import { parseFileRef } from './github.js';

export function journeyPrompt(name, fname) {
  return `The attached "${fname}" has the README and core files of ${name}, starting with a map of the repository. ` +
    `I'm new to this codebase and want to understand it by reading it, starting from the big picture.\n\n` +
    `Reply with ONLY one JSON code block, exactly in this shape:\n` +
    '```json\n' +
    `{"summary": "2-3 sentences: what the project does, for whom, and how it works at the highest level",\n` +
    ` "parts": [{"name": "short name", "role": "one sentence on what this part is responsible for", "files": ["path/in/repo"]}],\n` +
    ` "path": [{"file": "path/in/repo", "why": "one sentence: what I will learn by reading it now"}]}\n` +
    '```\n\n' +
    `- "parts": the 3 to 6 main parts of the project.\n` +
    `- "path": 5 to 8 files in the order to read them: start where the program starts (the entry point), ` +
    `then follow what it calls, so each file builds on the ones before. Skip config, tests and generated files.\n` +
    `- Use only paths that appear in the repository map.`;
}

// Keep only files that exist (a partial path is matched when it's unique),
// drop repeats. Returns { summary, parts, path } or null when the reading
// order has fewer than two files.
export function parseJourney(text, fileSet) {
  const str = v => (v == null ? '' : String(v)).trim();
  const known = f => parseFileRef(str(f).replace(/^`|`$/g, ''), fileSet)?.path || null;
  for (const obj of jsonCandidates(text)) {
    if (!Array.isArray(obj?.path)) continue;
    const seen = new Set();
    const path = obj.path
      .map(p => ({ file: known(typeof p === 'string' ? p : p?.file), why: str(p?.why) }))
      .filter(p => p.file && !seen.has(p.file) && seen.add(p.file));
    if (path.length < 2) continue;
    const parts = (Array.isArray(obj.parts) ? obj.parts : [])
      .map(x => ({ name: str(x?.name), role: str(x?.role), files: (Array.isArray(x?.files) ? x.files : []).map(known).filter(Boolean) }))
      .filter(x => x.name);
    return { summary: str(obj.summary), parts, path };
  }
  return null;
}

// Where to go after finishing `current`, best first, without asking any AI:
// the next unread file in the reading order, then unread files that `current`
// imports, then unread files that import it.
// Returns [{ file, reason }].
export function nextCandidates({ path, current, done, imports = [], importedBy = [] }) {
  const out = [];
  const add = (file, reason) => {
    if (file && file !== current && !done.has(file) && !out.some(c => c.file === file)) out.push({ file, reason });
  };
  const order = path.map(p => p.file);
  const at = order.indexOf(current);
  const later = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))];
  const inOrder = later.find(f => !done.has(f) && f !== current);
  if (inOrder) add(inOrder, path.find(p => p.file === inOrder).why || 'Next in the reading order');
  imports.forEach(f => add(f, `${current.split('/').pop()} uses it`));
  importedBy.forEach(f => add(f, `It uses ${current.split('/').pop()}`));
  return out.slice(0, 4);
}

// A short question for a small model: which of the candidates to read next.
export function nextPrompt({ summary, current, done, candidates }) {
  return `I'm reading a codebase file by file to understand it. ${summary}\n\n` +
    `I just finished \`${current}\`. Already read: ${[...done].map(f => `\`${f}\``).join(', ') || 'nothing else'}.\n\n` +
    `Candidates for what to read next:\n${candidates.map(c => `- \`${c.file}\`: ${c.reason}`).join('\n')}\n\n` +
    `Pick the one that best continues my understanding. Reply with ONLY JSON: {"file": "one of the candidate paths", "why": "one short sentence"}`;
}

// { file, why } when the reply names one of the candidates, else null
export function parseNext(text, candidates) {
  for (const obj of jsonCandidates(text)) {
    const file = String(obj?.file || '').replace(/^`|`$/g, '').trim();
    const hit = candidates.find(c => c.file === file);
    if (hit) return { file: hit.file, why: String(obj.why || '').trim() || hit.reason };
  }
  return null;
}

// How the files connect, as a tree for a narrow panel: each file's children
// are the repo files it imports. Roots are files of the reading order that no
// other file in it imports (the entry points), in reading order. A file shown
// once is marked `repeat` where it appears again, so shared helpers don't
// multiply. `importsOf`: Map(file -> [imported files]).
// Returns [{ file, repeat, children }].
export function connectionTree(order, importsOf, { maxDepth = 3, maxChildren = 8 } = {}) {
  const imported = new Set(order.flatMap(f => importsOf.get(f) || []));
  const roots = order.filter(f => !imported.has(f));
  if (!roots.length && order.length) roots.push(order[0]);   // everything imports everything: start at the top
  const seen = new Set();
  const node = (file, depth) => {
    if (seen.has(file)) return { file, repeat: true, children: [] };
    seen.add(file);
    const kids = depth < maxDepth ? (importsOf.get(file) || []).slice(0, maxChildren) : [];
    return { file, repeat: false, children: kids.map(k => node(k, depth + 1)) };
  };
  const out = roots.map(r => node(r, 0));
  order.filter(f => !seen.has(f)).forEach(f => out.push(node(f, 0)));   // only reachable through a cycle
  return out;
}
