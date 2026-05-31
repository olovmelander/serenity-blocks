/* eslint-disable import/no-unresolved */
/**
 * Intro Animation — Shared TSL Noise Library
 *
 * Self-contained copy of the noise primitives used by the AAA intro backdrop
 * (nebula sky, dust, post). Mirrors the proven Electric Dreams V3 noise lib
 * (`src/themes/electric-dreams-v3/materials/tsl-noise-lib.js`) but lives under
 * `src/ui/` so the core intro never depends on a specific (removable) theme.
 */
import {
    Fn,
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

// 2D hash for screen-space / star-field noise.
export const hash2 = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Standard 3D value noise (trilinear interp between hashed lattice corners).
export const valueNoise3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
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
// Produces swirling, marble-like "nebula"/"smoke" patterns.
export const warpedFbm3 = Fn(([pInput, warpStrength]) => {
    const p = vec3(pInput).toVar();
    const warp = vec3(
        fbm3(p.add(vec3(0.0, 0.0, 0.0))),
        fbm3(p.add(vec3(5.2, 1.3, 0.0))),
        fbm3(p.add(vec3(0.0, 7.7, 3.1))),
    );
    return fbm3(p.add(warp.mul(warpStrength)));
});

// 2D value noise — used for the star-field threshold.
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
