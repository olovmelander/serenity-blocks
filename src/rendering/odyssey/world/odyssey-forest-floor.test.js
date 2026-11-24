import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
    FOREST_FLOOR, FOREST_FLOOR_PLATE, bakeForestFloorData, floorShare, forestClosure,
} from './odyssey-forest-floor.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { FOREST_SPECIMENS, forestFarIndex } from './odyssey-forest-models-decode.js';
import { FOREST_BEACH, FOREST_GLADES, forestTarnOpen } from './odyssey-forest-composition.js';
import { FOREST_ANIMAL_GROUND, FOREST_ANIMAL_REACH, FOREST_ROCKS } from './odyssey-forest-keepouts.js';
import { odysseyMeadowOpenness } from './odyssey-meadow-clearing.js';
import { ODYSSEY_SEA_LEVEL, odysseyTarnDistance, odysseyWorldHeight } from './odyssey-world-height.js';
import { getOdysseyWorldRailPointAt } from '../path-utils.js';

/**
 * THE FOREST'S FLOOR (2026-11-24): where the ground is a wood's, and what grows on it.
 */

const RAIL = Array.from({ length: 48 }, (_, i) => {
    const p = getOdysseyWorldRailPointAt(i / 47);
    return { x: p.x, y: p.y, z: p.z };
});
const FOREST = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL });
const FLOOR = FOREST.placements.filter((p) => p.role === 'floor');
const TREES = FOREST.placements.filter((p) => p.role !== 'floor');
const WOOD = forestClosure(TREES);
const P = FOREST_FLOOR_PLATE;
const at = (p) => `${p.id} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`;
const refuse = (p, why) => { throw new Error(`${at(p)}: ${why}`); };
const texelOf = (x, z) => {
    const i = Math.floor(((x - (P.x - (P.extent / 2))) / P.extent) * P.res);
    const j = Math.floor(((z - (P.z - (P.extent / 2))) / P.extent) * P.res);
    return ((j * P.res) + i) * 4;
};
const plateAt = (x, z) => Array.from(FOREST.floor.data.subarray(texelOf(x, z), texelOf(x, z) + 4), (v) => v / 255);
const oak = (x, z, extra = {}) => ({
    x, z, crownR: 8.5, speciesId: 'oak', role: 'canopy', ...extra,
});

describe('where a wood has a floor', () => {
    it('is under a shut wood, not under a tree alone on the grass', () => {
        const lone = forestClosure([oak(P.x, P.z)]);
        expect(floorShare(lone.at(P.x, P.z), P.x, P.z)).toBeLessThan(0.15);
        const grove = [];
        for (let j = -4; j <= 4; j += 1) for (let i = -4; i <= 4; i += 1) grove.push(oak(P.x + (i * 10), P.z + (j * 10)));
        const shut = forestClosure(grove);
        expect(shut.at(P.x, P.z)).toBeGreaterThan(1);
        expect(floorShare(shut.at(P.x, P.z), P.x, P.z)).toBe(1);
        // ...and it ends where the wood does.
        expect(floorShare(shut.at(P.x + 70, P.z), P.x + 70, P.z)).toBe(0);
    });

    it('is laid by what stands over it, not by bushes, ferns or dead trunks', () => {
        const low = ['shrub', 'floor'].map((role) => oak(P.x, P.z, { role }));
        const dead = oak(P.x, P.z, { speciesId: 'snag' });
        expect(Math.max(...forestClosure([...low, dead]).closed.subarray(0, 100))).toBe(0);
        expect(forestClosure([...low, dead]).at(P.x, P.z)).toBe(0);
    });

    it('knows whose wood it is: needles, blossom and gold are parts of the whole', () => {
        const mixed = forestClosure([oak(P.x, P.z), oak(P.x + 6, P.z, { speciesId: 'spruce' }), oak(P.x, P.z + 6, { speciesId: 'cherry' }),
            oak(P.x + 6, P.z + 6, { speciesId: 'aspen' })]);
        const parts = [mixed.needlesAt, mixed.blossomAt, mixed.goldAt].map((f) => f(P.x, P.z) / mixed.at(P.x, P.z));
        parts.forEach((v) => {
            expect(v).toBeGreaterThan(0.1);
            expect(v).toBeLessThan(0.4);
        });
        const data = bakeForestFloorData(mixed);
        expect(data.data.length).toBe(P.res * P.res * 4);
        expect(data.res).toBe(P.res);
    });
});

describe('the island\'s floor plate', () => {
    it('comes with the scatter, for every tier the same', () => {
        expect(FOREST.floor.data).toBeInstanceOf(Uint8Array);
        const low = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL, spacing: 24 });
        expect(low.floor.data.every((v, k) => v === FOREST.floor.data[k])).toBe(true);
    });

    it('covers the heart of the Greenwood, and leaves the meadow, the glade on the rail and the sand open', () => {
        // (The heart of each authored mass, off the glades cut through them.)
        [[-432, -288], [-330, -318], [-560, -340], [-446, -430]].forEach(([x, z]) => expect(plateAt(x, z)[0], `${x},${z}`).toBeGreaterThan(0.6));
        [[-40, -330], [30, -330], [-168, -320], [-192, -372]].forEach(([x, z]) => expect(plateAt(x, z)[0], `${x},${z}`).toBeLessThan(0.1));
        expect(FOREST_GLADES.length).toBeGreaterThan(4);
        for (let x = -700; x < 500; x += 8) {
            for (let z = -240; z < -120; z += 8) {
                const over = odysseyWorldHeight(x, z) - ODYSSEY_SEA_LEVEL;
                if (over > 0 && over < FOREST_BEACH.top - 3) expect(plateAt(x, z)[0], `sand ${x},${z}`).toBeLessThan(0.6);
            }
        }
    });

    it('lies in needles on the slopes, in petals under the cherries, in its own leaves on the gold side', () => {
        expect(plateAt(-344, -628)[1]).toBeGreaterThan(0.6);
        expect(plateAt(104, -556)[2]).toBeGreaterThan(0.5);
        const gold = TREES.filter((p) => p.speciesId === 'aspen').map((p) => plateAt(p.x, p.z)[3]);
        expect(gold.reduce((s, v) => s + v, 0) / gold.length).toBeGreaterThan(0.6);
        const oaks = TREES.filter((p) => p.speciesId === 'oak' && p.x < -200).map((p) => plateAt(p.x, p.z));
        expect(oaks.reduce((s, v) => s + v[1] + v[2] + v[3], 0) / oaks.length).toBeLessThan(0.25);
    });
});

describe('what grows there', () => {
    it('is ferns, bracken and fallen wood, and never drawn far off', () => {
        const kinds = new Set(FLOOR.map((p) => p.speciesId));
        expect([...kinds].sort()).toEqual(['bracken', 'fern', 'log']);
        expect(FLOOR.length).toBeGreaterThan(1500);
        expect(FLOOR.length).toBeLessThan(3500);
        FLOOR.forEach((p) => {
            if (p.lod === 'far' || p.dEye > FOREST_FLOOR.reach + 6) refuse(p, `${p.lod} ${p.dEye.toFixed(0)}`);
        });
        FOREST_SPECIMENS.filter((s) => kinds.has(s.species)).forEach((s) => expect(forestFarIndex(s.id), s.id).toBe(-1));
        // Cheap: the whole floor is a tenth of the near trees' foliage.
        const cards = (list) => list.filter((p) => p.lod !== 'far').reduce((s, p) => s + FOREST_SPECIMENS[p.specimen][p.lod].cards, 0);
        expect(cards(FLOOR)).toBeLessThan(cards(TREES) * 0.13);
    });

    it('keeps ferns under the crowns and bracken to the edge, and leaves the blossom its petals', () => {
        const mean = (list) => list.reduce((s, p) => s + WOOD.at(p.x, p.z), 0) / list.length;
        const of = (id) => FLOOR.filter((p) => p.speciesId === id);
        expect(mean(of('fern'))).toBeGreaterThan(mean(of('bracken')) + 0.25);
        of('fern').forEach((p) => { if (WOOD.at(p.x, p.z) < 0.35) refuse(p, 'a fern in the open'); });
        of('bracken').forEach((p) => { if (WOOD.at(p.x, p.z) > 0.9) refuse(p, 'bracken in the dark'); });
        FLOOR.forEach((p) => { if (WOOD.blossomAt(p.x, p.z) / WOOD.at(p.x, p.z) > 0.55) refuse(p, 'under the blossom'); });
    });

    it('stands on dry open ground: off the sand, the water and its near bank, the rocks, the animals\' ground and the horses\' meadow', () => {
        FLOOR.forEach((p) => {
            const over = p.y - ODYSSEY_SEA_LEVEL;
            if (over < 1.5) refuse(p, 'in the sea');
            if (over < 7 && p.z > -260) refuse(p, 'on the sand');
            if (odysseyTarnDistance(p.x, p.z) < 1.2 || forestTarnOpen(p.x, p.z, p.y)) refuse(p, 'on the tarn\'s bank');
            if (odysseyMeadowOpenness(p.x, p.z) > 0) refuse(p, 'on the horses\' meadow');
            FOREST_ROCKS.forEach(([x, z, r]) => { if (Math.hypot(p.x - x, p.z - z) < r) refuse(p, 'in a rock'); });
            FOREST_ANIMAL_GROUND.forEach(([x, z]) => {
                if (Math.hypot(p.x - x, p.z - z) < FOREST_ANIMAL_REACH + (p.skirt * 0.6)) refuse(p, 'on the animals\' ground');
            });
        });
    });

    it('grows round the trunks, not through them, and a fallen trunk lies along its slope', () => {
        const near = TREES.filter((p) => p.lod === 'hero');
        FLOOR.forEach((p) => {
            near.forEach((t) => {
                if (Math.hypot(p.x - t.x, p.z - t.z) < (FOREST_SPECIMENS[t.specimen].trunkR * t.scale) + 0.3) refuse(p, `in the trunk of ${at(t)}`);
            });
        });
        const logs = FLOOR.filter((p) => p.id.startsWith('log'));
        expect(logs.length).toBeGreaterThan(8);
        logs.forEach((p) => {
            // Its length runs along its own x: the ground under its two ends is near one height.
            const half = p.crownR * 0.8;
            const end = (s) => odysseyWorldHeight(p.x + (Math.cos(p.rot) * half * s), p.z - (Math.sin(p.rot) * half * s));
            if (Math.abs(end(1) - end(-1)) > 1.4) refuse(p, `its ends ${Math.abs(end(1) - end(-1)).toFixed(1)} u apart`);
        });
    });

    it('takes the wood\'s light: in its shade, with flecks of sun', () => {
        const ferns = FLOOR.filter((p) => p.speciesId === 'fern' && p.lod === 'hero');
        const sunny = ferns.filter((p) => p.shadeTop < 0).length / ferns.length;
        expect(sunny).toBeGreaterThan(0.05);
        expect(sunny).toBeLessThan(0.6);
        // ...and a tree's own light knows nothing of the ferns at its foot.
        const bare = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, seaLevel: ODYSSEY_SEA_LEVEL, forceLod: null });
        expect(bare.placements.filter((p) => p.role !== 'floor').map((p) => p.open).slice(0, 400))
            .toEqual(TREES.map((p) => p.open).slice(0, 400));
    });
});

describe('its photograph', () => {
    const png = readFileSync(fileURLToPath(new URL('../assets/ground/floor.png', import.meta.url)));
    it('is a 512 px square of data, and the shader divides by its real mean', () => {
        expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([512, 512, 8, 2]);
        const parts = [];
        for (let o = 8; o < png.length;) {
            const n = png.readUInt32BE(o);
            if (png.toString('latin1', o + 4, o + 8) === 'IDAT') parts.push(png.subarray(o + 8, o + 8 + n));
            o += n + 12;
        }
        const raw = inflateSync(Buffer.concat(parts));
        const sum = [0, 0, 0];
        for (let y = 0; y < 512; y += 1) {
            const row = y * ((512 * 3) + 1);
            expect(raw[row]).toBe(0);
            for (let x = 0; x < 512; x += 1) for (let c = 0; c < 3; c += 1) sum[c] += raw[row + 1 + (x * 3) + c];
        }
        const [light, moss, fresh] = sum.map((v) => v / (512 * 512 * 255));
        const renderer = readFileSync(fileURLToPath(new URL('./odyssey-world-renderer.js', import.meta.url)), 'utf8');
        const stated = Number(renderer.match(/const FLOOR = Object\.freeze\(\{[^]*?mean: ([\d.]+)/)[1]);
        expect(Math.abs(stated - light)).toBeLessThan(0.004);
        expect(moss).toBeGreaterThan(0.08);
        expect(fresh).toBeGreaterThan(0.015);
    });
});
