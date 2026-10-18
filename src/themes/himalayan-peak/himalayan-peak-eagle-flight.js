/**
 * Himalayan Peak — how the eagle flies. Three-free (tests and captures ask it directly).
 *
 * A golden eagle working the updraft off the pass, out in the open sky right of the board where
 * the sun comes up: it circles in a thermal that carries it slowly round a wider loop, leans into
 * every turn, rides the air on a shallow V with its primaries splayed and curled up by the load,
 * corrects the small rolls the air gives it, and a few times a round puts in a short bout of
 * deep, slow wingbeats. Everything is closed form in the world clock, so a seek shows the same
 * bird in the same place with the same wings; the clock is only ever multiplied by constants.
 * The wind changes how hard the air works the bird (amplitudes), never how fast anything runs.
 *
 * The bird's frame: x to its left, y up, z forward (the model's, see
 * scripts/blender/himalayan_eagle.py). Joint angles are radians, applied in the order z, y, x
 * about the bone's own axes (three's Euler order 'ZYX'): about z is a wing's dihedral and its
 * beat, about y its sweep (positive swings a left wing back), about x its twist.
 */

import { EYE, GALE_REST, TAU } from './himalayan-peak-core.js';

const DEG = Math.PI / 180;

/** Seconds one round of its flight takes; three turns of the thermal fit in it. */
export const EAGLE_ROUND = 84;
export const EAGLE_TURNS = 3;
/**
 * The wingspan as drawn (m): five times life, as a long lens shows it. Against the open sky
 * nothing tells its distance, only its size on the screen does: about 35 to 55 px across at
 * 1080p.
 */
export const EAGLE_SPAN = 11;
/** Wingbeats a second in a bout. */
export const EAGLE_BEAT = 1.6;
/**
 * The bouts of wingbeats in a round: [start (s into the round), beats]. Two come on the near
 * side of the circle, where the beat is seen best, one as it turns up into the wind far out.
 */
export const EAGLE_BOUTS = Object.freeze([[14.0, 4], [40.0, 3], [69.5, 5]]);

/** The thermal: where it is centred (bearing right of the view axis, distance), its turn radius
 * and its height over the eye (m). */
const CIRCLE = Object.freeze({
    bearing: 30 * DEG, distance: 300, radius: 52, height: 76,
});
/** The slow loop the thermal itself makes over a round, and the lean of each turn (m). */
const DRIFT = Object.freeze({
    x: 20, z: 32, height: 12, tilt: 6,
});
const CENTRE_X = EYE.x + Math.sin(CIRCLE.bearing) * CIRCLE.distance;
const CENTRE_Z = EYE.z - Math.cos(CIRCLE.bearing) * CIRCLE.distance;
/**
 * How much more the bird leans than a coordinated turn of its size needs. A thermalling eagle
 * banks 25° to 45°; so steep a lean shows the eye the whole spread of its wings on the near
 * side of every turn, where a level bird would be a line.
 */
const LEAN_GAIN = 2.8;
const LEAN_MAX = 0.78;
const G = 9.81;

/** The eagle's place on its round at `time` (design space, metres). */
export function eaglePoint(time, out = { x: 0, y: 0, z: 0 }) {
    const phi = (time / EAGLE_ROUND) * TAU * EAGLE_TURNS + 0.9;
    const psi = (time / EAGLE_ROUND) * TAU;
    out.x = CENTRE_X + Math.cos(phi) * CIRCLE.radius + Math.sin(psi) * DRIFT.x;
    out.z = CENTRE_Z - Math.sin(phi) * CIRCLE.radius + Math.cos(psi + 0.7) * DRIFT.z;
    out.y = EYE.y + CIRCLE.height + Math.sin(psi + 1.2) * DRIFT.height + Math.sin(phi + 0.3) * DRIFT.tilt;
    return out;
}

const pa = { x: 0, y: 0, z: 0 };
const pb = { x: 0, y: 0, z: 0 };
const pc = { x: 0, y: 0, z: 0 };
const H = 0.02;

/**
 * Where the eagle is at `time`: position, heading (unit) and lean (radians, positive with its
 * left wing down; it leans into its turn by what the turn asks, a little more for the eye).
 */
export function eaglePath(time, out = {
    x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 1, lean: 0,
}) {
    eaglePoint(time - H, pa);
    eaglePoint(time, pb);
    eaglePoint(time + H, pc);
    const vx = (pc.x - pa.x) / (2 * H);
    const vy = (pc.y - pa.y) / (2 * H);
    const vz = (pc.z - pa.z) / (2 * H);
    const speed = Math.hypot(vx, vy, vz) || 1;
    out.x = pb.x;
    out.y = pb.y;
    out.z = pb.z;
    out.hx = vx / speed;
    out.hy = vy / speed;
    out.hz = vz / speed;
    // The turn: the acceleration toward the bird's left, over the ground.
    const ax = (pc.x - 2 * pb.x + pa.x) / (H * H);
    const az = (pc.z - 2 * pb.z + pa.z) / (H * H);
    const flat = Math.hypot(out.hx, out.hz) || 1;
    const toLeft = (ax * out.hz - az * out.hx) / flat;
    out.lean = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, Math.atan(toLeft / G) * LEAN_GAIN));
    out.speed = speed;
    return out;
}

const smooth = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};
const wrap01 = (x) => x - Math.floor(x);

/**
 * The bout of wingbeats under way at `time`: how far into it the wings are (0..1, eased in and
 * out over half a beat) and the beat's phase (0 = wings at the top, the downstroke first).
 */
export function eagleBout(time, out = { amount: 0, phase: 0 }) {
    const local = wrap01(time / EAGLE_ROUND) * EAGLE_ROUND;
    out.amount = 0;
    out.phase = 0;
    for (let i = 0; i < EAGLE_BOUTS.length; i++) {
        const [start, beats] = EAGLE_BOUTS[i];
        const into = local - start;
        const length = beats / EAGLE_BEAT;
        if (into < 0 || into > length) continue;
        const ease = 0.5 / EAGLE_BEAT;
        out.amount = smooth(0, ease, into) * smooth(length, length - ease, into);
        out.phase = wrap01(into * EAGLE_BEAT);
        break;
    }
    return out;
}

/** Wing height through a beat: 1 at the top, -1 at the bottom; a quicker, stronger downstroke. */
const DOWN = 0.55;
export function beatHeight(phase) {
    const p = wrap01(phase);
    return p < DOWN ? Math.cos((Math.PI * p) / DOWN) : -Math.cos((Math.PI * (p - DOWN)) / (1 - DOWN));
}
/** 0..1: how far the wing is folded (only on the way up). */
const beatFold = (phase) => {
    const p = wrap01(phase);
    if (p < DOWN) return 0;
    const s = Math.sin((Math.PI * (p - DOWN)) / (1 - DOWN));
    return s * s;
};
/** 0..1: the push of the downstroke. */
const beatPush = (phase) => {
    const p = wrap01(phase);
    return p < DOWN ? Math.sin((Math.PI * p) / DOWN) : 0;
};

/** The small rolls the air gives a soaring bird (degrees), before the gale's share. */
const teeter = (t) => 2.0 * Math.sin(1.13 * t + 0.4) + 1.2 * Math.sin(2.07 * t + 1.9) + 0.6 * Math.sin(3.31 * t + 0.7);

export const EAGLE_FINGERS = 7;
const SIDES = [['L', 1], ['R', -1]];
const FINGER_BONES = SIDES.map(([sfx]) => Array.from({ length: EAGLE_FINGERS }, (_, j) => `f${j}${sfx}`));
/** Every joint the pose sets, in the model's skeleton. */
export const EAGLE_BONES = Object.freeze([
    'root', 'neck', 'head', 'tail', 'tailL', 'tailR',
    ...SIDES.flatMap(([sfx], s) => [`arm${sfx}`, `fore${sfx}`, `hand${sfx}`, ...FINGER_BONES[s]]),
]);

/** A pose: every joint's [x, y, z] (radians), the body's frame and its heave. */
export function createEaglePose() {
    const joints = {};
    EAGLE_BONES.forEach((name) => { joints[name] = [0, 0, 0]; });
    return {
        joints,
        path: {
            x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 1, lean: 0, speed: 0,
        },
        bout: { amount: 0, phase: 0 },
        /** The body's axes in design space: its left, its up, its forward (unit). */
        left: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, 1],
        /** How far the body rides up and down with the beat (m at the model's own size). */
        heave: 0,
        /** The roll the body carries (radians, positive left wing up): lean and the air's. */
        roll: 0,
    };
}

const setJoint = (joints, name, x, y, z) => {
    const j = joints[name];
    j[0] = x * DEG;
    j[1] = y * DEG;
    j[2] = z * DEG;
};

/**
 * The whole bird at `time`.
 * @param {number} time            world clock (s)
 * @param {object} [air]
 * @param {number} [air.gale]      the world's eased gale (GALE_REST at rest)
 * @param {boolean} [air.reduced]  reduced motion: it glides, and the air hardly moves it
 * @param {object} [pose]          createEaglePose() to write into
 */
export function eagleFlight(time, { gale = GALE_REST, reduced = false } = {}, pose = createEaglePose()) {
    const path = eaglePath(time, pose.path);
    const bout = eagleBout(time, pose.bout);
    if (reduced) bout.amount = 0;
    const flap = bout.amount;
    const glide = 1 - flap;
    const wind = smooth(GALE_REST, GALE_REST + 1.2, gale);
    const calm = reduced ? 0.3 : 1;

    // ── The air's small rolls, and the wing that answers each a moment later ──
    const sway = teeter(time) * (0.45 + 0.9 * wind) * glide * calm;
    const answer = -teeter(time - 0.3) * (0.45 + 0.9 * wind) * glide * calm * 0.9;
    pose.roll = -path.lean + sway * DEG;

    // ── The body's frame: heading, then the roll about it (never a flip: up stays up) ──
    const { hx, hy, hz } = path;
    const flat = Math.hypot(hx, hz) || 1;
    const lx = hz / flat;
    const lz = -hx / flat;
    // up0 = forward × left0
    const ux = hy * lz;
    const uy = hz * lx - hx * lz;
    const uz = -hy * lx;
    const c = Math.cos(pose.roll);
    const s = Math.sin(pose.roll);
    pose.left[0] = lx * c + ux * s;
    pose.left[1] = uy * s;
    pose.left[2] = lz * c + uz * s;
    pose.up[0] = -lx * s + ux * c;
    pose.up[1] = uy * c;
    pose.up[2] = -lz * s + uz * c;
    pose.forward[0] = hx;
    pose.forward[1] = hy;
    pose.forward[2] = hz;

    // ── The beat ──
    const p = bout.phase;
    const height = beatHeight(p);
    const tip = beatHeight(p - 0.07); // the hand follows the arm a little late
    const fold = beatFold(p);
    const push = beatPush(p);
    pose.heave = -0.05 * beatHeight(p - 0.12) * flap;

    // ── The glide: a shallow V, wrists forward, the hand turned up, tucked a little in wind ──
    const tuck = (0.12 + 0.55 * wind) * calm + (reduced ? 0.12 : 0);
    const breathe = Math.sin(time * 0.23 + 0.6) * 2 * calm;
    const load = 0.6 + 0.4 * Math.min(1, Math.abs(path.lean) / 0.35);
    const turn = Math.max(-1, Math.min(1, path.lean / 0.3));

    // Each angle is the glide's and the beat's, mixed by how far into a bout the bird is; the
    // right wing mirrors the left (its turns about y and z are negated).
    const mix = (a, b) => a * glide + b * flap;
    const { joints } = pose;
    for (let side = 0; side < 2; side++) {
        const [sfx, sign] = SIDES[side];
        const lift = sign * answer; // + raises this wing
        const armSweep = mix(-3 + tuck * 14 + breathe, -5 * push + 16 * fold);
        const armBeat = mix(7 + lift, 6 + 38 * height);
        setJoint(joints, `arm${sfx}`, 0, sign * armSweep, sign * armBeat);
        setJoint(joints, `fore${sfx}`, 0, sign * mix(tuck * 6, 10 * fold), sign * mix(-2, -2 + 4 * tip));
        const handTwist = mix(2, 7 * push - 22 * fold);
        const handSweep = mix(-4 + tuck * 16 - breathe * 0.5, -4 + 30 * fold);
        setJoint(joints, `hand${sfx}`, handTwist, sign * handSweep, sign * mix(4, 18 * tip));
        const fingers = FINGER_BONES[side];
        for (let j = 0; j < EAGLE_FINGERS; j++) {
            const reach = 0.55 + 0.12 * j;
            const flick = Math.sin(time * 5.3 + j * 1.7 + side * 2.1) * 1.5 * wind * calm;
            const curl = (9 + 6 * load) * reach * (1 - tuck * 0.4) + flick;
            const spread = mix((j - 3) * 1.8 * (1 - tuck * 0.6), (j - 3) * (1.2 + 2.6 * fold));
            setJoint(joints, fingers[j], 0, sign * spread, sign * mix(curl, (14 * push - 8 * fold) * reach));
        }
    }

    // ── Tail: fanned more in a tight turn and on the beat, twisted into the turn ──
    const fan = (10 + 8 * Math.abs(turn) - 7 * tuck) * glide + 16 * flap;
    setJoint(pose.joints, 'tail', 3 * flap * height, 0, -6 * turn);
    setJoint(pose.joints, 'tailL', 0, -fan, 0);
    setJoint(pose.joints, 'tailR', 0, fan, 0);

    // ── Body and head: the head looks into the turn and holds the horizon level ──
    setJoint(pose.joints, 'root', 2.5 * height * flap, 0, 0);
    const look = 14 * turn + (10 * Math.sin(time * 0.31 + 0.5) + 5 * Math.sin(time * 0.83 + 2.2)) * calm;
    const level = -pose.roll / DEG;
    setJoint(pose.joints, 'neck', 0, look * 0.4, level * 0.35);
    setJoint(pose.joints, 'head', -3 * flap * height, look * 0.6, level * 0.45);
    return pose;
}
