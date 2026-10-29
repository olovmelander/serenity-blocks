/**
 * Ice Temple's session bakes: the noise texture's mip chain and the architecture's vertices.
 *
 * They depend only on their seeds and the plan, and nothing writes to them once baked (a texture
 * and a mesh are made over them), so each is baked once a session. A first visit bakes them off the
 * page's thread (shared/bake-worker-client.js), in a module Worker while the renderer comes up:
 * ~45 + 30-50 ms that ran as one long task in the world's build, a stall of the outgoing theme and
 * the board in an in-play switch (docs/THEME_FLEET_240_2026-10.md).
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    NOISE_SEED, NOISE_SIZE, architectureArrays, bakeNoiseMips,
} from './ice-temple-bake-data.js';

/** The session key of the plan a world builds when it is given no seed (its planSeed). */
export const DEFAULT_PLAN_KEY = 'default';

const kept = { noise: new Map(), architecture: new Map() };
const noiseKey = (seed, size) => `${seed}:${size}`;

/** The noise's mip chain for a seed and size, baked here on the page if still missing. */
export function sessionNoiseMips(seed = NOISE_SEED, size = NOISE_SIZE) {
    const key = noiseKey(seed, size);
    if (!kept.noise.has(key)) kept.noise.set(key, bakeNoiseMips(seed, size));
    return kept.noise.get(key);
}

/**
 * The architecture's arrays for `plan`, kept under `sessionKey` (the plan's seed; without one,
 * built afresh), baked here on the page if still missing.
 */
export function sessionArchitectureArrays(plan, sessionKey) {
    if (sessionKey === undefined) return architectureArrays(plan);
    if (!kept.architecture.has(sessionKey)) kept.architecture.set(sessionKey, architectureArrays(plan));
    return kept.architecture.get(sessionKey);
}

/** The bakes a world builds from on a start, as worker jobs (ice-temple-bake-data.js's). */
export function iceTempleBakeJobs() {
    return [
        { kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] },
        // buildPlan's default plan, the one a world given no seed builds (DEFAULT_PLAN_KEY).
        { kind: 'architecture', args: [] },
    ];
}

/** Whether this session holds a job's bake (a revisit, or the worker's). */
export function hasIceTempleBake({ kind, args }) {
    if (kind === 'noise') return kept.noise.has(noiseKey(args[0], args[1]));
    return kept.architecture.has(DEFAULT_PLAN_KEY);
}

/**
 * Keep what the bake worker posted for a job. The worker runs the same code, so its bakes are the
 * page's, byte for byte.
 */
export function keepIceTempleBake({ kind, args }, value) {
    if (kind === 'noise') {
        const key = noiseKey(args[0], args[1]);
        const ok = Array.isArray(value) && value.length > 0 && value.every((l) => l?.data instanceof Uint16Array);
        if (ok && !kept.noise.has(key)) kept.noise.set(key, value);
        return;
    }
    const ok = value?.position instanceof Float32Array && value.st instanceof Float32Array
        && Number.isFinite(value.triangles);
    if (ok && !kept.architecture.has(DEFAULT_PLAN_KEY)) kept.architecture.set(DEFAULT_PLAN_KEY, value);
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function iceTempleBakes() {
    return bakeInWorker({
        jobs: iceTempleBakeJobs(),
        keyOf: ({ kind, args }) => `ice-temple:${kind}:${args.join(':')}`,
        isReady: hasIceTempleBake,
        accept: keepIceTempleBake,
        createWorker: () => new Worker(
            new URL('./ice-temple-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
