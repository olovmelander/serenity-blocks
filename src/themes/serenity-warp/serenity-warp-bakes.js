/**
 * Serenity Warp's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * gas volume and the fBm field bake in a module Worker while the renderer comes up (the gas alone
 * held the main thread about 0.45 s, play-feel probe 2026-10-15), and the build finds them in the
 * bake cache.
 */
import {
    FBM_SEED, FBM_SIZE, GAS_SEED, GAS_SIZE, fbmKey, gasNoiseKey,
} from './serenity-warp-bake.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes the world's build asks for, as worker jobs. */
export const SERENITY_WARP_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'gas', args: Object.freeze([GAS_SEED, GAS_SIZE]) }),
    Object.freeze({ kind: 'fbm', args: Object.freeze([FBM_SEED, FBM_SIZE]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const serenityWarpBakeKey = ({ kind, args }) => (kind === 'gas' ? gasNoiseKey(...args) : fbmKey(...args));

/** Start the first visit's bakes; resolves when they are kept (never rejects). */
export function serenityWarpBakes() {
    return bakeInWorker({
        jobs: SERENITY_WARP_BAKE_JOBS,
        keyOf: serenityWarpBakeKey,
        createWorker: () => new Worker(new URL('./serenity-warp-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}
