// Saved answers: storage, the panel, and export.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

export class HistoryPart {
  // History is kept in memory after the first read (it can be several MB);
  // writes go through setHistory, and changes from another Yavar window come
  // in through storage.onChanged.
  async getHistory() {
    if (this._history) return this._history;
    try {
      const { yavarHistory } = await chrome.storage.local.get('yavarHistory');
      this._history = Array.isArray(yavarHistory) ? yavarHistory : [];
    } catch (e) {
      console.error('[Yavar] Failed to load history:', e);
      return [];
    }
    return this._history;
  }

  async setHistory(list) {
    this._history = list;
    await chrome.storage.local.set({ yavarHistory: list });
  }

  async addHistoryEntry(entry) {
    // keep the 200 most recent
    await this.setHistory([entry, ...(await this.getHistory())].slice(0, 200));
  }

  async deleteHistoryEntry(id) {
    await this.setHistory((await this.getHistory()).filter(e => e.id !== id));
    this.renderHistory();
  }

  async clearHistory() {
    await this.setHistory([]);
    this.renderHistory();
  }

  handleClearHistoryClick() {
    if (!this.confirmTwice('history')) return;
    this.clearHistory();
    this.showNotification('🗑️ History cleared');
  }

  toggleHistory() {
    if (this.historyPanel.classList.contains('hidden')) {
      this.renderHistory();
      this.historyPanel.classList.remove('hidden');
      this.historySearch.focus();
    } else {
      this.historyPanel.classList.add('hidden');
    }
  }

  async renderHistory() {
    const history = await this.getHistory();
    const q = (this.historySearch?.value || '').toLowerCase().trim();
    const filtered = q
      ? history.filter(e =>
          (e.answer || '').toLowerCase().includes(q) ||
          (e.prompt || '').toLowerCase().includes(q) ||
          (e.platform || '').toLowerCase().includes(q) ||
          (e.topic || '').toLowerCase().includes(q))
      : history;

    if (!filtered.length) {
      this.historyList.innerHTML = `<div class="history-empty">${
        history.length
          ? 'No matches.'
          : 'No saved answers yet.<br>Open an AI chat, then click <strong>Save answer</strong> (or press Ctrl+Shift+S).'
      }</div>`;
      return;
    }

    this.historyList.innerHTML = filtered.map(e => {
      const date = new Date(e.ts).toLocaleString();
      const answer = e.answer || '';
      const preview = this.escapeHtml(answer.slice(0, 240)) + (answer.length > 240 ? '…' : '');
      const promptLine = e.prompt
        ? `<div class="history-prompt" title="${this.escapeHtml(e.prompt)}">${this.escapeHtml(e.prompt.slice(0, 140))}</div>`
        : '';
      return `
        <div class="history-item" data-id="${e.id}">
          <div class="history-meta">
            <span class="history-platform">${this.escapeHtml(e.platform || 'AI')}</span>
            ${e.topic ? `<button class="history-topic" data-topic="${this.escapeHtml(e.topic)}" title="Show answers about ${this.escapeHtml(e.topic)}">${this.escapeHtml(e.topic)}</button>` : ''}
            <span class="history-date">${date}</span>
          </div>
          ${promptLine}
          <div class="history-answer" data-act="expand" data-id="${e.id}" title="Click to expand">${preview}</div>
          <div class="history-item-actions">
            <button class="history-btn" data-act="copy" data-id="${e.id}">Copy</button>
            <button class="history-btn" data-act="notes" data-id="${e.id}">→ Notes</button>
            <button class="history-btn history-btn-danger" data-act="delete" data-id="${e.id}">Delete</button>
          </div>
        </div>`;
    }).join('');
  }

  handleHistoryListClick(e) {
    const topicEl = e.target.closest('.history-topic');
    if (topicEl) {
      this.historySearch.value = topicEl.dataset.topic;
      this.renderHistory();
      return;
    }
    const answerEl = e.target.closest('.history-answer[data-act="expand"]');
    if (answerEl) {
      this.toggleHistoryAnswer(answerEl);
      return;
    }
    const btn = e.target.closest('.history-btn');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'copy') this.copyHistoryEntry(id);
    else if (act === 'notes') this.insertHistoryToNotes(id);
    else if (act === 'delete') this.deleteHistoryEntry(id);
  }

  // Swap the short preview for the full answer (and back). Full text is only
  // read on demand so the list stays light with 200 long entries.
  async toggleHistoryAnswer(el) {
    if (window.getSelection()?.toString()) return; // don't collapse while selecting text
    const expanded = el.classList.toggle('expanded');
    const answer = (await this.getHistory()).find(x => x.id === el.dataset.id)?.answer || '';
    el.textContent = expanded ? answer : answer.slice(0, 240) + (answer.length > 240 ? '…' : '');
    el.title = expanded ? 'Click to collapse' : 'Click to expand';
  }

  async copyHistoryEntry(id) {
    const entry = (await this.getHistory()).find(x => x.id === id);
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(entry.answer || '');
      this.showNotification('📋 Answer copied to clipboard');
    } catch (err) {
      console.error('[Yavar] Failed to copy history entry:', err);
    }
  }

  async insertHistoryToNotes(id) {
    const entry = (await this.getHistory()).find(x => x.id === id);
    if (!entry) return;
    this.appendToNotes(entry);
    this.showNotification('📝 Added to notes');
  }

  async exportHistory() {
    const history = await this.getHistory();
    if (!history.length) {
      this.showNotification('No saved answers to export');
      return;
    }
    const blocks = history.map(e => {
      const head = `## ${e.topic ? e.topic + ' · ' : ''}${e.platform || 'AI'} · ${new Date(e.ts).toLocaleString()}`;
      const src = e.url ? `\n\n<${e.url}>` : '';
      const prompt = e.prompt ? `\n\n**Prompt:**\n\n${e.prompt}` : '';
      return `${head}${src}${prompt}\n\n**Answer:**\n\n${e.answer || ''}`;
    });
    const md = `# Yavar saved answers\n\nExported ${new Date().toLocaleString()} · ${history.length} answer(s)\n\n---\n\n` +
      blocks.join('\n\n---\n\n') + '\n';
    this.downloadText(`yavar-answers-${this.fileDateStamp()}.md`, md);
    this.showNotification(`⬇️ Exported ${history.length} answer(s)`);
  }
}
