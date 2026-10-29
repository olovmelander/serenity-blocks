/**
 * Aurora's session bakes: the shared noise tile, the range grid's points and the shore ice.
 *
 * They depend only on their seeds and the tier's grid, and nothing writes to them once baked (a
 * texture or a mesh is made over them), so each is baked once a session: the noise took ~28 ms on a
 * first visit, the range ~25 ms and the ice ~7 ms on every visit (docs/THEME_FLEET_240_2026-10.md).
 * A first visit bakes them off the page's thread (shared/bake-worker-client.js), in a module Worker
 * while the renderer comes up; the world's build finds them kept. (The range's mesh, its normals,
 * cover and skyline profile, is kept by the landscape itself: shared/session-geometry.js.)
 */
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { bakeAuroraNoise } from './aurora-noise.js';
import { QUALITY_PRESETS } from './aurora-quality.js';
import { bakeShoreIce, rangeGridPositions } from './aurora-terrain.js';

/** The artwork is authored for this seed: the massifs, the saddle and the star field. */
export const AURORA_SEED = 20261005;
export const NOISE_SIZE = 256;
/** The seeds the world hands its noise and its land (aurora-world.js). */
export const noiseSeedOf = (seed) => seed % 65521;
export const landSeedOf = (seed) => seed % 9973;

const kept = { noise: new Map(), grids: new Map(), ice: new Map() };
const gridKey = (columns, rows, seed) => `${columns}x${rows}:${seed}`;

/** The noise tile for a seed, baked here on the page if still missing. */
export function sessionNoise(seed, size = NOISE_SIZE) {
    const key = `${size}:${seed}`;
    if (!kept.noise.has(key)) kept.noise.set(key, bakeAuroraNoise(size, seed));
    return kept.noise.get(key);
}

/** The range grid's points for a tier's grid and a land seed, baked here if still missing. */
export function sessionRangeGrid(columns, rows, seed) {
    const key = gridKey(columns, rows, seed);
    if (!kept.grids.has(key)) kept.grids.set(key, rangeGridPositions(columns, rows, seed));
    return kept.grids.get(key);
}

/** The shore ice for a land seed, baked here if still missing. */
export function sessionShoreIce(seed) {
    if (!kept.ice.has(seed)) kept.ice.set(seed, bakeShoreIce(seed));
    return kept.ice.get(seed);
}

/** The bakes a world of this quality builds from, as worker jobs (aurora-bake.worker.js). */
export function auroraBakeJobs(quality, seed = AURORA_SEED) {
    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    return [
        { kind: 'noise', args: [NOISE_SIZE, noiseSeedOf(seed)] },
        { kind: 'range', args: [preset.terrainColumns, preset.terrainRows, landSeedOf(seed)] },
        { kind: 'ice', args: [landSeedOf(seed)] },
    ];
}

/** Whether this session holds a job's bake (a revisit, or the worker's). */
export function hasAuroraBake({ kind, args }) {
    if (kind === 'noise') return kept.noise.has(`${args[0]}:${args[1]}`);
    if (kind === 'range') return kept.grids.has(gridKey(...args));
    return kept.ice.has(args[0]);
}

/**
 * Keep what the bake worker posted. The worker runs the same code, so its bakes are the page's,
 * byte for byte.
 */
export function keepAuroraBake({ kind, args }, value) {
    if (kind === 'noise') {
        const key = `${args[0]}:${args[1]}`;
        if (ArrayBuffer.isView(value) && !kept.noise.has(key)) kept.noise.set(key, value);
    } else if (kind === 'range') {
        const key = gridKey(...args);
        if (value instanceof Float32Array && value.length === args[0] * args[1] * 3 && !kept.grids.has(key)) {
            kept.grids.set(key, value);
        }
    } else if (value instanceof Uint8Array && !kept.ice.has(args[0])) {
        kept.ice.set(args[0], value);
    }
}

/** Start a first visit's bakes; resolves when they are kept (never rejects). */
export function auroraBakes(quality, seed = AURORA_SEED) {
    return bakeInWorker({
        jobs: auroraBakeJobs(quality, seed),
        keyOf: ({ kind, args }) => `aurora:${kind}:${args.join(':')}`,
        isReady: hasAuroraBake,
        accept: keepAuroraBake,
        createWorker: () => new Worker(
            new URL('./aurora-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}
