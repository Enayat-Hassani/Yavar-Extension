// Options Page - the one place for Yavar's settings

import { loadTemplates, saveTemplates, DEFAULT_TEMPLATES } from './utils/templates.js';
import { loadModels } from './utils/models.js';
import { OPENROUTER_BASE, DEFAULT_MONTHLY_CAP, isFreeModel, loadApiConfig, buildRoute, askWithBudget, loadSpend, spentThisMonth } from './utils/llm.js';

const DEFAULT_SETTINGS = {
  defaultAI: 'chatgpt',
  enableFloatingMenu: true,
  disabledSites: [],
  autoSubmit: false,
  tempChats: true,
  deepResearch: false,
  inChatButtons: true,
  ytxBaseUrl: 'http://localhost:8722',
  ytxVideoCount: 12,
  answerWith: 'chat',
  apiFreeModels: [],
  apiPaidModel: '',
  apiMonthlyCap: DEFAULT_MONTHLY_CAP,
  apiGatewayBase: '',
  apiGatewayModel: ''
};

// Toggles that map one checkbox to one boolean setting
const TOGGLES = {
  'enable-floating-menu': 'enableFloatingMenu',
  'setting-auto-submit': 'autoSubmit',
  'setting-temp-chats': 'tempChats',
  'setting-deep-research': 'deepResearch',
  'setting-inchat': 'inChatButtons'
};

class OptionsPage {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.models = [];
    this.templates = [];
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();
    await this.loadModelsList();
    this.renderShortcuts();
    this.loadGithubToken();
    this.loadApiKeys();
    const version = document.getElementById('app-version');
    if (version) version.textContent = 'v' + chrome.runtime.getManifest().version;
    this.templates = await loadTemplates();
    this.renderTemplates();
    // The panel's model menu changes the current model: keep the select in step
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.aiModels || changes.currentModelId)) this.loadModelsList();
    });
  }

  cacheElements() {
    this.defaultAiSelect = document.getElementById('default-ai');
    this.modelsList = document.getElementById('models-list');
    this.addModelForm = document.getElementById('add-model-form');

    this.ytxBaseUrlInput = document.getElementById('ytx-base-url');
    this.ytxVideoCountInput = document.getElementById('ytx-video-count');

    this.disabledSiteInput = document.getElementById('disabled-site');
    this.addSiteBtn = document.getElementById('add-site-btn');
    this.disabledSitesList = document.getElementById('disabled-sites-list');

    this.exportSettingsBtn = document.getElementById('export-settings-btn');
    this.importSettingsBtn = document.getElementById('import-settings-btn');
    this.resetSettingsBtn = document.getElementById('reset-settings-btn');
    this.importFileInput = document.getElementById('import-file');

    this.configureShortcutsBtn = document.getElementById('configure-shortcuts-btn');

    this.templatesList = document.getElementById('templates-list');
    this.addTemplateBtn = document.getElementById('add-template-btn');
    this.resetTemplatesBtn = document.getElementById('reset-templates-btn');

    this.shortcutsList = document.getElementById('shortcuts-list');
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.defaultAiSelect.addEventListener('change', () => this.saveDefaultModel());
    this.addModelForm.addEventListener('submit', (e) => this.addModel(e));
    this.modelsList.addEventListener('change', (e) => {
      const id = e.target.closest('[data-model-toggle]')?.dataset.modelToggle;
      if (id) this.setModelEnabled(id, e.target.checked);
    });
    this.modelsList.addEventListener('click', (e) => {
      const id = e.target.closest('[data-model-delete]')?.dataset.modelDelete;
      if (id) this.deleteModel(id);
    });

    for (const [elId, key] of Object.entries(TOGGLES)) {
      document.getElementById(elId)?.addEventListener('change', (e) => this.saveSetting({ [key]: e.target.checked }));
    }

    this.ytxBaseUrlInput?.addEventListener('change', () => this.saveSetting({
      ytxBaseUrl: this.ytxBaseUrlInput.value.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.ytxBaseUrl
    }));
    this.ytxVideoCountInput?.addEventListener('change', () => {
      const count = parseInt(this.ytxVideoCountInput.value, 10);
      this.saveSetting({ ytxVideoCount: Number.isFinite(count) ? Math.min(50, Math.max(1, count)) : 12 });
    });

    document.getElementById('save-github-token')?.addEventListener('click', () => this.saveGithubToken());

    document.getElementById('save-openrouter-key')?.addEventListener('click', () => this.saveLocalKey('openrouterKey', 'openrouter-key'));
    document.getElementById('gateway-key')?.addEventListener('change', () => this.saveLocalKey('gatewayKey', 'gateway-key'));
    document.getElementById('load-free-models')?.addEventListener('click', () => this.loadFreeModels());
    document.getElementById('free-models')?.addEventListener('change', () => this.saveFreeModels());
    document.getElementById('paid-model')?.addEventListener('change', (e) => this.saveSetting({ apiPaidModel: e.target.value.trim() }));
    document.getElementById('monthly-cap')?.addEventListener('change', (e) => {
      const cap = parseFloat(e.target.value);
      this.saveSetting({ apiMonthlyCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_CAP }).then(() => this.showSpend());
    });
    document.getElementById('gateway-base')?.addEventListener('change', (e) => this.saveSetting({ apiGatewayBase: e.target.value.trim().replace(/\/+$/, '') }));
    document.getElementById('gateway-model')?.addEventListener('change', (e) => this.saveSetting({ apiGatewayModel: e.target.value.trim() }));
    document.getElementById('test-api')?.addEventListener('click', () => this.testApi());

    this.addSiteBtn.addEventListener('click', () => this.addDisabledSite());
    // Delegated: inline onclick handlers are blocked by the extension CSP
    this.disabledSitesList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-site]');
      if (btn) this.removeDisabledSite(btn.dataset.removeSite);
    });
    this.disabledSiteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addDisabledSite();
    });

    this.exportSettingsBtn.addEventListener('click', () => this.exportSettings());
    this.importSettingsBtn.addEventListener('click', () => this.importFileInput.click());
    this.importFileInput.addEventListener('change', (e) => this.handleImport(e));
    this.resetSettingsBtn.addEventListener('click', () => this.resetSettings());

    this.configureShortcutsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    this.addTemplateBtn?.addEventListener('click', () => this.addTemplate());
    this.resetTemplatesBtn?.addEventListener('click', () => this.resetTemplates());
    this.templatesList?.addEventListener('input', (e) => this.handleTemplateEdit(e));
    this.templatesList?.addEventListener('change', (e) => this.handleTemplateEdit(e));
    // Don't lose a debounced template edit when the tab closes
    window.addEventListener('pagehide', () => {
      if (this._persistTimer) this.persistTemplates();
    });
    this.templatesList?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) this.deleteTemplate(parseInt(del.dataset.del, 10));
    });
  }

  async loadSettings() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      this.settings = { ...DEFAULT_SETTINGS, ...settings };
    } catch (error) {
      console.error('[Yavar] Failed to load settings:', error);
    }
    this.populateForm();
  }

  // Merge into what's stored now, not into what this page loaded: the panel
  // writes settings too
  async saveSetting(patch) {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      this.settings = { ...DEFAULT_SETTINGS, ...settings, ...patch };
      await chrome.storage.sync.set({ settings: this.settings });
    } catch (error) {
      console.error('[Yavar] Failed to save settings:', error);
      this.showToast('Could not save the setting', true);
    }
  }

  populateForm() {
    for (const [elId, key] of Object.entries(TOGGLES)) {
      const el = document.getElementById(elId);
      if (el) el.checked = !!this.settings[key];
    }
    if (this.ytxBaseUrlInput) this.ytxBaseUrlInput.value = this.settings.ytxBaseUrl;
    if (this.ytxVideoCountInput) this.ytxVideoCountInput.value = this.settings.ytxVideoCount;
    document.getElementById('paid-model').value = this.settings.apiPaidModel || '';
    document.getElementById('monthly-cap').value = this.settings.apiMonthlyCap;
    this.showSpend();
    document.getElementById('gateway-base').value = this.settings.apiGatewayBase || '';
    document.getElementById('gateway-model').value = this.settings.apiGatewayModel || '';
    this.renderFreeModels();
    this.renderDisabledSites();
  }

  // ===== Models =====
  async loadModelsList() {
    try {
      this.models = await loadModels();
      const { currentModelId } = await chrome.storage.sync.get('currentModelId');
      this.currentModelId = currentModelId || this.settings.defaultAI;
    } catch (error) {
      console.error('[Yavar] Failed to load models:', error);
    }
    this.renderModels();
  }

  renderModels() {
    const enabled = this.models.filter(m => m.enabled);
    this.defaultAiSelect.innerHTML = enabled.map(m =>
      `<option value="${this.escapeHtml(m.id)}">${this.escapeHtml(m.name)}</option>`).join('');
    if (enabled.some(m => m.id === this.currentModelId)) this.defaultAiSelect.value = this.currentModelId;

    this.modelsList.innerHTML = this.models.map(m => `
      <div class="model-row">
        <span class="model-row-icon" aria-hidden="true">${this.escapeHtml(m.icon || '🌐')}</span>
        <span class="model-row-info">
          <span class="model-row-name">${this.escapeHtml(m.name)}</span>
          <span class="model-row-url">${this.escapeHtml(m.url)}</span>
        </span>
        ${m.custom ? `<button type="button" class="btn-icon-danger" data-model-delete="${this.escapeHtml(m.id)}" title="Delete ${this.escapeHtml(m.name)}" aria-label="Delete ${this.escapeHtml(m.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>` : ''}
        <label class="toggle-label" title="Show in the model menu">
          <input type="checkbox" data-model-toggle="${this.escapeHtml(m.id)}" ${m.enabled ? 'checked' : ''}
                 aria-label="Show ${this.escapeHtml(m.name)} in the model menu">
          <span class="toggle"></span>
        </label>
      </div>`).join('');
  }

  async saveModels() {
    try {
      await chrome.storage.sync.set({ aiModels: this.models });
    } catch (error) {
      console.error('[Yavar] Failed to save models:', error);
      this.showToast('Could not save the models', true);
    }
  }

  async setModelEnabled(id, enabled) {
    const model = this.models.find(m => m.id === id);
    if (!model) return;
    if (!enabled && this.models.filter(m => m.enabled).length === 1) {
      this.showToast('Keep at least one model on', true);
      this.renderModels();
      return;
    }
    model.enabled = enabled;
    await this.saveModels();
    this.renderModels();
  }

  async deleteModel(id) {
    const model = this.models.find(m => m.id === id);
    if (!model?.custom) return;
    if (!confirm(`Delete ${model.name}?`)) return;
    this.models = this.models.filter(m => m.id !== id);
    await this.saveModels();
    this.renderModels();
  }

  async addModel(e) {
    e.preventDefault();
    const name = document.getElementById('model-name').value.trim();
    const url = document.getElementById('model-url').value.trim();
    if (!name || !url) return;
    // Only real web pages can be framed; reject javascript:, file:, typos, etc.
    let parsed;
    try { parsed = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url); } catch (err) { parsed = null; }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      this.showToast('Enter a valid http(s) URL', true);
      return;
    }
    this.models.push({ id: 'custom_' + Date.now(), name, url: parsed.href, icon: '🌐', enabled: true, custom: true });
    await this.saveModels();
    this.addModelForm.reset();
    this.renderModels();
    this.showToast(`${name} added`);
  }

  // The side panel opens whichever model is current, so set both.
  async saveDefaultModel() {
    this.currentModelId = this.defaultAiSelect.value;
    await this.saveSetting({ defaultAI: this.currentModelId });
    try {
      await chrome.storage.sync.set({ currentModelId: this.currentModelId });
      this.showToast('Saved');
    } catch (error) {
      console.error('[Yavar] Failed to save default model:', error);
    }
  }

  // ===== GitHub token (local only) =====
  async loadGithubToken() {
    try {
      const { githubToken } = await chrome.storage.local.get('githubToken');
      document.getElementById('github-token').value = githubToken || '';
    } catch (e) { /* leave empty */ }
  }

  async saveGithubToken() {
    const token = document.getElementById('github-token').value.trim();
    await chrome.storage.local.set({ githubToken: token });
    this.showToast(token ? 'Token saved' : 'Token removed');
  }

  // ===== Model APIs (keys local only) =====
  async loadApiKeys() {
    try {
      const keys = await chrome.storage.local.get(['openrouterKey', 'gatewayKey']);
      document.getElementById('openrouter-key').value = keys.openrouterKey || '';
      document.getElementById('gateway-key').value = keys.gatewayKey || '';
    } catch (e) { /* leave empty */ }
  }

  async saveLocalKey(storageKey, inputId) {
    const value = document.getElementById(inputId).value.trim();
    await chrome.storage.local.set({ [storageKey]: value });
    this.showToast(value ? 'Key saved' : 'Key removed');
  }

  // OpenRouter's current free models, biggest context first; ticked ones are
  // the chosen models (kept in the order you chose them)
  async loadFreeModels() {
    const btn = document.getElementById('load-free-models');
    btn.disabled = true;
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`);
      if (!res.ok) throw new Error('OpenRouter answered ' + res.status);
      const { data } = await res.json();
      this.freeCatalog = (data || []).filter(isFreeModel)
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
      this.renderFreeModels();
    } catch (e) {
      this.showToast('Could not load the models: ' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  renderFreeModels() {
    const box = document.getElementById('free-models');
    const chosen = this.settings.apiFreeModels || [];
    // Chosen models first, in order, even before the list is loaded
    const byId = new Map((this.freeCatalog || []).map(m => [m.id, m]));
    const rows = [...chosen.map(id => byId.get(id) || { id }), ...(this.freeCatalog || []).filter(m => !chosen.includes(m.id))];
    if (!rows.length) return;
    box.innerHTML = rows.map(m => {
      const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}k context` : '';
      const n = chosen.indexOf(m.id);
      return `<label class="free-model"><input type="checkbox" value="${this.escapeHtml(m.id)}"${n >= 0 ? ' checked' : ''}>` +
        `<span class="free-model-name">${n >= 0 ? `<b>${n + 1}.</b> ` : ''}${this.escapeHtml(m.name || m.id)}</span>` +
        `<span class="free-model-meta">${this.escapeHtml(ctx)}</span></label>`;
    }).join('');
  }

  saveFreeModels() {
    const ticked = [...document.querySelectorAll('#free-models input:checked')].map(i => i.value);
    const kept = (this.settings.apiFreeModels || []).filter(id => ticked.includes(id));
    const added = ticked.filter(id => !kept.includes(id));
    this.saveSetting({ apiFreeModels: [...kept, ...added] }).then(() => this.renderFreeModels());
  }

  async showSpend() {
    const el = document.getElementById('spent-this-month');
    try {
      const spent = spentThisMonth(await loadSpend());
      el.textContent = `Spent this month: $${spent.toFixed(spent && spent < 0.01 ? 4 : 2)} of $${Number(this.settings.apiMonthlyCap).toFixed(2)}. At the limit, Yavar uses only the free models until next month.`;
    } catch (e) { el.textContent = ''; }
  }

  async testApi() {
    const out = document.getElementById('test-api-result');
    const route = buildRoute(await loadApiConfig());
    out.textContent = 'Asking…';
    try {
      const { text, step, cost } = await askWithBudget(route, [{ role: 'user', content: 'Reply with just: OK' }], {
        onAttempt: (s) => { out.textContent = `Trying ${s.label}…`; }
      });
      out.textContent = `✓ ${step.label}${step.paid ? ` (paid, $${cost.toFixed(5)})` : ''} answered: ${text.trim().slice(0, 80)}`;
      if (step.paid) this.showSpend();
    } catch (e) {
      out.textContent = '✕ ' + e.message;
    }
  }

  renderShortcuts() {
    if (!this.shortcutsList || !chrome.commands?.getAll) return;
    chrome.commands.getAll((commands) => {
      const rows = (commands || [])
        .filter(c => c.description)
        .map(c => {
          const keys = c.shortcut
            ? c.shortcut.split('+').map(k => `<kbd>${this.escapeHtml(k)}</kbd>`).join(' + ')
            : '<span class="help-text">Not set</span>';
          return `<p><strong>${this.escapeHtml(c.description)}:</strong> ${keys}</p>`;
        });
      this.shortcutsList.innerHTML = rows.join('') +
        '<p class="help-text">In the chat view: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> saves the AI\'s last answer.</p>';
    });
  }

  showToast(text, isError = false) {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.classList.toggle('toast-error', isError);
    this.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.hidden = true; }, 2200);
  }

  // ===== Floating menu: sites where it never shows =====
  async addDisabledSite() {
    const site = this.disabledSiteInput.value.trim();
    if (!site) return;
    let domain = site;
    try {
      domain = new URL(site.startsWith('http') ? site : `https://${site}`).hostname;
    } catch (e) { /* use as typed */ }
    const sites = this.settings.disabledSites || [];
    if (!sites.includes(domain)) await this.saveSetting({ disabledSites: [...sites, domain] });
    this.disabledSiteInput.value = '';
    this.renderDisabledSites();
  }

  async removeDisabledSite(site) {
    await this.saveSetting({ disabledSites: (this.settings.disabledSites || []).filter(s => s !== site) });
    this.renderDisabledSites();
  }

  renderDisabledSites() {
    const sites = this.settings.disabledSites || [];
    this.disabledSitesList.hidden = !sites.length;
    this.disabledSitesList.innerHTML = sites.map(site => `
      <div class="disabled-site-tag">
        ${this.escapeHtml(site)}
        <button type="button" data-remove-site="${this.escapeHtml(site)}" title="Remove" aria-label="Remove ${this.escapeHtml(site)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');
  }

  // Data Management
  // Exports everything a user would miss on a new machine: settings, prompt
  // templates and custom models. (The GitHub token is left out on purpose.)
  async exportSettings() {
    const { aiModels } = await chrome.storage.sync.get('aiModels');
    const data = {
      yavarExport: 1,
      settings: this.settings,
      promptTemplates: this.templates,
      aiModels: Array.isArray(aiModels) ? aiModels : undefined
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `yavar-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showToast('Settings exported');
  }

  async handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid settings file');
      }

      // New format wraps sections; old exports were the bare settings object.
      const imported = parsed.yavarExport ? parsed.settings : parsed;
      if (imported && typeof imported === 'object') {
        const clean = {};
        if (typeof imported.defaultAI === 'string') clean.defaultAI = imported.defaultAI;
        if (typeof imported.enableFloatingMenu === 'boolean') clean.enableFloatingMenu = imported.enableFloatingMenu;
        if (Array.isArray(imported.disabledSites)) clean.disabledSites = imported.disabledSites.filter(x => typeof x === 'string');
        if (typeof imported.ytxBaseUrl === 'string') clean.ytxBaseUrl = imported.ytxBaseUrl;
        if (Number.isFinite(imported.ytxVideoCount)) clean.ytxVideoCount = imported.ytxVideoCount;
        if (Number.isFinite(imported.apiMonthlyCap) && imported.apiMonthlyCap >= 0) clean.apiMonthlyCap = imported.apiMonthlyCap;
        for (const k of ['apiPaidModel', 'apiGatewayBase', 'apiGatewayModel']) {
          if (typeof imported[k] === 'string') clean[k] = imported[k];
        }
        if (Array.isArray(imported.apiFreeModels)) clean.apiFreeModels = imported.apiFreeModels.filter(x => typeof x === 'string');
        if (imported.answerWith === 'chat' || imported.answerWith === 'api') clean.answerWith = imported.answerWith;
        for (const k of ['autoSubmit', 'tempChats', 'deepResearch', 'inChatButtons']) {
          if (typeof imported[k] === 'boolean') clean[k] = imported[k];
        }
        await this.saveSetting(clean);
      }

      if (parsed.yavarExport && Array.isArray(parsed.promptTemplates)) {
        this.templates = parsed.promptTemplates
          .filter(t => t && typeof t.body === 'string')
          .map((t, i) => ({
            id: String(t.id || 'tpl-' + Date.now() + '-' + i),
            name: String(t.name || 'Template'),
            icon: String(t.icon || '•').slice(0, 2),
            menu: !!t.menu,
            primary: !!t.primary,
            body: t.body
          }));
        await saveTemplates(this.templates);
        this.renderTemplates();
      }

      if (parsed.yavarExport && Array.isArray(parsed.aiModels)) {
        const models = parsed.aiModels.filter(m =>
          m && typeof m.id === 'string' && typeof m.name === 'string' && /^https?:\/\//i.test(m.url || ''));
        if (models.length) await chrome.storage.sync.set({ aiModels: models });
      }

      this.populateForm();
      await this.loadModelsList();
      this.showToast('Settings imported');
    } catch (error) {
      console.error('[Yavar] Failed to import settings:', error);
      this.showToast('Import failed - check the file format', true);
    }

    event.target.value = '';
  }

  // Settings only: templates, models and the token have their own resets
  async resetSettings() {
    if (!confirm('Reset all settings to their defaults? Templates, models and your GitHub token are kept.')) return;
    try {
      await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS } });
      this.settings = { ...DEFAULT_SETTINGS };
      this.populateForm();
      this.showToast('Settings reset');
    } catch (error) {
      console.error('[Yavar] Failed to reset settings:', error);
      this.showToast('Could not reset settings', true);
    }
  }

  // ===== Prompt Templates =====
  renderTemplates() {
    if (!this.templatesList) return;

    if (!this.templates.length) {
      this.templatesList.innerHTML = '<div class="empty-state">No templates. Add one below.</div>';
      return;
    }

    this.templatesList.innerHTML = this.templates.map((t, i) => `
      <div class="template-card" data-index="${i}">
        <div class="template-row">
          <input type="text" class="template-icon-input" data-field="icon" data-index="${i}"
                 value="${this.escapeHtml(t.icon || '')}" maxlength="2" title="Icon" placeholder="•">
          <input type="text" class="template-name-input" data-field="name" data-index="${i}"
                 value="${this.escapeHtml(t.name || '')}" placeholder="Template name">
          <label class="template-menu-toggle" title="Show as a button in the selection menu">
            <input type="checkbox" data-field="menu" data-index="${i}" ${t.menu ? 'checked' : ''}>
            <span>In menu</span>
          </label>
          <button class="btn-icon-danger" data-del="${i}" title="Delete template">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <textarea class="template-body-input" data-field="body" data-index="${i}" rows="3"
                  placeholder="Prompt text. Use {{selection}}, {{page}}, {{clipboard}}…">${this.escapeHtml(t.body || '')}</textarea>
      </div>
    `).join('');
  }

  handleTemplateEdit(e) {
    const el = e.target;
    const field = el.dataset.field;
    if (field == null) return;
    const i = parseInt(el.dataset.index, 10);
    if (!this.templates[i]) return;

    if (field === 'menu') this.templates[i].menu = el.checked;
    else this.templates[i][field] = el.value;

    // Keep a stable id so it survives edits
    if (!this.templates[i].id) this.templates[i].id = 'tpl-' + Date.now() + '-' + i;

    // Debounced: every keystroke would otherwise be a storage.sync write, and
    // sync allows only ~120 writes per minute.
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this.persistTemplates(), 400);
  }

  addTemplate() {
    this.templates.push({
      id: 'tpl-' + Date.now(),
      name: 'New template',
      icon: '•',
      menu: false,
      body: '{{selection}}'
    });
    this.persistTemplates();
    this.renderTemplates();
    // Focus the new card's name field
    const last = this.templatesList.querySelector('.template-card:last-child .template-name-input');
    last?.focus();
    last?.select();
  }

  deleteTemplate(i) {
    if (Number.isNaN(i) || !this.templates[i]) return;
    this.templates.splice(i, 1);
    this.persistTemplates();
    this.renderTemplates();
  }

  resetTemplates() {
    if (!confirm('Reset all prompt templates to the defaults? Your custom templates will be lost.')) return;
    this.templates = DEFAULT_TEMPLATES.map(t => ({ ...t }));
    this.persistTemplates();
    this.renderTemplates();
  }

  async persistTemplates() {
    clearTimeout(this._persistTimer);
    try {
      await saveTemplates(this.templates);
    } catch (error) {
      console.error('[Yavar] Failed to save templates:', error);
      // Most likely the 8 KB per-item sync quota: templates are stored together
      this.showToast(/quota/i.test(error.message) ? 'Templates too large to sync - shorten a prompt' : 'Could not save templates', true);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    // innerHTML escapes &, <, > but not quotes — escape them too for attribute safety
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

// Initialize options page
const optionsPage = new OptionsPage();
