// Build it yourself: the plan, its steps, hints and reviews.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { earlierAnswers } from '../utils/conversation.js';
import { pickCoreFiles, planPrompt, hintPrompt, askPrompt, checkPrompt, parseRebuildPlan } from '../utils/rebuild.js';
import { estimateTokens, formatCount, readingPrompt } from '../utils/github.js';

export class RebuildPart {
  rebuildKey() {
    const k = this.readMarksKey();
    return k ? k.replace(/^readMarks:/, 'rebuild:') : null;
  }

  async loadRebuild() {
    const key = this.rebuildKey();
    if (!key) return null;
    try { return (await chrome.storage.local.get(key))[key] || null; } catch (e) { return null; }
  }

  async saveRebuild(state) {
    const key = this.rebuildKey();
    if (!key) return;
    this.rebuild = state;
    try { await chrome.storage.local.set({ [key]: state }); } catch (e) { /* ignore */ }
    const gh = this._tabCtx?.gh;
    if (gh && key === `rebuild:${gh.owner}/${gh.repo}`) {
      this._tabCtx.rebuild = this.rebuildStatus(state);
      this.renderHome();
    }
  }

  // "Step 3 of 8 · continue" for a plan in progress, null when there is none
  rebuildStatus(state) {
    const n = state?.plan?.steps?.length;
    if (!n) return null;
    const done = state.done?.length || 0;
    return done >= n ? `All ${n} steps done` : `Step ${Math.min((state.current || 0) + 1, n)} of ${n} · continue where you left off`;
  }

  // For the repo in the tab, or else the local folder you last opened
  async openRebuild() {
    try {
      if (this._tabCtx?.gh) await this.ensureRepoTree();
    } catch (e) {
      this.showNotification(e.message);
      return;
    }
    if (!this.repoTree) {
      this.showNotification('Open a GitHub repository, or add files from a folder first');
      return;
    }
    this.rebuild = await this.loadRebuild();
    document.getElementById('rebuild-sub').textContent = this.repoDisplayName();
    this.rebuildPanel.classList.remove('hidden');
    this.renderRebuild();
  }

  async resetRebuild() {
    if (!this.rebuild?.plan) return;
    if (!this.confirmTwice('rebuild', 'Click again to discard this plan and start over')) return;
    await this.saveRebuild(null);
    this.renderRebuild();
  }

  // One step at a time under the shared step bar: what to learn, which
  // original files to study (they open in the reader), the task, your code,
  // and hints and reviews in place. Marking a step done is its own act.
  renderRebuild() {
    const st = this.rebuild;
    const esc = (t) => this.escapeHtml(t || '');
    if (!st?.plan) {
      const core = pickCoreFiles(this.repoTree.items);
      const bytes = core.reduce((n, p) => n + (this.repoTree.sizes.get(p) || 0), 0);
      this.rebuildBody.innerHTML =
        `<p class="wk-summary">Build a small version of this project yourself, one step at a time. The AI reads its core files ` +
          `and writes the plan; for each step you study the original, write your own, and ask for a hint or a review.</p>` +
        `<div class="jr-head"><span class="rebuild-label">Core files it will read</span>` +
          `<span class="jr-count">${core.length} · ~${formatCount(estimateTokens(bytes))} tokens</span></div>` +
        `<div class="jr-files rb-core">${core.map(p =>
          `<button type="button" class="jr-file" data-rb="open" data-path="${esc(p)}" title="Open ${esc(p)} in the reader">${esc(p.split('/').pop())}</button>`).join('')}</div>` +
        (this._planPending
          ? `<div class="rebuild-wait"><span class="files-spinner"></span>The AI is writing your plan…<div class="rebuild-live"></div></div>`
          : `<div class="jr-actions rb-start">` +
              `<button type="button" class="files-link-btn jr-link" data-rb="load">Load a plan already in the chat</button>` +
              (core.length ? `<button type="button" class="files-send jr-primary" data-rb="create">Create my plan →</button>` : '') +
            `</div>`);
      return;
    }

    const { plan, current = 0, done = [], code = {} } = st;
    const n = plan.steps.length;
    const i = Math.min(current, n - 1);
    const s = plan.steps[i];
    const isDone = done.includes(i);
    const study = (s.study || []).map(p => this.repoTree.fileSet.has(p)
      ? `<button type="button" class="jr-file" data-rb="study" data-path="${esc(p)}" title="Open ${esc(p)} in the reader and explain it for this step">${esc(p.split('/').pop())}</button>`
      : `<span class="jr-file is-missing" title="Not found in this repository">${esc(p.split('/').pop())}</span>`).join('');

    this.rebuildBody.innerHTML =
      this.stepBar({
        act: 'rb', context: this.repoDisplayName(), where: `Step ${i + 1} of ${n}`, first: i === 0,
        pct: Math.round((done.length / n) * 100),
        next: `<button type="button" class="wk-step" data-rb="fwd" aria-label="Next step"${i === n - 1 ? ' disabled' : ''}>›</button>`,
        items: plan.steps.map((x, k) => ({ i: k, current: k === i, mark: done.includes(k) ? '✓' : k + 1, title: esc(x.title) })),
        extra: `<button type="button" class="files-link-btn wk-redo" data-rb="reset">Start over with a new plan</button>`
      }) +
      (i === 0 && plan.summary ? `<p class="wk-summary">${esc(plan.summary)}</p>` : '') +
      `<h3 class="wk-title">${esc(s.title)}</h3>` +
      (s.goal ? `<p class="rb-goal">${esc(s.goal)}</p>` : '') +
      (study ? `<div class="rebuild-label">Study first</div><div class="jr-files">${study}</div>` : '') +
      `<div class="rebuild-label">Your task</div><p class="wk-explain">${esc(s.task)}</p>` +
      (s.done_when ? `<div class="rebuild-label">Done when</div><p class="wk-explain">${esc(s.done_when)}</p>` : '') +
      `<div class="rebuild-label">Your code</div>` +
      `<div class="code-box" aria-label="Your code for this step"></div>` +
      `<div class="rebuild-mentor"></div>` +
      `<div class="rb-done">` + (isDone
        ? `<span class="rb-done-note">✓ Step done</span><button type="button" class="files-link-btn jr-link" data-rb="undone">Undo</button>`
        : `<button type="button" class="files-send jr-primary" data-rb="done">${i === n - 1 ? 'Mark the last step done' : 'Mark done and continue →'}</button>`) +
      `</div>` +
      `<div class="wk-dock">` + this.askBox('data-rb', 'Ask about this step…',
        `<button type="button" class="run-ask" data-rb="hint">Hint</button>` +
        `<button type="button" class="run-ask" data-rb="check">Review my code</button>`) +
      `</div>`;

    this._rbCode = this.makeCodeBox(this.rebuildBody.querySelector('.code-box'), {
      value: code[i] || '', lang: plan.language, placeholder: 'Write your version of this step…',
      onChange: (value) => {
        clearTimeout(this._rbSave);
        this._rbSave = setTimeout(() => this.saveRebuild({ ...this.rebuild, code: { ...(this.rebuild.code || {}), [i]: value } }), 400);
      }
    });

    // Earlier hints and reviews for this step, folded
    const mentor = this.rebuildBody.querySelector('.rebuild-mentor');
    for (const note of (st.mentor?.[i] || [])) {
      const card = this.answerCard(mentor, { title: note.title.replace(/^\p{Extended_Pictographic}️?‍?\p{Extended_Pictographic}?\s*/u, ''), onUseCode: (c) => this.setStepCode(c), collapsible: true, openInChat: false, inline: true });
      card.done(note.text);
      card.el.classList.add('collapsed');
    }
  }

  // Put code into the current step's editor (e.g. "Use in editor" on an answer)
  setStepCode(code) {
    if (!this._rbCode) return;
    this._rbCode.setValue(code);
    this._rbCode.focus();
  }

  async addMentorNote(i, title, text) {
    const st = this.rebuild;
    if (!st?.plan) return;
    const mentor = { ...(st.mentor || {}) };
    mentor[i] = [...(mentor[i] || []), { title, text, ts: Date.now() }].slice(-6);
    await this.saveRebuild({ ...st, mentor });
  }

  async onRebuildClick(e) {
    if (!e.target.closest('.wk-bar')) this.closeStepList(this.rebuildBody);
    const el = e.target.closest('[data-rb]');
    if (!el || el.disabled) return;
    const act = el.dataset.rb;
    const st = this.rebuild;
    if (act === 'close') return this.rebuildPanel.classList.add('hidden');
    if (act === 'create') return this.createRebuildPlan();
    if (act === 'load') return this.loadPlanFromChat();
    if (act === 'open') return this.openRepoFile(this.fileRefFor(el.dataset.path));
    if (!st?.plan) return;
    const n = st.plan.steps.length;
    const i = Math.min(st.current || 0, n - 1);
    const code = this._rbCode?.getValue() || '';
    const go = async (k, changes = {}) => {
      await this.saveRebuild({ ...st, ...changes, current: k, code: { ...(st.code || {}), [i]: code } });
      this.renderRebuild();
      this.rebuildBody.scrollTop = 0;
    };

    if (act === 'list') {
      this.toggleStepList(this.rebuildBody, el);
    } else if (act === 'reset') {
      await this.resetRebuild();
    } else if (act === 'goto') {
      await go(Number(el.dataset.i));
    } else if (act === 'prev') {
      await go(Math.max(0, i - 1));
    } else if (act === 'fwd') {
      await go(Math.min(i + 1, n - 1));
    } else if (act === 'done') {
      const done = [...new Set([...(st.done || []), i])];
      await go(Math.min(i + 1, n - 1), { done });
      if (done.length === n) this.showNotification('You rebuilt the whole plan. Try extending it with a feature of your own.');
    } else if (act === 'undone') {
      await go(i, { done: (st.done || []).filter(k => k !== i) });
    } else if (act === 'study') {
      // Explained right here in the step, like hints, so the plan stays open
      const path = el.dataset.path;
      const name = path.split('/').pop();
      el.disabled = true;
      this.openRepoFile(this.fileRefFor(path));
      try {
        const [file] = await this.fetchRepoFilesMany([path]);
        if (file.error) throw new Error(file.error);
        const fname = name + '.md';
        const title = 'About ' + name;
        await this.showAnswerIn(this.rebuildBody.querySelector('.rebuild-mentor'), title,
          `The attached "${fname}" is \`${path}\` from ${this.repoDisplayName()}. I am rebuilding this project step by step ` +
          `and am on the step "${st.plan.steps[i].title}". ${readingPrompt('explain', { what: `\`${path}\``, repo: this.repoDisplayName() }, this._promptEdits)}\n\n` +
          'Point out the parts that matter for this step. Do not write the step for me.', {
            attachments: [{ filename: fname, content: this.packFor([file]) }],
            via: 'chat', inline: true,
            onUseCode: (c) => this.setStepCode(c),
            onDone: (text) => this.addMentorNote(i, title, text)
          });
        await this.markRead([path]);
      } catch (e) {
        this.showNotification('⚠️ Could not read ' + name + ': ' + e.message);
      } finally {
        el.disabled = false;
      }
    } else if (act === 'hint' || act === 'check') {
      // Answered right here in the step; the chat keeps the conversation
      if (act === 'check' && !code.trim()) { this.showNotification('Write your code for this step first'); return; }
      const mentor = this.rebuildBody.querySelector('.rebuild-mentor');
      let prompt = hintPrompt(st.plan, i);
      let attachments = [];
      if (act === 'check') {
        const study = (st.plan.steps[i].study || []).filter(p => this.repoTree.fileSet.has(p));
        const files = study.length ? (await this.fetchRepoFilesMany(study)).filter(f => !f.error) : [];
        if (files.length) attachments = [{ filename: `step-${i + 1}-original.md`, content: this.packFor(files) }];
        prompt = checkPrompt(st.plan, i, code, attachments.length > 0);
      }
      const title = act === 'hint' ? 'Hint' : 'Review of your code';
      el.disabled = true;
      await this.showAnswerIn(mentor, title, prompt, {
        attachments, via: 'chat', inline: true,
        onUseCode: (c) => this.setStepCode(c),
        onDone: (text) => this.addMentorNote(i, title, text)
      });
      el.disabled = false;
    } else if (act === 'ask') {
      const q = this.takeQuestion(this.rebuildBody);
      if (!q) return;
      const title = q.length > 80 ? q.slice(0, 79) + '…' : q;
      el.disabled = true;
      await this.showAnswerIn(this.rebuildBody.querySelector('.rebuild-mentor'), title, askPrompt(st.plan, i, code, q, earlierAnswers(st.mentor?.[i])), {
        via: 'chat', inline: true,
        onUseCode: (c) => this.setStepCode(c),
        onDone: (text) => this.addMentorNote(i, title, text)
      });
      el.disabled = false;

    }
  }

  async createRebuildPlan() {
    if (this._planPending) return;
    const paths = pickCoreFiles(this.repoTree.items);
    if (!paths.length) return;
    this._planPending = true;
    this.renderRebuild();
    try {
      const files = (await this.fetchRepoFilesMany(paths)).filter(f => !f.error);
      if (!files.length) throw new Error('could not read the project files');
      const attachments = [{ filename: `${this.repoTree.repo}-core-files.md`.replace(/[^\w.-]+/g, '-'), content: this.packFor(files) }];
      // Show the step titles as the AI writes them
      const { value, text, tried } = await this.askForJson(planPrompt(this.repoDisplayName()), {
        attachments, live: this.rebuildBody, list: 'title|name', parse: parseRebuildPlan
      });
      if (!value) throw new Error(`couldn't find a plan in the replies (asked ${tried})`);
      await this.adoptPlan(text);
    } catch (e) {
      this.showNotification('⚠️ ' + e.message + '. When the plan is in the chat, use "Load it".');
    } finally {
      this._planPending = false;
      if (!this.rebuildPanel.classList.contains('hidden') || !this.rebuild?.plan) this.renderRebuild();
    }
  }

  async adoptPlan(text) {
    const plan = parseRebuildPlan(text);
    if (!plan) throw new Error("couldn't find a plan in the AI's reply");
    if (!plan.project) plan.project = this.repoDisplayName();
    await this.saveRebuild({ plan, current: 0, done: [], code: {}, created: Date.now() });
    this.rebuildPanel.classList.remove('hidden');
    this.renderRebuild();
    this.showNotification(`🛠 Plan ready: ${plan.steps.length} steps`);
  }
}
