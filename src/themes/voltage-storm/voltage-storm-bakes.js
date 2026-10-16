/**
 * Voltage Storm's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * 2D noise and the cloud's 3D noise (about 0.15 s of main thread, play-feel probe 2026-10-16) bake
 * in a module Worker while the renderer comes up, and the build finds them in the bake cache.
 */
import {
    CLOUD_SEED, NOISE_SEED, NOISE_SIZE, cloudKey, noiseKey,
} from './voltage-storm-bake.js';
import { tierFor } from './voltage-storm-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world of this quality builds from, as worker jobs. */
export function voltageStormBakeJobs(quality) {
    return [
        { kind: 'noise', args: [NOISE_SEED, NOISE_SIZE] },
        { kind: 'cloud', args: [CLOUD_SEED, tierFor(quality).noise3d] },
    ];
}

/** The bake cache key a job's bake keeps its result under. */
export const voltageStormBakeKey = ({ kind, args }) => (kind === 'noise' ? noiseKey(...args) : cloudKey(...args));

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function voltageStormBakes(quality) {
    return bakeInWorker({
        jobs: voltageStormBakeJobs(quality),
        keyOf: voltageStormBakeKey,
        createWorker: () => new Worker(
            new URL('./voltage-storm-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
