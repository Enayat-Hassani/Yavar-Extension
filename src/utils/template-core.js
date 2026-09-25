// Prompt template core, shared by every part of Yavar.
//
// A classic script (no import/export), so the content script can load it via
// the manifest (content scripts can't use ES imports), while extension pages
// get it through utils/templates.js, which imports this file for its side
// effect and re-exports the API. One copy of the defaults and the expander.
//
// Supported placeholders (all optional, missing ones expand to ''):
//   {{selection}} — the text the user selected
//   {{page}}      — readable text of the current page
//   {{clipboard}} — the system clipboard contents
//   {{repo}}      — owner/repo of the GitHub repo in the active tab
//   {{url}}       — the current page URL
//   {{title}}     — the current page title

(function () {
  if (globalThis.YavarTemplateCore) return;

  const DEFAULT_TEMPLATES = [
    { id: 'send',      name: 'Send',            icon: '➤', menu: true,  body: '{{selection}}' },
    { id: 'explain',   name: 'Explain',         icon: '?', menu: true,  primary: true, body: 'Explain this to me using "Guided Learning" mode:\n\n{{selection}}' },
    { id: 'summarize', name: 'Summarize',       icon: '≡', menu: true,  body: 'Summarize the key points of this clearly and concisely:\n\n{{selection}}' },
    { id: 'improve',   name: 'Improve writing', icon: '✎', menu: false, body: 'Improve the clarity, grammar and flow of this text. Return only the rewritten version:\n\n{{selection}}' },
    { id: 'translate', name: 'Translate → EN',  icon: '文', menu: false, body: 'Translate this into natural English. Return only the translation:\n\n{{selection}}' },
    { id: 'ask-page',  name: 'Ask about page',  icon: '◆', menu: false, body: 'Here is the page I\'m reading:\n\n{{page}}\n\n---\nAnswer my question about it: ' },
  ];

  // Names of every placeholder the expander knows how to fill
  const TEMPLATE_VARS = ['selection', 'page', 'clipboard', 'repo', 'url', 'title'];

  // Expand {{vars}} in `body` using values from `ctx`. Getters only run for
  // placeholders that appear, so the clipboard/page are read only when asked.
  async function expandTemplate(body, ctx = {}) {
    const getters = {
      selection: () => ctx.selection ?? '',
      page:      () => ctx.page ?? '',
      repo:      () => ctx.repo ?? '',
      url:       () => ctx.url ?? '',
      title:     () => ctx.title ?? '',
      clipboard: async () => {
        if (ctx.clipboard != null) return ctx.clipboard;
        try { return await navigator.clipboard.readText(); } catch { return ''; }
      },
    };
  
    // Resolve every referenced value first, then substitute in ONE pass, so
    // text inside a value (e.g. a selection containing "{{page}}") is never expanded.
    const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
    const values = {};
    for (const name of new Set([...body.matchAll(PLACEHOLDER)].map(m => m[1]))) {
      const getter = getters[name];
      values[name] = getter ? String(await getter() ?? '') : '';
    }
    const out = body.replace(PLACEHOLDER, (_, name) => values[name]);
    return out.trim();
  }

  // Which placeholders a template references (to decide what context to gather)
  function varsInTemplate(body) {
    return [...new Set([...String(body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
  }

  async function loadTemplates() {
    try {
      const { promptTemplates } = await chrome.storage.sync.get('promptTemplates');
      if (Array.isArray(promptTemplates) && promptTemplates.length) return promptTemplates;
    } catch (e) { /* fall through to defaults */ }
    return DEFAULT_TEMPLATES.slice();
  }

  globalThis.YavarTemplateCore = Object.freeze({
    DEFAULT_TEMPLATES, TEMPLATE_VARS, expandTemplate, varsInTemplate, loadTemplates
  });
})();
