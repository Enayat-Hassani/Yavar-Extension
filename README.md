# Yavar - Your AI Sidekick

A Chrome extension sidekick for ChatGPT, Claude, and Gemini. Select any text on any page for quick actions, capture areas of the screen, analyze GitHub repositories, and send anything straight to your AI.

## What it does

**Floating menu** — select text on any page and a small action menu appears:

- **Send** — send the selection straight to your default AI platform.
- **Explain** — send it wrapped in a "Guided Learning" prompt.

**Keyboard shortcuts** (rebind at `chrome://extensions/shortcuts`):

| Shortcut (Mac / Win) | Action |
|---------------------|--------|
| `Cmd+Space` / `Ctrl+Space` | Toggle sidebar |
| `Cmd+Shift+I` / `Ctrl+Shift+I` | Capture screenshot (area select) |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Analyze current GitHub repository |
| `Cmd+Shift+O` / `Ctrl+Shift+N` | Toggle notes panel |

**GitHub analysis** — on any GitHub repository, press `Cmd+Shift+L` to generate a structured learning prompt. It scans the repository structure and README, then builds a formatted prompt with the file tree and context — no API token required.

**Notes panel** — a built-in CodeMirror-powered scratchpad inside the sidebar, toggled with the notes shortcut.

**Auto-submit & auto-paste** — send selected text, or paste a screenshot, directly into ChatGPT, Claude, or Gemini.

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
│   ├── sidepanel.js      # Sidebar UI
│   ├── ai-bridge.js      # Auto-submit / auto-paste on AI platforms
│   ├── options.js        # Settings page
│   └── utils/
│       ├── commands.js   # Keyboard shortcut handlers
│       ├── messageHandler.js
│       └── contextMenu.js
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

## Development

This is a vanilla JavaScript (MV3) extension with no bundler. Edit source files, then reload from `chrome://extensions/`.

- **Content scripts:** Browser DevTools → Console
- **Background worker:** `chrome://extensions/` → "Inspect views: background page"
- **Sidebar:** right-click the sidebar → Inspect

## License

MIT — see [LICENSE](LICENSE).