/**
 * Thermal Bloom's first-visit bakes, off the page's thread (shared/bake-worker-client.js).
 *
 * A first visit used to bake the noise, the cells, the vapour volume and the Stair inside
 * `world.build()`: one task of about 0.6 s on the main thread, which froze the theme still playing
 * while this one built behind it. The theme hands these jobs to a module Worker while its renderer
 * comes up; the results prime the shared bake cache, so the build finds them there.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { THERMAL_BLOOM_BAKE_KEYS, withStairGenerator } from './thermal-bloom-bake.js';

/** bakeStair's own defaults, so a job and the bake name the same key. */
function withStairDefaults({
    tiers = 10, rows = 300, columns = 110, layoutSize = 512, seed = 0x57a1,
} = {}) {
    return {
        tiers, rows, columns, layoutSize, seed,
    };
}

/** The cache key of a job ({ kind, args }), as the bake functions themselves name it. */
export function bakeJobKey({ kind, args }) {
    const key = THERMAL_BLOOM_BAKE_KEYS[kind];
    if (!key) throw new Error(`[ThermalBloom] unknown bake ${kind}`);
    return kind === 'stair' ? key(withStairDefaults(args[0])) : key(...args);
}

/**
 * Bake the jobs the cache does not hold yet in a Worker, priming the cache as each lands.
 * @param {Array<{ kind: string, args: Array }>} jobs  thermalBloomBakeJobs(quality)
 * @returns {Promise<{ viaWorker: boolean, baked: number, cached: number }>} never rejects
 */
export function prepareThermalBloomBakes(jobs) {
    return bakeInWorker({
        jobs: jobs.map((job) => (job.kind === 'stair' ? { ...job, args: [withStairDefaults(job.args[0])] } : job)),
        keyOf: bakeJobKey,
        createWorker: () => new Worker(new URL('./thermal-bloom-bake.worker.js', import.meta.url), { type: 'module' }),
        // The Stair's sampler cannot cross from the worker: it is rebuilt here (cheap).
        toCached: (job, value) => (job.kind === 'stair' ? withStairGenerator(value) : value),
    });
}
