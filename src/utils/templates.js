// Prompt templates for extension pages (options, side panel). The shared
// implementation lives in template-core.js, which the content script also
// loads; importing it here runs it and defines globalThis.YavarTemplateCore.

import './template-core.js';

export const {
  DEFAULT_TEMPLATES, TEMPLATE_VARS, expandTemplate, varsInTemplate, loadTemplates
} = globalThis.YavarTemplateCore;

export async function saveTemplates(list) {
  await chrome.storage.sync.set({ promptTemplates: list });
}
