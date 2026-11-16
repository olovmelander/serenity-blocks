/**
 * Waves' session bakes: the water's noise field and its field of foam cells (waves-core.js's
 * bakeWaterNoise and bakeFoamLace).
 *
 * Each depends only on its size and seed, and nothing writes to it once baked (a texture is made
 * over it), so it is baked once a session: ~58 ms of main thread for the noise on every Waves
 * start before (docs/THEME_FLEET_240_2026-10.md). A first visit bakes them off the page's thread
 * (shared/bake-worker-client.js), in a module Worker while the renderer comes up.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { bakeFoamLace, bakeWaterNoise } from './waves-core.js';
import { tierFor } from './waves-quality.js';

const BAKES = Object.freeze({ water: bakeWaterNoise, foam: bakeFoamLace });
const kept = new Map();
const keyOf = ({ kind, args }) => `${kind}:${args[0]}`;

function session(kind, size) {
    const key = keyOf({ kind, args: [size] });
    if (!kept.has(key)) kept.set(key, BAKES[kind](size));
    return kept.get(key);
}

/** The water's noise field for a size, baked here on the page if still missing. */
export function sessionWaterNoise(size) {
    return session('water', size);
}

/** The field of foam cells for a size, baked here on the page if still missing. */
export function sessionFoamLace(size) {
    return session('foam', size);
}

/** The bakes a world of this quality builds from, as worker jobs (each bake's arguments). */
export function wavesBakeJobs(quality) {
    const tier = tierFor(quality);
    return [{ kind: 'water', args: [tier.noise] }, { kind: 'foam', args: [tier.lace] }];
}

/** Whether this session holds the job's bake (a revisit, or the worker's). */
export function hasWavesBake(job) {
    return kept.has(keyOf(job));
}

/** Keep what the bake worker posted (the same code: the page's bake, byte for byte). */
export function keepWavesBake(job, value) {
    const [size] = job.args;
    if (!(job.kind in BAKES)) return;
    if (value instanceof Uint8Array && value.length === size * size * 4 && !hasWavesBake(job)) {
        kept.set(keyOf(job), value);
    }
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function wavesBakes(quality) {
    return bakeInWorker({
        jobs: wavesBakeJobs(quality),
        keyOf: (job) => `waves:${keyOf(job)}`,
        isReady: hasWavesBake,
        accept: keepWavesBake,
        createWorker: () => new Worker(
            new URL('./waves-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
