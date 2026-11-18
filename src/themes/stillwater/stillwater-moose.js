/**
 * Stillwater — the old moose of the wood.
 *
 * Now and then (stillwater-night.js) a bull moose comes down out of the mist on the far water to
 * the left of the board: he walks in through the shallows, bearing round as he slows so that he
 * comes to a stand broadside, looks about, lowers his head and drinks (rings run out from his
 * muzzle), lifts it with the water running off, looks across at the spirit's light a long moment,
 * then walks off round a slow turn and back into the mist the way he came.
 *
 * He is the theme's own figure (scripts/blender/stillwater/moose.py: a distance field of smooth
 * masses meshed in Blender, a 16-bone skeleton, every vertex told what it is), in the theme's
 * compact figure file (stillwater-rig.js). Every pose is made here, as a function of how long he
 * has been there.
 *
 * His body keeps to a way laid down in metres (a curve in that ends broadside, a turn and a line
 * out), at a pace that slackens and gathers smoothly; he faces along it and bends into its turns.
 * His hooves are planted: each comes down where his body will stand over it halfway through its
 * stance, stays there while he walks over it, and is lifted and carried to the next such place,
 * so a hoof neither slides nor skates, in a turn or a stop as on the straight. Each leg is bent to
 * reach its hoof (the upper two bones solved, the cannon tilted with the leg and folded as it comes
 * through). The steps fall in a moose's order (left hind, left fore, right hind, right fore),
 * shorter and slower as he slows; his body dips and rolls a little with them and his head nods.
 *
 * He is lit as the place is (swLight: the moon through the canopy, the sky, the lights that live
 * here) with a pale rim where the moon's halo is behind him, and the mist takes him with his range.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import mooseUrl from './assets/moose.glb?url';
import {
    clamp01, lerp, smooth, swFog, swLight, swPart,
} from './stillwater-tsl.js';
import { buildFigure } from './stillwater-rig.js';
import { groundHeight } from './stillwater-plan.js';

/**
 * His visit (stage metres, seconds from when he comes): out of the mist at `from`, along the far
 * shallows to `at`, where he stands; then home to `away`. How deep he wades at most (the tarn is
 * deep out there: he keeps to where his knees are wet), how he walks, and the beats of his time
 * there.
 */
export const MOOSE = Object.freeze({
    from: Object.freeze([-14.5, -44]),
    at: Object.freeze([-8.4, -25.5]),
    away: Object.freeze([-15.5, -43]),
    /** The way he stands to drink: broadside to the eye, his head toward the board. */
    broadside: 70 * (Math.PI / 180),
    wade: 0.42,
    pace: 1.15,
    /** Metres of ground one whole cycle of his legs covers at his pace. */
    stride: 1.45,
    /** Metres over which he slows to a stand, and over which he gathers his pace again. */
    stop: 2.4,
    start: 2,
    /** Metres: how far ahead of the stand his way in begins to bear round to broadside. */
    bear: 4,
    /** Metres: the radius of his turn for home. */
    turnRadius: 1.8,
    /**
     * Seconds: his feet settle under him, he stands and looks about, lowers his head, drinks,
     * lifts it, looks across at her (then he turns for home).
     */
    settle: 1.6,
    stand: 3.4,
    lower: 2.6,
    drink: 8.5,
    lift: 2.4,
    regard: 5,
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// ── His ways, by the metre ──────────────────────────────────────────────────────

/**
 * A cubic Bézier way from p0 to p3, walked by the metre (a table of its length), and straight on
 * past either end. `at(s, o)` sets o.x, o.z, o.heading (rad, 0 = toward +z) and o.bend (how fast
 * the heading turns per metre: + is to his left).
 */
function curveWay(p0, p1, p2, p3) {
    const P = [p0, p1, p2, p3];
    const N = 256;
    const table = new Float64Array(N + 1);
    const e = {};
    const at = (u) => {
        const v = 1 - u;
        const b0 = v * v * v;
        const b1 = 3 * v * v * u;
        const b2 = 3 * v * u * u;
        const b3 = u * u * u;
        e.x = b0 * P[0][0] + b1 * P[1][0] + b2 * P[2][0] + b3 * P[3][0];
        e.z = b0 * P[0][1] + b1 * P[1][1] + b2 * P[2][1] + b3 * P[3][1];
        const d0 = 3 * v * v;
        const d1 = 6 * v * u;
        const d2 = 3 * u * u;
        e.dx = d0 * (P[1][0] - P[0][0]) + d1 * (P[2][0] - P[1][0]) + d2 * (P[3][0] - P[2][0]);
        e.dz = d0 * (P[1][1] - P[0][1]) + d1 * (P[2][1] - P[1][1]) + d2 * (P[3][1] - P[2][1]);
        e.ddx = 6 * v * (P[2][0] - 2 * P[1][0] + P[0][0]) + 6 * u * (P[3][0] - 2 * P[2][0] + P[1][0]);
        e.ddz = 6 * v * (P[2][1] - 2 * P[1][1] + P[0][1]) + 6 * u * (P[3][1] - 2 * P[2][1] + P[1][1]);
        return e;
    };
    let px = p0[0];
    let pz = p0[1];
    for (let i = 1; i <= N; i++) {
        at(i / N);
        table[i] = table[i - 1] + Math.hypot(e.x - px, e.z - pz);
        px = e.x;
        pz = e.z;
    }
    const length = table[N];
    return {
        length,
        at(s, o) {
            if (s <= 0 || s >= length) {
                // Off either end: straight on along it.
                at(s <= 0 ? 0 : 1);
                const over = s <= 0 ? s : s - length;
                const l = Math.hypot(e.dx, e.dz);
                o.x = e.x + (e.dx / l) * over;
                o.z = e.z + (e.dz / l) * over;
                o.heading = Math.atan2(e.dx, e.dz);
                o.bend = 0;
                return o;
            }
            let lo = 0;
            let hi = N;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (table[mid] <= s) lo = mid;
                else hi = mid;
            }
            at((lo + (s - table[lo]) / (table[hi] - table[lo])) / N);
            const l = Math.hypot(e.dx, e.dz);
            o.x = e.x;
            o.z = e.z;
            o.heading = Math.atan2(e.dx, e.dz);
            o.bend = (e.dz * e.ddx - e.dx * e.ddz) / (l * l * l);
            return o;
        },
    };
}

/**
 * A turn of `radius` to his left from `start` (facing `heading`) until `end` lies dead ahead,
 * then straight to it and on: his way home. Its bend eases off into the straight.
 */
function turnWay(start, heading, radius, end) {
    const cx = start[0] + radius * Math.cos(heading);
    const cz = start[1] - radius * Math.sin(heading);
    const onX = (h) => cx - radius * Math.cos(h);
    const onZ = (h) => cz + radius * Math.sin(h);
    // How far to his left the end lies, facing `h` on the turn: it reaches zero dead ahead.
    const aside = (h) => (end[0] - onX(h)) * Math.cos(h) - (end[1] - onZ(h)) * Math.sin(h);
    let lo = heading;
    let hi = heading + Math.PI;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (aside(mid) > 0) lo = mid;
        else hi = mid;
    }
    const last = (lo + hi) / 2;
    const arc = radius * (last - heading);
    const sx = onX(last);
    const sz = onZ(last);
    return {
        length: arc + Math.hypot(end[0] - sx, end[1] - sz),
        at(s, o) {
            if (s < arc) {
                const h = heading + Math.max(0, s) / radius;
                o.x = onX(h);
                o.z = onZ(h);
                o.heading = h;
            } else {
                o.x = sx + Math.sin(last) * (s - arc);
                o.z = sz + Math.cos(last) * (s - arc);
                o.heading = last;
            }
            o.bend = (1 - smooth(arc - 1, arc + 0.5, s)) / radius;
            return o;
        },
    };
}

const dirOf = (h, k = 1) => [Math.sin(h) * k, Math.cos(h) * k];

/** In: from the mist toward the stand, bearing round over the last metres to come in broadside. */
const IN = (() => {
    const [bx, bz] = dirOf(MOOSE.broadside, MOOSE.bear);
    const p2 = [MOOSE.at[0] - bx, MOOSE.at[1] - bz];
    const p1 = [lerp(MOOSE.from[0], p2[0], 0.4), lerp(MOOSE.from[1], p2[1], 0.4)];
    return curveWay(MOOSE.from, p1, p2, MOOSE.at);
})();
/** Out: round to his left from broadside until the way home lies ahead, then into the mist. */
const OUT = turnWay(MOOSE.at, MOOSE.broadside, MOOSE.turnRadius, MOOSE.away);

/** Metres walked and his speed `t` s into a walk of `length` that slows to a stand over its last `ease` metres. */
function stopping(t, length, ease, o) {
    const v = MOOSE.pace;
    const slow = (2 * ease) / v;
    const cruise = (length - ease) / v;
    if (t <= cruise) {
        o.s = v * t;
        o.v = v;
        return o;
    }
    // His speed falls away on a smoothstep: no jolt as he slows, none as he stands.
    const x = Math.min(1, (t - cruise) / slow);
    o.s = length - ease + v * slow * (x - x * x * x + 0.5 * x * x * x * x);
    o.v = v * (1 - x * x * (3 - 2 * x));
    return o;
}

/** Metres walked and his speed `t` s after he sets off from a stand, gathering pace over `ease` metres. */
function starting(t, ease, o) {
    const v = MOOSE.pace;
    const gather = (2 * ease) / v;
    if (t <= 0) {
        o.s = 0;
        o.v = 0;
        return o;
    }
    if (t < gather) {
        const x = t / gather;
        o.s = v * gather * (x * x * x - 0.5 * x * x * x * x);
        o.v = v * x * x * (3 - 2 * x);
        return o;
    }
    o.s = ease + v * (t - gather);
    o.v = v;
    return o;
}

/** Seconds of his walk in and out. */
const IN_TIME = (IN.length + MOOSE.stop) / MOOSE.pace;
const OUT_TIME = (OUT.length + MOOSE.start) / MOOSE.pace;

/** When each beat begins (seconds from his coming). */
export const MOOSE_BEATS = Object.freeze((() => {
    const arrive = IN_TIME;
    const squared = arrive + MOOSE.settle;
    const lower = squared + MOOSE.stand;
    const drink = lower + MOOSE.lower;
    const lift = drink + MOOSE.drink;
    const regard = lift + MOOSE.lift;
    // He turns for home, has his pace again round the turn, and is gone into the mist.
    const turn = regard + MOOSE.regard;
    const leave = turn + (2 * MOOSE.start) / MOOSE.pace;
    const gone = turn + OUT_TIME;
    return {
        arrive, squared, lower, drink, lift, regard, turn, leave, gone,
    };
})());
/** Seconds he is there, from his first step out of the mist to his last into it. */
export const MOOSE_SPAN = MOOSE_BEATS.gone;

// ── His legs ────────────────────────────────────────────────────────────────────

/**
 * His legs (each a chain of three bones) and when in the cycle each hoof comes down: a lateral
 * walk, the hind before the fore on the same side. `fold` is how far the cannon folds back as the
 * leg comes through (the fore knee folds deep; the hock less).
 */
const LEGS = Object.freeze([
    {
        bones: ['thighL', 'shinL', 'hindL'], down: 0.0, fold: 0.4, hind: true,
    },
    {
        bones: ['armL', 'foreL', 'canL'], down: 0.25, fold: 1.15, hind: false,
    },
    {
        bones: ['thighR', 'shinR', 'hindR'], down: 0.5, fold: 0.4, hind: true,
    },
    {
        bones: ['armR', 'foreR', 'canR'], down: 0.75, fold: 1.15, hind: false,
    },
]);
/** Share of a leg's cycle its hoof is on the ground. */
const STANCE = 0.62;
/** Share of his steps' rhythm he keeps standing still (so his last steps finish, and his first are slow). */
const CADENCE_FLOOR = 0.4;
/** Metres the knee (and the hock) rises as a leg comes through, on a full step. */
const KNEE_LIFT = 0.13;
/** How much of the leg's own tilt the cannon takes. */
const LEAN = 0.65;

/** Metres he has walked in all by `age` (on at his pace before he came, and after he has gone). */
function walkedBy(age, o) {
    const B = MOOSE_BEATS;
    if (age < B.arrive) return stopping(age, IN.length, MOOSE.stop, o);
    if (age < B.turn) {
        o.s = IN.length;
        o.v = 0;
        return o;
    }
    starting(age - B.turn, MOOSE.start, o);
    o.s += IN.length;
    return o;
}

const walk = {};
/** How far through his legs' cycle he is at `age`: steps keep a slow rhythm even as he stands. */
function cycleAt(age) {
    walkedBy(age, walk);
    return (CADENCE_FLOOR * MOOSE.pace * age + (1 - CADENCE_FLOOR) * walk.s) / MOOSE.stride;
}

/** The age at which his legs' cycle reaches `c` (it only ever goes forward). */
function ageAtCycle(c) {
    const v = MOOSE.pace;
    let lo = (c * MOOSE.stride) / v;
    if (lo <= 0) return lo;
    let hi = lo / CADENCE_FLOOR;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (cycleAt(mid) < c) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** Where his body is at `age` (stage metres, not squeezed), which way it faces, how it bends, how fast it goes. */
function bodyAt(age, o) {
    const B = MOOSE_BEATS;
    walkedBy(age, walk);
    if (age < B.arrive) IN.at(walk.s, o);
    else if (age < B.turn) {
        o.x = MOOSE.at[0];
        o.z = MOOSE.at[1];
        o.heading = MOOSE.broadside;
        o.bend = 0;
    } else OUT.at(walk.s - IN.length, o);
    o.speed = walk.v;
    return o;
}

/** He looks about as he stands: one way, a hold, the other, a hold, and back (look, rad; + is to his left). */
const GLANCES = Object.freeze([[0, 0], [0.9, 0.34], [1.5, 0.34], [2.4, -0.26], [2.9, -0.26], [3.4, 0]]);
function glance(t) {
    for (let i = 1; i < GLANCES.length; i++) {
        const [t0, v0] = GLANCES[i - 1];
        const [t1, v1] = GLANCES[i];
        if (t < t1) return lerp(v0, v1, smooth(t0, t1, t));
    }
    return 0;
}

/**
 * Where he is and what he is doing `age` seconds after he came: { x, z (stage), heading (rad, 0 =
 * toward +z), walking 0..1 (his speed over his pace), cycle (how far through his legs' cycle),
 * bend (rad of turn per metre of his way, + to his left), neck, head (pitch, rad: + is down),
 * look (yaw of his head, rad, + to his left) }. A pure function of the age.
 */
export function mooseAt(age, out = {}) {
    const B = MOOSE_BEATS;
    const o = out;
    const t = Math.max(0, age);
    bodyAt(t, o);
    o.walking = o.speed / MOOSE.pace;
    o.cycle = cycleAt(t);
    // Head down to the water, a while there, up again with the water running off (the neck
    // leads, the head follows it a moment later).
    const neckDown = smooth(B.lower, B.drink - 0.4, t) * (1 - smooth(B.lift, B.regard - 0.5, t));
    const headDown = smooth(B.lower + 0.5, B.drink, t) * (1 - smooth(B.lift + 0.3, B.regard, t));
    o.neck = lerp(-0.05, 0.98, neckDown);
    o.head = lerp(0.08, 0.62, headDown) + Math.sin(t * 2.4) * 0.03 * headDown;
    // He looks about as he stands; then across at her light, a long moment (she is ahead of him
    // and to his right as he stands broadside); and into his turns as he walks.
    const regard = smooth(B.regard - 0.6, B.regard + 1.2, t) * (1 - smooth(B.turn, B.turn + 1.5, t));
    o.look = glance(t - B.squared) - regard + o.bend * 0.6 * o.walking;
    o.neck += -0.12 * regard;
    return o;
}

/** How much of him shows (he comes out of the mist and goes back into it): 0..1. */
export function mooseShown(age) {
    return smooth(0, 2.5, age) * (1 - smooth(MOOSE_SPAN - 2.5, MOOSE_SPAN, age));
}

/** The height he stands at over (x, z): on the bed, or as deep as he wades. */
const standHeight = (x, z) => Math.max(groundHeight(x, z), -MOOSE.wade);

const stood = {};
/**
 * Where the hoof at `rest` (model metres) is planted for a leg's `n`th stance: under where his
 * body is halfway through it (world, the stage drawn in by `squeeze`).
 */
function plantAt(leg, n, rest, squeeze, out) {
    bodyAt(ageAtCycle(n + leg.down + STANCE / 2), stood);
    const c = Math.cos(stood.heading);
    const s = Math.sin(stood.heading);
    out.x = stood.x * squeeze + rest.x * c + rest.z * s;
    out.y = standHeight(stood.x, stood.z) + rest.y;
    out.z = stood.z - rest.x * s + rest.z * c;
    return out;
}

const fromPlant = {};
const toPlant = {};
/**
 * Where a leg's hoof is at the point `cycle` of his legs' cycle (world): { x, y, z, step (which
 * stance it is on or coming to), swing (0 on the ground, else 0..1 through the swing), fold (rad
 * the cannon folds back), reach (metres of the step it is taking) }.
 */
function hoofAt(leg, rest, cycle, squeeze, out) {
    const q = cycle - leg.down;
    const n = Math.floor(q);
    const ph = q - n;
    plantAt(leg, n, rest, squeeze, fromPlant);
    out.step = n;
    if (ph < STANCE) {
        out.x = fromPlant.x;
        out.y = fromPlant.y;
        out.z = fromPlant.z;
        out.swing = 0;
        out.fold = 0;
        out.reach = 0;
        return out;
    }
    plantAt(leg, n + 1, rest, squeeze, toPlant);
    const k = (ph - STANCE) / (1 - STANCE);
    const reach = Math.hypot(toPlant.x - fromPlant.x, toPlant.z - fromPlant.z);
    // A small step (as he settles, or sets off) is lifted and folded less.
    const full = clamp01(reach / (0.45 * MOOSE.stride));
    // The hoof leaves the ground and comes down on it at rest (every curve here starts and ends
    // still): carried forward on a smoothstep, lifted on a smooth bump. The cannon folds early in
    // the swing and reaches out again before the hoof goes down; the hoof rises with the knee and
    // with the fold.
    const e = k * k * (3 - 2 * k);
    const bump = 16 * k * k * (1 - k) * (1 - k);
    const fold = leg.fold * full * Math.sin(Math.PI * k ** 0.8) ** 2;
    out.x = lerp(fromPlant.x, toPlant.x, e);
    out.z = lerp(fromPlant.z, toPlant.z, e);
    out.y = lerp(fromPlant.y, toPlant.y, e) + KNEE_LIFT * full * bump + leg.cannon * (1 - Math.cos(fold));
    out.swing = k;
    out.fold = fold;
    out.reach = reach;
    out.step = n + 1;
    return out;
}

/**
 * One leg's measures from the rest skeleton: its three bones' rest vectors (each from its head to
 * the next) in the leg's own plane (y, z), their lengths and angles there, which way its middle
 * joint bends, and where its hoof stands in the model.
 */
function legRig(built, leg) {
    const [top, mid, low] = leg.bones;
    const r = built.rest;
    const tail = built.tails[low];
    const s1 = r[mid].clone().sub(r[top]);
    const s2 = r[low].clone().sub(r[mid]);
    const s3 = tail.clone().sub(r[low]);
    const ang = (v) => Math.atan2(v.z, v.y);
    const k1 = s1.clone().add(s2);
    const whole = k1.clone().add(s3);
    const L1 = Math.hypot(s1.y, s1.z);
    const L2 = Math.hypot(s2.y, s2.z);
    return {
        ...leg,
        s1,
        s2,
        s3,
        L1,
        L2,
        L3: Math.hypot(s3.y, s3.z),
        a1: ang(s1),
        a2: ang(s2),
        a3: ang(s3),
        // How far the upper two bones reach, straight (and where their reach begins to give).
        M: L1 + L2 - 1e-4,
        // Which side of the line from hip to hock the stifle lies.
        side: Math.sign(k1.y * s1.z - k1.z * s1.y) || 1,
        // (The leg's own sideways set, which a pitch never changes.)
        x: whole.x,
        limb: ang(whole),
        hoof: tail.clone(),
        tip: s3,
        cannon: Math.hypot(s3.y, s3.z),
    };
}

/**
 * Roll a leg out or in (about its forward axis, at its top joint) so the hoof at `d` (from the top
 * joint, in its parent bone's frame) lies in the plane its pitches swing it in. Sets out.roll and
 * out.ey, out.ez: the hoof in that plane.
 */
function rollTo(rig, dx, dy, dz, out) {
    const set = Math.acos(Math.max(-1, Math.min(1, rig.x / Math.hypot(dx, dy))));
    const roll = Math.max(-0.45, Math.min(0.45, wrap(Math.atan2(dy, dx) + set)));
    out.roll = roll;
    out.ey = -dx * Math.sin(roll) + dy * Math.cos(roll);
    out.ez = dz;
    return out;
}

/** Share of the upper two bones' reach past which a hind leg gives (rather than snap straight). */
const SOFT = 0.95;

/**
 * Bend a hind leg to reach its hoof `d`, the cannon folded back by `fold`: the cannon leans with
 * the leg, and the thigh and the shin are solved to its head (the stifle forward, as it rests),
 * their reach easing off short of straight. Sets out.roll and out.t1, t2, t3 (the pitch of each
 * bone, rad, + swings it back).
 */
function bendHind(rig, dx, dy, dz, fold, out) {
    rollTo(rig, dx, dy, dz, out);
    const { ey, ez } = out;
    const c3 = rig.a3 + LEAN * wrap(Math.atan2(ez, ey) - rig.limb) + fold;
    const py = ey - rig.L3 * Math.cos(c3);
    const pz = ez - rig.L3 * Math.sin(c3);
    const D0 = Math.hypot(py, pz);
    const give = rig.M * SOFT;
    let D = D0 <= give ? D0 : give + (rig.M - give) * (1 - Math.exp(-(D0 - give) / (rig.M - give)));
    D = Math.max(Math.abs(rig.L1 - rig.L2) + 1e-4, D);
    const cosG = (rig.L1 * rig.L1 + D * D - rig.L2 * rig.L2) / (2 * rig.L1 * D);
    const a1 = Math.atan2(pz, py) + rig.side * Math.acos(Math.max(-1, Math.min(1, cosG)));
    const ky = (py * D) / D0 - rig.L1 * Math.cos(a1);
    const kz = (pz * D) / D0 - rig.L1 * Math.sin(a1);
    const t12 = wrap(Math.atan2(kz, ky) - rig.a2);
    out.t1 = wrap(a1 - rig.a1);
    out.t2 = wrap(t12 - out.t1);
    out.t3 = wrap(c3 - rig.a3 - t12);
    return out;
}

/** How far a fore leg's forearm swings forward as its knee folds (share of the fold). */
const ELBOW = 0.4;

/**
 * Bend a fore leg to its hoof `d`, the cannon folded back by `fold`. A moose's fore leg is a
 * straight column on the ground and folds at the knee as it comes through: the forearm swings
 * forward with the fold and the cannon folds back under it, and the whole leg is swung from the
 * shoulder to point at its hoof (so it sweeps with the ground; what it lacks or has over in
 * length is taken under the water). Sets out.roll and out.t1, t2, t3.
 */
function bendFore(rig, dx, dy, dz, fold, out) {
    rollTo(rig, dx, dy, dz, out);
    const t2 = -ELBOW * fold;
    const t3 = fold;
    // The leg's end, its top joint unturned: the cannon in the forearm's frame, then the forearm in the arm's.
    const cy = rig.s3.y * Math.cos(t3) - rig.s3.z * Math.sin(t3);
    const cz = rig.s3.y * Math.sin(t3) + rig.s3.z * Math.cos(t3);
    const fy = rig.s2.y + cy;
    const fz = rig.s2.z + cz;
    const vy = rig.s1.y + fy * Math.cos(t2) - fz * Math.sin(t2);
    const vz = rig.s1.z + fy * Math.sin(t2) + fz * Math.cos(t2);
    out.t1 = wrap(Math.atan2(out.ez, out.ey) - Math.atan2(vz, vy));
    out.t2 = t2;
    out.t3 = t3;
    return out;
}

/** How deep his body dips with each step, how far it rolls, how his head nods (at his pace). */
const BOB = 0.016;
const CROUCH = 0.05;
const ROLL = 0.022;
const NOD = 0.035;
/** How far his forequarters turn into a bend (rad per rad-per-metre). */
const BEND = 0.38;

/**
 * @param {object} u  shared uniforms
 */
export function createMoose(u) {
    const group = new THREE.Group();
    group.name = 'StillwaterMoose';
    group.visible = false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterMoose';
    material.fog = false;
    material.toneMapped = false;
    const col = attribute('color', 'vec4');
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(cameraPosition));
        const kind = col.x;
        const ao = col.y.mul(0.6).add(0.4);
        // What he is: dark brown-black hide, pale grey-brown stockings, a lighter muzzle, pale antlers.
        const hide = vec3(0.028, 0.019, 0.013);
        const leg = vec3(0.16, 0.135, 0.11);
        const muzzle = vec3(0.05, 0.036, 0.027);
        const horn = vec3(0.3, 0.26, 0.2);
        const eye = vec3(0.004, 0.004, 0.004);
        const isEye = smoothstep(0.1, 0.2, kind).mul(float(1.0).sub(smoothstep(0.2, 0.3, kind)));
        const coat = mix(mix(hide, leg, smoothstep(0.25, 0.4, kind)), muzzle, smoothstep(0.55, 0.7, kind));
        const albedo = mix(coat, horn, smoothstep(0.85, 1.0, kind)).toVar();
        albedo.assign(mix(albedo, eye, isEye));
        const lit = swLight(u, albedo, N, P, { wrap: 0.55, local: 0.8 }).mul(ao).toVar();
        // A pale rim where the moon's halo stands behind him (his outline against the mist).
        const facing = clamp(dot(N, V).negate(), 0.0, 1.0);
        const rim = float(1.0).sub(facing);
        const behind = clamp(dot(V, u.moonDir).mul(0.5).add(0.5), 0.0, 1.0);
        lit.addAssign(u.glow.mul(rim.mul(rim).mul(rim)).mul(behind.mul(0.7).add(0.2)).mul(0.4).mul(u.breath));
        // The water he stands in darkens his legs where they go in.
        const wet = smoothstep(0.35, -0.05, P.y);
        lit.mulAssign(float(1.0).sub(wet.mul(0.6)));
        // (A little less of the mist than his range takes: he is what the eye is drawn to.)
        return vec4(swFog(u, lit, P, 0.8), 1.0);
    })();

    const part = swPart('StillwaterMoose', null, material, 13, { mesh: group });
    part.ready = false;
    part.failed = false;
    let built = null;
    let rigs = null;
    let disposed = false;
    const pose = {};
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const hoof = {};
    const bent = {};
    const lastPlant = {};
    /** Which stance each leg was on or coming to, and whether it was down, as of the last pose. */
    const lastStep = [null, null, null, null];
    const lastDown = [false, false, false, false];
    /** Each leg's hoof target and how far through a swing it was, as of the last pose (for the tests). */
    const targets = LEGS.map(() => new THREE.Vector3());
    const swings = LEGS.map(() => 0);

    part.load = async (loader = new GLTFLoader()) => {
        try {
            const gltf = await loader.loadAsync(mooseUrl);
            if (disposed) return false;
            built = buildFigure(gltf, material);
            built.mesh.renderOrder = 13;
            built.mesh.layers.mask = group.layers.mask;
            group.add(built.mesh);
            rigs = LEGS.map((leg) => legRig(built, leg));
            part.ready = true;
            return true;
        } catch (error) {
            part.failed = true;
            console.warn('[Stillwater] The moose could not be loaded.', error);
            return false;
        }
    };

    /**
     * Pose him `age` seconds into his visit, standing on the stage drawn in by `squeeze`. Returns
     * events: { type: 'step', x, z } as a hoof goes down in the water, { type: 'sip', x, z } while
     * he drinks (the world rings the water for both).
     */
    part.update = (age, squeeze = 1) => {
        const events = [];
        if (!built) return events;
        const p = mooseAt(age, pose);
        const x = p.x * squeeze;
        const y = standHeight(p.x, p.z);
        group.position.set(x, y, p.z);
        group.rotation.set(0, p.heading, 0);
        const b = built.bones;
        Object.keys(b).forEach((name) => b[name].quaternion.identity());
        // His body dips twice and rolls once with each cycle of his steps, lower as he walks than
        // as he stands (the legs below are bent to their hooves); his forequarters turn into a bend.
        const { walking } = p;
        const step = p.cycle * Math.PI * 2;
        if (b.root) {
            b.root.position.y = built.rest.root.y - walking * (CROUCH + BOB * 0.5 * (1 - Math.cos(2 * step)));
            b.root.quaternion.setFromAxisAngle(Z, Math.sin(step - 0.6) * ROLL * walking);
        }
        if (b.spine) b.spine.quaternion.setFromAxisAngle(Y, Math.max(-0.3, Math.min(0.3, p.bend * BEND * walking)));
        // Neck and head: the pitch of each, the look turned in the neck; a nod with each fore step
        // that the head half takes back (his eyes keep steadier than his neck).
        const nod = Math.sin(2 * step - 1.2) * NOD * walking;
        if (b.neck) {
            q.setFromAxisAngle(X, p.neck + nod);
            q2.setFromAxisAngle(Y, p.look * 0.6);
            b.neck.quaternion.copy(q2).multiply(q);
        }
        if (b.head) {
            q.setFromAxisAngle(X, p.head - nod * 0.5);
            q2.setFromAxisAngle(Y, p.look * 0.4);
            b.head.quaternion.copy(q2).multiply(q);
        }
        group.updateMatrixWorld(true);
        // The legs: each hoof where it is planted (or on its way to the next place), each leg bent to it.
        rigs.forEach((rig, i) => {
            const top = b[rig.bones[0]];
            const mid = b[rig.bones[1]];
            const low = b[rig.bones[2]];
            if (!top || !mid || !low || !top.parent) return;
            hoofAt(rig, rig.hoof, p.cycle, squeeze, hoof);
            targets[i].set(hoof.x, hoof.y, hoof.z);
            swings[i] = hoof.swing;
            tmp.copy(targets[i]);
            top.parent.worldToLocal(tmp).sub(top.position);
            (rig.hind ? bendHind : bendFore)(rig, tmp.x, tmp.y, tmp.z, hoof.fold, bent);
            q.setFromAxisAngle(Z, bent.roll);
            q2.setFromAxisAngle(X, bent.t1);
            top.quaternion.copy(q).multiply(q2);
            mid.quaternion.setFromAxisAngle(X, bent.t2);
            low.quaternion.setFromAxisAngle(X, bent.t3);
            // A hoof going down in the water (a real step, not a shuffle) leaves a ring.
            const down = hoof.swing === 0;
            const came = lastStep[i] !== null && down && hoof.step - lastStep[i] >= 0 && hoof.step - lastStep[i] <= 1
                && (!lastDown[i] || hoof.step !== lastStep[i]);
            lastStep[i] = hoof.step;
            lastDown[i] = down;
            if (came && y < 0) {
                plantAt(rig, hoof.step - 1, rig.hoof, squeeze, lastPlant);
                if (Math.hypot(hoof.x - lastPlant.x, hoof.z - lastPlant.z) > 0.3) {
                    events.push({ type: 'step', x: hoof.x, z: hoof.z });
                }
            }
        });
        group.updateMatrixWorld(true);
        // His muzzle in the water while he drinks.
        if (age > MOOSE_BEATS.drink && age < MOOSE_BEATS.lift && b.head) {
            tmp.set(0, -0.32, 0.68).applyMatrix4(b.head.matrixWorld);
            events.push({ type: 'sip', x: tmp.x, z: tmp.z });
        }
        return events;
    };

    /** Where his muzzle is now (world), for the eyes that turn to him. */
    part.muzzleWorld = (out = new THREE.Vector3()) => {
        if (!built?.bones.head) return out.set(MOOSE.at[0], 1.5, MOOSE.at[1]);
        return out.set(0, -0.32, 0.68).applyMatrix4(built.bones.head.matrixWorld);
    };

    /**
     * (For the tests: each hoof where the last pose put it and where it was meant to be, world, and
     * how far through a swing it was: 0 on the ground.)
     * @returns {{ at: THREE.Vector3, target: THREE.Vector3, swing: number }[]}
     */
    part.hooves = () => (rigs || []).map((rig, i) => ({
        at: rig.tip.clone().applyMatrix4(built.bones[rig.bones[2]].matrixWorld),
        target: targets[i].clone(),
        swing: swings[i],
    }));

    part.dispose = () => {
        disposed = true;
        if (built) {
            built.mesh.geometry.dispose();
            built.mesh.skeleton?.dispose?.();
        }
        material.dispose();
    };
    part.shownAt = mooseShown;
    return part;
}

/** (For the tests: how many seconds each part of his visit takes, and how long each way is.) */
export const MOOSE_TIMES = Object.freeze({
    in: IN_TIME, out: OUT_TIME, inLength: IN.length, outLength: OUT.length,
});

export { clamp01 };
