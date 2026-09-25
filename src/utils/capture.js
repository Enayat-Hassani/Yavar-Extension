// What the page picker captured (an element you clicked, or an area you
// dragged), turned into what the message carries: a short chip label and a
// Markdown attachment with the text, table, links and so on. The picker in
// the page only collects raw facts; everything here is pure.
//
// capture: { mode: 'element' | 'area', tag, text, rows: [[cell]], links:
// [{ text, href }], images: [{ alt, src }], heading, html, url, title }

const escCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function tableMarkdown(rows) {
  if (!rows?.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')].map(escCell);
  const [head, ...body] = rows.map(pad);
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map(r => `| ${r.join(' | ')} |`)
  ].join('\n');
}

const wordCount = (t) => (String(t || '').match(/\S+/g) || []).length;

const KINDS = {
  a: 'Link', button: 'Button', input: 'Field', textarea: 'Field', select: 'Field', form: 'Form',
  img: 'Image', svg: 'Image', canvas: 'Chart or drawing', video: 'Video', pre: 'Code', code: 'Code',
  ul: 'List', ol: 'List', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', p: 'Paragraph'
};

// "Table · 8×4", "Paragraph · 38 words", "Button: Save", "Screenshot"
export function captureLabel(c) {
  if (!c) return 'Screenshot';
  if (c.rows?.length) return `Table · ${c.rows.length}×${Math.max(...c.rows.map(r => r.length))}`;
  const kind = KINDS[c.tag] || (c.mode === 'area' ? 'Area' : 'Section');
  const text = String(c.text || '').replace(/\s+/g, ' ').trim();
  if (['Link', 'Button', 'Field', 'Heading'].includes(kind) && text) {
    // Cut at a word boundary, not mid-word
    const short = text.length > 28 ? text.slice(0, 29).replace(/\s+\S*$/, '') + '…' : text;
    return `${kind}: ${short}`;
  }
  const words = wordCount(text);
  return words ? `${kind} · ${words} word${words === 1 ? '' : 's'}` : (kind === 'Area' ? 'Screenshot' : kind);
}

// True when there's more than the picture to send
export function hasCaptureText(c) {
  return !!(c && (String(c.text || '').trim() || c.rows?.length || c.links?.length || c.images?.some(i => i.alt) || c.html));
}

export function captureMarkdown(c) {
  const parts = [`# Captured from "${c.title || c.url || 'a web page'}"`];
  if (c.url) parts.push(c.url);
  if (c.heading) parts.push(`Under the heading: ${c.heading}`);
  if (c.rows?.length) parts.push('## Table\n\n' + tableMarkdown(c.rows));
  const text = String(c.text || '').trim();
  // A table's text is already in the table
  if (text && !c.rows?.length) parts.push('## Text\n\n' + text);
  if (c.links?.length) parts.push('## Links\n\n' + c.links.map(l => `- [${escCell(l.text) || l.href}](${l.href})`).join('\n'));
  const alts = (c.images || []).filter(i => i.alt);
  if (alts.length) parts.push('## Images\n\n' + alts.map(i => `- ${escCell(i.alt)}`).join('\n'));
  if (c.html) parts.push('## HTML\n\n```html\n' + c.html + '\n```');
  return parts.join('\n\n') + '\n';
}
