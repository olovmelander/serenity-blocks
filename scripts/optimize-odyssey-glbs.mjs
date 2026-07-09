#!/usr/bin/env node
/**
 * Batch-optimize the Odyssey chapter GLBs to KTX2 (Basis) textures + meshopt geometry.
 *
 *   43 MB → ~6-8 MB. Cuts the cold-start GPU texture-decode + upload (the runtime loader is
 *   already wired for KTX2/meshopt in odyssey-gltf-loader.js — re-exporting activates it).
 *
 * SAFE for rigged/animated GLBs: meshopt preserves skinning + morph + animation, and this
 * script does NOT run simplify/join/weld (those can corrupt skinned meshes). It overwrites
 * each .glb in place after backing the original up to assets/_originals/<same path>.
 *
 * Requirements (one-time):
 *   1. @gltf-transform/cli   — invoked via npx (auto-fetched).
 *   2. KTX-Software `toktx`   — gltf-transform's KTX2 encoder shells out to it.
 *        Windows: `winget install KhronosGroup.KTX-Software`  (or the GitHub release)
 *        Verify:  `toktx --version`
 *
 * Usage:
 *   node scripts/optimize-odyssey-glbs.mjs            # all GLBs, texture cap 1024
 *   node scripts/optimize-odyssey-glbs.mjs --size 2048   # higher-res textures (hero assets)
 *   node scripts/optimize-odyssey-glbs.mjs --dry         # list what would run, no changes
 *
 * After running: re-capture the affected chapters in your desktop session (KTX2 is lossy)
 * per docs/WEBGPU_THREEJS_WORKFLOW.md before committing the new assets.
 */

import { execFileSync } from 'node:child_process';
import {
    readdirSync, statSync, mkdirSync, copyFileSync, existsSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'src', 'rendering', 'odyssey', 'assets');
const BACKUP_DIR = join(ASSETS_DIR, '_originals');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const sizeArg = args.indexOf('--size');
const textureSize = sizeArg >= 0 ? args[sizeArg + 1] : '1024';

function findGlbs(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === '_originals') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...findGlbs(full));
        else if (name.toLowerCase().endsWith('.glb')) out.push(full);
    }
    return out;
}

function mb(bytes) {
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

const glbs = findGlbs(ASSETS_DIR);
console.log(`Found ${glbs.length} GLBs under ${relative(process.cwd(), ASSETS_DIR)} (texture cap ${textureSize}px)\n`);

let totalBefore = 0;
let totalAfter = 0;
let failed = 0;

for (const file of glbs) {
    const rel = relative(ASSETS_DIR, file);
    const before = statSync(file).size;
    totalBefore += before;

    if (dryRun) {
        console.log(`  [dry] ${rel}  (${mb(before)})`);
        continue;
    }

    // Back up the original once (these GLBs are NOT in git — the backup is the only safety net).
    const backup = join(BACKUP_DIR, rel);
    if (!existsSync(backup)) {
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(file, backup);
    }

    try {
        // Optimize from the pristine backup so re-runs are idempotent (not double-compressed).
        execFileSync('npx', [
            '--yes', '@gltf-transform/cli', 'optimize', backup, file,
            '--compress', 'meshopt',
            '--texture-compress', 'ktx2',
            '--texture-size', textureSize,
            '--simplify', 'false', // skinning-safe: no decimation
            '--join', 'false', // skinning-safe: don't merge meshes
            '--weld', '0', // skinning-safe: no vertex welding
        ], { stdio: 'pipe', shell: process.platform === 'win32' });

        const after = statSync(file).size;
        totalAfter += after;
        const pct = (100 * (1 - after / before)).toFixed(0);
        console.log(`  ✓ ${rel}  ${mb(before)} → ${mb(after)}  (-${pct}%)`);
    } catch (err) {
        failed += 1;
        totalAfter += before; // count original since we leave it in place on failure
        console.error(`  ✗ ${rel} FAILED: ${err.stderr?.toString().trim() || err.message}`);
    }
}

if (!dryRun) {
    console.log(`\nTotal: ${mb(totalBefore)} → ${mb(totalAfter)}  (-${(100 * (1 - totalAfter / totalBefore)).toFixed(0)}%)`);
    if (failed) console.log(`${failed} file(s) failed — likely a missing 'toktx' (KTX-Software). See header.`);
    console.log('Originals backed up to assets/_originals/. Re-capture affected chapters before committing.');
}
