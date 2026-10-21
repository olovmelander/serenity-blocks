/**
 * Voltage Storm — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    cloud reads ONE tileable 3D texture and the water, the hills and the rain shafts ONE
 *    tileable 2D texture, both baked on the CPU; hashes are hash-without-sine;
 *  - nothing is lit by scene lights: every part shades itself (MeshBasicNodeMaterial /
 *    NodeMaterial), scene-linear and unbounded (HDR); the post stack owns the tone map;
 *  - event data lives in a few `uniformArray` tables of vec4 rows written by the world; live
 *    rows are kept at the front and counted, so an idle storm loops over nothing.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec3,
} from 'three/tsl';

import {
    BOLT_ROWS,
    BOLT_SLOTS,
    FLASH_SLOTS,
    SHOCK_FADE,
    SHOCK_SLOTS,
    SKY_CODE_PEAK,
    STORM,
    TOWER_MAX,
    VOLTAGE_STORM_PALETTES,
} from './voltage-storm-core.js';
import { derivedOnce } from '../shared/bake-cache.js';
import { NOISE_SIZE } from './voltage-storm-bake.js';
// The bakes are pure and three-free (voltage-storm-bake.js): a first visit runs them in a worker.
export {
    NOISE_SIZE, NOISE_SLOPE_GAIN, bakeCloudNoise, bakeNoise,
} from './voltage-storm-bake.js';

export * from './voltage-storm-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const vsHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'vs_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const vsHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'vs_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** float → vec2 in [0,1) */
export const vsHash12 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn, pIn, pIn).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'vs_hash12', type: 'vec2', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → vec2 in [0,1) */
export const vsHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'vs_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const vsLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const vsMax3 = (c) => max(c.x, max(c.y, c.z));

/** e^(−x²). */
export const vsGauss = (x) => exp(x.mul(x).negate());

// ── The 2D noise texture ────────────────────────────────────────────────────────

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    // The CPU mip chain is derived once per cached field; each texture gets its own records.
    const mipmaps = derivedOnce(field, `mips:${size}`, () => mipsNoise(field, size)).map((mip) => ({ ...mip }));
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'voltage-storm-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The half-float mip chain of a field (pure: derived once per field). */
function mipsNoise(field, size) {
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

// ── The cloud's 3D noise ────────────────────────────────────────────────────────

export function createCloudTexture(data, size) {
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
    tex.name = 'voltage-storm-cloud';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/**
 * Every uniform the storm's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, cloud: THREE.Data3DTexture, sky: THREE.Texture }} textures
 */
export function createStormUniforms(textures) {
    const p = VOLTAGE_STORM_PALETTES[0];
    const tables = {
        bolts: rows(BOLT_SLOTS * BOLT_ROWS),
        flashes: rows(FLASH_SLOTS * 2),
        shocks: rows(SHOCK_SLOTS * 2, [0, 0, -100, 0]),
        towers: rows(TOWER_MAX * 3),
    };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, for the sky target (which is drawn without one).
        camPos: uniform(new THREE.Vector3(0, STORM.eye, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.6, 0.34)),
        /** The horizon's height in the frame (uv.y, down): the water mirrors the sky about it. */
        horizonV: uniform(0.7),
        /** Gain on every light the storm makes itself: a four-line clear holds its breath. */
        breath: uniform(1),
        /** 1: the towers' obstruction beacons pulse; 0: they burn steady (reduced motion or flashing). */
        blink: uniform(1),
        /** 0..1: the chain's charge. */
        power: uniform(0),
        /** 0..1.3: the overdrive after a superbolt. */
        surge: uniform(0),
        /** How far the cloud has drifted (metres) and the churn's clock (gameplay bends both). */
        drift: uniform(new THREE.Vector3(0, 0, 0)),
        churn: uniform(0),
        /** The rain's own clock (it hangs while the storm holds its breath) and its lean and weight. */
        rainClock: uniform(0),
        rainLean: uniform(new THREE.Vector2(0.16, 0.05)),
        rainGain: uniform(1),
        /** The cloud's twist over the hero tower: (x, z, angle in radians, radius in metres). */
        twist: uniform(new THREE.Vector4(0, -200, 0, 900)),
        /** Sheet lightning running out through the cloud: (x, z, birth time, strength). */
        sheet: uniform(new THREE.Vector4(0, 0, -100, 0)),
        /** The strokes' light where the camera stands (rain, haze, the post's flash). */
        veil: uniform(new THREE.Vector3(0, 0, 0)),
        // The palette (scene-linear), eased by the world between levels.
        horizon: v3(p.horizon),
        gap: v3(p.gap),
        cloud: v3(p.cloud),
        rim: v3(p.rim),
        haze: v3(p.haze),
        bolt: v3(p.bolt),
        flash: v3(p.flash),
        water: v3(p.water),
        corona: v3(p.corona),
        chain: v3(p.chain),
        steel: v3(p.steel),
        /** Live rows at the front of the flash and shock tables. */
        flashCount: uniform(0),
        shockCount: uniform(0),
        tables,
        /** Bolt table: four rows per slot (see BOLT_KIND in the core). */
        bolts: uniformArray(tables.bolts, 'vec4'),
        /** Flash table: (position, reach in metres) + (rgb light, _). */
        flashes: uniformArray(tables.flashes, 'vec4'),
        /** Shock table: (x, z, birth time, strength) + (rgb, speed m/s). */
        shocks: uniformArray(tables.shocks, 'vec4'),
        /**
         * Tower table, three rows per tower: (x, z, height, live) + (held rgb, ring fill 0..1) +
         * (strike flash, lock pulse birth, lock pulse strength, corona 0..1).
         */
        towers: uniformArray(tables.towers, 'vec4'),
        noiseTex: textures.noise,
        cloudTex: textures.cloud,
        skyTex: texture(textures.sky),
    };
    u.noise = (st) => texture(u.noiseTex, st);
    /** A fixed mip: for fetches in a vertex stage or whose coordinates jump. */
    u.noiseLod = (st, lod = 0) => texture(u.noiseTex, st).level(lod);
    u.cloudNoise = (p3) => texture3D(u.cloudTex, p3).level(0);
    /**
     * The sky target's light at a screen UV. Where the target is 8-bit (`floatSky` false) it holds
     * the square root of the light over SKY_CODE_PEAK, so the dark cloud keeps its steps.
     */
    u.floatSky = textures.floatSky !== false;
    u.skyAt = (st) => {
        const stored = u.skyTex.sample(st).rgb;
        return u.floatSky ? stored : stored.mul(stored).mul(SKY_CODE_PEAK);
    };
    return u;
}

/**
 * The strokes' light at a world point: every live flash, falling off with distance over its own
 * reach. Inline (it reads the flash table), so call it once per shader.
 */
export const vsFlashLight = (u, point, name = 'fl') => {
    const sum = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.flashCount), type: 'int', condition: '<', name,
    }, (loop) => {
        const index = loop[name];
        const at = u.flashes.element(index.mul(2));
        const light = u.flashes.element(index.mul(2).add(1));
        const away = point.sub(at.xyz);
        // 1 / (1 + d²/r²)²: full within its reach, gone by three times that (a stroke lights its
        // own part of the storm, not the whole sky).
        const fall = float(1.0).div(float(1.0).add(dot(away, away).div(at.w.mul(at.w))));
        sum.addAssign(light.xyz.mul(fall.mul(fall)));
    });
    return sum;
};

/**
 * The rings crossing the water at `xz`: `{ slope }` (a vec2 along each ring's radius) and
 * `{ light }` (each ring's own colour on its front). A ring is a short train of ripples behind a
 * bright front.
 */
export const vsShockRings = (u, xz, name = 'sk') => {
    const slope = vec3(0.0).toVar(); // xy = slope, z unused
    const light = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.shockCount), type: 'int', condition: '<', name,
    }, (loop) => {
        const index = loop[name];
        const a = u.shocks.element(index.mul(2));
        const c = u.shocks.element(index.mul(2).add(1));
        const age = max(u.time.sub(a.z), 0.0);
        const away = xz.sub(a.xy);
        const dist = max(length(away), 0.01);
        const front = age.mul(c.w);
        const x = dist.sub(front);
        const width = float(6.0).add(front.mul(0.035));
        const env = exp(x.mul(x).div(width.mul(width)).negate()).mul(a.w).mul(exp(age.mul(-SHOCK_FADE)));
        const wave = x.div(width).mul(2.4).cos().mul(env);
        slope.addAssign(vec3(away.div(dist).mul(wave), 0.0));
        light.addAssign(c.xyz.mul(env));
    });
    return { slope: slope.xy, light };
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function vsFxMaterial(name, { depthTest = true } = {}) {
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
export function vsQuadGeometry(count, attributes = {}) {
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
export function vsPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function vsPassMaterial(name, node) {
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

/** Clamp-to-edge, linear colour target without depth: half-float, or 8-bit where that cannot be drawn to. */
export function vsTarget(width, height, name, halfFloat = true) {
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
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
}
