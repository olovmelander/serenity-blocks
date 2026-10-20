/**
 * THE MASSIF'S EAGLE — how it flies (three-free; tests and the board ask it directly).
 *
 * A golden eagle working the thermal that rises off the hero massif's south flank, beside the
 * chapter-4 rail where the meadows end and the wall begins: it circles in the thermal while the
 * thermal itself wanders slowly round a wider loop and climbs, leans into every turn, rides the
 * air on a shallow V with its primaries splayed, and a few times a round puts in a short bout of
 * deep, slow wingbeats. Everything is closed form in the board clock (the clock is only ever
 * multiplied by constants — the closed-form phase trap), so a seek shows the same bird in the
 * same place with the same wings.
 *
 * PORTED from the Himalayan Peak theme (`himalayan-peak-eagle-flight.js`, which Odyssey may not
 * import): the joint posing is that module's, unchanged, so the Blender-built model
 * (`assets/chapter-04/eagle.glb`, 26 bones) moves exactly as it was tuned to. What differs is
 * WHERE: the theme's thermal hangs at a bearing from a fixed eye; Odyssey's is a world place
 * (`ODYSSEY_EAGLE.thermal`), sited against the real rail and terrain (odyssey-eagle.test.js).
 *
 * The bird's frame: x to its left, y up, z forward (the model's). Joint angles are radians,
 * applied in the order z, y, x about the bone's own axes (three's Euler order 'ZYX').
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The thermal and the flight:
 *   thermal   centre (world), the turn radius, and the slow loop the thermal makes over a round
 *             (x/z wander, height swing, the tilt of each turn) — world units
 *   round     seconds one round takes; `turns` circles of the thermal fit in it
 *   span      wingspan as drawn (world units): five times life, as a long lens shows it
 *   window    [fade in from, fully in by, fade out from, gone by] in JOURNEY progress
 *
 * The window ends where the camera has CLIMBED PAST the bird, not at a round number. It used to
 * fade over p 0.386-0.404 with the whole thermal still in frame, so the player parked at L28
 * (p 0.3996) watched it dissolve to 15 % in the middle of the picture. Measured on the real
 * camera (odyssey-act2-fade-out-of-view.test.js): the thermal stays in frame up the wall and
 * through the glide from L28, slides off the lower right as the rail passes it (closest ~60 u at
 * p ~0.44), and is wholly out of frame from p 0.446. It now fades just after that, and is gone
 * before L29 (p 0.4503) parks, so no parked orb draws a bird it cannot see. The fade in
 * (0.300-0.318) happens off frame up and to the right of the L23-L24 views.
 */
export const ODYSSEY_EAGLE = Object.freeze({
    thermal: Object.freeze({
        x: -96,
        y: 612,
        z: -616,
        radius: 46,
        wanderX: 20,
        wanderZ: 24,
        swing: 12,
        tilt: 6,
    }),
    round: 84,
    turns: 3,
    span: 11,
    window: Object.freeze([0.300, 0.318, 0.4470, 0.4500]),
});
/** Wingbeats a second in a bout. */
export const EAGLE_BEAT = 1.6;
/** The bouts in a round: [start (s into the round), beats]. */
export const EAGLE_BOUTS = Object.freeze([[14.0, 4], [40.0, 3], [69.5, 5]]);
/** How much more the bird leans than a coordinated turn needs (it shows the wings' spread). */
const LEAN_GAIN = 2.8;
const LEAN_MAX = 0.78;
const G = 9.81;

/** The eagle's place at `time` (world). */
export function eaglePoint(time, out = { x: 0, y: 0, z: 0 }, cfg = ODYSSEY_EAGLE) {
    const th = cfg.thermal;
    const phi = (time / cfg.round) * TAU * cfg.turns + 0.9;
    const psi = (time / cfg.round) * TAU;
    out.x = th.x + Math.cos(phi) * th.radius + Math.sin(psi) * th.wanderX;
    out.z = th.z - Math.sin(phi) * th.radius + Math.cos(psi + 0.7) * th.wanderZ;
    out.y = th.y + Math.sin(psi + 1.2) * th.swing + Math.sin(phi + 0.3) * th.tilt;
    return out;
}

const pa = { x: 0, y: 0, z: 0 };
const pb = { x: 0, y: 0, z: 0 };
const pc = { x: 0, y: 0, z: 0 };
const H = 0.02;

/** Position, heading (unit) and lean (radians, positive with its left wing down) at `time`. */
export function eaglePath(time, out = {
    x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 1, lean: 0,
}, cfg = ODYSSEY_EAGLE) {
    eaglePoint(time - H, pa, cfg);
    eaglePoint(time, pb, cfg);
    eaglePoint(time + H, pc, cfg);
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

/** The bout of wingbeats under way at `time`: amount (0..1) and the beat's phase. */
export function eagleBout(time, out = { amount: 0, phase: 0 }, cfg = ODYSSEY_EAGLE) {
    const local = wrap01(time / cfg.round) * cfg.round;
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

const DOWN = 0.55;
function beatHeight(phase) {
    const p = wrap01(phase);
    return p < DOWN ? Math.cos((Math.PI * p) / DOWN) : -Math.cos((Math.PI * (p - DOWN)) / (1 - DOWN));
}
const beatFold = (phase) => {
    const p = wrap01(phase);
    if (p < DOWN) return 0;
    const s = Math.sin((Math.PI * (p - DOWN)) / (1 - DOWN));
    return s * s;
};
const beatPush = (phase) => {
    const p = wrap01(phase);
    return p < DOWN ? Math.sin((Math.PI * p) / DOWN) : 0;
};
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
        left: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, 1],
        heave: 0,
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
 * @param {number} time board clock (s)
 * @param {object} [air]
 * @param {number} [air.wind] 0..1 how hard the air works the bird (the act's wind)
 * @param {boolean} [air.reduced] reduced motion: it glides, and the air hardly moves it
 * @param {object} [pose] createEaglePose() to write into
 * @param {object} [cfg] ODYSSEY_EAGLE override
 */
export function eagleFlight(time, { wind = 0.3, reduced = false } = {}, pose = createEaglePose(), cfg = ODYSSEY_EAGLE) {
    const path = eaglePath(time, pose.path, cfg);
    const bout = eagleBout(time, pose.bout, cfg);
    if (reduced) bout.amount = 0;
    const flap = bout.amount;
    const glide = 1 - flap;
    const w = Math.max(0, Math.min(1, wind));
    const calm = reduced ? 0.3 : 1;

    const sway = teeter(time) * (0.45 + 0.9 * w) * glide * calm;
    const answer = -teeter(time - 0.3) * (0.45 + 0.9 * w) * glide * calm * 0.9;
    pose.roll = -path.lean + sway * DEG;

    // The body's frame: heading, then the roll about it (built from world up: never a flip).
    const { hx, hy, hz } = path;
    const flat = Math.hypot(hx, hz) || 1;
    const lx = hz / flat;
    const lz = -hx / flat;
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

    const p = bout.phase;
    const height = beatHeight(p);
    const tip = beatHeight(p - 0.07);
    const fold = beatFold(p);
    const push = beatPush(p);
    pose.heave = -0.05 * beatHeight(p - 0.12) * flap;

    const tuck = (0.12 + 0.55 * w) * calm + (reduced ? 0.12 : 0);
    const breathe = Math.sin(time * 0.23 + 0.6) * 2 * calm;
    const load = 0.6 + 0.4 * Math.min(1, Math.abs(path.lean) / 0.35);
    const turn = Math.max(-1, Math.min(1, path.lean / 0.3));

    const mix = (a, b) => a * glide + b * flap;
    const { joints } = pose;
    for (let side = 0; side < 2; side++) {
        const [sfx, sign] = SIDES[side];
        const lift = sign * answer;
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
            const flick = Math.sin(time * 5.3 + j * 1.7 + side * 2.1) * 1.5 * w * calm;
            const curl = (9 + 6 * load) * reach * (1 - tuck * 0.4) + flick;
            const spread = mix((j - 3) * 1.8 * (1 - tuck * 0.6), (j - 3) * (1.2 + 2.6 * fold));
            setJoint(joints, fingers[j], 0, sign * spread, sign * mix(curl, (14 * push - 8 * fold) * reach));
        }
    }

    const fan = (10 + 8 * Math.abs(turn) - 7 * tuck) * glide + 16 * flap;
    setJoint(pose.joints, 'tail', 3 * flap * height, 0, -6 * turn);
    setJoint(pose.joints, 'tailL', 0, -fan, 0);
    setJoint(pose.joints, 'tailR', 0, fan, 0);

    setJoint(pose.joints, 'root', 2.5 * height * flap, 0, 0);
    const look = 14 * turn + (10 * Math.sin(time * 0.31 + 0.5) + 5 * Math.sin(time * 0.83 + 2.2)) * calm;
    const level = -pose.roll / DEG;
    setJoint(pose.joints, 'neck', 0, look * 0.4, level * 0.35);
    setJoint(pose.joints, 'head', -3 * flap * height, look * 0.6, level * 0.45);
    return pose;
}

/** Reveal (0..1) at journey progress `p`. */
export function eagleRevealAt(p, cfg = ODYSSEY_EAGLE) {
    const [a, b, c, d] = cfg.window;
    return smooth(a, b, p) * (1 - smooth(c, d, p));
}
