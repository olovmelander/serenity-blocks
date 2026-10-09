/**
 * Himalayan Peak — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once and reads no uniform or texture carries
 *    `setLayout`, so it is emitted ONCE as a real shader function instead of being inlined;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float texture baked on the CPU (value, its gradient, a second value),
 *    hashes are hash-without-sine;
 *  - nothing is lit by a light: every surface shades itself (MeshBasicNodeMaterial) from the
 *    shared uniforms below — one sun, the sky it scatters into, and the amphitheatre's own
 *    shadow, which is a texture lookup for any elevation of the sun (himalayan-peak-field.js);
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 *
 * "Design space" is the amphitheatre as it was planned (metres). Upright screens draw it
 * narrower about the view axis (the world's root is scaled in x by `squeeze`), so meshes under
 * the root read `positionLocal` as their design position, and anything that builds its own clip
 * position goes through `hpClip`.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    select,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    GALE_REST,
    GRID,
    GUST_SLOTS,
    HOURS,
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    RING_TAU,
    SUN_AZIMUTH,
    SUN_ELEVATION,
    TAU,
    mulberry32,
    sunDirection,
} from './himalayan-peak-core.js';

export * from './himalayan-peak-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const hpHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'hp_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const hpHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hp_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const hpHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'hp_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const hpLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const hpMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const hpBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x², x⁴, x⁸ as products (pow() of a base a hair under zero is NaN). */
export const hpSq = (x) => x.mul(x);
export const hpPow4 = (x) => hpSq(hpSq(x));
export const hpPow8 = (x) => hpSq(hpPow4(x));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise: (value in 0..1, its gradient per texture width ×2, a second,
 * unrelated value in 0..1).
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 8848, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let pass = 0; pass < 2; pass++) {
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
            amp *= 0.55;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) field[i] = (field[i] - lo) * inv;
        if (pass === 0) {
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const o = (y * n + x) * 4;
                    const l = field[y * n + ((x + n - 1) % n)];
                    const r = field[y * n + ((x + 1) % n)];
                    const d = field[((y + n - 1) % n) * n + x];
                    const u = field[((y + 1) % n) * n + x];
                    out[o] = field[y * n + x];
                    // Slope across one texture width, scaled so it sits in about −1..1.
                    out[o + 1] = (r - l) * n * 0.5 * 0.05;
                    out[o + 2] = (u - d) * n * 0.5 * 0.05;
                }
            }
        } else {
            for (let i = 0; i < field.length; i++) out[i * 4 + 3] = field[i];
        }
    }
    return out;
}

/** The noise field as a tileable half-float texture with a CPU-built mip chain. */
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
    // The pass's snow reads it at a grazing angle: without this its drifts blur to nothing.
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'himalayan-peak-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The amphitheatre's textures ─────────────────────────────────────────────────

const dataTexture = (name, data, size, format, type, mips = false) => {
    const tex = new THREE.DataTexture(data, size, size, format, type);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.generateMipmaps = mips;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
};

const halves = (floats) => {
    const out = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) out[i] = THREE.DataUtils.toHalfFloat(floats[i]);
    return out;
};

/**
 * @param {object} field
 * @param {Uint8Array} field.shade      size² × 4 (normal.x, normal.z, sky visibility, hollowness)
 * @param {Float32Array} field.horizon  size² × 2 (ground, cloud top) as tan(elevation)
 * @param {Float32Array} field.volume   lowSize² × 4 shadow heights (metres)
 * @param {Float32Array} field.low      lowSize² ground heights (metres)
 */
export function createFieldTextures(field) {
    return {
        shade: dataTexture('himalayan-peak-shade', field.shade, field.size, THREE.RGBAFormat, THREE.UnsignedByteType, true),
        horizon: dataTexture('himalayan-peak-horizon', halves(field.horizon), field.size, THREE.RGFormat, THREE.HalfFloatType),
        volume: dataTexture('himalayan-peak-shadow', halves(field.volume), field.lowSize, THREE.RGBAFormat, THREE.HalfFloatType),
        ground: dataTexture('himalayan-peak-ground', halves(field.low), field.lowSize, THREE.RedFormat, THREE.HalfFloatType),
    };
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the amphitheatre's materials share. The world owns the values; materials only
 * read.
 * @param {{ noise: THREE.Texture, shade: THREE.Texture, horizon: THREE.Texture,
 *           volume: THREE.Texture, ground: THREE.Texture }} textures
 */
export function createPeakUniforms(textures) {
    const hour = HOURS[0].cold;
    const sun = sunDirection(SUN_ELEVATION.rest);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** How much narrower than planned the world is drawn about the view axis (1 = as planned). */
        squeeze: uniform(1),
        /** 0..1: the mountain's charge (combo). */
        power: uniform(0),
        /** 0..1.4: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light: a four-line clear holds the mountain's breath (→ 0.12). */
        breath: uniform(1),
        /** Unit vector toward the sun, and tan(its elevation) for the horizon lookups. */
        sunDir: uniform(new THREE.Vector3(sun[0], sun[1], sun[2])),
        sunTan: uniform(Math.tan(SUN_ELEVATION.rest)),
        /** The sun's bearing on the ground (unit, xz): the shafts run along it. */
        sunFlat: uniform(new THREE.Vector2(Math.sin(SUN_AZIMUTH), -Math.cos(SUN_AZIMUTH))),
        /** Weights of the four slices of the shadow in the air. */
        shadowW: uniform(new THREE.Vector4(1, 0, 0, 0)),
        // The hour (scene-linear), eased by the world between levels and by the charge.
        sunCol: v3(hour.sun),
        glow: v3(hour.glow),
        zenith: v3(hour.zenith),
        horizon: v3(hour.horizon),
        shade: v3(hour.shade),
        cloudCol: v3(hour.cloud),
        stars: uniform(hour.stars),
        /** How much of the sun's disc reaches the pass (0 behind the headwall .. 1 clear). */
        nearSun: uniform(0),
        /** Pixels one metre covers at one metre from the eye. */
        pxScale: uniform(1000),
        /** A gust leaving the chorten's spire lights it: (colour, amount). */
        spark: uniform(new THREE.Vector4(1, 1, 1, 0)),
        /** The ring of ice-light round the sun that a perfect clear draws (0..1). */
        halo: uniform(0),
        /** The avalanche: (birth time, strength). */
        avalanche: uniform(new THREE.Vector2(-100, 0)),
        /** The wind: how far it has carried things (metres, downwind) and how hard it blows now. */
        windRun: uniform(0),
        gale: uniform(GALE_REST),
        /** The phase of the flags' ripple (radians, wrapped at FLAG_TURN): the world runs it. */
        flutter: uniform(0),
        /** A clear's light running down the mountain: (birth time, fronts, strength, top height). */
        waveA: [],
        waveC: [],
        /** Powder rings on the pass: (x, z, birth time, strength) + (colour, reach fraction). */
        ringA: [],
        ringC: [],
        /** Gusts along the flag lines: (line, where along it the gust starts, birth time, strength). */
        gustA: [],
        noiseTex: textures.noise,
        shadeTex: textures.shade,
        horizonTex: textures.horizon,
        volumeTex: textures.volume,
        groundTex: textures.ground,
    };
    for (let i = 0; i < 2; i++) {
        u.waveA.push(uniform(new THREE.Vector4(-100, 1, 0, 3300)));
        u.waveC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < RING_SLOTS; i++) {
        u.ringA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.ringC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < GUST_SLOTS; i++) {
        u.gustA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    /** A design-space xz as the field textures' coordinate. */
    u.fieldUv = (xz) => xz.sub(vec2(GRID.x0, GRID.z0)).div(GRID.span);
    return u;
}

// ── Light ───────────────────────────────────────────────────────────────────────

/** Width of the ground shadow's edge, as tan(elevation). */
const PENUMBRA = 0.016;

/** 0 in the amphitheatre's shadow, 1 in the sun, for a point ON the ground at field uv `st`. */
export const hpGroundLight = (u, st) => {
    const edge = texture(u.horizonTex, st).r;
    return smoothstep(-PENUMBRA, PENUMBRA, u.sunTan.sub(edge));
};

/** The same for the top of the cloud sea over field uv `st`; `lift` = metres above y = 0. */
export const hpCloudLight = (u, st, lift = 0) => {
    const edge = texture(u.horizonTex, st).g;
    // A billow that stands higher sees over the wall a little sooner.
    return smoothstep(-0.02, 0.03, u.sunTan.sub(edge).add(float(lift).mul(1 / 5200)));
};

/** 0 under the shadow, 1 above it, for a point in the AIR (design space). `soft` in metres. */
export const hpAirLight = (u, p, soft = 70) => {
    const top = dot(texture(u.volumeTex, u.fieldUv(p.xz)), u.shadowW);
    return smoothstep(-soft, soft, p.y.sub(top));
};

/** The ground's height (metres) at a design-space xz, coarse. */
export const hpGround = (u, xz) => texture(u.groundTex, u.fieldUv(xz)).r;

/**
 * The sky a direction ends in, without its stars, cirrus or disc: the gradient, the glow round
 * the sun and along the horizon under it, and at twilight the rose band that stands opposite.
 * Every material uses it as the colour of distance.
 */
export const hpSky = (u, dir, glare = 1) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const grad = mix(u.horizon, u.zenith, up.pow(0.42));
    const cs = max(dot(dir, u.sunDir), 0.0);
    const cs2 = cs.mul(cs);
    const cs8 = hpPow4(cs2);
    const cs64 = hpPow8(cs8);
    // Forward scatter: a wide warm quarter of the sky, a tight glare, and the horizon under it.
    const scatter = u.glow.mul(cs2.mul(0.03).add(cs8.mul(0.1)).add(cs64.mul(0.62))).mul(glare);
    const arch = u.glow.mul(exp(up.mul(-7.0))).mul(cs2.mul(0.7).add(0.1)).mul(glare);
    // The belt of Venus: rose over the earth's own shadow, opposite a sun that has not risen.
    const away = float(1.0).sub(dot(dir.xz, u.sunFlat).mul(0.5).add(0.5));
    const band = exp(hpSq(up.sub(0.13).div(0.075)).negate());
    const belt = vec3(0.5, 0.2, 0.26).mul(band).mul(hpSq(away)).mul(float(1.0).sub(u.power))
        .mul(u.stars.mul(0.7).add(0.3));
    return grad.add(scatter).add(arch).add(belt).mul(u.breath.mul(0.65).add(0.35));
};

/** Optical depth of the air between the eye and a point: thin with height, a mist on the cloud. */
const airDepth = /* @__PURE__ */ Fn(([y0, y1, dist]) => {
    const H = float(1500.0);
    const a = exp(max(y0, 0.0).div(H).negate());
    const b = exp(max(y1, 0.0).div(H).negate());
    const dy = y1.sub(y0);
    // ∫ e^(−y/H) along the ray; the two forms meet where the ray is level.
    const level = abs(dy).lessThan(4.0);
    const safe = mix(dy, float(1.0), step(abs(dy), 4.0));
    const thick = select(level, a.add(b).mul(0.5), a.sub(b).mul(H).div(safe));
    const M = float(190.0);
    const am = exp(max(y0, 0.0).div(M).negate());
    const bm = exp(max(y1, 0.0).div(M).negate());
    const mist = select(level, am.add(bm).mul(0.5), am.sub(bm).mul(M).div(safe));
    return dist.mul(thick.mul(3.0e-5).add(mist.mul(1.5e-4)));
}).setLayout({
    name: 'hp_airDepth',
    type: 'float',
    inputs: [{ name: 'y0', type: 'float' }, { name: 'y1', type: 'float' }, { name: 'dist', type: 'float' }],
});

/**
 * Apply the air to a shaded colour at design-space point `p`: what is lost on the way, and what
 * the air itself scatters in — the sky's colour where the air stands in shadow, the sun's where
 * it stands in the light, which is what draws the shafts across the basin. `steps` = how many
 * times the shadow is asked along the way (0 = the air is taken as half lit).
 */
export const hpAtmosphere = (u, col, p, { steps = 4, gain = 1 } = {}) => {
    const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
    const rel = p.sub(eye);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const lost = float(1.0).sub(exp(airDepth(eye.y, p.y, dist).mul(gain).negate()));
    let lit = float(0.5);
    if (steps > 0) {
        // (No per-pixel jitter: the shadow is kept soft and coarse, so a few fixed steps do not
        // band, and a jittered sum showed as a weave on lit snow.)
        let sum = float(0.0);
        for (let i = 0; i < steps; i++) {
            const f = float((i + 0.5) / steps);
            // Bunched toward the far end, where the basin's shadow lies.
            const k = f.mul(float(2.0).sub(f));
            sum = sum.add(hpAirLight(u, eye.add(rel.mul(k)), 110));
        }
        lit = sum.div(steps);
    }
    const flat = vec3(dir.x, max(dir.y, 0.0), dir.z);
    const cs = max(dot(dir, u.sunDir), 0.0);
    const shaft = u.sunCol.mul(hpSq(cs).mul(0.012).add(hpPow8(cs).mul(0.075))).mul(lit).mul(u.breath);
    const haze = hpSky(u, flat, 0.16).mul(lit.mul(0.3).add(0.6)).add(shaft);
    return mix(col, haze, lost);
};

/**
 * A clear's light running down the mountain at height `y` (metres): vec4(colour · fronts, glow).
 * One front per cleared line; what it has passed keeps a little of its light.
 */
export const hpWaveLight = (u, y) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    for (let i = 0; i < 2; i++) {
        const A = u.waveA[i];
        // The first front is at the top at birth and at the cloud 1.5 s later.
        const since = u.time.sub(A.x).sub(A.w.sub(y).div(A.w).mul(1.5));
        // Each front is a bright edge with what it has just passed still glowing behind it.
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            const s = since.sub(k * 0.24);
            f = f.add(exp(max(s, 0.0).div(-0.085)).mul(step(0.0, s)).mul(step(k + 0.5, A.y)).mul(1 - k * 0.16));
        }
        front = front.add(u.waveC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(max(since, 0.0).div(-1.3)).mul(step(0.0, since)).mul(A.z));
    }
    return vec4(front, glow);
};

/** Light of the powder rings on the pass at design-space point `p`. */
export const hpRingLight = (u, p) => {
    let sum = vec3(0.0);
    for (let i = 0; i < RING_SLOTS; i++) {
        const A = u.ringA[i];
        const age = u.time.sub(A.z);
        const radius = u.ringC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = hpBell(d.sub(radius).div(u.ringC[i].w.mul(1.1).add(0.9)));
        const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.ringC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** Clip position of a design-space point (for parts that build their own vertex position). */
export const hpClip = (u, p) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p.x.mul(u.squeeze), p.y, p.z, 1.0));

/** An opaque self-shaded material. */
export function hpSolidMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = name;
    m.fog = false;
    return m;
}

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function hpFxMaterial(name, { depthTest = true } = {}) {
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
export function hpQuadGeometry(count, attributes = {}) {
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
export function hpPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** min() re-exported for parts that clamp HDR colours by their peak. */
export const hpClampPeak = (c, peak) => c.mul(min(float(1.0), float(peak).div(max(hpMax3(c), 1e-4))));
