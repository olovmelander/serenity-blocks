/**
 * Cosmic Noir's first-visit CPU bake, off the page's thread (shared/bake-worker-client.js): the
 * smoke volume bakes in a module Worker while the renderer comes up, and the build finds it in the
 * bake cache.
 */
import { SMOKE_SEED, smokeNoiseKey } from './cosmic-noir-bake.js';
import { tierFor } from './cosmic-noir-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function cosmicNoirBakeJobs(quality) {
    return [{ kind: 'smoke', args: [SMOKE_SEED, tierFor(quality).noise] }];
}

/** The bake cache key a job's bake keeps its result under. */
export const cosmicNoirBakeKey = ({ args }) => smokeNoiseKey(...args);

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function cosmicNoirBakes(quality) {
    return bakeInWorker({
        jobs: cosmicNoirBakeJobs(quality),
        keyOf: cosmicNoirBakeKey,
        createWorker: () => new Worker(
            new URL('./cosmic-noir-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
