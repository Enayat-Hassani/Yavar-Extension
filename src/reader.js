// The Yavar reader: one tab that shows the file Yavar is talking about, from
// a GitHub repository or a local folder, with line numbers and the lines under
// discussion highlighted. The side panel decides what it shows by writing
// `readerView` to chrome.storage.session; this page follows every change.
//
// readerView: { repo: { source, owner, repo, ref, name }, path, content,
//               lines: { start, end } | null, label, walkKey, ts,
//               diff: { add, del, part? } | null, focus, nav: { prev, next } | null,
//               walk: { id, block } | null }
//
// With `diff` (a part of a commit or pull request), the file is shown as it is
// after the change, with the removed lines put back in red where they were and
// the added lines in green; the part is the band around them, or with
// `focus` the lines an explanation named. `nav` shows ‹ › to step the walk,
// which the panel follows through `readerNav`. `walk` names the walk the
// highlight belongs to (its storage key) and its block: a small sign beside
// the highlight, and ‹ ›, open the panel on that walk, even after the panel
// was closed or moved on to something else.
//
// Wrap folds long lines onto the rows under them, which have no number of
// their own, so line numbers (and Yavar's path:12-15) stay the same. A
// Markdown file can be shown rendered (Preview). Both are remembered.
//
// A local file can be edited here and saved back to its folder. Saving moves
// the lines after the edit, so the file's walk, the highlighted lines and the
// panel's cached copy are brought up to date (afterSave).
// Changed in another editor, the file is shown again and the same follows
// (checkDisk).

import { highlightLines, renderMarkdown } from './utils/markdown.js';
import { langFromPath, blobUrl } from './utils/github.js';
import { cmModeFor, defineGenericMode, closeBracketKeys } from './utils/codeEditor.js';
import { editedLines, shiftRange, shiftWalk, textSha } from './utils/walkthrough.js';
import { diffRows } from './utils/changes.js';
import { idbGet } from './utils/idb.js';
import { openPanel } from './utils/panel.js';

// This window, known up front: the panel must open within the click, before any await
let windowId;
chrome.windows.getCurrent().then(w => { windowId = w.id; }).catch(() => {});

const $ = (id) => document.getElementById(id);
let shown = '';        // which file the code area holds, so a new range doesn't redraw it
let shownBand = null;  // in a diff: the rows the part covers
let shownRows = [];    // in a diff: the rows, to find a line's row

// The rows of the part being read: its added lines and its removed ones (1-based)
function partRows(part) {
  if (!part) return null;
  const add = new Set(part.add);
  const del = new Set(part.del.map(d => d[1]));
  const at = shownRows.map((r, k) => (r.kind === 'add' && add.has(r.n)) || (r.kind === 'del' && del.has(r.old)) ? k : -1).filter(k => k >= 0);
  return at.length ? { start: at[0] + 1, end: at.at(-1) + 1 } : null;
}

// Lines of the file after the change as rows of the diff (1-based)
function rowsOf({ start, end }) {
  const a = shownRows.findIndex(r => r.n === start);
  const z = shownRows.findIndex(r => r.n === end);
  return a < 0 ? shownBand : { start: a + 1, end: (z < 0 ? a : z) + 1 };
}
let current = null;    // the view the panel last asked for
let placed = null;     // the rows the band was last drawn over

// Wrap and Preview, kept for the next time the reader opens
const prefs = (() => { try { return JSON.parse(localStorage.getItem('readerPrefs')) || {}; } catch (e) { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('readerPrefs', JSON.stringify(prefs)); } catch (e) { /* this session only */ } };
const isMarkdown = (path) => /\.(md|mdx|markdown)$/i.test(path || '');
const previewing = (view) => !!prefs.preview && isMarkdown(view?.path) && !view?.diff;
let editing = null;    // { view, handle, text, modified, cm, clean, saving } while editing

// `top`: the line to scroll to instead of the highlighted lines (leaving the editor)
function render(view, { top = null } = {}) {
  current = view;
  if (editing) return;   // the editor stays; the latest view shows when you're done
  const has = !!view?.path;
  const preview = has && previewing(view);
  $('rd-empty').hidden = has;
  $('rd-code').hidden = !has || preview;
  $('rd-md').hidden = !preview;
  $('rd-edit').hidden = true;
  $('rd-view').hidden = !has;
  $('rd-preview').hidden = !has || !isMarkdown(view.path) || !!view.diff;
  $('rd-preview').setAttribute('aria-pressed', String(preview));
  $('rd-wrap').hidden = preview;
  if (!has) return;

  const { repo, path, content, lines, label } = view;
  const name = path.split('/').pop();
  document.title = `${name} · ${repo.name}`;
  $('rd-repo').textContent = repo.name;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  $('rd-path').replaceChildren(document.createTextNode(dir), Object.assign(document.createElement('strong'), { textContent: name }));
  $('rd-label').hidden = !label;
  $('rd-label').textContent = label || '';
  $('rd-nav').hidden = !label;
  $('rd-prev').hidden = $('rd-next').hidden = !view.nav;
  if (view.nav) { $('rd-prev').disabled = !view.nav.prev; $('rd-next').disabled = !view.nav.next; }
  const gh = $('rd-github');
  gh.hidden = repo.source === 'local';
  if (!gh.hidden) gh.href = blobUrl(repo.owner, repo.repo, repo.ref, path, lines);

  const { diff } = view;
  // The part marked is left out: moving between a file's changes only moves the band
  const key = `${repo.source}:${repo.name}@${repo.ref}:${path}:${content.length}:${diff ? JSON.stringify([diff.add, diff.del]) : ''}`;
  let band = lines;
  if (key !== shown) {
    shown = key;
    const text = content.replace(/\n$/, '');
    const file = text.split('\n');
    const marks = $('rd-marks');
    marks.replaceChildren();
    // One element a row, in the gutter and the code, so a wrapped row's
    // number keeps to its first line
    const draw = (numbers, code) => {
      $('rd-gutter').innerHTML = numbers.map(n => `<div>${n}</div>`).join('');
      $('rd-text').innerHTML = code.map(h => `<div class="rd-l">${h}</div>`).join('');
    };
    if (diff) {
      const rows = diffRows(file.length, diff.add, diff.del);
      draw(rows.map(r => r.kind === 'del' ? '<span class="rd-g-del">−</span>' : r.kind === 'add' ? `<span class="rd-g-add">${r.n}</span>` : r.n),
        highlightLines(rows.map(r => r.kind === 'del' ? r.text : file[r.n - 1]).join('\n'), langFromPath(path)));
      // One mark per run of added or removed rows, drawn behind the code
      rows.forEach((r, k) => {
        if (!r.kind) return;
        const last = marks.lastElementChild;
        if (last && last.dataset.kind === r.kind && Number(last.dataset.end) === k - 1) { last.dataset.end = k; return; }
        marks.append(Object.assign(document.createElement('div'), { className: `rd-mark is-${r.kind}` }));
        Object.assign(marks.lastElementChild.dataset, { kind: r.kind, start: k, end: k });
      });
      const marked = rows.map((r, k) => r.kind ? k : -1).filter(k => k >= 0);
      shownBand = marked.length ? { start: marked[0] + 1, end: marked.at(-1) + 1 } : null;
      shownRows = rows;
    } else {
      draw(file.map((_, i) => i + 1), highlightLines(text, langFromPath(path)));
      shownBand = null;
    }
    $('rd-md').innerHTML = isMarkdown(path) ? renderMarkdown(text, { headingShift: 0 }).html : '';
    $('rd-md').querySelectorAll('[data-md-act="use"]').forEach(b => b.remove());
    if (preview) $('rd-main').scrollTop = 0;
    syncGutter();
    drawMarks();
  }
  // In a diff the band is in rows, which the removed lines have moved
  if (diff) band = view.focus && lines ? rowsOf(lines) : partRows(diff.part) || shownBand || null;
  $('rd-band').classList.toggle('is-diff', !!diff);
  if (preview) {
    placed = band;
    $('rd-explain').hidden = true;
    // The highlight is in the source; say so rather than hide it silently
    if (lines) say(`${lines.end > lines.start ? `Lines ${lines.start}-${lines.end} are` : `Line ${lines.start} is`} highlighted in the source: turn Preview off to see them`);
  } else {
    place(band, top == null);
    if (top != null) $('rd-main').scrollTop = lineTop(top);
  }
  offerEdit(view);
}

// Where rows `start` to `end` (1-based) sit in the code, wrapped or not
function rowsBox(start, end) {
  const rows = $('rd-text').children;
  if (!rows.length) return { top: 0, height: 0 };
  const at = (n) => rows[Math.min(Math.max(n, 1), rows.length) - 1];
  const a = at(start);
  const z = at(Math.max(start, end));
  return { top: a.offsetTop, height: z.offsetTop + z.offsetHeight - a.offsetTop };
}
// Where row `n` (0-based) starts in the scrolling area, and the row at the top
function lineTop(n) { return $('rd-code').offsetTop + rowsBox(n + 1, n + 1).top; }
function topLine() {
  const rows = $('rd-text').children;
  const y = $('rd-main').scrollTop - $('rd-code').offsetTop;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].offsetTop <= y) lo = mid; else hi = mid - 1;
  }
  return Math.max(0, lo);
}

// Wrapped, each number's row is as tall as its line (read all, then write)
function syncGutter() {
  const wrap = document.body.classList.contains('is-wrap');
  const heights = wrap ? [...$('rd-text').children].map(r => r.offsetHeight) : [];
  [...$('rd-gutter').children].forEach((g, k) => { g.style.height = wrap ? `${heights[k]}px` : ''; });
}

// The added and removed runs, placed by row
function drawMarks() {
  for (const m of $('rd-marks').children) {
    const { top, height } = rowsBox(Number(m.dataset.start) + 1, Number(m.dataset.end) + 1);
    m.style.top = `${top}px`;
    m.style.height = `${height}px`;
  }
}

// The rows moved (wrapping turned on or off, a narrower window): everything
// drawn over them follows, without scrolling or the arrival pulse
function relayout() {
  if ($('rd-code').hidden) return;
  syncGutter();
  drawMarks();
  if (placed) place(placed, false, false);
}

// Draw the highlight behind the lines and, unless `scroll` is false, bring them into view
function place(lines, scroll = true, pulse = true) {
  const band = $('rd-band');
  placed = lines;
  if (!lines) { band.hidden = true; $('rd-explain').hidden = true; return; }
  const { top, height } = rowsBox(lines.start, lines.end);
  band.hidden = false;
  band.style.top = `${top}px`;
  band.style.height = `${height}px`;
  // Beside the highlight, the way back to what Yavar said about it
  const back = $('rd-explain');
  back.hidden = !current?.walk;
  back.style.top = `${top}px`;
  if (pulse) {
    band.classList.remove('is-new');
    void band.offsetWidth;   // restart the arrival pulse
    band.classList.add('is-new');
  }
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

// Edit shows only for a file of a folder Yavar still has a handle for, as
// it is on disk (not at a past commit); a folder read without the folder
// picker can't be written back
async function offerEdit(view) {
  if (view.repo.source !== 'local' || view.repo.ref || !window.FileSystemFileHandle?.prototype.createWritable) return;
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
  $('rd-md').hidden = true;
  $('rd-view').hidden = true;
  const cm = CodeMirror(host, {
    value: state.text, mode: cmModeFor(langFromPath(state.view.path)), theme: 'yavar', lineNumbers: true,
    lineWrapping: !!prefs.wrap, tabSize: 4, indentUnit: 4, indentWithTabs: false,
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
  $('rd-view').hidden = false;
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
    // Its lines moved with the edit, so it still matches the file: the file's new hash goes with it
    if (walk?.blocks) await chrome.storage.local.set({ [view.walkKey]: { ...shiftWalk(walk, edit), sha: await textSha(text) } });
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
function setWrap(on) {
  prefs.wrap = on;
  savePrefs();
  document.body.classList.toggle('is-wrap', on);
  $('rd-wrap').setAttribute('aria-pressed', String(on));
  // The same code stays at the top of the window
  const top = $('rd-code').hidden ? null : topLine();
  relayout();
  if (top != null) $('rd-main').scrollTop = lineTop(top);
}
setWrap(!!prefs.wrap);
$('rd-wrap').addEventListener('click', () => setWrap(!prefs.wrap));
$('rd-preview').addEventListener('click', () => {
  prefs.preview = !previewing(current);
  savePrefs();
  say('');
  render(current);
  relayout();
});
// Wrapped rows grow and shrink with the window
new ResizeObserver(() => { if (prefs.wrap) relayout(); }).observe($('rd-main'));
// A rendered code block's Copy, and Show all lines
$('rd-md').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-md-act]');
  if (!btn) return;
  const block = btn.closest('.md-code');
  if (btn.dataset.mdAct === 'unfold') { block.classList.remove('is-folded'); btn.remove(); return; }
  try { await navigator.clipboard.writeText(block.querySelector('code').textContent); say('Copied'); } catch (err) { /* not allowed */ }
});
// The walk steps in the panel, which follows readerNav (dir 0: show the
// highlighted block). The panel opens first, within the click: it may have
// been closed, and it reopens the walk this view belongs to.
const step = (dir) => {
  openPanel({ windowId });
  chrome.storage.session.set({ readerNav: { dir, walk: current?.walk || null, repo: current?.repo || null, ts: Date.now() } });
};
$('rd-explain').addEventListener('click', () => step(0));
$('rd-prev').addEventListener('click', () => step(-1));
$('rd-next').addEventListener('click', () => step(1));
document.addEventListener('keydown', (e) => {
  if (editing || !current?.nav || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea')) return;
  if ((e.key === 'ArrowLeft' || e.key === 'k') && current.nav.prev) { e.preventDefault(); step(-1); }
  if ((e.key === 'ArrowRight' || e.key === 'j') && current.nav.next) { e.preventDefault(); step(1); }
});
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

// ----- Following the file on disk -----

// A local file shown as it is on disk may be changed in another editor. The
// reader looks at its modified time every few seconds while the tab is
// showing, and as soon as you come back to it. A new version replaces the one
// shown and moves the walk's lines, as saving here does (afterSave), so the
// panel's next question sends the file as it is now.
let watched = null;    // { id, modified }: the file shown, as last seen on disk
let checking = false;
async function checkDisk() {
  const view = current;
  if (checking || editing || document.hidden || view?.repo?.source !== 'local' || view.repo.ref || view.diff) return;
  checking = true;
  try {
    const dir = await folderFor(view.repo.repo);
    if (!dir || await dir.queryPermission({ mode: 'read' }) !== 'granted') return;
    const file = await (await fileIn(dir, view.path)).getFile();
    const id = `${view.repo.repo}:${view.path}`;
    if (watched?.id === id && watched.modified === file.lastModified) return;
    watched = { id, modified: file.lastModified };
    if (file.size > 2000000) return;   // the panel only holds the start of it
    const text = await file.text();
    if (view !== current || editing || text === view.content) return;
    const top = $('rd-code').hidden ? null : topLine();
    await afterSave(view, editedLines(view.content, text), text);
    shown = '';
    render(current, { top });
    say(`${view.path.split('/').pop()} changed on disk: showing the new version`);
  } catch (e) {
    // moved, deleted or no longer allowed: the reader keeps what it shows
  } finally {
    checking = false;
  }
}
setInterval(checkDisk, 2000);
document.addEventListener('visibilitychange', checkDisk);
window.addEventListener('focus', checkDisk);

chrome.storage.session.get('readerView').then(({ readerView }) => { render(readerView); checkDisk(); });
chrome.storage.onChanged.addListener((changes, area) => {
  const view = changes.readerView?.newValue;
  // The view the reader wrote itself (afterSave) is already showing
  if (area !== 'session' || !changes.readerView || (view && view.ts === current?.ts && view.path === current?.path)) return;
  render(view);
  checkDisk();
});
