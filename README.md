# Yavar - The Sidekick AI Wrapper

> **Now with Modular Plugin Architecture!** Easily add support for new websites and use cases.

## What it does

**Keyboard shortcuts:**
- `Cmd+Space` (Mac) / `Ctrl+Space` (Win) - Toggle sidebar
- `Cmd+H` / `Ctrl+H` - Copy selected text to clipboard
- `Cmd+Shift+I` / `Ctrl+Shift+I` - Capture screenshot
- `Cmd+Shift+L` / `Ctrl+Shift+L` - Generate GitHub learning prompt

**GitHub analysis:**
- On any GitHub repo, press `Cmd+Shift+L` to generate a structured learning prompt
- Automatically scans repository structure and README
- Creates a formatted prompt with file tree and context

**Floating menu:**
- Select text → quick actions appear (Copy, Explain with AI)

## Plugin Architecture 🆕

Yavar now supports **plugins** - modular extensions that activate on specific websites:

### Current Plugins

| Plugin | Activates On | Purpose |
|--------|-------------|---------|
| GitHub Analyzer | `github.com/*` | Repository structure scanning + README extraction |

### Future Plugins (Examples)

- **Stack Overflow Helper** - Extract code snippets and error context
- **MDN Summarizer** - Create concise API references from documentation
- **YouTube Analyzer** - Extract and summarize video transcripts
- **Documentation Crawler** - Build context from multiple doc pages

Want to create a plugin? See **[PLUGINS.md](PLUGINS.md)** for the complete guide!

## Installation

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `Yavar-Extension` folder

## Project Structure

```
Yavar-Extension/
├── src/
│   ├── plugins/                    # 🆕 Modular plugin system
│   │   ├── base-plugin.js          # Abstract base class
│   │   ├── plugin-manager.js       # Plugin registry & lifecycle
│   │   └── github-analyzer-plugin.js
│   ├── content.js                  # Main content script + plugin loader
│   ├── background.js               # Service worker
│   ├── sidepanel.js                # Sidebar UI
│   └── ai-bridge.js                # Auto-submit to AI chatbots
├── styles/
├── manifest.json
├── QWEN.md                         # Technical documentation
└── PLUGINS.md                      # Plugin development guide 🆕
```

## How It Works

### Core Features

- **Text copy:** Uses `navigator.clipboard.writeText()` - copies selected text
- **Screenshot:** Uses `chrome.tabs.captureVisibleTab()` - captures visible webpage
- **GitHub analysis:** Uses Git Trees API + DOM scraping for repo structure
- **Auto-submit:** Stores prompts in session storage, injects into AI chatbots

### Plugin System

Plugins are self-contained modules that:

1. **Extend `BasePlugin`** - Provides common interface and utilities
2. **Define match patterns** - URLs where plugin activates
3. **Implement actions** - Handle messages from background/sidepanel
4. **Auto-initialize** - Load when user visits matching domain

Example plugin structure:

```javascript
import { BasePlugin } from './base-plugin.js';

export class MyPlugin extends BasePlugin {
  constructor() {
    super({
      name: 'My Plugin',
      matchPatterns: ['*://example.com/*'],
      icon: '🚀'
    });
  }

  async onInit() {
    // Called when plugin activates
  }

  handleMessage(action, payload) {
    // Handle messages from sidepanel
  }
}
```

See **[PLUGINS.md](PLUGINS.md)** for the complete plugin development guide.

## AI Platforms Supported

| Platform | URL | Auto-Support |
|----------|-----|--------------|
| ChatGPT | `https://chatgpt.com` | ✅ |
| Claude | `https://claude.ai` | ✅ |
| Gemini | `https://gemini.google.com` | ✅ |
| Bing Chat | `https://www.bing.com/chat` | ✅ |

## Development

### No Build Step

This is a vanilla JavaScript extension with no bundling. Changes are reflected immediately after reloading:

1. Go to `chrome://extensions/`
2. Click the refresh icon on Yavar

### Debugging

- **Content scripts:** Browser DevTools → Console
- **Background worker:** `chrome://extensions/` → "Inspect views: background page"
- **Sidebar:** Right-click sidebar → Inspect

### Testing Plugins

1. Navigate to a matching URL (e.g., `github.com`)
2. Check console for `[Plugin:GitHub Analyzer] Initialized`
3. Press `Cmd+Shift+L` to test GitHub analysis
4. Verify output in sidebar

## Key Changes (v2.0)

### 🆕 Plugin Architecture

- Modular design - plugins activate only on specific domains
- Easy to add new website support without modifying core code
- Base plugin class provides common interface
- Plugin manager handles lifecycle and message routing

### 🆕 GitHub Analyzer Plugin

- Refactored from standalone script to plugin module
- Uses Git Trees API (no token required)
- Automatic branch detection (`main` → `master` fallback)
- Formatted file tree output with folder structure

### 🗑️ Removed

- GitHub token requirement (no longer needed)
- `github-api.js` file (replaced by plugin)
- Token settings UI (simplified settings)

## License

MIT

## Contributing

Want to add a new plugin? See **[PLUGINS.md](PLUGINS.md)** for the development guide!
