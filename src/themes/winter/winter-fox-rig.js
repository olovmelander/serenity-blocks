/**
 * Winter — the arctic fox's body: its skeleton, and the fox rig made for it.
 * Three-free and renderer-free, like the mind (winter-fox-mind.js): the model (winter-fox.js)
 * only copies the rotations this solves onto its bones, the rigging script
 * (scripts/winter/rig-fox.mjs) builds the asset's skin from the same table, and the CPU preview
 * (scripts/fox/preview-fox.mjs) draws the same poses without a GPU.
 *
 * How a fox's skeleton carries a pose — feet placed on the snow and legs solved to reach them,
 * a gait of footfalls that opens from a trot into a gallop, a back that bends, everything it
 * does at a stop written as numbers that blend — is the rig the themes share
 * (../shared/fox-rig.js). This file is what is the arctic fox's own: where its bones are, and
 * its paces.
 */

import { FOX_SCALE, clamp01, smooth } from './winter-core.js';
import {
    FOX_LEGS, FOOT, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxPace, createFoxRig, createFoxSpec, qBetween, qMul,
    qRotate, qSlerp, qTurn,
} from '../shared/fox-rig.js';

/**
 * Every bone at rest: [name, parent, x, y, z] in model metres (+z ahead, +y up, +x its left).
 * All of them are axis-aligned at rest, so a bone's rotation in the model's frame IS its pose.
 */
export const FOX_BONES = Object.freeze([
    ['hips', null, 0, 0.33, -0.12],
    ['spine', 'hips', 0, 0.335, 0],
    ['chest', 'spine', 0, 0.34, 0.12],
    ['neck', 'chest', 0, 0.42, 0.22],
    ['head', 'neck', 0, 0.5, 0.33],
    ['tail1', 'hips', 0, 0.3, -0.18],
    ['tail2', 'tail1', 0, 0.2, -0.28],
    ['tail3', 'tail2', 0, 0.145, -0.37],
    ['tail4', 'tail3', 0, 0.15, -0.445],
    ['armL', 'chest', 0.085, 0.29, 0.205],
    ['foreL', 'armL', 0.077, 0.165, 0.19],
    ['handL', 'foreL', 0.077, 0.055, 0.195],
    ['armR', 'chest', -0.085, 0.29, 0.205],
    ['foreR', 'armR', -0.077, 0.165, 0.19],
    ['handR', 'foreR', -0.077, 0.055, 0.195],
    ['thighL', 'hips', 0.08, 0.3, -0.1],
    ['shinL', 'thighL', 0.085, 0.175, -0.045],
    ['hockL', 'shinL', 0.087, 0.095, -0.115],
    ['thighR', 'hips', -0.08, 0.3, -0.1],
    ['shinR', 'thighR', -0.085, 0.175, -0.045],
    ['hockR', 'shinR', -0.087, 0.095, -0.115],
]);

/** Points on the animal that are not joints (model metres, at rest). */
export const FOX_MARKS = Object.freeze({
    nose: Object.freeze([0, 0.452, 0.535]),
    tailTip: Object.freeze([0, 0.19, -0.515]),
    /** Its left eye (the right is its mirror), where the rigging script paints it. */
    eye: Object.freeze([0.058, 0.492, 0.462]),
    /** Where each paw meets the snow. */
    pawFL: Object.freeze([0.077, 0, 0.225]),
    pawFR: Object.freeze([-0.077, 0, 0.225]),
    pawBL: Object.freeze([0.087, 0, -0.085]),
    pawBR: Object.freeze([-0.087, 0, -0.085]),
});

// ── What the arctic fox does that other foxes do not ────────────────────────────

const TAU = Math.PI * 2;
/** Up over an edge, held, and down again over another. */
const hold = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
/** An angle as the turn it is: the same whole turns on, in −π..π. */
const wrapped = (a) => a - TAU * Math.round(a / TAU);

const {
    FL, FR, BL, BR,
} = FOOT;
const DX = FOOT.dx;
const DY = FOOT.dy;
const DZ = FOOT.dz;
const TOE = FOOT.toe;
const AIR = FOOT.air;
const STEP = FOOT.size;

/** Its mousing leap: when it leaves the snow and when its forepaws and nose go into it (seconds into the act). */
export const MOUSE_AIR = Object.freeze([0.56, 1.36]);
/** Its leap with a turn in it: off the snow, and down again. */
export const TWIRL_AIR = Object.freeze([0.3, 0.98]);
/** Its three bounces on stiff legs: off and down, each. */
export const PRONK_AIRS = Object.freeze([
    Object.freeze([0.24, 0.62]), Object.freeze([0.78, 1.22]), Object.freeze([1.38, 1.76]),
]);
/** When, on its back in the snow, it wriggles (the snow flies): from and to, and how often a second. */
export const BATH_WRIGGLE = Object.freeze([1.35, 3.55, 1.7]);
/** How far round it goes after its own tail (turns), and how far it turns to each step of a paw (radians). */
const CHASE_TURNS = 2;
const CHASE_STEP = TAU / 4;
const CHASE_DOWN = 0.5;
/** How long it spins (seconds into the act, from and to), and how much of that it takes to get up to speed. */
const CHASE_SPIN = Object.freeze([0.3, 3.7]);
const CHASE_RAMP = 0.2;

/** Seconds each of its own acts takes. */
const WINTER_LENGTHS = Object.freeze({
    HeadTilt: 2.6,
    MouseLeap: 2.5,
    PlayBow: 1.7,
    Pronk: 2.2,
    Scratch: 4.2,
    SkyGaze: 2.8,
    SnowBath: 5.6,
    Sphinx: 7.6,
    StandTall: 3.4,
    TailChase: 4,
    Twirl: 1.5,
});

/**
 * Put a paw where a turn of `angle` about the middle of its back would carry it over the snow
 * from where it stands (`rest`), `high` off it.
 */
function pawRound(s, f, rest, angle, high) {
    const c = Math.cos(angle);
    const n = Math.sin(angle);
    s[f + DX] = rest[0] * c + rest[2] * n - rest[0];
    s[f + DZ] = rest[2] * c - rest[0] * n - rest[2];
    s[f + DY] = high;
}

const PAWS = [FOX_MARKS.pawFL, FOX_MARKS.pawFR, FOX_MARKS.pawBL, FOX_MARKS.pawBR];

/**
 * Its own acts: (spec, seconds into it, size), as the shared ones are written. Those that go to
 * a side are written for its left and mirrored by the rig (WINTER_MIRRORED).
 */
const WINTER_ACTS = Object.freeze({
    /** It lies down like a sphinx, forepaws out before it, head up, and watches something go by. */
    Sphinx(s, t, k) {
        const down = hold(t, 0.1, 1.25, 6.35, 7.45);
        const up = hold(t, 1.2, 2.0, 5.6, 6.3);
        const look = 0.55 * Math.sin(t * 0.9 + 0.4) + 0.2 * Math.sin(t * 2.3 + 1.1);
        s[SPEC.rear] = 0.205 * k * down;
        s[SPEC.fore] = 0.165 * k * down;
        s[SPEC.shift] = -0.02 * k * down;
        s[SPEC.arch] = 0.12 * down;
        s[SPEC.headPitch] = 0.12 * down + (0.16 + 0.12 * Math.sin(t * 0.7 + 1)) * up;
        s[SPEC.headYaw] = look * up;
        s[SPEC.headRoll] = -0.12 * look * up;
        s[SPEC.reach] = -0.12 * down;
        s[SPEC.tailCurl] = 1.7 * down;
        s[SPEC.tailLift] = 0.62 * down;
        s[SPEC.tailFree] = down;
        // Forepaws out ahead, wrists laid down; hind paws folded under, hocks on the snow.
        s[FL + DZ] = 0.085 * k * down;
        s[FR + DZ] = 0.085 * k * down;
        s[FL + TOE] = -0.75 * down;
        s[FR + TOE] = -0.75 * down;
        s[BL + DZ] = 0.075 * k * down;
        s[BR + DZ] = 0.075 * k * down;
        s[BL + TOE] = -1.3 * down;
        s[BR + TOE] = -1.3 * down;
        s[BL + DX] = 0.03 * k * down;
        s[BR + DX] = -0.03 * k * down;
    },
    /** It sits and scratches behind its left ear with its left hind paw. */
    Scratch(s, t, k) {
        const down = hold(t, 0.1, 0.9, 3.45, 4.1);
        const up = hold(t, 0.8, 1.4, 2.9, 3.45);
        const w = TAU * 6.2 * t;
        // It sits, curls round to its left and brings its head down to where the paw can reach it.
        s[SPEC.rear] = 0.17 * k * down;
        s[SPEC.fore] = (0.046 + 0.059 * up) * k * down;
        s[SPEC.shift] = -0.035 * k * down;
        s[SPEC.arch] = (0.4 + 0.35 * up) * down;
        s[SPEC.bend] = 0.9 * up;
        s[SPEC.roll] = 0.16 * up;
        s[SPEC.headYaw] = 0.8 * up;
        s[SPEC.headPitch] = 0.05 * down - 0.47 * up;
        s[SPEC.headRoll] = (-0.75 + 0.06 * Math.sin(w)) * up;
        s[SPEC.reach] = 0.48 * up;
        s[SPEC.tailCurl] = -1.5 * down;
        s[SPEC.tailLift] = 0.85 * down;
        s[SPEC.tailFree] = down;
        s[FL + DZ] = -0.09 * k * down;
        s[FR + DZ] = -0.09 * k * down;
        s[BR + DZ] = 0.05 * k * down;
        s[BR + TOE] = -1.2 * down;
        s[BR + DX] = -0.02 * k * down;
        // The paw that scratches: knee out, up behind its ear, going like a drumstick.
        // (It goes up ahead of its hip and out to the side only once it is high: a leg that
        // pointed straight out sideways on its way would not know which way to fold.)
        const ahead = smooth(0, 0.55, up);
        const aside = smooth(0.5, 1, up);
        s[BL + DZ] = (0.05 + 0.082 * ahead + 0.07 * Math.sin(Math.PI * up) + 0.024 * Math.cos(w) * aside) * k * down;
        s[BL + DY] = (0.318 * up + 0.026 * Math.sin(w) * aside) * k;
        s[BL + DX] = (0.02 + 0.17 * aside) * k * down;
        s[BL + TOE] = (-1.2 + 0.6 * up) * down;
        s[BL + AIR] = smooth(0, 0.4, up);
    },
    /** It goes down on a shoulder, rolls onto its back in the snow, wriggles, and rolls up again. */
    SnowBath(s, t, k) {
        const down = hold(t, 0.05, 0.8, 4.55, 5.45);
        const over = hold(t, 0.4, 1.3, 3.65, 4.55);
        const [from, to, rate] = BATH_WRIGGLE;
        const wriggle = hold(t, from - 0.1, from + 0.3, to - 0.25, to + 0.1);
        const w = TAU * rate * t;
        const roll = 2.3 * over + 0.34 * Math.sin(w) * wriggle;
        const shoulder = hold(t, 0.05, 0.45, 0.7, 1.1);
        s[SPEC.rear] = 0.2 * k * down - 0.05 * k * shoulder;
        s[SPEC.fore] = (0.2 - 0.025 * over) * k * down;
        s[SPEC.roll] = roll;
        s[SPEC.arch] = 0.12 * over - 0.1 * Math.sin(w * 2 + 0.6) * wriggle;
        s[SPEC.bend] = 0.34 * Math.sin(w + 1.3) * wriggle;
        s[SPEC.twist] = 0.3 * Math.sin(w + 2.4) * wriggle;
        s[SPEC.shift] = 0.012 * k * Math.sin(w * 2) * wriggle;
        // (Its head goes over with it: held level, its neck would be wrung.)
        s[SPEC.headRoll] = 0.62 * roll + 0.25 * Math.sin(w + 0.7) * wriggle;
        s[SPEC.headYaw] = 0.3 * shoulder + 0.4 * Math.sin(w + 0.3) * wriggle;
        s[SPEC.headPitch] = -0.45 * shoulder + 0.1 * over;
        // (On its back its neck curls its head up off the snow, toward its own paws.)
        s[SPEC.reach] = 0.4 * shoulder + 0.5 * over;
        // (Its tail lies on the snow behind it whichever way up it is.)
        s[SPEC.tailFree] = down;
        s[SPEC.tailLift] = 0.8 * down + 0.2 * Math.sin(w * 2) * wriggle;
        s[SPEC.tailYaw] = 0.6 * Math.sin(w + 3) * wriggle;
        // Lying on its belly its paws are drawn up under it; over on its back its legs wave in the air.
        const air = hold(t, 0.15, 0.6, 4.65, 5.25);
        const tucked = 0.185 * down * (1 - over) + 0.07 * over;
        for (let f = FL, i = 0; f <= BR; f += STEP, i++) {
            const kick = Math.sin(w * 1.5 + i * 1.9) * wriggle;
            s[f + AIR] = air;
            s[f + DY] = (tucked + 0.03 * kick) * k * air;
            s[f + DZ] = ((f < BL ? -0.02 : 0.05) + 0.04 * Math.cos(w * 1.5 + i * 1.9) * wriggle) * k * air;
            s[f + TOE] = 0.5 * air + 0.3 * kick;
        }
    },
    /** A play bow: chest down, rump high, tail going, a feint to each side — and it is ready to run. */
    PlayBow(s, t, k) {
        const bow = hold(t, 0.05, 0.32, 1.32, 1.6);
        const feint = Math.sin(TAU * 1.9 * (t - 0.45)) * hold(t, 0.45, 0.6, 1.2, 1.38);
        const spring = hold(t, 1.3, 1.5, 1.6, 1.7);
        s[SPEC.fore] = ((0.125 + 0.012 * Math.abs(feint)) * bow + 0.028 * spring) * k;
        s[SPEC.rear] = (-0.014 * bow + 0.05 * spring) * k;
        s[SPEC.shift] = (-0.04 * bow - 0.01 * spring) * k;
        s[SPEC.sway] = 0.022 * k * feint;
        s[SPEC.yaw] = 0.16 * feint;
        s[SPEC.arch] = -0.24 * bow;
        s[SPEC.headPitch] = 0.46 * bow;
        s[SPEC.headYaw] = -0.2 * feint;
        s[SPEC.headRoll] = 0.12 * feint;
        s[SPEC.tailLift] = 1.1 * bow + 0.3 * spring;
        s[SPEC.tailYaw] = 0.65 * Math.sin(TAU * 5 * t) * Math.max(bow, spring);
        s[FL + DZ] = 0.055 * k * bow;
        s[FR + DZ] = 0.055 * k * bow;
        s[FL + DX] = (0.022 + 0.018 * feint) * k * bow;
        s[FR + DX] = (-0.022 + 0.018 * feint) * k * bow;
        // (The forepaw on the side it feints to pats the snow.)
        s[FL + DY] = 0.03 * k * Math.max(0, feint) * (1 - Math.abs(feint)) * 2;
        s[FR + DY] = 0.03 * k * Math.max(0, -feint) * (1 - Math.abs(feint)) * 2;
    },
    /**
     * The mousing leap: it gathers, goes straight up, jack-knifes at the top and comes down nose
     * and forepaws first, its hind legs in the air behind it; then it backs out and shakes the
     * snow off its face.
     */
    MouseLeap(s, t, k) {
        const [off, into] = MOUSE_AIR;
        const coil = hold(t, 0, 0.36, 0.5, 0.64);
        const fly = hold(t, off - 0.06, off + 0.06, into - 0.04, into + 0.08);
        const through = clamp01((t - off) / (into - off));
        const dive = smooth(0.34, 0.9, through);
        // Nose up as it goes up, nose down from the top of its leap until it has backed out.
        const rise = hold(t, off - 0.06, off + 0.08, off + 0.24, off + 0.54);
        const nose = hold(t, off + 0.3, into - 0.02, 1.6, 2.1);
        const stuck = hold(t, into - 0.06, into + 0.05, 1.6, 2.0);
        const settle = hold(t, into + 0.2, into + 0.5, 1.95, 2.3);
        const out = hold(t, 1.9, 2.1, 2.3, 2.5);
        s[SPEC.rear] = (0.09 * coil - 0.02 * stuck + 0.06 * settle) * k;
        s[SPEC.fore] = (0.035 * coil + 0.01 * stuck + 0.035 * settle) * k;
        s[SPEC.shift] = (-0.05 * coil + 0.03 * stuck) * k;
        s[SPEC.arch] = 0.32 * coil + fly * (0.5 * Math.sin(Math.PI * through) - 0.1) - 0.1 * stuck;
        s[SPEC.pitch] = -0.8 * rise + 0.98 * nose;
        s[SPEC.headPitch] = -0.3 * coil + 0.3 * rise - 0.75 * nose;
        s[SPEC.headRoll] = 0.4 * Math.sin(TAU * 5.5 * t) * out;
        s[SPEC.reach] = 0.22 * coil + 0.4 * nose;
        s[SPEC.tailLift] = 0.3 * coil + 0.9 * Math.max(fly, nose);
        s[SPEC.tailYaw] = 0.3 * Math.sin(TAU * 3 * t) * stuck;
        // Its forepaws are tucked to its chest as it rises and reached out along its nose as it
        // comes down; they stay in the snow with its nose until it backs out. Its hind legs
        // trail in the air behind it, and come down after.
        const foreUp = hold(t, off - 0.06, off + 0.06, 1.72, 2.1);
        const hindUp = hold(t, off - 0.06, off + 0.06, into + 0.24, into + 0.6);
        const reached = dive * (1 - smooth(1.62, 2.05, t));
        for (let f = FL; f <= FR; f += STEP) {
            s[f + AIR] = foreUp;
            s[f + DY] = (0.09 * fly + 0.2 * reached) * k;
            s[f + DZ] = (-0.02 * fly + 0.19 * reached) * k;
            s[f + TOE] = 0.7 * fly * (1 - dive);
        }
        for (let f = BL; f <= BR; f += STEP) {
            s[f + AIR] = hindUp;
            s[f + DY] = 0.03 * k * hindUp;
            s[f + DZ] = -0.07 * k * hindUp;
            s[f + TOE] = 0.9 * hindUp + 0.6 * nose * (1 - hindUp);
        }
    },
    /** Nothing there. It looks at the place, head on one side, then on the other. */
    HeadTilt(s, t, k) {
        const on = hold(t, 0, 0.3, 2.25, 2.55);
        const tilt = smooth(0.25, 0.5, t) - 2 * smooth(1.15, 1.42, t) + smooth(2.1, 2.4, t);
        const pat = hold(t, 1.6, 1.75, 1.85, 2.05);
        s[SPEC.headPitch] = -0.34 * on;
        s[SPEC.reach] = 0.2 * on;
        s[SPEC.headRoll] = 0.52 * tilt * on;
        s[SPEC.headYaw] = -0.12 * tilt * on;
        s[SPEC.fore] = 0.012 * k * on;
        s[SPEC.tailLift] = 0.2 * on;
        s[SPEC.tailYaw] = 0.25 * Math.sin(t * 2.6) * on;
        s[FL + DY] = 0.045 * k * pat;
        s[FL + DZ] = 0.035 * k * pat;
        s[FL + TOE] = 0.7 * pat;
    },
    /**
     * It goes round after its own tail, to its left, twice: its back curled, its head turned to
     * its tail, its paws stepping it round in diagonal pairs. Each paw stays where it is put down
     * until it is lifted.
     */
    TailChase(s, t, k) {
        const on = hold(t, 0.1, 0.5, 3.45, 3.9);
        // How far round it has gone: up to speed, round at a steady rate, and down from it.
        const through = clamp01((t - CHASE_SPIN[0]) / (CHASE_SPIN[1] - CHASE_SPIN[0]));
        const steady = 1 / (1 - CHASE_RAMP);
        let eased = (through - CHASE_RAMP / 2) * steady;
        if (through < CHASE_RAMP) eased = (steady * through * through) / (2 * CHASE_RAMP);
        else if (through > 1 - CHASE_RAMP) eased = 1 - (steady * (1 - through) * (1 - through)) / (2 * CHASE_RAMP);
        const turned = CHASE_TURNS * TAU * eased;
        s[SPEC.yaw] = wrapped(turned);
        s[SPEC.bend] = 0.8 * on;
        s[SPEC.roll] = -0.1 * on;
        s[SPEC.rear] = 0.045 * k * on;
        s[SPEC.fore] = 0.05 * k * on;
        s[SPEC.headYaw] = 0.75 * on;
        s[SPEC.headPitch] = -0.22 * on;
        s[SPEC.headRoll] = 0.15 * on;
        s[SPEC.tailCurl] = 0.9 * on;
        s[SPEC.tailYaw] = (0.5 + 0.3 * Math.sin(TAU * 2.6 * t)) * on;
        s[SPEC.tailLift] = 0.55 * on;
        for (let i = 0; i < 4; i++) {
            const f = SPEC.feet + i * STEP;
            // (Diagonal pairs: one pair is half a step on from the other.)
            const u = turned / CHASE_STEP + CHASE_DOWN / 2 + (i === 0 || i === 3 ? 0 : 0.5);
            const into = u - Math.floor(u);
            let ahead;
            let high = 0;
            if (into < CHASE_DOWN) ahead = CHASE_DOWN / 2 - into;
            else {
                const swing = (into - CHASE_DOWN) / (1 - CHASE_DOWN);
                ahead = (swing * swing * (3 - 2 * swing) - 0.5) * CHASE_DOWN;
                high = 0.04 * k * Math.sin(Math.PI * swing) * on;
                s[f + TOE] = 0.5 * Math.sin(Math.PI * swing) * on;
            }
            pawRound(s, f, PAWS[i], turned + ahead * CHASE_STEP, high);
        }
    },
    /** It stands up on its hind legs to see further, forepaws at its chest, and looks about. */
    StandTall(s, t, k) {
        const up = hold(t, 0.15, 0.8, 2.55, 3.2);
        const look = smooth(0.9, 1.3, t) - 2 * smooth(1.55, 2.0, t) + smooth(2.3, 2.6, t);
        s[SPEC.fore] = -0.205 * k * up;
        s[SPEC.rear] = 0.085 * k * up;
        s[SPEC.shift] = -0.06 * k * up;
        s[SPEC.arch] = 0.3 * up;
        s[SPEC.sway] = 0.006 * k * Math.sin(t * 3.1) * up;
        s[SPEC.headPitch] = 0.1 * up;
        s[SPEC.headYaw] = 0.55 * look * up;
        s[SPEC.reach] = 0.25 * up;
        s[SPEC.tailFree] = up;
        s[SPEC.tailLift] = 0.25 * up;
        s[SPEC.tailYaw] = -0.2 * look * up;
        for (let f = FL; f <= FR; f += STEP) {
            s[f + AIR] = up;
            s[f + DY] = 0.12 * k * up;
            s[f + DZ] = -0.07 * k * up;
            s[f + TOE] = 0.9 * up;
        }
        s[BL + TOE] = -0.45 * up;
        s[BR + TOE] = -0.45 * up;
        s[BL + DX] = 0.015 * k * up;
        s[BR + DX] = -0.015 * k * up;
    },
    /** A leap with a whole turn in it, to its left: it gathers, springs, turns once in the air and lands. */
    Twirl(s, t, k) {
        const [off, down] = TWIRL_AIR;
        const coil = hold(t, 0, 0.2, off - 0.04, off + 0.08);
        const fly = hold(t, off - 0.05, off + 0.05, down - 0.05, down + 0.05);
        const land = hold(t, down - 0.04, down + 0.08, 1.15, 1.45);
        const through = clamp01((t - off) / (down - off));
        s[SPEC.yaw] = wrapped(TAU * smooth(0.04, 0.96, through));
        s[SPEC.rear] = (0.08 * coil + 0.07 * land - 0.02 * fly) * k;
        s[SPEC.fore] = (0.06 * coil + 0.06 * land - 0.02 * fly) * k;
        s[SPEC.arch] = 0.25 * coil + 0.3 * fly * Math.sin(Math.PI * through) + 0.15 * land;
        s[SPEC.bend] = 0.45 * fly * Math.sin(Math.PI * through);
        s[SPEC.pitch] = -0.2 * fly * Math.cos(Math.PI * through);
        s[SPEC.headYaw] = 0.5 * fly * Math.sin(Math.PI * through);
        s[SPEC.headPitch] = -0.15 * coil + 0.1 * fly;
        s[SPEC.tailLift] = 0.3 * coil + 0.7 * fly + 0.4 * land;
        s[SPEC.tailYaw] = -0.7 * fly * Math.sin(Math.PI * through);
        for (let f = FL; f <= BR; f += STEP) {
            s[f + AIR] = fly;
            s[f + DY] = (f < BL ? 0.07 : 0.05) * k * fly;
            s[f + DZ] = (f < BL ? -0.02 : 0.04) * k * fly;
            s[f + TOE] = 0.6 * fly;
        }
    },
    /** Three bounces on the spot on stiff legs, tail up: every paw leaves the snow at once. */
    Pronk(s, t, k) {
        let fly = 0;
        let squat = hold(t, 0, 0.14, 0.2, 0.32);
        PRONK_AIRS.forEach(([off, down]) => {
            fly += hold(t, off - 0.04, off + 0.05, down - 0.05, down + 0.04);
            squat += hold(t, down - 0.05, down + 0.05, down + 0.08, down + 0.2);
        });
        const on = hold(t, 0, 0.2, 1.85, 2.15);
        s[SPEC.rear] = (0.05 * squat - 0.012 * fly) * k;
        s[SPEC.fore] = (0.045 * squat - 0.012 * fly) * k;
        s[SPEC.arch] = 0.22 * fly - 0.05 * squat;
        s[SPEC.headPitch] = 0.2 * on + 0.12 * fly;
        s[SPEC.tailLift] = 0.7 * on + 0.3 * fly;
        s[SPEC.tailYaw] = 0.5 * Math.sin(TAU * 4 * t) * on;
        for (let f = FL; f <= BR; f += STEP) {
            s[f + AIR] = fly;
            s[f + DY] = 0.012 * k * fly;
            s[f + DZ] = (f < BL ? 0.015 : -0.015) * k * fly;
            s[f + TOE] = 0.35 * fly;
        }
    },
    /** It stops and lifts its head to the sky, and looks along it. */
    SkyGaze(s, t, k) {
        const on = hold(t, 0.05, 0.6, 2.2, 2.75);
        s[SPEC.rear] = 0.075 * k * on;
        s[SPEC.fore] = 0.022 * k * on;
        s[SPEC.shift] = -0.012 * k * on;
        s[SPEC.arch] = 0.14 * on;
        s[SPEC.headPitch] = 0.78 * on;
        s[SPEC.reach] = -0.3 * on;
        s[SPEC.headYaw] = 0.4 * Math.sin((t - 0.5) * 1.5) * on;
        s[SPEC.headRoll] = 0.1 * Math.sin((t - 0.5) * 1.5 + 1) * on;
        s[SPEC.tailLift] = 0.3 * on;
        s[SPEC.tailYaw] = 0.3 * Math.sin(t * 2.2) * on;
        s[BL + TOE] = -0.25 * on;
        s[BR + TOE] = -0.25 * on;
    },
});

/** Its acts that go to a side: written for its left, mirrored when its mind says its right. */
export const WINTER_MIRRORED = Object.freeze(['Scratch', 'SnowBath', 'TailChase', 'Twirl']);
/** The names of its own acts (the rest are every fox's: ../shared/fox-rig.js). */
export const WINTER_ACT_NAMES = Object.freeze(Object.keys(WINTER_ACTS));

/**
 * A rig of this skeleton drawn `scale` times life. The shared rig's lengths are written for this
 * very animal (size 1); its forelegs all but straight when it stands, it reaches a long step by
 * crouching (shoulder 0.235 over wrist, a foreleg 0.2355 long).
 */
export const arcticFoxRig = (scale) => createFoxRig({
    bones: FOX_BONES,
    marks: FOX_MARKS,
    scale,
    acts: WINTER_ACTS,
    lengths: WINTER_LENGTHS,
    mirrored: WINTER_MIRRORED,
    gait: { crouch: { rest: 0.235, chain: 0.2355, margin: 0.01 } },
});

/** The rig: the fox, drawn FOX_SCALE larger than life. */
export const FOX_RIG = arcticFoxRig(FOX_SCALE);
/**
 * The visitor's: the same animal a little smaller (a rig's paces go by how large it is drawn, so
 * a fox of another size has a rig of its own).
 */
export const VISITOR_RIG = arcticFoxRig(FOX_SCALE * 0.93);

/** Bone name → index into FOX_BONES. */
export const FOX_BONE_INDEX = FOX_RIG.index;
/** Seconds each thing it does takes (`Run` is its gait: no act, any length). */
export const FOX_ACTS = FOX_RIG.lengths;

/** Fill a spec with what an act looks like `t` seconds in (`Run` and unknown names: it stands). */
export const foxAct = FOX_RIG.act;
/** Metres one cycle of its gait carries it at a speed (m/s, world). */
export const foxStride = FOX_RIG.stride;
/** How much of a gallop its gait is at a speed (0 a trot .. 1 a gallop). */
export const foxGallop = FOX_RIG.gallop;
/** The share of a cycle each paw is on the snow at a speed. */
export const foxDuty = FOX_RIG.duty;
/** When in a cycle each paw lands (FOX_LEGS order). */
export const foxFootfalls = FOX_RIG.footfalls;
/** Lay its gait over a spec: (spec, phase, speed, amount, step, gallop). */
export const foxGait = FOX_RIG.gait;
/** The spec of a pose the mind resolved (winter-fox-mind.js). */
export const foxSpec = FOX_RIG.spec;
/** What solveFox() fills in: the root's place and every bone's rotation. */
export const createFoxPosture = FOX_RIG.createPosture;
/** Solve a spec: every bone's rotation, and where the root is. */
export const solveFox = FOX_RIG.solve;
/** Where a point of the animal is in a posture: `rest` is the point at rest, carried by `bone`. */
export const foxPoint = FOX_RIG.point;

export {
    FOX_LEGS, FOOT, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxPace, createFoxSpec, qBetween, qMul, qRotate,
    qSlerp, qTurn,
};
