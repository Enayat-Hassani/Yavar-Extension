// Options Page - Settings Management

class OptionsPage {
  constructor() {
    this.settings = {};
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();
    this.renderDisabledSites();
  }

  cacheElements() {
    // Default AI
    this.defaultAiSelect = document.getElementById('default-ai');
    
    // Feature toggles
    this.floatingMenuToggle = document.getElementById('enable-floating-menu');
    
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
  }

  bindEvents() {
    // Default AI change
    this.defaultAiSelect.addEventListener('change', () => this.saveSettings());
    
    // Feature toggles
    this.floatingMenuToggle.addEventListener('change', () => this.saveSettings());
    
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
  }

  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      this.settings = response.settings || this.getDefaultSettings();
      this.populateForm();
    } catch (error) {
      console.error('[AI Sidebar] Failed to load settings:', error);
      this.settings = this.getDefaultSettings();
      this.populateForm();
    }
  }

  getDefaultSettings() {
    return {
      defaultAI: 'chatgpt',
      enableFloatingMenu: true,
      disabledSites: []
    };
  }

  populateForm() {
    this.defaultAiSelect.value = this.settings.defaultAI || 'chatgpt';
    this.floatingMenuToggle.checked = this.settings.enableFloatingMenu ?? true;
  }

  async saveSettings() {
    this.settings = {
      ...this.settings,
      defaultAI: this.defaultAiSelect.value,
      enableFloatingMenu: this.floatingMenuToggle.checked
    };
    
    try {
      await chrome.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: this.settings 
      });
      console.log('[AI Sidebar] Settings saved');
    } catch (error) {
      console.error('[AI Sidebar] Failed to save settings:', error);
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
        console.error('[AI Sidebar] Failed to add disabled site:', error);
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
      console.error('[AI Sidebar] Failed to remove disabled site:', error);
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
      console.error('[AI Sidebar] Failed to import settings:', error);
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
      console.error('[AI Sidebar] Failed to reset settings:', error);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize options page
const optionsPage = new OptionsPage();
