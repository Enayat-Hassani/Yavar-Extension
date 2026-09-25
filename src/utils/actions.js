// One-tap actions for what's attached to the message. Each attachment is
// sorted by what it is (a table, code, an error, a control, prose, a short
// phrase, a bare image, a page, repo files) with plain rules on what the
// picker or selection collected: instant, free, and still working when the
// models are busy. The message box shows the actions as buttons; tapping
// one sends it, with anything typed added as "Also: …".
//
// An action is { id, label, hint, prompt } or, for repo files, { id, label,
// hint, readMode } (the reading prompts in github.js).

import { READ_MODES } from './github.js';

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

const ACTIONS = {
  table: [
    { id: 'explain', label: 'Explain', hint: 'What the table shows', prompt: 'Explain what this table shows: what each column means and what stands out.' },
    { id: 'takeaways', label: 'Key takeaways', hint: 'The 3-5 points that matter', prompt: 'Give the 3-5 most important takeaways from this table, each with the numbers behind it.' },
    { id: 'csv', label: 'As CSV', hint: 'Copyable data', prompt: 'Convert the table to CSV in a single code block, keeping every row and column exactly. No commentary.' }
  ],
  code: [
    { id: 'explain', label: 'Explain', hint: 'What it does and how', prompt: 'Explain what this code does and how it works, step by step, for someone learning it.' },
    { id: 'bugs', label: 'Find bugs', hint: 'Bugs, risks, edge cases', prompt: 'Review this code for bugs, risky edge cases and unclear parts. For each, say why it matters and show a fix.' },
    { id: 'lines', label: 'Line by line', hint: 'Walk through it slowly', prompt: 'Walk through this code line by line, explaining what each line does and why.' }
  ],
  error: [
    { id: 'why', label: 'Why this error?', hint: 'What it means and what causes it', prompt: 'Explain what this error means and the most likely causes, most likely first.' },
    { id: 'fix', label: 'How do I fix it?', hint: 'Concrete steps', prompt: 'Tell me how to fix this error: concrete steps, with the exact commands or code changes.' }
  ],
  control: [
    { id: 'broken', label: "Why isn't it working?", hint: 'From its HTML', prompt: "This is an element from a web page, with its HTML. List the likely reasons it isn't working as expected (disabled, hidden, validation, missing handler…) and how to check each." },
    { id: 'explain', label: 'Explain', hint: 'What it is for', prompt: 'Explain what this page element is and what it does.' }
  ],
  prose: [
    { id: 'summarize', label: 'Summarize', hint: 'The main point and key details', prompt: 'Summarize this: the main point in 2 sentences, then the key details as short bullets.' },
    { id: 'simple', label: 'Explain simply', hint: 'Plain words', prompt: 'Explain this in plain, simple words, as if to a smart 15-year-old.' },
    { id: 'vocab', label: 'Words to learn', hint: 'Vocabulary for an advanced learner', prompt: 'List 8-10 words or phrases from this text worth learning for an advanced English learner (IELTS level). For each: its meaning in simple words, the sentence it appears in, and one new example sentence.' }
  ],
  short: [
    { id: 'explain', label: 'Explain', hint: 'What it means', prompt: 'Explain what this means, with the context needed to understand it.' },
    { id: 'examples', label: 'Examples', hint: 'How it is used', prompt: 'Show how this is used, with 3 short, varied examples.' },
    { id: 'translate', label: 'Translate', hint: 'Into natural English', prompt: 'Translate this into natural English. If it is already English, rephrase it more simply.' }
  ],
  image: [
    { id: 'describe', label: 'Describe', hint: 'What the image shows', prompt: 'Describe what this screenshot shows and what matters in it.' },
    { id: 'text', label: 'Read the text', hint: 'Transcribe it', prompt: 'Transcribe all the text in this screenshot exactly, keeping its structure.' }
  ],
  page: [
    { id: 'summarize', label: 'Summarize', hint: 'The main point and key details', prompt: 'Summarize this: the main point in 2 sentences, then the key details as short bullets.' },
    { id: 'questions', label: 'Questions to ask', hint: 'Check your understanding', prompt: 'Give me 5 questions that test whether I understood this, with short answers at the end.' },
    { id: 'vocab', label: 'Words to learn', hint: 'Vocabulary for an advanced learner', prompt: 'List 8-10 words or phrases from this text worth learning for an advanced English learner (IELTS level). For each: its meaning in simple words, the sentence it appears in, and one new example sentence.' }
  ],
  several: [
    { id: 'compare', label: 'Compare', hint: 'How they differ', prompt: 'Compare these attachments: what they have in common and where they differ.' },
    { id: 'summarize', label: 'Summarize all', hint: 'One summary', prompt: 'Summarize these attachments together: the main points and how they relate.' }
  ]
};

export function suggestActions(items) {
  if (!items?.length) return [];
  const kinds = items.map(itemKind);
  if (kinds.every(k => k === 'files')) {
    return READ_MODES.filter(m => m.id !== 'add').map(m => ({ id: m.id, label: m.label, hint: m.hint, readMode: m.id }));
  }
  if (items.length > 1) return ACTIONS.several;
  return ACTIONS[kinds[0]] || [];
}
