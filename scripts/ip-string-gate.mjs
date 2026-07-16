#!/usr/bin/env node
/**
 * Shipped-artifact IP-string gate (tetris_legal_review.md v4.0, remediation P0.7).
 *
 * Prevents third-party mark tokens from (re)appearing on consumer-facing
 * surfaces. Scans, case-insensitively, for standalone "tetris" and any
 * "tetrimino" spelling in:
 *
 *   1. public/** and index.html  — copied verbatim into every build
 *   2. dist/**                   — the built web artifact, when present
 *
 * Allowed:
 *   - CREDITS.md / README.md copies in dist (the counsel-reviewed legal notice)
 *   - internal identifiers that survive minification into JS bundles: tokens
 *     that are identifier fragments (tetrisFlash, _cueTetris, isTetris),
 *     property accesses (.tetris/.TETRIS), object keys (tetris:), bare string
 *     literals ('tetris' event kind), and the serialized victory-condition
 *     type 'tetris-count'. Renaming these touches save/replay data and is
 *     tracked as P2 hygiene in the review — this gate stops NEW consumer-facing
 *     uses (e.g. a "like Tetris" sentence in copy) while that debt exists.
 *
 * Usage: node scripts/ip-string-gate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEXT_EXT = /\.(js|mjs|css|html|svg|json|txt|md|xml|webmanifest)$/i;
const TOKEN = /tetris|tetrimino/gi;
const IDENT_CHAR = /[A-Za-z0-9_$]/;
const ALLOWED_FILES = new Set(['dist/CREDITS.md', 'dist/README.md']);

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

function scanFile(fullPath, relPath, { allowInternalIdentifiers }) {
    const violations = [];
    const source = fs.readFileSync(fullPath, 'utf8');
    for (const match of source.matchAll(TOKEN)) {
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

const violations = [];
const surfaces = [];

// 1. Verbatim-copied source surfaces (always scanned; no identifier allowance —
//    nothing in public/ or index.html should need these tokens at all).
const publicDir = path.join(repoRoot, 'public');
if (fs.existsSync(publicDir)) {
    for (const file of walk(publicDir)) {
        if (!TEXT_EXT.test(file)) continue;
        const rel = path.relative(repoRoot, file);
        violations.push(...scanFile(file, rel, { allowInternalIdentifiers: false }));
    }
    surfaces.push('public/');
}
const indexHtml = path.join(repoRoot, 'index.html');
if (fs.existsSync(indexHtml)) {
    violations.push(...scanFile(indexHtml, 'index.html', { allowInternalIdentifiers: false }));
    surfaces.push('index.html');
}

// 2. Built artifact, when present (JS bundles get the identifier allowance).
const distDir = path.join(repoRoot, 'dist');
if (fs.existsSync(distDir)) {
    for (const file of walk(distDir)) {
        if (!TEXT_EXT.test(file)) continue;
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        if (ALLOWED_FILES.has(rel)) continue;
        const isBundle = /\.(js|mjs)$/i.test(rel);
        violations.push(...scanFile(file, rel, { allowInternalIdentifiers: isBundle }));
    }
    surfaces.push('dist/');
} else {
    console.warn(
        'ip-string-gate: dist/ not found — built artifact not scanned (run `npm run build` first for full coverage)'
    );
}

console.log(`ip-string-gate: scanned ${surfaces.join(', ')}`);
if (violations.length > 0) {
    console.error(`ip-string-gate: FAILED — ${violations.length} disallowed token(s):`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        'Remove the token or, for a counsel-approved legal notice, extend the documented allowlist.'
    );
    process.exit(1);
}
console.log('ip-string-gate: OK — no disallowed tokens on shipped surfaces');
