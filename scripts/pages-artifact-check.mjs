#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');
const manifestPath = path.join(distDir, 'manifest.json');
const hiddenManifestPath = path.join(distDir, '.vite', 'manifest.json');
const assetsDir = path.join(distDir, 'assets');

function fail(message) {
    console.error(`pages-artifact-check: FAIL - ${message}`);
    process.exitCode = 1;
}

if (!existsSync(manifestPath)) {
    fail('dist/manifest.json is missing; GitHub Pages needs a non-hidden Vite manifest.');
} else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entryRecord = manifest['src/entry-desktop.js'];
    const entryFile = entryRecord?.file;

    if (typeof entryFile !== 'string' || entryFile.length === 0) {
        fail('manifest is missing the src/entry-desktop.js entry.');
    } else if (!existsSync(path.join(distDir, entryFile))) {
        fail(`manifest entry points to missing file: ${entryFile}`);
    }
}

if (existsSync(hiddenManifestPath)) {
    fail('dist/.vite/manifest.json exists; keep the runtime manifest out of hidden folders.');
}

if (!existsSync(assetsDir)) {
    fail('dist/assets is missing.');
} else {
    const jsBundleText = readdirSync(assetsDir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => readFileSync(path.join(assetsDir, name), 'utf8'))
        .join('\n');

    if (jsBundleText.includes('.vite/manifest.json')) {
        fail('built loader still fetches .vite/manifest.json.');
    }

    if (/(^|[^.])\/src\/entry-desktop\.js/.test(jsBundleText)) {
        fail('built loader still contains a domain-root /src/entry-desktop.js fallback.');
    }
}

if (!process.exitCode) {
    console.log('pages-artifact-check: OK');
}
