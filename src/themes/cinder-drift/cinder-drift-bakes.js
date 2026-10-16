/**
 * Cinder Drift's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * noise and the crust's plates (about 0.14 s of main thread, play-feel probe 2026-10-16) bake in a
 * module Worker while the renderer comes up, and the build finds them in the bake cache. The plan
 * (91 ms in the world's constructor) bakes there too; its readers are closures a worker cannot
 * post, so it comes as data and waits here for the one world that takes it (takeBakedPlan).
 */
import {
    NOISE_SEED, NOISE_SIZE, PLATE_SEED, PLATE_SIZE, noiseKey, platesKey,
} from './cinder-drift-bake.js';
import { PLATE_CELLS } from './cinder-drift-core.js';
import { PLAN_SEED } from './cinder-drift-layout.js';
import { tierFor } from './cinder-drift-quality.js';
import { isBaked, primeBake } from '../shared/bake-cache.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const CINDER_DRIFT_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'noise', args: Object.freeze([NOISE_SEED, NOISE_SIZE]) }),
    Object.freeze({ kind: 'plates', args: Object.freeze([PLATE_SEED, PLATE_SIZE, PLATE_CELLS]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const cinderDriftBakeKey = ({ kind, args }) => (kind === 'noise' ? noiseKey(...args) : platesKey(...args));

/** Plans a worker baked, by seed and detail, until a world takes them. */
const waiting = new Map();
const planKey = (seed, detail) => `cinder-drift:plan:${seed}:${detail}`;

/** The worker job for the plan a world of this quality builds. */
export const cinderDriftPlanJob = (quality, seed = PLAN_SEED) => ({
    kind: 'plan', args: [seed, tierFor(quality).detail],
});

/** The plan's data a worker baked for this seed and detail, once (null when none waits). */
export function takeBakedPlan(seed, detail) {
    const key = planKey(seed, detail);
    const baked = waiting.get(key) ?? null;
    waiting.delete(key);
    return baked;
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function cinderDriftBakes(quality = 'High') {
    return bakeInWorker({
        jobs: [...CINDER_DRIFT_BAKE_JOBS, cinderDriftPlanJob(quality)],
        keyOf: (job) => (job.kind === 'plan' ? planKey(...job.args) : cinderDriftBakeKey(job)),
        isReady: (job) => (job.kind === 'plan' ? waiting.has(planKey(...job.args)) : isBaked(cinderDriftBakeKey(job))),
        accept: (job, value) => {
            if (job.kind === 'plan') waiting.set(planKey(...job.args), value);
            else primeBake(cinderDriftBakeKey(job), value);
        },
        createWorker: () => new Worker(
            new URL('./cinder-drift-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
