import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeFbm, bakeGasNoise } from '../../src/themes/serenity-warp/serenity-warp-tsl.js';
import { GAS_SEED, GAS_SIZE } from '../../src/themes/serenity-warp/serenity-warp-bake.js';
import {
    SERENITY_WARP_BAKE_JOBS, serenityWarpBakeKey, serenityWarpBakes,
} from '../../src/themes/serenity-warp/serenity-warp-bakes.js';

/**
 * Serenity Warp's noise bakes run in a module Worker on a first visit (the gas volume held the main
 * thread about 0.45 s, play-feel probe 2026-10-15). The jobs must name exactly the bakes the world's
 * build asks for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/serenity-warp/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Serenity Warp bakes its noise ahead of the build', () => {
    it('names, under the keys they keep, the two bakes the world builds from', () => {
        for (const job of SERENITY_WARP_BAKE_JOBS) expect(isBaked(serenityWarpBakeKey(job))).toBe(false);
        // What the world calls (serenity-warp-world.js: the gas at its seed and size, the fBm at its defaults).
        expect(source('serenity-warp-world.js')).toContain('bakeGasNoise(GAS_SEED, GAS_SIZE)');
        expect(source('serenity-warp-world.js')).toContain('createFbmTexture(bakeFbm())');
        bakeGasNoise(GAS_SEED, GAS_SIZE);
        bakeFbm();
        for (const job of SERENITY_WARP_BAKE_JOBS) expect(isBaked(serenityWarpBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('serenity-warp-bake.js')).not.toMatch(/from 'three/);
        const worker = source('serenity-warp-bake.worker.js');
        for (const { kind } of SERENITY_WARP_BAKE_JOBS) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(serenityWarpBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
