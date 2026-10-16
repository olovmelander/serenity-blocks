/**
 * Bioluminescence's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * noise and the grotto's plan (0.14 s of main thread in the world's constructor, play-feel probe
 * 2026-10-16) bake in a module Worker while the renderer comes up. The plan holds closures a worker
 * cannot post, so it comes as data and waits here for the one world that takes it (takeBakedPlan),
 * which makes its readers; a world with nothing waiting bakes as before.
 */
import { PLAN_SEED } from './bioluminescence-layout.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** Plans a worker baked, by seed, until a world takes them. */
const waiting = new Map();

/** The worker job for a plan. */
export const bioluminescencePlanJob = (seed = PLAN_SEED) => ({ kind: 'plan', args: [seed] });

/** Start a first visit's bake; resolves when the plan is waiting (never rejects). */
export function bioluminescenceBakes(seed = PLAN_SEED) {
    return bakeInWorker({
        jobs: [bioluminescencePlanJob(seed)],
        keyOf: ({ args }) => `bioluminescence:plan:${args[0]}`,
        isReady: ({ args }) => waiting.has(args[0]),
        accept: ({ args }, value) => waiting.set(args[0], value),
        createWorker: () => new Worker(
            new URL('./bioluminescence-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}

/** The noise and the plan's data a worker baked for this seed, once (null when none waits). */
export function takeBakedPlan(seed = PLAN_SEED) {
    const baked = waiting.get(seed) ?? null;
    waiting.delete(seed);
    return baked;
}
