/**
 * Astral Weave — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    nebula reads ONE tileable half-float fBm texture baked on the CPU, hashes are Dave Hoskins'
 *    hash-without-sine;
 *  - every glow is written premultiplied through `awFxMaterial` ("over" blending, One /
 *    OneMinusSrcAlpha): `vec4(emission, 0)` is purely additive and `vec4(rgb·a, a)` occludes, so
 *    one material can be light and veil at once and no falloff is ever applied twice.
 *
 * Everything here is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    dot,
    float,
    fract,
    max,
    mix,
    modelWorldMatrix,
    normalize,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

export const TAU = Math.PI * 2;

// ── Seeded RNG (CPU) ────────────────────────────────────────────────────────────

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const awHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'aw_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const awHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'aw_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1) */
export const awHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'aw_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const awLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const awMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * The thread spectrum. `t` runs once around the hoop; `heat` (0..1) is the combo temperature.
 * Cool: mint → azure → violet → rose (pearl silk). Warm: rose → orchid. Hot: gold → amber → coral
 * (molten silk). Three cosine palettes (scene-linear), so the hue never greys between stops.
 */
export const awSpectrum = /* @__PURE__ */ Fn(([t, heat]) => {
    const ph = t.mul(TAU);
    const cool = vec3(
        cos(ph.sub(TAU * 0.75)).mul(0.45).add(0.5),
        cos(ph.sub(TAU * 0.02)).mul(0.33).add(0.58),
        cos(ph.sub(TAU * 0.3)).mul(0.1).add(0.9),
    );
    const hot = vec3(
        float(1.0),
        cos(ph.sub(TAU * 0.12)).mul(0.19).add(0.5),
        cos(ph.sub(TAU * 0.62)).mul(0.1).add(0.14),
    );
    // Between them the weave passes through rose and orchid, never through grey-green.
    const mid = vec3(
        cos(ph.sub(TAU * 0.8)).mul(0.12).add(0.86),
        cos(ph.sub(TAU * 0.15)).mul(0.14).add(0.36),
        cos(ph.sub(TAU * 0.45)).mul(0.18).add(0.72),
    );
    return mix(mix(cool, mid, smoothstep(0.0, 0.5, heat)), hot, smoothstep(0.45, 1.0, heat));
}).setLayout({
    name: 'aw_spectrum',
    type: 'vec3',
    inputs: [{ name: 't', type: 'float' }, { name: 'heat', type: 'float' }],
});

// ── The nebula noise texture ────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * A tileable RGBA fBm texture: four decorrelated channels of periodic gradient noise (five
 * octaves), stretched to [0, 1] and stored as half floats so the dark nebula gradients never
 * band. Baked once on the CPU (≈ 40 ms); every nebula octave in the sky is ONE fetch of it.
 */
export function createNoiseTexture(seed = 7411, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint16Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) {
            data[i * 4 + c] = THREE.DataUtils.toHalfFloat((field[i] - lo) * inv);
        }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'astral-weave-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function awFxMaterial(name) {
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

/** A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances, with a vec4 `aSeed` each. */
export function awQuadGeometry(count, seed, extra = null) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const rand = mulberry32(seed);
    const seeds = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    if (extra) Object.keys(extra).forEach((k) => geometry.setAttribute(k, extra[k]));
    geometry.instanceCount = count;
    return geometry;
}

/**
 * A thread strip: `segments` quads along x (position.x = t in 0..1, position.y = side in ±1),
 * instanced `count` times. `aThread` = (u, seedA, seedB, seedC): u is the thread's place around
 * the hoop in [0, 1).
 */
export function awThreadGeometry(count, segments, seed) {
    const geometry = new THREE.InstancedBufferGeometry();
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        positions.push(t, -1, 0, t, 1, 0);
        uvs.push(t, 0, t, 1);
        if (j < segments) {
            const a = j * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const rand = mulberry32(seed);
    const n = Math.max(1, count);
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        data[i * 4] = i / n;
        data[i * 4 + 1] = rand();
        data[i * 4 + 2] = rand();
        data[i * 4 + 3] = rand();
    }
    geometry.setAttribute('aThread', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;
    return geometry;
}

/** Clip position of a loom-local point (through the loom group's world matrix). */
export const awLoomClip = (local) => cameraProjectionMatrix.mul(cameraViewMatrix)
    .mul(modelWorldMatrix.mul(vec4(local, 1.0)));

/**
 * Screen-space ribbon expansion. `p0` is the loom-local point at this vertex, `p1` a point a
 * little further along the same curve; the vertex is pushed `side · halfWidthPx` pixels along the
 * screen-space normal, so a thread keeps its pixel width at any distance and under any tilt.
 * Returns the clip position.
 */
export function awRibbonClip(p0, p1, side, halfWidthPx, uViewport) {
    const c0 = awLoomClip(p0);
    const c1 = awLoomClip(p1);
    const half = uViewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const off = nrm.mul(side.mul(halfWidthPx)).div(half).mul(c0.w);
    return vec4(c0.xy.add(off), c0.z, c0.w);
}

/** Clip position of a camera-facing quad corner around a loom-local `center` (pixel offset). */
export function awSpriteClip(center, offsetPx, uViewport) {
    const c = awLoomClip(center);
    return vec4(c.xy.add(offsetPx.div(uViewport.mul(0.5)).mul(c.w)), c.z, c.w);
}
