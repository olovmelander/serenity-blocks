/**
 * Neon District's first-visit CPU bakes, off the page's thread (shared/bake-worker-client.js): the
 * noise and the glyph atlas (0.11 s of main thread, play-feel probe 2026-10-16) and the tube logos
 * bake in a module Worker while the renderer comes up, and the build finds them in the bake cache.
 */
import { NOISE_SEED, NOISE_SIZE, noiseKey } from './neon-district-bake.js';
import { GLYPH_ATLAS_KEY } from './neon-district-glyphs.js';
import { LOGO_ATLAS_KEY } from './neon-district-logos.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';

/** The bakes a world builds from (the same at every quality), as worker jobs. */
export const NEON_DISTRICT_BAKE_JOBS = Object.freeze([
    Object.freeze({ kind: 'noise', args: Object.freeze([NOISE_SEED, NOISE_SIZE]) }),
    Object.freeze({ kind: 'glyphs', args: Object.freeze([]) }),
    Object.freeze({ kind: 'logos', args: Object.freeze([]) }),
]);

const KEYS = { glyphs: GLYPH_ATLAS_KEY, logos: LOGO_ATLAS_KEY };

/** The bake cache key a job's bake keeps its result under. */
export const neonDistrictBakeKey = ({ kind, args }) => (kind === 'noise' ? noiseKey(...args) : KEYS[kind]);

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function neonDistrictBakes() {
    return bakeInWorker({
        jobs: NEON_DISTRICT_BAKE_JOBS,
        keyOf: neonDistrictBakeKey,
        createWorker: () => new Worker(
            new URL('./neon-district-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
