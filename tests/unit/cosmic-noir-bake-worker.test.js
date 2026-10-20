import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { SMOKE_SEED, bakeSmokeNoise } from '../../src/themes/cosmic-noir/cosmic-noir-bake.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/cosmic-noir/cosmic-noir-quality.js';
import {
    cosmicNoirBakeJobs, cosmicNoirBakeKey, cosmicNoirBakes,
} from '../../src/themes/cosmic-noir/cosmic-noir-bakes.js';

/**
 * Cosmic Noir's smoke volume bakes in a module Worker on a first visit. The jobs must name exactly
 * the bake the world's build asks for, under the key that bake keeps, or the build bakes it again on
 * the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/cosmic-noir/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Cosmic Noir bakes its smoke ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, the bake the world builds from', (quality) => {
        const jobs = cosmicNoirBakeJobs(quality);
        for (const job of jobs) expect(isBaked(cosmicNoirBakeKey(job))).toBe(false);
        // What the world calls (cosmic-noir-world.js: the smoke at the tier's size).
        expect(source('cosmic-noir-world.js')).toContain('bakeSmokeNoise(SMOKE_SEED, tier.noise)');
        bakeSmokeNoise(SMOKE_SEED, tierFor(quality).noise);
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
});
