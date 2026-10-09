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

import { FOX_SCALE } from './winter-core.js';
import {
    FOX_LEGS, FOOT, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxRig, createFoxSpec, qBetween, qMul, qRotate,
    qSlerp, qTurn,
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
    ['tail1', 'hips', 0.012, 0.3, -0.18],
    ['tail2', 'tail1', 0.02, 0.2, -0.28],
    ['tail3', 'tail2', 0.025, 0.145, -0.37],
    ['tail4', 'tail3', 0.03, 0.15, -0.445],
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
    nose: Object.freeze([0, 0.455, 0.565]),
    tailTip: Object.freeze([0.03, 0.19, -0.515]),
    /** Its left eye (the right is its mirror), where the rigging script paints it. */
    eye: Object.freeze([0.064, 0.497, 0.44]),
    /** Where each paw meets the snow. */
    pawFL: Object.freeze([0.077, 0, 0.225]),
    pawFR: Object.freeze([-0.077, 0, 0.225]),
    pawBL: Object.freeze([0.087, 0, -0.085]),
    pawBR: Object.freeze([-0.087, 0, -0.085]),
});

/**
 * The rig: this skeleton, drawn FOX_SCALE larger than life. The shared rig's lengths are
 * written for this very animal (size 1); its forelegs all but straight when it stands, it
 * reaches a long step by crouching (shoulder 0.235 over wrist, a foreleg 0.2355 long).
 */
export const FOX_RIG = createFoxRig({
    bones: FOX_BONES,
    marks: FOX_MARKS,
    scale: FOX_SCALE,
    gait: { crouch: { rest: 0.235, chain: 0.2355, margin: 0.01 } },
});

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
    FOX_LEGS, FOOT, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxSpec, qBetween, qMul, qRotate, qSlerp, qTurn,
};
