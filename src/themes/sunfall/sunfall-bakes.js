/**
 * Sunfall's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * lattice, the fBm and the oculus (~60 ms of main thread, up to 90 cold, stalling the outgoing
 * theme and the board in an in-play switch; docs/THEME_FLEET_240_2026-10.md) bake in a module
 * Worker while the authored assets load, and bakeAllSunfallTextures finds them in the bake cache.
 */
import {
    FBM_SIZE, LATTICE_SIZE, OCULUS_TEX, fbmKey, latticeKey, oculusKey,
} from './sunfall-bake-data.js';
import { SUNFALL_SEED } from './sunfall-core.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this seed draws (bakeAllSunfallTextures' own calls), as worker jobs. */
export function sunfallBakeJobs(seed = SUNFALL_SEED >>> 0) {
    return [
        { kind: 'lattice', args: [seed, LATTICE_SIZE] },
        { kind: 'fbm', args: [seed, FBM_SIZE] },
        { kind: 'oculus', args: [seed] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export function sunfallBakeKey({ kind, args }) {
    if (kind === 'lattice') return latticeKey(args[0], args[1]);
    if (kind === 'fbm') return fbmKey(args[0], args[1]);
    return oculusKey(args[0], OCULUS_TEX);
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function sunfallBakes() {
    return bakeInWorker({
        jobs: sunfallBakeJobs(),
        keyOf: sunfallBakeKey,
        createWorker: () => new Worker(
            new URL('./sunfall-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
