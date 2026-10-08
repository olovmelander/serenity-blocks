/**
 * Galaxy — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site; laid-out helpers are pure
 *    (no captured uniforms or textures: values go in as parameters);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - nothing is lit by scene lights: every part emits (MeshBasicNodeMaterial), scene-linear and
 *    unbounded (HDR); the post stack owns the tone map;
 *  - nothing writes depth: the sky is drawn first, the gas "over" it, every light added on top.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    log,
    max,
    pow,
    step,
    texture,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CLEAR_SLOTS,
    GALAXY,
    GALAXY_PALETTES,
    LOCK_SLOTS,
    RIPPLE_FADE,
    RIPPLE_REACH,
    RIPPLE_TAU,
    TAU,
    WAVE_AFTERGLOW,
    WAVE_FRONT_GAP,
    WAVE_FRONT_WIDTH,
    WAVE_REACH,
    WAVE_SHAPE,
    WAVE_TRAVEL,
    mulberry32,
} from './galaxy-core.js';

export * from './galaxy-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const gxHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'gx_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const gxHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'gx_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const gxHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'gx_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const gxLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const gxMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const gxBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

// ── The spiral ──────────────────────────────────────────────────────────────────

/** The angle an arm's ridge stands at for a radius (TSL twin of armAngle). */
export const gxArmAngle = (radius, winding) => winding
    .mul(log(max(radius, GALAXY.armStart * 0.5).div(GALAXY.armStart)));

/** cos of the arm phase at (radius, angle), shifted by `offset` radians of phase: 1 on a ridge. */
export const gxArmWave = (radius, angle, winding, offset = 0) => cos(
    angle.sub(gxArmAngle(radius, winding)).mul(GALAXY.arms).add(offset),
);

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4242, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
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
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/** Bilinear, wrapping read of one channel of a baked noise field (the CPU twin of a fetch). */
export function sampleNoise(field, size, x, y, channel = 0) {
    const fx = (((x % 1) + 1) % 1) * size - 0.5;
    const fy = (((y % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => field[((((iy % size) + size) % size) * size + (((ix % size) + size) % size)) * 4 + channel];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'galaxy-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the galaxy's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createGalaxyUniforms(textures) {
    const p = GALAXY_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel (the gas picks its noise mip from the pixel's footprint). */
        pixelAngle: uniform(0.0005),
        /** The galaxy's frame → world, and the camera in the galaxy's frame. */
        frame: uniform(new THREE.Matrix4()),
        camLocal: uniform(new THREE.Vector3(0, 150, 240)),
        /** The nucleus in the world, the axis the jets run along, and the way to the nucleus. */
        centre: uniform(new THREE.Vector3(0, 0, -280)),
        axis: uniform(new THREE.Vector3(0, 1, 0)),
        nucleusDir: uniform(new THREE.Vector3(0, 0, -1)),
        /** 0..1: the nucleus's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light: a four-line clear holds the galaxy's breath (→ 0.12). */
        breath: uniform(1),
        /** How tightly the arms wind right now (a T-spin winds them up and lets them go). */
        winding: uniform(GALAXY.winding),
        /** How far the old disc's stars have streamed through the pattern (a clock gameplay bends). */
        flow: uniform(0),
        // The palette (scene-linear), eased by the world between levels.
        core: v3(p.core),
        nucleus: v3(p.nucleus),
        armInner: v3(p.armInner),
        armOuter: v3(p.armOuter),
        nursery: v3(p.nursery),
        dust: v3(p.dust),
        jet: v3(p.jet),
        nebulaA: v3(p.nebulaA),
        nebulaB: v3(p.nebulaB),
        voidCol: v3(p.void),
        /** Rings in the disc round the nucleus: 0..6, one per step of the chain. */
        rings: uniform(0),
        /** The jets: (reach 0..1, gain, burst birth time, burst strength). */
        jets: uniform(new THREE.Vector4(0.1, 0.06, -100, 0)),
        /** A four-line clear's shock ring across the sky: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** The sky's stars answer a clear: 0..1. */
        skyPulse: uniform(0),
        /** The companion galaxy: where it is, (angular radius, its own turn, tilt, _). */
        companionDir: uniform(new THREE.Vector3(0.5, 0.3, -0.8).normalize()),
        companion: uniform(new THREE.Vector4(0.05, 0, 0.9, 0)),
        /** 1 while any ripple / any clear wave is still in the disc (the loops are skipped at rest). */
        ripplesLive: uniform(0),
        wavesLive: uniform(0),
        /** Ripple slots: (x, z in the galaxy's frame, birth time, strength) + (colour, reach 0..1). */
        lockA: [],
        lockC: [],
        /** Wave slots: (birth time, fronts, strength, starfire 0..1) + colour. */
        waveA: [],
        waveC: [],
        noiseTex: textures.noise,
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.waveA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.waveC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    /** A fixed mip: for fetches whose coordinates jump (a polar seam) or that run in a vertex stage. */
    u.noiseLod = (st, lod = 0) => texture(u.noiseTex, st).level(lod);
    return u;
}

// ── The board's light in the disc ───────────────────────────────────────────────

/**
 * Light of the lock ripples at a point `xz` of the disc (the galaxy's frame): every seed that
 * lands sends a ring out through the gas round its nursery. Returns the summed colour (HDR).
 */
export const gxRippleLight = (u, xz) => {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = u.lockC[i].w.mul(RIPPLE_REACH).mul(float(1.0).sub(exp(max(age, 0.0).div(-RIPPLE_TAU))));
        const d = length(xz.sub(A.xy));
        const shell = gxBell(d.sub(radius).div(u.lockC[i].w.mul(3.0).add(2.4)));
        const env = exp(max(age, 0.0).mul(-RIPPLE_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

/**
 * The clear waves at radius `r` of the disc. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const gxWaveLight = (u, r) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    const far = clamp(r.div(WAVE_REACH), 0.0, 1.0);
    const pass = float(WAVE_TRAVEL).mul(pow(far, 1 / WAVE_SHAPE));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.waveA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(gxBell(since.sub(k * WAVE_FRONT_GAP).div(WAVE_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.waveC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(max(since, 0.0).div(-WAVE_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function gxFxMaterial(name) {
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
export function gxQuadGeometry(count, attributes = {}) {
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

/** The mesh wrapper every part returns. */
export function gxPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
