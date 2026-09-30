// Answers shown inside Yavar: the answer card, streaming an answer into a
// container, and follow-up suggestions.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { renderMarkdown } from '../utils/markdown.js';
import { transcriptMarkdown, turnsToMessages, HANDOFF_NOTE } from '../utils/conversation.js';
import { loadApiConfig, buildRoute, askRoute } from '../utils/llm.js';

export class AnswersPart {
  // An answer shown inside Yavar: streams, renders Markdown, and wires the
  // code-block buttons. onUseCode(code) enables "Use in editor".
  // Under a finished answer: Copy, then Retry (onRetry), Save (saveAs), and
  // either "Ask <chat site>" (onAskChat, for API answers) or "Open in chat"
  // (openInChat, for answers the chat site wrote).
  // inline: drawn as part of what it answers (a walkthrough block, a review
  // step) rather than as a separate card
  answerCard(container, { title, onUseCode = null, collapsible = false, saveAs = null, onRetry = null, onAskChat = null, openInChat = true, inline = false } = {}) {
    const card = document.createElement('div');
    card.className = 'answer-card is-writing' + (inline ? ' is-inline' : '');
    const icon = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const act = (id, label, svg, extra = '') =>
      `<button type="button" class="answer-act" data-ans="${id}" title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}"${extra}>${svg}</button>`;
    const chatName = this.getCurrentModel()?.name || 'the chat';
    // A foldable answer's title is its toggle, with a chevron that says which way it goes
    const titleHtml = `<span class="answer-title">${this.escapeHtml(title)}</span>`;
    card.innerHTML =
      `<div class="answer-head">` + (collapsible
        ? `<button type="button" class="answer-toggle" data-ans="toggle" aria-expanded="true">${titleHtml}` +
          `<svg class="answer-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>`
        : titleHtml) +
      `<span class="answer-status" aria-live="polite"></span></div>` +
      `<div class="answer-body md"><div class="answer-wait" aria-label="Waiting for the answer"><i></i><i></i><i></i></div></div>` +
      `<div class="answer-foot" hidden>` +
        act('copy', 'Copy as Markdown', icon('<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>')) +
        (onRetry ? act('retry', 'Ask again', icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>')) : '') +
        (saveAs ? act('save', 'Keep in Saved answers', icon('<path d="M6 3h12v18l-6-4-6 4z"></path>')) : '') +
        (onAskChat
          ? `<button type="button" class="answer-chip" data-ans="askchat" title="Ask the same question in ${this.escapeHtml(chatName)} (free)">Ask ${this.escapeHtml(chatName)}</button>`
          : openInChat && !inline ? `<button type="button" class="answer-chip" data-ans="chat" title="Show the chat (the answer is there too)">Open in chat</button>` : '') +
      `</div>`;
    container.appendChild(card);
    const body = card.querySelector('.answer-body');
    const foot = card.querySelector('.answer-foot');
    let code = [];
    let pending = null;
    let finalText = '';
    const paint = (text, final = false) => {
      const r = renderMarkdown(text);
      body.innerHTML = r.html;
      code = r.code;
      if (!onUseCode) body.querySelectorAll('[data-md-act="use"]').forEach(b => b.remove());
      if (final) this.linkFileRefs(body);
    };
    // A button says what happened for a moment, then goes back
    const flash = (btn, cls) => {
      btn.classList.add(cls);
      setTimeout(() => btn.classList.remove(cls), 1400);
    };
    // Folded from outside too (an older answer folds when a new one arrives)
    const toggle = card.querySelector('.answer-toggle');
    if (toggle) new MutationObserver(() => toggle.setAttribute('aria-expanded', String(!card.classList.contains('collapsed'))))
      .observe(card, { attributes: true, attributeFilter: ['class'] });
    card.addEventListener('click', async (e) => {
      const ref = e.target.closest('[data-file-ref]');
      if (ref) { this.openRepoFile(JSON.parse(ref.dataset.fileRef)); return; }
      // A folded answer's faded preview opens it
      if (card.classList.contains('collapsed') && e.target.closest('.answer-body')) { card.classList.remove('collapsed'); return; }
      const btn = e.target.closest('[data-md-act], [data-ans]');
      if (!btn) return;
      const ans = btn.dataset.ans;
      if (ans === 'chat') { this.closeSheets(); return; }
      if (ans === 'toggle') { card.classList.toggle('collapsed'); return; }
      if (ans === 'retry') { onRetry?.(); return; }
      if (ans === 'askchat') { btn.disabled = true; onAskChat?.(); return; }
      if (ans === 'copy') {
        try { await navigator.clipboard.writeText(finalText); flash(btn, 'is-done'); } catch (err) { /* ignore */ }
        return;
      }
      if (ans === 'save') {
        if (btn.disabled) return;
        await this.addHistoryEntry({
          id: 'h_' + Date.now(), ts: Date.now(), platform: card.querySelector('.answer-title').textContent || 'AI', url: '',
          prompt: saveAs.prompt || title || '', answer: finalText,
          topic: (this._readingContext && Date.now() - this._readingContext.ts < 3600000) ? this._readingContext.label : ''
        });
        btn.classList.add('is-done');
        btn.disabled = true;
        btn.title = 'Saved';
        return;
      }
      if (btn.dataset.mdAct === 'unfold') {
        btn.closest('.md-code')?.classList.remove('is-folded');
        btn.remove();
        return;
      }
      const block = code[Number(btn.closest('[data-code-index]')?.dataset.codeIndex)];
      if (!block) return;
      const mdAct = btn.dataset.mdAct;
      if (mdAct === 'copy') {
        try { await navigator.clipboard.writeText(block.code); btn.textContent = 'Copied ✓'; } catch (err) { /* ignore */ }
        setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
      } else if (mdAct === 'use' && onUseCode) {
        onUseCode(block.code);
      }
    });
    const status = (text) => { card.querySelector('.answer-status').textContent = text; };
    return {
      el: card,
      // Streaming updates are painted at most once per frame
      update: (text) => {
        // done() may land before the frame does: then there's nothing left to paint
        if (pending == null) requestAnimationFrame(() => { if (pending != null) paint(pending); pending = null; });
        pending = text;
      },
      done: (text) => {
        pending = null;
        finalText = text;
        paint(text, true);
        card.classList.remove('is-writing');
        status('');
        foot.hidden = false;
      },
      // Answered through the API: which model is writing it
      setModel: (label) => { card.querySelector('.answer-title').textContent = label; },
      fail: (msg) => {
        card.classList.remove('is-writing');
        card.classList.add('is-failed');
        body.querySelector('.answer-wait')?.remove();
        status('⚠️ ' + msg);
        // A failed answer can be asked again; nothing else applies
        foot.querySelectorAll('[data-ans]:not([data-ans="retry"]):not([data-ans="askchat"])').forEach(b => b.remove());
        foot.hidden = !foot.children.length;
      }
    };
  }

  // Ask in the background and stream the answer into a card in `container`
  // via: 'chat' or 'api' to force a route; otherwise the model menu's choice
  async showAnswerIn(container, title, prompt, opts = {}) {
    // show(text, final): the part of the reply the card displays (all of it by default)
    const { attachments = [], onUseCode = null, onDone = null, saveAs = null, collapsible = true, via = null, inline = false, topic = undefined, show = (t) => t } = opts;
    const api = (via || this.answerWith) === 'api';
    const inThread = container === this.threadBody;
    // Retry and "Ask <chat>" in the thread show as busy there, like any question
    const again = async (card, nextOpts, replace) => {
      if (this._panelAsk || this.threadBusy()) { this.showNotification('Wait for the current answer first'); return; }
      if (replace) {
        // The retried turn shouldn't stay in the API conversation
        if (api && card.el === [...container.querySelectorAll('.answer-card')].pop()) this._apiHistory?.splice(-2);
        card.el.remove();
      }
      if (inThread) this.setBusy(true);
      try {
        await this.showAnswerIn(container, nextOpts.via === 'chat' ? this.getCurrentModel()?.name || 'Chat' : title, prompt, nextOpts);
      } finally {
        if (inThread) this.setBusy(false);
      }
    };
    const card = this.answerCard(container, {
      title, onUseCode, collapsible, saveAs, inline,
      onRetry: () => again(card, opts, true),
      // A second opinion from the chat site, which hasn't seen this conversation
      onAskChat: api ? () => again(card, { ...opts, via: 'chat', handoff: card.el }, false) : null
    });
    // The conversation so far goes with the question after a model switch,
    // and with a second opinion (minus the answer it's a second opinion on)
    this.claimChat(topic);   // back to the conversation from other work: it's handed over
    let askPrompt = prompt;
    let askAttachments = attachments;
    const prior = inThread ? this.threadTurns().filter(t => t.el !== opts.handoff) : [];
    const handoff = prior.length > 0 && (this._handoff || !!opts.handoff);
    if (handoff && api) {
      this._apiHistory = turnsToMessages(prior);
    } else if (handoff) {
      askPrompt = `${HANDOFF_NOTE}\n\n${prompt}`;
      askAttachments = [...attachments, { filename: 'conversation-so-far.md', content: transcriptMarkdown(prior), mime: 'text/markdown' }];
    }
    card.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      // Bring the answer's top into view once it starts arriving
      let shown = false;
      const text = await this.askInPanel(askPrompt, {
        attachments: askAttachments, via, topic,
        onModel: (label) => card.setModel(label),
        onProgress: (t) => {
          card.update(show(t));
          if (!shown && t) { shown = true; card.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        }
      });
      card.done(show(text, true));
      onDone?.(text);
      if (inThread) {
        if (handoff && !opts.handoff) this._handoff = false;   // the new model has it now
        this._turns = [...this.threadTurns(), { q: saveAs?.prompt || title, a: text, by: card.el.querySelector('.answer-title').textContent, el: card.el }];
      }
      if (api && inThread) this.suggestFollowups(card.el, saveAs?.prompt || '', text);
      return text;
    } catch (e) {
      card.fail(e.message);
      return null;
    }
  }

  // Three short next questions under the latest API answer, from a free
  // model only (never the paid one). Tapping one asks it.
  async suggestFollowups(cardEl, question, answer) {
    const route = buildRoute(await loadApiConfig()).filter(s => !s.paid);
    if (!route.length) return;
    let list = [];
    try {
      const { text } = await askRoute(route, [
        { role: 'system', content: 'Suggest exactly 3 short follow-up questions the user is likely to ask next, in their language. Reply with only a JSON array of strings, each under 70 characters.' },
        { role: 'user', content: `Question: ${question.slice(0, 1000)}\n\nAnswer:\n${answer.slice(0, 6000)}` }
      ]);
      list = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]').filter(q => typeof q === 'string' && q.trim()).slice(0, 3);
    } catch (e) {
      console.warn('[Yavar] No follow-up suggestions:', e.message);   // optional: the answer stands without them
      return;
    }
    // Only if this is still the latest answer
    if (!list.length || !cardEl.isConnected || cardEl !== [...this.threadBody.querySelectorAll('.answer-card')].pop()) return;
    const box = document.createElement('div');
    box.className = 'answer-followups';
    list.forEach((q, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer-followup';
      b.style.setProperty('--i', i);
      b.textContent = q.trim();
      b.addEventListener('click', () => {
        this.threadInput.value = q.trim();
        this.sendComposer();
      });
      box.appendChild(b);
    });
    cardEl.appendChild(box);
  }
}
