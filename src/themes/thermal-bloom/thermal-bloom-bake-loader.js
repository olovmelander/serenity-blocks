/**
 * Thermal Bloom's first-visit bakes, off the page's thread.
 *
 * A first visit used to bake the noise, the cells, the vapour volume and the Stair inside
 * `world.build()`: one long task of several hundred milliseconds on the main thread, which froze the
 * theme still playing while this one built behind it. The loader runs those bakes in a module Worker
 * while the renderer comes up and primes the shared bake cache with the results, so the build finds
 * them there. Without a Worker (tests, a worker that fails to start), it resolves at once and the
 * build bakes them itself, as before. A bake already in the cache is not asked for again.
 */
import { isBaked, primeBake } from '../shared/bake-cache.js';
import { THERMAL_BLOOM_BAKE_KEYS, withStairGenerator } from './thermal-bloom-bake.js';

/** The cache key of a job ({ kind, args }), as the bake functions themselves name it. */
export function bakeJobKey({ kind, args }) {
    const key = THERMAL_BLOOM_BAKE_KEYS[kind];
    if (!key) throw new Error(`[ThermalBloom] unknown bake ${kind}`);
    return kind === 'stair' ? key(withStairDefaults(args[0])) : key(...args);
}

/** bakeStair's own defaults, so a job and the bake name the same key. */
function withStairDefaults({
    tiers = 10, rows = 300, columns = 110, layoutSize = 512, seed = 0x57a1,
} = {}) {
    return {
        tiers, rows, columns, layoutSize, seed,
    };
}

/** What a finished job leaves in the cache: the stair bake also gets its sampler back. */
function primeJob(job, value) {
    const key = bakeJobKey(job);
    primeBake(key, job.kind === 'stair' ? withStairGenerator(value) : value);
}

/**
 * Bake the jobs the cache does not hold yet in one Worker, priming the cache as each lands.
 * @param {Array<{ kind: string, args: Array }>} jobs  thermalBloomBakeJobs(quality)
 * @returns {Promise<{ viaWorker: boolean, baked: number, cached: number }>} never rejects
 */
export function prepareThermalBloomBakes(jobs) {
    const pending = jobs
        .map((job) => (job.kind === 'stair' ? { ...job, args: [withStairDefaults(job.args[0])] } : job))
        .filter((job) => !isBaked(bakeJobKey(job)));
    const cached = jobs.length - pending.length;
    if (!pending.length || typeof Worker === 'undefined') {
        return Promise.resolve({ viaWorker: false, baked: 0, cached });
    }
    return new Promise((resolve) => {
        let worker = null;
        try {
            worker = new Worker(new URL('./thermal-bloom-bake.worker.js', import.meta.url), { type: 'module' });
        } catch {
            resolve({ viaWorker: false, baked: 0, cached });
            return;
        }
        let left = pending.length;
        let baked = 0;
        const finish = () => {
            worker.terminate();
            resolve({ viaWorker: true, baked, cached });
        };
        worker.onmessage = (event) => {
            const { id, ok, value } = event?.data || {};
            const job = pending[id];
            if (ok && job) {
                primeJob(job, value);
                baked += 1;
            }
            left -= 1;
            if (left <= 0) finish();
        };
        // A worker that fails leaves the rest to the build, which bakes what is still missing.
        worker.onerror = () => finish();
        pending.forEach((job, id) => worker.postMessage({ id, kind: job.kind, args: job.args }));
    });
}
