/**
 * Stellar Drift — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    cloud and the nebula read one tileable half-float fBm texture, the moons and the ice one
 *    256² lattice (two z-slices side by side in its channels, so a 3D value-noise sample is a
 *    single fetch); the rings and the giant's bands are 1D tables. All of it is baked on the
 *    CPU when the world is built (stellar-drift-bake.js); nothing is downloaded;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and
 *    unbounded (HDR); the post stack owns the tone map;
 *  - the giant, its rings, the moons and the sky are ONE full-screen pass that traces them
 *    (stellar-drift-space.js), so every edge is anti-aliased analytically and every shadow is
 *    exact; what is drawn as geometry on top (the ice, the meteors) hides itself behind the
 *    giant in its own vertex stage.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    dot,
    float,
    floor,
    fract,
    max,
    mix,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';

import {
    EVENT_ROWS, GIANT, PALETTES, PALETTE_COUNT,
} from './stellar-drift-core.js';
import { LATTICE_SIZE, LATTICE_SLICE } from './stellar-drift-bake.js';
import { derivedOnce } from '../shared/bake-cache.js';

export * from './stellar-drift-core.js';
export * from './stellar-drift-bake.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const sdHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'sd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const sdHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const sdHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'sd_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const sdLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const sdMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const sdBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** Henyey–Greenstein phase function over 4π, for the cosine of the scattering angle. */
export const sdPhase = /* @__PURE__ */ Fn(([cosT, g]) => {
    const g2 = g.mul(g);
    const d = max(float(1.0).add(g2).sub(g.mul(cosT).mul(2.0)), 1e-4);
    return float(1.0).sub(g2).div(d.mul(d.sqrt()));
}).setLayout({
    name: 'sd_phase', type: 'float', inputs: [{ name: 'cosT', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── Textures ────────────────────────────────────────────────────────────────────

export function createLatticeTexture(data, size = LATTICE_SIZE) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'stellar-drift-lattice';
    tex.needsUpdate = true;
    return tex;
}

/**
 * The fBm field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createFbmTexture(field, size) {
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
    tex.name = 'stellar-drift-fbm';
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

/** The rings' radial profile, with the mip chain the bake averaged. */
export function createRingTexture(profile) {
    const tex = new THREE.DataTexture(profile.levels[0].data, profile.size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mipmaps = profile.levels.map((level) => ({ data: level.data, width: level.width, height: 1 }));
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'stellar-drift-rings';
    tex.needsUpdate = true;
    return tex;
}

function tableTexture(data, width, height, name, srgb) {
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    // Rows are palettes on a wheel: the last one blends on into the first.
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

export const createBandMetaTexture = (meta) => tableTexture(meta.data, meta.size, 1, 'stellar-drift-band-meta', false);
export const createBandColorTexture = (colors) => tableTexture(
    colors.data,
    colors.size,
    colors.rows,
    'stellar-drift-bands',
    true,
);
export const createBandBlurTexture = (colors) => tableTexture(
    colors.small,
    colors.smallSize,
    colors.rows,
    'stellar-drift-bands-far',
    true,
);

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ lattice, fbm, rings, bandMeta, bands, bandsFar }} textures
 * @param {{ fbmSize: number, ringSize: number, bandSize: number }} sizes
 */
export function createStellarDriftUniforms(textures, sizes) {
    const p = PALETTES[0];
    const idle = () => new THREE.Vector4(0, 0, -1000, 0);
    const u = {
        time: uniform(0),
        /** The cloud's flow clock, in cycles (the two reads cross-fade over one). */
        flow: uniform(0),
        /** The giant's turn, radians. */
        spin: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, as the full-screen pass needs it: where it is and its three axes, and the
        // tangents of half its field of view (x, y).
        camPos: uniform(new THREE.Vector3(0, 1, 5)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.5, 0.28)),
        // The sky's own sheet: the resting camera's axes (the nebula is laid out in the frame
        // the composition is made for, and stays at infinity when the camera leans), and the
        // scale that turns a direction into screen heights.
        skyRight: uniform(new THREE.Vector3(1, 0, 0)),
        skyUp: uniform(new THREE.Vector3(0, 1, 0)),
        skyFwd: uniform(new THREE.Vector3(0, 0, -1)),
        skyScale: uniform(1.7),
        /** Where the nebula's bright bank lies on the sheet (screen heights from the centre). */
        skyBank: uniform(new THREE.Vector4(0.5, 0.16, -0.5, -0.24)),
        /** The way to the sun. */
        sunDir: uniform(new THREE.Vector3(-0.6, 0.3, 0.74)),
        /** Gain on the sun's light (an event may raise it for a moment). */
        sunGain: uniform(1),
        /** Where the bands read their colours: row + the way through the step to the next. */
        bandPlace: uniform(0),
        /** The rings' own light: (the chain's hum 0..1, spoke strength, the swell's clock, crown 0..1). */
        ringGlow: uniform(new THREE.Vector4(0, 0.5, 0, 0)),
        /** The colour the rings take from the board (a chain's own colour). */
        accent: uniform(new THREE.Vector3(0.4, 0.9, 1.0)),
        /** The moons: centre and radius. */
        moonA: uniform(new THREE.Vector4(6, 2, -8, 0.5)),
        moonB: uniform(new THREE.Vector4(5, -2, -4, 0.2)),
        /** The icy moon's plumes (0..1), and the way they point. */
        plume: uniform(0.25),
        plumeDir: uniform(new THREE.Vector3(0.2, -0.95, 0.2).normalize()),
        // The palette (scene-linear), mixed on the CPU between two neighbours of the wheel.
        storm: v3(p.storm),
        haze: v3(p.haze),
        night: v3(p.night),
        sun: v3(p.sun),
        ringIce: v3(p.ringIce),
        ringDust: v3(p.ringDust),
        gasA: v3(p.gasA),
        gasB: v3(p.gasB),
        deep: v3(p.deep),
        starTint: v3(p.starTint),
        bolt: v3(p.bolt),
        moonIce: v3(p.moonIce),
        moonRust: v3(p.moonRust),
        /** The giant's own mean light (what it casts on the rings' dark side and on the moons). */
        shine: v3(p.zoneB),
        /**
         * What the board has done, as rows of one table (EVENT_ROWS names the blocks); two rows
         * per event. `counts` = live ripples, chimes, jets, strikes; `bolts` = live bolts.
         */
        events: uniformArray(Array.from({ length: EVENT_ROWS.total }, idle), 'vec4'),
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        bolts: uniform(0),
        // The flourishes (stellar-drift-core.js): two surges and two shells may run at once; the
        // cyclone and the strand are fed by a second reward, so the world hands their light.
        /** A T-spin's cyclone: (longitude in the giant's frame, latitude, birth, light now). */
        cyclone: uniform(new THREE.Vector4(0, 0, -1000, 0)),
        /** Its colour, and which way it winds (±1). */
        cycloneTint: uniform(new THREE.Vector4(1, 1, 1, 1)),
        /** A surge round the rings: (bearing it leaves, how far round it has run, power, breadth), and its colour. */
        surge: uniform(new THREE.Vector4(0, 0, 0, 0)),
        surgeTint: uniform(new THREE.Vector3(1, 1, 1)),
        /** A second surge still running when the newest left. */
        surgeB: uniform(new THREE.Vector4(0, 0, 0, 0)),
        surgeTintB: uniform(new THREE.Vector3(1, 1, 1)),
        /** The outer strand ablaze: (birth, light now, seed, _), and its colour. */
        strand: uniform(new THREE.Vector4(-1000, 0, 0, 0)),
        strandTint: uniform(new THREE.Vector3(1, 0.9, 0.7)),
        /** A shell of light thrown off the giant: (birth, power, _, _), and its colour. */
        shock: uniform(new THREE.Vector4(-1000, 0, 0, 0)),
        shockTint: uniform(new THREE.Vector3(1, 0.9, 0.7)),
        /** A second shell still running when the newest left. */
        shockB: uniform(new THREE.Vector4(-1000, 0, 0, 0)),
        shockTintB: uniform(new THREE.Vector3(1, 0.9, 0.7)),
        /**
         * How hot play runs, as the giant wears it (src/themes/shared/gameplay-surge.js): (how
         * tightly its ovals are wound, 1 at rest; the glow in their hearts; the plasma corona
         * along its limb; _).
         */
        drive: uniform(new THREE.Vector4(1, 0, 0, 0)),
        latticeTex: textures.lattice,
        fbmTex: textures.fbm,
        ringTex: textures.rings,
        bandMetaTex: textures.bandMeta,
        bandTex: textures.bands,
        bandFarTex: textures.bandsFar,
        fbmSize: sizes.fbmSize,
        ringSize: sizes.ringSize,
        bandSize: sizes.bandSize,
        bandRows: PALETTE_COUNT,
        hazeHeight: GIANT.hazeHeight,
    };
    /** The fBm clouds (mipped by the sampler). */
    u.fbm = (st) => texture(u.fbmTex, st);
    /** A fixed mip: for fetches whose coordinates jump (a longitude's seam) or that run in a vertex stage. */
    u.fbmLod = (st, lod = 0) => texture(u.fbmTex, st).level(lod);
    /**
     * 3D value noise, two independent fields in [0, 1], in ONE fetch. One unit of `at` is one
     * lattice cell.
     */
    u.noise3 = (at) => {
        const cell = floor(at);
        const f0 = fract(at);
        const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
        const st = cell.xy.add(vec2(LATTICE_SLICE[0], LATTICE_SLICE[1]).mul(cell.z)).add(f.xy).add(0.5)
            .div(LATTICE_SIZE);
        const t = texture(u.latticeTex, st).level(0);
        return mix(t.xz, t.yw, f.z);
    };
    return u;
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. Depth is
 * tested (the ice hides what is behind it) and never written.
 */
export function sdFxMaterial(name, { depthTest = true } = {}) {
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

/** A solid: opaque, depth-tested and depth-writing, lit by its own shader. */
export function sdSolidMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = name;
    m.fog = false;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function sdQuadGeometry(count, attributes = {}) {
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
export function sdPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
