/**
 * Winter — the polar bear's body: its skeleton, and how a pose is carried by it.
 * Three-free and renderer-free: the model (winter-bear.js) only copies the rotations this solves
 * onto its bones, the modelling scripts (scripts/blender/winter_polar_bear.py, run by
 * scripts/winter/model-bear.mjs) build the asset round these very joints and skin it to them, and
 * the CPU preview (scripts/winter/preview-bear.mjs) draws the same poses without a GPU.
 *
 * A bear is built for walking, and so is this skeleton:
 *  - a trunk of four bones (pelvis, two of spine, chest) that bends along the path it walks, rounds
 *    and hollows, and lets the shoulders roll against the hips;
 *  - a neck of two bones, so the long neck carries the small head low in a curve, not a kink;
 *  - shoulder blades that slide on the ribs: the scapula swings forward with the reaching foreleg
 *    and back as it pushes, so the shoulder joint travels and the hump of the shoulder rolls;
 *  - legs of shoulder (or hip), elbow (or knee), wrist (or heel) and the ball of the foot, then the
 *    toes: a paw is placed by the ball of the foot, the heel peels up about it while the toes stay
 *    flat on the ice, and swinging, the wrist curls so the forepaw hangs and shows its sole;
 *  - ears and a stub of a tail.
 *
 * A pose is a "spec": a handful of numbers for the trunk and the head, and six for each foot (where
 * the ball of the foot is from where it stands, how far its heel is up, how far the paw is curled,
 * how it is turned). Any two specs blend. What a spec does not say — where the shoulder blade has
 * gone, how the legs fold to reach the paws — the solver works out (two-bone inverse kinematics in
 * the plane each leg swings in).
 *
 * Model metres: +z ahead, +y up, +x its left, its paws on y = 0. A big male: 1.32 m at the
 * shoulder, 1.36 m over the rump, 2.5 m from nose to tail.
 */

import {
    qBetween, qMul, qRotate, qSlerp, qTurn,
} from '../shared/fox-rig.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
const hold = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
const TAU = Math.PI * 2;

/**
 * Every bone at rest: [name, parent, x, y, z] in model metres. All of them axis-aligned at rest, so
 * a bone's rotation in the model's frame IS its pose.
 */
const SIDE = (name, parent, x, y, z) => [[`${name}L`, parent && `${parent}L`, x, y, z], [`${name}R`, parent && `${parent}R`, -x, y, z]];
const ONE = (pair, parentL, parentR) => {
    // (A side's root hangs from a bone of the midline.)
    pair[0][1] = parentL;
    pair[1][1] = parentR;
    return pair;
};
export const BEAR_BONES = Object.freeze([
    ['pelvis', null, 0, 1.0, -0.5],
    ['spine1', 'pelvis', 0, 1.03, -0.16],
    ['spine2', 'spine1', 0, 1.04, 0.14],
    ['chest', 'spine2', 0, 1.02, 0.42],
    ['neck1', 'chest', 0, 1.05, 0.66],
    ['neck2', 'neck1', 0, 1.06, 0.87],
    ['head', 'neck2', 0, 1.05, 1.06],
    ...ONE(SIDE('ear', null, 0.118, 1.17, 1.1), 'head', 'head'),
    ['tail1', 'pelvis', 0, 1.1, -0.92],
    ['tail2', 'tail1', 0, 1.05, -1.0],
    ...ONE(SIDE('scap', null, 0.18, 1.1, 0.4), 'chest', 'chest'),
    ...SIDE('arm', 'scap', 0.25, 0.92, 0.52),
    ...SIDE('fore', 'arm', 0.2547, 0.58, 0.37),
    ...SIDE('hand', 'fore', 0.26, 0.15, 0.47),
    ...SIDE('fing', 'hand', 0.255, 0.055, 0.6),
    ...ONE(SIDE('thigh', null, 0.24, 0.97, -0.58), 'pelvis', 'pelvis'),
    ...SIDE('shin', 'thigh', 0.25, 0.55, -0.42),
    ...SIDE('foot', 'shin', 0.26, 0.13, -0.66),
    ...SIDE('toes', 'foot', 0.255, 0.045, -0.46),
].map((bone) => Object.freeze(bone)));

/** Points on the animal that are not joints (model metres, at rest). */
export const BEAR_MARKS = Object.freeze({
    /** The tip of its black nose. */
    nose: Object.freeze([0, 0.985, 1.5]),
    /** Its left eye (the right is its mirror). */
    eye: Object.freeze([0.088, 1.075, 1.31]),
    tailTip: Object.freeze([0, 0.99, -1.07]),
    /** Where each paw meets the ice: under the ball of the foot. */
    pawFL: Object.freeze([0.255, 0, 0.6]),
    pawFR: Object.freeze([-0.255, 0, 0.6]),
    pawBL: Object.freeze([0.255, 0, -0.46]),
    pawBR: Object.freeze([-0.255, 0, -0.46]),
    /** The tips of its toes, ahead of the ball. */
    tipFL: Object.freeze([0.25, 0.03, 0.75]),
    tipFR: Object.freeze([-0.25, 0.03, 0.75]),
    tipBL: Object.freeze([0.25, 0.03, -0.31]),
    tipBR: Object.freeze([-0.25, 0.03, -0.31]),
});

/**
 * It is drawn this much larger than life (as the fox is, winter-core.js FOX_SCALE), so it reads as
 * the great animal it is from fifty metres and more, past the board's edge.
 */
export const BEAR_SCALE = 1.3;

/** Bone name → index into BEAR_BONES. */
export const BEAR_BONE_INDEX = Object.freeze(Object.fromEntries(BEAR_BONES.map((bone, i) => [bone[0], i])));
const B = BEAR_BONE_INDEX;
const REST = BEAR_BONES.map((bone) => [bone[2], bone[3], bone[4]]);
const PARENT = BEAR_BONES.map((bone) => (bone[1] === null ? -1 : B[bone[1]]));

/**
 * Its four feet, in the order a spec lists them: name, the leg's bones from its root, the mark of
 * the ball of the foot, whether it is a foreleg, which side (+1 its left).
 */
export const BEAR_FEET = Object.freeze([
    Object.freeze({
        name: 'FL', front: true, side: 1, paw: 'pawFL', bones: Object.freeze(['scapL', 'armL', 'foreL', 'handL', 'fingL']),
    }),
    Object.freeze({
        name: 'FR', front: true, side: -1, paw: 'pawFR', bones: Object.freeze(['scapR', 'armR', 'foreR', 'handR', 'fingR']),
    }),
    Object.freeze({
        name: 'BL', front: false, side: 1, paw: 'pawBL', bones: Object.freeze(['thighL', 'shinL', 'footL', 'toesL']),
    }),
    Object.freeze({
        name: 'BR', front: false, side: -1, paw: 'pawBR', bones: Object.freeze(['thighR', 'shinR', 'footR', 'toesR']),
    }),
]);

// ── What a pose is ──────────────────────────────────────────────────────────────

/**
 * A spec's numbers, all zero when it stands square. Metres are model metres.
 *  drop, fore     how far its pelvis and its chest are lowered (the back pitches to suit)
 *  shift, sway    the body moved ahead / to its left over its feet
 *  pitch, roll, yaw   the whole trunk turned (+ nose down, + right side down, + nose left)
 *  arch           the back rounded (+) or hollowed (−)
 *  bend           the back curved to its left (+), as it walks a curve to the left
 *  twist          the shoulders rolled against the hips (+ right shoulder down)
 *  headYaw, headPitch, headRoll   where its head is turned (+ left, + up, + left ear up), from the
 *                 chest's facing but held part-way level against the trunk's pitch and roll
 *  reach          the neck lowered and stretched (+) or raised (−)
 *  earL, earR     each ear laid back (+) or pricked (−)
 *  tailYaw, tailLift
 * and for each foot (BEAR_FEET order): dx, dy, dz where the ball of its foot is from where it
 * stands; pitch, its heel up about the ball (+); curl, the wrist or ankle flexed as it swings (+),
 * the toes with it; yaw, the foot turned (+ toes to its left); ground, the whole paw tipped to the
 * slope it stands on (+ toes down); air, how far it is off its weight (0 bearing it .. 1 lifted).
 */
export const SPEC = Object.freeze({
    drop: 0,
    fore: 1,
    shift: 2,
    sway: 3,
    pitch: 4,
    roll: 5,
    yaw: 6,
    arch: 7,
    bend: 8,
    twist: 9,
    headYaw: 10,
    headPitch: 11,
    headRoll: 12,
    reach: 13,
    earL: 14,
    earR: 15,
    tailYaw: 16,
    tailLift: 17,
    feet: 18,
});
/** Where a foot's numbers are in a spec: `FOOT.FL + FOOT.dz` is the left forepaw's reach ahead. */
export const FOOT = Object.freeze({
    size: 8,
    dx: 0,
    dy: 1,
    dz: 2,
    pitch: 3,
    curl: 4,
    yaw: 5,
    ground: 6,
    air: 7,
    FL: SPEC.feet,
    FR: SPEC.feet + 8,
    BL: SPEC.feet + 16,
    BR: SPEC.feet + 24,
});
export const SPEC_SIZE = SPEC.feet + 4 * FOOT.size;
export const createBearSpec = () => new Float64Array(SPEC_SIZE);

// ── Solving a spec ──────────────────────────────────────────────────────────────

/** The back from the pelvis to the chest, and where along it the trunk is held. */
const BACK = REST[B.chest][2] - REST[B.pelvis][2];
const ANCHOR = (REST[B.spine2][2] - REST[B.pelvis][2]) / BACK;
/** How much of the trunk's pitch and roll its head does not take. */
const HEAD_STEADY = 0.6;
/** How far a shoulder blade swings (radians) for a forepaw a long reach ahead or behind, and lifts. */
const SCAP_SWING = 0.55;
const SCAP_LIFT = 0.25;
/**
 * The last stretch of each leg's reach (model metres) over which it straightens ever more slowly
 * instead of snapping straight: a leg that is all but straight would otherwise fling its elbow or
 * knee from one frame to the next.
 */
const SOFT_REACH = 0.05;
/** How many times the trunk sinks onto legs that cannot reach the ground they stand on. */
const SINK_PASSES = 2;
/** The most it sinks for them at each pass (model metres): past that a paw comes off the ice. */
const SINK_MOST = 0.06;

const LIMBS = BEAR_FEET.map((foot) => {
    // A foreleg hangs from its shoulder blade; a hind leg from the pelvis.
    const chain = foot.bones.map((name) => B[name]);
    const [root, upper, lower, last, toe] = foot.front ? chain : [null, ...chain];
    const sub = (a, b) => [REST[a][0] - REST[b][0], REST[a][1] - REST[b][1], REST[a][2] - REST[b][2]];
    const upperRest = sub(lower, upper);
    const lowerRest = sub(last, lower);
    const l1 = Math.hypot(...upperRest);
    const l2 = Math.hypot(...lowerRest);
    const ball = BEAR_MARKS[foot.paw];
    // How far from straight the leg stands at rest: its reach softens over most of that.
    const restReach = Math.hypot(REST[last][0] - REST[upper][0], REST[last][1] - REST[upper][1], REST[last][2] - REST[upper][2]);
    const soft = Math.min(SOFT_REACH, 0.8 * (l1 + l2 - restReach));
    return {
        foot,
        soft,
        over: 0,
        down: 1,
        root,
        upper,
        lower,
        last,
        toe,
        carrier: foot.front ? B.chest : B.pelvis,
        ball,
        // From the ball of the foot to the wrist or the heel (the last joint), and to the toe joint.
        heel: [REST[last][0] - ball[0], REST[last][1] - ball[1], REST[last][2] - ball[2]],
        knuckle: [REST[toe][0] - ball[0], REST[toe][1] - ball[1], REST[toe][2] - ball[2]],
        upperDir: upperRest.map((v) => v / l1),
        lowerDir: lowerRest.map((v) => v / l2),
        l1,
        l2,
        // An elbow folds back, a knee forward.
        fold: foot.front ? -1 : 1,
    };
});

/** What solveBear() fills in: each bone's rotation (in the model's frame and its parent's) and joint. */
export function createBearPosture() {
    return {
        world: BEAR_BONES.map(() => [0, 0, 0, 1]),
        local: BEAR_BONES.map(() => [0, 0, 0, 1]),
        at: BEAR_BONES.map((bone) => [bone[2], bone[3], bone[4]]),
        /** How far short of its paw each leg fell (0 when it reached). */
        short: [0, 0, 0, 0],
    };
}

const Q1 = [0, 0, 0, 1];
const Q2 = [0, 0, 0, 1];
const Q3 = [0, 0, 0, 1];
const V1 = [0, 0, 0];
const V2 = [0, 0, 0];
const V3 = [0, 0, 0];

/** A joint's place: its parent's plus its own rest offset, turned with the parent. */
function place(posture, bone) {
    const parent = PARENT[bone];
    V1[0] = REST[bone][0] - REST[parent][0];
    V1[1] = REST[bone][1] - REST[parent][1];
    V1[2] = REST[bone][2] - REST[parent][2];
    qRotate(posture.world[parent], V1, V2);
    const at = posture.at[bone];
    const from = posture.at[parent];
    at[0] = from[0] + V2[0];
    at[1] = from[1] + V2[1];
    at[2] = from[2] + V2[2];
}

/** A joint placed back from a child already placed: the parent's place from the child's. */
function placeBack(posture, child, parent) {
    V1[0] = REST[child][0] - REST[parent][0];
    V1[1] = REST[child][1] - REST[parent][1];
    V1[2] = REST[child][2] - REST[parent][2];
    qRotate(posture.world[parent], V1, V2);
    const at = posture.at[parent];
    const from = posture.at[child];
    at[0] = from[0] - V2[0];
    at[1] = from[1] - V2[1];
    at[2] = from[2] - V2[2];
}

const set = (out, q) => {
    out[0] = q[0];
    out[1] = q[1];
    out[2] = q[2];
    out[3] = q[3];
    return out;
};

/**
 * Two bones from `hip` to reach `target` (model frame), folding in the plane the leg swings in.
 * Writes the upper and lower bones' rotations and the middle joint, returns how far it fell short.
 */
function reach(posture, limb, target) {
    const { world, at } = posture;
    const carry = world[limb.carrier];
    const hip = at[limb.upper];
    let tx = target[0] - hip[0];
    let ty = target[1] - hip[1];
    let tz = target[2] - hip[2];
    const far = Math.hypot(tx, ty, tz) || 1e-6;
    const most = limb.l1 + limb.l2 - 1e-4;
    const least = Math.abs(limb.l1 - limb.l2) + 1e-4;
    // Past the start of the soft stretch the leg straightens more and more slowly, and is never
    // quite straight.
    const knee = most - limb.soft;
    const eased = far > knee ? knee + limb.soft * (1 - Math.exp(-(far - knee) / limb.soft)) : far;
    const d = Math.max(least, eased);
    tx /= far;
    ty /= far;
    tz /= far;
    // (How far past the soft stretch's start the target is, and how steeply down it lies.)
    limb.over = Math.max(0, far - knee);
    limb.down = -ty;
    // The joint stands off the line across the animal's own side-to-side axis (as the body carries
    // it): that turns smoothly with the line wherever the paw goes.
    V1[0] = 1;
    V1[1] = 0;
    V1[2] = 0;
    qRotate(carry, V1, V2);
    let ox = (ty * V2[2] - tz * V2[1]) * limb.fold;
    let oy = (tz * V2[0] - tx * V2[2]) * limb.fold;
    let oz = (tx * V2[1] - ty * V2[0]) * limb.fold;
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol;
    oy /= ol;
    oz /= ol;
    const a = (limb.l1 * limb.l1 - limb.l2 * limb.l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, limb.l1 * limb.l1 - a * a));
    const kx = tx * a + ox * h;
    const ky = ty * a + oy * h;
    const kz = tz * a + oz * h;
    qRotate(carry, limb.upperDir, V1);
    V2[0] = kx / limb.l1;
    V2[1] = ky / limb.l1;
    V2[2] = kz / limb.l1;
    qMul(qBetween(V1, V2, Q2), carry, world[limb.upper]);
    at[limb.lower][0] = hip[0] + kx;
    at[limb.lower][1] = hip[1] + ky;
    at[limb.lower][2] = hip[2] + kz;
    qRotate(world[limb.upper], limb.lowerDir, V1);
    V2[0] = (tx * d - kx) / limb.l2;
    V2[1] = (ty * d - ky) / limb.l2;
    V2[2] = (tz * d - kz) / limb.l2;
    qMul(qBetween(V1, V2, Q2), world[limb.upper], world[limb.lower]);
    at[limb.last][0] = hip[0] + tx * d;
    at[limb.last][1] = hip[1] + ty * d;
    at[limb.last][2] = hip[2] + tz * d;
    return Math.max(0, far - d);
}

const TARGET = [0, 0, 0];
const SUNK = new Float64Array(SPEC_SIZE);

/**
 * Solve a spec: every bone's rotation, and where every joint is.
 *
 * Where a foot that bears weight lies beyond its leg's easy reach (down a slope, or far ahead or
 * behind), the chest or the hips sink toward it until the leg reaches, as an animal steps down
 * onto lower ground: the spec is solved again with the trunk lowered.
 * @param {Float64Array} spec
 * @param {object} [posture]  createBearPosture()
 */
export function solveBear(spec, posture = createBearPosture()) {
    solveOnce(spec, posture);
    let sunk = false;
    for (let pass = 0; pass < SINK_PASSES; pass++) {
        let front = 0;
        let back = 0;
        for (let i = 0; i < LIMBS.length; i++) {
            const limb = LIMBS[i];
            const bears = 1 - clamp01(spec[SPEC.feet + i * FOOT.size + FOOT.air]);
            const sink = Math.min(SINK_MOST, (limb.over * bears) / Math.max(0.5, limb.down));
            if (limb.foot.front) front = Math.max(front, sink);
            else back = Math.max(back, sink);
        }
        if (front < 1e-5 && back < 1e-5) break;
        if (!sunk) {
            SUNK.set(spec);
            sunk = true;
        }
        SUNK[SPEC.fore] += front;
        SUNK[SPEC.drop] += back;
        solveOnce(SUNK, posture);
    }
    return posture;
}

function solveOnce(spec, posture) {
    const { world, local, at } = posture;
    const S = SPEC;

    // ── The trunk: four bones sharing the bend, the arch and the twist ──
    const slope = Math.asin(clamp((spec[S.fore] - spec[S.drop]) / BACK, -0.92, 0.92));
    const yaw = spec[S.yaw];
    const roll = spec[S.roll];
    const bend = spec[S.bend];
    const arch = spec[S.arch];
    const twist = spec[S.twist];
    qTurn(yaw, spec[S.pitch] + slope, roll, Q3);
    const shares = [[B.pelvis, -0.5], [B.spine1, -1 / 6], [B.spine2, 1 / 6], [B.chest, 0.5]];
    for (let i = 0; i < shares.length; i++) {
        const [bone, k] = shares[i];
        qMul(Q3, qTurn(bend * k, arch * k, twist * k, Q1), world[bone]);
    }
    // Held at the second spine joint: lowered by its share of the drop and the fore.
    const anchor = at[B.spine2];
    anchor[0] = REST[B.spine2][0] + spec[S.sway] - roll * 0.3;
    anchor[1] = REST[B.spine2][1] - (spec[S.drop] + (spec[S.fore] - spec[S.drop]) * ANCHOR);
    anchor[2] = REST[B.spine2][2] + spec[S.shift];
    placeBack(posture, B.spine2, B.spine1);
    placeBack(posture, B.spine1, B.pelvis);
    place(posture, B.chest);

    // ── Neck and head: the head turned where it looks and held part-way level ──
    qTurn(spec[S.headYaw], -spec[S.headPitch], spec[S.headRoll], Q1);
    qMul(world[B.chest], Q1, Q2);
    qMul(qTurn(yaw + bend * 0.5, 0, 0, Q3), Q1, Q1);
    qSlerp(Q2, Q1, HEAD_STEADY, world[B.head]);
    const lift = spec[S.reach];
    qSlerp(world[B.chest], world[B.head], 0.34, Q1);
    qMul(Q1, qTurn(0, lift * 0.6, 0, Q2), world[B.neck1]);
    qSlerp(world[B.chest], world[B.head], 0.68, Q1);
    qMul(Q1, qTurn(0, lift * 0.4, 0, Q2), world[B.neck2]);
    place(posture, B.neck1);
    place(posture, B.neck2);
    place(posture, B.head);
    qMul(world[B.head], qTurn(spec[S.earL] * 0.4, -spec[S.earL] * 0.7, 0, Q1), world[B.earL]);
    qMul(world[B.head], qTurn(-spec[S.earR] * 0.4, -spec[S.earR] * 0.7, 0, Q1), world[B.earR]);
    place(posture, B.earL);
    place(posture, B.earR);

    // ── The tail ──
    qMul(world[B.pelvis], qTurn(spec[S.tailYaw] * 0.6, spec[S.tailLift] * 0.6, 0, Q1), world[B.tail1]);
    qMul(world[B.tail1], qTurn(spec[S.tailYaw] * 0.4, spec[S.tailLift] * 0.4, 0, Q1), world[B.tail2]);
    place(posture, B.tail1);
    place(posture, B.tail2);

    // ── The legs: each placed by the ball of its foot ──
    for (let i = 0; i < LIMBS.length; i++) {
        const limb = LIMBS[i];
        const f = S.feet + i * FOOT.size;
        const dx = spec[f + FOOT.dx];
        const dy = spec[f + FOOT.dy];
        const dz = spec[f + FOOT.dz];
        const heelUp = spec[f + FOOT.pitch];
        const curl = spec[f + FOOT.curl];
        const footYaw = spec[f + FOOT.yaw];
        const tilt = spec[f + FOOT.ground];
        if (limb.root !== null) {
            // The shoulder blade swings with the foreleg: forward as it reaches, back as it pushes,
            // and up as the leg is lifted.
            const swing = -SCAP_SWING * clamp(dz / 0.55, -1.2, 1.2) - SCAP_LIFT * clamp(dy / 0.25, 0, 1);
            qMul(world[B.chest], qTurn(0, swing, 0, Q1), world[limb.root]);
            place(posture, limb.root);
        }
        place(posture, limb.upper);
        // The last bone (hand or foot): heel up about the ball, flexed as it swings.
        qTurn(footYaw, heelUp + curl + tilt, 0, world[limb.last]);
        qRotate(world[limb.last], limb.heel, V3);
        TARGET[0] = limb.ball[0] + dx + V3[0];
        TARGET[1] = limb.ball[1] + dy + V3[1];
        TARGET[2] = limb.ball[2] + dz + V3[2];
        posture.short[i] = reach(posture, limb, TARGET);
        // (The last joint is where the leg reached: if short, the paw comes up with it.)
        // The toes stay flat on the ice as the heel peels; swinging, they curl with the paw.
        qTurn(footYaw, curl * 1.25 + tilt, 0, world[limb.toe]);
        place(posture, limb.toe);
    }

    // ── What each bone object takes: its rotation in its parent's frame ──
    for (let i = 0; i < BEAR_BONES.length; i++) {
        const parent = PARENT[i];
        if (parent < 0) {
            set(local[i], world[i]);
        } else {
            const q = world[parent];
            Q1[0] = -q[0];
            Q1[1] = -q[1];
            Q1[2] = -q[2];
            Q1[3] = q[3];
            qMul(Q1, world[i], local[i]);
        }
    }
    return posture;
}

/** Where a point of the animal is in a posture: `rest` is the point at rest, carried by `bone`. */
export function bearPoint(posture, bone, rest, out = [0, 0, 0]) {
    const i = typeof bone === 'number' ? bone : B[bone];
    V1[0] = rest[0] - REST[i][0];
    V1[1] = rest[1] - REST[i][1];
    V1[2] = rest[2] - REST[i][2];
    qRotate(posture.world[i], V1, V2);
    out[0] = posture.at[i][0] + V2[0];
    out[1] = posture.at[i][1] + V2[1];
    out[2] = posture.at[i][2] + V2[2];
    return out;
}

/** Where the ball of each foot is in a posture (BEAR_FEET order). */
export function bearPaw(posture, i, out = [0, 0, 0]) {
    const limb = LIMBS[i];
    return bearPoint(posture, limb.last, limb.ball, out);
}

// ── What it does when it stops ──────────────────────────────────────────────────

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

const { FL, FR, BL } = FOOT;
const STEP = FOOT.size;

/** What it looks like `t` seconds into each act (spec, t). Its feet are its gait's unless it says. */
const ACTS = {
    /** Standing square on the ice, its head a little low. */
    Stand(s) {
        s[SPEC.headPitch] = -0.08;
        s[SPEC.reach] = 0.06;
    },
    /** Under way: its head carried low and well out, a little below the line of its back. */
    Walk(s) {
        s[SPEC.headPitch] = -0.14;
        s[SPEC.reach] = 0.16;
        s[SPEC.arch] = -0.03;
        s[SPEC.earL] = 0.15;
        s[SPEC.earR] = 0.15;
    },
    /**
     * It lifts its nose high into the wind and sniffs: the neck stretched up, the nose working in
     * short bursts, the head turning slowly to find where the scent comes from, ears pricked.
     */
    Sniff(s, t) {
        const up = hold(t, 0.2, 1.4, 5.8, 7.1);
        const bursts = hold(t, 1.2, 1.5, 2.6, 2.9) + hold(t, 3.6, 3.9, 5.2, 5.5);
        s[SPEC.headPitch] = (0.55 + 0.045 * Math.sin(TAU * 3.2 * t) * bursts) * up - 0.08 * (1 - up);
        s[SPEC.reach] = -0.34 * up + 0.06 * (1 - up);
        s[SPEC.headYaw] = 0.3 * Math.sin(0.85 * (t - 1.2)) * smooth(1.0, 2.0, t) * up;
        s[SPEC.headRoll] = 0.06 * Math.sin(0.85 * (t - 1.2)) * up;
        s[SPEC.fore] = -0.015 * up;
        s[SPEC.shift] = -0.025 * up;
        s[SPEC.arch] = 0.04 * up;
        s[SPEC.earL] = -0.35 * up;
        s[SPEC.earR] = -0.35 * up;
    },
    /** Its nose put down to the ice, working along it: head low and swinging, a few quick sniffs. */
    Scent(s, t) {
        const down = hold(t, 0.2, 1.1, 4.3, 5.2);
        const sniffs = hold(t, 2.2, 2.4, 3.2, 3.4);
        s[SPEC.headPitch] = (-0.62 + 0.04 * Math.sin(TAU * 3.4 * t) * sniffs) * down - 0.08 * (1 - down);
        s[SPEC.reach] = 0.55 * down + 0.06 * (1 - down);
        s[SPEC.headYaw] = 0.24 * Math.sin(1.7 * (t - 1.1)) * smooth(0.9, 1.6, t) * down;
        s[SPEC.fore] = 0.05 * down;
        s[SPEC.shift] = 0.03 * down;
        s[SPEC.arch] = -0.04 * down;
        s[SPEC.earL] = -0.2 * down;
        s[SPEC.earR] = -0.2 * down;
    },
    /** It looks about: one way, the other way, back; an ear turns after. */
    Look(s, t) {
        const e = smooth(0.3, 1.1, t) - 2 * smooth(2.1, 3.1, t) + smooth(4.1, 4.9, t);
        s[SPEC.headYaw] = 0.95 * e;
        s[SPEC.headPitch] = 0.04 + 0.08 * Math.abs(e);
        s[SPEC.headRoll] = -0.08 * e;
        s[SPEC.reach] = 0.02;
        s[SPEC.yaw] = 0.05 * e;
        s[SPEC.bend] = 0.12 * e;
        s[SPEC.sway] = 0.015 * e;
        s[SPEC.earL] = -0.3 * Math.max(0, e);
        s[SPEC.earR] = -0.3 * Math.max(0, -e);
    },
    /**
     * It stands up on its hind legs to see further: the forepaws come off the ice and hang before
     * its chest, its head up to the sky, ears pricked; it holds there, then drops back down.
     */
    Rear(s, t) {
        const up = hold(t, 0.35, 1.7, 4.6, 6.1);
        const off = hold(t, 0.55, 1.15, 5.2, 6.0);
        s[SPEC.fore] = -0.78 * up;
        s[SPEC.drop] = 0.16 * up;
        s[SPEC.shift] = -0.4 * up;
        s[SPEC.pitch] = 0.08 * up;
        s[SPEC.arch] = 0.12 * up;
        s[SPEC.headPitch] = 0.16 * up + 0.04 * Math.sin(TAU * 2.6 * t) * hold(t, 2.2, 2.5, 3.6, 3.9);
        s[SPEC.reach] = -0.1 * up;
        s[SPEC.headYaw] = 0.22 * Math.sin(1.1 * (t - 1.8)) * hold(t, 1.7, 2.3, 4.2, 4.8);
        s[SPEC.earL] = -0.4 * up;
        s[SPEC.earR] = -0.4 * up;
        for (let f = FL; f <= FR; f += STEP) {
            // (Its forelegs hang before its belly: the elbows down at its sides, the forearms out a
            // little and the paws dangling from bent wrists, as far below the raised shoulders as
            // a standing bear's are.)
            s[f + FOOT.dx] = (f === FL ? -0.01 : 0.01) * off;
            s[f + FOOT.dy] = 0.92 * off;
            s[f + FOOT.dz] = -0.28 * off;
            s[f + FOOT.curl] = 1.1 * off;
            s[f + FOOT.air] = off;
        }
        for (let f = BL; f <= BL + STEP; f += STEP) {
            s[f + FOOT.dz] = -0.06 * up;
            s[f + FOOT.pitch] = -0.12 * up;
        }
    },
    /** It lies down on the ice: forepaws out ahead, hind legs drawn under it, its chin on its paws. */
    Lie(s, t) {
        const down = smooth(0.2, 2.4, t);
        const settle = smooth(2.0, LIE_HOLD, t);
        s[SPEC.drop] = 0.47 * smooth(0.2, 1.8, t);
        s[SPEC.fore] = 0.5 * smooth(0.6, 2.4, t);
        s[SPEC.shift] = -0.06 * down;
        s[SPEC.arch] = 0.06 * down;
        s[SPEC.headPitch] = -0.04 * down - 0.1 * settle;
        s[SPEC.reach] = 0.1 * down + 0.2 * settle;
        s[SPEC.earL] = 0.25 * settle;
        s[SPEC.earR] = 0.25 * settle;
        for (let f = FL; f <= FR; f += STEP) {
            s[f + FOOT.dz] = 0.36 * smooth(0.5, 2.2, t);
            s[f + FOOT.pitch] = -0.2 * down;
            s[f + FOOT.dx] = (f === FL ? -0.03 : 0.03) * down;
        }
        for (let f = BL; f <= BL + STEP; f += STEP) {
            s[f + FOOT.dz] = 0.12 * down;
            s[f + FOOT.pitch] = -0.3 * down;
            s[f + FOOT.dx] = (f === BL ? 0.1 : -0.1) * down;
        }
    },
    /** It gets up off the ice: Lie run backwards, a shade quicker. */
    Rise(s, t) {
        ACTS.Lie(s, LIE_HOLD * (1 - smooth(0, BEAR_ACTS.Rise, t)));
    },
};

/** Whether an act places its feet itself (the gait's feet are left to it). */
export const OWNS_FEET = Object.freeze({ Rear: true, Lie: true, Rise: true });

/** Fill a spec with what an act looks like `t` seconds in (unknown names: it stands). */
export function bearAct(spec, name, t) {
    spec.fill(0);
    (ACTS[name] || ACTS.Stand)(spec, Math.max(0, t));
    return spec;
}

export { SPEC as BEAR_SPEC };
