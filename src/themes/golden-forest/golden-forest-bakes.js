/**
 * Golden Forest's first-visit CPU bake, off the page's thread (shared/bake-worker-client.js): the
 * lake map (0.12 s of main thread, play-feel probe 2026-10-16) bakes in a module Worker while the
 * renderer and the asset pack come up, and the terrain finds it in the bake cache.
 */
import { LAKE_MAP_HEIGHT, LAKE_MAP_WIDTH, lakeMapKey } from './golden-forest-shape.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const GOLDEN_FOREST_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'lakeMap', args: Object.freeze([LAKE_MAP_WIDTH, LAKE_MAP_HEIGHT]) }),
]);

/** The bake cache key a job's bake keeps its result under. */
export const goldenForestBakeKey = ({ args }) => lakeMapKey(...args);

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function goldenForestBakes() {
    return bakeInWorker({
        jobs: GOLDEN_FOREST_BAKE_JOBS,
        keyOf: goldenForestBakeKey,
        createWorker: () => new Worker(
            new URL('./golden-forest-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
