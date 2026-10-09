/**
 * Stillwater — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - helpers that are pure functions of their arguments carry `setLayout` (emitted once); helpers
 *    that read uniforms or the noise texture are plain JS functions that build nodes inline;
 *  - every surface shades itself (MeshBasicNodeMaterial): the night's light is the moon, the
 *    mist's own glow and the few lights that live here (the troll's lantern, the spirit, the
 *    heart under the water), written once in `swLight` and used by everything that is lit;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 *
 * The whole distance is ONE function of a direction, `swBackdrop`: the night sky, the moon in
 * its halo, the stars, the northern lights, and rank behind rank of spruce going into the mist.
 * The sky dome draws it along the view ray and the tarn draws it along its mirror ray, so the
 * far shore stands in the water exactly, costs no second render and bends with every ripple.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
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
    normalize,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    HEART,
    HOURS,
    MOON,
    PALETTE_KEYS,
    PALETTE_SCALARS,
    RING_SLOTS,
    STROKE_SLOTS,
    TAU,
    WISP_SLOTS,
    mulberry32,
    skyDirection,
} from './stillwater-core.js';
import { SHORE_MAP, STAGE, bakeShoreMap } from './stillwater-plan.js';

export * from './stillwater-core.js';

/** Metres either side of the water's edge the shore map resolves. */
export const SHORE_SPAN = SHORE_MAP.span;

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

/** vec3 → [0,1)³ */
export const swHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'sw_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const swLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const swMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const swBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x⁵ by products (a `pow` whose base strays below zero is a NaN). */
export const swPow5 = (x) => {
    const x2 = x.mul(x);
    return x2.mul(x2).mul(x);
};

/** Schlick's Fresnel for a clamped cosine. */
export const swFresnel = (cosine, f0 = 0.04) => float(f0)
    .add(float(1 - f0).mul(swPow5(float(1.0).sub(clamp(cosine, 0.0, 1.0)))));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4421, size = NOISE_SIZE) {
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
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the tarn reads it
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
    tex.name = 'stillwater-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The shore map (plan's bakeShoreMap) as a texture: 0.5 at the water's edge. */
export function createShoreTexture() {
    const tex = new THREE.DataTexture(bakeShoreMap(), SHORE_MAP.size, SHORE_MAP.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'stillwater-shore';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the night's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, shore: THREE.Texture }} textures
 */
export function createStillwaterUniforms(textures) {
    const p = HOURS[0];
    const moon = skyDirection(MOON.azimuth, MOON.elevation);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians one pixel subtends at the centre of the frame (edges drawn in the sky function). */
        pixelAngle: uniform(0.001),
        /** How far the stage is drawn in toward the middle (1 on a wide frame). */
        squeeze: uniform(1),
        /** Where the moon stands (unit vector), and its azimuth. */
        moonDir: uniform(new THREE.Vector3(moon[0], moon[1], moon[2])),
        moonAz: uniform(MOON.azimuth),
        /** Gain on every light of the night: a four-line clear holds its breath (→ 0.2). */
        breath: uniform(1),
        /** 0..1: the wood's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** The slow clock everything unhurried runs on, and the boughs' own (wind-paced) phase. */
        drift: uniform(0),
        sway: uniform(0),
        /** How hard the air moves (0.25 at rest, more for a moment after a level turns). */
        wind: uniform(0.25),
        /** How still the water is asked to be: 1 at rest, 0 while the tarn holds its breath. */
        ruffle: uniform(1),
        /** How far the mist has lifted (a perfect clear): 0..1. */
        lift: uniform(0),
        // ── The lights that live here ──
        /** The troll's lantern: where its flame is (world), and how strongly it burns. */
        lanternAt: uniform(new THREE.Vector4(8, 2, -11, 0.5)),
        /** The spirit: her heart's height (world), and her radiance. */
        spiritAt: uniform(new THREE.Vector4(-6.7, 1.1, -10.2, 0.6)),
        /** The heart on the tarn's bed: (world x, y, z, how much of its gold shows). */
        heartAt: uniform(new THREE.Vector4(HEART[0], HEART[1], HEART[2], 0)),
        /** The wisps' light, gathered per side: where, and how much. */
        poolL: uniform(new THREE.Vector4(-5, 0.8, -8, 0)),
        poolR: uniform(new THREE.Vector4(5, 0.8, -8, 0)),
        poolColL: uniform(new THREE.Vector3(1, 1, 1)),
        poolColR: uniform(new THREE.Vector3(1, 1, 1)),
        /** The far wood's eyes: (share of them open 0..1, flash). */
        eyes: uniform(new THREE.Vector2(0, 0)),
        /** The glowing caps: how far in from the frame's edge they are lit, per side (0..1). */
        caps: uniform(new THREE.Vector2(0.12, 0.12)),
        /** The water lilies: (share of them open 0..1, flash: all of them for a moment). */
        lilies: uniform(new THREE.Vector2(0, 0)),
        /** The moon's shafts between the trunks (0..1.5). */
        shafts: uniform(0.35),
        // ── Events ──
        /** How many (rings, strokes, wisps) are live: the loops over the tables stop there. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        noiseTex: textures.noise,
        shoreTex: textures.shore,
    };
    PALETTE_KEYS.forEach((key) => {
        u[key] = v3(p[key]);
    });
    PALETTE_SCALARS.forEach((key) => {
        u[key] = uniform(p[key]);
    });
    /**
     * Event tables, live rows packed at the front (the world compacts them every frame).
     *   rings:   row 2i = (x, z, birth, strength), row 2i+1 = (r, g, b, reach)
     *   strokes: row 2i = (birth, fronts, strength, gold 0..1), row 2i+1 = (r, g, b, _)
     *   wisps:   row 2i = (x, y, z, light), row 2i+1 = (r, g, b, _)
     */
    u.ringRows = Array.from({ length: RING_SLOTS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
    u.strokeRows = Array.from({ length: STROKE_SLOTS * 2 }, () => new THREE.Vector4(-100, 1, 0, 0));
    u.wispRows = Array.from({ length: WISP_SLOTS * 2 }, () => new THREE.Vector4(0, -10, 0, 0));
    u.rings = uniformArray(u.ringRows, 'vec4');
    u.strokes = uniformArray(u.strokeRows, 'vec4');
    u.wisps = uniformArray(u.wispRows, 'vec4');
    u.noise = (st) => texture(u.noiseTex, st);
    /** The shore map at a WORLD xz: 0.5 at the water's edge, > 0.5 on land. */
    u.shore = (xz) => texture(u.shoreTex, vec2(
        xz.x.div(u.squeeze).sub(STAGE.x0).div(STAGE.x1 - STAGE.x0),
        xz.y.sub(STAGE.z0).div(STAGE.z1 - STAGE.z0),
    )).r;
    return u;
}

/** A scene part: what the world adds, hides and disposes. */
export function swPart(name, geometry, material, renderOrder = 0, extra = {}) {
    const mesh = extra.mesh || new THREE.Mesh(geometry, material);
    mesh.name = name;
    // A Group's renderOrder outranks its children's own (three sorts by it first): a part made
    // of several draws keeps the order on each of them instead.
    if (!mesh.isGroup) mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return {
        mesh, geometry, material, ...extra,
    };
}

// ── The night's light ───────────────────────────────────────────────────────────

/** The mist's density per metre at the water (it thins with height), before the hour's own share. */
export const FOG_DENSITY = 0.0115;

/** 0..1: how nearly a direction points at the moon (1 = straight at it). */
export const swToward = (u, dir) => clamp(dot(dir, u.moonDir).mul(0.5).add(0.5), 0.0, 1.0);

/**
 * The colour distance takes: the mist, pale and luminous toward the moon, dim away from it.
 * Every lit thing fades into it, and the far wood is painted with it.
 */
export const swHaze = (u, dir) => {
    const t = swToward(u, dir);
    const t2 = t.mul(t);
    const t4 = t2.mul(t2);
    const t16 = t4.mul(t4).mul(t4).mul(t4);
    const lowBand = exp(max(dir.y, 0.0).mul(-7.0));
    const base = mix(u.haze, u.hazeLit, t16.mul(0.85).add(t4.mul(0.15)));
    // The first light lies low all the way round, strongest opposite the viewer.
    const dawn = u.hazeLit.mul(u.dawn).mul(lowBand).mul(0.35);
    return base.mul(t4.mul(0.5).add(0.5)).add(dawn).mul(u.breath.mul(0.45).add(0.55));
};

/**
 * Mist between the eye and a world point: thicker low over the water, thinner up the trunks.
 * Returns the colour with the mist laid over it.
 */
export const swFog = (u, col, P, gain = 1) => {
    const rel = P.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const low = exp(max(P.y, 0.0).mul(-0.3)).mul(0.6).add(0.4);
    const density = u.mist.mul(float(1.0).sub(u.lift.mul(0.8))).mul(FOG_DENSITY * gain);
    const f = float(1.0).sub(exp(dist.mul(density).mul(low).negate()));
    return mix(col, swHaze(u, dir), clamp(f, 0.0, 1.0));
};

/** How much mist stands in front of a world point (0..1), for parts that need the number itself. */
export const swFogAmount = (u, P, gain = 1) => {
    const dist = length(P.sub(cameraPosition));
    const low = exp(max(P.y, 0.0).mul(-0.3)).mul(0.6).add(0.4);
    const density = u.mist.mul(float(1.0).sub(u.lift.mul(0.8))).mul(FOG_DENSITY * gain);
    return clamp(float(1.0).sub(exp(dist.mul(density).mul(low).negate())), 0.0, 1.0);
};

/**
 * Moonlight comes through the canopy in pools. The pattern is laid out on the ground where the
 * moon's ray through a point lands, so a pool on the moss runs on up the trunk that stands in it.
 */
export const swDapple = (u, P) => {
    const down = P.y.div(max(u.moonDir.y, 0.05));
    const q = P.xz.sub(u.moonDir.xz.mul(down));
    const n = u.noise(q.mul(0.035).add(vec2(u.sway.mul(0.004), u.sway.mul(-0.003))));
    const fine = u.noise(q.mul(0.13).add(vec2(u.sway.mul(-0.011), u.sway.mul(0.007))));
    return smoothstep(0.4, 0.66, n.r.mul(0.7).add(fine.g.mul(0.3)));
};

/**
 * The light on a surface: what the sky gives it, the moon through the canopy, and the lights
 * that live here. `N` = unit world normal, `P` = world position, `albedo` = what it is made of.
 * @param {object} [opts]
 * @param {*} [opts.shade]  moonlight reaching it (default: the canopy's pools)
 * @param {number} [opts.wrap=0.45]  how far the moon's light wraps round (soft things more)
 * @param {number} [opts.local=1]  share of the lights that live here (the lantern's bearer takes less)
 */
export const swLight = (u, albedo, N, P, opts = {}) => {
    const wrap = opts.wrap ?? 0.45;
    const shade = opts.shade ?? swDapple(u, P).mul(0.85).add(0.15);
    const up = N.y.mul(0.5).add(0.5);
    const amb = mix(u.groundAmb, u.skyAmb, up).mul(0.55);
    const nl = max(dot(N, u.moonDir).add(wrap).div(1 + wrap), 0.0);
    const moon = u.moonLight.mul(nl).mul(shade).mul(0.42);
    const point = (posPower, colour, reach) => {
        const to = posPower.xyz.sub(P);
        const d = length(to);
        const att = float(1.0).div(d.mul(d).mul(reach).add(1.0));
        const facing = max(dot(N, to.div(max(d, 1e-3))).mul(0.6).add(0.4), 0.0);
        return colour.mul(att.mul(facing).mul(posPower.w));
    };
    const local = point(u.lanternAt, u.lantern, 0.16).mul(2.2)
        .add(point(u.spiritAt, u.spirit, 0.3).mul(1.1))
        .add(point(u.heartAt, u.heart, 0.02).mul(0.9))
        .add(point(u.poolL, u.poolColL, 0.12).mul(0.7))
        .add(point(u.poolR, u.poolColR, 0.12).mul(0.7));
    return albedo.mul(amb.add(moon).mul(u.breath.mul(0.5).add(0.5)).add(local.mul(u.breath).mul(opts.local ?? 1)));
};

// ── The far wood (constants baked into the shader) ──────────────────────────────

/**
 * Ranks of spruce, far to near: trees per radian, hash row, the ground line (tan elevation), how
 * tall the trees stand above it, and how deep the mist has them (1 = all mist).
 */
const RANKS = [
    {
        trees: 82, row: 0.13, base: 0.01, tall: 0.058, mist: 0.93,
    },
    {
        trees: 56, row: 0.37, base: 0.006, tall: 0.1, mist: 0.84,
    },
    {
        trees: 38, row: 0.61, base: 0.003, tall: 0.155, mist: 0.72,
    },
    {
        trees: 26, row: 0.83, base: 0.0, tall: 0.225, mist: 0.58,
    },
];

/**
 * Everything at a distance, along a direction. Call inside a `Fn` (it declares variables).
 * @param {object} u
 * @param {*} dirIn  unit direction; anything below the horizon reads the horizon
 * @param {object} [opts]
 * @param {boolean} [opts.lite=false]   no stars, no northern lights, two ranks fewer (low tiers' mirror)
 * @param {number} [opts.soft=1]        edge softness multiplier (the mirror's edges are softer)
 */
export const swBackdrop = (u, dirIn, opts = {}) => {
    const lite = opts.lite === true;
    const soft = opts.soft ?? 1;
    const dir = vec3(dirIn).toVar();
    const up = clamp(dir.y, 0.0, 1.0).toVar();
    const horiz = max(length(dir.xz), 1e-4).toVar();
    /** tan(elevation), and the azimuth (0 = straight ahead, + to the right). */
    const el = max(dir.y, 0.0).div(horiz).toVar();
    const az = atan(dir.x, dir.z.negate()).toVar();
    const cm = dot(dir, u.moonDir).toVar();
    const aa = u.pixelAngle.mul(1.5 * soft).toVar();
    const gain = u.breath.mul(0.45).add(0.55).toVar();
    const clear = float(1.0).sub(u.lift.mul(0.7)).toVar();

    // ── The sky, and the moon's halo in the mist ──
    // Low down the sky IS the mist, and a little brighter than anything that stands in it: the
    // far wood is always a darker shape against it, never a pale one against the dark.
    const haze = swHaze(u, dir).toVar();
    const rise = sqrt(up);
    const col = mix(mix(haze.mul(1.3), u.horizon, smoothstep(0.44, 0.72, rise)), u.zenith, smoothstep(0.55, 0.95, rise)).toVar();
    // (2·(1 − cos) is the angle squared, near enough, for everything close to the moon.)
    const a2 = max(float(2.0).sub(cm.mul(2.0)), 0.0).toVar();
    const halo = exp(a2.mul(-7.0)).mul(0.5).add(exp(a2.mul(-55.0)).mul(0.6)).add(exp(a2.mul(-520.0)).mul(1.1));
    col.addAssign(u.glow.mul(halo).mul(clear.mul(0.75).add(0.25)).mul(gain));

    // ── Stars (one size of them on a grid over the sphere) ──
    if (!lite) {
        const p = dir.mul(96.0);
        const cell = floor(p);
        const h = swHash33(cell).toVar();
        const at = cell.add(0.5).add(h.sub(0.5).mul(0.7));
        const d = length(p.sub(at));
        const size = aa.mul(96.0 * 1.2).add(0.014);
        const spark = swBell(d.div(size.mul(2.0))).mul(step(0.955, h.z));
        const mag = fract(h.x.mul(57.0)).mul(fract(h.x.mul(57.0))).mul(0.85).add(0.15);
        const twinkle = sin(u.time.mul(h.y.mul(2.6).add(1.3)).add(h.x.mul(40.0))).mul(0.3).add(0.7);
        const tint = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.9, 0.76), h.y);
        const dark = clamp(float(1.0).sub(swLuma(col).mul(5.0)), 0.0, 1.0);
        col.addAssign(tint.mul(spark.mul(mag).mul(twinkle)).mul(dark).mul(smoothstep(0.04, 0.3, up))
            .mul(u.stars.add(u.lift.mul(1.2)).mul(1.4))
            .mul(1 / soft));
    }

    // ── The northern lights: one curtain with a sharp hem and a long fade upward ──
    if (!lite) {
        const wave = u.noise(vec2(az.mul(0.21).add(u.drift.mul(0.004)), 0.19)).toVar();
        const hem = float(0.2).add(wave.r.sub(0.5).mul(0.16));
        const x = el.sub(hem).div(0.3);
        const profile = smoothstep(-0.05, 0.0, x).mul(exp(max(x, 0.0).mul(-3.0)));
        const rays = u.noise(vec2(az.mul(1.7).add(wave.g.mul(0.3)), float(0.63).add(u.drift.mul(0.009)))).b;
        const band = profile.mul(rays.mul(rays).mul(1.5).add(0.15)).mul(smoothstep(0.25, 0.8, wave.b).mul(0.85).add(0.15));
        col.addAssign(mix(vec3(0.2, 0.95, 0.55), vec3(0.45, 0.4, 1.0), clamp(x.mul(0.8), 0.0, 1.0))
            .mul(band).mul(u.aurora.add(u.surge.mul(0.5))).mul(0.34));
    }

    // ── The moon ──
    const r = MOON.radius;
    const disc = float(1.0).sub(smoothstep(float(r).sub(aa), float(r).add(aa), sqrt(a2))).toVar();
    // A few seas, so it is the moon and not a lamp.
    const seas = u.noise(dir.xy.mul(7.0).add(vec2(0.31, 0.77))).r;
    const face = u.moon.mul(smoothstep(0.2, 0.75, seas).mul(0.3).add(0.75)).mul(gain.mul(2.6));
    col.assign(mix(col, face, disc.mul(clear.mul(0.2).add(0.8))));

    // ── Thin cloud across the moon's part of the sky ──
    const veilUv = vec2(az.mul(0.55).add(u.drift.mul(0.0016)), el.mul(2.6));
    const veil = u.noise(veilUv).toVar();
    const streak = smoothstep(0.5, 0.78, veil.g.mul(0.7).add(veil.b.mul(0.3)))
        .mul(smoothstep(0.05, 0.14, el)).mul(clear);
    const lit = exp(a2.mul(-9.0)).mul(1.4).add(0.12);
    col.assign(mix(col, u.glow.mul(lit).mul(0.42).add(u.horizon.mul(0.35)).mul(gain), streak.mul(0.5)));
    // ── Rank behind rank of spruce, far to near, each deeper in the mist ──
    /** The wood parts where the moon stands. */
    const gap = float(1.0).sub(swBell(az.sub(u.moonAz).div(0.34)).mul(0.52)).toVar();
    const ranks = lite ? RANKS.slice(1) : RANKS;
    ranks.forEach((rank) => {
        const hills = u.noise(vec2(az.mul(0.19).add(rank.row * 2.3), rank.row)).toVar();
        const ground = float(rank.base).add(hills.r.sub(0.4).mul(rank.tall * 0.3)).toVar();
        const top = float(0.0).toVar();
        // Two sets of trees half a place apart, so no tree is ever cut off by its neighbour's cell.
        [0, 0.5].forEach((shift, set) => {
            const x = az.mul(rank.trees).add(shift + rank.row * 31.0);
            const id = floor(x);
            const f = x.sub(id);
            const h1 = swHash11(id.mul(1.37).add(rank.row * 91.0 + set * 13.0));
            const h2 = swHash11(id.mul(2.11).add(rank.row * 57.0 + set * 7.0 + 3.1));
            const centre = h1.mul(0.3).add(0.35);
            const half = min(centre, float(1.0).sub(centre)).mul(0.92);
            const t = clamp(abs(f.sub(centre)).div(half), 0.0, 1.0);
            // A spruce: a slender spire whose sides fall in tiers of boughs. (Some places stand empty.)
            const lean = float(1.0).sub(t);
            const spire = lean.mul(float(1.14).sub(lean.mul(0.14)));
            const tiers = abs(fract(spire.mul(9.0).add(h2.mul(4.0))).sub(0.5)).mul(0.17);
            const height = h2.mul(0.42).add(0.58).mul(step(h1.mul(h2.add(0.5)), 0.86));
            top.assign(max(top, spire.sub(tiers.mul(smoothstep(0.0, 0.25, t)).mul(lean.add(0.25))).mul(height)));
        });
        // Under the spires the wood is a wall with a ragged edge.
        const fineLine = u.noise(vec2(az.mul(rank.trees * 0.11).add(rank.row * 5.1), rank.row + 0.3)).r;
        const brush = hills.g.mul(0.2).add(fineLine.mul(0.22)).add(0.34);
        const crest = ground.add(max(top, brush).mul(rank.tall).mul(gap)).toVar();
        const below = float(1.0).sub(smoothstep(crest.sub(aa), crest.add(aa), el)).toVar();
        // How far down from the crest, 0 at the tips → 1 at the water: the mist lies at the feet.
        const under = clamp(crest.sub(el).div(max(crest, 1e-3)), 0.0, 1.0);
        const wall = mix(u.forest.mul(gain), haze, rank.mist);
        const body = mix(wall, haze, under.mul(under).mul(0.75 - rank.mist * 0.35).mul(clear));
        col.assign(mix(col, body, below));
    });

    // Mist lies on the water all the way round.
    col.assign(mix(col, haze, exp(el.mul(-46.0)).mul(0.86).mul(clear.mul(0.6).add(0.4))));
    return col;
};

/** Camera-facing soft dot: 1 at the centre of a quad's uv, 0 at its rim. */
export const swDot = (uvNode) => {
    const d = length(uvNode.sub(0.5)).mul(2.0);
    return clamp(float(1.0).sub(d), 0.0, 1.0);
};

/** vec4(rgb, 0): what an additive part writes, so the target's alpha is left alone. */
export const swAdd = (rgb) => vec4(rgb, 0.0);

/** Hide a vertex (a pooled instance that is not in use). */
export const SW_CULLED = /* @__PURE__ */ vec4(0.0, 0.0, -2.0, 1.0);

/** Unit vector helper for parts. */
export const swUnit = (v) => normalize(v);
