/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Shared TSL Noise Library
 *
 * Centralized noise primitives used across nebula, fluid, lighting, and post.
 * Keeping them in one place prevents the V2 mistake of duplicating noise math
 * across five different files with subtle divergences.
 */
import {
    Fn,
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

// 3D hash → scalar [0,1). Cheap, good enough for noise lookup.
export const hash3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});

// 2D hash for screen-space noise.
export const hash2 = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Standard 3D value noise (linear interpolation between hashed lattice corners).
export const valueNoise3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    // Smoothstep: 3x^2 - 2x^3
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash3(i);
    const b = hash3(i.add(vec3(1.0, 0.0, 0.0)));
    const c = hash3(i.add(vec3(0.0, 1.0, 0.0)));
    const d = hash3(i.add(vec3(1.0, 1.0, 0.0)));
    const e = hash3(i.add(vec3(0.0, 0.0, 1.0)));
    const f1 = hash3(i.add(vec3(1.0, 0.0, 1.0)));
    const g = hash3(i.add(vec3(0.0, 1.0, 1.0)));
    const h = hash3(i.add(vec3(1.0, 1.0, 1.0)));

    const x1 = mix(a, b, u.x);
    const x2 = mix(c, d, u.x);
    const x3 = mix(e, f1, u.x);
    const x4 = mix(g, h, u.x);
    const y1 = mix(x1, x2, u.y);
    const y2 = mix(x3, x4, u.y);
    return mix(y1, y2, u.z);
});

// 4-octave FBM. Tuned for nebula-scale features (slow drift, soft edges).
export const fbm3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p)));
    return v;
});

// Domain-warped FBM — feeds FBM output back into its own input.
// Produces the swirling, marble-like patterns that read as "nebula" or "smoke".
export const warpedFbm3 = Fn(([pInput, warpStrength]) => {
    const p = vec3(pInput).toVar();
    const warp = vec3(
        fbm3(p.add(vec3(0.0, 0.0, 0.0))),
        fbm3(p.add(vec3(5.2, 1.3, 0.0))),
        fbm3(p.add(vec3(0.0, 7.7, 3.1))),
    );
    return fbm3(p.add(warp.mul(warpStrength)));
});

// 2D variant of value noise — used for star-field and screen-space dither.
export const valueNoise2 = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = hash2(i);
    const b = hash2(i.add(vec2(1.0, 0.0)));
    const c = hash2(i.add(vec2(0.0, 1.0)));
    const d = hash2(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Smooth minimum (polynomial form). Used for SDF metaball fusion in fluid surface.
// k=0 → hard min (regular union). k>0 → smooth blend, larger k = softer.
export const smin = Fn(([a, b, k]) => {
    const h = float(0.5).add(float(0.5).mul(b.sub(a)).div(k)).toVar();
    const hClamped = h.clamp(0.0, 1.0);
    return mix(b, a, hClamped).sub(k.mul(hClamped).mul(float(1.0).sub(hClamped)));
});

// 3-color iridescent ramp. Maps thickness/depth into a perceptually smooth
// purple → magenta → cyan gradient. Used by fluid SSFR and satellite blobs.
export const iridescentRamp = Fn(([t]) => {
    const c0 = vec3(0.10, 0.04, 0.25); // deep purple
    const c1 = vec3(0.85, 0.27, 0.94); // vibrant magenta
    const c2 = vec3(0.02, 0.71, 0.83); // electric cyan
    const tt = t.clamp(0.0, 1.0).toVar();
    const a = mix(c0, c1, tt.mul(2.0).clamp(0.0, 1.0));
    const b = mix(c1, c2, tt.sub(0.5).mul(2.0).clamp(0.0, 1.0));
    return mix(a, b, tt);
});

// Cheap rotation in XY plane — used for camera-relative billboards & swirls.
export const rotate2 = Fn(([v, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
});
