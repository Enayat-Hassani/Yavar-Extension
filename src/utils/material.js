// "Save for Morfia": the article in the tab as a material file (format
// "morfia-material", version 1), which Morfia's Add article page opens.
// The selected passage goes as `start_quote`, where Morfia's reader opens.

const MAX_TITLE = 300;
const MAX_QUOTE = 1000;

// getActivePageText puts the page title on the first line; the file carries
// the title in its own field
export function materialFile({ title = '', url = '', text = '', quote = '', producer = '', capturedAt = '' }) {
  const heading = `# ${title}\n\n`;
  const body = (title && text.startsWith(heading) ? text.slice(heading.length) : text).trim();
  return {
    format: 'morfia-material',
    version: 1,
    kind: 'article',
    title: title.trim().slice(0, MAX_TITLE),
    url: /^https?:\/\//i.test(url) ? url : '',
    text: body,
    start_quote: quote.trim().slice(0, MAX_QUOTE),
    producer,
    captured_at: capturedAt
  };
}

export function materialFilename(title) {
  return (title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article') + '.morfia.json';
}
