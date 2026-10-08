/**
 * Koi Pond — the moonwake pond: numbers, shape and noise (CPU only, three-free).
 *
 * Everything that has to agree between the renderer, the koi and the tests lives here: the lie
 * of the pond (where the waterline runs, how deep the water is, how the bank rises), the region
 * the ripple simulation covers, and a small tileable noise field every part samples.
 *
 * World: metres, y up, the water surface at y = 0. The camera stands on the +z side and looks
 * down and away (toward −z), so the far bank runs along the top of the picture and curves toward
 * the viewer at both ends, like the mouth of a cove.
 */

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

/** Shortest signed difference between two angles (radians). */
export function angleDelta(from, to) {
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
}

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

/** A repeatable 0..1 value for an integer pair. */
export function hash2(i, j) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour (a CSS hex string) as scene-linear light, its brightest channel at 1 so
 * that every piece strikes the pond equally hard. Anything else gives moon white.
 */
export function pieceLight(color, out = [0.75, 0.88, 1]) {
    const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
    if (!hex) {
        out[0] = 0.75;
        out[1] = 0.88;
        out[2] = 1;
        return out;
    }
    const r = srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255);
    const g = srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255);
    const b = srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255);
    const peak = Math.max(r, g, b, 1e-4);
    out[0] = r / peak;
    out[1] = g / peak;
    out[2] = b / peak;
    return out;
}

// ── The pond ────────────────────────────────────────────────────────────────────────────────

/**
 * The rectangle of water the ripple simulation covers (and the textures derived from it).
 * Everything the camera can see of the pond lies inside it.
 */
export const POND = Object.freeze({
    minX: -11,
    maxX: 11,
    minZ: -6.6,
    maxZ: 6.6,
    /** The deep basin under the board card: koi come up out of it, the dragon lives in it. */
    basin: Object.freeze({
        x: 0, z: 0.4, radiusX: 2.7, radiusZ: 3.3, depth: 1.7,
    }),
});
export const POND_WIDTH = POND.maxX - POND.minX;
export const POND_LENGTH = POND.maxZ - POND.minZ;

/** Where the far waterline runs (its z) at a given x. */
export function shoreZ(x) {
    return -3.55 + 0.047 * x * x + 0.24 * Math.sin(x * 0.83 + 0.6) + 0.1 * Math.sin(x * 2.3 + 1.9);
}

/** Metres from the waterline, positive out in the pond, negative up the bank. */
export function shoreDistance(x, z) {
    // The waterline is a gentle curve: the vertical gap scaled by its slope is distance enough.
    const slope = 0.094 * x + 0.2 * Math.cos(x * 0.83 + 0.6) + 0.23 * Math.cos(x * 2.3 + 1.9);
    return (z - shoreZ(x)) / Math.sqrt(1 + slope * slope);
}

/** 0..1: how far into the deep basin a point lies. */
export function basinWeight(x, z) {
    const { basin } = POND;
    const dx = (x - basin.x) / basin.radiusX;
    const dz = (z - basin.z) / basin.radiusZ;
    return Math.exp(-(dx * dx + dz * dz) * 1.25);
}

/**
 * The ground: y of the bed under the water (negative) and of the bank above it (positive),
 * meeting at y = 0 on the waterline. A pebble shelf, a step down, then the dark basin.
 */
export function groundHeight(x, z) {
    const s = shoreDistance(x, z);
    if (s >= 0) {
        const shelf = 0.5 * smooth(0, 0.95, s) + 0.34 * smooth(0.7, 3.2, s);
        const roll = 0.05 * Math.sin(x * 0.9 + z * 1.3) * smooth(0.4, 2, s);
        // (The basin fades out toward the bank: the bed must meet the waterline at y = 0.)
        return -(shelf + roll + POND.basin.depth * basinWeight(x, z) * smooth(0, 1.4, s));
    }
    const up = -s;
    const rise = 0.34 * smooth(0, 1.3, up) + 0.62 * smooth(0.9, 4.2, up);
    const mounds = (0.16 * Math.sin(x * 0.7 + 1.1) * Math.cos(z * 0.9 - 0.4) + 0.08 * Math.sin(x * 1.9 - z * 1.4))
        * smooth(0.3, 2.2, up);
    return rise + mounds;
}

/** Metres of water at a point (0 on land). */
export function waterDepth(x, z) {
    return Math.max(0, -groundHeight(x, z));
}

/** World x,z → the simulation's texture coordinates (0..1). */
export function pondUV(x, z, out = { u: 0, v: 0 }) {
    out.u = (x - POND.minX) / POND_WIDTH;
    out.v = (z - POND.minZ) / POND_LENGTH;
    return out;
}

// ── Noise ───────────────────────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * A tileable field of smooth value noise, four channels of rising frequency:
 *   R  broad islands (koi markings, moss)        G  medium (mottling, drifting mist)
 *   B  fine (grain, pebble tone)                 A  finest (sparkle seeds)
 * Returned as bytes (RGBA8) so the renderer can upload it as-is.
 */
export function bakeNoise(seed = 20261008, size = NOISE_SIZE) {
    const rand = mulberry32(seed);
    const layer = (cells) => {
        const lattice = new Float32Array(cells * cells);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
        return (u, v) => {
            const x = u * cells;
            const y = v * cells;
            const x0 = Math.floor(x);
            const y0 = Math.floor(y);
            const fx = x - x0;
            const fy = y - y0;
            const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
            const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
            const i0 = ((x0 % cells) + cells) % cells;
            const j0 = ((y0 % cells) + cells) % cells;
            const i1 = (i0 + 1) % cells;
            const j1 = (j0 + 1) % cells;
            const a = lattice[j0 * cells + i0];
            const b = lattice[j0 * cells + i1];
            const c = lattice[j1 * cells + i0];
            const d = lattice[j1 * cells + i1];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        };
    };
    const fbm = (base, octaves) => {
        const layers = [];
        for (let o = 0; o < octaves; o += 1) layers.push(layer(base * 2 ** o));
        return (u, v) => {
            let sum = 0;
            let weight = 0;
            let amp = 1;
            for (let o = 0; o < octaves; o += 1) {
                sum += layers[o](u, v) * amp;
                weight += amp;
                amp *= 0.5;
            }
            return sum / weight;
        };
    };
    const channels = [fbm(4, 3), fbm(9, 3), fbm(22, 2), fbm(48, 2)];
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            const u = (i + 0.5) / size;
            const v = (j + 0.5) / size;
            const at = (j * size + i) * 4;
            for (let c = 0; c < 4; c += 1) {
                // Stretch the middle of the range: summed octaves crowd around one half.
                const n = clamp01((channels[c](u, v) - 0.5) * 1.9 + 0.5);
                data[at + c] = Math.round(n * 255);
            }
        }
    }
    return data;
}

/** Sample a baked noise field (bytes) at u, v with bilinear filtering and wrap. Returns 0..1. */
export function sampleNoise(data, u, v, channel = 0, size = NOISE_SIZE) {
    const x = (((u % 1) + 1) % 1) * size - 0.5;
    const y = (((v % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const wrap = (n) => ((n % size) + size) % size;
    const at = (i, j) => data[(wrap(j) * size + wrap(i)) * 4 + channel] / 255;
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
