/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 — Shared TSL Noise Library
 *
 * Centralized noise primitives for the AAA rebuild (sky, cloud sea, terrain,
 * glints). Sibling of `himalayan-peak/himalayan-noise.js` — kept local to the
 * theme so Sky's painterly tuning never collides with other themes' noise.
 *
 * `valueNoise2`/`fbm2` drive the painterly sky gradient break, cloud-deck
 * displacement, and meadow detail; `ridged2` shapes the (soft) valley terrain;
 * `worley2` gives the cloud sea its cauliflower billow read.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §3.1.
 */
import {
    Fn,
    abs,
    cos,
    dot,
    float,
    floor,
    fract,
    max,
    min,
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

// 5-octave FBM. General-purpose detail (painterly sky break, haze, meadow grain).
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

// Single ridged octave: 1 - |2n-1|, squared to sharpen.
const ridgeOctave = /* @__PURE__ */ Fn(([pInput]) => {
    const n = valueNoise2(pInput).toVar();
    const r = float(1.0).sub(abs(n.mul(2.0).sub(1.0))).toVar();
    return r.mul(r);
});

/**
 * Ridged multifractal over 2D — the valley silhouette generator. Tuned soft for
 * Sky (rolling cloud-islands / sunlit shoulder), not knife-edge aretes; the
 * caller scales amplitude down. Returns roughly [0, ~1.1].
 */
export const ridged2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const sum = float(0.0).toVar();
    const amp = float(0.5).toVar();
    const prev = float(1.0).toVar();

    let n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev)); prev.assign(n);
    p.mulAssign(2.07); amp.mulAssign(0.5);
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4))); prev.assign(n);
    p.mulAssign(2.11); amp.mulAssign(0.5);
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4))); prev.assign(n);
    p.mulAssign(2.03); amp.mulAssign(0.5);
    n = ridgeOctave(p).toVar();
    sum.addAssign(n.mul(amp).mul(prev.mul(0.6).add(0.4)));

    return sum;
});

// 2D Worley / cellular noise → cauliflower billows for the cloud sea.
// Returns the distance to the nearest feature point in [0, ~1.4].
export const worley2 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const ip = floor(p).toVar();
    const fp = fract(p).toVar();
    const minDist = float(1.5).toVar();
    for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
            const g = vec2(float(x), float(y));
            const o = vec2(
                hash2(ip.add(g)),
                hash2(ip.add(g).add(vec2(19.7, 7.3))),
            );
            const r = g.add(o).sub(fp);
            minDist.assign(min(minDist, dot(r, r)));
        }
    }
    return max(float(0.0), minDist.sqrt());
});

// Domain warp — feed FBM offsets back in to break grid artifacts.
export const domainWarp2 = /* @__PURE__ */ Fn(([pInput, strength]) => {
    const p = vec2(pInput).toVar();
    const wx = fbm2(p.add(vec2(0.0, 0.0)));
    const wy = fbm2(p.add(vec2(5.2, 1.3)));
    return p.add(vec2(wx, wy).sub(0.5).mul(strength));
});

// Cheap 2D rotation.
export const rotate2 = /* @__PURE__ */ Fn(([v, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
});

// Cheap 3D-ish sparkle hash (glints & stars).
export const hash3to1 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});
