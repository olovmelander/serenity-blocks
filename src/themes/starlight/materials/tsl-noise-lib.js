/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Shared TSL Noise & Color Library
 *
 * Copied from electric-dreams-v3/materials/tsl-noise-lib.js (the proven base)
 * and extended with the Starlight-specific helpers:
 *   - curlNoise3     — divergence-free flow field for the stardust river (Phase 3)
 *   - starlightRamp  — cool-blue-white → warm-cream gradient for dust/particles
 *   - blackbodyColor — star color-temperature LUT (cool red → hot blue-white)
 *
 * Keeping all noise math in one place prevents subtle divergences across the
 * nebula, starfield, stardust, meteor and post subsystems.
 */
import {
    Fn,
    cos,
    dot,
    float,
    floor,
    fract,
    mix,
    mx_noise_vec3 as mxNoiseVec3,
    sin,
    step,
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

// Cheap rotation in XY plane — used for camera-relative billboards & swirls.
export const rotate2 = Fn(([v, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
});

// ─────────────────────────────────────────────────────────────────────────
// Starlight-specific additions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Divergence-free curl noise (finite-difference of MaterialX vector noise).
 * Motes advected by this swirl in coherent eddies and never clump — the core
 * of the "living river of light" stardust look (Phase 3). `t` slowly evolves
 * the field over time. Returns a vec3 velocity direction.
 */
export const curlNoise3 = Fn(([p, t]) => {
    const eps = float(0.35);
    const tt = vec3(0.0, 0.0, t.mul(0.05));
    const sx1 = mxNoiseVec3(p.add(vec3(eps, 0.0, 0.0)).mul(0.18).add(tt));
    const sx0 = mxNoiseVec3(p.sub(vec3(eps, 0.0, 0.0)).mul(0.18).add(tt));
    const sy1 = mxNoiseVec3(p.add(vec3(0.0, eps, 0.0)).mul(0.18).add(tt));
    const sy0 = mxNoiseVec3(p.sub(vec3(0.0, eps, 0.0)).mul(0.18).add(tt));
    const sz1 = mxNoiseVec3(p.add(vec3(0.0, 0.0, eps)).mul(0.18).add(tt));
    const sz0 = mxNoiseVec3(p.sub(vec3(0.0, 0.0, eps)).mul(0.18).add(tt));
    const dx = sx1.sub(sx0);
    const dy = sy1.sub(sy0);
    const dz = sz1.sub(sz0);
    return vec3(
        dy.z.sub(dz.y),
        dz.x.sub(dx.z),
        dx.y.sub(dy.x),
    ).div(eps.mul(2.0));
});

/**
 * Stardust color ramp: cool blue-white (cold motes) → warm cream (warm motes).
 * `t` in [0,1].
 */
export const starlightRamp = Fn(([tInput]) => {
    const t = tInput.clamp(0.0, 1.0);
    const cool = vec3(0.75, 0.85, 1.0);
    const warm = vec3(1.0, 0.91, 0.76);
    return mix(cool, warm, t);
});

/**
 * Star color-temperature LUT. `t` in [0,1]:
 *   0.0 → cool red (#FFB48A), 0.4 → gold (#FFD9A8),
 *   0.7 → white (#FFF6E8),    1.0 → hot blue-white (#CFE0FF).
 * Piecewise-linear across three temperature segments.
 */
export const blackbodyColor = Fn(([tInput]) => {
    const t = tInput.clamp(0.0, 1.0).toVar();
    const cRed = vec3(1.0, 0.70, 0.54);
    const cGold = vec3(1.0, 0.85, 0.66);
    const cWhite = vec3(1.0, 0.96, 0.91);
    const cBlue = vec3(0.81, 0.88, 1.0);
    const seg1 = mix(cRed, cGold, t.div(0.4).clamp(0.0, 1.0));
    const seg2 = mix(cGold, cWhite, t.sub(0.4).div(0.3).clamp(0.0, 1.0));
    const seg3 = mix(cWhite, cBlue, t.sub(0.7).div(0.3).clamp(0.0, 1.0));
    const lower = mix(seg1, seg2, step(0.4, t));
    return mix(lower, seg3, step(0.7, t));
});
