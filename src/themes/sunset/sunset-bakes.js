/**
 * Sunset's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the sky's
 * and the sea's noise (about 0.33 s of main thread, play-feel probe 2026-10-16) bake in a module
 * Worker while the renderer comes up, and the build finds them in the bake cache.
 */
import {
    SEA_NOISE_SEED, SKY_NOISE_SEED, seaNoiseKey, skyNoiseKey,
} from './sunset-core.js';
import { tierFor } from './sunset-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function sunsetBakeJobs(quality) {
    const tier = tierFor(quality);
    return [
        { kind: 'sky', args: [tier.skyNoise, SKY_NOISE_SEED] },
        { kind: 'sea', args: [tier.seaNoise, SEA_NOISE_SEED] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const sunsetBakeKey = ({ kind, args }) => (kind === 'sky' ? skyNoiseKey(...args) : seaNoiseKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function sunsetBakes(quality) {
    return bakeInWorker({
        jobs: sunsetBakeJobs(quality),
        keyOf: sunsetBakeKey,
        createWorker: () => new Worker(new URL('./sunset-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}
