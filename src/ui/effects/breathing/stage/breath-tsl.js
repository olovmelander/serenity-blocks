/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Shared TSL for the breathing worlds (three r186; WebGPU and the WebGL2 backend).
 *
 * A world paints its sky and ground on one backdrop quad and may add real geometry on top.
 * Everything a world needs to follow the breath comes through one uniform bundle:
 *
 *   breath     lung fill 0..1 (eased; 1 = full)      phase   0 in, 1 full hold, 2 out, 3 empty hold
 *   phaseT     progress through the phase 0..1       breathInt  integral of breath (breath-paced flow)
 *   time       scene seconds; frozen under reduced motion, slowed while a session holds still
 *   calm       0..1, how still the scene should be (retention, integration)
 *   ext        half extents of the screen; the short axis is always 1
 *   focus      how far above screen centre the hero sits, in the same units
 *   px         one device pixel in those units (pixel-stable edges and stars)
 *
 * Backdrop space `p`: origin on the hero, y up, short screen axis spans -1..1. The stage camera
 * maps the z = 0 plane onto exactly that space, so meshes and painted light line up.
 *
 * Every helper carries a `setLayout`: without one TSL inlines the body at each call site.
 *
 * Never let a masked-out term grow without bound (an `exp` of a signed distance, say): `mix`
 * may be evaluated as a + (b - a) * t, and a huge `a` cancels the other side to black even at t = 1.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, clamp, dot, exp, float, floor, fract, length, mix, pow, sin, smoothstep, step, uniform, uv, vec2, vec3,
} from 'three/tsl';

export function createBreathUniforms() {
    return {
        time: uniform(0),
        breath: uniform(0),
        breathInt: uniform(0),
        phase: uniform(0),
        phaseT: uniform(0),
        calm: uniform(0),
        ext: uniform(new THREE.Vector2(16 / 9, 1)),
        focus: uniform(0.14),
        px: uniform(1 / 450),
    };
}

/** The backdrop quad's fragment position in hero space. */
export const backdropPoint = (u) => uv().mul(2).sub(1).mul(u.ext)
    .sub(vec2(0, u.focus));

export const hash21 = /* @__PURE__ */ Fn(([p]) => {
    const q = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    q.addAssign(dot(q, q.yzx.add(33.33)));
    return fract(q.x.add(q.y).mul(q.z));
}).setLayout({ name: 'br_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const hash22 = /* @__PURE__ */ Fn(([p]) => {
    const q = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    q.addAssign(dot(q, q.yzx.add(33.33)));
    return fract(q.xx.add(q.yz).mul(q.zy));
}).setLayout({ name: 'br_hash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

/** Quintic value noise in 0..1: smooth second derivative, so lit ridges show no lattice. */
export const vnoise = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const w = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
    const a = hash21(i);
    const b = hash21(i.add(vec2(1, 0)));
    const c = hash21(i.add(vec2(0, 1)));
    const d = hash21(i.add(vec2(1, 1)));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}).setLayout({ name: 'br_vnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** Quintic gradient noise in ~0..1: organic, with none of value noise's plateaus. */
export const gnoise = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const w = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
    const a = dot(hash22(i).mul(2).sub(1), f);
    const b = dot(hash22(i.add(vec2(1, 0))).mul(2).sub(1), f.sub(vec2(1, 0)));
    const c = dot(hash22(i.add(vec2(0, 1))).mul(2).sub(1), f.sub(vec2(0, 1)));
    const d = dot(hash22(i.add(vec2(1, 1))).mul(2).sub(1), f.sub(vec2(1, 1)));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y).mul(0.72).add(0.5);
}).setLayout({ name: 'br_gnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const fbmCache = new Map();
/** Fractal gradient noise in ~0..1 with a fixed octave count (one real shader function per count). */
export function fbm(p, octaves = 5) {
    if (!fbmCache.has(octaves)) {
        // Normalised so every octave count spans the same range.
        const norm = 1 / (1 - 0.5 ** octaves);
        fbmCache.set(octaves, Fn(([pIn]) => {
            const q = vec2(pIn).toVar();
            const sum = float(0).toVar();
            let amplitude = 0.5;
            for (let i = 0; i < octaves; i++) {
                sum.addAssign(gnoise(q).sub(0.5).mul(amplitude));
                // Rotate and scale between octaves so the lattice never lines up.
                q.assign(vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(vec2(3.1, 1.7)));
                amplitude *= 0.5;
            }
            return sum.mul(norm).add(0.5);
        }).setLayout({ name: `br_fbm${octaves}`, type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] }));
    }
    return fbmCache.get(octaves)(p);
}

/** Domain-warped fbm: billowing cloud and gas that never reads as a grid. */
export function warpedFbm(p, drift, octaves = 5) {
    const q = vec2(fbm(p.add(vec2(0, drift)), 2), fbm(p.add(vec2(5.2, 1.3)).sub(vec2(drift, 0)), 2));
    return fbm(p.add(q.mul(1.7)), octaves);
}

const starLayer = /* @__PURE__ */ Fn(([p, cells, seed, amount, px, t]) => {
    const q = p.mul(cells).toVar();
    const cell = floor(q).toVar();
    const pick = hash21(cell.add(seed)).toVar();
    const pos = hash22(cell.add(seed.mul(1.7))).mul(0.7).add(0.15);
    const mag = pow(hash21(cell.add(seed).add(9.1)), 5).toVar();
    // One device pixel in cell units keeps the core crisp at every render scale.
    const cellPx = px.mul(cells).toVar();
    const d = length(fract(q).sub(pos)).toVar();
    const core = exp(d.mul(d).negate().div(cellPx.mul(cellPx).mul(mag.mul(3.6).add(0.8))));
    const halo = mag.mul(0.05).mul(exp(d.mul(-7))).div(d.mul(d).div(cellPx.mul(cellPx)).mul(0.02).add(1));
    const twinkle = sin(t.mul(pick.mul(9).add(0.35)).add(pick.mul(60))).mul(0.2).add(0.8);
    const tint = mix(vec3(0.72, 0.82, 1), vec3(1, 0.86, 0.7), hash21(cell.add(seed).add(3.3)));
    return tint.mul(core.mul(mag.mul(1.4).add(0.25)).add(halo)).mul(twinkle).mul(step(pick, amount));
}).setLayout({
    name: 'br_starLayer',
    type: 'vec3',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'cells', type: 'float' }, { name: 'seed', type: 'float' },
        { name: 'amount', type: 'float' }, { name: 'px', type: 'float' }, { name: 't', type: 'float' },
    ],
});

/** Three depths of fixed stars with a slow, never-strobing twinkle. */
export function starfield(p, u, density = 1) {
    // Small screens hold fewer pixels per unit of sky: thin the field so it never reads as snow.
    const room = clamp(float(1).div(u.px.mul(450)), 0.3, 1.1).mul(density);
    return starLayer(p, float(7), float(1), room.mul(0.3), u.px, u.time)
        .add(starLayer(p.add(3.7), float(15), float(2), room.mul(0.34), u.px, u.time).mul(0.6))
        .add(starLayer(p.add(8.1), float(31), float(3), room.mul(0.3), u.px, u.time).mul(0.35));
}

/** An edge that stays about one pixel soft at every render scale. `x` is in hero units. */
export const softStep = (edge, x, u, width = 1.5) => smoothstep(
    float(edge).sub(u.px.mul(width)),
    float(edge).add(u.px.mul(width)),
    x,
);

/** A descending ramp: 1 at or below `lo`, 0 at or above `hi`. (Never reverse smoothstep's edges: GLSL leaves that undefined.) */
export const fadeOut = (lo, hi, x) => float(1).sub(smoothstep(lo, hi, x));

/** Rotate a vec2 node by a (node or number) angle. */
export const turn = (p, angle) => {
    const a = float(angle);
    return vec2(p.x.mul(a.cos()).sub(p.y.mul(a.sin())), p.x.mul(a.sin()).add(p.y.mul(a.cos())));
};
