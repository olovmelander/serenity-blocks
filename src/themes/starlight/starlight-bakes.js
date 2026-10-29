/**
 * Starlight's session bakes: the noise and the star catalogue.
 *
 * They depend only on their seeds and the tier's star count, and nothing writes to them once baked
 * (the stars' attributes and the noise texture read them), so they are baked once a session:
 * 85-100 ms of main thread on every Starlight start, a stall of the outgoing theme and the board in
 * an in-play switch (docs/THEME_FLEET_240_2026-10.md). A first visit bakes them off the page's
 * thread (shared/bake-worker-client.js), in a module Worker while the renderer comes up, and the
 * world's build finds them kept.
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { NOISE_SEED, bakeNoise, generateCatalog } from './starlight-core.js';
import { tierFor } from './starlight-quality.js';

const bakes = { noise: null, catalogs: new Map() };

/** The session's noise and the catalogue for `stars`, baked here on the page if still missing. */
export function sessionBakes(stars) {
    bakes.noise ??= bakeNoise(NOISE_SEED);
    if (!bakes.catalogs.has(stars)) bakes.catalogs.set(stars, generateCatalog(stars, bakes.noise));
    return { noise: bakes.noise, catalog: bakes.catalogs.get(stars) };
}

/** Whether this session holds the bakes a sky of `stars` builds from (a revisit, or the worker's). */
export function hasStarlightBakes(stars) {
    return bakes.noise !== null && bakes.catalogs.has(stars);
}

/**
 * Keep what the bake worker posted for `stars` (bakeSkyData's). The worker runs the same code, so
 * its noise and catalogue are the page's, byte for byte.
 */
export function keepStarlightBakes(stars, { noise, catalog } = {}) {
    if (!(noise instanceof Uint8Array) || !(catalog?.polar instanceof Float32Array)) return;
    bakes.noise ??= noise;
    if (!bakes.catalogs.has(stars)) bakes.catalogs.set(stars, catalog);
}

/** The bakes a world of this quality builds from, as worker jobs (bakeSkyData's argument). */
export function starlightBakeJobs(quality) {
    return [{ kind: 'sky', args: [tierFor(quality).stars] }];
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function starlightBakes(quality) {
    return bakeInWorker({
        jobs: starlightBakeJobs(quality),
        keyOf: ({ kind, args }) => `starlight:${kind}:${args[0]}`,
        isReady: ({ args }) => hasStarlightBakes(args[0]),
        accept: ({ args }, value) => keepStarlightBakes(args[0], value),
        createWorker: () => new Worker(
            new URL('./starlight-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
