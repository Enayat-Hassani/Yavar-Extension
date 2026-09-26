// The Yavar reader: one tab that shows the file Yavar is talking about, from
// a GitHub repository or a local folder, with line numbers and the lines under
// discussion highlighted. The side panel decides what it shows by writing
// `readerView` to chrome.storage.session; this page follows every change.
//
// readerView: { repo: { source, owner, repo, ref, name }, path, content,
//               lines: { start, end } | null, label, ts }

import { highlight } from './utils/markdown.js';
import { langFromPath, blobUrl } from './utils/github.js';

const $ = (id) => document.getElementById(id);
let shown = '';   // which file the code area holds, so a new range doesn't redraw it

function render(view) {
  const has = !!view?.path;
  $('rd-empty').hidden = has;
  $('rd-code').hidden = !has;
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
  place(lines);
}

// Draw the highlight behind the lines and bring them into view
function place(lines) {
  const band = $('rd-band');
  if (!lines) { band.hidden = true; return; }
  const pre = $('rd-src').querySelector('pre');
  const style = getComputedStyle(pre);
  const lh = parseFloat(style.lineHeight);
  const top = parseFloat(style.paddingTop) + (lines.start - 1) * lh;
  const height = (lines.end - lines.start + 1) * lh;
  band.hidden = false;
  band.style.top = `${top}px`;
  band.style.height = `${height}px`;
  band.classList.remove('is-new');
  void band.offsetWidth;   // restart the arrival pulse
  band.classList.add('is-new');

  // The block's top sits a quarter of the way down; a tall block starts at the top
  const main = $('rd-main');
  const codeTop = $('rd-code').offsetTop;
  const room = main.clientHeight;
  const target = codeTop + top - (height < room * 0.7 ? room * 0.25 : 16);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' });
}

chrome.storage.session.get('readerView').then(({ readerView }) => render(readerView));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.readerView) render(changes.readerView.newValue);
});
