# Yavar - Your AI Sidekick

A Chrome extension that embeds ChatGPT, Claude, and Gemini in a sidebar — so you can select anything on any page and route it to the AI, capture screenshots, analyze GitHub repositories with a deep-dive agent, run a web research agent, and keep your AI answers in a searchable history.

## What it does

**AI sidebar** — opens `gemini.google.com`, `chatgpt.com`, or `claude.ai` in a full-viewport sidebar, with a model switcher (and support for adding your own custom models). Send selected text, screenshots, or whole-page content straight to the model.

**Floating menu** — select text on any page and a compact icon menu appears, driven by **customizable prompt templates**. Built-ins include:

- **Send** — send the selection straight to your default AI platform.
- **Explain** — send it wrapped in a "Guided Learning" prompt.
- **Summarize** — send it wrapped in a concise-summary prompt.

Add, edit, or remove your own templates in Settings using `{{selection}}`, `{{page}}`, `{{clipboard}}`, `{{url}}`, and `{{title}}` placeholders, and choose which appear in the menu.

**GitHub analysis** — on any GitHub repository, generate a structured learning prompt with the file tree and README context. Unauthenticated by default; optionally add a GitHub token in Settings to lift the 60 req/hr rate limit.

**GitHub deep-dive agent** — pick a repository to scan, then ask questions about it. The agent reads the codebase and answers with file references, with a live working-status bar.

**Web research agent** — research any topic: the agent performs **SEARCH + READ** across the web and synthesizes an answer in the sidebar. Toggle **Deep research mode** in Settings for deeper coverage.

**Context dock** — a subtle dock on the left edge of the sidebar, shown on any page:

- **Add page** — drop the current tab's readable text into the chat as context (inline, or attached as a file when long). On a **YouTube watch page** this becomes **Add video**, grabbing the transcript instead of the page chrome.
- **Research this page** — seed the web research agent with the current page, then let it branch out via SEARCH/READ to confirm and deepen it.
- **Search videos** (deep search) — search YouTube for a topic (e.g. *"top things to try in Chiang Mai"*), pull the top videos' transcripts, and hand them to the AI to synthesize against your Notes. Requires a running **ytx** server; see [Video search: setting up ytx](#video-search-setting-up-ytx).
- On GitHub, one click **adds the file you're viewing**, or opens the repo **file browser**.

**Repo file browser** — browse any GitHub repository's file tree right in the sidebar, search/filter it, and jump to (or quick-add) the active file.

**Architecture diagrams** — generate a Mermaid **architecture diagram** of the current repository, rendered interactively in the sidebar.

**History & saved answers** — capture the AI's last answer and keep it in a saved-answers history panel you can return to, copy, or clear.

**Notes panel** — a built-in CodeMirror-powered scratchpad inside the sidebar, toggled with the notes shortcut.

**Auto-submit & auto-paste** — send selected text, or paste a screenshot, directly into ChatGPT, Claude, or Gemini.

### Keyboard shortcuts

Chrome commands (rebind at `chrome://extensions/shortcuts`):

| Shortcut (Mac / Win) | Action |
|----------------------|--------|
| `Cmd+Space` / `Ctrl+Space` | Toggle sidebar |
| `Cmd+Shift+I` / `Ctrl+Shift+I` | Capture screenshot (area select) |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Analyze current GitHub repository (learning prompt) |
| `Cmd+Shift+O` / `Ctrl+Shift+N` | Toggle notes panel |

In-sidebar keybinding (when the sidebar is focused):

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Save the AI's last answer to history |

## AI platforms supported

| Platform | URL | Auto-support |
|----------|-----|--------------|
| ChatGPT | `https://chatgpt.com` | ✅ |
| Claude | `https://claude.ai` | ✅ |
| Gemini | `https://gemini.google.com` | ✅ |

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
│   ├── sidepanel.js      # Sidebar UI: chat, agents, repo browser, history,
│   │                     #   diagrams, notes, model management, settings
│   ├── ai-bridge.js      # Auto-submit / auto-paste / answer capture on AI platforms
│   ├── options.js        # Settings page
│   └── utils/
│       ├── commands.js   # Keyboard shortcut handlers
│       ├── templates.js  # Prompt templates (defaults + {{variable}} expansion)
│       ├── messageHandler.js
│       └── contextMenu.js
├── lib/
│   ├── codemirror/       # CodeMirror (notes panel)
│   └── mermaid/          # Mermaid (architecture diagrams)
├── styles/
├── rules/
│   └── csp-bypass.json   # Declarative Net Request rules (see below)
├── sidepanel.html
├── options.html
└── manifest.json
```

## Permissions & privacy

Yavar asks for broad permissions to do its job. Here's what they are and why:

- **`<all_urls>`** — the floating text-selection menu needs to run on every page. This is the widest possible ask; you can review exactly what the content script does in `src/content.js`.
- **Declarative Net Request (CSP bypass)** — to inject and auto-submit prompts on ChatGPT, Claude, and Gemini, the extension strips `Content-Security-Policy` and `X-Frame-Options` response headers **only on those chat sites** (see `rules/csp-bypass.json`). It does not touch any other site. This is required to iframe the AI frontends; know that it weakens those sites' own headers while Yavar is installed.

## Configuration

Most behaviour is controlled from the options page (`options.html`) and the shortcut list at `chrome://extensions/shortcuts`.

> **Note on default shortcuts:** `Cmd+Space` is Spotlight and `Cmd+Shift+I` is DevTools on macOS. If these don't fire, rebind them at `chrome://extensions/shortcuts`.

## Video search: setting up ytx

The **Add video** and **Search videos** features get their transcripts from
**[ytx](https://github.com/Enayat-Hassani/youtube-transcript-extractor)**, a
small local server. (A browser extension can't fetch many transcripts reliably
on its own — YouTube throttles it — so ytx does the heavy lifting: multi-backend
fetching with caching.) You only need it for the video features; everything else
works without it.

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

- **Content scripts:** Browser DevTools → Console
- **Background worker:** `chrome://extensions/` → "Inspect views: background page"
- **Sidebar:** right-click the sidebar → Inspect

## License

MIT — see [LICENSE](LICENSE).