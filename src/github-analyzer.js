// GitHub Repo Analyzer - Smart Scraper
// Runs only on GitHub.com to extract repo structure and code context

class YavarGitHubAnalyzer {
  constructor() {
    this.isGitHub = window.location.hostname.includes('github.com');
    if (!this.isGitHub) return;

    this.init();
  }

  init() {
    this.addMessageListener();
  }

  addMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'scrape_github') {
        const data = this.scrapeRepo();
        sendResponse(data);
        return true;
      }
      
      if (request.action === 'get_selected_code') {
        const selection = window.getSelection().toString();
        sendResponse({ selection });
        return true;
      }
    });
  }

  scrapeRepo() {
    // Get repo info from URL
    const urlParts = window.location.pathname.split('/').filter(Boolean);
    const [owner, repo] = urlParts;
    
    // Extract file tree (2025+ GitHub selectors)
    // Target ONLY actual file rows, ignoring nav tabs (Issues, PRs, Actions)
    const fileSelectors = [
      'div.react-directory-filename-column a',
      'a[data-turbo-frame="repo-content-turbo-frame"]',
      '[role="row"] a[href*="/blob/"]',
      '.js-navigation-item a[title]'
    ];
    
    const fileElements = document.querySelectorAll(fileSelectors.join(', '));
    const uiNoise = ['Issues', 'Pull requests', 'Actions', 'Projects', 'Discussions', 'Security', 'Insights', 'Settings'];
    
    const files = Array.from(fileElements)
      .map(el => el.innerText.trim())
      .filter(name => {
        // Filter out: empty, UI tabs, pure numbers, very long strings
        if (!name || name.length === 0) return false;
        if (uiNoise.includes(name)) return false;
        if (/^\d+$/.test(name)) return false;
        if (name.length > 50) return false;
        return true;
      })
      .slice(0, 25);
    
    // Extract README content - 2026 GitHub lazy-loads in React containers
    const readmeSelectors = [
      '[data-target="readme-toc.content"] article',
      '#readme article',
      '.Box-body .markdown-body',
      '[data-selector="repo-content-readme"]'
    ];
    
    const readmeElement = document.querySelector(readmeSelectors.join(', '));
    const readme = readmeElement 
      ? readmeElement.innerText.slice(0, 1200) 
      : 'README not visible (may be deep in page or lazy-loaded)';
    
    // Extract stats
    const starsEl = document.querySelector('#repo-stars-counter-star, #repo-stars-counter');
    const stars = starsEl?.innerText?.trim() || starsEl?.title || '0';
    
    const forksEl = document.querySelector('[aria-label="Forks"]');
    const forks = forksEl?.innerText?.trim() || '0';
    
    // Extract description
    const description = document.querySelector('meta[name="description"]')?.content || '';
    
    // Extract topics/tags
    const topics = Array.from(document.querySelectorAll('.topic-tag, .js-topic-button'))
      .map(el => el.innerText.trim())
      .filter(t => t && t.length > 0 && t.length < 30)
      .slice(0, 10);
    
    // Extract current file content if viewing a file (not repo root)
    const fileContent = document.querySelector('[data-line-numbers], .BlobContent, pre[class*="highlight"]')?.innerText;
    
    return {
      url: window.location.href,
      owner: owner || 'unknown',
      repo: repo || 'unknown',
      repoName: `${owner || 'unknown'}/${repo || 'unknown'}`,
      files,
      fileCount: files.length,
      readme,
      fileContent: fileContent?.slice(0, 2000),
      description,
      topics,
      stars,
      forks,
      timestamp: new Date().toISOString()
    };
  }
}

// Initialize on GitHub pages only
if (window.location.hostname.includes('github.com')) {
  // Wait for DOM to be ready (GitHub uses Turbo)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new YavarGitHubAnalyzer());
  } else {
    new YavarGitHubAnalyzer();
  }

  // Re-initialize on Turbo navigation
  document.addEventListener('turbo:load', () => {
    new YavarGitHubAnalyzer();
  });
}
