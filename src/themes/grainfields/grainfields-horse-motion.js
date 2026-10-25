/**
 * Grainfields — how a horse moves (CPU, three-free): its stride, its legs on the ground and in the
 * air, its back, neck, head, jaw, ears and tail, from what the band's life asks of it
 * (grainfields-herd-sim.js) and the gaits' numbers (grainfields-gait.js). It writes a pose of the
 * horse's skeleton (grainfields-horse-rig.js) each step.
 *
 * The legs. A hoof on the ground stays where it struck: each frame the leg is solved to it (the
 * pastern sloped by the weight on the fetlock, the hoof flat, its heel lifting over the toe as the
 * leg leaves), so a horse walks over its feet instead of sliding them. A leg is solved as one
 * flexion of its upper joints (the fore's shoulder and elbow, the hind's stifle and hock, which a
 * horse cannot move apart) and an aim about the top of the shoulder blade or the hip. In the air a
 * leg moves from where it left the ground to where it will land (one stride on, at that ground's
 * height), its elbow and knee or stifle and hock folding, its fetlock curling, the fore reaching
 * past its touchdown and drawing back onto it. At a walk and faster the gait's footfalls say when
 * each leg lifts; slower than that a horse stands, and a leg steps (one at a time) only when the
 * body has moved or turned off it.
 *
 * The body rides the ground under its fore and hind feet and the stride (the withers and the
 * croup each on their beat), pitches back when it brakes, banks into a turn; the back rounds and
 * stretches at a canter and a gallop.
 *
 * The neck and head go where the horse's business puts them (in the barley's ears or down to the
 * grass, up to look, low and still to doze), each joint on a critically damped spring, and nod with
 * the stride. Grazing is a cycle: reach, bite, a tug that tears the mouthful off, then chewing with
 * the head lifted a little. The ears turn on their own. The tail is carried with the gait and
 * swished at the flies; its hair is a chain of damped springs that the body's own accelerations
 * swing, so it streams, bounces and whips. The mane's freedom is the vertex stage's, from the wind
 * and the horse's motion (`flow`).
 */
import { clamp, mulberry32, smooth } from './grainfields-core.js';
import {
    bodyAt, ease, gaitAt, gaitFor, swingShape, wrap,
} from './grainfields-gait.js';
import { createPose, poseRig } from './grainfields-horse-rig.js';

/** How far a leg's upper joints may open (negative) or fold (positive), radians. */
const FLEX = Object.freeze({ fore: [-0.62, 1.15], hind: [-0.58, 1.0] });
/** A hoof's height over the ground at its coffin joint, and the toe ahead of it (metres, horse scale). */
const HOOF = Object.freeze({ coffin: 0.05, toe: 0.045 });
/** A standing leg steps when its hoof is this far from under the body (metres, horse scale). */
const STEP = Object.freeze({
    far: 0.16, square: 0.07, time: 0.42, gap: 0.08, settle: 2.5,
});
/** How far a leg's fetlock sinks standing (radians). */
const STANDING_LOAD = 0.1;
/** Where the muzzle is in the rest pose when the asset says nothing (horse frame, metres). */
const MUZZLE = Object.freeze([0, 1.265, 1.408]);
/** How high the barley's ears stand, where a horse browses them (metres over the ground). */
export const BARLEY_TOPS = 0.86;

// ── 2D (y, z) helpers in a leg's plane: rot(t) turns +z toward -y, as a bone's pitch does ──
function rot2(t, y, z, out) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    out[0] = y * c - z * s;
    out[1] = y * s + z * c;
    return out;
}
const angle2 = (y, z) => Math.atan2(z, y);
/** An angle folded into (-pi, pi]. */
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A leg of the rig: its bones, the segments between its joints (y, z) and its rest coffin. */
function legSpec(rig, front, side) {
    const names = front
        ? ['scapula', 'humerus', 'forearm', 'foreCannon', 'forePastern', 'foreHoof']
        : ['femur', 'tibia', 'hindCannon', 'hindPastern', 'hindHoof'];
    const bones = names.map((name) => rig.index[name + side]);
    const yz = bones.map((b) => [rig.heads[b * 3 + 1], rig.heads[b * 3 + 2]]);
    const seg = (a, b) => [yz[b][0] - yz[a][0], yz[b][1] - yz[a][1]];
    const n = bones.length;
    const hoof = bones[n - 1];
    return {
        front,
        side,
        bones,
        parent: rig.parents[bones[0]],
        segs: front ? [seg(0, 1), seg(1, 2), seg(2, 3), seg(3, 4)] : [seg(0, 1), seg(1, 2), seg(2, 3)],
        pastern: seg(n - 2, n - 1),
        root: [rig.heads[bones[0] * 3], rig.heads[bones[0] * 3 + 1], rig.heads[bones[0] * 3 + 2]],
        coffin: [rig.heads[hoof * 3], rig.heads[hoof * 3 + 1], rig.heads[hoof * 3 + 2]],
        flex: front ? FLEX.fore : FLEX.hind,
    };
}

const t2a = [0, 0];
const t2b = [0, 0];
/**
 * Where a leg's fetlock is (y, z from its top joint, before the aim) for a flexion `f`, the fore's
 * forearm swung `e` forward of its shoulder blade (radians, negative forward) and the knee or the
 * hind's cannon turned `k`.
 */
export function chainEnd(leg, f, e, k, out = [0, 0]) {
    const [a, b, c, d] = leg.segs;
    if (leg.front) {
        // Shoulder blade to shoulder joint; humerus turned f; forearm at e; cannon at e + k.
        out[0] = a[0];
        out[1] = a[1];
        rot2(f, b[0], b[1], t2a);
        out[0] += t2a[0];
        out[1] += t2a[1];
        rot2(e, c[0], c[1], t2a);
        out[0] += t2a[0];
        out[1] += t2a[1];
        rot2(e + k, d[0], d[1], t2a);
        out[0] += t2a[0];
        out[1] += t2a[1];
        return out;
    }
    // Femur turned -f/2; tibia at 0.8 f (the stifle and the hock fold together); cannon at k.
    rot2(-0.5 * f, a[0], a[1], t2a);
    rot2(0.8 * f, b[0], b[1], t2b);
    out[0] = t2a[0] + t2b[0];
    out[1] = t2a[1] + t2b[1];
    rot2(k, c[0], c[1], t2a);
    out[0] += t2a[0];
    out[1] += t2a[1];
    return out;
}

const tEnd = [0, 0];
/**
 * The flexion and aim that put a leg's fetlock at `ty, tz` (from its top joint, in its parent's
 * frame, rest metres) with the knee or hock straight: { f, aim, reach } (reach 1 when the target
 * was inside the leg's range).
 */
export function solveLeg(leg, ty, tz, out = {}) {
    const want = Math.hypot(ty, tz);
    let [lo, hi] = leg.flex;
    const dLo = Math.hypot(...chainEnd(leg, lo, 0, 0, tEnd));
    const dHi = Math.hypot(...chainEnd(leg, hi, 0, 0, tEnd));
    let f;
    if (want >= dLo) f = lo;
    else if (want <= dHi) f = hi;
    else {
        for (let i = 0; i < 22; i++) {
            const mid = 0.5 * (lo + hi);
            if (Math.hypot(...chainEnd(leg, mid, 0, 0, tEnd)) > want) lo = mid;
            else hi = mid;
        }
        f = 0.5 * (lo + hi);
    }
    chainEnd(leg, f, 0, 0, tEnd);
    out.f = f;
    out.aim = wrapAngle(angle2(ty, tz) - angle2(tEnd[0], tEnd[1]));
    out.reach = want < dLo && want > dHi ? 1 : 0;
    return out;
}

const tPas = [0, 0];
/**
 * A planted leg's angles for its coffin at `cy, cz` (from the top joint, in the parent's frame,
 * rest metres), its parent pitched `pitch` in the world, the fetlock sunk `drop` and the heel lifted
 * `tilt` over the toe: writes { aim, f, e, k, p, c }.
 */
export function stanceAngles(leg, cy, cz, pitch, drop, tilt, out) {
    // The pastern slopes the more the fetlock sinks; the hoof stays flat on the ground.
    const pastern = -drop - pitch;
    rot2(pastern, leg.pastern[0], leg.pastern[1], tPas);
    solveLeg(leg, cy - tPas[0], cz - tPas[1], out);
    out.e = 0;
    out.k = 0;
    out.p = pastern - out.aim;
    out.c = tilt + drop;
    return out;
}

/** A leg's angles onto its bones' pitch (writes the rig pose's local x). */
function writeLeg(leg, a, local) {
    const [b0, b1, b2, b3, b4, b5] = leg.bones;
    if (leg.front) {
        local[b0 * 3] = a.aim;
        local[b1 * 3] = a.f;
        local[b2 * 3] = -a.f + a.e;
        local[b3 * 3] = a.k;
        local[b4 * 3] = a.p;
        local[b5 * 3] = a.c;
    } else {
        local[b0 * 3] = a.aim - 0.5 * a.f;
        local[b1 * 3] = 1.3 * a.f;
        local[b2 * 3] = -0.8 * a.f + a.k;
        local[b3 * 3] = a.p;
        local[b4 * 3] = a.c;
    }
}

const ANGLES = ['aim', 'f', 'e', 'k', 'p', 'c'];
const blankAngles = () => ({
    aim: 0, f: 0, e: 0, k: 0, p: 0, c: 0, reach: 1,
});

/** A critically damped spring toward a target (implicit, stable at any step). */
function spring(s, target, omega, dt) {
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const det = 1 / (f + hhoo);
    const x = (f * s.x + dt * s.v + hhoo * target) * det;
    s.v = (s.v + hoo * (target - s.x)) * det;
    s.x = x;
    return x;
}
const sp = (x = 0) => ({ x, v: 0 });

/** The head's channels (springs) and how fast each follows (rad/s). */
const HEAD = Object.freeze({
    bend: 4.2, yaw: 3.2, pitch: 5, headYaw: 5, roll: 4, jaw: 22, side: 18, tug: 16,
});

/**
 * A horse's motion: `rig` (grainfields-horse-rig.js createRig), `seed` (0..1) for its own habits,
 * `lead` (+1 right, -1 left), `landmarks` (the asset's: { muzzle }).
 */
export function createHorseMotion(rig, { seed = 0.5, lead = 1, landmarks = {} } = {}) {
    const legs = [legSpec(rig, true, 'L'), legSpec(rig, true, 'R'), legSpec(rig, false, 'L'), legSpec(rig, false, 'R')];
    const rng = mulberry32(Math.floor(seed * 0x7fffffff) ^ 0x5bd1e995);
    const I = rig.index;
    return {
        rig,
        seed,
        rng,
        pose: createPose(rig),
        place: {
            x: 0, y: 0, z: 0, heading: 0, scale: 1,
        },
        lead: lead < 0 ? -1 : 1,
        legs: legs.map((spec) => ({
            spec,
            planted: true,
            stepping: false,
            plant: [0, 0, 0],
            coffin: [0, 0, 0],
            w: 1,
            swingTime: STEP.time,
            from: blankAngles(),
            to: blankAngles(),
            now: blankAngles(),
            landed: 0,
        })),
        started: false,
        g: 0,
        phase: wrap(seed * 3.7),
        gait: gaitAt(0, lead),
        body: {},
        still: 0,
        lastStep: 0,
        // The head and neck.
        head: {
            bend: sp(0.4),
            yaw: sp(),
            pitch: sp(0.2),
            headYaw: sp(),
            roll: sp(),
            jaw: sp(),
            side: sp(),
            tugPitch: sp(),
            tugYaw: sp(),
        },
        ears: [0, 1].map(() => ({
            x: sp(), y: sp(), z: sp(), aim: [0, 0, 0], until: 0,
        })),
        eat: {
            stage: 'reach', until: 0, side: 1, bites: 0,
        },
        rest: 0,
        swish: { phase: rng() * 6.28, burst: 0 },
        tail: Array.from({ length: 6 }, () => ({
            x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
        })),
        tailBones: [0, 1, 2, 3, 4, 5].map((i) => I[`tail${i}`]),
        velocity: [0, 0, 0],
        accel: [0, 0, 0],
        flow: [0, 0, 0],
        muzzle: landmarks.muzzle || MUZZLE,
        neck: [I.neck0, I.neck1, I.neck2, I.head],
        bones: I,
    };
}

// ── the body ──────────────────────────────────────────────────────────────────────────
const bodyScratch = {};
/** The body's place and turn: height over the ground under its feet, pitch, bank, the back. */
function placeBody(m, h, ground, gait) {
    const s = h.scale || 1;
    const fx = Math.sin(h.heading);
    const fz = Math.cos(h.heading);
    const { local } = m.pose;
    const I = m.bones;
    // The ground under the fore feet and under the hind (0.5 m ahead of the root, 0.65 m behind).
    const gF = ground(h.x + fx * 0.5 * s, h.z + fz * 0.5 * s);
    const gH = ground(h.x - fx * 0.65 * s, h.z - fz * 0.65 * s);
    const b = bodyAt(gait, m.phase, bodyScratch);
    // A resting horse sinks a little onto its cocked hind.
    const front = gF + (b.front - 0.006 * m.rest) * s;
    const hind = gH + (b.hind - 0.025 * m.rest) * s;
    const span = 1.15 * s;
    m.place.x = h.x;
    m.place.z = h.z;
    m.place.y = hind + (front - hind) * (0.65 / 1.15) + 1.0 * s;
    m.place.heading = h.heading;
    m.place.scale = s;
    // Pitch (positive nose down): the ground and the stride, a sit back when it brakes.
    const accel = h.accel || 0;
    const pitch = Math.atan2(hind - front, span) - Math.max(0, -accel) * 0.012 + Math.max(0, accel) * 0.005;
    // Bank into a turn; a resting horse drops the hip of its cocked leg.
    const restSide = (h.seed || 0) < 0.5 ? 1 : -1;
    const roll = clamp((h.speed || 0) * (h.yawRate || 0) * 0.045, -0.2, 0.2) + restSide * 0.03 * m.rest;
    local[I.root * 3] = pitch;
    local[I.root * 3 + 2] = roll;
    // The back rounds (the croup tucks, the withers drop) and stretches.
    local[I.pelvis * 3] = -0.7 * b.flex;
    local[I.chest * 3] = 0.4 * b.flex;
    local[I.pelvis * 3 + 2] = restSide * 0.02 * m.rest;
    return b;
}

// ── the legs ──────────────────────────────────────────────────────────────────────────
const plane = [0, 0];
/** A world point in a leg's plane: (y, z) from its top joint, in its parent's frame, rest metres. */
function toLeg(m, legState, px, py, pz, out) {
    const { pose, place } = m;
    const leg = legState.spec;
    const root = leg.bones[0];
    const fx = Math.sin(place.heading);
    const fz = Math.cos(place.heading);
    const ax = pose.at[root * 3];
    const ay = pose.at[root * 3 + 1];
    const az = pose.at[root * 3 + 2];
    const s = place.scale;
    const dy = (py - ay) / s;
    const dz = ((px - ax) * fx + (pz - az) * fz) / s;
    const pitch = parentPitch(m, leg.parent);
    rot2(-pitch, dy, dz, out);
    return pitch;
}

/** A bone's pitch in the world (its +z axis against the horizontal, in the heading's plane). */
function parentPitch(m, bone) {
    const r = m.pose.rot;
    const o = bone * 9;
    const fx = Math.sin(m.place.heading);
    const fz = Math.cos(m.place.heading);
    return Math.atan2(-r[o + 5], r[o + 2] * fx + r[o + 8] * fz);
}

/** Where a leg's coffin rests under the body now (world), on the ground there. */
function neutralFoot(m, legState, ground, ahead, out) {
    const { place } = m;
    const s = place.scale;
    const fx = Math.sin(place.heading);
    const fz = Math.cos(place.heading);
    const [cx, , cz] = legState.spec.coffin;
    // The rest coffin relative to the root bone's head (x left, z forward), turned to the heading.
    const lx = cx * s;
    const lz = (cz - m.rig.heads[2]) * s + ahead;
    out[0] = place.x + lz * fx + lx * fz;
    out[2] = place.z + lz * fz - lx * fx;
    out[1] = ground(out[0], out[2]) + HOOF.coffin * s;
    return out;
}

const foot = [0, 0, 0];
const toe = [0, 0];
/** A planted leg solved to its plant (the heel lifting `tilt` over the toe as it leaves). */
function plantedAngles(m, legState, drop, tilt, out) {
    const s = m.place.scale;
    const [px, py, pz] = legState.plant;
    let qx = px;
    let qy = py;
    let qz = pz;
    if (tilt > 1e-4) {
        // Breakover: the coffin turns up about the toe.
        const fx = Math.sin(m.place.heading);
        const fz = Math.cos(m.place.heading);
        rot2(tilt, HOOF.coffin * s, -HOOF.toe * s, toe);
        qy = py - HOOF.coffin * s + toe[0];
        const along = HOOF.toe * s + toe[1];
        qx = px + fx * along;
        qz = pz + fz * along;
    }
    const pitch = toLeg(m, legState, qx, qy, qz, plane);
    return stanceAngles(legState.spec, plane[0], plane[1], pitch, drop, tilt, out);
}

/** The angles a leg will land with: its coffin at `target` (world). */
function landingAngles(m, legState, target, drop, out) {
    const pitch = toLeg(m, legState, target[0], target[1], target[2], plane);
    return stanceAngles(legState.spec, plane[0], plane[1], pitch, drop, 0, out);
}

const shape = {};
/** A leg in the air at `w` of its swing: from lift-off toward touchdown, folding as it goes. */
function swingAngles(legState, gait, w, out) {
    const { from, to } = legState;
    const e = ease(w);
    ANGLES.forEach((key) => { out[key] = from[key] + (to[key] - from[key]) * e; });
    swingShape(w, shape);
    // The upper joints fold to the gait's own flexion mid-swing, however stretched the leg left and
    // will land (a bump on top of two stretched ends would drag the hoof through the ground).
    if (legState.spec.front) {
        out.f += (gait.fold - out.f) * shape.fold;
        out.e -= gait.elbow * shape.fold;
        out.k += gait.knee * shape.knee;
        out.p += gait.curl * shape.curl;
        out.c += 0.35 * gait.curl * shape.curl;
        out.aim -= gait.reach * shape.reach;
    } else {
        out.f += (gait.stifle - out.f) * shape.fold;
        out.k -= gait.hock * shape.fold;
        out.p += gait.curl * 0.9 * shape.curl;
        out.c += 0.3 * gait.curl * shape.curl;
        out.aim -= 0.45 * gait.reach * shape.reach;
    }
    return out;
}

const landing = [0, 0, 0];
function liftOff(legState, duration) {
    legState.planted = false;
    legState.w = 0;
    legState.swingTime = Math.max(0.12, duration);
    ANGLES.forEach((key) => { legState.from[key] = legState.now[key]; });
}

function touchDown(m, legState, ground, time) {
    legState.planted = true;
    legState.stepping = false;
    legState.w = 1;
    legState.landed = time;
    const [x, , z] = legState.coffin;
    legState.plant[0] = x;
    legState.plant[2] = z;
    legState.plant[1] = ground(x, z) + HOOF.coffin * m.place.scale;
}

/** Each leg's angles for this step: the stride's footfalls at speed, single steps when standing. */
function stepLegs(m, h, ground, gait, dt, time) {
    const s = m.place.scale;
    const speed = Math.max(0, h.speed || 0);
    const cyclic = m.g >= 0.5 && gait.freq > 0.05;
    const stride = cyclic ? (speed * gait.duty) / gait.freq : 0;
    const swingTime = cyclic ? (1 - gait.duty) / gait.freq : STEP.time * Math.sqrt(s);
    if (h.treadmill) {
        // A horse kept on the spot (a capture's lineup): the ground runs back under its hooves.
        const fx = Math.sin(m.place.heading) * speed * dt;
        const fz = Math.cos(m.place.heading) * speed * dt;
        m.legs.forEach((leg) => {
            leg.plant[0] -= fx;
            leg.plant[2] -= fz;
        });
    }
    // Standing: is any leg in the air, and which one most needs to step?
    let airborne = 0;
    let worst = -1;
    let worstErr = 0;
    m.legs.forEach((leg, i) => {
        if (!leg.planted) airborne += 1;
        else if (!cyclic) {
            neutralFoot(m, leg, ground, 0, foot);
            const err = Math.hypot(foot[0] - leg.plant[0], foot[2] - leg.plant[2]) / s;
            const limit = m.still > STEP.settle ? STEP.square : STEP.far;
            if (err > limit && err > worstErr) {
                worst = i;
                worstErr = err;
            }
        }
    });
    if (!cyclic && airborne === 0 && worst >= 0 && time - m.lastStep > STEP.gap) {
        liftOff(m.legs[worst], swingTime);
        m.legs[worst].stepping = true;
        m.lastStep = time;
    }
    m.legs.forEach((leg, i) => {
        const psi = wrap(m.phase - gait.offsets[i]);
        const inStance = psi < gait.duty;
        if (leg.planted) {
            if (cyclic && !inStance) liftOff(leg, swingTime);
        }
        if (leg.planted) {
            // On the ground: the fetlock sinks through the stance, the heel lifts as it ends (both
            // eased in as a stand breaks into a walk).
            const k = cyclic ? psi / Math.max(0.05, gait.duty) : 0.5;
            const striding = cyclic ? smooth(0.5, 0.9, m.g) : 0;
            const load = (gait.load - STANDING_LOAD) * Math.sin(Math.PI * k) ** 1.2 * striding;
            const drop = STANDING_LOAD + load;
            const tilt = 0.55 * smooth(0.72, 1.0, k) * striding;
            plantedAngles(m, leg, drop, tilt, leg.now);
            // A hoof the leg cannot reach (the body ran on, or turned) lets go.
            if (!leg.now.reach && !cyclic && airborne === 0) {
                liftOff(leg, swingTime);
                leg.stepping = true;
                airborne += 1;
            }
            if (leg.planted) return;
        }
        // In the air: the swing's own clock, kept in step with the stride's.
        const byPhase = cyclic && !inStance ? (psi - gait.duty) / Math.max(0.05, 1 - gait.duty) : 0;
        const catchUp = cyclic && inStance ? 0.15 : leg.swingTime;
        leg.w = Math.min(1, Math.max(leg.w + dt / catchUp, leg.stepping ? 0 : byPhase));
        // Where it will land: one half-stride ahead of its rest under the body (at speed), on the
        // ground there; the body runs on until then.
        const remain = (1 - leg.w) * leg.swingTime;
        neutralFoot(m, leg, ground, stride * 0.5 + speed * remain, landing);
        // (Solved where the leg will be when it lands: back by the ground the body covers until then.)
        const ahead = speed * remain;
        landing[0] -= Math.sin(m.place.heading) * ahead;
        landing[2] -= Math.cos(m.place.heading) * ahead;
        landingAngles(m, leg, landing, STANDING_LOAD, leg.to);
        swingAngles(leg, gait, leg.w, leg.now);
        if (leg.w >= 1 && (!cyclic || inStance || leg.stepping)) leg.touch = true;
    });
}

// ── the head and neck ─────────────────────────────────────────────────────────────────
/** How a neck's bend is shared down its bones: mostly at its base, like a boom. */
const NECK_SHARE = Object.freeze([0.55, 0.28, 0.17]);

/**
 * The muzzle's height over the ground for a neck bent `bend` and the head held at `face` (its pitch
 * in the world, from its rest carriage: positive turns the face down toward the vertical).
 */
function muzzleHeight(m, bend, face, groundY) {
    const { rig, pose } = m;
    const [n0, n1, n2, hd] = m.neck;
    const s = m.place.scale;
    const P = parentPitch(m, rig.parents[n0]);
    const H = (b, c) => rig.heads[b * 3 + c];
    const step = (from, to, a) => {
        rot2(a, (H(to, 1) - H(from, 1)) * s, (H(to, 2) - H(from, 2)) * s, t2a);
        return t2a[0];
    };
    let angle = P + NECK_SHARE[0] * bend;
    let y = pose.at[n0 * 3 + 1] + step(n0, n1, angle);
    angle += NECK_SHARE[1] * bend;
    y += step(n1, n2, angle);
    angle += NECK_SHARE[2] * bend;
    y += step(n2, hd, angle);
    rot2(face, (m.muzzle[1] - H(hd, 1)) * s, (m.muzzle[2] - H(hd, 2)) * s, t2a);
    return y + t2a[0] - groundY;
}

/** The neck's bend that puts the muzzle `height` over the ground with the head held at `face`. */
function bendFor(m, height, groundY, face) {
    let lo = -0.5;
    let hi = 2.1;
    for (let i = 0; i < 18; i++) {
        const mid = 0.5 * (lo + hi);
        if (muzzleHeight(m, mid, face, groundY) > height) lo = mid;
        else hi = mid;
    }
    return 0.5 * (lo + hi);
}

/** Grazing: reach, bite, tear, chew; the muzzle's target height and the jaw's work. */
function graze(m, h, time, out) {
    const { eat } = m;
    const verge = Boolean(h.verge);
    const r = m.rng;
    if (time >= eat.until) {
        const next = {
            reach: 'bite', bite: 'tear', tear: verge && eat.bites < 3 ? 'reach' : 'chew', chew: 'reach',
        }[eat.stage] || 'reach';
        eat.stage = next;
        if (next === 'reach') eat.side = r() < 0.5 ? -1 : 1;
        eat.bites = next === 'chew' ? 0 : eat.bites + (next === 'bite' ? 1 : 0);
        const lasts = {
            reach: verge ? [0.35, 0.8] : [0.6, 1.4],
            bite: [0.18, 0.3],
            tear: [0.22, 0.32],
            chew: verge ? [1.5, 3] : [2.2, 5],
        }[next];
        eat.until = time + lasts[0] + (lasts[1] - lasts[0]) * r();
    }
    const ground = verge ? 0.04 : BARLEY_TOPS - 0.08 + 0.12 * Math.sin(time * 0.31 + m.seed * 20);
    out.height = ground;
    out.face = verge ? 0.72 : 0.38;
    out.yaw = eat.side * 0.12;
    out.jaw = 0;
    out.side = 0;
    out.tugPitch = 0;
    out.tugYaw = 0;
    out.ears = 'graze';
    if (eat.stage === 'bite') {
        out.height -= 0.04;
        out.jaw = 0.2;
    } else if (eat.stage === 'tear') {
        // The tug: a sharp lift and turn of the head that tears the mouthful away.
        out.tugPitch = -0.16;
        out.tugYaw = eat.side * 0.14;
        out.jaw = 0.03;
    } else if (eat.stage === 'chew') {
        out.height += verge ? 0.06 : 0.12;
        out.face -= 0.1;
        const chew = time * 2 * Math.PI * 1.35 + m.seed * 9;
        out.jaw = 0.05 + 0.045 * Math.sin(chew);
        out.side = 0.035 * Math.cos(chew);
    }
    return out;
}

const want = {};
/** The head and neck's targets from the horse's business, and the springs toward them. */
function stepHead(m, h, ground, gait, b, dt, time) {
    const { local } = m.pose;
    const I = m.bones;
    const fast = smooth(2.5, 3.8, m.g);
    const moving = smooth(0.25, 1.0, m.g);
    const business = h.business || 'graze';
    const standing = business !== 'travel' && (h.speed || 0) < 0.5;
    want.height = null;
    want.bend = 0.12 + 0.2 * fast;
    want.face = 0.1 - 0.3 * fast;
    want.yaw = clamp((h.yawRate || 0) * 0.35, -0.5, 0.5);
    want.headYaw = 0;
    want.roll = 0;
    want.jaw = 0;
    want.side = 0;
    want.tugPitch = 0;
    want.tugYaw = 0;
    want.ears = m.g > 3.3 ? 'pinned' : 'travel';
    let rest = 0;
    if (standing) {
        if (business === 'graze' || business === 'step') {
            graze(m, h, time, want);
        } else if (business === 'look') {
            want.bend = -0.3;
            want.face = -0.02;
            want.yaw = h.lookYaw || 0;
            want.headYaw = 0.3 * (h.lookYaw || 0);
            want.ears = 'forward';
        } else if (business === 'rest') {
            want.bend = 0.42;
            want.face = 0.32;
            want.jaw = 0.04;
            want.ears = 'doze';
            rest = 1;
        } else if (business === 'swat') {
            // A turn of the head back toward the flank.
            const side = (h.seed || 0) < 0.5 ? 1 : -1;
            want.bend = 0.3;
            want.face = 0.15;
            want.yaw = side * 0.85;
            want.headYaw = side * 0.35;
            want.roll = side * 0.15;
            want.ears = 'back';
        } else {
            want.bend = 0.2;
            want.face = 0.12;
        }
    }
    // Startled: heads up, ears forward.
    const alert = h.alert || 0;
    if (alert > 0.05) {
        want.height = null;
        want.bend += (Math.min(want.bend, -0.45) - want.bend) * alert;
        want.face += (-0.08 - want.face) * alert;
        if (alert > 0.3) want.ears = 'forward';
    }
    m.rest += (rest * (1 - moving) - m.rest) * (1 - Math.exp(-1.5 * dt));
    const groundY = ground(h.x, h.z);
    const bend = want.height === null ? want.bend : bendFor(m, want.height, groundY, want.face);
    const { head } = m;
    const k = 1 + 0.6 * moving;
    spring(head.bend, bend, HEAD.bend * k, dt);
    spring(head.yaw, want.yaw, HEAD.yaw, dt);
    spring(head.pitch, want.face, HEAD.pitch * k, dt);
    spring(head.headYaw, want.headYaw, HEAD.headYaw, dt);
    spring(head.roll, want.roll, HEAD.roll, dt);
    spring(head.jaw, want.jaw, HEAD.jaw, dt);
    spring(head.side, want.side, HEAD.side, dt);
    spring(head.tugPitch, want.tugPitch, HEAD.tug, dt);
    spring(head.tugYaw, want.tugYaw, HEAD.tug, dt);
    const { nod } = b;
    const B = head.bend.x;
    local[I.neck0 * 3] = NECK_SHARE[0] * B + 0.5 * nod;
    local[I.neck1 * 3] = NECK_SHARE[1] * B + 0.4 * nod;
    local[I.neck2 * 3] = NECK_SHARE[2] * B;
    local[I.neck0 * 3 + 1] = 0.3 * head.yaw.x;
    local[I.neck1 * 3 + 1] = 0.35 * head.yaw.x;
    local[I.neck2 * 3 + 1] = 0.35 * head.yaw.x + head.tugYaw.x * 0.5;
    // The head holds its face's angle in the world over the bent neck and the pitching body, and
    // dips a little with the nod.
    const chestPitch = parentPitch(m, m.rig.parents[I.neck0]);
    local[I.head * 3] = head.pitch.x - chestPitch - B - 0.45 * nod + head.tugPitch.x;
    local[I.head * 3 + 1] = head.headYaw.x + head.tugYaw.x * 0.5;
    local[I.head * 3 + 2] = head.roll.x;
    local[I.jaw * 3] = Math.max(0, head.jaw.x);
    local[I.jaw * 3 + 1] = head.side.x;
    stepEars(m, want.ears, dt, time);
}

/** Where the ears point for a mood: [pitch (forward +), swivel out, lop out] (left ear's signs). */
const EAR_MOODS = Object.freeze({
    forward: [[0.28, -0.05, 0]],
    travel: [[0.12, 0.1, 0.05], [0.05, 0.45, 0.1], [0.2, 0, 0]],
    graze: [[0.05, 0.35, 0.15], [-0.1, 0.9, 0.2], [0.15, 0.1, 0.05], [-0.25, 1.3, 0.1]],
    doze: [[-0.15, 0.55, 0.7], [-0.1, 0.4, 0.8]],
    back: [[-0.3, 1.2, 0.2], [-0.2, 0.9, 0.15]],
    pinned: [[-0.65, 0.35, 0.1]],
});

function stepEars(m, mood, dt, time) {
    const { local } = m.pose;
    const I = m.bones;
    const choices = EAR_MOODS[mood] || EAR_MOODS.travel;
    m.ears.forEach((ear, i) => {
        if (time >= ear.until || ear.mood !== mood) {
            // Each ear turns on its own, now and then.
            const pick = choices[Math.floor(m.rng() * choices.length)];
            ear.aim = pick;
            ear.mood = mood;
            ear.until = time + 0.8 + m.rng() * (mood === 'graze' ? 3 : 5);
        }
        const side = i === 0 ? 1 : -1;
        const fast = mood === 'pinned' || mood === 'forward' ? 14 : 9;
        spring(ear.x, ear.aim[0], fast, dt);
        spring(ear.y, ear.aim[1] * side, fast, dt);
        spring(ear.z, ear.aim[2] * side, fast * 0.7, dt);
        const bone = i === 0 ? I.earL : I.earR;
        local[bone * 3] = ear.x.x;
        local[bone * 3 + 1] = ear.y.x;
        local[bone * 3 + 2] = ear.z.x;
    });
}

// ── the tail ──────────────────────────────────────────────────────────────────────────
/** Each tail bone: stiffness (rad/s), damping ratio, how much of the carriage it takes. */
const TAIL = Object.freeze([
    [9, 0.8, 0.55], [8, 0.6, 0.22], [6, 0.32, 0.1], [5.2, 0.3, 0.06], [4.6, 0.28, 0.04], [4.2, 0.26, 0.03],
]);

function stepTail(m, h, gait, dt, time, env) {
    const { local } = m.pose;
    const moving = smooth(0.25, 1.0, m.g);
    const { swish } = m;
    // Swishing at the flies, in bursts, when standing.
    const burst = smooth(0.2, 0.7, Math.sin(time * 0.23 + m.seed * 17)) + (h.business === 'swat' ? 1.5 : 0);
    swish.phase += dt * (3.2 + 2.5 * burst);
    const swat = (1 - moving) * Math.sin(swish.phase) * 0.55 * Math.min(1, burst);
    const carry = gait.carry * smooth(0.5, 1.5, m.g) + 0.35 * (h.alert || 0) - 0.06 * m.rest;
    // The body's acceleration in its own frame (forward, up, left) drives the hair.
    const fx = Math.sin(m.place.heading);
    const fz = Math.cos(m.place.heading);
    const [ax, ay, az] = m.accel;
    const aF = ax * fx + az * fz;
    const aL = ax * fz - az * fx;
    const windL = (env.windX || 0) * fz - (env.windZ || 0) * fx;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h2 = dt / steps;
    for (let n = 0; n < steps; n++) {
        let parentAx = 0;
        let parentAy = 0;
        m.tail.forEach((bone, i) => {
            const [omega, zeta, share] = TAIL[i];
            const tx = carry * share + (i === 0 ? 0.05 : 0);
            // (y here is the sideways swing, a roll of each bone.)
            const ty = i < 2 ? swat * (i === 0 ? 0.55 : 0.4) : 0;
            const reach = 0.4 + i / 5;
            const driveX = (aF * 0.03 - ay * 0.045) * reach - 0.6 * parentAx;
            const driveY = (-aL * 0.035 + windL * 0.04) * reach - 0.6 * parentAy;
            const accX = omega * omega * (tx - bone.x) - 2 * zeta * omega * bone.vx + (i ? driveX : 0);
            const accY = omega * omega * (ty - bone.y) - 2 * zeta * omega * bone.vy + (i ? driveY : 0);
            bone.vx += accX * h2;
            bone.vy += accY * h2;
            bone.x += bone.vx * h2;
            bone.y += bone.vy * h2;
            bone.ax = accX;
            bone.ay = accY;
            parentAx = accX;
            parentAy = accY;
        });
    }
    m.tail.forEach((bone, i) => {
        const b = m.tailBones[i];
        local[b * 3] = clamp(bone.x, -0.6, 1.4);
        local[b * 3 + 2] = clamp(bone.y, -1.0, 1.0);
    });
}

// ── a step ────────────────────────────────────────────────────────────────────────────
/**
 * Move a horse on by `dt`: `h` its life's state (x, z, heading, speed, yawRate, accel, scale, seed,
 * business, lookYaw, alert, verge, foal; `treadmill` when it is kept on the spot at its speed),
 * `ground(x, z)` the field's height, `env` the wind
 * ({ windX, windZ }, m/s). Writes `m.pose` (posed: local angles, world joints) and `m.place`.
 */
export function stepHorseMotion(m, h, ground, dt, time, env = {}) {
    const d = Math.max(0, Math.min(0.25, dt || 0));
    const s = h.scale || 1;
    // A small horse's legs swing faster for the same pace (and it breaks into a trot sooner).
    const froude = Math.sqrt(s);
    const target = gaitFor((h.speed || 0) / froude);
    const rate = target > m.g ? 3.2 : 2.2;
    m.g += (target - m.g) * (1 - Math.exp(-rate * d));
    const gait = gaitAt(m.g, m.lead, m.gait);
    gait.freq /= froude;
    m.phase = wrap(m.phase + gait.freq * d);
    m.still = (h.speed || 0) < 0.05 ? m.still + d : 0;
    // The body's velocity and acceleration (for the tail and the mane).
    const vx = Math.sin(h.heading) * (h.speed || 0);
    const vz = Math.cos(h.heading) * (h.speed || 0);
    const prevY = m.place.y;
    const b = placeBody(m, h, ground, gait);
    const vy = m.started && d > 0 ? (m.place.y - prevY) / d : 0;
    if (d > 0) {
        const k = 1 - Math.exp(-d * 12);
        m.accel[0] += ((vx - m.velocity[0]) / d - m.accel[0]) * k;
        m.accel[1] += ((vy - m.velocity[1]) / d - m.accel[1]) * k;
        m.accel[2] += ((vz - m.velocity[2]) / d - m.accel[2]) * k;
    }
    m.velocity[0] = vx;
    m.velocity[1] = vy;
    m.velocity[2] = vz;
    // Pose the body (and the legs as they were) to find the legs' roots, then the legs.
    poseRig(m.rig, m.pose, m.place);
    if (!m.started) settle(m, ground);
    stepLegs(m, h, ground, gait, d, time);
    m.legs.forEach((leg) => writeLeg(leg.spec, leg.now, m.pose.local));
    // A resting hind: cocked, on the toe of its hoof.
    if (m.rest > 0.01) {
        const leg = m.legs[(h.seed || 0) < 0.5 ? 2 : 3];
        const { local } = m.pose;
        const [b0, b1, b2, b3, b4] = leg.spec.bones;
        local[b0 * 3] += -0.06 * m.rest;
        local[b1 * 3] += 0.12 * m.rest;
        local[b2 * 3] += -0.3 * m.rest;
        local[b3 * 3] += 0.85 * m.rest;
        local[b4 * 3] += 0.3 * m.rest;
    }
    stepHead(m, h, ground, gait, b, d, time);
    stepTail(m, h, gait, d, time, env);
    poseRig(m.rig, m.pose, m.place);
    m.legs.forEach((leg) => {
        const hoof = leg.spec.bones[leg.spec.bones.length - 1];
        leg.coffin[0] = m.pose.at[hoof * 3];
        leg.coffin[1] = m.pose.at[hoof * 3 + 1];
        leg.coffin[2] = m.pose.at[hoof * 3 + 2];
        if (leg.touch) {
            leg.touch = false;
            touchDown(m, leg, ground, time);
        }
    });
    // The hair's flow: the wind through it, the air the horse runs through, its bounce.
    m.flow[0] = (env.windX || 0) * 0.35 - vx * 0.08;
    m.flow[1] = -m.accel[1] * 0.004;
    m.flow[2] = (env.windZ || 0) * 0.35 - vz * 0.08;
    m.started = true;
    return m;
}

/** First step: every hoof planted under the body where it stands. */
function settle(m, ground) {
    m.legs.forEach((leg) => {
        neutralFoot(m, leg, ground, 0, foot);
        leg.plant[0] = foot[0];
        leg.plant[1] = foot[1];
        leg.plant[2] = foot[2];
        leg.coffin[0] = foot[0];
        leg.coffin[1] = foot[1];
        leg.coffin[2] = foot[2];
        leg.planted = true;
        leg.w = 1;
    });
}
