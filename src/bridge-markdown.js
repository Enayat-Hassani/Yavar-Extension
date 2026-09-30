// An answer on a chat site, as Markdown: the chat shows it rendered, and
// Yavar reads it back from the page. Loaded into the chat frames before
// ai-bridge.js (the same content-script world), which calls
// yavarAnswerMarkdown(el). Headings, lists (nested ones indented), code
// blocks, tables, quotes, rules and inline emphasis, links and code are
// kept; anything else gives its text.

(function () {
  'use strict';

  // Buttons, icons and source/citation chips (Gemini's "MD +1") aren't answer text
  const SKIP_TAGS = /^(button|svg|img|mat-icon|script|style|yavar-answer-bar|source-footnote|sources-carousel.*|source-inline-chip.*|.*citation.*)$/;
  const SKIP_CLASS = /\b(citation|source-chip|source-inline|sources-carousel|footnote|code-block-decoration)\b/i;

  // A table cell's text on one line, its pipes escaped
  const cell = (el) => nodeToMarkdown(el).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim();

  function nodeToMarkdown(el) {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (SKIP_TAGS.test(tag) || SKIP_CLASS.test(typeof node.className === 'string' ? node.className : '')) return;

      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        const codeText = (codeEl || node).innerText.replace(/\n+$/, '');
        let lang = '';
        if (codeEl) {
          const m = (codeEl.className || '').match(/language-([\w+-]+)/);
          if (m) lang = m[1];
        }
        out += `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
      } else if (/^h[1-6]$/.test(tag)) {
        out += `\n\n${'#'.repeat(Number(tag[1]))} ${node.innerText.trim()}\n\n`;
      } else if (tag === 'ul' || tag === 'ol') {
        out += '\n';
        const ordered = tag === 'ol';
        let i = Number(node.getAttribute('start')) || 1;
        node.querySelectorAll(':scope > li').forEach((li) => {
          const prefix = ordered ? `${i++}. ` : '- ';
          // An item's further lines (a nested list, a second paragraph) sit under its text
          const body = cleanMarkdown(nodeToMarkdown(li)).replace(/\n{2,}(?=[-*] |\d+\. )/g, '\n').replace(/\n/g, '\n' + ' '.repeat(prefix.length));
          out += `${prefix}${body}\n`;
        });
        out += '\n';
      } else if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(cell));
        if (!rows.length) return;
        const width = Math.max(...rows.map(r => r.length));
        const line = (r) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
        out += `\n\n${line(rows[0])}\n| ${Array(width).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
      } else if (tag === 'blockquote') {
        const body = cleanMarkdown(nodeToMarkdown(node));
        out += `\n\n${body.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
      } else if (tag === 'hr') {
        out += '\n\n---\n\n';
      } else if (tag === 'p' || tag === 'li') {
        out += `\n\n${nodeToMarkdown(node).trim()}\n\n`;
      } else if (tag === 'br') {
        out += '\n';
      } else if (tag === 'code') {
        out += '`' + node.innerText + '`';
      } else if (tag === 'strong' || tag === 'b') {
        out += '**' + nodeToMarkdown(node).trim() + '**';
      } else if (tag === 'em' || tag === 'i') {
        out += '*' + nodeToMarkdown(node).trim() + '*';
      } else if (tag === 'a') {
        out += `[${node.innerText}](${node.getAttribute('href') || ''})`;
      } else {
        out += nodeToMarkdown(node);
      }
    });
    return out;
  }

  function cleanMarkdown(s) {
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  globalThis.yavarAnswerMarkdown = (el) => cleanMarkdown(nodeToMarkdown(el));
})();
