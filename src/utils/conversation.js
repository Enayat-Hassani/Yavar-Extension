// The conversation in the Yavar view, handed to whichever model answers
// next. Switching models used to start the new one from nothing although
// the whole conversation was on screen. A turn is { q, a, by }: what was
// asked, the answer, and the model that wrote it.

// A long conversation keeps its newest turns; the oldest go first
export const HANDOFF_CHARS = 24000;

function fitTurns(turns, maxChars) {
  const kept = [];
  let size = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const n = turns[i].q.length + turns[i].a.length;
    if (kept.length && size + n > maxChars) break;
    kept.unshift(turns[i]);
    size += n;
  }
  return kept;
}

// For a chat site: the conversation as a Markdown file to attach
export function transcriptMarkdown(turns, maxChars = HANDOFF_CHARS) {
  const kept = fitTurns(turns, maxChars);
  const left = turns.length - kept.length;
  return '# Our conversation so far\n\n' +
    (left ? `(${left} earlier turn${left === 1 ? '' : 's'} left out)\n\n` : '') +
    kept.map(t => `## Me\n\n${t.q}\n\n## ${t.by || 'Assistant'}\n\n${t.a}`).join('\n\n') + '\n';
}

// For an API model: the conversation as its own earlier turns
export function turnsToMessages(turns, maxChars = HANDOFF_CHARS) {
  return fitTurns(turns, maxChars).flatMap(t => [
    { role: 'user', content: t.q },
    { role: 'assistant', content: t.a }
  ]);
}

// What the chat site is told along with the file
export const HANDOFF_NOTE = 'We started this conversation in another chat. The attached "conversation-so-far.md" ' +
  'has it; read it and continue from there as if you had been in it. My next message:';
