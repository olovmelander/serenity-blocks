import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeCloudNoise, bakeNoise } from '../../src/themes/voltage-storm/voltage-storm-tsl.js';
import { CLOUD_SEED } from '../../src/themes/voltage-storm/voltage-storm-bake.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/voltage-storm/voltage-storm-quality.js';
import {
    voltageStormBakeJobs, voltageStormBakeKey, voltageStormBakes,
} from '../../src/themes/voltage-storm/voltage-storm-bakes.js';

/**
 * Voltage Storm's noise bakes run in a module Worker on a first visit (about 0.15 s of main thread,
 * play-feel probe 2026-10-16). The jobs must name exactly the bakes the world's build asks for,
 * under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/voltage-storm/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Voltage Storm bakes its noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, the two bakes the world builds from', (quality) => {
        const jobs = voltageStormBakeJobs(quality);
        for (const job of jobs) expect(isBaked(voltageStormBakeKey(job))).toBe(false);
        // What the world calls (voltage-storm-world.js).
        expect(source('voltage-storm-world.js')).toContain('createNoiseTexture(bakeNoise())');
        expect(source('voltage-storm-world.js')).toContain('bakeCloudNoise(CLOUD_SEED, tier.noise3d)');
        bakeNoise();
        bakeCloudNoise(CLOUD_SEED, tierFor(quality).noise3d);
        for (const job of jobs) expect(isBaked(voltageStormBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('voltage-storm-bake.js')).not.toMatch(/from 'three/);
        const worker = source('voltage-storm-bake.worker.js');
        for (const { kind } of voltageStormBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(voltageStormBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
