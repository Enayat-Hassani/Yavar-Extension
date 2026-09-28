// What the browser journeys share: Yavar loaded as an extension in Chromium,
// a real git repository to read, and a stand-in for the chat.
//
// The journeys run a copy of the extension with one line added at the end of
// src/sidepanel.js that hands the panel to the page (window.__panel), so a
// journey can drive and observe it without a hook in the shipped code. The
// chat sites refuse headless browsers, so each journey stubs showAnswerIn
// (and askForJson where a walk needs one) with replies of its own.
//
// Run with `npm run e2e`. Locally, YAVAR_E2E_CHROME may point at a Chromium
// or Chrome for Testing binary; otherwise Playwright's own Chromium is used
// (`npx playwright install chromium`).

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, appendFileSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['.git', 'node_modules', 'tests', '.claude', '.github']);

let copy = null;
// The extension with the panel exposed; made once per test file
function extensionCopy() {
  if (copy) return copy;
  copy = mkdtempSync(join(tmpdir(), 'yavar-e2e-ext-'));
  for (const name of readdirSync(ROOT)) if (!SKIP.has(name)) cpSync(join(ROOT, name), join(copy, name), { recursive: true });
  appendFileSync(join(copy, 'src/sidepanel.js'), '\nwindow.__panel = panel;\n');
  return copy;
}

// A fresh browser profile with Yavar loaded. open(path) gives a page of the
// extension (sidepanel.html, reader.html, options.html).
export async function launch() {
  const ext = extensionCopy();
  const profile = mkdtempSync(join(tmpdir(), 'yavar-e2e-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    // Full Chromium: the lighter headless shell can't load extensions
    ...(process.env.YAVAR_E2E_CHROME ? { executablePath: process.env.YAVAR_E2E_CHROME } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const errors = [];
  const open = async (path, { width = 420, height = 900 } = {}) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
    await page.setViewportSize({ width, height });
    await page.goto(`chrome-extension://${id}/${path}`);
    if (path.startsWith('sidepanel')) await page.waitForFunction(() => window.__panel?.walkBody);
    return page;
  };
  return { ctx, id, open, errors, close: async () => { await ctx.close(); rmSync(profile, { recursive: true, force: true }); } };
}

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
});

// A repository with one commit of `before`, then `after` written on top and
// not committed. A null in `after` deletes the file.
export function makeRepo(before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'yavar-e2e-repo-'));
  const put = (files) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) { rmSync(join(dir, path), { force: true }); continue; }
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.hooksPath', '/dev/null');
  put(before);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  git(dir, 'gc', '-q');   // packed objects, as in most real repositories
  put(after);
  return dir;
}

// Every file under `dir`, .git included, as [path, base64] for the page
export function filesOf(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push([relative(dir, p), readFileSync(p).toString('base64')]);
    }
  };
  walk(dir);
  return out;
}

// Put a repository into the page's private file system (the folder picker
// can't be driven headless) and open it as Yavar's project folder
export async function openFolder(page, name, files) {
  await page.evaluate(async ([name, files]) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const [path, b64] of files) {
      let dir = root;
      const parts = path.split('/');
      for (const d of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(d, { create: true });
      const w = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      await w.close();
    }
    window.__panel.showReaderTab = async () => {};   // the reader tab is checked on its own page
    await window.__panel.openLocalFolder({ handle: root });
  }, [name, files]);
}

// The chat, stood in for: every question is recorded in window.__asks, and
// `reply` (a function source, called with (label, prompt, opts)) answers it,
// drawn as a real answer card
export async function stubChat(page, reply) {
  await page.evaluate((src) => {
    const answer = new Function(`return (${src})`)();
    window.__asks = [];
    const p = window.__panel;
    p.showAnswerIn = async (el, label, prompt, opts = {}) => {
      window.__asks.push({ label, prompt, attached: (opts.attachments || []).map(a => a.filename), attachments: opts.attachments || [] });
      const text = answer(label, prompt, opts);
      const card = p.answerCard(el, { title: label, collapsible: true, openInChat: false, inline: true });
      card.done(text);
      return text;
    };
  }, reply.toString());
}

export const wait = (page, ms) => page.waitForTimeout(ms);
