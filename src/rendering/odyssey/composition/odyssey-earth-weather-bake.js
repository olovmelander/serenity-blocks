// @ts-check
/**
 * @fileoverview THE EARTH'S GRAIN (2026-11-17, the Odyssey masterpiece pass): the tileable noise
 * the round Earth (odyssey-orbit-earth.js) reads its clouds, its storm cells and its towns from.
 *
 * The planet's weather used to be octaves of the baked value-noise lattice: soft blobs that the
 * texture unit blends in 1/256 steps, so from orbit the cloud cover read as smears. Clouds are
 * not blobs: cumulus billow, decks break into cells with clear lanes between them, towns sit at
 * the knots of a web of roads. This field carries those shapes, three-free and seeded, so a test
 * can read what the shader reads:
 *
 *   R  billow: gradient fBm pushed up by an inverted cell fBm (the cauliflower of cumulus);
 *   G  cells: the distance to the nearest cell point (0 at a point, 1 at the farthest corner);
 *   B  lanes: the gap between the nearest and the second nearest point (0 on a cell's edge):
 *      the clear lanes of a broken deck, and the roads between towns;
 *   A  drift: plain gradient fBm, decorrelated from R (coverage, warps, cirrus fibres).
 *
 * Every channel tiles in both axes and is stretched to [0, 1].
 */

export const EARTH_WEATHER_NOISE = Object.freeze({
    size: 256,
    seed: 90210,
    /** Cell points per tile side for G and B. */
    cells: 16,
    /** The billow's cell octaves (points per tile side) and their weights. */
    billowCells: Object.freeze([[8, 0.6], [16, 0.27], [32, 0.13]]),
});

const TAU = Math.PI * 2;

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Periodic gradient fBm over an n x n tile (octave periods `first` x 2^o), stretched to [0, 1]. */
function gradientFbm(n, rand, octaves, first) {
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * ((v * ((v * 6) - 15)) + 10);
    let amp = 1;
    for (let o = 0; o < octaves; o += 1) {
        const period = first << o;
        const gx = new Float32Array(period * period);
        const gy = new Float32Array(period * period);
        for (let i = 0; i < gx.length; i += 1) {
            const a = rand() * TAU;
            gx[i] = Math.cos(a);
            gy[i] = Math.sin(a);
        }
        const scale = period / n;
        for (let y = 0; y < n; y += 1) {
            const fy = y * scale;
            const y0 = Math.floor(fy);
            const ty = fy - y0;
            const y1 = (y0 + 1) % period;
            const sy = fade(ty);
            for (let x = 0; x < n; x += 1) {
                const fx = x * scale;
                const x0 = Math.floor(fx);
                const tx = fx - x0;
                const x1 = (x0 + 1) % period;
                const sx = fade(tx);
                const i00 = (y0 * period) + x0;
                const i10 = (y0 * period) + x1;
                const i01 = (y1 * period) + x0;
                const i11 = (y1 * period) + x1;
                const d00 = (gx[i00] * tx) + (gy[i00] * ty);
                const d10 = (gx[i10] * (tx - 1)) + (gy[i10] * ty);
                const d01 = (gx[i01] * tx) + (gy[i01] * (ty - 1));
                const d11 = (gx[i11] * (tx - 1)) + (gy[i11] * (ty - 1));
                const top = d00 + ((d10 - d00) * sx);
                const bottom = d01 + ((d11 - d01) * sx);
                field[(y * n) + x] += (top + ((bottom - top) * sy)) * amp;
            }
        }
        amp *= 0.5;
    }
    return stretch(field);
}

function stretch(field) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < field.length; i += 1) {
        if (field[i] < lo) lo = field[i];
        if (field[i] > hi) hi = field[i];
    }
    const inv = 1 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < field.length; i += 1) field[i] = (field[i] - lo) * inv;
    return field;
}

/**
 * Periodic cell noise over an n x n tile with `cells` points a side: the distance to the nearest
 * point and to the second nearest, in cell widths.
 * @returns {{ f1: Float32Array, f2: Float32Array }}
 */
function cellDistances(n, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = 0.12 + (rand() * 0.76);
        py[i] = 0.12 + (rand() * 0.76);
    }
    const f1 = new Float32Array(n * n);
    const f2 = new Float32Array(n * n);
    const scale = cells / n;
    for (let y = 0; y < n; y += 1) {
        const cy = (y + 0.5) * scale;
        const iy = Math.floor(cy);
        for (let x = 0; x < n; x += 1) {
            const cx = (x + 0.5) * scale;
            const ix = Math.floor(cx);
            let a = 9;
            let b = 9;
            for (let dy = -1; dy <= 1; dy += 1) {
                const jy = iy + dy;
                const wy = ((jy % cells) + cells) % cells;
                for (let dx = -1; dx <= 1; dx += 1) {
                    const jx = ix + dx;
                    const k = (wy * cells) + (((jx % cells) + cells) % cells);
                    const ex = (jx + px[k]) - cx;
                    const ey = (jy + py[k]) - cy;
                    const d = (ex * ex) + (ey * ey);
                    if (d < a) {
                        b = a;
                        a = d;
                    } else if (d < b) {
                        b = d;
                    }
                }
            }
            const i = (y * n) + x;
            f1[i] = Math.sqrt(a);
            f2[i] = Math.sqrt(b);
        }
    }
    return { f1, f2 };
}

/**
 * The field (size x size x 4, floats in [0, 1]; R billow, G cells, B lanes, A drift).
 * @param {{ size: number, seed: number, cells: number, billowCells: readonly (readonly number[])[] }} [spec]
 * @returns {Float32Array}
 */
export function bakeEarthWeatherNoise(spec = EARTH_WEATHER_NOISE) {
    const n = spec.size;
    const rand = mulberry32(spec.seed);
    const out = new Float32Array(n * n * 4);
    // R: the gradient fBm, lifted by the inverted cells where a cell point is near.
    const perlin = gradientFbm(n, rand, 5, 4);
    const puff = new Float32Array(n * n);
    spec.billowCells.forEach(([cells, weight]) => {
        const { f1 } = cellDistances(n, rand, cells);
        for (let i = 0; i < puff.length; i += 1) puff[i] += Math.max(0, 1 - (f1[i] * 1.25)) * weight;
    });
    const billow = new Float32Array(n * n);
    for (let i = 0; i < billow.length; i += 1) billow[i] = puff[i] + (perlin[i] * (1 - puff[i]));
    stretch(billow);
    // G and B: one set of cell points for both, so a lane always runs between two cells.
    const { f1, f2 } = cellDistances(n, rand, spec.cells);
    const lanes = new Float32Array(n * n);
    for (let i = 0; i < lanes.length; i += 1) lanes[i] = f2[i] - f1[i];
    stretch(f1);
    stretch(lanes);
    // A: a second, decorrelated fBm.
    const drift = gradientFbm(n, rand, 5, 4);
    for (let i = 0; i < billow.length; i += 1) {
        out[i * 4] = billow[i];
        out[(i * 4) + 1] = f1[i];
        out[(i * 4) + 2] = lanes[i];
        out[(i * 4) + 3] = drift[i];
    }
    return out;
}

let cached = null;

/** The default field, baked once a session (the board is rebuilt; the grain never changes). */
export function getEarthWeatherNoise() {
    if (!cached) cached = bakeEarthWeatherNoise();
    return cached;
}

/**
 * The field at a tile coordinate (u, v in tiles, any real), bilinear, as the texture unit reads its
 * top level: for tests and CPU twins.
 * @param {number} u
 * @param {number} v
 * @param {number} channel 0..3
 * @returns {number}
 */
export function earthWeatherNoiseAt(u, v, channel) {
    const n = EARTH_WEATHER_NOISE.size;
    const data = getEarthWeatherNoise();
    const x = (u * n) - 0.5;
    const y = (v * n) - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (ix, iy) => data[((((iy % n) + n) % n) * n * 4) + ((((ix % n) + n) % n) * 4) + channel];
    const top = at(x0, y0) + ((at(x0 + 1, y0) - at(x0, y0)) * fx);
    const bottom = at(x0, y0 + 1) + ((at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx);
    return top + ((bottom - top) * fy);
}
