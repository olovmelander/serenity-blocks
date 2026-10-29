/**
 * Solar Eclipse's session bakes: the noise and the ranges' crests.
 *
 * They depend on their seeds alone, and nothing writes to them (the textures read them), so they
 * are baked once a session: ~35 ms of main thread on every start before, a stall of the outgoing
 * theme and the board in an in-play switch (docs/THEME_FLEET_240_2026-10.md). A first visit bakes
 * them off the page's thread (shared/bake-worker-client.js), in a module Worker while the renderer
 * comes up, and the world's build finds them kept.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { NOISE_SEED, bakeNoise, bakeRanges } from './solar-eclipse-core.js';

const bakes = { noise: null, ranges: null };

/** The session's noise and ranges, baked here on the page if still missing. */
export function sessionEclipseBakes() {
    bakes.noise ??= bakeNoise(NOISE_SEED);
    bakes.ranges ??= bakeRanges();
    return { noise: bakes.noise, ranges: bakes.ranges };
}

/** Whether this session holds the sky's bakes (a revisit, or the worker's). */
export function hasSolarEclipseBakes() {
    return bakes.noise !== null && bakes.ranges !== null;
}

/**
 * Keep what the bake worker posted (bakeEclipseData's). The worker runs the same code, so its
 * noise and ranges are the page's, byte for byte.
 */
export function keepSolarEclipseBakes({ noise, ranges } = {}) {
    if (noise instanceof Uint8Array) bakes.noise ??= noise;
    if (Array.isArray(ranges?.crests) && Array.isArray(ranges?.slopes)) bakes.ranges ??= ranges;
}

/** The bakes a world builds from (the same at every quality), as worker jobs: bakeEclipseData's. */
export const SOLAR_ECLIPSE_BAKE_JOBS = Object.freeze([Object.freeze({ kind: 'sky', args: Object.freeze([]) })]);

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function solarEclipseBakes() {
    return bakeInWorker({
        jobs: SOLAR_ECLIPSE_BAKE_JOBS,
        keyOf: ({ kind }) => `solar-eclipse:${kind}`,
        isReady: () => hasSolarEclipseBakes(),
        accept: (job, value) => keepSolarEclipseBakes(value),
        createWorker: () => new Worker(
            new URL('./solar-eclipse-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
