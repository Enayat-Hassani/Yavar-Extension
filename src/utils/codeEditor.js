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

// ----- Closing brackets and quotes, as code editors do -----
// Typing an opener adds its closer; typing a closer that's already next
// steps over it; Backspace between an empty pair deletes both; Enter
// between brackets puts the closer on its own line.

const PAIRS = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' };
const QUOTES = new Set(["'", '"', '`']);

// What typing `ch` does, from the text before and after the cursor on its
// line: 'pair' (insert it and its closer, cursor between), 'skip' (step
// over the same character already next) or null (type it as usual)
export function bracketAction(ch, before, after) {
  const next = after[0] || '';
  const prev = before[before.length - 1] || '';
  if ((ch === ')' || ch === ']' || ch === '}' || QUOTES.has(ch)) && next === ch) return 'skip';
  if (!PAIRS[ch]) return null;
  if (next && !/[\s)\]}:;,.]/.test(next)) return null;           // right before a word: no pair
  if (QUOTES.has(ch) && /[\w'"`]/.test(prev)) return null;        // don't, a'b, closing a string
  return 'pair';
}

// Backspace between an opener and its closer ("(|)") removes both
export function deletesPair(before, after) {
  const prev = before[before.length - 1];
  return !!prev && PAIRS[prev] === after[0];
}

// The key map for a CodeMirror 5 editor (`CM` is the CodeMirror global)
export function closeBracketKeys(CM) {
  const single = (cm) => cm.listSelections().length === 1;
  const around = (cm) => {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    return { cur, before: line.slice(0, cur.ch), after: line.slice(cur.ch) };
  };
  const keys = {};
  for (const ch of [...Object.keys(PAIRS), ')', ']', '}']) {
    keys[`'${ch}'`] = (cm) => {
      if (!single(cm)) return CM.Pass;
      if (cm.somethingSelected()) {
        if (!PAIRS[ch]) return CM.Pass;
        // Wrap what's selected, and keep it selected
        const from = cm.getCursor('from');
        const to = cm.getCursor('to');
        cm.operation(() => {
          cm.replaceRange(PAIRS[ch], to);
          cm.replaceRange(ch, from);
          cm.setSelection({ line: from.line, ch: from.ch + 1 }, { line: to.line, ch: to.ch + (to.line === from.line ? 1 : 0) });
        });
        return undefined;
      }
      const { cur, before, after } = around(cm);
      const act = bracketAction(ch, before, after);
      if (act === 'skip') cm.setCursor({ line: cur.line, ch: cur.ch + 1 });
      else if (act === 'pair') cm.operation(() => {
        cm.replaceSelection(ch + PAIRS[ch]);
        cm.setCursor({ line: cur.line, ch: cur.ch + 1 });
      });
      else return CM.Pass;
      return undefined;
    };
  }
  keys.Backspace = (cm) => {
    if (!single(cm) || cm.somethingSelected()) return CM.Pass;
    const { cur, before, after } = around(cm);
    if (!deletesPair(before, after)) return CM.Pass;
    cm.replaceRange('', { line: cur.line, ch: cur.ch - 1 }, { line: cur.line, ch: cur.ch + 1 });
    return undefined;
  };
  keys.Enter = (cm) => {
    if (!single(cm) || cm.somethingSelected()) return CM.Pass;
    const { cur, before, after } = around(cm);
    const prev = before[before.length - 1];
    if (!prev || !'([{'.includes(prev) || PAIRS[prev] !== after[0]) return CM.Pass;
    const base = before.match(/^\s*/)[0];
    const unit = ' '.repeat(cm.getOption('indentUnit'));
    cm.operation(() => {
      cm.replaceSelection(`\n${base}${unit}\n${base}`);
      cm.setCursor({ line: cur.line + 1, ch: base.length + unit.length });
    });
    return undefined;
  };
  return keys;
}
