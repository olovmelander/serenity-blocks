/**
 * Sunset — the lantern sea: numbers, the sea's shape, the paths of the sun and the moon, and
 * the noise the sky and the water are drawn with (CPU only, three-free).
 *
 * Everything that has to agree between the renderer, the event aiming and the tests lives here.
 *
 * World: metres, y up, the still sea at y = 0. The eye floats a little above the water and looks
 * WEST, toward −z; +x is to its right (north). The sun and the moon both go down into the sea in
 * front of it.
 */

import { bakeOnce } from '../shared/bake-cache.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two DISTINCT edges (either order). */
export function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent easing factor: `value += (target - value) * approach(rate, dt)`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour (a CSS hex string) as scene-linear light, its brightest channel at 1 so that
 * every lantern burns equally bright. Anything else (and a colour with no light in it) gives
 * candle gold.
 */
export function pieceLight(color, out = [1, 0.72, 0.36]) {
    const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
    const r = hex ? srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255) : 0;
    const g = hex ? srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255) : 0;
    const b = hex ? srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255) : 0;
    const peak = Math.max(r, g, b);
    if (peak < 0.01) {
        out[0] = 1;
        out[1] = 0.72;
        out[2] = 0.36;
        return out;
    }
    out[0] = r / peak;
    out[1] = g / peak;
    out[2] = b / peak;
    return out;
}

// ── The sea ─────────────────────────────────────────────────────────────────────────────────

/** Where the eye floats: metres above the still water. */
export const EYE_HEIGHT = 3.2;

/** Gravity, and how fast the sea's clock runs against the world's (a little slow: it is calm). */
export const GRAVITY = 9.81;
export const SEA_TIME = 0.82;

/**
 * The swell: trains of waves coming in from the west toward the eye, each a little off the line.
 *   length     crest to crest, metres
 *   height     amplitude, metres
 *   bearing    degrees off the line toward the eye (+z); positive leans toward +x
 * Their speeds follow from their lengths (deep water: c = √(g·L / 2π)), so long waves overtake
 * short ones as they do at sea. The steepness of every train is about the same (height · k ≈
 * 0.024): the sea is calm, and no train breaks.
 */
export const SWELL = Object.freeze([
    Object.freeze({ length: 62, height: 0.22, bearing: 8 }),
    Object.freeze({ length: 41, height: 0.16, bearing: -14 }),
    Object.freeze({ length: 27, height: 0.1, bearing: 21 }),
    Object.freeze({ length: 17, height: 0.065, bearing: -6 }),
    Object.freeze({ length: 11, height: 0.042, bearing: -31 }),
    Object.freeze({ length: 7.3, height: 0.028, bearing: 33 }),
    Object.freeze({ length: 4.6, height: 0.018, bearing: 12 }),
    Object.freeze({ length: 2.9, height: 0.011, bearing: -22 }),
]);

/** How far a crest is drawn forward over its trough (Gerstner): 0 a sine, 1 a cusp. */
export const SWELL_CHOP = 0.72;

/**
 * Each train as the numbers the shaders and the CPU both use:
 * [dirX, dirZ, k (rad/m), omega (rad/s of the sea's clock), height, phase].
 */
export const SWELL_ROWS = Object.freeze(SWELL.map((train, i) => {
    const k = TAU / train.length;
    const a = train.bearing * DEG;
    return Object.freeze([Math.sin(a), Math.cos(a), k, Math.sqrt(GRAVITY * k), train.height, i * 1.7]);
}));

/** The slope variance all the trains carry together (what is left when none is resolved). */
export const SWELL_VARIANCE = SWELL_ROWS.reduce((sum, row) => sum + 0.5 * (row[4] * row[2]) ** 2, 0);

/**
 * The height of the swell over a point of the still sea at `time` (the world's clock). The
 * crests' forward lean is left out: a float rides within a hand of where this puts it.
 */
export function seaHeight(x, z, time) {
    const t = time * SEA_TIME;
    let y = 0;
    for (let i = 0; i < SWELL_ROWS.length; i += 1) {
        const row = SWELL_ROWS[i];
        y += row[4] * Math.sin(row[2] * (row[0] * x + row[1] * z) - row[3] * t + row[5]);
    }
    return y;
}

/** The swell's slope there: d(height)/dx and d(height)/dz. */
export function seaSlope(x, z, time, out = { x: 0, z: 0 }) {
    const t = time * SEA_TIME;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < SWELL_ROWS.length; i += 1) {
        const row = SWELL_ROWS[i];
        const c = row[4] * row[2] * Math.cos(row[2] * (row[0] * x + row[1] * z) - row[3] * t + row[5]);
        sx += c * row[0];
        sz += c * row[1];
    }
    out.x = sx;
    out.z = sz;
    return out;
}

/** The sea's mesh: a fan of rings round the eye's foot, each ring `ratio` times the last. */
export const SEA_FAN = Object.freeze({
    /** The nearest ring and the farthest, metres from the eye's foot. */
    near: 1.4,
    far: 9000,
    /** The fan opens this far to each side of the line (degrees). */
    halfAngle: 82,
});

/** The radius of ring `i` of `rings` (0 the nearest). */
export function ringRadius(i, rings) {
    return SEA_FAN.near * (SEA_FAN.far / SEA_FAN.near) ** (i / Math.max(1, rings - 1));
}

// ── The sun and the moon ────────────────────────────────────────────────────────────────────

/**
 * The unit direction to a body `az` degrees right of the line the eye looks down and `el`
 * degrees over the sea (negative: under it). Where the bodies run is sunset-hours.js (arcAt).
 */
export function azElDirection(az, el, out = { x: 0, y: 0, z: -1 }) {
    const a = az * DEG;
    const e = el * DEG;
    const flat = Math.cos(e);
    out.x = Math.sin(a) * flat;
    out.y = Math.sin(e);
    out.z = -Math.cos(a) * flat;
    return out;
}

/** How squashed a disc is by the air it is seen through: 1 high up, flatter on the horizon. */
export function discSquash(height) {
    return lerp(0.84, 1, smooth(0, 7, height));
}

// ── Noise ───────────────────────────────────────────────────────────────────────────────────

/** A tileable value-noise fBm field, 0..1 (mean 0.5). */
function fbmField(size, rand, baseCells, octaves, gain = 0.55) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
        const cells = baseCells * 2 ** o;
        if (cells > size / 2) break;
        const lattice = new Float32Array(cells * cells);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
        const step = cells / size;
        for (let j = 0; j < size; j += 1) {
            const y = j * step;
            const y0 = Math.floor(y);
            const fy = y - y0;
            const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
            const j0 = (y0 % cells) * cells;
            const j1 = ((y0 + 1) % cells) * cells;
            const rowAt = j * size;
            for (let i = 0; i < size; i += 1) {
                const x = i * step;
                const x0 = Math.floor(x);
                const fx = x - x0;
                const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
                const i0 = x0 % cells;
                const i1 = (i0 + 1) % cells;
                const p = lattice[j0 + i0];
                const q = lattice[j0 + i1];
                const s = lattice[j1 + i0];
                const w = lattice[j1 + i1];
                out[rowAt + i] += (p + (q - p) * sx + (s - p) * sy + (p - q - s + w) * sx * sy) * amp;
            }
        }
        total += amp;
        amp *= gain;
    }
    for (let i = 0; i < out.length; i += 1) out[i] /= total;
    return out;
}

/**
 * A tileable field of rounded cells, 0..1: 1 at a cell's heart, 0 on the seams between cells
 * (one octave of inverted Worley distance). Cumulus is made of these.
 */
function cellField(size, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = rand();
        py[i] = rand();
    }
    const out = new Float32Array(size * size);
    const step = cells / size;
    for (let j = 0; j < size; j += 1) {
        const y = j * step;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = i * step;
            const cx = Math.floor(x);
            let best = 9;
            for (let oy = -1; oy <= 1; oy += 1) {
                const gy = cy + oy;
                const wy = ((gy % cells) + cells) % cells;
                for (let ox = -1; ox <= 1; ox += 1) {
                    const gx = cx + ox;
                    const at = wy * cells + (((gx % cells) + cells) % cells);
                    const dx = gx + px[at] - x;
                    const dy = gy + py[at] - y;
                    const d = dx * dx + dy * dy;
                    if (d < best) best = d;
                }
            }
            out[j * size + i] = 1 - Math.min(1, Math.sqrt(best));
        }
    }
    return out;
}

const toByte = (v) => Math.round(clamp01(v) * 255);

/** The noise bakes' seeds, and the bake cache's keys for them (a first visit bakes them in a worker). */
export const SKY_NOISE_SEED = 20261011;
export const SEA_NOISE_SEED = 20261012;
export const skyNoiseKey = (size, seed = SKY_NOISE_SEED) => `sunset:sky:${size}:${seed}`;
export const seaNoiseKey = (size, seed = SEA_NOISE_SEED) => `sunset:sea:${size}:${seed}`;

/**
 * The sky's noise, as bytes (RGBA8), tileable:
 *   R  broad fBm (the shape of a cloud field)
 *   G  billows: rounded cells at three sizes (cumulus heads, the cells of a mackerel sky)
 *   B  a second, independent fBm (where there is cloud at all; cirrus; the Milky Way's dust)
 *   A  fine fBm (the torn edge of everything)
 */
export function bakeSkyNoise(size = 256, seed = SKY_NOISE_SEED) {
    return bakeOnce(skyNoiseKey(size, seed), () => computeSkyNoise(size, seed));
}

function computeSkyNoise(size, seed) {
    const rand = mulberry32(seed);
    const broad = fbmField(size, rand, 4, 6);
    const second = fbmField(size, rand, 3, 6);
    const fine = fbmField(size, rand, 16, 4, 0.6);
    const c1 = cellField(size, rand, 6);
    const c2 = cellField(size, rand, 13);
    const c3 = cellField(size, rand, 29);
    const data = new Uint8Array(size * size * 4);
    for (let at = 0; at < size * size; at += 1) {
        const billow = c1[at] * 0.56 + c2[at] * 0.29 + c3[at] * 0.15;
        data[at * 4] = toByte((broad[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 1] = toByte(billow * 1.25);
        data[at * 4 + 2] = toByte((second[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 3] = toByte((fine[at] - 0.5) * 2.2 + 0.5);
    }
    return data;
}

/**
 * The water's noise, as bytes (RGBA8), tileable:
 *   R, G  the slope of a five-octave height field (d/du, d/dv around 0.5): one fetch gives a
 *         ripple's slope, and the mip chain averages it correctly;
 *   B     the height itself (foam, the sparks' grain);
 *   A     a second, independent height.
 * `slopeScale` is returned beside the bytes: a byte's full swing, in height per texel.
 */
export function bakeSeaNoise(size = 256, seed = SEA_NOISE_SEED) {
    return bakeOnce(seaNoiseKey(size, seed), () => computeSeaNoise(size, seed));
}

function computeSeaNoise(size, seed) {
    const rand = mulberry32(seed);
    const h = fbmField(size, rand, 4, 5);
    const h2 = fbmField(size, rand, 5, 4);
    const data = new Uint8Array(size * size * 4);
    const wrap = (n) => (n + size) % size;
    let peak = 1e-6;
    const gx = new Float32Array(size * size);
    const gy = new Float32Array(size * size);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            const at = j * size + i;
            gx[at] = (h[j * size + wrap(i + 1)] - h[j * size + wrap(i - 1)]) * 0.5;
            gy[at] = (h[wrap(j + 1) * size + i] - h[wrap(j - 1) * size + i]) * 0.5;
            peak = Math.max(peak, Math.abs(gx[at]), Math.abs(gy[at]));
        }
    }
    let sum = 0;
    for (let at = 0; at < size * size; at += 1) {
        const sx = gx[at] / peak;
        const sy = gy[at] / peak;
        sum += sx * sx + sy * sy;
        data[at * 4] = toByte(sx * 0.5 + 0.5);
        data[at * 4 + 1] = toByte(sy * 0.5 + 0.5);
        data[at * 4 + 2] = toByte((h[at] - 0.5) * 2.1 + 0.5);
        data[at * 4 + 3] = toByte((h2[at] - 0.5) * 2.1 + 0.5);
    }
    return { data, variance: sum / (size * size) };
}
