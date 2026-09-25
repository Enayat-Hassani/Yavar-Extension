// Options Page - Settings Management

import { loadTemplates, saveTemplates, DEFAULT_TEMPLATES } from './utils/templates.js';

class OptionsPage {
  constructor() {
    this.settings = {};
    this.templates = [];
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();
    await this.populateModelSelect();
    this.renderDisabledSites();
    this.renderShortcuts();
    const version = document.getElementById('app-version');
    if (version) version.textContent = 'v' + chrome.runtime.getManifest().version;
    this.templates = await loadTemplates();
    this.renderTemplates();
  }

  cacheElements() {
    // Default AI
    this.defaultAiSelect = document.getElementById('default-ai');
    
    // Feature toggles
    this.floatingMenuToggle = document.getElementById('enable-floating-menu');

    // Video research (ytx)
    this.ytxBaseUrlInput = document.getElementById('ytx-base-url');
    this.ytxVideoCountInput = document.getElementById('ytx-video-count');

    // Disabled sites
    this.disabledSiteInput = document.getElementById('disabled-site');
    this.addSiteBtn = document.getElementById('add-site-btn');
    this.disabledSitesList = document.getElementById('disabled-sites-list');
    
    // Data management
    this.exportSettingsBtn = document.getElementById('export-settings-btn');
    this.importSettingsBtn = document.getElementById('import-settings-btn');
    this.resetSettingsBtn = document.getElementById('reset-settings-btn');
    this.importFileInput = document.getElementById('import-file');
    
    // Shortcuts
    this.configureShortcutsBtn = document.getElementById('configure-shortcuts-btn');

    // Prompt templates
    this.templatesList = document.getElementById('templates-list');
    this.addTemplateBtn = document.getElementById('add-template-btn');
    this.resetTemplatesBtn = document.getElementById('reset-templates-btn');

    this.shortcutsList = document.getElementById('shortcuts-list');
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    // Default AI change
    this.defaultAiSelect.addEventListener('change', () => this.saveDefaultModel());
    
    // Feature toggles
    this.floatingMenuToggle.addEventListener('change', () => this.saveSettings());

    // Video research (ytx)
    this.ytxBaseUrlInput?.addEventListener('change', () => this.saveSettings());
    this.ytxVideoCountInput?.addEventListener('change', () => this.saveSettings());

    // Add disabled site
    this.addSiteBtn.addEventListener('click', () => this.addDisabledSite());
    // Delegated: inline onclick handlers are blocked by the extension CSP
    this.disabledSitesList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-site]');
      if (btn) this.removeDisabledSite(btn.dataset.removeSite);
    });
    this.disabledSiteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addDisabledSite();
    });
    
    // Data management
    this.exportSettingsBtn.addEventListener('click', () => this.exportSettings());
    this.importSettingsBtn.addEventListener('click', () => this.importFileInput.click());
    this.importFileInput.addEventListener('change', (e) => this.handleImport(e));
    this.resetSettingsBtn.addEventListener('click', () => this.resetSettings());
    
    // Configure shortcuts - opens Chrome shortcuts page
    this.configureShortcutsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    // Prompt templates
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
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      this.settings = response.settings || this.getDefaultSettings();
      this.populateForm();
    } catch (error) {
      console.error('[Yavar] Failed to load settings:', error);
      this.settings = this.getDefaultSettings();
      this.populateForm();
    }
  }

  getDefaultSettings() {
    return {
      defaultAI: 'chatgpt',
      enableFloatingMenu: true,
      disabledSites: [],
      ytxBaseUrl: 'http://localhost:8722',
      ytxVideoCount: 12
    };
  }

  // Offer every enabled model (custom ones included), selecting the one the
  // side panel will actually open with.
  async populateModelSelect() {
    try {
      const { aiModels, currentModelId } = await chrome.storage.sync.get(['aiModels', 'currentModelId']);
      if (Array.isArray(aiModels) && aiModels.length) {
        this.defaultAiSelect.innerHTML = '';
        for (const m of aiModels.filter(m => m.enabled)) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          this.defaultAiSelect.appendChild(opt);
        }
      }
      const wanted = currentModelId || this.settings.defaultAI;
      if ([...this.defaultAiSelect.options].some(o => o.value === wanted)) this.defaultAiSelect.value = wanted;
    } catch (error) {
      console.error('[Yavar] Failed to load models:', error);
    }
  }

  // The side panel opens whichever model is current, so set both.
  async saveDefaultModel() {
    await this.saveSettings();
    try {
      await chrome.storage.sync.set({ currentModelId: this.defaultAiSelect.value });
      this.showToast('Default AI saved');
    } catch (error) {
      console.error('[Yavar] Failed to save default model:', error);
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
        '<p class="help-text">In the sidebar: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> saves the AI\'s last answer.</p>';
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

  populateForm() {
    this.floatingMenuToggle.checked = this.settings.enableFloatingMenu ?? true;
    if (this.ytxBaseUrlInput) this.ytxBaseUrlInput.value = this.settings.ytxBaseUrl || 'http://localhost:8722';
    if (this.ytxVideoCountInput) this.ytxVideoCountInput.value = this.settings.ytxVideoCount ?? 12;
  }

  async saveSettings() {
    const count = parseInt(this.ytxVideoCountInput?.value, 10);
    this.settings = {
      ...this.settings,
      defaultAI: this.defaultAiSelect.value || this.settings.defaultAI,
      enableFloatingMenu: this.floatingMenuToggle.checked,
      ytxBaseUrl: (this.ytxBaseUrlInput?.value || '').trim().replace(/\/+$/, '') || 'http://localhost:8722',
      ytxVideoCount: Number.isFinite(count) ? Math.min(50, Math.max(1, count)) : 12
    };
    
    try {
      await chrome.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: this.settings 
      });
      console.log('[Yavar] Settings saved');
    } catch (error) {
      console.error('[Yavar] Failed to save settings:', error);
    }
  }

  // Disabled Sites
  async addDisabledSite() {
    const site = this.disabledSiteInput.value.trim();
    
    if (!site) return;
    
    // Basic validation - extract domain
    let domain = site;
    try {
      domain = new URL(site.startsWith('http') ? site : `https://${site}`).hostname;
    } catch (e) {
      // Use as-is if not a valid URL
    }
    
    if (!this.settings.disabledSites) {
      this.settings.disabledSites = [];
    }
    
    if (!this.settings.disabledSites.includes(domain)) {
      this.settings.disabledSites.push(domain);
      
      try {
        await chrome.runtime.sendMessage({ 
          type: 'UPDATE_SETTINGS', 
          settings: this.settings 
        });
        
        this.disabledSiteInput.value = '';
        this.renderDisabledSites();
      } catch (error) {
        console.error('[Yavar] Failed to add disabled site:', error);
      }
    }
  }

  async removeDisabledSite(site) {
    this.settings.disabledSites = this.settings.disabledSites.filter(s => s !== site);
    
    try {
      await chrome.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: this.settings 
      });
      this.renderDisabledSites();
    } catch (error) {
      console.error('[Yavar] Failed to remove disabled site:', error);
    }
  }

  renderDisabledSites() {
    const sites = this.settings.disabledSites || [];
    
    if (sites.length === 0) {
      this.disabledSitesList.innerHTML = '<div class="empty-state">No disabled sites. The sidebar works on all websites.</div>';
      return;
    }
    
    this.disabledSitesList.innerHTML = sites.map(site => `
      <div class="disabled-site-tag">
        ${this.escapeHtml(site)}
        <button type="button" data-remove-site="${this.escapeHtml(site)}" title="Remove">
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
        for (const k of ['autoPaste', 'autoSubmit', 'showScreenshotPreview', 'deepResearch']) {
          if (typeof imported[k] === 'boolean') clean[k] = imported[k];
        }
        this.settings = { ...this.settings, ...clean };
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: this.settings });
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
      await this.populateModelSelect();
      this.renderDisabledSites();
      this.showToast('Settings imported');
    } catch (error) {
      console.error('[Yavar] Failed to import settings:', error);
      this.showToast('Import failed - check the file format', true);
    }

    event.target.value = '';
  }

  async resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) return;
    
    this.settings = this.getDefaultSettings();
    
    try {
      await chrome.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: this.settings 
      });
      
      this.populateForm();
      this.renderDisabledSites();
    } catch (error) {
      console.error('[Yavar] Failed to reset settings:', error);
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
