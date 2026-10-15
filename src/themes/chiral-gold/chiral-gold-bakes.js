/**
 * Chiral Gold's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * studio the gold reflects and the tileable noise (about 0.1 s of main thread at High, play-feel
 * probe 2026-10-15) bake in a module Worker while the renderer comes up, and the build finds them
 * in the bake cache.
 */
import {
    NOISE_SEED, NOISE_SIZE, STUDIO_SEED, noiseKey, studioKey,
} from './chiral-gold-bake.js';
import { tierFor } from './chiral-gold-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function chiralGoldBakeJobs(quality) {
    return [
        { kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] },
        { kind: 'studio', args: [tierFor(quality).studio, STUDIO_SEED] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const chiralGoldBakeKey = ({ kind, args }) => (kind === 'noise' ? noiseKey(...args) : studioKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function chiralGoldBakes(quality) {
    return bakeInWorker({
        jobs: chiralGoldBakeJobs(quality),
        keyOf: chiralGoldBakeKey,
        createWorker: () => new Worker(
            new URL('./chiral-gold-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
