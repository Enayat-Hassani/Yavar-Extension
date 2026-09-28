// Reading JSON out of an AI reply, which may wrap it in a code fence, add
// words around it, or slip in a trailing comma. Pure functions (tested).

import { stripChatArtifacts } from './markdown.js';

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
  const src = stripChatArtifacts(text);
  const raw = [];
  for (const m of src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)) raw.push(m[1]);
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) raw.push(src.slice(first, last + 1));
  return raw.map(c => tryJson(c.trim())).filter(v => v != null);
}
