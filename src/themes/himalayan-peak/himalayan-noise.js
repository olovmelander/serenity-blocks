/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak — Shared TSL Noise Library
 *
 * Centralized noise primitives for the AAA rebuild (terrain, sky, wind, post).
 * Sibling of electric-dreams-v3/materials/tsl-noise-lib.js — kept local to the
 * theme so terrain tuning never collides with other themes' noise.
 *
 * The hero here is `ridged2` / ridged-multifractal: the canonical "sharp alpine
 * peak" noise. Plain FBM gives rolling hills; ridging inverts + sharpens each
 * octave to carve knife-edge aretes and pointed summits.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.1.
 */
import {
    Fn,
    abs,
    cos,
    dot,
    float,
    floor,
    fract,
    mix,
    sin,
    vec2,
    vec3,
} from 'three/tsl';

// 2D hash → [0,1). Cheap lattice hash for value noise.
export const hash2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// 2D value noise (smooth-interpolated hashed lattice).
export const valueNoise2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))); // smoothstep
    const a = hash2(i);
    const b = hash2(i.add(vec2(1.0, 0.0)));
    const c = hash2(i.add(vec2(0.0, 1.0)));
    const d = hash2(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// 5-octave FBM. General-purpose detail (snow patches, rock grain, haze).
export const fbm2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(valueNoise2(p))); p.mulAssign(2.02); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise2(p))); p.mulAssign(2.03); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise2(p))); p.mulAssign(2.01); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise2(p))); p.mulAssign(2.04); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise2(p)));
    return v;
});

// Single ridged octave: 1 - |2n-1|, squared to sharpen. Peaks where noise≈0.5.
const ridgeOctave = /* @__PURE__ */ Fn(([pInput]) => {
    const n = valueNoise2(pInput).toVar();
    const r = float(1.0).sub(abs(n.mul(2.0).sub(1.0))).toVar();
    return r.mul(r); // square → sharper ridges
});

/**
 * Ridged multifractal over 2D — the alpine silhouette generator.
 * Each octave's amplitude is weighted by the previous octave so fine detail
 * rides on the big forms (multifractal), giving believable peak/valley structure
 * rather than uniform fuzz. Returns roughly [0, ~1.1].
 *
 * @param {vec2} p        domain point (pre-scaled by caller)
 * @param {float} octaves unused placeholder kept for call-site symmetry
 */
export const ridged2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const sum = float(0.0).toVar();
    const amp = float(0.5).toVar();
    const prev = float(1.0).toVar();

    // Octave 1 (big forms)
    let n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev)); prev.assign(n);
    p.mulAssign(2.07); amp.mulAssign(0.5);
    // Octave 2
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4))); prev.assign(n);
    p.mulAssign(2.11); amp.mulAssign(0.5);
    // Octave 3
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4))); prev.assign(n);
    p.mulAssign(2.03); amp.mulAssign(0.5);
    // Octave 4 (fine crags)
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4)));

    return sum;
});

// Domain warp helper — feed FBM offsets back into the input to break grid
// artifacts and give terrain organic, swept ridgelines.
export const domainWarp2 = /* @__PURE__ */ Fn(([pInput, strength]) => {
    const p = vec2(pInput).toVar();
    const wx = fbm2(p.add(vec2(0.0, 0.0)));
    const wy = fbm2(p.add(vec2(5.2, 1.3)));
    return p.add(vec2(wx, wy).sub(0.5).mul(strength));
});

// Cheap 2D rotation (camera-relative swirls / wind alignment).
export const rotate2 = /* @__PURE__ */ Fn(([v, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
});

// Cheap 3D-ish star/sparkle hash from a vec3 (used for snow glints & stars).
export const hash3to1 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});
