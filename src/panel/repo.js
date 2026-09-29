// Files from a GitHub repository or a folder on this computer: fetching and
// caching them, the file tree, read marks, file packs, and opening files in
// the reader.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { idbGet, idbSet } from '../utils/idb.js';
import {
  parseGitHubUrl,
  refCandidates,
  rawFileUrl,
  encodePath,
  isReadablePath,
  estimateTokens,
  formatCount,
  sliceLines,
  buildPack,
  readingPrompt,
  READ_MODES,
  fencedFile,
  parseCommitsAtom,
  commitsFromApi,
  timeAgo,
  LOCAL_SKIP_DIRS,
  isSecretPath,
  parseFileRef,
  LINE_NUMBER_NOTE,
  NEED_RULE
} from '../utils/github.js';

export class RepoPart {
  // ---- GitHub auth (optional personal access token, stored locally) ----
  async getGithubToken() {
    try {
      const { githubToken } = await chrome.storage.local.get('githubToken');
      return (githubToken || '').trim();
    } catch (e) {
      return '';
    }
  }

  ghHeaders(token) {
    const h = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  // One GET to the GitHub REST API with consistent, friendly errors
  // (err.status is kept for callers that retry on 404/422).
  async ghApi(path, { accept, notFound = 'not found' } = {}) {
    const token = await this.getGithubToken();
    const headers = this.ghHeaders(token);
    if (accept) headers.Accept = accept;
    const res = await fetch('https://api.github.com/' + path, { headers });
    if (res.ok) return res;
    const err = new Error(
      res.status === 403 || res.status === 429
        ? (token ? 'GitHub rate limit or access denied' : 'GitHub rate limit hit (60/hr without a token), add a free token in Settings')
        : res.status === 404
          ? (token ? notFound : 'not found (private repo? add a GitHub token in Settings)')
          : 'GitHub ' + res.status);
    err.status = res.status;
    throw err;
  }

  // Decode base64 as proper UTF-8 (atob alone mangles multi-byte chars → "Â·")
  decodeB64(b64) {
    const bin = atob((b64 || '').replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Fetch a single file's contents from a repo via the GitHub Contents API.
  async fetchRepoFile(owner, repo, path, branch, maxChars = 6000) {
    const cleanPath = path.replace(/^\.?\//, '');
    const ref = branch || 'HEAD';
    let text = null;

    // raw.githubusercontent.com first: no API quota used (public repos)
    try {
      const raw = await fetch(rawFileUrl(owner, repo, ref, cleanPath), { credentials: 'omit' });
      if (raw.ok) text = await raw.text();
    } catch (e) { /* fall through to the API */ }

    if (text == null) {
      // Private repos (with a token) and anything raw couldn't serve
      const res = await this.ghApi(`repos/${owner}/${repo}/contents/${encodePath(cleanPath)}?ref=${encodeURIComponent(ref)}`,
        { notFound: 'file not found' });
      const data = await res.json();
      if (Array.isArray(data)) throw new Error('path is a directory');
      if (!data.content) throw new Error('no content (file may be too large — over 1MB)');
      text = this.decodeB64(data.content);
    }

    return this.truncateText(text, maxChars);
  }

  // Callers pick the cap; the reader passes a huge one so attached files
  // arrive whole. When we must truncate, cut on a
  // newline so it never ends mid-line.
  truncateText(text, maxChars) {
    if (text.length <= maxChars) return text;
    let cut = text.slice(0, maxChars);
    const lastNl = cut.lastIndexOf('\n');
    if (lastNl > maxChars * 0.5) cut = cut.slice(0, lastNl);
    return cut + `\n\n… [truncated — full file is ${text.length} chars]`;
  }

  // Browse a repo's files, pick several, and send them to the chat as ONE
  // Markdown pack (with a repo map) plus a reading prompt. File contents come
  // from raw.githubusercontent.com, which doesn't use the 60/hr API quota;
  // the tree is one API call per repo+ref, cached for the browser session.
  async getActiveGitHub() {
    try {
      const [tab] = await this.getActiveTabs();
      const info = parseGitHubUrl(tab?.url || '');
      if (info) info.title = tab.title || '';
      return info;
    } catch (e) {
      return null;
    }
  }

  // Fetch (or reuse) the recursive tree for owner/repo at ref ('HEAD' = default branch).
  async loadRepoTree(owner, repo, ref = 'HEAD') {
    const key = `tree:${owner}/${repo}@${ref}`;
    this._treeCache = this._treeCache || new Map();
    if (this._treeCache.has(key)) return this._treeCache.get(key);
    try {
      const cached = (await chrome.storage.session.get(key))[key];
      if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
        this._treeCache.set(key, cached);
        return cached;
      }
    } catch (e) { /* session storage unavailable */ }

    const res = await this.ghApi(`repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { notFound: 'repo or branch not found' });
    const data = await res.json();
    const tree = {
      owner, repo, ref, ts: Date.now(), truncated: !!data.truncated,
      items: (data.tree || []).slice(0, 8000).map(i => ({ path: i.path, type: i.type, size: i.size }))
    };
    this._treeCache.set(key, tree);
    try { await chrome.storage.session.set({ [key]: tree }); } catch (e) { /* too big or unavailable */ }
    return tree;
  }

  // Load the tree for the repo in the active tab, honouring the branch/tag in
  // the URL (trying each possible ref split for branch names with slashes).
  async ensureRepoTree() {
    const gh = await this.getActiveGitHub();
    if (!gh) { this.repoTree = null; return false; }

    let tree = null;
    let activePath = null;
    if (gh.rest.length) {
      for (const cand of refCandidates(gh.rest)) {
        try {
          tree = await this.loadRepoTree(gh.owner, gh.repo, cand.ref);
          activePath = cand.path || null;
          break;
        } catch (e) {
          if (e.status !== 404 && e.status !== 422) throw e;
        }
      }
    }
    if (!tree) tree = await this.loadRepoTree(gh.owner, gh.repo, 'HEAD');

    const sameRepo = this.repoTree && this.repoTree.owner === gh.owner && this.repoTree.repo === gh.repo;
    this.repoTree = { ...tree, ...this.deriveTree(tree) };
    this.activeRepoFile = gh.kind === 'blob' && activePath && this.repoTree.fileSet.has(activePath)
      ? { path: activePath, lines: gh.lines }
      : null;
    await this.loadReadMarks();
    return true;
  }

  refLabel(ref) {
    return !ref || ref === 'HEAD' ? 'default branch' : (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref);
  }

  // The chat a project's reading goes to (claimChat): the map and its files' walks
  readTopic() {
    return (this.readMarksKey() || 'readMarks:').replace(/^readMarks:/, 'read:');
  }

  readMarksKey() {
    if (!this.repoTree) return null;
    return this.repoTree.source === 'local'
      ? `readMarks:local/${this.repoTree.repo}`
      : `readMarks:${this.repoTree.owner}/${this.repoTree.repo}`;
  }

  // "owner/repo" for GitHub, the folder name for a local folder
  repoDisplayName() {
    const t = this.repoTree;
    return !t ? '' : t.owner ? `${t.owner}/${t.repo}` : t.repo;
  }

  // Read a file from whichever source the reader is showing
  // Contents are cached per repo+ref+path, so "+ Imports" then Send, or a
  // README preview then Explain, download each file only once.
  async readRepoFile(path, maxChars = 2000000) {
    const t = this.repoTree;
    const text = t.source === 'local'
      ? await this.cachedFile(`local:${t.owner}/${t.repo}@${t.ref}:${path}`, () => this.readLocalFile(path, 2000000))
      : await this.fetchFileAt(t.owner, t.repo, t.ref, path);
    return this.truncateText(text, maxChars);
  }

  // A GitHub file at any ref (the loaded tree's, a commit, a pull request's
  // head), so the reader, practice and packs download it once
  fetchFileAt(owner, repo, ref, path) {
    return this.cachedFile(`github:${owner}/${repo}@${ref}:${path}`, () => this.fetchRepoFile(owner, repo, path, ref, 2000000));
  }

  // One download per key; failures aren't kept
  cachedFile(key, load) {
    this._fileCache = this._fileCache || new Map();
    let pending = this._fileCache.get(key);
    if (!pending) {
      pending = load();
      pending.catch(() => this._fileCache.delete(key));
      this._fileCache.set(key, pending);
      if (this._fileCache.size > 80) this._fileCache.delete(this._fileCache.keys().next().value);
    }
    return pending;
  }

  // Lookup structures for a tree, built once per tree object (trees are
  // cached, so reopening the reader doesn't rebuild them)
  deriveTree(tree) {
    this._derived = this._derived || new WeakMap();
    let d = this._derived.get(tree);
    if (!d) {
      const blobs = tree.items.filter(i => i.type === 'blob');
      d = {
        fileSet: new Set(blobs.map(i => i.path)),
        sizes: new Map(blobs.map(i => [i.path, i.size])),
        root: this.buildFileTree(tree.items),
        // [path, lowercased path, lowercased name] for search
        searchIndex: blobs.map(i => [i.path, i.path.toLowerCase(), i.path.split('/').pop().toLowerCase()])
      };
      this._derived.set(tree, d);
    }
    return d;
  }

  // Drop cached file contents whose key starts with prefix ('' = all)
  clearFileCache(prefix = '') {
    for (const k of [...(this._fileCache?.keys() || [])]) if (k.startsWith(prefix)) this._fileCache.delete(k);
  }

  async loadReadMarks() {
    const key = this.readMarksKey();
    if (key && key === this._readMarksKey) return; // already loaded; markRead keeps it current
    this._readMarksKey = key;
    this.readMarks = new Set();
    if (!key) return;
    try { this.readMarks = new Set((await chrome.storage.local.get(key))[key] || []); } catch (e) { /* ignore */ }
  }

  async markRead(paths) {
    const key = this.readMarksKey();
    if (!key) return;
    paths.forEach(p => this.readMarks.add(p));
    try { await chrome.storage.local.set({ [key]: [...this.readMarks].slice(-2000) }); } catch (e) { /* ignore */ }
  }

  // Files open in the Yavar reader (reader.html), one tab that shows GitHub
  // and local files alike, with the lines under discussion highlighted.

  // Where a file of the loaded repo or folder lives, as the reader needs it
  fileRefFor(path, lines = null) {
    const t = this.repoTree;
    return { source: t.source || 'github', owner: t.owner, repo: t.repo, ref: t.ref, path, lines };
  }

  // Inline code in an answer that names a file of the loaded repo or folder
  // becomes a link. Where the file lives is stored on the link, so an old
  // answer still opens the right file after you move on to another repo.
  linkFileRefs(root) {
    const t = this.repoTree;
    if (!t) return;
    root.querySelectorAll('code').forEach(el => {
      if (el.closest('pre, a, button')) return;
      const ref = parseFileRef(el.textContent, t.fileSet);
      if (!ref) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-ref';
      btn.dataset.fileRef = JSON.stringify(this.fileRefFor(ref.path, ref.lines));
      const at = !ref.lines ? '' : ref.lines.end > ref.lines.start ? `, lines ${ref.lines.start}-${ref.lines.end}` : `, line ${ref.lines.start}`;
      btn.title = `Open ${ref.path}${at} in the reader`;
      el.replaceWith(btn);
      btn.appendChild(el);
    });
  }

  // Show a file in the reader tab with `lines` highlighted. `label` names what
  // is highlighted (a walkthrough block). When several calls race (Next
  // clicked quickly), only the latest is shown. A local file carries its
  // walk's storage key, so an edit saved in the reader can move the walk.
  async openRepoFile({ source = 'github', owner, repo, ref, path, lines = null, label = '', diff = null, focus = false, nav = null, walk = null }) {
    const seq = (this._readerSeq = (this._readerSeq || 0) + 1);
    try {
      const t = this.repoTree;
      const loaded = t && t.repo === repo && (t.owner || '') === (owner || '') && (t.ref || '') === (ref || '');
      let content;
      if (loaded) content = await this.readRepoFile(path);
      else if (source === 'local') throw new Error('open that folder again first');
      else content = await this.fetchFileAt(owner, repo, ref, path);
      if (seq !== this._readerSeq) return;
      await chrome.storage.session.set({ readerView: {
        repo: { source, owner, repo, ref, name: owner ? `${owner}/${repo}` : repo },
        path, content, lines, label, diff, focus, nav, walk, walkKey: source === 'local' ? this.walkKey(path) : null, ts: Date.now()
      } });
      await this.showReaderTab();
    } catch (e) {
      this.showNotification('⚠️ Could not open ' + path.split('/').pop() + ': ' + e.message);
    }
  }

  // Load the repository or folder a reader view came from, to reopen its
  // walk. A folder is opened only if Chrome still allows reading it, without
  // asking (the click was in the reader, not here). True when it's loaded.
  async restoreSource(r) {
    const t = this.repoTree;
    if (r.source === 'local') {
      if (t?.source === 'local' && t.repo === r.repo && this.localRoot) return true;
      const recent = ((await idbGet('recentFolders')) || []).map(x => x.handle);
      const handle = [await idbGet('lastFolder'), ...recent].find(h => h?.name === r.repo);
      if (!handle || (await handle.queryPermission({ mode: 'read' })) !== 'granted') return false;
      return this.openLocalFolder({ handle });
    }
    if (t && t.source !== 'local' && t.owner === r.owner && t.repo === r.repo && t.ref === r.ref) return true;
    const tree = await this.loadRepoTree(r.owner, r.repo, r.ref);
    this.repoTree = { ...tree, ...this.deriveTree(tree) };
    this.activeRepoFile = null;
    await this.loadReadMarks();
    return true;
  }

  // The reader saved an edit to a local file. Cached copies of local files go
  // (reading them again is cheap), and an open walk of that file takes the
  // moved lines the reader stored for it.
  async onFileEdited({ repo, path }) {
    this.clearFileCache('local:');
    const w = this.walk;
    const t = this.repoTree;
    if (!w?.blocks || w.change || w.path !== path || t?.source !== 'local' || t.repo !== repo) return;
    const key = this.walkKey(path);
    const saved = (await chrome.storage.local.get(key))[key];
    if (!saved || this.walk !== w) return;
    this.walk = saved;
    if (!this.walkPanel.classList.contains('hidden')) this.renderWalk();
  }

  // Bring the reader tab forward, or open one next to the tab you're on
  async showReaderTab() {
    const base = chrome.runtime.getURL('reader.html');
    const [tab] = await this.getActiveTabs();
    const tabs = await chrome.tabs.query({ windowId: tab?.windowId });
    const reader = tabs.find(x => (x.url || '').startsWith(base));
    if (reader) {
      if (!reader.active) await chrome.tabs.update(reader.id, { active: true });
    } else {
      await chrome.tabs.create({ url: base, windowId: tab?.windowId, index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id });
    }
  }

  async quickAddActiveFile(mode = null) {
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
    await this.sendRepoFiles([path], mode || 'explain', lines);
  }

  buildFileTree(items) {
    const root = { name: '', path: '', type: 'tree', children: {} };
    for (const it of items) {
      const parts = it.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const isLast = i === parts.length - 1;
        if (!node.children[name]) {
          node.children[name] = {
            name,
            path: parts.slice(0, i + 1).join('/'),
            type: isLast ? it.type : 'tree',
            children: {}
          };
        }
        node = node.children[name];
      }
    }
    return root;
  }

  // Read a project folder from this computer with the same reader: packs,
  // modes, imports, READMEs. Nothing is uploaded except what you send.

  // show: false loads the folder without opening the reader (the picker uses it)
  // Choose a folder (or reopen the last one) as the file source; true if loaded
  // reuse: the folder you last opened, without asking; handle: a folder
  // chosen from the recent list. Otherwise the system folder picker opens.
  async openLocalFolder({ reuse = false, handle: chosen = null } = {}) {
    let tree;
    try {
      if (window.showDirectoryPicker) {
        let handle = chosen || (reuse ? await idbGet('lastFolder') : null);
        if (handle) {
          const perm = await handle.queryPermission({ mode: 'read' });
          if (perm !== 'granted' && (await handle.requestPermission({ mode: 'read' })) !== 'granted') handle = null;
        }
        if (!handle) handle = await window.showDirectoryPicker({ id: 'yavar-reader', mode: 'read' });
        idbSet('lastFolder', handle);
        await this.rememberFolder(handle);
        this.localRoot = handle;
        this.showNotification(`Reading ${handle.name}…`);
        tree = await this.scanDirectoryHandle(handle);
      } else {
        const files = await this.pickFolderViaInput();
        if (!files) return false;
        this.localRoot = null;
        tree = this.treeFromFileList(files);
      }
    } catch (e) {
      if (e?.name === 'AbortError') return false; // picker cancelled
      this.showNotification('Could not open the folder: ' + e.message);
      return false;
    }
    if (!tree.items.length) {
      this.showNotification('No readable files found in that folder');
      return false;
    }

    this.repoTree = {
      source: 'local', owner: '', repo: tree.name, ref: '', truncated: tree.truncated,
      items: tree.items, ...this.deriveTree(tree)
    };
    this.localFiles = tree.files;
    this.activeRepoFile = null;
    this.clearFileCache('local:');
    await this.loadReadMarks();
    this.hideNotification();
    return true;
  }

  // Walk a directory handle, skipping heavy/generated folders and secrets
  async scanDirectoryHandle(root, limit = 8000) {
    const items = [];
    const files = new Map();
    const sizeReads = [];
    let truncated = false;
    const queue = [[root, '']];
    for (let q = 0; q < queue.length && !truncated; q++) {   // index, not shift(): O(1)
      const [dir, prefix] = queue[q];
      for await (const [name, handle] of dir.entries()) {
        if (items.length >= limit) { truncated = true; break; }
        const path = prefix + name;
        if (handle.kind === 'directory') {
          if (LOCAL_SKIP_DIRS.has(name)) continue;
          items.push({ path, type: 'tree' });
          queue.push([handle, path + '/']);
        } else if (!isSecretPath(path)) {
          const item = { path, type: 'blob', size: null };
          items.push(item);
          files.set(path, handle);
          // Sizes are read in parallel below instead of one await per file
          if (isReadablePath(path)) sizeReads.push(item);
        }
      }
    }
    for (let i = 0; i < sizeReads.length; i += 64) {
      await Promise.all(sizeReads.slice(i, i + 64).map(async (item) => {
        try { item.size = (await files.get(item.path).getFile()).size; } catch (e) { /* unreadable */ }
      }));
    }
    return { name: root.name, items, files, truncated };
  }

  // Fallback for browsers without showDirectoryPicker
  pickFolderViaInput() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener('change', () => resolve(input.files?.length ? [...input.files] : null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
  }

  treeFromFileList(fileList, limit = 8000) {
    const items = [];
    const files = new Map();
    const dirs = new Set();
    let name = '';
    let truncated = false;
    for (const f of fileList) {
      const parts = (f.webkitRelativePath || f.name).split('/');
      name = name || parts[0];
      const rel = parts.slice(1);
      if (!rel.length || rel.slice(0, -1).some(d => LOCAL_SKIP_DIRS.has(d))) continue;
      const path = rel.join('/');
      if (isSecretPath(path)) continue;
      if (items.length >= limit) { truncated = true; break; }
      for (let i = 1; i < rel.length; i++) {
        const d = rel.slice(0, i).join('/');
        if (!dirs.has(d)) { dirs.add(d); items.push({ path: d, type: 'tree' }); }
      }
      items.push({ path, type: 'blob', size: f.size });
      files.set(path, f);
    }
    return { name: name || 'folder', items, files, truncated };
  }

  async readLocalFile(path, maxChars) {
    const entry = this.localFiles?.get(path);
    if (!entry) throw new Error('file not found');
    let file;
    try {
      file = entry.getFile ? await entry.getFile() : entry;
    } catch (e) {
      throw new Error('the folder changed or permission was lost, reopen it');
    }
    if (file.size > 5 * 1024 * 1024) throw new Error('file is over 5 MB');
    return this.truncateText(await file.text(), maxChars);
  }

  // The last few folders opened, newest first, for "Read a project folder"
  async rememberFolder(handle) {
    const recent = (await idbGet('recentFolders')) || [];
    const others = [];
    for (const r of recent) {
      let same = r.name === handle.name;
      try { same = same && await r.handle.isSameEntry(handle); } catch (e) { /* treat same name as same */ }
      if (!same) others.push(r);
    }
    await idbSet('recentFolders', [{ name: handle.name, handle, ts: Date.now() }, ...others].slice(0, 6));
  }

  // A small preview card for a README: first paragraph, plus one-click actions.
  // Latest commits on this branch. The public Atom feed costs no API quota;
  // the REST API is the fallback (e.g. private repos with a token).
  async fetchRecentCommits() {
    const { owner, repo, ref } = this.repoTree;
    const key = `${owner}/${repo}@${ref}`;
    this._commitsCache = this._commitsCache || new Map();
    const hit = this._commitsCache.get(key);
    if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit.list;

    let list = [];
    try {
      const feed = `https://github.com/${owner}/${repo}/commits${ref === 'HEAD' ? '' : '/' + encodePath(ref)}.atom`;
      const res = await fetch(feed, { credentials: 'omit' });
      if (res.ok) list = parseCommitsAtom(await res.text());
    } catch (e) { /* try the API */ }
    if (!list.length) {
      const res = await this.ghApi(`repos/${owner}/${repo}/commits?per_page=20${ref === 'HEAD' ? '' : '&sha=' + encodeURIComponent(ref)}`);
      list = commitsFromApi(await res.json());
    }
    this._commitsCache.set(key, { ts: Date.now(), list });
    return list;
  }

  // Recent changes: the latest commits as a list in the thread. Each one can
  // be explained; "What's been happening?" summarizes them all.
  async showRecentChanges() {
    try {
      if (!(await this.ensureRepoTree())) { this.showNotification('Open a GitHub repository first'); return; }
    } catch (e) {
      this.showNotification(e.message);
      return;
    }
    const { owner, repo, ref } = this.repoTree;
    let commits;
    try {
      commits = await this.fetchRecentCommits();
    } catch (e) {
      this.showNotification("Couldn't load the commits: " + e.message);
      return;
    }
    if (!commits.length) { this.showNotification(`No commits found on ${this.refLabel(ref)}`); return; }
    this.openThread({ title: `${owner}/${repo}` });
    this.addThreadQuestion(`Recent changes on ${this.refLabel(ref)}`);
    const list = document.createElement('div');
    list.className = 'commit-list';
    list.innerHTML =
      `<button type="button" class="commit-summary" data-act="summarize">What's been happening?</button>` +
      commits.map(c =>
        `<button type="button" class="commit-row" data-sha="${this.escapeHtml(c.sha)}" title="Read this commit part by part">` +
          `<span class="commit-title">${this.escapeHtml(c.title)}</span>` +
          `<span class="commit-meta"><code>${this.escapeHtml(c.sha.slice(0, 7))}</code> ` +
          `${this.escapeHtml(c.author)}${c.date ? ' · ' + this.escapeHtml(timeAgo(c.date)) : ''}</span>` +
        `</button>`).join('');
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="summarize"]')) {
        const lines = commits.map(c => `- ${c.sha.slice(0, 7)} ${c.date ? c.date.slice(0, 10) : ''} ${c.author}: ${c.title}`).join('\n');
        this._readingContext = { label: `${owner}/${repo}`, ts: Date.now() };
        this.askInThread({
          title: `${owner}/${repo}`, sub: 'Recent changes', label: `What's been happening? (${commits.length} commits)`,
          prompt: `Here are the latest ${commits.length} commits on ${this.refLabel(ref)} of ${owner}/${repo}:\n\n${lines}\n\n` +
            'Explain what the project has been working on lately: group related commits into themes, say what each theme ' +
            'means for the code or users, and point out any commit worth reading closely to learn from (and why).'
        });
        return;
      }
      const sha = e.target.closest('[data-sha]')?.dataset.sha;
      if (sha) this.walkChange({ owner, repo, kind: 'commit', sha, title: commits.find(c => c.sha === sha)?.title || '' });
    });
    this.threadBody.appendChild(list);
  }

  async fetchRepoFilesMany(paths) {
    const out = new Array(paths.length);
    let next = 0;
    const worker = async () => {
      while (next < paths.length) {
        const i = next++;
        try {
          out[i] = { path: paths[i], content: await this.readRepoFile(paths[i], 2000000) };
        } catch (e) {
          out[i] = { path: paths[i], error: e.message };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));
    return out;
  }

  async sendRepoFiles(paths, mode = 'explain', lines = null) {
    if (!this.repoTree || !paths.length) return;
    // One file, line by line: the guided walkthrough
    if (mode === 'lines' && paths.length === 1) return this.startWalk(paths[0], lines);
    if (this._sendingFiles) return;
    this._sendingFiles = true;
    const { repo } = this.repoTree;
    const repoName = this.repoDisplayName();
    this.showNotification(`📄 Reading ${paths.length === 1 ? paths[0].split('/').pop() : paths.length + ' files'}…`);

    try {
      let files = await this.fetchRepoFilesMany(paths);
      const failed = files.filter(f => f.error);
      files = files.filter(f => !f.error);
      if (!files.length) throw new Error(failed[0]?.error || 'could not read the files');

      if (lines && files.length === 1) {
        files[0] = { ...files[0], content: sliceLines(files[0].content, lines.start, lines.end), lines };
      }

      const single = files.length === 1 ? files[0] : null;
      const what = single
        ? (single.lines ? `lines ${single.lines.start}-${single.lines.end} of \`${single.path}\`` : `\`${single.path}\``)
        : `these ${files.length} files`;
      let question = readingPrompt(mode, { what, repo: repoName }, this._promptEdits);
      const t = this.repoTree;
      const packProject = t && { owner: t.owner, repo: t.repo, local: t.source === 'local' };
      const brief = question && t ? await this.projectBriefFor(packProject) : '';
      if (brief) question = `${brief}\n\n${question}`;
      if (question) question += `\n\n${NEED_RULE}`;
      const totalChars = files.reduce((n, f) => n + f.content.length, 0);

      const modeLabel = READ_MODES.find(m => m.id === mode)?.label || 'Explain';
      const names = files.map(f => f.path.split('/').pop());
      const label = `${modeLabel}: ${names.length > 3 ? names.slice(0, 3).join(', ') + ` +${names.length - 3}` : names.join(', ')}`;
      if (!question) {
        // "Just add": attach to the message you're writing
        const fname = single ? single.path.split('/').pop() + '.md' : `${repo}-${files.length}-files.md`.replace(/[^\w.-]+/g, '-');
        this.addComposerItem({
          kind: 'files',
          label: single ? single.path.split('/').pop() + (single.lines ? ` L${single.lines.start}-${single.lines.end}` : '')
            : files.length <= 3 ? files.map(f => f.path.split('/').pop()).join(', ') : `${files.length} files`,
          title: files.map(f => f.path).join('\n'), filename: fname, content: this.packFor(files),
          what: single ? what : `${files.length} files from ${repoName} (${files.map(f => f.path).join(', ')}) with a map of the repository`,
          repo: repoName
        });
        this.threadInput?.focus();
      } else if (single && single.content.length <= 4000) {
        // Small single file: inline, so the code is visible in the chat
        const block = `\`${single.path}\`${single.lines ? ` (lines ${single.lines.start}-${single.lines.end})` : ''} from ${repoName}. ` +
          `${LINE_NUMBER_NOTE}\n\n${fencedFile(single)}`;
        this.askInThread({ title: modeLabel, sub: repoName, label, prompt: `${block}\n\n${question}`, project: packProject });
      } else {
        // Several (or big) files: ONE attachment with a repo map, then the question
        const fname = single
          ? single.path.split('/').pop() + '.md'
          : `${repo}-${files.length}-files.md`.replace(/[^\w.-]+/g, '-');
        question = `The attached "${fname}" contains ${single ? what : `${files.length} files from ${repoName}`}` +
          `${single ? '' : ` (${files.map(f => f.path).join(', ')})`}, starting with a map of the repository.\n\n${question}`;
        this.askInThread({ title: modeLabel, sub: repoName, label, prompt: question,
          attachments: [{ filename: fname, content: this.packFor(files) }], project: packProject });
      }

      await this.markRead(files.map(f => f.path));
      this._readingContext = { label: repoName, ts: Date.now() };
      const size = `~${formatCount(estimateTokens(totalChars))} tokens`;
      this.showNotification(failed.length
        ? `⚠️ Sent ${files.length}, skipped ${failed.length} (${failed[0].error})`
        : `📎 ${question ? 'Sent' : 'Attached'} ${files.length === 1 ? files[0].path.split('/').pop() : files.length + ' files'} (${size})`);
    } catch (e) {
      this.showNotification('⚠️ Could not read: ' + e.message);
    } finally {
      this._sendingFiles = false;
      }
  }

  // The reader's files as one Markdown pack (with the repository map)
  packFor(files) {
    const { owner, repo, ref, source } = this.repoTree;
    return buildPack({ owner, repo, ref: source === 'local' ? '' : this.refLabel(ref), files, treePaths: [...this.repoTree.fileSet] });
  }
}
