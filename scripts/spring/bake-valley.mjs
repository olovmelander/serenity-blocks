#!/usr/bin/env node
/**
 * Bake Spring's valley (src/themes/spring/spring-terrain.js) into the asset the theme reads at
 * start: assets/spring-valley.bin, the three grids' heights and the near and mid grids' water
 * edge and level, quantised, row-delta encoded and deflated. Re-run after any change to the plan
 * or the height function; the unit tests compare the asset with the function and fail when it is
 * stale. Prints each layer's worst round-trip error.
 *
 * Usage: node scripts/spring/bake-valley.mjs
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themeDir = path.join(repoRoot, 'src', 'themes', 'spring');
const assetsDir = path.join(themeDir, 'assets');
const FILE = 'spring-valley.bin';

const terrain = await import(pathToFileURL(path.join(themeDir, 'spring-terrain.js')).href);
const t0 = Date.now();
const baked = terrain.bakeTerrain();
const t1 = Date.now();
const raw = terrain.encodeValley(baked);
const packed = zlib.deflateSync(raw, { level: 9 });
fs.writeFileSync(path.join(assetsDir, FILE), packed);
const mb = (bytes) => (bytes / 1e6).toFixed(2);
console.log(`baked in ${t1 - t0} ms; ${mb(raw.length)} MB raw, ${mb(packed.length)} MB deflated`);

// Round trip: what the theme will read against what was baked.
const back = terrain.decodeValley(new Uint8Array(zlib.inflateSync(packed)));
for (const grid of ['near', 'mid', 'far']) {
    for (const key of ['h', 'edge', 'level']) {
        const a = baked[grid][key];
        const b = back[grid][key];
        if (!a) continue;
        let worst = 0;
        for (let i = 0; i < a.length; i++) {
            const v = key === 'edge' ? Math.max(-80, Math.min(3000, a[i])) : a[i];
            worst = Math.max(worst, Math.abs(v - b[i]));
        }
        console.log(`  ${grid}.${key.padEnd(5)} worst error ${worst.toFixed(4)} m`);
    }
}

// The manifest: one entry for the valley beside the trees and the granite.
const manifestPath = path.join(assetsDir, 'asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = {
    file: FILE,
    bytes: packed.length,
    sha256: createHash('sha256').update(packed).digest('hex'),
    kind: 'valley',
    schema: terrain.VALLEY_SCHEMA,
    grids: Object.fromEntries(['near', 'mid', 'far'].map((g) => [g, { size: baked[g].size, res: baked[g].res }])),
    generator: 'scripts/spring/bake-valley.mjs',
};
manifest.assets = [...manifest.assets.filter((a) => a.file !== FILE), entry];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${FILE} (${entry.bytes} bytes) and its manifest entry`);
