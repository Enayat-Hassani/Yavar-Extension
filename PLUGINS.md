# Yavar Plugin System

## Overview

Yavar uses a modular plugin architecture that allows you to add support for different websites and use cases. Each plugin is a self-contained module that activates only on specific domains.

## Architecture

```
src/
├── plugins/
│   ├── base-plugin.js           # Abstract base class all plugins extend
│   ├── plugin-manager.js        # Registry and lifecycle manager
│   └── github-analyzer-plugin.js # GitHub.com analyzer plugin
├── content.js                   # Main content script + plugin loader
└── ...
```

## Creating a New Plugin

### 1. Extend BasePlugin

Create a new file in `src/plugins/your-plugin.js`:

```javascript
import { BasePlugin } from './base-plugin.js';

export class YourPlugin extends BasePlugin {
  constructor() {
    super({
      name: 'Your Plugin Name',
      description: 'What your plugin does',
      version: '1.0.0',
      matchPatterns: ['*://example.com/*', '*://*.example.com/*'],
      icon: '🚀'
    });
  }

  async onInit() {
    // Called when plugin activates on a page
    this.addMessageListener();
  }

  addMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.plugin !== this.name) return false;

      switch (request.action) {
        case 'your_action':
          this.doSomething()
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ error: err.message }));
          return true;

        case 'get_plugin_info':
          sendResponse(this.getInfo());
          return true;

        default:
          return false;
      }
    });
  }

  async doSomething() {
    // Your plugin logic here
    return { success: true, data: 'result' };
  }
}

// Auto-initialize on matching domains
if (window.location.hostname.includes('example.com')) {
  const plugin = new YourPlugin();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => plugin.init());
  } else {
    plugin.init();
  }
}
```

### 2. Register the Plugin

Add your plugin to `src/content.js`:

```javascript
import { pluginManager } from './plugins/plugin-manager.js';
import { GitHubAnalyzerPlugin } from './plugins/github-analyzer-plugin.js';
import { YourPlugin } from './plugins/your-plugin.js'; // Add this

// ...

async initializePlugins() {
  try {
    // Register all available plugins
    pluginManager.register(new GitHubAnalyzerPlugin());
    pluginManager.register(new YourPlugin()); // Add this
    
    // Initialize plugins that match current URL
    await pluginManager.initializeAll();
  } catch (error) {
    console.error('[Yavar] Plugin initialization failed:', error);
  }
}
```

## BasePlugin API

### Properties

- `name` - Unique plugin identifier
- `description` - What the plugin does
- `version` - Semver version string
- `matchPatterns` - URL patterns to activate on
- `icon` - Emoji icon for UI
- `enabled` - Whether plugin is enabled

### Methods

#### `shouldActivate()`
Returns `true` if current URL matches plugin patterns.

#### `async init()`
Initializes the plugin. Calls `onInit()` subclass method.

#### `async onInit()`
Override this in your subclass for custom initialization.

#### `handleMessage(action, payload)`
Override to handle messages from background/sidepanel.

#### `getInfo()`
Returns plugin metadata object.

#### `enable()` / `disable()`
Enable or disable the plugin.

#### `notify(message, type)`
Show notification in sidepanel. Types: `'info'`, `'success'`, `'error'`, `'warning'`.

#### `sendToSidepanel(data)`
Send data to sidepanel (custom events).

#### `async setSessionData(key, value)`
Store data in session storage (prefixed with plugin name).

#### `async getSessionData(key)`
Retrieve data from session storage.

## Match Patterns

Patterns use glob-like syntax:

- `*://example.com/*` - All pages on example.com
- `*://*.example.com/*` - All subdomains
- `*://example.com/specific/path` - Specific path
- `https://api.*.com/*` - Wildcard subdomain

## Message Flow

```
Sidepanel/Background
       ↓
   chrome.tabs.sendMessage(tabId, {
     plugin: 'Your Plugin',
     action: 'your_action',
     data: { ... }
   })
       ↓
Plugin Manager (content.js)
       ↓
Routes to YourPlugin.handleMessage()
       ↓
YourPlugin processes and responds
```

## Plugin Lifecycle

1. **Registration**: Plugin instance created and registered with `PluginManager`
2. **Activation**: `shouldActivate()` checks if current URL matches
3. **Initialization**: `init()` called, which calls `onInit()`
4. **Ready**: Plugin listens for messages and user interactions
5. **Navigation**: On SPA navigation (Turbo, etc.), re-initialize

## Example: Stack Overflow Plugin

```javascript
// src/plugins/stackoverflow-plugin.js
import { BasePlugin } from './base-plugin.js';

export class StackOverflowPlugin extends BasePlugin {
  constructor() {
    super({
      name: 'Stack Overflow Helper',
      description: 'Extract code snippets and error messages from Stack Overflow',
      version: '1.0.0',
      matchPatterns: ['*://stackoverflow.com/*', '*://*.stackoverflow.com/*'],
      icon: '📚'
    });
  }

  async onInit() {
    this.addMessageListener();
    this.extractCodeSnippets();
  }

  addMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.plugin !== this.name) return false;

      switch (request.action) {
        case 'get_question_context':
          this.getQuestionContext()
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ error: err.message }));
          return true;

        default:
          return false;
      }
    });
  }

  async getQuestionContext() {
    const question = document.querySelector('.question .js-question-title')?.innerText;
    const codeBlocks = Array.from(document.querySelectorAll('pre code'))
      .map(block => block.innerText);
    
    return {
      question,
      codeBlocks,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
  }

  extractCodeSnippets() {
    // Auto-extract code for quick copying
    console.log('[StackOverflow Plugin] Code snippets extracted');
  }
}

// Auto-init
if (window.location.hostname.includes('stackoverflow.com')) {
  const plugin = new StackOverflowPlugin();
  plugin.init();
}
```

## Best Practices

1. **Keep plugins focused**: One plugin = one website/use case
2. **Graceful degradation**: Plugin should not break if site structure changes
3. **Minimal permissions**: Only request access to necessary domains
4. **Clear naming**: Use descriptive plugin names and action names
5. **Error handling**: Always catch and report errors gracefully
6. **Documentation**: Document all actions and data formats

## Future Plugin Ideas

- **Stack Overflow Helper**: Extract code snippets and error context
- **MDN Docs Summarizer**: Create concise API references
- **YouTube Transcript Analyzer**: Extract and summarize video content
- **Documentation Crawler**: Build context from multiple doc pages
- **CodePen/JSFiddle Saver**: Capture and save code examples
- **API Playground Helper**: Format and explain API responses

## Debugging

Enable verbose logging:

```javascript
// In your plugin
console.log(`[Plugin:${this.name}] Debug info:`, data);
```

View logs in:
- Content script: Browser DevTools → Console
- Background: `chrome://extensions/` → Inspect "background page"
- Sidepanel: Right-click sidebar → Inspect

## Testing

Test your plugin:

1. Navigate to a matching URL
2. Check console for `[Plugin:Your Name] Initialized`
3. Send test message from sidepanel:
   ```javascript
   chrome.tabs.sendMessage(tabId, {
     plugin: 'Your Plugin',
     action: 'test_action'
   });
   ```
4. Verify response in console
