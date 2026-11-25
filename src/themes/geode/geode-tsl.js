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
    min,
    mix,
    mod,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
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
    CLEAR_LIVE,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    FRACTURE_HEAL,
    FRACTURE_TRAVEL,
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
} from './geode-core.js';

import { NOISE_SIZE } from './geode-bake-data.js';
import { sessionNoiseMips } from './geode-bakes.js';

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

export {
    NOISE_SIZE, bakeNoise, sampleNoise,
} from './geode-bake-data.js';

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (geode-bake-data.js's
 * noiseMips, kept for the session with the field: geode-bakes.js).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = sessionNoiseMips(field, size).map((level) => ({ ...level }));
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
        /** A twist turns the agate: the bands' phase round the axis. */
        twist: uniform(0),
        /** Rings of the crown grown (0..CROWN_RINGS, eased). */
        crown: uniform(0),
        /** A four-line clear's fracture: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** The fracture before it, still healing when the next one opened: (birth time, strength). */
        shockB: uniform(new THREE.Vector2(-100, 0)),
        /**
         * A fever holds the fracture open: (how brightly its cracks burn, how far down the wall
         * from the heart they have opened).
         */
        veins: uniform(new THREE.Vector2(0, 0)),
        /**
         * The heat of play (src/themes/shared/gameplay-surge.js): (how much of its level the geode
         * wears 0..1 — none under casual play, see warmth() in geode-world.js — fever 0..1, blaze —
         * the light every clear pours into the crown — 0..~1.2, the agate's back-to-back lift 0..~1.2).
         */
        heat: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** (any ring live, any ripple live, any clear live, fracture live): the loops rest at 0. */
        live: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /**
         * The air the geode stands in (geode-airs.js), eased by the world between airs:
         * (light coming through the wall's thin places, the stones' own inner fire, spectral fire
         * on the facets and the lining, the moonstone sheen that crosses the lining).
         */
        mood: uniform(new THREE.Vector4(0.5, 0, 0.3, 0)),
        /**
         * (how hard the lining sparkles, how thick the dust hangs, how far the wall's thin places
         * have wandered, how far down the wall the heart's light carries).
         */
        air: uniform(new THREE.Vector4(1, 1, 0, 1)),
        /** (gain on the cool light from the viewer's side, how far the moonstone sheen has crossed). */
        lamp: uniform(new THREE.Vector2(1, 0)),
        // ── A level-up recrystallises the geode: the new mineral runs down the wall behind a front ──
        /** The mineral the geode is turning into (shown behind the front; see gdSweep). */
        fillB: v3(p.fill),
        rockB: v3(p.rock),
        druzyB: v3(p.druzy),
        bandsB: [v3(p.band0), v3(p.band1), v3(p.band2), v3(p.band3)],
        mineralsB: [],
        /** The front: (when it left the heart, 1 while it runs — 0 and the first palette is the only one). */
        sweep: uniform(new THREE.Vector2(-100, 0)),
        // ── What happens in the geode unasked (geode-airs.js: visits) ──
        /** Sparkle running over the lining: (meridian's place in turns, its strength, a ring's place w, its strength). */
        shimmer: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** A cluster ringing by itself: (its root, strength) + colour. */
        chime: uniform(new THREE.Vector4(0, 0, 0, 0)),
        chimeC: uniform(new THREE.Vector3(1, 1, 1)),
        /** The heart's slow ring: (its place w, strength). */
        swell: uniform(new THREE.Vector2(0, 0)),
        // ── Gameplay's own shapes ──
        /** A twist's pinwheel: (birth time, strength, arms, sense ±1). */
        whirl: uniform(new THREE.Vector4(-100, 0, 3, 1)),
        /** A perfect clear's opal fire: the play of colour over every facet, 0..1.4. */
        opal: uniform(0),
        /** (pinwheel live, opal fire live, a visit's sparkle or ring live, a chime live): the terms rest at 0. */
        live2: uniform(new THREE.Vector4(0, 0, 0, 0)),
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
    for (let i = 0; i < MINERALS; i++) {
        u.minerals.push(v3(p[`m${i}`]));
        u.mineralsB.push(v3(p[`m${i}`]));
    }
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

/** Seconds after a front leaves the heart at which it passes wall coordinate `w` (core's clearPassTime). */
export const gdPassTime = (w) => float(CLEAR_TRAVEL).mul(pow(clamp(w.div(CLEAR_REACH), 0.0, 1.0), 1 / CLEAR_SHAPE));

/**
 * A level-up's front at wall coordinate `w`: (how far the new mineral has taken this ring, 0..1,
 * and the seconds since the front passed it — negative ahead of it). It runs with the pale wave
 * the level-up sends (the same kinematics as a clear's), so the wall behind the wave is the new
 * mineral and the wall ahead of it still the old.
 */
export const gdSweep = (u, w) => {
    const since = u.time.sub(u.sweep.x).sub(gdPassTime(w));
    return vec2(smoothstep(-0.04, 0.16, since).mul(u.sweep.y), since);
};

/**
 * The palette a ring of the wall is showing while a level-up's front runs: every colour the
 * materials read, mixed `k` of the way to the mineral the geode is turning into. Has the shape
 * of `u` for gdMineral and gdBandRamp.
 */
export const gdPalette = (u, k) => ({
    fill: mix(u.fill, u.fillB, k).mul(u.lamp.x),
    rock: mix(u.rock, u.rockB, k),
    druzy: mix(u.druzy, u.druzyB, k),
    bands: u.bands.map((band, i) => mix(band, u.bandsB[i], k)),
    minerals: u.minerals.map((mineral, i) => mix(mineral, u.mineralsB[i], k)),
});

/**
 * What a visit lays over a ring of the wall (geode-airs.js): vec4(light, sparkle). A meridian of
 * sparkle running round the axis, a ring of it running down the wall, and the heart's slow swell.
 * `turn` is the angle round the axis in turns.
 */
export const gdVisit = (u, turn, w) => {
    const meridian = gdBell(fract(turn.sub(u.shimmer.x).add(0.5)).sub(0.5).div(0.045)).mul(u.shimmer.y);
    const ring = gdBell(w.sub(u.shimmer.z).div(0.085)).mul(u.shimmer.w);
    const swell = gdBell(w.sub(u.swell.x).div(0.2)).mul(u.swell.y);
    const run = meridian.add(ring);
    return vec4(
        mix(u.heart, vec3(1.0), 0.6).mul(run.mul(0.42)).add(u.heart.mul(swell.mul(0.5))),
        run.mul(7.0).add(swell.mul(1.5)),
    );
};

/** The moonstone sheen: two broad bands of cool light crossing the lining against each other (0..~1). */
export const gdSheen = (u, turn, w) => {
    const a = gdBell(fract(turn.add(w.mul(0.3)).sub(u.lamp.y)).sub(0.5).div(0.2));
    const b = gdBell(fract(turn.mul(2.0).sub(w.mul(0.45)).add(u.lamp.y.mul(1.6)).add(0.3)).sub(0.5).div(0.26));
    return a.add(b.mul(0.5)).mul(u.mood.w);
};

/**
 * A twist's pinwheel at (turn, w): arms of iridescent light that wind out from the heart and turn
 * about the axis. Returns the colour (HDR). Rests at zero when u.whirl's strength is.
 */
export const gdWhirl = (u, turn, w) => {
    const age = u.time.sub(u.whirl.x);
    const sense = u.whirl.w;
    const phase = turn.mul(u.whirl.z).add(w.mul(1.15).mul(sense)).sub(age.mul(0.85).mul(sense));
    const arm = gdBell(fract(phase).sub(0.5).div(0.24));
    // The arms wind outward from the heart, and thin as they go.
    const out = float(1.0).sub(smoothstep(age.mul(2.6).add(0.25), age.mul(2.6).add(0.6), w));
    const env = float(1.0).sub(exp(age.mul(-9.0))).mul(exp(age.div(-1.25))).mul(step(0.0, age))
        .mul(u.whirl.y);
    const hue = gdSpectrum(fract(turn.add(age.mul(0.22)).add(w.mul(0.35))));
    return mix(hue, vec3(1.0), 0.3).mul(arm.mul(out).mul(env));
};

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
    const warm = u.heart.mul(h8.mul(h8).mul(2.4).add(h2.mul(0.1)));
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
 * Call it inside an Fn (it keeps its sums in variables and skips the slots that are over).
 */
export const gdClearLight = (u, w) => {
    const front = vec3(0.0).toVar();
    const glow = float(0.0).toVar();
    const pass = float(CLEAR_TRAVEL).mul(pow(clamp(w.div(CLEAR_REACH), 0.0, 1.0), 1 / CLEAR_SHAPE)).toVar();
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        // A slot whose wave is over costs one comparison (the branch is uniform).
        If(u.time.sub(A.x).lessThan(CLEAR_LIVE), () => {
            const since = u.time.sub(A.x).sub(pass);
            let f = float(0.0);
            for (let k = 0; k < 4; k++) {
                f = f.add(gdBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
            }
            const live = step(0.0, since).mul(A.z);
            front.addAssign(u.clearC[i].mul(f.mul(A.z)));
            glow.addAssign(exp(max(since, 0.0).div(-CLEAR_AFTERGLOW)).mul(live));
        });
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

/** Cells of the fracture network round the axis and per radian along the wall. */
export const CRACK_ROUND = 22;
export const CRACK_ALONG = 5.4;

/**
 * The plates the wall breaks into: Voronoi cells over (turn, w). Returns vec2(F2 − F1 — small
 * along the cracks between plates — and the plate's own number in [0, 1)). `turn` is the angle
 * round the axis in turns (any whole number of turns off: the cells wrap). Call inside an Fn.
 */
export const gdCracks = (turn, w) => {
    const g = vec2(turn.mul(CRACK_ROUND), w.mul(CRACK_ALONG));
    const id = floor(g).toVar();
    const f = fract(g).toVar();
    const f1 = float(8.0).toVar();
    const f2 = float(8.0).toVar();
    const plate = float(0.0).toVar();
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const key = vec2(mod(id.x.add(i).add(CRACK_ROUND * 2), CRACK_ROUND), id.y.add(j)).toVar();
            const own = gdHash21(key).toVar();
            const site = vec2(own, gdHash21(key.add(vec2(31.7, 12.3)))).mul(0.8).add(0.1);
            const dist = length(vec2(i, j).add(site).sub(f)).toVar();
            f2.assign(min(f2, max(f1, dist)));
            // (nearer than the nearest so far: this is the plate the point lies on)
            plate.assign(select(dist.lessThan(f1), own, plate));
            f1.assign(min(f1, dist));
        }
    }
    return vec2(f2.sub(f1), plate);
};

/**
 * A four-line clear's fracture at (turn, w): vec3(F2 − F1 of the plates, how open the cracks
 * are here, how brightly this plate is flaring). Two fractures are drawn — the newest and the one
 * still healing under it — and a fever holds the same network open from the heart out to
 * u.veins.y, light pulsing outward along it. Rests (all zero) while u.live.w is down.
 */
export const gdFracture = (u, turnIn, wIn) => Fn(() => {
    const w = float(wIn).toVar();
    const turn = float(turnIn).toVar();
    const out = vec3(1.0, 0.0, 0.0).toVar();
    If(u.live.w.greaterThan(0.5), () => {
        const cells = gdCracks(turn, w).toVar();
        /** One fracture (birth, strength): how open its cracks are here, and its running head. */
        const opened = (shock) => {
            const age = u.time.sub(shock.x);
            const reached = age.div(FRACTURE_TRAVEL).mul(CAVITY.wMax);
            const since = max(age.sub(w.div(CAVITY.wMax).mul(FRACTURE_TRAVEL)), 0.0);
            return vec2(
                step(w, reached).mul(exp(since.div(-FRACTURE_HEAL * 0.4))).mul(shock.y),
                gdBell(w.sub(reached).div(0.2)).mul(shock.y),
            );
        };
        const a = opened(u.shock).toVar();
        const b = opened(u.shockB).toVar();
        // A fever's veins: open from the heart out to veins.y, light pulsing outward along them.
        const vein = u.veins.x.mul(float(1.0).sub(smoothstep(u.veins.y.sub(0.12), u.veins.y.add(0.12), w)))
            .mul(sin(u.time.mul(2.6).sub(w.mul(13.0)).add(cells.y.mul(5.0))).mul(0.35).add(0.65));
        out.assign(vec3(
            cells.x,
            a.x.add(b.x).add(vein),
            a.y.add(b.y).mul(cells.y.mul(1.4).add(0.3)),
        ));
    });
    return out;
})();

/**
 * Where the wall is thin, light from outside the stone comes through it and the lining glows from
 * behind: the noise field is read here, at a place that wanders slowly round the axis (u.air.z),
 * so the pools of light drift over the wall. `turn` is the angle round the axis in turns (whole
 * multiples of it only: the field tiles).
 */
export const gdThinUV = (u, turn, w) => vec2(turn.mul(3.0).add(u.air.z), w.mul(0.62).sub(u.air.z.mul(0.37)));

/** How thin the wall is (0..1) from the field read at gdThinUV. */
export const gdThin = (field) => smoothstep(0.5, 0.74, field.g).mul(smoothstep(0.2, 0.55, field.a).mul(0.6).add(0.4));

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
