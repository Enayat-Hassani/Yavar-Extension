// Code boxes (walkthrough practice, rebuild steps) are CodeMirror editors,
// like the runner. The bundled modes cover Python, JavaScript/TypeScript/JSON,
// CSS and HTML; every other language gets a small mode that colours comments,
// strings, numbers and keywords the same way the reader and answers do.

import { keywordInfo } from './markdown.js';

const BUNDLED = {
  python: 'python', py: 'python',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', node: 'javascript',
  typescript: 'text/typescript', ts: 'text/typescript', tsx: 'text/typescript',
  json: 'application/json',
  css: 'css', scss: 'text/x-scss', less: 'text/x-less',
  html: 'htmlmixed', vue: 'htmlmixed', svelte: 'htmlmixed', xml: 'xml'
};

// The CodeMirror mode for a language name ("python", "TypeScript", "go"),
// as langFromPath() or a rebuild plan gives it. Plain text when unknown.
export function cmModeFor(lang) {
  const l = String(lang || '').trim().toLowerCase();
  if (!l || /^(text|txt|plain|plaintext|markdown|md)$/.test(l)) return 'text/plain';
  return BUNDLED[l] || { name: 'yavar-generic', lang: l };
}

// Register the fallback mode on the CodeMirror global (once)
export function defineGenericMode(CM) {
  if (CM.modes['yavar-generic']) return;
  CM.defineMode('yavar-generic', (config, { lang }) => {
    const { fam, keywords, lineComment } = keywordInfo(lang);
    const blockComments = lineComment === '//';
    return {
      startState: () => ({ inBlock: false }),
      token(stream, state) {
        if (state.inBlock) {
          if (stream.skipTo('*/')) { stream.match('*/'); state.inBlock = false; } else stream.skipToEnd();
          return 'comment';
        }
        if (stream.eatSpace()) return null;
        if (blockComments && stream.match('/*')) { state.inBlock = true; return 'comment'; }
        if (stream.match(lineComment)) { stream.skipToEnd(); return 'comment'; }
        const ch = stream.peek();
        if (ch === '"' || ch === "'" || ch === '`') {
          stream.next();
          let escaped = false;
          for (let c = stream.next(); c != null; c = stream.next()) {
            if (c === ch && !escaped) break;
            escaped = !escaped && c === '\\';
          }
          return 'string';
        }
        if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
        if (stream.match(/^[A-Za-z_$][\w$]*/)) {
          const word = stream.current();
          return keywords.has(fam === 'sql' ? word.toLowerCase() : word) ? 'keyword' : null;
        }
        stream.next();
        return null;
      },
      lineComment,
      blockCommentStart: blockComments ? '/*' : null,
      blockCommentEnd: blockComments ? '*/' : null
    };
  });
}
