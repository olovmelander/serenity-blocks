import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    bakeCacheStats, isBaked, primeBake, resetBakeCache,
} from '../../src/themes/shared/bake-cache.js';
import {
    bakeCellular, bakeNoise, bakeStair, bakeVapourNoise, computeStairArrays, withStairGenerator,
} from '../../src/themes/thermal-bloom/thermal-bloom-bake.js';
import { bakeJobKey, prepareThermalBloomBakes } from '../../src/themes/thermal-bloom/thermal-bloom-bake-loader.js';
import { ThermalBloomWorld, thermalBloomBakeJobs } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';

afterEach(() => resetBakeCache());

/** What the worker does with a job, on this thread (vitest has no Worker). */
const WORKER_BAKES = {
    noise: bakeNoise, cellular: bakeCellular, vapour: bakeVapourNoise, stair: computeStairArrays,
};

describe('Thermal Bloom bakes ahead of the build', () => {
    it('names, as jobs, exactly the bakes a build makes (a primed cache leaves the build nothing to bake)', () => {
        const jobs = thermalBloomBakeJobs('Minimal');
        expect(jobs.map((job) => job.kind)).toEqual(['noise', 'cellular', 'vapour', 'stair']);
        // Bake each job as the worker would (plain data), then start from an empty cache.
        const results = jobs.map((job) => {
            const args = job.kind === 'stair' ? [{ seed: 0x57a1, ...job.args[0] }] : job.args;
            return WORKER_BAKES[job.kind](...args);
        });
        resetBakeCache();
        // Primed as the loader primes them: under the jobs' keys, the Stair with its sampler back.
        jobs.forEach((job, i) => {
            primeBake(bakeJobKey(job), job.kind === 'stair' ? withStairGenerator(results[i]) : results[i]);
        });
        jobs.forEach((job) => expect(isBaked(bakeJobKey(job)), job.kind).toBe(true));
        const before = bakeCacheStats().entries;
        const world = new ThermalBloomWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        // Every bake the build asked for was already kept under the jobs' keys.
        expect(bakeCacheStats().entries).toBe(before);
        expect(world.parts.terraces).toBeTruthy();
        world.dispose();
    });

    it('leaves a kept Stair as it was baked when a build lifts its mesh', () => {
        const [stairJob] = thermalBloomBakeJobs('Minimal').filter((job) => job.kind === 'stair');
        const first = new ThermalBloomWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        const baked = bakeStair(stairJob.args[0]);
        const heights = Array.from(baked.positions.subarray(0, 30));
        first.dispose();
        const second = new ThermalBloomWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        expect(bakeStair(stairJob.args[0])).toBe(baked);
        expect(Array.from(baked.positions.subarray(0, 30))).toEqual(heights);
        second.dispose();
    });

    it('resolves at once without a Worker and leaves the bakes to the build', async () => {
        expect(typeof Worker).toBe('undefined');
        const result = await prepareThermalBloomBakes(thermalBloomBakeJobs('Minimal'));
        expect(result).toEqual({ viaWorker: false, baked: 0, cached: 0 });
        // Nothing was baked on this thread by the loader itself.
        expect(bakeCacheStats().entries).toBe(0);
    });

    it('asks only for what the cache does not hold', async () => {
        const jobs = thermalBloomBakeJobs('Minimal');
        bakeNoise(...jobs[0].args);
        const result = await prepareThermalBloomBakes(jobs);
        expect(result.cached).toBe(1);
    });
});

describe('the bake cache takes results baked elsewhere', () => {
    it('keeps a primed result, and keeps the first one when a key is primed twice', () => {
        const a = new Float32Array(4);
        expect(isBaked('k')).toBe(false);
        expect(primeBake('k', a)).toBe(a);
        expect(isBaked('k')).toBe(true);
        expect(primeBake('k', new Float32Array(4))).toBe(a);
        expect(bakeCacheStats()).toMatchObject({ entries: 1, bytes: 16 });
    });
});
