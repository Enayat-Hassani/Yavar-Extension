# Yavar - Your AI Sidekick

A Chrome extension that embeds ChatGPT, Claude, and Gemini in a sidebar — so you can select anything on any page and route it to the AI, capture screenshots, learn GitHub repositories, run a web research agent, and keep your AI answers in a searchable history.

## What it does

**AI sidebar** — opens `gemini.google.com`, `chatgpt.com`, or `claude.ai` in a full-viewport sidebar, with a model switcher (and support for adding your own custom models). Send selected text, screenshots, or whole-page content straight to the model.

**The Yavar view**: Yavar opens as a full-page app. The chat (ChatGPT, Claude or Gemini) keeps running behind it; the chat button in the header shows it, and **‹ Yavar** brings you back.

- **Header:** the model pill switches models (a divider marks the new chat), the pencil starts a new conversation, and **⋯** holds saved answers, notes, web and video research, the code playground, *Continue in a fresh chat* and settings.
- **Start page:** actions for the tab you're on. On GitHub: *Tour this repository*, *Browse files*, *Recent changes*, *Build it yourself*, and *Explain* for an open pull request or file. On other pages: *Summarize*, *Ask about it*, *Fact-check it*.
- **Composer:** type to the model, or press **+** to add the file open in your tab, **files from the repository** or **a folder**, **this page** (on YouTube, the video's transcript), or a **screenshot** of an area of the page. **Use a prompt** wraps what you typed in one of your templates. With files attached, one tap asks for *Explain*, *Line by line*, *How it fits*, *Review* or *Quiz me*.
- **Selections, pages and screenshots from outside the panel** (the floating menu, the right-click menu, the shortcuts) arrive in the composer. A floating-menu prompt is sent at once if *Settings → Send floating-menu prompts right away* is on; otherwise it waits in the message box.
- **Answers** stream in with Copy, Save and ▶ Run on code. ■ stops waiting.

**Inside the chat** — when you open the chat itself (the chat button in the header), each finished answer gets **Save** (stores that exact answer *with the question you asked*), **→ Notes** and **Copy MD**, and Python and JavaScript code blocks get **▶ Run**. They sit in isolated shadow DOM, so they never clash with the site's styles, and never appear in your normal chat tabs. Turn them off under *Settings → Asking the AI*.

**Floating menu** — select text (or code on GitHub, where it also tells the AI the file and line numbers) on any page and a compact icon menu appears, driven by **customizable prompt templates**. Built-ins include:

- **Send** — send the selection to Yavar as it is.
- **Explain** — send it wrapped in a "Guided Learning" prompt.
- **Summarize** — send it wrapped in a concise-summary prompt.

Add, edit, or remove your own templates in Settings using `{{selection}}`, `{{page}}`, `{{clipboard}}`, `{{url}}`, `{{title}}`, and `{{repo}}` placeholders. Pin the ones you use most to the menu; the rest (e.g. **Improve writing**, **Translate**) sit behind its **⋯** button.

**Tour this repository** (also `Cmd/Ctrl+Shift+L`): one click packs the README and the repo's core files into one message and asks for a guided tour (purpose, layout, how a request flows through, the stack, and which 3 files to read first). It replaced the old deep-dive agent, which took many turns to do the same.

**Web research agent** — research any topic: the agent performs **SEARCH + READ** across the web and writes an answer with sources. Each search and read is logged in the conversation as it happens, and ■ stops it. Turn on **Deep research** in Settings for deeper coverage.

**Fact-check it** (the start page on any web page) seeds the web research agent with the page, then lets it branch out via SEARCH/READ. **Video research** (in **⋯**) searches YouTube for a topic (e.g. *"top things to try in Chiang Mai"*), pulls the top videos' transcripts, and hands them to the AI to synthesize against your Notes. Requires a running **ytx** server; see [Video search: setting up ytx](#video-search-setting-up-ytx).

**Reading code** — learn from other people's code without an API key or burning your chat quota. **+ → Files from this repository** (or *Browse files* on the start page) opens a file picker:

- **Pick several files, send one message.** They go to the chat as **one Markdown pack** with a map of the repo showing where each file sits.
- **+ Imports** also selects the repo files the selected ones import (JS/TS, Python, C/C++, Rust, CSS).
- **Suggested** lists the file open in your tab, then a reading order: README, the manifest, then entry points.
- **Line ranges:** select lines on GitHub (`#L10-L25`) and *Explain* on the start page sends just those lines.
- **Read marks (✓)** and a token estimate, so you know when a pack is too big for a free plan.
- **Works on any branch or tag**, including names with slashes.
- **Recent changes** (start page): the latest commits on the branch. Click one to have the AI explain its diff, or ask *What's been happening?* for a themed summary.
- **Barely touches the GitHub API:** file contents come from `raw.githubusercontent.com`, and the tree is one cached API call per repo, so the 60 requests/hour anonymous limit stops being a problem. A token in Settings lifts it further and opens private repos.

**Local folders** — **+ → Files from a folder** uses the same picker on a project folder on your computer: packs, reading modes, imports, read marks. `node_modules`, `.git`, build output and secret files (`.env`, keys) are never listed, and nothing leaves your machine except the files you choose to send. Reopening remembers the last folder.

**Rebuild it yourself** — the best way to understand a codebase is to build a small version of it. From the start page on GitHub (or for the folder you last opened), one click sends the project's core files and the AI writes a plan of 5-10 small steps. For each step: the files to study (one click to read them), your task, how you know it works, a box for your code, **💡 Hint** (not the solution), **Check my code** (compared against the original files), and **▶ Try it**, which runs your code right in the step card. Hints and reviews stream into the step as they're written, with Copy, Run and *Use in editor* on each code block, so you never have to leave the step. Progress and mentor notes are saved per project.

**Answers inside Yavar**: every answer, including research reports, streams into the conversation as the AI writes it. Code blocks get Copy and ▶ Run, each answer has Copy and Save, and the composer asks follow-ups in the same chat. *Open in chat* shows the real chat whenever you want it.

**Private chats for Yavar's work** (on by default): these requests, the rebuild hints and reviews, and the agents run in a temporary chat, so they don't fill your chat history: `chatgpt.com/?temporary-chat=true`, Claude's incognito chat, or Gemini's *Temporary chat* button. Follow-ups continue in the same temporary chat. Save the answers you want to keep. Turn it off under *Settings → Asking the AI* to keep everything in your normal history.

**Sheets**: the runner, rebuild, notes and saved-answers panels open as sheets from the bottom. Drag the handle to resize (double-click for full height).

**Run code** — every Python or JavaScript block in an answer gets a **▶ Run** button. It runs locally in a sandbox (Python via bundled [Pyodide](https://pyodide.org), standard library only), shows the output, and offers *Ask AI to fix it*, *Explain the output* and *What should I try next?*. The answers appear under your code, not in the chat. *Code playground* in **⋯** opens the same runner.

**Explain PR / commit** — on a pull request or commit page, one click attaches the diff and asks the AI to explain the goal, each file's change, what to learn from it, and what's risky.

**History & saved answers** — capture the AI's last answer and keep it in a searchable saved-answers panel. Answers saved while reading a repo are tagged with it (click the tag to see everything about that repo). The **+** in the panel's header saves the chat's latest answer. Expand, copy, send to Notes, or **export everything as Markdown**.

**Continue in a fresh chat** — long chats get slow and hit free-plan limits. *Continue in a fresh chat* in **⋯** asks the AI for a handoff note, starts a new conversation, and attaches the note to your next message so the new chat picks up where you left off. The note is also kept in Saved answers.

**Notes panel** — a built-in CodeMirror-powered scratchpad inside the sidebar, toggled with the notes shortcut. Download it as a `.md` file anytime.

**Light & dark** — the sidebar and Settings follow your OS theme, matching the chat sites.

### Keyboard shortcuts

Chrome commands (rebind at `chrome://extensions/shortcuts`):

| Shortcut (Mac / Win) | Action |
|----------------------|--------|
| `Cmd+Shift+Y` / `Alt+Shift+Y` | Open Yavar |
| `Cmd+Shift+I` / `Alt+Shift+S` | Screenshot an area of the page (attached to your message) |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Tour the GitHub repository in your tab |
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
│   │                     #   history, notes, runner, rebuild
│   ├── ai-bridge.js      # Auto-submit / auto-paste / answer capture on AI platforms
│   ├── options.js        # Settings page (models, prompts, token, shortcuts)
│   └── utils/
│       ├── commands.js   # Keyboard shortcut handlers
│       ├── template-core.js # Prompt templates: defaults + {{variable}} expansion
│       │                    #   (classic script, shared by content script and pages)
│       ├── templates.js  # ES-module wrapper around template-core for extension pages
│       ├── frameRules.js # Lets the chat sites load in the sidebar (see below)
│       ├── net.js        # URL guard for the research agent
│       ├── models.js     # Built-in chat models, shared by the panel and Settings
│       └── contextMenu.js
├── lib/
│   ├── codemirror/       # CodeMirror (notes panel)
│   └── pyodide/          # Python runtime for the code runner
├── styles/
├── tests/                # node:test unit tests
├── scripts/              # ytx setup + check.mjs (static checks)
├── sidepanel.html
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