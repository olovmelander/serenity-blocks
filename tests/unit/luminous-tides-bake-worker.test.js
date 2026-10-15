import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { createSeaNoise, createSkyNoise } from '../../src/themes/luminous-tides/luminous-tides-tsl.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/luminous-tides/luminous-tides-quality.js';
import {
    luminousTidesBakeJobs, luminousTidesBakeKey, luminousTidesBakes,
} from '../../src/themes/luminous-tides/luminous-tides-bakes.js';

/**
 * Luminous Tides' sky and sea noise bake in a module Worker on a first visit (about 0.4 s of main
 * thread, play-feel probe 2026-10-15). The jobs must name exactly the bakes the world's build asks
 * for, under the keys those bakes keep, or the build bakes them again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/luminous-tides/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Luminous Tides bakes its noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, exactly the noise the world builds from', (quality) => {
        const jobs = luminousTidesBakeJobs(quality);
        for (const job of jobs) expect(isBaked(luminousTidesBakeKey(job))).toBe(false);
        // What the world calls (luminous-tides-world.js).
        const tier = tierFor(quality);
        expect(source('luminous-tides-world.js')).toContain('createSkyNoise(tier.skyNoise)');
        expect(source('luminous-tides-world.js')).toContain('createSeaNoise(tier.seaNoise)');
        createSkyNoise(tier.skyNoise).dispose();
        createSeaNoise(tier.seaNoise).map.dispose();
        for (const job of jobs) expect(isBaked(luminousTidesBakeKey(job)), job.kind).toBe(true);
    });

    it('is served by its worker under the jobs\' kinds, from a core that imports no three', () => {
        expect(source('luminous-tides-core.js')).not.toMatch(/from 'three/);
        const worker = source('luminous-tides-bake.worker.js');
        for (const { kind } of luminousTidesBakeJobs('High')) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(luminousTidesBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
