/**
 * Stellar Drift's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * lattice, the clouds' fBm (43 ms alone at 512 px), the rings' profile and the bands' metadata
 * (~60 ms of main thread on a session's first Stellar Drift at High, stalling the outgoing theme
 * and the board in an in-play switch; docs/THEME_FLEET_240_2026-10.md) bake in a module Worker
 * while the renderer comes up, and the build finds them in the bake cache under their own keys.
 */
import {
    LATTICE_SIZE, WORLD_SEED, bandsKey, fbmKey, latticeKey, ringKey,
} from './stellar-drift-bake.js';
import { tierFor } from './stellar-drift-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

const KEYS = {
    lattice: latticeKey, fbm: fbmKey, ring: ringKey, bands: bandsKey,
};

/** The bakes a world of this quality builds from (the world's own calls, argument for argument). */
export function stellarDriftBakeJobs(quality, seed = WORLD_SEED) {
    const tier = tierFor(quality);
    return [
        { kind: 'lattice', args: [seed + 11, LATTICE_SIZE] },
        { kind: 'fbm', args: [seed + 23, tier.fbmSize, tier.fbmOctaves] },
        { kind: 'ring', args: [tier.ringSize, seed + 37] },
        { kind: 'bands', args: [512, seed + 41] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const stellarDriftBakeKey = ({ kind, args }) => KEYS[kind](...args);

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function stellarDriftBakes(quality) {
    return bakeInWorker({
        jobs: stellarDriftBakeJobs(quality),
        keyOf: stellarDriftBakeKey,
        createWorker: () => new Worker(
            new URL('./stellar-drift-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
