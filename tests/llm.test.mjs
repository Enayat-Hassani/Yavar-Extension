import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE, buildRoute, isFreeModel, askRoute, OPENROUTER_BASE, monthKey, spentThisMonth, addSpend, callCost } from '../src/utils/llm.js';

// A fetch that answers each model from a script: a status, or SSE text
function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const { model } = JSON.parse(init.body);
    calls.push(model);
    const r = script[model];
    if (typeof r === 'number') return new Response('{"error":{"message":"busy"}}', { status: r });
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return new Response(r, { status: 200 });
  };
  return { impl, calls };
}

const sse = (...parts) => parts.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
const step = (model, extra = {}) => ({ label: model, base: OPENROUTER_BASE, key: 'k', model, paid: false, ...extra });

test('parseSSE joins deltas, skips comments and keeps a partial line', () => {
  const { deltas, done, rest } = parseSSE(': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}\ndata: {"choi');
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(done, false);
  assert.equal(rest, 'data: {"choi');
  assert.equal(parseSSE('data: [DONE]\n').done, true);
});

test('parseSSE raises an error sent inside the stream', () => {
  assert.throws(() => parseSSE('data: {"error":{"code":429,"message":"rate limited"}}\n'), /rate limited/);
});

test('route order: local gateway, free models, then the paid one', () => {
  const route = buildRoute({
    gatewayBase: 'http://localhost:20128/v1/', gatewayModel: 'auto', gatewayKey: '',
    openrouterKey: 'k', freeModels: ['a:free', 'b:free'], paidModel: 'anthropic/claude-haiku-4.5'
  });
  assert.deepEqual(route.map(s => [s.model, s.paid]), [['auto', false], ['a:free', false], ['b:free', false], ['anthropic/claude-haiku-4.5', true]]);
  assert.equal(route[0].base, 'http://localhost:20128/v1');
});

test('no OpenRouter key: OpenRouter models are left out', () => {
  assert.deepEqual(buildRoute({ openrouterKey: '', freeModels: ['a:free'], paidModel: 'p', gatewayBase: '', gatewayModel: '' }), []);
});

test('isFreeModel by suffix or zero pricing', () => {
  assert.equal(isFreeModel({ id: 'x/y:free' }), true);
  assert.equal(isFreeModel({ id: 'x/y', pricing: { prompt: '0', completion: '0' } }), true);
  assert.equal(isFreeModel({ id: 'x/y', pricing: { prompt: '0.000001', completion: '0' } }), false);
  assert.equal(isFreeModel({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }), false);
});

test('falls through rate limits and empty answers to the next model', async () => {
  const { impl, calls } = fakeFetch({ 'a:free': 429, 'b:free': sse(''), paid: sse('Hi', ' there') });
  const seen = [];
  const { text, step: used } = await askRoute([step('a:free'), step('b:free'), step('paid', { paid: true })],
    [{ role: 'user', content: 'x' }], { fetchImpl: impl, onDelta: t => seen.push(t) });
  assert.deepEqual(calls, ['a:free', 'b:free', 'paid']);
  assert.equal(text, 'Hi there');
  assert.equal(used.model, 'paid');
  assert.deepEqual(seen, ['Hi there']);
});

test('reports every failure when nothing answers', async () => {
  const { impl } = fakeFetch({ a: 503, b: 401 });
  await assert.rejects(askRoute([step('a'), step('b')], [], { fetchImpl: impl }), /a: 503: busy; b: 401: busy/);
});

test('stopping ends the route instead of trying the next model', async () => {
  const { impl, calls } = fakeFetch({ a: 'hang', b: sse('no') });
  const ctrl = new AbortController();
  const p = askRoute([step('a'), step('b')], [], { fetchImpl: impl, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, { name: 'AbortError' });
  assert.deepEqual(calls, ['a']);
});

test('an empty route explains what to set up', async () => {
  await assert.rejects(askRoute([], []), /OpenRouter key or a local gateway/);
});

test('a rate-limited model rests, so the next question skips it', async () => {
  const { impl, calls } = fakeFetch({ 'rl:free': 429, 'ok:free': sse('fine') });
  const route = [step('rl:free'), step('ok:free')];
  await askRoute(route, [], { fetchImpl: impl });
  await askRoute(route, [], { fetchImpl: impl });
  assert.deepEqual(calls, ['rl:free', 'ok:free', 'ok:free']);
});

test('when every model is resting, all are tried anyway', async () => {
  const { impl, calls } = fakeFetch({ 'x:free': 429 });
  await assert.rejects(askRoute([step('x:free')], [], { fetchImpl: impl }));
  await assert.rejects(askRoute([step('x:free')], [], { fetchImpl: impl }));
  assert.deepEqual(calls, ['x:free', 'x:free']);
});

test('parseSSE keeps the usage OpenRouter sends with the last chunk', () => {
  const { usage } = parseSSE('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.0004}}\n');
  assert.deepEqual(usage, { prompt_tokens: 10, completion_tokens: 5, cost: 0.0004 });
});

test('skip() passes over a model with its reason, and the answer carries usage', async () => {
  const usageChunk = 'data: {"choices":[],"usage":{"cost":0.002}}\n\n';
  const { impl, calls } = fakeFetch({ 'f:free': 503, paid: sse('ok').replace('data: [DONE]', usageChunk + 'data: [DONE]') });
  const route = [step('f:free'), step('paid', { paid: true })];
  await assert.rejects(askRoute(route, [], { fetchImpl: impl, skip: s => (s.paid ? 'budget used up' : null) }), /paid: budget used up/);
  assert.deepEqual(calls, ['f:free']);
  const r = await askRoute(route, [], { fetchImpl: impl });
  assert.equal(r.usage.cost, 0.002);
});

test('spending adds up within a month and starts again in the next', () => {
  const sep = new Date(2026, 8, 26), oct = new Date(2026, 9, 1);
  assert.equal(monthKey(sep), '2026-09');
  let spend = addSpend(null, 0.5, sep);
  spend = addSpend(spend, 0.25, sep);
  assert.deepEqual(spend, { month: '2026-09', usd: 0.75 });
  assert.equal(spentThisMonth(spend, oct), 0);
  assert.deepEqual(addSpend(spend, 0.1, oct), { month: '2026-10', usd: 0.1 });
});

test('cost: OpenRouter figure first, else tokens times prices', () => {
  assert.equal(callCost({ cost: 0.01, prompt_tokens: 1e6 }, { prompt: '1' }), 0.01);
  assert.equal(callCost({ prompt_tokens: 1000, completion_tokens: 500 }, { prompt: '0.000001', completion: '0.000005' }), 0.0035);
  assert.equal(callCost(null, null), 0);
});
