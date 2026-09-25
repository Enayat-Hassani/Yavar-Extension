import { test } from 'node:test';
import assert from 'node:assert/strict';

function mockChrome(aiModels) {
  const calls = [];
  globalThis.chrome = {
    tabs: { TAB_ID_NONE: -1 },
    storage: { sync: { get: async () => ({ aiModels }) } },
    declarativeNetRequest: {
      getSessionRules: async () => [{ id: 7 }],
      updateSessionRules: async (arg) => { calls.push(arg); }
    }
  };
  return calls;
}

const { syncFrameRules } = await import('../src/utils/frameRules.js');

test('rule only targets side-panel sub-frames of the chat sites', async () => {
  const calls = mockChrome([
    { id: 'claude', url: 'https://claude.ai', custom: false },
    { id: 'custom_1', url: 'https://www.perplexity.ai/search', custom: true },
    { id: 'custom_2', url: 'not a url', custom: true }
  ]);
  await syncFrameRules();

  assert.equal(calls.length, 1);
  const { removeRuleIds, addRules } = calls[0];
  assert.deepEqual(removeRuleIds, [7]);
  assert.equal(addRules.length, 1);

  const { condition, action } = addRules[0];
  assert.deepEqual(condition.tabIds, [-1]);
  assert.deepEqual(condition.resourceTypes, ['sub_frame']);
  assert.ok(!condition.resourceTypes.includes('main_frame'));
  assert.deepEqual(
    condition.requestDomains.sort(),
    ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'www.perplexity.ai'].sort()
  );
  assert.ok(!('urlFilter' in condition));
  assert.deepEqual(
    action.responseHeaders.map(h => h.header).sort(),
    ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options']
  );
});
