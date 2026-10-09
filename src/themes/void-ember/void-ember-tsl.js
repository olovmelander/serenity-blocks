/**
 * Void Ember — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    volume noise is ONE 256² texture read as a lattice (two z-slices side by side in its
 *    channels, so a 3D value-noise sample is a single fetch), the sky's clouds are one tileable
 *    half-float fBm texture, both baked on the CPU when the world is built;
 *  - nothing is lit by scene lights: every part writes its own light (MeshBasicNodeMaterial),
 *    scene-linear and unbounded (HDR); the post stack owns the tone map;
 *  - the solids (the star, the cinder world, the belt's rocks) write depth; every light is added
 *    on top with the depth test on, so a rock that crosses the star's face is a black shape on it
 *    and a flare loop that goes round the limb goes behind it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    pow,
    smoothstep,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    EMBER,
    HEAT_RAMP,
    IMPACT_SLOTS,
    REST_HEAT,
    TAU,
    VOID_PALETTES,
    WAVE_AFTERGLOW,
    WAVE_FRONT_GAP,
    WAVE_FRONT_WIDTH,
    WAVE_REACH,
    WAVE_SHAPE,
    WAVE_SLOTS,
    WAVE_TRAVEL,
    mulberry32,
} from './void-ember-core.js';

export * from './void-ember-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const veHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 've_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const veHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 've_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const veHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 've_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const veLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const veMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const veBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

// ── Heat ────────────────────────────────────────────────────────────────────────

const stop = (i) => vec3(HEAT_RAMP[i][1], HEAT_RAMP[i][2], HEAT_RAMP[i][3]);

/**
 * The colour of something at `heat`: a dying coal's deep red, through orange and gold to
 * white-hot past 1. Peak 1; the light it gives off is veGlow. TSL twin of
 * emberColor (void-ember-core.js).
 */
export const veBlackbody = /* @__PURE__ */ Fn(([heat]) => {
    const c = vec3(stop(0)).toVar();
    for (let i = 1; i < HEAT_RAMP.length; i++) {
        c.assign(mix(c, stop(i), smoothstep(HEAT_RAMP[i - 1][0], HEAT_RAMP[i][0], heat)));
    }
    return c;
}).setLayout({ name: 've_blackbody', type: 'vec3', inputs: [{ name: 'heat', type: 'float' }] });

/** How much light a surface at `heat` gives off. TSL twin of emberGlow. */
export const veGlow = /* @__PURE__ */ Fn(([heat]) => pow(max(heat, 0.0), 2.3).mul(2.6).add(0.035))
    .setLayout({ name: 've_glow', type: 'float', inputs: [{ name: 'heat', type: 'float' }] });

// ── The noise textures ──────────────────────────────────────────────────────────

export const LATTICE_SIZE = 256;
export const FBM_SIZE = 256;
/** The offset between two z-slices of the lattice (the classic 37, 17). */
const SLICE = [37, 17];

/**
 * White noise for 3D value noise in one fetch: G holds R shifted by one z-slice, A holds B
 * shifted the same way, so `mix(rb, ga, fz)` at `xy + SLICE · floor(z)` is the trilinear blend
 * of two independent fields. Must be sampled at level 0 with bilinear filtering.
 */
export function bakeLattice(seed = 9917, size = LATTICE_SIZE) {
    const rand = mulberry32(seed);
    const r = new Uint8Array(size * size);
    const b = new Uint8Array(size * size);
    for (let i = 0; i < r.length; i++) {
        r[i] = Math.floor(rand() * 256);
        b[i] = Math.floor(rand() * 256);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const j = ((y + SLICE[1]) % size) * size + ((x + SLICE[0]) % size);
            data[i * 4] = r[i];
            data[i * 4 + 1] = r[j];
            data[i * 4 + 2] = b[i];
            data[i * 4 + 3] = b[j];
        }
    }
    return data;
}

export function createLatticeTexture(data, size = LATTICE_SIZE) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'void-ember-lattice';
    tex.needsUpdate = true;
    return tex;
}

/** The CPU twin of veNoise3's first field (tests, and what the plan needs to know of the star). */
export function sampleLattice(data, x, y, z, size = LATTICE_SIZE) {
    const fade = (v) => v * v * (3 - 2 * v);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const wrap = (v) => ((v % size) + size) % size;
    const at = (cx, cy, cz) => data[(wrap(cy + SLICE[1] * cz) * size + wrap(cx + SLICE[0] * cz)) * 4] / 255;
    const slice = (cz) => {
        const top = at(ix, iy, cz) + (at(ix + 1, iy, cz) - at(ix, iy, cz)) * fx;
        const bottom = at(ix, iy + 1, cz) + (at(ix + 1, iy + 1, cz) - at(ix, iy + 1, cz)) * fx;
        return top + (bottom - top) * fy;
    };
    return slice(iz) + (slice(iz + 1) - slice(iz)) * fz;
}

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeFbm(seed = 3141, size = FBM_SIZE) {
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

/**
 * The fBm field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createFbmTexture(field, size = FBM_SIZE) {
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
    tex.name = 'void-ember-fbm';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ lattice: THREE.Texture, fbm: THREE.Texture }} textures
 */
export function createVoidEmberUniforms(textures) {
    const p = VOID_PALETTES[0];
    const far = () => new THREE.Vector4(0, 0, 0, -100);
    const u = {
        time: uniform(0),
        /** The clock the surface boils on, and the one the ember wind streams on (heat bends both). */
        boil: uniform(0),
        flow: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0005),
        /** The star: its centre in the world and its radius. */
        centre: uniform(new THREE.Vector3(-30, 0, -60)),
        radius: uniform(EMBER.radius),
        /** The star's own frame → world (a rotation), and back. */
        starRot: uniform(new THREE.Matrix3()),
        starInv: uniform(new THREE.Matrix3()),
        /** The star's axis in the world. */
        axis: uniform(new THREE.Vector3(0, 1, 0)),
        /** The way to the star from the camera, and the sine of its angular radius. */
        starDir: uniform(new THREE.Vector3(-0.4, 0, -0.9).normalize()),
        starSize: uniform(0.17),
        /** The belt's frame → world (a rotation; the belt is centred on the star). */
        beltRot: uniform(new THREE.Matrix3()),
        /** REST_HEAT at rest → HEAT_CHAIN (gold) in a long chain → white-gold after a four-line clear. */
        heat: uniform(REST_HEAT),
        /** Gain on every light: a four-line clear holds the ember's breath (→ 0.1). */
        breath: uniform(1),
        /**
         * How far the post's iris has closed, inverted: the lights of an event (a loop, a comet,
         * a shell) are raised by it, so they are as bright on screen over a white-hot star as
         * over a banked one.
         */
        iris: uniform(1),
        /** The corona and the ember wind wind up (a T-spin) and spring back: radians per radius. */
        twist: uniform(0),
        /** The light the star casts on what is round it (colour × strength at one radius). */
        starLight: uniform(new THREE.Vector3(1, 0.2, 0.03)),
        /** The share of it the dust of the void gets (it grows far less with the heat). */
        skyLight: uniform(new THREE.Vector3(1, 0.2, 0.03)),
        // The void's palette (scene-linear), eased by the world between levels.
        voidCol: v3(p.void),
        dustA: v3(p.dustA),
        dustB: v3(p.dustB),
        rock: v3(p.rock),
        fill: v3(p.fill),
        starTint: v3(p.star),
        /** The cinder world: its centre and radius. */
        worldCentre: uniform(new THREE.Vector3(60, 20, -180)),
        worldRadius: uniform(6),
        /**
         * Impacts on the photosphere, two rows each: (site in the star's frame, birth time) and
         * (colour, strength). `impactCount` rows are live.
         */
        impacts: uniformArray(Array.from({ length: IMPACT_SLOTS * 2 }, far), 'vec4'),
        impactCount: uniform(0, 'int'),
        /**
         * Clear waves, three rows each: (birth time, strength, fronts, shell thickness),
         * (colour, how much of the circle the shell covers 0..1), (the way it leaves in the
         * corona's plane, _, _).
         */
        waves: uniformArray(Array.from({ length: WAVE_SLOTS * 3 }, far), 'vec4'),
        /** 1 while any wave is still crossing the frame (the per-pixel wave maths is skipped at rest). */
        wavesLive: uniform(0),
        latticeTex: textures.lattice,
        fbmTex: textures.fbm,
    };
    /** The fBm clouds (mipped). */
    u.fbm = (st) => texture(u.fbmTex, st);
    /** A fixed mip: for fetches whose coordinates jump or that run in a vertex stage. */
    u.fbmLod = (st, lod = 0) => texture(u.fbmTex, st).level(lod);
    /**
     * 3D value noise, two independent fields in [0, 1], in ONE fetch. One unit of `at` is one
     * lattice cell.
     */
    u.noise3 = (at) => {
        const cell = floor(at);
        const f0 = fract(at);
        const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
        const st = cell.xy.add(vec2(SLICE[0], SLICE[1]).mul(cell.z)).add(f.xy).add(0.5).div(LATTICE_SIZE);
        const t = texture(u.latticeTex, st).level(0);
        return mix(t.xz, t.yw, f.z);
    };
    return u;
}

// ── The clear wave, as light ────────────────────────────────────────────────────

/**
 * The clear waves at `radii` (star radii from the centre). Returns vec4(colour · front,
 * afterglow): the bright leading fronts (one per cleared line) and the afterglow of everything
 * the wave has passed. An inline helper: it reads the wave rows.
 */
export const veWaveLight = (u, radii) => {
    // Built without vars: it is also called outside any Fn (a vertex stage's varying), where an
    // assignment has no stack to land on.
    let front = vec3(0.0);
    let glow = float(0.0);
    const far = clamp(radii.sub(1.0).div(WAVE_REACH), 0.0, 1.6);
    const pass = float(WAVE_TRAVEL).mul(pow(far, 1 / WAVE_SHAPE));
    for (let i = 0; i < WAVE_SLOTS; i++) {
        const A = u.waves.element(i * 3);
        const C = u.waves.element(i * 3 + 1);
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(veBell(since.sub(k * WAVE_FRONT_GAP).div(WAVE_FRONT_WIDTH)).mul(step(k + 0.5, A.z)));
        }
        const live = step(0.0, since).mul(A.y);
        front = front.add(C.rgb.mul(f.mul(A.y)));
        glow = glow.add(exp(max(since, 0.0).div(-WAVE_AFTERGLOW)).mul(live));
    }
    return vec4(front, min(glow, 1.5));
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. Depth is
 * tested (the solids hide what is behind them) and never written.
 */
export function veFxMaterial(name, { depthTest = true } = {}) {
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
export function veSolidMaterial(name) {
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
export function veQuadGeometry(count, attributes = {}) {
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
export function vePart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
