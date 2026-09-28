// What the AI is told about the project a question is on: its brief, its file
// list, the files a question needs from the start, and the files an answer
// asks for, with a line saying what Yavar is doing while it gathers them.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { projectBrief } from '../utils/journey.js';
import { isReadablePath, isSecretPath, outlineTree, NEED_RULE, neededFiles, extractImports, resolveImports } from '../utils/github.js';

export class ContextPart {
  // The brief sent with every question on a project's code (projectBrief):
  // { owner, repo } on GitHub, { repo, local: true } for a folder. Cached per
  // project; a new reading map replaces it.
  async projectBriefFor({ owner = '', repo, local = false }) {
    const id = local ? `local/${repo}` : `${owner}/${repo}`;
    this._briefs = this._briefs || {};
    if (id in this._briefs) return this._briefs[id];
    let journey = null;
    try { journey = (await chrome.storage.local.get(`journey:${id}`))[`journey:${id}`] || null; } catch (e) { /* none */ }
    let readme = '';
    if (!journey?.summary) {
      try {
        const t = this.repoTree;
        if (local) {
          const path = t?.source === 'local' && t.repo === repo && [...(this.localFiles?.keys() || [])].find(p => /^readme(\.md|\.txt)?$/i.test(p));
          if (path) readme = await this.readRepoFile(path);
        } else {
          readme = await this.fetchFileAt(owner, repo, 'HEAD', 'README.md');
        }
      } catch (e) { /* no README: no brief */ }
    }
    return (this._briefs[id] = projectBrief(journey, readme));
  }

  // The loaded file tree when it is this project's, else null
  treeFor({ owner = '', repo } = {}) {
    const t = this.repoTree;
    return t && t.repo === repo && (t.owner || '') === (owner || '') ? t : null;
  }

  // The project's file list and the NEED rule, so the AI can ask for the
  // files it needs (answerWithFiles sends them). The list goes once per walk;
  // later questions carry the rule alone. '' without the project's tree.
  projectFiles(project, focus = [], { list = true } = {}) {
    const t = project && this.treeFor(project);
    if (!t) return '';
    const paths = [...t.fileSet].filter(isReadablePath);
    return (list ? `The project's files:\n\`\`\`\n${outlineTree(paths, focus, 150, true)}\n\`\`\`\n\n` : '') + NEED_RULE;
  }

  // A line in `container` saying what Yavar is doing for the AI while it
  // gathers files; say() changes it, done() takes it away
  workStatus(container, text) {
    const el = document.createElement('div');
    el.className = 'work-status';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="files-spinner" aria-hidden="true"></span><span></span>';
    const say = (t) => { el.lastChild.textContent = t; };
    say(text);
    container.appendChild(el);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return { say, done: () => el.remove() };
  }

  // The files a walk question needs from the start: for a change, the whole
  // file its part is in; for both, the project files that file imports. Each
  // goes once per walk, within a budget. { attachment, note } or null.
  async walkContextFiles(container, w, b, project) {
    if (!project || !this.treeFor(project) || (w.change && !b.start)) return null;
    // A change walk is known by its key, a file walk by its path
    const id = w.key || w.path;
    if (this._sentFiles?.id !== id) this._sentFiles = { id, paths: new Set(w.change ? [] : [w.path]) };
    const sent = this._sentFiles.paths;
    const path = w.change ? b.path : w.path;
    const name = path.split('/').pop();
    const status = this.workStatus(container, `Finding the files ${name} needs…`);
    try {
      const t = this.treeFor(project);
      // A change's file as it is after the change: on disk, or at its commit
      const c = w.change;
      const content = c && !c.local ? await this.fetchFileAt(c.owner, c.repo, c.ref, path) : await this.readRepoFile(path);
      const imports = resolveImports(extractImports(content, path), path, t.fileSet)
        .filter(p => p !== path && !sent.has(p) && isReadablePath(p) && !isSecretPath(p));
      const files = [];
      let size = 0;
      if (c && !sent.has(path)) { files.push({ path, content }); size += content.length; }
      if (imports.length) status.say(`Adding ${[name, ...imports.map(p => p.split('/').pop())].join(', ')}…`);
      for (const f of (await this.fetchRepoFilesMany(imports)).filter(f => !f.error)) {
        if (size + f.content.length > 60000) break;
        files.push(f);
        size += f.content.length;
      }
      if (!files.length) return null;
      files.forEach(f => sent.add(f.path));
      const deps = files.filter(f => f.path !== path);
      const what = [files.some(f => f.path === path) ? `the whole of \`${path}\` as it is after the change` : '',
        deps.length ? `the project files ${c ? 'it' : `\`${path}\``} imports (${deps.map(f => `\`${f.path}\``).join(', ')})` : ''].filter(Boolean).join(', and ');
      return { attachment: { filename: 'context-files.md', content: this.packFor(files) }, note: `Also attached, "context-files.md": ${what}.` };
    } catch (e) {
      return null;   // the question still goes, without the extra files
    } finally {
      status.done();
    }
  }

  // An answer that ends with NEED lines gets those files, once, in the same
  // chat, and gives its full answer; that answer is the one kept. Files sent
  // already (`sent`) aren't sent again.
  async answerWithFiles(container, label, text, project, sent = null) {
    const t = text && project && this.treeFor(project);
    const paths = t ? neededFiles(text, t.fileSet).filter(p => !sent?.has(p)) : [];
    if (!paths.length) return text;
    const status = this.workStatus(container, `The AI asked for ${paths.map(p => p.split('/').pop()).join(', ')}: reading ${paths.length === 1 ? 'it' : 'them'}…`);
    let files;
    try {
      files = (await this.fetchRepoFilesMany(paths)).filter(f => !f.error);
    } finally {
      status.done();
    }
    if (!files.length) return text;
    files.forEach(f => sent?.add(f.path));
    const one = files.length === 1 && files[0].path.split('/').pop();
    const fname = one ? (one.endsWith('.md') ? one : `${one}.md`) : 'requested-files.md';
    const more = await this.showAnswerIn(container, `${label} · with ${files.map(f => f.path.split('/').pop()).join(', ')}`,
      `Here ${files.length === 1 ? 'is the file' : 'are the files'} you asked for, attached as "${fname}". ` +
      `Now give your full answer to my last question, in the same shape as before, without asking for more files.`,
      { via: 'chat', inline: true, attachments: [{ filename: fname, content: this.packFor(files) }] });
    return more || text;
  }

  // The project the open walk or tree is in, for projectBriefFor
  walkProject() {
    const c = this.walk?.change;
    if (c) return { owner: c.owner, repo: c.repo, local: !!c.local };
    const t = this.repoTree;
    return t ? { owner: t.owner, repo: t.repo, local: t.source === 'local' } : null;
  }
}
