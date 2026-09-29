// Reading a repository: the reading map, choosing a folder, and the files that
// connect.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { journeyPrompt, parseJourney, connectionTree, pickCoreFiles } from '../utils/journey.js';
import { idbGet } from '../utils/idb.js';
import { extractImports, resolveImports } from '../utils/github.js';

export class JourneyPart {
  // The big picture first: the free chat reads the README and core files and
  // returns what the project does, its parts and a reading order (the map).
  // Each file is then walked block by block, and finishing one suggests the
  // next: the reading order and the file's imports give the candidates, and a
  // free API model (never the paid one) picks between them when one is set up.
  // Kept per repo under journey:<repo>.
  journeyKey() {
    const k = this.readMarksKey();
    return k ? k.replace(/^readMarks:/, 'journey:') : null;
  }

  async loadJourney() {
    const key = this.journeyKey();
    if (!key) return null;
    try { return (await chrome.storage.local.get(key))[key] || null; } catch (e) { return null; }
  }

  async saveJourney(state) {
    this.journey = state;
    this._briefs = {};
    const key = this.journeyKey();
    if (key) try { await chrome.storage.local.set({ [key]: state }); } catch (e) { /* ignore */ }
    const gh = this._tabCtx?.gh;
    if (gh && key === `journey:${gh.owner}/${gh.repo}`) {
      this._tabCtx.journey = this.journeyStatus(state);
      this.renderHome();
    }
  }

  // "Continue · 2 of 7 files read" for a journey in progress, null when there is none
  journeyStatus(state) {
    const n = state?.path?.length;
    if (!n) return null;
    const read = state.path.filter(p => state.done?.includes(p.file)).length;
    return read >= n ? `All ${n} files read` : `Continue · ${read} of ${n} files read`;
  }

  // For the repo in the tab, the folder already open, or (folder: true) a folder you pick
  async openJourney({ folder = false } = {}) {
    try {
      if (folder) return this.showFolderChoice({ review: false });
      if (this._tabCtx?.gh) {
        await this.ensureRepoTree();
      }
    } catch (e) {
      this.showNotification('⚠️ ' + e.message);
      return;
    }
    if (!this.repoTree) {
      this.showNotification('Open a GitHub repository in your tab, or pick a project folder');
      return;
    }
    this.journey = await this.loadJourney();
    this.walkPanel.classList.remove('hidden');
    if (this.journey) this.showJourneyMap();
    else await this.createJourney();
  }

  // "Read a project folder" or "Review my changes": the folders you opened
  // before, or a new one
  async showFolderChoice({ review = this._folderReview } = {}) {
    this._folderReview = review;
    this.walkView = 'folders';
    document.getElementById('walk-title').textContent = review ? 'Review my changes' : 'Reading';
    document.getElementById('walk-sub').textContent = 'A project folder';
    this.walkPanel.classList.remove('hidden');
    let recent = window.showDirectoryPicker ? (await idbGet('recentFolders')) || [] : [];
    // Folders opened before the recent list existed are only in lastFolder
    if (!recent.length && window.showDirectoryPicker) {
      const last = await idbGet('lastFolder');
      if (last) recent = [{ name: last.name, handle: last, ts: 0 }];
    }
    this._recentFolders = recent;
    let states = {};
    try { states = await chrome.storage.local.get(recent.map(r => `journey:local/${r.name}`)); } catch (e) { /* no progress known */ }
    const esc = (t) => this.escapeHtml(t || '');
    this.walkBody.innerHTML =
      (recent.length
        ? `<div class="sheet-label">Recent</div><ul class="jr-folders">${recent.map((r, k) => {
            const status = this.journeyStatus(states[`journey:local/${r.name}`]);
            return `<li><button type="button" class="jr-folder" data-wk="folder" data-i="${k}">` +
              `<span class="jr-folder-name">${esc(r.name)}</span>${status ? `<span class="jr-folder-status">${esc(status)}</span>` : ''}` +
              `<span class="home-chev" aria-hidden="true">›</span></button></li>`;
          }).join('')}</ul>`
        : `<p class="wk-summary">${review
          ? 'Pick the project folder, the one holding its .git. Yavar compares it with your last commit, or with what you last pushed, and walks you through the changes line by line.'
          : 'Pick a folder on this computer. Yavar gives you the big picture first, then walks you through it file by file.'}</p>`) +
      `<div class="jr-actions"><button type="button" class="files-send jr-primary" data-wk="folder-new">Choose a folder…</button></div>`;
  }

  // i: index into the recent list, or null to pick a new folder
  async openFolderJourney(i) {
    const recent = i == null ? null : this._recentFolders?.[Number(i)];
    if (!(await this.openLocalFolder(recent ? { handle: recent.handle } : {}))) return;
    if (this._folderReview) return this.showReviewChoice();
    this.journey = await this.loadJourney();
    if (this.journey) this.showJourneyMap();
    else await this.createJourney();
  }

  showJourneyMap() {
    this.walkView = 'map';
    this._journeyError = null;
    document.getElementById('walk-title').textContent = 'Reading';
    document.getElementById('walk-sub').textContent = this.repoDisplayName();
    this.renderJourney();
    this.walkBody.scrollTop = 0;
  }

  async resetJourney() {
    if (!this.journey || this._journeyPending) return;
    if (!this.confirmTwice('journey', 'Click again to ask for a new overview and reading order')) return;
    await this.createJourney();
  }

  async createJourney() {
    if (this._journeyPending) return;
    this.walkView = 'map';
    document.getElementById('walk-title').textContent = 'Reading';
    document.getElementById('walk-sub').textContent = this.repoDisplayName();
    this._journeyPending = true;
    this._journeyError = null;
    this._journeyRaw = '';
    this.renderJourney();
    const done = this.journey?.done || [];
    try {
      const readme = this.repoTree.items.find(i => i.type === 'blob' && /^readme(\.\w+)?$/i.test(i.path))?.path;
      const paths = [...new Set([readme, ...pickCoreFiles(this.repoTree.items)].filter(Boolean))].slice(0, 12);
      const files = (await this.fetchRepoFilesMany(paths)).filter(f => !f.error);
      if (!files.length) throw new Error('could not read the project files');
      const fname = `${this.repoTree.repo}-overview.md`.replace(/[^\w.-]+/g, '-');
      // Show the reading order as the AI writes it
      const { value: parsed, text, tried } = await this.askForJson(journeyPrompt(this.repoDisplayName(), fname), {
        attachments: [{ filename: fname, content: this.packFor(files) }], live: this.walkBody, list: 'file', topic: this.readTopic(),
        parse: (t) => parseJourney(t, this.repoTree.fileSet, this.repoTree.repo)
      });
      if (!parsed) {
        this._journeyRaw = text;
        throw new Error(`couldn't find a reading order of files from this project in the replies (asked ${tried})`);
      }
      await this.saveJourney({ ...parsed, done, created: Date.now() });
      this._readingContext = { label: this.repoDisplayName(), ts: Date.now() };
    } catch (e) {
      this._journeyError = e.message;
    } finally {
      this._journeyPending = false;
      if (this.walkView === 'map') this.renderJourney();
    }
  }

  // The map: what the project is, the reading order (with where you are),
  // its parts, and how the files connect
  renderJourney() {
    const esc = (t) => this.escapeHtml(t || '');
    const j = this.journey;
    const local = this.repoTree?.source === 'local';
    const other = local ? `<button type="button" class="files-link-btn jr-link" data-wk="folders">Read another folder</button>` : '';
    // A failed new overview says so, even when an older map exists
    if (this._journeyPending || this._journeyError || !j) {
      this.walkBody.innerHTML = this._journeyPending
        ? `<div class="sheet-wait"><span class="files-spinner"></span>Reading the README and core files for the big picture…<div class="sheet-live"></div></div>`
        : `<div class="sheet-intro"><p>⚠️ Could not get an overview${this._journeyError ? `: ${esc(this._journeyError)}` : ''}.</p>` +
          `<div class="jr-actions jr-start">` +
            (j ? `<button type="button" class="files-link-btn jr-link" data-wk="map">Back to the current map</button>` : '<span></span>') +
            `<button type="button" class="files-send jr-primary" data-wk="journey-create">Ask again</button></div></div>` +
          this.replyDisclosure(this._journeyRaw) + other;
      return;
    }
    const done = new Set(j.done || []);
    const next = j.path.find(p => !done.has(p.file));
    const read = j.path.filter(p => done.has(p.file)).length;
    const chip = (f) => `<button type="button" class="jr-file" data-wk="open" data-path="${esc(f)}" title="Open ${esc(f)} in the reader">${esc(f.split('/').pop())}</button>`;
    // The project's own docs come before its code: the top-level README and
    // an architecture or design note, when there is one
    const files = [...this.repoTree.fileSet];
    const docs = [
      files.find(f => /^readme(\.\w+)?$/i.test(f)),
      files.find(f => f.split('/').length <= 2 && /^(architecture|design)\.md$/i.test(f.split('/').pop()))
    ].filter(Boolean);
    const parts = j.parts?.length
      ? `<div class="sheet-label">How it is organised</div><ul class="jr-parts">${j.parts.map(p =>
          `<li><strong>${esc(p.name)}</strong> ${esc(p.role)}${p.files.length ? `<span class="jr-files">${p.files.map(chip).join('')}</span>` : ''}</li>`).join('')}</ul>`
      : '';
    // The big picture before the files, until reading has begun; then where you are comes first
    this.walkBody.innerHTML =
      (j.summary ? `<p class="jr-summary">${esc(j.summary)}</p>` : '') +
      (read ? '' : parts) +
      `<div class="jr-head"><span class="sheet-label">Reading order</span>` +
        (read ? `<span class="jr-count">${read} of ${j.path.length} read</span>` : '') + `</div>` +
      (docs.length ? `<p class="jr-docs">Before the code, read ${docs.map(chip).join(' and ')} for what the project is for and how it is meant to fit together.</p>` : '') +
      `<ol class="sheet-steps jr-path">${j.path.map((p, k) =>
        `<li class="${p === next ? 'current' : ''}${done.has(p.file) ? ' done' : ''}" data-wk="walkfile" data-path="${esc(p.file)}">` +
        `<span class="sheet-step-dot">${done.has(p.file) ? '✓' : k + 1}</span>` +
        `<span class="jr-step"><code>${esc(p.file)}</code>${p.why ? `<span>${esc(p.why)}</span>` : ''}</span></li>`).join('')}</ol>` +
      (next
        ? `<div class="jr-actions"><button type="button" class="files-send jr-primary" data-wk="walkfile" data-path="${esc(next.file)}">` +
          `${read ? 'Continue with' : 'Start with'} ${esc(next.file.split('/').pop())} →</button></div>`
        : '') +
      (read ? parts : '') +
      `<div class="jr-connections"></div>` +
      `<div class="jr-foot">${other}<button type="button" class="files-link-btn jr-link" data-wk="journey-reset">Start over with a new overview</button></div>`;
    this.renderConnections(j);
  }

  // Which file uses which, from the imports of the files in the reading order
  // (read locally, no AI). Shown only when there is something to connect.
  async renderConnections(j) {
    const fileSet = this.repoTree.fileSet;
    const order = j.path.map(p => p.file);
    const importsOf = new Map();
    try {
      for (const f of (await this.fetchRepoFilesMany(order)).filter(f => !f.error)) {
        importsOf.set(f.path, resolveImports(extractImports(f.content, f.path), f.path, fileSet));
      }
    } catch (e) { return; }
    const box = this.walkBody.querySelector('.jr-connections');
    if (!box || this.journey !== j || ![...importsOf.values()].some(list => list.length)) return;
    const done = new Set(j.done || []);
    const esc = (t) => this.escapeHtml(t || '');
    const draw = (nodes) => `<ul>${nodes.map(n =>
      `<li><button type="button" class="jr-node${n.repeat ? ' is-repeat' : ''}${done.has(n.file) ? ' is-read' : ''}" data-wk="walkfile" data-path="${esc(n.file)}" title="${esc(n.file)}">` +
      `${esc(n.file.split('/').pop())}${done.has(n.file) ? ' <span aria-label="read">✓</span>' : ''}${n.repeat ? ' <span>(above)</span>' : ''}</button>` +
      (n.children.length ? draw(n.children) : '') + `</li>`).join('')}</ul>`;
    box.innerHTML = `<div class="sheet-label">How the files connect</div><p class="jr-legend">Each file, then the files it uses.</p>` +
      `<div class="jr-tree">${draw(connectionTree(order, importsOf))}</div>`;
  }
}
