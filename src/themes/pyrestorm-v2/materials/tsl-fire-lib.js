/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Shared TSL Fire/Noise Library
 *
 * Centralized noise + color primitives for the volcanic theme: sky nebula,
 * lava flow, rock, embers, post. Keeping them in one place avoids the
 * divergent-noise-math problem of the old single-file WebGL theme.
 *
 * Core noise (hash/value/fbm/warp) is the same family as electric-dreams-v3's
 * tsl-noise-lib; the fire-specific helpers (heatRamp, hemispheric light) are
 * new here. Worley/Voronoi crust + curl noise are added in later phases
 * (lava-ground / eruption sim) to keep this file buildable per-phase.
 */
import {
    Fn,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    sin,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';

// ── Hashes ───────────────────────────────────────────────────────────────────
// 3D hash → scalar [0,1). Cheap, good enough for lattice noise.
export const hash3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});

// 2D hash for screen-space / star noise.
export const hash2 = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// ── Value noise ────────────────────────────────────────────────────────────--
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

// ── FBM ────────────────────────────────────────────────────────────────────--
// 4-octave fractal Brownian motion (3D). Returns ~[0,1].
export const fbm3 = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.02); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.03); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p))); p.mulAssign(2.01); a.mulAssign(0.5);
    v.addAssign(a.mul(valueNoise3(p)));
    return v;
});

// Domain-warped FBM — feeds FBM output back into its own input for the swirling,
// advected, marble-like patterns that read as "nebula", "smoke", or "lava flow".
// (Iñigo Quílez domain warping.)
export const warpedFbm3 = Fn(([pInput, warpStrength]) => {
    const p = vec3(pInput).toVar();
    const warp = vec3(
        fbm3(p.add(vec3(0.0, 0.0, 0.0))),
        fbm3(p.add(vec3(5.2, 1.3, 0.0))),
        fbm3(p.add(vec3(0.0, 7.7, 3.1))),
    );
    return fbm3(p.add(warp.mul(warpStrength)));
});

// ── Worley / Voronoi (cellular) ───────────────────────────────────────────────
// Returns vec2(F1, F2): distance to the nearest and 2nd-nearest feature points.
// (F2 - F1) is small on cell borders → glowing-crack masks for cooled basalt.
// The 3×3 neighbourhood is unrolled at graph-build time via plain JS loops.
export const worley2 = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const ip = floor(p).toVar();
    const fp = fract(p).toVar();
    const f1 = float(8.0).toVar();
    const f2 = float(8.0).toVar();
    for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
            const o = vec2(float(x), float(y));
            const cell = ip.add(o);
            const feature = vec2(hash2(cell), hash2(cell.add(vec2(37.0, 17.0))));
            const diff = o.add(feature).sub(fp);
            const d = dot(diff, diff); // squared distance is fine for ordering
            const newF1 = min(f1, d);
            const newF2 = min(max(f1, d), f2); // 2nd-smallest (uses old f1)
            f1.assign(newF1);
            f2.assign(newF2);
        }
    }
    return vec2(sqrt(f1), sqrt(f2));
});

// ── Fire-specific helpers ────────────────────────────────────────────────────
// Blackbody-ish temperature ramp: cold crust → dull red → orange → white-hot.
// Returns HDR values (>1) in the hot range so selective bloom can pick it up.
export const heatRamp = Fn(([tInput]) => {
    const t = clamp(tInput, 0.0, 1.0).toVar();
    const cCrust = vec3(0.015, 0.008, 0.010); // cooled basalt
    const cDull = vec3(0.55, 0.06, 0.01); // dull red
    const cOrange = vec3(1.7, 0.42, 0.04); // bright orange (HDR)
    const cHot = vec3(3.2, 1.6, 0.55); // yellow-white hot (HDR)
    const a = mix(cCrust, cDull, smoothstep(0.0, 0.32, t));
    const b = mix(a, cOrange, smoothstep(0.30, 0.68, t));
    return mix(b, cHot, smoothstep(0.66, 1.0, t));
});

// Hemispheric ambient: cool sky tint from above, warm ground bounce from below.
// `nWorldY` is the surface normal's world-space Y in [-1,1].
export const hemispheric = Fn(([nWorldY, skyColor, groundColor]) => {
    const t = clamp(nWorldY.mul(0.5).add(0.5), 0.0, 1.0);
    return mix(groundColor, skyColor, t);
});

// Cheap 2D rotation — billboards / swirl advection.
export const rotate2 = Fn(([v, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
});
