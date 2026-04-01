// Base Plugin Class - All plugins must extend this
// Provides common interface and utility methods

export class BasePlugin {
  constructor(config) {
    if (this.constructor === BasePlugin) {
      throw new Error('BasePlugin is abstract - extend it instead');
    }
    
    this.name = config.name;
    this.description = config.description;
    this.version = config.version || '1.0.0';
    this.matchPatterns = config.matchPatterns; // URL patterns to activate on
    this.icon = config.icon || '🔌';
    this.enabled = config.enabled !== false;
    
    this._initialized = false;
  }

  /**
   * Check if plugin should activate on current page
   */
  shouldActivate() {
    if (!this.enabled) return false;
    
    const currentUrl = window.location.href;
    return this.matchPatterns.some(pattern => {
      // Convert glob-like patterns to regex
      const regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      return new RegExp(regex).test(currentUrl);
    });
  }

  /**
   * Initialize plugin - override in subclass
   */
  async init() {
    if (this._initialized) return;
    
    console.log(`[Plugin:${this.name}] Initializing...`);
    await this.onInit();
    this._initialized = true;
    console.log(`[Plugin:${this.name}] Ready`);
  }

  /**
   * Override this in subclass for custom initialization
   */
  async onInit() {
    // To be overridden
  }

  /**
   * Handle messages from background/sidepanel
   * Override in subclass
   */
  handleMessage(action, payload) {
    console.warn(`[Plugin:${this.name}] No handler for action: ${action}`);
    return { error: 'Action not supported' };
  }

  /**
   * Get plugin metadata
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      icon: this.icon,
      enabled: this.enabled,
      matchPatterns: this.matchPatterns
    };
  }

  /**
   * Enable plugin
   */
  enable() {
    this.enabled = true;
    console.log(`[Plugin:${this.name}] Enabled`);
  }

  /**
   * Disable plugin
   */
  disable() {
    this.enabled = false;
    console.log(`[Plugin:${this.name}] Disabled`);
  }

  /**
   * Show notification in sidepanel
   */
  notify(message, type = 'info') {
    chrome.runtime.sendMessage({
      type: 'PLUGIN_NOTIFICATION',
      plugin: this.name,
      message,
      type
    }).catch(() => {}); // Ignore if sidepanel not open
  }

  /**
   * Send data to sidepanel
   */
  sendToSidepanel(data) {
    chrome.runtime.sendMessage({
      type: 'PLUGIN_DATA',
      plugin: this.name,
      data
    }).catch(() => {});
  }

  /**
   * Store data in session storage
   */
  async setSessionData(key, value) {
    await chrome.storage.session.set({ [`plugin_${this.name}_${key}`]: value });
  }

  /**
   * Get data from session storage
   */
  async getSessionData(key) {
    const result = await chrome.storage.session.get(`plugin_${this.name}_${key}`);
    return result[`plugin_${this.name}_${key}`];
  }
}
