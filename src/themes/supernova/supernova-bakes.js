/**
 * Supernova's first-visit CPU bake, off the page's thread (shared/bake-worker-client.js): the 3D
 * noise (0.13 s of main thread, play-feel probe 2026-10-16) bakes in a module Worker while the
 * renderer comes up, and the build finds it in the bake cache.
 */
import { NOISE3_SEED, NOISE3_SIZE, noise3Key } from './supernova-bake.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const SUPERNOVA_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'noise3', args: Object.freeze([NOISE3_SEED, NOISE3_SIZE]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const supernovaBakeKey = ({ args }) => noise3Key(...args);

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function supernovaBakes() {
    return bakeInWorker({
        jobs: SUPERNOVA_BAKE_JOBS,
        keyOf: supernovaBakeKey,
        createWorker: () => new Worker(
            new URL('./supernova-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
