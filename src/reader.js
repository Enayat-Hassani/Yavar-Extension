// The Yavar reader: one tab that shows the file Yavar is talking about, from
// a GitHub repository or a local folder, with line numbers and the lines under
// discussion highlighted. The side panel decides what it shows by writing
// `readerView` to chrome.storage.session; this page follows every change.
//
// readerView: { repo: { source, owner, repo, ref, name }, path, content,
//               lines: { start, end } | null, label, walkKey, ts }
//
// A local file can be edited here and saved back to its folder. Saving moves
// the lines after the edit, so the file's walk, the highlighted lines and the
// panel's cached copy are brought up to date (afterSave).

import { highlight } from './utils/markdown.js';
import { langFromPath, blobUrl } from './utils/github.js';
import { cmModeFor, defineGenericMode, closeBracketKeys } from './utils/codeEditor.js';
import { editedLines, shiftRange, shiftWalk } from './utils/walkthrough.js';
import { idbGet } from './utils/idb.js';

const $ = (id) => document.getElementById(id);
let shown = '';        // which file the code area holds, so a new range doesn't redraw it
let current = null;    // the view the panel last asked for
let editing = null;    // { view, handle, text, modified, cm, clean, saving } while editing

// `top`: the line to scroll to instead of the highlighted lines (leaving the editor)
function render(view, { top = null } = {}) {
  current = view;
  if (editing) return;   // the editor stays; the latest view shows when you're done
  const has = !!view?.path;
  $('rd-empty').hidden = has;
  $('rd-code').hidden = !has;
  $('rd-edit').hidden = true;
  if (!has) return;

  const { repo, path, content, lines, label } = view;
  const name = path.split('/').pop();
  document.title = `${name} · ${repo.name}`;
  $('rd-repo').textContent = repo.name;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  $('rd-path').replaceChildren(document.createTextNode(dir), Object.assign(document.createElement('strong'), { textContent: name }));
  $('rd-label').hidden = !label;
  $('rd-label').textContent = label || '';
  const gh = $('rd-github');
  gh.hidden = repo.source === 'local';
  if (!gh.hidden) gh.href = blobUrl(repo.owner, repo.repo, repo.ref, path, lines);

  const key = `${repo.source}:${repo.name}@${repo.ref}:${path}:${content.length}`;
  if (key !== shown) {
    shown = key;
    const text = content.replace(/\n$/, '');
    const count = text.split('\n').length;
    $('rd-gutter').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    $('rd-text').innerHTML = highlight(text, langFromPath(path));
  }
  place(lines, top == null);
  if (top != null) $('rd-main').scrollTop = lineTop(top);
  offerEdit(view);
}

// Where line `n` (0-based) starts in the scrolling area, and the reverse
function lineHeight() { return parseFloat(getComputedStyle($('rd-src').querySelector('pre')).lineHeight); }
function codePad() { return parseFloat(getComputedStyle($('rd-src').querySelector('pre')).paddingTop); }
function lineTop(n) { return $('rd-code').offsetTop + codePad() + n * lineHeight(); }
function topLine() { return Math.max(0, Math.floor(($('rd-main').scrollTop - $('rd-code').offsetTop - codePad()) / lineHeight())); }

// Draw the highlight behind the lines and, unless `scroll` is false, bring them into view
function place(lines, scroll = true) {
  const band = $('rd-band');
  if (!lines) { band.hidden = true; return; }
  const lh = lineHeight();
  const top = codePad() + (lines.start - 1) * lh;
  const height = (lines.end - lines.start + 1) * lh;
  band.hidden = false;
  band.style.top = `${top}px`;
  band.style.height = `${height}px`;
  band.classList.remove('is-new');
  void band.offsetWidth;   // restart the arrival pulse
  band.classList.add('is-new');
  if (!scroll) return;

  // The block's top sits a quarter of the way down; a tall block starts at the top
  const main = $('rd-main');
  const codeTop = $('rd-code').offsetTop;
  const room = main.clientHeight;
  const target = codeTop + top - (height < room * 0.7 ? room * 0.25 : 16);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' });
}

// ----- Editing a local file -----

// The folder a local file came from: the one last opened, or one of the
// recent folders, matched by name (handles are kept in IndexedDB by the panel)
async function folderFor(name) {
  const last = await idbGet('lastFolder');
  if (last?.name === name) return last;
  return ((await idbGet('recentFolders')) || []).find(r => r.name === name)?.handle || null;
}

async function fileIn(dir, path) {
  const parts = path.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return dir.getFileHandle(parts.at(-1));
}

// Edit shows only for a file of a folder Yavar still has a handle for; a
// folder read without the folder picker can't be written back
async function offerEdit(view) {
  if (view.repo.source !== 'local' || !window.FileSystemFileHandle?.prototype.createWritable) return;
  const dir = await folderFor(view.repo.repo);
  if (view === current && !editing) $('rd-edit').hidden = !dir;
}

// The editor starts from the file on disk, not the panel's copy, which can be
// cut short or older than the file
async function startEdit() {
  const view = current;
  const name = view.path.split('/').pop();
  try {
    const dir = await folderFor(view.repo.repo);
    if (!dir) throw new Error(`${view.repo.repo} is no longer in Yavar's recent folders; open it again from the panel`);
    if (await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(`Chrome didn't allow changes to ${view.repo.repo}`);
    const handle = await fileIn(dir, view.path);
    const file = await handle.getFile();
    if (file.size > 5 * 1024 * 1024) throw new Error('it is over 5 MB');
    openEditor({ view, handle, text: await file.text(), modified: file.lastModified });
  } catch (e) {
    say(`Couldn't edit ${name}: ${e.message}`, true);
  }
}

function openEditor(state) {
  const top = topLine();
  defineGenericMode(CodeMirror);
  const host = $('rd-editor');
  host.replaceChildren();
  host.hidden = false;
  $('rd-code').hidden = true;
  const cm = CodeMirror(host, {
    value: state.text, mode: cmModeFor(langFromPath(state.view.path)), theme: 'yavar', lineNumbers: true,
    lineWrapping: false, tabSize: 4, indentUnit: 4, indentWithTabs: false,
    extraKeys: { Tab: (ed) => ed.somethingSelected() ? ed.indentSelection('add') : ed.replaceSelection(' '.repeat(ed.getOption('indentUnit'))) }
  });
  cm.addKeyMap(closeBracketKeys(CodeMirror));
  editing = { ...state, cm, clean: cm.changeGeneration(), saving: false };
  const lines = current?.lines;
  if (lines) for (let n = lines.start - 1; n < Math.min(lines.end, cm.lineCount()); n++) cm.addLineClass(n, 'background', 'rd-edit-band');
  cm.on('changes', buttons);
  buttons();
  // The same code stays in view, with the cursor at the highlighted lines
  cm.refresh();
  cm.scrollTo(null, cm.heightAtLine(top, 'local'));
  cm.setCursor({ line: lines ? lines.start - 1 : top, ch: 0 }, null, { scroll: false });
  cm.focus();
}

// Done leaves the editor when nothing is unsaved; with changes it's Cancel,
// next to Save
function buttons() {
  const dirty = !!editing && !editing.cm.isClean(editing.clean);
  $('rd-edit').hidden = true;
  $('rd-done').hidden = !editing;
  $('rd-done').textContent = dirty ? 'Cancel' : 'Done';
  $('rd-save').hidden = !dirty;
  document.title = `${dirty ? '• ' : ''}${document.title.replace(/^• /, '')}`;
}

function stopEdit() {
  const e = editing;
  if (!e) return;
  if (!e.cm.isClean(e.clean) && !confirm(`Discard your changes to ${e.view.path.split('/').pop()}?`)) return;
  const top = e.cm.lineAtHeight(e.cm.getScrollInfo().top, 'local');
  editing = null;
  $('rd-editor').hidden = true;
  $('rd-editor').replaceChildren();
  $('rd-done').hidden = true;
  $('rd-save').hidden = true;
  document.title = document.title.replace(/^• /, '');
  shown = '';
  render(current, { top });
}

// Write the file, unless it changed on disk since the editor opened it and
// you'd rather keep that version. `close` leaves the editor afterwards (Save);
// ⌘S / Ctrl+S keeps it open.
async function save(close) {
  const e = editing;
  if (!e || e.saving) return;
  const name = e.view.path.split('/').pop();
  const text = e.cm.getValue();
  const gen = e.cm.changeGeneration();
  if (text === e.text) {   // changed and changed back
    e.clean = gen;
    close ? stopEdit() : buttons();
    return;
  }
  e.saving = true;
  try {
    const onDisk = await e.handle.getFile();
    if (onDisk.lastModified !== e.modified &&
        !confirm(`${name} changed on disk after you started editing, maybe in another editor. Replace it with your version?`)) return;
    const out = await e.handle.createWritable();
    await out.write(text);
    await out.close();
    e.modified = (await e.handle.getFile()).lastModified;
    const edit = editedLines(e.text, text);
    e.text = text;
    e.clean = gen;
    await afterSave(e.view, edit, text);
    say(`Saved ${name}`);
    close ? stopEdit() : buttons();
  } catch (err) {
    say(`Couldn't save ${name}: ${err.message}`, true);
  } finally {
    e.saving = false;
  }
}

// Everything else that holds this file's lines: its walk (moved here, so it
// is right even with the panel closed), what the reader shows, and the
// panel's cached copy and open walk (fileEdited tells it)
async function afterSave(view, edit, text) {
  if (view.walkKey) {
    const walk = (await chrome.storage.local.get(view.walkKey))[view.walkKey];
    if (walk?.blocks) await chrome.storage.local.set({ [view.walkKey]: shiftWalk(walk, edit) });
  }
  const { readerView: now } = await chrome.storage.session.get('readerView');
  if (now?.path === view.path && now.repo?.source === 'local' && now.repo.repo === view.repo.repo) {
    const lines = now.lines && shiftRange(now.lines, edit);
    // Kept here too: leaving the editor can come before the storage change does
    current = { ...now, content: text, lines: lines && { start: lines.start, end: lines.end }, ts: Date.now() };
    await chrome.storage.session.set({ readerView: current });
  }
  await chrome.storage.session.set({ fileEdited: { repo: view.repo.repo, path: view.path, ts: Date.now() } });
}

let sayTimer = 0;
function say(text, isError = false) {
  const el = $('rd-status');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
  clearTimeout(sayTimer);
  if (!isError) sayTimer = setTimeout(() => { el.textContent = ''; }, 3000);
}

$('rd-edit').addEventListener('click', () => { say(''); startEdit(); });
$('rd-done').addEventListener('click', stopEdit);
$('rd-save').addEventListener('click', () => save(true));
document.addEventListener('keydown', (e) => {
  if (!editing) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
  else if (e.key === 'Escape' && editing.cm.isClean(editing.clean)) stopEdit();
});
window.addEventListener('beforeunload', (e) => {
  if (editing && !editing.cm.isClean(editing.clean)) e.preventDefault();
});

chrome.storage.session.get('readerView').then(({ readerView }) => render(readerView));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.readerView) render(changes.readerView.newValue);
});
