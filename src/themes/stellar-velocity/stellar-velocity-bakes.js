/**
 * Stellar Velocity's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js):
 * the canyon's cloud volume and the fBm field bake in a module Worker while the renderer comes up
 * (the canyon alone held the main thread about 0.3 s, play-feel probe 2026-10-15), and the build
 * finds them in the bake cache.
 */
import {
    CANYON_SEED, FBM_SEED, FBM_SIZE, canyonNoiseKey, fbmKey,
} from './stellar-velocity-bake.js';
import { tierFor } from './stellar-velocity-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function stellarVelocityBakeJobs(quality) {
    return [
        { kind: 'canyon', args: [CANYON_SEED, tierFor(quality).noise] },
        { kind: 'fbm', args: [FBM_SEED, FBM_SIZE] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const stellarVelocityBakeKey = ({ kind, args }) => (
    kind === 'canyon' ? canyonNoiseKey(...args) : fbmKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function stellarVelocityBakes(quality) {
    return bakeInWorker({
        jobs: stellarVelocityBakeJobs(quality),
        keyOf: stellarVelocityBakeKey,
        createWorker: () => new Worker(
            new URL('./stellar-velocity-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
