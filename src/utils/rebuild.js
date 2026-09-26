// "Rebuild it yourself": pick a project's core files, ask the AI for a
// step-by-step rebuild plan, and parse that plan. Pure functions (tested).

import { isReadablePath, suggestStartFiles } from './github.js';

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

// ---- Parsing the AI's plan ----

function tryJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Common AI slips: trailing commas, smart quotes
  try {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"'));
  } catch { return null; }
}

// The JSON values in an AI reply, most likely first: fenced blocks, then
// everything from the first "{" to the last "}". Unparseable ones are skipped.
export function jsonCandidates(text) {
  const src = String(text || '');
  const raw = [];
  for (const m of src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)) raw.push(m[1]);
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) raw.push(src.slice(first, last + 1));
  return raw.map(c => tryJson(c.trim())).filter(v => v != null);
}

function normaliseStep(s, i) {
  if (!s || typeof s !== 'object') return null;
  const str = v => (v == null ? '' : Array.isArray(v) ? v.join('\n') : String(v)).trim();
  const title = str(s.title || s.name) || `Step ${i + 1}`;
  const study = (Array.isArray(s.study) ? s.study : Array.isArray(s.files) ? s.files : str(s.study || s.files).split(/[,\n]/))
    .map(x => String(x).trim().replace(/^`|`$/g, '').replace(/^\.?\//, ''))
    .filter(Boolean)
    .slice(0, 8);
  return { title, goal: str(s.goal || s.concept), study, task: str(s.task || s.what || s.description), done_when: str(s.done_when || s.doneWhen || s.check) };
}

// Parse a plan from the AI's reply: a JSON block (preferred), bare JSON, or
// a Markdown list of "Step N: title" sections. Returns null if nothing usable.
export function parseRebuildPlan(text) {
  const src = String(text || '');
  for (const obj of jsonCandidates(src)) {
    const rawSteps = Array.isArray(obj) ? obj : obj?.steps;
    if (!Array.isArray(rawSteps) || !rawSteps.length) continue;
    const steps = rawSteps.map(normaliseStep).filter(Boolean);
    if (!steps.length) continue;
    return {
      project: String(obj?.project || '').trim(),
      language: String(obj?.language || '').trim(),
      summary: String(obj?.summary || '').trim(),
      steps
    };
  }

  // Markdown fallback: "## Step 1: Title" / "1. **Title**" followed by text
  const steps = [];
  const re = /^(?:#{1,4}\s*)?(?:step\s*)?(\d+)[.):]\s*(?:step\s*\d+[:.]?\s*)?\**([^*\n]+?)\**\s*$/gim;
  const heads = [...src.matchAll(re)];
  heads.forEach((h, i) => {
    const body = src.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined).trim();
    const study = [...body.matchAll(/`([\w./-]+\.\w+)`/g)].map(m => m[1]);
    steps.push({ title: h[2].trim(), goal: '', study: [...new Set(study)].slice(0, 8), task: body.slice(0, 1200), done_when: '' });
  });
  return steps.length >= 2 ? { project: '', language: '', summary: '', steps } : null;
}
