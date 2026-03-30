// GitHub API Wrapper
// Handles all GitHub API calls with rate limit management and error handling

export class GitHubAPI {
  constructor() {
    this.baseUrl = 'https://api.github.com';
    this.defaultHeaders = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ChromeSideBar-Learning-Tool/1.0'
    };
  }

  /**
   * Get API headers with optional token
   */
  async getHeaders() {
    const { githubToken } = await chrome.storage.local.get('githubToken');
    const headers = { ...this.defaultHeaders };
    
    if (githubToken) {
      headers['Authorization'] = `Bearer ${githubToken}`;
    }
    
    return headers;
  }

  /**
   * Fetch repository information (stars, forks, description, topics)
   */
  async fetchRepoInfo(owner, repo) {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, { headers });
    
    if (!response.ok) {
      throw this.handleError(response);
    }
    
    const data = await response.json();
    
    return {
      stars: data.stargazers_count,
      forks: data.forks_count,
      description: data.description || 'No description',
      topics: data.topics || [],
      language: data.language,
      updatedAt: data.updated_at,
      createdAt: data.created_at
    };
  }

  /**
   * Fetch repository contents (file tree)
   */
  async fetchRepoContents(owner, repo, path = '') {
    const headers = await this.getHeaders();
    const url = path 
      ? `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`
      : `${this.baseUrl}/repos/${owner}/${repo}/contents`;
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw this.handleError(response);
    }
    
    const data = await response.json();
    
    // Handle single file response
    if (!Array.isArray(data)) {
      return [data];
    }
    
    return data;
  }

  /**
   * Fetch README content
   */
  async fetchReadme(owner, repo) {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/readme`, { headers });
    
    if (!response.ok) {
      if (response.status === 404) {
        return { content: 'No README found', format: 'text' };
      }
      throw this.handleError(response);
    }
    
    const data = await response.json();
    
    // Base64 decode the content
    const content = atob(data.content);
    
    return {
      content: content.slice(0, 2000), // Limit for prompt context
      format: data.encoding,
      name: data.name
    };
  }

  /**
   * Fetch a single file's content
   */
  async fetchFileContent(owner, repo, filePath) {
    const headers = await this.getHeaders();
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
      { headers }
    );
    
    if (!response.ok) {
      throw this.handleError(response);
    }
    
    const data = await response.json();
    
    // Base64 decode
    const content = atob(data.content);
    
    return {
      content: content.slice(0, 5000), // Limit for context
      size: data.size,
      language: this.detectLanguage(filePath),
      path: data.path
    };
  }

  /**
   * Detect programming language from file extension
   */
  detectLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const languageMap = {
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'py': 'Python',
      'java': 'Java',
      'cpp': 'C++',
      'c': 'C',
      'cs': 'C#',
      'go': 'Go',
      'rs': 'Rust',
      'rb': 'Ruby',
      'php': 'PHP',
      'swift': 'Swift',
      'kt': 'Kotlin',
      'scala': 'Scala',
      'r': 'R',
      'sh': 'Shell',
      'bash': 'Bash',
      'zsh': 'Zsh',
      'html': 'HTML',
      'css': 'CSS',
      'scss': 'SCSS',
      'sass': 'Sass',
      'less': 'Less',
      'json': 'JSON',
      'yaml': 'YAML',
      'yml': 'YAML',
      'xml': 'XML',
      'md': 'Markdown',
      'txt': 'Text',
      'sql': 'SQL',
      'ex': 'Elixir',
      'exs': 'Elixir',
      'erl': 'Erlang',
      'hs': 'Haskell',
      'lua': 'Lua',
      'm': 'Objective-C',
      'mm': 'Objective-C++',
      'pl': 'Perl',
      'pm': 'Perl',
      'rkt': 'Racket',
      'clj': 'Clojure',
      'vim': 'Vim',
      'dockerfile': 'Dockerfile',
      'makefile': 'Makefile'
    };
    
    return languageMap[ext] || 'Unknown';
  }

  /**
   * Get file tree with limited depth (recursive)
   */
  async fetchFileTree(owner, repo, maxDepth = 2, maxFiles = 50) {
    const files = [];
    
    async function fetchDir(path = '', depth = 0) {
      if (depth > maxDepth || files.length >= maxFiles) return;
      
      try {
        const contents = await this.fetchRepoContents(owner, repo, path);
        
        for (const item of contents) {
          if (files.length >= maxFiles) break;
          
          if (item.type === 'file') {
            files.push({
              name: item.name,
              path: item.path,
              size: item.size,
              language: this.detectLanguage(item.name)
            });
          } else if (item.type === 'dir' && depth < maxDepth) {
            // Skip common non-essential directories
            if (!['node_modules', '.git', 'vendor', 'dist', 'build'].includes(item.name)) {
              await fetchDir(item.path, depth + 1);
            }
          }
        }
      } catch (error) {
        console.warn(`[GitHubAPI] Failed to fetch ${path}:`, error.message);
      }
    }
    
    await fetchDir.call(this);
    return files;
  }

  /**
   * Check rate limit status
   */
  async checkRateLimit() {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/rate_limit`, { headers });
    
    if (!response.ok) {
      return { error: 'Failed to check rate limit' };
    }
    
    const data = await response.json();
    return data.resources;
  }

  /**
   * Handle API errors
   */
  handleError(response) {
    const status = response.status;
    
    if (status === 401) {
      return new Error('Invalid GitHub token. Please check your token in settings.');
    }
    
    if (status === 403) {
      return new Error('Rate limit exceeded. Please wait or add a GitHub token in settings.');
    }
    
    if (status === 404) {
      return new Error('Repository not found. Please check the URL.');
    }
    
    return new Error(`GitHub API error: ${status}`);
  }

  /**
   * Fetch all data needed for a repo (parallel requests)
   */
  async fetchAllData(owner, repo) {
    try {
      const [repoInfo, fileTree, readme] = await Promise.all([
        this.fetchRepoInfo(owner, repo),
        this.fetchFileTree(owner, repo, 2, 30),
        this.fetchReadme(owner, repo)
      ]);
      
      return {
        success: true,
        owner,
        repo,
        repoName: `${owner}/${repo}`,
        ...repoInfo,
        files: fileTree.map(f => f.name),
        fileTree,
        readme: readme.content,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        owner,
        repo,
        repoName: `${owner}/${repo}`,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
export const githubAPI = new GitHubAPI();
