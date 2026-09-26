# Yavar - Your AI Sidekick

A Chrome extension that embeds ChatGPT, Claude, and Gemini in a sidebar — so you can select anything on any page and route it to the AI, capture screenshots, read a GitHub repository, a commit or a local project block by block beside the code, run a web research agent, and keep your AI answers in a searchable history.

## What it does

**AI sidebar** — opens `gemini.google.com`, `chatgpt.com`, or `claude.ai` in a full-viewport sidebar, with a model switcher (and support for adding your own custom models). Send selected text, screenshots, or whole-page content straight to the model.

**The Yavar view**: Yavar opens as a full-page app. The chat (ChatGPT, Claude or Gemini) keeps running behind it; the chat button in the header shows it, and **‹ Yavar** brings you back.

- **Header:** the model pill switches models; the new model picks up the conversation (API models get the earlier turns as their own, a chat site gets them as an attached `conversation-so-far.md`, newest turns first if it's long), and *Ask* on an API answer passes them on too, the pencil starts a new conversation, and **⋯** holds saved answers, notes, web and video research, the code playground, *Continue in a fresh chat* and settings.
- **Start page:** actions for the tab you're on. On GitHub: *Read <file>* on a file page, *Read this commit* or *Read pull request #N* on those pages, *Read this repository*, *Build it yourself* and *Recent changes*. On other pages: *Summarize*, *Ask about it*, *Fact-check it*. With no page open: *Read a project folder*.
- **Composer:** type to the model, or press **+** to add the file open in your tab, **files from the repository** or **a folder**, **this page** (on YouTube, the video's transcript), or a **screenshot**: click an element on the page, or drag an area (↑ widens a click to the element around it, ✓ or Enter takes it). Along with the picture, Yavar sends what's in it as Markdown: text, a table as a table, links, image descriptions, the heading above it, and the HTML of a control or form. Each attachment chip shows its size in tokens, and the message box offers one-tap actions that fit what's attached: a table gets *Explain / Key takeaways / As CSV*, code *Explain / Find bugs / Line by line*, an error *Why this error? / How do I fix it?*, a paragraph *Summarize / Explain simply / Words to learn*. **Use a prompt** wraps what you typed in one of your templates. With files attached, one tap asks for *Explain*, *Line by line*, *How it fits*, *Review* or *Quiz me*.
- **Selections, pages and screenshots from outside the panel** (the floating menu, the right-click menu, the shortcuts) arrive in the composer. A floating-menu prompt is sent at once if *Settings → Send floating-menu prompts right away* is on; otherwise it waits in the message box.
- **Answers** stream in and render tables, checklists, nested lists and coloured code (long blocks fold). Under each: Copy, Ask again, Save, and *Open in chat*, or with **API** chosen, *Ask ChatGPT/Claude/Gemini* to put the same question to the free chat. API answers suggest three follow-up questions. Hover your question to edit and resend it. ■ stops waiting.

**Inside the chat** — when you open the chat itself (the chat button in the header), each finished answer gets **Save** (stores that exact answer *with the question you asked*), **→ Notes** and **Copy MD**, and Python and JavaScript code blocks get **▶ Run**. They sit in isolated shadow DOM, so they never clash with the site's styles, and never appear in your normal chat tabs. Turn them off under *Settings → Asking the AI*.

**Floating menu** — select text (or code on GitHub, where it also tells the AI the file and line numbers) on any page and a compact icon menu appears, driven by **customizable prompt templates**. Built-ins include:

- **Send** — add the selection to Yavar's message as a chip that remembers which page it came from (so does right-click → *Send selection to Yavar*).
- **Explain** — send it wrapped in a "Guided Learning" prompt.
- **Summarize** — send it wrapped in a concise-summary prompt.

Add, edit, or remove your own templates in Settings using `{{selection}}`, `{{page}}`, `{{clipboard}}`, `{{url}}`, `{{title}}`, and `{{repo}}` placeholders. Pin the ones you use most to the menu; the rest (e.g. **Improve writing**, **Translate**) sit behind its **⋯** button.

**Web research agent** — research any topic: the agent performs **SEARCH + READ** across the web and writes an answer with sources. Each search and read is logged in the conversation as it happens, and ■ stops it. Turn on **Deep research** in Settings for deeper coverage.

**Fact-check it** (the start page on any web page) seeds the web research agent with the page, then lets it branch out via SEARCH/READ. **Video research** (in **⋯**) searches YouTube for a topic (e.g. *"top things to try in Chiang Mai"*), pulls the top videos' transcripts, and hands them to the AI to synthesize against your Notes. Requires a running **ytx** server; see [Video search: setting up ytx](#video-search-setting-up-ytx).

**Reading code** — read a repository the way you would with a mentor beside you, without an API key. The chat site does the explaining, so reading costs no paid calls.

- **The reader.** Files open in a Yavar reader tab with the lines under discussion highlighted. It shows GitHub files and files from a local folder alike. A local file can be edited there: **Edit**, then **Save** (or ⌘S) writes it back to the folder, and the walkthrough's blocks move with your change. File references in answers (`src/app.js:12-30`) are links that open there.
- **Read <file>.** The AI splits the file into blocks of related lines. You step through them in the panel while the reader highlights each block. Every block has *Explain more*, *Quiz me*, *Practise typing* (retype the lines from memory; Yavar compares them with the original and marks what differs) and a chat button for your own question. Questions carry the block's numbered lines and the last two answers on it, so they make sense in any chat. Progress is kept per file.
- **Read this repository** (also `Cmd/Ctrl+Shift+L`). The AI reads the README and core files and returns the big picture: what the project does, its main parts, and a reading order that starts at the entry point. Each file is then walked block by block. When you finish one, *Up next* suggests the next from the reading order and the file's imports; with a free API model set up, it picks between the candidates. *How the files connect* shows the import tree.
- **Read this commit / pull request** (and each row of *Recent changes*). The change is split into parts, one per changed spot in a file. The AI gives the goal of the change, the order to read the parts, and what each part changed and why. The reader shows the file as it is after the change with the new lines highlighted; what was removed is in a fold under the explanation. *Write it yourself* is the typing practice over the new lines. Lockfiles, generated and vendored code and binary files are left out and named; a change with more than 40 parts has its busiest files' parts joined.
- **Local folders.** *Read a project folder* (start page, or **+ → Files from a folder**) lists the folders you have opened before, or asks for a new one. Everything above works on it: the reader, walkthroughs, the reading map. `node_modules`, `.git`, build output and secret files (`.env`, keys) are never listed, and nothing leaves your machine except the files you send.
- **Pick several files, send one message.** **+ → Files from this repository** opens a picker. The files go to the chat as **one Markdown pack** with a map of the repo, and one tap asks for *Explain*, *Line by line*, *How it fits*, *Review* or *Quiz me*. **+ Imports** adds the repo files the selected ones import (JS/TS, Python, C/C++, Rust, CSS). Read marks (✓) and a token estimate show what you have read and when a pack is too big for a free plan.
- **Works on any branch or tag**, including names with slashes. File contents come from `raw.githubusercontent.com`, and the tree is one cached API call per repo, so the 60 requests/hour anonymous limit is rarely reached. A token in Settings lifts it further and opens private repos.

When a walkthrough, reading map or plan comes back in a form Yavar can't read, it asks again before showing an error: the same chat once more, then another chat site (Gemini first), then the free API models, never the paid one. If the chat page shows its own error (for example Gemini's *Something went wrong (1060)*), Yavar moves on at once and the final error quotes it. Your chosen chat is loaded back afterwards.

**Build it yourself** — the best way to understand a codebase is to build a small version of it. From the start page on GitHub (or for the folder you last opened), one click sends the project's core files and the AI writes a plan of 5-10 small steps. For each step: the files to study (one click opens them in the reader and explains them), your task, how you know it works, a code editor for your version, **Hint** (not the solution), **Review my code** (compared against the original files), **Run it**, and a chat button for your own question about the step. Answers appear inside the step, with Copy, Run and *Use in editor* on each code block. Progress and mentor notes are saved per project.

**Answers inside Yavar**: every answer, including research reports, streams into the conversation as the AI writes it. Code blocks get Copy and ▶ Run, each answer has Copy, Ask again and Save, and the composer asks follow-ups in the same chat. *Open in chat* shows the real chat whenever you want it (API answers have no chat page, so they offer *Ask* the chat site instead).

**Private chats for Yavar's work** (on by default): these requests, the rebuild hints and reviews, and the agents run in a temporary chat, so they don't fill your chat history: `chatgpt.com/?temporary-chat=true`, Claude's incognito chat, or Gemini's *Temporary chat* button. Follow-ups continue in the same temporary chat. Save the answers you want to keep. Turn it off under *Settings → Asking the AI* to keep everything in your normal history.

**Model APIs**: choose **API** in the model menu to answer through model APIs instead of a chat site. Yavar tries a local OpenAI-compatible gateway first (OmniRoute, Ollama), then the OpenRouter free models you tick in *Settings → Model APIs*, then one paid model if you set one. A model that is busy, rate-limited or silent is skipped, and each answer names the model that wrote it. The paid model has a monthly limit ($3 by default): a paid answer shows what it cost, Settings shows this month's total, and at the limit Yavar uses only the free models until the next month. Keys stay on this device.

**Sheets**: the runner, Build it yourself, notes and saved answers each fill the panel. ✕ or Esc goes back to the Yavar view.

**Run code** — every Python or JavaScript block in an answer gets a **▶ Run** button. It runs locally in a sandbox (Python via bundled [Pyodide](https://pyodide.org), standard library only), shows the output, and offers *Fix it*, *Explain the output* and *What to try next*. The answers appear under your code, not in the chat. *Code playground* in **⋯** opens the same runner.

**History & saved answers** — capture the AI's last answer and keep it in a searchable saved-answers panel. Answers saved while reading a repo are tagged with it (click the tag to see everything about that repo). The **+** in the panel's header saves the chat's latest answer. Expand, copy, send to Notes, or **export everything as Markdown**.

**Continue in a fresh chat** — long chats get slow and hit free-plan limits. *Continue in a fresh chat* in **⋯** asks the AI for a handoff note, starts a new conversation, and attaches the note to your next message so the new chat picks up where you left off. The note is also kept in Saved answers.

**Notes panel** — a built-in CodeMirror-powered scratchpad inside the sidebar, toggled with the notes shortcut. Download it as a `.md` file anytime.

**Light & dark** — the sidebar and Settings follow your OS theme, matching the chat sites.

### Keyboard shortcuts

Chrome commands (rebind at `chrome://extensions/shortcuts`):

| Shortcut (Mac / Win) | Action |
|----------------------|--------|
| `Cmd+Shift+Y` / `Alt+Shift+Y` | Open Yavar |
| `Cmd+Shift+I` / `Alt+Shift+S` | Pick an element or area of the page (attached to your message) |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Read the GitHub repository in your tab |
| `Cmd+Shift+O` / `Alt+Shift+N` | Open or close Notes |

These are the defaults for a new install. Chrome keeps the bindings of an existing install; change them at `chrome://extensions/shortcuts`.

In the chat view:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Save the AI's last answer to history |

## AI platforms supported

| Platform | URL | Auto-support |
|----------|-----|--------------|
| ChatGPT | `https://chatgpt.com` | ✅ |
| Claude | `https://claude.ai` | ✅ |
| Gemini | `https://gemini.google.com` | ✅ |

## Browser support

| Browser | How Yavar opens |
|---------|-----------------|
| Chrome, Edge, Brave (Windows / macOS / Linux) | Side panel (toolbar icon or the *Open Yavar* shortcut) |
| Opera, Opera GX | Opera's left sidebar (click the Yavar icon there), or the toolbar icon, which opens Yavar as a slim window docked to the right |
| Other Chromium browsers without a side panel | The same docked window |

## Installation

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `Yavar-Extension` folder

No build step needed — reload the extension to pick up changes.

## Project structure

```
Yavar-Extension/
├── src/
│   ├── content.js        # Content script: floating menu + text selection
│   ├── background.js     # Service worker (lifecycle, screenshot, routing)
│   ├── sidepanel.js      # Sidebar UI: the Yavar view, agents, file picker,
│   │                     #   walkthroughs, history, notes, runner, rebuild
│   ├── reader.js         # The reader tab: a file with its lines highlighted, editable when local
│   ├── ai-bridge.js      # Auto-submit / auto-paste / answer capture on AI platforms
│   ├── options.js        # Settings page (models, prompts, token, shortcuts)
│   └── utils/
│       ├── github.js     # URLs, file packs, line citations, imports
│       ├── walkthrough.js # A file split into blocks; typing comparison; quizzes;
│       │                  #   moving blocks after an edit
│       ├── journey.js    # The reading map and what to read next
│       ├── changes.js    # A commit or PR diff split into parts
│       ├── rebuild.js    # Build it yourself: plans, hints, reviews
│       ├── llm.js        # Model APIs: local gateway, OpenRouter, the monthly budget
│       ├── markdown.js   # Rendering answers
│       ├── codeEditor.js # CodeMirror modes for the code boxes and the reader
│       ├── idb.js        # IndexedDB store for local folder handles
│       ├── commands.js   # Keyboard shortcut handlers
│       ├── template-core.js # Prompt templates: defaults + {{variable}} expansion
│       │                    #   (classic script, shared by content script and pages)
│       ├── templates.js  # ES-module wrapper around template-core for extension pages
│       ├── frameRules.js # Lets the chat sites load in the sidebar (see below)
│       ├── net.js        # URL guard for the research agent
│       ├── models.js     # Built-in chat models, shared by the panel and Settings
│       └── contextMenu.js
├── lib/
│   ├── codemirror/       # CodeMirror (notes, runner, code boxes, reader)
│   └── pyodide/          # Python runtime for the code runner
├── styles/
├── tests/                # node:test unit tests
├── scripts/              # ytx setup + check.mjs (static checks)
├── sidepanel.html
├── reader.html
├── options.html
└── manifest.json
```

## Permissions & privacy

Yavar asks for broad permissions to do its job. Here's what they are and why:

- **`<all_urls>`** — the floating text-selection menu needs to run on every page. This is the widest possible ask; you can review exactly what the content script does in `src/content.js`.
- **Declarative Net Request (frame headers)** — ChatGPT, Claude, and Gemini send `X-Frame-Options` / `Content-Security-Policy` headers that stop them loading in an iframe. Yavar removes those headers **only for frames loaded by Yavar itself**: one session rule for Chrome's side panel (`tabIds: [-1]`, the ID Chrome gives requests that don't belong to a tab) and one for Yavar's own pages elsewhere, such as Opera's sidebar or the docked window (`initiatorDomains: [<extension id>]`). Both apply only to the chat sites plus any custom models you add. Your normal tabs keep the sites' full headers, and other websites can't use Yavar to frame your logged-in chats. See `src/utils/frameRules.js`.
- **Talking to the chat frame** — the in-chat helper (`src/ai-bridge.js`) only accepts instructions from the Yavar sidebar's own origin and only sends answers back to it.
- **Research agent** — pages the AI asks to READ are fetched without your cookies, and local or private-network addresses (localhost, `192.168.x.x`, cloud metadata, etc.) are refused, so text on a web page can't steer the agent into your LAN.

## Configuration

Settings live on the options page (`options.html`, or **⋯ → Settings** in Yavar). Shortcuts are changed at `chrome://extensions/shortcuts`.

## Video search: setting up ytx

**Video research** gets its transcripts from
**[ytx](https://github.com/Enayat-Hassani/youtube-transcript-extractor)**, a
small local server. (A browser extension can't fetch many transcripts reliably
on its own — YouTube throttles it — so ytx does the heavy lifting: multi-backend
fetching with caching.) Attaching one video's transcript (**+ → This video's
transcript** on a YouTube page) uses ytx when it's running and the page's
captions otherwise. Everything else works without it.

ytx needs [**uv**](https://docs.astral.sh/uv/) (a Python tool). Install that
first, then set ytx up.

**macOS / Linux** — from the extension folder:

```bash
./scripts/setup-ytx.sh
```

**Windows** (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-ytx.ps1
```

That clones ytx into `server/ytx` and installs its dependencies. Then run it
(leave it open in a terminal):

```bash
cd server/ytx && uv run uvicorn ytx_api.main:app --host 127.0.0.1 --port 8722
```

Check it's up (should print `{"status":"ok",…}`):

```bash
curl -s http://127.0.0.1:8722/health
```

The extension talks to `http://localhost:8722` by default — change the URL or
video count in **Settings** if you like.

### Keep it always-on (optional)

So you don't have to start it by hand each time:

- **macOS** — installs a LaunchAgent that runs ytx at login and restarts it if it
  stops:

  ```bash
  ./scripts/install-autostart-macos.sh
  ```

  Uninstall: `launchctl unload -w ~/Library/LaunchAgents/com.yavar.ytx.plist && rm ~/Library/LaunchAgents/com.yavar.ytx.plist`

- **Windows** — create a Task Scheduler task that runs the `uvicorn …` command
  above *At log on*.
- **Linux** — a `systemd --user` service running the same command.

It's a light process (~55 MB idle, ~0% CPU when unused). Port `8722` is used
instead of the common `8000` to avoid clashing with other local servers.

## Development

This is a vanilla JavaScript (MV3) extension with no bundler. Edit source files, then reload from `chrome://extensions/`.

```bash
npm test          # unit tests (node:test, no install needed)
npm run check     # manifest + referenced files + syntax
```

CI runs both on every push and pull request.

- **Content scripts:** Browser DevTools → Console
- **Background worker:** `chrome://extensions/` → "Inspect views: background page"
- **Sidebar:** right-click the sidebar → Inspect

## License

MIT — see [LICENSE](LICENSE).