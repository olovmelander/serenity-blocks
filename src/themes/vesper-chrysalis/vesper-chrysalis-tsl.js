/**
 * Vesper Chrysalis — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - helpers that are pure functions of their arguments carry `setLayout` (emitted once); helpers
 *    that read uniforms or the noise texture are plain JS functions that build nodes inline;
 *  - every surface shades itself (MeshBasicNodeMaterial): the evening's light is the sky function
 *    below, read along a normal or a mirror ray, plus the light the gameplay makes;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 *
 * The whole distance is ONE function of a direction, `vcBackdrop`: the dusk gradient, the day's
 * last light, the stars, the ringed world, the evening star, the aurora, the clouds and the
 * mountain ranges with the mist at their feet. The sky dome draws it along the view ray and the
 * lake draws it along its mirror ray, so the reflection is exact, costs no second render and
 * bends with every ripple.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

import {
    PLANET,
    RING_SLOTS,
    SUN,
    SWELL_SLOTS,
    TAU,
    THREAD_PULSES,
    VESPER,
    VESPER_PALETTES,
    mulberry32,
    skyDirection,
} from './vesper-chrysalis-core.js';

export * from './vesper-chrysalis-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const vcHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'vc_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const vcHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'vc_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1)³ */
export const vcHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'vc_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const vcLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const vcMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const vcBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x⁵ by products (a `pow` whose base strays below zero is a NaN). */
export const vcPow5 = (x) => {
    const x2 = x.mul(x);
    return x2.mul(x2).mul(x);
};

/** Schlick's Fresnel for a clamped cosine. */
export const vcFresnel = (cosine, f0 = 0.04) => float(f0)
    .add(float(1 - f0).mul(vcPow5(float(1.0).sub(clamp(cosine, 0.0, 1.0)))));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 9127, size = NOISE_SIZE) {
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
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the lake reads it
 * at grazing angles; generating half-float mips on the GPU is not portable to every WebGL2
 * device).
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
    tex.name = 'vesper-chrysalis-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the evening's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createVesperUniforms(textures) {
    const p = VESPER_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians one pixel subtends at the centre of the frame (edges drawn in the sky function). */
        pixelAngle: uniform(0.001),
        /** 0..1: the chrysalis's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light the evening makes: a four-line clear holds its breath (→ 0.15). */
        breath: uniform(1),
        /** 0..1: how awake the chrysalis is (its inner light and the reach of its cracks). */
        wake: uniform(0.12),
        crack: uniform(0),
        /** The chain, for what counts steps (the diadem). */
        combo: uniform(0),
        /** 0..1: how far into the night (stars), and the aurora's strength (0..1.6). */
        night: uniform(p.night),
        aurora: uniform(0),
        /** How far the clouds have drifted, and the slow clock everything unhurried runs on. */
        cloudDrift: uniform(0),
        drift: uniform(0),
        // The palette (scene-linear), eased by the world between levels.
        zenith: v3(p.zenith),
        mid: v3(p.mid),
        horizon: v3(p.horizon),
        far: v3(p.far),
        glow: v3(p.glow),
        cloudLit: v3(p.cloudLit),
        cloudShade: v3(p.cloudShade),
        haze: v3(p.haze),
        range: v3(p.range),
        deep: v3(p.deep),
        crystal: v3(p.crystal),
        shell: v3(p.shell),
        core: v3(p.core),
        wingRoot: v3(p.wingRoot),
        wingMid: v3(p.wingMid),
        wingEdge: v3(p.wingEdge),
        auroraA: v3(p.auroraA),
        auroraB: v3(p.auroraB),
        /** What the chrysalis last took in: a colour, and how much of it is left (0..1). */
        fed: uniform(new THREE.Vector4(1, 0.7, 0.4, 0)),
        // ── The wings ──
        /** (how far unfurled 0..1, stroke angle, how far fallen to dust 0..1, flash). */
        wing: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** (hind eyes open 0..1, fore eyes open 0..1, radiance past full 0..1, _). */
        eyes: uniform(new THREE.Vector4(0, 0, 0, 0)),
        // ── Events ──
        /** 1 while any ring / swell / thread pulse is still running (the loops are skipped at rest). */
        ringsLive: uniform(0),
        swellLive: uniform(0),
        pulsesLive: uniform(0),
        /** Ring slots: (x, z, birth time, strength) + (colour, reach as a fraction of RING_REACH). */
        ringA: [],
        ringC: [],
        /** Swell slots: (birth time, fronts, strength, sunfire 0..1) + colour. */
        swellA: [],
        swellC: [],
        /** Thread pulse slots: (birth time, side −1 | 0 | +1, strength, _) + colour. */
        pulseA: [],
        pulseC: [],
        noiseTex: textures.noise,
    };
    for (let i = 0; i < RING_SLOTS; i++) {
        u.ringA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.ringC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < SWELL_SLOTS; i++) {
        u.swellA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.swellC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < THREAD_PULSES; i++) {
        u.pulseA.push(uniform(new THREE.Vector4(-100, 0, 0, 0)));
        u.pulseC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

/** A scene part: what the world adds, hides and disposes. */
export function vcPart(name, geometry, material, renderOrder = 0, extra = {}) {
    const mesh = extra.mesh || new THREE.Mesh(geometry, material);
    mesh.name = name;
    // A Group's renderOrder outranks its children's own (three sorts by it first): a part made
    // of several draws keeps the order on each of them instead.
    if (!mesh.isGroup) mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh, geometry, material, ...extra,
    };
}

// ── The sky's fixed geometry (constants baked into the shaders) ─────────────────

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A tangent frame about a direction: [right, up] as seen by a viewer looking along it. */
const frameOf = (f) => {
    const right = unit(cross(f, [0, 1, 0]));
    return [right, cross(right, f)];
};
const lit = (a) => vec3(a[0], a[1], a[2]);

export const SUN_DIR = Object.freeze(skyDirection(SUN.azimuth, SUN.elevation));
const SUN_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, SUN_DIR[2] / l];
})();

const PLANET_DIR = skyDirection(PLANET.azimuth, PLANET.elevation);
const [PLANET_X, PLANET_Y] = frameOf(PLANET_DIR);
const PLANET_TAN = Math.tan(PLANET.radius);
/** The sun as the planet sees it, in (right, up, toward the viewer). */
const PLANET_SUN = (() => {
    // Its light comes from where the sun set, but from further behind it than the true angle:
    // a thin crescent reads as a world at dusk, a fat one as a ball.
    const flat = unit([dot3(SUN_DIR, PLANET_X), dot3(SUN_DIR, PLANET_Y), 0]);
    const behind = 0.8;
    const side = Math.sqrt(1 - behind * behind);
    return [flat[0] * side, flat[1] * side, -behind];
})();
const RING_COS = Math.cos(PLANET.ringLean);
const RING_SIN = Math.sin(PLANET.ringLean);
const RING_K = PLANET.ringOpen;
const RING_S = Math.sqrt(1 - RING_K * RING_K);
/** The same sun in the rings' own frame (major axis, minor axis, toward the viewer). */
const RING_SUN = [
    PLANET_SUN[0] * RING_COS + PLANET_SUN[1] * RING_SIN,
    -PLANET_SUN[0] * RING_SIN + PLANET_SUN[1] * RING_COS,
    PLANET_SUN[2],
];

const VESPER_DIR = skyDirection(VESPER.azimuth, VESPER.elevation);
const [VESPER_X, VESPER_Y] = frameOf(VESPER_DIR);

/** The three mountain ranges, far to near: azimuth frequency, noise row, base, height, depth. */
const RANGES = [
    {
        k: 1.1, row: 0.13, base: 0.014, amp: 0.07, depth: 0,
    },
    {
        k: 0.74, row: 0.47, base: 0.006, amp: 0.1, depth: 0.5,
    },
    {
        k: 0.46, row: 0.81, base: -0.012, amp: 0.2, depth: 1,
    },
];

// ── The evening's light ─────────────────────────────────────────────────────────

/** 0..1: how nearly a direction points (in plan) at the place the sun went down. */
export const vcToward = (dir) => {
    const flat = dir.xz.div(max(length(dir.xz), 1e-4));
    return dot(flat, vec2(SUN_FLAT[0], SUN_FLAT[1])).mul(0.5).add(0.5);
};

/**
 * The sky a direction ends in, without anything that stands in it: the gradient from the zenith
 * down to the horizon, which is rose toward the set sun and dusky opposite it, and the day's
 * last light lying on the horizon there. Every material uses it: as the colour of distance, as
 * the light a surface gathers from the side it faces, as what a facet mirrors.
 */
export const vcSkyBase = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const toward = vcToward(dir);
    const t2 = toward.mul(toward);
    const t4 = t2.mul(t2);
    const t8 = t4.mul(t4);
    const t32 = t8.mul(t8).mul(t8).mul(t8);
    const low = mix(u.far, u.horizon, t4);
    const rise = sqrt(up);
    const g1 = mix(low, u.mid, smoothstep(0.0, 0.4, rise));
    const grad = mix(g1, u.zenith, smoothstep(0.28, 0.9, rise));
    // The afterglow: a wide low wash, a taller dome where the sun went down, a hot line under it.
    const after = u.glow.mul(
        t8.mul(0.12).mul(exp(up.mul(-8.0)))
            .add(t32.mul(0.55).mul(exp(up.mul(-5.4))))
            .add(t32.mul(t32).mul(0.9).mul(exp(up.mul(-13.0)))),
    );
    // A band of light lies on the horizon itself, all the way round.
    const band = low.mul(exp(up.mul(-16.0))).mul(0.42);
    return grad.add(after).add(band).mul(u.breath.mul(0.4).add(0.6));
};

/**
 * The light a surface with normal `n` gathers from the sky: the sky function read a little above
 * the way the surface faces, warm on the side that looks at the afterglow.
 */
export const vcSkyLight = (u, n) => {
    const d = normalize(vec3(n.x, max(n.y, 0.0).add(0.4), n.z));
    return vcSkyBase(u, d).mul(n.y.mul(0.3).add(0.7));
};

/** The mist that lies on the far water and at the mountains' feet, seen along a direction. */
export const vcHaze = (u, dir) => {
    const toward = vcToward(dir);
    const t4 = toward.mul(toward).mul(toward).mul(toward);
    return mix(u.haze, u.glow.mul(0.9).add(u.haze.mul(0.4)), t4.mul(t4).mul(0.6)).mul(t4.mul(0.5).add(0.5))
        .mul(u.breath.mul(0.4).add(0.6));
};

/**
 * Everything at a distance, along a direction. Call inside a `Fn` (it declares variables).
 * @param {object} u
 * @param {*} dirIn  unit direction; anything below the horizon reads the horizon
 * @param {object} [opts]
 * @param {boolean} [opts.lite=false]   no stars, no aurora rays, one cloud octave (low tiers' mirror)
 * @param {number} [opts.soft=1]        edge softness multiplier (the mirror's edges are softer)
 */
export const vcBackdrop = (u, dirIn, opts = {}) => {
    const lite = opts.lite === true;
    const soft = opts.soft ?? 1;
    const dir = vec3(dirIn).toVar();
    const up = clamp(dir.y, 0.0, 1.0).toVar();
    const horiz = max(length(dir.xz), 1e-4).toVar();
    /** tan(elevation), and the azimuth (0 = straight ahead, + to the right). */
    const el = max(dir.y, 0.0).div(horiz).toVar();
    const az = atan(dir.x, dir.z.negate()).toVar();
    const toward = vcToward(dir).toVar();
    const t4 = toward.mul(toward).mul(toward).mul(toward).toVar();
    const aa = u.pixelAngle.mul(1.4 * soft).toVar();

    const col = vcSkyBase(u, vec3(dir.x, up, dir.z)).toVar();
    /** 1 where nothing stands between the viewer and the stars. */
    const open = float(1.0).toVar();

    // ── The ringed world ──
    const cp = dot(dir, lit(PLANET_DIR)).toVar();
    If(cp.greaterThan(Math.cos(PLANET.radius * (PLANET.ringOut + 0.4))), () => {
        const q = vec2(dot(dir, lit(PLANET_X)), dot(dir, lit(PLANET_Y))).div(cp.mul(PLANET_TAN)).toVar();
        const r2 = dot(q, q).toVar();
        const edge = aa.div(PLANET_TAN).mul(1.2);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(edge), float(1.0).add(edge), sqrt(r2))).toVar();
        const nz = sqrt(max(float(1.0).sub(r2), 0.0)).toVar();
        // In the rings' frame: major axis, minor axis, toward the viewer.
        const qr = vec2(
            q.x.mul(RING_COS).add(q.y.mul(RING_SIN)),
            q.y.mul(RING_COS).sub(q.x.mul(RING_SIN)),
        ).toVar();
        const sun = lit(RING_SUN);
        const nr = vec3(qr.x, qr.y, nz);
        const day = dot(nr, sun).toVar();
        // Bands of cloud run round the axis the rings turn about.
        const lat = qr.y.mul(RING_S).add(nz.mul(RING_K));
        const bands = u.noise(vec2(lat.mul(0.42).add(0.2), 0.63)).toVar();
        const belt = smoothstep(0.3, 0.7, bands.r).mul(0.7).add(bands.g.mul(0.3));
        const albedo = mix(
            u.mid.mul(1.2).add(u.horizon.mul(0.4)).add(0.1),
            u.cloudLit.mul(0.6).add(vec3(0.42, 0.36, 0.32)),
            belt,
        );
        const shade = smoothstep(-0.06, 0.42, day);
        const sunCol = u.glow.mul(0.55).add(vec3(0.75, 0.66, 0.58));
        // The night side is the sky's own colour, a little darker: the air is in front of it.
        const night = col.mul(0.46).add(albedo.mul(0.01));
        const limb = float(1.0).sub(nz);
        const air = sunCol.mul(limb.mul(limb).mul(limb)).mul(smoothstep(-0.3, 0.25, day)).mul(1.5);
        const body = mix(night, albedo.mul(sunCol).mul(1.5), shade).add(air);
        col.assign(mix(col, body, disc));
        open.assign(float(1.0).sub(disc));

        // The rings: a flat annulus about the planet, seen nearly edge on.
        const rr = sqrt(qr.x.mul(qr.x).add(qr.y.mul(qr.y).div(RING_K * RING_K))).toVar();
        const ringEdge = edge.mul(2.0).add(0.02);
        const span = smoothstep(PLANET.ringIn, float(PLANET.ringIn).add(ringEdge), rr)
            .mul(float(1.0).sub(smoothstep(float(PLANET.ringOut).sub(ringEdge), PLANET.ringOut, rr)));
        const grooves = u.noise(vec2(rr.mul(1.9), 0.27)).toVar();
        const gap = float(1.0).sub(vcBell(rr.sub(1.92).div(0.045)).mul(0.9));
        const dens = span.mul(gap).mul(smoothstep(0.2, 0.62, grooves.b).mul(0.75).add(0.25)).toVar();
        // Depth of the ring toward the viewer: its lower half passes in front of the planet.
        const depth = qr.y.mul(-RING_S / RING_K);
        const front = max(float(1.0).sub(disc), step(nz, depth));
        const x3 = vec3(qr.x, qr.y, depth);
        const along = dot(x3, sun);
        const off2 = dot(x3, x3).sub(along.mul(along));
        const shadow = float(1.0).sub(smoothstep(0.86, 1.02, sqrt(max(off2, 0.0)))).mul(step(along, 0.0));
        const ringCol = mix(u.cloudLit, vec3(1.0, 0.9, 0.8), grooves.g.mul(0.3).add(0.5))
            .mul(sunCol).mul(float(1.0).sub(shadow.mul(0.93))).mul(0.44);
        const ringA = dens.mul(front).mul(0.72);
        col.assign(mix(col, ringCol.add(col.mul(0.35)), ringA));
        open.mulAssign(float(1.0).sub(ringA.mul(0.8)));
    });

    // ── Stars: two sizes of them on a grid over the sphere ──
    if (!lite) {
        const starLight = vec3(0.0).toVar();
        [[78, 0.986, 1.7], [190, 0.972, 0.6]].forEach(([scale, rarity, gain], layer) => {
            const p = dir.mul(scale);
            const cell = floor(p);
            const h = vcHash33(cell.add(layer * 17.0)).toVar();
            const at = cell.add(0.5).add(h.sub(0.5).mul(0.7));
            const d = length(p.sub(at));
            const size = aa.mul(scale).mul(1.15).add(0.012);
            const spark = vcBell(d.div(size.mul(2.0))).mul(step(rarity, h.z));
            const mag = fract(h.x.mul(57.0)).mul(fract(h.x.mul(57.0))).mul(0.85).add(0.15);
            const twinkle = sin(u.time.mul(h.y.mul(2.6).add(1.3)).add(h.x.mul(40.0))).mul(0.3).add(0.7);
            const tint = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.86, 0.7), h.y);
            starLight.addAssign(tint.mul(spark.mul(mag).mul(twinkle).mul(gain)));
        });
        // They come out as the sky darkens, and never through the glow.
        const dark = clamp(float(1.0).sub(vcLuma(col).mul(3.2)), 0.0, 1.0);
        col.addAssign(starLight.mul(open).mul(dark).mul(smoothstep(0.03, 0.3, up)).mul(u.night.mul(1.5).add(0.25))
            .mul(u.breath)
            .mul(1 / soft));
    }

    // ── The evening star ──
    const cv = dot(dir, lit(VESPER_DIR)).toVar();
    If(cv.greaterThan(0.985), () => {
        const s = vec2(dot(dir, lit(VESPER_X)), dot(dir, lit(VESPER_Y))).div(cv).toVar();
        const d = length(s);
        const w = aa.mul(1.6).add(0.0006);
        const core = exp(d.div(w).mul(d.div(w)).negate()).mul(9.0);
        const halo = exp(d.mul(-150.0)).mul(0.55);
        const spikes = exp(abs(s.x).mul(-75.0)).mul(exp(s.y.div(w).mul(s.y.div(w)).negate()))
            .add(exp(abs(s.y).mul(-75.0)).mul(exp(s.x.div(w).mul(s.x.div(w)).negate())));
        const breathe = sin(u.time.mul(1.7)).mul(0.08).add(0.92);
        col.addAssign(vec3(1.0, 0.93, 0.82).mul(core.add(halo).add(spikes.mul(0.5))).mul(breathe).mul(u.breath));
    });

    // ── The aurora: curtains with a sharp lower hem and a long fade upward ──
    If(u.aurora.greaterThan(0.01), () => {
        const light = vec3(0.0).toVar();
        [[0.21, 0.19, 0.31, 0.17], [0.34, 0.33, 0.52, 0.67]].forEach(([height, sway, freq, row], i) => {
            const wave = u.noise(vec2(az.mul(freq * 0.16).add(u.drift.mul(0.004 * (i + 1))), row)).toVar();
            const hem = float(height).add(wave.r.sub(0.5).mul(sway));
            const x = el.sub(hem).div(0.26);
            const profile = smoothstep(-0.06, 0.0, x).mul(exp(max(x, 0.0).mul(-3.2)));
            const rays = lite
                ? float(0.7)
                : u.noise(vec2(az.mul(1.9).add(wave.g.mul(0.35)), float(row).add(u.drift.mul(0.011)))).b;
            const fold = smoothstep(0.25, 0.8, wave.b);
            const band = profile.mul(rays.mul(rays).mul(1.6).add(0.12)).mul(fold.mul(0.85).add(0.15));
            light.addAssign(mix(u.auroraA, u.auroraB, clamp(x.mul(0.8), 0.0, 1.0)).mul(band));
        });
        col.addAssign(light.mul(u.aurora).mul(open.mul(0.7).add(0.3)).mul(0.5).mul(u.breath));
    });

    // ── Clouds: a high deck of streaks that catch the last light from below ──
    const deck = dir.xz.div(up.add(0.11)).toVar();
    const alongSun = deck.x.mul(SUN_FLAT[0]).add(deck.y.mul(SUN_FLAT[1]));
    const across = deck.y.mul(SUN_FLAT[0]).sub(deck.x.mul(SUN_FLAT[1]));
    const c1 = u.noise(vec2(alongSun.mul(0.021).add(u.cloudDrift), across.mul(0.085).add(0.31))).toVar();
    const fineUv = vec2(alongSun.mul(0.09).add(u.cloudDrift.mul(1.7)), across.mul(0.27));
    const body = lite ? c1.r : c1.r.mul(0.66).add(u.noise(fineUv).g.mul(0.34));
    const band = smoothstep(0.015, 0.1, up).mul(float(1.0).sub(smoothstep(0.26, 0.52, up)));
    const cover = smoothstep(0.53, 0.72, body).mul(band).toVar();
    // A cloud's thin edge glows; its body is its own shadow. The light comes from where the sun set.
    const thin = float(1.0).sub(smoothstep(0.55, 0.7, body));
    const under = t4.mul(t4).mul(0.9).add(0.1).mul(exp(up.mul(-4.2)));
    const shade = u.cloudShade.mul(vcLuma(col).mul(1.2).add(0.34));
    const cloud = mix(shade, u.cloudLit.mul(thin.mul(1.5).add(0.12)), under.mul(thin.mul(0.75).add(0.25)))
        .add(u.glow.mul(t4.mul(t4)).mul(thin).mul(under).mul(0.9));
    col.assign(mix(col, cloud.mul(u.breath.mul(0.4).add(0.6)), cover.mul(0.7)));

    // ── The ranges, far to near, and the mist at their feet ──
    const haze = vcHaze(u, dir).toVar();
    const dip = float(1.0).sub(vcBell(az.sub(SUN.azimuth).div(0.5)).mul(0.5)).toVar();
    RANGES.forEach((range) => {
        const n = u.noise(vec2(az.mul(range.k).add(range.row * 3.1), range.row)).toVar();
        const crag = u.noise(vec2(az.mul(range.k * 4.7).add(range.row * 1.7), range.row + 0.21)).toVar();
        // Ridged: the summits are creases, and a finer grain breaks every slope into crags.
        const fold = float(1.0).sub(abs(n.r.mul(2.0).sub(1.0)));
        const rise = clamp(fold.mul(fold).mul(0.6).add(n.g.mul(0.26)).add(crag.b.sub(0.5).mul(0.24))
            .add(0.04), 0.0, 1.0);
        const sides = range.depth > 0.75
            ? smoothstep(0.16, 0.74, abs(az.add(0.05))).mul(0.84).add(0.16)
            : float(1.0);
        const ridge = float(range.base).add(rise.mul(range.amp).mul(dip).mul(sides)).toVar();
        const below = float(1.0).sub(smoothstep(ridge.sub(aa), ridge.add(aa), el)).toVar();
        // How deep under the crest this point is, 0 at the crest → 1 at the water.
        const under2 = clamp(ridge.sub(el).div(max(ridge, 1e-3)), 0.0, 1.0);
        const rock = mix(haze.mul(0.7), u.range.add(u.mid.mul(0.04)), range.depth * 0.8 + 0.16);
        const mist = mix(rock, haze.mul(0.92), under2.mul(under2).mul(0.82 - range.depth * 0.3));
        // The crest catches the last light on the side of the set sun.
        const crest = vcBell(ridge.sub(el).div(aa.mul(3.0).add(0.0035))).mul(t4).mul(0.55 - range.depth * 0.2);
        col.assign(mix(col, mist.add(u.glow.mul(crest)), below));
    });
    // Mist lies on the water all the way round.
    col.assign(mix(col, haze, exp(el.mul(-70.0)).mul(0.8)));
    return col;
};
