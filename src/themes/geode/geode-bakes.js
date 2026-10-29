/**
 * Geode's session bakes: the noise field and its mip chain, the plan over it, and the shell's
 * vertices.
 *
 * They depend only on their seeds and the tier's plan options, and nothing writes to them once
 * baked (a texture, the crystals and a mesh are made over them), so each is baked once a session:
 * ~55 ms of main thread on every Geode start before. A first visit bakes the noise, its mips and
 * the shell off the page's thread (shared/bake-worker-client.js), in a module Worker while the
 * renderer comes up; the plan is rebuilt here over the posted field (it carries functions).
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    NOISE_SEED, NOISE_SIZE, bakeNoise, noiseMips, planOver, shellArrays,
} from './geode-bake-data.js';
import { tierFor } from './geode-quality.js';

const kept = {
    field: null, mips: new WeakMap(), plans: new Map(), shells: new Map(),
};
/** The plan each session plan was kept under (its shell is kept under the same key). */
const planKeys = new WeakMap();

/** A plan's options as a key: the seed (buildPlan's default when none) and the tier's counts. */
export function planKey({
    seed, crownPerRing, druzy, stars,
}) {
    return `${seed ?? 'default'}:${crownPerRing}:${druzy}:${stars}`;
}

/** The plan options a world of this tier builds (geode-world.js). */
export function planOptionsFor(tier, seed) {
    return {
        seed, crownPerRing: tier.crownPerRing, druzy: tier.druzy, stars: tier.stars,
    };
}

/** The session's noise field, baked here on the page if still missing. */
export function sessionNoiseField() {
    kept.field ??= bakeNoise(NOISE_SEED, NOISE_SIZE);
    return kept.field;
}

/** The mip chain of a noise field, kept with it. */
export function sessionNoiseMips(field, size = NOISE_SIZE) {
    if (!kept.mips.has(field)) kept.mips.set(field, noiseMips(field, size));
    return kept.mips.get(field);
}

/** The plan over the session's field for these options, kept for the session. */
export function sessionPlan(field, options) {
    if (field !== kept.field) return planOver(field, options);
    const key = planKey(options);
    if (!kept.plans.has(key)) {
        const plan = planOver(field, options);
        kept.plans.set(key, plan);
        planKeys.set(plan, key);
    }
    return kept.plans.get(key);
}

/** The shell's arrays over a plan: kept for a session plan, built afresh for any other. */
export function sessionShellArrays(plan) {
    const key = planKeys.get(plan);
    if (key === undefined) return shellArrays(plan);
    if (!kept.shells.has(key)) kept.shells.set(key, shellArrays(plan));
    return kept.shells.get(key);
}

/** The bakes a world of this quality builds from, as worker jobs (bakeGeodeData's argument). */
export function geodeBakeJobs(quality) {
    return [{ kind: 'geode', args: [planOptionsFor(tierFor(quality))] }];
}

/** Whether this session holds a job's bakes (a revisit, or the worker's). */
export function hasGeodeBakes({ args }) {
    return kept.field !== null && kept.mips.has(kept.field) && kept.shells.has(planKey(args[0]));
}

/**
 * Keep what the bake worker posted. The worker runs the same code, so its bakes are the page's,
 * byte for byte; a field already kept wins (the shell and mips were made over an equal one).
 */
export function keepGeodeBakes({ args }, value) {
    const { field, mips, shell } = value || {};
    if (!(field instanceof Float32Array) || !Array.isArray(mips) || !(shell?.positions instanceof Float32Array)) return;
    if (kept.field === null) {
        kept.field = field;
        kept.mips.set(field, mips);
    }
    const key = planKey(args[0]);
    if (!kept.shells.has(key)) kept.shells.set(key, shell);
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function geodeBakes(quality) {
    return bakeInWorker({
        jobs: geodeBakeJobs(quality),
        keyOf: ({ args }) => `geode:${planKey(args[0])}`,
        isReady: hasGeodeBakes,
        accept: keepGeodeBakes,
        createWorker: () => new Worker(
            new URL('./geode-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
