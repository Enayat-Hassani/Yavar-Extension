// Every question Yavar asks, written once. An intent is the job (explain,
// line by line, find bugs…); the subject it is asked about (a selection, a
// table, a file, a block of a walk, a part of a change) adds only what that
// subject needs: the code or diff, where it sits, and at most a line that
// fits the job to it. So one wording serves the message box, file packs and
// walks, and improving it improves them all.
//
// The code-reading intents can be edited under Settings → Prompts. Settings
// stores only the ones a user changed (chrome.storage.sync, key `review`,
// the name from when it held the review prompts alone: { [id]: text }), so a
// default that improves still reaches the rest.
//
// Prompts whose replies Yavar reads as data (a walk's blocks, its quiz, the
// reading map) keep their own shapes in their modules.

export const PROMPTS_KEY = 'review';

export const INTENTS = [
  // Reading code (editable)
  {
    id: 'explain', name: 'Explain', editable: true,
    body: 'Explain what this does and how it works, step by step, in plain words, for someone reading it for the first time. ' +
      'Define any unfamiliar term, point out a pattern worth learning, and end with one short question that checks I understood.'
  },
  {
    id: 'lines', name: 'Line by line', editable: true,
    body: 'Go through it line by line, in order: for each line, or a few that belong together, the line number(s) in bold when ' +
      'they are shown, then what it does and why. Point out anything surprising or error-prone. One or two sentences an item.'
  },
  {
    id: 'bugs', name: 'Find bugs', editable: true,
    body: 'Review this code for bugs: logic errors, edge cases (empty, missing, zero, very large, at the same time), ' +
      'missing error handling, security problems, and anything that breaks code that calls it. For each problem give the ' +
      'line number, what goes wrong, a concrete case that shows it, and a fix. If a problem depends on code not shown here, ' +
      "say what to check. If there is nothing real, say so plainly and name what you checked; don't invent problems."
  },
  {
    id: 'better', name: 'Better ways', editable: true,
    body: 'Is there a better way to write this code? Suggest alternatives that are simpler, clearer, safer or more usual ' +
      'for this language, each with its trade-off and a short example, most useful first. If the code is already a good ' +
      'choice, say so and why, rather than suggesting changes for their own sake.'
  },
  {
    id: 'tests', name: 'How to test it', editable: true,
    body: 'How would I check that this works? List the cases worth testing, edge cases included, and for each what to do ' +
      'and what should happen. Say which ones an automated test should cover. Keep it short.'
  },
  {
    id: 'fit', name: 'How it fits',
    body: 'Explain how this fits into the rest of the project: what calls it, what it depends on, and where its data comes ' +
      'from and goes. Name the related files, and suggest which one to read next and why.'
  },
  {
    id: 'quiz', name: 'Quiz me',
    body: 'Quiz me on this. Ask 5 questions, one at a time, from what a part does to why it is written this way or what ' +
      'would break if it changed. Wait for my answer before giving feedback and the next question.'
  },
  // Errors and page elements
  { id: 'why', name: 'Why this error?', body: 'Explain what this error means and its most likely causes, most likely first.' },
  { id: 'fix', name: 'How do I fix it?', body: 'Tell me how to fix this error: concrete steps, with the exact commands or code changes.' },
  {
    id: 'broken', name: "Why isn't it working?",
    body: "List the likely reasons this page element isn't working as expected (disabled, hidden, validation, a missing " +
      'handler…) and how to check each.'
  },
  // Text, tables and images
  { id: 'summarize', name: 'Summarize', body: 'Summarize this: the main point in two sentences, then the key details as short bullets.' },
  { id: 'simple', name: 'Explain simply', body: 'Explain this in plain, simple words, as if to a smart 15-year-old.' },
  { id: 'examples', name: 'Examples', body: 'Show how this is used, with 3 short, varied examples.' },
  { id: 'translate', name: 'Translate', body: 'Translate this into natural English. If it is already English, rephrase it more simply.' },
  {
    id: 'vocab', name: 'Words to learn',
    body: 'List 8-10 words or phrases from this text worth learning for an advanced English learner (IELTS level). For each: ' +
      'its meaning in simple words, the sentence it appears in, and one new example sentence.'
  },
  { id: 'questions', name: 'Questions to ask', body: 'Give me 5 questions that test whether I understood this, with short answers at the end.' },
  { id: 'takeaways', name: 'Key takeaways', body: 'Give the 3-5 most important takeaways, each with the numbers behind it.' },
  { id: 'csv', name: 'As CSV', body: 'Convert the table to CSV in a single code block, keeping every row and column exactly. No commentary.' },
  { id: 'describe', name: 'Describe', body: 'Describe what this screenshot shows and what matters in it.' },
  { id: 'transcribe', name: 'Read the text', body: 'Transcribe all the text in this screenshot exactly, keeping its structure.' },
  { id: 'compare', name: 'Compare', body: 'Compare these: what they have in common and where they differ.' },
  { id: 'summarizeAll', name: 'Summarize all', body: 'Summarize these together: the main points and how they relate.' }
];

const byId = new Map(INTENTS.map(i => [i.id, i]));

// An intent's text, with the user's edit when there is one
export function intentText(edits, id) {
  const intent = byId.get(id);
  if (!intent) throw new Error(`no intent "${id}"`);
  const edit = intent.editable ? edits?.[id] : null;
  return typeof edit === 'string' && edit.trim() ? edit : intent.body;
}

// The editable intents with a user's edits applied; `edited` marks the ones changed
export function editableIntents(edits = {}) {
  return INTENTS.filter(i => i.editable).map(i => (typeof edits?.[i.id] === 'string' && edits[i.id].trim()
    ? { ...i, body: edits[i.id], edited: true } : { ...i, edited: false }));
}

export async function loadEdits() {
  const { [PROMPTS_KEY]: saved } = await chrome.storage.sync.get(PROMPTS_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}
