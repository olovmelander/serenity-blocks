/**
 * Stellar Drift — the moons' surfaces, baked on the CPU (three-free: typed arrays only).
 *
 * Each moon is an equirectangular map (longitude across, latitude up, south at row 0) of four
 * channels the full-screen pass turns into colour and relief under the palette of the hour:
 *
 *   R  light ↔ dark: how much of the moon's own bright ground shows (0 = its darkest ground)
 *   G  its one special material: the brown of the ice's cracks and chaos, the frost of the rust
 *      world's polar caps
 *   B  slope eastward, A  slope northward (0.5 = level): the relief the shader lights
 *
 * The icy moon is young ice: long double-ridged cracks (lineae) wound round it on great and
 * small circles, a few patches of broken "chaos" ground stained brown, a handful of fresh craters
 * with bright rays, and four parallel blue "tiger stripes" near its south pole, where its jets
 * vent. The small rust world is old ground: bright dusty plains and dark basalt provinces, a
 * great canyon along its equator, a shield volcano, many craters and one wide basin, a polar cap
 * at each end.
 *
 * Deterministic: the same seed bakes the same bytes. The mip chain is averaged here (half-float
 * free, RGBA8), so the shader can choose a level from the moon's own footprint inside a branch.
 */

import {
    TAU, clamp01, mulberry32, smooth,
} from './stellar-drift-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

/** The two maps' sizes (width; height is half). */
export const MOON_SIZES = Object.freeze({
    ice: 1024,
    rust: 512,
});

export const moonKey = (kind, width, seed) => `stellar-drift:moon:${kind}:${width}:${seed}`;

/** The seed the moons' maps are baked from: the world's seed plus their own offset. */
export const moonSeed = (worldSeed) => worldSeed + 59;

// ── 3D gradient noise (CPU) ─────────────────────────────────────────────────────

/** Improved gradient noise on a seeded permutation, in −1..1 (about). */
function makeNoise3(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (h, x, y, z) => {
        const k = h & 15;
        const u = k < 8 ? x : y;
        let v = z;
        if (k < 4) v = y;
        else if (k === 12 || k === 14) v = x;
        return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
    };
    const noise = (px, py, pz) => {
        const fx = Math.floor(px);
        const fy = Math.floor(py);
        const fz = Math.floor(pz);
        const X = fx & 255;
        const Y = fy & 255;
        const Z = fz & 255;
        const x = px - fx;
        const y = py - fy;
        const z = pz - fz;
        const u = fade(x);
        const v = fade(y);
        const w = fade(z);
        const A = perm[X] + Y;
        const AA = perm[A] + Z;
        const AB = perm[A + 1] + Z;
        const B = perm[X + 1] + Y;
        const BA = perm[B] + Z;
        const BB = perm[B + 1] + Z;
        const l = (a, b, t) => a + (b - a) * t;
        const near = l(
            l(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
            l(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
            v,
        );
        const far = l(
            l(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
            l(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
            v,
        );
        return l(near, far, w);
    };
    /** fBm in about −1..1. */
    return (x, y, z, octaves = 4, gain = 0.5) => {
        let sum = 0;
        let amp = 1;
        let total = 0;
        let f = 1;
        for (let o = 0; o < octaves; o++) {
            sum += noise(x * f + o * 19.1, y * f + o * 7.3, z * f + o * 3.7) * amp;
            total += amp;
            amp *= gain;
            f *= 2.07;
        }
        return sum / total;
    };
}

/** A random unit vector. */
function unit(rand) {
    const z = rand() * 2 - 1;
    const a = rand() * TAU;
    const s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), z, s * Math.sin(a)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** A direction from (longitude, latitude): longitude from +X toward +Z, as the shader reads it. */
const direction = (lon, lat) => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];

/**
 * A crater: a bowl below a raised rim, a little central peak in the larger ones, and (if `rays`)
 * bright ejecta thrown out in streaks to several radii. Returns [height, brighten] at angular
 * distance `d` (radians) from the centre, for a crater of radius `R`; `az` is the bearing round it.
 */
function crater(d, R, rays, az, seed) {
    const x = d / R;
    let h = 0;
    if (x < 1) h = (x * x - 1) * 0.9 + 0.25;
    else h = 0.25 * Math.exp(-(((x - 1) / 0.35) ** 2));
    if (R > 0.07 && x < 0.22) h += 0.35 * (1 - x / 0.22) ** 2;
    let bright = 0;
    if (rays > 0 && x < 7) {
        // Ejecta: a bright blanket and streaks at hashed bearings.
        const blanket = Math.exp(-(((x - 1.1) / 0.8) ** 2)) * (x > 0.85 ? 1 : 0.4);
        let streak = 0;
        for (let k = 0; k < 9; k++) {
            const b = (((Math.sin((seed + k) * 12.9898) * 43758.5453) % 1) + 1) % 1;
            let da = az - b * TAU;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            const len = 2.5 + ((((Math.sin((seed + k) * 78.233) * 9631.7) % 1) + 1) % 1) * 4;
            streak += Math.exp(-(((da * x) / 0.16) ** 2)) * Math.max(0, 1 - x / len);
        }
        bright = rays * (blanket * 0.5 + Math.min(1, streak) * 0.55) * (x > 0.9 ? 1 : 0.3);
    }
    return [h, bright];
}

// ── The bakes ───────────────────────────────────────────────────────────────────

/**
 * One moon's map as RGBA8 with its mip chain.
 * @param {'ice'|'rust'} kind
 * @returns {{ width: number, height: number, levels: Array<{ data: Uint8Array, width: number, height: number }> }}
 */
export function bakeMoon(kind = 'ice', width = MOON_SIZES[kind], seed = 0x3a11) {
    return bakeOnce(moonKey(kind, width, seed), () => computeMoon(kind, width, seed));
}

function computeMoon(kind, width, seed) {
    const W = width;
    const H = width >> 1;
    const light = new Float32Array(W * H);
    const special = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    if (kind === 'rust') paintRust(W, H, seed, light, special, height);
    else paintIce(W, H, seed, light, special, height);
    // Relief: the height's slope east (per unit of arc) and north, from central differences.
    const data = new Float32Array(W * H * 4);
    const dLon = TAU / W;
    const dLat = Math.PI / H;
    const gain = kind === 'rust' ? 3.2 : 2.4;
    for (let y = 0; y < H; y++) {
        const lat = ((y + 0.5) / H) * Math.PI - Math.PI / 2;
        const c = Math.max(0.08, Math.cos(lat));
        const yn = Math.min(H - 1, y + 1);
        const ys = Math.max(0, y - 1);
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const e = height[y * W + ((x + 1) % W)];
            const w = height[y * W + ((x - 1 + W) % W)];
            const sx = ((e - w) / (2 * dLon * c)) * gain;
            const sy = ((height[yn * W + x] - height[ys * W + x]) / ((yn - ys) * dLat)) * gain;
            data[i * 4] = clamp01(light[i]);
            data[i * 4 + 1] = clamp01(special[i]);
            data[i * 4 + 2] = clamp01(0.5 + sx * 0.5);
            data[i * 4 + 3] = clamp01(0.5 + sy * 0.5);
        }
    }
    // The mip chain (2 × 2 averages; the last levels keep a row of two as the width halves).
    const levels = [];
    let level = data;
    let w = W;
    let h = H;
    for (;;) {
        const bytes = new Uint8Array(w * h * 4);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(level[i] * 255);
        levels.push({ data: bytes, width: w, height: h });
        if (w === 1 && h === 1) break;
        const nw = Math.max(1, w >> 1);
        const nh = Math.max(1, h >> 1);
        const next = new Float32Array(nw * nh * 4);
        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                const x0 = Math.min(w - 1, x * 2);
                const x1 = Math.min(w - 1, x * 2 + 1);
                const y0 = Math.min(h - 1, y * 2);
                const y1 = Math.min(h - 1, y * 2 + 1);
                for (let k = 0; k < 4; k++) {
                    next[(y * nw + x) * 4 + k] = (level[(y0 * w + x0) * 4 + k] + level[(y0 * w + x1) * 4 + k]
                        + level[(y1 * w + x0) * 4 + k] + level[(y1 * w + x1) * 4 + k]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
        h = nh;
    }
    return { width: W, height: H, levels };
}

/** Sines and cosines of every column's longitude and every row's latitude, per map size. */
const TABLES = new Map();
function tables(W, H) {
    const key = W * 100000 + H;
    let t = TABLES.get(key);
    if (!t) {
        t = {
            lon: new Float64Array(W),
            cLon: new Float64Array(W),
            sLon: new Float64Array(W),
            lat: new Float64Array(H),
            cLat: new Float64Array(H),
            sLat: new Float64Array(H),
        };
        for (let x = 0; x < W; x++) {
            t.lon[x] = ((x + 0.5) / W) * TAU - Math.PI;
            t.cLon[x] = Math.cos(t.lon[x]);
            t.sLon[x] = Math.sin(t.lon[x]);
        }
        for (let y = 0; y < H; y++) {
            t.lat[y] = ((y + 0.5) / H) * Math.PI - Math.PI / 2;
            t.cLat[y] = Math.cos(t.lat[y]);
            t.sLat[y] = Math.sin(t.lat[y]);
        }
        TABLES.set(key, t);
    }
    return t;
}

/** Visit every texel with its direction: fn(i, d, lon, lat). `d` is reused: copy what you keep. */
function eachTexel(W, H, fn) {
    const t = tables(W, H);
    const d = [0, 0, 0];
    for (let y = 0; y < H; y++) {
        const cl = t.cLat[y];
        d[1] = t.sLat[y];
        for (let x = 0; x < W; x++) {
            d[0] = cl * t.cLon[x];
            d[2] = cl * t.sLon[x];
            fn(y * W + x, d, t.lon[x], t.lat[y]);
        }
    }
}

/** Stamp a feature into the texels within `reach` radians of `centre` only. */
function stamp(W, H, centre, reach, fn) {
    const lat0 = Math.asin(Math.max(-1, Math.min(1, centre[1])));
    const lon0 = Math.atan2(centre[2], centre[0]);
    const y0 = Math.max(0, Math.floor(((lat0 - reach + Math.PI / 2) / Math.PI) * H) - 1);
    const y1 = Math.min(H - 1, Math.ceil(((lat0 + reach + Math.PI / 2) / Math.PI) * H) + 1);
    const cosR = Math.cos(Math.min(Math.PI, reach));
    for (let y = y0; y <= y1; y++) {
        const lat = ((y + 0.5) / H) * Math.PI - Math.PI / 2;
        const c = Math.cos(lat);
        const span = c > 1e-3 ? Math.min(Math.PI, reach / c + 0.02) : Math.PI;
        const x0 = Math.floor(((lon0 - span + Math.PI) / TAU) * W) - 1;
        const x1 = Math.ceil(((lon0 + span + Math.PI) / TAU) * W) + 1;
        for (let xx = x0; xx <= x1 && xx - x0 < W; xx++) {
            const x = ((xx % W) + W) % W;
            const lon = ((x + 0.5) / W) * TAU - Math.PI;
            const d = direction(lon, lat);
            const cd = dot(d, centre);
            if (cd < cosR) continue;
            fn(y * W + x, d, Math.acos(Math.max(-1, Math.min(1, cd))));
        }
    }
}

/** The bearing of `d` round `centre`, in a frame fixed by the centre. */
function bearing(d, centre) {
    const ref = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e = norm(cross(ref, centre));
    const n = cross(centre, e);
    return Math.atan2(dot(d, n), dot(d, e));
}

function paintIce(W, H, seed, light, special, height) {
    const fbm = makeNoise3(seed + 1);
    const rand = mulberry32(seed + 7);
    // Ground: bright ice, mottled; patches of chaos broken and stained.
    eachTexel(W, H, (i, d) => {
        const broad = fbm(d[0] * 1.6, d[1] * 1.6, d[2] * 1.6, 4);
        const mottle = fbm(d[0] * 3.4 + 2.1, d[1] * 3.4 + 7.7, d[2] * 3.4, 4);
        const fine = fbm(d[0] * 11 + 5, d[1] * 11, d[2] * 11, 3);
        const chaosField = fbm(d[0] * 1.3 + 9.1, d[1] * 1.3 + 2.3, d[2] * 1.3, 4) + fine * 0.2 + mottle * 0.15;
        const chaos = smooth(0.12, 0.34, chaosField);
        // Broad provinces: blue-grey plains where `broad` is low, brown-mottled ridged plains where
        // the second field is high (what gives the moon a face at forty pixels).
        const blue = smooth(-0.05, -0.35, broad);
        const brown = smooth(0.0, 0.32, mottle) * (1 - blue * 0.6);
        light[i] = 0.86 + broad * 0.14 - blue * 0.3 - chaos * (0.26 + fine * 0.28) + fine * 0.04;
        special[i] = brown * (0.26 + Math.max(0, fine) * 0.25) + chaos * (0.38 + Math.max(0, fine) * 0.45);
        height[i] = chaos * fine * 0.014 + broad * 0.002 + mottle * 0.003;
    });
    // Lineae: arcs of great and small circles, each a double ridge with a brown band between.
    const LINES = 46;
    for (let k = 0; k < LINES; k++) {
        const n = unit(rand);
        const offset = (rand() - 0.5) * 0.5; // a small circle when not 0
        const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const ua = norm(cross(ref, n));
        const va = cross(n, ua);
        const mid = rand() * TAU;
        const half = 0.5 + rand() * rand() * 2.6;
        const w = (0.006 + rand() * rand() * 0.022) * (k < 6 ? 1.6 : 1);
        const tone = 0.45 + rand() * 0.55;
        const wobA = rand() * 0.03;
        const wobF = 3 + Math.floor(rand() * 6);
        const wobP = rand() * TAU;
        eachTexelNearPlane(W, H, n, offset, w * 4 + wobA + 0.01, (i, d) => {
            const phi = Math.atan2(dot(d, va), dot(d, ua));
            let along = phi - mid;
            along = Math.atan2(Math.sin(along), Math.cos(along));
            const ends = 1 - smooth(half * 0.75, half, Math.abs(along));
            if (ends <= 0) return;
            const dist = dot(d, n) - offset + Math.sin(phi * wobF + wobP) * wobA;
            const a = Math.abs(dist);
            const ridge = Math.exp(-(((a - w * 0.55) / (w * 0.3)) ** 2));
            const band = Math.exp(-((a / (w * 0.75)) ** 2));
            const halo = Math.exp(-((a / (w * 2.6)) ** 2));
            special[i] = Math.max(special[i], (band * 0.85 + halo * 0.3) * tone * ends);
            light[i] -= (ridge * 0.12 + band * 0.1) * tone * ends;
            height[i] += ridge * w * 0.5 * ends;
        });
    }
    // Tiger stripes: four long, slightly bent fractures near the south pole, flanked by fresh frost.
    eachTexel(W, H, (i, d, lon, lat) => {
        if (lat > -0.85) return;
        const r = (Math.PI / 2 + lat); // angular distance from the pole
        const px = Math.cos(lon + 0.6) * r;
        const py = Math.sin(lon + 0.6) * r;
        if (Math.abs(px) > 0.36) return;
        const fadeEnd = 1 - smooth(0.26, 0.36, Math.abs(px));
        for (let s = 0; s < 4; s++) {
            const o = -0.21 + s * 0.135 + Math.sin(px * 6 + s) * 0.018;
            const a = Math.abs(py - o);
            const crack = Math.exp(-((a / 0.012) ** 2)) * fadeEnd;
            const frost = Math.exp(-((a / 0.045) ** 2)) * fadeEnd;
            light[i] += frost * 0.12 - crack * 0.5;
            special[i] *= 1 - frost * 0.8;
            height[i] -= crack * 0.006;
        }
    });
    // Craters: few (the ice is young), some with bright rays.
    for (let k = 0; k < 16; k++) {
        const c = unit(rand);
        if (c[1] < -0.7) continue; // the stripes' country stays clear
        const R = 0.02 + rand() * rand() * 0.09;
        const rays = k < 4 ? 0.8 + rand() * 0.4 : 0;
        const s = k * 3.17 + 1;
        stamp(W, H, c, R * (rays ? 7 : 1.8), (i, d, ang) => {
            const [h, bright] = crater(ang, R, rays, bearing(d, c), s);
            height[i] += h * R * 0.6;
            light[i] += bright * 0.2 - (ang < R ? 0.04 : 0);
            special[i] *= 1 - Math.min(1, bright) * 0.6;
        });
    }
}

/** Visit the texels within `reach` of the plane dot(d, n) = offset (a circle round the moon). */
function eachTexelNearPlane(W, H, n, offset, reach, fn) {
    // Sampled per row: a row's texels near the circle lie in at most two runs; scanning the row is
    // cheap beside the work, and keeps this obviously right.
    const t = tables(W, H);
    for (let y = 0; y < H; y++) {
        const cl = t.cLat[y];
        const sl = t.sLat[y];
        // dot(d, n) = cl (n0 cos lon + n2 sin lon) + sl n1: its range over the row.
        const amp = cl * Math.hypot(n[0], n[2]);
        const centre = sl * n[1] - offset;
        if (Math.abs(centre) - amp > reach) continue;
        const d = [0, sl, 0];
        for (let x = 0; x < W; x++) {
            d[0] = cl * t.cLon[x];
            d[2] = cl * t.sLon[x];
            if (Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2] - offset) > reach) continue;
            fn(y * W + x, d);
        }
    }
}

function paintRust(W, H, seed, light, special, height) {
    const fbm = makeNoise3(seed + 2);
    const rand = mulberry32(seed + 13);
    eachTexel(W, H, (i, d, lon, lat) => {
        const broad = fbm(d[0] * 1.5 + 3.3, d[1] * 1.5, d[2] * 1.5 + 1.1, 5);
        const fine = fbm(d[0] * 7 + 1, d[1] * 7, d[2] * 7, 3);
        // Dark basalt provinces, mostly in the south, with ragged edges.
        const south = smooth(0.7, -0.5, lat);
        const dark = smooth(-0.02, 0.2, broad + fine * 0.22 + south * 0.16 - 0.06);
        light[i] = 0.84 + fine * 0.12 - dark * 0.62;
        height[i] = broad * 0.01 + fine * 0.004;
        // Polar caps: the north broad, the south small, edges torn by the noise.
        const capN = smooth(1.22, 1.29, lat + fine * 0.06);
        const capS = smooth(-1.3, -1.36, lat + fine * 0.05);
        special[i] = Math.max(capN, capS * 0.9);
    });
    // The great canyon: a long trough along the equator, branched at its west end.
    eachTexel(W, H, (i, d, lon, lat) => {
        if (lon < -0.6 || lon > 1.1 || Math.abs(lat + 0.15) > 0.2) return;
        const path = -0.13 + Math.sin(lon * 4.0) * 0.025 + Math.sin(lon * 11) * 0.008;
        const a = Math.abs(lat - path);
        const ends = smooth(-0.6, -0.35, lon) * (1 - smooth(0.85, 1.1, lon));
        const trough = Math.exp(-((a / 0.022) ** 2)) * ends;
        light[i] -= trough * 0.4;
        height[i] -= trough * 0.03;
    });
    // A shield volcano with a dark caldera.
    stamp(W, H, direction(2.3, 0.32), 0.22, (i, d, ang) => {
        const x = ang / 0.16;
        height[i] += Math.max(0, 1 - x) ** 1.5 * 0.035;
        light[i] += Math.exp(-((x / 0.9) ** 2)) * 0.05 - Math.exp(-((x / 0.14) ** 2)) * 0.3;
    });
    // Craters, and one wide bright-floored basin in the south.
    stamp(W, H, direction(-1.9, -0.7), 0.5, (i, d, ang) => {
        const x = ang / 0.36;
        const floor = 1 - smooth(0.75, 1.0, x);
        light[i] += floor * 0.28;
        height[i] += (x < 1 ? (x * x - 1) * 0.02 : 0.006 * Math.exp(-(((x - 1) / 0.25) ** 2)));
    });
    for (let k = 0; k < 40; k++) {
        const c = unit(rand);
        const R = 0.015 + rand() * rand() * rand() * 0.12;
        stamp(W, H, c, R * 1.8, (i, d, ang) => {
            const [h] = crater(ang, R, 0, 0, k);
            height[i] += h * R * 0.5;
            light[i] -= ang < R ? 0.05 : 0;
        });
    }
}
