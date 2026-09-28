// The extras under Settings → Labs: IELTS practice and Add to Morfia.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { coachSteps, loadCoach, coachPrompt } from '../utils/coach.js';
import { materialFile, addToMorfia } from '../utils/material.js';

export class LabsPart {
  // IELTS coach: the article goes with the first step as a file; each send
  // wraps what you typed in the current step's prompt, then moves on
  async startCoach() {
    try {
      const [{ text, title, url }, { about, prompts }] = await Promise.all([this.getActivePageText(60000), loadCoach()]);
      this._coach = { i: 0, steps: coachSteps(prompts), about, title, url, page: text };
      this.composerTool = 'coach';
      this.renderComposer();
      this.setView('app');
      this.threadInput.focus();
    } catch (e) {
      this.showNotification('⚠️ ' + e.message);
    }
  }

  async coachSend(text) {
    const c = this._coach;
    if (!c) return;
    this.composerTool = 'coach';
    this.renderComposer();
    const first = c.i === 0;
    const filename = (c.title.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'article') + '.txt';
    const answer = await this.askInThread({
      title: c.title.slice(0, 60), label: text,
      prompt: await coachPrompt(c.steps[c.i], text, c),
      items: first ? [{ label: c.title.slice(0, 40) || 'This page' }] : [],
      attachments: first ? [{ filename, content: c.page, mime: 'text/plain' }] : []
    });
    if (this._coach !== c) return;   // ended or restarted while waiting
    // A failed answer keeps the step, so the attempt can be sent again
    if (answer != null) c.i++;
    if (c.i >= c.steps.length) { this._coach = null; this.composerTool = null; }
    this.renderComposer();
  }

  // The article in the tab, added to Morfia's library, with the selected
  // passage as the place its reader opens
  async saveForMorfia() {
    try {
      const [{ settings }, { morfiaToken }] = await Promise.all([
        chrome.storage.sync.get('settings'), chrome.storage.local.get('morfiaToken')]);
      if (!morfiaToken) throw new Error("Add Morfia's connection code in Settings → Labs");
      const base = settings?.morfiaBase || 'http://localhost:8000';
      this.showNotification('Adding to Morfia…');
      const [tab] = await this.getActiveTabs();
      const [{ text, title, url }, quote] = await Promise.all([
        this.getActivePageText(110000),
        // The selection is optional: without it Morfia opens at the top
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || '') })
          .then(([r]) => r?.result || '').catch(() => '')
      ]);
      const file = materialFile({
        title, url, text, quote,
        producer: 'Yavar ' + chrome.runtime.getManifest().version, capturedAt: new Date().toISOString()
      });
      if (!file.text) throw new Error('This page has no readable text');
      const added = await addToMorfia(file, { base, token: morfiaToken });
      this.showNotification(`${added.already ? 'Already in Morfia' : 'Added to Morfia'}: ${added.title}`);
    } catch (e) {
      this.showNotification('⚠️ ' + e.message);
    }
  }
}
