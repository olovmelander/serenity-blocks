#!/usr/bin/env node
/**
 * Bake what the Verdant Hills theme would otherwise work out every time it starts: the
 * valley's patchwork (hedgerows, the tone of each pasture, still water, and the shade of
 * every tree and hedge that stands beyond the shadow map) and the cloud field the sky
 * marches.
 *
 * The map is `createVerdantHillsLandData()` from the theme's own terrain module, evaluated
 * once here at a size the theme could not afford to compute when it starts, and written as
 * `src/themes/verdant-hills/assets/verdant-land.png` beside a manifest that pins its bytes;
 * the cloud field is `createVerdantHillsCloudData()` from the light rig, written as
 * `verdant-clouds.png` with the table of its levels. Without the files the theme makes a
 * coarse map and the same clouds on the spot, so the bake is an improvement, never a
 * requirement.
 *
 * Usage: node scripts/verdant-hills/bake-land.mjs [--size=1536] [--out=<dir>]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../himalayan-peak/png.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themeDir = path.join(repoRoot, 'src', 'themes', 'verdant-hills');
const options = Object.fromEntries(process.argv.slice(2).filter((token) => token.startsWith('--')).map((token) => {
    const [key, value = 'true'] = token.slice(2).split('=');
    return [key, value];
}));
const size = Math.max(64, Math.min(4096, Number.parseInt(options.size || '1536', 10)));
const outDir = path.resolve(options.out || path.join(themeDir, 'assets'));

const terrain = await import(new URL(`file://${path.join(themeDir, 'verdant-hills-terrain.js').replace(/\\/g, '/')}`));
const layout = await import(new URL(`file://${path.join(themeDir, 'verdant-hills-layout.js').replace(/\\/g, '/')}`));

const started = performance.now();
const trees = layout.verdantHillsTreeShadows();
const data = terrain.createVerdantHillsLandData(size, trees);
const png = encodePng(data, size, size);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'verdant-land.png'), png);
const manifest = {
    schema: terrain.VERDANT_HILLS_LAND_SCHEMA,
    generator: 'scripts/verdant-hills/bake-land.mjs',
    size,
    bounds: terrain.VERDANT_HILLS_MAP_BOUNDS,
    trees: trees.length,
    bytes: png.length,
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
};
fs.writeFileSync(path.join(outDir, 'verdant-land.json'), `${JSON.stringify(manifest, null, 4)}\n`);
console.log(`verdant-land.png ${size}×${size}, ${trees.length} tree shadows, ${png.length} bytes, `
    + `${Math.round(performance.now() - started)} ms`);

// The cloud field: the same function the light rig falls back to, at the seed the theme starts from.
const light = await import(new URL(`file://${path.join(themeDir, 'verdant-hills-light.js').replace(/\\/g, '/')}`));
const cloudSize = light.VERDANT_HILLS_CLOUD_SIZE;
const clouds = light.createVerdantHillsCloudData(light.VERDANT_HILLS_CLOUD_SEED, cloudSize);
const cloudPng = encodePng(clouds.data, cloudSize, cloudSize);
fs.writeFileSync(path.join(outDir, 'verdant-clouds.png'), cloudPng);
fs.writeFileSync(path.join(outDir, 'verdant-clouds.json'), `${JSON.stringify({
    schema: light.VERDANT_HILLS_CLOUD_SCHEMA,
    generator: 'scripts/verdant-hills/bake-land.mjs',
    size: cloudSize,
    seed: light.VERDANT_HILLS_CLOUD_SEED,
    // Field level (0..255) below which each 255th of the sky lies.
    edges: Array.from(clouds.edges, (edge) => Math.round(edge * 255)),
    bytes: cloudPng.length,
    sha256: crypto.createHash('sha256').update(cloudPng).digest('hex'),
}, null, 4)}\n`);
console.log(`verdant-clouds.png ${cloudSize}×${cloudSize}, ${cloudPng.length} bytes`);
