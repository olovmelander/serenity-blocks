/**
 * Void Ember's first-visit CPU bake, off the page's thread (shared/bake-worker-client.js): the
 * crust's plates (bakePlates, a 174 ms task on a session's first Void Ember, stalling the outgoing
 * theme and the board in an in-play switch; docs/THEME_FLEET_240_2026-10.md) bake in a module
 * Worker while the renderer comes up, and createPlatesTexture finds them kept.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { hasPlatesBake, keepPlatesBake } from './void-ember-tsl.js';

/** The bakes a world builds from (the same at every quality), as worker jobs: bakePlates' defaults. */
export const VOID_EMBER_BAKE_JOBS = Object.freeze([Object.freeze({ kind: 'plates', args: Object.freeze([]) })]);

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function voidEmberBakes() {
    return bakeInWorker({
        jobs: VOID_EMBER_BAKE_JOBS,
        keyOf: ({ kind }) => `void-ember:${kind}`,
        isReady: () => hasPlatesBake(),
        accept: (job, value) => keepPlatesBake(value),
        createWorker: () => new Worker(
            new URL('./void-ember-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
