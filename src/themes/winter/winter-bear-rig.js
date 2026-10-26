/**
 * Winter — the polar bear's body: its skeleton, its walk and what it does when it stops.
 * Three-free and renderer-free, like the fox's (winter-fox-rig.js): the model (winter-bear.js)
 * only copies the rotations this solves onto its bones, the modelling script
 * (scripts/winter/model-bear.mjs, with scripts/blender/winter_polar_bear.py) builds the asset's
 * mesh round these very joints and skins it to them, and the CPU preview
 * (scripts/fox/preview-fox.mjs --fox=bear) draws the same poses without a GPU.
 *
 * The solver is the quadruped one the foxes share (../shared/fox-rig.js): feet placed on the
 * ground and legs solved to reach them, a back of three bones that bends, a head held level, every
 * pose a "spec" of numbers so any two blend. A bear is not a fox, so what is the bear's own is
 * written here:
 *  - its walk. A bear walks, it does not trot: a four-beat walk of lateral footfalls (left hind,
 *    left fore, right hind, right fore), each paw on the ice for two thirds of the stride, the
 *    forepaw flicked back sole-up as it swings through, the hind foot peeled off heel first. The
 *    head is carried low, below the line of the back, and swings to the side of the planted
 *    forepaw; the shoulders roll and the hips sway under a long, slack back;
 *  - what it does at a stop: it lifts its nose to the wind and sniffs; it looks about; it stands
 *    up on its hind legs to see further; it lies down on the ice, head on its paws, and gets up.
 *
 * Model metres: +z ahead, +y up, +x its left, its paws on y = 0. A big male: 1.32 m at the
 * shoulder, 1.37 m over the rump, 2.6 m from nose to tail.
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

/**
 * Every bone at rest: [name, parent, x, y, z] in model metres. All of them axis-aligned at rest,
 * so a bone's rotation in the model's frame IS its pose. The legs are the joints a bear stands
 * on: shoulder, elbow and wrist; hip, knee and heel (it is plantigrade: the hind foot lies flat
 * from the heel to the toes).
 */
export const BEAR_BONES = Object.freeze([
    ['hips', null, 0, 1.0, -0.55],
    ['spine', 'hips', 0, 1.02, -0.05],
    ['chest', 'spine', 0, 1.0, 0.42],
    ['neck', 'chest', 0, 1.04, 0.7],
    ['head', 'neck', 0, 1.0, 1.1],
    ['tail1', 'hips', 0, 1.1, -0.95],
    ['tail2', 'tail1', 0, 1.06, -1.02],
    ['tail3', 'tail2', 0, 1.01, -1.07],
    ['armL', 'chest', 0.25, 0.98, 0.5],
    ['foreL', 'armL', 0.26, 0.62, 0.38],
    ['handL', 'foreL', 0.25, 0.13, 0.48],
    ['armR', 'chest', -0.25, 0.98, 0.5],
    ['foreR', 'armR', -0.26, 0.62, 0.38],
    ['handR', 'foreR', -0.25, 0.13, 0.48],
    ['thighL', 'hips', 0.25, 0.98, -0.62],
    ['shinL', 'thighL', 0.27, 0.56, -0.46],
    ['hockL', 'shinL', 0.26, 0.12, -0.67],
    ['thighR', 'hips', -0.25, 0.98, -0.62],
    ['shinR', 'thighR', -0.27, 0.56, -0.46],
    ['hockR', 'shinR', -0.26, 0.12, -0.67],
]);

/** Points on the animal that are not joints (model metres, at rest). */
export const BEAR_MARKS = Object.freeze({
    /** The tip of its black nose. */
    nose: Object.freeze([0, 0.93, 1.535]),
    tailTip: Object.freeze([0, 0.98, -1.12]),
    /** Its left eye (the right is its mirror) and its left ear. */
    eye: Object.freeze([0.074, 1.035, 1.33]),
    ear: Object.freeze([0.108, 1.165, 1.12]),
    /**
     * Where each paw meets the ice: under the ball of the foot, so a heel that lifts turns the
     * foot about its toes. A forepaw is a broad round pad turned a little in; a hind foot is long.
     */
    pawFL: Object.freeze([0.245, 0, 0.62]),
    pawFR: Object.freeze([-0.245, 0, 0.62]),
    pawBL: Object.freeze([0.255, 0, -0.47]),
    pawBR: Object.freeze([-0.255, 0, -0.47]),
});

/**
 * It is drawn this much larger than life (as the fox is, winter-core.js FOX_SCALE), so it reads as
 * the great animal it is from fifty metres and more, past the board's edge.
 */
export const BEAR_SCALE = 1.3;

/** The shared solver, made for this skeleton (its size: about three arctic foxes). */
const BODY = createFoxRig({
    bones: BEAR_BONES,
    marks: BEAR_MARKS,
    scale: BEAR_SCALE,
    size: 3,
    headSteady: 0.6,
});

/** Bone name → index into BEAR_BONES. */
export const BEAR_BONE_INDEX = BODY.index;

// ── Its walk ────────────────────────────────────────────────────────────────────

/**
 * The walk, in model metres. A big bear ambles at about a metre a second, some 0.8 strides a
 * second, each paw on the ice for two thirds of a stride.
 *  stride       metres a stride carries it: base + rate × speed (m/s)
 *  duty         the share of a stride each paw is on the ice
 *  falls        when in the stride each paw lands (FOX_LEGS order: FL, FR, BL, BR): left hind,
 *               left fore a fifth later, then the right pair half a stride on
 *  lift         how high each paw is carried through its swing
 *  under        where each paw's stance is centred, ahead (+) of where it stands: a forepaw's
 *               a little behind (its leg reaches further back than ahead)
 *  flick        how far a paw's heel is turned up through its swing (a forepaw shows its sole)
 *  peel         how far the heel has come up as the paw leaves the ice
 *  low          how much lower the body rides walking than standing
 */
export const BEAR_WALK = Object.freeze({
    strideBase: 0.62,
    strideRate: 0.62,
    duty: 0.68,
    falls: Object.freeze([0.2, 0.7, 0, 0.5]),
    lift: Object.freeze([0.12, 0.12, 0.06, 0.06]),
    under: Object.freeze([-0.07, -0.07, 0.02, 0.02]),
    flick: Object.freeze([1.5, 1.5, 0.25, 0.25]),
    peel: Object.freeze([0.75, 0.75, 0.6, 0.6]),
    low: 0.055,
});

/** Metres one stride carries it at a speed (m/s, world). */
export const bearStride = (speed) => (BEAR_WALK.strideBase + BEAR_WALK.strideRate * Math.max(0, speed)) * BEAR_SCALE;

const { FL, FR, BL } = FOOT;
const DX = FOOT.dx;
const DY = FOOT.dy;
const DZ = FOOT.dz;
const TOE = FOOT.toe;
const AIR = FOOT.air;
const STEP = FOOT.size;

/**
 * Lay its walk over a spec.
 * @param {Float64Array} spec
 * @param {number} phase   strides walked (the plan advances it by distance / stride)
 * @param {number} speed   m/s, world
 * @param {number} amount  how much of its stride it takes (0 standing .. 1)
 */
export function layWalk(spec, phase, speed, amount) {
    if (!(amount > 0)) return spec;
    const W = BEAR_WALK;
    const stride = bearStride(speed) / BEAR_SCALE;
    const stance = W.duty * stride * amount;
    for (let i = 0; i < 4; i++) {
        const f = SPEC.feet + i * STEP;
        const at = frac(phase - W.falls[i]);
        spec[f + DZ] += W.under[i] * amount;
        if (at < W.duty) {
            const along = at / W.duty;
            spec[f + DZ] += stance * (0.5 - along);
            // The heel comes up as the paw is left behind: the foot rolls off its toes.
            spec[f + TOE] += W.peel[i] * smooth(0.55, 1, along) * amount;
        } else {
            const along = (at - W.duty) / (1 - W.duty);
            const ease = along * along * (3 - 2 * along);
            spec[f + DZ] += stance * (ease - 0.5);
            spec[f + DY] += W.lift[i] * amount * Math.sin(Math.PI * along) ** 0.7;
            // Swinging through, the forepaw is flicked back sole-up and brought flat to land.
            const flick = Math.sin(Math.PI * Math.min(1, along * 1.35)) * (1 - smooth(0.7, 1, along));
            spec[f + TOE] += (W.peel[i] * (1 - smooth(0, 0.3, along)) + W.flick[i] * flick) * amount;
        }
    }
    // The body rides a little lower than it stands, and settles on each footfall.
    const settle = Math.cos(2 * TAU * (phase - 0.1));
    spec[SPEC.rear] += (W.low + 0.01 * settle) * amount;
    spec[SPEC.fore] += (W.low + 0.012 * Math.cos(2 * TAU * (phase - 0.3))) * amount;
    // Weight goes over the planted side: the shoulders roll over the planted forepaw (the left
    // is down from 0.2 to 0.88), the hips over the planted hind foot.
    const fore = Math.sin(TAU * (phase - 0.2) - 1.1);
    const hind = Math.sin(TAU * phase - 1.1);
    spec[SPEC.roll] += -0.03 * fore * amount;
    spec[SPEC.twist] += 0.05 * (hind - fore) * amount;
    spec[SPEC.sway] += 0.012 * fore * amount;
    // The long back flexes side to side, and the body surges a little at each footfall.
    spec[SPEC.bend] += 0.05 * Math.sin(TAU * (phase - 0.35)) * amount;
    spec[SPEC.shift] += 0.008 * Math.sin(2 * TAU * (phase - 0.15)) * amount;
    // The head swings low to the side of the planted forepaw and nods with each step.
    spec[SPEC.headYaw] += 0.12 * Math.sin(TAU * (phase - 0.2) - 0.6) * amount;
    spec[SPEC.headRoll] += -0.05 * Math.sin(TAU * (phase - 0.2) - 0.6) * amount;
    spec[SPEC.headPitch] += 0.035 * Math.cos(2 * TAU * (phase - 0.32)) * amount;
    spec[SPEC.tailYaw] += 0.15 * Math.sin(TAU * (phase - 0.1)) * amount;
    return spec;
}

// ── What it does at a stop ──────────────────────────────────────────────────────

/** Seconds into `Lie` by which it lies flat (a plan holds it there until it gets up). */
export const LIE_HOLD = 3.2;

/** Seconds each thing it does takes (`Walk` and `Stand` are any length; `Lie` holds at LIE_HOLD). */
export const BEAR_ACTS = Object.freeze({
    Stand: 1,
    Walk: 1,
    Sniff: 7.2,
    Scent: 5.4,
    Look: 5.6,
    Rear: 6.8,
    Lie: 4,
    Rise: 2.4,
});

/** What it looks like `t` seconds into each act (spec, t). */
const ACTS = {
    /** Standing square on the ice, its head a little low. */
    Stand(s) {
        s[SPEC.headPitch] = -0.1;
        s[SPEC.reach] = 0.08;
    },
    /** Under way: its head carried low and well out, below the line of its back. */
    Walk(s) {
        s[SPEC.headPitch] = -0.22;
        s[SPEC.reach] = 0.22;
        s[SPEC.arch] = -0.04;
    },
    /**
     * It lifts its nose high into the wind and sniffs: the neck stretched up, the nose working
     * in short bursts, the head turning slowly to find where the scent comes from.
     */
    Sniff(s, t) {
        const up = hold(t, 0.2, 1.3, 5.9, 7.1);
        const bursts = hold(t, 1.2, 1.5, 2.6, 2.9) + hold(t, 3.6, 3.9, 5.2, 5.5);
        s[SPEC.headPitch] = (0.62 + 0.05 * Math.sin(TAU * 3.2 * t) * bursts) * up - 0.1 * (1 - up);
        s[SPEC.reach] = -0.38 * up + 0.08 * (1 - up);
        s[SPEC.headYaw] = 0.32 * Math.sin(0.85 * (t - 1.2)) * smooth(1.0, 2.0, t) * up;
        s[SPEC.headRoll] = 0.06 * Math.sin(0.85 * (t - 1.2)) * up;
        // (Its chest comes up a little: its forelegs stand all but straight already.)
        s[SPEC.fore] = -0.02 * up;
        s[SPEC.shift] = -0.03 * up;
        s[SPEC.arch] = 0.05 * up;
    },
    /**
     * It puts its nose down to the ice and works along it, the way a bear smells for a seal's
     * breathing hole under the snow: head low and swinging, a pause, a few quick sniffs.
     */
    Scent(s, t) {
        const down = hold(t, 0.2, 1.1, 4.3, 5.2);
        const sniffs = hold(t, 2.2, 2.4, 3.2, 3.4);
        s[SPEC.headPitch] = (-0.72 + 0.05 * Math.sin(TAU * 3.4 * t) * sniffs) * down - 0.1 * (1 - down);
        s[SPEC.reach] = 0.6 * down + 0.08 * (1 - down);
        s[SPEC.headYaw] = 0.26 * Math.sin(1.7 * (t - 1.1)) * smooth(0.9, 1.6, t) * down;
        s[SPEC.fore] = 0.06 * down;
        s[SPEC.shift] = 0.03 * down;
        s[SPEC.arch] = -0.05 * down;
    },
    /** It looks about: one way, the other way, back. */
    Look(s, t) {
        const e = smooth(0.3, 1.1, t) - 2 * smooth(2.1, 3.1, t) + smooth(4.1, 4.9, t);
        s[SPEC.headYaw] = 0.95 * e;
        s[SPEC.headPitch] = 0.02 + 0.08 * Math.abs(e);
        s[SPEC.headRoll] = -0.08 * e;
        s[SPEC.reach] = 0.05;
        s[SPEC.yaw] = 0.06 * e;
        s[SPEC.bend] = 0.08 * e;
        s[SPEC.sway] = 0.015 * e;
    },
    /**
     * It stands up on its hind legs to see further: the forepaws come off the ice and hang in
     * front of its chest, its nose goes up, it holds there a moment, then drops back down.
     */
    Rear(s, t) {
        const up = hold(t, 0.35, 1.7, 4.6, 6.1);
        const off = hold(t, 0.55, 1.15, 5.2, 6.0);
        s[SPEC.fore] = -0.78 * up;
        s[SPEC.rear] = 0.16 * up;
        s[SPEC.shift] = -0.4 * up;
        // (A little forward of upright, over its feet; its head held up to the sky, not thrown back.)
        s[SPEC.pitch] = 0.08 * up;
        s[SPEC.arch] = 0.12 * up;
        s[SPEC.headPitch] = 0.16 * up + 0.04 * Math.sin(TAU * 2.6 * t) * hold(t, 2.2, 2.5, 3.6, 3.9);
        s[SPEC.reach] = -0.1 * up;
        s[SPEC.headYaw] = 0.22 * Math.sin(1.1 * (t - 1.8)) * hold(t, 1.7, 2.3, 4.2, 4.8);
        for (let f = FL; f <= FR; f += STEP) {
            s[f + AIR] = off;
            // (Carried by the chest: hanging in front of it, the wrists bent, the paws loose.)
            s[f + DY] = 0.62 * off;
            s[f + DZ] = -0.32 * off;
            s[f + TOE] = 1.2 * off;
        }
        for (let f = BL; f <= BL + STEP; f += STEP) {
            s[f + DZ] = -0.04 * up;
            s[f + TOE] = -0.15 * up;
        }
    },
    /**
     * It lies down on the ice: forepaws out ahead, hind legs drawn under it, its belly down, and
     * at last its head laid on its paws. (A plan holds it at LIE_HOLD.)
     */
    Lie(s, t) {
        const down = smooth(0.2, 2.4, t);
        const settle = smooth(2.0, LIE_HOLD, t);
        s[SPEC.rear] = 0.5 * smooth(0.2, 1.8, t);
        s[SPEC.fore] = 0.53 * smooth(0.6, 2.4, t);
        s[SPEC.shift] = -0.06 * down;
        s[SPEC.arch] = 0.06 * down;
        // (Its chin comes down onto its paws, not into the ice.)
        s[SPEC.headPitch] = -0.04 * down - 0.1 * settle;
        s[SPEC.reach] = 0.1 * down + 0.2 * settle;
        for (let f = FL; f <= FR; f += STEP) {
            s[f + DZ] = 0.36 * smooth(0.5, 2.2, t);
            s[f + TOE] = -0.25 * down;
            s[f + DX] = (f === FL ? -0.03 : 0.03) * down;
        }
        // The hind feet stay on the ice, drawn up beside the belly, knees out.
        for (let f = BL; f <= BL + STEP; f += STEP) {
            s[f + DZ] = 0.12 * down;
            s[f + TOE] = -0.3 * down;
            s[f + DX] = (f === BL ? 0.1 : -0.1) * down;
        }
    },
    /** It gets up off the ice: Lie run backwards, a shade quicker. */
    Rise(s, t) {
        ACTS.Lie(s, LIE_HOLD * (1 - smooth(0, BEAR_ACTS.Rise, t)));
    },
};

/** Fill a spec with what an act looks like `t` seconds in (unknown names: it stands). */
export function bearAct(spec, name, t) {
    spec.fill(0);
    (ACTS[name] || ACTS.Stand)(spec, Math.max(0, t));
    return spec;
}

const SPEC_A = createFoxSpec();
const SPEC_B = createFoxSpec();

/**
 * The spec of a pose the plan resolved: what it is doing and what it was doing, cross-faded; its
 * walk under that; and over it all where it looks and its breath.
 * @param {object} p  { act, actTime, from, fromTime, blend, phase, speed, amp, over, overTime,
 *                      overBlend, lookYaw, lookPitch, breath }
 * @param {Float64Array} [spec]
 */
export function bearSpec(p, spec = createFoxSpec()) {
    const blend = clamp01(p.blend ?? 1);
    const mix = blend * blend * (3 - 2 * blend);
    // (The fox tools name what it does `clip`.)
    const act = p.act ?? p.clip;
    bearAct(SPEC_A, act, p.actTime ?? p.clipTime ?? 0);
    let walking = act === 'Walk' ? mix : 0;
    if (mix < 1) {
        bearAct(SPEC_B, p.from ?? 'Stand', p.fromTime ?? 0);
        if (p.from === 'Walk') walking += 1 - mix;
        for (let i = 0; i < SPEC_SIZE; i++) spec[i] = SPEC_B[i] + (SPEC_A[i] - SPEC_B[i]) * mix;
    } else {
        spec.set(SPEC_A);
    }
    layWalk(spec, p.phase ?? 0, p.speed ?? 0, walking * (p.amp ?? 1));
    // Something it was made to do over whatever it was doing (it stands up at a four, it lies down
    // when the run ends): that act, laid over the rest by `overBlend`.
    const over = clamp01(p.overBlend ?? 0);
    if (p.over && over > 0) {
        bearAct(SPEC_B, p.over, p.overTime ?? 0);
        const k = over * over * (3 - 2 * over);
        for (let i = 0; i < SPEC_SIZE; i++) spec[i] += (SPEC_B[i] - spec[i]) * k;
    }
    spec[SPEC.headYaw] += p.lookYaw ?? 0;
    spec[SPEC.headPitch] += p.lookPitch ?? 0;
    // It breathes: slow and deep.
    const breath = p.breath ?? 0;
    spec[SPEC.arch] += 0.01 * breath;
    spec[SPEC.fore] -= 0.006 * breath;
    return spec;
}

/**
 * The rig: what the preview, the plan and the model ask of the bear's body. Shaped like the
 * foxes' (createFoxRig), so the fox tools draw it too.
 */
export const BEAR_RIG = Object.freeze({
    bones: BEAR_BONES,
    index: BODY.index,
    marks: BEAR_MARKS,
    scale: BEAR_SCALE,
    lengths: BEAR_ACTS,
    createSpec: createFoxSpec,
    createPosture: BODY.createPosture,
    act: bearAct,
    stride: bearStride,
    /** A bear walks: no gallop. */
    gallop: () => 0,
    duty: () => BEAR_WALK.duty,
    footfalls: (speed, out = [0, 0, 0, 0]) => {
        for (let i = 0; i < 4; i++) out[i] = BEAR_WALK.falls[i];
        return out;
    },
    gait: (spec, phase, speed, amount) => layWalk(spec, phase, speed, amount),
    spec: bearSpec,
    solve: BODY.solve,
    point: BODY.point,
});

/** Solve a spec: every bone's rotation, and where the root is. */
export const solveBear = BODY.solve;
/** What solveBear() fills in. */
export const createBearPosture = BODY.createPosture;
/** Where a point of the animal is in a posture: `rest` is the point at rest, carried by `bone`. */
export const bearPoint = BODY.point;

export {
    FOX_LEGS as BEAR_LEGS, FOOT, SPEC, SPEC_SIZE, createFoxSpec as createBearSpec,
};
