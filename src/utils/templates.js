// Prompt Templates — reusable prompt wrappers with {{variables}}.
// Shared by the floating menu (content.js), the sidepanel, and the options page.
//
// Supported placeholders (all optional, missing ones expand to ''):
//   {{selection}} — the text the user selected
//   {{page}}      — readable text of the current page
//   {{clipboard}} — the system clipboard contents
//   {{repo}}      — owner/repo of the GitHub repo in the active tab
//   {{url}}       — the current page URL
//   {{title}}     — the current page title

export const DEFAULT_TEMPLATES = [
  { id: 'send',      name: 'Send',            icon: '➤', menu: true,  body: '{{selection}}' },
  { id: 'explain',   name: 'Explain',         icon: '?', menu: true,  primary: true, body: 'Explain this to me using "Guided Learning" mode:\n\n{{selection}}' },
  { id: 'summarize', name: 'Summarize',       icon: '≡', menu: true,  body: 'Summarize the key points of this clearly and concisely:\n\n{{selection}}' },
  { id: 'improve',   name: 'Improve writing', icon: '✎', menu: false, body: 'Improve the clarity, grammar and flow of this text. Return only the rewritten version:\n\n{{selection}}' },
  { id: 'translate', name: 'Translate → EN',  icon: '文', menu: false, body: 'Translate this into natural English. Return only the translation:\n\n{{selection}}' },
  { id: 'ask-page',  name: 'Ask about page',  icon: '◆', menu: false, body: 'Here is the page I\'m reading:\n\n{{page}}\n\n---\nAnswer my question about it: ' },
];

// Names of every placeholder this module knows how to fill.
export const TEMPLATE_VARS = ['selection', 'page', 'clipboard', 'repo', 'url', 'title'];

// Expand {{vars}} in `body` using values from `ctx`. Getters are only invoked
// for placeholders that actually appear, so we never read the clipboard/page
// unless the template asks for it.
export async function expandTemplate(body, ctx = {}) {
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

  const used = new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]));
  let out = body;
  for (const name of used) {
    const getter = getters[name];
    const value = getter ? await getter() : '';
    out = out.replace(new RegExp('\\{\\{\\s*' + name + '\\s*\\}\\}', 'g'), value);
  }
  return out.trim();
}

// Which placeholders a template references (used to decide what context to gather).
export function varsInTemplate(body) {
  return [...new Set([...String(body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
}

export async function loadTemplates() {
  try {
    const { promptTemplates } = await chrome.storage.sync.get('promptTemplates');
    if (Array.isArray(promptTemplates) && promptTemplates.length) return promptTemplates;
  } catch { /* fall through to defaults */ }
  return DEFAULT_TEMPLATES.slice();
}

export async function saveTemplates(list) {
  await chrome.storage.sync.set({ promptTemplates: list });
}
