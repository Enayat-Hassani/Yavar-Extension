import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmModeFor, defineGenericMode } from '../src/utils/codeEditor.js';

test('bundled modes for the languages CodeMirror ships here', () => {
  assert.equal(cmModeFor('python'), 'python');
  assert.equal(cmModeFor('Python'), 'python');
  assert.equal(cmModeFor('typescript'), 'text/typescript');
  assert.equal(cmModeFor('tsx'), 'text/typescript');
  assert.equal(cmModeFor('JavaScript'), 'javascript');
  assert.equal(cmModeFor('json'), 'application/json');
  assert.equal(cmModeFor('scss'), 'text/x-scss');
});

test('other languages get the generic mode; prose stays plain', () => {
  assert.deepEqual(cmModeFor('go'), { name: 'yavar-generic', lang: 'go' });
  assert.deepEqual(cmModeFor('Rust'), { name: 'yavar-generic', lang: 'rust' });
  assert.equal(cmModeFor('markdown'), 'text/plain');
  assert.equal(cmModeFor(''), 'text/plain');
});

// A minimal stand-in for CodeMirror's StringStream, enough to run the mode
function tokens(mode, line, state = mode.startState()) {
  const out = [];
  let pos = 0;
  const stream = {
    get string() { return line; },
    start: 0,
    eatSpace() { const m = /^\s+/.exec(line.slice(pos)); if (m) pos += m[0].length; return !!m; },
    match(p) {
      if (typeof p === 'string') { if (line.startsWith(p, pos)) { pos += p.length; return true; } return false; }
      const m = p.exec(line.slice(pos)); if (m && m.index === 0) { pos += m[0].length; return m; } return null;
    },
    peek() { return line[pos]; },
    next() { return pos < line.length ? line[pos++] : null; },
    skipToEnd() { pos = line.length; },
    skipTo(s) { const i = line.indexOf(s, pos); if (i < 0) return false; pos = i; return true; },
    current() { return line.slice(this.start, pos); }
  };
  while (pos < line.length) {
    stream.start = pos;
    const style = mode.token(stream, state);
    if (style) out.push([line.slice(stream.start, pos), style]);
  }
  return { out, state };
}

test('the generic mode colours keywords, strings, numbers and comments', () => {
  let mode;
  defineGenericMode({ modes: {}, defineMode: (name, factory) => { mode = factory({}, { lang: 'go' }); } });
  const { out } = tokens(mode, 'func main() { x := "hi" + 42 } // done');
  assert.deepEqual(out, [['func', 'keyword'], ['"hi"', 'string'], ['42', 'number'], ['// done', 'comment']]);
  const first = tokens(mode, 'a /* start');
  assert.equal(first.state.inBlock, true);
  assert.deepEqual(tokens(mode, 'still */ return', first.state).out, [['still */', 'comment'], ['return', 'keyword']]);
});

test('Python-family languages comment with #', () => {
  let mode;
  defineGenericMode({ modes: {}, defineMode: (name, factory) => { mode = factory({}, { lang: 'bash' }); } });
  assert.deepEqual(tokens(mode, 'echo hi # note').out, [['echo', 'keyword'], ['# note', 'comment']]);
});
