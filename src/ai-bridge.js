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

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    return null;
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
      console.log('[Yavar Bridge] inputEl found:', !!inputEl);

      // Set the text
      if (inputEl.tagName === 'TEXTAREA') {
        // For textarea elements (ChatGPT sometimes uses this)
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(inputEl, prompt);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (inputEl.contentEditable === 'true') {
        // For contenteditable divs (Claude, Gemini, ChatGPT ProseMirror)
        inputEl.focus();
        inputEl.innerHTML = '';

        // Use execCommand for better compatibility with rich text editors
        document.execCommand('insertText', false, prompt);

        // Also dispatch input event
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      console.log('[Yavar Bridge] Text inserted, waiting before submit...');

      // Wait for the send button to become active
      setTimeout(async () => {
        try {
          const submitBtn = document.querySelector(selectors.button);
          console.log('[Yavar Bridge] submitBtn found:', !!submitBtn, 'disabled:', submitBtn?.disabled);

          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            console.log('[Yavar Bridge] Submit button clicked!');
          } else {
            // Try Enter key as fallback
            console.log('[Yavar Bridge] Trying Enter key fallback...');
            inputEl.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
          }
        } catch (err) {
          console.error('[Yavar Bridge] Submit failed:', err);
        }
      }, 800);

    } catch (err) {
      console.error('[Yavar Bridge] autoSubmit failed:', err);
    }
  }

  // Guard against duplicate submissions from retries
  let lastSubmittedPrompt = '';
  let lastSubmitTime = 0;

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

  // Listen for postMessage from sidepanel
  window.addEventListener('message', (event) => {
    if (event.data?.action === 'AUTO_SUBMIT_PROMPT' && event.data?.prompt) {
      console.log('[Yavar Bridge] Received AUTO_SUBMIT_PROMPT via postMessage');
      handleAutoSubmit(event.data.prompt);
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
      return true;
    });
  }

  console.log('[Yavar Bridge] AI Bridge loaded on:', detectPlatform());
})();
