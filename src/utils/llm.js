// Answers from model APIs that speak the OpenAI chat format: OpenRouter, a
// gateway on this computer (OmniRoute, Ollama, LM Studio…), or any other
// compatible endpoint. A route is the list of models to try in order: the
// local gateway, then OpenRouter's free models, then one paid model. Each
// failure (rate limit, outage, no first token in time, empty answer) moves
// on to the next.

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// The paid model stops for the month once this much is spent (USD)
export const DEFAULT_MONTHLY_CAP = 3;

// Free models can sit in a queue; give up on one that hasn't started by then
const FIRST_TOKEN_MS = 25000;

// A model that said "rate limited" (429) is skipped for a minute, so each
// question doesn't wait on it again. When every model is resting, all are tried.
const REST_MS = 60000;
const resting = new Map();   // "base model" -> until (ms)

// Settings (sync, merged into `settings`) and keys (local only, never synced)
export async function loadApiConfig() {
  const [{ settings = {} }, keys] = await Promise.all([
    chrome.storage.sync.get('settings'),
    chrome.storage.local.get(['openrouterKey', 'gatewayKey'])
  ]);
  return {
    gatewayBase: settings.apiGatewayBase || '',
    gatewayModel: settings.apiGatewayModel || '',
    freeModels: Array.isArray(settings.apiFreeModels) ? settings.apiFreeModels : [],
    paidModel: settings.apiPaidModel || '',
    monthlyCap: Number.isFinite(settings.apiMonthlyCap) ? settings.apiMonthlyCap : DEFAULT_MONTHLY_CAP,
    openrouterKey: keys.openrouterKey || '',
    gatewayKey: keys.gatewayKey || ''
  };
}

export function buildRoute(cfg) {
  const route = [];
  if (cfg.gatewayBase && cfg.gatewayModel) {
    route.push({ label: `${cfg.gatewayModel} (local)`, base: cfg.gatewayBase.replace(/\/+$/, ''), key: cfg.gatewayKey, model: cfg.gatewayModel, paid: false });
  }
  if (cfg.openrouterKey) {
    for (const model of cfg.freeModels) route.push({ label: model, base: OPENROUTER_BASE, key: cfg.openrouterKey, model, paid: false });
    if (cfg.paidModel) route.push({ label: cfg.paidModel, base: OPENROUTER_BASE, key: cfg.openrouterKey, model: cfg.paidModel, paid: true });
  }
  return route;
}

// A model in OpenRouter's /models listing that costs nothing to call
export function isFreeModel(m) {
  if (!m?.id) return false;
  if (m.id.endsWith(':free')) return true;
  return Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
}

// Split a server-sent-events buffer into the text deltas it completes.
// Returns what's left over (a partial line) to prepend to the next chunk.
export function parseSSE(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop();
  const deltas = [];
  let done = false;
  let usage = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;   // blank lines and ": keep-alive" comments
    const data = line.slice(5).trim();
    if (data === '[DONE]') { done = true; continue; }
    let obj;
    try { obj = JSON.parse(data); } catch (e) { continue; }
    if (obj.error) throw new ApiError(obj.error.code || 0, obj.error.message || 'the model reported an error');
    const d = obj.choices?.[0]?.delta?.content;
    if (d) deltas.push(d);
    if (obj.usage) usage = obj.usage;   // OpenRouter sends it with the last chunk
  }
  return { deltas, done, rest, usage };
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Stream one model's answer; onDelta gets the whole text so far. Resolves
// to { text, usage } (usage: tokens, and on OpenRouter the cost in USD).
export async function streamChat({ base, key, model, messages, signal, onDelta, fetchImpl = fetch }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (base === OPENROUTER_BASE) headers['X-Title'] = 'Yavar';
  const res = await fetchImpl(`${base}/chat/completions`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ model, messages, stream: true, ...(base === OPENROUTER_BASE ? { usage: { include: true } } : {}) })
  });
  if (!res.ok) {
    let msg = '';
    try {
      const body = await res.text();
      try { msg = JSON.parse(body).error?.message || ''; } catch (e) { msg = body.slice(0, 200); }
    } catch (e) { /* no body */ }
    throw new ApiError(res.status, `${res.status}${msg ? ': ' + msg : ''}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSSE(buf + decoder.decode(value, { stream: true }));
    buf = parsed.rest;
    if (parsed.usage) usage = parsed.usage;
    if (parsed.deltas.length) {
      text += parsed.deltas.join('');
      onDelta?.(text);
    }
    if (parsed.done) break;
  }
  return { text, usage };
}

// Try each model on the route until one answers. onAttempt(step, i) fires
// before each try, so the caller can clear a half-streamed answer that
// failed. skip(step) may return a reason not to try a model (the budget).
// Stopping (signal) ends the whole route, not just one model.
export async function askRoute(route, messages, { signal, onDelta, onAttempt, skip, fetchImpl = fetch } = {}) {
  if (!route.length) throw new Error('no API models set up: add an OpenRouter key or a local gateway in Settings');
  const failures = [];
  const now = Date.now();
  const awake = route.filter(s => !(resting.get(`${s.base} ${s.model}`) > now));
  const tries = awake.length ? awake : route;
  for (let i = 0; i < tries.length; i++) {
    const step = tries[i];
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    const skipped = skip?.(step);
    if (skipped) { failures.push(`${step.label}: ${skipped}`); continue; }
    onAttempt?.(step, i);
    const ctrl = new AbortController();
    const onStop = () => ctrl.abort();
    signal?.addEventListener('abort', onStop, { once: true });
    let started = false;
    const firstToken = setTimeout(() => { if (!started) ctrl.abort(); }, FIRST_TOKEN_MS);
    try {
      const { text, usage } = await streamChat({
        ...step, messages, signal: ctrl.signal, fetchImpl,
        onDelta: (t) => { started = true; onDelta?.(t); }
      });
      if (!text.trim()) throw new Error('empty answer');
      return { text, step, usage };
    } catch (e) {
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
      if (e.status === 429) resting.set(`${step.base} ${step.model}`, Date.now() + REST_MS);
      failures.push(`${step.label}: ${ctrl.signal.aborted ? 'no answer in time' : e.message}`);
    } finally {
      clearTimeout(firstToken);
      signal?.removeEventListener('abort', onStop);
    }
  }
  throw new Error('every model failed. ' + failures.join('; '));
}

// ---- The monthly budget for the paid model ----
// Spending is kept per calendar month on this device: { month: 'YYYY-MM', usd }

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// This month's total (a new month starts from zero)
export const spentThisMonth = (spend, now = new Date()) => (spend?.month === monthKey(now) ? spend.usd || 0 : 0);

export const addSpend = (spend, usd, now = new Date()) => ({ month: monthKey(now), usd: spentThisMonth(spend, now) + usd });

// What a call cost: OpenRouter's own figure, or tokens × the model's prices
export function callCost(usage, pricing) {
  if (!usage) return 0;
  if (Number.isFinite(usage.cost)) return usage.cost;
  if (!pricing) return 0;
  return (usage.prompt_tokens || 0) * Number(pricing.prompt || 0) + (usage.completion_tokens || 0) * Number(pricing.completion || 0);
}

let pricingCache = null;
async function modelPricing(model) {
  if (!pricingCache) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`);
      pricingCache = new Map(((await res.json()).data || []).map(m => [m.id, m.pricing]));
    } catch (e) {
      return null;
    }
  }
  return pricingCache.get(model) || null;
}

export async function loadSpend() {
  return (await chrome.storage.local.get('apiSpend')).apiSpend || null;
}

// askRoute with the budget applied: the paid model is skipped once this
// month's spending reaches the cap, and what it costs is added up.
// Resolves to { text, step, cost }.
export async function askWithBudget(route, messages, opts = {}) {
  const cfg = await loadApiConfig();
  const spent = spentThisMonth(await loadSpend());
  const result = await askRoute(route, messages, {
    ...opts,
    skip: (step) => (step.paid && spent >= cfg.monthlyCap
      ? `skipped, this month's $${cfg.monthlyCap.toFixed(2)} budget for the paid model is used up` : null)
  });
  let cost = 0;
  if (result.step.paid) {
    cost = callCost(result.usage, result.usage && !Number.isFinite(result.usage.cost) ? await modelPricing(result.step.model) : null);
    if (cost) await chrome.storage.local.set({ apiSpend: addSpend(await loadSpend(), cost) });
  }
  return { ...result, cost };
}
