// Pieces of the reading sheet: the step bar, code boxes, and the ask box in
// the dock.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { cmModeFor, defineGenericMode, closeBracketKeys } from '../utils/codeEditor.js';

export class SheetsPart {
  // A dock's content: the quick actions in one row, and under them the
  // question field, always there because asking is what you do most. It
  // starts one line tall and grows as you type; Enter asks, Shift+Enter
  // starts a new line, Escape leaves the field.
  askBox(attr, placeholder, actions) {
    return `<div class="wk-acts">${actions}</div>` +
      `<div class="wk-ask"><textarea class="wk-ask-input" rows="1" placeholder="${placeholder}" aria-label="${placeholder}"></textarea>` +
      `<button type="button" class="wk-ask-send" ${attr}="ask" title="Ask (Enter)" aria-label="Ask">` +
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg></button></div>`;
  }

  // The question typed in a dock's ask field, cleared once taken; '' when empty
  takeQuestion(body) {
    const input = body.querySelector('.wk-ask-input');
    const q = input?.value.trim() || '';
    if (!q) { input?.focus(); return ''; }
    input.value = '';
    input.style.height = '';
    return q;
  }

  // Pinned at the top of the sheet: a way back, what you're reading and where
  // you are in it (the step list opens from it), Previous, a forward control
  // and ✕, over a thin progress line. It stands in for the sheet's header, so
  // the answer gets the height. `act` names the sheet's data attribute (wk,
  // rb); `context` is text, the other titles are markup.
  stepBar({ act, back = '', context, where, first, next, pct, items, extra = '' }) {
    const a = `data-${act}`;
    return `<div class="wk-bar"><div class="wk-row">${back}` +
        `<button type="button" class="wk-where" ${a}="list" aria-expanded="false">` +
          `<span class="wk-ctx">${this.escapeHtml(context)}</span><span class="wk-pos">${where}</span><span class="wk-chev" aria-hidden="true"></span></button>` +
        `<span class="wk-steps"><button type="button" class="wk-step" ${a}="prev" aria-label="Previous"${first ? ' disabled' : ''}>‹</button>${next}</span>` +
        `<button type="button" class="wk-close" ${a}="close" title="Close (Esc)" aria-label="Close">✕</button>` +
      `</div>` +
      `<div class="wk-progress" aria-hidden="true"><i style="width:${pct}%"></i></div>` +
      `<div class="wk-blocks" hidden><ol>${items.map(it =>
        `<li><button type="button" class="${it.current ? 'is-current' : ''}" ${a}="goto" data-i="${it.i}"${it.current ? ' aria-current="step"' : ''}>` +
        `<span class="wk-n">${it.mark}</span><span class="wk-t">${it.title}</span>${it.meta ? `<span class="wk-l">${it.meta}</span>` : ''}</button></li>`).join('')}</ol>` +
      extra + `</div></div>`;
  }

  // A code editor with colours, line numbers and indentation (CodeMirror)
  // that starts one line tall and grows with the code.
  // firstLine numbers it like the file (a block of lines 16-49 starts at 16);
  // Ctrl/Cmd+Enter calls onSubmit.
  makeCodeBox(host, { value = '', lang = '', firstLine = 1, placeholder = '', onChange = null, onSubmit = null }) {
    defineGenericMode(CodeMirror);
    const cm = CodeMirror(host, {
      value, mode: cmModeFor(lang), theme: 'yavar', lineNumbers: true, firstLineNumber: firstLine,
      lineWrapping: false, viewportMargin: Infinity, tabSize: 4, indentUnit: 4, indentWithTabs: false,
      extraKeys: {
        'Ctrl-Enter': () => onSubmit?.(),
        'Cmd-Enter': () => onSubmit?.(),
        Tab: (ed) => ed.somethingSelected() ? ed.indentSelection('add') : ed.replaceSelection(' '.repeat(ed.getOption('indentUnit')))
      }
    });
    cm.addKeyMap(closeBracketKeys(CodeMirror));
    // CodeMirror 5 here has no placeholder addon: a hint shown while it's empty
    const hint = document.createElement('span');
    hint.className = 'code-box-hint';
    hint.textContent = placeholder;
    hint.setAttribute('aria-hidden', 'true');
    host.appendChild(hint);
    const empty = () => host.classList.toggle('is-empty', !cm.getValue());
    cm.on('change', () => { empty(); onChange?.(cm.getValue()); });
    empty();
    requestAnimationFrame(() => {
      cm.refresh();
      hint.style.left = cm.getGutterElement().offsetWidth + 6 + 'px';
    });
    return cm;
  }

  toggleStepList(body, btn) {
    const list = body.querySelector('.wk-blocks');
    list.hidden = !list.hidden;
    btn.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) list.querySelector('.is-current')?.focus();
  }

  // Close the step list if it's open; true when it was
  closeStepList(body, refocus = false) {
    const list = body?.querySelector('.wk-blocks:not([hidden])');
    if (!list) return false;
    list.hidden = true;
    const where = body.querySelector('.wk-where');
    where?.setAttribute('aria-expanded', 'false');
    if (refocus) where?.focus();
    return true;
  }
}
