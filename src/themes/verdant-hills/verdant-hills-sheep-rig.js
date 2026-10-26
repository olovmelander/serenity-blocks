/**
 * Verdant Hills — the sheep's bodies: their skeletons, their gaits and what they do.
 * Three-free and renderer-free: the flock (verdant-hills-sheep.js) copies the bone rotations this
 * solves into a table its vertex stage skins by, the modelling script (scripts/verdant-hills/
 * model-sheep.mjs, with scripts/blender/verdant_hills_sheep.py) builds each mesh round these very
 * joints and skins it to them, and the CPU preview (scripts/fox/preview-fox.mjs --fox=ewe|lamb)
 * draws the same poses without a GPU.
 *
 * The solver is the quadruped one the foxes and the polar bear share (../shared/fox-rig.js): hooves
 * placed on the ground and legs solved to reach them, a back of three bones that bends, a head held
 * level, every pose a "spec" of numbers so any two blend. What is the sheep's own is written here:
 *  - its gaits, on one continuous coordinate: a four-beat walk of lateral footfalls (left hind,
 *    left fore, right hind, right fore), the trot of diagonal pairs the forelegs slide into as it
 *    quickens, and the bounding gallop of a bolting flock, the back gathering and stretching and
 *    all four feet off the grass between strides. Every hoof stays where it struck: the phase is
 *    distance over stride;
 *  - what it does: grazing with its muzzle in the sward, cropping and stepping on; standing with
 *    its head up chewing; staring at what alarmed it, a forefoot stamped; going down on its knees
 *    to lie and chew the cud and getting up hind end first; stretching; shaking its fleece; the
 *    lamb's spring straight up off all four feet, the twisting kick, its suckling under the ewe.
 *
 * Two skeletons, one set of bones: a ewe (a black-faced Suffolk cross, 0.72 m at the withers, 1.35 m
 * from muzzle to tail) and her lamb of six weeks (0.46 m, long-legged, big-headed). Model metres,
 * +z ahead, +y up, +x its left, the hooves on y = 0, every bone axis-aligned at rest.
 */

import {
    FOOT, FOX_LEGS, SPEC, SPEC_SIZE, createFoxRig, createFoxSpec,
} from '../shared/fox-rig.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
const hold = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
const frac = (v) => v - Math.floor(v);
const mixNumber = (a, b, t) => a + (b - a) * t;

/**
 * The ewe at rest: [name, parent, x, y, z]. The trunk's joints run inside the fleece: hips over
 * the hip joints, spine mid-back, chest at the withers' foot. The neck starts low in front of the
 * withers and runs up and forward to the poll; the head is long and Roman-nosed, carried with the
 * face sloping down. The legs are the joints it stands on: shoulder, elbow and knee (the carpus)
 * in front, from which the cannon runs to the hoof; hip, stifle and hock behind.
 */
export const EWE_BONES = Object.freeze([
    ['hips', null, 0, 0.62, -0.3],
    ['spine', 'hips', 0, 0.645, -0.02],
    ['chest', 'spine', 0, 0.62, 0.25],
    ['neck', 'chest', 0, 0.62, 0.36],
    ['head', 'neck', 0, 0.82, 0.6],
    ['tail1', 'hips', 0, 0.66, -0.5],
    ['tail2', 'tail1', 0, 0.615, -0.535],
    ['tail3', 'tail2', 0, 0.57, -0.55],
    ['armL', 'chest', 0.12, 0.66, 0.29],
    ['foreL', 'armL', 0.115, 0.36, 0.215],
    ['handL', 'foreL', 0.105, 0.19, 0.265],
    ['armR', 'chest', -0.12, 0.66, 0.29],
    ['foreR', 'armR', -0.115, 0.36, 0.215],
    ['handR', 'foreR', -0.105, 0.19, 0.265],
    ['thighL', 'hips', 0.115, 0.58, -0.3],
    ['shinL', 'thighL', 0.12, 0.425, -0.2],
    ['hockL', 'shinL', 0.105, 0.255, -0.395],
    ['thighR', 'hips', -0.115, 0.58, -0.3],
    ['shinR', 'thighR', -0.12, 0.425, -0.2],
    ['hockR', 'shinR', -0.105, 0.255, -0.395],
]);

/** Points on the ewe that are not joints (model metres, at rest). */
export const EWE_MARKS = Object.freeze({
    /** The tip of its muzzle, between the nostrils. */
    nose: Object.freeze([0, 0.655, 0.795]),
    tailTip: Object.freeze([0, 0.525, -0.555]),
    /** Its left eye (the right is its mirror) and the root of its left ear. */
    eye: Object.freeze([0.058, 0.79, 0.665]),
    ear: Object.freeze([0.07, 0.835, 0.6]),
    /** Where each hoof meets the grass: under the toe's middle. */
    pawFL: Object.freeze([0.105, 0, 0.29]),
    pawFR: Object.freeze([-0.105, 0, 0.29]),
    pawBL: Object.freeze([0.105, 0, -0.37]),
    pawBR: Object.freeze([-0.105, 0, -0.37]),
    /** The udder, between the hind legs (where a lamb's muzzle goes to suckle). */
    udder: Object.freeze([0, 0.32, -0.26]),
});

/** The lamb at rest: six weeks old, all legs and head, its tail still long. */
export const LAMB_BONES = Object.freeze([
    ['hips', null, 0, 0.405, -0.17],
    ['spine', 'hips', 0, 0.415, 0],
    ['chest', 'spine', 0, 0.4, 0.14],
    ['neck', 'chest', 0, 0.405, 0.2],
    ['head', 'neck', 0, 0.54, 0.335],
    ['tail1', 'hips', 0, 0.44, -0.29],
    ['tail2', 'tail1', 0, 0.385, -0.325],
    ['tail3', 'tail2', 0, 0.325, -0.335],
    ['armL', 'chest', 0.072, 0.43, 0.16],
    ['foreL', 'armL', 0.07, 0.235, 0.112],
    ['handL', 'foreL', 0.064, 0.13, 0.145],
    ['armR', 'chest', -0.072, 0.43, 0.16],
    ['foreR', 'armR', -0.07, 0.235, 0.112],
    ['handR', 'foreR', -0.064, 0.13, 0.145],
    ['thighL', 'hips', 0.07, 0.38, -0.175],
    ['shinL', 'thighL', 0.072, 0.28, -0.115],
    ['hockL', 'shinL', 0.064, 0.17, -0.225],
    ['thighR', 'hips', -0.07, 0.38, -0.175],
    ['shinR', 'thighR', -0.072, 0.28, -0.115],
    ['hockR', 'shinR', -0.064, 0.17, -0.225],
]);

export const LAMB_MARKS = Object.freeze({
    nose: Object.freeze([0, 0.455, 0.47]),
    tailTip: Object.freeze([0, 0.265, -0.338]),
    eye: Object.freeze([0.044, 0.52, 0.39]),
    ear: Object.freeze([0.05, 0.55, 0.34]),
    pawFL: Object.freeze([0.064, 0, 0.155]),
    pawFR: Object.freeze([-0.064, 0, 0.155]),
    pawBL: Object.freeze([0.064, 0, -0.21]),
    pawBR: Object.freeze([-0.064, 0, -0.21]),
    udder: Object.freeze([0, 0.2, -0.13]),
});

/**
 * How much larger than life they are drawn. A ewe 250 m from the lens is about seven pixels long
 * at 1080p; drawn a shade large she reads as a sheep and not a fleck.
 */
export const SHEEP_SCALE = 1.15;

/** The lamb against the ewe, for the lengths in its gaits and acts (its legs are 0.62 of hers). */
export const LAMB_SIZE = 0.62;

// ── Their gaits ─────────────────────────────────────────────────────────────────

/**
 * Three gaits on one coordinate (0 walk, 1 trot, 2 gallop), every number between two of them
 * mixed by where the coordinate stands. Model metres at the ewe's size (a lamb's are scaled).
 *  falls   when in the stride each hoof lands (FOX_LEGS order: FL, FR, BL, BR). The walk's
 *          lateral sequence (left hind, left fore 0.22 on, then the right pair) becomes the
 *          trot's diagonals as both forelegs slide 0.28 later; the gallop's hind pair lands
 *          together, the fore pair a little before the half (transverse, left lead)
 *  duty    the share of the stride each hoof is on the grass
 *  lift    how high each hoof is carried through its swing
 *  flick   how far the cannon folds back as it swings (the knee flexed, the hoof turned up)
 *  peel    how far the heel has come up as the hoof leaves the grass
 *  under   where each hoof's stance is centred, ahead (+) of where it stands
 *  low     how much lower the body rides than it stands
 *  bob     how far it dips on each footfall (twice a stride)
 *  sway, nod   the trunk's roll over the planted side, the head's nod with each step
 *  arch    the back gathered (+) and stretched through the gallop's stride
 *  leap    how far the body rises through the gallop's float
 */
export const SHEEP_GAITS = Object.freeze([
    Object.freeze({
        falls: Object.freeze([0.22, 0.72, 0, 0.5]),
        duty: 0.62,
        lift: Object.freeze([0.075, 0.075, 0.06, 0.06]),
        flick: Object.freeze([1.25, 1.25, 0.55, 0.55]),
        peel: Object.freeze([0.45, 0.45, 0.5, 0.5]),
        under: Object.freeze([-0.01, -0.01, 0.02, 0.02]),
        low: 0.012,
        bob: 0.007,
        sway: 0.028,
        nod: 0.07,
        arch: 0,
        leap: 0,
    }),
    Object.freeze({
        falls: Object.freeze([0.5, 1.0, 0, 0.5]),
        duty: 0.42,
        lift: Object.freeze([0.1, 0.1, 0.085, 0.085]),
        flick: Object.freeze([1.55, 1.55, 0.9, 0.9]),
        peel: Object.freeze([0.55, 0.55, 0.6, 0.6]),
        under: Object.freeze([0.0, 0.0, 0.02, 0.02]),
        low: 0.02,
        bob: 0.016,
        sway: 0.012,
        nod: 0.035,
        arch: 0,
        leap: 0,
    }),
    Object.freeze({
        falls: Object.freeze([0.47, 0.58, 0.0, 0.08]),
        duty: 0.3,
        lift: Object.freeze([0.13, 0.13, 0.11, 0.11]),
        flick: Object.freeze([1.7, 1.7, 1.15, 1.15]),
        peel: Object.freeze([0.6, 0.6, 0.7, 0.7]),
        under: Object.freeze([0.04, 0.04, 0.05, 0.05]),
        low: 0.03,
        bob: 0,
        sway: 0.01,
        nod: 0.05,
        arch: 0.26,
        leap: 0.035,
    }),
]);

/** Where walk turns to trot and trot to gallop (m/s at the ewe's size; Froude-scaled for a lamb). */
export const SHEEP_GAIT_SPEEDS = Object.freeze({
    trotFrom: 1.25, trotTo: 1.7, gallopFrom: 2.9, gallopTo: 3.7,
});

/** Metres a stride carries a ewe (size 1) or a lamb at a speed (m/s, model metres). */
export function sheepStride(speed, size = 1) {
    const felt = Math.max(0, speed) / Math.sqrt(size);
    return (0.42 + 0.36 * felt) * size;
}

/** Where a speed puts the gait coordinate (0 walk .. 1 trot .. 2 gallop). */
export function sheepGaitAt(speed, size = 1) {
    const felt = Math.max(0, speed) / Math.sqrt(size);
    const s = SHEEP_GAIT_SPEEDS;
    return smooth(s.trotFrom, s.trotTo, felt) + smooth(s.gallopFrom, s.gallopTo, felt);
}

/** How long a leg is from its top joint to the ground (model metres at the ewe's size). */
const LEG_REACH = 0.6;
const { FL, FR, BL } = FOOT;
const DX = FOOT.dx;
const DY = FOOT.dy;
const DZ = FOOT.dz;
const TOE = FOOT.toe;
const AIR = FOOT.air;
const STEP = FOOT.size;

/** The gait table at a coordinate, mixed (scratch, filled in place). */
const MIXED = {
    falls: [0, 0, 0, 0],
    lift: [0, 0, 0, 0],
    flick: [0, 0, 0, 0],
    peel: [0, 0, 0, 0],
    under: [0, 0, 0, 0],
    duty: 0,
    low: 0,
    bob: 0,
    sway: 0,
    nod: 0,
    arch: 0,
    leap: 0,
};
const SCALARS = ['duty', 'low', 'bob', 'sway', 'nod', 'arch', 'leap'];
const ROWS = ['falls', 'lift', 'flick', 'peel', 'under'];

/** Fill MIXED with the gait table at coordinate `g` (0..2). */
export function sheepGaitTable(g, out = MIXED) {
    const c = Math.max(0, Math.min(2, g));
    const i = Math.min(1, Math.floor(c));
    const t = c - i;
    const a = SHEEP_GAITS[i];
    const b = SHEEP_GAITS[i + 1];
    for (const key of SCALARS) out[key] = mixNumber(a[key], b[key], t);
    for (const key of ROWS) for (let k = 0; k < 4; k++) out[key][k] = mixNumber(a[key][k], b[key][k], t);
    return out;
}

/**
 * Lay a gait over a spec.
 * @param {Float64Array} spec
 * @param {number} phase   strides gone (the flock advances it by distance / stride)
 * @param {number} speed   m/s, model metres (world speed / scale)
 * @param {number} amount  how much of its stride it takes (0 standing .. 1)
 * @param {number} gait    the gait coordinate (0 walk .. 2 gallop; the flock eases it)
 * @param {number} [size]  1 for the ewe, LAMB_SIZE for the lamb
 * @param {number} [step]  how much it lifts its feet even so (0..1: stepping round on the spot)
 */
export function laySheepGait(spec, phase, speed, amount, gait, size = 1, step = 0, crouch = null) {
    const lifts = Math.max(amount, step);
    if (!(lifts > 0)) return spec;
    const G = sheepGaitTable(gait);
    const stride = sheepStride(speed, size);
    const stance = G.duty * stride * amount;
    const fast = clamp01(gait / 2);
    for (let i = 0; i < 4; i++) {
        const f = SPEC.feet + i * STEP;
        const at = frac(phase - G.falls[i]);
        spec[f + DZ] += G.under[i] * size * amount;
        if (at < G.duty) {
            const along = at / G.duty;
            const off = stance * (0.5 - along);
            spec[f + DZ] += off;
            // The cannon leans with the leg over the planted hoof (its top toward the shoulder or the
            // hip), and the heel comes up as the hoof is left behind: it rolls off its toe.
            spec[f + TOE] += -off / (LEG_REACH * size) + G.peel[i] * smooth(0.6, 1, along) * lifts;
        } else {
            const along = (at - G.duty) / (1 - G.duty);
            const ease = along * along * (3 - 2 * along);
            spec[f + DZ] += stance * (ease - 0.5);
            spec[f + DY] += G.lift[i] * size * lifts * Math.sin(Math.PI * along) ** 0.75;
            // Swinging through, the knee (or the hock) folds and the hoof is turned up behind;
            // it straightens to reach out and land flat.
            const fold = Math.sin(Math.PI * Math.min(1, along * 1.3)) * (1 - smooth(0.72, 1, along));
            spec[f + TOE] += (G.peel[i] * (1 - smooth(0, 0.3, along)) + G.flick[i] * fold) * lifts;
        }
    }
    // The body rides lower the longer its stride (as far as its forelegs need to reach both ends of
    // their stance), and dips on every footfall (twice a stride).
    let low = G.low * size;
    if (crouch) {
        const half = stance / 2 + 0.01 * size;
        low = Math.max(low, crouch.rest - Math.sqrt(Math.max(1e-6, crouch.chain * crouch.chain - half * half)));
    }
    const dip = Math.cos(2 * TAU * (phase - G.duty * 0.5));
    spec[SPEC.rear] += (low * 0.8 + G.bob * size * dip) * amount;
    spec[SPEC.fore] += (low + G.bob * 0.8 * size * dip) * amount;
    // Weight rolls over the planted side; the head nods with each step of the forelegs.
    const fore = Math.sin(TAU * (phase - G.falls[0]) - 1.2);
    spec[SPEC.roll] += -G.sway * fore * amount;
    spec[SPEC.sway] += 0.006 * size * fore * amount * (1 - fast);
    spec[SPEC.headPitch] += G.nod * Math.cos(2 * TAU * (phase - G.falls[0] - 0.1)) * amount;
    spec[SPEC.headYaw] += 0.05 * Math.sin(TAU * (phase - G.falls[0]) - 0.5) * amount * (1 - fast);
    // The gallop: the hind pair lands at 0 and drives; the back stretches out through the float
    // and gathers again as the forefeet come down.
    const gallop = clamp01(gait - 1) * amount;
    if (gallop > 0) {
        spec[SPEC.arch] += G.arch * gallop * Math.cos(TAU * (phase - 0.82));
        spec[SPEC.pitch] += 0.09 * gallop * Math.sin(TAU * (phase - 0.3));
        const float = -Math.cos(2 * TAU * (phase - 0.33));
        spec[SPEC.rear] -= G.leap * size * gallop * float;
        spec[SPEC.fore] -= G.leap * size * gallop * float;
        spec[SPEC.headPitch] += 0.06 * gallop * Math.sin(TAU * (phase - 0.25));
        spec[SPEC.tailLift] += 0.5 * gallop;
    }
    return spec;
}

// ── What they do ────────────────────────────────────────────────────────────────

/** Seconds into `Lie` by which it lies (the flock holds it there until it gets up). */
export const SHEEP_LIE_HOLD = 2.6;

/**
 * Seconds each thing it does takes. `Stand`, `Walk`, `Graze`, `Chew`, `Stare`, `Suckle` and
 * `Nurse` loop as long as the flock likes; `Lie` holds at SHEEP_LIE_HOLD.
 */
export const SHEEP_ACTS = Object.freeze({
    Stand: 1,
    Walk: 1,
    Graze: 6,
    Chew: 4,
    Stare: 4,
    Stamp: 1.6,
    Lie: 3.4,
    Rise: 2.2,
    Stretch: 2.6,
    Shake: 1.5,
    Scratch: 2.8,
    Nurse: 6,
    Suckle: 6,
    Pronk: 1.3,
    Twist: 1.15,
    Butt: 1.6,
});

/** The acts that loop (their time runs on; the rest play once). */
export const SHEEP_LOOPS = Object.freeze(new Set(['Stand', 'Walk', 'Graze', 'Chew', 'Stare', 'Nurse', 'Suckle']));

/** When a pronk or a twist leaves the grass and comes down again (seconds into it). */
export const SHEEP_LEAPS = Object.freeze({ Pronk: Object.freeze([0.3, 0.86]), Twist: Object.freeze([0.26, 0.82]) });

/**
 * How high the leap carries the body (model metres at the lamb's size) `t` seconds into a pronk or
 * a twist: a parabola between leaving and landing, 0 elsewhere. The flock lifts the whole lamb by it.
 */
export function sheepLeapHeight(name, t, size = LAMB_SIZE) {
    const span = SHEEP_LEAPS[name];
    if (!span) return 0;
    const u = (t - span[0]) / (span[1] - span[0]);
    if (u <= 0 || u >= 1) return 0;
    const peak = name === 'Pronk' ? 0.62 : 0.52;
    return 4 * peak * size * u * (1 - u);
}

/**
 * The lying pose, as far folded as `front` and `back` say (0 standing .. 1 down): the front on
 * its knees, each cannon folded flat back under the forearm; the hindquarters down with the hind
 * cannons laid forward along the belly. Every hoof stays on the grass (each foreleg may be folded
 * on its own: `left`, `right`).
 */
function lying(s, front, back, k, left = front, right = front) {
    s[SPEC.fore] = (0.25 * front + 0.07 * back) * k;
    s[SPEC.rear] = (0.03 * front + 0.33 * back) * k;
    s[SPEC.shift] = (0.035 * front * (1 - back) - 0.01 * back) * k;
    s[SPEC.arch] = 0.06 * back;
    s[SPEC.tailLift] = -0.25 * back;
    [[FL, left], [FR, right]].forEach(([f, on]) => {
        s[f + DY] = 0.02 * k * on;
        s[f + DZ] = -0.13 * k * on;
        s[f + TOE] = 1.5 * on;
    });
    [[BL, 1], [BL + STEP, -1]].forEach(([f, side]) => {
        s[f + DY] = 0.03 * k * back;
        s[f + DZ] = 0.2 * k * back;
        s[f + DX] = 0.06 * side * k * back;
        s[f + TOE] = -1.45 * back;
    });
}

/**
 * What each act looks like `t` seconds in: (spec, t, k), k the size (1 a ewe, LAMB_SIZE a lamb).
 * A head at rest is carried with the face sloping (the bones' own rest); `headPitch` turns it from
 * there, `reach` lowers and stretches the neck.
 */
const ACTS = {
    /** Standing square, the head carried easy. */
    Stand(s) {
        s[SPEC.headPitch] = -0.05;
    },
    /** Under way: the head carried a little low and forward. */
    Walk(s) {
        s[SPEC.headPitch] = -0.12;
        s[SPEC.reach] = 0.12;
    },
    /**
     * Grazing: the neck down and out, the muzzle in the sward, the face near upright. It crops: the
     * head works a little from side to side, each bite a tug back and up; now and then a forefoot is
     * put forward to reach on.
     */
    Graze(s, t, k) {
        const down = smooth(0, 0.9, t);
        const bite = Math.max(0, Math.sin(TAU * 1.35 * t)) ** 3;
        const sweep = Math.sin(TAU * 0.23 * t + 0.4) * 0.18 + Math.sin(TAU * 0.61 * t) * 0.05;
        // (A lamb's short neck stretches further, and its head goes nearer upright.)
        const young = 1 - k;
        s[SPEC.reach] = (1.15 + 0.4 * young) * down;
        s[SPEC.headPitch] = (-1.05 - 0.13 * young + 0.07 * bite) * down;
        s[SPEC.headYaw] = sweep * down;
        s[SPEC.headRoll] = -0.25 * sweep * down;
        s[SPEC.fore] = (0.045 + 0.03 * young) * k * down;
        s[SPEC.shift] = 0.012 * k * down;
        s[SPEC.arch] = -0.04 * down;
        s[FL + DZ] = 0.05 * k * down;
        s[BL + DZ] = -0.015 * k * down;
        s[SPEC.tailLift] = -0.1;
    },
    /** Head up, chewing what it cropped: the jaw's work rocks the head a little. */
    Chew(s, t) {
        const up = smooth(0, 0.6, t);
        s[SPEC.headPitch] = (0.06 + 0.018 * Math.sin(TAU * 1.6 * t)) * up;
        s[SPEC.reach] = -0.05 * up;
        s[SPEC.headRoll] = 0.02 * Math.sin(TAU * 0.8 * t) * up;
    },
    /** It has seen something: head high and still, the whole sheep turned toward it. */
    Stare(s, t) {
        const up = smooth(0, 0.45, t);
        s[SPEC.headPitch] = 0.32 * up;
        s[SPEC.reach] = -0.32 * up;
        s[SPEC.fore] = -0.012 * up;
        s[SPEC.shift] = -0.012 * up;
        s[SPEC.tailLift] = 0.15 * up;
    },
    /** A forefoot stamped twice at what it does not like, head high. */
    Stamp(s, t, k) {
        ACTS.Stare(s, t + 0.45);
        const lift = hold(t, 0.15, 0.32, 0.38, 0.46) + hold(t, 0.72, 0.88, 0.94, 1.02);
        s[FL + DY] = 0.07 * k * lift;
        s[FL + DZ] = 0.02 * k * lift;
        s[FL + TOE] = 0.9 * lift;
        s[SPEC.fore] += 0.008 * k * lift;
    },
    /**
     * Going down: it drops onto its front knees first (each cannon folded flat back under its
     * forearm), then its hindquarters fold down beside it, the hind feet tucked forward along the
     * belly; it lies on its brisket with its head up, chewing the cud. (A flock holds it at
     * SHEEP_LIE_HOLD.)
     */
    Lie(s, t, k) {
        const front = smooth(0.1, 1.0, t);
        const back = smooth(0.85, 2.0, t);
        lying(s, front, back, k);
        const settle = smooth(1.8, SHEEP_LIE_HOLD, t);
        s[SPEC.roll] += 0.06 * settle;
        // On its knees it reaches its head down; settled, it lifts it.
        s[SPEC.headPitch] = -0.25 * front * (1 - back) + 0.12 * settle;
        s[SPEC.reach] = 0.35 * front * (1 - back) - 0.05 * settle;
    },
    /** Getting up, hind end first (as a sheep does), then one foreleg out and the front up. */
    Rise(s, t, k) {
        const back = 1 - smooth(0.1, 0.85, t);
        const left = 1 - smooth(0.8, 1.45, t);
        const right = 1 - smooth(1.05, 1.9, t);
        lying(s, Math.max(left, right), back, k, left, right);
        s[SPEC.roll] += 0.06 * back;
        s[SPEC.headPitch] = 0.12 * back - 0.2 * (1 - back) * right;
        s[SPEC.reach] = 0.3 * (1 - back) * right;
    },
    /** Up again, it stretches: forelegs out, chest down and rump high, then a hind leg back. */
    Stretch(s, t, k) {
        const bow = hold(t, 0.05, 0.55, 1.0, 1.4);
        const leg = hold(t, 1.2, 1.6, 2.0, 2.45);
        s[SPEC.fore] = 0.07 * k * bow;
        s[SPEC.rear] = -0.012 * k * bow;
        s[SPEC.shift] = -0.04 * k * bow;
        s[SPEC.arch] = -0.22 * bow + 0.1 * leg;
        s[SPEC.headPitch] = 0.2 * bow - 0.1 * leg;
        s[SPEC.reach] = 0.15 * bow;
        s[FL + DZ] = 0.07 * k * bow;
        s[FR + DZ] = 0.07 * k * bow;
        s[BL + DZ] = -0.13 * k * leg;
        s[BL + DY] = 0.05 * k * leg;
        s[BL + TOE] = 0.5 * leg;
        s[BL + AIR] = 0.3 * leg;
    },
    /** It shakes its fleece: a roll that runs from its head back down to its tail. */
    Shake(s, t, k) {
        const on = hold(t, 0, 0.12, 1.05, 1.45);
        const w = TAU * 4.6 * t;
        s[SPEC.headRoll] = 0.45 * Math.sin(w) * on;
        s[SPEC.headPitch] = 0.05 * on;
        s[SPEC.twist] = 0.4 * Math.sin(w - 0.8) * on;
        s[SPEC.roll] = 0.07 * Math.sin(w - 0.5) * on;
        s[SPEC.tailYaw] = 0.6 * Math.sin(w - 2.0) * on;
        s[SPEC.rear] = 0.012 * k * on;
        s[SPEC.fore] = 0.012 * k * on;
    },
    /** A hind hoof up to scratch behind its ear, its head bent round to meet it. */
    Scratch(s, t, k) {
        const up = hold(t, 0.1, 0.5, 2.2, 2.7);
        const rub = Math.sin(TAU * 5.2 * t) * hold(t, 0.5, 0.6, 2.1, 2.2);
        s[SPEC.headYaw] = 0.75 * up;
        s[SPEC.headPitch] = -0.3 * up;
        s[SPEC.headRoll] = 0.3 * up;
        s[SPEC.bend] = 0.35 * up;
        s[SPEC.reach] = 0.25 * up;
        s[SPEC.roll] = -0.05 * up;
        s[SPEC.sway] = -0.012 * k * up;
        s[BL + AIR] = up;
        s[BL + DY] = (0.3 + 0.025 * rub) * k * up;
        s[BL + DZ] = (0.42 + 0.02 * rub) * k * up;
        s[BL + DX] = 0.06 * k * up;
        s[BL + TOE] = 0.6 * up;
    },
    /** The ewe stands for her lamb, her head turned round to it to know it by its smell. */
    Nurse(s, t) {
        const round = smooth(0.3, 1.4, t) * (0.75 + 0.25 * Math.sin(TAU * 0.13 * t));
        s[SPEC.headYaw] = 1.15 * round;
        s[SPEC.headPitch] = -0.32 * round;
        s[SPEC.bend] = 0.28 * round;
        s[SPEC.reach] = 0.2 * round;
        s[SPEC.yaw] = 0.05 * round;
    },
    /**
     * The lamb at the udder: crouched a little in front, its head turned up under her, butting it
     * now and then, its tail going like a flag.
     */
    Suckle(s, t, k) {
        const on = smooth(0, 0.5, t);
        const butt = Math.max(0, Math.sin(TAU * 0.7 * t)) ** 6;
        s[SPEC.fore] = 0.05 * k * on;
        s[SPEC.rear] = 0.015 * k * on;
        s[SPEC.shift] = 0.02 * k * on;
        s[SPEC.headPitch] = (0.5 + 0.12 * butt) * on;
        s[SPEC.reach] = (0.45 + 0.1 * butt) * on;
        s[SPEC.headRoll] = 0.25 * on;
        s[SPEC.tailYaw] = 0.9 * Math.sin(TAU * 6.5 * t) * on;
        s[SPEC.tailLift] = 0.5 * on;
        s[FL + DZ] = 0.04 * k * on;
        s[FR + DZ] = 0.04 * k * on;
        s[BL + DZ] = -0.03 * k * on;
        s[BL + DZ + STEP] = -0.03 * k * on;
    },
    /**
     * The lamb's spring: it crouches, goes straight up off all four feet with its legs stiff and
     * its back bowed, and comes down on all four together. (The flock lifts it by sheepLeapHeight.)
     */
    Pronk(s, t, k) {
        const [off, on] = SHEEP_LEAPS.Pronk;
        const crouch = hold(t, 0, 0.18, 0.24, off + 0.04) + hold(t, on - 0.04, on + 0.06, on + 0.12, on + 0.34);
        const air = hold(t, off - 0.02, off + 0.05, on - 0.06, on + 0.01);
        s[SPEC.rear] = 0.06 * k * crouch;
        s[SPEC.fore] = 0.05 * k * crouch;
        s[SPEC.arch] = 0.12 * crouch + 0.32 * air;
        s[SPEC.headPitch] = -0.1 * crouch + 0.2 * air;
        s[SPEC.reach] = -0.1 * air;
        s[SPEC.tailLift] = 0.6 * air;
        for (let f = FL; f <= FOOT.BR; f += STEP) {
            // In the air its legs hang straight under it, a little gathered.
            s[f + AIR] = air;
            s[f + DY] = 0.02 * k * air;
            s[f + DZ] = (f < BL ? -0.02 : 0.03) * k * air;
            s[f + TOE] = 0.25 * air;
        }
    },
    /** The frisk: up off the grass with a twist of the body, the hind legs kicked out to one side. */
    Twist(s, t, k) {
        const [off, on] = SHEEP_LEAPS.Twist;
        const crouch = hold(t, 0, 0.16, 0.2, off + 0.04) + hold(t, on - 0.04, on + 0.05, on + 0.1, on + 0.3);
        const air = hold(t, off - 0.02, off + 0.05, on - 0.06, on + 0.01);
        const kick = hold(t, off + 0.08, off + 0.22, on - 0.2, on - 0.06);
        s[SPEC.rear] = 0.05 * k * crouch;
        s[SPEC.fore] = 0.05 * k * crouch;
        s[SPEC.bend] = 0.45 * kick;
        s[SPEC.twist] = 0.55 * kick;
        s[SPEC.roll] = -0.25 * kick;
        s[SPEC.pitch] = 0.15 * kick;
        s[SPEC.arch] = 0.15 * air;
        s[SPEC.headPitch] = 0.25 * air;
        s[SPEC.headYaw] = -0.35 * kick;
        s[SPEC.tailLift] = 0.7 * air;
        s[SPEC.tailYaw] = -0.6 * kick;
        for (let f = FL; f <= FOOT.BR; f += STEP) {
            s[f + AIR] = air;
            s[f + TOE] = (f < BL ? 0.9 : 0.4) * air;
            s[f + DY] = (f < BL ? 0.07 : 0.03) * k * air;
            s[f + DZ] = (f < BL ? -0.03 : -0.1 * kick) * k * air;
            s[f + DX] = f >= BL ? 0.08 * k * kick : 0;
        }
    },
    /** A lamb's butt at another: head down, a bound forward, heads meeting. */
    Butt(s, t, k) {
        const down = hold(t, 0.05, 0.35, 1.2, 1.55);
        const lunge = hold(t, 0.4, 0.6, 0.72, 1.05);
        s[SPEC.headPitch] = -0.55 * down;
        s[SPEC.reach] = 0.35 * down;
        s[SPEC.fore] = 0.04 * k * down;
        s[SPEC.rear] = -0.02 * k * lunge;
        s[SPEC.shift] = 0.06 * k * lunge;
        s[SPEC.arch] = -0.08 * down;
        s[SPEC.tailLift] = 0.3 * down;
        s[BL + DZ] = -0.05 * k * lunge;
        s[BL + DZ + STEP] = -0.05 * k * lunge;
        s[BL + TOE] = 0.6 * lunge;
        s[BL + TOE + STEP] = 0.6 * lunge;
    },
};

/** Fill a spec with what an act looks like `t` seconds in (unknown names: it stands). */
export function sheepAct(spec, name, t, size = 1) {
    spec.fill(0);
    (ACTS[name] || ACTS.Stand)(spec, Math.max(0, t), size);
    return spec;
}

/** The acts that carry it with its gait (the rest it does where it stands). */
const MOVING = Object.freeze(new Set(['Walk']));

/**
 * Make a sheep's body: the solver on its skeleton, with its gaits and its acts.
 * @param {object} o
 * @param {Array} o.bones
 * @param {object} o.marks
 * @param {number} [o.size=1]    its legs against the ewe's (LAMB_SIZE for the lamb)
 * @param {number} [o.scale=SHEEP_SCALE]  world metres to a model metre
 */
export function createSheepRig({
    bones, marks, size = 1, scale = SHEEP_SCALE,
}) {
    const body = createFoxRig({
        bones,
        marks,
        scale,
        // (The common acts' lengths are written for an arctic fox; ours are our own.)
        size: size * 2,
        headSteady: 0.7,
    });
    const SPEC_A = createFoxSpec();
    const SPEC_B = createFoxSpec();
    const SPEC_C = createFoxSpec();
    // How high its shoulder stands over its forefoot, and the length of the foreleg laid straight.
    const joint = Object.fromEntries(bones.map((b) => [b[0], [b[2], b[3], b[4]]]));
    const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const crouch = Object.freeze({
        rest: joint.armL[1] - marks.pawFL[1],
        chain: (gap(joint.armL, joint.foreL) + gap(joint.foreL, joint.handL) + gap(joint.handL, marks.pawFL)) * 0.995,
    });

    /**
     * What it is doing and what it was doing, cross-faded (no gait, nothing laid over): the part of
     * a pose a flock keeps as `fromSpec` when it changes its mind half-way through a change, so the
     * next change starts from the pose it was in at that instant.
     */
    const posture = (p, out = createFoxSpec()) => {
        const blend = clamp01(p.blend ?? 1);
        const mix = blend * blend * (3 - 2 * blend);
        const act = p.act ?? p.clip ?? 'Stand';
        sheepAct(SPEC_A, act, p.actTime ?? p.clipTime ?? 0, size);
        if (mix < 1) {
            if (p.fromSpec) SPEC_B.set(p.fromSpec);
            else sheepAct(SPEC_B, p.from ?? 'Stand', p.fromTime ?? 0, size);
            for (let i = 0; i < SPEC_SIZE; i++) out[i] = SPEC_B[i] + (SPEC_A[i] - SPEC_B[i]) * mix;
        } else {
            out.set(SPEC_A);
        }
        return out;
    };

    /**
     * The spec of a pose the flock resolved: what it does and what it was doing, cross-faded (from
     * an act by name, or from `fromSpec`); its gait under that; something laid over the rest
     * (`over`); and over it all where it looks, its tail and its breath, and the ground under each
     * hoof.
     * @param {object} p  { act, actTime, from, fromTime, fromSpec, blend, phase, speed, amp, gait,
     *                      step, over, overTime, overBlend, lookYaw, lookPitch, lean, tailWag,
     *                      breath, feet }
     *                    (speed in world m/s; `amp` the share of its stride it takes, from the
     *                    act when not given: `Walk` strides, the rest stand; `feet` the ground
     *                    under each hoof, model metres up)
     * @param {Float64Array} [spec]
     */
    const spec = (p, out = createFoxSpec()) => {
        posture(p, out);
        let moving;
        if (p.amp !== undefined && p.amp !== null) moving = clamp01(p.amp);
        else {
            const blend = clamp01(p.blend ?? 1);
            const mix = blend * blend * (3 - 2 * blend);
            moving = (MOVING.has(p.act ?? p.clip) ? mix : 0)
                + (mix < 1 && !p.fromSpec && MOVING.has(p.from) ? 1 - mix : 0);
        }
        const speed = (p.speed ?? 0) / scale;
        laySheepGait(out, p.phase ?? 0, speed, moving, p.gait ?? sheepGaitAt(speed, size), size, p.step ?? 0, crouch);
        const over = clamp01(p.overBlend ?? 0);
        if (p.over && over > 0) {
            sheepAct(SPEC_C, p.over, p.overTime ?? 0, size);
            const k = over * over * (3 - 2 * over);
            for (let i = 0; i < SPEC_SIZE; i++) out[i] += (SPEC_C[i] - out[i]) * k;
        }
        out[SPEC.headYaw] += p.lookYaw ?? 0;
        out[SPEC.headPitch] += p.lookPitch ?? 0;
        out[SPEC.roll] -= p.lean ?? 0;
        out[SPEC.tailYaw] += p.tailWag ?? 0;
        const breath = p.breath ?? 0;
        out[SPEC.arch] += 0.008 * breath;
        out[SPEC.fore] -= 0.003 * size * breath;
        // The ground: each hoof stands at its own height, and the trunk follows the slope part way
        // (its legs take the rest), so it stands level-backed across a hill and pitched up one.
        const { feet } = p;
        if (feet) {
            for (let i = 0; i < 4; i++) {
                const f = SPEC.feet + i * STEP;
                // (A hoof carried by the body in the air is not on the ground at all.)
                out[f + DY] += feet[i] * (1 - clamp01(out[f + AIR]));
            }
            // Across a slope it leans its body down the hill (+ roll drops its right side) and settles
            // a little lower between its legs, so the downhill pair reach the grass too.
            out[SPEC.fore] -= 0.7 * (feet[0] + feet[1]) * 0.5 - 0.45 * Math.abs(feet[0] - feet[1]);
            out[SPEC.rear] -= 0.7 * (feet[2] + feet[3]) * 0.5 - 0.45 * Math.abs(feet[2] - feet[3]);
            const across = (feet[0] + feet[2]) - (feet[1] + feet[3]);
            out[SPEC.roll] += 0.6 * Math.atan2(across, 4 * Math.abs(marks.pawFL[0]) + 1e-6);
        }
        return out;
    };

    return Object.freeze({
        bones,
        index: body.index,
        marks,
        scale,
        size,
        lengths: SHEEP_ACTS,
        createSpec: createFoxSpec,
        createPosture: body.createPosture,
        act: (out, name, t) => sheepAct(out, name, t, size),
        stride: (speed) => sheepStride(speed / scale, size) * scale,
        gallop: (speed) => clamp01(sheepGaitAt(speed / scale, size) - 1),
        duty: (speed) => sheepGaitTable(sheepGaitAt(speed / scale, size)).duty,
        footfalls: (speed, out = [0, 0, 0, 0]) => {
            const G = sheepGaitTable(sheepGaitAt(speed / scale, size));
            for (let i = 0; i < 4; i++) out[i] = G.falls[i];
            return out;
        },
        gait: (out, phase, speed, amount) => {
            const model = speed / scale;
            return laySheepGait(out, phase, model, amount, sheepGaitAt(model, size), size);
        },
        posture,
        spec,
        solve: body.solve,
        point: body.point,
    });
}

/** The ewe's body and the lamb's. */
export const EWE_RIG = createSheepRig({ bones: EWE_BONES, marks: EWE_MARKS, size: 1 });
export const LAMB_RIG = createSheepRig({ bones: LAMB_BONES, marks: LAMB_MARKS, size: LAMB_SIZE });

export {
    FOX_LEGS as SHEEP_LEGS, FOOT, SPEC, SPEC_SIZE, createFoxSpec as createSheepSpec,
};
