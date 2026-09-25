// AI Bridge - Runs inside AI chat iframes (ChatGPT, Claude, Gemini)
// Handles auto-submit of prompts via postMessage from the sidepanel

(function () {
  'use strict';

  const SELECTORS = {
    chatgpt: {
      input: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"]',
      button: 'button[data-testid="send-button"], button[aria-label="Send prompt"]'
    },
    claude: {
      input: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
      button: 'button[aria-label="Send Message"], button[data-testid="send-button"]'
    },
    gemini: {
      input: 'div[contenteditable="true"].ql-editor, div[contenteditable="true"]',
      button: 'button[aria-label="Send message"], button.send-button'
    }
  };

  // Selectors for reading the assistant's response back out of the page.
  // These are best-effort and may need updating as the AI sites change their DOM.
  const RESPONSE_SELECTORS = {
    chatgpt: {
      message: 'div[data-message-author-role="assistant"]',
      content: '.markdown, .prose'
    },
    claude: {
      message: 'div.font-claude-message, [data-testid="assistant-message"]',
      content: null
    },
    gemini: {
      message: 'message-content, .model-response-text',
      content: null
    }
  };

  // Present while a response is still streaming (used to warn about partial captures)
  const STOP_SELECTORS = 'button[data-testid="stop-button"], button[aria-label*="Stop generating" i], button[aria-label*="Stop response" i], button[aria-label="Stop"]';

  // Only the Yavar side panel may drive this bridge. The chat sites can be
  // framed by other pages too, and without this check any website could send
  // prompts into the user's logged-in chat and read the answers back.
  const EXTENSION_ORIGIN = (() => {
    try { return new URL(chrome.runtime.getURL('')).origin; } catch (e) { return null; }
  })();

  function isFromYavar(event) {
    return !!EXTENSION_ORIGIN && event.origin === EXTENSION_ORIGIN && event.source === window.parent;
  }

  function postToYavar(message) {
    if (!EXTENSION_ORIGIN || window.parent === window) return;
    window.parent.postMessage(message, EXTENSION_ORIGIN);
  }

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    return null;
  }

  // Convert a response DOM subtree into readable Markdown. Handles the common
  // cases (headings, lists, code blocks, inline emphasis/links) and falls back
  // to text content for anything unrecognised.
  function nodeToMarkdown(el) {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        const codeText = (codeEl || node).innerText.replace(/\n+$/, '');
        let lang = '';
        if (codeEl) {
          const m = (codeEl.className || '').match(/language-([\w+-]+)/);
          if (m) lang = m[1];
        }
        out += `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
      } else if (/^h[1-6]$/.test(tag)) {
        out += `\n\n${'#'.repeat(Number(tag[1]))} ${node.innerText.trim()}\n\n`;
      } else if (tag === 'ul' || tag === 'ol') {
        out += '\n';
        const ordered = tag === 'ol';
        let i = 1;
        node.querySelectorAll(':scope > li').forEach((li) => {
          const prefix = ordered ? `${i++}. ` : '- ';
          out += `${prefix}${nodeToMarkdown(li).trim()}\n`;
        });
        out += '\n';
      } else if (tag === 'p' || tag === 'li') {
        out += `\n\n${nodeToMarkdown(node).trim()}\n\n`;
      } else if (tag === 'br') {
        out += '\n';
      } else if (tag === 'code') {
        out += '`' + node.innerText + '`';
      } else if (tag === 'strong' || tag === 'b') {
        out += '**' + nodeToMarkdown(node).trim() + '**';
      } else if (tag === 'em' || tag === 'i') {
        out += '*' + nodeToMarkdown(node).trim() + '*';
      } else if (tag === 'a') {
        out += `[${node.innerText}](${node.getAttribute('href') || ''})`;
      } else {
        out += nodeToMarkdown(node);
      }
    });
    return out;
  }

  function cleanMarkdown(s) {
    return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  function extractLastAnswer() {
    const platform = detectPlatform();
    if (!platform) return { ok: false, reason: 'unknown-platform' };

    const sel = RESPONSE_SELECTORS[platform];
    const nodes = document.querySelectorAll(sel.message);
    if (!nodes.length) return { ok: false, reason: 'no-messages' };

    const last = nodes[nodes.length - 1];
    const contentEl = sel.content ? (last.querySelector(sel.content) || last) : last;

    let md = cleanMarkdown(nodeToMarkdown(contentEl));
    if (!md) md = (contentEl.innerText || '').trim();
    if (!md) return { ok: false, reason: 'empty' };

    return { ok: true, text: md, platform, generating: !!document.querySelector(STOP_SELECTORS) };
  }

  // ---- Auto-watch: wait for a NEW response to finish streaming, then post it ----
  // Poll-based (NOT mutation-debounce): the AI sites mutate the DOM constantly
  // even when idle, which made a "wait for DOM silence" approach hang forever.
  // Instead we poll on a fixed cadence and settle when the answer TEXT is stable.
  let watchInterval = null;
  let watchRequestId = null;
  let watchSafetyTimer = null;

  function stopAnswerWatch() {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
    if (watchSafetyTimer) { clearTimeout(watchSafetyTimer); watchSafetyTimer = null; }
    watchRequestId = null;
  }

  function startAnswerWatch(requestId) {
    stopAnswerWatch();
    const platform = detectPlatform();
    if (!platform) {
      try { postToYavar({ action: 'ANSWER_WATCH_FAILED', reason: 'unknown-platform', requestId }); } catch (e) {}
      return;
    }
    watchRequestId = requestId;

    const sel = RESPONSE_SELECTORS[platform];
    const baselineCount = document.querySelectorAll(sel.message).length;
    const preArm = extractLastAnswer();
    const preArmText = preArm.ok ? preArm.text : '';

    const TICK = 600;
    const STABLE_TICKS = 3;      // ~1.8s of unchanged text after generation stops
    const STALL_MS = 22000;      // no generation + no new answer → the submit likely failed
    const HARD_TIMEOUT_MS = 90000;

    let sawGenerating = false;
    let lastText = '';
    let stableTicks = 0;
    let elapsed = 0;

    const settle = (text) => {
      const rid = requestId;
      stopAnswerWatch();
      try {
        postToYavar({
          action: 'ANSWER_SETTLED', text, platform, url: window.location.href, requestId: rid
        });
        console.log('[Yavar Bridge] ANSWER_SETTLED sent to parent');
      } catch (e) {
        console.warn('[Yavar Bridge] Failed to post settled answer:', e);
      }
    };

    const emit = (action) => {
      const rid = requestId;
      stopAnswerWatch();
      try { postToYavar({ action, requestId: rid }); } catch (e) {}
    };

    watchInterval = setInterval(() => {
      if (watchRequestId !== requestId) return;
      elapsed += TICK;

      // Still generating → keep waiting, reset stability
      if (document.querySelector(STOP_SELECTORS)) {
        sawGenerating = true;
        stableTicks = 0;
        return;
      }

      const cur = extractLastAnswer();
      const curCount = document.querySelectorAll(sel.message).length;
      const isNewAnswer = curCount > baselineCount || (cur.ok && cur.text && cur.text !== preArmText);

      if (cur.ok && cur.text && isNewAnswer) {
        if (cur.text === lastText) {
          if (++stableTicks >= STABLE_TICKS) settle(cur.text);
        } else {
          lastText = cur.text;
          stableTicks = 0;
        }
      } else if (!sawGenerating && elapsed >= STALL_MS) {
        // Never saw generation and no new answer appeared — the message probably
        // never sent. Tell the agent so it can retry rather than hang.
        console.warn('[Yavar Bridge] Watch stalled — no reply detected');
        emit('ANSWER_WATCH_STALLED');
      }
    }, TICK);

    watchSafetyTimer = setTimeout(() => {
      if (watchRequestId === requestId) emit('ANSWER_WATCH_TIMEOUT');
    }, HARD_TIMEOUT_MS);
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for: ${selector}`));
      }, timeout);
    });
  }

  function insertTextIntoInput(inputEl, text) {
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      // For textarea/input elements, set value directly via native setter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(inputEl, text);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[Yavar Bridge] Text set via native value setter');
    } else if (inputEl.contentEditable === 'true') {
      // For contenteditable elements (ChatGPT, Claude, Gemini use these)
      inputEl.focus();

      // Try execCommand first — most reliable for contenteditable
      const success = document.execCommand('insertText', false, text);
      if (success) {
        console.log('[Yavar Bridge] Text inserted via execCommand');
        return;
      }

      // Fallback: clipboard paste event with text data (NOT file)
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.items.add(text, 'text/plain');
      inputEl.dispatchEvent(pasteEvent);
      console.log('[Yavar Bridge] Text inserted via paste event');
    }
  }

  async function autoSubmit(prompt) {
    const platform = detectPlatform();
    if (!platform) {
      console.warn('[Yavar Bridge] Unknown platform, cannot auto-submit');
      return;
    }

    console.log('[Yavar Bridge] autoSubmit called on platform:', platform, 'prompt length:', prompt?.length);

    const selectors = SELECTORS[platform];

    try {
      const inputEl = await waitForElement(selectors.input, 10000);
      console.log('[Yavar Bridge] Input element found:', !!inputEl, 'tagName:', inputEl?.tagName);

      inputEl.focus();
      insertTextIntoInput(inputEl, prompt);

      console.log('[Yavar Bridge] Text inserted, submitting (with retries)...');

      // Retry the submit until the input actually clears (message sent).
      // A single click often fails on ChatGPT when the send button isn't ready yet.
      const MAX_ATTEMPTS = 6;
      const currentInputText = () => {
        const el = document.querySelector(selectors.input);
        if (!el) return '';
        return (el.value !== undefined ? el.value : el.innerText || '').trim();
      };

      const trySubmit = (attempt) => {
        if (attempt > 0 && currentInputText() === '') {
          console.log('[Yavar Bridge] Submit confirmed (input cleared)');
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          console.warn('[Yavar Bridge] Submit attempts exhausted — message may not have sent');
          return;
        }

        const submitBtn = document.querySelector(selectors.button);
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
        } else {
          const el = document.querySelector(selectors.input);
          el?.focus();
          el?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
        }
        setTimeout(() => trySubmit(attempt + 1), 700);
      };

      setTimeout(() => trySubmit(0), 500);

    } catch (err) {
      console.error('[Yavar Bridge] autoSubmit failed:', err);
    }
  }

  // Guard against duplicate submissions from retries
  let lastSubmittedPrompt = '';
  let lastSubmitTime = 0;
  let lastScreenshotData = '';
  let lastScreenshotTime = 0;

  function handleAutoSubmit(prompt) {
    const now = Date.now();
    // Dedupe: ignore if same prompt within 8 seconds (covers staggered retries)
    if (prompt === lastSubmittedPrompt && now - lastSubmitTime < 8000) {
      console.log('[Yavar Bridge] Ignoring duplicate submit');
      return;
    }
    lastSubmittedPrompt = prompt;
    lastSubmitTime = now;
    autoSubmit(prompt);
  }

  let lastPastedPrompt = '';
  let lastPasteTime = 0;

  function handleAutoPasteOnly(prompt) {
    const now = Date.now();
    // Dedupe: ignore if same prompt within 8 seconds (covers staggered retries)
    if (prompt === lastPastedPrompt && now - lastPasteTime < 8000) {
      console.log('[Yavar Bridge] Ignoring duplicate paste');
      return;
    }
    lastPastedPrompt = prompt;
    lastPasteTime = now;

    const platform = detectPlatform();
    if (!platform) {
      console.warn('[Yavar Bridge] Unknown platform, cannot paste');
      return;
    }

    console.log('[Yavar Bridge] handleAutoPasteOnly called on platform:', platform, 'prompt length:', prompt?.length);

    const selectors = SELECTORS[platform];

    (async () => {
      try {
        const inputEl = await waitForElement(selectors.input, 10000);
        console.log('[Yavar Bridge] Input element found:', !!inputEl);

        inputEl.focus();
        insertTextIntoInput(inputEl, prompt);
        console.log('[Yavar Bridge] Text pasted (no auto-submit)');

      } catch (err) {
        console.error('[Yavar Bridge] handleAutoPasteOnly failed:', err);
      }
    })();
  }

  function handleAutoPasteScreenshot(imageDataUrl) {
    const now = Date.now();
    // Dedupe: ignore if same screenshot within 8 seconds (covers staggered retries)
    if (imageDataUrl === lastScreenshotData && now - lastScreenshotTime < 8000) {
      console.log('[Yavar Bridge] Ignoring duplicate screenshot paste');
      return;
    }
    lastScreenshotData = imageDataUrl;
    lastScreenshotTime = now;
    
    // Call the async function
    (async () => {
      const platform = detectPlatform();
      if (!platform) {
        console.warn('[Yavar Bridge] Unknown platform, cannot paste screenshot');
        return;
      }

      console.log('[Yavar Bridge] handleAutoPasteScreenshot called on platform:', platform);

      const selectors = SELECTORS[platform];

      try {
        // Convert data URL to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();
        const file = new File([blob], 'screenshot_' + Date.now() + '.png', { type: 'image/png' });

        console.log('[Yavar Bridge] Screenshot converted to blob, size:', blob.size);

        // Get the input element
        const inputEl = await waitForElement(selectors.input, 10000);
        console.log('[Yavar Bridge] Input element found:', !!inputEl);

        inputEl.focus();

        // Create a paste event with the image file
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });

        // Add the image file to clipboard data
        pasteEvent.clipboardData.items.add(file);

        // Dispatch the paste event
        inputEl.dispatchEvent(pasteEvent);
        console.log('[Yavar Bridge] Screenshot pasted via paste event');

        // Alternative method: Some platforms support direct file input
        // Try creating a file input change event as fallback
        setTimeout(() => {
          try {
            const fileChangeEvent = new Event('change', { bubbles: true });
            // Some rich text editors listen for this
            inputEl.dispatchEvent(fileChangeEvent);
            console.log('[Yavar Bridge] Dispatched change event as fallback');
          } catch (err) {
            console.warn('[Yavar Bridge] Fallback event failed:', err);
          }
        }, 200);

      } catch (err) {
        console.error('[Yavar Bridge] handleAutoPasteScreenshot failed:', err);
      }
    })();
  }

  // Attach a text file (e.g. a big source file as .md) to the chat input.
  // Web UIs accept far larger content as an attachment than as pasted text.
  let lastAttachKey = '';
  let lastAttachTime = 0;

  function handleAttachFile(filename, content, mime) {
    const now = Date.now();
    const key = filename + '|' + (content ? content.length : 0);
    if (key === lastAttachKey && now - lastAttachTime < 6000) {
      console.log('[Yavar Bridge] Ignoring duplicate attach');
      return;
    }
    lastAttachKey = key;
    lastAttachTime = now;

    const platform = detectPlatform();
    if (!platform) { console.warn('[Yavar Bridge] Unknown platform, cannot attach'); return; }
    const selectors = SELECTORS[platform];

    (async () => {
      try {
        const inputEl = await waitForElement(selectors.input, 10000);
        inputEl.focus();

        // Paste the file as an attachment (same mechanism as the screenshot attach)
        const file = new File([content], filename, { type: mime || 'text/plain' });
        const dt = new DataTransfer();
        dt.items.add(file);
        inputEl.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt
        }));
        console.log('[Yavar Bridge] Attached file via paste:', filename, content.length, 'chars');
      } catch (err) {
        console.error('[Yavar Bridge] handleAttachFile failed:', err);
      }
    })();
  }

  // ---- "▶ Run" buttons on code blocks in answers ----
  // Only inside the Yavar side panel (never in the user's normal chat tabs).
  // Clicking sends the code to the panel, which runs it in a sandbox.

  const RUNNABLE = {
    javascript: 'javascript', js: 'javascript', node: 'javascript', nodejs: 'javascript', mjs: 'javascript',
    python: 'python', py: 'python', python3: 'python', py3: 'python'
  };

  // Language from the code element's class, a nearby header label, or a guess
  function codeLanguage(pre, text) {
    const code = pre.querySelector('code') || pre;
    const cls = (code.className || '') + ' ' + (pre.className || '');
    const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
    if (m) return RUNNABLE[m[1].toLowerCase()] || null;

    // ChatGPT / Gemini show the language as a small label above the block
    const box = pre.closest('div');
    const label = box?.parentElement?.querySelector('span, div')?.textContent?.trim().toLowerCase() || '';
    if (RUNNABLE[label]) return RUNNABLE[label];
    const header = pre.parentElement?.previousElementSibling?.textContent?.trim().toLowerCase() || '';
    if (RUNNABLE[header]) return RUNNABLE[header];

    // Heuristic fallback
    if (/^\s*(def |class \w+.*:\s*$|from [\w.]+ import |import [\w.]+\s*$|print\()/m.test(text) && !/[;{]\s*$/m.test(text)) return 'python';
    if (/\b(console\.log|const |let |function |=>|document\.)/.test(text)) return 'javascript';
    return null;
  }

  function isInsideAnswer(el) {
    const platform = detectPlatform();
    const sel = platform && RESPONSE_SELECTORS[platform];
    if (sel && el.closest(sel.message)) return true;
    // Unknown DOM: accept any block that isn't in the message composer
    return !el.closest('[contenteditable="true"], textarea, form');
  }

  // Code text without our own button's label
  function codeText(pre) {
    const el = pre.querySelector('code') || pre;
    return (el.innerText || '').replace(/\n?▶ Run\s*$/, '').replace(/\n$/, '');
  }

  function decorateCodeBlocks() {
    document.querySelectorAll('pre:not([data-yavar-run])').forEach((pre) => {
      if (!isInsideAnswer(pre)) { pre.setAttribute('data-yavar-run', 'skip'); return; }
      const text = codeText(pre);
      if (text.length > 100000) { pre.setAttribute('data-yavar-run', 'skip'); return; }
      // Not recognisable yet (maybe still streaming): look again next time
      const lang = text.trim().length >= 3 ? codeLanguage(pre, text) : null;
      if (!lang) return;
      pre.setAttribute('data-yavar-run', lang);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '▶ Run';
      btn.title = `Run this ${lang === 'python' ? 'Python' : 'JavaScript'} in Yavar's sandbox`;
      btn.setAttribute('aria-label', btn.title);
      btn.style.cssText = [
        'position:absolute', 'right:8px', 'bottom:8px', 'z-index:5',
        'padding:3px 10px', 'font:600 12px/1.4 system-ui,-apple-system,sans-serif',
        'color:#fff', 'background:#0071e3', 'border:none', 'border-radius:999px',
        'cursor:pointer', 'opacity:0.85', 'box-shadow:0 1px 4px rgba(0,0,0,.25)'
      ].join(';');
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.85'; });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Re-read at click time: the block may have finished streaming since
        const code = codeText(pre);
        postToYavar({ action: 'RUN_CODE', lang: codeLanguage(pre, code) || lang, code });
      });
      const cs = getComputedStyle(pre);
      if (cs.position === 'static') pre.style.position = 'relative';
      // Room for the button so it never covers the last line of code
      pre.style.paddingBottom = `calc(${cs.paddingBottom} + 30px)`;
      pre.appendChild(btn);
    });
  }

  if (EXTENSION_ORIGIN && window.parent !== window && detectPlatform()) {
    let pending = null;
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; decorateCodeBlocks(); }, 800);
    };
    const start = () => {
      decorateCodeBlocks();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ---- Yavar controls inside the chat ----
  // An action row under each finished answer, and a chip bar above the
  // message box. Rendered in shadow roots so the site's CSS can't touch
  // them (and ours can't leak), re-attached when the site re-renders.
  // Only in the Yavar side panel; can be turned off in Settings.

  const USER_SELECTORS = {
    chatgpt: 'div[data-message-author-role="user"]',
    claude: '[data-testid="user-message"]',
    gemini: 'user-query'
  };

  let inChatEnabled = true;
  let yavarTemplates = [];

  const UI_CSS = `
    :host { all: initial; --fg:#1d1d1f; --muted:#6e6e73; --bg:#ffffff; --line:rgba(0,0,0,.12); --hover:rgba(0,113,227,.09); --accent:#0071e3; }
    :host([dark]) { --fg:#f5f5f7; --muted:#a1a1a6; --bg:#2c2c2e; --line:rgba(255,255,255,.14); --hover:rgba(10,132,255,.18); --accent:#4aa3ff; }
    * { box-sizing: border-box; font: 500 12px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .row { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin:8px 0 2px; opacity:.72; transition:opacity .15s; }
    .row:hover, .row:focus-within { opacity:1; }
    .brand { color:var(--muted); font-weight:600; font-size:11px; margin-right:2px; letter-spacing:.02em; }
    button { display:inline-flex; align-items:center; gap:4px; padding:4px 9px; color:var(--fg); background:transparent;
      border:1px solid var(--line); border-radius:999px; cursor:pointer; white-space:nowrap; }
    button:hover { background:var(--hover); border-color:var(--accent); color:var(--accent); }
    button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
    button.ok { color:#1f9d55; border-color:#1f9d55; }
    .bar { position:fixed; z-index:2147483000; display:flex; gap:4px; align-items:center; padding:3px; max-width:calc(100vw - 16px);
      overflow-x:auto; scrollbar-width:none; background:var(--bg); border:1px solid var(--line); border-radius:999px;
      box-shadow:0 2px 10px rgba(0,0,0,.1); }
    .bar::-webkit-scrollbar { display:none; }
    .bar button { border-color:transparent; padding:4px 8px; }
    .menu { position:fixed; z-index:2147483001; min-width:200px; max-height:260px; overflow:auto; padding:4px; background:var(--bg);
      border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
    .menu button { display:flex; width:100%; border:none; border-radius:8px; padding:7px 10px; text-align:left; }
    .menu .hint { padding:6px 10px 8px; color:var(--muted); font-size:11px; font-weight:400; line-height:1.4; }
    [hidden] { display:none !important; }
  `;

  function looksDark() {
    const pick = (el) => {
      const m = el && getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || (m.length === 4 && Number(m[3]) === 0)) return null;
      const [r, g, b] = m.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    };
    const fromBg = pick(document.body) ?? pick(document.documentElement);
    if (fromBg != null) return fromBg;
    return document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function makeHost(tag) {
    const host = document.createElement(tag);
    host.setAttribute('data-yavar-ui', '');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    root.appendChild(style);
    host.toggleAttribute('dark', looksDark());
    return { host, root };
  }

  function flash(btn, label) {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = label;
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1600);
  }

  function answerMarkdown(msgEl) {
    const sel = RESPONSE_SELECTORS[detectPlatform()];
    const contentEl = sel?.content ? (msgEl.querySelector(sel.content) || msgEl) : msgEl;
    return cleanMarkdown(nodeToMarkdown(contentEl)) || (contentEl.innerText || '').trim();
  }

  // The user's question that this answer replies to (last one before it)
  function questionFor(msgEl) {
    const sel = USER_SELECTORS[detectPlatform()];
    if (!sel) return '';
    let q = null;
    for (const u of document.querySelectorAll(sel)) {
      if (u.compareDocumentPosition(msgEl) & Node.DOCUMENT_POSITION_FOLLOWING) q = u;
    }
    return q ? (q.innerText || '').trim().slice(0, 4000) : '';
  }

  function addAnswerBar(msgEl) {
    const { host, root } = makeHost('yavar-answer-bar');
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<span class="brand">Yavar</span>' +
      '<button data-a="save" title="Save this answer to Yavar history">Save</button>' +
      '<button data-a="notes" title="Append this answer to your Yavar notes">→ Notes</button>' +
      '<button data-a="copy" title="Copy as Markdown">Copy MD</button>';
    root.appendChild(row);

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      const text = answerMarkdown(msgEl);
      const base = { platform: detectPlatform(), url: location.href };
      if (btn.dataset.a === 'save') {
        postToYavar({ action: 'ANSWER_CAPTURED', text, prompt: questionFor(msgEl), ...base });
        flash(btn, 'Saved ✓');
      } else if (btn.dataset.a === 'notes') {
        postToYavar({ action: 'YAVAR_TO_NOTES', text, prompt: questionFor(msgEl), ...base });
        flash(btn, 'Added ✓');
      } else if (btn.dataset.a === 'copy') {
        try { await navigator.clipboard.writeText(text); flash(btn, 'Copied ✓'); }
        catch (err) { postToYavar({ action: 'YAVAR_COPY', text }); flash(btn, 'Copied ✓'); }
      }
    });
    msgEl.appendChild(host);
  }

  function decorateAnswers() {
    const sel = RESPONSE_SELECTORS[detectPlatform()];
    if (!sel) return;
    const msgs = [...document.querySelectorAll(sel.message)];
    const generating = !!document.querySelector(STOP_SELECTORS);
    msgs.forEach((m, i) => {
      if (generating && i === msgs.length - 1) return;           // still streaming
      if (m.parentElement?.closest(sel.message)) return;           // nested match
      if (m.querySelector(':scope > yavar-answer-bar')) return;
      if (!(m.innerText || '').trim()) return;
      addAnswerBar(m);
    });
  }

  // ---- Chip bar above the message box ----
  let composer = null;

  function currentComposerText() {
    const el = document.querySelector(SELECTORS[detectPlatform()]?.input);
    if (!el) return '';
    return (el.value !== undefined ? el.value : el.innerText || '').trim();
  }

  function buildComposer() {
    const { host, root } = makeHost('yavar-composer-bar');
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML =
      '<button data-c="reader" title="Repo Reader: pick repo or folder files to read with the AI">📚 Repo</button>' +
      '<button data-c="add_page" title="Add the page open in your tab">📄 Page</button>' +
      '<button data-c="prompts" title="Apply a prompt template to what you typed">✨ Prompts</button>' +
      '<button data-c="run" title="Open the code playground">▶ Code</button>' +
      '<button data-c="carry_over" title="Summarize this chat and continue in a fresh one">🧳 Fresh</button>';
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.hidden = true;
    root.append(bar, menu);

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      const c = btn.dataset.c;
      if (c === 'prompts') {
        if (!menu.hidden) { menu.hidden = true; return; }
        const typed = currentComposerText();
        menu.innerHTML = (typed
          ? '<div class="hint">Wraps what you typed in the chosen prompt.</div>'
          : '<div class="hint">Type or paste something first; the prompt wraps it. Prompts using the page work either way.</div>') +
          (yavarTemplates.length ? yavarTemplates : [{ id: '', name: '(no templates)' }])
            .map(t => `<button data-t="${String(t.id).replace(/"/g, '&quot;')}">${String(t.icon || '•').replace(/</g, '&lt;')}&nbsp; ${String(t.name).replace(/</g, '&lt;')}</button>`).join('');
        const r = btn.getBoundingClientRect();
        menu.hidden = false;
        menu.style.left = Math.max(8, Math.min(r.left, innerWidth - 216)) + 'px';
        menu.style.top = Math.max(8, r.top - menu.offsetHeight - 6) + 'px';
        return;
      }
      menu.hidden = true;
      postToYavar({ action: 'YAVAR_OPEN', what: c });
    });
    menu.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]');
      if (!t || !t.dataset.t) return;
      e.stopPropagation();
      menu.hidden = true;
      postToYavar({ action: 'YAVAR_TEMPLATE', id: t.dataset.t, inputText: currentComposerText() });
    });
    document.addEventListener('click', () => { menu.hidden = true; });
    document.documentElement.appendChild(host);
    return { host, bar, menu };
  }

  function placeComposer() {
    const input = inChatEnabled && document.querySelector(SELECTORS[detectPlatform()]?.input);
    if (!input) { if (composer) composer.host.hidden = true; return; }
    composer = composer && composer.host.isConnected ? composer : buildComposer();
    const anchor = input.closest('form') || input.parentElement?.parentElement || input;
    watchAnchor(anchor);
    const r = anchor.getBoundingClientRect();
    const barH = composer.bar.offsetHeight || 30;
    const top = r.top - barH - 6;
    composer.host.hidden = r.width === 0 || top < 4;
    composer.bar.style.left = Math.max(8, r.left) + 'px';
    composer.bar.style.top = top + 'px';
    composer.host.toggleAttribute('dark', looksDark());
  }

  // Re-place the bar when the message box moves or resizes (it grows as you
  // type, the sidebar is resized…) instead of polling on a timer.
  let anchorObserver = null;
  let observedAnchor = null;
  function watchAnchor(anchor) {
    if (anchor === observedAnchor || typeof ResizeObserver === 'undefined') return;
    anchorObserver?.disconnect();
    anchorObserver = new ResizeObserver(() => schedulePlace());
    anchorObserver.observe(anchor);
    observedAnchor = anchor;
  }

  // At most one placement per animation frame (scroll fires very often)
  let placeQueued = false;
  function schedulePlace() {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; placeComposer(); });
  }

  function removeInChatUi() {
    document.querySelectorAll('yavar-answer-bar').forEach(el => el.remove());
    if (composer) { composer.host.remove(); composer = null; }
    anchorObserver?.disconnect();
    anchorObserver = null;
    observedAnchor = null;
  }

  function refreshInChatUi() {
    if (!inChatEnabled) return;
    decorateAnswers();
    placeComposer();
  }

  if (EXTENSION_ORIGIN && window.parent !== window && window.parent === window.top && detectPlatform()) {
    try {
      chrome.storage.sync.get('settings').then(({ settings }) => {
        inChatEnabled = settings?.inChatButtons ?? true;
        if (!inChatEnabled) removeInChatUi(); else refreshInChatUi();
      }).catch(() => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.settings) return;
        inChatEnabled = changes.settings.newValue?.inChatButtons ?? true;
        if (!inChatEnabled) removeInChatUi(); else refreshInChatUi();
      });
    } catch (e) { /* storage unavailable: keep defaults */ }

    let queued = null;
    const schedule = () => {
      if (queued) return;
      queued = setTimeout(() => { queued = null; refreshInChatUi(); }, 700);
    };
    const start = () => {
      refreshInChatUi();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      addEventListener('resize', schedulePlace);
      addEventListener('scroll', schedulePlace, { capture: true, passive: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  function replaceComposerText(text) {
    const platform = detectPlatform();
    if (!platform) return;
    waitForElement(SELECTORS[platform].input, 10000).then((el) => {
      el.focus();
      if (el.value !== undefined) {
        el.select();
      } else {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      insertTextIntoInput(el, text);
    }).catch(() => {});
  }

  // Listen for postMessage from sidepanel
  window.addEventListener('message', (event) => {
    if (!isFromYavar(event)) return;

    if (event.data?.action === 'AUTO_SUBMIT_PROMPT' && event.data?.prompt) {
      console.log('[Yavar Bridge] Received AUTO_SUBMIT_PROMPT via postMessage (paste + submit)');
      handleAutoSubmit(event.data.prompt);
    }

    if (event.data?.action === 'AUTO_PASTE_PROMPT' && event.data?.prompt) {
      console.log('[Yavar Bridge] Received AUTO_PASTE_PROMPT via postMessage (paste only)');
      handleAutoPasteOnly(event.data.prompt);
    }

    if (event.data?.action === 'AUTO_PASTE_SCREENSHOT' && event.data?.imageData) {
      console.log('[Yavar Bridge] Received AUTO_PASTE_SCREENSHOT via postMessage');
      handleAutoPasteScreenshot(event.data.imageData);
    }

    if (event.data?.action === 'CAPTURE_LAST_ANSWER') {
      console.log('[Yavar Bridge] Received CAPTURE_LAST_ANSWER');
      const result = extractLastAnswer();
      const reply = result.ok
        ? {
            action: 'ANSWER_CAPTURED',
            text: result.text,
            platform: result.platform,
            generating: result.generating,
            url: window.location.href,
            requestId: event.data.requestId
          }
        : {
            action: 'ANSWER_CAPTURE_FAILED',
            reason: result.reason,
            platform: detectPlatform(),
            requestId: event.data.requestId
          };
      try {
        postToYavar(reply);
        console.log('[Yavar Bridge] Sent', reply.action, 'to parent');
      } catch (e) {
        console.warn('[Yavar Bridge] Failed to post answer to parent:', e);
      }
    }

    if (event.data?.action === 'AUTO_ATTACH_FILE' && event.data?.content) {
      console.log('[Yavar Bridge] Received AUTO_ATTACH_FILE');
      handleAttachFile(event.data.filename || 'file.md', event.data.content, event.data.mime);
    }

    if (event.data?.action === 'WATCH_FOR_ANSWER') {
      console.log('[Yavar Bridge] Received WATCH_FOR_ANSWER');
      startAnswerWatch(event.data.requestId);
    }

    if (event.data?.action === 'YAVAR_TEMPLATES' && Array.isArray(event.data.templates)) {
      yavarTemplates = event.data.templates;
    }

    if (event.data?.action === 'AUTO_REPLACE_PROMPT' && typeof event.data.prompt === 'string') {
      replaceComposerText(event.data.prompt);
    }

    if (event.data?.action === 'STOP_WATCH') {
      console.log('[Yavar Bridge] Received STOP_WATCH');
      stopAnswerWatch();
    }
  });

  // Also listen for chrome runtime messages (if injected as content script)
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'AUTO_SUBMIT_PROMPT' && message.prompt) {
        console.log('[Yavar Bridge] Received AUTO_SUBMIT_PROMPT via runtime message');
        handleAutoSubmit(message.prompt);
        sendResponse({ success: true });
      }
      if (message.action === 'AUTO_PASTE_SCREENSHOT' && message.imageData) {
        console.log('[Yavar Bridge] Received AUTO_PASTE_SCREENSHOT via runtime message');
        handleAutoPasteScreenshot(message.imageData);
        sendResponse({ success: true });
      }
      return true;
    });
  }

  console.log('[Yavar Bridge] AI Bridge loaded on:', detectPlatform());
})();
