// Minimal, safe Markdown → HTML for AI answers shown inside Yavar.
//
// Everything is HTML-escaped first; only a known set of constructs is turned
// into markup (headings, lists and checklists, tables, quotes, code with
// light syntax colouring, emphasis, http(s) links), so text from the chat
// can never inject script or attributes.
// Returns { html, code: [{ lang, code }] }; each code block's toolbar carries
// data-code-index pointing into `code`.

const RUNNABLE = { python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript' };

export const runnableLang = (lang) => RUNNABLE[String(lang || '').toLowerCase()] || null;

// Code blocks longer than this start folded
export const FOLD_LINES = 24;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---- Syntax colouring ----
// One regex pass over the raw code: comments, strings, numbers and the
// language family's keywords become spans; everything else is escaped text.
// Enough to make code readable in a sidebar, not a full parser.
const KEYWORDS = {
  c: 'if else for while do return function const let var class new this import from export default async await try catch finally throw switch case break continue typeof instanceof in of null undefined true false void yield extends super static public private protected interface type enum implements package struct fn pub impl mut use mod match loop where trait self Self int float double char bool string long short unsigned go func defer chan select range map nil',
  py: 'def return if elif else for while in not and or is import from as class try except finally raise with lambda yield pass break continue global nonlocal None True False async await self print assert del',
  sh: 'if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk sudo npm npx node git pip python curl',
  sql: 'select from where join left right inner outer on group by order having limit insert into values update set delete create table index view drop alter and or not null is as distinct count sum avg min max case when then else end union all'
};
const FAMILY = {
  python: 'py', py: 'py', python3: 'py',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  sql: 'sql', postgres: 'sql', mysql: 'sql', sqlite: 'sql'
};
const kwCache = new Map();

// A language's keyword family: its keywords and how a line comment starts.
// Shared by highlight() and the code boxes' editor mode, so both colour the
// same words.
export function keywordInfo(lang) {
  const fam = FAMILY[String(lang || '').toLowerCase()] || 'c';
  if (!kwCache.has(fam)) kwCache.set(fam, new Set(KEYWORDS[fam].split(' ')));
  return { fam, keywords: kwCache.get(fam), lineComment: fam === 'py' || fam === 'sh' ? '#' : fam === 'sql' ? '--' : '//' };
}

export function highlight(code, lang) {
  const l = String(lang || '').toLowerCase();
  if (/^(text|txt|plain|plaintext|output|markdown|md)?$/.test(l) && l !== '') return esc(code);
  const { fam, keywords: kws, lineComment } = keywordInfo(l);
  const re = new RegExp([
    lineComment === '#' ? '(#[^\\n]*)' : lineComment === '--' ? '(--[^\\n]*)' : '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)',
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '([A-Za-z_$][\\w$]*)'
  ].join('|'), 'g');
  let out = '';
  let last = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    out += esc(code.slice(last, m.index));
    const [tok, comment, str, num, word] = m;
    if (comment) out += `<span class="tok-c">${esc(comment)}</span>`;
    else if (str) out += `<span class="tok-s">${esc(str)}</span>`;
    else if (num) out += `<span class="tok-n">${num}</span>`;
    else if (kws.has(fam === 'sql' ? word.toLowerCase() : word)) out += `<span class="tok-k">${word}</span>`;
    else out += esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last));
}

// Inline formatting on already-escaped text. Inline code is cut out first so
// its contents stay literal; so are links, so a bare URL inside one isn't
// linked twice.
function inline(text) {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = text
    .replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g, (_, pre, u) => pre + hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}

// A checklist item ("[ ] …" / "[x] …") shows a tick box
function listItem(text) {
  const task = text.match(/^\[([ xX])\]\s+(.*)$/);
  if (!task) return inline(text);
  const done = task[1] !== ' ';
  return `<span class="md-task${done ? ' is-done' : ''}" aria-hidden="true"></span>` +
    `<span class="md-task-text">${inline(task[2])}</span>`;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

// ChatGPT's citation markers leak into copied text as
// ":contentReference[oaicite:0]{index=0}"; they mean nothing outside its page.
export const stripChatArtifacts = (text) => String(text || '').replace(/:?contentReference\[oaicite:\d+\]\{index=\d+\}/g, '');

export function renderMarkdown(md) {
  const code = [];
  const lines = esc(stripChatArtifacts(md).replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let para = [];
  // Open lists, outermost first: { type, indent, items: [html] }
  let lists = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
    para = [];
  };
  const closeList = () => {
    const l = lists.pop();
    const html = `<${l.type}${l.task ? ' class="md-tasks"' : ''}>${l.items.map(i => `<li>${i}</li>`).join('')}</${l.type}>`;
    if (lists.length) {
      const parent = lists[lists.length - 1];
      parent.items[parent.items.length - 1] += html;
    } else {
      out.push(html);
    }
  };
  const flushLists = () => { while (lists.length) closeList(); };
  const flush = () => { flushPara(); flushLists(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block (``` or ~~~)
    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + fence[1] + '\\s*$').test(lines[i])) body.push(lines[i++]);
      const lang = fence[2].toLowerCase();
      // Store the raw (unescaped) code for Copy / Run
      const raw = unesc(body.join('\n'));
      const idx = code.push({ lang, code: raw }) - 1;
      const run = runnableLang(lang)
        ? `<button type="button" data-md-act="run">▶ Run</button><button type="button" data-md-act="use">Use in editor</button>` : '';
      const n = body.length;
      const fold = n > FOLD_LINES
        ? `<button type="button" class="md-code-more" data-md-act="unfold">Show all ${n} lines</button>` : '';
      out.push(`<div class="md-code${fold ? ' is-folded' : ''}" data-code-index="${idx}"><div class="md-code-bar"><span>${esc(lang) || 'code'}</span>` +
        `<button type="button" data-md-act="copy">Copy</button>${run}</div><pre><code>${highlight(raw, lang)}</code></pre>${fold}</div>`);
      continue;
    }

    // Table: a header row, a --- separator row, then body rows
    if (/^\s*\|?.+\|.+/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      const rows = [];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--;
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c || '')}</${tag}>`;
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);   // keep headings modest in a sidebar
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const item = line.match(/^(\s*)(?:([-*+])|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const indent = item[1].length;
      const type = item[2] ? 'ul' : 'ol';
      // Deeper than the open list: a sublist of its last item; shallower: close lists
      while (lists.length && indent < lists[lists.length - 1].indent) closeList();
      let top = lists[lists.length - 1];
      if (top && indent === top.indent && top.type !== type) { closeList(); top = lists[lists.length - 1]; }
      if (!top || indent > top.indent) {
        lists.push({ type, indent, items: [] });
        top = lists[lists.length - 1];
      }
      if (/^\[[ xX]\]\s/.test(item[3])) top.task = true;
      top.items.push(listItem(item[3]));
      continue;
    }

    const quote = line.match(/^\s*&gt;\s?(.*)$/);
    if (quote) {
      flush();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    if (!line.trim()) { flush(); continue; }

    // A continuation line indented under a list item joins that item
    if (lists.length && /^\s{2,}\S/.test(line)) {
      const top = lists[lists.length - 1];
      top.items[top.items.length - 1] += ' ' + inline(line.trim());
      continue;
    }

    flushLists();
    para.push(line);
  }
  flush();
  return { html: out.join('\n'), code };
}
