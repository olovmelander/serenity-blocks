/**
 * Wolfhour's wolf rig (CPU only, three-free): a pose becomes a list of tapered capsules that
 * wolfhour-wolves.js unions smoothly in a shader into one organic silhouette.
 *
 * The frame: a wolf faces +x with its paws on y = 0; one unit is about a world unit at scale 1
 * (nose to tail tip about 50). Legs are placed by two-bone IK from the shoulder or hip to the
 * wrist or hock, which follows the paw: the elbow bends back, the stifle forward. A walk is a
 * four-beat gait (left hind, left fore, right hind, right fore a quarter cycle apart), each paw
 * pushing back along the ground for 65 % of its cycle and swinging forward in an arc; a trot moves
 * the diagonal pairs together with a moment of suspension.
 *
 * On uneven ground (`pose.ground`, the ground's height under any x of the frame) every paw is set
 * on the ground under it, and the body settles to the ground under its hips and shoulders and
 * tilts with it (about its own height, so the legs stay upright the way an animal's do). With the
 * stride equal to the distance the body travels per gait cycle, a planted paw stays planted.
 *
 * Three builds (standing, sitting, lying) share one capsule layout, so `blendRigs` can carry a wolf
 * smoothly from one to another; a capsule a build does not use rests inside the body.
 */

/** Floats per capsule: ax, ay, bx, by, ra, rb, smoothness, spare. */
export const CAPSULE_STRIDE = 8;
/** Capsules in every pose. */
export const CAPSULE_COUNT = 25;

/** The three builds and their joints at rest. */
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
    lying: Object.freeze({
        hip: [-7, 6.4],
        shoulder: [6, 7.6],
        neckBase: [7.6, 10.8],
        neckAngle: 54,
        neckLength: 6.6,
        hipJoint: [-7, 5.4],
        shoulderJoint: [6.6, 5.8],
        tailBase: [-11.4, 5.4],
        torso: [4.6, 5.2],
        chest: [3.2, 3.6],
        rump: [4.8, 4.2],
    }),
});

/** Paws at rest, relative to the frame: [front near, front far, hind near, hind far]. */
const PAWS = Object.freeze({
    standing: Object.freeze([[10, 0.7], [7.4, 0.7], [-10.4, 0.7], [-13, 0.7]]),
    sitting: Object.freeze([[6.4, 0.7], [4.6, 0.7], [-1, 0.8], [-2.6, 0.8]]),
    // Lying: the forelegs stretched out in front, the hind legs folded under the haunch.
    lying: Object.freeze([[16, 0.8], [14, 0.8], [-1.6, 0.8], [-3.2, 0.8]]),
});

// The legs are a little longer than the rest pose needs: the slack lets a paw reach down a slope
// or forward through a stride without the leg locking straight.
const FRONT = Object.freeze({
    upper: 7.5, lower: 7.3, foot: [-0.4, 2.5], bend: -1, radii: [2.5, 1.7, 1.45, 1.2, 1.1],
});
const HIND = Object.freeze({
    upper: 7.6, lower: 6.9, foot: [-1.8, 4.3], bend: 1, radii: [3.5, 2.0, 1.55, 1.2, 1.1],
});
/**
 * Gaits: each leg's offset in the cycle ([front near, front far, hind near, hind far]), the share
 * of the cycle a paw is down, how high a swinging paw lifts, and how much the body bobs.
 */
export const GAITS = Object.freeze({
    walk: Object.freeze({
        offsets: Object.freeze([0.25, 0.75, 0, 0.5]), stance: 0.65, step: 0.17, bob: 0.03,
    }),
    trot: Object.freeze({
        offsets: Object.freeze([0, 0.5, 0.5, 0]), stance: 0.42, step: 0.2, bob: 0.07,
    }),
});
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

const mix = (a, b, w) => a + (b - a) * w;

/**
 * Where a paw is in its gait: `phase` 0..1 through the cycle; returns [dx, lift, flex] relative to
 * its rest place for a stride of `stride` units (0: standing still).
 */
export function pawCycle(phase, stride, gait = GAITS.walk) {
    const p = ((phase % 1) + 1) % 1;
    if (stride <= 0) return [0, 0, 0];
    const { stance, step } = gait;
    const reach = stride * stance * 0.5;
    if (p < stance) {
        // On the ground, pushing back from the front of its reach to the back.
        return [reach - (p / stance) * reach * 2, 0, 0];
    }
    const s = (p - stance) / (1 - stance);
    const ease = s * s * (3 - 2 * s);
    return [-reach + ease * reach * 2, Math.sin(s * Math.PI) * stride * step, Math.sin(s * Math.PI)];
}

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/**
 * Pose a wolf. Angles in degrees unless named in radians.
 * @param {object} pose
 * @param {'standing'|'sitting'|'lying'} pose.build
 * @param {number} [pose.gait]  gait cycle position (any real; whole numbers are full cycles)
 * @param {number} [pose.stride]  0 stands still; else the distance the body travels per cycle
 * @param {'walk'|'trot'} [pose.gaitKind]
 * @param {number} [pose.head]  head lift: 0 looks ahead, 60+ howls, negative sniffs the ground
 * @param {number} [pose.turn]  0..1, the head turned toward the viewer
 * @param {number} [pose.jaw]  mouth opening
 * @param {number} [pose.tail]  tail swing (up positive)
 * @param {number} [pose.tailUp]  0..1, the tail carried high (excited, playing)
 * @param {number} [pose.breath]  -1..1 chest rise
 * @param {number} [pose.ears]  ears laid back (degrees)
 * @param {number} [pose.crouch]  units the body sinks toward the ground (legs bend)
 * @param {number} [pose.lift]  units the body rises off the ground (a leap)
 * @param {number} [pose.pitch]  radians the body tilts beyond the ground's slope (front up +)
 * @param {number} [pose.tuck]  0..1, the legs drawn into their flight pose (fore reaching, hind trailing)
 * @param {number} [pose.reach]  units the fore paws stretch forward (a stretch, a play bow)
 * @param {(x: number) => number} [pose.ground]  the ground's height under x (frame units; flat 0)
 * @param {Float32Array} [out]  CAPSULE_COUNT * CAPSULE_STRIDE floats, reused
 * @returns {{ capsules: Float32Array, eye: number[], eye2: number[], muzzle: number[], paws: number[][] }}
 */
export function poseWolf(pose, out = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE)) {
    const build = BUILDS[pose.build] ? pose.build : 'standing';
    const b = BUILDS[build];
    const rest = PAWS[build];
    const sitting = build === 'sitting';
    const lying = build === 'lying';
    const gaitDef = GAITS[pose.gaitKind] || GAITS.walk;
    const stride = Math.max(0, num(pose.stride));
    const gait = num(pose.gait);
    const head = num(pose.head);
    const turn = Math.min(1, Math.max(0, num(pose.turn)));
    const jaw = Math.max(0, num(pose.jaw));
    const tail = num(pose.tail);
    const tailUp = Math.min(1, Math.max(0, num(pose.tailUp)));
    const breath = num(pose.breath);
    const ears = num(pose.ears);
    const crouch = Math.max(0, num(pose.crouch));
    const leap = Math.max(0, num(pose.lift));
    const tuck = Math.min(1, Math.max(0, num(pose.tuck)));
    const reachFore = num(pose.reach);
    const groundFn = typeof pose.ground === 'function' ? pose.ground : null;
    const groundAt = (x) => {
        const y = groundFn ? groundFn(x) : 0;
        return Number.isFinite(y) ? y : 0;
    };
    // The body rests on the ground under its hips and shoulders (read a little wide, so a notch
    // in the crest does not jolt it) and tilts with the slope between them.
    const wide = (x) => (groundAt(x - 2.5) + groundAt(x) + groundAt(x + 2.5)) / 3;
    const foreX = (rest[0][0] + rest[1][0]) / 2;
    const hindX = sitting || lying ? b.hip[0] : (rest[2][0] + rest[3][0]) / 2;
    const gFore = wide(foreX);
    const gHind = wide(hindX);
    const slope = Math.atan2(gFore - gHind, foreX - hindX);
    const share = sitting || lying ? TILT_SHARE * 0.6 : TILT_SHARE;
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, slope)) * share + num(pose.pitch);
    const settle = (sitting || lying ? gHind : (gFore + gHind) / 2) - crouch + leap;
    const pivotX = (foreX + hindX) / 2;
    // A moving body bobs twice per cycle, lowest as each fore paw takes the weight.
    const bob = stride > 0 ? Math.cos(gait * Math.PI * 4) * stride * gaitDef.bob : 0;
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
    // A sitting wolf's belly fills the fold between its haunch and its chest; other builds keep
    // that capsule resting inside the body (so a blend never sweeps it across the scene).
    if (sitting) put(fromHip(2.4, 1), fromHip(7.6, 1.2), 3.2, 2.2, 1.2);
    else put(fromHip(4, 0), fromHip(6, 0), 0.05, 0.05, 0.1);

    // Neck and head. Turned toward the viewer, the muzzle foreshortens, the skull rounds and both
    // ears and both eyes show.
    const neckBase = lift(b.neckBase);
    const neckAngle = (b.neckAngle + head * 0.62) * DEG + tilt;
    const neckTop = [
        neckBase[0] + Math.cos(neckAngle) * b.neckLength,
        neckBase[1] + Math.sin(neckAngle) * b.neckLength,
    ];
    put(neckBase, neckTop, 5.2, 3.9, 3);
    const headAngle = (-12 + head - turn * 6) * DEG + tilt;
    const at = (local) => {
        const r = rotate(local, headAngle);
        return [neckTop[0] + r[0], neckTop[1] + r[1]];
    };
    put(at([-1.4, 0.7]), at([2.3, 0.3]), 3.5 + turn * 0.5, 3.1 + turn * 0.6, 1.4);
    put(at([2.2, -0.3]), at([9.2 - turn * 6, -1.9 + turn * 0.5]), 2.05 + turn * 0.2, 1.05 + turn * 0.5, 1.1);
    const jawPivot = [1.8, -1.5];
    const jawAt = (local) => {
        const r = rotate([local[0] - jawPivot[0], local[1] - jawPivot[1]], -jaw * DEG);
        return at([r[0] + jawPivot[0], r[1] + jawPivot[1]]);
    };
    put(jawAt([1.8, -2.1]), jawAt([8.2 - turn * 5.4, -3 + turn * 0.4]), 1.35, 0.75 + turn * 0.2, 0.8);
    const ear = (base, tip) => rotate([tip[0] - base[0], tip[1] - base[1]], ears * DEG);
    const baseA = [-1.3 - turn * 1.4, 2.6];
    const baseB = [0.5 + turn * 1.9, 2.8];
    const earA = ear(baseA, [baseA[0] - 1 - turn * 0.8, 6.8]);
    const earB = ear(baseB, [baseB[0] - 0.4 + turn * 1.3, 6.8]);
    put(at(baseA), at([baseA[0] + earA[0], baseA[1] + earA[1]]), 1.55, 0.12, 0.5);
    put(at(baseB), at([baseB[0] + earB[0], baseB[1] + earB[1]]), 1.3 + turn * 0.25, 0.12, 0.5);

    // Legs: three bones each, placed by IK from the paw.
    const legs = [
        [b.shoulderJoint, FRONT], [[b.shoulderJoint[0] - 1.6, b.shoulderJoint[1]], FRONT],
        [b.hipJoint, HIND], [[b.hipJoint[0] - 1.6, b.hipJoint[1]], HIND],
    ];
    const paws = [];
    legs.forEach(([joint, bone], i) => {
        const front = bone === FRONT;
        const [dx, rise, flex] = pawCycle(gait + gaitDef.offsets[i], stride, gaitDef);
        const pawX = rest[i][0] + dx + (front ? reachFore : 0);
        // Each paw comes down on the ground under it...
        const grounded = [pawX, groundAt(pawX) + rest[i][1] + rise];
        // ...unless the wolf is in the air: then the forelegs reach ahead and the hind legs trail.
        const airborne = lift(front ? [rest[i][0] + 7, rest[i][1] + 5] : [rest[i][0] - 7, rest[i][1] + 6]);
        const paw = [mix(grounded[0], airborne[0], tuck), mix(grounded[1], airborne[1], tuck)];
        paws.push(paw);
        const root = lift(joint);
        if ((sitting || lying) && !front) {
            // A sitting or lying wolf's hind leg folds flat: thigh forward, shin back, foot along
            // the ground.
            const stifle = [root[0] + 5.6, root[1] - 1.6];
            const hockX = paw[0] - 5.8;
            const hock = [hockX, groundAt(hockX) + 1.6];
            put(root, stifle, 4.4, 2.6, 1.6);
            put(stifle, hock, 2.5, 1.6, 1.6);
            put(hock, [paw[0] + 1.2, groundAt(paw[0] + 1.2) + 0.8], 1.6, 1.15, 1.2);
            return;
        }
        if (lying && front) {
            // Forelegs stretched out in front: elbow down by the chest, forearm along the ground.
            const elbowX = root[0] + 2.2;
            const elbow = [elbowX, groundAt(elbowX) + 1.8];
            const wristX = paw[0] - 2.6;
            const wrist = [wristX, groundAt(wristX) + 1.3];
            put(root, elbow, 2.4, 1.7, 1.4);
            put(elbow, wrist, 1.6, 1.25, 0.8);
            put(wrist, [paw[0] + 1.4, groundAt(paw[0] + 1.4) + 1.0], 1.2, 1.05, 0.6);
            return;
        }
        const foot = rotate(bone.foot, flex * (front ? 0.9 : -0.5) + tuck * (front ? -0.6 : 0.9));
        const wrist = [paw[0] + foot[0], paw[1] + foot[1]];
        const knee = ik(root, wrist, bone.upper, bone.lower, bone.bend);
        const [r0, r1, r2, r3, r4] = bone.radii;
        put(root, knee, r0, r1, 1.4);
        put(knee, wrist, r2, r3, 0.8);
        // The toes rest on the ground under them, which on rough ground is not the paw's.
        const toeX = paw[0] + 1.5;
        const toeGround = groundAt(toeX) + rest[i][1] + rise + 0.2;
        put(wrist, [toeX, mix(toeGround, paw[1] + 0.2, tuck)], r3, r4, 0.6);
    });

    // Tail: hangs from the rump (or lies along the ground behind a sitting or lying wolf),
    // swinging; carried high and waving when the wolf is excited.
    const tailBase = lift(b.tailBase);
    const swing = tail * DEG;
    if ((sitting || lying) && tailUp < 0.5) {
        const midX = tailBase[0] - 5.5;
        const mid = [midX, groundAt(midX) + 1.8 + Math.max(0, tail) * 0.04];
        const tipX = mid[0] - 6 + Math.sin(swing) * 1.5;
        const tip = [tipX, groundAt(tipX) + 1.4 + Math.max(0, tail) * 0.08];
        put(tailBase, mid, 2.3, 2.9, 2);
        put(mid, tip, 2.9, 1.2, 1.8);
    } else {
        // A wolf carries its tail low, hanging toward the hocks, bushiest a third of the way down;
        // raised, it streams out level behind and its tip waves.
        const hang = [-3 + Math.sin(swing) * 1.5, -6 + Math.sin(swing) * 3];
        const raised = [-6.2 + Math.sin(swing) * 0.6, 1.2 + Math.sin(swing) * 2.6];
        const down = rotate([mix(hang[0], raised[0], tailUp), mix(hang[1], raised[1], tailUp)], tilt);
        const mid = [tailBase[0] + down[0], tailBase[1] + down[1]];
        const hangEnd = [-1 + Math.sin(swing) * 3, -6.4 + Math.sin(swing) * 3.5];
        const raisedEnd = [-5.4 + Math.sin(swing) * 1.2, 1.6 + Math.sin(swing) * 4.4];
        const endOffset = rotate(
            [mix(hangEnd[0], raisedEnd[0], tailUp), mix(hangEnd[1], raisedEnd[1], tailUp)],
            tilt * tailUp,
        );
        const end = [mid[0] + endOffset[0], mid[1] + endOffset[1]];
        // On a downhill slope behind it the tail must not trail through the ground.
        const tip = [end[0], Math.max(end[1], groundAt(end[0]) + 1.6)];
        put(tailBase, mid, 2.3, 3.3, 2.2);
        put(mid, tip, 3.3, 1.4, 2);
    }

    const eyeA = at([3.5 - turn * 1.6, 0.9 + turn * 0.2]);
    const eyeB = at([3.5 + turn * 0.8, 0.9 + turn * 0.2]);
    return {
        capsules: out,
        eye: eyeA,
        eye2: [eyeB[0], eyeB[1], turn],
        muzzle: at([9.6 - turn * 6, -2.2 + turn * 0.6]),
        paws,
    };
}

/**
 * Blend two posed rigs (`a` toward `b` by `w`, 0..1) into `out`: capsule by capsule (the builds
 * share one layout), with the eyes, muzzle and paws.
 */
export function blendRigs(a, b, w, out = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE)) {
    const t = Math.min(1, Math.max(0, num(w)));
    for (let i = 0; i < out.length; i++) out[i] = mix(a.capsules[i], b.capsules[i], t);
    const lerp2 = (p, q) => p.map((v, k) => mix(v, q[k], t));
    return {
        capsules: out,
        eye: lerp2(a.eye, b.eye),
        eye2: lerp2(a.eye2, b.eye2),
        muzzle: lerp2(a.muzzle, b.muzzle),
        paws: a.paws.map((p, i) => lerp2(p, b.paws[i])),
    };
}

/**
 * The frame a posed wolf stays inside (for its quad), in rig units: [minX, minY, maxX, maxY]. It
 * leaves room above and below for a wolf standing across a slope (its paws up to a dozen units
 * above or below the ground at its middle) and for a leap.
 */
export const WOLF_BOUNDS = Object.freeze([-34, -14, 38, 62]);
/** The steepest ground a wolf's paws follow, as a height change per unit (beyond it they clamp). */
export const MAX_GROUND_SLOPE = 0.7;
