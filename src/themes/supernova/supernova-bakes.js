/**
 * Supernova's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the 3D
 * noise (0.13 s of main thread, play-feel probe 2026-10-16) and the photosphere's convection cells
 * (0.1 s) bake in a module Worker while the renderer comes up, and the build finds them in the
 * bake cache.
 */
import {
    CELLS3_SIZE, NOISE3_SEED, NOISE3_SIZE, cells3Key, noise3Key,
} from './supernova-bake.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const SUPERNOVA_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'noise3', args: Object.freeze([NOISE3_SEED, NOISE3_SIZE]) }),
    Object.freeze({ kind: 'cells3', args: Object.freeze([NOISE3_SEED, CELLS3_SIZE]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const supernovaBakeKey = ({ kind, args }) => (kind === 'cells3' ? cells3Key(...args) : noise3Key(...args));

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
