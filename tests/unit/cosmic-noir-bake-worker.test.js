import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { DataUtils } from 'three';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import {
    LACE_SEED, LACE_SIZE, SEA_SEED, SMOKE_SEED, bakeFoamLace, bakeSeaField, bakeSmokeNoise,
} from '../../src/themes/cosmic-noir/cosmic-noir-bake.js';
import {
    ROCK_BOX, ROCK_SEED, bakeRockField, rockField, rockGrid,
} from '../../src/themes/cosmic-noir/cosmic-noir-rock.js';
import { PULSAR, SEA, TOWER } from '../../src/themes/cosmic-noir/cosmic-noir-core.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/cosmic-noir/cosmic-noir-quality.js';
import {
    cosmicNoirBakeJobs, cosmicNoirBakeKey, cosmicNoirBakes,
} from '../../src/themes/cosmic-noir/cosmic-noir-bakes.js';

/**
 * Cosmic Noir's smoke volume and its sea's field bake in a module Worker on a first visit. The jobs
 * must name exactly the bakes the world's build asks for, under the keys those bakes keep, or the
 * build bakes them again on the page.
 */
const { fromHalfFloat } = DataUtils;
const source = (name) => readFileSync(new URL(`../../src/themes/cosmic-noir/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Cosmic Noir bakes its smoke ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, the bake the world builds from', (quality) => {
        const jobs = cosmicNoirBakeJobs(quality);
        for (const job of jobs) expect(isBaked(cosmicNoirBakeKey(job))).toBe(false);
        // What the world calls (cosmic-noir-world.js: the smoke and the sea at the tier's sizes).
        expect(source('cosmic-noir-world.js')).toContain('bakeSmokeNoise(SMOKE_SEED, tier.noise)');
        expect(source('cosmic-noir-world.js')).toContain('bakeSeaField(SEA_SEED, tier.sea)');
        expect(source('cosmic-noir-world.js')).toContain('bakeFoamLace(LACE_SEED, LACE_SIZE)');
        expect(source('cosmic-noir-world.js')).toContain('bakeRockField(ROCK_SEED, tier.rock)');
        expect(jobs.map(({ kind }) => kind).sort()).toEqual(['lace', 'rock', 'sea', 'smoke']);
        bakeSmokeNoise(SMOKE_SEED, tierFor(quality).noise);
        bakeSeaField(SEA_SEED, tierFor(quality).sea);
        bakeFoamLace(LACE_SEED, LACE_SIZE);
        bakeRockField(ROCK_SEED, tierFor(quality).rock);
        for (const job of jobs) expect(isBaked(cosmicNoirBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('cosmic-noir-bake.js')).not.toMatch(/from 'three/);
        expect(source('cosmic-noir-rock.js')).not.toMatch(/from 'three/);
        const worker = source('cosmic-noir-bake.worker.js');
        for (const { kind } of cosmicNoirBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(cosmicNoirBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('bakes the same volume for the same seed: the smoke is one place, every visit', () => {
        const a = bakeSmokeNoise(SMOKE_SEED, 16);
        resetBakeCache();
        const b = bakeSmokeNoise(SMOKE_SEED, 16);
        expect(a.near).not.toBe(b.near);
        expect(Buffer.compare(Buffer.from(a.near), Buffer.from(b.near))).toBe(0);
        expect(Buffer.compare(Buffer.from(a.far), Buffer.from(b.far))).toBe(0);
        // Four channels a voxel (masses, filaments, billows, the slow field), every one of them used.
        expect(a.far.length).toBe(8 * 8 * 8 * 4);
        expect(a.near.length).toBe(16 * 16 * 16 * 4);
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < a.near.length; i += 4) {
                lo = Math.min(lo, a.near[i]);
                hi = Math.max(hi, a.near[i]);
            }
            expect(hi - lo, `channel ${c}`).toBeGreaterThan(80);
        }
    });

    it('bakes the sea as one field: a height, its own slope, a calm share and a mip chain, the same every visit', () => {
        const size = 64;
        const a = bakeSeaField(SEA_SEED, size);
        resetBakeCache();
        const b = bakeSeaField(SEA_SEED, size);
        expect(a.size).toBe(size);
        expect(a.levels.map((level) => level.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
        expect(Buffer.compare(Buffer.from(a.levels[0].data.buffer), Buffer.from(b.levels[0].data.buffer))).toBe(0);
        const at = (x, y, c) => fromHalfFloat(a.levels[0].data[(((y + size) % size) * size + ((x + size) % size)) * 4 + c]);
        let lo = Infinity;
        let hi = -Infinity;
        let dot = 0;
        let stored = 0;
        let measured = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const h = at(x, y, 0);
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
                // The slope it stores is the height's own (per tile), across the tile's seam too.
                const du = at(x, y, 1);
                const diff = (at(x + 1, y, 0) - at(x - 1, y, 0)) * size * 0.5;
                dot += du * diff;
                stored += du * du;
                measured += diff * diff;
                expect(at(x, y, 3)).toBeGreaterThanOrEqual(0);
                expect(at(x, y, 3)).toBeLessThanOrEqual(1);
            }
        }
        // Height −1 .. 1 about its mean, reaching one end.
        expect(Math.max(-lo, hi)).toBeCloseTo(1, 2);
        expect(Math.min(-lo, hi)).toBeGreaterThan(0.4);
        expect(dot / Math.sqrt(stored * measured)).toBeGreaterThan(0.99);
        // A far read is the filtered sea: the coarsest level holds the mean height, about 0.
        expect(Math.abs(fromHalfFloat(a.levels[6].data[0]))).toBeLessThan(0.05);
    });

    it('bakes the foam\'s lace as cell walls: thin walls, whole cells, the same every visit', () => {
        const a = bakeFoamLace(LACE_SEED, 64);
        resetBakeCache();
        const b = bakeFoamLace(LACE_SEED, 64);
        expect(a.size).toBe(64);
        expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data))).toBe(0);
        // A wall is where the two nearest cells are equally near: few texels lie on one, most
        // lie well inside a cell, so a thread drawn from it is thin.
        let onWall = 0;
        let inside = 0;
        for (let i = 0; i < a.data.length; i += 4) {
            if (a.data[i] < 16) onWall += 1;
            if (a.data[i] > 96) inside += 1;
        }
        const texels = a.data.length / 4;
        expect(onWall / texels).toBeGreaterThan(0.02);
        expect(onWall / texels).toBeLessThan(0.3);
        expect(inside / texels).toBeGreaterThan(0.3);
    });

    it('shapes the rock once: a footing under the tower, clear of its box, the same every visit', () => {
        const cell = 0.25;
        const a = bakeRockField(ROCK_SEED, cell);
        resetBakeCache();
        const b = bakeRockField(ROCK_SEED, cell);
        const [nx, ny, nz] = rockGrid(cell);
        expect([a.nx, a.ny, a.nz]).toEqual([nx, ny, nz]);
        expect(a.data.length).toBe(nx * ny * nz);
        expect(Buffer.compare(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer))).toBe(0);
        // Every value is finite, and both signs are there (there is a rock, and there is air).
        let inside = 0;
        for (let i = 0; i < a.data.length; i++) {
            const d = fromHalfFloat(a.data[i]);
            expect(Number.isFinite(d)).toBe(true);
            if (d < 0) inside += 1;
        }
        expect(inside / a.data.length).toBeGreaterThan(0.03);
        expect(inside / a.data.length).toBeLessThan(0.5);

        const field = rockField(ROCK_SEED);
        const sea = SEA.level - PULSAR.height;
        const foot = sea + TOWER.footLift;
        // The tower's foot stands on stone: rock a little under it on its axis, air a little over.
        expect(field(0, foot - 0.5, 0)).toBeLessThan(0);
        expect(field(0, foot + 0.9, 0)).toBeGreaterThan(0);
        // It stands in the sea (stone under the water at its middle) and clear of every side of
        // its box but the floor: the shader takes the way to the box as the way to the rock.
        expect(field(0, sea - 0.5, 0)).toBeLessThan(0);
        const { min, max } = ROCK_BOX;
        for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
                const s = i / 8;
                const t = j / 8;
                const x = min[0] + (max[0] - min[0]) * s;
                const y = min[1] + (max[1] - min[1]) * t;
                const z = min[2] + (max[2] - min[2]) * s;
                const zt = min[2] + (max[2] - min[2]) * t;
                expect(field(min[0], y, z), `−x face ${s} ${t}`).toBeGreaterThan(0.1);
                expect(field(max[0], y, z), `+x face ${s} ${t}`).toBeGreaterThan(0.1);
                expect(field(x, y, min[2]), `−z face ${s} ${t}`).toBeGreaterThan(0.1);
                expect(field(x, y, max[2]), `+z face ${s} ${t}`).toBeGreaterThan(0.1);
                expect(field(x, max[1], zt), `top ${s} ${t}`).toBeGreaterThan(0.1);
            }
        }
    });
});
