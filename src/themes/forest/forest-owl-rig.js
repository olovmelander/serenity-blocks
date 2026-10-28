/**
 * Forest — the eagle owl's rig: its bones, and every pose as plain numbers.
 *
 * The model (scripts/blender/forest_owl/) rests perched, the body upright (its axis OWL_POSTURE
 * degrees above level) and both wings spread sideways in the plane of the back; every bone's rest
 * rotation is the identity, so a rotation set here reads in the owl's own frame (x its left, y up,
 * z forward). A wing is worked in its "flight frame" (x along the wing, y dorsal, z along the body
 * toward the head) and turned into the owl's frame at the end.
 *
 * Every flight feather has a bone of its own. A wing folds as a bird's does: the arm closes in a Z
 * against the flank (shoulder back, elbow forward, wrist back) and each feather turns about its own
 * root until it lies along the body. The folded wing is given as where each part should lie
 * (`FOLDED`), and the turn to it is found once; any pose between is a slerp of each joint toward it,
 * so a half-open wing is always a wing.
 *
 * No three.js here: the theme, the playground, the Blender previews (scripts/forest/owl-poses.mjs)
 * and the tests share it. Quaternions are [x, y, z, w], as three's are.
 */

const DEG = Math.PI / 180;

/** Degrees the body's axis stands above level in the rest pose (perched). */
export const OWL_POSTURE = 62;
export const OWL_PRIMARIES = 10;
export const OWL_SECONDARIES = 14;
export const OWL_TERTIALS = 3;
export const OWL_RECTRICES = 6;
/** Where the rest pose's root joint (the body's centre) stands over the perch, metres. */
export const OWL_ROOT_HEIGHT = 0.215;
/** How much larger than life the theme draws it: a big female eagle owl, a little more. */
export const OWL_DRAWN_SCALE = 1.12;

// The wing's plan (flight frame, metres from the shoulder), as the model builds it.
const ELBOW_F = [0.15, 0, -0.03];
const WRIST_F = [0.325, 0, 0.006];
const TIP_F = [0.455, 0, -0.006];
const PRIMARY_ANGLE = [22, 28.5, 35, 41.5, 48.5, 55.5, 63, 70.5, 78.5, 87];
const TERTIAL_ANGLE = [-9, -18, -28];
const secondaryAngle = (i) => {
    const t = i / (OWL_SECONDARIES - 1);
    return 13 * (1 - t) - 2.5 * t;
};
const rectrixAngle = (i) => 2.5 + 3.2 * i;

// -- quaternions ------------------------------------------------------------------------------
export function qSet(out, x, y, z, w) {
    out[0] = x; out[1] = y; out[2] = z; out[3] = w;
    return out;
}

export function qAxis(ax, ay, az, angle, out = [0, 0, 0, 1]) {
    const len = Math.hypot(ax, ay, az) || 1;
    const s = Math.sin(angle / 2) / len;
    return qSet(out, ax * s, ay * s, az * s, Math.cos(angle / 2));
}

export function qMul(a, b, out = [0, 0, 0, 1]) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return qSet(
        out,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    );
}

export function qConj(a, out = [0, 0, 0, 1]) {
    return qSet(out, -a[0], -a[1], -a[2], a[3]);
}

export function qNormalize(a, out = a) {
    const len = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
    return qSet(out, a[0] / len, a[1] / len, a[2] / len, a[3] / len);
}

export function qSlerp(a, b, t, out = [0, 0, 0, 1]) {
    let [bx, by, bz, bw] = b;
    let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (cos < 0) {
        cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let k0;
    let k1;
    if (cos > 0.9995) {
        k0 = 1 - t;
        k1 = t;
    } else {
        const angle = Math.acos(Math.min(1, cos));
        const sin = Math.sin(angle);
        k0 = Math.sin((1 - t) * angle) / sin;
        k1 = Math.sin(t * angle) / sin;
    }
    qSet(out, a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1);
    return qNormalize(out);
}

const IDENTITY = Object.freeze([0, 0, 0, 1]);

/** `q` raised to the power t: that much of its turn about its own axis. */
export function qPow(q, t, out = [0, 0, 0, 1]) {
    return qSlerp(IDENTITY, q, t, out);
}

export function qRotate(q, v, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    out[0] = vx + w * tx + (y * tz - z * ty);
    out[1] = vy + w * ty + (z * tx - x * tz);
    out[2] = vz + w * tz + (x * ty - y * tx);
    return out;
}

/** The rotation whose columns are the unit vectors xa, ya, za. */
export function qFromBasis(xa, ya, za, out = [0, 0, 0, 1]) {
    const m00 = xa[0]; const m01 = ya[0]; const m02 = za[0];
    const m10 = xa[1]; const m11 = ya[1]; const m12 = za[1];
    const m20 = xa[2]; const m21 = ya[2]; const m22 = za[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        qSet(out, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        qSet(out, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        qSet(out, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        qSet(out, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
    }
    return qNormalize(out);
}

/** Yaw (about y), then pitch (about x), then roll (about z), in degrees: R = Ry * Rx * Rz. */
export function qEuler(yaw, pitch, roll, out = [0, 0, 0, 1]) {
    const y = qAxis(0, 1, 0, yaw * DEG);
    const x = qAxis(1, 0, 0, pitch * DEG);
    const z = qAxis(0, 0, 1, roll * DEG);
    return qMul(qMul(y, x, out), z, out);
}

/** The yaw, pitch and roll (degrees, R = Ry * Rx * Rz) of a rotation; pitch within +-90. */
export function eulerOf(q, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    // Rotation matrix entries needed for the YXZ order.
    const m12 = 2 * (y * z - w * x);
    const m02 = 2 * (x * z + w * y);
    const m22 = 1 - 2 * (x * x + y * y);
    const m10 = 2 * (x * y + w * z);
    const m11 = 1 - 2 * (x * x + z * z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -m12)));
    out[0] = Math.atan2(m02, m22) / DEG;
    out[1] = pitch / DEG;
    out[2] = Math.atan2(m10, m11) / DEG;
    return out;
}

/** A left-side rotation (owl frame) as the right side's: mirrored across the owl's middle. */
export function qMirror(q, out = [0, 0, 0, 1]) {
    return qSet(out, q[0], -q[1], -q[2], q[3]);
}

// -- vectors -----------------------------------------------------------------------------------
const unit = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sweep = (degrees) => [Math.sin(degrees * DEG), 0, -Math.cos(degrees * DEG)];

/** The turn taking a part lying along `fromDir` (its back toward `fromUp`) to lie along `toDir`/`toUp`. */
function qAlign(fromDir, fromUp, toDir, toUp) {
    const frame = (d, n) => {
        const z = unit(d);
        const y = unit(sub(n, z.map((c) => c * dot(n, z))));
        return [cross(y, z), y, z];
    };
    const a = qFromBasis(...frame(fromDir, fromUp));
    const b = qFromBasis(...frame(toDir, toUp));
    return qMul(b, qConj(a));
}

// -- the flight frame -----------------------------------------------------------------------
// From the flight frame to the owl's: a turn of -POSTURE about x.
const TO_OWL = qAxis(1, 0, 0, -OWL_POSTURE * DEG);
const FROM_OWL = qConj(TO_OWL);

/** A rotation given in the flight frame, as the same rotation in the owl's frame. */
export function qFlightToOwl(q, out = [0, 0, 0, 1]) {
    return qMul(qMul(TO_OWL, q, out), FROM_OWL, out);
}

// -- the bones -----------------------------------------------------------------------------
/** Every bone in the model's order (scripts/blender/forest_owl/model.py skeleton()). */
export const OWL_BONES = Object.freeze((() => {
    const names = ['root', 'pelvis', 'chest', 'neck0', 'neck1', 'head', 'throat', 'tail'];
    ['L', 'R'].forEach((s) => {
        names.push(`lid${s}`, `ear${s}`);
        for (let i = 1; i <= OWL_RECTRICES; i += 1) names.push(`rectrix${s}${i}`);
        names.push(`thigh${s}`, `shin${s}`, `tarsus${s}`, `foot${s}`);
        for (let t = 1; t <= 4; t += 1) names.push(`toe${s}${t}a`, `toe${s}${t}b`);
        names.push(`humerus${s}`, `ulna${s}`, `hand${s}`, `alula${s}`);
        for (let i = 1; i <= OWL_PRIMARIES; i += 1) names.push(`primary${s}${i}`);
        for (let i = 1; i <= OWL_SECONDARIES; i += 1) names.push(`secondary${s}${i}`);
        for (let i = 1; i <= OWL_TERTIALS; i += 1) names.push(`tertial${s}${i}`);
    });
    return names;
})());

export const OWL_BONE_INDEX = Object.freeze(Object.fromEntries(OWL_BONES.map((name, i) => [name, i])));

// -- the folded wing -----------------------------------------------------------------------
/**
 * Where the folded wing's parts lie, in the flight frame (left wing): each a direction and the way
 * its upper (dorsal) side faces. The arm closes in a Z along the flank; the feathers lie back along
 * the body, the primaries under the secondaries, the tertials on top.
 */
export const FOLDED = Object.freeze({
    // The wing's upper side faces out from the flank (and a little up the back).
    up: unit([0.94, 0.3, -0.1]),
    // The humerus runs from the shoulder down the side of the back, the forearm back up it to the
    // bend of the wing beside the breast, the hand down again under the secondaries.
    humerus: unit([0.3, -0.29, -0.91]),
    ulna: unit([0.03, -0.1, 1]),
    hand: unit([0.1, -0.06, -1]),
    // The tips close in over the rump and the tail, the primaries crossing under the secondaries.
    primary: (i) => unit([-0.03 - 0.01 * i, -0.02 - 0.006 * i, -1]),
    secondary: (i) => unit([-0.03 - 0.05 * (i / (OWL_SECONDARIES - 1)), 0.02, -1]),
    tertial: (i) => unit([-0.03 * i, 0.02 + 0.02 * i, -1]),
    // The folded wing curls round the body: its front (primaries, outer secondaries) faces out from the
    // flank, its back (inner secondaries, tertials) lies over the back.
    primaryUp: () => unit([0.96, 0.24, -0.1]),
    secondaryUp: (i) => {
        const t = i / (OWL_SECONDARIES - 1);
        return unit([0.96 - 0.4 * t, 0.26 + 0.5 * t, -0.1]);
    },
    tertialUp: (i) => unit([0.45 - 0.1 * i, 0.88, -0.1]),
});

const REST = {
    humerus: unit(ELBOW_F),
    ulna: unit(sub(WRIST_F, ELBOW_F)),
    hand: unit(sub(TIP_F, WRIST_F)),
};
const UP = [0, 1, 0];

/** The folded wing's local turns, per joint, in the flight frame (found once). */
const FOLD = (() => {
    const world = {
        humerus: qAlign(REST.humerus, UP, FOLDED.humerus, FOLDED.up),
        ulna: qAlign(REST.ulna, UP, FOLDED.ulna, FOLDED.up),
        hand: qAlign(REST.hand, UP, FOLDED.hand, FOLDED.up),
    };
    const local = {
        humerus: world.humerus,
        ulna: qMul(qConj(world.humerus), world.ulna),
        hand: qMul(qConj(world.ulna), world.hand),
        primary: [],
        secondary: [],
        tertial: [],
    };
    for (let i = 0; i < OWL_PRIMARIES; i += 1) {
        const w = qAlign(sweep(PRIMARY_ANGLE[i]), UP, FOLDED.primary(i), FOLDED.primaryUp(i));
        local.primary.push(qMul(qConj(world.hand), w));
    }
    for (let i = 0; i < OWL_SECONDARIES; i += 1) {
        const w = qAlign(sweep(secondaryAngle(i)), UP, FOLDED.secondary(i), FOLDED.secondaryUp(i));
        local.secondary.push(qMul(qConj(world.ulna), w));
    }
    for (let i = 0; i < OWL_TERTIALS; i += 1) {
        const w = qAlign(sweep(TERTIAL_ANGLE[i]), UP, FOLDED.tertial(i), FOLDED.tertialUp(i));
        local.tertial.push(qMul(qConj(world.humerus), w));
    }
    return local;
})();

// -- poses ---------------------------------------------------------------------------------
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** A wing's numbers: `fold` 0 spread .. 1 folded; angles in degrees. */
export function createWingPose() {
    return {
        fold: 1, dihedral: 0, sweep: 0, twist: 0, flex: 0, handTwist: 0, tip: 0, fan: 1, load: 0, alula: 0,
    };
}

/** Every number a pose is made of; `createOwlPose()` is the owl perched at rest. */
export function createOwlPose() {
    return {
        // The body's turn in the model frame (the root's), and where the root moves, metres.
        body: [0, 0, 0, 1],
        lift: [0, 0, 0],
        wings: [createWingPose(), createWingPose()],
        // The head relative to the chest: yaw (+ to its left), pitch (+ up), roll (+ its left ear down), degrees.
        head: [0, 0, 0],
        neck: 0, // + stretches the neck up out of the ruff (metres, a few centimetres at most)
        blink: [0, 0],
        tufts: 0.8, // 0 laid flat, 1 erect
        puff: 0, // the white throat swelling for a hoot
        ruffle: 0, // the whole plumage fluffed out
        tail: {
            pitch: 0, yaw: 0, fan: 1,
        },
        // Legs: `tuck` folded up for flight, `reach` thrown forward to land, `grip` toes closed round a
        // perch of `perch` metres radius, `spread` toes thrown open.
        legs: [{
            tuck: 0, reach: 0, grip: 1, spread: 0, lift: 0,
        }, {
            tuck: 0, reach: 0, grip: 1, spread: 0, lift: 0,
        }],
        perch: 0.045,
    };
}

/** Where the pose's numbers are written: a quaternion per bone, the root's move and the scales. */
export function createOwlFrame() {
    return {
        rotations: OWL_BONES.map(() => [0, 0, 0, 1]),
        root: [0, 0, 0],
        scales: {
            throat: [1, 1, 1], chest: [1, 1, 1], pelvis: [1, 1, 1], neck1: [1, 1, 1],
        },
    };
}

const T = {
    a: [0, 0, 0, 1], b: [0, 0, 0, 1], c: [0, 0, 0, 1], d: [0, 0, 0, 1], e: [0, 0, 0, 1],
};

function wing(frame, w, side) {
    const sfx = side === 0 ? 'L' : 'R';
    const R = frame.rotations;
    const I = OWL_BONE_INDEX;
    const set = (name, qFlight, index = '') => {
        const out = R[I[`${name}${sfx}${index}`]];
        qFlightToOwl(qFlight, out);
        if (side === 1) qMirror(out, out);
    };
    const flex = clamp01(w.flex);
    const fold = clamp01(w.fold);
    const fH = fold;
    const fU = clamp01(fold + flex * 0.34);
    const fW = clamp01(fold + flex * 0.55);
    const fP = clamp01(fold + flex * 0.3);
    const fS = clamp01(fold + flex * 0.22);
    // The arm: the humerus beats (dihedral, about the body's axis), sweeps (about the back's normal)
    // and twists (about itself) on top of its fold; the forearm and hand close by their folds.
    qMul(qAxis(0, 0, 1, w.dihedral * DEG, T.a), qAxis(0, 1, 0, w.sweep * DEG, T.b), T.c);
    qMul(T.c, qAxis(1, 0, 0, -w.twist * DEG, T.a), T.c);
    qMul(T.c, qPow(FOLD.humerus, fH, T.d), T.e);
    set('humerus', T.e);
    set('ulna', qPow(FOLD.ulna, fU, T.a));
    qMul(qAxis(0, 0, 1, w.tip * DEG, T.a), qAxis(1, 0, 0, -w.handTwist * DEG, T.b), T.c);
    qMul(T.c, qPow(FOLD.hand, fW, T.d), T.e);
    set('hand', T.e);
    set('alula', qAxis(0, 1, 0, -w.alula * 26 * DEG, T.a));
    // Primaries: fanned about their own roots (the spread between p1 and p10 scaled by `fan`), bent up
    // and twisted nose-down at the tips by the air's load, the outer ones most; then folded.
    const fan = Number.isFinite(w.fan) ? w.fan : 1;
    for (let i = 0; i < OWL_PRIMARIES; i += 1) {
        const d = sweep(PRIMARY_ANGLE[i]);
        const spread = (PRIMARY_ANGLE[i] - PRIMARY_ANGLE[0]) * (fan - 1);
        const reach = (i + 1) / OWL_PRIMARIES;
        const load = w.load * reach * reach;
        qAxis(0, 1, 0, -spread * DEG, T.a);
        // Up about the axis square to the feather in the wing's plane, then nose-down about itself.
        const k = cross(d, UP);
        qMul(qAxis(k[0], k[1], k[2], load * 9 * DEG, T.b), T.a, T.a);
        qMul(qAxis(d[0], d[1], d[2], -load * 7 * DEG, T.b), T.a, T.a);
        qSlerp(T.a, FOLD.primary[i], fP, T.c);
        set('primary', T.c, i + 1);
    }
    for (let i = 0; i < OWL_SECONDARIES; i += 1) {
        const spread = (secondaryAngle(i) - secondaryAngle(OWL_SECONDARIES - 1)) * (fan - 1) * 0.35;
        qAxis(0, 1, 0, -spread * DEG, T.a);
        qSlerp(T.a, FOLD.secondary[i], fS, T.c);
        set('secondary', T.c, i + 1);
    }
    for (let i = 0; i < OWL_TERTIALS; i += 1) {
        set('tertial', qPow(FOLD.tertial[i], fH, T.a), i + 1);
    }
}

// The eyelid's hinge: across the eye (the model's lid cap is centred on "up" and opens toward "look").
const LID_UP = unit([0, 1, -0.25]);
const LID_LOOK = unit([0.16, -0.02, 1]);
const LID_AXIS = unit(cross(LID_UP, LID_LOOK));
// The toes (left foot, rest directions), and how far each joint closes round a perch.
const TOE_RAW = [[-0.12, 0, -1], [-0.32, 0, 1], [0.06, 0, 1], [0.85, 0, 0.5]];
const TOE_DIR = TOE_RAW.map(unit);
const TOE_SEG = [[0.018, 0.015], [0.021, 0.017], [0.025, 0.019], [0.02, 0.016]];

/** The plan the model is built on (scripts/blender/forest_owl/model.py), as the GLB's extras carry it. */
export const OWL_PLAN = Object.freeze({
    posture: OWL_POSTURE,
    elbow: ELBOW_F,
    wrist: WRIST_F,
    tip: TIP_F,
    primaryAngle: PRIMARY_ANGLE,
    tertialAngle: TERTIAL_ANGLE,
    toeDirections: TOE_RAW,
    toeLengths: TOE_SEG,
    rootHeight: OWL_ROOT_HEIGHT,
});

function legs(frame, pose, side) {
    const sfx = side === 0 ? 'L' : 'R';
    const R = frame.rotations;
    const I = OWL_BONE_INDEX;
    const leg = pose.legs[side];
    const set = (name, q, tag = '') => {
        const out = R[I[`${name}${sfx}${tag}`]];
        qSet(out, q[0], q[1], q[2], q[3]);
        if (side === 1) qMirror(out, out);
    };
    const tuck = clamp01(leg.tuck);
    const reach = clamp01(leg.reach);
    // Thrown forward to land: the thigh swings the leg out ahead of the breast; tucked for flight the
    // legs fold up under the belly's plumage.
    set('thigh', qAxis(1, 0, 0, (-reach * 62 + tuck * 30 - (leg.lift || 0) * 20) * DEG, T.a));
    set('shin', qAxis(1, 0, 0, (reach * 18 - tuck * 75 + (leg.lift || 0) * 28) * DEG, T.a));
    set('tarsus', qAxis(1, 0, 0, (reach * 22 + tuck * 118 - (leg.lift || 0) * 12) * DEG, T.a));
    set('foot', qAxis(1, 0, 0, (-reach * 25 + tuck * 40) * DEG, T.a));
    // Toes: closed round the perch (each joint by the arc its segment wraps), or thrown open.
    const radius = Math.max(0.015, pose.perch || 0.045);
    const grip = clamp01(leg.grip) * (1 - clamp01(leg.spread));
    const open = clamp01(leg.spread);
    for (let t = 0; t < 4; t += 1) {
        const d = TOE_DIR[t];
        const k = cross(UP, d); // curling about this turns the toe down
        // Perched, the outer toe turns back to hold with two toes each way.
        const swing = t === 3 ? (grip * -78 + open * 20) : (open * (t === 0 ? -14 : 12) * (t === 1 ? 1 : -1));
        const wrapA = (grip * (TOE_SEG[t][0] / radius) * 0.5) / DEG + tuck * 40 - open * 25;
        const wrapB = (grip * (TOE_SEG[t][1] / radius) * 0.75) / DEG + tuck * 60 - open * 10;
        qMul(qAxis(0, 1, 0, swing * DEG, T.b), qAxis(k[0], k[1], k[2], wrapA * DEG, T.c), T.a);
        set('toe', T.a, `${t + 1}a`);
        set('toe', qAxis(k[0], k[1], k[2], wrapB * DEG, T.a), `${t + 1}b`);
    }
}

/**
 * Write `pose` into `frame`: every bone's local rotation (the owl's frame), the root's move, and the
 * scales of the throat and the plumage. Allocation-free after the first call.
 */
export function poseOwl(pose, frame = createOwlFrame()) {
    const R = frame.rotations;
    const I = OWL_BONE_INDEX;
    R.forEach((q) => qSet(q, 0, 0, 0, 1));
    qSet(R[I.root], pose.body[0], pose.body[1], pose.body[2], pose.body[3]);
    qNormalize(R[I.root]);
    frame.root[0] = pose.lift[0];
    frame.root[1] = pose.lift[1];
    frame.root[2] = pose.lift[2];
    // The neck: yaw, pitch and roll shared out along it, most at the top (powers of one turn per axis
    // do not fight each other).
    const [yaw, pitch, roll] = pose.head;
    qEuler(yaw * 0.22, -pitch * 0.34, roll * 0.2, R[I.neck0]);
    qEuler(yaw * 0.36, -pitch * 0.34, roll * 0.3, R[I.neck1]);
    qEuler(yaw * 0.42, -pitch * 0.32, roll * 0.5, R[I.head]);
    // Eyelids close down over the eyes; the tufts stand or lie back.
    for (let side = 0; side < 2; side += 1) {
        const sfx = side === 0 ? 'L' : 'R';
        const lid = R[I[`lid${sfx}`]];
        qAxis(LID_AXIS[0], LID_AXIS[1], LID_AXIS[2], clamp01(pose.blink[side]) * 74 * DEG, lid);
        if (side === 1) qMirror(lid, lid);
        const flat = 1 - clamp01(pose.tufts);
        const ear = R[I[`ear${sfx}`]];
        qMul(qAxis(1, 0, 0, -flat * 62 * DEG, T.a), qAxis(0, 0, 1, -flat * 16 * DEG, T.b), ear);
        if (side === 1) qMirror(ear, ear);
    }
    // The tail: pitched and swung about its base, its feathers fanned about their roots.
    const { tail } = pose;
    qMul(qAxis(0, 1, 0, (tail.yaw || 0) * DEG, T.a), qAxis(1, 0, 0, (tail.pitch || 0) * DEG, T.b), T.c);
    qFlightToOwl(T.c, R[I.tail]);
    const tailFan = Number.isFinite(tail.fan) ? tail.fan : 1;
    for (let side = 0; side < 2; side += 1) {
        const sfx = side === 0 ? 'L' : 'R';
        for (let i = 0; i < OWL_RECTRICES; i += 1) {
            const out = R[I[`rectrix${sfx}${i + 1}`]];
            qFlightToOwl(qAxis(0, 1, 0, -rectrixAngle(i) * (tailFan - 1) * DEG, T.a), out);
            if (side === 1) qMirror(out, out);
        }
    }
    wing(frame, pose.wings[0], 0);
    wing(frame, pose.wings[1], 1);
    legs(frame, pose, 0);
    legs(frame, pose, 1);
    const puff = clamp01(pose.puff);
    const ruffle = Math.max(0, pose.ruffle || 0);
    frame.scales.throat[0] = 1 + puff * 0.45;
    frame.scales.throat[1] = 1 + puff * 0.25;
    frame.scales.throat[2] = 1 + puff * 0.7;
    const fluff = 1 + ruffle * 0.07;
    frame.scales.chest[0] = fluff;
    frame.scales.chest[1] = 1 + ruffle * 0.03;
    frame.scales.chest[2] = fluff;
    frame.scales.pelvis[0] = fluff;
    frame.scales.pelvis[1] = 1 + ruffle * 0.03;
    frame.scales.pelvis[2] = fluff;
    const stretch = 1 + Math.max(-0.2, Math.min(0.6, (pose.neck || 0) / 0.04)) * 0.25;
    frame.scales.neck1[0] = 1 / Math.sqrt(stretch);
    frame.scales.neck1[1] = stretch;
    frame.scales.neck1[2] = 1 / Math.sqrt(stretch);
    return frame;
}

/**
 * The body's attitude as a turn of the root: its axis raised `pitch` degrees above level (the rest pose's
 * perched owl is pitch OWL_POSTURE), rolled `bank` degrees (+ rolls to its left: the left wing drops,
 * as in a turn to the left), turned `heading` degrees about y.
 */
export function owlFlightBody(heading, pitch, bank, out = [0, 0, 0, 1]) {
    // The rest pose's upright body laid level (a turn of +POSTURE about x), then rolled, pitched, turned.
    qEuler(heading, -pitch, -bank, out);
    return qMul(out, qAxis(1, 0, 0, OWL_POSTURE * DEG, T.a), out);
}
