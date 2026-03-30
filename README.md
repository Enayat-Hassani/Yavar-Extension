# AI Sidebar

A Chrome extension that opens AI chatbots (ChatGPT, Gemini, Claude) in a persistent sidebar with keyboard shortcuts for copying text and screenshots.

## What it does

**Keyboard shortcuts:**
- `Cmd+Space` (Mac) / `Ctrl+Space` (Win) - Toggle sidebar
- `Cmd+H` / `Ctrl+H` - Copy selected text to clipboard
- `Cmd+Shift+I` / `Ctrl+Shift+I` - Capture screenshot
- `Cmd+Shift+L` / `Ctrl+Shift+L` - Generate GitHub learning prompt

**GitHub analysis:**
- On any GitHub repo, press `Cmd+Shift+L` to generate a structured learning prompt
- Right-click code → "Explain with AI" to copy with explanation prompt

**Floating menu:**
- Select text → quick actions appear (Copy, Explain, Summarize, Translate, Rewrite)

## Installation

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `ChromeSideBar` folder

## How it works

- **Text copy:** Uses `navigator.clipboard.writeText()` - selected text is copied to clipboard, paste into any AI chatbot
- **Screenshot:** Uses `chrome.tabs.captureVisibleTab()` - captures visible webpage, preview shown in sidebar
- **GitHub prompts:** Scrapes repo metadata (file tree, README, stars) and generates a learning prompt
- **Embedding:** Uses `declarativeNetRequest` to remove `X-Frame-Options` headers from chatbot domains so they can be embedded

## Notes

- Sign in to your AI service once (in sidebar or regular tab)
- Settings stored locally in Chrome sync storage
- No data collection or external telemetry

## Structure

```
ChromeSideBar/
├── manifest.json
├── sidepanel.html
├── src/
│   ├── background.js
│   ├── content.js
│   └── sidepanel.js
├── rules/csp-bypass.json
└── styles/
```

License: MIT
