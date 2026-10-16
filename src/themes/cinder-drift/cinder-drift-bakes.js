/**
 * Cinder Drift's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * noise and the crust's plates (about 0.14 s of main thread, play-feel probe 2026-10-16) bake in a
 * module Worker while the renderer comes up, and the build finds them in the bake cache.
 */
import {
    NOISE_SEED, NOISE_SIZE, PLATE_SEED, PLATE_SIZE, noiseKey, platesKey,
} from './cinder-drift-bake.js';
import { PLATE_CELLS } from './cinder-drift-core.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const CINDER_DRIFT_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'noise', args: Object.freeze([NOISE_SEED, NOISE_SIZE]) }),
    Object.freeze({ kind: 'plates', args: Object.freeze([PLATE_SEED, PLATE_SIZE, PLATE_CELLS]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const cinderDriftBakeKey = ({ kind, args }) => (kind === 'noise' ? noiseKey(...args) : platesKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function cinderDriftBakes() {
    return bakeInWorker({
        jobs: CINDER_DRIFT_BAKE_JOBS,
        keyOf: cinderDriftBakeKey,
        createWorker: () => new Worker(
            new URL('./cinder-drift-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
