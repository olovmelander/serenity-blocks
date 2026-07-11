#!/usr/bin/env node
/**
 * Architecture fitness functions (ARCHITECTURAL_REMEDIATION_PLAN.md Phase 3d).
 *
 * Hand-rolled, baseline-file ratchets: every metric here is an architecture
 * rule that "matters twice" made mechanical. Each count is compared against
 * the committed baseline in architecture-fitness.json — FAIL when a metric
 * grows, warn (and lock in via --update) when it shrinks. Rules cite their
 * ADR / plan section so the constraint is loadable, not tribal.
 *
 * Usage:
 *   node scripts/architecture-fitness-check.mjs            # gate (CI)
 *   node scripts/architecture-fitness-check.mjs --update   # lock in improvements
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'architecture-fitness.json');
const update = process.argv.includes('--update');

const trackedJs = execFileSync('git', ['ls-files', 'src/**/*.js'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));

const fileCache = new Map();
function read(file) {
    if (!fileCache.has(file)) fileCache.set(file, readFileSync(path.join(repoRoot, file), 'utf8'));
    return fileCache.get(file);
}
function countMatches(files, regex) {
    let total = 0;
    const perFile = {};
    for (const f of files) {
        const hits = (read(f).match(regex) || []).length;
        if (hits > 0) { total += hits; perFile[f] = hits; }
    }
    return { total, perFile };
}
const inScope = (prefix, { excludeTests = true } = {}) => trackedJs.filter((f) => f.startsWith(prefix)
    && (!excludeTests || !/\.test\.js$/.test(f)));

/**
 * Metric definitions. Each returns { value, detail? }. Direction: smaller is
 * better; FAIL when value > baseline.
 */
const METRICS = {
    // God-file line ceilings (plan §3d / §10 scope-freeze made mechanical —
    // the markdown-only freeze already failed once, +560 lines).
    'lines:ffa-p2p-game-state': () => lineCount('src/core/multiplayer/ffa-p2p-game-state.js'),
    'lines:main': () => lineCount('src/main.js'),
    'lines:OdysseyMode': () => lineCount('src/core/game-modes/OdysseyMode.js'),
    'lines:LocalMultiplayerMode': () => lineCount('src/core/game-modes/LocalMultiplayerMode.js'),
    'lines:OnlineMultiplayerMode': () => lineCount('src/core/game-modes/OnlineMultiplayerMode.js'),

    // No new raw GLSL ShaderMaterials (plan §7 — retire, never grow; ADR-0008).
    'shader-material:hits': () => {
        const { total } = countMatches(trackedJs, /new (?:THREE\.)?ShaderMaterial\s*\(/g);
        return { value: total };
    },
    'shader-material:files': () => {
        const { perFile } = countMatches(trackedJs, /new (?:THREE\.)?ShaderMaterial\s*\(/g);
        return { value: Object.keys(perFile).length };
    },

    // Determinism inventory (plan §5.6/§3d): nondeterminism sources under the
    // core sim may only shrink until Phase 5 evicts them entirely.
    'core-nondeterminism': () => {
        const files = inScope('src/core/');
        const { total, perFile } = countMatches(files, /\b(?:Math\.random|Date\.now|performance\.now)\s*\(/g);
        return { value: total, detail: top(perFile, 5) };
    },

    // Core headlessness (plan §3d ESLint no-restricted-globals equivalent,
    // ratchet form): DOM/global reads under src/core may only shrink.
    // Includes the sim-inside theme-color read (game.js) Phase 5.11 evicts.
    'core-dom-globals': () => {
        const files = inScope('src/core/');
        const { total, perFile } = countMatches(files, /\b(?:window|document|navigator)\s*\./g);
        return { value: total, detail: top(perFile, 5) };
    },

    // Exactly one rAF sim driver under src/core is the §5.5 end-state; until
    // the loops collapse, the count may only shrink.
    'core-raf-drivers': () => {
        const files = inScope('src/core/');
        const { total, perFile } = countMatches(files, /\brequestAnimationFrame\s*\(/g);
        return { value: total, detail: top(perFile, 8) };
    },

    // Resize-listener sprawl (plan §4.4): every raw window resize listener
    // OUTSIDE the canonical broadcaster (src/utils/viewport.js) may only shrink;
    // migrate them to EVENTS.VIEWPORT_RESIZED. The broadcaster owns the one
    // allowed listener and is exempt.
    'resize-listeners': () => {
        const files = trackedJs.filter((f) => f !== 'src/utils/viewport.js');
        const { total, perFile } = countMatches(files, /addEventListener\(\s*['"]resize['"]/g);
        return { value: total, detail: top(perFile, 6) };
    },

    // One event bus is the §4.1 end-state; no third implementation may appear.
    // Today: src/events/event-bus.js + src/utils/event-optimizer.js (the
    // optimizer is deleted by §4.1). Basename-matched so relocation can't hide one.
    'event-bus-files': () => {
        const buses = trackedJs.filter((f) => /(?:^|\/)(?:event-bus|event-optimizer|event-emitter)[^/]*\.js$/.test(f));
        return { value: buses.length, detail: buses };
    },

    // Board-state write sites (plan §5.1): direct lockedPieces/boardGrid
    // REPLACEMENT assignments may only shrink — new board mutations go through
    // the sanctioned boundaries (applyGarbage/restoreBoardState/lockPiece/
    // processPhysics) which repair grid + caches in one place. Assignment-only
    // on purpose: `=` (not `==`/`===`) catches the grid/array-swap class the
    // renderer's retired per-frame rebuild used to mask.
    'board-write-sites': () => {
        const { total, perFile } = countMatches(trackedJs, /\.(?:lockedPieces|boardGrid)\s*=[^=]/g);
        return { value: total, detail: top(perFile, 8) };
    },
};

function lineCount(file) {
    return { value: read(file).split('\n').length };
}
function top(perFile, n) {
    return Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([f, c]) => `${f}:${c}`);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
let failed = false;
let shrank = false;
const next = { ...baseline, metrics: { ...baseline.metrics } };

for (const [id, fn] of Object.entries(METRICS)) {
    const { value, detail } = fn();
    const base = baseline.metrics[id];
    if (base === undefined) {
        console.warn(`fitness: ${id} = ${value} (no baseline — adding)`);
        next.metrics[id] = value;
        shrank = true;
    } else if (value > base) {
        failed = true;
        console.error(`fitness: FAIL ${id} = ${value} > baseline ${base}${detail ? `\n    ${[].concat(detail).join('\n    ')}` : ''}`);
    } else if (value < base) {
        shrank = true;
        console.log(`fitness: ${id} = ${value} (< baseline ${base} — improvement)`);
        next.metrics[id] = value;
    } else {
        console.log(`fitness: OK ${id} = ${value}`);
    }
}

if (failed) {
    console.error('\nfitness: FAIL — an architecture ratchet regressed. Fix the new violation; never raise a baseline.');
    process.exitCode = 1;
} else if (shrank && update) {
    next.capturedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log('\nfitness: baselines lowered. Commit architecture-fitness.json.');
} else if (shrank) {
    console.warn('\nfitness: metrics shrank — run `node scripts/architecture-fitness-check.mjs --update` to lock in.');
} else {
    console.log('\nfitness: all ratchets at baseline.');
}
