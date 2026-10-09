/**
 * A fox's body: how a skeleton of a fox's shape carries a pose. Three-free and renderer-free.
 *
 * Shared by the themes that keep a fox (Winter's arctic fox, Sakura Twilight's pair): each
 * brings its own skeleton — the same bones, its own proportions — and its own mind; this is
 * what turns "it trots at 1.5 m/s, 0.3 of a cycle in" or "it is two seconds into sitting down"
 * into a rotation for every bone.
 *
 * Nothing here is a recorded clip. A fox is animated the way it is built:
 *  - its feet are placed on the ground and its legs are solved to reach them (two-bone inverse
 *    kinematics), so a planted paw stays where it was put while the body moves over it;
 *  - its gait is footfalls, not a loop: a trot of diagonal pairs that opens into a gallop as it
 *    speeds up, each paw on the ground for exactly as long as the ground it covers, so nothing
 *    slides at a steady pace;
 *  - its back is three bones and bends: it arches in the gallop, rounds when it sits, and curls
 *    nose to tail when it sleeps;
 *  - everything it does at a stop is a pose written as a handful of numbers — a "spec" — so any
 *    two of them blend, and nothing snaps.
 *
 * The skeleton a rig is made for: `hips` (the root) → `spine` → `chest` → `neck` → `head`;
 * `tail1` … `tailN` from the hips; `armL/R` → `foreL/R` → `handL/R` from the chest;
 * `thighL/R` → `shinL/R` → `hockL/R` from the hips. Model metres, +z ahead, +y up, +x its
 * left, every bone axis-aligned at rest — so a bone's rotation in the model's frame IS its pose.
 */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Hermite step between two edges (either order). */
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
const hold = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));

// ── Quaternions (x, y, z, w) and vectors as plain arrays ────────────────────────

export function qMul(a, b, out = [0, 0, 0, 1]) {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
}

/** Rotate a vector by a unit quaternion. */
export function qRotate(q, v, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    const ox = v[0] + w * tx + (y * tz - z * ty);
    const oy = v[1] + w * ty + (z * tx - x * tz);
    const oz = v[2] + w * tz + (x * ty - y * tx);
    out[0] = ox;
    out[1] = oy;
    out[2] = oz;
    return out;
}

/**
 * A rotation in the model's own terms: yaw (about +y: + turns its nose to its left), then pitch
 * (about +x: + puts its nose down), then roll (about +z: + drops its right side, its left
 * comes up).
 */
export function qTurn(yaw, pitch, roll, out = [0, 0, 0, 1]) {
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    const cr = Math.cos(roll / 2);
    const sr = Math.sin(roll / 2);
    // q = qy · qx · qz
    out[0] = cy * sp * cr + sy * cp * sr;
    out[1] = sy * cp * cr - cy * sp * sr;
    out[2] = cy * cp * sr - sy * sp * cr;
    out[3] = cy * cp * cr + sy * sp * sr;
    return out;
}

/** The shortest rotation that takes unit vector `a` onto unit vector `b`. */
export function qBetween(a, b, out = [0, 0, 0, 1]) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d < -0.999999) {
        // Opposite: half a turn about an axis across `a` — the animal's own side-to-side axis
        // when `a` lies across that (its legs fold about it), else its up axis.
        const sideways = Math.abs(a[0]) < 0.9;
        const along = sideways ? a[0] : a[1];
        const x = (sideways ? 1 : 0) - a[0] * along;
        const y = (sideways ? 0 : 1) - a[1] * along;
        const z = -a[2] * along;
        const l = Math.hypot(x, y, z) || 1;
        out[0] = x / l;
        out[1] = y / l;
        out[2] = z / l;
        out[3] = 0;
        return out;
    }
    const x = a[1] * b[2] - a[2] * b[1];
    const y = a[2] * b[0] - a[0] * b[2];
    const z = a[0] * b[1] - a[1] * b[0];
    const w = 1 + d;
    const l = Math.hypot(x, y, z, w) || 1;
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
    out[3] = w / l;
    return out;
}

export function qSlerp(a, b, t, out = [0, 0, 0, 1]) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const sign = d < 0 ? -1 : 1;
    d *= sign;
    let ka = 1 - t;
    let kb = t;
    if (d < 0.9995) {
        const theta = Math.acos(d);
        const s = Math.sin(theta);
        ka = Math.sin((1 - t) * theta) / s;
        kb = Math.sin(t * theta) / s;
    }
    const x = a[0] * ka + b[0] * kb * sign;
    const y = a[1] * ka + b[1] * kb * sign;
    const z = a[2] * ka + b[2] * kb * sign;
    const w = a[3] * ka + b[3] * kb * sign;
    const l = Math.hypot(x, y, z, w) || 1;
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
    out[3] = w / l;
    return out;
}

// ── What a pose is ──────────────────────────────────────────────────────────────

/** Its legs, in the order a spec lists its feet: [name, upper bone, lower bone, last bone, paw mark, carried by]. */
export const FOX_LEGS = Object.freeze([
    Object.freeze(['FL', 'armL', 'foreL', 'handL', 'pawFL', 'chest']),
    Object.freeze(['FR', 'armR', 'foreR', 'handR', 'pawFR', 'chest']),
    Object.freeze(['BL', 'thighL', 'shinL', 'hockL', 'pawBL', 'hips']),
    Object.freeze(['BR', 'thighR', 'shinR', 'hockR', 'pawBR', 'hips']),
]);

/**
 * A pose is a "spec": these numbers, all zero when it stands. Metres are model metres.
 *
 *  rear, fore   how far its hips and its chest are lowered (the back pitches to suit)
 *  shift, sway  the body moved ahead / to its left over its feet
 *  pitch, roll, yaw   the whole trunk turned (+ nose down, + right side down, + nose left)
 *  arch         the back rounded (+) or hollowed (−)
 *  bend         the back curled to its left (+): head and tail come round that side
 *  twist        chest rolled against hips
 *  headYaw, headPitch, headRoll   where its head is turned (+ left, + up, + left ear up),
 *               measured from its chest's facing but held level against the trunk's pitch and roll
 *  reach        the neck lowered and stretched out (+)
 *  tailYaw, tailLift, tailCurl    the tail swung to its left, raised, curled round to its left
 *  tailFree     how far the tail lies as it likes whatever the hips do (1: sitting, it stays
 *               on the ground though the hips tip back)
 *  and for each foot (FOX_LEGS order): dx, dy, dz where its paw is from where it stands,
 *  toe (+ heel raised, − heel laid down), air (0 on the ground .. 1 carried by the body).
 */
export const SPEC = Object.freeze({
    rear: 0,
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
    tailYaw: 14,
    tailLift: 15,
    tailCurl: 16,
    tailFree: 17,
    feet: 18,
});
/** Where a foot's numbers are in a spec: `FOOT.FL + FOOT.dz` is the left forepaw's reach ahead. */
export const FOOT = Object.freeze({
    size: 5,
    dx: 0,
    dy: 1,
    dz: 2,
    toe: 3,
    air: 4,
    FL: SPEC.feet,
    FR: SPEC.feet + 5,
    BL: SPEC.feet + 10,
    BR: SPEC.feet + 15,
});
export const SPEC_SIZE = SPEC.feet + FOX_LEGS.length * FOOT.size;
export const createFoxSpec = () => new Float64Array(SPEC_SIZE);

const {
    FL, FR, BL, BR,
} = FOOT;
const DX = FOOT.dx;
const DY = FOOT.dy;
const DZ = FOOT.dz;
const TOE = FOOT.toe;
const AIR = FOOT.air;
const STEP = FOOT.size;

// ── What it does at a stop ──────────────────────────────────────────────────────

/** Seconds each thing a fox does takes (`Run` is its gait: no act, any length). */
export const FOX_ACTS = Object.freeze({
    CurlSleep: 2.6667,
    Dig: 1.8,
    Greet: 2,
    Listen: 2.4,
    LookAround: 3.2,
    Pounce: 1.5333,
    Run: 0.8,
    Shake: 1,
    Sit: 6.4,
    Stretch: 2.4,
});

/** The pounce: when it leaves the ground and when it lands (seconds into the act). */
export const POUNCE_AIR = Object.freeze([0.42, 1.08]);
/** Seconds into `CurlSleep` by which it lies curled (a mind holds it there). */
export const SLEEP_HOLD = 1.6;

/**
 * The acts every fox knows: (spec, seconds into it, size). Lengths are written for a fox the
 * size of the arctic one and multiplied by `k` for another; angles are angles.
 */
export const FOX_COMMON_ACTS = Object.freeze({
    /** It stands and turns its head one way, then the other. */
    LookAround(s, t, k) {
        const e = smooth(0.15, 0.75, t) - 2 * smooth(1.3, 2, t) + smooth(2.55, 3.15, t);
        s[SPEC.headYaw] = 0.92 * e;
        s[SPEC.headPitch] = 0.05 + 0.1 * Math.abs(e);
        s[SPEC.headRoll] = -0.07 * e;
        s[SPEC.yaw] = 0.07 * e;
        s[SPEC.sway] = 0.01 * k * e;
        s[SPEC.tailYaw] = -0.22 * e;
        s[SPEC.tailLift] = 0.12;
    },
    /** It has heard something under the snow or the grass: head low and cocked, one forepaw raised. */
    Listen(s, t, k) {
        const on = hold(t, 0, 0.4, 2.1, 2.4);
        const tilt = smooth(0.4, 0.62, t) - 2 * smooth(1.1, 1.36, t) + smooth(1.85, 2.1, t);
        s[SPEC.headPitch] = -0.42 * on;
        s[SPEC.reach] = 0.3 * on;
        s[SPEC.headRoll] = 0.4 * tilt * on;
        s[SPEC.shift] = -0.012 * k * on;
        s[SPEC.fore] = 0.01 * k * on;
        s[FL + DY] = 0.07 * k * on;
        s[FL + DZ] = 0.03 * k * on;
        s[FL + TOE] = 1.05 * on;
        s[SPEC.tailLift] = 0.28 * on;
    },
    /** It gathers, leaps, and comes down nose and forepaws first. */
    Pounce(s, t, k) {
        const coil = hold(t, 0, 0.3, 0.36, 0.5);
        const fly = hold(t, 0.4, 0.5, 0.98, 1.12);
        const dive = smooth(0.3, 0.92, clamp01((t - POUNCE_AIR[0]) / (POUNCE_AIR[1] - POUNCE_AIR[0])));
        // (It stays down where it landed: what follows — digging, or running on — takes it up.)
        const land = smooth(1.0, 1.16, t);
        s[SPEC.rear] = 0.075 * k * coil;
        s[SPEC.fore] = (0.05 * coil + 0.11 * land) * k;
        s[SPEC.shift] = (-0.05 * coil + 0.025 * land) * k;
        s[SPEC.arch] = 0.3 * coil + 0.3 * fly * dive - 0.12 * land;
        s[SPEC.pitch] = fly * (-0.5 + 1.35 * dive);
        s[SPEC.headPitch] = -0.2 * coil + fly * (0.25 - 0.8 * dive) - 0.8 * land;
        s[SPEC.reach] = 0.2 * coil + 0.45 * fly * dive + 0.68 * land;
        s[SPEC.tailLift] = 0.3 * coil + 0.85 * fly + 1.05 * land;
        for (let f = FL; f <= FR; f += STEP) {
            s[f + AIR] = fly;
            // (Tucked as it rises; in the dive they reach out along its body, down at the ground.)
            s[f + DY] = fly * (0.085 + 0.115 * dive) * k;
            s[f + DZ] = (fly * (-0.03 + 0.23 * dive) + 0.04 * land) * k;
            s[f + TOE] = 0.6 * fly * (1 - dive);
        }
        for (let f = BL; f <= BR; f += STEP) {
            s[f + AIR] = fly;
            s[f + DY] = 0.04 * k * fly;
            s[f + DZ] = fly * (-0.05 - 0.07 * dive) * k;
            s[f + TOE] = 0.9 * fly;
        }
    },
    /** Nose in the ground, rump up, forepaws scraping turn about. */
    Dig(s, t, k) {
        // (It goes down in the cross-fade from whatever it did before: from a pounce it is there.)
        const on = 1 - smooth(1.5, 1.8, t);
        const w = TAU * 4.5 * t;
        s[SPEC.fore] = 0.105 * k * on;
        s[SPEC.rear] = -0.008 * k * on;
        s[SPEC.shift] = (0.02 + 0.006 * Math.sin(w * 2)) * k * on;
        s[SPEC.arch] = -0.12 * on;
        s[SPEC.headPitch] = -0.85 * on;
        s[SPEC.reach] = 0.68 * on;
        s[SPEC.headRoll] = 0.1 * Math.sin(w) * on;
        s[SPEC.tailLift] = 0.95 * on;
        s[SPEC.tailYaw] = 0.45 * Math.sin(TAU * 2.4 * t) * on;
        s[FL + DZ] = 0.045 * k * Math.sin(w) * on;
        s[FL + DY] = 0.035 * k * Math.max(0, Math.cos(w)) * on;
        s[FL + TOE] = 0.5 * Math.max(0, Math.cos(w)) * on;
        s[FR + DZ] = -0.045 * k * Math.sin(w) * on;
        s[FR + DY] = 0.035 * k * Math.max(0, -Math.cos(w)) * on;
        s[FR + TOE] = 0.5 * Math.max(0, -Math.cos(w)) * on;
    },
    /** It shakes itself: a roll that runs from its head down to the tip of its tail. */
    Shake(s, t, k) {
        const on = hold(t, 0, 0.12, 0.68, 0.98);
        const w = TAU * 5.5 * t;
        s[SPEC.headRoll] = 0.5 * Math.sin(w) * on;
        s[SPEC.headPitch] = -0.1 * on;
        s[SPEC.twist] = 0.5 * Math.sin(w - 0.9) * on;
        s[SPEC.roll] = 0.1 * Math.sin(w - 0.5) * on;
        s[SPEC.tailYaw] = 0.55 * Math.sin(w - 2.2) * on;
        s[SPEC.tailLift] = 0.4 * on;
        s[SPEC.rear] = 0.03 * k * on;
        s[SPEC.fore] = 0.03 * k * on;
    },
    /** A bow with its forepaws out and its rump high, then a long lean forward over them. */
    Stretch(s, t, k) {
        const bow = hold(t, 0.05, 0.6, 1.05, 1.5);
        const lunge = hold(t, 1.15, 1.6, 1.95, 2.35);
        s[SPEC.fore] = (0.13 * bow + 0.03 * lunge) * k;
        s[SPEC.rear] = (-0.01 * bow + 0.04 * lunge) * k;
        s[SPEC.shift] = (-0.07 * bow + 0.07 * lunge) * k;
        s[SPEC.arch] = -0.3 * bow - 0.18 * lunge;
        s[SPEC.headPitch] = 0.3 * bow + 0.35 * lunge;
        s[SPEC.reach] = 0.25 * bow - 0.15 * lunge;
        s[SPEC.tailLift] = 1.0 * bow + 0.3 * lunge;
        s[FL + DZ] = 0.05 * k * bow;
        s[FR + DZ] = 0.05 * k * bow;
        s[BL + DZ] = -0.05 * k * lunge;
        s[BR + DZ] = -0.05 * k * lunge;
        s[BL + TOE] = 0.8 * lunge;
        s[BR + TOE] = 0.8 * lunge;
    },
    /** A bow to whoever is watching, tail going, and a small spring out of it. */
    Greet(s, t, k) {
        const bow = hold(t, 0.1, 0.4, 1.25, 1.55);
        const hop = Math.sin(clamp01((t - 1.5) / 0.42) * Math.PI);
        s[SPEC.fore] = 0.11 * k * bow;
        s[SPEC.rear] = (-0.01 * bow - 0.012 * hop) * k;
        s[SPEC.shift] = -0.03 * k * bow;
        s[SPEC.arch] = -0.2 * bow;
        s[SPEC.headPitch] = 0.42 * bow + 0.1 * hop;
        s[SPEC.tailLift] = 1.05 * bow + 0.5 * hop;
        s[SPEC.tailYaw] = 0.6 * Math.sin(TAU * 4.2 * t) * Math.min(1, bow + hop * 0.6);
        s[FL + DZ] = 0.04 * k * bow;
        s[FR + DZ] = 0.04 * k * bow;
    },
    /** It sits down, its tail round its feet, and looks up at the sky for a while. */
    Sit(s, t, k) {
        const down = hold(t, 0.1, 1.05, 5.5, 6.3);
        const up = hold(t, 1.3, 2.4, 4.7, 5.4);
        s[SPEC.rear] = 0.17 * k * down;
        s[SPEC.fore] = 0.046 * k * down;
        s[SPEC.shift] = -0.035 * k * down;
        s[SPEC.arch] = 0.4 * down;
        s[SPEC.headPitch] = 0.1 * down + 0.5 * up;
        s[SPEC.headRoll] = 0.16 * Math.sin(t * 1.1) * up;
        s[SPEC.headYaw] = 0.25 * Math.sin(t * 0.7 + 0.5) * up;
        s[SPEC.tailCurl] = 2.0 * down;
        s[SPEC.tailLift] = 0.85 * down;
        s[SPEC.tailFree] = down;
        s[FL + DZ] = -0.09 * k * down;
        s[FR + DZ] = -0.09 * k * down;
        s[BL + DZ] = 0.05 * k * down;
        s[BR + DZ] = 0.05 * k * down;
        s[BL + TOE] = -1.2 * down;
        s[BR + TOE] = -1.2 * down;
        s[BL + DX] = 0.02 * k * down;
        s[BR + DX] = -0.02 * k * down;
    },
    /** It lies down and curls up, nose round to its tail. */
    CurlSleep(s, t, k) {
        const down = smooth(0, SLEEP_HOLD - 0.1, t);
        const curl = smooth(0.35, SLEEP_HOLD, t);
        s[SPEC.rear] = 0.2 * k * down;
        s[SPEC.fore] = 0.19 * k * down;
        s[SPEC.arch] = 0.25 * curl;
        s[SPEC.bend] = 1.1 * curl;
        s[SPEC.roll] = 0.12 * curl;
        s[SPEC.headYaw] = 1.15 * curl;
        s[SPEC.headPitch] = -0.5 * curl;
        s[SPEC.headRoll] = 0.3 * curl;
        s[SPEC.reach] = 0.45 * curl;
        s[SPEC.tailCurl] = 2.5 * curl;
        s[SPEC.tailLift] = 0.4 * down;
        // (Its paws are drawn up under it, not left down in the ground it lies on.)
        for (let f = FL; f <= BR; f += STEP) {
            s[f + AIR] = down;
            s[f + DY] = 0.185 * k * down;
            s[f + DZ] = (f < BL ? 0.04 : 0.06) * k * down;
        }
    },
});

// ── A rig: one skeleton, and everything it can be asked ─────────────────────────

/** How a tail of so many bones shares out its swing, its curl and its lift. */
const TAILS = Object.freeze({
    3: Object.freeze({ swing: [0.5, 0.36, 0.3], curl: [0.3, 0.38, 0.32], lift: [0.58, 0.28, 0.14] }),
    4: Object.freeze({ swing: [0.45, 0.3, 0.25, 0.2], curl: [0.2, 0.3, 0.28, 0.22], lift: [0.55, 0.25, 0.12, 0.08] }),
});

/**
 * @param {object} o
 * @param {Array} o.bones   every bone at rest: [name, parent, x, y, z] (see the top of the file)
 * @param {object} o.marks  points that are not joints, at rest: nose, tailTip, pawFL, pawFR,
 *                          pawBL, pawBR (where each paw meets the ground)
 * @param {number} [o.scale=1]  world metres to a model metre (how much larger than life it is drawn)
 * @param {number} [o.size=1]   its size against the arctic fox's: the lengths in the common acts
 *                              and in the gait are multiplied by it
 * @param {number} [o.foreAt]   the z (at rest) of the place `fore` lowers; the chest joint's when not given
 * @param {object} [o.acts]     acts of its own, over or beside the common ones: name → (spec, t, size)
 * @param {object} [o.lengths]  seconds its own acts take
 * @param {object} [o.gait]     its paces: strideBase (model m), strideRate (s), stanceMost
 *                              (model m), dutyMost, dutyLeast, gallopFrom, gallopTo (model m/s),
 *                              crouch { rest, chain, margin } (model m)
 * @param {number} [o.headSteady=0.75]  how much of the trunk's pitch and roll its head does not take
 */
export function createFoxRig({
    bones, marks, scale = 1, size = 1, foreAt, acts = {}, lengths = {}, gait = {}, headSteady = 0.75,
}) {
    const index = Object.freeze(Object.fromEntries(bones.map((bone, i) => [bone[0], i])));
    const B = index;
    const REST = bones.map((bone) => [bone[2], bone[3], bone[4]]);
    const PARENT = bones.map((bone) => (bone[1] === null ? -1 : index[bone[1]]));
    const COUNT = bones.length;
    const k = size;
    const LEG = FOX_LEGS.map(([, upper, lower, last, paw, carrier], order) => {
        const u = B[upper];
        const l = B[lower];
        const e = B[last];
        const upperRest = [REST[l][0] - REST[u][0], REST[l][1] - REST[u][1], REST[l][2] - REST[u][2]];
        const lowerRest = [REST[e][0] - REST[l][0], REST[e][1] - REST[l][1], REST[e][2] - REST[l][2]];
        const l1 = Math.hypot(...upperRest);
        const l2 = Math.hypot(...lowerRest);
        return {
            u,
            l,
            e,
            carrier: B[carrier],
            paw: marks[paw],
            // From where the paw meets the ground up to its last joint.
            heel: [REST[e][0] - marks[paw][0], REST[e][1] - marks[paw][1], REST[e][2] - marks[paw][2]],
            upperDir: upperRest.map((v) => v / l1),
            lowerDir: lowerRest.map((v) => v / l2),
            l1,
            l2,
            // Which way round its own side-to-side axis the joint between folds: an elbow back
            // (and down, when the foreleg is reached out ahead), a knee forward (and up, sitting).
            fold: order < 2 ? -1 : 1,
        };
    });
    const TAIL = bones.map((bone, i) => (/^tail\d+$/.test(bone[0]) ? i : -1)).filter((i) => i >= 0);
    const tail = TAILS[TAIL.length];
    if (!tail) throw new Error(`a fox's tail is three or four bones, not ${TAIL.length}`);
    /** The back, from the hips to where `fore` lowers it (model metres). */
    const FORE_AT = foreAt ?? REST[B.chest][2];
    const BACK = FORE_AT - REST[B.hips][2];
    /** How far along that the middle of the back is. */
    const MID = (REST[B.spine][2] - REST[B.hips][2]) / BACK;

    // ── Its paces ──
    const fore = LEG[0];
    const pace = {
        strideBase: 0.1 * k,
        strideRate: 0.3,
        stanceMost: 0.2 * k,
        dutyMost: 0.52,
        dutyLeast: 0.16,
        gallopFrom: 2.2 * Math.sqrt(k),
        gallopTo: 3.4 * Math.sqrt(k),
        ...gait,
    };
    // Its forelegs are all but straight when it stands, so it reaches a long step by crouching:
    // how far its shoulder stands over its wrist, and how long the leg between them is.
    const crouch = {
        rest: REST[fore.u][1] - REST[fore.e][1],
        chain: (fore.l1 + fore.l2) * 0.9966,
        margin: 0.01 * k,
        ...(gait.crouch || {}),
    };
    /** A speed as the arctic fox would feel it: a larger animal is slower for its size. */
    const felt = (speed) => speed / scale / Math.sqrt(k);

    /** Metres one cycle of its gait carries it at a speed (m/s, world). */
    const stride = (speed) => pace.strideBase * scale + pace.strideRate * Math.max(0, speed);
    /** How much of a gallop its gait is at a speed (0 a trot .. 1 a gallop). */
    const gallopAt = (speed) => smooth(pace.gallopFrom, pace.gallopTo, speed / scale);
    /** The share of a cycle each paw is on the ground at a speed. */
    const duty = (speed) => Math.max(pace.dutyLeast, Math.min(pace.dutyMost, pace.stanceMost / (stride(speed) / scale)));
    /**
     * When in a cycle each paw lands (FOX_LEGS order): diagonal pairs at a trot; in the gallop
     * the hind pair, then the fore pair, each a beat apart. `gallop` is how much of a gallop the
     * gait is (a mind eases it, so the legs fall into the new step over a stride or two).
     */
    const footfalls = (speed, out = [0, 0, 0, 0], gallop = gallopAt(speed)) => {
        const g = clamp01(gallop);
        out[0] = 0.45 * g;
        out[1] = 0.5 + 0.03 * g;
        out[2] = 0.5 + 0.5 * g;
        out[3] = 0.08 * g;
        return out;
    };
    const FALLS = [0, 0, 0, 0];

    /**
     * Lay its gait over a spec.
     * @param {Float64Array} spec
     * @param {number} phase   cycles of the gait it has run (a mind advances it by distance / stride)
     * @param {number} speed   m/s, world
     * @param {number} amount  how much of its stride it takes (0 standing .. 1)
     * @param {number} [step]  how much it lifts its feet even so (0..1: stepping on the spot as it turns)
     * @param {number} [gallop]  how much of a gallop its gait is (0..1; from the speed when not given)
     */
    const layGait = (spec, phase, speed, amount, step = 0, gallop = gallopAt(speed)) => {
        const lifts = Math.max(amount, step);
        if (lifts <= 0) return spec;
        const cycle = stride(speed) / scale;
        const share = duty(speed);
        const stance = share * cycle * amount;
        const g = clamp01(gallop) * amount;
        const fast = smooth(0.4, 3.2, felt(speed));
        const height = (0.022 + 0.04 * fast) * k * lifts;
        footfalls(speed, FALLS, gallop);
        for (let i = 0; i < 4; i++) {
            const f = SPEC.feet + i * STEP;
            const at = (((phase + 1 - FALLS[i]) % 1) + 1) % 1;
            // In the gallop the hind paws land well under the body, the fore paws reach out ahead.
            const lead = (i < 2 ? 0.012 : 0.03) * k * g;
            if (at < share) {
                const along = at / share;
                spec[f + DZ] += stance * (0.5 - along) + lead;
                // The heel comes up as the paw is left behind (by as much as it will be lifted:
                // stepping on the spot it comes up too, or the toe would snap at lift-off).
                spec[f + TOE] += 0.55 * smooth(0.62, 1, along) * lifts;
            } else {
                const along = (at - share) / (1 - share);
                const ease = along * along * (3 - 2 * along);
                spec[f + DZ] += stance * (ease - 0.5) + lead;
                spec[f + DY] += height * Math.sin(Math.PI * along) ** 0.8;
                // Toes trail as it lifts, and are brought level to land.
                spec[f + TOE] += (0.55 * (1 - smooth(0, 0.45, along)) + 0.5 * Math.sin(Math.PI * along) * fast) * lifts;
            }
        }
        // The body: it rides lower the longer its steps…
        const reach = crouch.rest - Math.sqrt(Math.max(1e-6, crouch.chain * crouch.chain - (stance / 2 + crouch.margin) ** 2));
        const low = Math.max(0, reach) + 0.012 * k * g;
        spec[SPEC.rear] += low;
        spec[SPEC.fore] += low;
        // …at a trot it dips on every pair of paws and sways a little over them…
        const trot = amount * (1 - clamp01(gallop));
        const dip = Math.cos(2 * TAU * (phase - share / 2));
        const bob = (0.004 + 0.007 * fast) * k * trot * dip;
        spec[SPEC.rear] += bob;
        spec[SPEC.fore] += bob * 0.8;
        spec[SPEC.roll] += 0.022 * trot * Math.sin(TAU * (phase - share / 2));
        spec[SPEC.yaw] += 0.03 * trot * Math.sin(TAU * (phase - share / 2) + 1.2);
        // …and in the gallop it bounds: hind paws land at 0, fore paws near the half; between the
        // two it is stretched out in the air, after the fore paws it is gathered.
        spec[SPEC.arch] += 0.36 * g * Math.cos(TAU * (phase - 0.865));
        spec[SPEC.pitch] += 0.1 * g * Math.sin(TAU * (phase - 0.35));
        const leap = -Math.cos(2 * TAU * (phase - 0.365));
        spec[SPEC.rear] -= 0.012 * k * g * leap;
        spec[SPEC.fore] -= 0.012 * k * g * leap;
        spec[SPEC.tailLift] -= 0.12 * g * Math.sin(TAU * (phase - 0.35));
        spec[SPEC.headPitch] += 0.05 * g * Math.sin(TAU * (phase - 0.3));
        return spec;
    };

    // ── What it does ──
    const ACT = { ...FOX_COMMON_ACTS, ...acts };
    const ACT_LENGTHS = Object.freeze({ ...FOX_ACTS, ...lengths });

    /** Fill a spec with what an act looks like `t` seconds in (`Run` and unknown names: it stands). */
    const act = (spec, name, t) => {
        spec.fill(0);
        const pose = ACT[name];
        if (pose) pose(spec, Math.max(0, t), k);
        return spec;
    };

    const SPEC_A = createFoxSpec();
    const SPEC_B = createFoxSpec();
    const SPEC_C = createFoxSpec();

    /** An act as the side the mind chose has it: what curls to a side curls to that one. */
    const sided = (spec, name, t, side) => {
        act(spec, name, t);
        if (side < 0) {
            spec[SPEC.bend] = -spec[SPEC.bend];
            spec[SPEC.tailCurl] = -spec[SPEC.tailCurl];
            if (name === 'CurlSleep') {
                spec[SPEC.headYaw] = -spec[SPEC.headYaw];
                spec[SPEC.headRoll] = -spec[SPEC.headRoll];
                spec[SPEC.roll] = -spec[SPEC.roll];
            }
        }
        return spec;
    };

    /**
     * The spec of a pose a mind resolved: what it is doing and what it was doing, cross-faded;
     * its gait under that; and over it all what the mind adds whatever it does — its lean, its
     * nod, where its head is turned, its tail's swing and carriage, its breath.
     *
     * A mind that changes what it does half-way through a change names a third act: `was`, what
     * it had been leaving, held at the share `hold` of the way from it that it had reached — so
     * the pose it was in at that instant is the pose the new change starts from.
     * @param {object} p  { clip, clipTime, from, fromTime, blend, was, wasTime, hold, side, phase,
     *                      speed, amp, step, gallop, lean, nod, lookYaw, lookPitch, tailYaw,
     *                      tailLift, breath }
     * @param {Float64Array} [spec]
     */
    const specOf = (p, spec = createFoxSpec()) => {
        const blend = clamp01(p.blend ?? 1);
        const mix = blend * blend * (3 - 2 * blend);
        const side = p.side ?? 1;
        const held = p.was === undefined || p.was === null ? 1 : clamp01(p.hold ?? 1);
        sided(SPEC_A, p.clip, p.clipTime ?? 0, side);
        // How much of what it shows is its gait.
        let running = p.clip === 'Run' ? mix : 0;
        if (mix < 1) {
            sided(SPEC_B, p.from, p.fromTime ?? 0, side);
            if (p.from === 'Run') running += (1 - mix) * held;
            if (held < 1) {
                sided(SPEC_C, p.was, p.wasTime ?? 0, side);
                for (let i = 0; i < SPEC_SIZE; i++) SPEC_B[i] = SPEC_C[i] + (SPEC_B[i] - SPEC_C[i]) * held;
                if (p.was === 'Run') running += (1 - mix) * (1 - held);
            }
            for (let i = 0; i < SPEC_SIZE; i++) spec[i] = SPEC_B[i] + (SPEC_A[i] - SPEC_B[i]) * mix;
        } else {
            spec.set(SPEC_A);
        }
        layGait(spec, p.phase ?? 0, p.speed ?? 0, running * (p.amp ?? 1), p.step ?? 0, p.gallop ?? undefined);
        spec[SPEC.roll] -= p.lean ?? 0;
        // (It sinks a little as it pitches — braking, or springing off — so its paws stay down.)
        const nod = p.nod ?? 0;
        spec[SPEC.pitch] += nod;
        spec[SPEC.rear] += Math.abs(nod) * 0.11 * k;
        spec[SPEC.fore] += Math.abs(nod) * 0.11 * k;
        spec[SPEC.headYaw] += p.lookYaw ?? 0;
        spec[SPEC.headPitch] += p.lookPitch ?? 0;
        spec[SPEC.tailYaw] += p.tailYaw ?? 0;
        spec[SPEC.tailLift] += p.tailLift ?? 0;
        // It breathes: slowly and deep when it lies, quick and shallow after a run.
        const breath = p.breath ?? 0;
        spec[SPEC.arch] += 0.012 * breath;
        spec[SPEC.fore] -= 0.0025 * k * breath;
        spec[SPEC.rear] -= 0.0015 * k * breath;
        return spec;
    };

    // ── Solving a spec ──

    /** What solve() fills in: the root's place and every bone's rotation. */
    const createPosture = () => ({
        /** Each bone's rotation in the model's frame. */
        world: bones.map(() => [0, 0, 0, 1]),
        /** Each bone's rotation in its parent's frame: what a bone object takes. */
        local: bones.map(() => [0, 0, 0, 1]),
        /** Each joint's place in the model's frame (the root's is what the root bone takes). */
        at: bones.map((bone) => [bone[2], bone[3], bone[4]]),
        /** How far short of its paw each leg fell (0 when it reached). */
        short: [0, 0, 0, 0],
    });

    const Q1 = [0, 0, 0, 1];
    const Q2 = [0, 0, 0, 1];
    const Q3 = [0, 0, 0, 1];
    const V1 = [0, 0, 0];
    const V2 = [0, 0, 0];
    const V3 = [0, 0, 0];

    /** Where a joint is: its parent's place plus its own offset, turned with the parent. */
    const place = (posture, bone) => {
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
    };

    /**
     * Solve a spec: every bone's rotation, and where the root is.
     * @param {Float64Array} spec
     * @param {object} [posture]  createPosture()
     */
    const solve = (spec, posture = createPosture()) => {
        const { world, local, at } = posture;

        // ── The trunk: the middle of its back is put in place, hips and chest turn about it ──
        const slope = Math.asin(Math.max(-0.92, Math.min(0.92, (spec[SPEC.fore] - spec[SPEC.rear]) / BACK)));
        const yaw = spec[SPEC.yaw];
        const roll = spec[SPEC.roll];
        qTurn(yaw, spec[SPEC.pitch] + slope, roll, world[B.spine]);
        qMul(world[B.spine], qTurn(spec[SPEC.bend] / 2, spec[SPEC.arch] / 2, spec[SPEC.twist] / 2, Q1), world[B.chest]);
        qMul(world[B.spine], qTurn(-spec[SPEC.bend] / 2, -spec[SPEC.arch] / 2, -spec[SPEC.twist] / 2, Q1), world[B.hips]);
        const mid = at[B.spine];
        // (A roll is about its feet, not its back: the body goes over to the side it drops.)
        mid[0] = REST[B.spine][0] + spec[SPEC.sway] - roll * 0.12 * k;
        mid[1] = REST[B.spine][1] - (spec[SPEC.rear] + (spec[SPEC.fore] - spec[SPEC.rear]) * MID);
        mid[2] = REST[B.spine][2] + spec[SPEC.shift];
        V1[0] = REST[B.spine][0] - REST[B.hips][0];
        V1[1] = REST[B.spine][1] - REST[B.hips][1];
        V1[2] = REST[B.spine][2] - REST[B.hips][2];
        qRotate(world[B.hips], V1, V2);
        at[B.hips][0] = mid[0] - V2[0];
        at[B.hips][1] = mid[1] - V2[1];
        at[B.hips][2] = mid[2] - V2[2];
        place(posture, B.chest);

        // ── Neck and head: the head is turned where it looks and held level; the neck goes between ──
        qTurn(spec[SPEC.headYaw], -spec[SPEC.headPitch], spec[SPEC.headRoll], Q1);
        qMul(world[B.chest], Q1, Q2);
        qMul(qTurn(yaw + spec[SPEC.bend] / 2, 0, 0, Q3), Q1, Q1);
        qSlerp(Q2, Q1, headSteady, world[B.head]);
        qSlerp(world[B.chest], world[B.head], 0.5, Q1);
        qMul(Q1, qTurn(0, spec[SPEC.reach], 0, Q2), world[B.neck]);
        place(posture, B.neck);
        place(posture, B.head);

        // ── The tail: each bone turns a little more than the last ──
        // (Its root hangs from the hips, or — sitting — lies level whatever they do.)
        qSlerp(world[B.hips], qTurn(yaw - spec[SPEC.bend] / 2, 0, 0, Q1), clamp01(spec[SPEC.tailFree]), Q3);
        for (let i = 0; i < TAIL.length; i++) {
            const bone = TAIL[i];
            qTurn(
                -(spec[SPEC.tailYaw] * tail.swing[i] + spec[SPEC.tailCurl] * tail.curl[i]),
                spec[SPEC.tailLift] * tail.lift[i],
                0,
                Q1,
            );
            qMul(i === 0 ? Q3 : world[PARENT[bone]], Q1, world[bone]);
            place(posture, bone);
        }

        // ── The legs: each is solved to put its paw where the spec has it ──
        for (let i = 0; i < LEG.length; i++) {
            const leg = LEG[i];
            const f = SPEC.feet + i * STEP;
            const carry = world[leg.carrier];
            place(posture, leg.u);
            const hip = at[leg.u];
            const air = clamp01(spec[f + AIR]);
            // Where the paw meets the ground — or, in the air, where the body carries it.
            V1[0] = leg.paw[0] - REST[leg.carrier][0] + spec[f + DX];
            V1[1] = leg.paw[1] - REST[leg.carrier][1] + spec[f + DY];
            V1[2] = leg.paw[2] - REST[leg.carrier][2] + spec[f + DZ];
            qRotate(carry, V1, V2);
            const px = leg.paw[0] + spec[f + DX] + (at[leg.carrier][0] + V2[0] - leg.paw[0] - spec[f + DX]) * air;
            const py = leg.paw[1] + spec[f + DY] + (at[leg.carrier][1] + V2[1] - leg.paw[1] - spec[f + DY]) * air;
            const pz = leg.paw[2] + spec[f + DZ] + (at[leg.carrier][2] + V2[2] - leg.paw[2] - spec[f + DZ]) * air;
            // Its last joint stands over the paw, rolled about the toes; in the air the paw hangs
            // from the leg instead.
            qTurn(yaw * (1 - air), spec[f + TOE], 0, Q1);
            qSlerp(Q1, qMul(carry, qTurn(0, spec[f + TOE], 0, Q2), Q3), air, Q1);
            qRotate(Q1, leg.heel, V3);
            let tx = px + V3[0] - hip[0];
            let ty = py + V3[1] - hip[1];
            let tz = pz + V3[2] - hip[2];
            const far = Math.hypot(tx, ty, tz) || 1e-6;
            const most = leg.l1 + leg.l2 - 1e-4;
            const least = Math.abs(leg.l1 - leg.l2) + 1e-4;
            const d = Math.max(least, Math.min(most, far));
            posture.short[i] = Math.max(0, far - most);
            tx /= far;
            ty /= far;
            tz /= far;
            // The joint between stands off the line from hip to paw, in the plane the leg swings
            // in: across the animal's own side-to-side axis (as the body carries it). That turns
            // smoothly with the line wherever the paw goes — a pole to aim at would flip sides
            // when the leg came to point along it.
            V1[0] = 1;
            V1[1] = 0;
            V1[2] = 0;
            qRotate(carry, V1, V2);
            let ox = (ty * V2[2] - tz * V2[1]) * leg.fold;
            let oy = (tz * V2[0] - tx * V2[2]) * leg.fold;
            let oz = (tx * V2[1] - ty * V2[0]) * leg.fold;
            const ol = Math.hypot(ox, oy, oz);
            if (ol > 1e-6) {
                ox /= ol;
                oy /= ol;
                oz /= ol;
            } else {
                // (The leg points along that axis: straight out sideways. Fold it fore-and-aft.)
                V1[0] = 0;
                V1[2] = leg.fold;
                qRotate(carry, V1, V2);
                [ox, oy, oz] = V2;
            }
            const a = (leg.l1 * leg.l1 - leg.l2 * leg.l2 + d * d) / (2 * d);
            const h = Math.sqrt(Math.max(0, leg.l1 * leg.l1 - a * a));
            const kx = tx * a + ox * h;
            const ky = ty * a + oy * h;
            const kz = tz * a + oz * h;
            // Upper bone: from where the body carries it, the least turn onto hip → joint.
            qRotate(carry, leg.upperDir, V1);
            V2[0] = kx / leg.l1;
            V2[1] = ky / leg.l1;
            V2[2] = kz / leg.l1;
            qMul(qBetween(V1, V2, Q2), carry, world[leg.u]);
            at[leg.l][0] = hip[0] + kx;
            at[leg.l][1] = hip[1] + ky;
            at[leg.l][2] = hip[2] + kz;
            // Lower bone: likewise onto joint → last joint.
            qRotate(world[leg.u], leg.lowerDir, V1);
            V2[0] = (tx * d - kx) / leg.l2;
            V2[1] = (ty * d - ky) / leg.l2;
            V2[2] = (tz * d - kz) / leg.l2;
            qMul(qBetween(V1, V2, Q2), world[leg.u], world[leg.l]);
            at[leg.e][0] = hip[0] + tx * d;
            at[leg.e][1] = hip[1] + ty * d;
            at[leg.e][2] = hip[2] + tz * d;
            world[leg.e][0] = Q1[0];
            world[leg.e][1] = Q1[1];
            world[leg.e][2] = Q1[2];
            world[leg.e][3] = Q1[3];
        }

        // ── What each bone object takes: its rotation in its parent's frame ──
        for (let i = 0; i < COUNT; i++) {
            const parent = PARENT[i];
            if (parent < 0) {
                local[i][0] = world[i][0];
                local[i][1] = world[i][1];
                local[i][2] = world[i][2];
                local[i][3] = world[i][3];
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
    };

    /** Where a point of the animal is in a posture: `rest` is the point at rest, carried by `bone`. */
    const point = (posture, bone, rest, out = [0, 0, 0]) => {
        const i = typeof bone === 'number' ? bone : B[bone];
        V1[0] = rest[0] - REST[i][0];
        V1[1] = rest[1] - REST[i][1];
        V1[2] = rest[2] - REST[i][2];
        qRotate(posture.world[i], V1, V2);
        out[0] = posture.at[i][0] + V2[0];
        out[1] = posture.at[i][1] + V2[1];
        out[2] = posture.at[i][2] + V2[2];
        return out;
    };

    return Object.freeze({
        bones,
        index,
        marks,
        scale,
        size,
        /** Seconds each of its acts takes. */
        lengths: ACT_LENGTHS,
        createSpec: createFoxSpec,
        createPosture,
        act,
        stride,
        gallop: gallopAt,
        duty,
        footfalls,
        gait: layGait,
        spec: specOf,
        solve,
        point,
    });
}
