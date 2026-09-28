// The tab you are looking at: what it is, and reading its page or video.
// Its methods join YavarSidePanel's (see the end of sidepanel.js), so `this` is the panel.

import { parseGitHubUrl } from '../utils/github.js';

export class TabPart {
  // What the tab you're looking at is (a web page, a GitHub repo, a video)
  // decides the start page's actions and what the + menu can add.
  setupTabContext() {
    const update = () => this.updateTabContext();
    update();
    try {
      chrome.tabs.onActivated.addListener(update);
      chrome.tabs.onUpdated.addListener((id, info) => {
        if (info.status === 'complete' || info.url) update();
      });
      chrome.windows?.onFocusChanged?.addListener(update);
    } catch (e) {
      console.warn('[Yavar] Could not watch tab changes:', e);
    }
  }

  async updateTabContext() {
    let url = '';
    try {
      const [tab] = await this.getActiveTabs();
      url = tab?.url || '';
    } catch (e) { /* no tab: nothing to offer */ }

    // The reader shows the repo you were already on: keep that context
    if (url.startsWith(chrome.runtime.getURL('reader.html'))) return;
    // "Usable" = a real web page that isn't one of the AI chat sites themselves
    const isHttp = /^https?:\/\//i.test(url);
    const isAIHost = /(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com)/i.test(url);
    const usable = isHttp && !isAIHost;
    const video = usable && (/:\/\/(www\.)?youtube\.com\/watch\?/i.test(url) || /:\/\/youtu\.be\//i.test(url));
    const gh = parseGitHubUrl(url);
    // The reading map you started for this repo, so the menus can offer to continue it
    let journey = null;
    if (gh) {
      const key = `journey:${gh.owner}/${gh.repo}`;
      try { journey = (await chrome.storage.local.get(key))[key] || null; } catch (e) { /* none yet */ }
    }
    this._tabCtx = { usable, gh, url, video, journey: this.journeyStatus(journey) };
    this.renderHome();
  }

  // Read the active tab's readable page text. Injects a reader on demand so it
  // works even when the content script isn't loaded in that tab yet (e.g. the
  // tab was open before the extension was reloaded); falls back to messaging.
  async getActivePageText(maxChars = 40000) {
    const [tab] = await this.getActiveTabs();
    if (!tab?.id) throw new Error('No active tab');

    // Primary: inject the extractor directly (no content script required)
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (max) => {
          try {
            const root = document.querySelector('article') || document.querySelector('main') || document.body;
            if (!root) return { text: '', title: document.title, url: location.href };
            const clone = root.cloneNode(true);
            clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer,header,form,button,aside').forEach(el => el.remove());
            let text = (clone.innerText || clone.textContent || '')
              .replace(/[ \t]+/g, ' ')
              .replace(/\n[ \t]+/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            if (document.title) text = '# ' + document.title + '\n\n' + text;
            if (text.length > max) text = text.slice(0, max) + '\n… [truncated]';
            return { text, title: document.title, url: location.href };
          } catch (e) {
            return { text: '', title: document.title, url: location.href };
          }
        },
        args: [maxChars]
      });
      const r = res?.result;
      if (r && r.text) return { text: r.text, title: r.title || tab.title || 'page', url: r.url || tab.url || '' };
    } catch (e) { /* fall through to messaging */ }

    // Fallback: ask the content script (if present)
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'get_page_text', maxChars }).catch(() => null);
    if (res && res.text) return { text: res.text, title: res.title || tab.title || 'page', url: res.url || tab.url || '' };

    throw new Error('Could not read this page (try reloading the tab)');
  }

  // Read the active YouTube tab's transcript. Injects into the page's MAIN world
  // and reads the LIVE player response (`#movie_player.getPlayerResponse()`),
  // which — unlike the page-load `ytInitialPlayerResponse` — stays correct after
  // YouTube's in-page navigation. Fetches the caption track from page context
  // (correct origin/cookies) and flattens it to text.
  async getVideoTranscript(maxChars = 100000) {
    const [tab] = await this.getActiveTabs();
    if (!tab?.id) throw new Error('No active tab');

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (max) => {
        try {
          // Live player first; fall back to the initial page-load response.
          let pr = null;
          try { pr = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch (e) {}
          if (!pr?.captions) pr = window.ytInitialPlayerResponse;
          const title = pr?.videoDetails?.title || document.title || 'video';
          const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (!tracks || !tracks.length) {
            return { error: 'This video has no captions available.' };
          }
          // Prefer a human (non-ASR) English track; fall back to first track.
          const en = tracks.filter(t => (t.languageCode || '').toLowerCase().startsWith('en'));
          const pool = en.length ? en : tracks;
          const pick = pool.find(t => t.kind !== 'asr') || pool[0];
          const url = pick.baseUrl + (pick.baseUrl.includes('fmt=') ? '' : '&fmt=json3');
          const resp = await fetch(url);
          if (!resp.ok) return { error: 'Could not download the transcript (HTTP ' + resp.status + ').' };
          const data = await resp.json();
          const lines = (data.events || [])
            .map(ev => (ev.segs || []).map(s => s.utf8 || '').join(''))
            .map(s => s.replace(/\n+/g, ' ').trim())
            .filter(Boolean);
          let text = lines.join('\n');
          if (!text) return { error: 'The transcript came back empty.' };
          text = '# ' + title + '\n\n' + text;
          if (text.length > max) text = text.slice(0, max) + '\n… [truncated]';
          return { text, title, url: location.href };
        } catch (e) {
          return { error: 'Transcript extraction failed: ' + (e?.message || e) };
        }
      },
      args: [maxChars]
    });

    const r = res?.result;
    if (r?.error) throw new Error(r.error);
    if (r?.text) return { text: r.text, title: r.title, url: r.url };
    throw new Error('Could not read this video (try reloading the tab)');
  }
}
