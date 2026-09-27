// "Add to Morfia": the article in the tab, sent to Morfia's bridge as
// "morfia-material" version 1. Morfia fetches and cleans the article from
// its link and falls back to this text. The selected passage goes as
// `start_quote`, where Morfia's reader opens.

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

// POST to a running Morfia with its connection code. Resolves to Morfia's
// answer ({ id, title, already, from }); rejects with a message to show.
export async function addToMorfia(file, { base, token }) {
  let res;
  try {
    res = await fetch(base.replace(/\/+$/, '') + '/bridge/v1/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(file)
    });
  } catch (e) {
    throw new Error(`Morfia isn't running at ${base}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Morfia answered ${res.status}`);
  return data;
}

export async function pingMorfia({ base, token }) {
  let res;
  try {
    res = await fetch(base.replace(/\/+$/, '') + '/bridge/v1/ping', { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error(`Morfia isn't running at ${base}`);
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Morfia answered ${res.status}`);
}
