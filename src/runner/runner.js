// Code runner (sandboxed page). The side panel embeds runner.html in an
// iframe and posts { type: 'run', id, lang, code, timeoutMs }. Each run
// happens in a Web Worker so a stuck loop can be terminated. This page has
// no extension APIs, and its opaque origin can't read the extension's data.
//
// Replies to the parent: { type: 'status' | 'output' | 'done', id, ... }

(function () {
  'use strict';

  const PYODIDE_BASE = new URL('lib/pyodide/', location.href).href;
  const MAX_OUTPUT = 50000;

  // ---- Worker sources (stringified into blob workers) ----

  function jsWorkerMain() {
    const fmt = (v) => {
      if (typeof v === 'string') return v;
      if (v instanceof Error) return v.stack || String(v);
      if (typeof v === 'function') return v.toString().split('\n')[0] + ' …';
      try {
        // Each JSON pass needs its own "seen" set for cycle detection
        const makeReplacer = () => {
          const seen = new WeakSet();
          return (k, x) => {
            if (typeof x === 'bigint') return x.toString() + 'n';
            if (x && typeof x === 'object') { if (seen.has(x)) return '[Circular]'; seen.add(x); }
            if (x instanceof Map) return Object.fromEntries(x);
            if (x instanceof Set) return [...x];
            return x;
          };
        };
        // One line when short (like Node's console), indented when long
        const flat = JSON.stringify(v, makeReplacer());
        if (flat === undefined) return String(v);
        if (flat.length <= 72) return flat.replace(/,(?=["\[{\d-]|true|false|null)/g, ', ');
        return JSON.stringify(v, makeReplacer(), 2);
      } catch (e) {
        return String(v);
      }
    };
    const out = (stream) => (...args) => postMessage({ kind: 'out', stream, text: args.map(fmt).join(' ') + '\n' });
    console.log = console.info = console.debug = out('stdout');
    console.warn = console.error = out('stderr');
    console.table = (d) => out('stdout')(d);
    self.onerror = (msg, src, line, col, err) => { out('stderr')(err || msg); };
    self.onunhandledrejection = (e) => { out('stderr')('Uncaught (in promise) ', e.reason); };

    onmessage = async (e) => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const result = await new AsyncFunction(e.data.code)();
        if (result !== undefined) out('stdout')('→', result);
        postMessage({ kind: 'done', ok: true });
      } catch (err) {
        // Point at the learner's line: the async wrapper adds 2 lines on top
        const m = String(err && err.stack || '').match(/<anonymous>:(\d+):(\d+)/);
        const where = m ? ` (line ${Number(m[1]) - 2})` : '';
        const name = err && err.name ? err.name + ': ' : '';
        const msg = `${name}${err && err.message !== undefined ? err.message : err}${where}`;
        out('stderr')(msg);
        postMessage({ kind: 'done', ok: false, error: msg });
      }
    };
  }

  function pyWorkerMain() {
    let py = null;
    const send = (m) => postMessage(m);
    onmessage = async (e) => {
      const { base, code } = e.data;
      try {
        if (!py) {
          send({ kind: 'status', text: 'Loading Python (first run takes a few seconds)…' });
          importScripts(base + 'pyodide.js');
          py = await self.loadPyodide({
            indexURL: base,
            stdout: (t) => send({ kind: 'out', stream: 'stdout', text: t + '\n' }),
            stderr: (t) => send({ kind: 'out', stream: 'stderr', text: t + '\n' })
          });
          py.setStdin({ stdin: () => { throw new Error('input() is not available here: put the values in the code instead'); } });
          send({ kind: 'status', text: '' });
        }
        // Fresh globals per run so earlier snippets don't leak into this one
        const globals = py.globals.get('dict')();
        try {
          const result = await py.runPythonAsync(code, { globals });
          if (result !== undefined && result !== null) {
            send({ kind: 'out', stream: 'stdout', text: '→ ' + (result.toString ? result.toString() : String(result)) + '\n' });
          }
          if (result && result.destroy) result.destroy();
        } finally {
          globals.destroy();
        }
        send({ kind: 'done', ok: true });
      } catch (err) {
        const tb = cleanTraceback(String(err && err.message || err));
        send({ kind: 'out', stream: 'stderr', text: tb + '\n' });
        const last = tb.split('\n').filter(l => /^\w+(Error|Exception|Interrupt|Exit)\b/.test(l)).pop();
        send({ kind: 'done', ok: false, error: last || 'error' });
      }
    };

    // Drop Pyodide's own frames and its install hints, keep the user's frames
    function cleanTraceback(msg) {
      const lines = msg.replace(/^PythonError: /, '').split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*File "\/lib\/python\d+\.zip\//.test(l)) {
          while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1]) && !/^\s*File /.test(lines[i + 1])) i++;
          continue;
        }
        if (/^The module '.*' is included in the Pyodide distribution/.test(l)) {
          out.push('(Only the Python standard library is available in Yavar\'s runner; packages like numpy or requests are not.)');
          break;
        }
        out.push(l.replace('File "<exec>"', 'Your code'));
      }
      return out.join('\n').trim();
    };
  }

  // One blob URL per worker kind, reused for every run (never leaked per run)
  const workerUrls = new Map();
  const workerFrom = (fn) => {
    if (!workerUrls.has(fn)) {
      workerUrls.set(fn, URL.createObjectURL(new Blob([`(${fn.toString()})()`], { type: 'text/javascript' })));
    }
    return new Worker(workerUrls.get(fn));
  };

  // Python stays loaded between runs (loading is the slow part), but is
  // released after a few idle minutes so it doesn't hold ~50-100 MB.
  const PY_IDLE_MS = 5 * 60 * 1000;
  let pyWorker = null;
  let pyIdleTimer = null;

  function armPyIdle() {
    clearTimeout(pyIdleTimer);
    pyIdleTimer = setTimeout(() => {
      if (pyWorker && !(running && running.lang === 'python')) {
        pyWorker.terminate();
        pyWorker = null;
      }
    }, PY_IDLE_MS);
  }
  let running = null;

  const reply = (msg) => window.parent.postMessage(msg, '*');

  function finish(id, ok, extra = {}) {
    if (!running || running.id !== id) return;
    clearTimeout(running.timer);
    const ms = Math.round(performance.now() - running.start);
    if (running.lang === 'javascript') {
      const w = running.worker;
      setTimeout(() => w.terminate(), 1500); // let pending timers flush a little
    } else {
      armPyIdle();
    }
    running = null;
    reply({ type: 'done', id, ok, ms, ...extra });
  }

  function run({ id, lang, code, timeoutMs = 10000 }) {
    if (running) {
      reply({ type: 'done', id, ok: false, error: 'Another snippet is still running' });
      return;
    }
    let outputChars = 0;
    const worker = lang === 'python'
      ? (pyWorker = pyWorker || workerFrom(pyWorkerMain))
      : workerFrom(jsWorkerMain);
    running = { id, lang, worker, start: performance.now() };

    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === 'out') {
        if (outputChars > MAX_OUTPUT) return;
        outputChars += m.text.length;
        const text = outputChars > MAX_OUTPUT ? m.text.slice(0, 2000) + '\n… [output truncated]\n' : m.text;
        reply({ type: 'output', id, stream: m.stream, text });
      } else if (m.kind === 'status') {
        reply({ type: 'status', id, text: m.text });
        // Loading Python shouldn't eat into the snippet's time budget
        if (running && running.id === id) {
          clearTimeout(running.timer);
          running.timer = setTimeout(onTimeout, m.text ? 60000 : timeoutMs);
        }
      } else if (m.kind === 'done') {
        finish(id, m.ok, m.error ? { error: m.error } : {});
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      reply({ type: 'output', id, stream: 'stderr', text: (e.message || 'Worker error') + '\n' });
      finish(id, false, { error: e.message });
    };

    const onTimeout = () => {
      if (!running || running.id !== id) return;
      worker.terminate();
      if (lang === 'python') pyWorker = null;
      reply({ type: 'output', id, stream: 'stderr', text: `\nStopped after ${Math.round(timeoutMs / 1000)}s (infinite loop or long computation?)\n` });
      finish(id, false, { error: 'timeout' });
    };
    running.timer = setTimeout(onTimeout, timeoutMs);
    running.stop = onTimeout;

    worker.postMessage(lang === 'python' ? { base: PYODIDE_BASE, code } : { code });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const msg = e.data || {};
    if (msg.type === 'run' && typeof msg.code === 'string') run(msg);
    else if (msg.type === 'stop' && running && running.id === msg.id) running.stop();
  });

  reply({ type: 'ready' });
})();
