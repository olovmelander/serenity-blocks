#!/usr/bin/env node
/**
 * Boot-closure guard (app boot, 2026-08-21). Walks dist/manifest.json and fails when the
 * production boot path regrows: the entry's static closure must stay tiny, and the main chunk's
 * static closure must contain no theme-*, mode-*, phaser or three chunk (the lazy intent of
 * vite.config.js manualChunks). Run after `vite build`: `node scripts/check-boot-closure.mjs`.
 * `--print` lists both closures with sizes.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIST = path.join(ROOT, 'dist');
const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const print = process.argv.includes('--print');

const size = (file) => { try { return statSync(path.join(DIST, file)).size; } catch { return 0; } };
const closure = (key) => {
    const seen = new Set();
    const walk = (k) => { if (seen.has(k) || !manifest[k]) return; seen.add(k); (manifest[k].imports || []).forEach(walk); };
    walk(key);
    return [...seen];
};
const describe = (keys) => keys.map((k) => ({ key: k, file: manifest[k].file, bytes: size(manifest[k].file) }))
    .sort((a, b) => b.bytes - a.bytes);
const total = (items) => items.reduce((a, b) => a + b.bytes, 0);
const chunkName = (file) => file.replace(/^assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '');

const entryKey = Object.keys(manifest).find((k) => k.endsWith('src/entry-desktop.js'));
const mainKey = Object.keys(manifest).find((k) => /\/main-[A-Za-z0-9_-]+\.js$/.test(manifest[k].file) || k === 'src/main.js');
if (!entryKey || !mainKey) { console.error('check-boot-closure: entry or main chunk not found in manifest'); process.exit(2); }

const entry = describe(closure(entryKey));
const main = describe(closure(mainKey));
const failures = [];
const LAZY = /^(theme-(?!shared$)|mode-|phaser$|three$|draco|playground)/;
for (const item of main) {
    const name = chunkName(item.file);
    if (LAZY.test(name)) failures.push(`main statically reaches lazy chunk ${name} (${(item.bytes / 1024).toFixed(0)} KB)`);
}
if (entry.length > 6) failures.push(`entry closure is ${entry.length} chunks (expected ≤ 6)`);
if (total(entry) > 600 * 1024) failures.push(`entry closure is ${(total(entry) / 1024).toFixed(0)} KB (expected ≤ 600 KB)`);
if (total(main) > 2 * 1024 * 1024) failures.push(`main closure is ${(total(main) / 1024 / 1024).toFixed(2)} MB (expected ≤ 2 MB)`);

const line = (label, items) => `${label}: ${items.length} chunks, ${(total(items) / 1024).toFixed(0)} KB`;
console.log(line('entry static closure', entry));
console.log(line('main static closure', main));
if (print) {
    for (const item of main) console.log(`  ${(item.bytes / 1024).toFixed(0).padStart(6)} KB  ${chunkName(item.file)}`);
}
if (failures.length) {
    console.error('\nBOOT CLOSURE GUARD FAILED');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
}
console.log('boot closure OK');
