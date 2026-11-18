/**
 * Cosmic Noir's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * smoke volume, the sea's field and the foam's lace bake in a module Worker while the renderer comes up, and the
 * build finds them in the bake cache.
 */
import {
    LACE_SEED, LACE_SIZE, SEA_SEED, SMOKE_SEED, foamLaceKey, seaFieldKey, smokeNoiseKey,
} from './cosmic-noir-bake.js';
import { ROCK_SEED, rockFieldKey } from './cosmic-noir-rock.js';
import { tierFor } from './cosmic-noir-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function cosmicNoirBakeJobs(quality) {
    const tier = tierFor(quality);
    return [
        { kind: 'smoke', args: [SMOKE_SEED, tier.noise] },
        { kind: 'sea', args: [SEA_SEED, tier.sea] },
        { kind: 'lace', args: [LACE_SEED, LACE_SIZE] },
        { kind: 'rock', args: [ROCK_SEED, tier.rock] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
const KEY_OF = {
    sea: seaFieldKey, lace: foamLaceKey, rock: rockFieldKey, smoke: smokeNoiseKey,
};
export const cosmicNoirBakeKey = ({ kind, args }) => (KEY_OF[kind] || smokeNoiseKey)(...args);

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
