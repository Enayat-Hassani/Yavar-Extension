// A project's changes in one sheet: your own work before you commit or push
// (a folder), and the recent commits (a folder's, read from .git, or a
// GitHub repository's). Each opens the same part-by-part walk.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { gitRepo, workingDiff, commitDiff, ignoreRules } from '../utils/git.js';
import { textSha } from '../utils/walkthrough.js';
import { idbGet, idbSet } from '../utils/idb.js';
import { isSecretPath, timeAgo } from '../utils/github.js';
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

  // "Changes · <folder>" on the start page: the folder reviewed
  // last, at its choice, where each kind of change says how far you read it
  async reviewLast() {
    const handle = this._reviewFolder || await idbGet('reviewFolder');
    if (!handle) return this.startReview();
    this.walkPanel.classList.remove('hidden');
    this._folderReview = true;
    if (!(await this.openLocalFolder({ handle }))) return;
    await this.showChanges();
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

  // "Changes" on the start page: a GitHub tab's repository, else a folder
  async openChanges() {
    if (this._tabCtx?.gh) {
      try {
        if (!(await this.ensureRepoTree())) throw new Error('open a GitHub repository first');
      } catch (e) {
        this.showNotification('⚠️ ' + e.message);
        return;
      }
      this.walkPanel.classList.remove('hidden');
      return this.showChanges();
    }
    return this._reviewFolder ? this.reviewLast() : this.startReview();
  }

  // How far a saved walk of a change got: "2 of 5 files read", or ''
  changeProgress(w) {
    const files = w?.blocks?.length ? fileGroups(w.blocks) : [];
    if (!files.length) return '';
    const read = files.filter(g => Array.from({ length: g.last - g.first + 1 }, (_, j) => w.notes?.[g.first + j]?.length).every(Boolean)).length;
    if (read === files.length) return read === 1 ? 'Read' : `All ${read} files read`;
    return `${read} of ${files.length} file${files.length === 1 ? '' : 's'} read`;
  }

  // The sheet: your work (a folder only; GitHub can't see it) and the
  // recent commits, each saying how far its walk got
  async showChanges() {
    this.walkView = 'folders';
    const t = this.repoTree;
    const local = t?.source === 'local';
    const name = t?.repo || '';
    document.getElementById('walk-title').textContent = 'Changes';
    document.getElementById('walk-sub').textContent = this.repoDisplayName();
    const esc = (s) => this.escapeHtml(s || '');
    this._review = null;
    this.walkBody.innerHTML = `<div class="sheet-wait"><span class="files-spinner"></span>Reading the history…</div>`;
    let st = null;
    let commits;
    try {
      if (local) {
        const { repo } = await this.localGit();
        st = await repo.state();
        if (!st.sha) throw new Error('the repository has no commits yet');
        commits = await repo.log(st.sha, 20);
      } else {
        commits = await this.fetchRecentCommits();
      }
    } catch (e) {
      this.walkBody.innerHTML = `<div class="sheet-intro"><p>⚠️ ${esc(e.message)}.</p>` +
        (local ? `<button type="button" class="files-send jr-primary" data-wk="folders">Choose another folder</button>` : '') + `</div>`;
      return;
    }
    this._review = st;
    this._commits = commits;
    const bases = local ? ['head', ...(st.upstream && st.upstream.sha !== st.sha ? ['upstream'] : [])] : [];
    const commitKey = (sha) => `walk:${local ? `local/${name}` : `${t.owner}/${t.repo}`}:@${sha}`;
    let saved = {};
    try { saved = await chrome.storage.local.get([...bases.map(b => this.reviewKey(b)), ...commits.map(c => commitKey(c.sha))]); } catch (e) { /* none */ }
    // A walk begun earlier shows how far it got, and can be begun again
    const option = (base, title, desc) => {
      const done = this.changeProgress(saved[this.reviewKey(base)]);
      return `<li class="rv-option"><button type="button" class="jr-folder" data-wk="review" data-base="${base}">` +
        `<span class="jr-folder-name">${esc(title)}</span>` +
        `<span class="jr-folder-status">${done ? `${done} · Continue` : esc(desc)}</span>` +
        `<span class="home-chev" aria-hidden="true">›</span></button>` +
        (done ? `<button type="button" class="files-link-btn rv-restart" data-wk="review-restart" data-base="${base}">Start over</button>` : '') +
        `</li>`;
    };
    const commitRow = (c) => {
      const done = this.changeProgress(saved[commitKey(c.sha)]);
      return `<li><button type="button" class="jr-folder" data-wk="commit" data-sha="${esc(c.sha)}">` +
        `<span class="jr-folder-name">${esc(c.title || '(no message)')}</span>` +
        `<span class="jr-folder-status"><code>${esc(c.sha.slice(0, 7))}</code> ${esc(c.author)}${c.date ? ` · ${esc(timeAgo(c.date))}` : ''}` +
          `${done ? ` · <span class="rv-done">${esc(done)}</span>` : ''}</span>` +
        `<span class="home-chev" aria-hidden="true">›</span></button></li>`;
    };
    this.walkBody.innerHTML =
      (local
        ? `<div class="sheet-label">Your work${st.branch ? ` on <code>${esc(st.branch)}</code>` : ''}</div>` +
          `<ul class="jr-folders">` +
            option('head', 'Not committed yet', `What changed since your last commit (${st.sha.slice(0, 7)})`) +
            (bases.includes('upstream') ? option('upstream', 'Not pushed yet', `Your commits and changes since ${st.upstream.name}`) : '') +
          `</ul>`
        : '') +
      `<div class="jr-head"><span class="sheet-label">Recent commits${local ? '' : ` on ${esc(this.refLabel(t.ref))}`}</span>` +
        (commits.length ? `<button type="button" class="files-link-btn jr-link" data-wk="commits-summary">What's been happening?</button>` : '') + `</div>` +
      (commits.length ? `<ul class="jr-folders rv-commits">${commits.map(commitRow).join('')}</ul>` : `<p class="wk-summary">No commits found.</p>`) +
      (local ? `<div class="jr-actions"><button type="button" class="files-link-btn jr-link" data-wk="folders">Another folder</button></div>` : '');
  }

  // A recent commit, read part by part like your own changes
  async openCommit(sha) {
    const c = this._commits?.find(x => x.sha === sha);
    if (!c) return;
    const t = this.repoTree;
    this.walkBody.innerHTML = `<div class="sheet-wait"><span class="files-spinner"></span>Reading commit ${sha.slice(0, 7)}…</div>`;
    if (t.source !== 'local') return this.walkChange({ owner: t.owner, repo: t.repo, kind: 'commit', sha, title: c.title });
    await this.openLocalChange({ local: true, owner: '', repo: t.repo, kind: 'commit', sha, parent: c.parents[0] || null, ref: sha,
      title: c.title, base: sha.slice(0, 7), label: `Commit ${sha.slice(0, 7)}`, what: `commit ${sha.slice(0, 7)}`,
      key: `walk:local/${t.repo}:@${sha}` }, 'This commit changed no files Yavar can show.');
  }

  // "What's been happening?": the recent commits summed up in the conversation
  summarizeCommits() {
    const commits = this._commits || [];
    const name = this.repoDisplayName();
    const on = this.repoTree.source === 'local' ? (this._review?.branch || 'the current branch') : this.refLabel(this.repoTree.ref);
    const lines = commits.map(c => `- ${c.sha.slice(0, 7)} ${c.date ? c.date.slice(0, 10) : ''} ${c.author}: ${c.title}`).join('\n');
    this.walkPanel.classList.add('hidden');
    this._readingContext = { label: name, ts: Date.now() };
    this.askInThread({
      title: name, sub: 'Recent changes', label: `What's been happening? (${commits.length} commits)`,
      prompt: `Here are the latest ${commits.length} commits on ${on} of ${name}:\n\n${lines}\n\n` +
        'Explain what the project has been working on lately: group related commits into themes, say what each theme ' +
        'means for the code or users, and point out any commit worth reading closely to learn from (and why).'
    });
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
    return this.openLocalChange(change, `Nothing to review: the files match ${up ? st.upstream.name : 'your last commit'}.`, this.reviewKey(base));
  }

  // Walk a change of a folder (your work, or a commit). Its diff's hash
  // tells a walk of the same changes (opened again) from one that moved on.
  async openLocalChange(change, emptyNote, key = change.key) {
    try {
      const diff = await this.localDiff({ ...change, key });
      if (!diff) {
        this.walkBody.innerHTML = `<div class="sheet-intro"><p>${this.escapeHtml(emptyNote)}</p>` +
          `<button type="button" class="files-link-btn jr-link" data-wk="review-back">Back</button></div>`;
        return false;
      }
      change.diffHash = await textSha(diff);
      change.key = key;
      this._localDiffs = { [change.key]: diff };
      // Walks from before there was one per kind of change (their keys ended in the diff's hash)
      if (change.kind !== 'commit') {
        try {
          const old = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith(`${change.key}-`));
          if (old.length) await chrome.storage.local.remove(old);
        } catch (e) { /* ignore */ }
      }
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
    if (this.repoTree?.repo !== change.repo || !this.localRoot) throw new Error(`open ${change.repo} again from Changes`);
    if (change.kind === 'commit') return commitDiff((await this.localGit()).repo, change.parent, change.sha, { isPrivate: isSecretPath });
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

  // A folder's file as it was at a commit, read from .git
  localFileAt(sha, path) {
    return this.cachedFile(`local:${this.repoTree.repo}@${sha}:${path}`, async () => {
      const { repo } = await this.localGit();
      this._commitFiles = this._commitFiles?.sha === sha ? this._commitFiles : { sha, files: await repo.commitFiles(sha) };
      const blob = this._commitFiles.files.get(path);
      if (!blob) throw new Error(`${path} isn't in commit ${sha.slice(0, 7)}`);
      return new TextDecoder().decode((await repo.read(blob)).data);
    });
  }
}
