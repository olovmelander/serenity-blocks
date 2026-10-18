import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    bakeCacheStats, isBaked, resetBakeCache,
} from '../../src/themes/shared/bake-cache.js';
import {
    bakeOpticsLut, bakePuff, bakeSeaField, bakeSkyNoise, bakeStoneNoise,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-core.js';
import {
    RainbowTerracesWorld, rainbowTerracesBakeJobs, rainbowTerracesBakeKey,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-world.js';
import { rainbowTerracesBakes } from '../../src/themes/rainbow-terraces/rainbow-terraces-theme.js';

afterEach(() => resetBakeCache());

/** What the worker does with a job, on this thread (vitest has no Worker). */
const WORKER_BAKES = {
    sky: bakeSkyNoise, stone: bakeStoneNoise, optics: bakeOpticsLut, puff: bakePuff, sea: bakeSeaField,
};

describe('Rainbow Terraces bakes ahead of the build', () => {
    it('names, as jobs, exactly the bakes a build makes (kept ones leave the build nothing to bake)', () => {
        const jobs = rainbowTerracesBakeJobs('Minimal');
        expect(jobs.map((job) => job.kind).sort()).toEqual(['optics', 'puff', 'sea', 'sky', 'stone']);
        jobs.forEach((job) => {
            WORKER_BAKES[job.kind](...job.args);
            expect(isBaked(rainbowTerracesBakeKey(job)), job.kind).toBe(true);
        });
        const before = bakeCacheStats().entries;
        const world = new RainbowTerracesWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        expect(bakeCacheStats().entries).toBe(before);
        world.dispose();
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(rainbowTerracesBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(bakeCacheStats().entries).toBe(0);
    });
});
