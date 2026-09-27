// The IELTS coach: one prompt per step, each wrapped around what the learner
// typed. The panel sends one step at a time, so the chat cannot run ahead of
// the learner's attempt. The article travels as an attached file with the
// first step; the prompts stay short because free chat sites and free models
// lose track of long ones.
//
// Settings stores only the steps a user changed (chrome.storage.sync, key
// `coach`: { about, prompts: { [stepId]: body } }), so an improved default
// still reaches every step nobody edited.

import { expandTemplate } from './templates.js';

export const COACH_KEY = 'coach';

export const COACH_STEPS = [
  {
    id: 'thesis', name: 'Thesis', ask: 'Skim the article, then write its thesis in 1–2 sentences',
    body: `You are my IELTS Academic coach. I attempt first; you give feedback after.
Rules for this chat: one step per reply, ending with my next task. No band scores or numbers. Quote the text for every point. No model answers unless I ask.

The attached file is the article "{{title}}". I skimmed it without help. My thesis summary:
{{selection}}

Compare my summary with the article's thesis: what I caught and what I missed, quoting the passages that carry it. Then set 3 IELTS Reading questions (True/False/Not Given or summary completion) without the answers.`
  },
  {
    id: 'answers', name: 'Answers', ask: 'Your answers to the three questions',
    body: `My answers:
{{selection}}

For each: right or wrong, the sentence that decides it, and the distractor if one misled me. Then ask me to read the article closely and send one sentence whose structure or linking I think is well built.`
  },
  {
    id: 'sentence', name: 'Sentence', ask: 'One well-built sentence from the article',
    body: `The sentence I chose:
{{selection}}

In a few lines, explain why it works and how it links to the sentences around it. Then pick 3 C1/C2 collocations and 1 grammar structure from the article, quoting where each appears, with no example sentences. Ask me to write one sentence in Writing Task 2 register using at least one collocation and the structure.`
  },
  {
    id: 'own', name: 'Your sentence', ask: 'Your own sentence with those items',
    body: `My sentence:
{{selection}}

Give feedback on collocation, register and grammar. Quote each problem; do not rewrite the sentence for me. Then set a Writing Task 2 question on the article's theme and ask for one body paragraph of 3–4 sentences that uses those items.`
  },
  {
    id: 'paragraph', name: 'Paragraph', ask: 'Your body paragraph',
    body: `My paragraph:
{{selection}}

Give feedback through Task Response, Coherence and Cohesion, Lexical Resource, and Grammatical Range and Accuracy, with no band or score. Quote my text for each point. End with the two changes that matter most and ask me to rewrite the paragraph once.`
  }
];

// The steps with a user's edits applied; `edited` marks the ones changed
export function coachSteps(edits = {}) {
  return COACH_STEPS.map(s => edits[s.id]
    ? { ...s, body: edits[s.id], edited: true }
    : { ...s, edited: false });
}

// Every step must carry the attempt, or the turn-taking breaks
export const lacksAttempt = (body) => !/\{\{\s*selection\s*\}\}/.test(body);

export async function loadCoach() {
  const { [COACH_KEY]: saved } = await chrome.storage.sync.get(COACH_KEY);
  return { about: saved?.about || '', prompts: saved?.prompts || {} };
}

// The prompt for one step. "About you" goes with the first step only: the
// chat keeps it from there.
export async function coachPrompt(step, attempt, { title = '', url = '', about = '' } = {}) {
  const text = await expandTemplate(step.body, { selection: attempt, title, url });
  return step.id === COACH_STEPS[0].id && about.trim() ? `${text}\n\nAbout me: ${about.trim()}` : text;
}
