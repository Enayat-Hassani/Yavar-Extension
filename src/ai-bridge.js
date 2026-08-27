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
      try { window.parent.postMessage({ action: 'ANSWER_WATCH_FAILED', reason: 'unknown-platform', requestId }, '*'); } catch (e) {}
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
        window.parent.postMessage({
          action: 'ANSWER_SETTLED', text, platform, url: window.location.href, requestId: rid
        }, '*');
        console.log('[Yavar Bridge] ANSWER_SETTLED sent to parent');
      } catch (e) {
        console.warn('[Yavar Bridge] Failed to post settled answer:', e);
      }
    };

    const emit = (action) => {
      const rid = requestId;
      stopAnswerWatch();
      try { window.parent.postMessage({ action, requestId: rid }, '*'); } catch (e) {}
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

  // Listen for postMessage from sidepanel
  window.addEventListener('message', (event) => {
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
        window.parent.postMessage(reply, '*');
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
