// What Yavar asks about a block of a file or a part of a change, one
// instruction per action. The structure around it (the code or the part's
// diff, where it sits, the part headings a reply is split at) stays in
// code; the instruction can be edited under Settings → Prompts. Settings stores only the ones a user changed
// (chrome.storage.sync, key `review`: { [id]: text }), so a default that
// improves still reaches the rest.

export const REVIEW_KEY = 'review';

export const REVIEW_STEPS = [
  {
    id: 'lines', name: 'Line by line',
    body: 'Go through the changed lines in order: for each changed line, or a few that belong together, the line number(s) in bold, ' +
      'then what it did before, what it does now, and why. Put changes that are only formatting or renaming into one item, ' +
      'and skip unchanged lines. One or two sentences an item.'
  },
  {
    id: 'bugs', name: 'Find bugs',
    body: 'Review this code for bugs: logic errors, edge cases (empty, missing, zero, very large, at the same time), ' +
      'missing error handling, security problems, and anything that breaks code that calls it. For each problem give the ' +
      'line number, what goes wrong, a concrete case that shows it, and a fix. If a problem depends on code not shown here, ' +
      "say what to check. If there is nothing real, say so plainly and name what you checked; don't invent problems."
  },
  {
    id: 'better', name: 'Better ways',
    body: 'Is there a better way to write this code? Suggest alternatives that are simpler, clearer, safer or more usual ' +
      'for this language, each with its trade-off and a short example, most useful first. If the code is already a good ' +
      'choice, say so and why, rather than suggesting changes for their own sake.'
  },
  {
    id: 'tests', name: 'How to test it',
    body: 'How would I check that this works? List the cases worth testing, edge cases included, and for each what to do ' +
      'and what should happen. Say which ones an automated test should cover. Keep it short.'
  }
];

// The steps with a user's edits applied; `edited` marks the ones changed
export function reviewSteps(edits = {}) {
  return REVIEW_STEPS.map(s => (edits[s.id]?.trim() ? { ...s, body: edits[s.id], edited: true } : { ...s, edited: false }));
}

export const reviewText = (edits, id) => reviewSteps(edits || {}).find(s => s.id === id).body;

export async function loadReview() {
  const { [REVIEW_KEY]: saved } = await chrome.storage.sync.get(REVIEW_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}
