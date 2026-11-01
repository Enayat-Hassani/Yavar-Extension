// Ideas: a creative search in rounds, so the chat cannot jump to the first
// generic ideas. It scans widely, then makes ideas with named methods people
// have used to find new ones, then (after you pick) checks them against what
// exists and deepens the best. One chat holds every round; a step marked
// `auto` runs straight after the one before, without waiting for you.
// Pure (tested); the panel's side is startIdeas/ideasSend in panel/labs.js.

export const IDEA_STEPS = [
  {
    id: 'scan', name: 'Scan', ask: 'What do you want ideas for?',
    body: `I want genuinely new ideas for: {{text}}

Before any ideas, research widely. Search the web across at least five different angles: what already exists and how well it works, adjacent and distant fields that face a similar problem, the hard constraints (cost, physics, law, habits), attempts that failed and why, and recent shifts that open new options.

Reply with numbered findings (F1, F2…), one or two sentences each, with the source. No ideas yet.`
  },
  {
    id: 'diverge', name: 'Diverge', auto: true,
    body: `Now make ideas with these methods, 2 or 3 ideas each:
1. Distant analogy: borrow how a far-away field or nature solves a similar problem.
2. Reverse the assumptions: list what everyone takes for granted here, flip one each time.
3. Contradiction (TRIZ): name the trade-off people accept, and find a way to get both sides.
4. Combine: join two unrelated findings into one idea.
5. First principles: rebuild from the basic need, ignoring how it is done today.
6. Extreme user: design for the most demanding or unusual user, then bring it back.

Number the ideas (I1, I2…). For each: one sentence, the method, and the findings it builds on. Leave out anything your research showed already exists, and anything a quick search would find in the first results.`
  },
  {
    id: 'critique', name: 'Critique', ask: 'Which ideas or directions should I develop? (numbers or words)',
    body: `Develop these: {{text}}

For each one, search the web to check whether it, or something close, already exists, and say what you found. Then score it 1-5 on novelty and on feasibility, with one line of reasoning each. Drop the ones that turn out generic or already done, and say why. Keep at most five.`
  },
  {
    id: 'deepen', name: 'Deepen', auto: true,
    body: `Take the three strongest that survived. For each:
- How it works, concretely, in a short paragraph.
- What makes it non-obvious: why people haven't done it.
- A first test I could run within a week, and what result would tell me to continue.
- The riskiest assumption, and how to check it cheaply.`
  }
];

// Settings stores only the rounds a user changed (chrome.storage.sync, key
// `ideas`: { prompts: { [stepId]: body } }), so an improved default still
// reaches every round nobody edited.
export const IDEAS_KEY = 'ideas';

// The rounds with a user's edits applied; `edited` marks the ones changed
export function ideaSteps(edits = {}) {
  return IDEA_STEPS.map(s => (typeof edits[s.id] === 'string' && edits[s.id].trim()
    ? { ...s, body: edits[s.id], edited: true } : { ...s, edited: false }));
}

// A round you answer must carry what you typed; a round that runs on its own needs none
export const lacksText = (step, body) => !step.auto && !/\{\{\s*text\s*\}\}/.test(body);

export async function loadIdeas() {
  const { [IDEAS_KEY]: saved } = await chrome.storage.sync.get(IDEAS_KEY);
  return { prompts: saved?.prompts || {} };
}

// The prompt for one step, with what you typed in place of {{text}}
export function ideasPrompt(step, text = '') {
  // A function, so a $ in what you typed is not read as a replacement pattern
  return step.body.replace(/\{\{\s*text\s*\}\}/g, () => String(text).trim());
}
