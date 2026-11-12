import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { DataUtils } from 'three';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import {
    SEA_SEED, SMOKE_SEED, bakeSeaField, bakeSmokeNoise,
} from '../../src/themes/cosmic-noir/cosmic-noir-bake.js';
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
        expect(jobs.map(({ kind }) => kind).sort()).toEqual(['sea', 'smoke']);
        bakeSmokeNoise(SMOKE_SEED, tierFor(quality).noise);
        bakeSeaField(SEA_SEED, tierFor(quality).sea);
        for (const job of jobs) expect(isBaked(cosmicNoirBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('cosmic-noir-bake.js')).not.toMatch(/from 'three/);
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
});
