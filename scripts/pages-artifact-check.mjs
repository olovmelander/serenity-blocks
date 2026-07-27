#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let configuredDistDir = null;

for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument !== '--dist-dir') {
        console.error(`pages-artifact-check: FAIL - unknown argument: ${argument}`);
        process.exit(1);
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        console.error('pages-artifact-check: FAIL - --dist-dir requires a path.');
        process.exit(1);
    }
    if (configuredDistDir !== null) {
        console.error('pages-artifact-check: FAIL - --dist-dir may only be provided once.');
        process.exit(1);
    }

    configuredDistDir = value;
    index += 1;
}

const distDir = configuredDistDir
    ? path.resolve(process.cwd(), configuredDistDir)
    : path.join(repoRoot, 'dist');
const distLabel = path.relative(repoRoot, distDir) || '.';
const manifestPath = path.join(distDir, 'manifest.json');
const hiddenManifestPath = path.join(distDir, '.vite', 'manifest.json');
const assetsDir = path.join(distDir, 'assets');
const playgroundReferencesDir = path.join(distDir, 'playground-refs');
const requiredLegalNotices = ['CREDITS.md', 'README.md'];

function fail(message) {
    console.error(`pages-artifact-check: FAIL - ${message}`);
    process.exitCode = 1;
}

if (!existsSync(manifestPath)) {
    fail(`${distLabel}/manifest.json is missing; GitHub Pages needs a non-hidden Vite manifest.`);
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
    fail(`${distLabel}/.vite/manifest.json exists; keep the runtime manifest out of hidden folders.`);
}

if (existsSync(playgroundReferencesDir)) {
    fail(`${distLabel}/playground-refs exists; local visual references must not ship.`);
}

for (const file of requiredLegalNotices) {
    const sourcePath = path.join(repoRoot, file);
    const artifactPath = path.join(distDir, file);

    if (!existsSync(artifactPath)) {
        fail(`${distLabel}/${file} is missing; release artifacts must include legal notices.`);
    } else if (!existsSync(sourcePath)) {
        fail(`${file} is missing from the repository root; artifact identity cannot be verified.`);
    } else if (!readFileSync(artifactPath).equals(readFileSync(sourcePath))) {
        fail(`${distLabel}/${file} differs byte-for-byte from the repository-root ${file}.`);
    }
}

if (!existsSync(assetsDir)) {
    fail(`${distLabel}/assets is missing.`);
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
