/**
 * Wolfhour's wolf rig (CPU only, three-free): a pose becomes a list of tapered capsules that
 * wolfhour-wolves.js unions smoothly in a shader into one organic silhouette.
 *
 * The frame: a wolf faces +x with its paws on y = 0; one unit is about a world unit at scale 1
 * (nose to tail tip about 50). Legs are placed by two-bone IK from the shoulder or hip to the
 * wrist or hock, which follows the paw: the elbow bends back, the stifle forward. A walk is a
 * four-beat gait (left hind, left fore, right hind, right fore a quarter cycle apart), each paw
 * pushing back along the ground for 65 % of its cycle and swinging forward in an arc.
 *
 * On uneven ground (`pose.ground`, the ground's height under any x of the frame) every paw is set
 * on the ground under it, and the body settles to the ground under its hips and shoulders and
 * tilts with it (about its own height, so the legs stay upright the way an animal's do). With the
 * stride equal to the distance the body travels per gait cycle, a planted paw stays planted.
 */

/** Floats per capsule: ax, ay, bx, by, ra, rb, smoothness, spare. */
export const CAPSULE_STRIDE = 8;
/** Capsules in every pose (unused ones are parked far away). */
export const CAPSULE_COUNT = 25;
const FAR = 1e4;

/** The two builds and their joints at rest. */
const BUILDS = Object.freeze({
    standing: Object.freeze({
        hip: [-12, 19.6],
        shoulder: [8, 19.8],
        neckBase: [10, 22.4],
        neckAngle: 46,
        neckLength: 7.4,
        hipJoint: [-11.6, 17.6],
        shoulderJoint: [8.4, 16.2],
        tailBase: [-16.4, 21.2],
        torso: [4.4, 5.6],
        chest: [3.5, 4.2],
        rump: [4.4, 4],
    }),
    sitting: Object.freeze({
        hip: [-6, 8],
        shoulder: [3.4, 20.6],
        neckBase: [5, 23.4],
        neckAngle: 64,
        neckLength: 7,
        hipJoint: [-6, 7],
        shoulderJoint: [4.4, 17.4],
        tailBase: [-9.6, 3.6],
        torso: [4.8, 5.4],
        chest: [3.4, 4],
        rump: [5, 4.2],
    }),
});

/** Paws at rest, relative to the frame: [front near, front far, hind near, hind far]. */
const PAWS = Object.freeze({
    standing: Object.freeze([[10, 0.7], [7.4, 0.7], [-10.4, 0.7], [-13, 0.7]]),
    sitting: Object.freeze([[6.4, 0.7], [4.6, 0.7], [-1, 0.8], [-2.6, 0.8]]),
});

// The legs are a little longer than the rest pose needs: the slack lets a paw reach down a slope
// or forward through a stride without the leg locking straight.
const FRONT = Object.freeze({
    upper: 7.5, lower: 7.3, foot: [-0.4, 2.5], bend: -1, radii: [2.5, 1.7, 1.45, 1.2, 1.1],
});
const HIND = Object.freeze({
    upper: 7.6, lower: 6.9, foot: [-1.8, 4.3], bend: 1, radii: [3.5, 2.0, 1.55, 1.2, 1.1],
});
/** Gait offsets (fraction of a cycle) for [front near, front far, hind near, hind far]. */
const GAIT = Object.freeze([0.25, 0.75, 0, 0.5]);
const STANCE = 0.65;
/** How far the body tilts with the ground (radians at most, and the share of the slope taken). */
const MAX_TILT = 0.42;
const TILT_SHARE = 0.8;
/** The height the body tilts about (the legs below it stay upright). */
const TILT_HEIGHT = 15;

const DEG = Math.PI / 180;

function ik(root, target, l1, l2, bend) {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const raw = Math.hypot(dx, dy) || 1e-4;
    const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, raw));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / raw;
    const uy = dy / raw;
    return [root[0] + ux * a - uy * h * bend, root[1] + uy * a + ux * h * bend];
}

function rotate([x, y], angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [x * c - y * s, x * s + y * c];
}

/**
 * Where a paw is in its gait: `phase` 0..1 through the cycle; returns [dx, lift, flex] relative to
 * its rest place for a stride of `stride` units (0: standing still).
 */
export function pawCycle(phase, stride) {
    const p = ((phase % 1) + 1) % 1;
    if (stride <= 0) return [0, 0, 0];
    const reach = stride * STANCE * 0.5;
    if (p < STANCE) {
        // On the ground, pushing back from the front of its reach to the back.
        return [reach - (p / STANCE) * reach * 2, 0, 0];
    }
    const s = (p - STANCE) / (1 - STANCE);
    const ease = s * s * (3 - 2 * s);
    return [-reach + ease * reach * 2, Math.sin(s * Math.PI) * stride * 0.17, Math.sin(s * Math.PI)];
}

/**
 * Pose a wolf. Angles in degrees.
 * @param {object} pose
 * @param {'standing'|'sitting'} pose.build
 * @param {number} [pose.gait]  walk cycle position (any real; whole numbers are full cycles)
 * @param {number} [pose.stride]  0 stands still; about 14 for a walk
 * @param {number} [pose.head]  head lift: 0 looks ahead, 60+ howls, negative sniffs the ground
 * @param {number} [pose.jaw]  mouth opening
 * @param {number} [pose.tail]  tail swing (up positive)
 * @param {number} [pose.breath]  -1..1 chest rise
 * @param {number} [pose.ears]  ears laid back (degrees)
 * @param {(x: number) => number} [pose.ground]  the ground's height under x (frame units; flat 0)
 * @param {Float32Array} [out]  CAPSULE_COUNT * CAPSULE_STRIDE floats, reused
 * @returns {{ capsules: Float32Array, eye: number[], muzzle: number[], paws: number[][] }}
 */
export function poseWolf(pose, out = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE)) {
    const b = BUILDS[pose.build] || BUILDS.standing;
    const rest = PAWS[pose.build] || PAWS.standing;
    const stride = Number.isFinite(pose.stride) ? Math.max(0, pose.stride) : 0;
    const gait = Number.isFinite(pose.gait) ? pose.gait : 0;
    const head = Number.isFinite(pose.head) ? pose.head : 0;
    const jaw = Math.max(0, Number.isFinite(pose.jaw) ? pose.jaw : 0);
    const tail = Number.isFinite(pose.tail) ? pose.tail : 0;
    const breath = Number.isFinite(pose.breath) ? pose.breath : 0;
    const ears = Number.isFinite(pose.ears) ? pose.ears : 0;
    const sitting = pose.build === 'sitting';
    const groundFn = typeof pose.ground === 'function' ? pose.ground : null;
    const groundAt = (x) => {
        const y = groundFn ? groundFn(x) : 0;
        return Number.isFinite(y) ? y : 0;
    };
    // The body rests on the ground under its hips and shoulders (read a little wide, so a notch
    // in the crest does not jolt it) and tilts with the slope between them.
    const wide = (x) => (groundAt(x - 2.5) + groundAt(x) + groundAt(x + 2.5)) / 3;
    const foreX = (rest[0][0] + rest[1][0]) / 2;
    const hindX = sitting ? b.hip[0] : (rest[2][0] + rest[3][0]) / 2;
    const gFore = wide(foreX);
    const gHind = wide(hindX);
    const slope = Math.atan2(gFore - gHind, foreX - hindX);
    const share = sitting ? TILT_SHARE * 0.6 : TILT_SHARE;
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, slope)) * share;
    const settle = sitting ? gHind : (gFore + gHind) / 2;
    const pivotX = (foreX + hindX) / 2;
    // A walking body bobs twice per cycle, lowest as each fore paw takes the weight.
    const bob = stride > 0 ? Math.cos(gait * Math.PI * 4) * stride * 0.03 : 0;
    const lift = (p) => {
        const r = rotate([p[0] - pivotX, p[1] - TILT_HEIGHT], tilt);
        return [r[0] + pivotX, r[1] + TILT_HEIGHT + settle + bob];
    };

    let n = 0;
    const put = (a, c, ra, rb, k) => {
        const o = n * CAPSULE_STRIDE;
        out[o] = a[0]; out[o + 1] = a[1]; out[o + 2] = c[0]; out[o + 3] = c[1];
        out[o + 4] = ra; out[o + 5] = rb; out[o + 6] = k; out[o + 7] = 0;
        n += 1;
    };

    const hip = lift(b.hip);
    const shoulder = lift(b.shoulder);
    const swell = breath * 0.25;
    // Body: a lean barrel, the shoulder hump, the deep narrow chest, the rump over the thighs.
    put(hip, shoulder, b.torso[0], b.torso[1] + swell, 3);
    // Offsets from the rest shoulder and hip, carried through the body's settle and tilt.
    const fromShoulder = (dx, dy) => lift([b.shoulder[0] + dx, b.shoulder[1] + dy]);
    const fromHip = (dx, dy) => lift([b.hip[0] + dx, b.hip[1] + dy]);
    put(fromShoulder(-4.4, 3.6), fromShoulder(1.6, 2.8), 2.7, 3, 2.6);
    put(fromShoulder(-2.2, -3.2), fromShoulder(2.4, -2.4), b.chest[0], b.chest[1] + swell, 2.6);
    put(fromHip(-1, 0.4), fromHip(1.6, -2.2), b.rump[0], b.rump[1], 2.6);
    // A sitting wolf's belly fills the fold between its haunch and its chest.
    if (sitting) put(fromHip(2.4, 1), fromHip(7.6, 1.2), 3.2, 2.2, 1.2);
    else put([FAR, FAR], [FAR, FAR], 0.1, 0.1, 0.1);

    // Neck and head.
    const neckBase = lift(b.neckBase);
    const neckAngle = (b.neckAngle + head * 0.62) * DEG + tilt;
    const neckTop = [
        neckBase[0] + Math.cos(neckAngle) * b.neckLength,
        neckBase[1] + Math.sin(neckAngle) * b.neckLength,
    ];
    put(neckBase, neckTop, 5.2, 3.9, 3);
    const headAngle = (-12 + head) * DEG + tilt;
    const at = (local) => {
        const r = rotate(local, headAngle);
        return [neckTop[0] + r[0], neckTop[1] + r[1]];
    };
    put(at([-1.4, 0.7]), at([2.3, 0.3]), 3.5, 3.1, 1.4);
    put(at([2.2, -0.3]), at([9.2, -1.9]), 2.05, 1.05, 1.1);
    const jawPivot = [1.8, -1.5];
    const jawAt = (local) => {
        const r = rotate([local[0] - jawPivot[0], local[1] - jawPivot[1]], -jaw * DEG);
        return at([r[0] + jawPivot[0], r[1] + jawPivot[1]]);
    };
    put(jawAt([1.8, -2.1]), jawAt([8.2, -3]), 1.35, 0.75, 0.8);
    const ear = (base, tip) => rotate([tip[0] - base[0], tip[1] - base[1]], ears * DEG);
    const earA = ear([-1.3, 2.6], [-2.3, 6.8]);
    const earB = ear([0.5, 2.8], [0.1, 6.8]);
    put(at([-1.3, 2.6]), at([-1.3 + earA[0], 2.6 + earA[1]]), 1.55, 0.12, 0.5);
    put(at([0.5, 2.8]), at([0.5 + earB[0], 2.8 + earB[1]]), 1.3, 0.12, 0.5);

    // Legs: three bones each, placed by IK from the paw.
    const legs = [
        [b.shoulderJoint, FRONT], [[b.shoulderJoint[0] - 1.6, b.shoulderJoint[1]], FRONT],
        [b.hipJoint, HIND], [[b.hipJoint[0] - 1.6, b.hipJoint[1]], HIND],
    ];
    const paws = [];
    legs.forEach(([joint, bone], i) => {
        const [dx, rise, flex] = pawCycle(gait + GAIT[i], stride);
        const pawX = rest[i][0] + dx;
        // Each paw comes down on the ground under it.
        const paw = [pawX, groundAt(pawX) + rest[i][1] + rise];
        paws.push(paw);
        const root = lift(joint);
        if (sitting && bone === HIND) {
            // A sitting wolf's hind leg folds flat: thigh forward, shin back, foot along the ground.
            const stifle = [root[0] + 5.6, root[1] - 1.6];
            const hockX = paw[0] - 5.8;
            const hock = [hockX, groundAt(hockX) + 1.6];
            put(root, stifle, 4.4, 2.6, 1.6);
            put(stifle, hock, 2.5, 1.6, 1.6);
            put(hock, [paw[0] + 1.2, groundAt(paw[0] + 1.2) + 0.8], 1.6, 1.15, 1.2);
            return;
        }
        const foot = rotate(bone.foot, flex * (bone === FRONT ? 0.9 : -0.5));
        const wrist = [paw[0] + foot[0], paw[1] + foot[1]];
        const knee = ik(root, wrist, bone.upper, bone.lower, bone.bend);
        const [r0, r1, r2, r3, r4] = bone.radii;
        put(root, knee, r0, r1, 1.4);
        put(knee, wrist, r2, r3, 0.8);
        // The toes rest on the ground under them, which on rough ground is not the paw's.
        const toeX = paw[0] + 1.5;
        put(wrist, [toeX, groundAt(toeX) + rest[i][1] + rise + 0.2], r3, r4, 0.6);
    });

    // Tail: hangs from the rump (or lies along the ground behind a sitting wolf), swinging.
    const tailBase = lift(b.tailBase);
    const swing = tail * DEG;
    if (sitting) {
        // Lying along the ground behind it, following the ground's shape.
        const midX = tailBase[0] - 5.5;
        const mid = [midX, groundAt(midX) + 1.8 + Math.max(0, tail) * 0.04];
        const tipX = mid[0] - 6 + Math.sin(swing) * 1.5;
        const tip = [tipX, groundAt(tipX) + 1.4 + Math.max(0, tail) * 0.08];
        put(tailBase, mid, 2.3, 2.9, 2);
        put(mid, tip, 2.9, 1.2, 1.8);
    } else {
        // A wolf carries its tail low, hanging toward the hocks, bushiest a third of the way down.
        const down = rotate([-3 + Math.sin(swing) * 1.5, -6 + Math.sin(swing) * 3], tilt);
        const mid = [tailBase[0] + down[0], tailBase[1] + down[1]];
        const end = [mid[0] - 1 + Math.sin(swing) * 3, mid[1] - 6.4 + Math.sin(swing) * 3.5];
        // On a downhill slope behind it the tail must not trail through the ground.
        const tip = [end[0], Math.max(end[1], groundAt(end[0]) + 1.6)];
        put(tailBase, mid, 2.3, 3.3, 2.2);
        put(mid, tip, 3.3, 1.4, 2);
    }

    while (n < CAPSULE_COUNT) put([FAR, FAR], [FAR, FAR], 0.1, 0.1, 0.1);
    return {
        capsules: out, eye: at([3.5, 0.9]), muzzle: at([9.6, -2.2]), paws,
    };
}

/**
 * The frame a posed wolf stays inside (for its quad), in rig units: [minX, minY, maxX, maxY]. It
 * leaves room above and below for a wolf standing across a slope (its paws up to a dozen units
 * above or below the ground at its middle).
 */
export const WOLF_BOUNDS = Object.freeze([-32, -14, 36, 54]);
/** The steepest ground a wolf's paws follow, as a height change per unit (beyond it they clamp). */
export const MAX_GROUND_SLOPE = 0.7;
