/**
 * Lunara — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights): the valley's light is
 *    the two moons (directions and colours in the shared uniforms), the sky they scatter into and
 *    the event pulses below, so the mirror's second render stays cheap;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    pow,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LOCK_SLOTS,
    LUNARA_PALETTES,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    TAU,
    TERRAIN,
    mulberry32,
} from './lunara-core.js';

export * from './lunara-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const luHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'lu_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const luHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'lu_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const luHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'lu_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const luLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const luMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const luBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 7717, size = NOISE_SIZE) {
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
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the water reads it
 * at grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
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
    tex.name = 'lunara-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The near terrain's heights (metres, water at 0) as a half-float texture the water reads. */
export function createHeightTexture(heights, size = TERRAIN.size) {
    const data = new Uint16Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'lunara-heights';
    tex.needsUpdate = true;
    return tex;
}

/** A 1×1 mid-grey stand-in for the moon map until it arrives. */
export function createPlaceholderTexture() {
    const tex = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255]), 1, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.name = 'lunara-placeholder';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the valley's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, heights: THREE.Texture }} textures
 */
export function createValleyUniforms(textures) {
    const p = LUNARA_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** 0..1: the valley's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light in the valley: a four-line clear holds its breath (→ 0.12). */
        breath: uniform(1),
        /** Unit vectors toward the great moon, its companion, the ringed world and their sun. */
        moonDir: uniform(new THREE.Vector3(-0.35, 0.4, -0.85).normalize()),
        companionDir: uniform(new THREE.Vector3(-0.2, 0.45, -0.87).normalize()),
        planetDir: uniform(new THREE.Vector3(0.5, 0.4, -0.77).normalize()),
        sunDir: uniform(new THREE.Vector3(0.75, 0.35, 0.56).normalize()),
        /** Angular radii (radians): (moon, companion, planet, _). */
        discs: uniform(new THREE.Vector4(0.17, 0.05, 0.04, 0)),
        // The palette (scene-linear), eased by the world between levels.
        moonCol: v3(p.moon),
        companionCol: v3(p.companion),
        zenith: v3(p.zenith),
        horizon: v3(p.horizon),
        glow: v3(p.glow),
        auroraLow: v3(p.auroraLow),
        auroraHigh: v3(p.auroraHigh),
        bed: v3(p.bed),
        crystal: v3(p.crystal),
        /** Curtain gain (≈ 0.3 at rest, → 2 in a storm) and how far the curtains have drifted. */
        aurora: uniform(0.3),
        auroraDrift: uniform(0),
        /** How far the motes have been carried up (the valley's charge lifts them faster). */
        moteLift: uniform(0),
        /**
         * Upright screens are too narrow to see where the spires stand: this draws every spire
         * this much nearer the middle of the flats (1 = where the plan put it).
         */
        squeeze: uniform(1),
        /** Halo rings round the great moon: 0..6, one per step of the chain. */
        rings: uniform(0),
        /** The light in the great moon's veins, 0..1.5. */
        veins: uniform(0),
        /** A four-line clear's shock ring across the sky: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** 1 while any ring / any clear wave is still in the valley (the loops are skipped at rest). */
        ringsLive: uniform(0),
        clearLive: uniform(0),
        /** Where on the flats the clear waves start: (x, z). */
        heart: uniform(new THREE.Vector2(0, -12)),
        /** Ring slots: (x, z, birth time, strength) + (colour, reach as a fraction of RING_REACH). */
        lockA: [],
        lockC: [],
        /** Clear slots: (birth time, fronts, strength, moonfire 0..1) + colour. */
        clearA: [],
        clearC: [],
        noiseTex: textures.noise,
        heightTex: textures.heights,
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    /** Terrain height (metres) at a world xz; far below the water outside the baked square. */
    u.height = (xz) => {
        const st = vec2(
            xz.x.add(TERRAIN.halfWidth).div(TERRAIN.halfWidth * 2),
            xz.y.sub(TERRAIN.zMin).div(TERRAIN.zMax - TERRAIN.zMin),
        );
        return texture(u.heightTex, st).r;
    };
    return u;
}

// ── The valley's light ──────────────────────────────────────────────────────────

/**
 * The sky a direction ends in, without its stars, curtains or discs: the zenith-to-horizon
 * gradient, the haze that lies on the horizon and the great moon's scatter. Every material uses
 * it — as the colour of distance, and as what a facet or the water mirrors.
 */
export const luSkyBase = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const grad = mix(u.horizon, u.zenith, pow(up, 0.3));
    const cm = max(dot(dir, u.moonDir), 0.0);
    const cm2 = cm.mul(cm);
    const cm8 = cm2.mul(cm2).mul(cm2).mul(cm2);
    const scatter = u.glow.mul(cm8.mul(0.035).add(cm8.mul(cm8).mul(cm8).mul(0.16)));
    const band = u.horizon.mul(exp(up.mul(-9.0))).mul(cm2.mul(1.1).add(0.35));
    return grad.add(scatter).add(band).mul(u.breath.mul(0.6).add(0.4));
};

/** The two moons' discs along a direction (what a facet or still water mirrors of them). */
export const luMoonDiscs = (u, dir) => {
    const soft = float(0.012);
    const a = smoothstep(u.discs.x.cos().sub(soft), u.discs.x.cos().add(soft.mul(0.25)), dot(dir, u.moonDir));
    const b = smoothstep(u.discs.y.cos().sub(soft.mul(0.3)), u.discs.y.cos().add(soft.mul(0.1)), dot(dir, u.companionDir));
    return u.moonCol.mul(a).mul(1.5).add(u.companionCol.mul(b).mul(1.3)).mul(u.breath);
};

/** Fraction of light lost between the camera and a point `dist` away at height `y`. */
export const luFogAmount = (dist, y) => {
    const thin = mix(float(1.0), float(0.4), smoothstep(4.0, 200.0, y));
    const k = dist.mul(1 / 860);
    const air = float(1.0).sub(exp(k.mul(k).mul(thin).negate()));
    // Mist lies on the water and round the feet of the ranges.
    const mist = float(1.0).sub(exp(dist.mul(-1 / 420))).mul(exp(y.mul(-0.085))).mul(0.42);
    return float(1.0).sub(float(1.0).sub(air).mul(float(1.0).sub(mist)));
};

/** Apply the atmosphere to a shaded colour at world point `p`. */
export const luAtmosphere = (u, col, p) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const f = luFogAmount(dist, max(p.y, 0.0));
    // Low mist near the water glows a little with the bed's own light.
    const mist = u.bed.mul(exp(max(p.y, 0.0).mul(-0.3))).mul(0.012).mul(u.power.mul(1.5).add(1.0));
    return mix(col, luSkyBase(u, vec3(dir.x, max(dir.y, 0.0), dir.z)).add(mist), f);
};

/**
 * Light of the lock rings at world point `p`: each lock sends a ring out over the flats from
 * under the board, and a smaller one from the foot of the spire its wisp strikes. Returns the
 * summed colour (HDR).
 */
export const luLockLight = (u, p) => {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = luBell(d.sub(radius).div(u.lockC[i].w.mul(1.8).add(1.4)));
        const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

/**
 * The clear waves at world point `p`. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const luClearLight = (u, p) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    const far = clamp(length(p.xz.sub(u.heart)).div(CLEAR_REACH), 0.0, 1.0);
    const pass = float(CLEAR_TRAVEL).mul(pow(far, 1 / CLEAR_SHAPE));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(luBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(since.div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function luFxMaterial(name, { depthTest = true } = {}) {
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
export function luQuadGeometry(count, attributes = {}) {
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
export function luPart(name, geometry, material, renderOrder = 0, reflected = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}
