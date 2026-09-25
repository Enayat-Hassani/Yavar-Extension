// Frame Rules - let the AI chat sites load inside the Yavar panel.
//
// ChatGPT, Claude and Gemini send X-Frame-Options / CSP frame-ancestors headers
// that block iframing. We strip those headers, but ONLY for sub-frames loaded
// by the side panel: requests from extension pages have no tab, so
// `tabIds: [TAB_ID_NONE]` keeps the rule from ever touching the user's normal
// tabs or letting other websites frame these (logged-in) chat sites.
// tabIds is only allowed on session rules, so we (re)register them on every
// service-worker start.

const RULE_ID_BASE = 1000;
const BUILT_IN_DOMAINS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com'];
const STRIPPED_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only'
];

// Hostnames of the user's custom models (so "Add model" sites can be framed too).
async function customModelDomains() {
  try {
    const { aiModels } = await chrome.storage.sync.get('aiModels');
    return (aiModels || [])
      .filter(m => m.custom && m.url)
      .map(m => { try { return new URL(m.url).hostname; } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function syncFrameRules() {
  const domains = [...new Set([...BUILT_IN_DOMAINS, ...(await customModelDomains())])];
  const action = {
    type: 'modifyHeaders',
    responseHeaders: STRIPPED_HEADERS.map(header => ({ header, operation: 'remove' }))
  };
  // Chrome's side panel: requests from extension pages that aren't tabs
  const rule = {
    id: RULE_ID_BASE,
    priority: 1,
    action,
    condition: {
      requestDomains: domains,
      resourceTypes: ['sub_frame'],
      tabIds: [chrome.tabs.TAB_ID_NONE]
    }
  };

  // Opera's sidebar and the fallback panel window: frames loaded by Yavar's
  // own pages (initiator chrome-extension://<id>), whatever tab they're in
  const ownPagesRule = {
    id: RULE_ID_BASE + 1,
    priority: 1,
    action,
    condition: {
      requestDomains: domains,
      resourceTypes: ['sub_frame'],
      initiatorDomains: [chrome.runtime.id]
    }
  };

  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map(r => r.id),
      addRules: [rule, ownPagesRule]
    });
  } catch (error) {
    console.error('[Yavar] Failed to register frame rules:', error);
  }
}
