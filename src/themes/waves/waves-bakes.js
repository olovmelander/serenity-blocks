/**
 * Waves' session bake: the water's noise field (waves-core.js's bakeWaterNoise).
 *
 * It depends only on its size and seed, and nothing writes to it once baked (a texture is made over
 * it), so it is baked once a session: ~58 ms of main thread on every Waves start before
 * (docs/THEME_FLEET_240_2026-10.md). A first visit bakes it off the page's thread
 * (shared/bake-worker-client.js), in a module Worker while the renderer comes up.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { bakeWaterNoise } from './waves-core.js';
import { tierFor } from './waves-quality.js';

const kept = new Map();

/** The water's noise field for a size, baked here on the page if still missing. */
export function sessionWaterNoise(size) {
    if (!kept.has(size)) kept.set(size, bakeWaterNoise(size));
    return kept.get(size);
}

/** The bake a world of this quality builds from, as a worker job (bakeWaterNoise's arguments). */
export function wavesBakeJobs(quality) {
    return [{ kind: 'water', args: [tierFor(quality).noise] }];
}

/** Whether this session holds the job's bake (a revisit, or the worker's). */
export function hasWavesBake({ args }) {
    return kept.has(args[0]);
}

/** Keep what the bake worker posted (the same code: the page's bake, byte for byte). */
export function keepWavesBake({ args }, value) {
    const [size] = args;
    if (value instanceof Uint8Array && value.length === size * size * 4 && !kept.has(size)) kept.set(size, value);
}

/** Start a first visit's bake; resolves when it is kept (never rejects). */
export function wavesBakes(quality) {
    return bakeInWorker({
        jobs: wavesBakeJobs(quality),
        keyOf: ({ args }) => `waves:water:${args[0]}`,
        isReady: hasWavesBake,
        accept: keepWavesBake,
        createWorker: () => new Worker(
            new URL('./waves-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
