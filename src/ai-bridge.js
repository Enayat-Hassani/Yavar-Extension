// AI Bridge - Runs inside AI chat iframes (ChatGPT, Claude, Gemini)
// Handles auto-submit of prompts via postMessage from the sidepanel

(function () {
  'use strict';

  const SELECTORS = {
    chatgpt: {
      input: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"]',
      button: 'button[data-testid="send-button"], #composer-submit-button, button[aria-label="Send prompt" i]'
    },
    claude: {
      input: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
      button: 'button[aria-label="Send message" i], button[data-testid="send-button"]'
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
  const SKIP_TAGS = /^(button|svg|img|mat-icon|script|style|yavar-answer-bar|source-footnote|sources-carousel.*|source-inline-chip.*|.*citation.*)$/;
  const SKIP_CLASS = /\b(citation|source-chip|source-inline|sources-carousel|footnote|code-block-decoration)\b/i;

  function nodeToMarkdown(el) {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      // Buttons, icons and source/citation chips (Gemini's "MD +1") aren't answer text
      if (SKIP_TAGS.test(tag) || SKIP_CLASS.test(typeof node.className === 'string' ? node.className : '')) return;

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

    const md = answerMarkdown(nodes[nodes.length - 1]);
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
  // True while autoSubmit waits for the chat to accept the message (a file
  // upload keeps the send button disabled); the answer watch doesn't count
  // that time as "no reply"
  let submitting = false;

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
    const IDLE_TIMEOUT_MS = 90000; // give up only after this long with no activity

    // The site's own failure message ("Something went wrong (1060)"), new
    // since the watch started. The phrase inside the user's own messages
    // (code being explained, say) doesn't count. Read sparingly: innerText
    // lays out the page.
    const ERROR_RE = /something went wrong[^\n]{0,80}/gi;
    const siteErrors = () => {
      const found = (document.body?.innerText || '').match(ERROR_RE) || [];
      const userSel = USER_SELECTORS[platform];
      const own = userSel ? [...document.querySelectorAll(userSel)].flatMap(el => (el.innerText || '').match(ERROR_RE) || []) : [];
      return found.slice(own.length);   // the site's messages come after the question they answer
    };
    const errorsBefore = siteErrors().length;

    let sawGenerating = false;
    let lastText = '';
    let lastProgress = '';
    let stableTicks = 0;
    let elapsed = 0;
    let lastActivity = Date.now();

    // Stream the answer so far to the panel (only when it changed)
    const progress = (text) => {
      if (!text || text === lastProgress) return;
      lastProgress = text;
      lastActivity = Date.now();
      try { postToYavar({ action: 'ANSWER_PROGRESS', text, requestId }); } catch (e) {}
    };

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
      if (submitting) { elapsed = 0; lastActivity = Date.now(); return; }
      elapsed += TICK;

      const generating = !!document.querySelector(STOP_SELECTORS);
      const cur = extractLastAnswer();
      const curCount = document.querySelectorAll(sel.message).length;
      const isNewAnswer = curCount > baselineCount || (cur.ok && cur.text && cur.text !== preArmText);
      if (cur.ok && isNewAnswer) progress(cur.text);

      // Still generating → keep waiting, reset stability
      if (generating) {
        sawGenerating = true;
        lastActivity = Date.now();
        stableTicks = 0;
        return;
      }

      if (cur.ok && cur.text && isNewAnswer) {
        if (cur.text === lastText) {
          if (++stableTicks >= STABLE_TICKS) settle(cur.text);
        } else {
          lastText = cur.text;
          stableTicks = 0;
        }
      } else if (!generating && elapsed % 3000 < TICK && siteErrors().length > errorsBefore) {
        const rid = requestId;
        const message = siteErrors().pop().trim();
        stopAnswerWatch();
        try { postToYavar({ action: 'ANSWER_WATCH_ERROR', message, requestId: rid }); } catch (e) {}
      } else if (!sawGenerating && elapsed >= STALL_MS) {
        // Never saw generation and no new answer appeared — the message probably
        // never sent. Tell the agent so it can retry rather than hang.
        console.warn('[Yavar Bridge] Watch stalled — no reply detected');
        emit('ANSWER_WATCH_STALLED');
      }
    }, TICK);

    // Time out only after a long stretch with no generation and no new text
    const checkIdle = () => {
      if (watchRequestId !== requestId) return;
      const idle = Date.now() - lastActivity;
      if (idle >= IDLE_TIMEOUT_MS) emit('ANSWER_WATCH_TIMEOUT');
      else watchSafetyTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS - idle);
    };
    watchSafetyTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS);
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

      submitting = true;
      const sent = await submitWhenReady(selectors);
      submitting = false;
      if (!sent) {
        console.warn('[Yavar Bridge] The chat did not accept the message');
        // Fail the answer watch now with the real reason, rather than "no reply" later
        if (watchRequestId) {
          const rid = watchRequestId;
          stopAnswerWatch();
          postToYavar({ action: 'ANSWER_WATCH_NOT_SENT', requestId: rid });
        }
      }
    } catch (err) {
      submitting = false;
      console.error('[Yavar Bridge] autoSubmit failed:', err);
    }
  }

  // Press send once the chat allows it, and resolve true when the message
  // has left the input. With a file attached the send button stays disabled
  // until the upload finishes, which can take far longer than a fixed wait.
  async function submitWhenReady(selectors) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const inputText = () => {
      const el = document.querySelector(selectors.input);
      return el ? (el.value !== undefined ? el.value : el.innerText || '').trim() : '';
    };
    const deadline = Date.now() + 90000;
    let presses = 0;
    await sleep(400);
    while (Date.now() < deadline && presses < 6) {
      if (presses > 0 && inputText() === '') return true;
      const btn = document.querySelector(selectors.button);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        presses++;
      } else if (!btn) {
        // No send button matched (the site may have changed): try Enter
        const el = document.querySelector(selectors.input);
        el?.focus();
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        presses++;
      }
      // A disabled button means an upload is still running: keep waiting
      await sleep(presses ? 800 : 500);
    }
    return presses > 0 && inputText() === '';
  }

  // The panel sends each message exactly once, after BRIDGE_READY (see the
  // message listener), so no duplicate filtering is needed here.
  function handleAutoSubmit(prompt) {
    autoSubmit(prompt);
  }

  function handleAutoPasteOnly(prompt) {
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
  function handleAttachFile(filename, content, mime) {
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

  // Language from the code element's class, a nearby header label, or a
  // guess. Returns false when the block is known not to be runnable (so it's
  // never re-checked), null when it can't tell yet (e.g. still streaming).
  function codeLanguage(pre, text) {
    const code = pre.querySelector('code') || pre;
    const cls = (code.className || '') + ' ' + (pre.className || '');
    const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
    if (m) return RUNNABLE[m[1].toLowerCase()] || false;

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

  function decorateCodeBlocks(generating) {
    const pres = document.querySelectorAll('pre:not([data-yavar-run])');
    const lastPre = pres[pres.length - 1];
    pres.forEach((pre) => {
      if (!isInsideAnswer(pre)) { pre.setAttribute('data-yavar-run', 'skip'); return; }
      const text = codeText(pre);
      if (text.length > 100000) { pre.setAttribute('data-yavar-run', 'skip'); return; }
      const lang = text.trim().length >= 3 ? codeLanguage(pre, text) : null;
      if (!lang) {
        // Unknown language: only a block that may still be streaming (the last
        // one while the AI is answering) is worth looking at again later
        if (lang === false || !(generating && pre === lastPre)) pre.setAttribute('data-yavar-run', 'skip');
        return;
      }
      pre.setAttribute('data-yavar-run', lang);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '▶ Run';
      btn.setAttribute('data-yavar-run-btn', '');
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
        postToYavar({ action: 'RUN_CODE', lang, code });
      });
      const cs = getComputedStyle(pre);
      if (cs.position === 'static') pre.style.position = 'relative';
      // Room for the button so it never covers the last line of code
      pre.style.paddingBottom = `calc(${cs.paddingBottom} + 30px)`;
      pre.appendChild(btn);
    });
  }

  // ---- Yavar controls inside the chat ----
  // An action row under each finished answer. Rendered in a shadow root so
  // the site's CSS can't touch it (and ours can't leak), re-attached when
  // the site re-renders. Only in the Yavar side panel; can be turned off in
  // Settings. Everything else lives in the Yavar view.

  const USER_SELECTORS = {
    chatgpt: 'div[data-message-author-role="user"]',
    claude: '[data-testid="user-message"]',
    gemini: 'user-query'
  };

  let inChatEnabled = true;

  const UI_CSS = `
    :host { all: initial; --fg:#1d1d1f; --muted:#6e6e73; --line:rgba(0,0,0,.12); --hover:rgba(0,113,227,.09); --accent:#0071e3; }
    :host([dark]) { --fg:#f5f5f7; --muted:#a1a1a6; --line:rgba(255,255,255,.14); --hover:rgba(10,132,255,.18); --accent:#409cff; }
    * { box-sizing: border-box; font: 500 12px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .row { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin:8px 0 2px; opacity:.72; transition:opacity .15s; }
    .row:hover, .row:focus-within { opacity:1; }
    .brand { color:var(--muted); font-weight:600; font-size:11px; margin-right:2px; letter-spacing:.02em; }
    button { display:inline-flex; align-items:center; gap:4px; padding:4px 9px; color:var(--fg); background:transparent;
      border:1px solid var(--line); border-radius:999px; cursor:pointer; white-space:nowrap; }
    button:hover { background:var(--hover); border-color:var(--accent); color:var(--accent); }
    button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
    button.ok { color:#1f9d55; border-color:#1f9d55; }
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

  // Computed once per refresh pass (getComputedStyle is too costly for every
  // answer bar or scroll frame)
  let isDark = false;

  function makeHost(tag) {
    const host = document.createElement(tag);
    host.setAttribute('data-yavar-ui', '');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    root.appendChild(style);
    host.toggleAttribute('dark', isDark);
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

  function decorateAnswers(generating) {
    const sel = RESPONSE_SELECTORS[detectPlatform()];
    if (!sel) return;
    const msgs = document.querySelectorAll(sel.message);
    msgs.forEach((m, i) => {
      if (generating && i === msgs.length - 1) return;           // still streaming
      if (m.querySelector(':scope > yavar-answer-bar')) return;   // cheapest check first
      if (m.parentElement?.closest(sel.message)) return;           // nested match
      if (!m.textContent.trim()) return;                           // textContent: no layout
      addAnswerBar(m);
    });
  }

  function removeInChatUi() {
    document.querySelectorAll('yavar-answer-bar').forEach(el => el.remove());
  }

  function applyInChat(enabled) {
    inChatEnabled = enabled;
    if (enabled) refreshInChatUi();
    else removeInChatUi();
  }

  function refreshInChatUi() {
    if (!inChatEnabled) return;
    isDark = looksDark();
    const generating = !!document.querySelector(STOP_SELECTORS);
    decorateCodeBlocks(generating);
    decorateAnswers(generating);
  }

  // Mutations caused only by our own buttons/bars don't need another pass
  const isOwnNode = (n) => n.nodeType === 1 && (n.hasAttribute('data-yavar-ui') || n.hasAttribute('data-yavar-run-btn'));
  const onlyOwnChanges = (records) => records.every(r =>
    [...r.addedNodes, ...r.removedNodes].every(isOwnNode) || (r.type === 'attributes'));

  if (EXTENSION_ORIGIN && window.parent !== window && window.parent === window.top && detectPlatform()) {
    try {
      chrome.storage.sync.get('settings')
        .then(({ settings }) => applyInChat(settings?.inChatButtons ?? true))
        .catch(() => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) applyInChat(changes.settings.newValue?.inChatButtons ?? true);
      });
    } catch (e) { /* storage unavailable: keep defaults */ }

    // One observer drives everything (code-block buttons, answer bars)
    let queued = null;
    const schedule = (records) => {
      if (queued || (records && onlyOwnChanges(records))) return;
      queued = setTimeout(() => { queued = null; trackTemp(); refreshInChatUi(); }, 700);
    };
    const start = () => {
      refreshInChatUi();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ---- Private (temporary) chats for Yavar's background work ----
  // ChatGPT and Claude open one from a URL; Gemini only has a button. We
  // remember that this page is one while the user stays in that conversation
  // (the URL can change after the first message) and forget it when they
  // start a new chat.
  const NEW_CHAT_PATH = { chatgpt: /^\/$/, claude: /^\/new\/?$/, gemini: /^(\/u\/\d+)?\/app\/?$/ };
  const here = () => location.pathname + location.search;

  function tempUrl() {
    const q = new URLSearchParams(location.search);
    const p = detectPlatform();
    return (p === 'chatgpt' && q.get('temporary-chat') === 'true') || (p === 'claude' && q.has('incognito'));
  }

  let tempSession = tempUrl();
  let lastLoc = here();
  function trackTemp() {
    const now = here();
    if (now === lastLoc) return;
    lastLoc = now;
    if (tempUrl()) tempSession = true;
    else if (NEW_CHAT_PATH[detectPlatform()]?.test(location.pathname)) tempSession = false;
  }

  // Gemini's button has moved between the side menu and the start page, so
  // look for it by test id, label or tooltip, not one fixed selector
  function findTempButton() {
    const visible = (el) => el && el.offsetParent !== null;
    const byId = [...document.querySelectorAll('[data-test-id*="temp-chat" i], [data-test-id*="temporary" i]')]
      .map(el => el.closest('button, a, [role="button"]') || el).find(visible);
    if (byId) return byId;
    const re = /temporary chat/i;
    return [...document.querySelectorAll('button, a, [role="button"]')].find(el => visible(el) && (
      re.test(el.getAttribute('aria-label') || '') || re.test(el.getAttribute('mattooltip') || '') ||
      re.test(el.getAttribute('title') || '') || re.test((el.textContent || '').trim().slice(0, 40))));
  }

  async function waitFor(find, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = find();
      if (el) return el;
      await new Promise(r => setTimeout(r, 150));
    }
    return null;
  }

  async function startGeminiTempChat() {
    let btn = await waitFor(findTempButton, 2500);
    if (!btn) {
      // In a narrow panel the button can live in the collapsed side menu
      const menu = document.querySelector('[data-test-id="side-nav-menu-button"], button[aria-label*="main menu" i]');
      menu?.click();
      btn = await waitFor(findTempButton, 4000);
      if (!btn && menu) menu.click();   // put the menu back
    }
    if (!btn) return false;
    const on = btn.getAttribute('aria-pressed') === 'true' || /\b(active|selected)\b/.test(btn.className);
    if (!on) btn.click();
    await new Promise(r => setTimeout(r, 900));   // let the new chat's URL settle
    tempSession = true;
    lastLoc = here();
    return true;
  }

  // Listen for postMessage from sidepanel
  window.addEventListener('message', (event) => {
    if (!isFromYavar(event)) return;

    // Handshake: the panel queues messages until it knows we're listening
    if (event.data?.action === 'BRIDGE_PING') {
      postToYavar({ action: 'BRIDGE_READY', platform: detectPlatform() });
      return;
    }

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

    if (event.data?.action === 'CHAT_STATE') {
      trackTemp();
      postToYavar({ action: 'CHAT_STATE', requestId: event.data.requestId, platform: detectPlatform(), temporary: tempSession });
    }

    if (event.data?.action === 'START_TEMP_CHAT') {
      const requestId = event.data.requestId;
      (detectPlatform() === 'gemini' ? startGeminiTempChat() : Promise.resolve(false))
        .catch(() => false)
        .then(ok => postToYavar({ action: 'TEMP_CHAT_STARTED', requestId, ok }));
    }

    if (event.data?.action === 'STOP_WATCH') {
      console.log('[Yavar Bridge] Received STOP_WATCH');
      stopAnswerWatch();
    }
  });

  // Tell the Yavar panel we're ready to receive messages
  if (EXTENSION_ORIGIN && window.parent !== window && detectPlatform()) {
    postToYavar({ action: 'BRIDGE_READY', platform: detectPlatform() });
  }

  console.log('[Yavar Bridge] AI Bridge loaded on:', detectPlatform());
})();
