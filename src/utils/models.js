// The built-in chat models. Stored in sync storage as `aiModels` (with any
// custom ones the user adds in Settings); `currentModelId` is the one open.
export const DEFAULT_MODELS = [
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', icon: '✨', enabled: true, custom: false },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', icon: '🤖', enabled: true, custom: false },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', icon: '🧠', enabled: true, custom: false }
];

export async function loadModels() {
  const { aiModels } = await chrome.storage.sync.get('aiModels');
  return Array.isArray(aiModels) && aiModels.length ? aiModels : DEFAULT_MODELS.map(m => ({ ...m }));
}
