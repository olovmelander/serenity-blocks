/**
 * Ocean — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - helpers that are pure functions of their arguments carry `setLayout` (emitted once); helpers
 *    that read uniforms or a texture are plain JS functions that build nodes inline;
 *  - every surface shades itself (MeshBasicNodeMaterial): the sea's light is written once here
 *    (`ocLight`, `ocFog`) and used by everything that is lit;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 *
 * The light is ONE pattern, painted every frame into a small tileable target (`createLightPass`):
 * the caustic net in one channel, the broad mask of the shafts in another. A surface looks its
 * own point up along the sun's ray to where that ray came through the surface, and the post
 * stack looks every step of its march up the same way, so a shaft stands exactly over the bright
 * patch it lays on the sand, and both move with the same water.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    mix,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    LIGHT_TILE,
    RING_LIVE,
    RING_SLOTS,
    RING_SLOW,
    RING_SPEED,
    SCARE_SLOTS,
    SCHOOL_REST,
    SCHOOL_SPAN,
    SONG_SLOTS,
    STAIN_FADE,
    STAIN_KINDLE,
    STAIN_REACH,
    STAIN_SLOTS,
    SURFACE,
    SURGE_SLOTS,
    SURGE_SPEED,
    SURGE_START,
    SURGE_WIDTH,
    TAU,
    mulberry32,
    refractToAir,
    skyDirection,
} from './ocean-core.js';
import { HOURS, HOUR_COLOURS } from './ocean-hours.js';

export * from './ocean-core.js';
export * from './ocean-hours.js';

/** Capsules that stand in the sun's way: the large animals throw shadows through the shafts. */
export const SHADE_SLOTS = 4;

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const ocHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'oc_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const ocHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'oc_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const ocLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const ocMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const ocBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x⁴ and x⁸ by products (a `pow` whose base strays below zero is a NaN). */
export const ocPow4 = (x) => {
    const x2 = x.mul(x);
    return x2.mul(x2);
};
export const ocPow8 = (x) => {
    const x4 = ocPow4(x);
    return x4.mul(x4);
};

/** A vector turned about the y axis by an angle whose sine and cosine are given. */
export const ocTurnY = (v, s, c) => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 7741, size = NOISE_SIZE) {
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
 * The noise field as a tileable 8-bit texture with a CPU-built mip chain (the sand reads it at
 * grazing angles, and every WebGL2 device can filter it).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const bytes = new Uint8Array(level.length);
        for (let i = 0; i < level.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(level[i] * 255)));
        mipmaps.push({ data: bytes, width: w, height: w });
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
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'ocean-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
const rows = (count, make) => Array.from({ length: count }, make);

/**
 * Every uniform the sea's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, light: THREE.Texture }} textures
 */
export function createOceanUniforms(textures) {
    const h = HOURS[0];
    const sun = skyDirection(h.azimuth * (Math.PI / 180), h.elevation * (Math.PI / 180));
    const air = refractToAir(sun);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** How far the stage is drawn in toward the middle (1 on a wide frame). */
        squeeze: uniform(1),
        /** The slow clock everything unhurried runs on, and the flora's own (current-paced) phase. */
        drift: uniform(0),
        sway: uniform(0),
        /** Toward the light, in the water; and where that light stands in the sky over it. */
        sunDir: uniform(new THREE.Vector3(sun[0], sun[1], sun[2])),
        sunAir: uniform(new THREE.Vector3(air[0], air[1], air[2])),
        /** Gain on every light of the sea: a four-line clear holds its breath (→ 0.3). */
        breath: uniform(1),
        /** 0..1: the reef's charge (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** How far the water has cleared (a perfect clear): 0..1. */
        lift: uniform(0),
        /** The steady current's lean on everything that grows (0.25 at rest). */
        current: uniform(0.25),
        /** How steep the surface's waves stand (1 at rest; a level's set swell and the overdrive raise it). */
        swell: uniform(1),
        /** How strongly the reef fluoresces, and how much of the night's own light is out. */
        fluor: uniform(h.fluor),
        night: uniform(h.night),
        /** The great shaft a four-line clear opens: (world x, z where it meets the sand, radius, strength). */
        beam: uniform(new THREE.Vector4(0, 0, 3, 0)),
        // ── The silver school ──
        /** (how wide its loop is, its mean height, its swing in y, the z it circles). */
        schoolA: uniform(new THREE.Vector4(SCHOOL_REST.wide, SCHOOL_REST.high, SCHOOL_REST.swing, SCHOOL_REST.back)),
        /** (its swing in z, its phase on the loop, how far it is wound into the vortex 0..1, its span on the loop). */
        schoolB: uniform(new THREE.Vector4(SCHOOL_REST.deep, 0, 0, SCHOOL_SPAN)),
        /** (the vortex's own phase, how tight the school packs 1 = at rest, how excited 0..1, _). */
        schoolC: uniform(new THREE.Vector4(0, 1, 0, 0)),
        // ── Events ──
        /** How many (rings, stains, surges, scares) are live: the loops over the tables stop there. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** How many (songs, shades) are live. */
        counts2: uniform(new THREE.Vector4(0, 0, 0, 0)),
        noiseTex: textures.noise,
        lightTex: textures.light,
    };
    HOUR_COLOURS.forEach((key) => {
        u[key] = v3(h[key]);
    });
    /**
     * Event tables, live rows packed at the front (the world compacts them every frame).
     *   rings:   row 2i = (x, z, birth, strength), row 2i+1 = (r, g, b, reach)
     *   stains:  row 2i = (x, z, birth, gain),     row 2i+1 = (r, g, b, let go at)
     *   surges:  row i  = (birth, direction ±1, strength, lines)
     *   scares:  row 2i = (x, y, z, birth),        row 2i+1 = (strength, radius, _, _)
     *   songs:   row i  = (x, y, z, birth)
     *   shades:  row 2i = (ax, ay, az, radius),    row 2i+1 = (bx, by, bz, strength)
     */
    u.ringRows = rows(RING_SLOTS * 2, () => new THREE.Vector4(0, 0, -100, 0));
    u.stainRows = rows(STAIN_SLOTS * 2, () => new THREE.Vector4(0, 0, -100, 0));
    u.surgeRows = rows(SURGE_SLOTS, () => new THREE.Vector4(-100, 1, 0, 0));
    u.scareRows = rows(SCARE_SLOTS * 2, () => new THREE.Vector4(0, 0, 0, -100));
    u.songRows = rows(SONG_SLOTS, () => new THREE.Vector4(0, 0, 0, -100));
    u.shadeRows = rows(SHADE_SLOTS * 2, () => new THREE.Vector4(0, -100, 0, 0));
    u.rings = uniformArray(u.ringRows, 'vec4');
    u.stains = uniformArray(u.stainRows, 'vec4');
    u.surges = uniformArray(u.surgeRows, 'vec4');
    u.scares = uniformArray(u.scareRows, 'vec4');
    u.songs = uniformArray(u.songRows, 'vec4');
    u.shades = uniformArray(u.shadeRows, 'vec4');
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

/** A scene part: what the world adds, hides and disposes. */
export function ocPart(name, geometry, material, renderOrder = 0, extra = {}) {
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

// ── The water ───────────────────────────────────────────────────────────────────

/**
 * The colour of the water itself along a direction, as far as the eye goes: bright overhead,
 * deep blue level, dark below, and a glow round the way the light comes from. Everything fades
 * into exactly this, and the dome behind everything is painted with it.
 */
export const ocBackdrop = (u, dir) => {
    const up = clamp(dir.y, -1.0, 1.0);
    const above = mix(u.deep, u.shallow, smoothstep(-0.05, 0.85, up));
    const body = mix(above, u.abyss, float(1.0).sub(smoothstep(-0.75, 0.0, up)));
    const toward = clamp(dot(dir, u.sunDir), 0.0, 1.0);
    const t2 = toward.mul(toward);
    const t6 = t2.mul(t2).mul(t2);
    const t24 = ocPow4(t6);
    const halo = u.halo.mul(t6.mul(0.55).add(t24.mul(1.4)));
    return body.add(halo).mul(u.breath.mul(0.5).add(0.5));
};

/** What a stretch of water lets through, per channel. */
export const ocThrough = (u, dist) => exp(u.ext.mul(dist).mul(float(1.0).sub(u.lift.mul(0.55))).negate());

/** The water between the eye and a world point, laid over a colour. */
export const ocFog = (u, col, P) => {
    const rel = P.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    return mix(ocBackdrop(u, dir), col, ocThrough(u, dist));
};

/** How much of a light that starts at a world point reaches the eye (for lights that add themselves). */
export const ocSeen = (u, P) => ocThrough(u, length(P.sub(cameraPosition)));

// ── The light pattern ───────────────────────────────────────────────────────────

/** Where the light that falls on a world point came through the surface (xz). */
export const ocLightPoint = (u, P) => {
    const climb = max(float(SURFACE).sub(P.y), 0.0).div(max(u.sunDir.y, 0.25));
    return P.xz.add(u.sunDir.xz.mul(climb));
};

/** The pattern at a surface point: r = the caustic net, g = the shafts' mask (both stored as roots). */
export const ocLightRead = (u, q) => texture(u.lightTex, q.div(LIGHT_TILE));

/**
 * The caustic net on a world point, as a gain on the direct light (about 1 on average). It only
 * comes into focus some way under the surface and softens with distance from the eye.
 */
export const ocCaustic = (u, P, shift = null) => {
    const q = ocLightPoint(u, P);
    const { r } = ocLightRead(u, shift ? q.add(shift) : q);
    const net = r.mul(r).mul(3.4).add(0.5);
    const focus = smoothstep(0.4, 5.0, float(SURFACE).sub(P.y));
    const near = exp(length(P.sub(cameraPosition)).mul(-0.028));
    return mix(float(1.0), net, focus.mul(near).mul(u.power.mul(0.2).add(0.8)));
};

/**
 * What the large animals take out of the sun's light at a world point: each is a capsule, and a
 * point is in its shadow when the ray toward the sun passes through it.
 */
export const ocShade = (u, P) => {
    const lit = float(1.0).toVar();
    Loop({
        start: int(0), end: int(u.counts2.y), type: 'int', condition: '<', name: 'sh',
    }, ({ sh }) => {
        const A = u.shades.element(sh.mul(2));
        const B = u.shades.element(sh.mul(2).add(1));
        const S = u.sunDir;
        // Everything flattened along the sun's ray: the capsule's axis and the point.
        const a = A.xyz.sub(P);
        const b = B.xyz.sub(P);
        const a2 = a.sub(S.mul(dot(a, S)));
        const b2 = b.sub(S.mul(dot(b, S)));
        const ab = b2.sub(a2);
        const k = clamp(dot(a2.negate(), ab).div(max(dot(ab, ab), 1e-4)), 0.0, 1.0);
        const off = length(a2.add(ab.mul(k)));
        const over = step(0.0, dot(mix(a, b, k), S));
        const dark = float(1.0).sub(smoothstep(A.w.mul(0.75), A.w.mul(1.9), off)).mul(over).mul(B.w);
        lit.mulAssign(float(1.0).sub(dark));
    });
    return lit;
};

/**
 * The great shaft a four-line clear opens, at a world point: a column of light down the sun's
 * ray to where `u.beam` says it meets the sand (0 while there is none).
 */
export const ocBeam = (u, P) => {
    const foot = P.xz.sub(u.sunDir.xz.mul(P.y.div(max(u.sunDir.y, 0.25))));
    const off = foot.sub(u.beam.xy).div(max(u.beam.z, 0.1));
    return exp(dot(off, off).negate()).mul(u.beam.w);
};

/**
 * The sea's light on a surface: the sun (or the moon) through the caustic net, the glow of the
 * whole surface from above, and what the sand gives back from below.
 * @param {object} u
 * @param {object} s
 * @param {*} s.N        world normal
 * @param {*} s.P        world position
 * @param {*} [s.caustic]  the caustic gain, if the surface read it itself (a vec3 for a colour split)
 * @param {*} [s.shade]    the animals' shadow, if the surface read it itself
 * @param {number} [s.wrap=0.45]  how far the light wraps round (soft things take it from all sides)
 */
export const ocLight = (u, {
    N, P, caustic = null, shade = null, wrap = 0.45,
}) => {
    const depth = max(float(SURFACE).sub(P.y), 0.0);
    // What the water over a point has already taken out of the light (eased: a reef stays coloured).
    const sunk = exp(u.ext.mul(depth).mul(-0.32));
    const facing = clamp(dot(N, u.sunDir).mul(1 - wrap).add(wrap), 0.0, 1.0);
    const net = caustic || ocCaustic(u, P);
    const direct = u.sun.mul(facing.mul(facing)).mul(net).mul(shade || float(1.0))
        .add(u.shaft.mul(ocBeam(u, P)).mul(facing.mul(0.6).add(0.4)).mul(1.4));
    const sky = u.ambient.mul(N.y.mul(0.5).add(0.5));
    const ground = u.bounce.mul(float(0.5).sub(N.y.mul(0.5)));
    return direct.add(sky).mul(sunk).add(ground).mul(u.breath.mul(0.6).add(0.4));
};

// ── What the board lays on the reef ─────────────────────────────────────────────

/** The rings of light running over the reef, at a world xz. */
export const ocRings = (u, xz) => {
    const light = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'rg',
    }, ({ rg }) => {
        const A = u.rings.element(rg.mul(2));
        const C = u.rings.element(rg.mul(2).add(1));
        const age = u.time.sub(A.z).toVar();
        const radius = float(RING_SPEED * RING_SLOW * 0.42).mul(float(1.0).sub(exp(age.div(-RING_SLOW)))).mul(C.w)
            .add(0.25);
        const back = radius.sub(length(xz.sub(A.xy))).toVar();
        // A bright front with a soft wash behind it.
        const front = ocBell(back.div(0.55)).add(smoothstep(-0.2, 0.3, back).mul(exp(max(back, 0.0).mul(-0.75))).mul(0.35));
        const live = step(0.0, age).mul(float(1.0).sub(smoothstep(RING_LIVE * 0.45, RING_LIVE, age))).mul(A.w)
            .div(radius.mul(0.12).add(1.0));
        light.addAssign(C.xyz.mul(front).mul(live));
    });
    return light;
};

/**
 * The colours the colonies are holding, at a world xz (a soft pool round each stain). Where
 * several overlap the strongest one's hue wins (weighted by the cube of each one's strength),
 * and the brightness is capped: ten pieces locked on one garden must not add up to white.
 */
export const ocStains = (u, xz) => {
    const hue = vec3(0.0).toVar();
    const weight = float(0.0).toVar();
    const level = float(0.0).toVar();
    Loop({
        start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'sn',
    }, ({ sn }) => {
        const A = u.stains.element(sn.mul(2));
        const C = u.stains.element(sn.mul(2).add(1));
        const age = u.time.sub(A.z).toVar();
        const gone = max(u.time.sub(C.w), 0.0).toVar();
        const kindle = smoothstep(0.0, STAIN_KINDLE, age).mul(exp(age.div(-0.35)).mul(1.6).add(1.0));
        const go = exp(gone.div(-0.3)).mul(2.2).mul(step(1e-4, gone)).add(1.0)
            .mul(float(1.0).sub(smoothstep(0.0, STAIN_FADE, gone)));
        const d = length(xz.sub(A.xy)).div(STAIN_REACH);
        const pool = float(1.0).sub(smoothstep(0.15, 1.0, d));
        const w = pool.mul(pool).mul(kindle).mul(go).mul(A.w);
        const w3 = w.mul(w).mul(w);
        hue.addAssign(C.xyz.mul(w3));
        weight.addAssign(w3);
        level.addAssign(w);
    });
    // (A level over 1 is a stain kindling or letting go: let those flare, a little.)
    const capped = level.div(level.add(1.0)).mul(2.0);
    return hue.div(max(weight, 1e-5)).mul(capped);
};

/**
 * How hard the passing currents lean on what grows at a stage x: signed, along x (a clear's
 * front crossing the canyon), on top of the steady current.
 */
export const ocLean = (u, x) => {
    const lean = float(0.0).toVar();
    Loop({
        start: int(0), end: int(u.counts.z), type: 'int', condition: '<', name: 'sg',
    }, ({ sg }) => {
        const A = u.surges.element(sg);
        const age = u.time.sub(A.x).toVar();
        const front = age.mul(SURGE_SPEED).sub(SURGE_START).mul(A.y);
        // Hard on the front, a long ease behind it.
        const back = front.sub(x).mul(A.y).toVar();
        const push = smoothstep(-1.5, 1.0, back).mul(exp(max(back, 0.0).div(-SURGE_WIDTH)));
        lean.addAssign(push.mul(A.z).mul(A.y).mul(step(0.0, age)));
    });
    return lean;
};

/**
 * How the water bends what grows at a stage x: (along x, along z) per unit of flex. The steady
 * current, a slow sway of each thing's own, and the lean of every passing current.
 */
export const ocSway = (u, x, seed) => {
    const t = u.sway;
    const own = sin(t.mul(0.9).add(seed.mul(6.283)).add(x.mul(0.35))).mul(0.5)
        .add(sin(t.mul(1.7).add(seed.mul(13.0))).mul(0.25));
    const lean = u.current.add(ocLean(u, x));
    return vec2(lean.add(own.mul(0.35)), cos(t.mul(0.7).add(seed.mul(9.1))).mul(0.25));
};

/** The whale's song at a world point: thin shells of light running out from where it sang. */
export const ocSong = (u, P) => {
    const light = float(0.0).toVar();
    Loop({
        start: int(0), end: int(u.counts2.x), type: 'int', condition: '<', name: 'so',
    }, ({ so }) => {
        const A = u.songs.element(so);
        const age = u.time.sub(A.w).toVar();
        const d = length(P.sub(A.xyz));
        const radius = age.mul(13.0);
        const shell = ocBell(d.sub(radius).div(1.1)).add(ocBell(d.sub(radius.sub(3.2)).div(0.9)).mul(0.6))
            .add(ocBell(d.sub(radius.sub(6.0)).div(0.8)).mul(0.35));
        light.addAssign(shell.mul(step(0.0, age)).mul(exp(age.mul(-0.5))));
    });
    return light;
};

// ── The light pass ──────────────────────────────────────────────────────────────

/**
 * One tile of water caustics: light gathered into a net of bright threads. Periodic in `p`
 * (period 2π), animated by `t`. Returns the net before it is sharpened, 0..1.
 */
const causticNet = /* @__PURE__ */ Fn(([pIn, t]) => {
    const p = vec2(pIn).toVar();
    const i = vec2(p).toVar();
    const c = float(1.0).toVar();
    // (The lattice the threads fold on: a constant, so the tile closes on itself exactly.)
    const fold = float(-247.0 * 0.005);
    for (let n = 0; n < 5; n++) {
        const tt = t.mul(1.0 - 3.5 / (n + 1));
        i.assign(p.add(vec2(
            cos(tt.sub(i.x)).add(sin(tt.add(i.y))),
            sin(tt.sub(i.y)).add(cos(tt.add(i.x))),
        )));
        // (Only the length is used, so the signs may go; the floor keeps a zero out of the divisor.)
        const gather = vec2(
            fold.div(max(abs(sin(i.x.add(tt))), 1e-4)),
            fold.div(max(abs(cos(i.y.add(tt))), 1e-4)),
        );
        c.addAssign(float(1.0).div(length(gather)));
    }
    c.divAssign(5.0);
    const lifted = float(1.17).sub(pow(max(c, 0.0), 1.4));
    return clamp(abs(lifted), 0.0, 1.0);
}).setLayout({
    name: 'oc_causticNet',
    type: 'float',
    inputs: [{ name: 'pIn', type: 'vec2' }, { name: 't', type: 'float' }],
});

/**
 * The pass that paints the light pattern: a tileable target the whole sea reads.
 *   r = √ of the caustic net (two scales of it), g = √ of the shafts' mask.
 * @param {object} u       shared uniforms (reads `drift`)
 * @param {number} size    the target's edge in texels
 */
export function createLightPass(u, size = 512) {
    const target = new THREE.RenderTarget(size, size, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    target.texture.name = 'ocean-light';
    target.texture.wrapS = THREE.RepeatWrapping;
    target.texture.wrapT = THREE.RepeatWrapping;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    target.texture.generateMipmaps = true;
    // The sand reads it at a grazing angle: without this the net smears along the line of sight.
    target.texture.anisotropy = 8;
    target.texture.colorSpace = THREE.NoColorSpace;

    const material = new THREE.NodeMaterial();
    material.name = 'OceanLightPass';
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = Fn(() => {
        const st = uv();
        const t = u.drift;
        // The fine net: two scales of it, the smaller riding on the larger.
        const a = causticNet(st.mul(TAU * 5).add(vec2(0.0, 1.7)), t.mul(0.62));
        const b = causticNet(st.mul(TAU * 9).add(vec2(2.3, 0.4)), t.mul(0.83).add(11.0));
        const a8 = ocPow8(a);
        const b8 = ocPow8(b);
        const net = clamp(a8.mul(0.72).add(b8.mul(0.28)).add(a8.mul(b8).mul(0.6)), 0.0, 1.0);
        // The shafts: where the swell lets the light down in a column. Two fields drifting
        // across one another make soft columns that open and close (few enough that a line of
        // sight crosses one or two, not a wall of them); the broad net gives each its threads.
        const s = causticNet(st.mul(TAU * 3).add(vec2(4.1, 2.9)), t.mul(0.31).add(5.0));
        const f1 = texture(u.noiseTex, st.add(vec2(t.mul(0.006), t.mul(0.0035)))).level(2.0).r;
        const f2 = texture(u.noiseTex, st.add(vec2(t.mul(-0.0045), t.mul(0.005))).add(vec2(0.37, 0.61))).level(2.0).g;
        const open = smoothstep(0.5, 0.7, f1.add(f2).mul(0.5));
        const shaft = clamp(open.mul(s.mul(s).mul(0.7).add(0.4)), 0.0, 1.0);
        return vec4(net.sqrt(), shaft.sqrt(), f1, 1.0);
    })();
    const quad = new THREE.QuadMesh(material);
    quad.name = 'OceanLightPass';

    return {
        target,
        texture: target.texture,
        material,
        /** Paint this frame's pattern (the `drift` uniform must be current). */
        render(renderer) {
            if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
            const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
            renderer.setRenderTarget(target);
            quad.render(renderer);
            renderer.setRenderTarget(previous);
            return true;
        },
        dispose() {
            target.dispose();
            material.dispose();
        },
    };
}
