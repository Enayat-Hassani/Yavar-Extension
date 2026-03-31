// Side Panel - Main Logic (2026 Redesign)
// Full viewport chat with bottom navigation and model management

class YavarSidePanel {
  constructor() {
    // Default AI models
    this.defaultModels = [
      { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', icon: '✨', enabled: true, custom: false },
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', icon: '🤖', enabled: true, custom: false },
      { id: 'claude', name: 'Claude', url: 'https://claude.ai', icon: '🧠', enabled: true, custom: false }
    ];

    this.models = [];
    this.currentModelId = 'gemini';
    this.capturedScreenshot = null;

    this.init();
  }

  async init() {
    this.cacheElements();
    await this.loadModels();
    this.bindEvents();
    this.loadCurrentAI();
    this.setupMessageListener();
    this.checkPendingData();
  }

  cacheElements() {
    // Main elements
    this.aiFrame = document.getElementById('ai-frame');
    this.loadingState = document.getElementById('loading-state');
    this.notificationBar = document.getElementById('notification-bar');
    this.notificationText = document.getElementById('notification-text');
    this.notificationDismiss = document.getElementById('notification-dismiss');
    this.screenshotPanel = document.getElementById('screenshot-panel');
    this.screenshotImg = document.getElementById('screenshot-img');
    this.btnCopyScreenshot = document.getElementById('btn-copy-screenshot');
    this.btnDismissScreenshot = document.getElementById('btn-dismiss-screenshot');

    // Bottom bar buttons
    this.btnModelSwitcher = document.getElementById('btn-model-switcher');
    this.btnAnalyzeRepo = document.getElementById('btn-analyze-repo');
    this.btnScreenshot = document.getElementById('btn-screenshot');
    this.btnCopyPage = document.getElementById('btn-copy-page');
    this.btnCopyLink = document.getElementById('btn-copy-link');
    this.btnNewChat = document.getElementById('btn-new-chat');
    this.btnHelp = document.getElementById('btn-help');
    this.btnSettings = document.getElementById('btn-settings');

    // Model switcher
    this.modelSwitcher = document.getElementById('model-switcher');
    this.modelList = document.getElementById('model-list');
    this.btnManageModels = document.getElementById('btn-manage-models');

    // Settings panel
    this.settingsPanel = document.getElementById('settings-panel');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.modelsListContainer = document.getElementById('models-list-container');
    this.btnAddModel = document.getElementById('btn-add-model');

    // GitHub token section
    this.githubTokenInput = document.getElementById('github-token-input');
    this.btnSaveToken = document.getElementById('btn-save-github-token');
    this.btnCheckRateLimit = document.getElementById('btn-check-rate-limit');
    this.githubTokenStatus = document.getElementById('github-token-status');

    // Add model modal
    this.addModelModal = document.getElementById('add-model-modal');
    this.btnCloseModal = document.getElementById('btn-close-modal');
    this.btnCancelModel = document.getElementById('btn-cancel-model');
    this.addModelForm = document.getElementById('add-model-form');
    this.modelNameInput = document.getElementById('model-name');
    this.modelUrlInput = document.getElementById('model-url');
    this.modelEnabledCheckbox = document.getElementById('model-enabled');

    // Help tooltip
    this.helpTooltip = document.getElementById('help-tooltip');
  }

  async loadModels() {
    try {
      const result = await chrome.storage.sync.get('aiModels');
      if (result.aiModels && result.aiModels.length > 0) {
        this.models = result.aiModels;
      } else {
        this.models = [...this.defaultModels];
        await this.saveModels();
      }
      
      // Load current model
      const currentResult = await chrome.storage.sync.get('currentModelId');
      if (currentResult.currentModelId) {
        this.currentModelId = currentResult.currentModelId;
      }
    } catch (error) {
      console.error('[Yavar] Failed to load models:', error);
      this.models = [...this.defaultModels];
    }
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
    return this.models.find(m => m.id === this.currentModelId) || this.models[0];
  }

  bindEvents() {
    // Model switcher
    this.btnModelSwitcher.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModelSwitcher();
    });
    
    this.btnManageModels.addEventListener('click', () => {
      this.hideModelSwitcher();
      this.showSettings();
    });
    
    // Close model switcher when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.modelSwitcher.contains(e.target) && !this.btnModelSwitcher.contains(e.target)) {
        this.hideModelSwitcher();
      }
    });
    
    // Analyze repo button (GitHub)
    this.btnAnalyzeRepo.addEventListener('click', () => this.analyzeGitHubRepo());
    
    // Screenshot button
    this.btnScreenshot.addEventListener('click', () => this.captureScreenshot());
    
    // Copy page content
    this.btnCopyPage.addEventListener('click', () => this.copyPageContent());
    
    // Copy link
    this.btnCopyLink.addEventListener('click', () => this.copyLink());
    
    // New chat - refresh iframe
    this.btnNewChat.addEventListener('click', () => this.openNewChat());
    
    // Help button
    this.btnHelp.addEventListener('mouseenter', () => this.showHelpTooltip());
    this.btnHelp.addEventListener('mouseleave', () => this.hideHelpTooltip());
    this.btnHelp.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHelpTooltip();
    });
    
    // Settings button
    this.btnSettings.addEventListener('click', () => this.showSettings());
    
    // Close settings
    this.btnCloseSettings.addEventListener('click', () => this.hideSettings());
    
    // Add model button
    this.btnAddModel.addEventListener('click', () => this.showAddModelModal());
    
    // Modal buttons
    this.btnCloseModal.addEventListener('click', () => this.hideAddModelModal());
    this.btnCancelModel.addEventListener('click', () => this.hideAddModelModal());
    
    // Add model form
    this.addModelForm.addEventListener('submit', (e) => this.handleAddModel(e));

    // Notification dismiss
    this.notificationDismiss.addEventListener('click', () => this.hideNotification());

    // Screenshot panel buttons
    this.btnCopyScreenshot.addEventListener('click', () => this.copyScreenshot());
    this.btnDismissScreenshot.addEventListener('click', () => this.dismissScreenshot());

    // GitHub token buttons
    this.btnSaveToken.addEventListener('click', () => this.saveGitHubToken());
    this.btnCheckRateLimit.addEventListener('click', () => this.checkRateLimit());

    // Iframe load handling
    this.aiFrame.addEventListener('load', () => this.handleFrameLoad());
  }

  loadCurrentAI() {
    const model = this.getCurrentModel();
    if (model) {
      this.loadingState.classList.remove('hidden');
      this.aiFrame.src = model.url;
    }
  }

  switchModel(modelId) {
    this.currentModelId = modelId;
    this.saveCurrentModelId();
    this.loadCurrentAI();
    this.hideModelSwitcher();
    this.renderModelList();
  }

  handleFrameLoad() {
    setTimeout(() => {
      this.loadingState.classList.add('hidden');
    }, 500);

    // Retry any pending auto-submit after iframe loads
    console.log('[Yavar Sidepanel] Iframe fully loaded:', this.aiFrame.src);
    this.checkPendingAutoSubmit();
  }

  openNewChat() {
    // Refresh the iframe to start a new chat session
    const model = this.getCurrentModel();
    if (model) {
      this.loadingState.classList.remove('hidden');
      this.aiFrame.src = model.url + '?' + Date.now();
    }
  }

  // ========== Model Switcher ==========

  toggleModelSwitcher() {
    if (this.modelSwitcher.classList.contains('hidden')) {
      this.showModelSwitcher();
    } else {
      this.hideModelSwitcher();
    }
  }

  showModelSwitcher() {
    this.renderModelList();
    this.modelSwitcher.classList.remove('hidden');
  }

  hideModelSwitcher() {
    this.modelSwitcher.classList.add('hidden');
  }

  renderModelList() {
    const enabledModels = this.models.filter(m => m.enabled);
    
    this.modelList.innerHTML = enabledModels.map(model => `
      <div class="model-item ${model.id === this.currentModelId ? 'active' : ''}" 
           data-model-id="${model.id}">
        <div class="model-icon">${model.icon}</div>
        <div class="model-info">
          <div class="model-name">${model.name}</div>
          ${model.custom ? `<div class="model-url">${model.url}</div>` : ''}
        </div>
      </div>
    `).join('');
    
    // Add click handlers
    this.modelList.querySelectorAll('.model-item').forEach(item => {
      item.addEventListener('click', () => {
        const modelId = item.dataset.modelId;
        this.switchModel(modelId);
      });
    });
  }

  // ========== Settings Panel ==========

  showSettings() {
    this.renderModelsList();
    this.settingsPanel.classList.remove('hidden');
  }

  hideSettings() {
    this.settingsPanel.classList.add('hidden');
  }

  renderModelsList() {
    this.modelsListContainer.innerHTML = this.models.map(model => `
      <div class="model-row">
        <div class="model-row-icon">${model.icon}</div>
        <div class="model-row-info">
          <div class="model-row-name">${model.name}</div>
          <div class="model-row-url">${model.url}</div>
        </div>
        <div class="model-row-actions">
          <div class="toggle-switch ${model.enabled ? 'active' : ''}" 
               data-model-id="${model.id}" 
               title="Toggle visibility">
          </div>
          ${!model.custom ? '' : `
            <button class="btn-delete" data-model-id="${model.id}" title="Delete model">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          `}
        </div>
      </div>
    `).join('');
    
    // Add toggle handlers
    this.modelsListContainer.querySelectorAll('.toggle-switch').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const modelId = toggle.dataset.modelId;
        this.toggleModelEnabled(modelId);
      });
    });
    
    // Add delete handlers
    this.modelsListContainer.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const modelId = btn.dataset.modelId;
        this.deleteModel(modelId);
      });
    });
  }

  toggleModelEnabled(modelId) {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      model.enabled = !model.enabled;
      this.saveModels();
      this.renderModelsList();
    }
  }

  deleteModel(modelId) {
    this.models = this.models.filter(m => m.id !== modelId);
    this.saveModels();
    this.renderModelsList();
    
    // If current model was deleted, switch to first enabled
    if (this.currentModelId === modelId) {
      const firstEnabled = this.models.find(m => m.enabled);
      if (firstEnabled) {
        this.switchModel(firstEnabled.id);
      }
    }
  }

  // ========== Add Model Modal ==========

  showAddModelModal() {
    this.addModelModal.classList.remove('hidden');
    this.modelNameInput.focus();
  }

  hideAddModelModal() {
    this.addModelModal.classList.add('hidden');
    this.addModelForm.reset();
  }

  handleAddModel(e) {
    e.preventDefault();

    const name = this.modelNameInput.value.trim();
    const url = this.modelUrlInput.value.trim();
    const enabled = this.modelEnabledCheckbox.checked;

    if (!name || !url) return;

    const newModel = {
      id: 'custom_' + Date.now(),
      name,
      url,
      icon: '🌐',
      enabled,
      custom: true
    };

    this.models.push(newModel);
    this.saveModels();
    this.hideAddModelModal();
    this.renderModelsList();
  }

  // ========== GitHub Token Management ==========

  async saveGitHubToken() {
    const token = this.githubTokenInput.value.trim();
    
    if (!token) {
      this.showTokenStatus('Please enter a token', 'error');
      return;
    }

    try {
      // Save to local storage
      await chrome.storage.local.set({ githubToken: token });
      this.showTokenStatus('✅ Token saved! Rate limit: 15,000 requests/hour', 'success');
      this.githubTokenInput.value = '';
    } catch (error) {
      this.showTokenStatus('❌ Failed to save token', 'error');
    }
  }

  async checkRateLimit() {
    try {
      this.showTokenStatus('⏳ Checking rate limit...', 'info');
      
      const limits = await chrome.runtime.sendMessage({ action: 'check_github_rate_limit' });
      
      if (limits.error) {
        this.showTokenStatus(`❌ ${limits.error}`, 'error');
        return;
      }

      const core = limits.core;
      const remaining = core.remaining;
      const limit = core.limit;
      const resetTime = new Date(core.reset * 1000);
      const isToken = limit === 15000;

      const statusText = isToken
        ? `✅ Token active: ${remaining.toLocaleString()} / ${limit.toLocaleString()} requests remaining`
        : `⚠️ No token: ${remaining.toLocaleString()} / ${limit.toLocaleString()} requests remaining`;
      
      const resetText = `Resets at ${resetTime.toLocaleTimeString()}`;
      
      this.showTokenStatus(`${statusText}\n${resetText}`, isToken ? 'success' : 'info');
    } catch (error) {
      this.showTokenStatus(`❌ Error: ${error.message}`, 'error');
    }
  }

  showTokenStatus(message, type) {
    this.githubTokenStatus.textContent = message;
    this.githubTokenStatus.className = `token-status show ${type}`;
    
    // Auto-hide after 5 seconds for success/error
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        this.githubTokenStatus.classList.remove('show');
      }, 5000);
    }
  }

  // ========== GitHub Analysis ==========

  async analyzeGitHubRepo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('github.com')) {
      this.showNotification('⚠️ Open a GitHub repository to use this feature');
      return;
    }

    // Show loading state
    this.showNotification('🔄 Analyzing repository...');

    try {
      const repoData = await chrome.tabs.sendMessage(tab.id, { action: 'scrape_github' });

      if (!repoData || !repoData.repoName) {
        this.showNotification('⚠️ Could not analyze repository');
        return;
      }

      const prompt = this.generateLearningPrompt(repoData);
      await navigator.clipboard.writeText(prompt);
      
      const source = repoData.source === 'dom-fallback' ? ' (fallback mode)' : '';
      this.showNotification(`🚀 Learning prompt copied${source}! Press Cmd+V in ChatGPT`);

    } catch (error) {
      console.error('[Yavar] GitHub analysis failed:', error);
      this.showNotification('⚠️ Analysis failed. Make sure you\'re on a GitHub repo page.');
    }
  }

  generateLearningPrompt(repoData) {
    // Handle both API and DOM response formats
    const stars = repoData.stars?.toLocaleString?.() || repoData.stars || '0';
    const forks = repoData.forks?.toLocaleString?.() || repoData.forks || '0';
    const files = repoData.files?.slice(0, 15).join(', ') || 'Unknown files';
    const topics = repoData.topics?.length > 0 ? repoData.topics.join(', ') : 'None';
    
    // Handle README from API (plain text) or DOM (already text)
    const readmeFull = repoData.readme || 'No README available';
    const readmeExcerpt = readmeFull.slice(0, 600).replace(/\n/g, ' ').trim();
    
    // Add language info if available (from API)
    const languageInfo = repoData.language ? `\n   📦 Primary Language: ${repoData.language}` : '';

    return `🎓 LEARNING MODE: ${repoData.repoName}

📊 Repository Stats:
   ⭐ Stars: ${stars} | 🍴 Forks: ${forks}${languageInfo}
   🏷️ Topics: ${topics}

📁 Key Files Identified:
   ${files}

📖 README Context:
   ${readmeExcerpt}

---
As my Senior Coding Tutor, please help me learn this codebase:

1. 🚪 ENTRY POINT: Which file should I read first to understand where the logic starts?

2. 📚 READING ORDER: Give me a 3-step sequence to understand how data flows through this project.

3. 🎯 DESIGN PATTERNS: What patterns/concepts should I pay attention to? Explain like I'm a junior developer.

4. ⚡ QUICK WIN: What's one small feature I could trace through the codebase to learn the architecture?`;
  }

  // ========== Screenshot Functions ==========

  async captureScreenshot() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 90
      });

      this.capturedScreenshot = dataUrl;
      this.showScreenshotPanel(dataUrl);
      this.showNotification('📸 Screenshot captured! Paste with Cmd+V in ChatGPT');

    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
      this.showNotification('❌ Failed to capture screenshot.');
    }
  }

  showScreenshotPanel(dataUrl) {
    this.screenshotImg.src = dataUrl;
    this.screenshotPanel.classList.remove('hidden');
  }

  dismissScreenshot() {
    this.capturedScreenshot = null;
    this.screenshotPanel.classList.add('hidden');
    this.screenshotImg.src = '';
  }

  async copyScreenshot() {
    if (!this.capturedScreenshot) return;

    try {
      const response = await fetch(this.capturedScreenshot);
      const blob = await response.blob();

      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);

      this.showNotification('📋 Image copied to clipboard!');
      this.dismissScreenshot();

    } catch (error) {
      console.error('[Yavar] Failed to copy screenshot:', error);
      this.showNotification('❌ Failed to copy image.');
    }
  }

  // ========== Copy Functions ==========

  async copyPageContent() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent
      });

      const content = result[0]?.result || '';

      if (content) {
        await navigator.clipboard.writeText(content);
        this.showNotification('📋 Page content copied!');
      } else {
        this.showNotification('⚠️ Could not extract content');
      }

    } catch (error) {
      console.error('[Yavar] Failed to copy page:', error);
      this.showNotification('❌ Failed to copy page content');
    }
  }

  async copyLink() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await navigator.clipboard.writeText(tab.url);
      this.showNotification('🔗 URL copied to clipboard!');
    } catch (error) {
      console.error('[Yavar] Failed to copy link:', error);
    }
  }

  // ========== Notification Functions ==========

  showNotification(text) {
    this.notificationText.textContent = text;
    this.notificationBar.classList.remove('hidden');

    setTimeout(() => {
      this.hideNotification();
    }, 4000);
  }

  hideNotification() {
    this.notificationBar.classList.add('hidden');
  }

  // ========== Help Tooltip ==========

  showHelpTooltip() {
    this.helpTooltip.classList.remove('hidden');
    setTimeout(() => this.helpTooltip.classList.add('visible'), 10);
  }

  hideHelpTooltip() {
    this.helpTooltip.classList.remove('visible');
    setTimeout(() => this.helpTooltip.classList.add('hidden'), 200);
  }

  toggleHelpTooltip() {
    if (this.helpTooltip.classList.contains('visible')) {
      this.hideHelpTooltip();
    } else {
      this.showHelpTooltip();
    }
  }

  // ========== Message Listener ==========

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Yavar] Message received:', message.type || message.action);

      if (message.type === 'TEXT_SELECTION') {
        this.handleTextSelection(message.text);
      }
      
      if (message.type === 'SCREENSHOT_CAPTURED') {
        this.capturedScreenshot = message.imageData;
        this.showScreenshotPanel(message.imageData);
      }
      
      if (message.action === 'trigger_learn') {
        // Trigger GitHub analysis when keyboard shortcut is pressed
        this.analyzeGitHubRepo();
      }

      if (message.action === 'AUTO_SUBMIT_PROMPT' && message.prompt) {
        console.log('[Yavar Sidepanel] Received AUTO_SUBMIT_PROMPT, forwarding to iframe');
        this.forwardToIframe(message);
      }

      sendResponse({ received: true });
      return true;
    });
  }

  async handleTextSelection(text) {
    if (!text) return;

    await navigator.clipboard.writeText(text);
    const preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
    this.showNotification(`📋 "${preview}" copied!`);
  }

  async checkPendingData() {
    try {
      const result = await chrome.storage.session.get(['pendingText', 'pendingScreenshot', 'pendingNotification']);

      if (result.pendingText) {
        await navigator.clipboard.writeText(result.pendingText);
        if (result.pendingNotification) {
          this.showNotification(result.pendingNotification);
        } else {
          this.showNotification('📋 Content copied!');
        }
        await chrome.storage.session.remove('pendingText');
        await chrome.storage.session.remove('pendingNotification');
      }

      if (result.pendingScreenshot) {
        this.capturedScreenshot = result.pendingScreenshot;
        this.showScreenshotPanel(result.pendingScreenshot);
        await chrome.storage.session.remove('pendingScreenshot');
      }
    } catch (error) {
      console.error('[Yavar] Failed to check pending data:', error);
    }

    // Also check for pending auto-submit
    this.checkPendingAutoSubmit();
  }

  async checkPendingAutoSubmit() {
    try {
      const result = await chrome.storage.session.get(['pendingAutoSubmit', 'lastSubmitTime']);
      if (result.pendingAutoSubmit && Date.now() - result.lastSubmitTime < 120000) {
        console.log('[Yavar Sidepanel] Found pending auto-submit prompt');
        this.forwardToIframe({ prompt: result.pendingAutoSubmit });
        await chrome.storage.session.remove(['pendingAutoSubmit', 'lastSubmitTime']);
      }
    } catch (error) {
      console.error('[Yavar Sidepanel] Failed to check pending auto-submit:', error);
    }
  }

  forwardToIframe(message) {
    const payload = { action: 'AUTO_SUBMIT_PROMPT', prompt: message.prompt };

    // Staggered sends — the iframe/bridge may not be fully interactive yet
    const delays = [0, 400, 1200, 2500];
    delays.forEach(delay => {
      setTimeout(() => {
        try {
          if (this.aiFrame && this.aiFrame.contentWindow) {
            console.log(`[Yavar Sidepanel] postMessage to iframe (delay=${delay}ms)`);
            this.aiFrame.contentWindow.postMessage(payload, '*');
          } else {
            console.warn(`[Yavar Sidepanel] Iframe not ready at delay=${delay}ms`);
          }
        } catch (e) {
          console.warn('[Yavar Sidepanel] postMessage failed:', e);
        }
      }, delay);
    });
  }
}

// Content extraction function (runs in page context)
function extractPageContent() {
  const article = document.querySelector('article');
  if (article) return article.innerText;
  const main = document.querySelector('main');
  if (main) return main.innerText;
  return document.body.innerText;
}

// Initialize panel
const panel = new YavarSidePanel();
