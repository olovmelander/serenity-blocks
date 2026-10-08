/**
 * Geode — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - a helper called more than once carries `setLayout` when it is a pure function of its
 *    arguments, so it is emitted ONCE as a real shader function; helpers that read uniforms or
 *    textures stay inline (a laid-out function cannot see them);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights): the geode's light is
 *    the heart behind the far wall, a cool fill from the viewer's side and the event pulses below;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    pow,
    sin,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CAVITY,
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    GEODE_PALETTES,
    MINERALS,
    PULSE_FADE,
    PULSE_REACH,
    PULSE_SLOTS,
    PULSE_TAU,
    PULSE_WIDTH,
    STRIKE_FADE,
    STRIKE_REACH,
    STRIKE_SLOTS,
    STRIKE_TAU,
    TAU,
    mulberry32,
} from './geode-core.js';

export * from './geode-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const gdHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'gd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const gdHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'gd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const gdHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'gd_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const gdLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const gdMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const gdBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** A saturated spectral colour for a hue in turns (the GPU twin of core's `spectrum`). */
export const gdSpectrum = /* @__PURE__ */ Fn(([h]) => {
    const s = cos(h.sub(vec3(0.0, 1 / 3, 2 / 3)).mul(TAU)).mul(0.5).add(0.5);
    return s.mul(s).mul(1.3).add(0.02);
}).setLayout({ name: 'gd_spectrum', type: 'vec3', inputs: [{ name: 'h', type: 'float' }] });

/** The wall coordinate w (the ring a point stands on): the angle from the heart. */
export const gdWallW = (p) => atan(length(p.xy).div(CAVITY.a), float(CAVITY.zc).sub(p.z).div(CAVITY.c));

/**
 * Glitter: one glint per cell of a world-space grid. Each cell holds a point (jittered inside
 * it) and a facet with its own normal; the facet flashes when it mirrors a light at the eye, so
 * the lining twinkles as the view drifts. Returns (flash, hue seed).
 */
export const gdGlitter = /* @__PURE__ */ Fn(([p, cell, N, H1, H2, time]) => {
    const g = p.div(cell);
    const id = floor(g);
    const h = gdHash33(id);
    const k = gdHash33(id.add(vec3(17.3, 5.1, 9.7)));
    const d = length(fract(g).sub(0.5).sub(h.sub(0.5).mul(0.5)));
    const dotShape = exp(d.mul(d).mul(-46.0));
    const n = normalize(mix(N, k.mul(2.0).sub(1.0), 0.8));
    const a = max(dot(n, H1), 0.0);
    const b = max(dot(n, H2), 0.0);
    const a2 = a.mul(a);
    const a8 = a2.mul(a2).mul(a2).mul(a2);
    const b2 = b.mul(b);
    const b8 = b2.mul(b2).mul(b2).mul(b2);
    const flash = a8.mul(a8).mul(a8).add(b8.mul(b8).mul(0.6));
    const twinkle = sin(time.mul(h.z.mul(2.6).add(0.7)).add(h.x.mul(40.0))).mul(0.35).add(0.65);
    return vec2(flash.mul(dotShape).mul(twinkle), k.x.add(h.y));
}).setLayout({
    name: 'gd_glitter',
    type: 'vec2',
    inputs: [
        { name: 'p', type: 'vec3' }, { name: 'cell', type: 'float' }, { name: 'N', type: 'vec3' },
        { name: 'H1', type: 'vec3' }, { name: 'H2', type: 'vec3' }, { name: 'time', type: 'float' },
    ],
});

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4409, size = NOISE_SIZE) {
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
    tex.name = 'geode-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the geode's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createGeodeUniforms(textures) {
    const p = GEODE_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** 0..1: the geode's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light in the geode: a four-line clear holds its breath (→ 0.12). */
        breath: uniform(1),
        /** Where the heart's light comes from (a point just inside the far pole). */
        heartPos: uniform(new THREE.Vector3(0, 0, CAVITY.zc - CAVITY.c + 5)),
        // The palette (scene-linear), eased by the world between levels.
        heart: v3(p.heart),
        fill: v3(p.fill),
        rock: v3(p.rock),
        druzy: v3(p.druzy),
        bands: [v3(p.band0), v3(p.band1), v3(p.band2), v3(p.band3)],
        minerals: [],
        /** How far the dust has been carried round the axis and toward the viewer. */
        drift: uniform(0),
        /** A T-spin turns the agate: the bands' phase round the axis. */
        twist: uniform(0),
        /** Rings of the crown grown (0..CROWN_RINGS, eased). */
        crown: uniform(0),
        /** A four-line clear's fracture: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** (any ring live, any ripple live, any clear live, fracture live): the loops rest at 0. */
        live: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Heart rings: (birth time, strength, reach, _) + colour. */
        pulseA: [],
        pulseC: [],
        /** Ripples where a spark lands: (x, y, z, birth time) + (colour, strength). */
        strikeA: [],
        strikeC: [],
        /** Clear slots: (birth time, fronts, strength, geodefire 0..1) + colour. */
        clearA: [],
        clearC: [],
        noiseTex: textures.noise,
    };
    for (let i = 0; i < MINERALS; i++) u.minerals.push(v3(p[`m${i}`]));
    for (let i = 0; i < PULSE_SLOTS; i++) {
        u.pulseA.push(uniform(new THREE.Vector4(-100, 0, 1, 0)));
        u.pulseC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < STRIKE_SLOTS; i++) {
        u.strikeA.push(uniform(new THREE.Vector4(0, 0, 0, -100)));
        u.strikeC.push(uniform(new THREE.Vector4(1, 1, 1, 0)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── The geode's light ───────────────────────────────────────────────────────────

/** The mineral a (fractional) index names: neighbours blend, so zones of the lining grade. */
export const gdMineral = (u, index) => {
    let sum = vec3(0.0);
    for (let i = 0; i < MINERALS; i++) {
        sum = sum.add(u.minerals[i].mul(max(float(1.0).sub(abs(index.sub(i))), 0.0)));
    }
    // The index wraps: the last mineral grades back into the first.
    return sum.add(u.minerals[0].mul(max(float(1.0).sub(abs(index.sub(MINERALS))), 0.0)));
};

/** The agate's colour at a band coordinate (the four band colours, in turn, softly joined). */
export const gdBandRamp = (u, x) => {
    const f = fract(x).mul(4.0);
    const k = (i) => max(float(1.0).sub(abs(f.sub(i))), 0.0);
    return u.bands[0].mul(k(0).add(k(4)))
        .add(u.bands[1].mul(k(1)))
        .add(u.bands[2].mul(k(2)))
        .add(u.bands[3].mul(k(3)));
};

/**
 * What a facet mirrors of the cavity along a direction: the dark lining, the heart's warm lobe
 * down the axis, and the ring of lit agate round it.
 */
export const gdEnv = (u, dir) => {
    const toHeart = max(dir.z.negate(), 0.0);
    const h2 = toHeart.mul(toHeart);
    const h8 = h2.mul(h2).mul(h2).mul(h2);
    const warm = u.heart.mul(h8.mul(h8).mul(1.5).add(h2.mul(0.1)));
    const ring = u.bands[0].mul(gdBell(toHeart.sub(0.82).mul(7.0))).mul(0.22);
    const lining = mix(u.rock.mul(1.6), u.druzy.mul(0.09), dir.y.mul(0.5).add(0.5));
    return lining.add(warm).add(ring).mul(u.breath.mul(0.6).add(0.4));
};

/**
 * Light of the heart rings at wall coordinate `w`: each lock sends a thin ring out from the
 * heart along the wall, with a short wake behind it. Returns the summed colour (HDR).
 */
export const gdPulseLight = (u, w) => {
    let sum = vec3(0.0);
    for (let i = 0; i < PULSE_SLOTS; i++) {
        const A = u.pulseA[i];
        const age = u.time.sub(A.x);
        const front = A.z.mul(PULSE_REACH).mul(float(1.0).sub(exp(age.div(-PULSE_TAU))));
        const behind = front.sub(w);
        const shell = gdBell(behind.div(PULSE_WIDTH))
            .add(exp(max(behind, 0.0).mul(-9.0)).mul(step(0.0, behind)).mul(0.22));
        const env = exp(age.mul(-PULSE_FADE)).mul(step(0.0, age)).mul(A.y);
        sum = sum.add(u.pulseC[i].mul(shell.mul(env)));
    }
    return sum;
};

/** Light of the ripples that run over the wall from where a spark landed, at world point `p`. */
export const gdStrikeLight = (u, p) => {
    let sum = vec3(0.0);
    for (let i = 0; i < STRIKE_SLOTS; i++) {
        const A = u.strikeA[i];
        const age = u.time.sub(A.w);
        const radius = float(STRIKE_REACH).mul(float(1.0).sub(exp(age.div(-STRIKE_TAU))));
        const d = length(p.sub(A.xyz));
        const shell = gdBell(d.sub(radius).div(1.7)).add(exp(d.mul(-0.5)).mul(exp(age.mul(-3.0))).mul(0.8));
        const env = exp(age.mul(-STRIKE_FADE)).mul(step(0.0, age)).mul(u.strikeC[i].w);
        sum = sum.add(u.strikeC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

/**
 * The clear waves at wall coordinate `w`. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const gdClearLight = (u, w) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    const pass = float(CLEAR_TRAVEL).mul(pow(clamp(w.div(CLEAR_REACH), 0.0, 1.0), 1 / CLEAR_SHAPE));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(gdBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(max(since, 0.0).div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

/**
 * Every wave that reaches a point of the wall — vec4(colour, a clear's afterglow) — for the
 * vertex stage of the instanced stones. The loops rest while nothing is live. The point and its
 * wall coordinate are pinned before the branches (a value first built inside one branch reads as
 * zero in the others).
 */
export const gdWaves = (u, wIn, pIn) => Fn(() => {
    const w = float(wIn).toVar();
    const p = vec3(pIn).toVar();
    const sum = vec3(0.0).toVar();
    const glow = float(0.0).toVar();
    If(u.live.x.greaterThan(0.5), () => {
        sum.addAssign(gdPulseLight(u, w));
    });
    If(u.live.y.greaterThan(0.5), () => {
        sum.addAssign(gdStrikeLight(u, p));
    });
    If(u.live.z.greaterThan(0.5), () => {
        const c = gdClearLight(u, w).toVar();
        sum.addAssign(c.rgb);
        glow.assign(c.a);
    });
    return vec4(sum, glow);
})();

/** The lit dust between the eye and a point: far things take a little of the heart's warmth. */
export const gdAir = (u, col, p) => {
    const haze = float(1.0).sub(exp(length(p.sub(cameraPosition)).div(-170.0))).mul(0.36);
    return mix(col, u.heart.mul(0.2).add(u.druzy.mul(0.03)).mul(u.breath), haze);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function gdFxMaterial(name, { depthTest = true } = {}) {
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
export function gdQuadGeometry(count, attributes = {}) {
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
export function gdPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
