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
    this.renderDisabledSites();
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
    this.ytxCleanToggle = document.getElementById('ytx-clean');

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
  }

  bindEvents() {
    // Default AI change
    this.defaultAiSelect.addEventListener('change', () => this.saveSettings());
    
    // Feature toggles
    this.floatingMenuToggle.addEventListener('change', () => this.saveSettings());

    // Video research (ytx)
    this.ytxBaseUrlInput?.addEventListener('change', () => this.saveSettings());
    this.ytxVideoCountInput?.addEventListener('change', () => this.saveSettings());
    this.ytxCleanToggle?.addEventListener('change', () => this.saveSettings());

    // Add disabled site
    this.addSiteBtn.addEventListener('click', () => this.addDisabledSite());
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
      ytxVideoCount: 12,
      ytxClean: true
    };
  }

  populateForm() {
    this.defaultAiSelect.value = this.settings.defaultAI || 'chatgpt';
    this.floatingMenuToggle.checked = this.settings.enableFloatingMenu ?? true;
    if (this.ytxBaseUrlInput) this.ytxBaseUrlInput.value = this.settings.ytxBaseUrl || 'http://localhost:8722';
    if (this.ytxVideoCountInput) this.ytxVideoCountInput.value = this.settings.ytxVideoCount ?? 12;
    if (this.ytxCleanToggle) this.ytxCleanToggle.checked = this.settings.ytxClean ?? true;
  }

  async saveSettings() {
    const count = parseInt(this.ytxVideoCountInput?.value, 10);
    this.settings = {
      ...this.settings,
      defaultAI: this.defaultAiSelect.value,
      enableFloatingMenu: this.floatingMenuToggle.checked,
      ytxBaseUrl: (this.ytxBaseUrlInput?.value || '').trim().replace(/\/+$/, '') || 'http://localhost:8722',
      ytxVideoCount: Number.isFinite(count) ? Math.min(50, Math.max(1, count)) : 12,
      ytxClean: this.ytxCleanToggle?.checked ?? true
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
        <button onclick="optionsPage.removeDisabledSite('${site}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');
  }

  // Data Management
  async exportSettings() {
    const dataStr = JSON.stringify(this.settings, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-sidebar-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }

  async handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importedSettings = JSON.parse(text);
      
      // Validate basic structure
      if (typeof importedSettings !== 'object') {
        throw new Error('Invalid settings file');
      }
      
      this.settings = { ...this.settings, ...importedSettings };
      
      await chrome.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: this.settings 
      });
      
      this.populateForm();
      this.renderDisabledSites();
      
      alert('Settings imported successfully!');
    } catch (error) {
      console.error('[Yavar] Failed to import settings:', error);
      alert('Failed to import settings. Please check the file format.');
    }
    
    // Reset file input
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

    this.persistTemplates();
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
    try {
      await saveTemplates(this.templates);
    } catch (error) {
      console.error('[Yavar] Failed to save templates:', error);
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
