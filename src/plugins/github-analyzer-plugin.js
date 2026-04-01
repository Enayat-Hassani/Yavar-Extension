// GitHub Analyzer Plugin
// Activates on github.com to provide repository analysis

import { BasePlugin } from './base-plugin.js';

export class GitHubAnalyzerPlugin extends BasePlugin {
  constructor() {
    super({
      name: 'GitHub Analyzer',
      description: 'Analyze GitHub repositories with structured file trees and README extraction',
      version: '2.0.0',
      matchPatterns: ['*://github.com/*'],
      icon: '🐙'
    });

    this.config = {
      maxFilesPerFolder: 8,
      totalLimit: 400,
      readmeLimit: 5000
    };

    // Files that should NEVER be hidden (entry points)
    this.priorityFiles = ['main', 'app', 'index', 'server', 'core', 'api', 'init', 'manage', 'wsgi'];
    this.importantExts = ['.py', '.ts', '.js', '.json', '.sh', '.yaml', '.yml', '.go', '.rs', '.java', '.cpp'];
    this.junkPatterns = [/\.github/, /\.agents/, /node_modules/, /__pycache__/, /LICENSE/, /\.md$/, /\.png$/, /\.jpg$/, /\.svg$/, /\.lock$/];
  }

  async onInit() {
    console.log(`[Plugin:${this.name}] Activated on ${window.location.hostname}`);
  }

  /**
   * Handle plugin-specific messages from content script
   * This is called directly by the content script, not via chrome.runtime.onMessage
   */
  handleMessage(request) {
    switch (request.action) {
      case 'scrape_github':
      case 'scan_repo':
        return this.scanRepo()
          .then(data => {
            console.log(`[Plugin:${this.name}] Scan success:`, data.repoName);
            return data;
          })
          .catch((error) => {
            console.error(`[Plugin:${this.name}] Scan failed:`, error);
            throw error;
          });

      case 'get_plugin_info':
        return Promise.resolve(this.getInfo());

      case 'get_selected_code':
        const selection = window.getSelection().toString();
        return Promise.resolve({ selection });

      default:
        return Promise.resolve({ error: 'Unknown action' });
    }
  }

  async scanRepo() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      throw new Error('Not on a GitHub repo page');
    }

    const config = {
      owner: pathParts[0],
      repo: pathParts[1],
      branch: (pathParts[2] === 'tree') ? pathParts[3] : null, // resolved after meta fetch
      maxFilesPerFolder: this.config.maxFilesPerFolder,
      totalLimit: this.config.totalLimit,
      readmeLimit: this.config.readmeLimit
    };

    console.log(`%c🚀 Deep Scanning ${config.repo}...`, "color: #00d2ff; font-weight: bold;");

    try {
      // 1. Fetch Repo Metadata (Stars, Description, Languages)
      const repoMetaRes = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`);
      if (!repoMetaRes.ok) throw new Error(`Repo not found or inaccessible (${repoMetaRes.status})`);
      const meta = await repoMetaRes.json();

      // Use the API's default_branch (handles main/master/other)
      const branch = config.branch || meta.default_branch || 'main';

      // 2. Fetch File Tree via Git Trees API (public, no auth needed)
      const treeRes = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${branch}?recursive=1`);
      const treeData = await treeRes.json();

      if (treeData.message) {
        if (treeData.message.toLowerCase().includes('rate limit')) {
          throw new Error('GitHub API rate limit exceeded. Please wait a few minutes and try again.');
        }
        throw new Error(`GitHub API error: ${treeData.message}`);
      }

      if (!Array.isArray(treeData.tree)) {
        throw new Error('Could not retrieve repository file tree.');
      }

      // 3. Build Folder Structure
      const folders = {};
      treeData.tree.forEach(file => {
        if (file.type === 'blob' && !this.junkPatterns.some(re => re.test(file.path))) {
          const parts = file.path.split('/');
          const fileName = parts.pop();
          const dir = parts.join('/') || 'root';
          if (!folders[dir]) folders[dir] = [];
          folders[dir].push(fileName);
        }
      });

      // 4. Smart Structure with Ranking
      let structureOutput = `PROJECT: ${meta.full_name}\nDESCRIPTION: ${meta.description || 'No description'}\nSTARS: ${meta.stargazers_count}\n\n--- STRUCTURE ---`;
      
      for (const [dir, files] of Object.entries(folders)) {
        if (structureOutput.length > config.totalLimit) break;
        structureOutput += `\n📂 ${dir}/\n`;
        
        const sorted = files.sort((a, b) => {
          const aName = a.split('.')[0].toLowerCase();
          const bName = b.split('.')[0].toLowerCase();
          const aPri = this.priorityFiles.includes(aName) ? 2 : (this.importantExts.some(e => a.endsWith(e)) ? 1 : 0);
          const bPri = this.priorityFiles.includes(bName) ? 2 : (this.importantExts.some(e => b.endsWith(e)) ? 1 : 0);
          return bPri - aPri;
        });

        sorted.slice(0, config.maxFilesPerFolder).forEach(f => {
          structureOutput += `  ├── ${f}\n`;
        });
        if (files.length > config.maxFilesPerFolder) {
          structureOutput += `  └── ... (${files.length - config.maxFilesPerFolder} more)\n`;
        }
      }

      // 5. Heavy-Duty README Cleaning
      const readmeRes = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/readme`, {
        headers: { "Accept": "application/vnd.github.v3.raw" }
      });
      
      let rawText = '';
      if (readmeRes.ok) {
        rawText = await readmeRes.text();
      }

      let cleanReadme = rawText
        .replace(/\|(.+)\|/g, '')                    // Remove Markdown Tables (HUGE saving)
        .replace(/!\[.*?\]\(.*?\)/g, '')             // Remove Images
        .replace(/<[^>]*>/g, ' ')                    // Remove HTML
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')    // Links to text
        .replace(/https?:\/\/\S+/g, '')              // Remove URLs
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // No Emojis
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 10 && !/img.shields|Twitter|Discord|License/i.test(l))
        .join('\n')
        .substring(0, config.readmeLimit);

      // Find start of meaningful content
      const startIdx = Math.max(0, cleanReadme.search(/What is|Introduction|Overview|README/i));
      cleanReadme = cleanReadme.substring(startIdx, startIdx + config.readmeLimit);

      // 6. GET STARS/FORKS FROM DOM (no API needed)
      const starsEl = document.querySelector('#repo-stars-counter-star, #repo-stars-counter');
      const stars = starsEl?.innerText?.trim() || starsEl?.title || meta.stargazers_count || '0';

      const forksEl = document.querySelector('[aria-label="Forks"]');
      const forks = forksEl?.innerText?.trim() || '0';

      const description = meta.description || document.querySelector('meta[name="description"]')?.content || '';

      const topics = Array.from(document.querySelectorAll('.topic-tag, .js-topic-button'))
        .map(el => el.innerText.trim())
        .filter(t => t && t.length > 0 && t.length < 30)
        .slice(0, 10);

      return {
        success: true,
        owner: config.owner,
        repo: config.repo,
        repoName: `${config.owner}/${config.repo}`,
        plugin: this.name,
        stars,
        forks,
        description,
        topics,
        fileStructure: structureOutput,
        readme: cleanReadme || 'No README found',
        timestamp: new Date().toISOString(),
        source: 'dynamic-scan'
      };

    } catch (e) {
      console.error(`[Plugin:${this.name}] Scan failed:`, e);
      throw e;
    }
  }
}

