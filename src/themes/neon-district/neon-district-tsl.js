/**
 * Neon District — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights): the district's light is
 *    the "glow map" (what the signs of each stretch of street throw on walls, road, rain and mist),
 *    the sky's haze and the event pulses below, so the reflector's second render stays cheap;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 *
 * The street runs along −Z from the camera and SCROLLS: every scrolling object carries its layout
 * depth z0 in [−PERIOD, 0) and is drawn at ndWrapZ(z0 + scroll), so the city flows past for ever
 * and re-enters inside the far haze.
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
    floor,
    fract,
    length,
    max,
    min,
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
    CLEAR_DEPTH,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LOCK_FADE,
    LOCK_REACH,
    LOCK_SHELL_WIDTH,
    LOCK_SLOTS,
    LOCK_TAU,
    STREET,
    TAU,
    linRGB,
    mulberry32,
} from './neon-district-core.js';

export * from './neon-district-core.js';

/** An sRGB hex as a scene-linear vec3 node. */
export function lin(hex) {
    const [r, g, b] = linRGB(hex);
    return vec3(r, g, b);
}

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const ndHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'nd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const ndHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'nd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1) */
export const ndHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'nd_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const ndHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'nd_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const ndLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const ndMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const ndBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** Wrap a scrolled depth into [wrapMax − period, wrapMax). */
export const ndWrapZ = /* @__PURE__ */ Fn(([z]) => {
    const p = float(STREET.period);
    return z.sub(p.mul(floor(z.sub(STREET.wrapMax).div(p)))).sub(p);
}).setLayout({ name: 'nd_wrapZ', type: 'float', inputs: [{ name: 'z', type: 'float' }] });

/** Anti-aliased box mask: 1 inside [lo, hi] on both axes, `aa` wide edges. */
export const ndBoxAA = (p, lo, hi, aa) => {
    const a = smoothstep(lo.sub(aa), lo.add(aa), p);
    const b = float(1.0).sub(smoothstep(hi.sub(aa), hi.add(aa), p));
    return a.x.mul(a.y).mul(b.x).mul(b.y);
};

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * A tileable RGBA fBm texture: four decorrelated channels of periodic gradient noise (five
 * octaves), stretched to [0, 1], half floats, with a CPU-built mip chain (the street reads it at
 * grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
 * Baked once (≈ 45 ms); every cloud, grime streak and puddle in the district is a fetch of it.
 */
export function createNoiseTexture(seed = 9029, size = NOISE_SIZE) {
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
    // Mip chain: 2×2 box filter down to 1×1.
    const mipmaps = [];
    let level = base;
    let w = n;
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
    const tex = new THREE.DataTexture(mipmaps[0].data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'neon-district-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The glow map as a texture: GLOW_TEXELS × 2 half floats, repeating along the street. */
export function createGlowTexture(glow, texels) {
    const data = new Uint16Array(glow.length);
    for (let i = 0; i < glow.length; i++) data[i] = THREE.DataUtils.toHalfFloat(glow[i]);
    const tex = new THREE.DataTexture(data, texels, 2, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'neon-district-glow';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

/**
 * Every uniform the district's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, glow: THREE.Texture }} textures
 */
export function createDistrictUniforms(textures) {
    const u = {
        time: uniform(0),
        /** Metres the city has flowed toward the camera. */
        scroll: uniform(0),
        /** 0..1: the district's charge (combo). */
        power: uniform(0),
        /** 0..1: palette temperature — cyan/rose at rest, molten gold in overdrive. */
        heat: uniform(0),
        /** Gain on every neon emitter (blackouts pull it down, overdrive pushes it up). */
        neon: uniform(1),
        /** 0..1: sign glitch (T-spins, the blackout's edges). */
        glitch: uniform(0),
        /** Sheet lightning in the smog, 0..1. */
        storm: uniform(0),
        /** Rain density 0..1 and wetness of every surface. */
        rain: uniform(1),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Haze colours: at street level and high in the smog. */
        hazeLow: uniform(new THREE.Vector3(0.05, 0.02, 0.09)),
        hazeHigh: uniform(new THREE.Vector3(0.012, 0.01, 0.035)),
        /** The two district accents (scene-linear) the unlit architecture borrows. */
        accentA: uniform(new THREE.Vector3(0.03, 0.75, 1.0)),
        accentB: uniform(new THREE.Vector3(1.0, 0.03, 0.27)),
        /** Lock slots: (x, z − scroll at birth, birth time, strength) + colour. */
        lockA: [],
        lockC: [],
        /** Clear slots: (birth time, fronts, strength, gold 0..1) + colour. */
        clearA: [],
        clearC: [],
        noiseTex: textures.noise,
        glowTex: textures.glow,
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── The district's light ────────────────────────────────────────────────────────

/**
 * What the signs of this stretch of street throw at a world point: the glow map is two rows
 * (left wall, right wall) of colour along the period; x blends between them.
 */
export function ndGlow(u, p) {
    const s = fract(p.z.sub(u.scroll).div(STREET.period));
    const t = smoothstep(-STREET.halfStreet, STREET.halfStreet, p.x).mul(0.5).add(0.25);
    return texture(u.glowTex, vec2(s, t)).rgb.mul(u.neon);
}

/** Fraction of light lost between the camera and a point `dist` away at height `y`. */
export function ndFogAmount(dist, y) {
    const thin = mix(float(1.0), float(0.06), smoothstep(6.0, 150.0, y));
    const k = dist.mul(1 / 172);
    return float(1.0).sub(exp(k.mul(k).mul(thin).negate()));
}

/**
 * The haze a view ray ends in: street-level mist carries the district's own light, the smog above
 * is dark and only catches the city from below. `rel` = point − camera.
 */
export function ndHaze(u, rel) {
    const up = rel.y.div(max(length(rel), 1e-3));
    const k = smoothstep(-0.05, 0.42, up);
    // The mist follows the district's power down (a blackout darkens it) but not up: a charged
    // district must keep its blacks, or its neon has nothing to burn against.
    const low = u.hazeLow.mul(min(u.neon, 1.0).mul(0.75).add(0.25));
    return mix(low, u.hazeHigh, k);
}

/** Apply the atmosphere to a shaded colour at world point `p`. */
export function ndAtmosphere(u, col, p) {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const f = ndFogAmount(dist, max(p.y, 0.0));
    // Mist near the ground also carries the local signs' colour.
    const local = ndGlow(u, p).mul(exp(max(p.y, 0.0).mul(-0.11))).mul(0.16);
    return mix(col, ndHaze(u, rel).add(local), f);
}

/**
 * Light of the lock shells at world point `p`: each lock throws an expanding shell from where the
 * piece landed. Returns the summed colour (HDR).
 */
export function ndLockLight(u, p) {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = float(LOCK_REACH).mul(float(1.0).sub(exp(age.div(-LOCK_TAU))));
        const d = length(p.sub(vec3(A.x, 0.0, A.y.add(u.scroll))));
        const shell = ndBell(d.sub(radius).div(LOCK_SHELL_WIDTH));
        const env = exp(age.mul(-LOCK_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].mul(shell.mul(env)));
    }
    return sum;
}

/**
 * The clear waves at depth `z` (world, negative ahead of the camera). Returns
 * vec4(colour · front, afterglow): the bright leading fronts (one per cleared line) and the
 * afterglow of everything the wave has already passed.
 */
export function ndClearLight(u, z) {
    let front = vec3(0.0);
    let glow = float(0.0);
    const depth = clamp(z.negate().div(CLEAR_DEPTH), 0.0, 1.0);
    const pass = float(CLEAR_TRAVEL).mul(float(1.0).sub(pow(depth, 1 / CLEAR_SHAPE)));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(ndBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(since.div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function ndFxMaterial(name, { depthTest = true } = {}) {
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
export function ndQuadGeometry(count, attributes = {}) {
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
