/**
 * Chromatic Impasto — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; such helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    paint's grain is hash-without-sine value noise;
 *  - per-stroke values reach the fragment stage as interpolated varyings, so anything hashed is
 *    an INTEGER, rounded again in the shader.
 */

import {
    Fn,
    abs,
    cos,
    cross,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';

export * from './chromatic-impasto-core.js';

// ── Hashes ──────────────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const ciHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ci_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/**
 * 1D value noise along `x` on track `row` (an integer): what one bristle does along its stroke.
 */
export const ciTrack = /* @__PURE__ */ Fn(([x, row]) => {
    const i = floor(x);
    const f = fract(x);
    const s = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    return mix(ciHash21(vec2(i, row)), ciHash21(vec2(i.add(1.0), row)), s);
}).setLayout({
    name: 'ci_track',
    type: 'float',
    inputs: [{ name: 'x', type: 'float' }, { name: 'row', type: 'float' }],
});

/** 2D value noise in [0, 1]. */
export const ciNoise2 = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const s = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0)));
    const a = ciHash21(i);
    const b = ciHash21(i.add(vec2(1.0, 0.0)));
    const c = ciHash21(i.add(vec2(0.0, 1.0)));
    const d = ciHash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}).setLayout({ name: 'ci_noise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const ciLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const ciMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * A rectangular soft box in direction `dir`, seen in the mirror direction `r`: 1 inside the
 * glass, less on the glazing bars, 0 outside. `size` = half-extents in tangent units.
 */
export const ciSoftBox = (r, dir, size, soft, bars) => {
    const t1 = normalize(cross(vec3(0.0, 0.0, 1.0), dir));
    const t2 = cross(dir, t1);
    const dz = dot(r, dir);
    const inv = float(1.0).div(max(dz, 0.05));
    const a = dot(r, t1).mul(inv);
    const b = dot(r, t2).mul(inv);
    const rect = float(1.0).sub(smoothstep(size.x.sub(soft), size.x.add(soft), abs(a)))
        .mul(float(1.0).sub(smoothstep(size.y.sub(soft), size.y.add(soft), abs(b))))
        .mul(step(0.05, dz));
    if (!bars) return rect;
    const bar = smoothstep(0.02, float(0.02).add(soft.mul(0.6)), abs(a))
        .mul(smoothstep(0.02, float(0.02).add(soft.mul(0.6)), abs(b)));
    return rect.mul(bar.mul(0.7).add(0.3));
};

/**
 * A canvas point (canvas units, y up) as a coordinate in the paint targets. A render target's
 * v = 0 is its TOP row on both backends (three flips WebGL's for us), so y is turned over.
 */
export const ciCanvasUv = (q, half) => vec2(
    q.x.div(half.x.mul(2.0)).add(0.5),
    float(0.5).sub(q.y.div(half.y.mul(2.0))),
);

// ── The cloth ───────────────────────────────────────────────────────────────────

/** Threads per canvas unit (the frame is two units tall). */
export const WEAVE_PITCH = 92;

/**
 * Plain-weave linen: the height of the cloth at a canvas point, in [0, 1]. Warp and weft pass
 * over each other on a checker; every thread has its own thickness.
 */
export const ciWeave = /* @__PURE__ */ Fn(([p]) => {
    const q = p.mul(WEAVE_PITCH);
    const cell = floor(q);
    const f = fract(q);
    const over = fract(cell.x.add(cell.y).mul(0.5)).mul(2.0); // 0 or 1: which thread is on top
    const across = mix(f.x, f.y, over);
    const along = mix(f.y, f.x, over);
    const thread = mix(cell.x, cell.y.add(511.0), over);
    const slub = ciHash21(vec2(thread, over.mul(7.0).add(3.0)));
    const bump = sin(across.mul(Math.PI)).mul(sin(along.mul(Math.PI)).mul(0.45).add(0.55));
    return bump.mul(slub.mul(0.5).add(0.6));
}).setLayout({ name: 'ci_weave', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// ── The twist ───────────────────────────────────────────────────────────────────

/** The stirring's falloff with distance from the board (0..1). Mirrors core.twistProfile. */
export const ciTwistProfile = /* @__PURE__ */ Fn(([k]) => {
    const rise = smoothstep(0.0, 0.22, k);
    const fall = float(1.0).sub(smoothstep(0.3, 1.0, k));
    return rise.mul(fall).mul(fall);
}).setLayout({ name: 'ci_twistProfile', type: 'float', inputs: [{ name: 'k', type: 'float' }] });

/**
 * A display point carried through the twist to where its paint lies.
 * `twist` = (centre.x, centre.y, angle, reach). Returns the point and, for neighbouring taps, the
 * rotation (cos, sin) and the shear term: tapPoint = q + R·δ + shear · dot(r̂, δ) · perp(q − c).
 */
export const ciTwist = (p, twist) => {
    const c = twist.xy;
    const rel = p.sub(c);
    const r = length(rel);
    const k = r.div(max(twist.w, 1e-4));
    const prof = ciTwistProfile(k);
    const a = twist.z.mul(prof);
    const ca = cos(a);
    const sa = sin(a);
    const rot = vec2(rel.x.mul(ca).sub(rel.y.mul(sa)), rel.x.mul(sa).add(rel.y.mul(ca)));
    const dProf = ciTwistProfile(k.add(0.01)).sub(prof).mul(100.0);
    const shear = twist.z.mul(dProf).div(max(twist.w, 1e-4));
    return {
        point: c.add(rot),
        cosA: ca,
        sinA: sa,
        shear,
        radial: rel.div(max(r, 1e-4)),
        perp: vec2(rot.y.negate(), rot.x),
    };
};

/** A tap offset δ (display space) carried through the twist found by ciTwist. */
export const ciTwistTap = (tw, delta) => {
    const turned = vec2(
        delta.x.mul(tw.cosA).sub(delta.y.mul(tw.sinA)),
        delta.x.mul(tw.sinA).add(delta.y.mul(tw.cosA)),
    );
    return turned.add(tw.perp.mul(tw.shear.mul(dot(tw.radial, delta))));
};
