#!/usr/bin/env node
/**
 * Forest — grow the eagle owl's limbs into the two elders, and tell the theme where they are.
 *
 * The owl's limbs are dead limbs of the elder spruce and the elder pine, grown by the trees' own
 * generator (scripts/blender/forest_night/owl_limbs.py) and meshed into their bark, so the trees'
 * bark shader, occlusion bake and wind are theirs too. Two steps:
 *
 *   blender  headless Blender (scripts/blender/forest_assets.py, the two elders only) grows both
 *            trees and writes spruce-elder.glb and pine-elder.glb with the manifest; each tree's
 *            extras carry its owl limbs (centreline, the top of the bark, seats) in its own frame
 *   place    this script places those limbs where the trees stand (forest-composition.js, on the
 *            ground of forest-terrain.js) and writes src/themes/forest/forest-owl-limbs.js, which the
 *            owl's perches read without three.js
 *
 *   node scripts/forest/pack-owl-limbs.mjs                   Blender, then the limbs' module
 *   node scripts/forest/pack-owl-limbs.mjs --place-only      the module from the GLBs already there
 *   node scripts/forest/pack-owl-limbs.mjs --blender=<exe>   (default: Blender 5.2 where it installs)
 *   node scripts/forest/pack-owl-limbs.mjs --dry             print the limbs, write nothing
 *
 * The trees' geometry is deterministic; their occlusion bake is sampled, so a rebuild moves a few
 * colour bytes.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGlb } from '../fox/glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSETS = join(ROOT, 'src', 'themes', 'forest', 'assets');
const MODULE = join(ROOT, 'src', 'themes', 'forest', 'forest-owl-limbs.js');
const BUILD_SCRIPT = join(ROOT, 'scripts', 'blender', 'forest_assets.py');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const TREES = ['spruce-elder', 'pine-elder'];

function args() {
    const out = {};
    for (const arg of process.argv.slice(2)) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        out[key] = value === undefined ? true : value;
    }
    return out;
}

function runBlender(exe) {
    const argv = ['--background', '--factory-startup', '--python-exit-code', '1', '--python', BUILD_SCRIPT, '--',
        '--out', ASSETS, '--only', 'trees', '--recipes', TREES.join(',')];
    const result = spawnSync(exe, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    `${result.stdout || ''}${result.stderr || ''}`.split(/\r?\n/)
        .filter((line) => line.includes('[forest-night]')).forEach((line) => console.log(line));
    if (result.status !== 0) {
        console.error(result.stdout?.slice(-4000), result.stderr?.slice(-4000));
        throw new Error(`Blender failed (${result.status})`);
    }
}

const round = (v) => Math.round(v * 1000) / 1000;

/** A tree's owl limbs, placed: every station [x, y, z, top, radius] in world metres. */
async function placeLimbs() {
    const load = (file) => import(pathToFileURL(join(ROOT, 'src', 'themes', 'forest', file)).href);
    const { FOREST_FEATURE_TREES } = await load('forest-composition.js');
    const { forestGroundHeight } = await load('forest-terrain.js');
    const limbs = [];
    TREES.forEach((name) => {
        const file = join(ASSETS, `${name}.glb`);
        if (!existsSync(file)) throw new Error(`${file} is missing`);
        const { json } = readGlb(file);
        const extras = json.scenes?.[json.scene || 0]?.extras || json.extras || {};
        const records = extras.owlLimbs || [];
        // The tree stands where the theme stands it (forest-trees.js: on the ground, sunk 5 cm).
        const placed = FOREST_FEATURE_TREES.filter((tree) => tree.asset === name);
        if (placed.length !== 1) throw new Error(`${name} stands ${placed.length} times; the owl needs it once`);
        const tree = placed[0];
        const y0 = forestGroundHeight(tree.x, tree.z) - 0.05;
        const c = Math.cos(tree.yaw);
        const s = Math.sin(tree.yaw);
        const k = tree.scale;
        const world = ([x, y, z]) => [tree.x + (x * c + z * s) * k, y0 + y * k, tree.z + (-x * s + z * c) * k];
        records.forEach((record) => {
            const stations = record.centres.map((centre, i) => {
                const [x, y, z] = world(centre);
                return [x, y, z, y0 + record.tops[i] * k, record.radii[i] * k].map(round);
            });
            limbs.push({
                id: record.id,
                tree: name,
                surface: round(record.surface),
                seats: Object.entries(record.seats).sort((a, b) => a[1] - b[1]).map(([id, u]) => [id, round(u)]),
                stations,
            });
        });
    });
    return limbs;
}

function moduleText(limbs) {
    const lines = limbs.map((limb) => {
        const seats = limb.seats.map(([id, u]) => `['${id}', ${u}]`).join(', ');
        const rows = [];
        for (let i = 0; i < limb.stations.length; i += 4) {
            rows.push(`            ${limb.stations.slice(i, i + 4).map((st) => `[${st.join(', ')}]`).join(', ')},`);
        }
        return [
            '    Object.freeze({',
            `        id: '${limb.id}',`,
            `        tree: '${limb.tree}',`,
            `        surface: ${limb.surface},`,
            `        seats: Object.freeze([${seats}]),`,
            '        stations: Object.freeze([',
            ...rows,
            '        ]),',
            '    }),',
        ].join('\n');
    });
    return `/**
 * Forest — the eagle owl's limbs, where they are in the world. GENERATED by
 * scripts/forest/pack-owl-limbs.mjs from spruce-elder.glb and pine-elder.glb: do not edit; change
 * scripts/blender/forest_night/owl_limbs.py (or where the elders stand) and run the script again.
 *
 * Each limb grows out of \`tree\`. \`stations\` run from inside the trunk to the limb's end, equally
 * spaced along it: [x, y, z, top, radius] in world metres, \`top\` being the height of the bark's top
 * there (where the owl's toes close). \`surface\` is where it leaves the trunk's bark and each seat
 * [id, u] a place the owl sits, both as shares of its length.
 */
/* eslint-disable max-len */

export const FOREST_OWL_LIMB_DATA = Object.freeze([
${lines.join('\n')}
]);
`;
}

const opts = args();
if (!opts['place-only'] && !opts.dry) runBlender(String(opts.blender || BLENDER));
const limbs = await placeLimbs();
limbs.forEach((limb) => {
    const seats = limb.seats.map(([id, u]) => {
        const st = limb.stations[Math.round(u * (limb.stations.length - 1))];
        return `${id}@${u} (${st[0]}, ${st[3]}, ${st[2]})`;
    });
    console.log(`[owl-limbs] ${limb.tree} ${limb.id}: ${limb.stations.length} stations, seats ${seats.join(' ')}`);
});
if (!opts.dry) {
    writeFileSync(MODULE, moduleText(limbs), 'utf8');
    console.log(`[owl-limbs] wrote ${MODULE}`);
}
