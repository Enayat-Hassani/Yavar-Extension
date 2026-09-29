// Reviewing your own changes before you commit or push: the folder, the
// choice, and the diff read from .git.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { gitRepo, workingDiff, ignoreRules, blobSha } from '../utils/git.js';
import { idbGet, idbSet } from '../utils/idb.js';
import { isSecretPath } from '../utils/github.js';
import { fileGroups } from '../utils/changes.js';

export class ReviewPart {
  // Chrome can't run git, so .git is read directly (utils/git.js): the files
  // on disk are compared with the last commit, or with the branch you push
  // to, and the diff is walked part by part like any commit.
  async startReview() {
    if (!window.showDirectoryPicker) {
      this.showNotification('Reviewing changes needs folder access, which this browser does not offer');
      return;
    }
    this.walkPanel.classList.remove('hidden');
    await this.showFolderChoice({ review: true });
  }

  // "Review my changes · <folder>" on the start page: the folder reviewed
  // last, at its choice, where each kind of change says how far you read it
  async reviewLast() {
    const handle = this._reviewFolder || await idbGet('reviewFolder');
    if (!handle) return this.startReview();
    this.walkPanel.classList.remove('hidden');
    this._folderReview = true;
    if (!(await this.openLocalFolder({ handle }))) return;
    await this.showReviewChoice();
  }

  // One walk per folder and kind of change: `head` (not committed) or `upstream` (not pushed)
  reviewKey(base) {
    return `walk:local/${this.repoTree?.repo}:@${base === 'upstream' ? 'unpushed' : 'uncommitted'}`;
  }

  // .git and the folder's files, in the shape utils/git.js reads
  async localGit() {
    const root = this.localRoot;
    if (!root) throw new Error('open the folder again');
    const at = async (dir, path, kind) => {
      const parts = path.split('/').filter(Boolean);
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      return kind === 'dir' ? (parts.length ? dir.getDirectoryHandle(parts.at(-1)) : dir) : dir.getFileHandle(parts.at(-1));
    };
    let gitDir;
    try { gitDir = await root.getDirectoryHandle('.git'); } catch (e) {
      throw new Error(`${root.name} has no .git folder here; pick the repository's top folder`);
    }
    const git = {
      file: async (p) => { try { return await (await at(gitDir, p, 'file')).getFile(); } catch (e) { return null; } },
      list: async (p) => {
        try {
          const names = [];
          for await (const [name] of (await at(gitDir, p, 'dir')).entries()) names.push(name);
          return names;
        } catch (e) { return []; }
      }
    };
    const work = {
      paths: async () => [...(this.localFiles?.keys() || [])],
      file: async (p) => { try { return await (await at(root, p, 'file')).getFile(); } catch (e) { return null; } }
    };
    return { repo: gitRepo(git), git, work };
  }

  async showReviewChoice() {
    this.walkView = 'folders';
    const name = this.repoTree?.repo || '';
    document.getElementById('walk-title').textContent = 'Review my changes';
    document.getElementById('walk-sub').textContent = name;
    const esc = (t) => this.escapeHtml(t || '');
    this._review = null;
    let st;
    try {
      st = await (await this.localGit()).repo.state();
      if (!st.sha) throw new Error('the repository has no commits yet');
    } catch (e) {
      this.walkBody.innerHTML = `<div class="sheet-intro"><p>⚠️ ${esc(e.message)}.</p>` +
        `<button type="button" class="files-send jr-primary" data-wk="folders">Choose another folder</button></div>`;
      return;
    }
    this._review = st;
    const bases = ['head', ...(st.upstream && st.upstream.sha !== st.sha ? ['upstream'] : [])];
    let saved = {};
    try { saved = await chrome.storage.local.get(bases.map(b => this.reviewKey(b))); } catch (e) { /* none */ }
    // A walk begun earlier shows how far it got, and can be begun again
    const option = (base, title, desc) => {
      const w = saved[this.reviewKey(base)];
      const files = w?.blocks?.length ? fileGroups(w.blocks) : [];
      const n = files.length;
      const read = files.filter(g => Array.from({ length: g.last - g.first + 1 }, (_, j) => w.notes?.[g.first + j]?.length).every(Boolean)).length;
      return `<li class="rv-option"><button type="button" class="jr-folder" data-wk="review" data-base="${base}">` +
        `<span class="jr-folder-name">${esc(title)}</span>` +
        `<span class="jr-folder-status">${n ? `${read} of ${n} file${n === 1 ? '' : 's'} read · Continue` : esc(desc)}</span>` +
        `<span class="home-chev" aria-hidden="true">›</span></button>` +
        (n ? `<button type="button" class="files-link-btn rv-restart" data-wk="review-restart" data-base="${base}">Start over</button>` : '') +
        `</li>`;
    };
    this.walkBody.innerHTML =
      `<p class="wk-summary">${st.branch ? `On <code>${esc(st.branch)}</code>. ` : ''}Which changes should Yavar walk you through?</p>` +
      `<ul class="jr-folders">` +
        option('head', 'Not committed yet', `What changed since your last commit (${st.sha.slice(0, 7)})`) +
        (bases.includes('upstream') ? option('upstream', 'Not pushed yet', `Your commits and changes since ${st.upstream.name}`) : '') +
      `</ul>` +
      `<div class="jr-actions"><button type="button" class="files-link-btn jr-link" data-wk="folders">Another folder</button></div>`;
  }

  // Start over: forget the saved walk of these changes, then read them afresh
  async restartReview(base) {
    if (!this.confirmTwice(`review:${base}`, 'Click Start over again to forget this walk')) return;
    try { await chrome.storage.local.remove(this.reviewKey(base)); } catch (e) { /* ignore */ }
    await this.reviewLocal(base);
  }

  // Walk the changes against the last commit or the pushed branch. There is
  // one walk per kind of change; it keeps the diff's hash, so changes that
  // moved on since are read again (keeping what was said about parts that
  // didn't change).
  async reviewLocal(base) {
    const st = this._review;
    const name = this.repoTree?.repo;
    if (!st || !name) return;
    const up = base === 'upstream' && st.upstream;
    this.walkBody.innerHTML = `<div class="sheet-wait"><span class="files-spinner"></span>Comparing the files with ${up ? st.upstream.name : 'your last commit'}…</div>`;
    const change = { local: true, owner: '', repo: name, ref: '', kind: 'local', title: '', base: up ? 'unpushed' : 'uncommitted',
      sha: up ? st.upstream.sha : st.sha,
      label: up ? `Not pushed · since ${st.upstream.name}` : 'Not committed yet',
      what: up ? `the changes on ${st.branch} not pushed to ${st.upstream.name} yet, commits and uncommitted work together`
        : `the changes not committed yet${st.branch ? ` on ${st.branch}` : ''}` };
    try {
      const diff = await this.localDiff(change);
      if (!diff) {
        this.walkBody.innerHTML = `<div class="sheet-intro"><p>Nothing to review: the files match ${up ? st.upstream.name : 'your last commit'}.</p>` +
          `<button type="button" class="files-link-btn jr-link" data-wk="review-back">Back</button></div>`;
        return false;
      }
      change.diffHash = (await blobSha(new TextEncoder().encode(diff))).slice(0, 12);
      change.key = this.reviewKey(base);
      this._localDiffs = { [change.key]: diff };
      // Walks from before there was one per kind of change (their keys ended in the diff's hash)
      try {
        const old = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith(`${change.key}-`));
        if (old.length) await chrome.storage.local.remove(old);
      } catch (e) { /* ignore */ }
      // The start page offers this folder next time, one click away
      if (this.localRoot && this._reviewFolder !== this.localRoot) {
        this._reviewFolder = this.localRoot;
        idbSet('reviewFolder', this.localRoot);
        this.renderHome();
      }
      await this.walkChange(change);
      return true;
    } catch (e) {
      this.walkBody.innerHTML = `<div class="sheet-intro"><p>⚠️ Could not read the changes: ${this.escapeHtml(e.message)}.</p>` +
        `<button type="button" class="files-link-btn jr-link" data-wk="review-back">Back</button></div>`;
    }
  }

  // The diff of a local change: kept from reviewLocal, or read again (Ask again)
  async localDiff(change) {
    if (this._localDiffs?.[change.key]) {
      const diff = this._localDiffs[change.key];
      delete this._localDiffs[change.key];
      return diff;
    }
    if (this.repoTree?.repo !== change.repo || !this.localRoot) throw new Error(`open ${change.repo} again with Review my changes`);
    this.clearFileCache('local:');
    const { repo, git, work } = await this.localGit();
    // .gitignore files (the folder's and nested ones) and .git/info/exclude
    const sources = [];
    const exclude = await git.file('info/exclude');
    if (exclude) sources.push({ dir: '', text: await exclude.text() });
    for (const p of [...(this.localFiles?.keys() || [])].filter(p => p === '.gitignore' || p.endsWith('/.gitignore'))) {
      const f = await work.file(p);
      if (f) sources.push({ dir: p.slice(0, -'.gitignore'.length).replace(/\/$/, ''), text: await f.text() });
    }
    const { diff } = await workingDiff(repo, change.sha, work, { isIgnored: ignoreRules(sources), isPrivate: isSecretPath });
    return diff;
  }
}
