# Project-wide syntax, levels on long files, editable Ideas rounds

Approved by Enayat on 2026-11-01. His words: "No need for the quizzes … reviewing what I learned, that wouldn't be
necessary. I want to focus more on the passive learning in terms of just seeing the syntax and all. For the
project-wide syntax, that's, I think, good. You can do that. And number three also is good. … Number four as well."

Builds on `specs/reading-levels-and-ideas.md` (done, branch `reading-levels-ideas`, commits 6a953ff and d4a169f).
Work on the same branch. Check: `npm run ci` and `npm run e2e` (all must pass; today 164 unit, 35 journeys).

Out of scope, by decision: quizzes, review sessions, spaced repetition. Learning here is passive: Yavar shows,
the reader looks. Don't add buttons that test the reader.

## A. Syntax across the project (on the reading map)

What it is: one answer on the reading map listing the language features and idioms the project uses everywhere,
so they are seen once before any file.

- New intent `projectSyntax` in `src/utils/intents.js`, editable (it then shows in Settings → Prompts by itself;
  update the expected lists in `tests/intents.test.mjs` and `tests/e2e/library.e2e.mjs`, as was done for
  `overview`/`syntax`). Wording, in the house style: the features and idioms this project uses (language syntax,
  and project conventions such as how errors are handled, how modules talk), most used first; for each, a plain
  one-sentence meaning and one or two `path:START-END` places where it shows. Plain words, terms defined.
- Asked through the chat (`via: 'chat'`, `topic: this.readTopic()`), with the same files the map was built from:
  `pickCoreFiles(this.repoTree.items)` plus the README, packed with `this.packFor(files)` as one attachment, as
  `createJourney` in `src/panel/journey.js` does. Ends with `CITE_RULE`, so `linkFileRefs`/`markLineRefs` make
  the places links that open the reader.
- Saved on the reading map: `journey.syntax` (text), through `saveJourney`. Not asked when the map is made; asked
  the first time its section is opened (it costs a chat question).
- Shown in `renderJourney` as a section "Syntax across the project" after "How it is organised" (follow how
  `parts` moves below the order once reading has begun): a `<details>` closed by default; opening it shows the
  saved answer (render with `renderWalkNote` or `answerCard` + `markLineRefs`, as walk notes do) or asks for it,
  with "Ask again". "Start over with a new overview" (`resetJourney`) drops `syntax` with the rest of the map.
- A file's Syntax tab then shows only what is new: when `journey.syntax` exists, `askLevel('syntax')` in
  `src/panel/walk.js` adds to its prompt a short line plus the project answer (cut to ~1500 characters, like
  `earlierAnswers`), asking it to mark which features are new in this file and keep the known ones to one line.
- Journey e2e (in `tests/e2e/reading.e2e.mjs`, next to "the reading map gives the big picture…"): opening the
  section asks once with the `projectSyntax` intent and the core files attached; reopening the map shows it
  without asking; a file's Syntax prompt then carries the project answer.

## B. Overview and Syntax on long files

Today a walk covers at most 400 lines (`MAX_LINES` in `createWalk`, needed because the block split is JSON), and
`askLevel` sends only `walk.range`, so a 1,200-line file's Overview describes its first 400 lines. Overview and
Syntax are prose, so they don't need that limit.

- `askLevel` sends the whole file (`readRepoFile(path)`, not `sliceLines` of the range), numbered with
  `fencedFile` so line citations stay right, inline up to 4000 characters, else as the attachment, as now.
- Above a size cap (`LEVEL_MAX_CHARS = 120000`, the budget `pickCoreFiles` uses), send the first part that fits
  plus an outline of the whole file made locally: a new pure `fileOutline(content, path)` in
  `src/utils/github.js` beside `extractImports`, returning `[{ line, kind, name }]` for the definitions it finds.
  Cover Python (`def`, `async def`, `class`) and the JS/TS family (`function`, `class`, `export`, top-level
  `const x = (…) =>` / `function`) first; other languages return `[]` and send only the first part. Say in the
  prompt that the file has N lines, which lines are shown, and that the outline lists the rest. Mark it
  `shortcut:` in a comment, naming the languages it covers and when to add more.
- The prompt names the whole file (`lines 1-N`), not the walk's range.
- The answers belong to the file, not the range: when "Next lines" or "Walk it again" makes a new walk of the
  same file (`createWalk`), carry over `levels`, `levelNotes` and `levelsEdited` from the walk it replaces when
  the file's `textSha` is unchanged; drop them when the file changed. (The walk being replaced is `this.walk`
  before `createWalk` overwrites it; `level` is already carried there the same way.)
- Unit tests for `fileOutline` (Python and JS samples, an unknown language → `[]`); extend the levels journey
  with a file over 400 lines: the Overview prompt covers `lines 1-N`, and "Next lines" keeps the saved Overview.

## C. Editable Ideas rounds

Like the IELTS coach's steps, which Settings already edits (`renderCoach`, `handleCoachEdit`, `resetCoachStep`,
`persistCoach` in `src/options.js`; `coachSteps`, `loadCoach`, `lacksAttempt` in `src/utils/coach.js`).

- `src/utils/ideas.js`: `IDEAS_KEY = 'ideas'` (`chrome.storage.sync`, `{ prompts: { [stepId]: body } }`, only
  edited steps stored), `ideaSteps(edits)` (steps with edits applied, `edited` marked; an empty edit keeps the
  default), `loadIdeas()`, and `lacksText(step, body)`: true when a step you answer (not `auto`) has lost
  `{{text}}`, which carries what you typed.
- `startIdeas`/`ideasSend` in `src/panel/labs.js` and `composerTools` in `src/panel/composer.js` use the steps
  loaded at `startIdeas` (keep them on `this._ideas.steps`) instead of `IDEA_STEPS`.
- Settings: a section "Ideas rounds" on the Prompts page of `options.html` (Ideas is not a Lab; it is always on),
  one card per round with its name, `auto` rounds labelled "runs on its own", Reset when edited, and the
  `{{text}}` error for rounds you answer, built like `renderCoach`. Include it in Settings export and import
  beside `coach` (see the `coach` lines around `parsed.coach` in `src/options.js`).
- Tests: `tests/ideas.test.mjs` for `ideaSteps` and `lacksText`; an e2e like "a review prompt edited in Settings
  is kept alone, and can be reset" in `tests/e2e/library.e2e.mjs`, and `tests/e2e/ideas.e2e.mjs` checking an
  edited round's text is what gets sent.

## Docs

Update `CLAUDE.md` (the Ideas and reading-levels paragraphs, and the Storage list: `journey:<repo>` gains
`syntax`; `chrome.storage.sync` gains `ideas`) and the README's Reading code and Ideas paragraphs. No version
bump on the branch; the release commit does that when it reaches `main`.

## Order and resume point

Build A, then B, then C; commit each separately (the repo's commit style: a plain title, a body saying what was
wrong and what changed, the Co-Authored-By line). A done (commit below in git log, 165 unit? no: 164 unit, 36 journeys). Resume at B.

Still open from the first spec: the reading levels and Ideas have not been tried in real Chrome against real
ChatGPT (only e2e with the chat stubbed), and whether the bridge can switch on ChatGPT's web search is unknown;
the Ideas prompts ask for search in words only. Enayat chose pausing after Diverge without answering; it stands.
