// Plugin Manager - Loads and manages all Yavar plugins
// Dynamically activates plugins based on current URL

export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.activePlugin = null;
    this.initialized = false;
  }

  /**
   * Register a plugin instance
   */
  register(plugin) {
    if (!plugin || !(plugin instanceof (Object.getPrototypeOf(plugin).constructor))) {
      throw new Error('Invalid plugin: must extend BasePlugin');
    }

    this.plugins.set(plugin.name, plugin);
    console.log(`[PluginManager] Registered: ${plugin.name} ${plugin.version}`);
  }

  /**
   * Initialize all plugins that match current URL
   */
  async initializeAll() {
    if (this.initialized) return;

    console.log('[PluginManager] Initializing plugins for:', window.location.hostname);

    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.shouldActivate()) {
          await plugin.init();
          this.activePlugin = plugin;
          console.log(`[PluginManager] ✓ Activated: ${name}`);
        } else {
          console.log(`[PluginManager] ✗ Skipped: ${name} (no match)`);
        }
      } catch (error) {
        console.error(`[PluginManager] Failed to initialize ${name}:`, error);
      }
    }

    this.initialized = true;
    this.setupMessageBridge();
  }

  /**
   * Setup message bridge between plugins and background/sidepanel
   */
  setupMessageBridge() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Handle plugin enumeration
      if (request.action === 'list_plugins') {
        const pluginList = Array.from(this.plugins.values()).map(p => p.getInfo());
        sendResponse({ plugins: pluginList, activePlugin: this.activePlugin?.name || null });
        return true;
      }

      // Handle plugin info request
      if (request.action === 'get_plugin_info') {
        const plugin = this.plugins.get(request.plugin);
        if (plugin) {
          sendResponse(plugin.getInfo());
        } else {
          sendResponse({ error: 'Plugin not found' });
        }
        return true;
      }

      // Don't handle plugin-specific messages here - they are handled by content.js
      // which relays them to the active plugin's handleMessage method
      if (request.plugin) {
        return false; // Let content.js handler deal with it
      }

      sendResponse({ error: 'No handler for message' });
      return true;
    });
  }

  /**
   * Get active plugin
   */
  getActivePlugin() {
    return this.activePlugin;
  }

  /**
   * Get plugin by name
   */
  getPlugin(name) {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins() {
    return Array.from(this.plugins.values());
  }

  /**
   * Enable a plugin
   */
  enablePlugin(name) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enable();
      return true;
    }
    return false;
  }

  /**
   * Disable a plugin
   */
  disablePlugin(name) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.disable();
      return true;
    }
    return false;
  }

  /**
   * Check if a plugin is active on current page
   */
  isPluginActive(name) {
    return this.activePlugin?.name === name;
  }
}

// Export singleton instance
export const pluginManager = new PluginManager();
