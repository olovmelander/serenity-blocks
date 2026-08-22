/* eslint-disable no-bitwise */
/**
 * @fileoverview Earth Core lava lake — baked, PERIODIC twin of the shared `snoise3` primitive
 * (pure math: no three import, so the Worker and vitest load it cheaply; the texture/TSL side is
 * odyssey-lake-noise-bake.js).
 *
 * Design: docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §2.2–2.5 (Session 0).
 *
 * The lake evaluates the calibrated Ashima simplex (`shared/odyssey-tsl-noise.js`: input × 0.664,
 * odd quintic remap) nineteen times per fragment. That is the chapter's compile pole (a 2 s
 * pipeline; 7 s before the simplex) and thousands of ALU per fragment on an iGPU. This module bakes
 * THE SAME PRIMITIVE into a 3D texture so the lake's `fbm(p, octaves, sn)` seam can fetch instead of
 * compute, with the statistics the chapter's thresholds were tuned on preserved by construction:
 *
 *  1. **Lattice wrap** — exact periodicity. Between `i = floor(v + dot(v, 1/3))` and the permute
 *     hash, every corner lattice point is mapped to a fundamental box of side `L_raw = 3k` in
 *     UNSKEWED space (`q = i − sum(i)/6`, `q' = q mod L`, `i' = skew(q')`). With `L = 3k` the
 *     wrapped point is again a lattice point hashed by the same permutation, so the field is
 *     periodic with period `L_raw` along each axis and its marginal distribution is the ensemble's.
 *  2. **Texel centres** — texel `(x, y, z)` stores `f(((x + 0.5) / res) · L_p)`, so repeat wrapping +
 *     linear filtering reproduce the stored values exactly at centres (no half-texel phase error).
 *  3. **Post-interpolation quantile map** — trilinear filtering of a band-limited field loses the
 *     tail (at 128³ the sampled field lost ~42 % of P(v > 0.6)); the lake's hot spots, glints and
 *     crust window live in that tail. A 64-knot monotone map `M` is applied to the STORED texels and
 *     fitted iteratively so that the distribution AFTER half-float quantisation + trilinear
 *     sampling matches the analytic primitive's (`M_{n+1} = M_n ∘ (F_target⁻¹ ∘ F_sampled,n)`).
 *
 * Everything here is IEEE add/mul/floor and table lookups — no `Math.sin/cos/exp/pow` — so the
 * bake is bit-identical in Node (vitest), a Worker and the Electron main thread, and a CRC can pin
 * it. The TSL side (`makeLakeNoiseSampler`) adds a small slice shear so the repeat distance on the
 * y≈0 lake plane becomes hundreds of units instead of `L_p / scale`.
 */

// ── Calibration constants (must equal shared/odyssey-tsl-noise.js) ──────────────────────────
export const SIMPLEX_FREQ_TO_MX = 0.664;
export const SIMPLEX_REMAP_A = 0.7058;
export const SIMPLEX_REMAP_B = -0.1769;
export const SIMPLEX_REMAP_C = 0.4543;

/** Default bake: 128³ texels, lattice period 3·4 = 12 simplex units → 18.07 p-units. */
export const LAKE_BAKE_RES = 128;
export const LAKE_BAKE_K = 4;
export const QUANTILE_KNOTS = 64;

/** Period of the baked field in the lake's p-units (the argument the chapter passes to snoise3). */
export function lakeNoisePeriod(k = LAKE_BAKE_K) {
    return (3 * k) / SIMPLEX_FREQ_TO_MX;
}

// ── Ashima simplex, scalar JS port of `od_simplex3` (shared/odyssey-tsl-noise.js) ────────────

const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;
const INV289 = 1.0 / 289.0;
const NS_X = 2.0 / 7.0; // ns.x = n_ * D.w  (n_ = 1/7, D.w = 2)
const NS_Y = 0.5 / 7.0 - 1.0; // ns.y = n_ * D.y - D.z
const NS_Z = 1.0 / 7.0; // ns.z = n_ * D.z

function mod289(x) {
    return x - Math.floor(x * INV289) * 289.0;
}
function permute(x) {
    return mod289(((x * 34.0) + 1.0) * x);
}
function taylorInvSqrt(r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

/**
 * Gradient contribution of one simplex corner. `px,py,pz` is the (possibly wrapped) integer lattice
 * point; `dx,dy,dz` the offset from the corner to the sample. Returns m⁴·dot(g, d) exactly as the
 * vectorised GLSL/TSL does it per lane.
 */
function cornerContribution(px, py, pz, dx, dy, dz) {
    let m = 0.6 - (dx * dx + dy * dy + dz * dz);
    if (m <= 0) return 0;
    m *= m;
    const p = permute(permute(permute(mod289(pz)) + mod289(py)) + mod289(px));
    // Gradients: 7x7 points over a square, mapped onto an octahedron.
    const j = p - 49.0 * Math.floor(p * NS_Z * NS_Z);
    const xi = Math.floor(j * NS_Z);
    const yi = Math.floor(j - 7.0 * xi);
    const x = xi * NS_X + NS_Y;
    const y = yi * NS_X + NS_Y;
    const h = 1.0 - Math.abs(x) - Math.abs(y);
    const sh = h <= 0 ? -1.0 : 0.0; // -step(h, 0)
    const sx = Math.floor(x) * 2.0 + 1.0;
    const sy = Math.floor(y) * 2.0 + 1.0;
    const gx = x + sx * sh;
    const gy = y + sy * sh;
    const gz = h;
    const norm = taylorInvSqrt(gx * gx + gy * gy + gz * gz);
    return m * m * (gx * norm * dx + gy * norm * dy + gz * norm * dz);
}

/**
 * Wrap an integer lattice point into the fundamental box of side `L` (simplex units, L = 3k) in
 * UNSKEWED space and skew it back. Returns an integer lattice point (rounded against float error).
 */
function wrapLattice(ix, iy, iz, L, out) {
    const t = (ix + iy + iz) * G3;
    let qx = ix - t;
    let qy = iy - t;
    let qz = iz - t;
    qx -= Math.floor(qx / L) * L;
    qy -= Math.floor(qy / L) * L;
    qz -= Math.floor(qz / L) * L;
    const s = (qx + qy + qz) * F3;
    out[0] = Math.round(qx + s);
    out[1] = Math.round(qy + s);
    out[2] = Math.round(qz + s);
    return out;
}

const _w = [0, 0, 0];

/**
 * Raw Ashima simplex in ~[-1,1] at simplex-space coordinates. With `L > 0` the lattice is wrapped
 * to period `L` (must be a multiple of 3); `L = 0` is the unwrapped primitive.
 */
export function simplex3Raw(x, y, z, L = 0) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    // Corner ordering — the GLSL step/min/max idiom.
    const gx = x0 >= y0 ? 1 : 0; // step(y0, x0)
    const gy = y0 >= z0 ? 1 : 0;
    const gz = z0 >= x0 ? 1 : 0;
    const lx = 1 - gx;
    const ly = 1 - gy;
    const lz = 1 - gz;
    const i1x = Math.min(gx, lz);
    const i1y = Math.min(gy, lx);
    const i1z = Math.min(gz, ly);
    const i2x = Math.max(gx, lz);
    const i2y = Math.max(gy, lx);
    const i2z = Math.max(gz, ly);
    const x1 = x0 - i1x + G3;
    const y1 = y0 - i1y + G3;
    const z1 = z0 - i1z + G3;
    const x2 = x0 - i2x + 2.0 * G3;
    const y2 = y0 - i2y + 2.0 * G3;
    const z2 = z0 - i2z + 2.0 * G3;
    const x3 = x0 - 0.5;
    const y3 = y0 - 0.5;
    const z3 = z0 - 0.5;

    let n = 0;
    if (L > 0) {
        let w = wrapLattice(i, j, k, L, _w);
        n += cornerContribution(w[0], w[1], w[2], x0, y0, z0);
        w = wrapLattice(i + i1x, j + i1y, k + i1z, L, _w);
        n += cornerContribution(w[0], w[1], w[2], x1, y1, z1);
        w = wrapLattice(i + i2x, j + i2y, k + i2z, L, _w);
        n += cornerContribution(w[0], w[1], w[2], x2, y2, z2);
        w = wrapLattice(i + 1, j + 1, k + 1, L, _w);
        n += cornerContribution(w[0], w[1], w[2], x3, y3, z3);
    } else {
        n += cornerContribution(i, j, k, x0, y0, z0);
        n += cornerContribution(i + i1x, j + i1y, k + i1z, x1, y1, z1);
        n += cornerContribution(i + i2x, j + i2y, k + i2z, x2, y2, z2);
        n += cornerContribution(i + 1, j + 1, k + 1, x3, y3, z3);
    }
    return 42.0 * n;
}

/** The calibration remap of shared/odyssey-tsl-noise.js (Horner form of a·s + b·s³ + c·s⁵). */
export function calibrate(s) {
    const s2 = s * s;
    return s * (SIMPLEX_REMAP_A + s2 * (SIMPLEX_REMAP_B + s2 * SIMPLEX_REMAP_C));
}

/** The shipped `snoise3(p)` on the CPU (p in the chapter's units). */
export function snoise3Calibrated(px, py, pz) {
    return calibrate(simplex3Raw(px * SIMPLEX_FREQ_TO_MX, py * SIMPLEX_FREQ_TO_MX, pz * SIMPLEX_FREQ_TO_MX, 0));
}

/** The periodic twin: same statistics, period `lakeNoisePeriod(k)` p-units on every axis. */
export function snoise3CalibratedPeriodic(px, py, pz, k = LAKE_BAKE_K) {
    const L = 3 * k;
    return calibrate(simplex3Raw(px * SIMPLEX_FREQ_TO_MX, py * SIMPLEX_FREQ_TO_MX, pz * SIMPLEX_FREQ_TO_MX, L));
}

// ── Half floats (no `three` import so the worker stays light) ────────────────────────────────

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/**
 * IEEE 754 binary16 from a JS number, round-to-nearest-even. (three's DataUtils.toHalfFloat truncates;
 * the bake produces the stored bits itself, so it uses the more accurate rounding. Decoding is
 * bit-identical to DataUtils.fromHalfFloat, which is what the GPU twin depends on.)
 */
export function toHalf(value) {
    _f32[0] = value;
    const x = _u32[0];
    const sign = (x >>> 16) & 0x8000;
    let exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
    if (exp > 142) return sign | 0x7c00; // overflow → inf
    if (exp < 103) return sign; // underflow → signed zero
    if (exp < 113) { // subnormal half
        mant |= 0x800000;
        const shift = 126 - exp;
        let half = mant >> shift;
        const rem = mant & ((1 << shift) - 1);
        const halfway = 1 << (shift - 1);
        if (rem > halfway || (rem === halfway && (half & 1))) half += 1;
        return sign | half;
    }
    exp -= 112;
    let half = (exp << 10) | (mant >> 13);
    const rem = mant & 0x1fff;
    if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1; // round to nearest even
    return sign | half;
}

/** JS number from an IEEE 754 binary16. */
export function fromHalf(h) {
    const sign = (h & 0x8000) ? -1 : 1;
    const exp = (h >>> 10) & 0x1f;
    const mant = h & 0x3ff;
    if (exp === 0) return sign * mant * 2 ** -24;
    if (exp === 31) return mant ? NaN : sign * Infinity;
    return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

// ── Quantile map ─────────────────────────────────────────────────────────────────────────────

const MAP_MIN = -1.0;
const MAP_MAX = 1.0;

/** Evaluate a monotone piecewise-linear map given as knot VALUES over [MAP_MIN, MAP_MAX]. */
export function applyMap(knots, v) {
    const n = knots.length - 1;
    let u = ((v - MAP_MIN) / (MAP_MAX - MAP_MIN)) * n;
    if (u <= 0) return knots[0];
    if (u >= n) return knots[n];
    const i = Math.floor(u);
    u -= i;
    return knots[i] + (knots[i + 1] - knots[i]) * u;
}

function identityMap(knotCount) {
    const m = new Float64Array(knotCount);
    for (let i = 0; i < knotCount; i += 1) m[i] = MAP_MIN + (MAP_MAX - MAP_MIN) * (i / (knotCount - 1));
    return m;
}

/** Deterministic LCG in [0,1) — the bake must not depend on Math.random. */
export function makeRng(seed = 0x9e3779b9) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Quantile (inverse CDF) of a SORTED sample at probability u ∈ [0,1]. */
function quantileOf(sorted, u) {
    const pos = u * (sorted.length - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    if (i >= sorted.length - 1) return sorted[sorted.length - 1];
    return sorted[i] + (sorted[i + 1] - sorted[i]) * f;
}

/** Empirical CDF of a SORTED sample at value v (binary search, linear within the bin). */
function cdfOf(sorted, v) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo / sorted.length;
}

/**
 * CPU twin of the GPU sampler: half-float texels, RepeatWrapping on all axes, trilinear filter,
 * texel centres at (i + 0.5) / res. `u,v,w` are texture coordinates in [0,1) (periods).
 */
export function sampleTrilinear(texels, res, u, v, w) {
    let fx = u * res - 0.5;
    let fy = v * res - 0.5;
    let fz = w * res - 0.5;
    let x0 = Math.floor(fx);
    let y0 = Math.floor(fy);
    let z0 = Math.floor(fz);
    fx -= x0; fy -= y0; fz -= z0;
    x0 = ((x0 % res) + res) % res;
    y0 = ((y0 % res) + res) % res;
    z0 = ((z0 % res) + res) % res;
    const x1 = (x0 + 1) % res;
    const y1 = (y0 + 1) % res;
    const z1 = (z0 + 1) % res;
    const r2 = res * res;
    const t = (x, y, z) => texels[x + y * res + z * r2];
    const c00 = t(x0, y0, z0) + (t(x1, y0, z0) - t(x0, y0, z0)) * fx;
    const c10 = t(x0, y1, z0) + (t(x1, y1, z0) - t(x0, y1, z0)) * fx;
    const c01 = t(x0, y0, z1) + (t(x1, y0, z1) - t(x0, y0, z1)) * fx;
    const c11 = t(x0, y1, z1) + (t(x1, y1, z1) - t(x0, y1, z1)) * fx;
    const c0 = c00 + (c10 - c00) * fy;
    const c1 = c01 + (c11 - c01) * fy;
    return c0 + (c1 - c0) * fz;
}

/** Analytic periodic field sampled at texel centres (Float64, x fastest), in the field's own units. */
export function bakeRawTexels(res = LAKE_BAKE_RES, k = LAKE_BAKE_K) {
    const L = 3 * k; // simplex units per period
    const raw = new Float64Array(res * res * res);
    let off = 0;
    for (let z = 0; z < res; z += 1) {
        const sz = ((z + 0.5) / res) * L;
        for (let y = 0; y < res; y += 1) {
            const sy = ((y + 0.5) / res) * L;
            for (let x = 0; x < res; x += 1) {
                const sx = ((x + 0.5) / res) * L;
                raw[off] = calibrate(simplex3Raw(sx, sy, sz, L));
                off += 1;
            }
        }
    }
    return raw;
}

/** Quantise through half floats exactly as the GPU will read them. */
function quantiseHalf(src, dst) {
    for (let i = 0; i < src.length; i += 1) dst[i] = fromHalf(toHalf(src[i]));
    return dst;
}

/**
 * Fit the post-interpolation quantile map.
 * @returns {{ knots: Float64Array, iterations: number, stats: object }}
 */
export function fitQuantileMap(raw, res, {
    knots = QUANTILE_KNOTS, iterations = 4, samples = 400_000, seed = 1234, k = LAKE_BAKE_K,
} = {}) {
    // Target: the analytic periodic primitive at uniformly random points (its own marginal).
    const rng = makeRng(seed);
    const L = 3 * k;
    const target = new Float64Array(samples);
    for (let i = 0; i < samples; i += 1) target[i] = calibrate(simplex3Raw(rng() * L, rng() * L, rng() * L, L));
    target.sort();
    // Fixed sample points for the sampled distribution (same every iteration).
    const rng2 = makeRng(seed ^ 0x5bd1e995);
    const pts = new Float64Array(samples * 3);
    for (let i = 0; i < pts.length; i += 1) pts[i] = rng2();

    let map = identityMap(knots);
    const mapped = new Float64Array(raw.length);
    const quantised = new Float64Array(raw.length);
    const sampled = new Float64Array(samples);
    let stats = null;
    for (let it = 0; it < iterations; it += 1) {
        for (let i = 0; i < raw.length; i += 1) mapped[i] = applyMap(map, raw[i]);
        quantiseHalf(mapped, quantised);
        for (let i = 0; i < samples; i += 1) {
            sampled[i] = sampleTrilinear(quantised, res, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
        }
        const sortedSampled = Float64Array.from(sampled).sort();
        stats = compareDistributions(target, sortedSampled);
        if (it === iterations - 1) break;
        // Correction on SAMPLED values: y → F_target⁻¹(F_sampled(y)); compose onto the stored map.
        const next = new Float64Array(knots);
        for (let i = 0; i < knots; i += 1) {
            const y = map[i];
            next[i] = quantileOf(target, cdfOf(sortedSampled, y));
        }
        // Keep it monotone (sampling noise in the extreme tails can invert a knot).
        for (let i = 1; i < knots; i += 1) if (next[i] < next[i - 1]) next[i] = next[i - 1];
        map = next;
    }
    return { knots: map, iterations, stats };
}

function stdOf(a) {
    let s = 0;
    let s2 = 0;
    for (const v of a) { s += v; s2 += v * v; }
    const mean = s / a.length;
    return Math.sqrt(Math.max(0, s2 / a.length - mean * mean));
}
function tailFrac(sorted, t) {
    return 1 - cdfOf(sorted, t);
}

/** Side-by-side statistics of two SORTED samples (the numbers the unit test asserts). */
export function compareDistributions(targetSorted, sampledSorted) {
    const q = (a, p) => quantileOf(a, p);
    return {
        std: { target: stdOf(targetSorted), sampled: stdOf(sampledSorted) },
        p50: { target: q(targetSorted, 0.5), sampled: q(sampledSorted, 0.5) },
        p90: { target: q(targetSorted, 0.9), sampled: q(sampledSorted, 0.9) },
        p99: { target: q(targetSorted, 0.99), sampled: q(sampledSorted, 0.99) },
        p999: { target: q(targetSorted, 0.999), sampled: q(sampledSorted, 0.999) },
        pGt06: { target: tailFrac(targetSorted, 0.6), sampled: tailFrac(sampledSorted, 0.6) },
        pGt07: { target: tailFrac(targetSorted, 0.7), sampled: tailFrac(sampledSorted, 0.7) },
    };
}

// ── The bake ─────────────────────────────────────────────────────────────────────────────────

/**
 * Bake the lake noise texture data.
 * @returns {{ data: Uint16Array, res: number, k: number, periodP: number, knots: Float64Array, stats: object, crc32: number }}
 */
export function bakeLakeNoise({
    res = LAKE_BAKE_RES, k = LAKE_BAKE_K, iterations = 4, samples = 400_000,
} = {}) {
    const raw = bakeRawTexels(res, k);
    const fit = fitQuantileMap(raw, res, { iterations, samples, k });
    const data = new Uint16Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) data[i] = toHalf(applyMap(fit.knots, raw[i]));
    return {
        data, res, k, periodP: lakeNoisePeriod(k), knots: fit.knots, stats: fit.stats, crc32: crc32(data),
    };
}

/** CRC-32 (IEEE) of a Uint16Array's bytes — pins the bake across machines and runtimes. */
export function crc32(u16) {
    const bytes = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        c ^= bytes[i];
        for (let b = 0; b < 8; b += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
}
