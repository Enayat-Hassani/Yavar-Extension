// What the AI is told about the project a question is on: its brief, its file
// list, and the files an answer asks for.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { projectBrief } from '../utils/journey.js';
import { isReadablePath, outlineTree, NEED_RULE, neededFiles } from '../utils/github.js';

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

  // An answer that ends with NEED lines gets those files, once, in the same
  // chat, and gives its full answer; that answer is the one kept
  async answerWithFiles(container, label, text, project) {
    const t = text && project && this.treeFor(project);
    const paths = t ? neededFiles(text, t.fileSet) : [];
    if (!paths.length) return text;
    const files = (await this.fetchRepoFilesMany(paths)).filter(f => !f.error);
    if (!files.length) return text;
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
