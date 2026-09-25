// Minimal, safe Markdown → HTML for AI answers shown inside Yavar.
//
// Everything is HTML-escaped first; only a known set of constructs is turned
// into markup (headings, lists, quotes, code, emphasis, http(s) links), so
// text from the chat can never inject script or attributes.
// Returns { html, code: [{ lang, code }] }; each code block's toolbar carries
// data-code-index pointing into `code`.

const RUNNABLE = { python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript' };

export const runnableLang = (lang) => RUNNABLE[String(lang || '').toLowerCase()] || null;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Inline formatting on already-escaped text. Inline code is cut out first so
// its contents stay literal.
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function renderMarkdown(md) {
  const code = [];
  const lines = esc(String(md || '').replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let para = [];
  let list = null;   // { type: 'ul' | 'ol', items: [] }

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

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
      const raw = body.join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      const idx = code.push({ lang, code: raw }) - 1;
      const run = runnableLang(lang)
        ? `<button type="button" data-md-act="run">▶ Run</button><button type="button" data-md-act="use">Use in editor</button>` : '';
      out.push(`<div class="md-code" data-code-index="${idx}"><div class="md-code-bar"><span>${esc(lang) || 'code'}</span>` +
        `<button type="button" data-md-act="copy">Copy</button>${run}</div><pre><code>${body.join('\n')}</code></pre></div>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);   // keep headings modest in a sidebar
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet || numbered)[1]);
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
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }

    flushList();
    para.push(line);
  }
  flush();
  return { html: out.join('\n'), code };
}
