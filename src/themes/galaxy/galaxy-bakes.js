/**
 * Galaxy's session bakes: the noise field and its mip chain, and the plan.
 *
 * They depend only on their seeds and the tier's star count, and nothing writes to them once baked
 * (a texture and the world's meshes are made over them), so each is baked once a session: ~15 ms
 * of noise, ~5 ms of mips and ~14 ms of plan on every Galaxy start before. A first visit bakes the
 * noise and mips off the page's thread (shared/bake-worker-client.js), in a module Worker while the
 * renderer comes up.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    NOISE_SIZE, bakeNoise, noiseMips,
} from './galaxy-bake-data.js';
import { buildPlan } from './galaxy-plan.js';

/** The seed the world bakes its noise with (bakeNoise's default). */
export const NOISE_SEED = 4242;

const kept = { field: null, mips: new WeakMap(), plans: new Map() };

/** The session's noise field, baked here on the page if still missing. */
export function sessionNoiseField() {
    kept.field ??= bakeNoise(NOISE_SEED, NOISE_SIZE);
    return kept.field;
}

/** The half-float mip chain of a noise field, kept with it. */
export function sessionNoiseMips(field, size = NOISE_SIZE) {
    if (!kept.mips.has(field)) kept.mips.set(field, noiseMips(field, size));
    return kept.mips.get(field);
}

/** The plan for a seed (buildPlan's default when none) and the tier's limits, kept for the session. */
export function sessionPlan(seed, limits = {}) {
    const key = `${seed ?? 'default'}:${JSON.stringify(limits)}`;
    if (!kept.plans.has(key)) kept.plans.set(key, seed === undefined ? buildPlan(undefined, limits) : buildPlan(seed, limits));
    return kept.plans.get(key);
}

/** The bake a world builds from, as a worker job (bakeNoiseData's arguments). */
export function galaxyBakeJobs() {
    return [{ kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] }];
}

/** Whether this session holds the job's bake (a revisit, or the worker's). */
export function hasGalaxyBake() {
    return kept.field !== null && kept.mips.has(kept.field);
}

/** Keep what the bake worker posted (the same code: the page's bake, byte for byte). */
export function keepGalaxyBake(job, value) {
    const { field, mips } = value || {};
    if (!(field instanceof Float32Array) || !Array.isArray(mips) || kept.field !== null) return;
    kept.field = field;
    kept.mips.set(field, mips);
}

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function galaxyBakes() {
    return bakeInWorker({
        jobs: galaxyBakeJobs(),
        keyOf: ({ args }) => `galaxy:noise:${args.join(':')}`,
        isReady: hasGalaxyBake,
        accept: keepGalaxyBake,
        createWorker: () => new Worker(
            new URL('./galaxy-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
