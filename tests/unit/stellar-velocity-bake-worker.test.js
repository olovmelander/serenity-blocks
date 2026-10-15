import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeCanyonNoise, bakeFbm } from '../../src/themes/stellar-velocity/stellar-velocity-tsl.js';
import { CANYON_SEED } from '../../src/themes/stellar-velocity/stellar-velocity-bake.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/stellar-velocity/stellar-velocity-quality.js';
import {
    stellarVelocityBakeJobs, stellarVelocityBakeKey, stellarVelocityBakes,
} from '../../src/themes/stellar-velocity/stellar-velocity-bakes.js';

/**
 * Stellar Velocity's noise bakes run in a module Worker on a first visit (the canyon's cloud held the
 * main thread about 0.3 s, play-feel probe 2026-10-15). The jobs must name exactly the bakes the
 * world's build asks for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/stellar-velocity/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Stellar Velocity bakes its noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, the two bakes the world builds from', (quality) => {
        const jobs = stellarVelocityBakeJobs(quality);
        for (const job of jobs) expect(isBaked(stellarVelocityBakeKey(job))).toBe(false);
        // What the world calls (stellar-velocity-world.js: the canyon at the tier's size, the fBm at its defaults).
        expect(source('stellar-velocity-world.js')).toContain('bakeCanyonNoise(CANYON_SEED, tier.noise)');
        expect(source('stellar-velocity-world.js')).toContain('createFbmTexture(bakeFbm())');
        bakeCanyonNoise(CANYON_SEED, tierFor(quality).noise);
        bakeFbm();
        for (const job of jobs) expect(isBaked(stellarVelocityBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('stellar-velocity-bake.js')).not.toMatch(/from 'three/);
        const worker = source('stellar-velocity-bake.worker.js');
        for (const { kind } of stellarVelocityBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(stellarVelocityBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
