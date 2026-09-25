// Static checks for the unpacked extension (no build step to catch these):
//  - manifest.json parses and every file it references exists
//  - every <script src> / <link href> in the extension pages exists
//  - every source file parses
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const errors = [];
const need = (rel, from) => {
  if (!existsSync(join(root, rel))) errors.push(`${from}: missing file ${rel}`);
};

// ---- manifest ----
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
} catch (e) {
  console.error('manifest.json: ' + e.message);
  process.exit(1);
}
if (manifest.manifest_version !== 3) errors.push('manifest.json: expected manifest_version 3');

need(manifest.background?.service_worker, 'background.service_worker');
need(manifest.side_panel?.default_path, 'side_panel.default_path');
need(manifest.options_page, 'options_page');
Object.values(manifest.icons || {}).forEach(p => need(p, 'icons'));
Object.values(manifest.action?.default_icon || {}).forEach(p => need(p, 'action.default_icon'));
(manifest.content_scripts || []).forEach((cs, i) =>
  [...(cs.js || []), ...(cs.css || [])].forEach(p => need(p, `content_scripts[${i}]`)));
(manifest.declarative_net_request?.rule_resources || []).forEach(r => need(r.path, 'rule_resources'));

// ---- extension pages ----
for (const page of [manifest.side_panel?.default_path, manifest.options_page].filter(Boolean)) {
  const html = readFileSync(join(root, page), 'utf8');
  for (const m of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) need(m[1], page);
    else errors.push(`${page}: remote resource ${m[1]} (MV3 pages can't load remote code)`);
  }
  if (/\son[a-z]+="/i.test(html)) errors.push(`${page}: inline event handler (blocked by the extension CSP)`);
}

// ---- syntax ----
const walk = (dir) => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))].filter(f => /\.m?js$/.test(f))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`${file.slice(root.length + 1)}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`);
  }
}

if (errors.length) {
  console.error(errors.map(e => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ manifest v${manifest.version}, referenced files and syntax OK`);
