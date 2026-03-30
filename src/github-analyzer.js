// GitHub Repo Analyzer - Smart Scraper with API + DOM Fallback
// Runs only on GitHub.com to extract repo structure and code context

class YavarGitHubAnalyzer {
  constructor() {
    this.isGitHub = window.location.hostname.includes('github.com');
    if (!this.isGitHub) return;

    this.init();
  }

  init() {
    this.addMessageListener();
    this.waitForGitHubReady();
  }

  /**
   * Wait for GitHub's React app to be fully loaded
   * GitHub uses Turbo/pushState, so we need to wait for the app-private element
   */
  waitForGitHubReady() {
    // Check if GitHub's React app is ready
    const isReady = document.querySelector('[data-turbo-body]') || 
                    document.querySelector('react-app-private') ||
                    document.querySelector('#repo-content-turbo-frame');
    
    if (isReady) {
      console.log('[GitHub Analyzer] GitHub React app is ready');
    } else {
      console.log('[GitHub Analyzer] Waiting for GitHub React app to load...');
      
      const observer = new MutationObserver((mutations, obs) => {
        const ready = document.querySelector('[data-turbo-body]') || 
                      document.querySelector('react-app-private') ||
                      document.querySelector('#repo-content-turbo-frame');
        
        if (ready) {
          console.log('[GitHub Analyzer] GitHub React app loaded');
          obs.disconnect();
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Timeout after 5 seconds
      setTimeout(() => observer.disconnect(), 5000);
    }
  }

  addMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'scrape_github') {
        console.log('[GitHub Analyzer] Received scrape_github request');
        
        // Try API first, fallback to DOM scraping
        this.scrapeRepoWithAPI()
          .then(data => {
            console.log('[GitHub Analyzer] API success:', data.repoName);
            sendResponse(data);
          })
          .catch((error) => {
            console.warn('[GitHub Analyzer] API failed, using DOM fallback:', error.message);
            // Fallback to DOM scraping if API fails
            const domData = this.scrapeRepo();
            sendResponse(domData);
          });
        return true; // Keep channel open for async response
      }

      if (request.action === 'get_selected_code') {
        const selection = window.getSelection().toString();
        sendResponse({ selection });
        return true;
      }
    });
  }

  /**
   * Primary: Fetch repo data via GitHub API (direct fetch from content script)
   * This bypasses the background service worker to avoid "context lost" issues
   */
  async scrapeRepoWithAPI() {
    const urlParts = window.location.pathname.split('/').filter(Boolean);
    const [owner, repo] = urlParts;

    console.log('[GitHub Analyzer] Attempting direct API fetch for:', owner, repo);

    if (!owner || !repo) {
      console.error('[GitHub Analyzer] Invalid owner/repo');
      throw new Error('Invalid GitHub URL');
    }

    try {
      // Get token from storage
      const { githubToken } = await chrome.storage.local.get('githubToken');
      
      const headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ChromeSideBar/1.0'
      };
      
      if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
        console.log('[GitHub Analyzer] Using GitHub token');
      } else {
        console.log('[GitHub Analyzer] No token - using unauthenticated rate limit (60/hr)');
      }

      // Fetch repo info
      console.log('[GitHub Analyzer] Fetching repo info...');
      const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      
      if (!repoResponse.ok) {
        const errorData = await repoResponse.json();
        throw new Error(`GitHub API error: ${repoResponse.status} - ${errorData.message}`);
      }
      
      const repoData = await repoResponse.json();
      console.log('[GitHub Analyzer] Repo info fetched:', repoData.full_name);

      // Fetch README
      console.log('[GitHub Analyzer] Fetching README...');
      const readmeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
      let readme = 'No README found';
      
      if (readmeResponse.ok) {
        const readmeData = await readmeResponse.json();
        readme = atob(readmeData.content).slice(0, 2000);
      }

      // Fetch contents (file tree)
      console.log('[GitHub Analyzer] Fetching file tree...');
      const contentsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
      let files = [];
      
      if (contentsResponse.ok) {
        const contents = await contentsResponse.json();
        files = contents
          .filter(item => item.type === 'file')
          .map(file => file.name)
          .slice(0, 30);
      }

      return {
        success: true,
        owner,
        repo,
        repoName: `${owner}/${repo}`,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        description: repoData.description || 'No description',
        topics: repoData.topics || [],
        language: repoData.language,
        files,
        readme,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('[GitHub Analyzer] Direct API fetch failed:', error);
      throw error;
    }
  }

  /**
   * Fallback: Scrape repo data from DOM (when API unavailable)
   */
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
      timestamp: new Date().toISOString(),
      source: 'dom-fallback' // Mark as DOM-scraped
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
