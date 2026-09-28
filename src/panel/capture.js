// Screenshots and captured answers.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { captureLabel, captureMarkdown, hasCaptureText } from '../utils/capture.js';

export class CapturePart {
  // From the chat view the screenshot goes straight into the chat you're
  // looking at; from the Yavar view it joins the message you're writing
  async captureScreenshot(target = 'composer') {
    this._shotTarget = target;
    try {
      // Ask background to inject area selection overlay on the active tab
      chrome.runtime.sendMessage({ action: 'start_area_select' });
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
      this.showNotification('❌ Failed to capture screenshot.');
    }
  }

  // Text selected on a page joins the message as a chip, with where it came from
  attachSelection({ text, title, url }) {
    const words = text.replace(/\s+/g, ' ').trim();
    this.addComposerItem({
      kind: 'selection', label: `“${words.length > 32 ? words.slice(0, 33).replace(/\s+\S*$/, '') + '…' : words}”`, title: words.slice(0, 400),
      filename: 'selection.txt', content: text, mime: 'text/plain',
      what: `text I selected on ${title ? `the page "${title}"` : 'a page'}${url ? ` (${url})` : ''}`
    });
    this.threadInput?.focus();
  }

  // A picked element or area joins the message: its screenshot and, when
  // the picker found any, its text, table, links and so on as Markdown
  async attachScreenshot(dataUrl, rect = null, capture = null) {
    let image = dataUrl;
    if (rect) {
      try {
        image = await this.cropImage(dataUrl, rect);
      } catch (e) {
        this.showNotification('Could not crop the screenshot');
        return;
      }
    }
    if (this._shotTarget === 'chat' && this._view === 'chat') {
      this._shotTarget = null;
      this.forwardScreenshotToIframe(image);
      return;
    }
    if (hasCaptureText(capture)) {
      const label = captureLabel(capture);
      this.addComposerItem({
        kind: 'capture', capture, label, image, title: `${label} on ${capture.title || capture.url}`,
        filename: 'capture.md', content: captureMarkdown(capture), mime: 'text/markdown',
        what: `a part of the page "${capture.title || capture.url}" I picked (${label.toLowerCase()}): a screenshot of it, and its content as Markdown`
      });
    } else {
      this.addComposerItem({ kind: 'image', label: 'Screenshot', image, filename: 'screenshot.png', what: 'a screenshot I took of the page I\'m looking at' });
    }
    this.threadInput?.focus();
  }

  cropImage(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = rect.width * rect.dpr;
        canvas.height = rect.height * rect.dpr;
        canvas.getContext('2d').drawImage(img,
          rect.x * rect.dpr, rect.y * rect.dpr, rect.width * rect.dpr, rect.height * rect.dpr,
          0, 0, rect.width * rect.dpr, rect.height * rect.dpr);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('could not load the screenshot'));
      img.src = dataUrl;
    });
  }

  captureLastAnswer() {
    if (!this.aiFrame || !this.aiFrame.contentWindow) {
      this.showNotification('⚠️ No AI chat loaded to capture from');
      return;
    }

    const requestId = 'cap_' + Date.now();
    this._pendingCaptureId = requestId;

    clearTimeout(this._captureTimeout);
    this._captureTimeout = setTimeout(() => {
      if (this._pendingCaptureId === requestId) {
        this._pendingCaptureId = null;
        this.showNotification('⚠️ Could not read the answer. Let it finish, then retry.');
      }
    }, 4000);

    this.postToChat({ action: 'CAPTURE_LAST_ANSWER', requestId });
    this.showNotification('⏳ Capturing answer…');
  }

  async handleAnswerCaptured(data) {
    const model = this.getCurrentModel();

    let answer = (data.text || '').trim();
    if (!answer) {
      this.showNotification('⚠️ The answer looked empty');
      return;
    }
    if (answer.length > 100000) answer = answer.slice(0, 100000) + '\n\n…[truncated]';

    // The question comes from the chat itself when saved from the answer's
    // own button; otherwise pair with the last prompt we forwarded (< 15 min)
    const prompt = data.prompt != null
      ? data.prompt
      : (this._lastPrompt && Date.now() - (this._lastPromptTime || 0) < 900000)
        ? this._lastPrompt
        : '';

    const entry = {
      id: 'h_' + Date.now(),
      ts: Date.now(),
      platform: data.platform || model?.name || 'AI',
      url: data.url || '',
      prompt,
      answer,
      // What you were reading when you asked (repo files, a PR…), if recent
      topic: (this._readingContext && Date.now() - this._readingContext.ts < 3600000) ? this._readingContext.label : ''
    };

    await this.addHistoryEntry(entry);
    this._lastCapturedEntry = entry;


    const note = data.generating ? ' (still generating — may be partial)' : '';
    this.showNotification('💾 Answer saved to history' + note);

    if (this.historyPanel && !this.historyPanel.classList.contains('hidden')) {
      this.renderHistory();
    }
  }
}
