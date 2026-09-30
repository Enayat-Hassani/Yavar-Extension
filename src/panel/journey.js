// Reading a repository: the reading map, choosing a folder, and the files that
// connect.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { journeyPrompt, parseJourney, connectionTree, pickCoreFiles, isDocPath, moveInPath } from '../utils/journey.js';
import { isReadablePath } from '../utils/github.js';
import { idbGet } from '../utils/idb.js';
import { extractImports, resolveImports } from '../utils/github.js';
import { renderMarkdown } from '../utils/markdown.js';

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

  // "Read a project folder" or "Changes in a project folder": the folders you opened
  // before, or a new one
  async showFolderChoice({ review = this._folderReview } = {}) {
    this._folderReview = review;
    this.walkView = 'folders';
    document.getElementById('walk-title').textContent = review ? 'Changes' : 'Reading';
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
            return `<li class="rv-option"><button type="button" class="jr-folder" data-wk="folder" data-i="${k}">` +
              `<span class="jr-folder-name">${esc(r.name)}</span>${status ? `<span class="jr-folder-status">${esc(status)}</span>` : ''}` +
              `<span class="home-chev" aria-hidden="true">›</span></button>` +
              (status && !review ? `<button type="button" class="files-link-btn rv-restart" data-wk="folder-forget" data-i="${k}" aria-label="Delete the reading of ${esc(r.name)}">Delete</button>` : '') +
              `</li>`;
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
    if (this._folderReview) return this.showChanges();
    this.journey = await this.loadJourney();
    if (this.journey) this.showJourneyMap();
    else await this.createJourney();
  }

  showJourneyMap() {
    this.walkView = 'map';
    this._journeyEditing = false;
    this._journeyError = null;
    document.getElementById('walk-title').textContent = 'Reading';
    document.getElementById('walk-sub').textContent = this.repoDisplayName();
    this.renderJourney();
    this.walkBody.scrollTop = 0;
  }

  // Delete a project's reading: the map, the files marked read and each
  // file's walk (not the walks of its changes). id: "owner/repo" or "local/<folder>".
  async forgetReading(id) {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k === `journey:${id}` || k === `readMarks:${id}` ||
      (k.startsWith(`walk:${id}:`) && !k.startsWith(`walk:${id}:@`)));
    await chrome.storage.local.remove(keys);
  }

  // From the map: delete this project's reading and go back to where it began
  async deleteJourney() {
    if (this._journeyPending) return;
    if (!this.confirmTwice('journey-delete', 'Click Delete again to delete this reading and its walks')) return;
    const id = this.journeyKey().replace(/^journey:/, '');
    await this.forgetReading(id);
    this.journey = null;
    this._briefs = {};
    this.showNotification(`🗑️ Deleted the reading of ${this.repoDisplayName()}`);
    if (this.repoTree.source === 'local') return this.showFolderChoice({ review: false });
    if (this._tabCtx?.gh) { this._tabCtx.journey = null; this.renderHome(); }
    this.walkPanel.classList.add('hidden');
  }

  // From the folder list: delete a recent folder's reading, keeping the folder
  async forgetFolderReading(i) {
    const r = this._recentFolders?.[Number(i)];
    if (!r || !this.confirmTwice(`folder-forget:${r.name}`, `Click Delete again to delete the reading of ${r.name}`)) return;
    await this.forgetReading(`local/${r.name}`);
    if (this.repoTree?.source === 'local' && this.repoTree.repo === r.name) { this.journey = null; this._briefs = {}; }
    this.showNotification(`🗑️ Deleted the reading of ${r.name}`);
    await this.showFolderChoice({ review: false });
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
    const editing = !!this._journeyEditing;
    const chip = (f) => `<button type="button" class="jr-file" data-wk="open" data-path="${esc(f)}" title="Open ${esc(f)} in the reader">${esc(f.split('/').pop())}</button>`;
    // The project's own docs come before its code: the top-level README and
    // an architecture or design note, when there is one and the order hasn't it
    const files = [...this.repoTree.fileSet];
    const inPath = new Set(j.path.map(p => p.file));
    const docs = [
      files.find(f => /^readme(\.\w+)?$/i.test(f)),
      files.find(f => f.split('/').length <= 2 && /^(architecture|design)\.md$/i.test(f.split('/').pop()))
    ].filter(f => f && !inPath.has(f));
    const parts = j.parts?.length
      ? `<div class="sheet-label">How it is organised</div><ul class="jr-parts">${j.parts.map(p =>
          `<li><strong>${esc(p.name)}</strong> ${esc(p.role)}${p.files.length ? `<span class="jr-files">${p.files.map(chip).join('')}</span>` : ''}</li>`).join('')}</ul>`
      : '';
    // Editing: each file moves up or down (or is dragged), or leaves the
    // order, and any file of the project can be added at the end
    const row = (p, k) => editing
      ? `<li class="jr-edit-row${done.has(p.file) ? ' done' : ''}" draggable="true" data-k="${k}">` +
          `<span class="jr-grip" aria-hidden="true">⠿</span>` +
          `<span class="jr-step"><code>${esc(p.file)}</code>${isDocPath(p.file) ? '<span>Document: summed up</span>' : ''}</span>` +
          `<span class="jr-edit-btns">` +
            `<button type="button" class="jr-edit-btn" data-wk="jr-move" data-k="${k}" data-to="${k - 1}" aria-label="Move ${esc(p.file)} up"${k ? '' : ' disabled'}>↑</button>` +
            `<button type="button" class="jr-edit-btn" data-wk="jr-move" data-k="${k}" data-to="${k + 1}" aria-label="Move ${esc(p.file)} down"${k < j.path.length - 1 ? '' : ' disabled'}>↓</button>` +
            `<button type="button" class="jr-edit-btn" data-wk="jr-remove" data-k="${k}" aria-label="Take ${esc(p.file)} out of the order"${j.path.length > 1 ? '' : ' disabled'}>✕</button>` +
          `</span></li>`
      : `<li class="${p === next ? 'current' : ''}${done.has(p.file) ? ' done' : ''}" data-wk="walkfile" data-path="${esc(p.file)}">` +
        `<span class="sheet-step-dot">${done.has(p.file) ? '✓' : k + 1}</span>` +
        `<span class="jr-step"><code>${esc(p.file)}</code>${p.why ? `<span>${esc(p.why)}</span>` : ''}</span></li>`;
    const addable = editing ? files.filter(f => !inPath.has(f) && isReadablePath(f)).sort() : [];
    // The big picture before the files, until reading has begun; then where you are comes first
    this.walkBody.innerHTML =
      (j.summary ? `<div class="jr-summary md">${renderMarkdown(j.summary).html}</div>` : '') +
      (read || editing ? '' : parts) +
      `<div class="jr-head"><span class="sheet-label">Reading order</span>` +
        `<span class="jr-head-end">${read && !editing ? `<span class="jr-count">${read} of ${j.path.length} read</span>` : ''}` +
        `<button type="button" class="files-link-btn jr-link" data-wk="jr-edit" aria-pressed="${editing}">${editing ? 'Done' : 'Edit'}</button></span></div>` +
      (docs.length && !editing ? `<p class="jr-docs">Before the code, read ${docs.map(chip).join(' and ')} for what the project is for and how it is meant to fit together.</p>` : '') +
      `<ol class="sheet-steps jr-path${editing ? ' is-editing' : ''}">${j.path.map(row).join('')}</ol>` +
      (editing
        ? `<form class="jr-add" data-wk-form="jr-add"><input class="jr-add-input" list="jr-add-files" placeholder="Add a file: type part of its name" aria-label="Add a file to the reading order">` +
          `<datalist id="jr-add-files">${addable.slice(0, 3000).map(f => `<option value="${esc(f)}">`).join('')}</datalist>` +
          `<button type="submit" class="files-send jr-primary">Add</button></form>`
        : next
          ? `<div class="jr-actions"><button type="button" class="files-send jr-primary" data-wk="walkfile" data-path="${esc(next.file)}">` +
            `${read ? 'Continue with' : 'Start with'} ${esc(next.file.split('/').pop())} →</button></div>`
          : '') +
      (read && !editing ? parts : '') +
      `<div class="jr-connections"></div>` +
      `<div class="jr-foot">${other}<button type="button" class="files-link-btn jr-link" data-wk="journey-reset">Start over with a new overview</button>` +
        `<button type="button" class="files-link-btn jr-link jr-delete" data-wk="journey-delete">Delete this reading</button></div>`;
    if (editing) return this.wireOrderEditing();
    this.renderConnections(j);
  }

  // The reading order, edited on the map: saved at once, so walking a file
  // follows the new order
  async editOrder(change) {
    const j = this.journey;
    if (!j) return;
    await this.saveJourney({ ...j, path: change(j.path) });
    this.renderJourney();
  }

  async addToOrder(input) {
    const file = input.value.trim().replace(/^\.?\//, '');
    if (!file) return;
    if (!this.repoTree.fileSet.has(file)) { this.showNotification(`⚠️ ${file} isn't a file in this project`); return; }
    if (this.journey.path.some(p => p.file === file)) { this.showNotification(`${file} is already in the order`); return; }
    await this.editOrder(path => [...path, { file, why: '' }]);
    this.walkBody.querySelector('.jr-add-input')?.focus();
  }

  // Dragging a file in the order onto another puts it in that one's place
  wireOrderEditing() {
    const list = this.walkBody.querySelector('.jr-path');
    const form = this.walkBody.querySelector('.jr-add');
    form.addEventListener('submit', (e) => { e.preventDefault(); this.addToOrder(form.querySelector('input')); });
    let from = null;
    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('li[data-k]');
      from = Number(li.dataset.k);
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragover', (e) => {
      if (from == null) return;
      e.preventDefault();
      list.querySelectorAll('.is-drop').forEach(x => x.classList.remove('is-drop'));
      e.target.closest('li[data-k]')?.classList.add('is-drop');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = e.target.closest('li[data-k]');
      if (from != null && to) { const k = from; this.editOrder(path => moveInPath(path, k, Number(to.dataset.k))); }
      from = null;
    });
    list.addEventListener('dragend', () => {
      from = null;
      list.querySelectorAll('.is-dragging, .is-drop').forEach(x => x.classList.remove('is-dragging', 'is-drop'));
    });
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
