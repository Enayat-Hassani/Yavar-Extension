// One-tap actions for what's attached to the message. Each attachment is
// sorted by what it is (a table, code, an error, a control, prose, a short
// phrase, a bare image, a page, repo files) with plain rules on what the
// picker or selection collected: instant, free, and still working when the
// models are busy. The message box shows the actions as buttons; tapping
// one sends it, with anything typed added as "Also: …".
//
// An action is { id, intent, label, hint, about } or, for repo files,
// { id, label, hint, readMode } (the reading modes in github.js).

import { READ_MODES } from './github.js';
import { intentText } from './intents.js';

const ERROR_RE = /(Traceback \(most recent call last\)|\b[A-Z]\w*(Error|Exception)\b\s*[:(]|\bUncaught\b|npm ERR!|Segmentation fault|exit(ed)? (with )?code [1-9]|\bFATAL\b|\bpanic:)/;
const CODE_LINE = /(;\s*$|[{}]\s*$|=>|^\s*(def|class|import|from|return|const|let|var|function|if|for|while|public|private|#include|fn|func|package)\b|^\s*\w+\s*\(.*\)\s*;?\s*$)/;

const words = (t) => (String(t || '').match(/\S+/g) || []).length;

// True when most lines of the text read like code
export function looksLikeCode(text) {
  const lines = String(text || '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  return lines.filter(l => CODE_LINE.test(l)).length / lines.length >= 0.4;
}

export function itemKind(it) {
  if (it.kind === 'files') return 'files';
  if (it.kind === 'page') return 'page';
  const c = it.capture;
  if (c?.rows?.length) return 'table';
  if (c && (/^(button|input|select|textarea|form|label)$/.test(c.tag) || c.html)) return 'control';
  // Selected text and pasted or dropped text files are sorted by their content
  const text = (c ? c.text : it.kind === 'selection' || it.kind === 'file' ? it.content : '') || '';
  if (!text.trim()) return it.image ? 'image' : null;
  if (ERROR_RE.test(text)) return 'error';
  if ((c && /^(pre|code)$/.test(c.tag)) || looksLikeCode(text)) return 'code';
  return words(text) >= 25 ? 'prose' : 'short';
}

// Each action is an intent (utils/intents.js) asked about this kind of
// attachment; `about` is the one line that fits the job to the subject
const TABLE = 'It is a table: say what each column means and what stands out.';
const ELEMENT = 'It is an element from a web page, with its HTML.';
const act = (id, intent, label, hint, about = '') => ({ id, intent, label, hint, about });
const ACTIONS = {
  table: [act('explain', 'explain', 'Explain', 'What the table shows', TABLE), act('takeaways', 'takeaways', 'Key takeaways', 'The 3-5 points that matter'),
    act('csv', 'csv', 'As CSV', 'Copyable data')],
  code: [act('explain', 'explain', 'Explain', 'What it does and how'), act('bugs', 'bugs', 'Find bugs', 'Bugs, risks, edge cases'),
    act('lines', 'lines', 'Line by line', 'Walk through it slowly')],
  error: [act('why', 'why', 'Why this error?', 'What it means and what causes it'), act('fix', 'fix', 'How do I fix it?', 'Concrete steps')],
  control: [act('broken', 'broken', "Why isn't it working?", 'From its HTML', ELEMENT), act('explain', 'explain', 'Explain', 'What it is for', ELEMENT)],
  prose: [act('summarize', 'summarize', 'Summarize', 'The main point and key details'), act('simple', 'simple', 'Explain simply', 'Plain words'),
    act('vocab', 'vocab', 'Words to learn', 'Vocabulary for an advanced learner')],
  short: [act('explain', 'explain', 'Explain', 'What it means'), act('examples', 'examples', 'Examples', 'How it is used'),
    act('translate', 'translate', 'Translate', 'Into natural English')],
  image: [act('describe', 'describe', 'Describe', 'What the image shows'), act('text', 'transcribe', 'Read the text', 'Transcribe it')],
  page: [act('summarize', 'summarize', 'Summarize', 'The main point and key details'), act('questions', 'questions', 'Questions to ask', 'Check your understanding'),
    act('vocab', 'vocab', 'Words to learn', 'Vocabulary for an advanced learner')],
  several: [act('compare', 'compare', 'Compare', 'How they differ'), act('summarize', 'summarizeAll', 'Summarize all', 'One summary')]
};

// What an action asks, with the user's edits to the intents
export const actionPrompt = (action, edits) => [action.about, intentText(edits, action.intent)].filter(Boolean).join(' ');

export function suggestActions(items) {
  if (!items?.length) return [];
  const kinds = items.map(itemKind);
  if (kinds.every(k => k === 'files')) {
    return READ_MODES.filter(m => m.id !== 'add').map(m => ({ id: m.id, label: m.label, hint: m.hint, readMode: m.id }));
  }
  if (items.length > 1) return ACTIONS.several;
  return ACTIONS[kinds[0]] || [];
}
