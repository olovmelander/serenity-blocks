import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { createSeaNoise, createSkyNoise } from '../../src/themes/sunset/sunset-tsl.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/sunset/sunset-quality.js';
import {
    sunsetBakeJobs, sunsetBakeKey, sunsetBakes,
} from '../../src/themes/sunset/sunset-bakes.js';

/**
 * Sunset's sky and sea noise bake in a module Worker on a first visit (about 0.33 s of main
 * thread, play-feel probe 2026-10-16). The jobs must name exactly the bakes the world's build asks
 * for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/sunset/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Sunset bakes its noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, exactly the noise the world builds from', (quality) => {
        const jobs = sunsetBakeJobs(quality);
        for (const job of jobs) expect(isBaked(sunsetBakeKey(job))).toBe(false);
        // What the world calls (sunset-world.js).
        const tier = tierFor(quality);
        expect(source('sunset-world.js')).toContain('createSkyNoise(tier.skyNoise)');
        expect(source('sunset-world.js')).toContain('createSeaNoise(tier.seaNoise)');
        createSkyNoise(tier.skyNoise).dispose();
        createSeaNoise(tier.seaNoise).map.dispose();
        for (const job of jobs) expect(isBaked(sunsetBakeKey(job)), job.kind).toBe(true);
    });

    it('is served by its worker under the jobs\' kinds, from a core that imports no three', () => {
        expect(source('sunset-core.js')).not.toMatch(/from 'three/);
        const worker = source('sunset-bake.worker.js');
        for (const { kind } of sunsetBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(sunsetBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
