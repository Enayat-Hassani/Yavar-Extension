# Reading levels for a file, and Ideas (creative search)

Approved by Enayat on 2026-11-01 ("Yes go") after this design was proposed in chat.

## 1. Three reading levels for one file

A code file's walk (not a document, not a change) gets a row of three tabs under its step bar:

| Tab | What it shows |
|---|---|
| **Overview** | What the file is for; its imports in order, each with why it was chosen, what it is used for here and why it sits where it does; how many functions and classes, why each exists and which calls which; where it starts and how data flows. |
| **Syntax** | The language features the file uses (decorators, comprehensions, async/await, destructuring…), most used first, each with a one-line meaning and the lines it appears on. |
| **Lines** | Today's block walk, unchanged, with Line by line on each block. |

- Two new intents in `utils/intents.js`, `overview` and `syntax`, editable in Settings like the other code-reading intents. Plain words, terms defined.
- Each level is one prose question through `showAnswerIn` (`via: 'chat'`, the project's reading chat), the whole walked range attached as in `createWalk`, ending with `CITE_RULE` so line citations become links.
- The answers are saved with the walk (`walk.levels.overview`, `walk.levels.syntax`); a tab whose answer is saved shows it without asking again, with "Ask again".
- A newly made walk opens on Overview (`walk.level = 'overview'`); a walk saved before this opens on Lines. Stepping blocks (›, ‹, the block list) goes to Lines.

## 2. Ideas: a creative search in rounds

A composer tool, built like the IELTS coach (`utils/ideas.js` + `startIdeas`/`ideasSend` in `panel/labs.js`), always available (start page with no page open, and the ⋯ menu). All rounds run in one chat.

1. **Scan** (you type the topic): search the web widely: what exists, adjacent fields, constraints, failures. Numbered findings.
2. **Diverge** (runs on its own after 1): about six named methods (distant analogy and nature, reverse the assumptions, TRIZ contradictions, combine two unrelated findings, first principles, extreme user), 2–3 ideas each, each citing a finding; nothing round 1 found already existing. Numbered ideas.
3. **Critique** (you pick the ideas or directions to develop): check on the web whether each exists, score novelty and feasibility, drop the generic.
4. **Deepen** (runs on its own after 3): top 3, how it works, a test within a week, the riskiest assumption.

Decisions made without an answer from Enayat (asked, not answered): pause after round 2 for the pick (option B); "the language" read as plainer wording of explanations.

## Not done / unverified

- Whether the ChatGPT bridge can turn on web search; the prompts ask for it in words only.

## Resume point

§1 and §2 built on branch `reading-levels-ideas`, not committed. `npm run ci` (163) and `npm run e2e` (35) pass; new journeys: `reading.e2e.mjs` (levels), `ideas.e2e.mjs`. Ideas is in ⋯ everywhere and on the start page only when no page is open. A walk made again keeps its tab. Not yet tried in real Chrome against real ChatGPT.
