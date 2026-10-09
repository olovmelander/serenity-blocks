/**
 * Sakura Twilight — the red foxes' body: their skeleton, and the fox rig made for it.
 * Three-free and renderer-free: the model (sakura-foxes.js) only copies the rotations this
 * solves onto its bones, the rigging script (scripts/sakura/rig-fox.mjs) puts the asset's skin
 * on the same table, and the CPU preview draws the same poses without a GPU.
 *
 * How a fox's skeleton carries a pose is the rig the themes share (../shared/fox-rig.js). This
 * file is what is these foxes' own: where their bones are — the joints of the sample fox the
 * model began as, kept where its maker put them — and how a long-legged red fox does what the
 * short-legged arctic one the common acts were written for does.
 */

import {
    FOOT, FOX_COMMON_ACTS, SPEC, createFoxRig,
} from '../shared/fox-rig.js';

/**
 * Every bone at rest: [name, parent, x, y, z] in model metres (+z ahead, +y up, +x its left).
 * All of them are axis-aligned at rest, so a bone's rotation in the model's frame IS its pose.
 */
export const SAKURA_FOX_BONES = Object.freeze([
    ['hips', null, 0, 0.4294, -0.2675],
    ['spine', 'hips', 0, 0.5495, -0.2218],
    ['chest', 'spine', 0, 0.5375, -0.0056],
    ['neck', 'chest', 0, 0.5322, 0.2508],
    ['head', 'neck', 0, 0.6073, 0.3615],
    ['tail1', 'hips', 0, 0.5259, -0.4015],
    ['tail2', 'tail1', 0, 0.4346, -0.4856],
    ['tail3', 'tail2', 0, 0.2808, -0.673],
    ['armL', 'chest', 0.0697, 0.4907, 0.1802],
    ['foreL', 'armL', 0.0697, 0.2604, 0.1722],
    ['handL', 'foreL', 0.0697, 0.067, 0.1783],
    ['armR', 'chest', -0.0697, 0.4907, 0.1802],
    ['foreR', 'armR', -0.0697, 0.2604, 0.1722],
    ['handR', 'foreR', -0.0697, 0.067, 0.1783],
    ['thighL', 'hips', 0.0697, 0.4927, -0.2986],
    ['shinL', 'thighL', 0.0697, 0.3048, -0.2744],
    ['hockL', 'shinL', 0.0697, 0.1594, -0.3795],
    ['thighR', 'hips', -0.0697, 0.4927, -0.2986],
    ['shinR', 'thighR', -0.0697, 0.3048, -0.2744],
    ['hockR', 'shinR', -0.0697, 0.1594, -0.3795],
]);

/** Points on the animal that are not joints (model metres, at rest). */
export const SAKURA_FOX_MARKS = Object.freeze({
    nose: Object.freeze([0, 0.555, 0.655]),
    tailTip: Object.freeze([0, 0.21, -0.865]),
    /** Its left eye (the right is its mirror): painted by the material, there. */
    eye: Object.freeze([0.058, 0.624, 0.548]),
    /** Where each paw meets the ground. */
    pawFL: Object.freeze([0.0697, 0, 0.2]),
    pawFR: Object.freeze([-0.0697, 0, 0.2]),
    pawBL: Object.freeze([0.0697, 0, -0.325]),
    pawBR: Object.freeze([-0.0697, 0, -0.325]),
});

/** How much larger it is than the arctic fox the common acts were written for. */
export const SAKURA_FOX_SIZE = 1.6;

const {
    FL, FR, BL, BR,
} = FOOT;

/**
 * Its own way with some acts: its legs are far longer for its body than the arctic fox's, so
 * where that one only has to dip, this one has a long way down.
 */
const ACTS = {
    /** It sits: its hips go right down between its hind feet, its forelegs stay straight. */
    Sit(s, t, k) {
        FOX_COMMON_ACTS.Sit(s, t, k);
        const down = s[SPEC.tailFree];
        s[SPEC.rear] = 0.3 * down;
        s[SPEC.fore] = 0.02 * down;
        s[SPEC.shift] = -0.05 * down;
        s[SPEC.arch] = 0.5 * down;
        s[FL + FOOT.dz] = -0.2 * down;
        s[FR + FOOT.dz] = -0.2 * down;
        s[BL + FOOT.dz] = 0.12 * down;
        s[BR + FOOT.dz] = 0.12 * down;
        s[BL + FOOT.toe] = -1.25 * down;
        s[BR + FOOT.toe] = -1.25 * down;
    },
    /** It lies down and curls up: a long way down for those legs, and they fold right under it. */
    CurlSleep(s, t, k) {
        FOX_COMMON_ACTS.CurlSleep(s, t, k);
        const down = s[FL + FOOT.air];
        s[SPEC.rear] = 0.345 * down;
        s[SPEC.fore] = 0.33 * down;
        for (let f = FL; f <= BR; f += FOOT.size) s[f + FOOT.dy] = 0.31 * down;
    },
};

/**
 * A rig on this skeleton for a fox drawn `scale` times the model's size (the two foxes are not
 * the same size, and a paw only stays planted when the stride is the drawn animal's own).
 * `fore` lowers it at its shoulders: its chest joint sits in the middle of its back.
 */
export const createSakuraFoxRig = (scale = 1) => createFoxRig({
    bones: SAKURA_FOX_BONES,
    marks: SAKURA_FOX_MARKS,
    scale,
    size: SAKURA_FOX_SIZE,
    foreAt: 0.1802,
    acts: ACTS,
});

/** The rig at the model's own size (tools and tests). */
export const SAKURA_FOX_RIG = createSakuraFoxRig(1);
