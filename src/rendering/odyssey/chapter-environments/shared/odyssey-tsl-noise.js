/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey shared TSL noise primitives — the WebGPU twin of odyssey-noise.js
 *
 * Part of the Odyssey AAA WebGPU migration (P2). See docs/ODYSSEY_AAA_MASTER_PLAN.md §3.4.
 *
 * This is a faithful TSL port of the GLSL vocabulary in ./odyssey-noise.js: the same
 * hash constants, the same value-noise lattice, and the same FBM lacunarity/octave
 * counts (fbm2 @2.02, fbm3 @2.03, ridged3 @2.05, all 5 octaves) so a chapter shader
 * converted GLSL→TSL keeps its look. Leaf primitives are `Fn`-wrapped (reused, no
 * graph bloat); the octave builders (fbm2/fbm3/ridged3/curl3) are plain JS so the
 * octave count can vary per call site.
 *
 * `snoise3` is a TSL port of the Ashima simplex `snoise` the four chapters' private
 * inline GLSL used (earth-core / deep-ocean / mountain-peaks / surface-world), ~[-1,1].
 * It replaced three's `mx_noise_float` stand-in on 2026-08-21: MaterialX's integer-hash
 * Perlin made the D3D compiler take 7 s on ONE lava-lake pipeline (see `simplex3` below).
 *
 * NodeMaterials built from these run on BOTH the WebGPU backend (WGSL) and the
 * automatic WebGL2 fallback backend (GLSL) of WebGPURenderer — one codebase, both
 * backends. Unlike odyssey-noise.js (THREE-free strings), this imports real TSL nodes.
 */

import {
    Fn,
    abs,
    dot,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    mx_noise_float as mxNoiseFloat,
    normalize,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

// ── Hashes (mirror od_hash21 / od_hash31 / od_hash33) ───────────────────────────

/** vec2 → [0,1) scalar hash (od_hash21). */
export const hash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'od_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) scalar hash (od_hash31). */
export const hash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(vec3(pIn).mul(0.1031)).toVar();
    p.addAssign(dot(p, p.zyx.add(31.32)));
    return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'od_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Value noise (mirror od_noise2 / od_noise3) ──────────────────────────────────

/** Smooth 2D value noise in ~[0,1]. */
export const noise2 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = hash21(i.add(vec2(0.0, 0.0)));
    const b = hash21(i.add(vec2(1.0, 0.0)));
    const c = hash21(i.add(vec2(0.0, 1.0)));
    const d = hash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'od_noise2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Smooth 3D value noise in ~[0,1]. */
export const noise3 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const n000 = hash31(i.add(vec3(0.0, 0.0, 0.0)));
    const n100 = hash31(i.add(vec3(1.0, 0.0, 0.0)));
    const n010 = hash31(i.add(vec3(0.0, 1.0, 0.0)));
    const n110 = hash31(i.add(vec3(1.0, 1.0, 0.0)));
    const n001 = hash31(i.add(vec3(0.0, 0.0, 1.0)));
    const n101 = hash31(i.add(vec3(1.0, 0.0, 1.0)));
    const n011 = hash31(i.add(vec3(0.0, 1.0, 1.0)));
    const n111 = hash31(i.add(vec3(1.0, 1.0, 1.0)));
    const x1 = mix(n000, n100, u.x);
    const x2 = mix(n010, n110, u.x);
    const x3 = mix(n001, n101, u.x);
    const x4 = mix(n011, n111, u.x);
    return mix(mix(x1, x2, u.y), mix(x3, x4, u.y), u.z);
}).setLayout({ name: 'od_noise3', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── FBM / ridged / curl (plain JS builders, mirror odyssey-noise constants) ─────

/** Fractal Brownian motion over 2D value noise (rot+2.02, like GLSL fbm2). */
export function fbm2(pInput, octaves = 5) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let p = vec2(pInput);
    for (let i = 0; i < octaves; i += 1) {
        value = value.add(noise2(p).mul(amplitude));
        // rot * p * 2.02 ; rot = mat2(0.80, 0.60, -0.60, 0.80)
        const rx = p.x.mul(0.80).add(p.y.mul(-0.60));
        const ry = p.x.mul(0.60).add(p.y.mul(0.80));
        p = vec2(rx, ry).mul(2.02);
        amplitude = amplitude.mul(0.5);
    }
    return value;
}

/** Fractal Brownian motion over 3D value noise (lacunarity 2.03, like GLSL fbm3). */
export function fbm3(pInput, octaves = 5, n = noise3) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = vec3(pInput);
    for (let i = 0; i < octaves; i += 1) {
        value = value.add(n(coord).mul(amplitude));
        coord = coord.mul(2.03);
        amplitude = amplitude.mul(0.5);
    }
    return value;
}

/** Ridged multifractal — sharp filaments/crests (lacunarity 2.05, like GLSL ridged3). */
export function ridged3(pInput, octaves = 5, n = noise3) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = vec3(pInput);
    for (let i = 0; i < octaves; i += 1) {
        const fold = float(1.0).sub(abs(n(coord).mul(2.0).sub(1.0)));
        value = value.add(amplitude.mul(fold).mul(fold));
        coord = coord.mul(2.05);
        amplitude = amplitude.mul(0.5);
    }
    return value;
}

/** Divergence-free-ish curl of FBM, for swirling particle/accretion flow (like od_curl3). */
export function curl3(pInput) {
    const e = 0.18;
    const p = vec3(pInput);
    const dx = vec3(e, 0.0, 0.0);
    const dy = vec3(0.0, e, 0.0);
    const dz = vec3(0.0, 0.0, e);
    const x1 = fbm3(p.add(dy)).sub(fbm3(p.sub(dy)));
    const x2 = fbm3(p.add(dz)).sub(fbm3(p.sub(dz)));
    const y1 = fbm3(p.add(dz)).sub(fbm3(p.sub(dz)));
    const y2 = fbm3(p.add(dx)).sub(fbm3(p.sub(dx)));
    const z1 = fbm3(p.add(dx)).sub(fbm3(p.sub(dx)));
    const z2 = fbm3(p.add(dy)).sub(fbm3(p.sub(dy)));
    return normalize(
        vec3(x1.sub(x2), y1.sub(y2), z1.sub(z2)).div(2.0 * e).add(1e-5),
    );
}

// ── Simplex noise (Ashima / Stefan Gustavson `snoise`, TSL port) ────────────────
//
// WHY NOT three's `mx_noise_float` (the previous stand-in): MaterialX Perlin hashes the
// lattice with an INTEGER Bob-Jenkins mix (8 corner hashes × 7 bit-rotates per sample).
// Once the D3D shader compiler inlines that, pipeline-compile time grows superlinearly
// with the number of evaluations: the earth-core lava lake (20 evaluations, 16 KB WGSL)
// took **7.3 s** to compile on an RTX 3070 / Chrome 151 / DXC under r185 — the single
// longest pole of the whole Odyssey cold start (r185's `select()` emission of mx_select
// doubled what r181's if/else shape cost; 3.9 s there). The identical shader with the
// noise body swapped measured: Ashima simplex **0.98 s**, float-hash value noise 0.42 s,
// baked texture 0.14 s (docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md §1.3).
//
// Simplex is the same class (gradient noise, ~[-1,1], similar spectrum) and is what the
// chapters' original GLSL used, so thresholds tuned against `snoise` keep their meaning.
// Pure float math: no integer/bit ops → compiles on both backends, cheaper at runtime too
// (4 corners vs 8).

// NOTE: every Fn here carries a `setLayout` — without one TSL INLINES the body at each call
// site (a layout-less Fn is an inline function), which is how a 20-evaluation lake fragment
// became 113 KB of straight-line WGSL. With layouts they are emitted once as real WGSL `fn`s.
const mod289v3 = /* @__PURE__ */ Fn(([x]) => x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0)))
    .setLayout({ name: 'od_mod289v3', type: 'vec3', inputs: [{ name: 'x', type: 'vec3' }] });
const mod289v4 = /* @__PURE__ */ Fn(([x]) => x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0)))
    .setLayout({ name: 'od_mod289v4', type: 'vec4', inputs: [{ name: 'x', type: 'vec4' }] });
const permute4 = /* @__PURE__ */ Fn(([x]) => mod289v4(x.mul(34.0).add(1.0).mul(x)))
    .setLayout({ name: 'od_permute4', type: 'vec4', inputs: [{ name: 'x', type: 'vec4' }] });
const taylorInvSqrt4 = /* @__PURE__ */ Fn(([r]) => float(1.79284291400159).sub(r.mul(0.85373472095314)))
    .setLayout({ name: 'od_taylorInvSqrt4', type: 'vec4', inputs: [{ name: 'r', type: 'vec4' }] });

/** Ashima 3D simplex noise in ~[-1,1]. */
export const simplex3 = /* @__PURE__ */ Fn(([vIn]) => {
    const v = vec3(vIn).toVar();
    const C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    const i = floor(v.add(dot(v, C.yyy))).toVar();
    const x0 = v.sub(i).add(dot(i, C.xxx)).toVar();

    // Other corners
    const g = step(x0.yzx, x0.xyz).toVar();
    const l = float(1.0).sub(g).toVar();
    const i1 = min(g.xyz, l.zxy).toVar();
    const i2 = max(g.xyz, l.zxy).toVar();
    const x1 = x0.sub(i1).add(C.xxx).toVar();
    const x2 = x0.sub(i2).add(C.yyy).toVar();
    const x3 = x0.sub(D.yyy).toVar();

    // Permutations
    i.assign(mod289v3(i));
    const p = permute4(
        permute4(
            permute4(vec4(0.0, i1.z, i2.z, 1.0).add(i.z))
                .add(i.y).add(vec4(0.0, i1.y, i2.y, 1.0)),
        ).add(i.x).add(vec4(0.0, i1.x, i2.x, 1.0)),
    ).toVar();

    // Gradients: 7x7 points over a square, mapped onto an octahedron.
    const nScale = float(0.142857142857); // 1/7
    const ns = D.wyz.mul(nScale).sub(D.xzx).toVar();
    const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0)).toVar(); // mod(p, 7*7)
    const xi = floor(j.mul(ns.z)).toVar();
    const yi = floor(j.sub(xi.mul(7.0))).toVar(); // mod(j, N)
    const x = xi.mul(ns.x).add(ns.yyyy).toVar();
    const y = yi.mul(ns.x).add(ns.yyyy).toVar();
    const h = float(1.0).sub(abs(x)).sub(abs(y)).toVar();
    const b0 = vec4(x.xy, y.xy).toVar();
    const b1 = vec4(x.zw, y.zw).toVar();
    const s0 = floor(b0).mul(2.0).add(1.0).toVar();
    const s1 = floor(b1).mul(2.0).add(1.0).toVar();
    const sh = step(h, vec4(0.0)).negate().toVar();
    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy)).toVar();
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww)).toVar();
    const p0 = vec3(a0.xy, h.x).toVar();
    const p1 = vec3(a0.zw, h.y).toVar();
    const p2 = vec3(a1.xy, h.z).toVar();
    const p3 = vec3(a1.zw, h.w).toVar();

    // Normalise gradients
    const norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))).toVar();
    p0.mulAssign(norm.x);
    p1.mulAssign(norm.y);
    p2.mulAssign(norm.z);
    p3.mulAssign(norm.w);

    // Mix final noise value
    const m = max(float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0.0).toVar();
    m.assign(m.mul(m));
    return dot(m.mul(m), vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))).mul(42.0);
}).setLayout({ name: 'od_simplex3', type: 'float', inputs: [{ name: 'vIn', type: 'vec3' }] });

// A/B lever (dev URL only, same shape as `?earthCoreBakeNoise`): `?odysseySimplex=0` routes
// `snoise3` back through three's MaterialX Perlin so a seeked camera station can be captured
// under both primitives. Default ON; not a shipped switch.
function _readSimplexFlag() {
    if (typeof window === 'undefined') return true;
    try {
        const url = new URLSearchParams(window.location.search).get('odysseySimplex');
        if (url === '0') return false;
    } catch { /* URL unavailable — default */ }
    return true;
}
const USE_SIMPLEX = _readSimplexFlag();

// CALIBRATION to `mx_noise_float`'s distribution, so every chapter threshold tuned against the
// MaterialX stand-in keeps its meaning. Measured on the CPU over 600k samples (scratch
// `noise-stats.mjs` / `noise-quantiles.mjs`, ports of both primitives):
//   frequency — mx 0.819 zero-crossings per unit vs raw simplex 1.234 → input × 0.664;
//   amplitude — a plain linear scale matched the std (0.265) but NOT the shape: simplex is
//     flatter-topped than Perlin, so the linear fit squashed the upper tail (p99.9 0.61 vs
//     mx 0.71) and every upper-tail term — the lake's `pow(noise, 4)` hot-spots, the
//     `smoothstep(0.62, 0.70)` glints, the 0.60–0.90 crust window — lost its pale-yellow
//     pools. A tail-weighted odd quintic
//     quantile map fixes the shape: v' = 0.7058·v − 0.1769·v³ + 0.4543·v⁵ (monotone on [0,1],
//     f(1) = 0.98). Result vs mx: std 0.2656 / 0.2650; quantiles within ~1 % from p50 to
//     p99.99 (0.826 vs 0.817); P(v>0.6) 0.0073 / 0.0072; P(v>0.7) 0.0012 / 0.0012.
//   Verified in-game: 15 of 16 frozen-clock chapter stations within ±1.5 % luminance under both
//   primitives; the Earth Core entry station differs by realization (the flowing field under a
//   low camera), with the sign flipping across clocks — not a bias (plan §2.2).
const SIMPLEX_FREQ_TO_MX = 0.664;
const SIMPLEX_REMAP_A = 0.7058;
const SIMPLEX_REMAP_B = -0.1769;
const SIMPLEX_REMAP_C = 0.4543;

const snoise3Calibrated = /* @__PURE__ */ Fn(([p]) => {
    const s = simplex3(vec3(p).mul(SIMPLEX_FREQ_TO_MX)).toVar();
    const s2 = s.mul(s);
    // Horner form of a·s + b·s³ + c·s⁵
    return s.mul(float(SIMPLEX_REMAP_A).add(s2.mul(float(SIMPLEX_REMAP_B).add(s2.mul(SIMPLEX_REMAP_C)))));
}).setLayout({ name: 'od_snoise3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/**
 * Simplex-family gradient noise in ~[-1,1] with `mx_noise_float`'s distribution (see above) —
 * the `snoise` used by earth-core / deep-ocean / mountain-peaks / surface-world.
 */
export function snoise3(pInput) {
    if (!USE_SIMPLEX) return mxNoiseFloat(vec3(pInput));
    return snoise3Calibrated(vec3(pInput));
}

/**
 * three's MaterialX Perlin noise, kept under an explicit name for A/B and for the baked-noise
 * generator's distribution notes. Do NOT use for new chapter shaders — its integer hash is
 * the compile-time pathology documented above.
 */
export function mxPerlin3(pInput) {
    return mxNoiseFloat(vec3(pInput));
}
