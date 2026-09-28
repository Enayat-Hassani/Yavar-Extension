// "Read this repository": the big picture first (what it does, its parts, a
// reading order), then each file block by block, and after each file a
// suggestion for the next one. Pure functions (tested).

import { jsonCandidates } from './json.js';
import { parseFileRef, isReadablePath, suggestStartFiles } from './github.js';

const SOURCE_EXT = /\.(py|js|mjs|cjs|jsx|ts|tsx|go|rs|rb|php|java|kt|c|h|cpp|cc|hpp|cs|swift|dart|lua|ex|exs|scala|vue|svelte|sh)$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures|examples?|docs?|benchmarks?)\//i;

// Files that best show how the project works, within a size budget:
// docs/manifest/entry points first, then shallow source files, small first.
export function pickCoreFiles(items, budgetBytes = 120000, maxFiles = 25) {
  const blobs = items.filter(i => i.type === 'blob' && isReadablePath(i.path));
  const size = new Map(blobs.map(b => [b.path, b.size || 0]));
  const picks = [];
  let used = 0;
  const take = (p) => {
    if (picks.includes(p) || picks.length >= maxFiles) return;
    const s = size.get(p) || 0;
    if (s > budgetBytes * 0.4 || used + s > budgetBytes) return;
    picks.push(p);
    used += s;
  };
  suggestStartFiles(blobs.map(b => b.path)).forEach(take);
  blobs
    .filter(b => SOURCE_EXT.test(b.path) && !TEST_PATH.test(b.path + '/') && !/\.(d\.ts|test\.\w+|spec\.\w+)$/.test(b.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || (a.size || 0) - (b.size || 0))
    .forEach(b => take(b.path));
  return picks;
}

export function planPrompt(projectName) {
  return `I want to learn how ${projectName} is built by rebuilding a simplified version of it myself, step by step. ` +
    `The attached pack contains its key files and a map of the repository.\n\n` +
    `Act as a coding mentor and design a rebuild plan:\n` +
    `- 5 to 10 steps, from an empty folder to a small working core version (skip polish, config and edge cases).\n` +
    `- Each step is small (30-60 minutes for a beginner), builds on the previous one, and ends with something I can run or check.\n` +
    `- For each step, list the original files (paths from the map) I should study for it.\n\n` +
    `Reply with ONLY one JSON code block, exactly in this shape:\n` +
    '```json\n' +
    `{"project": "short name", "language": "main language", "summary": "one or two sentences on what we will build",\n` +
    ` "steps": [{"title": "short title", "goal": "the concept this step teaches", "study": ["path/in/repo"],\n` +
    `   "task": "concretely what to write in this step", "done_when": "how I can tell it works"}]}\n` +
    '```';
}

export function hintPrompt(plan, i) {
  const s = plan.steps[i];
  return `I'm rebuilding ${plan.project}, step ${i + 1} of ${plan.steps.length}: "${s.title}".\n` +
    `Task: ${s.task}\n\n` +
    `Give me a hint, not the solution: the next small thing to do, the idea I'm missing, and which part of ` +
    `${s.study?.length ? s.study.join(', ') : 'the original code'} to look at. Keep it short.`;
}

// A question of the user's own about the current step. `earlier`: what the
// mentor already said on it (earlierAnswers), so follow-ups make sense in
// any chat.
export function askPrompt(plan, i, code, question, earlier = '') {
  const s = plan.steps[i];
  return `I'm rebuilding ${plan.project}, step ${i + 1} of ${plan.steps.length}: "${s.title}".\n` +
    `Task: ${s.task}\n` + (s.done_when ? `Done when: ${s.done_when}\n` : '') + `\n` +
    (code.trim() ? `My code so far:\n\n\`\`\`${plan.language ? plan.language.toLowerCase() : ''}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n` : '') +
    (earlier ? `${earlier}\n\n` : '') +
    `My question: ${question}\n\n` +
    `Answer it like a mentor: help me understand, and don't write the step for me unless I ask for code.`;
}

export function checkPrompt(plan, i, code, attached) {
  const s = plan.steps[i];
  return `I'm rebuilding ${plan.project}, step ${i + 1} of ${plan.steps.length}: "${s.title}".\n` +
    `Task: ${s.task}\nDone when: ${s.done_when}\n\n` +
    `Here is my attempt:\n\n\`\`\`${plan.language ? plan.language.toLowerCase() : ''}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n` +
    (attached ? `The attached pack has the original files for this step.\n\n` : '') +
    `Review it like a mentor:\n` +
    `1. Does it do what the step asks? If not, what is missing?\n` +
    `2. The key differences from the original, and why the original does it that way.\n` +
    `3. One or two concrete improvements.\n` +
    `Don't rewrite everything for me; show only small snippets where needed.`;
}

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
// drop repeats. `root` is the repo or folder name, which the AI sometimes
// puts in front of paths ("my-app/src/x.py"). Returns { summary, parts,
// path } or null when the reading order has fewer than two files.
export function parseJourney(text, fileSet, root = '') {
  const str = v => (v == null ? '' : String(v)).trim();
  const known = (f) => {
    const p = str(f).replace(/^`|`$/g, '').replace(/^\.?\//, '');
    const hit = parseFileRef(p, fileSet)?.path;
    if (hit || !root || !p.startsWith(root + '/')) return hit || null;
    return parseFileRef(p.slice(root.length + 1), fileSet)?.path || null;
  };
  for (const obj of jsonCandidates(text)) {
    const order = obj?.path || obj?.reading_order || obj?.files;
    if (!Array.isArray(order)) continue;
    const seen = new Set();
    const path = order
      .map(p => ({ file: known(typeof p === 'string' ? p : p?.file || p?.path), why: str(p?.why || p?.reason) }))
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

// A few lines on the project a question is about, sent with every question
// on its code so answers see the whole and not only the lines in front of
// them: the reading map's overview and parts when the project has been read,
// else the opening of its README. '' when neither is known.
export function projectBrief(journey, readme = '', max = 1400) {
  let text = '';
  if (journey?.summary) {
    const parts = (journey.parts || []).slice(0, 8).map(p =>
      `- ${p.name ? `${p.name}: ` : ''}${p.role || ''}${p.files?.length ? ` (${p.files.slice(0, 4).join(', ')})` : ''}`);
    text = `${journey.summary}${parts.length ? `\nIts main parts:\n${parts.join('\n')}` : ''}`;
  } else if (readme) {
    // The README's first paragraphs of prose: not its title, badges or images
    text = readme.split(/\n\s*\n/)
      .map(b => b.trim())
      .filter(b => b && !/^#/.test(b) && !/^(\[!\[|!\[|<)/.test(b) && !/^[-=*_]{3,}$/.test(b))
      .slice(0, 2).join('\n\n');
  }
  if (!text) return '';
  return `About the project, for context: ${text.length > max ? text.slice(0, max - 1) + '…' : text}`;
}
