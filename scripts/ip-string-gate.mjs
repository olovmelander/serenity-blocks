#!/usr/bin/env node
/**
 * IP-string gate (tetris_legal_review.md v4.0, remediation P0.7; extended 2026-10-20).
 *
 * Two classes of third-party token, two scopes:
 *
 * A. Shipped surfaces — the genre mark. Scans, case-insensitively, for standalone "tetris"
 *    and any "tetrimino" spelling in:
 *      1. public/** and index.html  — copied verbatim into every build
 *      2. dist/**                   — the built web artifact, when present
 *    Allowed:
 *      - CREDITS.md / README.md copies in dist (the counsel-reviewed legal notice)
 *      - internal identifiers that survive minification into JS bundles: tokens that are
 *        identifier fragments (tetrisFlash, _cueTetris, isTetris), property accesses
 *        (.tetris/.TETRIS), object keys (tetris:), bare string literals ('tetris' event
 *        kind), and the serialized victory-condition type 'tetris-count'. Renaming these
 *        touches save/replay data and is tracked as P2 hygiene in the review — this gate
 *        stops NEW consumer-facing uses (e.g. a "like Tetris" sentence in copy) while that
 *        debt exists.
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
 * Usage: node scripts/ip-string-gate.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/ip-string-gate.mjs';

const TEXT_EXT = /\.(js|mjs|css|html|svg|json|txt|md|xml|webmanifest)$/i;
const TREE_TEXT_EXT = /\.(js|mjs|cjs|ts|mts|css|html|svg|json|txt|md|xml|webmanifest|ya?ml|py|sh|cmd|bat|ps1|glsl|wgsl|csv|toml)$/i;
const GENRE_TOKEN = /tetris|tetrimino/gi;
// Class B. Keep to proper nouns and coinages that belong to one franchise; plain words that a
// desert, a worm or a geyser needs ("dune", "sand", "worm", "spice" on its own) stay usable.
const WORLD_TOKEN =
    /arrakis|shai[\s-]?hulud|fremen|melange|muad'?dib|harkonnen|atreides|sardaukar|bene\s+gesserit|kwisatz|lisan\s+al[\s-]?gaib|crysknife|stillsuit|ornithopter|sietch|wormsign|spice\s+blows?|thumper|dune[\s-]+inspired|inspired\s+by\s+dune|dune\s+(?:film|movie|novel|franchise)/gi;
const IDENT_CHAR = /[A-Za-z0-9_$]/;
const ALLOWED_FILES = new Set(['dist/CREDITS.md', 'dist/README.md']);
const TREE_SKIP = new Set([SELF, 'package-lock.json']);

/** True when a JS-bundle match is a non-rendered internal identifier shape. */
function isInternalIdentifierUse(source, index, length) {
    const before = source[index - 1] ?? '';
    const after = source[index + length] ?? '';
    if (IDENT_CHAR.test(before) || IDENT_CHAR.test(after)) return true; // tetrisFlash, _cueTetris, isTetris
    if (before === '.') return true; // property access: me.tetris, zt.TETRIS
    if (/^\s*:/.test(source.slice(index + length))) return true; // object key: tetris:{...}
    if (/["'`]/.test(before) && before === after) return true; // bare string literal: 'tetris'
    if (/tetris-count/i.test(source.slice(Math.max(0, index - 6), index + length + 6))) return true; // serialized type
    return false;
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
    }
}

function scanFile(fullPath, relPath, token, { allowInternalIdentifiers = false } = {}) {
    const violations = [];
    const source = fs.readFileSync(fullPath, 'utf8');
    for (const match of source.matchAll(token)) {
        if (
            allowInternalIdentifiers &&
            isInternalIdentifierUse(source, match.index, match[0].length)
        )
            continue;
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

// A1. Verbatim-copied source surfaces (always scanned; no identifier allowance —
//     nothing in public/ or index.html should need these tokens at all).
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

// A2. Built artifact, when present (JS bundles get the identifier allowance for the genre
//     mark; world names get none).
const distDir = path.join(repoRoot, 'dist');
if (fs.existsSync(distDir)) {
    for (const file of walk(distDir)) {
        if (!TEXT_EXT.test(file)) continue;
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        if (ALLOWED_FILES.has(rel)) continue;
        const isBundle = /\.(js|mjs)$/i.test(rel);
        violations.push(...scanFile(file, rel, GENRE_TOKEN, { allowInternalIdentifiers: isBundle }));
        violations.push(...scanFile(file, rel, WORLD_TOKEN));
    }
    surfaces.push('dist/');
} else {
    console.warn(
        'ip-string-gate: dist/ not found — built artifact not scanned (run `npm run build` first for full coverage)'
    );
}

// B. Every tracked text file: world names from other franchises, anywhere.
let treeCount = 0;
for (const rel of trackedFiles()) {
    if (TREE_SKIP.has(rel) || !TREE_TEXT_EXT.test(rel)) continue;
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) continue; // deleted in the working tree
    violations.push(...scanFile(full, rel, WORLD_TOKEN));
    treeCount++;
}
surfaces.push(`tracked tree (${treeCount} text files, world names)`);

console.log(`ip-string-gate: scanned ${surfaces.join(', ')}`);
if (violations.length > 0) {
    console.error(`ip-string-gate: FAILED — ${violations.length} disallowed token(s):`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        'Remove the token (evoke the setting, do not name it) or, for a counsel-approved legal notice, extend the documented allowlist.'
    );
    process.exit(1);
}
console.log('ip-string-gate: OK — no disallowed tokens on shipped surfaces or in the tracked tree');
