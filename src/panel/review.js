// Reviewing your own changes before you commit or push: the folder, the
// choice, and the diff read from .git.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { gitRepo, workingDiff, ignoreRules, blobSha } from '../utils/git.js';
import { idbGet, idbSet } from '../utils/idb.js';
import { isSecretPath } from '../utils/github.js';

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
  // last, its uncommitted changes, or what isn't pushed when all is committed
  async reviewLast() {
    const handle = this._reviewFolder || await idbGet('reviewFolder');
    if (!handle) return this.startReview();
    this.walkPanel.classList.remove('hidden');
    this._folderReview = true;
    if (!(await this.openLocalFolder({ handle }))) return;
    await this.showReviewChoice();
    if (!this._review) return;   // not a repository any more: the choice says why
    if (!(await this.reviewLocal('head')) && this._review.upstream && this._review.upstream.sha !== this._review.sha) {
      await this.reviewLocal('upstream');
    }
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
    const option = (base, title, desc) => `<li><button type="button" class="jr-folder" data-wk="review" data-base="${base}">` +
      `<span class="jr-folder-name">${esc(title)}</span><span class="jr-folder-status">${esc(desc)}</span>` +
      `<span class="home-chev" aria-hidden="true">›</span></button></li>`;
    this.walkBody.innerHTML =
      `<p class="wk-summary">${st.branch ? `On <code>${esc(st.branch)}</code>. ` : ''}Which changes should Yavar walk you through?</p>` +
      `<ul class="jr-folders">` +
        option('head', 'Not committed yet', `What changed since your last commit (${st.sha.slice(0, 7)})`) +
        (st.upstream && st.upstream.sha !== st.sha
          ? option('upstream', 'Not pushed yet', `Your commits and changes since ${st.upstream.name}`) : '') +
      `</ul>` +
      `<div class="jr-actions"><button type="button" class="files-link-btn jr-link" data-wk="folders">Another folder</button></div>`;
  }

  // Walk the changes against the last commit or the pushed branch. The walk's
  // key is made from the diff, so the same changes reopen their walk.
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
      const hash = (await blobSha(new TextEncoder().encode(diff))).slice(0, 12);
      change.key = `walk:local/${name}:@${change.base}-${hash}`;
      this._localDiffs = { [change.key]: diff };
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
