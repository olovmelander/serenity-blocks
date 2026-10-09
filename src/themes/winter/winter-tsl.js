/**
 * Winter — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once and reads no uniform or texture carries
 *    `setLayout`, so it is emitted ONCE as a real shader function instead of being inlined;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float texture baked on the CPU (value, its gradient, a second value),
 *    hashes are hash-without-sine;
 *  - nothing is lit by a light: every surface shades itself (MeshBasicNodeMaterial) from the
 *    shared uniforms below — the moon, the twilight along the horizon, the sky they hang in and
 *    the fires that burn in it;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    GUST_SLOTS,
    GUST_SPEED,
    HOURS,
    ICE_Y,
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    RING_TAU,
    SKY_HOLD,
    SKY_SLOTS,
    TAU,
    glowDirection,
    moonDirection,
    mulberry32,
} from './winter-core.js';

export * from './winter-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const wHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'w_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const wHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'w_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const wHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'w_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const wLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const wMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const wBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x², x⁴, x⁸ as products (pow() of a base a hair under zero is NaN). */
export const wSq = (x) => x.mul(x);
export const wPow4 = (x) => wSq(wSq(x));
export const wPow8 = (x) => wSq(wPow4(x));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise: (value in 0..1, its gradient per texture width ×2, a second,
 * unrelated value in 0..1).
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 0x7ac0, size = NOISE_SIZE) {
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
    // The snow reads it at a grazing angle: without this its drifts blur to nothing.
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'winter-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The trees' moon shadows as a texture over the snowfield: 1 = in the light, 0 = shadowed. */
export function createShadowTexture(data, size) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'winter-moon-shadows';
    tex.needsUpdate = true;
    return tex;
}

// ── The aurora's sheets ─────────────────────────────────────────────────────────

/** The height of the aurora's foot, in the units its sheets are laid out in ("km"). */
export const AURORA_FOOT = 100;

/**
 * The sheets of the aurora, nearest the horizon first. Each hangs over a line on the ground
 * `reach` away, turned by `turn` about the vertical; it folds sideways by `fold` over waves of
 * `wave` per unit along it; its rays stand `rays` per unit apart.
 */
export const CURTAINS = Object.freeze([
    {
        reach: 400, turn: 0.3, fold: 58, wave: 0.0082, rays: 0.019, gain: 1,
    },
    {
        reach: 262, turn: -0.2, fold: 44, wave: 0.0115, rays: 0.026, gain: 0.9,
    },
    {
        reach: 600, turn: -0.52, fold: 76, wave: 0.0058, rays: 0.015, gain: 0.75,
    },
    {
        reach: 196, turn: 0.58, fold: 34, wave: 0.0145, rays: 0.032, gain: 0.8,
    },
]);

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the world's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, shadow: THREE.Texture }} textures
 */
export function createWinterUniforms(textures) {
    const hour = HOURS[0].calm;
    const moon = moonDirection(16 / 9);
    const glow = glowDirection(16 / 9);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Pixels one metre covers at one metre from the eye. */
        pxScale: uniform(1000),
        /** 0..1: how brightly the fires burn (combo). */
        power: uniform(0),
        /** 0..1.4: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light: a four-line clear holds the night's breath (→ 0.12). */
        breath: uniform(1),
        /** Unit vector toward the moon, and the bearing the twilight glows from (unit, xz). */
        moonDir: uniform(new THREE.Vector3(moon[0], moon[1], moon[2])),
        glowDir: uniform(new THREE.Vector2(glow[0], glow[1])),
        // The hour (scene-linear), eased by the world between levels and by the charge.
        zenith: v3(hour.zenith),
        band: v3(hour.band),
        glow: v3(hour.glow),
        haze: v3(hour.haze),
        moonCol: v3(hour.moon),
        shade: v3(hour.shade),
        fire: v3(hour.fire),
        crown: v3(hour.crown),
        stars: uniform(hour.stars),
        /** Cells of sparkle across one unit of the snow's screen-even grid (set on resize). */
        glintGrid: uniform(170),
        /** The ring of ice-light round the moon (0..1). */
        halo: uniform(0.12),
        /** How bright each sheet of the aurora burns. */
        curtains: uniform(new THREE.Vector4(0.3, 0, 0, 0)),
        /** How far the aurora's rays have run (they run faster as the fires rise). */
        auroraRun: uniform(0),
        /** A clear strums the sky: (birth time, strength). */
        flare: uniform(new THREE.Vector2(-100, 0)),
        /** How far the wind has carried things (metres, xz) and how hard it blows now. */
        windRun: uniform(new THREE.Vector2(0, 0)),
        gale: uniform(0.2),
        /** The fox: where it is, and how brightly it burns. */
        foxPos: uniform(new THREE.Vector3(0, 0, -9)),
        foxGlow: uniform(0),
        /** The fox of light in the sky: (bearing as tan, elevation as tan, strength, spare). */
        spirit: uniform(new THREE.Vector4(0, 0.3, 0, 0)),
        /** The moon shadows' map covers (x0, z0, 1/width, 1/depth). */
        shadowRect: uniform(new THREE.Vector4(-64, -118, 1 / 128, 1 / 128)),
        /** Powder rings on the snow: (x, z, birth time, strength) + (colour, reach fraction). */
        ringA: [],
        ringC: [],
        /** Gusts over the snow: (x, z, birth time, strength). */
        gustA: [],
        /** Colours the sky holds: (bearing as tan, arrival time, strength, spare) + colour. */
        skyA: [],
        skyC: [],
        noiseTex: textures.noise,
        shadowTex: textures.shadow,
    };
    for (let i = 0; i < RING_SLOTS; i++) {
        u.ringA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.ringC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < GUST_SLOTS; i++) {
        u.gustA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
    }
    for (let i = 0; i < SKY_SLOTS; i++) {
        u.skyA.push(uniform(new THREE.Vector4(0, -100, 0, 0)));
        u.skyC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── Light ───────────────────────────────────────────────────────────────────────

/**
 * The sky a direction ends in, without its stars, its moon or its fires: the gradient from the
 * horizon's haze through the pale band to the zenith, the last light where it lies along the
 * horizon, and the moon's aureole. Every material uses it as the colour of distance.
 */
export const wSky = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const toward = dot(flat, u.glowDir).mul(0.5).add(0.5);
    const lobe = toward.mul(toward).mul(toward);
    const foot = mix(u.haze, u.glow, lobe);
    const grad = mix(mix(foot, u.band, smoothstep(0.0, 0.2, up)), u.zenith, smoothstep(0.07, 0.72, up));
    // The last light is brightest on the horizon itself.
    const arch = u.glow.mul(exp(up.mul(-11.0))).mul(lobe).mul(0.5);
    const cs = max(dot(dir, u.moonDir), 0.0);
    const cs8 = wPow8(cs);
    const aureole = u.moonCol.mul(wPow8(cs8).mul(0.2).add(cs8.mul(0.03)));
    return grad.add(arch).add(aureole).mul(u.breath.mul(0.65).add(0.35));
};

/**
 * The colour the sky's fires have at a bearing (tan of it): their own, or what a piece gave
 * them. vec4(rgb, how much brighter than usual).
 */
export const wSkyTint = (u, q, base) => {
    let weight = float(0.0);
    let tint = vec3(0.0);
    let flash = float(0.0);
    for (let i = 0; i < SKY_SLOTS; i++) {
        const A = u.skyA[i];
        const age = u.time.sub(A.y);
        const near = exp(wSq(q.sub(A.x).div(0.3)).negate());
        const w = near.mul(A.z).mul(exp(max(age, 0.0).div(-SKY_HOLD))).mul(step(0.0, age));
        weight = weight.add(w);
        tint = tint.add(u.skyC[i].mul(w));
        flash = flash.add(w.mul(exp(max(age, 0.0).div(-0.7))));
    }
    const held = tint.div(max(weight, 1e-3));
    return vec4(mix(base, held, clamp(weight, 0.0, 1.0).mul(0.9)), flash);
};

/**
 * The aurora along a direction. A sheet hangs over a line on the ground and folds sideways; the
 * view ray is met with it by a fixed-point walk (three steps hold for these folds), which gives
 * the true perspective for nothing: sheets arch toward the horizon at their ends, folds
 * foreshorten, rays converge overhead. `count` sheets; `fine` = false drops the rays (mirrors).
 */
export const wAurora = (u, dir, { count = 3, fine = true } = {}) => {
    const q = dir.x.div(max(dir.z.negate(), 0.2));
    // A clear strums every sheet outward from the board.
    const strumAge = u.time.sub(u.flare.x);
    const strum = exp(wSq(abs(q).sub(strumAge.mul(1.5)).div(0.34)).negate())
        .mul(u.flare.y).mul(exp(max(strumAge, 0.0).div(-1.4))).mul(step(0.0, strumAge));
    const tinted = wSkyTint(u, q, u.fire);
    // (The fox of light brightens the sky it runs under.)
    const underSpirit = exp(wSq(q.sub(u.spirit.x).div(0.5)).negate()).mul(u.spirit.z);
    const lift = float(1.0).add(tinted.w.mul(1.5)).add(strum.mul(1.6)).add(underSpirit.mul(1.0));
    let sum = vec3(0.0);
    const energies = [u.curtains.x, u.curtains.y, u.curtains.z, u.curtains.w];
    for (let i = 0; i < Math.min(count, CURTAINS.length); i++) {
        const c = CURTAINS[i];
        const E = energies[i];
        const cs = Math.cos(c.turn);
        const sn = Math.sin(c.turn);
        const dx = dir.x.mul(cs).sub(dir.z.mul(sn));
        const dz = dir.x.mul(sn).add(dir.z.mul(cs));
        const fwd = max(dz.negate(), 0.07);
        const phase = i * 2.4 + 0.7;
        const run = u.auroraRun.mul(0.21 + i * 0.05);
        const fold = (x) => sin(x.mul(c.wave).add(phase).add(run)).mul(c.fold)
            .add(sin(x.mul(c.wave * 2.7).sub(phase * 1.7).add(run.mul(1.6))).mul(c.fold * 0.4));
        let t = float(c.reach).div(fwd);
        t = float(c.reach).add(fold(dx.mul(t))).div(fwd);
        t = float(c.reach).add(fold(dx.mul(t))).div(fwd);
        const x = dx.mul(t);
        const a = dir.y.mul(t).sub(AURORA_FOOT);
        // Seen edge on, a fold is brighter: the ray runs along the sheet.
        const slope = cos(x.mul(c.wave).add(phase).add(run)).mul(c.fold * c.wave)
            .add(cos(x.mul(c.wave * 2.7).sub(phase * 1.7).add(run.mul(1.6))).mul(c.fold * 0.4 * c.wave * 2.7));
        const flatLength = length(vec2(dx, dz));
        const edgeOn = min(sqrt(float(1.0).add(wSq(slope))).mul(flatLength)
            .div(max(abs(dz.add(dx.mul(slope))), flatLength.mul(0.36))), 2.6);
        const broad = u.noise(vec2(x.mul(c.rays * 0.16).add(run.mul(0.06)), i * 0.31 + 0.11));
        const patch = smoothstep(0.28, 0.72, broad.r);
        let ray = float(0.5);
        let hair = float(1.0);
        if (fine) {
            // (The rays are spaced by the broad pattern too: evenly spaced, they read as a comb.)
            const along = x.mul(c.rays).add(broad.a.mul(2.6)).sub(run.mul(0.5));
            const strands = u.noise(vec2(along, a.mul(0.0006).add(i * 0.17 + 0.63)));
            ray = smoothstep(0.24, 0.8, strands.r);
            // Fine rays ride on the broad ones, and are never all one width.
            hair = u.noise(vec2(x.mul(c.rays * 2.3).add(run.mul(0.8)), i * 0.23 + 0.37)).a.mul(0.7).add(0.65);
        }
        const tall = ray.mul(ray).mul(125.0).add(13.0).mul(E.mul(0.5).add(0.65));
        const body = smoothstep(-5.0, 4.0, a).mul(exp(max(a, 0.0).div(tall).negate()));
        const bright = patch.mul(1.5).add(0.1).mul(ray.mul(1.15).add(0.16)).mul(hair);
        // The foot of an energetic sheet burns rose.
        const hem = exp(wSq(a.sub(1.5).div(6.0)).negate()).mul(smoothstep(0.7, 1.6, E));
        const colour = mix(tinted.rgb, u.crown, smoothstep(0.12, 1.15, max(a, 0.0).div(tall)))
            .add(vec3(1.0, 0.3, 0.62).mul(hem.mul(0.9)));
        // It sinks into the haze at its ends and is lost behind the fells.
        const fade = smoothstep(0.012, 0.085, dir.y).mul(exp(t.mul(-1 / 1700)));
        sum = sum.add(colour.mul(body.mul(bright).mul(E).mul(c.gain).mul(fade)
            .mul(edgeOn)));
    }
    // The brightest folds saturate toward their own colour, never to white.
    const lit = sum.mul(lift);
    return lit.div(wMax3(lit).div(3.4).add(1.0)).mul(u.breath);
};

/** The trees' moon shadow at a point on the snow: 0 in shadow, 1 in the moon's light. */
export const wMoonShadow = (u, xz) => {
    const st = xz.sub(u.shadowRect.xy).mul(u.shadowRect.zw);
    return texture(u.shadowTex, clamp(st, 0.0, 1.0)).r;
};

/**
 * Apply the air to a shaded colour at world point `p`: a thin ice haze, and a mist that lies
 * over the lake. What is lost is replaced by the sky that stands behind.
 */
export const wAir = (u, col, p, gain = 1) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const low = exp(max(p.y.add(cameraPosition.y).mul(0.5).sub(ICE_Y), 0.0).div(-16.0));
    const depth = dist.mul(low.mul(1 / 1500).add(1 / 6500)).mul(u.gale.mul(0.5).add(0.9));
    const lost = float(1.0).sub(exp(depth.mul(gain).negate()));
    const flat = vec3(dir.x, max(dir.y, 0.0).mul(0.5).add(0.012), dir.z);
    return mix(col, wSky(u, flat.div(length(flat))), lost);
};

/** Light of the powder rings at world point `p`: vec4(colour, how much of a ring is here). */
export const wRingLight = (u, p) => {
    let sum = vec3(0.0);
    let amount = float(0.0);
    for (let i = 0; i < RING_SLOTS; i++) {
        const A = u.ringA[i];
        const age = u.time.sub(A.z);
        const radius = u.ringC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(max(age, 0.0).div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = wBell(d.sub(radius).div(u.ringC[i].w.mul(0.75).add(0.55)));
        const env = exp(max(age, 0.0).mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.ringC[i].rgb.mul(shell.mul(env)));
        amount = amount.add(shell.mul(env));
    }
    return vec4(sum, amount);
};

/**
 * The gusts at world point `p`: vec3(push.x, push.z, how hard it blows here now). A gust is a
 * front that leaves from under the board and crosses the snow, with a tail of moving air.
 */
export const wGust = (u, p) => {
    let push = vec2(0.0);
    let blow = float(0.0);
    for (let i = 0; i < GUST_SLOTS; i++) {
        const A = u.gustA[i];
        const age = u.time.sub(A.z);
        const rel = p.xz.sub(A.xy);
        const d = length(rel);
        const behind = age.mul(GUST_SPEED).sub(d);
        const env = smoothstep(-2.5, 1.0, behind).mul(exp(max(behind, 0.0).div(-14.0)))
            .mul(exp(max(age, 0.0).div(-3.2))).mul(step(0.0, age))
            .mul(A.w);
        push = push.add(rel.div(max(d, 0.5)).mul(env));
        blow = blow.add(env);
    }
    return vec3(push, blow);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** Clip position of a world point (for parts that build their own vertex position). */
export const wClip = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** An opaque self-shaded material. */
export function wSolidMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = name;
    m.fog = false;
    return m;
}

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function wFxMaterial(name, { depthTest = true } = {}) {
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
export function wQuadGeometry(count, attributes = {}) {
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
export function wPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
