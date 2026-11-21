/**
 * Himalayan Peak — how the eagle flies. Three-free (tests and captures ask it directly).
 *
 * The bird works an elliptical thermal whose centre, radius and height change with the air.
 * A strengthening updraft periodically brings the near arc past the shoulder. Each run gets
 * its own air; a seed and clock reproduce the pose exactly for seeking and captures.
 *
 * The bird's frame: x to its left, y up, z forward (the model's, see
 * scripts/blender/himalayan_eagle.py). Joint angles are radians, applied in the order z, y, x
 * about the bone's own axes (three's Euler order 'ZYX'): about z is a wing's dihedral and its
 * beat, about y its sweep (positive swings a left wing back), about x its twist.
 */

import {
    EYE, GALE_REST, TAU, mulberry32,
} from './himalayan-peak-core.js';

const DEG = Math.PI / 180;

export const EAGLE_SPAN = 11;

/** One world owns one route. Its phases and periods are sampled once, away from the frame loop. */
export function createEagleRoute(seed = 3187) {
    const rand = mulberry32(seed);
    const bearing = (28 + 4 * rand()) * DEG;
    return {
        lateral: Math.cos(bearing),
        radial: Math.sin(bearing),
        orbit: TAU / (32 + 11 * rand()),
        surge: TAU / (87 + 32 * rand()),
        start: TAU * rand(),
        air: TAU * rand(),
        lift: TAU * rand(),
        wingClock: 3 + 13 * rand(),
    };
}
const REST_ROUTE = createEagleRoute();
const LEAN_GAIN = 2.5;
const LEAN_MAX = 0.78;
const G = 9.81;

/** Position in metres, in radial and lateral coordinates centred on the open sky beside the board. */
export function eaglePoint(time, out = { x: 0, y: 0, z: 0 }, route = REST_ROUTE, reduced = false) {
    const {
        orbit, surge, start, air, lift, radial, lateral,
    } = route;
    const angle = time * orbit + start + 0.28 * Math.sin(time * 0.053 + air);
    const updraft = 0.5 + 0.5 * Math.sin(time * surge + lift + 0.45 * Math.sin(time * 0.035 + air));
    // A wide thermal offshore, an oblique pass along its near edge, then a climb back out.
    const near = 207 - (reduced ? 32 : 153) * updraft * updraft;
    const far = 343 + 38 * Math.sin(time * 0.041 + air);
    const depth = near + (far - near) * (0.5 + 0.5 * Math.cos(angle));
    const reach = (40 + 8 * Math.sin(time * 0.072 + lift)) * Math.sqrt(near / 155);
    // Approach along the strip between the score panel and the skyline at the right edge.
    // Use a C² curve. A kink in acceleration makes the bank snap at either edge.
    const nearBias = Math.max(0, Math.min(1, (210 - depth) / 130));
    const inside = 0.063 * nearBias ** 3 * (10 + nearBias * (6 * nearBias - 15));
    const cross = reach * Math.sin(angle) + depth * (0.044 * Math.sin(time * 0.065 + start) - inside);
    const climb = 0.272 + 0.026 * Math.sin(time * 0.047 + start) + 0.018 * Math.sin(angle - 0.8);
    out.x = EYE.x + depth * radial + cross * lateral;
    out.z = EYE.z - depth * lateral + cross * radial;
    out.y = EYE.y + depth * climb + 1.6 * Math.sin(angle + lift);
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
}, route = REST_ROUTE, reduced = false) {
    eaglePoint(time - H, pa, route, reduced);
    eaglePoint(time, pb, route, reduced);
    eaglePoint(time + H, pc, route, reduced);
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
export function eagleBout(time, out = { amount: 0, phase: 0 }, route = REST_ROUTE) {
    // Each 24-second interval holds one opportunity for a short bout (or a glide throughout).
    // The live rate is constant for the duration of a bout, even many hours after a scene seek.
    const clock = time + route.wingClock;
    const leg = Math.floor(clock / 24);
    const local = clock - leg * 24;
    const air = Math.sin(leg * 2.39996 + route.air);
    const start = 8.5 + 5.2 * Math.sin(leg * 1.413 + route.lift);
    const rate = 1.28 + 0.18 * Math.sin(leg * 1.217 + route.start);
    const beats = 2 + Math.floor((air + 1) * 1.7);
    const into = (local - start) * rate;
    out.amount = air < -0.84 || into <= 0 || into >= beats ? 0
        : smooth(0, 0.62, into) * smooth(0, 0.62, beats - into);
    out.phase = out.amount > 0 ? wrap01(into) : 0;
    return out;
}

/** Wing height through the Blender stroke, used by the body's counter-motion. */
export function beatHeight(phase) {
    const p = wrap01(phase);
    return p < 0.44 ? Math.cos(Math.PI * (p / 0.44)) : -Math.cos(Math.PI * ((p - 0.44) / 0.56));
}

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
export function eagleFlight(time, air = {}, pose = createEaglePose()) {
    const { gale = GALE_REST, reduced = false, route = REST_ROUTE } = air;
    const path = eaglePath(time, pose.path, route, reduced);
    const bout = eagleBout(time, pose.bout, route);
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
    pose.heave = -0.05 * beatHeight(p - 0.12) * flap;

    // ── The glide: a shallow V, wrists forward, the hand turned up, tucked a little in wind ──
    const tuck = (0.12 + 0.55 * wind) * calm + (reduced ? 0.12 : 0);
    const breathe = Math.sin(time * 0.23 + 0.6) * 2 * calm;
    const load = 0.6 + 0.4 * Math.min(1, Math.abs(path.lean) / 0.35);
    const turn = Math.max(-1, Math.min(1, path.lean / 0.3));

    // The air sets the glide; the rig blends its authored power stroke into this trim.
    const { joints } = pose;
    for (let side = 0; side < 2; side++) {
        const [sfx, sign] = SIDES[side];
        const lift = sign * answer;
        const trim = (2.2 * turn + 1.8 * Math.sin(time * 0.61 + route.air)) * sign * calm;
        setJoint(joints, `arm${sfx}`, 0, sign * (-3 + tuck * 14 + breathe), sign * (7 + lift));
        setJoint(joints, `fore${sfx}`, 0, sign * (tuck * 6 + trim), sign * (-2 + trim * 0.5));
        setJoint(joints, `hand${sfx}`, 2 + trim, sign * (-4 + tuck * 16 - breathe * 0.5), sign * (4 + trim));
        const fingers = FINGER_BONES[side];
        for (let j = 0; j < EAGLE_FINGERS; j++) {
            const reach = 0.55 + 0.12 * j;
            const flick = Math.sin(time * 5.3 + j * 1.7 + side * 2.1) * 1.5 * wind * calm;
            const curl = (9 + 6 * load) * reach * (1 - tuck * 0.4) + flick;
            const spread = (j - 3) * 0.95 * (1 - tuck * 0.6) + trim * reach;
            setJoint(joints, fingers[j], 0, sign * spread, sign * curl);
        }
    }

    // ── Tail: fanned more in a tight turn and on the beat, twisted into the turn ──
    const fan = (5.5 + 6 * Math.abs(turn) - 4 * tuck) * glide + 12 * flap;
    const rudder = 2.7 * turn + Math.sin(time * 0.72 + route.air) * calm;
    setJoint(pose.joints, 'tail', 3 * flap * height, 0, -6 * turn);
    setJoint(pose.joints, 'tailL', 0, -fan + rudder, 0);
    setJoint(pose.joints, 'tailR', 0, fan + rudder, 0);

    // ── Body and head: the head looks into the turn and holds the horizon level ──
    setJoint(pose.joints, 'root', 2.5 * height * flap, 0, 0);
    const look = 14 * turn + (10 * Math.sin(time * 0.31 + 0.5) + 5 * Math.sin(time * 0.83 + 2.2)) * calm;
    const level = -pose.roll / DEG;
    setJoint(pose.joints, 'neck', 0, look * 0.4, level * 0.35);
    setJoint(pose.joints, 'head', -3 * flap * height, look * 0.6, level * 0.45);
    return pose;
}
