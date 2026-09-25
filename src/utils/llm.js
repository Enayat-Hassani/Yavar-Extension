// Answers from model APIs that speak the OpenAI chat format: OpenRouter, a
// gateway on this computer (OmniRoute, Ollama, LM Studio…), or any other
// compatible endpoint. A route is the list of models to try in order: the
// local gateway, then OpenRouter's free models, then one paid model. Each
// failure (rate limit, outage, no first token in time, empty answer) moves
// on to the next.

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

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
  }
  return { deltas, done, rest };
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Stream one model's answer; onDelta gets the whole text so far
export async function streamChat({ base, key, model, messages, signal, onDelta, fetchImpl = fetch }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (base === OPENROUTER_BASE) headers['X-Title'] = 'Yavar';
  const res = await fetchImpl(`${base}/chat/completions`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ model, messages, stream: true })
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
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSSE(buf + decoder.decode(value, { stream: true }));
    buf = parsed.rest;
    if (parsed.deltas.length) {
      text += parsed.deltas.join('');
      onDelta?.(text);
    }
    if (parsed.done) break;
  }
  return text;
}

// Try each model on the route until one answers. onAttempt(step, i) fires
// before each try, so the caller can clear a half-streamed answer that
// failed. Stopping (signal) ends the whole route, not just one model.
export async function askRoute(route, messages, { signal, onDelta, onAttempt, fetchImpl = fetch } = {}) {
  if (!route.length) throw new Error('no API models set up: add an OpenRouter key or a local gateway in Settings');
  const failures = [];
  const now = Date.now();
  const awake = route.filter(s => !(resting.get(`${s.base} ${s.model}`) > now));
  const tries = awake.length ? awake : route;
  for (let i = 0; i < tries.length; i++) {
    const step = tries[i];
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    onAttempt?.(step, i);
    const ctrl = new AbortController();
    const onStop = () => ctrl.abort();
    signal?.addEventListener('abort', onStop, { once: true });
    let started = false;
    const firstToken = setTimeout(() => { if (!started) ctrl.abort(); }, FIRST_TOKEN_MS);
    try {
      const text = await streamChat({
        ...step, messages, signal: ctrl.signal, fetchImpl,
        onDelta: (t) => { started = true; onDelta?.(t); }
      });
      if (!text.trim()) throw new Error('empty answer');
      return { text, step };
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
