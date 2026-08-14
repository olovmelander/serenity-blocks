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
 * `snoise3` is a simplex-family stand-in (three's built-in MaterialX gradient noise)
 * for the four chapters whose private inline noise was Ashima `snoise` rather than the
 * od_* value noise — it returns ~[-1,1] like classic simplex.
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
    mix,
    mx_noise_float as mxNoiseFloat,
    normalize,
    vec2,
    vec3,
} from 'three/tsl';

// ── Hashes (mirror od_hash21 / od_hash31 / od_hash33) ───────────────────────────

/** vec2 → [0,1) scalar hash (od_hash21). */
export const hash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
});

/** vec3 → [0,1) scalar hash (od_hash31). */
export const hash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(vec3(pIn).mul(0.1031)).toVar();
    p.addAssign(dot(p, p.zyx.add(31.32)));
    return fract(p.x.add(p.y).mul(p.z));
});

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
});

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
});

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

/**
 * Simplex-family gradient noise in ~[-1,1] — the TSL stand-in for the Ashima `snoise`
 * used by earth-core / deep-ocean / mountain-peaks / surface-world. Backed by three's
 * built-in MaterialX noise so it compiles on both backends.
 */
export function snoise3(pInput) {
    return mxNoiseFloat(vec3(pInput));
}
