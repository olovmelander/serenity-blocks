/**
 * Halcyon Apex's session bakes: the noise field and its mip chain, and the plan.
 *
 * They depend only on their seeds, and nothing writes to them once baked (a texture and the
 * world's meshes are made over them), so each is baked once a session: the plan took ~19 ms of
 * every start, the noise ~21 ms and its mips ~5 ms of a first visit. A first visit bakes the noise
 * and its mips off the page's thread (shared/bake-worker-client.js), in a module Worker while the
 * renderer comes up.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    NOISE_SIZE, bakeNoise, halfMipChain,
} from './halcyon-apex-bake-data.js';
import { buildPlan } from './halcyon-apex-plan.js';

/** The seed the world bakes its noise with (bakeNoise's default). */
export const NOISE_SEED = 4471;

const kept = { field: null, mips: new WeakMap(), plans: new Map() };

/** The session's noise field, baked here on the page if still missing. */
export function sessionNoiseField() {
    kept.field ??= bakeNoise(NOISE_SEED, NOISE_SIZE);
    return kept.field;
}

/** The half-float mip chain of a noise field, kept with it. */
export function sessionNoiseMips(field, size = NOISE_SIZE) {
    if (!kept.mips.has(field)) kept.mips.set(field, halfMipChain(field, size));
    return kept.mips.get(field);
}

/** The plan for a seed (buildPlan's default when none), kept for the session. */
export function sessionPlan(seed) {
    const key = seed ?? 'default';
    if (!kept.plans.has(key)) kept.plans.set(key, seed === undefined ? buildPlan() : buildPlan(seed));
    return kept.plans.get(key);
}

/** The bake a world builds from, as a worker job (bakeNoiseData's arguments). */
export function halcyonApexBakeJobs() {
    return [{ kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] }];
}

/** Whether this session holds the job's bake (a revisit, or the worker's). */
export function hasHalcyonApexBake() {
    return kept.field !== null && kept.mips.has(kept.field);
}

/** Keep what the bake worker posted (the same code: the page's bake, byte for byte). */
export function keepHalcyonApexBake(job, value) {
    const { field, mips } = value || {};
    if (!(field instanceof Float32Array) || !Array.isArray(mips) || kept.field !== null) return;
    kept.field = field;
    kept.mips.set(field, mips);
}

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function halcyonApexBakes() {
    return bakeInWorker({
        jobs: halcyonApexBakeJobs(),
        keyOf: ({ args }) => `halcyon-apex:noise:${args.join(':')}`,
        isReady: hasHalcyonApexBake,
        accept: keepHalcyonApexBake,
        createWorker: () => new Worker(
            new URL('./halcyon-apex-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
