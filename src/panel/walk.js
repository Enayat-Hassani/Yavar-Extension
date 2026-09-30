// Walking through a file block by block, or a change part by part: the parts,
// the reader following them, the actions on each, and the review summary at
// the end.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { renderMarkdown } from '../utils/markdown.js';
import { icon } from '../utils/icons.js';
import { walkPrompt, parseWalkthrough, compareTyped, quizPrompt, parseQuiz, textSha } from '../utils/walkthrough.js';
import { nextCandidates, nextPrompt, parseNext, isDocPath, moveInPath } from '../utils/journey.js';
import {
  parseDiff,
  changeBlocks,
  changePack,
  partContext,
  partTitle,
  orderParts,
  linesBatch,
  linesPrompt,
  splitParts,
  carryNotes,
  fileGroups,
  fileContext,
  isProse
} from '../utils/changes.js';
import { intentText } from '../utils/intents.js';
import { earlierAnswers } from '../utils/conversation.js';
import { loadApiConfig, buildRoute, askRoute } from '../utils/llm.js';
import {
  estimateTokens,
  formatCount,
  sliceLines,
  extractImports,
  resolveImports,
  fencedFile,
  CITE_RULE,
  LINE_NUMBER_NOTE,
  langFromPath
} from '../utils/github.js';

// Of the 10 MB Chrome gives an extension's storage (see pruneWalks)
const STORE_FULL = 7 * 1024 * 1024;
const STORE_AFTER = 5 * 1024 * 1024;
const UNUSED = 90 * 24 * 60 * 60 * 1000;

export class WalkPart {
  // The AI splits a file into blocks of related lines; the sheet shows one
  // block at a time with its explanation, and the reader tab highlights the
  // same lines. Each block can be explained further, quizzed or retyped.
  // Progress is kept per file (walk:<repo>:<path>).
  walkKey(path) {
    const k = this.readMarksKey();
    return k ? `${k.replace(/^readMarks:/, 'walk:')}:${path}` : null;
  }

  // Saved with when it was last used, which decides what pruneWalks lets go
  // first. Storage full: room is made, and the save tried once more.
  async saveWalk(state) {
    this.walk = state;
    const key = state.key || this.walkKey(state.path);
    if (!key) return;
    const value = { ...state, opened: Date.now() };
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      await this.pruneWalks({ force: true });
      try { await chrome.storage.local.set({ [key]: value }); } catch (e2) {
        this.showNotification(`⚠️ Your place in this walk wasn't saved: ${e2.message}`);
      }
    }
  }

  // Saved walks (every file, commit, pull request and review read) only grow,
  // and an extension's storage holds 10 MB. Past STORE_FULL (or `force`, when
  // a save failed), walks not used for 90 days go, then the oldest, until it
  // is under STORE_AFTER. The open walk stays; reading maps are not walks.
  async pruneWalks({ force = false } = {}) {
    let used;
    try { used = await chrome.storage.local.getBytesInUse(null); } catch (e) { return; }
    if (!force && used < STORE_FULL) return;
    const all = await chrome.storage.local.get(null);
    const open = this.walk?.blocks ? this.walk.key || this.walkKey(this.walk.path) : null;
    const walks = Object.entries(all).filter(([k]) => k.startsWith('walk:') && k !== open)
      .map(([k, v]) => ({ k, at: v?.opened || v?.created || 0, size: k.length + JSON.stringify(v).length }))
      .sort((a, b) => a.at - b.at);
    const drop = [];
    for (const w of walks) {
      if (w.at > Date.now() - UNUSED && used <= STORE_AFTER) break;
      drop.push(w.k);
      used -= w.size;
    }
    if (!drop.length) return;
    await chrome.storage.local.remove(drop);
    this.showNotification(`Made room: ${drop.length} saved walk${drop.length === 1 ? '' : 's'} you hadn't opened for the longest were removed`);
  }

  // "Walk through <file>" on a GitHub file page (honours a #L10-L40 selection)
  async walkActiveFile() {
    try {
      if (!(await this.ensureRepoTree()) || !this.activeRepoFile) {
        this.showNotification('⚠️ Open a file on GitHub first');
        return;
      }
    } catch (e) {
      this.showNotification('⚠️ ' + e.message);
      return;
    }
    const { path, lines } = this.activeRepoFile;
    await this.startWalk(path, lines);
  }

  // Carry on with a saved walk that covers these lines, or ask for a new one
  async startWalk(path, lines = null) {
    if (!this.repoTree) return;
    const key = this.walkKey(path);
    let saved = null;
    try { saved = key ? (await chrome.storage.local.get(key))[key] : null; } catch (e) { /* none */ }
    const covers = saved?.blocks?.length && (!lines || (lines.start >= saved.range.start && lines.end <= saved.range.end));
    this.journey = await this.loadJourney();   // for the way back to the map, and what's been read
    this.walkView = 'file';
    document.getElementById('walk-title').textContent = 'Walk through';
    document.getElementById('walk-sub').textContent = path.split('/').pop();
    this.walkPanel.classList.remove('hidden');
    if (covers) {
      const at = lines ? saved.blocks.findIndex(b => b.end >= lines.start) : saved.current;
      await this.saveWalk({ ...saved, current: Math.max(0, at) });
      this.renderWalk();
      this.followWalk();
      this.checkWalkFile();
      return;
    }
    await this.createWalk(path, lines);
  }

  async createWalk(path, lines = null, startAt = null) {
    if (isDocPath(path)) return this.createDocWalk(path);
    if (this._walkPending) return;
    const MAX_LINES = 400;
    this._walkPending = true;
    this._walkRaw = '';
    this.walk = { path, pending: true };
    this.renderWalk();
    try {
      const content = (await this.readRepoFile(path)).replace(/\n$/, '');
      const total = content.split('\n').length;
      const start = lines?.start || startAt || 1;
      const range = { start, end: Math.min(lines?.end || total, start + MAX_LINES - 1, total) };
      const slice = sliceLines(content, range.start, range.end);
      const file = { path, content: slice, lines: range };
      const repo = this.repoDisplayName();
      // Short files go inline, like the reader does; longer ones as one attachment
      const inline = slice.length <= 4000;
      const fname = path.split('/').pop() + '.md';
      const prompt = inline
        ? `${walkPrompt({ path, repo, range, source: 'Below is' })}\n\n${LINE_NUMBER_NOTE}\n\n${fencedFile(file)}`
        : walkPrompt({ path, repo, range, source: `The attached "${fname}" is` });
      const { value: parsed, text, tried } = await this.askForJson(prompt, {
        attachments: inline ? [] : [{ filename: fname, content: this.packFor([file]) }], live: this.walkBody, list: 'title', topic: this.readTopic(),
        parse: (t) => parseWalkthrough(t, range)
      });
      if (!parsed) {
        this._walkRaw = text;
        throw new Error(`couldn't find the blocks in the replies (asked ${tried})`);
      }
      await this.saveWalk({ path, range, total, summary: parsed.summary, blocks: parsed.blocks, current: 0, typed: {}, created: Date.now(),
        sha: await textSha(content) });
      await this.markRead([path]);
      this._readingContext = { label: repo, ts: Date.now() };
      this.followWalk();
    } catch (e) {
      this.walk = { path, lines, startAt, error: e.message };
    } finally {
      this._walkPending = false;
      this.renderWalk();
    }
  }

  // A document (the README, a plan, design notes) is summed up in prose, not
  // split into blocks: its walk is one block, the whole file, whose
  // explanation is the summary. Questions, Quiz me and Finish file work as
  // they do for code.
  async createDocWalk(path) {
    if (this._walkPending) return;
    this._walkPending = true;
    this._walkRaw = '';
    this.walk = { path, doc: true, pending: true };
    this.renderWalk();
    try {
      const content = (await this.readRepoFile(path)).replace(/\n$/, '');
      const total = content.split('\n').length;
      const repo = this.repoDisplayName();
      const name = path.split('/').pop();
      const fname = /\.md$/i.test(name) ? name : `${name}.md`;
      const summary = await this.askInPanel(
        `I'm reading ${repo}, starting from the big picture. The attached "${fname}" is its document \`${path}\`. ${intentText(this._promptEdits, 'doc')}`,
        { via: 'chat', topic: this.readTopic(), attachments: [{ filename: fname, content }] });
      if (!summary?.trim()) throw new Error('the chat gave no summary');
      await this.saveWalk({ path, doc: true, range: { start: 1, end: total }, total, summary: '', current: 0, typed: {}, created: Date.now(),
        blocks: [{ start: 1, end: total, title: name, explain: summary }], sha: await textSha(content) });
      await this.markRead([path]);
      this._readingContext = { label: repo, ts: Date.now() };
      this.followWalk();
    } catch (e) {
      this.walk = { path, doc: true, error: e.message };
    } finally {
      this._walkPending = false;
      this.renderWalk();
    }
  }

  // Like a file, part by part: the diff is split here (utils/changes.js),
  // the chat orders and explains the parts, and the reader shows each part's
  // file as it is after the change. Kept per change (walk:<repo>:@<id>).
  async walkChange(gh) {
    const { owner, repo, kind, sha, number, title = '' } = gh;
    // A local change (reviewLocal) arrives whole: its label, and a key made
    // from its diff, so the same changes reopen their walk
    const change = gh.local ? gh : { owner, repo, kind, sha, number, title,
      label: kind === 'pull' ? `Pull request #${number}` : `Commit ${sha.slice(0, 7)}`,
      ref: kind === 'pull' ? `refs/pull/${number}/head` : sha,
      key: `walk:${owner}/${repo}:@${kind === 'pull' ? `pr-${number}` : sha}` };
    let saved = null;
    try { saved = (await chrome.storage.local.get(change.key))[change.key]; } catch (e) { /* none */ }
    // A pull request gains commits: its diff is fetched again and compared
    if (kind === 'pull' && saved?.blocks) {
      try {
        const text = await this.fetchDiff({ owner, repo, kind, number });
        change.diffHash = await textSha(text);
        this._fetchedDiff = { key: change.key, text };
      } catch (e) {
        change.diffHash = saved.change?.diffHash;   // offline: the saved walk stands
      }
    }
    this.walkView = 'file';
    document.getElementById('walk-title').textContent = 'Read the change';
    document.getElementById('walk-sub').textContent = change.label + (change.title ? ` · ${change.title}` : '');
    this.walkPanel.classList.remove('hidden');
    // Your own changes, or a pull request, that moved on since are read again
    if (saved?.blocks?.length && saved.change?.diffHash === change.diffHash) {
      this.walk = saved;
      this.renderWalk();
      this.followWalk();
      return;
    }
    // Opened on the repository's own page: its file tree lets the AI ask for files
    const tab = this._tabCtx?.gh;
    if (!change.local && tab && tab.owner === owner && tab.repo === repo) await this.ensureRepoTree().catch(() => {});
    await this.createChangeWalk(change, saved?.blocks ? saved : null);
  }

  // `before`: an earlier walk of the same changes, whose notes carry over to
  // the parts whose diff is the same
  async createChangeWalk(change, before = null) {
    if (this._walkPending) return;
    const { owner, repo, kind, sha, number, key } = change;
    this._walkPending = true;
    this._walkRaw = '';
    this.retireChat(key);
    this.walk = { key, change, pending: true };
    this.renderWalk();
    try {
      const fetched = this._fetchedDiff?.key === key ? this._fetchedDiff.text : null;
      this._fetchedDiff = null;
      const text = change.local ? await this.localDiff(change) : fetched ?? await this.fetchDiff({ owner, repo, kind, sha, number });
      // The walk is of the diff as it is now (read again by Ask again, Start over)
      if (change.local || kind === 'pull') change = { ...change, diffHash: await textSha(text) };
      const files = parseDiff(text);
      const { blocks, skipped } = changeBlocks(files);
      if (!blocks.length) throw new Error(files.length ? 'only lockfiles, generated or binary files changed' : 'the diff is empty');
      // The parts are ready at once, in reading order and named after their
      // functions; the chat explains them as they are opened (lines)
      const what = change.local ? change.what : kind === 'pull' ? `pull request #${number}` : `commit ${sha.slice(0, 7)}`;
      const fname = `${repo}-${change.local ? change.base : kind === 'pull' ? `pr-${number}` : sha.slice(0, 7)}-changes.md`.replace(/[^\w.-]+/g, '-');
      const parts = orderParts(blocks).map(b => ({ ...b, title: partTitle(b), explain: '' }));
      const notes = carryNotes(before, parts);
      await this.saveWalk({ key, change, what, fname, summary: '', blocks: parts, skipped, notes, current: 0, typed: {}, created: Date.now() });
      this._readingContext = { label: owner ? `${owner}/${repo}` : repo, ts: Date.now() };
      this.followWalk();
    } catch (e) {
      this.walk = { key, change, error: e.message };
    } finally {
      this._walkPending = false;
      this.renderWalk();
    }
  }

  // A file walk opened again: has the file changed since (edited elsewhere,
  // or new commits)? Then its blocks may sit on the wrong lines, and the walk
  // says so. A walk saved before walks kept the hash takes today's as its own.
  async checkWalkFile() {
    const w = this.walk;
    if (!w?.blocks || w.change) return;
    let sha;
    try { sha = await textSha(await this.readRepoFile(w.path)); } catch (e) { return; }
    if (this.walk !== w) return;
    if (!w.sha) return this.saveWalk({ ...w, sha });
    if (w.sha === sha) return;
    this._walkStale = this.walkKey(w.path);
    this.renderWalk();
  }

  async resetWalk() {
    const w = this.walk;
    if (!w?.blocks || this._walkPending) return;
    if (!this.confirmTwice('walk', 'Click again to ask for a new walkthrough')) return;
    if (w.change) return this.createChangeWalk(w.change, w);
    const partial = w.range.start > 1 || w.range.end < w.total;
    await this.createWalk(w.path, partial ? w.range : null);
  }

  // A change opened from Changes goes back there: your own work, or a
  // commit of the repository or folder loaded
  changesBack(c) {
    const t = this.repoTree;
    return !!c && (c.local || (c.kind === 'commit' && t?.source !== 'local' && t?.owner === c.owner && t?.repo === c.repo));
  }

  // Highlight the current block in the reader
  followWalk() {
    const w = this.walk;
    const b = w?.blocks?.[w.current];
    if (!b) return;
    if (w.change) {
      // The file as it is after the change, with the part's diff drawn in it
      // (a walk saved before parts kept their lines just highlights them)
      if (b.start) this.openRepoFile(this.partRef(b, { start: b.start, end: b.end }));
      return;
    }
    if (!this.repoTree) return;
    // A document is shown whole, with nothing highlighted
    this.openRepoFile({ ...this.fileRefFor(w.path, w.doc ? null : { start: b.start, end: b.end }),
      label: `Block ${w.current + 1} of ${w.blocks.length} · ${b.title}`, nav: this.walkNav(), walk: this.walkRef() });
  }

  // What the reader shows for a part of a change: the file after the change
  // with the part's diff in it, and `lines` highlighted (a line an
  // explanation names, with focus)
  // The whole file's diff is drawn, so moving between its changes only
  // moves the marked part (`diff.part`)
  partRef(b, lines, focus = false) {
    const w = this.walk;
    const { owner, repo, ref, local } = w.change;
    const files = fileGroups(w.blocks);
    const fi = files.findIndex(g => w.current >= g.first && w.current <= g.last);
    const f = files[fi];
    const parts = w.blocks.slice(f.first, f.last + 1);
    const count = f.last - f.first + 1;
    return { source: local ? 'local' : 'github', owner, repo, ref, path: b.path, lines, focus, nav: this.walkNav(), walk: this.walkRef(),
      label: `File ${fi + 1} of ${files.length}${count > 1 ? ` · Change ${w.current - f.first + 1} of ${count}` : ''} · ${partTitle(b)}`,
      diff: b.add ? { add: parts.flatMap(x => x.add || []), del: parts.flatMap(x => x.del || []), part: { add: b.add, del: b.del } } : null };
  }

  // What the reader's highlight belongs to: the walk (by its storage key) and block
  walkRef() {
    const w = this.walk;
    return { id: w.key || this.walkKey(w.path), block: w.current };
  }

  // The reader asked: step the walk (`dir`), or show its highlighted block
  // (dir 0). Its walk is reopened when the panel shows something else, or
  // was closed, so the reader never steps a walk it isn't showing.
  async followReader({ dir = 0, walk: ref, repo }) {
    if (!ref?.id) return;
    const w = this.walk;
    const showing = !this.walkPanel.classList.contains('hidden') && this.walkView === 'file' && w?.blocks;
    if (!showing || (w.key || this.walkKey(w.path)) !== ref.id) {
      if (!(await this.reopenWalk(ref, repo))) return;
    }
    if (dir) this.stepWalk(dir);
    else if (this.walk.current !== ref.block) await this.gotoWalk(ref.block);
    this.walkBody.focus({ preventScroll: true });
  }

  // A saved walk, open again at `ref.block`, with the repository or folder it
  // reads from loaded when it can be
  async reopenWalk(ref, repo) {
    let saved = null;
    try { saved = (await chrome.storage.local.get(ref.id))[ref.id]; } catch (e) { /* none */ }
    if (!saved?.blocks?.length) {
      this.showNotification('That walk is no longer saved; start it again from the file or the change');
      return false;
    }
    const c = saved.change;
    if (repo && (!c || c.local)) {
      try {
        if (!(await this.restoreSource(repo))) this.showNotification(`Open the ${repo.repo} folder again for the reader to follow`);
      } catch (e) {
        this.showNotification(`⚠️ Could not load ${repo.name}: ${e.message}`);
      }
    }
    this.walkView = 'file';
    this.walk = { ...saved, current: Math.min(ref.block, saved.blocks.length - 1), summaryOpen: false };
    this.journey = c ? null : await this.loadJourney();
    document.getElementById('walk-title').textContent = c ? 'Read the change' : 'Walk through';
    document.getElementById('walk-sub').textContent = c ? c.label + (c.title ? ` · ${c.title}` : '') : saved.path.split('/').pop();
    this.walkPanel.classList.remove('hidden');
    await this.renderWalk();
    this.checkWalkFile();
    return true;
  }

  // Whether the reader's ‹ › can step from here
  walkNav() {
    const w = this.walk;
    return { prev: w.current > 0, next: w.current < w.blocks.length - 1 || !!w.change };
  }

  // Open part `k` of the walk. In a change, the new part slides in from the
  // side you're going to, and a new file's header with it.
  async gotoWalk(k) {
    const w = this.walk;
    if (!w?.blocks?.[k]) return;
    if (w.change) {
      this._walkEnter = w.summaryOpen || k === w.current ? null : k > w.current ? 'next' : 'prev';
      this._walkFileChanged = w.summaryOpen || w.blocks[k].path !== w.blocks[w.current].path;
    }
    const had = this.walkPanel.contains(document.activeElement);
    await this.saveWalk({ ...w, current: k, summaryOpen: false });
    // The last block of the whole file reached: it counts as read on the map
    // (Finish file still suggests what to read next)
    const j = this.journey;
    if (!w.change && j && k === w.blocks.length - 1 && w.range.end >= w.total && !j.done?.includes(w.path)) {
      await this.saveJourney({ ...j, done: [...(j.done || []), w.path] });
    }
    await this.renderWalk();
    this.walkBody.scrollTop = 0;
    // The control that had focus was redrawn: keep it in the sheet, so the keys go on stepping
    if (had && !this.walkPanel.contains(document.activeElement)) this.walkBody.focus({ preventScroll: true });
    this.followWalk();
  }

  // One step through the open walk (the arrow keys, the reader's buttons).
  // False when there is no walk on screen to step.
  // With `file`, a change walk goes to the next file, or back to the start of
  // this one (or the one before, from its start).
  stepWalk(dir, { file = false } = {}) {
    if (this.walkPanel.classList.contains('hidden') || this.walkView !== 'file' || !this.walk?.blocks) return false;
    const w = this.walk;
    if (file && w.change && !w.summaryOpen) {
      const files = fileGroups(w.blocks);
      const fi = files.findIndex(g => w.current >= g.first && w.current <= g.last);
      const to = dir > 0 ? files[fi + 1]?.first : w.current > files[fi].first ? files[fi].first : files[fi - 1]?.first;
      if (to == null) return false;
      this.gotoWalk(to);
      return true;
    }
    const btn = dir < 0 ? this.walkBody.querySelector('.wk-steps [data-wk="prev"]:not(:disabled)')
      : this.walkBody.querySelector('.wk-steps [data-wk="next"], .wk-steps [data-wk="summary"], .wk-steps [data-wk="continue"]');
    if (!btn || (dir > 0 && w.summaryOpen)) return false;
    btn.click();
    return true;
  }

  // A line an explanation names (**12** or **12-14**), shown in the reader
  showLineRef(start, end) {
    const w = this.walk;
    const b = w?.blocks?.[w.current];
    if (!b) return;
    if (w.change) {
      if (b.start) this.openRepoFile(this.partRef(b, { start, end }, true));
      return;
    }
    if (!this.repoTree) return;
    this.openRepoFile({ ...this.fileRefFor(w.path, { start, end }),
      label: `Block ${w.current + 1} of ${w.blocks.length} · ${b.title}`, nav: this.walkNav(), walk: this.walkRef() });
  }

  // The current block's code, from the cached file. In a change: its new
  // lines, or what was removed when the file was deleted.
  async walkBlockCode() {
    const w = this.walk;
    const b = w.blocks[w.current];
    if (!w.change) return sliceLines(await this.readRepoFile(w.path), b.start, b.end);
    if (!b.start) return b.removedText;
    if (w.change.local) return sliceLines(await (w.change.kind === 'commit' ? this.localFileAt(w.change.sha, b.path) : this.readRepoFile(b.path)), b.start, b.end);
    const { owner, repo, ref } = w.change;
    return sliceLines(await this.fetchFileAt(owner, repo, ref, b.path), b.start, b.end);
  }

  // The code itself is in the reader tab; the panel holds what's said about
  // it. A bar that stays at the top holds the way back to the map, where you
  // are (the block list opens from it) and the steps, so a long answer never
  // pushes them out of reach.
  async renderWalk() {
    if (this.walkView !== 'file') return;   // the map or the folder choice is showing; the walk renders when you return
    const w = this.walk;
    const esc = (t) => this.escapeHtml(t || '');
    // The way back: to the reading map, or to the choice of your own changes
    const toMap = this.changesBack(w?.change) ? `<button type="button" class="wk-map" data-wk="review-back" aria-label="Back to Changes">‹</button>`
      : this.journey && !w?.change ? `<button type="button" class="wk-map" data-wk="map">‹ Map</button>` : '';
    if (!w?.blocks) {
      this.walkBody.innerHTML = (toMap ? `<div class="wk-bar">${toMap}</div>` : '') + (w?.error
        ? `<div class="sheet-intro"><p>⚠️ Could not ${w.doc ? 'sum up the document' : 'make the walkthrough'}: ${esc(w.error)}.</p>` +
          `<button type="button" class="files-send jr-primary" data-wk="retry">Ask again</button></div>` +
          this.replyDisclosure(this._walkRaw)
        : `<div class="sheet-wait"><span class="files-spinner"></span>${w?.change ? `Reading the diff of ${esc(w.change.label.toLowerCase())}…`
          : w?.doc ? `The AI is reading ${esc(w.path.split('/').pop())}…`
            : `The AI is splitting ${esc(w?.path?.split('/').pop())} into blocks…`}<div class="sheet-live"></div></div>`);
      return;
    }
    if (w.change) return w.summaryOpen ? this.renderReviewSummary() : this.renderChangeWalk(toMap);
    const { blocks, current: i, typed = {}, range, total } = w;
    const b = blocks[i];
    const n = blocks.length;
    const last = i === n - 1;
    const more = last && range.end < total;
    const best = typed[i]?.best;
    const practised = (k) => typed[k]?.best >= 90;

    this.walkBody.innerHTML =
      this.stepBar({
        act: 'wk', back: toMap, context: w.path.split('/').pop(),
        where: w.doc ? 'Summary' : `Block ${i + 1} of ${n}${range.start > 1 || range.end < total ? ` · lines ${range.start}-${range.end} of ${total}` : ''}`,
        first: i === 0, pct: Math.round(((i + 1) / n) * 100),
        next: !last ? `<button type="button" class="wk-step" data-wk="next" aria-label="Next">›</button>`
          : more ? `<button type="button" class="wk-step wk-step-text" data-wk="continue">Next lines ›</button>`
            : `<button type="button" class="wk-step wk-step-text" data-wk="finish">Finish file</button>`,
        items: blocks.map((x, k) => ({ i: k, current: k === i, mark: practised(k) ? '✓' : k + 1, title: esc(x.title), meta: `${x.start}-${x.end}` })),
        extra: `<button type="button" class="files-link-btn wk-redo" data-wk="redo">Ask for a new ${w.doc ? 'summary' : 'walkthrough'} of this file</button>`
      }) +
      (this._walkStale && this._walkStale === this.walkKey(w.path)
        ? `<p class="wk-stale" role="status">${esc(w.path.split('/').pop())} changed since this walk, so its blocks may sit on the wrong lines. ` +
          `<button type="button" class="files-link-btn" data-wk="rewalk">Walk it again</button></p>` : '') +
      (i === 0 && w.summary ? `<div class="wk-summary md">${renderMarkdown(w.summary).html}</div>` : '') +
      `<div class="wk-meta"><span>${w.doc ? `Document · ${total} line${total === 1 ? '' : 's'}` : `Lines ${b.start}-${b.end}`}${b.edited ? ' · edited after this was explained' : ''}</span>` +
        `<button type="button" class="files-link-btn wk-show" data-wk="show">Show in reader</button></div>` +
      `<h3 class="wk-title">${esc(b.title)}</h3>` +
      (b.explain ? `<div class="wk-explain md">${renderMarkdown(b.explain).html}</div>` : `<p class="wk-explain is-empty">The AI didn't explain these lines. Ask with Explain more.</p>`) +
      this.typeBox(b) +
      `<div class="walk-notes"></div>` +
      `<div class="walk-next" aria-live="polite"></div>` +
      // Pinned to the bottom of the sheet, so answers never push them away
      `<div class="wk-dock">` + this.askBox('data-wk', `Ask about lines ${b.start}–${b.end}…`,
        // The block is already explained line by line, so learning it comes first
        this.dockActs(w.doc ? [{ act: 'quiz', short: 'Quiz', full: 'Quiz me' }] : [
          { act: 'more', short: 'Explain', full: 'Explain more' },
          { act: 'type', short: `Type${best ? ` · ${best}%` : ''}`, full: `Practise typing${best ? ` · best ${best}%` : ''}`, expands: true },
          { act: 'quiz', short: 'Quiz', full: 'Quiz me' },
          { act: 'lines', short: 'Lines', full: 'Line by line' },
          { act: 'bugs', short: 'Bugs', full: 'Find bugs' },
          { act: 'better', short: 'Improve', full: 'Better ways' },
          { act: 'tests', short: 'Tests', full: 'How to test it' }
        ])) +
      `</div>`;

    // Earlier answers for this block, folded except the latest
    const notesEl = this.walkBody.querySelector('.walk-notes');
    const notes = w.notes?.[i] || [];
    notes.forEach((note, k) => this.renderWalkNote(notesEl, note, k < notes.length - 1));
    this._walkCode = null;   // the practice editor is made when practice opens
    this.fitActs();
  }

  // Typing a block (or a change's new lines) yourself, hidden until asked for
  typeBox(b) {
    return `<div class="walk-type" hidden>` +
        `<div class="code-box" aria-label="Type lines ${b.start} to ${b.end}"></div>` +
        `<div class="wk-type-actions">` +
          `<button type="button" class="wk-compare" data-wk="compare">Compare</button>` +
          `<button type="button" class="run-ask" data-wk="feedback">Ask for feedback</button>` +
          `<span class="wk-hint">Ctrl+Enter compares · comments don't count</span>` +
        `</div>` +
        `<div class="walk-result" aria-live="polite"></div>` +
      `</div>`;
  }

  // A change, file by file and in each file change by change. The file owns
  // its header (path, counts, a sentence on what changed in it), Find bugs,
  // Better ways and questions; a change owns its explanation. The dots step
  // the file's changes; › goes on to the next file after its last one.
  renderChangeWalk(back) {
    const w = this.walk;
    const esc = (t) => this.escapeHtml(t || '');
    const { blocks, current: i, typed = {}, change } = w;
    const b = blocks[i];
    const files = fileGroups(blocks);
    const fi = files.findIndex(g => i >= g.first && i <= g.last);
    const f = files[fi];
    const count = f.last - f.first + 1;
    const explained = (k) => !!w.notes?.[k]?.length;
    const prose = isProse(b);
    const best = typed[i]?.best;
    const lines = (x) => !x.start ? x.status : x.end > x.start ? `lines ${x.start}-${x.end}` : `line ${x.start}`;
    const name = (p) => p.split('/').pop();
    // Where you came from sets the way the new change slides in
    const enter = this._walkEnter ? ` data-enter="${this._walkEnter}"` : '';
    const fileEnter = this._walkEnter && this._walkFileChanged ? ` data-enter="${this._walkEnter}"` : '';
    this._walkEnter = null;
    const skippedNote = fi === 0 && w.skipped?.length
      ? ` <span class="wk-skipped" title="${esc(w.skipped.join('\n'))}">Left out: ${w.skipped.length} lockfile, generated, binary or over-the-limit file${w.skipped.length === 1 ? '' : 's'}.</span>` : '';
    const about = w.fileAbout?.[f.path];
    const pending = this._linesPending?.key === w.key && this._linesPending.nums.includes(i + 1) && !explained(i);
    const title = partTitle(b);

    this.walkBody.innerHTML =
      this.stepBar({
        act: 'wk', back, context: change.label, where: `File ${fi + 1} of ${files.length}`,
        first: i === 0, pct: Math.round(((i + 1) / blocks.length) * 100),
        next: i < blocks.length - 1 ? `<button type="button" class="wk-step" data-wk="next" aria-label="Next change">›</button>`
          : `<button type="button" class="wk-step wk-step-text" data-wk="summary">Summary ›</button>`,
        items: files.map((g, k) => {
          const all = Array.from({ length: g.last - g.first + 1 }, (_, j) => g.first + j).every(explained);
          const n = g.last - g.first + 1;
          return { i: g.first, current: k === fi, mark: all ? '✓' : k + 1, title: esc(name(g.path)),
            meta: n > 1 ? `${n} changes` : g.status === 'modified' ? '' : g.status };
        }),
        extra: (change.local ? '' : `<button type="button" class="files-link-btn wk-redo" data-wk="explain-change">Explain the whole change in the chat</button>`) +
          `<button type="button" class="files-link-btn wk-redo" data-wk="redo">Ask for a new walkthrough of this change</button>`
      }) +
      (fi === 0 && (w.summary || skippedNote) ? `<div class="wk-summary md">${renderMarkdown(w.summary).html}${skippedNote}</div>` : '') +
      `<div class="wk-filehead"${fileEnter}>` +
        `<div class="wk-meta"><span><code>${esc(f.path)}</code>` +
          `<span class="wk-counts">${f.added ? ` <ins>+${f.added}</ins>` : ''}${f.removed ? ` <del>−${f.removed}</del>` : ''}</span>` +
          `${f.status === 'modified' ? '' : ` · ${f.status}`}</span>` +
          (b.start ? `<button type="button" class="files-link-btn wk-show" data-wk="show">Show in reader</button>` : '') + `</div>` +
        (about ? `<div class="wk-about md">${renderMarkdown(about).html}</div>` : '') +
      `</div>` +
      (count > 1
        ? `<div class="wk-changes"><span class="wk-dots" role="group" aria-label="Changes in ${esc(name(f.path))}">` +
            Array.from({ length: count }, (_, j) => {
              const k = f.first + j;
              return `<button type="button" class="wk-dot${k === i ? ' is-current' : ''}${explained(k) ? ' is-read' : ''}" data-wk="goto" data-i="${k}"` +
                ` aria-label="Change ${j + 1}: ${esc(partTitle(blocks[k]))}"${k === i ? ' aria-current="step"' : ''}></button>`;
            }).join('') + `</span>` +
            `<span class="wk-change-pos">Change ${i - f.first + 1} of ${count} · ${lines(b)}</span></div>`
        : '') +
      `<div class="wk-change"${enter}>` +
        (title !== name(b.path) ? `<h3 class="wk-title">${esc(title)}</h3>` : '') +
        // The reader shows what was taken out, in place; a deleted file shows it here
        (b.removed && !b.start ? `<details class="raw-reply wk-removed" open><summary>The deleted lines (${b.removed} line${b.removed === 1 ? '' : 's'})</summary>` +
          `<pre>${esc(b.removedText)}</pre></details>` : '') +
        this.typeBox(b) +
        `<div class="walk-notes"></div>` +
        (pending ? `<div class="work-status wk-pending" role="status"><span class="files-spinner" aria-hidden="true"></span><span>Explaining with the rest of ${esc(name(f.path))}…</span></div>` : '') +
      `</div>` +
      `<div class="walk-notes wk-file-notes"></div>` +
      // Pinned to the bottom of the sheet, so answers never push them away
      `<div class="wk-dock">` + this.askBox('data-wk', `Ask about ${esc(name(f.path))}…`,
        // Each change is explained line by line as it opens, so judging it comes first
        this.dockActs([
          { act: 'bugs', short: 'Bugs', full: 'Find bugs' },
          { act: 'better', short: 'Improve', full: 'Better ways' },
          { act: 'more', short: 'Explain', full: 'Explain more' },
          prose ? { act: 'lines', short: 'In brief', full: 'In brief' } : { act: 'lines', short: 'Lines', full: 'Line by line' },
          { act: 'tests', short: 'Tests', full: 'How to test it' },
          { act: 'quiz', short: 'Quiz', full: 'Quiz me' },
          b.added && { act: 'type', short: `Write${best ? ` · ${best}%` : ''}`, full: `Write it yourself${best ? ` · best ${best}%` : ''}`, expands: true }
        ])) +
      `</div>`;

    // This change's answers, then the file's (Find bugs, questions), folded except the latest
    const [notesEl, fileEl] = this.walkBody.querySelectorAll('.walk-notes');
    const notes = w.notes?.[i] || [];
    notes.forEach((note, k) => this.renderWalkNote(notesEl, note, k < notes.length - 1));
    const fileNotes = w.fileNotes?.[f.path] || [];
    fileNotes.forEach((note, k) => this.renderWalkNote(fileEl, note, k < fileNotes.length - 1 || notes.length > 0));
    this._walkCode = null;
    this.fitActs();
    this.autoLines();
  }

  // A part of a change is explained line by line as soon as it opens, unless
  // it has been already or the chat is busy (then Line by line asks for it)
  autoLines() {
    const w = this.walk;
    if (!w?.change || !w.blocks || w.notes?.[w.current]?.length || this._panelAsk) return;
    if (this.walkPanel.classList.contains('hidden') || this.walkView !== 'file') return;
    this.walkBody.querySelector('[data-wk="lines"]:not(:disabled)')?.click();
  }

  // A dock's actions, most used first. They start in the bar, where fitActs
  // leaves as many as its width holds and moves the rest under ⋯.
  dockActs(acts) {
    const esc = (t) => this.escapeHtml(t);
    return acts.filter(Boolean).map(a =>
      `<button type="button" class="run-ask is-key" data-wk="${a.act}" data-short="${esc(a.short)}" data-full="${esc(a.full)}" title="${esc(a.full)}"` +
        `${a.expands ? ' aria-expanded="false"' : ''}>${esc(a.short)}</button>`).join('') +
      `<button type="button" class="wk-more-toggle" data-wk="moreacts" aria-haspopup="menu" aria-expanded="false" title="More actions" aria-label="More actions" hidden>${icon('more', 18)}</button>` +
      `<span class="wk-extra" role="menu" hidden></span>`;
  }

  // Fills the bar from the top of the list and puts what doesn't fit under ⋯,
  // so widening the panel brings actions out and narrowing it tucks them away
  fitActs() {
    const acts = this.walkBody.querySelector('.wk-acts');
    const more = acts?.querySelector('.wk-more-toggle');
    if (!more) return;
    const menu = more.nextElementSibling;
    // Bar first, then the menu: document order is the list's order
    const all = [...acts.querySelectorAll('[data-short]')];
    const place = (el, inBar) => {
      el.classList.toggle('is-key', inBar);
      el.textContent = inBar ? el.dataset.short : el.dataset.full;
      if (inBar) el.removeAttribute('role'); else el.setAttribute('role', 'menuitem');
    };
    for (const el of all) { more.before(el); place(el, true); }
    const over = () => acts.scrollWidth > acts.clientWidth;
    more.hidden = !over();
    for (let k = all.length - 1; k >= 0 && over(); k--) { menu.prepend(all[k]); place(all[k], false); }
    if (more.hidden) this.toggleMoreActs(false);
  }

  // The dock's ⋯ menu: the actions that didn't fit the bar, opened above it
  toggleMoreActs(open) {
    const menu = this.walkBody.querySelector('.wk-extra');
    if (!menu || menu.hidden === !open) return false;
    menu.hidden = !open;
    menu.previousElementSibling.setAttribute('aria-expanded', String(open));
    return true;
  }

  async onWalkClick(e) {
    if (!e.target.closest('.wk-bar')) this.closeStepList(this.walkBody);
    // Any click but the ⋯ itself closes its menu; a choice in it still runs
    if (!e.target.closest('[data-wk="moreacts"]')) this.toggleMoreActs(false);
    const ref = e.target.closest('.line-ref');
    if (ref) return this.showLineRef(Number(ref.dataset.start), Number(ref.dataset.end));
    const el = e.target.closest('[data-wk]');
    if (!el || el.disabled) return;
    const act = el.dataset.wk;
    const w = this.walk;
    if (act === 'close') return this.walkPanel.classList.add('hidden');
    // Choosing a folder, the reading map, and moving between files
    if (act === 'folder') return this.openFolderJourney(el.dataset.i);
    if (act === 'review') return this.reviewLocal(el.dataset.base);
    if (act === 'review-back') return this.showChanges();
    if (act === 'commit') return this.openCommit(el.dataset.sha);
    if (act === 'commits-summary') return this.summarizeCommits();
    if (act === 'review-restart') return this.restartReview(el.dataset.base);
    if (act === 'folder-new') return this.openFolderJourney(null);
    if (act === 'folders') return this.showFolderChoice();
    if (act === 'map') return this.showJourneyMap();
    if (act === 'walkfile') return this.startWalk(el.dataset.path);
    if (act === 'open') return this.openRepoFile(this.fileRefFor(el.dataset.path));
    if (act === 'journey-create') return this.createJourney();
    if (act === 'journey-reset') return this.resetJourney();
    if (act === 'journey-delete') return this.deleteJourney();
    if (act === 'jr-edit') { this._journeyEditing = !this._journeyEditing; return this.renderJourney(); }
    if (act === 'jr-move') return this.editOrder(path => moveInPath(path, Number(el.dataset.k), Number(el.dataset.to)));
    if (act === 'jr-remove') return this.editOrder(path => path.filter((_, k) => k !== Number(el.dataset.k)));
    if (act === 'folder-forget') return this.forgetFolderReading(el.dataset.i);
    if (act === 'retry') return w.change ? this.createChangeWalk(w.change) : this.createWalk(w.path, w.lines, w.startAt);
    if (act === 'reveal') {
      const a = el.nextElementSibling;
      a.hidden = !a.hidden;
      el.setAttribute('aria-expanded', String(!a.hidden));
      el.textContent = a.hidden ? 'Show answer' : 'Hide answer';
      return;
    }
    if (!w?.blocks) return;
    const i = w.current;
    const b = w.blocks[i];
    const go = (k) => this.gotoWalk(k);
    if (act === 'list') return this.toggleStepList(this.walkBody, el);
    if (act === 'moreacts') return this.toggleMoreActs(el.nextElementSibling.hidden);
    if (act === 'goto') return go(Number(el.dataset.i));
    if (act === 'prev') return go(w.summaryOpen ? i : Math.max(0, i - 1));
    if (act === 'summary') {
      await this.saveWalk({ ...w, summaryOpen: true });
      await this.renderWalk();
      this.walkBody.scrollTop = 0;
      return;
    }
    if (act === 'wrapup') return this.writeReviewSummary(el);
    if (act === 'next') return go(Math.min(w.blocks.length - 1, i + 1));
    if (act === 'show') return this.followWalk();
    if (act === 'redo') return this.resetWalk();
    if (act === 'rewalk') {
      this._walkStale = null;
      return this.createWalk(w.path, w.range.start > 1 || w.range.end < w.total ? w.range : null);
    }
    if (act === 'explain-change') return this.explainDiff(w.change);
    if (act === 'continue') return this.createWalk(w.path, null, w.range.end + 1);
    if (act === 'finish') return this.finishWalkFile(el);
    if (act === 'type') {
      const box = this.walkBody.querySelector('.walk-type');
      box.hidden = !box.hidden;
      el.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) {
        this._walkCode = this._walkCode || this.makeCodeBox(box.querySelector('.code-box'), {
          value: w.typed?.[i]?.text || '', lang: langFromPath(b.path || w.path), firstLine: b.start,
          placeholder: w.change ? 'Write the new version of these lines…' : `Type lines ${b.start}-${b.end} here…`,
          onSubmit: () => this.walkBody.querySelector('[data-wk="compare"]')?.click()
        });
        this._walkCode.focus();
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }

    const c = w.change;
    // A change's questions carry its diff; its code is fetched only to compare
    // with what you typed, so a file that can't be fetched stops nothing else
    const code = !c || ['compare', 'feedback'].includes(act) ? await this.walkBlockCode() : '';
    // A change has a chat of its own; a file's walk shares its project's
    const topic = c ? w.key : this.readTopic();
    const chat = this.claimChat(topic);
    const repo = c ? (c.owner ? `${c.owner}/${c.repo}` : c.repo) : this.repoDisplayName();
    // In a change, Find bugs, Better ways, tests and questions are about the
    // whole file (bugs sit between its changes); the rest about one change
    const f = c ? fileGroups(w.blocks).find(g => i >= g.first && i <= g.last) : null;
    const fileLevel = !!c && ['bugs', 'better', 'tests', 'ask'].includes(act);
    const inChange = c ? `${c.label.toLowerCase()} in ${repo}${c.title ? ` ("${c.title}")` : ''}` : '';
    // What the question is about: a file's numbered lines, or a change's file or part and its diff
    const where = !c ? `lines ${b.start}-${b.end} of \`${w.path}\`${repo ? ` from ${repo}` : ''}`
      : fileLevel ? `the changes to \`${b.path}\` in ${inChange}`
        : `change ${i - f.first + 1} of ${f.last - f.first + 1} to \`${b.path}\` in ${inChange}`;
    const block = !c ? `${LINE_NUMBER_NOTE}\n\n${fencedFile({ path: w.path, content: code, lines: b })}`
      : fileLevel ? fileContext(w.blocks.slice(f.first, f.last + 1)) : partContext(b);
    const project = this.walkProject();
    const listed = chat.sent.has('file-list');
    const files = project ? this.projectFiles(project, [b.path || w.path], { list: !listed }) : '';
    const brief = [project ? await this.projectBriefFor(project) : '', files].filter(Boolean).join('\n\n');
    const whole = [w.summary ? `(The ${c ? 'change' : 'file'} as a whole: ${w.summary})` : '', brief].filter(Boolean).join('\n\n');
    // Cited lines open the loaded tree's version, which a change's lines don't match
    const cite = c ? '' : `\n\n${CITE_RULE}`;
    const typedText = this._walkCode?.getValue() || '';

    if (act === 'compare') {
      if (!typedText.trim()) { this.showNotification('Type the lines first'); return; }
      const { accuracy, ops } = compareTyped(code, typedText, langFromPath(b.path || w.path));
      const bestSoFar = Math.max(accuracy, w.typed?.[i]?.best || 0);
      await this.saveWalk({ ...w, typed: { ...(w.typed || {}), [i]: { best: bestSoFar, text: typedText } } });
      this.walkBody.querySelector('.walk-result').innerHTML =
        `<div class="walk-score">${accuracy}% match${accuracy >= 90 ? ' ✓' : ''}` +
        `${accuracy < 100 ? ' <span>Highlighted lines are in the original but weren\'t matched in yours; faded ones are only in yours.</span>' : ''}</div>` +
        (accuracy < 100 ? `<pre class="walk-diff">${ops.map(o =>
          `<span class="is-${o.type}">${this.escapeHtml(o.text)}</span>`).join('')}</pre>` : '');
      const typeBtn = this.walkBody.querySelector('[data-wk="type"]');
      const pct = bestSoFar ? ` · ${bestSoFar}%` : '', best = bestSoFar ? ` · best ${bestSoFar}%` : '';
      Object.assign(typeBtn.dataset, w.change
        ? { short: `Write${pct}`, full: `Write it yourself${best}` }
        : { short: `Type${pct}`, full: `Practise typing${best}` });
      this.fitActs();
      if (bestSoFar >= 90 && !w.change) {
        const n = this.walkBody.querySelector(`.wk-blocks [data-i="${i}"] .wk-n`);
        if (n) n.textContent = '✓';
      }
      return;
    }
    if (!['more', 'lines', 'bugs', 'better', 'tests', 'quiz', 'feedback', 'ask'].includes(act)) return;

    const notesEl = this.walkBody.querySelector(fileLevel ? '.wk-file-notes' : '.walk-notes');
    let prompt;
    let label;
    let attachments = [];
    let lineNums = null;
    let about = [];
    if (act === 'lines' && !c) {
      label = 'Line by line';
      prompt = `I'm walking through ${where}, block by block. ${intentText(this._promptEdits, 'lines')} ${whole}\n\n${block}${cite}`;
    } else if (act === 'lines') {
      label = 'Line by line';
      // The next small parts not explained yet come along in the same message.
      // The first message in a chat also carries the whole diff, and until
      // the walk has one, asks what the change does as a whole.
      lineNums = linesBatch(w.blocks, i, k => !!w.notes?.[k]?.length).map(k => k + 1);
      const first = !!w.fname && !chat.sent.has('diff');
      // A file of several changes gets a sentence on what changed in it, once
      const groups = fileGroups(w.blocks);
      about = [...new Set(lineNums.map(n => w.blocks[n - 1].path))]
        .filter(p => !w.fileAbout?.[p] && groups.some(g => g.path === p && g.last > g.first));
      prompt = linesPrompt({ blocks: w.blocks, nums: lineNums, what: w.what || c.label.toLowerCase(), repo, title: c.title,
        fname: first ? w.fname : '', intro: !w.summary, skipped: w.skipped || [], edits: this._promptEdits, brief, about });
      if (first) attachments = [{ filename: w.fname, content: changePack(w.blocks, w.what) }];
    } else if (['bugs', 'better', 'tests'].includes(act)) {
      label = { bugs: 'Find bugs', better: 'Better ways', tests: 'How to test it' }[act];
      // In a change, the question is about what it adds or changes
      prompt = `I'm reading ${where}${c ? '; look at the code they add or change' : ''}. ${intentText(this._promptEdits, act)} ${whole}\n\n${block}${cite}`;
    } else if (act === 'more') {
      // A file's block gets the study explanation: step by step, terms defined, a question to check
      label = 'Explain more';
      prompt = c
        ? `I'm reading ${where}, change by change. Explain this change in more depth: the idea behind it, how it fits ` +
          `with the rest of the change, and anything a reader could easily miss. ${whole}\n\n${block}${cite}`
        : `I'm walking through ${where}, block by block, and its short explanation wasn't enough. ` +
          `${intentText(this._promptEdits, 'explain')} ${whole}\n\n${block}${cite}`;
    } else if (act === 'ask') {
      const q = this.takeQuestion(this.walkBody);
      if (!q) return;
      label = q.length > 80 ? q.slice(0, 79) + '…' : q;
      const earlier = earlierAnswers(c ? w.fileNotes?.[b.path] : w.notes?.[i]);
      prompt = `I'm ${c ? 'reading' : 'walking through'} ${where}${c ? '' : ', block by block'}. ` +
        `My question about ${c ? 'them' : 'this block'}: ${q}${whole ? `\n\n${whole}` : ''}\n\n${block}` +
        `${earlier ? `\n\n${earlier}` : ''}${cite}`;
    } else if (act === 'quiz') {
      label = 'Quiz';
      prompt = quizPrompt(where, block);
    } else {
      if (!typedText.trim()) { this.showNotification('Type the lines first'); return; }
      label = 'Feedback on your version';
      const lang = langFromPath(b.path || w.path);
      prompt = `I typed ${where} myself to practise.\n\nThe original:\n\n\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n` +
        `Mine:\n\n\`\`\`${lang}\n${typedText.replace(/\n$/, '')}\n\`\`\`\n\n` +
        `Would mine behave the same? List the differences that change behaviour first, then the ones that are only style. ` +
        `Keep it short and encouraging.`;
    }
    // Earlier answers fold away so the new one reads in place
    notesEl.querySelectorAll('.answer-card').forEach(c => c.classList.add('collapsed'));
    el.disabled = true;
    try {
      if (act === 'quiz') {
        const wait = document.createElement('div');
        wait.className = 'walk-quiz is-writing';
        wait.innerHTML = '<div class="answer-head"><span class="answer-title">Quiz</span><span class="answer-status">Writing 3 questions…</span></div>';
        notesEl.appendChild(wait);
        wait.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        let reply = null;
        try { reply = await this.askInPanel(prompt, { via: 'chat', topic }); } catch (err) { wait.querySelector('.answer-status').textContent = '⚠️ ' + err.message; return; }
        wait.remove();
        const quiz = parseQuiz(reply);
        const note = quiz ? { label, quiz } : { label, text: reply };
        this.renderWalkNote(notesEl, note, false);
        await this.addWalkNote(w.key || w.path, i, note);
      } else if (lineNums) {
        this._linesPending = { key: w.key, nums: lineNums };
        const up = await this.walkContextFiles(notesEl, w, b, project, chat);
        // The reply covers several parts; this part's card shows only its own
        // section as it arrives (nothing before its heading), and saveLines
        // gives the others theirs. A finished reply without headings shows whole.
        const show = (t, final) => {
          if (!/^#{1,4}\s*\**\s*Part\s+\d/im.test(t)) return final ? t : '';
          // A heading still arriving at the end isn't this part's
          return splitParts(final ? t : t.replace(/\n#[^\n]*$/, ''), lineNums).parts.get(lineNums[0]) || '';
        };
        let text = await this.showAnswerIn(notesEl, label, up ? `${prompt}\n\n${up.note}` : prompt,
          { via: 'chat', inline: true, topic, attachments: up ? [...attachments, up.attachment] : attachments, show });
        if (text) {
          if (files) chat.sent.add('file-list');
          if (attachments.length) chat.sent.add('diff');
        }
        text = await this.answerWithFiles(notesEl, label, text, project, chat, show);
        this.markLineRefs(notesEl);
        this._linesPending = null;
        if (text) await this.saveLines(w.key, lineNums, label, text);
      } else {
        const up = await this.walkContextFiles(notesEl, w, b, project, chat);
        let text = await this.showAnswerIn(notesEl, label, up ? `${prompt}\n\n${up.note}` : prompt,
          { via: 'chat', inline: true, topic, attachments: up ? [up.attachment] : [] });
        if (text && files) chat.sent.add('file-list');
        text = await this.answerWithFiles(notesEl, label, text, project, chat);
        this.markLineRefs(notesEl);
        if (text) await (fileLevel ? this.addFileNote(w.key, b.path, { label, text }) : this.addWalkNote(w.key || w.path, i, { label, text }));
      }
    } finally {
      if (lineNums) this._linesPending = null;
      el.disabled = false;
      // Moved on while this was answered: the part now open gets its turn
      if (c && this.walk?.key === w.key && this.walk.current !== i) this.autoLines();
    }
  }

  // What Find bugs turned up, part by part, and one summary: what the change
  // does, its risks, a checklist, and the words to go with it (a commit
  // message, a pull request description, or a review comment).
  renderReviewSummary() {
    const w = this.walk;
    const c = w.change;
    const esc = (t) => this.escapeHtml(t || '');
    const files = fileGroups(w.blocks);
    const n = files.length;
    const found = files.filter(g => this.bugNotes(g).length);
    const unchecked = n - found.length;
    const back = this.changesBack(c) ? `<button type="button" class="wk-map" data-wk="review-back" aria-label="Back to Changes">‹</button>` : '';
    this.walkBody.innerHTML =
      this.stepBar({
        act: 'wk', back, context: c.label, where: 'Summary', first: false, pct: 100, next: '',
        items: files.map((g, k) => ({ i: g.first, current: false, mark: k + 1, title: esc(g.path.split('/').pop()), meta: '' }))
      }) +
      `<h3 class="wk-title">Review summary</h3>` +
      (w.summary ? `<div class="wk-summary md">${renderMarkdown(w.summary).html}</div>` : '') +
      `<div class="sheet-label">Found with Find bugs</div>` +
      (found.length
        ? `<ul class="wk-found">${found.map(g =>
            `<li><button type="button" class="files-link-btn" data-wk="goto" data-i="${g.first}">${esc(g.path)}</button></li>`).join('')}</ul>`
        : '') +
      `<p class="wk-explain is-empty">${found.length ? '' : 'No file has been checked with Find bugs yet. '}` +
        `${unchecked ? `${unchecked} of ${n} file${n === 1 ? '' : 's'} not checked; the summary still reviews the whole diff.` : 'Every file was checked.'}</p>` +
      `<div class="walk-notes"></div>` +
      `<div class="wk-dock"><div class="wk-acts"><button type="button" class="run-ask" data-wk="wrapup">${w.review ? 'Write it again' : 'Write the summary'}</button></div></div>`;
    const notesEl = this.walkBody.querySelector('.walk-notes');
    if (w.review) this.renderWalkNote(notesEl, { label: 'Review summary', text: w.review }, false);
    else if (!this._panelAsk) this.walkBody.querySelector('[data-wk="wrapup"]').click();
  }

  // What Find bugs said about a file of the change: on the file, or (a walk
  // saved before files had notes) on its parts
  bugNotes(g) {
    const w = this.walk;
    const onParts = Array.from({ length: g.last - g.first + 1 }, (_, j) => w.notes?.[g.first + j] || []).flat();
    return [...(w.fileNotes?.[g.path] || []), ...onParts].filter(x => x.label === 'Find bugs');
  }

  async writeReviewSummary(el) {
    const w = this.walk;
    const c = w.change;
    const repo = c.owner ? `${c.owner}/${c.repo}` : c.repo;
    const found = fileGroups(w.blocks).flatMap(g => this.bugNotes(g).map(x => `### \`${g.path}\`\n${x.text.slice(0, 1500)}`));
    const [before, words] = c.local && c.kind !== 'commit'
      ? c.base === 'uncommitted'
        ? ['commit', 'Commit message: In a code block, a title line under 60 characters saying what the change does, in the imperative, then a blank line and a short body on what changed and why']
        : ['push', 'Pull request description: In a code block, a title, then what changed, why, and how it was tested']
      : ['merge', 'Review comment: A short, kind review you could post, saying what is good and what to change'];
    const brief = await this.projectBriefFor({ owner: c.owner, repo: c.repo, local: !!c.local });
    const prompt = (brief ? `${brief}\n\n` : '') +
      `The attached "${w.fname || 'changes.md'}" is the whole diff of ${w.what || c.label.toLowerCase()} in ${repo}${c.title ? ` ("${c.title}")` : ''}, ` +
      `which I have read part by part. Write the review summary, under these headings:\n\n` +
      `## What it does\nTwo or three sentences.\n\n` +
      `## Risks\nWhat could break and where, naming the parts.\n\n` +
      `## Before you ${before}\nA checklist ("- [ ] ...") of what to fix or check, most important first. Leave it out if there is nothing.\n\n` +
      `## ${words.split(':')[0]}\n${words.split(': ')[1]}.` +
      (found.length ? `\n\nWhile reading, Find bugs reported the problems below. Keep the ones that still hold after seeing the whole diff:\n\n${found.join('\n\n')}` : '');
    const notesEl = this.walkBody.querySelector('.walk-notes');
    notesEl.replaceChildren();
    el.disabled = true;
    try {
      const text = await this.showAnswerIn(notesEl, 'Review summary', prompt, {
        via: 'chat', inline: true, topic: w.key, attachments: [{ filename: w.fname || 'changes.md', content: changePack(w.blocks, w.what || c.label) }]
      });
      if (text && this.walk?.key === w.key) {
        await this.saveWalk({ ...this.walk, review: text });
        el.textContent = 'Write it again';
      }
    } finally {
      el.disabled = false;
    }
  }

  // A line-by-line reply for several parts: each part keeps its own section,
  // and the opening words about the whole change become the walk's summary
  async saveLines(key, nums, label, text) {
    const { intro, parts, files } = splitParts(text, nums);
    for (const [n, body] of parts) await this.addWalkNote(key, n - 1, { label, text: body });
    const w = this.walk;
    if (w?.key !== key) return;
    // A file's sentence is kept for a file in the walk (the model may name it loosely)
    const paths = new Set(w.blocks.map(b => b.path));
    const fileAbout = { ...(w.fileAbout || {}) };
    for (const [p, sentence] of files) {
      const path = paths.has(p) ? p : [...paths].find(x => x.endsWith(`/${p}`) || x.split('/').pop() === p);
      if (path && !fileAbout[path]) fileAbout[path] = sentence;
    }
    await this.saveWalk({ ...w, fileAbout, summary: w.summary || intro });
    // The part on screen showed the whole reply while it streamed
    if (nums.length > 1 || intro || files.size) {
      const top = this.walkBody.scrollTop;
      await this.renderWalk();
      this.walkBody.scrollTop = top;
    }
  }

  // Bold line numbers in an explanation (**12**, **lines 12-14**) become
  // links that show those lines in the reader
  markLineRefs(container) {
    for (const el of container.querySelectorAll('.md strong:not(.line-ref)')) {
      const m = /^(?:lines?\s+)?(\d+)(?:\s*[-–]\s*(\d+))?:?$/i.exec(el.textContent.trim());
      if (!m) continue;
      const start = Number(m[1]);
      const end = Math.max(start, Number(m[2] || m[1]));
      el.classList.add('line-ref');
      Object.assign(el.dataset, { start, end });
      el.title = 'Show in the reader';
    }
  }

  // One answer kept on a block: a quiz (answers hidden until asked for) or text
  renderWalkNote(container, note, folded) {
    if (note.quiz) {
      const el = document.createElement('div');
      el.className = 'walk-quiz';
      el.innerHTML = `<div class="answer-head"><span class="answer-title">${this.escapeHtml(note.label)}</span></div><ol>` +
        note.quiz.map(({ q, a }) =>
          `<li><div class="md">${renderMarkdown(q).html}</div>` +
          `<button type="button" class="files-link-btn walk-reveal" data-wk="reveal" aria-expanded="false">Show answer</button>` +
          `<div class="md walk-quiz-a" hidden>${renderMarkdown(a).html}</div></li>`).join('') + `</ol>`;
      container.appendChild(el);
      return;
    }
    const card = this.answerCard(container, { title: note.label, collapsible: true, openInChat: false, inline: true });
    card.done(note.text);
    this.markLineRefs(card.el);
    if (folded) card.el.classList.add('collapsed');
  }

  // A note on a whole file of a change (Find bugs, a question), kept by its path
  async addFileNote(key, path, note) {
    const w = this.walk;
    if (w?.key !== key || !w.blocks) return;
    const fileNotes = { ...(w.fileNotes || {}), [path]: [...(w.fileNotes?.[path] || []), note].slice(-4) };
    await this.saveWalk({ ...w, fileNotes });
  }

  // id: the walk's key (a change) or path (a file)
  async addWalkNote(id, i, note) {
    const w = this.walk;
    if ((w?.key || w?.path) !== id || !w.blocks) return;   // moved to another file or change meanwhile
    const notes = { ...(w.notes || {}) };
    notes[i] = [...(notes[i] || []), note].slice(-4);
    await this.saveWalk({ ...w, notes });
  }

  // Mark the file read, then show where to go next, in place under the step
  async finishWalkFile(btn) {
    const path = this.walk.path;
    if (this.journey) await this.saveJourney({ ...this.journey, done: [...new Set([...(this.journey.done || []), path])] });
    btn.hidden = true;   // done: Up next takes its place
    const box = this.walkBody.querySelector('.walk-next');
    const esc = (t) => this.escapeHtml(t || '');
    box.innerHTML = `<div class="sheet-label">Up next</div><p class="sheet-goal">Looking at what ${esc(path.split('/').pop())} uses…</p>`;

    const fileSet = this.repoTree.fileSet;
    const j = this.journey;
    let imports = [];
    const importedBy = [];
    try {
      imports = resolveImports(extractImports(await this.readRepoFile(path), path), path, fileSet);
      const others = (j?.path || []).map(p => p.file).filter(f => f !== path);
      for (const f of (await this.fetchRepoFilesMany(others)).filter(f => !f.error)) {
        if (resolveImports(extractImports(f.content, f.path), f.path, fileSet).includes(path)) importedBy.push(f.path);
      }
    } catch (e) { /* suggestions from the reading order alone */ }
    const done = new Set([...(j?.done || []), path]);
    let candidates = nextCandidates({ path: j?.path || [], current: path, done, imports, importedBy });

    const draw = (pickedBy = '') => {
      if (!box.isConnected) return;
      const [first, ...rest] = candidates;
      box.innerHTML = `<div class="sheet-label">Up next</div>` + (first
        ? `<button type="button" class="jr-next" data-wk="walkfile" data-path="${esc(first.file)}">` +
            `<code>${esc(first.file)}</code><span>${esc(first.reason)}</span></button>` +
          (pickedBy ? `<p class="jr-picked">Picked by ${esc(pickedBy)}</p>` : '') +
          (rest.length ? `<div class="jr-also">Also related: ${rest.map(c =>
            `<button type="button" class="jr-file" data-wk="walkfile" data-path="${esc(c.file)}" title="${esc(c.reason)}">${esc(c.file.split('/').pop())}</button>`).join('')}</div>` : '')
        : `<p class="sheet-goal">${j ? 'You have read every file in the reading order.' : 'Nothing else found that this file uses.'}</p>`);
    };
    draw();
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // A free model chooses between several candidates; without one, the order stands
    if (candidates.length < 2) return;
    try {
      const route = buildRoute(await loadApiConfig()).filter(st => !st.paid);
      if (!route.length) return;
      const { text, step } = await askRoute(route, [{ role: 'user', content: nextPrompt({ summary: j?.summary || '', current: path, done, candidates }) }]);
      const pick = parseNext(text, candidates);
      if (!pick) return;
      candidates = [{ file: pick.file, reason: pick.why }, ...candidates.filter(c => c.file !== pick.file)];
      draw(step.label);
    } catch (e) {
      console.warn('[Yavar] No next-file pick:', e.message);   // the reading order stands
    }
  }

  async walkActiveDiff() {
    const gh = await this.getActiveGitHub();
    if (!gh || (gh.kind !== 'pull' && gh.kind !== 'commit')) {
      this.showNotification('⚠️ Open a pull request or commit on GitHub first');
      return;
    }
    await this.walkChange({ ...gh, title: (gh.title || '').split(' · ')[0].trim() });
  }

  async explainDiff(gh) {
    const label = gh.kind === 'pull' ? `pull request #${gh.number}` : `commit ${gh.sha.slice(0, 7)}`;
    this.showNotification(`🔀 Fetching the ${label} diff…`);
    try {
      const diff = await this.fetchDiff(gh);
      if (!diff.trim()) throw new Error('the diff is empty');
      const MAX = 400000;
      const body = diff.length > MAX ? diff.slice(0, MAX) + '\n… [diff truncated]' : diff;
      const files = (diff.match(/^diff --git /gm) || []).length;
      const fname = gh.kind === 'pull' ? `${gh.repo}-pr-${gh.number}.diff` : `${gh.repo}-${gh.sha.slice(0, 7)}.diff`;
      const pageTitle = (gh.title || '').split(' · ')[0].trim();

      this._readingContext = { label: `${gh.owner}/${gh.repo}`, ts: Date.now() };
      const prompt =
        `The attached "${fname}" is the diff of ${label} in ${gh.owner}/${gh.repo}` +
        `${pageTitle ? ` ("${pageTitle}")` : ''}, touching ${files} file${files === 1 ? '' : 's'}.\n\n` +
        `Explain this change to someone learning from real-world code:\n` +
        `1. The goal of the change in 2-3 sentences.\n` +
        `2. File by file: what changed and why it was needed.\n` +
        `3. Techniques or patterns worth learning from it.\n` +
        `4. Anything risky, missing (tests, edge cases), or that you would do differently.`;
      this.askInThread({
        title: gh.kind === 'pull' ? `PR #${gh.number}` : `Commit ${gh.sha.slice(0, 7)}`,
        sub: `${gh.owner}/${gh.repo}${pageTitle ? ' · ' + pageTitle : ''}`,
        label: `Explain this ${gh.kind === 'pull' ? 'pull request' : 'commit'}`,
        prompt,
        attachments: [{ filename: fname, content: body, mime: 'text/plain' }]
      });
      this.showNotification(`🔀 Sent the ${label} diff (${files} file${files === 1 ? '' : 's'}, ~${formatCount(estimateTokens(body.length))} tokens)`);
    } catch (e) {
      this.showNotification('⚠️ Could not get the diff: ' + e.message);
    }
  }

  // github.com serves .diff files without using the API quota (and with your
  // login, for private repos); the API is the fallback.
  async fetchDiff(gh) {
    const path = gh.kind === 'pull' ? `pull/${gh.number}` : `commit/${gh.sha}`;
    try {
      const res = await fetch(`https://github.com/${gh.owner}/${gh.repo}/${path}.diff`, { credentials: 'include' });
      if (res.ok) return await res.text();
    } catch (e) { /* fall back to the API */ }
    const apiPath = gh.kind === 'pull' ? `pulls/${gh.number}` : `commits/${gh.sha}`;
    const res = await this.ghApi(`repos/${gh.owner}/${gh.repo}/${apiPath}`, { accept: 'application/vnd.github.diff' });
    return res.text();
  }
}
