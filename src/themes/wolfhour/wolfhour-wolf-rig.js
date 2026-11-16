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
 * Posture is continuous: `sit` lowers the haunches (0 standing, 1 sitting) and `down` the
 * forequarters (with `sit`, lying; without it, a bow). Every joint, bone length and paw place is a
 * bilinear blend of three builds (standing, sitting, lying) and every leg is solved by the same IK
 * at any blend, so a wolf can sit down hindquarters first, get up forequarters first and lie down
 * with its forelegs walking out in front, its legs folding and unfolding as real legs do. A
 * sitting or lying leg is shorter on screen because it splays out to the side.
 *
 * The rig is built in three dimensions and projected along z (the viewer looks down -z; a wolf's
 * near legs, ear and eye are on its +z side). `yaw` turns the whole wolf about a vertical axis
 * through its middle, so it turns round through a view of its face (or its back) rather than
 * flipping; `turn` and `headYaw` turn its head (and part of its neck), `roll` tilts the head. The
 * eyes glint on the side that faces the viewer.
 *
 * On uneven ground (`pose.ground`, the ground's height under any x of the frame) every paw is set
 * on the ground under it, and the body settles to the ground under its hips and shoulders and
 * tilts with it (about its own height, so the legs stay upright the way an animal's do). With the
 * stride equal to the distance the body travels per gait cycle, a planted paw stays planted.
 */

/**
 * Floats per capsule: ax, ay, bx, by, ra, rb, smoothness, coat tone (0 the dark of the saddle and the
 * tail's tip .. 1 the pale of the belly, legs and cheeks), then the depth of each end toward the
 * viewer (az, bz), how long the fur stands there, and a spare.
 */
export const CAPSULE_STRIDE = 12;
/** Capsules in every pose (the first 25 keep their order; the brisket, the cheek ruff and the tail's tip follow). */
export const CAPSULE_COUNT = 28;
/**
 * A wolf's own build (every one 1 at rest): `bulk` the body's girth, `ruff` the neck's and the
 * cheeks' fur, `tail` its brush, `ear` its ears' length, `limb` its legs' thickness, `head` its
 * skull and muzzle (a yearling's is big for it), `muzzle` the muzzle's length.
 */
export const WOLF_SHAPE = Object.freeze({
    bulk: 1, ruff: 1, tail: 1, ear: 1, limb: 1, head: 1, muzzle: 1,
});

/** The three builds and their joints at rest. */
const BUILDS = Object.freeze({
    standing: Object.freeze({
        hip: [-12, 19.6],
        shoulder: [8, 19.8],
        neckBase: [10, 22.2],
        neckAngle: 37,
        neckLength: 8.2,
        hipJoint: [-11.6, 17.6],
        shoulderJoint: [8.6, 17.3],
        tailBase: [-16.4, 21.2],
        torso: [3.8, 5.6],
        chest: [3.8, 4.7],
        rump: [4.5, 4],
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

/**
 * Legs, per build: bone lengths (as seen from the side), the wrist or hock's place from the paw,
 * capsule radii (shoulder or hip, elbow or stifle, again, wrist or hock, toe), smoothness, how far
 * the foot lies along the ground (0 upright, 1 flat) and the toe's place from the paw. The legs are
 * a little longer than the standing pose needs: the slack lets a paw reach down a slope or forward
 * through a stride without the leg locking straight.
 */
const FRONT = Object.freeze({
    bend: -1,
    standing: Object.freeze({
        upper: 7.5,
        lower: 7.3,
        foot: [-0.4, 2.5],
        radii: [2.6, 1.5, 1.28, 0.9, 1.16],
        k: [1.4, 0.8, 0.6],
        flat: 0,
        toe: [1.5, 0.2],
    }),
    // The forelegs of a sitting wolf stand as a standing wolf's do.
    sitting: null,
    lying: Object.freeze({
        upper: 4.57,
        lower: 4.63,
        foot: [-2.6, 0.5],
        radii: [2.4, 1.6, 1.45, 1.05, 1.1],
        k: [1.4, 0.8, 0.6],
        flat: 1,
        toe: [1.4, 0.2],
    }),
});
const HIND = Object.freeze({
    bend: 1,
    standing: Object.freeze({
        upper: 7.6,
        lower: 6.9,
        foot: [-1.8, 4.3],
        radii: [3.7, 1.85, 1.42, 0.88, 1.16],
        k: [1.4, 0.8, 0.6],
        flat: 0,
        toe: [1.5, 0.2],
    }),
    // A sitting or lying wolf's hind leg folds flat: thigh forward, shin back, foot along the ground.
    sitting: Object.freeze({
        upper: 5.8,
        lower: 7.4,
        foot: [-5.8, 0.8],
        radii: [4.4, 2.6, 2.5, 1.4, 1.15],
        k: [1.6, 1.6, 1.2],
        flat: 1,
        toe: [1.2, 0],
    }),
    lying: Object.freeze({
        upper: 5.8,
        lower: 6.4,
        foot: [-5.8, 0.8],
        radii: [4.4, 2.6, 2.5, 1.6, 1.15],
        k: [1.6, 1.6, 1.2],
        flat: 1,
        toe: [1.2, 0],
    }),
});
/** Where a scratching hind paw reaches, from the base of the neck, and how its foot turns up (radians). */
const SCRATCH_AT = Object.freeze([7, -9]);
const SCRATCH_FOOT = 1.2;
/** How far each leg stands out to the side ([front near, front far, hind near, hind far]). */
const LEG_SIDE = Object.freeze([3, -3, 3.2, -3.2]);

/**
 * Gaits: each leg's offset in the cycle ([front near, front far, hind near, hind far]), the share
 * of the cycle a paw is down, how high a swinging paw lifts, and how much the body bobs. A prowl
 * is a walk kept low: long on the ground, the paws barely lifted. A lope and a run are gallops:
 * the hind paws strike one after the other, then the fore paws, then the wolf is in the air with
 * its legs gathered under it; the body bounds once a cycle (`bound`, a share of the stride) and
 * rocks (`rock`, radians: forehand up as the hind legs drive, down as the fore paws land).
 * `full` is the stride at which the bound and the rock are whole (a wolf getting up to speed
 * eases into them).
 */
export const GAITS = Object.freeze({
    walk: Object.freeze({
        offsets: Object.freeze([0.25, 0.75, 0, 0.5]), stance: 0.65, step: 0.17, bob: 0.03,
    }),
    trot: Object.freeze({
        offsets: Object.freeze([0, 0.5, 0.5, 0]), stance: 0.42, step: 0.2, bob: 0.07,
    }),
    prowl: Object.freeze({
        offsets: Object.freeze([0.25, 0.75, 0, 0.5]), stance: 0.72, step: 0.11, bob: 0.012,
    }),
    lope: Object.freeze({
        offsets: Object.freeze([0.52, 0.4, 0.12, 0]),
        stance: 0.34,
        step: 0.12,
        bob: 0,
        bound: 0.07,
        rock: 0.1,
        full: 38,
    }),
    run: Object.freeze({
        offsets: Object.freeze([0.5, 0.4, 0.1, 0]),
        stance: 0.28,
        step: 0.11,
        bob: 0,
        bound: 0.085,
        rock: 0.15,
        full: 46,
    }),
});
/** How far the body tilts with the ground (radians at most, and the share of the slope taken). */
const MAX_TILT = 0.42;
const TILT_SHARE = 0.8;
/** The height the body tilts about (the legs below it stay upright). */
const TILT_HEIGHT = 15;
/** Postures as (sit, down). */
export const POSTURES = Object.freeze({
    standing: Object.freeze({ sit: 0, down: 0 }),
    sitting: Object.freeze({ sit: 1, down: 0 }),
    lying: Object.freeze({ sit: 1, down: 1 }),
});
/** How far a head turned toward the viewer (`turn` 1) turns (radians), and how much the neck shares. */
const HEAD_TURN = 1.3;
const NECK_SHARE = 0.35;
/** The eyes look out this far from the muzzle's line (radians): the eye that faces the viewer glints. */
const EYE_SPREAD = 0.87;

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
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => {
    const c = clamp01(t);
    return c * c * (3 - 2 * c);
};

/** The bilinear posture blend of one value (a number or an array) across the three builds. */
function blendValue(s, t, l, sit, down) {
    if (Array.isArray(s)) return s.map((v, i) => v + sit * (t[i] - v) + down * (l[i] - t[i]));
    return s + sit * (t - s) + down * (l - t);
}

function blendTable(table, sit, down) {
    const s = table.standing;
    const t = table.sitting ?? s;
    const l = table.lying;
    const out = {};
    for (const key of Object.keys(s)) out[key] = blendValue(s[key], t[key], l[key], sit, down);
    return out;
}

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

/**
 * A step in place (turning on the spot, circling): each paw lifts and sets down again in the
 * walk's order without moving along the ground; returns [lift, flex].
 */
export function stepInPlace(phase, height) {
    const p = ((phase % 1) + 1) % 1;
    if (height <= 0 || p > 0.4) return [0, 0];
    const s = Math.sin((p / 0.4) * Math.PI);
    return [s * height, s];
}

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/**
 * Pose a wolf. Angles in degrees unless named in radians.
 * @param {object} pose
 * @param {'standing'|'sitting'|'lying'} [pose.build]  a posture preset (`sit` and `down` override it)
 * @param {number} [pose.sit]  0..1, haunches down (sitting)
 * @param {number} [pose.down]  0..1, forequarters down (with `sit`, lying; alone, a bow)
 * @param {number[]} [pose.foreDown]  each forepaw's own `down` while it steps out or in
 * @param {number[]} [pose.foreLift]  each forepaw's lift while it steps
 * @param {number} [pose.gait]  gait cycle position (any real; whole numbers are full cycles)
 * @param {number} [pose.stride]  0 stands still; else the distance the body travels per cycle
 * @param {'walk'|'trot'|'prowl'|'lope'|'run'} [pose.gaitKind]
 * @param {Partial<typeof WOLF_SHAPE>} [pose.shape]  the wolf's own build
 * @param {number} [pose.step]  stepping in place: cycle position (legs lift in the walk's order)
 * @param {number} [pose.stepHeight]  how high a paw lifts stepping in place (0: no stepping)
 * @param {number} [pose.yaw]  radians the whole wolf turns about its middle (toward the viewer +)
 * @param {number} [pose.head]  head lift: 0 looks ahead, 60+ howls, negative sniffs the ground
 * @param {number} [pose.turn]  0..1, the head turned toward the viewer
 * @param {number} [pose.headYaw]  radians the head turns beyond `turn` (a look back over the shoulder)
 * @param {number} [pose.neckYaw]  radians the neck turns beyond its share of the head's turn
 * @param {number} [pose.roll]  radians the head tilts (a curious tilt)
 * @param {number} [pose.jaw]  mouth opening
 * @param {number} [pose.tail]  tail swing (up positive)
 * @param {number} [pose.tailUp]  0..1, the tail carried high (excited, playing)
 * @param {number} [pose.breath]  -1..1 chest rise
 * @param {number} [pose.ears]  ears laid back (degrees)
 * @param {number} [pose.earA]  the near ear laid back beyond `ears` (degrees)
 * @param {number} [pose.earB]  the far ear laid back beyond `ears` (degrees)
 * @param {number} [pose.crouch]  units the body sinks toward the ground (legs bend)
 * @param {number} [pose.lift]  units the body rises off the ground (a leap)
 * @param {number} [pose.pitch]  radians the body tilts beyond the ground's slope (front up +)
 * @param {number} [pose.tuck]  0..1, the legs drawn into their flight pose (fore reaching, hind trailing)
 * @param {number} [pose.reach]  units the fore paws stretch forward (a stretch, a play bow)
 * @param {number} [pose.hindReach]  units the hind paws stretch back (the stretch after a bow)
 * @param {number} [pose.pawUp]  0..1, the near forepaw raised and folded (alert)
 * @param {number} [pose.scratch]  0..1, the near hind paw up at the neck, scratching
 * @param {number} [pose.scratchPhase]  radians through the scratching strokes
 * @param {number} [pose.dig]  0..1, the forepaws digging at the snow
 * @param {number} [pose.digPhase]  radians through the digging strokes
 * @param {(x: number) => number} [pose.ground]  the ground's height under x (frame units; flat 0)
 * @param {Float32Array} [out]  CAPSULE_COUNT * CAPSULE_STRIDE floats, reused
 * @returns {{ capsules: Float32Array, eye: number[], eye2: number[], muzzle: number[],
 *   toward: number, paws: number[][] }}  `eye` and `eye2` are [x, y, visibility 0..1] for the near
 *   and far eye; `toward` is how far the muzzle points at the viewer (-1 away .. 1 toward)
 */
export function poseWolf(pose, out = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE)) {
    const preset = POSTURES[pose.build] ?? POSTURES.standing;
    const sit = clamp01(num(pose.sit, preset.sit));
    const down = clamp01(num(pose.down, preset.down));
    const b = blendTable(BUILDS, sit, down);
    // While the forequarters go down or up, each forepaw steps on its own (`foreDown`, `foreLift`).
    const foreDown = [0, 1].map((i) => clamp01(num(pose.foreDown?.[i], down)));
    const legDown = (i) => (i < 2 ? foreDown[i] : down);
    const rest = PAWS.standing.map((p, i) => blendValue(p, PAWS.sitting[i], PAWS.lying[i], sit, legDown(i)));
    const fronts = foreDown.map((d) => blendTable(FRONT, sit, d));
    const hind = blendTable(HIND, sit, down);
    const gaitDef = GAITS[pose.gaitKind] || GAITS.walk;
    const stride = Math.max(0, num(pose.stride));
    const gait = num(pose.gait);
    const stepHeight = Math.max(0, num(pose.stepHeight));
    const stepAt = num(pose.step);
    const yaw = num(pose.yaw);
    const head = num(pose.head);
    const turn = clamp01(num(pose.turn));
    const headYaw = turn * HEAD_TURN + num(pose.headYaw);
    const neckYaw = turn * HEAD_TURN * NECK_SHARE + num(pose.neckYaw);
    const roll = num(pose.roll);
    const jaw = Math.max(0, num(pose.jaw));
    const tail = num(pose.tail);
    const tailUp = clamp01(num(pose.tailUp));
    const breath = num(pose.breath);
    const ears = num(pose.ears);
    const crouch = Math.max(0, num(pose.crouch));
    const leap = Math.max(0, num(pose.lift));
    const tuck = clamp01(num(pose.tuck));
    const reachFore = num(pose.reach);
    const reachHind = num(pose.hindReach);
    const pawUp = clamp01(num(pose.pawUp));
    const scratch = clamp01(num(pose.scratch));
    const dig = clamp01(num(pose.dig));
    const digPhase = num(pose.digPhase);
    const shape = pose.shape ? { ...WOLF_SHAPE, ...pose.shape } : WOLF_SHAPE;

    // The body's fore and hind ends (where it rests on the ground) follow the posture, not a step.
    const foreX = blendValue(
        (PAWS.standing[0][0] + PAWS.standing[1][0]) / 2,
        (PAWS.sitting[0][0] + PAWS.sitting[1][0]) / 2,
        (PAWS.lying[0][0] + PAWS.lying[1][0]) / 2,
        sit,
        down,
    );
    const hindX = mix((rest[2][0] + rest[3][0]) / 2, b.hip[0], sit);
    const pivotX = (foreX + hindX) / 2;
    // The projection: the whole wolf turned by `yaw` about a vertical axis through its middle.
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const px = (x, z = 0) => pivotX + (x - pivotX) * cy - z * sy;
    // ...and how far a point then stands toward the viewer (the shader shades the union by it).
    const pz = (x, z = 0) => (x - pivotX) * sy + z * cy;
    const groundFn = typeof pose.ground === 'function' ? pose.ground : null;
    // The ground under a point of the frame (x along the wolf, z across it), wherever it is turned.
    const groundAt = (x, z = 0) => {
        const y = groundFn ? groundFn(px(x, z)) : 0;
        return Number.isFinite(y) ? y : 0;
    };
    // The body rests on the ground under its hips and shoulders (read a little wide, so a notch
    // in the crest does not jolt it) and tilts with the slope between them.
    const wide = (x) => (groundAt(x - 2.5) + groundAt(x) + groundAt(x + 2.5)) / 3;
    const gFore = wide(foreX);
    const gHind = wide(hindX);
    const slope = Math.atan2(gFore - gHind, foreX - hindX);
    const share = TILT_SHARE * (1 - 0.4 * sit);
    // A gallop rocks the body once a cycle and throws it into the air after the fore paws leave.
    const gallop = gaitDef.full && stride > 0 ? Math.min(1, stride / gaitDef.full) : 0;
    const rock = gallop > 0 ? gallop * gaitDef.rock * Math.sin((gait + 0.04) * Math.PI * 2) : 0;
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, slope)) * share + num(pose.pitch) + rock;
    const settle = mix((gFore + gHind) / 2, gHind, sit) - crouch + leap;
    // A moving body bobs twice per cycle, lowest as each fore paw takes the weight; the head rides
    // it out (a wolf carries its head level as it goes).
    const bob = (stride > 0 ? Math.cos(gait * Math.PI * 4) * stride * gaitDef.bob : 0)
        + (gallop > 0 ? gallop * gaitDef.bound * stride * (0.5 + 0.5 * Math.cos((gait - 0.9) * Math.PI * 2)) : 0);
    // (`sink`: how far the body has sunk onto its legs, below.)
    let sink = 0;
    const lift = (p) => {
        const r = rotate([p[0] - pivotX, p[1] - TILT_HEIGHT], tilt);
        return [r[0] + pivotX, r[1] + TILT_HEIGHT + settle + bob - sink];
    };
    // Legs: three bones each, placed by IK from the paw.
    const legs = [
        [b.shoulderJoint, fronts[0]], [[b.shoulderJoint[0] - 1.6, b.shoulderJoint[1]], fronts[1]],
        [b.hipJoint, hind], [[b.hipJoint[0] - 1.6, b.hipJoint[1]], hind],
    ];
    // A standing body cannot stand higher than its planted legs reach: where a paw is further off
    // than its leg is long (a long stride, a bound, a paw down a slope) the body sinks onto its
    // legs rather than the leg being drawn out. (Sitting down and lying down fold the legs their
    // own way: the forepaws walk out ahead of the body.)
    let need = 0;
    legs.forEach(([joint, bone], i) => {
        const isFront = i < 2;
        const near = i % 2 === 0;
        const z = LEG_SIDE[i];
        let raised = tuck;
        if (isFront && near) raised = Math.max(raised, pawUp);
        if (!isFront && near) raised = Math.max(raised, scratch);
        if (raised >= 1) return;
        const [dx, rise, flex] = pawCycle(gait + gaitDef.offsets[i], stride, gaitDef);
        const [stepRise, stepFlex] = stepInPlace(stepAt + GAITS.walk.offsets[i], stepHeight);
        const pawX = rest[i][0] + dx + (isFront ? reachFore : -reachHind);
        const pawY = groundAt(pawX, z) + rest[i][1] + rise + stepRise
            + (isFront ? Math.max(0, num(pose.foreLift?.[i])) : 0);
        const footVec = rotate(bone.foot, (flex + stepFlex) * (isFront ? 0.9 : -0.5));
        const root = lift(joint);
        const across = pawX + footVec[0] - root[0];
        const below = root[1] - (pawY + footVec[1]);
        const reach = bone.upper + bone.lower - 0.04;
        if (below > 0 && across * across + below * below > reach * reach) {
            const fits = Math.sqrt(Math.max(reach * reach - across * across, 0));
            need = Math.max(need, (below - fits) * (1 - raised));
        }
    });
    sink = Math.min(need, 7) * (1 - smooth(Math.max(sit, down) / 0.25));

    let n = 0;
    // Each capsule's ends are points of the frame [x, y, z]; they are drawn turned by the yaw.
    const put = (a, c, ra, rb, k, tone = 0.5, fur = 1) => {
        const o = n * CAPSULE_STRIDE;
        out[o] = px(a[0], a[2] ?? 0); out[o + 1] = a[1];
        out[o + 2] = px(c[0], c[2] ?? 0); out[o + 3] = c[1];
        out[o + 4] = ra; out[o + 5] = rb; out[o + 6] = k; out[o + 7] = tone;
        out[o + 8] = pz(a[0], a[2] ?? 0); out[o + 9] = pz(c[0], c[2] ?? 0);
        out[o + 10] = fur; out[o + 11] = 0;
        n += 1;
    };

    const hip = lift(b.hip);
    const shoulder = lift(b.shoulder);
    const swell = breath * 0.25;
    // Seen from the front or behind, the coat and the ruff fill the body out.
    const girth = Math.abs(sy) * 1.2;
    const { bulk } = shape;
    // Body: a lean barrel tucked up at the loin, the dark saddle over the withers, the deep narrow
    // chest, the rump over the thighs.
    put(hip, shoulder, b.torso[0] * bulk + girth, b.torso[1] * bulk + swell + girth, 3, 0.42, 1);
    // Offsets from the rest shoulder and hip, carried through the body's settle and tilt.
    const fromShoulder = (dx, dy) => lift([b.shoulder[0] + dx, b.shoulder[1] + dy]);
    const fromHip = (dx, dy) => lift([b.hip[0] + dx, b.hip[1] + dy]);
    put(fromShoulder(-4.4, 3.6), fromShoulder(1.6, 2.8), 2.7 * bulk + girth, 3 * bulk + girth, 2.6, 0.1, 1.25);
    put(
        fromShoulder(-2.6, -3.3),
        fromShoulder(2.2, -2.7),
        b.chest[0] * bulk + girth,
        b.chest[1] * bulk + swell + girth,
        2.6,
        0.72,
        1.1,
    );
    put(fromHip(-1, 0.4), fromHip(1.6, -2.2), b.rump[0] * bulk + girth, b.rump[1] * bulk + girth, 2.6, 0.32, 1);
    // A sitting wolf's belly fills the fold between its haunch and its chest; standing or lying,
    // it shrinks back inside the body.
    const belly = sit * (1 - down);
    put(
        fromHip(mix(4, 2.4, belly), mix(0, 1, belly)),
        fromHip(mix(6, 7.6, belly), mix(0, 1.2, belly)),
        mix(0.05, 3.2, belly),
        mix(0.05, 2.2, belly),
        mix(0.1, 1.2, belly),
        0.88,
        1.2,
    );

    // Neck and head, in three dimensions: the neck shares part of the head's turn, the head turns,
    // lifts and tilts about the top of the neck.
    const counter = -bob * 0.7;
    const neckBase = lift(b.neckBase);
    const neckAngle = (b.neckAngle + head * 0.62) * DEG + tilt;
    const neckFlat = Math.cos(neckAngle) * b.neckLength;
    const neckTop = [
        neckBase[0] + neckFlat * Math.cos(neckYaw),
        neckBase[1] + Math.sin(neckAngle) * b.neckLength + counter,
        neckFlat * Math.sin(neckYaw),
    ];
    const { ruff, head: skull } = shape;
    put(neckBase, neckTop, 5.2 * ruff + girth * 0.8, 3.9 * ruff + girth * 0.6, 3, 0.46, 1.5);
    const headAngle = (-12 + head) * DEG + tilt;
    const ch = Math.cos(headAngle);
    const shh = Math.sin(headAngle);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cyh = Math.cos(headYaw);
    const syh = Math.sin(headYaw);
    const at = ([x, y, z = 0]) => {
        // Tilt about the muzzle's line, lift, then turn.
        const ry = y * cr - z * sr;
        const rz = y * sr + z * cr;
        const lx = x * ch - ry * shh;
        const ly = x * shh + ry * ch;
        return [neckTop[0] + lx * cyh - rz * syh, neckTop[1] + ly, neckTop[2] + lx * syh + rz * cyh];
    };
    // Seen from the front a wolf's skull and muzzle are broad.
    const facing = headYaw + yaw;
    const broad = Math.abs(Math.sin(facing));
    // The muzzle is long and fine, the skull broad behind it with a stop between.
    const snout = shape.muzzle;
    put(at([-1.4, 0.7]), at([2, 0.35]), (3.4 + broad * 0.5) * skull, (2.95 + broad * 0.6) * skull, 1.3, 0.4, 0.55);
    put(
        at([2, -0.4]),
        at([2 + 5.9 * snout, -1.7]),
        (2.3 + broad * 0.2) * skull,
        (1.22 + broad * 0.5) * skull,
        1.1,
        0.5,
        0.14,
    );
    const jawPivot = [1.8, -1.5];
    const jawAt = (local) => {
        const r = rotate([local[0] - jawPivot[0], local[1] - jawPivot[1]], -jaw * DEG);
        return at([r[0] + jawPivot[0], r[1] + jawPivot[1]]);
    };
    const chin = jawAt([1.8 + 5.1 * snout, -2.85]);
    put(jawAt([1.8, -2.1]), chin, 1.4 * skull, (0.82 + broad * 0.2) * skull, 0.8, 0.96, 0.14);
    const ear = (base, tip, back) => {
        const r = rotate([tip[0] - base[0], tip[1] - base[1]], back * DEG);
        return [base[0] + r[0], base[1] + r[1], tip[2]];
    };
    // The ears stand tall and pointed, dark behind.
    const baseA = [-1.5, 2.8, 1.5];
    const baseB = [0.4, 3, -1.5];
    const earTip = (base, dx, side) => [base[0] + dx, base[1] + 4.7 * shape.ear, side * 2.1];
    put(at(baseA), at(ear(baseA, earTip(baseA, -0.7, 1), ears + num(pose.earA))), 2.15, 0.1, 0.4, 0.16, 0.1);
    const farEar = at(ear(baseB, earTip(baseB, -0.2, -1), ears + num(pose.earB)));
    put(at(baseB), farEar, 1.8 + broad * 0.25, 0.1, 0.4, 0.1, 0.1);

    const paws = [];
    legs.forEach(([joint, bone], i) => {
        const isFront = i < 2;
        const near = i % 2 === 0;
        const z = LEG_SIDE[i];
        const [dx, rise0, flex0] = pawCycle(gait + gaitDef.offsets[i], stride, gaitDef);
        const [stepRise, stepFlex] = stepInPlace(stepAt + GAITS.walk.offsets[i], stepHeight);
        let rise = rise0 + stepRise + (isFront ? Math.max(0, num(pose.foreLift?.[i])) : 0);
        let flex = flex0 + stepFlex;
        let pawX = rest[i][0] + dx + (isFront ? reachFore : -reachHind);
        if (isFront && dig > 0) {
            // Digging: the forepaws scrape back through the snow in turn, lifting to reach again.
            const phase = digPhase + (near ? 0 : Math.PI);
            pawX += Math.sin(phase) * 2.6 * dig;
            const up = Math.max(0, Math.cos(phase)) * 2.4 * dig;
            rise += up;
            flex += (up / 2.4) * 0.8;
        }
        // Each paw comes down on the ground under it...
        const grounded = [pawX, groundAt(pawX, z) + rest[i][1] + rise];
        // ...unless the wolf is in the air: then the forelegs reach ahead and the hind legs trail.
        const airborne = lift(isFront ? [rest[i][0] + 7, rest[i][1] + 5] : [rest[i][0] - 7, rest[i][1] + 6]);
        let paw = [mix(grounded[0], airborne[0], tuck), mix(grounded[1], airborne[1], tuck)];
        let raised = tuck;
        if (isFront && near && pawUp > 0) {
            // Alert: the near forepaw lifts and folds at the wrist.
            const up = [rest[i][0] + reachFore - 0.6, groundAt(rest[i][0], z) + rest[i][1] + 5.2];
            paw = [mix(paw[0], up[0], pawUp), mix(paw[1], up[1], pawUp)];
            flex = mix(flex, 1.6, pawUp);
            raised = Math.max(raised, pawUp);
        }
        let footTurn = 0;
        if (!isFront && near && scratch > 0) {
            // Scratching: the near hind paw comes forward under the chest, up to the jaw the head
            // has lowered to it, and strokes (in front of the belly, where its silhouette shows).
            const stroke = Math.sin(num(pose.scratchPhase));
            const target = [
                neckBase[0] + SCRATCH_AT[0] + stroke * 0.9,
                neckBase[1] + SCRATCH_AT[1] + stroke * 1.1,
            ];
            paw = [mix(paw[0], target[0], scratch), mix(paw[1], target[1], scratch)];
            footTurn = SCRATCH_FOOT * scratch;
            raised = Math.max(raised, scratch);
        }
        paws.push([px(paw[0], z), paw[1]]);
        const root = lift(joint);
        const footVec = rotate(
            bone.foot,
            flex * (isFront ? 0.9 : -0.5) + tuck * (isFront ? -0.6 : 0.9) + footTurn,
        );
        // A foot that lies along the ground follows it, on rough ground too.
        const flat = bone.flat * (1 - raised);
        const wristX = paw[0] + footVec[0];
        const wrist = [
            wristX,
            paw[1] + footVec[1] + flat * (groundAt(wristX, z) - groundAt(paw[0], z)),
        ];
        const knee = ik(root, wrist, bone.upper, bone.lower, isFront ? FRONT.bend : HIND.bend);
        const [r0, r1, r2, r3, r4] = bone.radii;
        const [k0, k1, k2] = bone.k;
        // The legs pale toward the paws; the thighs carry the longer fur of the britches.
        const { limb } = shape;
        // (A leg's root lies inside the body: the shoulder and the thigh stand only a little
        // proud of the flank; its paw stands a full stance out to the side.)
        const zRoot = z * 0.45;
        const zKnee = z * 0.8;
        const upperTone = isFront ? 0.58 : 0.5;
        const upperFur = isFront ? 0.7 : 0.95;
        put([root[0], root[1], zRoot], [knee[0], knee[1], zKnee], r0 * limb, r1 * limb, k0, upperTone, upperFur);
        put([knee[0], knee[1], zKnee], [wrist[0], wrist[1], z], r2 * limb, r3 * limb, k1, 0.66, 0.34);
        // The toes rest on the ground under them, which on rough ground is not the paw's.
        const toeX = paw[0] + bone.toe[0];
        const toeGround = groundAt(toeX, z) + rest[i][1] + rise + bone.toe[1];
        const toeAir = [paw[0] + mix(1.5, 1.2, scratch), paw[1] + mix(0.2, 1, scratch)];
        put(
            [wrist[0], wrist[1], z],
            [mix(toeX, toeAir[0], raised), mix(toeGround, toeAir[1], raised), z],
            r3 * limb,
            r4,
            k2,
            0.74,
            0.1,
        );
    });

    // Tail: hangs from the rump, swinging; carried high and waving when the wolf is excited; laid
    // along the ground behind a sitting or lying wolf.
    const tailBase = lift(b.tailBase);
    const swing = tail * DEG;
    // A wolf carries its tail low, hanging toward the hocks, bushiest a third of the way down;
    // raised, it streams out level behind and its tip waves.
    const hang = [-3 + Math.sin(swing) * 1.5, -6 + Math.sin(swing) * 3];
    const raisedTail = [-6.2 + Math.sin(swing) * 0.6, 1.2 + Math.sin(swing) * 2.6];
    const downTail = rotate([mix(hang[0], raisedTail[0], tailUp), mix(hang[1], raisedTail[1], tailUp)], tilt);
    const airMid = [tailBase[0] + downTail[0], tailBase[1] + downTail[1]];
    const hangEnd = [-1 + Math.sin(swing) * 3, -6.4 + Math.sin(swing) * 3.5];
    const raisedEnd = [-5.4 + Math.sin(swing) * 1.2, 1.6 + Math.sin(swing) * 4.4];
    const endOffset = rotate(
        [mix(hangEnd[0], raisedEnd[0], tailUp), mix(hangEnd[1], raisedEnd[1], tailUp)],
        tilt * tailUp,
    );
    const airEnd = [airMid[0] + endOffset[0], airMid[1] + endOffset[1]];
    // On a downhill slope behind it the tail must not trail through the ground.
    const airTip = [airEnd[0], Math.max(airEnd[1], groundAt(airEnd[0]) + 1.6)];
    const groundMidX = tailBase[0] - 5.5;
    const groundMid = [groundMidX, groundAt(groundMidX) + 1.8 + Math.max(0, tail) * 0.04];
    const groundTipX = groundMid[0] - 6 + Math.sin(swing) * 1.5;
    const groundTip = [groundTipX, groundAt(groundTipX) + 1.4 + Math.max(0, tail) * 0.08];
    const lay = sit * (1 - smooth((tailUp - 0.3) / 0.4));
    const tailMid = [mix(airMid[0], groundMid[0], lay), mix(airMid[1], groundMid[1], lay)];
    const tailTip = [mix(airTip[0], groundTip[0], lay), mix(airTip[1], groundTip[1], lay)];
    // A full brush: slim at the root, bushiest a third of the way down, a dark tip.
    const brush = shape.tail;
    const full = mix(3.25, 2.9, lay) * brush;
    const tailLate = [mix(tailMid[0], tailTip[0], 0.56), mix(tailMid[1], tailTip[1], 0.56)];
    put(tailBase, tailMid, 2.1, full, mix(2.2, 2, lay), 0.4, 1.3);
    put(tailMid, tailLate, full, 2.5 * brush, mix(2, 1.8, lay), 0.3, 1.6);

    // The brisket: the ruff runs down the front of the chest between the forelegs.
    put(
        [neckBase[0] + 1.4, neckBase[1] - 3.6, 0],
        fromShoulder(3.6, -5.4),
        3.5 * ruff + girth * 0.5,
        2.7 * ruff + girth * 0.5,
        2.2,
        0.8,
        1.5,
    );
    // The cheek ruff: the fur that stands out below the ears and behind the jaw.
    put(at([-0.9, -1.9]), at([1.3, -2.5]), 2.5 * ruff * skull, 1.7 * ruff * skull, 1.5, 0.92, 1.2);
    put(tailLate, tailTip, 2.5 * brush, mix(0.95, 0.9, lay), mix(1.8, 1.6, lay), 0.04, 1.3);

    // The eyes: each glints while it faces the viewer.
    const eyeA = at([2.9, 1, 1.3]);
    const eyeB = at([2.9, 1, -1.3]);
    const seen = (side) => smooth((Math.sin(facing + side * EYE_SPREAD) - 0.05) / 0.35);
    const muzzle = at([2 + 6.4 * snout, -2]);
    return {
        capsules: out,
        eye: [px(eyeA[0], eyeA[2]), eyeA[1], seen(1)],
        eye2: [px(eyeB[0], eyeB[2]), eyeB[1], seen(-1)],
        muzzle: [px(muzzle[0], muzzle[2]), muzzle[1]],
        toward: Math.sin(facing) * Math.cos(headAngle),
        paws,
    };
}

/**
 * Blend two posed rigs (`a` toward `b` by `w`, 0..1) into `out`: capsule by capsule (the builds
 * share one layout), with the eyes, muzzle and paws.
 */
export function blendRigs(a, b, w, out = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE)) {
    const t = clamp01(num(w));
    for (let i = 0; i < out.length; i++) out[i] = mix(a.capsules[i], b.capsules[i], t);
    const lerp2 = (p, q) => p.map((v, k) => mix(v, q[k], t));
    return {
        capsules: out,
        eye: lerp2(a.eye, b.eye),
        eye2: lerp2(a.eye2, b.eye2),
        muzzle: lerp2(a.muzzle, b.muzzle),
        toward: mix(a.toward ?? 0, b.toward ?? 0, t),
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
