// Side Panel - Main Logic (2026 Redesign)
// Full viewport chat with bottom navigation and model management
import { loadTemplates, expandTemplate, varsInTemplate } from './utils/templates.js';
import { DEFAULT_MODELS, loadModels as loadStoredModels } from './utils/models.js';
import { PROMPTS_KEY, loadEdits } from './utils/intents.js';
import { icon } from './utils/icons.js';
import { idbGet } from './utils/idb.js';
import { loadApiConfig, buildRoute } from './utils/llm.js';
import { parseGitHubUrl } from './utils/github.js';
import { ChatPart } from './panel/chat.js';
import { AnswersPart } from './panel/answers.js';
import { RepoPart } from './panel/repo.js';
import { ContextPart } from './panel/context.js';
import { SheetsPart } from './panel/sheets.js';
import { WalkPart } from './panel/walk.js';
import { JourneyPart } from './panel/journey.js';
import { ReviewPart } from './panel/review.js';
import { ComposerPart } from './panel/composer.js';
import { TabPart } from './panel/tab.js';
import { CapturePart } from './panel/capture.js';
import { HistoryPart } from './panel/history.js';
import { NotesPart } from './panel/notes.js';
import { LabsPart } from './panel/labs.js';

// Session-storage keys other parts of the extension use to hand work to the panel
const PENDING_KEYS = ['pendingAutoSubmit', 'pendingPromptLabel', 'lastSubmitTime', 'pendingText', 'pendingAction',
  'pendingScreenshot', 'pendingScreenshotRect', 'pendingCapture', 'pendingSelection', 'readerNav'];

class YavarSidePanel {
  constructor() {
    this.models = [];
    this.currentModelId = 'chatgpt';   // same default as the background and Settings

    this.init();
  }

  // The tab the user is looking at. In Chrome's side panel that's the active
  // tab of this window; when Yavar runs in its own window (browsers without
  // a side panel API) it's the active tab of the last focused normal window.
  async getActiveTabs() {
    const own = chrome.runtime.getURL('');
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || (tabs[0].url || '').startsWith(own)) {
      try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        tabs = await chrome.tabs.query({ active: true, windowId: win.id });
      } catch (e) { /* keep what we have */ }
    }
    return tabs;
  }

  // "Open in chat": put the sheets away and show the real chat
  closeSheets() {
    this.setView?.('chat');
    document.querySelectorAll('.sheet').forEach(el => el.classList.add('hidden'));
  }

  async init() {
    // Let the background know a panel is open (used where there's no side panel API)
    try { chrome.runtime.connect({ name: 'yavar-panel' }); } catch (e) { /* ignore */ }
    this.cacheElements();
    this.setupThread();
    await this.loadModels();
    this.updateModelPill();
    this.bindEvents();
    this.loadCurrentAI();
    this.setupIframeMessageListener();
    this.setupStorageListener();
    this.loadPromptTemplates();
    this.initCodeMirror();
    this.setupTabContext();
    this.drainPending();
    this.pruneWalks();
  }

  cacheElements() {
    // Main elements
    this.aiFrame = document.getElementById('ai-frame');
    this.loadingState = document.getElementById('loading-state');
    this.notificationBar = document.getElementById('notification-bar');
    this.notificationText = document.getElementById('notification-text');
    this.notificationDismiss = document.getElementById('notification-dismiss');

    // Notes panel
    this.notesPanel = document.getElementById('notes-panel');
    this.notesEditorContainer = document.getElementById('notes-editor');
    this.btnClearNotes = document.getElementById('btn-clear-notes');
    this.btnCopyNotes = document.getElementById('btn-copy-notes');
    this.btnDownloadNotes = document.getElementById('btn-download-notes');
    this.notesOpen = false;

    // History panel (captured AI answers)
    this.historyPanel = document.getElementById('history-panel');
    this.historyList = document.getElementById('history-list');
    this.historySearch = document.getElementById('history-search');
    this.btnClearHistory = document.getElementById('btn-clear-history');
    this.btnExportHistory = document.getElementById('btn-export-history');
    this.btnCloseHistory = document.getElementById('btn-close-history');

    // Repo Reader
    this.repoTree = null;
    this.readMarks = new Set();

    // Menus
    this.toolMenu = document.getElementById('tool-menu');

  }

  async loadModels() {
    try {
      const { aiModels } = await chrome.storage.sync.get('aiModels');
      this.models = await loadStoredModels();
      if (!aiModels?.length) await this.saveModels();   // the frame rules read the stored list


      // Current model: last used, else the Default AI from Settings
      const { currentModelId, settings } = await chrome.storage.sync.get(['currentModelId', 'settings']);
      const wanted = currentModelId || settings?.defaultAI;
      this.answerWith = settings?.answerWith === 'api' ? 'api' : 'chat';
      this._coachOn = !!settings?.ieltsCoach;
      loadEdits().then(r => { this._promptEdits = r; }).catch(() => {});
      idbGet('reviewFolder').then(h => { if (h) { this._reviewFolder = h; this.renderHome(); } }).catch(() => {});
      this._morfiaOn = !!settings?.morfia;
      if (wanted && this.models.some(m => m.id === wanted)) {
        this.currentModelId = wanted;
      }
    } catch (error) {
      console.error('[Yavar] Failed to load models:', error);
      this.models = DEFAULT_MODELS.map(m => ({ ...m }));
    }
  }

  // Models were added, removed or turned off in Settings
  onModelsChanged(models) {
    if (!Array.isArray(models) || !models.length) return;
    this.models = models;
    if (!this.models.some(m => m.id === this.currentModelId && m.enabled)) {
      const next = this.models.find(m => m.enabled);
      if (next) this.switchModel(next.id);
    }
    this.updateModelPill();
  }

  async saveModels() {
    try {
      await chrome.storage.sync.set({ aiModels: this.models });
    } catch (error) {
      console.error('[Yavar] Failed to save models:', error);
    }
  }

  async saveCurrentModelId() {
    try {
      await chrome.storage.sync.set({ currentModelId: this.currentModelId });
    } catch (error) {
      console.error('[Yavar] Failed to save current model:', error);
    }
  }

  getCurrentModel() {
    return this.models.find(m => m.id === this.currentModelId)
      || this.models.find(m => m.enabled)
      || this.models[0];
  }

  bindEvents() {
    document.getElementById('btn-save-current')?.addEventListener('click', () => this.captureLastAnswer());
    this.toolMenu?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-tool]');
      if (!item) return;
      e.stopPropagation();   // the document handler would close a lens picker this opens
      if (item.disabled) return;
      if (this.toolMenu.dataset.kind === 'command' && this._cmd) { this.pickCommand(item.dataset.tool); return; }
      this.toolMenu.classList.add('hidden');
      this.runTool(item.dataset.tool);
    });
    this.toolMenu?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toolMenu.classList.add('hidden');
    });

    this.walkPanel = document.getElementById('walk-panel');
    this.walkBody = document.getElementById('walk-body');
    document.getElementById('walk-close')?.addEventListener('click', () => this.walkPanel.classList.add('hidden'));
    this.walkPanel?.addEventListener('keydown', (e) => {
      // ← → (or k j) step through the walk, unless you're typing; [ ] a
      // change's files; ↓ ↑ read on into the next change once the sheet is
      // scrolled to its end (or back at its top), and scroll it until then
      const typing = e.target.closest?.('input, textarea, [contenteditable="true"], .CodeMirror');
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const b = this.walkBody;
        const dir = { ArrowLeft: -1, k: -1, '[': -1, ArrowRight: 1, j: 1, ']': 1,
          ArrowUp: b.scrollTop <= 0 ? -1 : 0, ArrowDown: b.scrollTop + b.clientHeight >= b.scrollHeight - 2 ? 1 : 0 }[e.key];
        if (dir === 0) return;
        if (dir && (/Arrow(Up|Down)|[[\]]/.test(e.key) ? !!this.walk?.change : true)) {
          if (this.stepWalk(dir, { file: e.key === '[' || e.key === ']' })) e.preventDefault();
          return;
        }
      }
      if (e.key !== 'Escape') return;
      if (this.toggleMoreActs(false)) this.walkBody.querySelector('[data-wk="moreacts"]')?.focus();
      else if (!this.closeStepList(this.walkBody, true)) this.walkPanel.classList.add('hidden');
    });
    this.walkBody?.addEventListener('click', (e) => this.onWalkClick(e));
    // A wider or narrower panel shows more or fewer of the dock's actions
    let actsWidth = 0;
    if (this.walkBody) new ResizeObserver(([e]) => {
      if (e.contentRect.width !== actsWidth) { actsWidth = e.contentRect.width; this.fitActs(); }
    }).observe(this.walkBody);
    for (const body of [this.walkBody]) {
      body?.addEventListener('click', (e) => {
        if (e.target.closest('.wk-ask-open')) this.toggleAsk(body, true);
      });
      body?.addEventListener('keydown', (e) => {
        if (!e.target.matches('.wk-ask-input') || e.isComposing) return;
        if (e.key === 'Escape') {
          e.stopPropagation();   // rolls the field up, not the sheet
          this.toggleAsk(body, false, { refocus: true });
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.target.nextElementSibling.click();
        }
      });
      // Left empty: back to the actions. A question being written stays.
      body?.addEventListener('focusout', (e) => {
        const ask = e.target.closest?.('.wk-ask');
        if (!ask || ask.contains(e.relatedTarget) || ask.querySelector('.wk-ask-input').value.trim()) return;
        this.toggleAsk(body, false);
      });
      body?.addEventListener('input', (e) => {
        if (!e.target.matches('.wk-ask-input')) return;
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
      });
    }

    // Close popovers when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.toolMenu?.contains(e.target)) this.toolMenu?.classList.add('hidden');
    });

    // Notification dismiss
    this.notificationDismiss.addEventListener('click', () => this.hideNotification());

    // Notes panel buttons
    this.btnClearNotes.addEventListener('click', () => this.handleClearNotesClick());
    this.btnDownloadNotes.addEventListener('click', () => this.downloadNotes());
    this.btnCopyNotes.addEventListener('click', () => this.copyNotes());
    document.getElementById('btn-close-notes')?.addEventListener('click', () => this.toggleNotes());
    this.notesPanel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.notesOpen) this.toggleNotes();
    });


    // History panel buttons
    this.btnCloseHistory.addEventListener('click', () => this.historyPanel.classList.add('hidden'));
    // The Library's two tabs, in the header of each
    for (const sheet of [this.historyPanel, this.notesPanel]) {
      sheet.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-lib]')?.dataset.lib;
        if (tab) this.openLibrary(tab);
      });
    }
    this.historyPanel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.historyPanel.classList.add('hidden');
    });
    this.btnClearHistory.addEventListener('click', () => this.handleClearHistoryClick());
    this.btnExportHistory.addEventListener('click', () => this.exportHistory());
    this.historySearch.addEventListener('input', () => this.renderHistory());
    this.historyList.addEventListener('click', (e) => this.handleHistoryListClick(e));

    // Iframe load handling
    this.aiFrame.addEventListener('load', () => this.handleFrameLoad());

    // While anything scrolls, rows passing under the pointer don't take hover (see .is-scrolling)
    let scrolling;
    document.addEventListener('scroll', () => {
      document.documentElement.classList.add('is-scrolling');
      clearTimeout(scrolling);
      scrolling = setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 150);
    }, { capture: true, passive: true });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+S — capture the AI's last answer to history
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        this.captureLastAnswer();
      }
    });
  }

  // A new chat page: nothing has been said in it yet (see claimChat)
  loadCurrentAI() {
    this._chatSession = null;
    const model = this.getCurrentModel();
    if (model) {
      this.loadingState.classList.remove('hidden');
      this.chatNavigating();
      this.aiFrame.src = model.url;
    }
  }

  // "API" in the model menu: answers come from the model APIs in Settings
  // (free models first, then paid) instead of the chat site
  async useApi() {
    if (!buildRoute(await loadApiConfig()).length) {
      this.showNotification('Add an OpenRouter key or a local gateway in Settings → Model APIs first');
      chrome.runtime.openOptionsPage();
      return;
    }
    const changed = this.answerWith !== 'api';
    await this.setAnswerWith('api');
    if (changed) this.noteSwitch('API');
  }

  async setAnswerWith(v) {
    if (this.answerWith === v) return;
    this.answerWith = v;
    this._apiHistory = [];
    this.updateModelPill();
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, answerWith: v } });
    } catch (e) { /* stays for this session */ }
  }

  switchModel(modelId) {
    const changed = modelId !== this.currentModelId;
    this.currentModelId = modelId;
    this.saveCurrentModelId();
    this.loadCurrentAI();
    this.updateModelPill();
    if (changed) this.noteSwitch(this.getCurrentModel()?.name || 'another model');
  }

  // The next model picks up the conversation: its next question carries the
  // turns so far (see showAnswerIn). Say so where the conversation shows.
  noteSwitch(name) {
    if (!this.hasMessages?.()) return;
    this._handoff = this.threadTurns().length > 0;
    const note = document.createElement('div');
    note.className = 'thread-note';
    note.textContent = this._handoff ? `Switched to ${name} · it picks up this conversation` : `Switched to ${name} · new chat`;
    this.threadBody.appendChild(note);
    note.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  // The conversation's answered turns, oldest first (a retried answer's
  // turn goes with its card)
  threadTurns() {
    this._turns = (this._turns || []).filter(t => t.el.isConnected);
    return this._turns;
  }

  handleFrameLoad() {
    // In case the bridge announced itself before we were listening
    try { this.aiFrame.contentWindow.postMessage({ action: 'BRIDGE_PING' }, '*'); } catch (e) { /* ignore */ }

    setTimeout(() => {
      this.loadingState.classList.add('hidden');
    }, 500);
  }

  openNewChat() {
    // Refresh the iframe to start a new chat session
    const model = this.getCurrentModel();
    if (model) {
      this.loadingState.classList.remove('hidden');
      const url = new URL(model.url);
      url.searchParams.set('_yavar', Date.now());
      this.chatNavigating();
      this.aiFrame.src = url.href;
    }
  }

  // A model's mark: its initial in a small tile, the same in the pill and menu
  modelMark(m) {
    return `<span class="model-mark" data-model="${this.escapeHtml(m.id)}">${this.escapeHtml((m.name || '?').trim().charAt(0).toUpperCase())}</span>`;
  }

  // The header pill shows the current model; the composer is addressed to it
  updateModelPill() {
    const m = this.answerWith === 'api' ? { id: 'api', name: 'API' } : this.getCurrentModel();
    const icon = document.getElementById('app-model-icon');
    const name = document.getElementById('app-model-name');
    if (icon) icon.innerHTML = m ? this.modelMark(m) : '';
    if (name) name.textContent = m?.name || 'Choose a model';
    if (this.threadInput && !this.composerItems?.length && !this.composerTool) this.threadInput.placeholder = `Message ${m?.name || 'the AI'} · / for commands`;
  }

  // Menus in the Yavar view: + (add to the message), its prompt templates, and ⋯
  toolMenuItems(kind) {
    const { usable, gh, video } = this._tabCtx || {};
    const repo = gh ? `${gh.owner}/${gh.repo}` : '';
    if (kind === 'add') {
      const file = gh?.kind === 'blob' && gh.rest.length > 1 ? gh.rest[gh.rest.length - 1] : '';
      return [
        ...(file ? [{ id: 'attach_file', icon: icon('file'), name: file, desc: 'Open in your tab' }] : []),
        { id: 'pick_repo', icon: icon('book'), name: 'Files from this repository', desc: repo || 'Open a GitHub repository in your tab', disabled: !gh },
        { id: 'pick_local', icon: icon('folder'), name: 'Files from a folder', desc: 'A project on this computer' },
        { id: 'attach_page', icon: icon(video ? 'video' : 'file'), name: video ? "This video's transcript" : 'This page', desc: usable ? (video ? 'The captions of the video in your tab' : 'The text of the page in your tab') : 'Open a web page in your tab', disabled: !usable },
        { id: 'screenshot_attach', icon: icon('shot'), name: 'Screenshot', desc: usable ? 'Select an area of the page' : 'Open a web page in your tab', disabled: !usable },
        { id: 'prompts', icon: icon('sparkle'), name: 'Use a prompt', desc: 'Wrap your message in one of your templates' }
      ];
    }
    if (kind === 'prompts') {
      // A template that is only {{selection}} would leave your message as it is
      return (this._templates || []).filter(t => t.body.trim() !== '{{selection}}').map(t => ({ id: 'tpl:' + t.id, icon: this.escapeHtml(t.icon || '•'), name: t.name }));
    }
    if (kind === 'models') {
      const api = this.answerWith === 'api';
      return [
        ...this.models.filter(m => m.enabled).map(m => {
          const on = !api && m.id === this.currentModelId;
          return { id: 'model:' + m.id, icon: this.modelMark(m), name: m.name, checked: on, desc: on ? '' : 'Starts a new chat' };
        }),
        { id: 'answer:api', icon: this.modelMark({ id: 'api', name: 'API' }), name: 'API', checked: api,
          desc: 'Free models first, then paid', divider: true },
        { id: 'manage_models', icon: '<span class="model-mark is-plain">⋯</span>', name: 'Models and APIs', divider: true }
      ];
    }
    // On a GitHub repo the repo's actions stay here once the start page is gone
    const file = gh?.kind === 'blob' && gh.rest.length > 1 ? gh.rest[gh.rest.length - 1] : '';
    // (Asking about chosen files lives in the + menu: "Files from this repository".)
    const repoItems = gh ? [
      ...(file ? [{ id: 'walk_file', icon: icon('lines'), name: `Read ${file}`, desc: 'Block by block, beside the code' }] : []),
      { id: 'explain_repo', icon: icon('compass'), name: 'Read this repository', desc: this._tabCtx.journey || 'The big picture, then file by file' },
      { id: 'changes', icon: icon('commit'), name: 'Changes', desc: 'Recent commits, part by part' }
    ] : [];
    return [
      ...repoItems,
      { id: 'read_folder', icon: icon('folder'), name: 'Read a project folder', desc: 'A project on this computer', divider: repoItems.length > 0 },
      { id: 'review_changes', icon: icon('diff'), name: 'Changes in a folder', desc: 'Your work and recent commits' },
      { id: 'library', icon: icon('bookmark'), name: 'Library', desc: 'Your saved answers and notes', divider: true },
      ...(this._morfiaOn && this._tabCtx?.usable && !this._tabCtx.video
        ? [{ id: 'save_morfia', icon: icon('forward'), name: 'Add to Morfia', desc: 'Add this article to your Morfia library' }] : []),
      { id: 'carry_over', icon: icon('forward'), name: 'Continue in a fresh chat', desc: 'Summarize this chat into a new one', divider: true },
      { id: 'settings', icon: icon('settings'), name: 'Settings' }
    ];
  }

  // icon is markup; name and desc are text
  menuItemsHtml(items, active = -1) {
    return items.map((t, i) =>
      (t.divider ? '<div class="lens-divider" role="separator"></div>' : '') +
      `<button type="button" role="${t.checked != null ? 'menuitemradio' : 'menuitem'}" class="lens-item${t.disabled ? ' is-disabled' : ''}${i === active ? ' is-active' : ''}" data-tool="${this.escapeHtml(t.id)}"` +
      `${t.disabled ? ' disabled' : ''}${t.checked != null ? ` aria-checked="${t.checked}"` : ''}>` +
      `<span class="lens-emoji">${t.icon}</span><span class="lens-text"><span class="lens-name">${this.escapeHtml(t.name)}</span>` +
      (t.desc ? `<span class="lens-desc">${this.escapeHtml(t.desc)}</span>` : '') + `</span>` +
      (t.checked ? '<svg class="lens-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>' : '') +
      `</button>`).join('');
  }

  toggleToolMenu(kind, anchor, fromKeyboard = false) {
    const menu = this.toolMenu;
    if (!menu) return;
    if (!menu.classList.contains('hidden') && menu.dataset.kind === kind) {
      menu.classList.add('hidden');
      return;
    }
    this._cmd = null;
    menu.dataset.kind = kind;
    const title = { add: 'Add to message', prompts: 'Use a prompt', more: '', models: '' }[kind];
    const head = document.getElementById('tool-menu-title');
    head.textContent = title;
    head.hidden = !title;
    document.getElementById('tool-menu-list').innerHTML = this.menuItemsHtml(this.toolMenuItems(kind));
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    if (kind === 'models') {
      // Under the model pill, left-aligned
      menu.style.right = 'auto';
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
    } else if (kind === 'more') {
      // Under the header button, right-aligned
      menu.style.left = 'auto';
      menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
    } else {
      // Above the composer's + button
      menu.style.right = 'auto';
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.style.top = Math.max(8, r.top - menu.offsetHeight - 8) + 'px';
    }
    if (fromKeyboard) menu.querySelector('button:not([disabled])')?.focus();
  }

  // One place for every action: the start page, the menus, the context menu
  // and shortcuts (queued as pendingAction) all come through here
  runTool(id) {
    if (id.startsWith('tpl:')) { this.applyTemplate(id.slice(4)); return; }
    if (id.startsWith('model:')) {
      // From API back to the chat site already open: still a switch for the conversation
      const sameSite = this.answerWith === 'api' && id.slice(6) === this.currentModelId;
      this.setAnswerWith('chat');
      this.switchModel(id.slice(6));
      if (sameSite) this.noteSwitch(this.getCurrentModel()?.name || 'the chat');
      return;
    }
    if (id === 'answer:api') { this.useApi(); return; }
    const tools = {
      changes: () => this.openChanges(),
      add_page: () => this.attachActivePage(),
      attach_page: () => this.attachActivePage(),
      attach_file: () => this.quickAddActiveFile('add'),
      summarize_page: () => this.summarizeActivePage(),
      walk_file: () => this.walkActiveFile(),
      walk_diff: () => this.walkActiveDiff(),
      explain_repo: () => this.openJourney(),
      read_folder: () => this.openJourney({ folder: true }),
      review_changes: () => this.startReview(),
      review_last: () => this.reviewLast(),
      library: () => this.openLibrary(),
      history: () => this.openLibrary('answers'),
      notes: () => this.toggleNotes(),
      settings: () => chrome.runtime.openOptionsPage(),
      manage_models: () => chrome.runtime.openOptionsPage(),
      new: () => this.newConversation(),
      chat: () => this.setView('chat'),
      pick_repo: () => this.openPicker('repo'),
      pick_local: () => this.openPicker('local'),
      screenshot: () => this.captureScreenshot(),
      screenshot_attach: () => this.captureScreenshot(),
      prompts: () => this.toggleToolMenu('prompts', document.getElementById('composer-add')),
      local: () => this.openPicker('local'),
      carry_over: () => this.carryOverToNewChat(),
      ielts: () => this.startCoach(),
      save_morfia: () => this.saveForMorfia()
    };
    tools[id]?.();
  }

  // Two-click confirm (window.confirm is unreliable inside side panels):
  // true on a second click within 3 s; otherwise arms and shows the hint.
  confirmTwice(key, hint = 'Click clear again to confirm') {
    this._armed = this._armed || new Map();
    if (this._armed.has(key)) {
      clearTimeout(this._armed.get(key));
      this._armed.delete(key);
      return true;
    }
    this._armed.set(key, setTimeout(() => this._armed.delete(key), 3000));
    this.showNotification(hint);
    return false;
  }

  escapeHtml(s) {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // The main screen. Conversations run in the chat behind it (a private one
  // by default); here you read the answers, attach pages and files, and
  // start from what's open in your tab. "Chat" shows the real chat.
  setupThread() {
    this.appView = document.getElementById('app-view');
    this.threadBody = document.getElementById('thread-body');
    this.threadInput = document.getElementById('thread-input');
    this.composerItems = [];
    if (!this.appView) return;
    document.getElementById('app-to-chat')?.addEventListener('click', () => this.setView('chat'));
    document.getElementById('back-to-yavar')?.addEventListener('click', () => this.setView('app'));
    document.getElementById('chat-screenshot')?.addEventListener('click', () => this.captureScreenshot('chat'));
    document.getElementById('app-new')?.addEventListener('click', () => this.newConversation());
    document.getElementById('app-model')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleToolMenu('models', e.currentTarget, e.detail === 0);
    });
    document.getElementById('app-more')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleToolMenu('more', e.currentTarget, e.detail === 0);
    });
    this.setupPicker();
    // "↓ Latest" when you've scrolled up away from the newest message
    const latest = document.createElement('button');
    latest.type = 'button';
    latest.className = 'thread-latest hidden';
    latest.textContent = '↓ Latest';
    latest.addEventListener('click', () => this.threadBody.scrollTo({ top: this.threadBody.scrollHeight, behavior: 'smooth' }));
    this.appView.querySelector('.composer').prepend(latest);
    this.threadBody.addEventListener('scroll', () => {
      const away = this.threadBody.scrollHeight - this.threadBody.scrollTop - this.threadBody.clientHeight;
      latest.classList.toggle('hidden', away < 240);
    }, { passive: true });
    // The dimmed area behind the file picker closes it (app-view's ::before)
    this.appView.addEventListener('click', (e) => {
      if (e.target === this.appView) this.closePicker();
    });
    this.updateModelPill();
    document.getElementById('thread-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendComposer();
    });
    this.threadInput?.addEventListener('keydown', (e) => {
      if (!e.isComposing && this.commandMenuKey(e)) return;
      if (this.composerTool && this.composerTool !== 'coach' && (e.key === 'Escape' || (e.key === 'Backspace' && !this.threadInput.value))) {
        e.preventDefault();
        this.clearComposerTool();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.sendComposer();
      }
    });
    this.threadInput?.addEventListener('input', () => {
      this.threadInput.style.height = 'auto';
      this.threadInput.style.height = Math.min(this.threadInput.scrollHeight, 140) + 'px';
      this.updateSendState();
      this.updateCommandMenu();
    });
    this.threadInput?.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      this.addDroppedFiles(files);
    });
    this.appView.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      this.appView.classList.add('is-dropping');
    });
    this.appView.addEventListener('dragleave', (e) => {
      if (!this.appView.contains(e.relatedTarget)) this.appView.classList.remove('is-dropping');
    });
    this.appView.addEventListener('drop', (e) => {
      this.appView.classList.remove('is-dropping');
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      this.addDroppedFiles(files);
    });
    document.getElementById('composer-add')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleToolMenu('add', e.currentTarget, e.detail === 0);
    });
    document.getElementById('composer-items')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-tool]')) { this.clearComposerTool(); this.threadInput.focus(); return; }
      const x = e.target.closest('[data-remove]');
      if (!x) return;
      this.composerItems.splice(Number(x.dataset.remove), 1);
      this.renderComposer();
    });
    document.getElementById('composer-modes')?.addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]')?.dataset.mode;
      if (mode) this.sendComposer(mode);
    });
    this.threadBody.addEventListener('click', (e) => {
      const act = e.target.closest('[data-home]')?.dataset.home;
      if (act) this.runTool(act);
    });
    this.setView('app');
    this.renderHome();
  }

  setView(view) {
    this._view = view;
    this.appView?.classList.toggle('hidden', view !== 'app');
    document.getElementById('chat-bar')?.classList.toggle('hidden', view !== 'chat');
    if (view !== 'app') this.closePicker();
    if (view === 'app') setTimeout(() => this.threadInput?.focus({ preventScroll: true }), 0);
  }

  hasMessages() {
    return !!this.threadBody?.querySelector('.thread-q');
  }

  // Start page: what you can do with the tab you're on
  renderHome() {
    if (!this.threadBody || this.hasMessages()) return;
    const { usable, gh, url } = this._tabCtx || {};
    const row = (id, icon, name, desc = '') =>
      `<button type="button" class="home-row" data-home="${id}"><span class="home-ico" aria-hidden="true">${icon}</span>` +
      `<span class="home-text"><span class="home-name">${this.escapeHtml(name)}</span>` +
      (desc ? `<span class="home-desc">${this.escapeHtml(desc)}</span>` : '') + `</span><span class="home-chev" aria-hidden="true">›</span></button>`;
    let hero;
    let ctx = '';
    if (gh) {
      const file = gh.kind === 'blob' && gh.rest.length > 1 ? gh.rest[gh.rest.length - 1] : '';
      hero = { kicker: 'GitHub repository', title: `${gh.owner}/${gh.repo}` };
      ctx = `<div class="home-group">` +
        (gh.kind === 'pull' || gh.kind === 'commit'
          ? row('walk_diff', icon('diff'), gh.kind === 'pull' ? `Read pull request #${gh.number}` : 'Read this commit', 'Part by part, beside the code') : '') +
        (file ? row('walk_file', icon('lines'), `Read ${file}`, 'Block by block, beside the code') : '') +
        row('explain_repo', icon('compass'), 'Read this repository', this._tabCtx.journey || 'The big picture first, then file by file') +
        row('changes', icon('commit'), 'Changes', 'Recent commits, part by part') +
        `</div>`;
    } else if (usable) {
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      hero = { kicker: host || 'This page', title: 'Start from this page' };
      ctx = `<div class="home-group">` +
        row('summarize_page', icon('lines'), 'Summarize', 'The main point and key details') +
        row('attach_page', icon('chat'), 'Ask about it', 'Attach the page, then ask your question') +
        (this._coachOn && !this._tabCtx.video ? row('ielts', icon('pen'), 'IELTS practice', 'Five steps, your attempt first') : '') +
        (this._morfiaOn && !this._tabCtx.video ? row('save_morfia', icon('forward'), 'Add to Morfia', 'Add this article to your Morfia library') : '') +
        `</div>`;
    } else {
      hero = { kicker: 'Yavar', title: 'Ask anything' };
      ctx = `<div class="home-group">` +
        row('read_folder', icon('folder'), 'Read a project folder', 'The big picture first, then file by file') +
        row('review_changes', icon('diff'), 'Changes in a project folder', 'Your work before you commit or push, and recent commits') +
        `</div>`;
    }
    // The project reviewed last, whatever the tab shows
    const review = this._reviewFolder
      ? `<div class="home-group">${row('review_last', icon('diff'), `Changes · ${this._reviewFolder.name}`, 'Your work and recent commits, line by line')}</div>` : '';
    if (review) ctx = ctx.replace(row('review_changes', icon('diff'), 'Changes in a project folder', 'Your work before you commit or push, and recent commits'), '');
    this.threadBody.innerHTML =
      `<div class="home">` +
        `<div class="home-hero"><span class="home-kicker">${this.escapeHtml(hero.kicker)}</span><h2>${this.escapeHtml(hero.title)}</h2></div>` +
        ctx + review +
      `</div>`;
    document.getElementById('thread-title').textContent = '';
    document.getElementById('thread-sub').textContent = '';
    document.getElementById('thread-private')?.classList.add('hidden');
  }

  async newConversation() {
    if (this.threadBusy()) {
      this.stopThread();
      await new Promise(r => setTimeout(r, 0));   // let the stopped answer unwind
    }
    this.threadBody.innerHTML = '';
    this.composerItems = [];
    this.composerTool = null;
    this._coach = null;
    this.renderComposer();
    this._freshChatNext = true;
    this._threadId = (this._threadId || 0) + 1;
    this._chatSession = null;
    this._apiHistory = [];
    this._turns = [];
    this._handoff = false;
    this.renderHome();
    this.setView('app');
  }

  threadBusy() {
    return this.appView?.classList.contains('is-busy');
  }

  // Stop waiting for the answer (the chat may still finish it; "Open chat" shows it)
  stopThread() {
    if (!this.threadBusy()) return;
    if (this._apiAbort) { this._apiAbort.abort(); return; }
    this.postToChat({ action: 'STOP_WATCH' });
    this.cancelChatRequests('stopped');
  }

  setBusy(busy) {
    this.appView?.classList.toggle('is-busy', busy);
    const send = document.getElementById('thread-send');
    if (!send) return;
    send.title = busy ? 'Stop waiting' : 'Send (Enter)';
    send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    send.innerHTML = busy
      ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="currentColor"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>';
  }

  openThread({ title, sub = '' } = {}) {
    // The answer shows in the main view: put away sheets that would cover it
    this.historyPanel?.classList.add('hidden');
    if (!this.hasMessages()) {
      this.threadBody.innerHTML = '';
      if (title) document.getElementById('thread-title').textContent = title;
      document.getElementById('thread-sub').textContent = sub;
    }
    this.setView('app');
  }

  addThreadQuestion(label, items = []) {
    this.threadBody.querySelectorAll('.answer-followups').forEach(el => el.remove());
    const q = document.createElement('div');
    q.className = 'thread-q';
    q.textContent = label;
    // Put the question back in the message box to change and resend it
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'thread-q-edit';
    edit.title = 'Edit and ask again';
    edit.setAttribute('aria-label', 'Edit and ask again');
    edit.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
    edit.addEventListener('click', () => this.fillComposer(label));
    q.appendChild(edit);
    if (items.length) {
      const chips = document.createElement('div');
      chips.className = 'thread-q-items';
      chips.textContent = items.map(i => '📎 ' + i.label).join('   ');
      q.prepend(chips);
    }
    this.threadBody.appendChild(q);
    q.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // Ask the chat and stream the answer into the Yavar view
  async askInThread({ title, sub = '', label, prompt, attachments = [], items = [], project = null }) {
    if (!this.appView) return null;
    if (this.threadBusy()) { this.showNotification('Wait for the current answer, or press ■ to stop it'); return null; }
    this.openThread({ title, sub });
    this.addThreadQuestion(label, items);
    this.setBusy(true);
    try {
      const name = this.answerWith === 'api' ? 'API' : this.getCurrentModel()?.name || 'Answer';
      const text = await this.showAnswerIn(this.threadBody, name, prompt, { attachments, collapsible: false, saveAs: { prompt: label } });
      // A file pack's answer may ask for more of the project's files
      return project ? await this.answerWithFiles(this.threadBody, name, text, project) : text;
    } finally {
      this.setBusy(false);
      document.getElementById('thread-private')?.classList.toggle('hidden', !this._chatIsTemp || this.answerWith === 'api');
    }
  }

  showNotification(text) {
    this.notificationText.textContent = text;
    this.notificationBar.classList.remove('hidden');

    // Restart the timer so a newer message isn't hidden by an older one's timeout
    clearTimeout(this._notificationTimer);
    this._notificationTimer = setTimeout(() => this.hideNotification(), 4000);
  }

  hideNotification() {
    this.notificationBar.classList.add('hidden');
  }

  // The in-chat "Prompts" menu lists the user's templates
  async loadPromptTemplates() {
    try { this._templates = await loadTemplates(); } catch (e) { this._templates = []; }
  }

  // "Use a prompt": expand a template around what you typed in the message box
  async applyTemplate(id) {
    const tpl = (this._templates || []).find(t => t.id === id);
    if (!tpl) return;
    const vars = varsInTemplate(tpl.body);
    const ctx = { selection: this.threadInput.value.trim() };
    try {
      const [tab] = await this.getActiveTabs();
      ctx.url = tab?.url || '';
      ctx.title = tab?.title || '';
      const gh = parseGitHubUrl(ctx.url);
      if (gh) ctx.repo = `${gh.owner}/${gh.repo}`;
    } catch (e) { /* no tab info */ }
    if (vars.includes('selection') && !ctx.selection) {
      this.showNotification(`Type or paste something first, then choose “${tpl.name}”`);
      this.threadInput.focus();
      return;
    }
    if (vars.includes('page')) {
      try { ctx.page = (await this.getActivePageText(12000)).text; }
      catch (e) { this.showNotification('Could not read the page: ' + e.message); return; }
    }
    this.threadInput.value = '';
    this.fillComposer(await expandTemplate(tpl.body, ctx));
  }

  // Buttons inside the chat page (bridge → panel)
  async handleInChatAction(data) {
    if (data.action === 'YAVAR_TO_NOTES') {
      this.appendToNotes({ ts: Date.now(), platform: this.getCurrentModel()?.name || data.platform || 'AI', prompt: data.prompt || '', answer: data.text || '' });
      this.showNotification('📝 Added to notes');
    } else if (data.action === 'YAVAR_COPY') {
      try { await navigator.clipboard.writeText(data.text || ''); } catch (e) { /* ignore */ }
    }
  }

  // A request queued by the context menu or a shortcut before the panel was open
  runPendingAction(action) {
    this.setView('app');
    this.runTool(action);
  }

  // Text sent from the context menu ("Send selection", "Explain code"): into
  // the message box, so you can add a question before sending
  handlePendingText(text) {
    this.fillComposer(text);
  }

  fillComposer(text) {
    this.setView('app');
    const input = this.threadInput;
    if (!input) return;
    input.value = input.value.trim() ? `${input.value.trim()}\n\n${text}` : text;
    input.dispatchEvent(new Event('input'));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.promptTemplates) this.loadPromptTemplates();
      if (areaName === 'sync' && changes[PROMPTS_KEY]) this._promptEdits = changes[PROMPTS_KEY].newValue || {};
      if (areaName === 'sync' && changes.aiModels) this.onModelsChanged(changes.aiModels.newValue);
      if (areaName === 'sync' && changes.settings) {
        this.answerWith = changes.settings.newValue?.answerWith === 'api' ? 'api' : 'chat';
        this.updateModelPill();
        const { ieltsCoach, morfia } = changes.settings.newValue || {};
        if (!!ieltsCoach !== this._coachOn || !!morfia !== this._morfiaOn) {
          this._coachOn = !!ieltsCoach;
          this._morfiaOn = !!morfia;
          this.renderHome();
        }
      }
      if (areaName === 'local' && changes.yavarHistory && this._history) {
        this._history = changes.yavarHistory.newValue || [];
      }
      if (areaName !== 'session') return;

      if (changes.fileEdited?.newValue) this.onFileEdited(changes.fileEdited.newValue);
      if (PENDING_KEYS.some(k => changes[k]?.newValue !== undefined)) this.drainPending();
    });
  }

  // Items handed over through chrome.storage.session (floating-menu prompt,
  // context-menu text, queued actions, screenshots). One serialized drain
  // reads and removes them, so however many signals arrive (panel open,
  // storage changes), each item is handled exactly once.
  drainPending() {
    this._drain = (this._drain || Promise.resolve())
      .then(() => this.drainPendingOnce())
      .catch(e => console.error('[Yavar] Failed to handle pending items:', e));
    return this._drain;
  }

  async drainPendingOnce() {
    const r = await chrome.storage.session.get(PENDING_KEYS);
    const present = PENDING_KEYS.filter(k => r[k] !== undefined);
    if (!present.length) return;
    await chrome.storage.session.remove(present);

    if (r.pendingAction) this.runPendingAction(r.pendingAction);
    // The reader's ‹ › or its sign by the highlight (it opened this panel if it was closed)
    if (r.readerNav && Date.now() - r.readerNav.ts < 60000) this.followReader(r.readerNav);
    if (r.pendingText) this.handlePendingText(r.pendingText);
    if (r.pendingSelection?.text) this.attachSelection(r.pendingSelection);
    if (r.pendingScreenshot) this.attachScreenshot(r.pendingScreenshot, r.pendingScreenshotRect, r.pendingCapture);
    // Floating-menu prompts older than 2 minutes are stale (panel closed meanwhile)
    if (r.pendingAutoSubmit && Date.now() - (r.lastSubmitTime || 0) < 120000) {
      this.handlePendingPrompt(r.pendingAutoSubmit, r.pendingPromptLabel);
    }
  }

  // A floating-menu prompt: asked in the thread, or left in the message box
  // to review when "send right away" is off (or an answer is still coming)
  async handlePendingPrompt(prompt, label) {
    let autoSubmit = false;
    try { autoSubmit = !!(await chrome.storage.sync.get('settings')).settings?.autoSubmit; } catch (e) { /* review first */ }
    if (!autoSubmit || this.threadBusy()) {
      this.fillComposer(prompt);
      return;
    }
    this.askInThread({ title: 'Yavar', label: label || prompt.slice(0, 120), prompt });
  }

  // The last prompt we put in the chat, to pair with a saved answer
  rememberPrompt(prompt) {
    this._lastPrompt = prompt;
    this._lastPromptTime = Date.now();
  }
}

// The panel's features live in src/panel/, one class of methods each; their
// methods join the panel's here, so each keeps `this` as the panel.
for (const part of [ChatPart, AnswersPart, RepoPart, ContextPart, SheetsPart, WalkPart, JourneyPart, ReviewPart, ComposerPart, TabPart, CapturePart, HistoryPart, NotesPart, LabsPart]) {
  for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
    if (name === 'constructor') continue;
    if (name in YavarSidePanel.prototype) throw new Error(`${part.name}.${name} is defined twice`);
    Object.defineProperty(YavarSidePanel.prototype, name, desc);
  }
}


// Initialize panel
const panel = new YavarSidePanel();
