/**
 * Supernova — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site; laid-out helpers are pure
 *    (no captured uniforms or textures: values go in as parameters);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable 3D texture baked on the CPU, hashes are hash-without-sine. The texture holds
 *    four smooth fields; anything thin (a filament, a lane between two granules) is drawn in the
 *    shader as the place where a field crosses its middle, so its sharpness does not depend on
 *    the texture's resolution;
 *  - every read of the 3D texture names its level: the reads sit inside branches and loops;
 *  - nothing is lit by scene lights: every part emits (MeshBasicNodeMaterial), scene-linear and
 *    unbounded (HDR); the post stack owns the tone map;
 *  - nothing writes depth: the sky is drawn first, the nebula "over" it, the star over that, and
 *    every light added on top. What should hide behind the star tests the star's sphere itself.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    dot,
    float,
    fract,
    max,
    normalize,
    smoothstep,
    sqrt,
    step,
    texture3D,
    uniform,
    uniformArray,
    vec3,
} from 'three/tsl';

import {
    IMPACT_SLOTS,
    RING,
    SHELL_ROWS,
    SHELL_STRIDE,
    SUPERNOVA_PALETTES,
    mulberry32,
} from './supernova-core.js';

export * from './supernova-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const snHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'sn_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const snHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sn_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const snHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'sn_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const snLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const snMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const snBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** 1 where a smooth field crosses its middle, falling to 0 either side: a thread, a lane. */
export const snRidge = (n) => float(1.0).sub(abs(n.mul(2.0).sub(1.0)));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE3_SIZE = 64;

/**
 * Four decorrelated periodic gradient-noise fields (three octaves each), as bytes. Every field
 * is centred on 0.5 with a standard deviation near 0.18, so a threshold means the same thing in
 * every channel: 0.5 is the median, 0.68 leaves about a sixth above it.
 * @returns {Uint8Array} size³ × 4
 */
export function bakeNoise3D(seed = 1987, size = NOISE3_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Uint8Array(n * n * n * 4);
    const field = new Float32Array(n * n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const ft = new Float32Array(n);
    const fs = new Float32Array(n);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 3; o++) {
            const period = 4 << o;
            const cells = period * period * period;
            const gx = new Float32Array(cells);
            const gy = new Float32Array(cells);
            const gz = new Float32Array(cells);
            for (let i = 0; i < cells; i++) {
                const z = rand() * 2 - 1;
                const a = rand() * Math.PI * 2;
                const s = Math.sqrt(Math.max(0, 1 - z * z));
                gx[i] = Math.cos(a) * s;
                gy[i] = Math.sin(a) * s;
                gz[i] = z;
            }
            const scale = period / n;
            for (let x = 0; x < n; x++) {
                const f = x * scale;
                i0[x] = Math.floor(f);
                ft[x] = f - i0[x];
                i1[x] = (i0[x] + 1) % period;
                fs[x] = fade(ft[x]);
            }
            let at = 0;
            for (let z = 0; z < n; z++) {
                const tz = ft[z];
                const sz = fs[z];
                const za = i0[z] * period;
                const zb = i1[z] * period;
                for (let y = 0; y < n; y++) {
                    const ty = ft[y];
                    const sy = fs[y];
                    const aa = (za + i0[y]) * period;
                    const ab = (za + i1[y]) * period;
                    const ba = (zb + i0[y]) * period;
                    const bb = (zb + i1[y]) * period;
                    for (let x = 0; x < n; x++) {
                        const tx = ft[x];
                        const sx = fs[x];
                        const xa = i0[x];
                        const xb = i1[x];
                        let k = aa + xa;
                        const d000 = gx[k] * tx + gy[k] * ty + gz[k] * tz;
                        k = aa + xb;
                        const d100 = gx[k] * (tx - 1) + gy[k] * ty + gz[k] * tz;
                        k = ab + xa;
                        const d010 = gx[k] * tx + gy[k] * (ty - 1) + gz[k] * tz;
                        k = ab + xb;
                        const d110 = gx[k] * (tx - 1) + gy[k] * (ty - 1) + gz[k] * tz;
                        k = ba + xa;
                        const d001 = gx[k] * tx + gy[k] * ty + gz[k] * (tz - 1);
                        k = ba + xb;
                        const d101 = gx[k] * (tx - 1) + gy[k] * ty + gz[k] * (tz - 1);
                        k = bb + xa;
                        const d011 = gx[k] * tx + gy[k] * (ty - 1) + gz[k] * (tz - 1);
                        k = bb + xb;
                        const d111 = gx[k] * (tx - 1) + gy[k] * (ty - 1) + gz[k] * (tz - 1);
                        const x00 = d000 + (d100 - d000) * sx;
                        const x10 = d010 + (d110 - d010) * sx;
                        const x01 = d001 + (d101 - d001) * sx;
                        const x11 = d011 + (d111 - d011) * sx;
                        const y0 = x00 + (x10 - x00) * sy;
                        const y1 = x01 + (x11 - x01) * sy;
                        field[at] += (y0 + (y1 - y0) * sz) * amp;
                        at += 1;
                    }
                }
            }
            amp *= 0.5;
        }
        let mean = 0;
        for (let i = 0; i < field.length; i++) mean += field[i];
        mean /= field.length;
        let variance = 0;
        for (let i = 0; i < field.length; i++) variance += (field[i] - mean) * (field[i] - mean);
        const inv = 1 / (Math.sqrt(variance / field.length) * 5.6 + 1e-9);
        for (let i = 0; i < field.length; i++) {
            const v = 0.5 + (field[i] - mean) * inv;
            out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
    }
    return out;
}

/** The baked fields as a tileable 3D texture (bytes filter on every device). */
export function createNoise3DTexture(data, size = NOISE3_SIZE) {
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'supernova-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the supernova's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Data3DTexture }} textures
 */
export function createSupernovaUniforms(textures) {
    const p = SUPERNOVA_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0005),
        /** The star in the world, and its distance from the rest camera. */
        centre: uniform(new THREE.Vector3(0, 0, -22)),
        /** The star's frame → world, and back (rotations only). */
        starRot: uniform(new THREE.Matrix3()),
        starInv: uniform(new THREE.Matrix3()),
        /** The star's radius now (it breathes, pulses, falls in and swells back). */
        starR: uniform(1),
        /** 0 at rest, → 1 with a chain, past 1 for a newborn star: shifts the photosphere up its ramp. */
        heat: uniform(0),
        /** White-hot cracks across the photosphere, 0..1 (a long chain, a collapse). */
        fissure: uniform(0),
        /** The star's own light, pulsed by a clear: 1 at rest. */
        starGain: uniform(1),
        /** The corona's reach and brightness: 1 at rest. */
        coronaGain: uniform(1),
        /** The glare and the spikes round the star: (glare, spikes). */
        glare: uniform(new THREE.Vector2(0.4, 0.2)),
        /** The photosphere's clock and the wind's clock (gameplay bends both). */
        boil: uniform(0),
        flow: uniform(0),
        /** Gain on every light: a collapse holds the nebula's breath. */
        breath: uniform(1),
        /** How far the corona is wound round the star (a T-spin winds it and lets it go). */
        twist: uniform(0),
        // The palette (scene-linear), eased by the world between levels.
        starDeep: v3(p.starDeep),
        starMid: v3(p.starMid),
        starHot: v3(p.starHot),
        rim: v3(p.rim),
        corona: v3(p.corona),
        gasA: v3(p.gasA),
        gasB: v3(p.gasB),
        gasC: v3(p.gasC),
        skyA: v3(p.skyA),
        skyB: v3(p.skyB),
        voidCol: v3(p.void),
        /** Lock impacts: (direction in the star's frame, birth time) + (colour, strength). */
        impactA: [],
        impactC: [],
        /** 1 while any impact is still on the photosphere. */
        impactsLive: uniform(0),
        /** The nebula's shell table (see supernova-nebula.js) and how many rows are live. */
        shells: null,
        shellCount: uniform(0),
        /** The scattered light that fills the nebula round the star. */
        haze: uniform(0.5),
        /** The flash crossing the far clouds: (birth, strength, radians per second, width) + colour. */
        echo: uniform(new THREE.Vector4(-100, 0, 0.9, 0.05)),
        echoCol: v3([1, 0.9, 0.75]),
        /** Where the star is on the sky (the echo and the sky's glow are measured from it). */
        starDir: uniform(new THREE.Vector3(0, 0, -1)),
        /** The sky's stars answer a clear: 0..1. */
        skyPulse: uniform(0),
        /** The ring's beads: (colour, how lit). */
        beads: null,
        /** The ring itself: (base glow, flare, turn, _). */
        ring: uniform(new THREE.Vector4(0.5, 0, 0, 0)),
        /** The pulsar: (gain, phase of its turn, beam length, _). */
        pulsar: uniform(new THREE.Vector4(0, 0, 14, 0)),
        noiseTex: textures.noise,
    };
    for (let i = 0; i < IMPACT_SLOTS; i++) {
        u.impactA.push(uniform(new THREE.Vector4(0, 1, 0, -100)));
        u.impactC.push(uniform(new THREE.Vector4(1, 1, 1, 0)));
    }
    u.shellRows = Array.from({ length: SHELL_ROWS * SHELL_STRIDE }, () => new THREE.Vector4(0, 0, 0, 0));
    u.shells = uniformArray(u.shellRows, 'vec4');
    u.beadRows = Array.from({ length: RING.beads }, () => new THREE.Vector4(1, 1, 1, 0));
    u.beads = uniformArray(u.beadRows, 'vec4');
    /** Four smooth fields at a point of the texture's own space (period 1). */
    u.noise = (point) => texture3D(u.noiseTex, point).level(0);
    return u;
}

// ── What hides behind the star ──────────────────────────────────────────────────

/**
 * 1 where a world point can be seen past the star, 0 where the star's sphere stands between it
 * and the camera, with an edge a few hundredths of a radius soft.
 */
export const snPastStar = (u, world) => {
    const ro = cameraPosition.sub(u.centre);
    const toPoint = world.sub(cameraPosition);
    const span = max(sqrt(dot(toPoint, toPoint)), 1e-4);
    const rd = toPoint.div(span);
    const b = dot(ro, rd);
    const h = b.mul(b).sub(dot(ro, ro)).add(u.starR.mul(u.starR));
    // The ray enters the sphere at −b − √h: hidden when that is nearer than the point.
    const enters = b.negate().sub(sqrt(max(h, 0.0)));
    const behind = step(enters, span).mul(step(0.0, enters));
    return float(1.0).sub(smoothstep(0.0, u.starR.mul(u.starR).mul(0.06), h).mul(behind));
};

/** A unit vector turned about the star's own axis (local Y) by `angle`. */
export const snTurnY = (v, angle) => {
    const c = angle.cos();
    const s = angle.sin();
    return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};

/** Safe normalise for a vector that may be zero. */
export const snUnit = (v) => normalize(v.add(vec3(1e-6, 0.0, 0.0)));

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function snFxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function snQuadGeometry(count, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/**
 * A strip for `count` instances: `segments` quads along it. position.x runs 0..1 along the
 * strip, position.y is −1 on one edge and +1 on the other; uv is the same pair in 0..1.
 */
export function snStripGeometry(count, segments, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    const positions = [];
    const uvs = [];
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const s = i / segments;
        positions.push(s, -1, 0, s, 1, 0);
        uvs.push(s, 0, s, 1);
        if (i < segments) {
            const a = i * 2;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** The mesh wrapper every part returns. */
export function snPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
