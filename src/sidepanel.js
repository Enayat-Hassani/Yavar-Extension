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
    this.setupStorageListener();
    this.initCodeMirror();
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

    // Notes panel
    this.notesPanel = document.getElementById('notes-panel');
    this.notesEditorContainer = document.getElementById('notes-editor');
    this.btnClearNotes = document.getElementById('btn-clear-notes');
    this.btnCopyNotes = document.getElementById('btn-copy-notes');
    this.notesOpen = false;

    // Right sidebar buttons
    this.sidebarBtnNotes = document.getElementById('sidebar-btn-notes');
    this.sidebarBtnModelSwitcher = document.getElementById('sidebar-btn-model-switcher');
    this.sidebarBtnAnalyzeRepo = document.getElementById('sidebar-btn-analyze-repo');
    this.sidebarBtnScreenshot = document.getElementById('sidebar-btn-screenshot');
    this.sidebarBtnCopyPage = document.getElementById('sidebar-btn-copy-page');
    this.sidebarBtnCopyLink = document.getElementById('sidebar-btn-copy-link');
    this.sidebarBtnNewChat = document.getElementById('sidebar-btn-new-chat');
    this.sidebarBtnHelp = document.getElementById('sidebar-btn-help');
    this.sidebarBtnSettings = document.getElementById('sidebar-btn-settings');
    this.rightSidebar = document.getElementById('right-sidebar');

    // Model switcher
    this.modelSwitcher = document.getElementById('model-switcher');
    this.modelList = document.getElementById('model-list');
    this.btnManageModels = document.getElementById('btn-manage-models');

    // Settings panel
    this.settingsPanel = document.getElementById('settings-panel');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.modelsListContainer = document.getElementById('models-list-container');
    this.btnAddModel = document.getElementById('btn-add-model');

    // Add model modal
    this.addModelModal = document.getElementById('add-model-modal');
    this.btnCloseModal = document.getElementById('btn-close-modal');
    this.btnCancelModel = document.getElementById('btn-cancel-model');
    this.addModelForm = document.getElementById('add-model-form');
    this.modelNameInput = document.getElementById('model-name');
    this.modelUrlInput = document.getElementById('model-url');
    this.modelEnabledCheckbox = document.getElementById('model-enabled');
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
    // Sidebar buttons
    this.sidebarBtnModelSwitcher.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModelSwitcher();
    });

    this.sidebarBtnNotes.addEventListener('click', () => this.toggleNotes());
    this.sidebarBtnAnalyzeRepo.addEventListener('click', () => this.analyzeGitHubRepo());
    this.sidebarBtnScreenshot.addEventListener('click', () => this.captureScreenshot());
    this.sidebarBtnCopyPage.addEventListener('click', () => this.copyPageContent());
    this.sidebarBtnCopyLink.addEventListener('click', () => this.copyLink());
    this.sidebarBtnNewChat.addEventListener('click', () => this.openNewChat());
    this.sidebarBtnSettings.addEventListener('click', () => this.showSettings());

    // Close model switcher when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.modelSwitcher.contains(e.target) && !this.sidebarBtnModelSwitcher.contains(e.target)) {
        this.hideModelSwitcher();
      }
    });

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

    // Notes panel buttons
    this.btnClearNotes.addEventListener('click', () => this.clearNotes());
    this.btnCopyNotes.addEventListener('click', () => this.copyNotes());

    // Screenshot panel buttons
    this.btnCopyScreenshot.addEventListener('click', () => this.copyScreenshot());
    this.btnDismissScreenshot.addEventListener('click', () => this.dismissScreenshot());

    // Iframe load handling
    this.aiFrame.addEventListener('load', () => this.handleFrameLoad());

    // Keyboard shortcut: Ctrl+N to toggle notes
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        this.toggleNotes();
      }
    });
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

  async showSettings() {
    await this.renderModelsList();
    await this.loadAutoPasteSettings();
    this.settingsPanel.classList.remove('hidden');
  }

  hideSettings() {
    this.settingsPanel.classList.add('hidden');
  }

  async loadAutoPasteSettings() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      const autoPaste = settings?.autoPaste ?? true;
      const autoSubmit = settings?.autoSubmit ?? false;
      const showScreenshotPreview = settings?.showScreenshotPreview ?? false;

      // Update toggle switches
      const autoPasteToggle = document.getElementById('setting-auto-paste-toggle');
      const autoSubmitToggle = document.getElementById('setting-auto-submit-toggle');
      const screenshotPreviewToggle = document.getElementById('setting-screenshot-preview-toggle');

      if (autoPasteToggle) autoPasteToggle.checked = autoPaste;
      if (autoSubmitToggle) autoSubmitToggle.checked = autoSubmit;
      if (screenshotPreviewToggle) screenshotPreviewToggle.checked = showScreenshotPreview;

      // Add event listeners if not already added
      if (!this.settingsListenersAdded) {
        autoPasteToggle?.addEventListener('change', (e) => this.saveAutoPasteSetting(e.target.checked));
        autoSubmitToggle?.addEventListener('change', (e) => this.saveAutoSubmitSetting(e.target.checked));
        screenshotPreviewToggle?.addEventListener('change', (e) => this.saveScreenshotPreviewSetting(e.target.checked));
        this.settingsListenersAdded = true;
      }
    } catch (error) {
      console.error('[Yavar] Failed to load auto-paste settings:', error);
    }
  }

  async saveAutoPasteSetting(enabled) {
    try {
      const { settings } = await chrome.storage.sync.get('settings') || {};
      const newSettings = { ...settings, autoPaste: enabled };
      await chrome.storage.sync.set({ settings: newSettings });
      console.log('[Yavar] Auto-paste setting saved:', enabled);
    } catch (error) {
      console.error('[Yavar] Failed to save auto-paste setting:', error);
    }
  }

  async saveAutoSubmitSetting(enabled) {
    try {
      const { settings } = await chrome.storage.sync.get('settings') || {};
      const newSettings = { ...settings, autoSubmit: enabled };
      await chrome.storage.sync.set({ settings: newSettings });
      console.log('[Yavar] Auto-submit setting saved:', enabled);
    } catch (error) {
      console.error('[Yavar] Failed to save auto-submit setting:', error);
    }
  }

  async saveScreenshotPreviewSetting(enabled) {
    try {
      const { settings } = await chrome.storage.sync.get('settings') || {};
      const newSettings = { ...settings, showScreenshotPreview: enabled };
      await chrome.storage.sync.set({ settings: newSettings });
      console.log('[Yavar] Screenshot preview setting saved:', enabled);
    } catch (error) {
      console.error('[Yavar] Failed to save screenshot preview setting:', error);
    }
  }

  async getAutoPasteSettings() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      return {
        autoPaste: settings?.autoPaste ?? true,
        autoSubmit: settings?.autoSubmit ?? false,
        showScreenshotPreview: settings?.showScreenshotPreview ?? false
      };
    } catch (error) {
      console.error('[Yavar] Failed to get auto-paste settings:', error);
      return { autoPaste: true, autoSubmit: false, showScreenshotPreview: false };
    }
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

  // ========== GitHub Analysis ==========

  async analyzeGitHubRepo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('github.com')) {
      this.showNotification('⚠️ Open a GitHub repository to use this feature');
      return;
    }

    // Extract owner/repo from tab URL
    const url = new URL(tab.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      this.showNotification('⚠️ Navigate to a GitHub repository page');
      return;
    }
    const [owner, repo] = pathParts;

    this.showNotification('🔄 Analyzing repository...');

    try {
      const scanResult = await this.scanRepoRobust(owner, repo);

      // Auto-submit to AI chat
      const { autoPaste, autoSubmit } = await this.getAutoPasteSettings();
      if (autoPaste) {
        this.forwardToIframe({ prompt: scanResult, autoSubmit });
      }

      // Also copy to clipboard as fallback
      await navigator.clipboard.writeText(scanResult);
      this.showNotification('🚀 Repo analysis sent to chat & copied to clipboard!');

    } catch (error) {
      console.error('[Yavar] GitHub analysis failed:', error);
      this.showNotification('⚠️ Analysis failed: ' + error.message);
    }
  }

  async scanRepoRobust(owner, repo) {
    const SAFE_FILE_LIMIT = 300;

    const fetchJSON = async (url) => {
      const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json();
    };

    const repoInfo = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`);
    const branch = repoInfo.default_branch;

    const [treeData, readmeData] = await Promise.all([
      fetchJSON(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`),
      fetchJSON(`https://api.github.com/repos/${owner}/${repo}/readme`).catch(() => ({ content: null }))
    ]);

    // --- DEP-SNIFFER: Extract dependency/tech stack info ---
    let depContext = 'DEPENDENCIES / TECH STACK\n========================\n';
    const manifestFiles = treeData.tree.filter(f =>
      ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml'].includes(f.path.split('/').pop())
    ).slice(0, 3);

    for (const file of manifestFiles) {
      try {
        const contentData = await fetchJSON(file.url);
        const raw = atob(contentData.content);
        const lines = raw.split('\n').filter(l => /^[ \t]*["\w\-_]+[:==]/.test(l)).join('\n');
        depContext += `FILE: ${file.path}\n${lines}\n\n`;
      } catch (e) { /* skip unreadable manifests */ }
    }

    // --- README: Preserve code blocks, filter fluff ---
    let semanticContext = `PROJECT: ${owner}/${repo}\n========================\n`;
    if (readmeData.content) {
      const rawReadme = atob(readmeData.content.replace(/\s/g, ''));
      const sections = rawReadme.match(/(##|###).*?(?=(##|###)|$)/gs) || [rawReadme.substring(0, 2000)];
      sections.forEach(section => {
        if (/Community|License|Sponsors|Star|Latest/i.test(section)) return;
        semanticContext += section
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
          .trim() + '\n\n';
      });
    }

    // --- LOGIC TREE: Filter to meaningful source files ---
    const logicExtensions = ['.py', '.go', '.js', '.ts', '.java', '.cpp', '.rs', '.rb', '.php', '.cs'];
    const baselineExclude = ['node_modules', '.github', 'dist', 'vendor', 'build'];

    let validFiles = treeData.tree.filter(item => {
      const parts = item.path.split('/');
      const name = parts[parts.length - 1];
      if (baselineExclude.some(d => parts.includes(d)) || name.startsWith('.')) return false;
      if (!logicExtensions.some(ext => name.endsWith(ext)) && item.type !== 'tree') return false;
      return parts.length <= 5;
    });

    if (validFiles.filter(i => i.type !== 'tree').length > SAFE_FILE_LIMIT) {
      validFiles = validFiles.filter(item => !['tests', 'docs', 'assets'].some(d => item.path.includes(d)));
    }

    let treeMap = 'LOGIC TREE\n==========\n';
    validFiles.slice(0, SAFE_FILE_LIMIT + 50).forEach(item => {
      const parts = item.path.split('/');
      treeMap += '  '.repeat(parts.length - 1) + (item.type === 'tree' ? '📂 ' : '📄 ') + parts.pop() + '\n';
    });

    const learningPrompt = `
---
Act as a Senior Software Architect and Coding Mentor. Using the DEPENDENCIES/TECH STACK, PROJECT/README, and LOGIC TREE above, guide my learning of this codebase.

Your Rules:
- Do not explain everything at once. Start by explaining the core "Mental Model" of how the system moves from a request to a response in this specific project.
- Use a "Socratic" approach: explain a concept, show a file path from the tree as an example, then ask me a question to verify my understanding.
- After each milestone, give me a tiny "Build Challenge" (3-5 lines of code) to implement a basic feature using the existing abstractions.
- Keep explanations grounded in the actual file structure provided.

First Task: Based on the tree and tech stack, what is the single most important directory I should look at first to understand how the core logic works, and why?`;

    return depContext + '\n' + semanticContext + '\n' + treeMap + learningPrompt;
  }

  // ========== Screenshot Functions ==========

  async captureScreenshot() {
    try {
      // Ask background to inject area selection overlay on the active tab
      chrome.runtime.sendMessage({ action: 'start_area_select' });
    } catch (error) {
      console.error('[Yavar] Screenshot capture failed:', error);
      this.showNotification('❌ Failed to capture screenshot.');
    }
  }

  showScreenshotPanel(dataUrl) {
    this.screenshotImg.src = dataUrl;
    this.screenshotPanel.classList.remove('hidden');
  }

  async cropAndShowScreenshot(dataUrl, rect) {
    console.log('[Yavar] cropAndShowScreenshot called with rect:', rect);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * rect.dpr;
      canvas.height = rect.height * rect.dpr;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,
        rect.x * rect.dpr, rect.y * rect.dpr,
        rect.width * rect.dpr, rect.height * rect.dpr,
        0, 0,
        rect.width * rect.dpr, rect.height * rect.dpr
      );
      const croppedUrl = canvas.toDataURL('image/png');
      this.capturedScreenshot = croppedUrl;
      
      // Check showScreenshotPreview setting before showing panel
      this.getAutoPasteSettings().then(({ showScreenshotPreview }) => {
        if (showScreenshotPreview) {
          this.showScreenshotPanel(croppedUrl);
        }
      });
      
      console.log('[Yavar] Calling autoPasteScreenshotToChat');
      this.autoPasteScreenshotToChat(croppedUrl);
    };
    img.onerror = () => {
      console.error('[Yavar] Failed to load screenshot image');
      this.showNotification('❌ Failed to process screenshot');
    };
    img.src = dataUrl;
  }

  async autoPasteScreenshotToChat(dataUrl) {
    try {
      // Store screenshot for iframe to pick up
      await chrome.storage.session.set({
        pendingScreenshotPaste: dataUrl,
        lastScreenshotTime: Date.now()
      });
      console.log('[Yavar] Stored pending screenshot paste in session');

      // Notify iframe to paste the screenshot
      this.forwardScreenshotToIframe(dataUrl);

    } catch (error) {
      console.error('[Yavar] Failed to send screenshot to chat:', error);
      this.showNotification('📸 Screenshot captured! Click "Copy Image" to copy');
    }
  }

  forwardScreenshotToIframe(screenshotDataUrl) {
    const payload = { 
      action: 'AUTO_PASTE_SCREENSHOT', 
      imageData: screenshotDataUrl 
    };

    // Staggered sends — the iframe/bridge may not be fully interactive yet
    const delays = [0, 400, 1200, 2500];
    delays.forEach(delay => {
      setTimeout(() => {
        try {
          if (this.aiFrame && this.aiFrame.contentWindow) {
            console.log(`[Yavar Sidepanel] Sending screenshot to iframe (delay=${delay}ms)`);
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

  // ========== Notes Panel ==========

  initCodeMirror() {
    this.cmEditor = CodeMirror(this.notesEditorContainer, {
      mode: 'javascript',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      indentWithTabs: false,
      placeholder: 'Write notes, code snippets, ideas...',
      autofocus: false
    });
    this.cmEditor.on('change', () => this.saveNotes());
  }

  toggleNotes() {
    this.notesOpen = !this.notesOpen;
    if (this.notesOpen) {
      this.notesPanel.classList.remove('hidden');
      this.sidebarBtnNotes.classList.add('sidebar-btn-active');
      this.loadNotes();
      this.cmEditor.refresh();
      this.cmEditor.focus();
    } else {
      this.notesPanel.classList.add('hidden');
      this.sidebarBtnNotes.classList.remove('sidebar-btn-active');
      this.saveNotes();
    }
  }

  async loadNotes() {
    try {
      const { yavarNotes } = await chrome.storage.local.get('yavarNotes');
      this.cmEditor.setValue(yavarNotes || '');
    } catch (e) {
      console.error('[Yavar] Failed to load notes:', e);
    }
  }

  saveNotes() {
    chrome.storage.local.set({ yavarNotes: this.cmEditor.getValue() });
  }

  clearNotes() {
    this.cmEditor.setValue('');
    this.saveNotes();
  }

  async copyNotes() {
    try {
      await navigator.clipboard.writeText(this.cmEditor.getValue());
      this.showNotification('Copied notes to clipboard!');
    } catch (e) {
      console.error('[Yavar] Failed to copy notes:', e);
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

  // ========== Message Listener ==========

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Yavar Sidepanel] Message received:', message);

      if (message.type === 'TEXT_SELECTION') {
        this.handleTextSelection(message.text);
      }

      if (message.type === 'SCREENSHOT_CAPTURED') {
        console.log('[Yavar Sidepanel] SCREENSHOT_CAPTURED received, rect:', message.rect, 'imageData length:', message.imageData?.length);
        if (message.rect) {
          // Crop to selected area
          console.log('[Yavar Sidepanel] Calling cropAndShowScreenshot');
          this.cropAndShowScreenshot(message.imageData, message.rect);
        } else {
          console.log('[Yavar Sidepanel] No rect, showing full screenshot');
          this.capturedScreenshot = message.imageData;
          this.showScreenshotPanel(message.imageData);
        }
      }

      if (message.action === 'trigger_learn') {
        // Trigger GitHub analysis when keyboard shortcut is pressed
        this.analyzeGitHubRepo();
      }

      if (message.action === 'AUTO_SUBMIT_PROMPT' && message.prompt) {
        // Only forward if we haven't already handled this prompt via checkPendingAutoSubmit
        // The background sends staggered retries — only honor the first one
        if (!this._lastForwardedPrompt || this._lastForwardedPrompt !== message.prompt ||
            Date.now() - (this._lastForwardedTime || 0) > 8000) {
          console.log('[Yavar Sidepanel] Received AUTO_SUBMIT_PROMPT, forwarding to iframe');
          this._lastForwardedPrompt = message.prompt;
          this._lastForwardedTime = Date.now();
          this.forwardToIframe(message);
        } else {
          console.log('[Yavar Sidepanel] Ignoring duplicate AUTO_SUBMIT_PROMPT from staggered retry');
        }
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

  setupStorageListener() {
    // Listen for screenshot data that arrives after sidepanel loads
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'session') return;

      if (changes.pendingScreenshot) {
        const { newValue, oldValue } = changes.pendingScreenshot;
        if (newValue) {
          console.log('[Yavar Sidepanel] Storage listener: screenshot arrived');
          chrome.storage.session.get('pendingScreenshotRect').then(result => {
            const rect = result?.pendingScreenshotRect;
            if (rect) {
              this.cropAndShowScreenshot(newValue, rect);
              chrome.storage.session.remove('pendingScreenshotRect');
            } else {
              this.capturedScreenshot = newValue;
              this.showScreenshotPanel(newValue);
            }
            chrome.storage.session.remove('pendingScreenshot');
          });
        }
      }
    });
  }

  async checkPendingData() {
    try {
      const result = await chrome.storage.session.get(['pendingText', 'pendingScreenshot', 'pendingScreenshotRect', 'pendingNotification']);

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
        console.log('[Yavar Sidepanel] Found pending screenshot in storage, rect:', result.pendingScreenshotRect);
        if (result.pendingScreenshotRect) {
          // Crop to selected area
          this.cropAndShowScreenshot(result.pendingScreenshot, result.pendingScreenshotRect);
        } else {
          this.capturedScreenshot = result.pendingScreenshot;
          this.showScreenshotPanel(result.pendingScreenshot);
        }
        await chrome.storage.session.remove('pendingScreenshot');
        await chrome.storage.session.remove('pendingScreenshotRect');
      }
    } catch (error) {
      console.error('[Yavar] Failed to check pending data:', error);
    }

    // Also check for pending auto-submit
    this.checkPendingAutoSubmit();
  }

  async checkPendingAutoSubmit() {
    console.log('[Yavar Sidepanel] checkPendingAutoSubmit called');
    try {
      const result = await chrome.storage.session.get(['pendingAutoSubmit', 'lastSubmitTime']);
      console.log('[Yavar Sidepanel] checkPendingAutoSubmit result:', result);
      if (result.pendingAutoSubmit && Date.now() - result.lastSubmitTime < 120000) {
        console.log('[Yavar Sidepanel] Found pending auto-submit prompt, length:', result.pendingAutoSubmit?.length);
        
        // Check settings
        const { autoPaste, autoSubmit } = await this.getAutoPasteSettings();
        
        if (autoPaste) {
          // Only forward if message listener hasn't already handled this prompt
          if (this._lastForwardedPrompt === result.pendingAutoSubmit &&
              Date.now() - (this._lastForwardedTime || 0) < 8000) {
            console.log('[Yavar Sidepanel] Skipping checkPending — already forwarded by message listener');
          } else {
            this._lastForwardedPrompt = result.pendingAutoSubmit;
            this._lastForwardedTime = Date.now();
            this.forwardToIframe({ prompt: result.pendingAutoSubmit, autoSubmit: autoSubmit });
            console.log('[Yavar Sidepanel] Forwarding to iframe (autoSubmit:', autoSubmit + ')');
          }
        } else {
          // Just notify user
          this.showNotification('📋 Text ready - click to paste manually');
          console.log('[Yavar Sidepanel] Auto-paste disabled, showing notification');
        }
        
        await chrome.storage.session.remove(['pendingAutoSubmit', 'lastSubmitTime']);
        console.log('[Yavar Sidepanel] Cleared pending auto-submit');
      } else {
        console.log('[Yavar Sidepanel] No valid pending auto-submit (expired or missing)');
      }
    } catch (error) {
      console.error('[Yavar Sidepanel] Failed to check pending auto-submit:', error);
    }
  }

  forwardToIframe(message) {
    const { prompt, autoSubmit } = message;
    const payload = { 
      action: autoSubmit ? 'AUTO_SUBMIT_PROMPT' : 'AUTO_PASTE_PROMPT',
      prompt: prompt
    };

    console.log('[Yavar Sidepanel] forwardToIframe:', payload.action);

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
