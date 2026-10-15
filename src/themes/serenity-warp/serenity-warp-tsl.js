/**
 * Serenity Warp — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    gas is ONE tileable 3D byte texture and the fine grain one tileable half-float fBm texture,
 *    both baked on the CPU when the world is built;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded
 *    (HDR); the post stack owns the tone map;
 *  - the sky is one function of a direction (serenity-warp-sky.js): drawn behind everything
 *    along the view ray, and painted once a frame in every direction into the environment
 *    target the glass refracts.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    clamp,
    cos,
    cross,
    dot,
    float,
    fract,
    max,
    sin,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';

import {
    GATE,
    RIPPLE_SLOTS,
    SKY_PALETTES,
    PALETTE_HOME,
    TAU,
    WAVE_SLOTS,
} from './serenity-warp-core.js';
import { derivedOnce } from '../shared/bake-cache.js';
import { FBM_SIZE } from './serenity-warp-bake.js';

export * from './serenity-warp-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const swHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'sw_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const swHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sw_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const swHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'sw_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const swLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const swMax3 = (c) => max(c.x, max(c.y, c.z));

/** v rotated by the unit quaternion q (xyz, w). */
export const swQuatRotate = /* @__PURE__ */ Fn(([q, v]) => {
    const t = cross(q.xyz, v).mul(2.0);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({
    name: 'sw_quatRotate', type: 'vec3', inputs: [{ name: 'q', type: 'vec4' }, { name: 'v', type: 'vec3' }],
});

/**
 * A direction as a place in the environment target: u round the world's Y axis, v DOWN from the
 * zenith (0 = straight up). The painting pass writes texel (u, v) with the QuadMesh's own uv,
 * whose v also runs down the target, so the two agree on both backends.
 */
export const swEnvUv = /* @__PURE__ */ Fn(([d]) => {
    const u = atan(d.x, d.z.negate()).div(TAU).add(0.5);
    const v = float(0.5).sub(clamp(d.y, -1.0, 1.0).asin().div(Math.PI));
    return vec2(u, v);
}).setLayout({ name: 'sw_envUv', type: 'vec2', inputs: [{ name: 'd', type: 'vec3' }] });

/** The direction a texel of the environment target holds (inverse of swEnvUv). */
export const swEnvDir = /* @__PURE__ */ Fn(([st]) => {
    const lon = st.x.sub(0.5).mul(TAU);
    const lat = float(0.5).sub(st.y).mul(Math.PI);
    const c = cos(lat);
    return vec3(sin(lon).mul(c), sin(lat), cos(lon).mul(c).negate());
}).setLayout({ name: 'sw_envDir', type: 'vec3', inputs: [{ name: 'st', type: 'vec2' }] });

/** CPU twins of the two (tests). */
export function envUv(d) {
    const u = Math.atan2(d[0], -d[2]) / TAU + 0.5;
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
    return [u, v];
}
export function envDir(st) {
    const lon = (st[0] - 0.5) * TAU;
    const lat = (0.5 - st[1]) * Math.PI;
    const c = Math.cos(lat);
    return [Math.sin(lon) * c, Math.sin(lat), -Math.cos(lon) * c];
}

// ── The noise textures ──────────────────────────────────────────────────────────

// The bakes are pure and three-free (serenity-warp-bake.js): a first visit runs them in a worker.
export {
    FBM_SIZE, bakeFbm, bakeGasNoise,
} from './serenity-warp-bake.js';

/** The gas as a tileable, linearly filtered 3D texture (RGBA8: filterable everywhere). */
export function createGasTexture(data, size, name = 'serenity-warp-gas') {
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.unpackAlignment = 1;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/** The CPU twin of one read of the gas (tests): the four fields at a point, 0..1. */
export function sampleGasNoise(data, size, x, y, z, out = [0, 0, 0, 0]) {
    const wrap = (v) => ((v % size) + size) % size;
    const px = x * size - 0.5;
    const py = y * size - 0.5;
    const pz = z * size - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const z0 = Math.floor(pz);
    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;
    const lerp1 = (a, b, t) => a + (b - a) * t;
    for (let c = 0; c < 4; c++) {
        const at = (ix, iy, iz) => data[((wrap(iz) * size + wrap(iy)) * size + wrap(ix)) * 4 + c] / 255;
        const lo = lerp1(lerp1(at(x0, y0, z0), at(x0 + 1, y0, z0), fx), lerp1(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx), fy);
        const hi = lerp1(
            lerp1(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx),
            lerp1(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx),
            fy,
        );
        out[c] = lerp1(lo, hi, fz);
    }
    return out;
}

/**
 * The fBm field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createFbmTexture(field, size = FBM_SIZE) {
    // The CPU mip chain is derived once per cached field; each texture gets its own records.
    const mipmaps = derivedOnce(field, `mips:${size}`, () => mipsFbm(field, size)).map((mip) => ({ ...mip }));
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'serenity-warp-fbm';
    tex.needsUpdate = true;
    return tex;
}

/** The half-float mip chain of a field (pure: derived once per field). */
function mipsFbm(field, size) {
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
    return mipmaps;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/** The peak the environment's light is coded against where its target is 8-bit (see `envAt`). */
export const ENV_CODE_PEAK = 8;

/** Rows of the one event table: two per wave, then two per ripple. */
export const EVENT_ROWS = Object.freeze({ waves: 0, ripples: WAVE_SLOTS * 2, total: (WAVE_SLOTS + RIPPLE_SLOTS) * 2 });

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ gas: THREE.Data3DTexture, fbm: THREE.Texture, env: THREE.Texture, floatTarget?: boolean }} textures
 */
export function createWarpUniforms(textures) {
    const p = SKY_PALETTES[PALETTE_HOME];
    const q = SKY_PALETTES[PALETTE_HOME + 1];
    const tables = { events: rows(EVENT_ROWS.total, [0, 0, 0, 0]) };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel of the drawing buffer. */
        pixelAngle: uniform(0.0006),
        // The camera, for the full-screen sky (drawn without one).
        camPos: uniform(new THREE.Vector3(0, 0, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.9, 0.5)),
        /** The gate: its direction from the camera, two axes across it, and its throat's angular radius. */
        gateDir: uniform(new THREE.Vector3(0, 0, -1)),
        gateX: uniform(new THREE.Vector3(1, 0, 0)),
        gateY: uniform(new THREE.Vector3(0, 1, 0)),
        gateRadius: uniform(GATE.radius * (Math.PI / 180)),
        /** The gate on screen (UV, y down). */
        gateUv: uniform(new THREE.Vector2(0.22, 0.42)),
        /** How brightly the gate stands (1 at rest; a chain, a flash, a jump raise it). */
        gateGain: uniform(1),
        /** A colour the rim flares in when a piece falls in, and how much (0..1). */
        rimTint: uniform(new THREE.Vector3(1, 1, 1)),
        rimFlash: uniform(0),
        /** 0 at rest → WARP_CHAIN: the vortex winds tighter, the stars draw out. */
        warp: uniform(0),
        /**
         * How far the gas has flowed in (log-radius units) and how far the vortex has turned
         * (radians). Integrated by the world: the speed changes, so the clock cannot be multiplied by it.
         */
        inflow: uniform(0),
        spin: uniform(0),
        /** The vortex's twist from a T-spin (radians, springs back to 0). */
        twist: uniform(0),
        /** How far the near stars and the dust have come (warp units, wrapped at their own depths). */
        starTravel: uniform(0),
        moteTravel: uniform(0),
        /** Warp units per second right now (trail lengths). */
        speed: uniform(1),
        /** Gain on every light: a four-line clear holds its breath (→ 0.1). */
        breath: uniform(1),
        /** How much of the frame is the throat's inside in a jump (0..1), and the clock its rings run on. */
        jump: uniform(0),
        jumpClock: uniform(0),
        /** The post's iris, inverted: event lights are raised by it so they read at any exposure. */
        iris: uniform(1),
        // Our sky's palette (scene-linear), walked by the world.
        glow: v3(p.glow),
        deep: v3(p.deep),
        accent: v3(p.accent),
        dust: v3(p.dust),
        gateCol: v3(p.gate),
        skyCol: v3(p.sky),
        starTint: v3(p.star),
        // The other sky's, seen through the throat: one palette further along.
        thereGlow: v3(q.glow),
        thereDeep: v3(q.deep),
        thereAccent: v3(q.accent),
        thereGate: v3(q.gate),
        /** Where in the gas volume each sky is read: a jump moves us to another stretch of it. */
        hereShift: uniform(new THREE.Vector3(0.0, 0.0, 0.0)),
        thereShift: uniform(new THREE.Vector3(0.37, 0.61, 0.23)),
        tables,
        /**
         * Waves leaving the throat, two rows each: (angle off the axis, width, light, _) and
         * (colour, _); then ripples round a newborn piece: (direction, angle) and (colour, light).
         */
        events: uniformArray(tables.events, 'vec4'),
        waveCount: uniform(0, 'int'),
        rippleCount: uniform(0, 'int'),
        gasTex: textures.gas,
        fbmTex: textures.fbm,
        envTex: texture(textures.env),
    };
    /** The gas's four fields at a point of the volume (one unit = one tile). */
    u.gas = (p3) => texture3D(u.gasTex, p3).level(0);
    /** The fBm grain (mipped), and at a fixed level. */
    u.fbm = (st) => texture(u.fbmTex, st);
    u.fbmLod = (st, lod = 0) => texture(u.fbmTex, st).level(lod);
    /**
     * The sky in a direction, from the environment target. Where the target is 8-bit
     * (`floatTarget` false) it holds the square root of the light over ENV_CODE_PEAK.
     */
    u.floatTarget = textures.floatTarget !== false;
    u.envAt = (dir) => {
        const stored = u.envTex.sample(swEnvUv(dir)).level(0);
        if (u.floatTarget) return stored.rgb;
        return stored.rgb.mul(stored.rgb).mul(ENV_CODE_PEAK);
    };
    return u;
}

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const swViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes.
 * `depthTest` lets the glass hide what is behind it; nothing here writes depth.
 */
export function swFxMaterial(name, { depthTest = false } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
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
export function swQuadGeometry(count, attributes = {}) {
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
export function swPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function swPassMaterial(name, node) {
    const material = new THREE.NodeMaterial();
    material.name = name;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = node;
    return material;
}

/**
 * Can this renderer draw into half-float targets? WebGPU always can. A WebGL2 context needs
 * EXT_color_buffer_float or EXT_color_buffer_half_float; without one a half-float target is an
 * incomplete framebuffer.
 */
export function supportsFloatTargets(renderer) {
    const backend = renderer?.backend;
    if (!backend || backend.isWebGPUBackend === true) return true;
    const { gl } = backend;
    if (!gl || typeof gl.getExtension !== 'function') return true;
    try {
        return Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } catch {
        return false;
    }
}

/** A linear colour target without depth: half-float, or 8-bit where that cannot be drawn to. */
export function swTarget(width, height, name, halfFloat = true, wrapS = THREE.ClampToEdgeWrapping) {
    const rt = new THREE.RenderTarget(Math.max(2, width), Math.max(2, height), {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    rt.texture.name = name;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = wrapS;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
}
