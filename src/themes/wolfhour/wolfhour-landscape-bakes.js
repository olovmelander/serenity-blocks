/**
 * Wolfhour's first-visit landscape bakes, off the page's thread (shared/bake-worker-client.js): the
 * four ranges and the granite grain (0.15-0.2 s of main thread, play-feel probe 2026-10-16) bake in
 * a module Worker while the renderer comes up, and the landscape finds them in the bake cache.
 */
import {
    GRANITE_SIZE, LANDSCAPE_SEED, RANGES, graniteKey, landscapeScale, rangeKey,
} from './wolfhour-landscape-bake.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a landscape of this quality builds from, as worker jobs. */
export function wolfhourLandscapeJobs(quality, seed = LANDSCAPE_SEED) {
    const scale = landscapeScale(quality);
    return [
        ...RANGES.map((range, index) => ({ kind: 'range', args: [index, scale, seed] })),
        { kind: 'granite', args: [seed, GRANITE_SIZE] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const wolfhourLandscapeKey = ({ kind, args }) => (kind === 'range' ? rangeKey(...args) : graniteKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function wolfhourLandscapeBakes(quality, seed = LANDSCAPE_SEED) {
    return bakeInWorker({
        jobs: wolfhourLandscapeJobs(quality, seed),
        keyOf: wolfhourLandscapeKey,
        createWorker: () => new Worker(
            new URL('./wolfhour-landscape-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
