// The notes scratchpad.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

export class NotesPart {
  // Append a captured answer to the Notes doc (works even if notes is closed).
  appendToNotes(entry) {
    const stamp = new Date(entry.ts).toLocaleString();
    const promptBlock = entry.prompt ? `**Prompt:** ${entry.prompt}\n\n` : '';
    const block = `\n\n---\n### ${entry.platform} · ${stamp}\n${promptBlock}${entry.answer || ''}\n`;
    const current = this.cmEditor.getValue();
    this.cmEditor.setValue(current ? current + block : block.trimStart());
    this.saveNotes();
  }

  initCodeMirror() {
    this.cmEditor = CodeMirror(this.notesEditorContainer, {
      mode: null,
      theme: 'yavar',
      lineNumbers: false,
      lineWrapping: true,
      tabSize: 2,
      indentWithTabs: false,
      placeholder: 'Write notes, code snippets, ideas...',
      autofocus: false
    });
    this.cmEditor.on('change', () => this.saveNotes());
  }

  toggleNotes() {
    this.notesOpen = !this.notesOpen;
    if (this.notesOpen) {
      this.notesPanel.classList.remove('hidden');
      this.loadNotes();
      this.cmEditor.refresh();
      this.cmEditor.focus();
    } else {
      this.notesPanel.classList.add('hidden');
      this.saveNotes();
    }
  }

  async loadNotes() {
    try {
      const { yavarNotes } = await chrome.storage.local.get('yavarNotes');
      this.cmEditor.setValue(yavarNotes || '');
    } catch (e) {
      console.error('[Yavar] Failed to load notes:', e);
    }
  }

  saveNotes() {
    chrome.storage.local.set({ yavarNotes: this.cmEditor.getValue() });
  }

  // One stray click shouldn't wipe notes
  handleClearNotesClick() {
    if (!this.cmEditor.getValue()) return;
    if (!this.confirmTwice('notes')) return;
    this.clearNotes();
    this.showNotification('🗑️ Notes cleared');
  }

  downloadNotes() {
    const text = this.cmEditor.getValue();
    if (!text.trim()) {
      this.showNotification('Notes are empty');
      return;
    }
    this.downloadText(`yavar-notes-${this.fileDateStamp()}.md`, text);
  }

  fileDateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  downloadText(filename, text, mime = 'text/markdown') {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  clearNotes() {
    this.cmEditor.setValue('');
    this.saveNotes();
  }

  async copyNotes() {
    try {
      await navigator.clipboard.writeText(this.cmEditor.getValue());
      this.showNotification('Copied notes to clipboard!');
    } catch (e) {
      console.error('[Yavar] Failed to copy notes:', e);
    }
  }
}
