#!/usr/bin/env node
/**
 * IP-string gate (legal review v4.0, remediation P0.7; extended 2026-10-20 and 2026-11-03).
 *
 * Two classes of third-party token, two scopes:
 *
 * A. Shipped surfaces — the genre mark. Scans, case-insensitively, for "tetris" and any
 *    "tetrimino" spelling in:
 *      1. public/** and index.html  — copied verbatim into every build
 *      2. the runtime source         — tracked text under src/ and electron/
 *      3. dist/**                   — the built web artifact, when present
 *      4. release/**                — each packaged desktop build's app.asar and the files beside
 *                                     it, when present (scripts/ip-packaged-scan.mjs, which
 *                                     scripts/afterPack.cjs also runs on every build it packages)
 *    The only allowance: the CREDITS.md / README.md copies in dist (the legal notice). Code
 *    names its own things (a four-line clear is a quad, its event 'quad', its Odyssey goal
 *    'quads'), so identifiers, keys and string literals get no exemption either.
 *
 * B. The whole tracked tree — names from other people's fictional worlds. A theme may evoke
 *    a setting (an alien twin-sun desert with a giant worm is fine); it may not name one, and
 *    that holds for code, comments, identifiers, tests and docs, not just player-facing copy.
 *    The repo is public, so a design note that calls a theme by another franchise's planet is
 *    on the record as intent even when no player ever reads the word, and it is exactly what
 *    turns "generic desert" into "their desert" in a complaint. Shifting Sands (2026-10-20) is
 *    the precedent: its world, creature, substance and device names were scrubbed and this
 *    class added so they cannot creep back. No identifier allowance: there is no legitimate
 *    internal use of these names.
 *
 * C. Names from other people's films, games and art (2026-11-03): scripts/ip-tokens.mjs. Blocked
 *    names fail anywhere (tracked text, tracked file names, dist/); names whose renames are still
 *    pending are held at or under the counts in ip-token-ratchet.json, which only goes down.
 *
 * Under CI (the CI variable set) a missing dist/ fails instead of being skipped: the bundles are
 * where a token actually reaches players.
 *
 * Usage: node scripts/ip-string-gate.mjs            check
 *        node scripts/ip-string-gate.mjs --update   lower ip-token-ratchet.json to today's counts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BLOCKED_TOKENS, GENRE_TOKEN, RATCHET_TOKENS, WORLD_TOKEN, compareToBaseline, countTokens, findToken,
} from './ip-tokens.mjs';
import { findPackagedResources, scanPackagedApp } from './ip-packaged-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/ip-string-gate.mjs';
const RATCHET_FILE = 'ip-token-ratchet.json';
const UPDATE = process.argv.includes('--update');

const TEXT_EXT = /\.(js|mjs|css|html|svg|json|txt|md|xml|webmanifest)$/i;
const TREE_TEXT_EXT = /\.(js|mjs|cjs|ts|mts|css|html|svg|json|txt|md|xml|webmanifest|ya?ml|py|sh|cmd|bat|ps1|glsl|wgsl|csv|toml)$/i;
const ALLOWED_FILES = new Set(['dist/CREDITS.md', 'dist/README.md']);
const TREE_SKIP = new Set([
    SELF, 'scripts/ip-tokens.mjs', 'tests/unit/ip-tokens.test.js', 'tests/unit/ip-packaged-scan.test.js',
    RATCHET_FILE, 'package-lock.json',
]);

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
    }
}

function scanFile(fullPath, relPath, token) {
    const violations = [];
    const source = fs.readFileSync(fullPath, 'utf8');
    for (const match of source.matchAll(token)) {
        const start = Math.max(0, match.index - 24);
        const context = source.slice(start, match.index + match[0].length + 24);
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${relPath}:${line}: …${context.replace(/\s+/g, ' ').trim()}…`);
    }
    return violations;
}

/** Tracked files (git), or a walk of the source roots when git is unavailable. */
function trackedFiles() {
    try {
        const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 << 20 });
        return out.split('\0').filter(Boolean);
    } catch {
        console.warn('ip-string-gate: git ls-files unavailable — walking source roots instead');
        const files = [];
        for (const root of ['src', 'docs', 'tests', 'scripts', 'public', 'reports']) {
            const dir = path.join(repoRoot, root);
            if (fs.existsSync(dir)) for (const f of walk(dir)) files.push(path.relative(repoRoot, f));
        }
        for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
            if (entry.isFile()) files.push(entry.name);
        }
        return files.map((f) => f.replace(/\\/g, '/'));
    }
}

const violations = [];
const surfaces = [];
const tracked = trackedFiles().filter((rel) => !TREE_SKIP.has(rel) && fs.existsSync(path.join(repoRoot, rel)));

// A1. Verbatim-copied source surfaces (always scanned).
const publicDir = path.join(repoRoot, 'public');
if (fs.existsSync(publicDir)) {
    for (const file of walk(publicDir)) {
        if (!TEXT_EXT.test(file)) continue;
        const rel = path.relative(repoRoot, file);
        violations.push(...scanFile(file, rel, GENRE_TOKEN));
    }
    surfaces.push('public/');
}
const indexHtml = path.join(repoRoot, 'index.html');
if (fs.existsSync(indexHtml)) {
    violations.push(...scanFile(indexHtml, 'index.html', GENRE_TOKEN));
    surfaces.push('index.html');
}

// A2. The runtime source: everything under src/ and electron/ that ends up in a build.
let runtimeCount = 0;
for (const rel of tracked) {
    if (!/^(src|electron)\//.test(rel) || !TREE_TEXT_EXT.test(rel)) continue;
    violations.push(...scanFile(path.join(repoRoot, rel), rel, GENRE_TOKEN));
    runtimeCount++;
}
surfaces.push(`runtime source (${runtimeCount} text files)`);

// A3. Built artifact, when present.
const distDir = path.join(repoRoot, 'dist');
if (fs.existsSync(distDir)) {
    for (const file of walk(distDir)) {
        if (!TEXT_EXT.test(file)) continue;
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        if (ALLOWED_FILES.has(rel)) continue;
        violations.push(...scanFile(file, rel, GENRE_TOKEN));
        violations.push(...scanFile(file, rel, WORLD_TOKEN));
        const text = fs.readFileSync(file, 'utf8');
        for (const token of BLOCKED_TOKENS) {
            for (const hit of findToken(token, rel)) violations.push(`${rel} (file name): ${token.id} …${hit.context}…`);
            for (const hit of findToken(token, text)) violations.push(`${rel}:${hit.line}: ${token.id} …${hit.context}…`);
        }
    }
    surfaces.push('dist/');
} else if (process.env.CI) {
    violations.push('dist/ not found under CI: run `npm run build` before this gate (it scans the bundles).');
} else {
    console.warn(
        'ip-string-gate: dist/ not found — built artifact not scanned (run `npm run build` first for full coverage)'
    );
}

// A4. Packaged desktop builds, when present: each app.asar under release/ and the files beside it.
for (const resourcesDir of findPackagedResources(path.join(repoRoot, 'release'))) {
    const rel = path.relative(repoRoot, resourcesDir).replace(/\\/g, '/');
    const { violations: found, fileCount } = scanPackagedApp(resourcesDir);
    violations.push(...found.map((violation) => `${rel}/${violation}`));
    surfaces.push(`${rel}/ (${fileCount} packaged files)`);
}

// B. Every tracked text file: world names from other franchises, anywhere.
let treeCount = 0;
for (const rel of tracked) {
    if (!TREE_TEXT_EXT.test(rel)) continue;
    violations.push(...scanFile(path.join(repoRoot, rel), rel, WORLD_TOKEN));
    treeCount++;
}
surfaces.push(`tracked tree (${treeCount} text files, world names)`);

// C. Names from other works: blocked ones nowhere, ratcheted ones no more than the baseline.
//    Tracked text and every tracked file name (binaries included).
const readTracked = (rel) => {
    if (!TREE_TEXT_EXT.test(rel)) return null;
    try {
        return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch {
        return null; // deleted in the working tree
    }
};
for (const [id, { hits }] of countTokens(BLOCKED_TOKENS, tracked, readTracked)) {
    for (const hit of hits) violations.push(`${hit} — ${id}`);
}
const ratchetPath = path.join(repoRoot, RATCHET_FILE);
const ratchet = fs.existsSync(ratchetPath) ? JSON.parse(fs.readFileSync(ratchetPath, 'utf8')) : { tokens: {} };
const ratchetCounts = countTokens(RATCHET_TOKENS, tracked, readTracked);
const { over, under } = compareToBaseline(ratchetCounts, ratchet.tokens);
for (const { id, count, baseline } of fs.existsSync(ratchetPath) ? over : []) {
    const hits = ratchetCounts.get(id).hits;
    violations.push(`${id}: ${count} uses, the ratchet allows ${baseline} (${RATCHET_FILE}). Latest: ${hits.slice(-3).join(' | ')}`);
}
if (UPDATE) {
    if (over.length && fs.existsSync(ratchetPath)) {
        console.error('ip-string-gate: --update never raises the ratchet; remove the new uses first.');
    } else {
        const tokens = Object.fromEntries([...ratchetCounts].map(([id, { count }]) => [id, count]));
        fs.writeFileSync(ratchetPath, `${JSON.stringify({ ...ratchet, updatedAt: new Date().toISOString().slice(0, 10), tokens }, null, 2)}\n`);
        console.log(`ip-string-gate: ${RATCHET_FILE} lowered to today's counts`);
    }
} else {
    for (const { id, count, baseline } of under) {
        console.log(`ip-string-gate: ${id} is down to ${count} (baseline ${baseline}): run with --update to lock it in`);
    }
}
surfaces.push(`tracked names and text (${BLOCKED_TOKENS.length} blocked, ${RATCHET_TOKENS.length} ratcheted tokens)`);

console.log(`ip-string-gate: scanned ${surfaces.join(', ')}`);
if (violations.length > 0) {
    console.error(`ip-string-gate: FAILED — ${violations.length} disallowed token(s):`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        'Remove the token (evoke the setting, do not name it) or, for a counsel-approved legal notice, extend the documented allowlist.'
            + ' A ratcheted name may only go down.'
    );
    process.exit(1);
}
console.log('ip-string-gate: OK — no disallowed tokens on shipped surfaces or in the tracked tree');
