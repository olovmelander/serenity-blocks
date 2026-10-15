/**
 * A theme's first-visit CPU bakes, off the page's thread.
 *
 * Bakes run inside a world's synchronous build were one long task on the main thread, which froze
 * the theme still playing while the next one built behind it (the play-feel probe, 2026-10-15:
 * 0.5-0.8 s in several themes). A theme lists the bakes its build will ask for as jobs, starts them
 * here before it awaits its renderer, and awaits them before the build: they run in a module Worker
 * and prime the shared bake cache under the keys the bakes themselves use, so the build finds them
 * there. Jobs the cache already holds are skipped (a revisit). Without a Worker (tests, a worker that
 * fails) it resolves at once and the build bakes what it needs, as before.
 */
import { isBaked, primeBake } from './bake-cache.js';

/**
 * @param {object} options
 * @param {Array<{ kind: string, args: Array }>} options.jobs
 * @param {(job: { kind: string, args: Array }) => string} options.keyOf  the bake cache key the
 *   job's bake keeps its result under
 * @param {() => Worker} options.createWorker  `() => new Worker(new URL('./<theme>-bake.worker.js',
 *   import.meta.url), { type: 'module' })`, written in the theme's own module: Vite bundles a worker
 *   from that literal where it stands
 * @param {(job: object, value: any) => any} [options.toCached]  what the bake keeps, from what the
 *   worker posted (a sampler rebuilt on this side, say); the posted value by default
 * @returns {Promise<{ viaWorker: boolean, baked: number, cached: number }>} never rejects
 */
export function bakeInWorker({
    jobs, keyOf, createWorker, toCached = (job, value) => value,
}) {
    const pending = jobs.filter((job) => !isBaked(keyOf(job)));
    const cached = jobs.length - pending.length;
    if (!pending.length || typeof Worker === 'undefined') {
        return Promise.resolve({ viaWorker: false, baked: 0, cached });
    }
    return new Promise((resolve) => {
        let worker = null;
        try {
            worker = createWorker();
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
                primeBake(keyOf(job), toCached(job, value));
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
