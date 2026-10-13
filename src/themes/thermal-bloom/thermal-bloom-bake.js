/**
 * Thermal Bloom — CPU bakes (three-free): typed arrays only, deterministic by seed, so the theme
 * downloads nothing and every texture is the same on both backends. Each bake is timed in the
 * unit tests and kept small: they run inside createScene and the prewarm.
 *
 *   bakeNoise       a tileable RGBA8 value-noise atlas: R the low fBm (warps, lobes, breakup),
 *                   G a mid fBm, B a fine fBm (mat micro-texture), A a ridged fBm; with CPU mips
 *   bakeCellular    a tileable RGBA8 cellular tile: R the edge distance (F2 − F1, the
 *                   microterraces' crackle), G the distance to the nearest point (F1), B the cell's
 *                   hash, A a blister bump; with CPU mips
 *   bakeRamp        the temperature ramp, RAMP_WIDTH × 6 (one row per season), linear rgb in
 *                   RGBA8 (the shader squares it back: stored as √linear for precision in the darks)
 *   bakeBasinFan    the basin's polar fan around the Iris: positions on the ground plane in the
 *                   fan's own frame (metres), its gentle sinter dome as heights, and indices
 */

import {
    RAMP_WIDTH, SEASONS, mulberry32, rampAt,
} from './thermal-bloom-core.js';

const smoothT = (t) => t * t * (3 - 2 * t);

/** A tileable value-noise lattice (period `period` cells) as a function of (x, y) in cells. */
function lattice(period, rand) {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = smoothT(x - xi);
        const fy = smoothT(y - yi);
        const x0 = ((xi % period) + period) % period;
        const y0 = ((yi % period) + period) % period;
        const x1 = (x0 + 1) % period;
        const y1 = (y0 + 1) % period;
        const a = g[y0 * period + x0];
        const b = g[y0 * period + x1];
        const c = g[y1 * period + x0];
        const d = g[y1 * period + x1];
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
}

/** Tileable fBm over a size² image: `base` cells across at the first octave, doubling. */
function fbmImage(size, base, octaves, rand, ridged = false) {
    const layers = [];
    for (let o = 0; o < octaves; o++) layers.push({ n: lattice(base << o, rand), period: base << o });
    const out = new Float32Array(size * size);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            let amp = 0.5;
            let norm = 0;
            for (let o = 0; o < octaves; o++) {
                const { n, period } = layers[o];
                let v = n((x / size) * period, (y / size) * period);
                if (ridged) v = 1 - Math.abs(2 * v - 1);
                sum += amp * v;
                norm += amp;
                amp *= 0.5;
            }
            const v = sum / norm;
            out[y * size + x] = v;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    // Stretch to 0..1 so thresholds in the shaders mean the same at every seed.
    const span = hi - lo || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
}

/** Box-filtered mips of a square RGBA8 image, level 0 first, down to 1×1. */
export function mipChain(data, size) {
    const levels = [{ data, width: size, height: size }];
    let level = data;
    let w = size;
    while (w > 1) {
        const nw = w >> 1;
        const next = new Uint8Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b = a + 4;
                const c = a + w * 4;
                const d = c + 4;
                const o = (y * nw + x) * 4;
                for (let k = 0; k < 4; k++) {
                    next[o + k] = (level[a + k] + level[b + k] + level[c + k] + level[d + k] + 2) >> 2;
                }
            }
        }
        levels.push({ data: next, width: nw, height: nw });
        level = next;
        w = nw;
    }
    return levels;
}

/** The noise atlas (see the header). Tiles seamlessly; mips built on the CPU. */
export function bakeNoise(size = 256, seed = 0x1b15) {
    const rand = mulberry32(seed);
    const low = fbmImage(size, 4, 4, rand);
    const mid = fbmImage(size, 8, 4, rand);
    const fine = fbmImage(size, 16, 4, rand);
    const ridge = fbmImage(size, 6, 4, rand, true);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        data[i * 4] = Math.round(low[i] * 255);
        data[i * 4 + 1] = Math.round(mid[i] * 255);
        data[i * 4 + 2] = Math.round(fine[i] * 255);
        data[i * 4 + 3] = Math.round(ridge[i] * 255);
    }
    return { data, size, mips: mipChain(data, size) };
}

/**
 * The cellular tile (see the header): `cells` jittered points a side, tiling. The edge distance
 * is in cell units scaled so a value of 1 means a third of a cell from an edge.
 */
export function bakeCellular(size = 256, cells = 12, seed = 0x5e11) {
    const rand = mulberry32(seed);
    const pts = new Float32Array(cells * cells * 2);
    const ids = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i++) {
        pts[i * 2] = 0.1 + 0.8 * rand();
        pts[i * 2 + 1] = 0.1 + 0.8 * rand();
        ids[i] = rand();
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const gx = ((x + 0.5) / size) * cells;
            const gy = ((y + 0.5) / size) * cells;
            const cx = Math.floor(gx);
            const cy = Math.floor(gy);
            let d1 = 9;
            let d2 = 9;
            let id = 0;
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const ix = (((cx + ox) % cells) + cells) % cells;
                    const iy = (((cy + oy) % cells) + cells) % cells;
                    const k = iy * cells + ix;
                    const px = cx + ox + pts[k * 2];
                    const py = cy + oy + pts[k * 2 + 1];
                    const d = Math.hypot(px - gx, py - gy);
                    if (d < d1) {
                        d2 = d1;
                        d1 = d;
                        id = ids[k];
                    } else if (d < d2) d2 = d;
                }
            }
            const o = (y * size + x) * 4;
            data[o] = Math.round(Math.min(1, (d2 - d1) * 3) * 255);
            data[o + 1] = Math.round(Math.min(1, d1) * 255);
            data[o + 2] = Math.round(id * 255);
            data[o + 3] = Math.round(Math.max(0, 1 - (d1 / 0.45) ** 2) * 255);
        }
    }
    return { data, size, mips: mipChain(data, size) };
}

/**
 * The temperature ramp: RAMP_WIDTH × SEASONS.length texels, row s = season s, texel i at
 * T = i / (RAMP_WIDTH − 1). Stored as √linear in RGBA8 (A = 255): the shader squares it.
 */
export function bakeRamp() {
    const rows = SEASONS.length;
    const data = new Uint8Array(RAMP_WIDTH * rows * 4);
    const rgb = [0, 0, 0];
    for (let s = 0; s < rows; s++) {
        for (let i = 0; i < RAMP_WIDTH; i++) {
            rampAt(s, i / (RAMP_WIDTH - 1), rgb);
            const o = (s * RAMP_WIDTH + i) * 4;
            data[o] = Math.round(Math.sqrt(rgb[0]) * 255);
            data[o + 1] = Math.round(Math.sqrt(rgb[1]) * 255);
            data[o + 2] = Math.round(Math.sqrt(rgb[2]) * 255);
            data[o + 3] = 255;
        }
    }
    return { data, width: RAMP_WIDTH, height: rows };
}

/**
 * The basin's polar fan around the Iris: `rings` rings × `spokes` spokes out to `extent` metres,
 * dense near the pool and coarse toward the horizon (radius r = R·(e^{a·t} − 1)/(e^a − 1)), plus
 * the centre. Heights: a gentle sinter dome that rises toward the pool's rim (the spring has
 * built its own mound) and settles into the apron, flat water inside the pool (its depth is
 * analytic in the shader). Positions are in the fan's frame (x, y up, z); the world moves the
 * mesh onto the Iris's centre.
 * @returns {{ positions: Float32Array, indices: Uint32Array, vertexCount: number }}
 */
export function bakeBasinFan(rings, spokes, { extent = 7000, poolRadius = 52, dome = 1.4 } = {}) {
    const a = 5.2;
    const radius = (t) => (extent * (Math.exp(a * t) - 1)) / (Math.exp(a) - 1);
    const vertexCount = 1 + rings * spokes;
    const positions = new Float32Array(vertexCount * 3);
    positions[1] = 0;
    for (let i = 0; i < rings; i++) {
        const r = radius((i + 1) / rings);
        // The dome: zero inside the pool, a low rim mound, settling out over a few pool radii.
        const k = r / poolRadius;
        const y = k <= 1 ? 0 : dome * Math.exp(-((k - 1.15) ** 2) / 0.9) * Math.min(1, (k - 1) * 8);
        for (let j = 0; j < spokes; j++) {
            const th = (j / spokes) * Math.PI * 2;
            const o = (1 + i * spokes + j) * 3;
            positions[o] = Math.cos(th) * r;
            positions[o + 1] = y;
            positions[o + 2] = Math.sin(th) * r;
        }
    }
    const indices = new Uint32Array(spokes * 3 + (rings - 1) * spokes * 6);
    let n = 0;
    for (let j = 0; j < spokes; j++) {
        const a0 = 1 + j;
        const b0 = 1 + ((j + 1) % spokes);
        indices[n++] = 0;
        indices[n++] = b0;
        indices[n++] = a0;
    }
    for (let i = 0; i < rings - 1; i++) {
        for (let j = 0; j < spokes; j++) {
            const a0 = 1 + i * spokes + j;
            const b0 = 1 + i * spokes + ((j + 1) % spokes);
            const a1 = a0 + spokes;
            const b1 = b0 + spokes;
            indices[n++] = a0;
            indices[n++] = b0;
            indices[n++] = a1;
            indices[n++] = b0;
            indices[n++] = b1;
            indices[n++] = a1;
        }
    }
    return { positions, indices, vertexCount };
}

// ── The vapour's 3D noise ───────────────────────────────────────────────────────

/**
 * A tileable size³ RGBA8 volume for the steam march (thermal-bloom-vapour.js), read with
 * texture3D and linear filtering:
 *   R  billows: gradient fBm carved by inverted cellular noise (round lobes hanging off masses),
 *   G  fine cells: inverted cellular fBm at three higher frequencies (the edges' erosion),
 *   B  the slow masses: low gradient fBm alone (which way a body swells),
 *   A  a second billow field, decorrelated, for the devils' swirl and warps.
 * Deterministic by seed; about 0.1–0.3 s at size 64 on one core.
 * @returns {{ data: Uint8Array, size: number }}
 */
export function bakeVapourNoise(size = 64, seed = 0x5713) {
    const n = size;
    const count = n * n * n;
    const rand = mulberry32(seed);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);

    /** Inverted cellular noise (1 on a feature point, 0 a cell away), `cells` cells per tile. */
    const cellular = (cells) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        const out = new Float32Array(count);
        const scale = cells / n;
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const cz = Math.floor(fz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const cy = Math.floor(fy);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const cx = Math.floor(fx);
                    let best = 9;
                    for (let dz = -1; dz <= 1; dz++) {
                        const wz = (cz + dz + cells) % cells;
                        for (let dy = -1; dy <= 1; dy++) {
                            const wy = (cy + dy + cells) % cells;
                            const row = (wz * cells + wy) * cells;
                            for (let dx = -1; dx <= 1; dx++) {
                                const k = (row + ((cx + dx + cells) % cells)) * 3;
                                const px = cx + dx + pts[k] - fx;
                                const py = cy + dy + pts[k + 1] - fy;
                                const pz = cz + dz + pts[k + 2] - fz;
                                const d = px * px + py * py + pz * pz;
                                if (d < best) best = d;
                            }
                        }
                    }
                    out[o] = 1 - Math.min(1, Math.sqrt(best));
                    o += 1;
                }
            }
        }
        return out;
    };

    /** Periodic gradient (Perlin) noise, `cells` lattice cells per tile, about −1..1. */
    const gradient = (cells) => {
        const g = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < g.length; i += 3) {
            const zc = rand() * 2 - 1;
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(1 - zc * zc);
            g[i] = r * Math.cos(a);
            g[i + 1] = r * Math.sin(a);
            g[i + 2] = zc;
        }
        const out = new Float32Array(count);
        const scale = cells / n;
        const dotAt = (ix, iy, iz, dx, dy, dz) => {
            const k = ((((iz % cells) * cells) + (iy % cells)) * cells + (ix % cells)) * 3;
            return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz;
        };
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const z0 = Math.floor(fz);
            const tz = fz - z0;
            const sz = fade(tz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const sx = fade(tx);
                    const a0 = dotAt(x0, y0, z0, tx, ty, tz);
                    const a1 = dotAt(x0 + 1, y0, z0, tx - 1, ty, tz);
                    const b0 = dotAt(x0, y0 + 1, z0, tx, ty - 1, tz);
                    const b1 = dotAt(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
                    const c0 = dotAt(x0, y0, z0 + 1, tx, ty, tz - 1);
                    const c1 = dotAt(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
                    const d0 = dotAt(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
                    const d1 = dotAt(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);
                    const lo = (a0 + (a1 - a0) * sx) + ((b0 + (b1 - b0) * sx) - (a0 + (a1 - a0) * sx)) * sy;
                    const hi = (c0 + (c1 - c0) * sx) + ((d0 + (d1 - d0) * sx) - (c0 + (c1 - c0) * sx)) * sy;
                    out[o] = (lo + (hi - lo) * sz) * 1.6;
                    o += 1;
                }
            }
        }
        return out;
    };

    const g2 = gradient(2);
    const g4 = gradient(4);
    const g8 = gradient(8);
    const w4 = cellular(4);
    const w8 = cellular(8);
    const w16 = cellular(16);
    const w32 = cellular(32);
    const a4 = gradient(4);
    const aw = cellular(6);
    const channels = Array.from({ length: 4 }, () => new Float32Array(count));
    for (let i = 0; i < count; i++) {
        const perlin = g4[i] * 0.62 + g8[i] * 0.28 + g2[i] * 0.3;
        const worley = w4[i] * 0.62 + w8[i] * 0.25 + w16[i] * 0.13;
        // Perlin–Worley: the gradient's masses, their tops carved into the cells' round lobes.
        channels[0][i] = perlin * 0.5 + worley * 0.75 + perlin * worley * 0.5;
        channels[1][i] = w8[i] * 0.5 + w16[i] * 0.3 + w32[i] * 0.2;
        channels[2][i] = g2[i] * 0.7 + g4[i] * 0.3;
        channels[3][i] = a4[i] * 0.6 + aw[i] * 0.8;
    }
    // Each channel stretched between its 1st and 99th percentile, so a threshold in the shader
    // means the same share of the volume in every channel and at every size.
    const data = new Uint8Array(count * 4);
    channels.forEach((ch, c) => {
        const sorted = Float32Array.from(ch).sort();
        const lo = sorted[Math.floor(count * 0.01)];
        const hi = sorted[Math.floor(count * 0.99)];
        const span = hi - lo || 1;
        for (let i = 0; i < count; i++) {
            data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(((ch[i] - lo) / span) * 255)));
        }
    });
    return { data, size };
}

// ── The Stair: travertine terraces (Stage A0 lab "s4", ported) ──────────────────

/** A seeded 1D/2D value noise and fBm for the Stair's generator (deterministic, no texture). */
function noise2(seed) {
    const hash = (x, y) => {
        let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed;
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const n = (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = smoothT(x - xi);
        const fy = smoothT(y - yi);
        const a = hash(xi, yi);
        const b = hash(xi + 1, yi);
        const c = hash(xi, yi + 1);
        const d = hash(xi + 1, yi + 1);
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
    return (x, y, octaves = 3) => {
        let sum = 0;
        let amp = 0.5;
        let norm = 0;
        let px = x;
        let py = y;
        for (let o = 0; o < octaves; o++) {
            sum += amp * n(px + o * 17.3, py - o * 9.1);
            norm += amp;
            amp *= 0.5;
            px *= 2.03;
            py *= 2.03;
        }
        return sum / norm;
    };
}

const smooth01 = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** The Stair's shape constants (metres; s runs 0 at the Chalice's mound … 1 at the near end). */
/** The mesh and layout reach this far past the footprint's nominal width, so its edge fade always
 * comes down to nothing inside the grid (an open side would show as a straight cut). */
const FOOTPRINT = 1.3;
/** The runoff apron's height over the basin floor (metres). */
const APRON_H = 0.08;

export const STAIR = Object.freeze({
    length: 135,
    /** The Stair's top meets the Chalice's mound; its lowest pool stands just above the basin floor. */
    top: 12,
    foot: 0.3,
    sMin: -0.04,
    sMax: 1.06,
    /**
     * Pool depth at its rim, how much of each tier's slope the floor keeps (nearly none: the
     * water fills each tier back to the foot of the face above it), the lip's crest.
     */
    depth: 0.34,
    gamma: 0.08,
    lip: 0.3,
    /** The widest half-width the footprint reaches (metres), for the layout's across axis. */
    halfWidth: 55,
    /** How much further down the slope (in s) the mound's sides stand: its dome across the fall line. */
    crown: 0.3,
});

/**
 * The Stair's generator: `tiers` scalloped rims (lower envelopes of lobes convex downhill, never
 * crossing the rim above), each scallop holding its own flat pool at the height of its lowest rim
 * point, risers that drop from each lip in two to four micro-steps onto the next tier's floor,
 * which rises gently uphill so water fills only a band behind each rim. Tabulated along the
 * across axis so a sample costs a few lookups.
 */
export function stairGenerator({ tiers = 10, seed = 0x57a1 } = {}) {
    const rand = mulberry32(seed);
    const fbm = noise2(seed ^ 0x9e37);
    const S = STAIR;
    const N = 1024;
    const w0 = -S.halfWidth * 1.15;
    const dw = (2 * S.halfWidth * 1.15) / (N - 1);
    const gaps = [];
    let acc = 0;
    for (let k = 0; k < tiers; k++) {
        acc += 0.8 + 0.4 * rand();
        gaps.push(acc);
    }
    const rim = [];
    const apex = [];
    const run = [];
    const steps = [];
    /** Scallops along the across axis: `[minWidth, maxWidth]` metres, depth per 16 m of width. */
    const scallops = (lo, hi, depth0, depth1) => {
        const out = [];
        let x = -S.halfWidth * 1.2 - rand() * hi;
        while (x < S.halfWidth * 1.2) {
            const width = lo + (hi - lo) * rand();
            out.push({ c: x + width / 2, half: width / 2, depth: (depth0 + depth1 * rand()) * (width / 16) ** 0.6 });
            x += width * (0.6 + 0.32 * rand());
        }
        return out;
    };
    /** The deepest bulge of a set of scallops at w, and the scallop it belongs to. */
    const bulge = (set, w) => {
        let best = -1;
        let at = null;
        for (let i = 0; i < set.length; i++) {
            const l = set[i];
            const d = Math.abs(w - l.c);
            if (d < l.half) {
                const v = l.depth * Math.sqrt(1 - (d / l.half) ** 2);
                if (v > best) {
                    best = v;
                    at = l;
                }
            }
        }
        return { best, at };
    };
    for (let k = 0; k < tiers; k++) {
        const base = (gaps[k] / acc) * 0.9 + 0.08;
        // Rims wander along the slope (each tier its own phase, so cusps never line up down the
        // Stair), scalloped at two scales: pools 6–40 m across, their lips crinkled by 3–8 m lobes.
        const wander = (x) => 0.04 * (fbm(x * 0.013 + k * 3.7, k * 2.9 + 0.5, 3) - 0.5) * 2
            + 0.03 * (x / S.halfWidth) ** 2;
        // Bulges a third of a tier and more, meeting in sharp cusps (they overlap).
        const big = scallops(8, 34, 0.045, 0.07);
        const small = scallops(3, 8, 0.006, 0.01);
        const gapMin = (x) => 0.02 + 0.025 * fbm(x * 0.05 + k * 1.3, 7.1 + k, 2);
        const R = new Float32Array(N);
        const A = new Float32Array(N);
        const U = new Float32Array(N);
        const M = new Float32Array(N);
        for (let j = 0; j < N; j++) {
            const w = w0 + j * dw;
            const b = bulge(big, w);
            const sm = bulge(small, w);
            let r = base + wander(w) + Math.max(b.best, 0) + Math.max(sm.best, 0);
            let a = b.at ? base + wander(b.at.c) + b.at.depth + Math.max(sm.best, 0) : r;
            if (k > 0) {
                r = Math.max(r, rim[k - 1][j] + gapMin(w));
                a = Math.max(a, r);
            }
            R[j] = r;
            A[j] = a;
            // Steep faces (rimstone dams, not ramps): 1.1–2 m of run for a tier's drop.
            U[j] = 1.1 + 0.9 * fbm(w * 0.08, k * 2.3, 2);
            M[j] = 2 + Math.floor(3 * fbm(w * 0.11 + k, 1.3, 2));
        }
        rim.push(R);
        apex.push(A);
        run.push(U);
        steps.push(M);
    }
    // Some rims end on the slope: over a stretch a tier merges into the one below (its rim slides
    // down onto the next and its pool takes the next one's level), so not every lip runs across.
    for (let k = 1; k < tiers - 1; k++) {
        if (rand() < 0.55) continue;
        const centre = (rand() * 2 - 1) * S.halfWidth * 0.8;
        const half = 4 + 8 * rand();
        for (let j = 0; j < N; j++) {
            const w = w0 + j * dw;
            // A long taper: the rim closes on the one below over ~15 m, so the pool narrows out.
            const m = smooth01(half + 16, half, Math.abs(w - centre));
            if (m <= 0) continue;
            rim[k][j] += (rim[k + 1][j] - 0.004 - rim[k][j]) * m;
            apex[k][j] += (apex[k + 1][j] - apex[k][j]) * m;
        }
    }
    const at = (table, w) => {
        const f = Math.max(0, Math.min(N - 1.001, (w - w0) / dw));
        const i = Math.floor(f);
        return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
    // Past the last rim the mound settles into a thin runoff apron just above the basin's floor
    // (never below it: a foot sunk under the ground would open a hole in the Stair).
    const hb = (x) => (x <= 1
        ? S.foot + (S.top - S.foot) * (1 - Math.max(0, x)) ** 1.15
        : Math.max(APRON_H, S.foot - (x - 1) * (S.top - S.foot) * 0.3));
    // Broad from the top (a mound, not a pyramid), its outline lobed by the outermost pools.
    const widthAt = (s) => (26 + 20 * Math.max(0, Math.min(1, s))) * (0.82 + 0.36 * fbm(s * 7.0, 3.3, 2));

    /**
     * Everything about one point (s along, w across, metres): its height, its tier, whether it is
     * under water, its distance to the downhill rim (metres), how far down its riser it is (0 at
     * the lip … 1 at the foot; 1 off a riser) and its edge fade into the apron (1 inside).
     */
    function sample(sIn, w, out = {}) {
        // The mound is domed across its fall line: toward its sides a point stands lower, as if
        // further down the slope, so every rim bends into an arc round the Chalice (a cascade
        // fan) and the tiers wrap the mound instead of stacking across it as level bands.
        const s = sIn + S.crown * (w / S.halfWidth) ** 2;
        let k = 0;
        while (k < tiers && s > at(rim[k], w)) k += 1;
        const kk = Math.min(k, tiers - 1);
        const rimK = at(rim[kk], w);
        const Pk = k < tiers ? hb(at(apex[kk], w)) : hb(1.08);
        const floor = Pk - S.depth + S.gamma * (hb(s) - Pk);
        let h = floor;
        let u = 1;
        if (k > 0) {
            const rimPrev = at(rim[k - 1], w);
            const Pprev = hb(at(apex[k - 1], w));
            u = Math.max(0, Math.min(1, ((s - rimPrev) * S.length) / at(run[k - 1], w)));
            if (u < 1) {
                const n = at(steps[k - 1], w);
                const us = u * n;
                const stepped = (Math.floor(us) + smooth01(0.55, 1, us - Math.floor(us))) / n;
                const prof = 0.55 * stepped + 0.45 * smooth01(0, 1, u);
                const crest = Pprev + S.lip;
                h = crest - (crest - floor) * prof ** 0.85;
            }
        }
        const water = k < tiers && floor < Pk && (k === 0 || u >= 1);
        if (water) h = Pk;
        // How deep the water stands here (negative: how far the dry floor rises above it), off
        // the risers: a continuous value, so the shoreline is smooth however the layout is sampled.
        out.depth = k < tiers && (k === 0 || u >= 1) ? Pk - floor : -1;
        const width = widthAt(sIn);
        // The flanks fall gently (about 25°), never as walls: a pagoda's sides are not travertine's.
        const edge = smooth01(1.15, 0.4, Math.abs(w) / width + 0.3 * (fbm(w * 0.05, s * 8, 2) - 0.5))
            * smooth01(S.sMin, 0.04, sIn + 0.22 * (w / S.halfWidth) ** 2)
            // The near end is lobed and rounded too, never cut along a straight line.
            * smooth01(S.sMax, 0.97, sIn + 0.12 * (w / S.halfWidth) ** 2 + 0.05 * (fbm(w * 0.06, 9.7, 2) - 0.5) * 2);
        out.height = h * edge ** 0.75;
        out.tier = k;
        // No pools on the tapering flanks: there the ground is no longer level.
        out.water = water && edge > 0.85;
        out.rimDist = (rimK - s) * S.length;
        out.riser = u;
        out.edge = edge;
        out.width = width;
        return out;
    }
    return { sample, widthAt, tiers };
}

/**
 * The Stair's mesh and layout. The mesh is a grid in (u, v) = (across ∈ 0..1, along ∈ 0..1) over
 * the footprint (w = (2u − 1)·width(s), s from sMin to sMax), its heights baked into the positions
 * (no vertex texture fetch on either backend), its uv the layout's coordinates, and an `edge`
 * attribute fading it into the apron. The layout (RGBA8, `layoutSize`², same uv): R the distance
 * to the downhill rim (metres / 24), G the tier id (/ 16; read it NEAREST), B the riser's depth
 * (0 at the lip … 1 at the foot), A the water's depth (0.5 at the shoreline, 1 at 0.3 m deep,
 * so a filtered read gives a smooth shore). Positions are local: x across, z along (toward the
 * camera), y up; the world turns and moves the mesh onto the Chalice's flank.
 */
export function bakeStair({
    tiers = 10, rows = 300, columns = 110, layoutSize = 512, seed = 0x57a1,
} = {}) {
    const gen = stairGenerator({ tiers, seed });
    const S = STAIR;
    const vertexCount = rows * columns;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const edges = new Float32Array(vertexCount);
    const p = {};
    for (let i = 0; i < rows; i++) {
        const v = i / (rows - 1);
        const s = S.sMin + (S.sMax - S.sMin) * v;
        const width = gen.widthAt(s);
        for (let j = 0; j < columns; j++) {
            const uu = j / (columns - 1);
            const w = (2 * uu - 1) * width * FOOTPRINT;
            gen.sample(s, w, p);
            const o = i * columns + j;
            positions[o * 3] = w;
            positions[o * 3 + 1] = p.height;
            positions[o * 3 + 2] = s * S.length;
            uvs[o * 2] = uu;
            uvs[o * 2 + 1] = v;
            edges[o] = p.edge;
        }
    }
    const indices = new Uint32Array((rows - 1) * (columns - 1) * 6);
    let n = 0;
    for (let i = 0; i < rows - 1; i++) {
        for (let j = 0; j < columns - 1; j++) {
            const a = i * columns + j;
            const b = a + 1;
            const c = a + columns;
            const d = c + 1;
            indices[n++] = a;
            indices[n++] = c;
            indices[n++] = b;
            indices[n++] = b;
            indices[n++] = c;
            indices[n++] = d;
        }
    }
    const layout = new Uint8Array(layoutSize * layoutSize * 4);
    for (let y = 0; y < layoutSize; y++) {
        const v = (y + 0.5) / layoutSize;
        const s = S.sMin + (S.sMax - S.sMin) * v;
        const width = gen.widthAt(s);
        for (let x = 0; x < layoutSize; x++) {
            const uu = (x + 0.5) / layoutSize;
            gen.sample(s, (2 * uu - 1) * width * FOOTPRINT, p);
            const o = (y * layoutSize + x) * 4;
            layout[o] = Math.round(Math.max(0, Math.min(1, p.rimDist / 24)) * 255);
            layout[o + 1] = Math.min(255, p.tier * 16);
            layout[o + 2] = Math.round(p.riser * 255);
            // 0.5 at the shoreline, 1 at 0.3 m deep; off the flanks' edge the pools give way.
            const shore = 0.5 + Math.max(-0.5, Math.min(0.5, p.depth / 0.6));
            layout[o + 3] = Math.round(shore * smooth01(0.8, 0.9, p.edge) * 255);
        }
    }
    return {
        positions, uvs, edges, indices, vertexCount, layout, layoutSize, tiers, gen,
    };
}
