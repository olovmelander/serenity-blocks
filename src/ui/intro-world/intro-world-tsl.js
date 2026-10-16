/**
 * First Light — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps, see the webgpu-threejs-tsl skill):
 *  - every helper called more than once carries `setLayout` and is pure (no captured uniforms
 *    or textures), so it is emitted once as a real shader function;
 *  - no MaterialX noise: the slow cloud grain is one small tileable texture baked on the CPU;
 *  - nothing is lit by scene lights: every part writes its own scene-linear light, and the
 *    post stack owns the one tone map;
 *  - the sky is ONE function of a direction, called by the backdrop along the view ray and by
 *    the pieces along their reflection, so the lacquer mirrors the same light that surrounds it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    normalize,
    sin,
    smoothstep,
    vec3,
} from 'three/tsl';
import { BRAND, mulberry32, srgbToLinear } from './intro-world-core.js';

// ── Hashes ──────────────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const flHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'fl_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const flHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'fl_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

export const flLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const flMax3 = (c) => max(c.x, max(c.y, c.z));

/** v rotated by the unit quaternion q (xyz, w). */
export const flQuatRotate = /* @__PURE__ */ Fn(([q, v]) => {
    const t = cross(q.xyz, v).mul(2.0);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({
    name: 'fl_quatRotate', type: 'vec3', inputs: [{ name: 'q', type: 'vec4' }, { name: 'v', type: 'vec3' }],
});

/** Schlick's Fresnel, written as products (a pow of a hair below zero is NaN). */
export const flFresnel = (cosI, f0) => {
    const m = clamp(float(1.0).sub(cosI), 0.0, 1.0);
    const m2 = m.mul(m);
    return float(f0).add(float(1 - f0).mul(m2.mul(m2).mul(m)));
};

/** A linear colour node from a brand hex. */
export const brand = (key) => vec3(...srgbToLinear(BRAND[key]));

// ── The sky ─────────────────────────────────────────────────────────────────────

/**
 * The sky in direction d (world space, unit), scene-linear:
 *   a near-black void overhead, a deep night at eye level with a faint violet nebula, and the
 *   light rising from below: an abyssal glow (deep teal with a cyan mid-glow, leaning violet on
 *   the left and sea-green on the right), breathing; a soft cool halo where the title stands; two
 *   layers of stars on a 3D lattice (round everywhere), thinned where the glow is bright; and
 *   cloud grain carried in from outside (`grain`, 0..1) that breaks the glow into wisps.
 *
 * Inputs are plain values so the function is laid out once and both the backdrop and the
 * pieces' reflections can call it: `light` = (breath, haze gain, halo gain, star gain),
 * `haloDir` = the title's direction, `t` = time (twinkle).
 */
export const flSky = /* @__PURE__ */ Fn(([d, haloDir, light, grain, t]) => {
    const e = d.y.toVar();
    const breath = light.x;
    // The void: #03040A overhead, #070A17 toward eye level, a violet nebula (#1F1647) lifting
    // just above the glow.
    const ink = vec3(0.0009, 0.0012, 0.003);
    const night = vec3(0.0021, 0.003, 0.0085);
    const violet = vec3(0.0137, 0.008, 0.063);
    const sky = mix(night, ink, smoothstep(-0.08, 0.5, e)).toVar();
    // The nebula is broken into wisps by the grain, so dark gaps run through it.
    const wisps = grain.mul(1.3).add(0.15);
    sky.assign(mix(sky, violet, exp(e.add(0.16).mul(e.add(0.16)).mul(-70.0)).mul(0.4).mul(wisps)));

    // The light from below: a deep band under the eye line and a narrower mid-glow core, hue
    // across the azimuth (violet, abyssal teal, sea-green).
    const az = d.x.toVar();
    const toTeal = smoothstep(-0.75, 0.05, az);
    const toSea = smoothstep(0.2, 0.95, az);
    // Deep band: #1F1647 → #093542 → #07383A; mid-glow: #2A1E66 → #007A8C → #007A78.
    const deep = mix(mix(violet, vec3(0.0027, 0.0356, 0.0545), toTeal), vec3(0.002, 0.04, 0.042), toSea);
    const glow = mix(
        mix(vec3(0.0232, 0.013, 0.1329), vec3(0.0, 0.1946, 0.2622), toTeal),
        vec3(0.0, 0.1946, 0.1878),
        toSea,
    );
    const band = exp(e.add(0.3).div(0.12).pow2().negate());
    const core = exp(e.add(0.4).div(0.085).pow2().negate());
    const breathe = breath.mul(0.32).add(0.78);
    const haze = deep.mul(band.mul(0.85)).add(glow.mul(core.mul(0.55))).mul(breathe).mul(light.y)
        .toVar();
    // Grain: the glow is not a gradient but wisps over the dark; brighter where the grain is.
    haze.mulAssign(grain.mul(1.4).add(0.1));
    sky.addAssign(haze);

    // The halo where the title stands: a cool glow and a faint violet bloom of it.
    const cosA = clamp(dot(d, haloDir), -1.0, 1.0);
    const a2 = float(1.0).sub(cosA).mul(2.0);
    const halo = exp(a2.mul(-110.0)).mul(0.06).add(exp(a2.mul(-30.0)).mul(0.008));
    const haloCol = mix(vec3(0.254, 0.147, 1.0), vec3(0.82, 0.9, 1.0), exp(a2.mul(-200.0)));
    sky.addAssign(haloCol.mul(halo).mul(breath.mul(0.45).add(0.7)).mul(light.z));

    // Stars on a 3D lattice: one per cell, put back on the sphere, so none is stretched.
    const dark = float(1.0).sub(smoothstep(0.008, 0.07, flLuma(haze)));
    const starLayer = (scale, power, gain, rate) => {
        const p = d.mul(scale);
        const cell = floor(p);
        const h = flHash33(cell).toVar();
        const star = normalize(cell.add(h.mul(0.56).add(0.22)));
        const off = d.sub(star).mul(scale);
        const bright = h.y.pow(power).mul(smoothstep(0.45, 0.55, h.x));
        const twinkle = sin(t.mul(h.x.mul(rate).add(0.4)).add(h.z.mul(40.0))).mul(0.3).add(0.7);
        const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.74, 0.84, 1.0), fract(h.z.mul(7.31)));
        return tint.mul(exp(dot(off, off).mul(-160.0)).mul(bright).mul(twinkle).mul(gain));
    };
    const stars = starLayer(52.0, 6.0, 2.4, 1.6).add(starLayer(120.0, 4.0, 0.7, 2.2));
    sky.addAssign(stars.mul(dark).mul(light.w).mul(smoothstep(-0.35, 0.05, e)));
    return max(sky, vec3(0.0));
}).setLayout({
    name: 'fl_sky',
    type: 'vec3',
    inputs: [
        { name: 'd', type: 'vec3' },
        { name: 'haloDir', type: 'vec3' },
        { name: 'light', type: 'vec4' },
        { name: 'grain', type: 'float' },
        { name: 't', type: 'float' },
    ],
});

/** A cheap stand-in for the sky (no stars, no grain) for reflections. */
export const flSkySoft = /* @__PURE__ */ Fn(([d, haloDir, light]) => {
    const e = d.y;
    const sky = mix(vec3(0.0021, 0.003, 0.0085), vec3(0.0009, 0.0012, 0.003), smoothstep(-0.08, 0.5, e)).toVar();
    const hue = mix(
        mix(vec3(0.0232, 0.013, 0.1329), vec3(0.0, 0.1946, 0.2622), smoothstep(-0.75, 0.05, d.x)),
        vec3(0.0, 0.1946, 0.1878),
        smoothstep(0.2, 0.95, d.x),
    );
    const band = exp(e.add(0.32).div(0.26).pow2().negate());
    sky.addAssign(hue.mul(band.mul(0.3)).mul(light.x.mul(0.32).add(0.78)).mul(light.y));
    const cosA = clamp(dot(d, haloDir), -1.0, 1.0);
    const a2 = float(1.0).sub(cosA).mul(2.0);
    sky.addAssign(vec3(0.5, 0.45, 1.0).mul(exp(a2.mul(-10.0)).mul(0.045)).mul(light.z));
    // The veils' light, wrapped round the sky's middle band: the lacquer catches colour.
    const veil = exp(e.sub(-0.08).mul(e.sub(-0.08)).mul(-18.0)).mul(min(cos(d.x.mul(3.0)).mul(0.5).add(0.5), 1.0));
    sky.addAssign(mix(vec3(0.16, 0.09, 0.62), vec3(0.0, 0.45, 0.6), d.x.mul(0.5).add(0.5)).mul(veil.mul(0.07)));
    return sky;
}).setLayout({
    name: 'fl_skySoft',
    type: 'vec3',
    inputs: [{ name: 'd', type: 'vec3' }, { name: 'haloDir', type: 'vec3' }, { name: 'light', type: 'vec4' }],
});

// ── Baked grain ─────────────────────────────────────────────────────────────────

/**
 * A small tileable fBm texture (value noise, four octaves), baked once: the soft structure in
 * the haze and in the veils' silk. Linear, repeat-wrapped, mipmapped.
 * @param {number} [size]
 * @returns {THREE.DataTexture}
 */
export function bakeGrainTexture(size = 128) {
    const rnd = mulberry32(1913);
    const lattice = (n) => {
        const g = new Float32Array(n * n);
        for (let i = 0; i < g.length; i++) g[i] = rnd();
        return g;
    };
    const octaves = [4, 8, 16, 32].map((n) => ({ n, g: lattice(n) }));
    const data = new Uint8Array(size * size * 4);
    const fade = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let v = 0;
            let amp = 0.5;
            let norm = 0;
            const ch = [];
            for (const { n, g } of octaves) {
                const fx = (x / size) * n;
                const fy = (y / size) * n;
                const x0 = Math.floor(fx);
                const y0 = Math.floor(fy);
                const tx = fade(fx - x0);
                const ty = fade(fy - y0);
                const at = (i, j) => g[((j + n) % n) * n + ((i + n) % n)];
                const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
                const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
                const o = a + (b - a) * ty;
                ch.push(o);
                v += o * amp;
                norm += amp;
                amp *= 0.5;
            }
            const i = (y * size + x) * 4;
            data[i] = Math.round((v / norm) * 255); // fBm
            data[i + 1] = Math.round(ch[1] * 255); // one octave (8), for the silk's fibres
            data[i + 2] = Math.round(ch[3] * 255); // the finest (32)
            data[i + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}
