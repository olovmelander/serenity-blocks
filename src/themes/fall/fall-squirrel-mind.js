/**
 * Fall — the red squirrel's mind: what it does next, where, and how it answers the game.
 *
 * The squirrel lives on the two great trees and the floor between them. Its day is a string of
 * acts — a dash, a hop, a leap onto the bark, a climb, a cling, a sit — and of little routines made
 * of them, which is where its character is: it forages in short hops with its nose in the litter,
 * digs and buries a nut and pats it down and looks round to see who saw; sits up and nibbles an
 * acorn and washes its face; scratches behind an ear like the clappers; dashes and stops dead;
 * plays hide-and-seek round a trunk, going round to the far side and peeking out at the edge; scolds
 * with its tail; goes up into the crown and is gone a while, and comes down head first.
 *
 * The game startles it. A hard drop makes it jump straight up with every leg flung out (less each
 * time: it gets used to the thumps), four lines send it up a trunk to scold from there, a combo has it
 * chattering, a perfect clear makes it twirl in the air for joy, and the end of a run sends it round
 * behind its tree to peek out. Clears turn its head to the board.
 *
 * Deterministic: the acts come from a seeded generator in the order they are needed, each starting
 * where and when the last ended (an answer to the game cuts the act it interrupts at that moment), so
 * the squirrel's pose is a function of the clock and the events alone: a seek that replays the same
 * events finds it in the same place at any frame rate.
 *
 * Three-free: positions and orientations are plain arrays (the drawing is fall-squirrel.js).
 */

import { SQUIRREL_CLIPS, SQUIRREL_SCALE } from './fall-squirrel-clips.js';
import { cross, normalize } from './fall-squirrel-stage.js';

const TAU = Math.PI * 2;
/** Seconds over which one clip hands over to the next. */
const BLEND = 0.26;
/** Seconds over which the body settles into an act's own heading (small changes; big ones are turned). */
const TURN = 0.24;
/** Seconds a move takes to get up to speed, and to stop (its speed eases in and out, S-shaped). */
const RAMP = 0.22;
/** A change of heading bigger than this (radians) is turned on the spot, the paws stepping round. */
const TURN_MIN = 0.5;
/**
 * The tail's follow-through: each of its seven bones, root to brush, points the way the body pointed
 * this much longer ago (seconds) than the one before it, so a turn or a stop runs down the tail and the
 * brush comes round last.
 */
const TAIL_DELAY = 0.035;
const TAIL_JOINTS = 7;
/** The routines a squirrel flicks its tail in now and then (more, and in bursts, when on edge). */
const FLICK_CLIPS = new Set(['idle', 'sit', 'look', 'cling', 'nibble']);
/** How long a flick runs (seconds): a snap up and a smaller rebound, travelling to the brush. */
export const FLICK_LENGTH = 0.75;
/** Where in its stride each gait starts (a fraction of the clip): with the hind feet down, pushing off. */
const GAIT_START = Object.freeze({
    bound: 0.7, hop: 0.72, climb: 0.74, descend: 0.0,
});
/** The leap's take-off and landing in its clip (the crouch and the landing are on the ground). */
const LEAP_MARKS = SQUIRREL_CLIPS.leap.marks;
/** The cushion between the bark or the litter and the paws (metres, drawn). */
const CLEARANCE = 0.012;

/**
 * Places on the floor it likes, by the tree they are near (world x, z). Each was projected through the
 * game's landscape eye: the maple's between 12 and 30 % of the screen's width from the left (clear of
 * its edge and of the board card), the oak's beyond 76 % (clear of the HUD that stands right of the
 * card), all on the floor the eye sees below the boughs.
 */
export const SQUIRREL_SPOTS = Object.freeze({
    maple: Object.freeze([[-6.3, 5.3], [-5.0, 6.4], [-4.5, 4.4], [-5.5, 5.0], [-4.0, 6.0], [-5.6, 7.0],
        [-4.3, 7.4], [-6.6, -0.4]]),
    oak: Object.freeze([[8.0, 1.0], [8.5, 2.5], [7.5, 3.5], [7.0, 4.6], [5.0, 7.0], [4.5, 8.3], [7.6, 0.4]]),
});
/**
 * Which way round each trunk it keeps to (radians from the side facing the eye, toward +x first): the
 * maple's trunk stands at the screen's left edge, so the squirrel keeps to its side toward the board.
 */
export const SQUIRREL_BARK_BIAS = Object.freeze({ maple: -0.35, oak: 0.25 });
/** The routines it can do on the floor and on the bark. */
export const GROUND_BITS = Object.freeze(['forage', 'snack', 'bury', 'sit', 'itch', 'dash', 'climb', 'cross']);
export const TRUNK_BITS = Object.freeze(['shift', 'look', 'peek', 'chatter', 'crown', 'treetops', 'down', 'over']);
/**
 * It keeps to both trees: from SETTLED seconds by one it grows restless for the other, wholly by
 * RESTLESS seconds more, and past WANDER it goes (over the floor, or up and through the treetops).
 */
const SETTLED = 15;
const RESTLESS = 25;
const WANDER = 75;
/** Where its attention goes when the board does something (about the board's middle, in the world). */
export const SQUIRREL_ATTENTION = Object.freeze([0, 3.2, 6.5]);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};
/** Quintic smoothstep: no jump in speed or in acceleration at either end. */
const smoother = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
};
/** The integral of the quintic smoothstep over 0..u (0.5 at 1): the distance covered while easing in. */
const easedDistance = (u) => u * u * u * u * (u * (u - 3) + 2.5);
/** A number in [0, 1) from two integers (a flick's timing, drawn from its act without the generator). */
const hash01 = (a, b) => {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const wrapPi = (a) => {
    let x = (a + Math.PI) % TAU;
    if (x < 0) x += TAU;
    return x - Math.PI;
};

// -- quaternions (x, y, z, w) -----------------------------------------------------------------
export function quatFromBasis(left, up, forward, out = [0, 0, 0, 1]) {
    // Columns: x = left, y = up, z = forward.
    const m00 = left[0];
    const m01 = up[0];
    const m02 = forward[0];
    const m10 = left[1];
    const m11 = up[1];
    const m12 = forward[1];
    const m20 = left[2];
    const m21 = up[2];
    const m22 = forward[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        out[3] = 0.25 / s;
        out[0] = (m21 - m12) * s;
        out[1] = (m02 - m20) * s;
        out[2] = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        out[3] = (m21 - m12) / s;
        out[0] = 0.25 * s;
        out[1] = (m01 + m10) / s;
        out[2] = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        out[3] = (m02 - m20) / s;
        out[0] = (m01 + m10) / s;
        out[1] = 0.25 * s;
        out[2] = (m12 + m21) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        out[3] = (m10 - m01) / s;
        out[0] = (m02 + m20) / s;
        out[1] = (m12 + m21) / s;
        out[2] = 0.25 * s;
    }
    const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    for (let i = 0; i < 4; i++) out[i] /= l;
    return out;
}

export function quatSlerp(a, b, t, out = [0, 0, 0, 1]) {
    let bx = b[0];
    let by = b[1];
    let bz = b[2];
    let bw = b[3];
    let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (cos < 0) {
        cos = -cos;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    let k0 = 1 - t;
    let k1 = t;
    if (cos < 0.9995) {
        const angle = Math.acos(cos);
        const sin = Math.sin(angle);
        k0 = Math.sin((1 - t) * angle) / sin;
        k1 = Math.sin(t * angle) / sin;
    }
    out[0] = a[0] * k0 + bx * k1;
    out[1] = a[1] * k0 + by * k1;
    out[2] = a[2] * k0 + bz * k1;
    out[3] = a[3] * k0 + bw * k1;
    const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    for (let i = 0; i < 4; i++) out[i] /= l;
    return out;
}

/** The body's forward (its +z) under quaternion q. */
function rotateForward(q) {
    const [x, y, z, w] = q;
    return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/** Turn quaternion q by `angle` about the unit axis (world), on the left. */
function quatTurn(q, axis, angle, out = [0, 0, 0, 1]) {
    const s = Math.sin(angle / 2);
    const rx = axis[0] * s;
    const ry = axis[1] * s;
    const rz = axis[2] * s;
    const rw = Math.cos(angle / 2);
    // (Read q whole before writing: `out` may be q itself.)
    const [qx, qy, qz, qw] = q;
    out[0] = rw * qx + rx * qw + ry * qz - rz * qy;
    out[1] = rw * qy - rx * qz + ry * qw + rz * qx;
    out[2] = rw * qz + rx * qy - ry * qx + rz * qw;
    out[3] = rw * qw - rx * qx - ry * qy - rz * qz;
    return out;
}

/**
 * A small seeded generator (mulberry32: its state is one number, so the mind can be replayed, and
 * neighbouring seeds give unrelated days, which a bare LCG did not).
 */
function nextRandom(state) {
    const s = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export class SquirrelMind {
    /**
     * @param {object} o
     * @param {object} o.stage            createSquirrelStage()
     * @param {number} [o.seed=271]
     * @param {number} [o.scale]          the drawn scale
     * @param {number} [o.motion=1]       under reduced motion, frights are a look rather than a jump
     * @param {string} [o.start='crown']  where it is when the world begins ('crown' comes down the maple)
     * @param {string[]} [o.script]       routines to do first, in order, where they can be done (the
     *                                     playground's ?squirrelPlan=), before it chooses for itself
     */
    constructor({
        stage, seed = 271, scale = SQUIRREL_SCALE, motion = 1, start = 'crown', script = [],
    }) {
        this.stage = stage;
        this.seed = seed >>> 0;
        this.scale = scale;
        this.motion = motion;
        this.start = start;
        this.script = Array.isArray(script) ? script.slice() : [];
        this.frameScratch = {
            point: [0, 0, 0], normal: [0, 1, 0], up: [0, 0, 1], side: [1, 0, 0],
        };
        this.reset(0);
    }

    reset(time = 0) {
        this.rngState = this.seed || 1;
        this.act = null;
        this.prev = null;
        /** The acts before the current one, newest first (blends reach back through them). */
        this.recent = [];
        this.queue = [];
        this.tail = null;
        this.alarm = 0;
        this.alarmTime = time;
        this.lastSnack = -1e9;
        this.lastCross = time;
        /** The tree it keeps to now, and since when (it grows restless for the other one). */
        this.home = null;
        this.homeSince = time;
        this.history = [];
        this.lastPushed = null;
        this.time = time;
        this.scripted = this.script.slice();
        if (this.start === 'crown') {
            this.tail = { time, place: this.crownPlace('maple', this.stage.facing.maple + 0.35) };
            this.push({ kind: 'hidden', duration: 1.8 });
            this.planFromCrown();
        } else {
            const [x, z] = SQUIRREL_SPOTS.maple[0];
            this.tail = {
                time,
                place: {
                    on: 'ground', a: x, b: z, heading: 0.4,
                },
            };
            this.planGround();
        }
        this.act = this.queue.shift();
        return this;
    }

    random() {
        const [state, value] = nextRandom(this.rngState);
        this.rngState = state;
        return value;
    }

    range(lo, hi) {
        return lo + (hi - lo) * this.random();
    }

    pick(weights) {
        const entries = Object.entries(weights).filter(([, w]) => w > 0);
        const total = entries.reduce((sum, [, w]) => sum + w, 0);
        let r = this.random() * total;
        for (const [key, w] of entries) {
            r -= w;
            if (r <= 0) return key;
        }
        return entries[entries.length - 1][0];
    }

    // -- places and frames --------------------------------------------------------------------
    trunkOf(place) {
        return place && place.on !== 'ground' ? this.stage.trunks[place.on] : null;
    }

    crownPlace(tree, angle) {
        const trunk = this.stage.trunks[tree];
        return {
            on: tree, a: trunk.high + 1.0, b: angle, heading: Math.PI,
        };
    }

    /** The frame of a place: point, normal, forward, left (world), with the heading. */
    frame(place, out = {
        point: [0, 0, 0], normal: [0, 1, 0], forward: [0, 0, 1], left: [1, 0, 0],
    }) {
        const f = this.frameScratch;
        let forward;
        if (place.on === 'ground') {
            this.stage.ground.frame(place.a, place.b, f);
            const c = Math.cos(place.heading);
            const s = Math.sin(place.heading);
            const n = f.normal;
            const d = c * n[0] + s * n[2];
            forward = normalize([c - n[0] * d, -n[1] * d, s - n[2] * d]);
        } else {
            this.stage.trunks[place.on].frame(place.a, place.b, f);
            const c = Math.cos(place.heading);
            const s = Math.sin(place.heading);
            forward = normalize([
                f.up[0] * c + f.side[0] * s, f.up[1] * c + f.side[1] * s, f.up[2] * c + f.side[2] * s,
            ]);
        }
        const n = f.normal;
        out.point[0] = f.point[0] + n[0] * CLEARANCE;
        out.point[1] = f.point[1] + n[1] * CLEARANCE;
        out.point[2] = f.point[2] + n[2] * CLEARANCE;
        out.normal[0] = n[0];
        out.normal[1] = n[1];
        out.normal[2] = n[2];
        out.forward[0] = forward[0];
        out.forward[1] = forward[1];
        out.forward[2] = forward[2];
        const left = normalize(cross(n, forward));
        out.left[0] = left[0];
        out.left[1] = left[1];
        out.left[2] = left[2];
        return out;
    }

    /** Metres between two places on one surface, and the heading from the first to the second. */
    measure(from, to) {
        if (from.on === 'ground') {
            const dx = to.a - from.a;
            const dz = to.b - from.b;
            return { length: Math.hypot(dx, dz), heading: Math.atan2(dz, dx) };
        }
        const trunk = this.stage.trunks[from.on];
        const dh = to.a - from.a;
        const da = wrapPi(to.b - from.b);
        const r = trunk.radius(clamp((from.a + to.a) / 2, trunk.low, trunk.high), from.b + da / 2);
        const side = da * r;
        return { length: Math.hypot(dh, side), heading: Math.atan2(side, dh) };
    }

    /** The place `s` of the way from `from` to `to` (same surface). */
    between(from, to, u, heading) {
        if (from.on === 'ground') {
            return {
                on: 'ground', a: from.a + (to.a - from.a) * u, b: from.b + (to.b - from.b) * u, heading,
            };
        }
        return {
            on: from.on, a: from.a + (to.a - from.a) * u, b: from.b + wrapPi(to.b - from.b) * u, heading,
        };
    }

    /** Where on the floor at the foot of `tree`, facing angle `angle`, it jumps on or lands. */
    trunkFoot(tree, angle) {
        const trunk = this.stage.trunks[tree];
        const { cx, cz, r } = trunk.sample(trunk.low, angle);
        const reach = r + 0.55;
        return {
            on: 'ground', a: cx + Math.cos(angle) * reach, b: cz + Math.sin(angle) * reach, heading: angle + Math.PI,
        };
    }

    nearestTree(place) {
        if (place.on !== 'ground') return place.on;
        let best = 'maple';
        let bestD = Infinity;
        for (const [name, trunk] of Object.entries(this.stage.trunks)) {
            const { cx, cz } = trunk.sample(trunk.low, 0);
            const d = Math.hypot(place.a - cx, place.b - cz);
            if (d < bestD) {
                bestD = d;
                best = name;
            }
        }
        return best;
    }

    // -- building the plan -------------------------------------------------------------------
    /** Append an act after the plan's tail. */
    push(spec) {
        // A big change of heading is turned on the spot first (the paws step round), not swung.
        if (spec.kind === 'move' && !spec.noTurn) this.turnToward(this.measure(this.tail.place, spec.to).heading);
        if (spec.kind === 'leap' && this.tail.place.on === 'ground' && spec.to.on !== 'ground') {
            const a = this.frame(this.tail.place);
            const b = this.frame(spec.to);
            this.turnToward(Math.atan2(b.point[2] - a.point[2], b.point[0] - a.point[0]), 1.0);
        }
        const from = this.tail.place;
        const act = {
            ...spec, from, t0: this.tail.time, rate: spec.rate ?? 1, phase: spec.phase ?? 0,
        };
        if (act.kind === 'move') {
            const { length, heading } = this.measure(from, act.to);
            const clip = SQUIRREL_CLIPS[act.clip];
            act.length = length;
            act.heading = heading;
            act.speed = clip.speed * this.scale * act.rate;
            act.duration = length / Math.max(act.speed, 1e-3) + RAMP;
            act.to = { ...act.to, heading };
            act.from = { ...from, heading };
        } else if (act.kind === 'leap') {
            const a = this.frame(from);
            const b = this.frame(act.to);
            const d = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1], b.point[2] - a.point[2]);
            const { length } = SQUIRREL_CLIPS.leap;
            act.distance = d;
            // Crouch and push on the ground, the flight, the landing taken in the legs.
            act.crouch = LEAP_MARKS.takeoff * length;
            act.flight = act.flight ?? (0.24 + 0.08 * d);
            act.landing = (1 - LEAP_MARKS.landing) * length;
            act.duration = act.crouch + act.flight + act.landing;
            act.height = act.height ?? (0.2 + 0.12 * d);
        } else if (act.kind === 'turn') {
            act.to = { ...from, heading: act.heading };
        }
        // A stay that plays on the clip the act before it played goes on from where that one was in
        // it (one clip cannot be in two places at once, and a jump in it is a jerk).
        const last = this.lastPushed;
        if (act.kind === 'stay' && last && (last.kind === 'stay' || last.kind === 'turn') && last.clip === act.clip
            && Math.abs(last.t1 - act.t0) < 1e-9) {
            act.rate = last.rate;
            act.phase = last.phase + (last.t1 - last.t0) * last.rate;
        }
        act.t1 = act.t0 + act.duration;
        // The act's own timing (a cut shortens its window, never the way it moves within it).
        act.run = act.duration;
        // How on edge it was when it began (an alarmed squirrel flags its tail).
        act.alarm = this.alarm;
        if (act.kind === 'stay' || act.kind === 'hidden') {
            act.to = act.to ?? { ...from, heading: act.heading ?? from.heading };
        }
        this.queue.push(act);
        this.tail = { time: act.t1, place: act.to };
        this.lastPushed = act;
        return act;
    }

    /** Turn on the spot to `heading` (the paws stepping round: shuffle on the floor, pivot on the bark). */
    turnToward(heading, least = TURN_MIN) {
        const from = this.tail.place;
        const delta = wrapPi(heading - from.heading);
        if (Math.abs(delta) <= least) return null;
        return this.push({
            kind: 'turn',
            clip: from.on === 'ground' ? 'shuffle' : 'pivot',
            duration: 0.24 + (0.36 * Math.abs(delta)) / Math.PI,
            fromHeading: from.heading,
            heading: from.heading + delta,
        });
    }

    stay(clip, duration, extra = {}) {
        return this.push({
            kind: 'stay', clip, duration, ...extra,
        });
    }

    move(to, clip, extra = {}) {
        return this.push({
            kind: 'move', to, clip, ...extra,
        });
    }

    leap(to, extra = {}) {
        return this.push({ kind: 'leap', to, ...extra });
    }

    /** Somewhere on the floor near its tree, within `near`..`far` metres of where it is. */
    groundSpot(tree, near = 0.6, far = 3.5) {
        const here = this.tail.place;
        const spots = SQUIRREL_SPOTS[tree];
        for (let attempt = 0; attempt < 8; attempt++) {
            const [x, z] = spots[Math.floor(this.random() * spots.length) % spots.length];
            const jx = x + this.range(-0.5, 0.5);
            const jz = z + this.range(-0.5, 0.5);
            const d = here.on === 'ground' ? Math.hypot(jx - here.a, jz - here.b) : 2;
            if (d >= near && d <= far) {
                return {
                    on: 'ground', a: jx, b: jz, heading: 0,
                };
            }
        }
        // Nothing in range: a short step in the direction of the nearest liked place.
        const [x, z] = spots[0];
        const dx = x - here.a;
        const dz = z - here.b;
        const d = Math.hypot(dx, dz) || 1;
        const step = clamp(d, near, far);
        return {
            on: 'ground', a: here.a + (dx / d) * step, b: here.b + (dz / d) * step, heading: 0,
        };
    }

    /** A place on the bark of `tree` the eye can see, within `span` radians of facing it. */
    barkSpot(tree, lo, hi, span = 0.9) {
        const trunk = this.stage.trunks[tree];
        return {
            on: tree,
            a: this.range(Math.max(trunk.low + 0.2, lo), Math.min(trunk.high - 0.15, hi)),
            b: this.front(tree) + this.range(-span, span),
            heading: 0,
        };
    }

    /** The angle round `tree` it keeps to (the side facing the eye, turned toward the board). */
    front(tree) {
        return this.stage.facing[tree] + (SQUIRREL_BARK_BIAS[tree] || 0);
    }

    /** An angle round `tree` brought back within `span` of its front. */
    toFront(tree, angle, span) {
        const front = this.front(tree);
        return front + clamp(wrapPi(angle - front), -span, span);
    }

    /** Over the floor: a hop for a short way, a bound for a long one. */
    goGround(to) {
        const here = this.tail.place;
        const d = Math.hypot(to.a - here.a, to.b - here.b);
        if (d > 2.2) {
            // Squirrels run in dashes: a stop dead halfway on a long run, sometimes.
            if (d > 4 && this.random() < 0.55) {
                const mid = this.between(here, to, this.range(0.4, 0.6), 0);
                this.move(mid, 'bound', { rate: this.range(0.9, 1.15) });
                this.stay(this.random() < 0.5 ? 'idle' : 'look', this.range(0.35, 0.8), { phase: this.range(0, 3) });
            }
            this.move(to, 'bound', { rate: this.range(0.9, 1.15) });
        } else if (d > 0.05) {
            this.move(to, 'hop', { rate: this.range(0.9, 1.2) });
        }
    }

    /** Up or down or round the bark to a place on the same trunk. */
    goBark(to) {
        const here = this.tail.place;
        const { heading } = this.measure(here, to);
        const down = Math.cos(heading) < -0.35;
        this.move(to, down ? 'descend' : 'climb', { rate: down ? this.range(1.0, 1.4) : this.range(0.85, 1.15) });
    }

    /** The next scripted routine if it can be done here (one that cannot is passed over). */
    scriptedBit(allowed) {
        while (this.scripted.length) {
            const bit = this.scripted.shift();
            if (allowed.includes(bit)) return bit;
        }
        return null;
    }

    planGround() {
        const here = this.tail.place;
        const tree = this.nearestTree(here);
        const now = this.tail.time;
        const snacked = now - this.lastSnack < 25;
        const bit = this.scriptedBit(GROUND_BITS) || this.pick({
            forage: 3,
            snack: snacked ? 0.3 : 2.4,
            bury: 1.4,
            sit: 1.4,
            itch: 0.8,
            dash: 1.3,
            climb: 2.6,
            cross: 0.1 + 4 * this.restless(now),
        });
        this.history.push(bit);
        if (bit === 'forage') {
            this.goGround(this.groundSpot(tree, 0.5, 1.8));
            this.stay('idle', this.range(0.7, 1.6), { phase: this.range(0, 4) });
        } else if (bit === 'snack') {
            this.lastSnack = now;
            this.goGround(this.groundSpot(tree, 0.4, 2.0));
            this.stay('dig', this.range(0.5, 0.9));
            this.stay('sit', 0.45);
            this.stay('nibble', this.range(3.6, 6.4), { acorn: true });
            this.stay('groom', this.range(1.6, 2.4));
            this.stay('sit', this.range(0.8, 1.6), { phase: this.range(0, 4) });
        } else if (bit === 'bury') {
            this.goGround(this.groundSpot(tree, 0.5, 2.5));
            this.stay('dig', this.range(1.0, 1.6));
            this.stay('pat', this.range(1.2, 1.6));
            // ...and looks round to see who saw.
            this.stay('look', this.range(1.4, 2.4), { phase: this.range(0, 3) });
        } else if (bit === 'sit') {
            this.stay(this.random() < 0.55 ? 'sit' : 'look', this.range(1.8, 3.6), { phase: this.range(0, 4) });
        } else if (bit === 'itch') {
            this.stay('sit', 0.6);
            this.stay('scratch', this.range(1.0, 1.8));
            this.stay('idle', 0.5, { phase: this.range(0, 4) });
        } else if (bit === 'dash') {
            this.goGround(this.groundSpot(tree, 2.0, 5.0));
            this.stay('idle', this.range(0.4, 0.9), { phase: this.range(0, 4) });
        } else if (bit === 'climb') {
            this.toTrunk(tree);
        } else if (bit === 'cross') {
            this.crossOver(tree);
        }
    }

    /** How restless it is for the other tree (0..1), having kept to this one since `homeSince`. */
    restless(now) {
        return clamp((now - this.homeSince - SETTLED) / RESTLESS, 0, 1);
    }

    /**
     * Over the floor to the other tree, as squirrels cross open ground: in dashes, stopping dead to look
     * at the edge of its own ground and again at the edge of the other's (the liked places nearest
     * across: beside the board, never behind it), then on, half the time straight up the other tree.
     */
    crossOver(tree) {
        const other = tree === 'maple' ? 'oak' : 'maple';
        this.lastCross = this.tail.time;
        const upIt = this.random() < 0.5;
        let goal;
        if (upIt) {
            goal = this.trunkFoot(other, this.front(other) + this.range(-0.5, 0.5));
        } else {
            const spots = SQUIRREL_SPOTS[other];
            const [x, z] = spots[Math.floor(this.random() * spots.length) % spots.length];
            goal = {
                on: 'ground', a: x + this.range(-0.3, 0.3), b: z + this.range(-0.3, 0.3), heading: 0,
            };
        }
        const rate = this.range(1.05, 1.2);
        const start = this.tail.place;
        const stops = [this.edgeSpot(tree, goal)];
        // (Not always both: one run in three goes on past the far edge without a pause.)
        if (this.random() > 0.33) stops.push(this.edgeSpot(other, start));
        for (const stop of stops) {
            const here = this.tail.place;
            // A stop it is already past, or all but standing on, is not a stop.
            const ahead = (stop.a - here.a) * (goal.a - here.a) + (stop.b - here.b) * (goal.b - here.b);
            if (Math.hypot(stop.a - here.a, stop.b - here.b) < 0.8 || ahead <= 0) continue;
            this.move(stop, 'bound', { rate });
            this.stay(this.random() < 0.6 ? 'look' : 'idle', this.range(0.45, 1.0), { phase: this.range(0, 3) });
        }
        this.move(goal, 'bound', { rate });
        if (upIt) this.toTrunk(other, { from: goal.heading - Math.PI });
        else this.stay('look', this.range(1.0, 1.8), { phase: this.range(0, 3) });
    }

    /** Of `tree`'s liked places on the floor, one of the two nearest `toward` (a place), a little aside. */
    edgeSpot(tree, toward) {
        const near = SQUIRREL_SPOTS[tree].map(([x, z]) => [x, z, Math.hypot(x - toward.a, z - toward.b)])
            .sort((p, q) => p[2] - q[2]);
        const [x, z] = near[this.random() < 0.5 ? 0 : Math.min(1, near.length - 1)];
        return {
            on: 'ground', a: x + this.range(-0.25, 0.25), b: z + this.range(-0.25, 0.25), heading: 0,
        };
    }

    /** Run to the foot of the tree, leap onto the bark and climb (`from`: the angle round it it comes at). */
    toTrunk(tree, { high = false, flee = false, from = null } = {}) {
        const trunk = this.stage.trunks[tree];
        const angle = from ?? this.front(tree) + this.range(-0.55, 0.55);
        const foot = this.trunkFoot(tree, angle);
        const here = this.tail.place;
        if (Math.hypot(foot.a - here.a, foot.b - here.b) > 0.15) {
            if (flee) this.move(foot, 'bound', { rate: 1.25 });
            else this.goGround(foot);
        }
        this.leap({
            on: tree, a: trunk.low + 0.35, b: angle, heading: 0,
        });
        const top = high ? trunk.high - 0.2 : this.range(trunk.low + 0.9, trunk.high - 0.25);
        this.goBark({
            on: tree, a: top, b: angle + this.range(-0.4, 0.4), heading: 0,
        });
        this.stay('cling', this.range(1.4, 3.0), { phase: this.range(0, 3.6) });
    }

    planTrunk() {
        const here = this.tail.place;
        const tree = here.on;
        const trunk = this.stage.trunks[tree];
        const face = this.stage.facing[tree];
        const restless = this.restless(this.tail.time);
        // (Long enough by this tree, it goes: over the floor or through the treetops.)
        const away = this.tail.time - this.homeSince > WANDER;
        const bit = this.scriptedBit(TRUNK_BITS) || this.pick({
            shift: away ? 0 : 2.2,
            look: away ? 0 : 1.8,
            peek: away ? 0 : 1.5,
            chatter: away ? 0 : 0.6,
            crown: away ? 0 : 0.6,
            treetops: 0.15 + 1.4 * restless,
            down: away ? 0 : 2.6,
            over: 2.2 * restless,
        });
        this.history.push(bit);
        if (bit === 'shift') {
            this.goBark({
                on: tree,
                a: clamp(here.a + this.range(-1.3, 1.3), trunk.low + 0.3, trunk.high - 0.15),
                b: this.toFront(tree, here.b + this.range(-0.5, 0.5), 0.85),
                heading: 0,
            });
            this.stay('cling', this.range(1.0, 2.4), { phase: this.range(0, 3.6) });
        } else if (bit === 'look') {
            this.stay('cling', this.range(1.8, 3.6), { phase: this.range(0, 3.6) });
        } else if (bit === 'peek') {
            // Round to the far side, a wait out of sight, then a peek round the edge.
            const side = this.random() < 0.5 ? -1 : 1;
            const h = clamp(here.a + this.range(-0.4, 0.4), trunk.low + 0.3, trunk.high - 0.2);
            this.goBark({
                on: tree, a: h, b: face + side * Math.PI * 0.95, heading: 0,
            });
            this.stay('cling', this.range(1.2, 2.6), { phase: this.range(0, 3.6) });
            const edge = face - side * this.range(1.2, 1.4);
            this.goBark({
                on: tree, a: clamp(h + this.range(-0.5, 0.5), trunk.low + 0.3, trunk.high - 0.2), b: edge, heading: 0,
            });
            this.stay('cling', this.range(1.4, 2.4), { look: 1, phase: this.range(0, 3.6) });
            this.goBark({
                on: tree, a: this.tail.place.a, b: face - side * this.range(0.2, 0.6), heading: 0,
            });
            this.stay('cling', this.range(0.8, 1.6), { phase: this.range(0, 3.6) });
        } else if (bit === 'chatter') {
            this.stay('chatter', this.range(1.8, 2.7), { look: 1 });
            this.stay('cling', 0.8, { phase: this.range(0, 3.6) });
        } else if (bit === 'crown') {
            this.goBark({
                on: tree, a: trunk.high + 1.0, b: here.b, heading: 0,
            });
            this.push({ kind: 'hidden', duration: this.range(3.5, 9) });
            this.planFromCrown();
        } else if (bit === 'treetops') {
            // Up into the crown and away through the treetops: it comes down the other tree.
            const other = tree === 'maple' ? 'oak' : 'maple';
            this.goBark({
                on: tree, a: trunk.high + 1.0, b: here.b, heading: 0,
            });
            this.push({
                kind: 'hidden',
                duration: this.range(6, 10),
                to: this.crownPlace(other, this.front(other)),
            });
            this.planFromCrown();
        } else if (bit === 'over') {
            this.toGround(tree);
            this.crossOver(tree);
        } else {
            this.toGround(tree);
        }
    }

    /** Head first down to the foot of the trunk, and a jump off onto the floor. */
    toGround(tree) {
        const trunk = this.stage.trunks[tree];
        const here = this.tail.place;
        const angle = this.toFront(tree, here.b, 0.6);
        this.goBark({
            on: tree, a: trunk.low + 0.3, b: angle, heading: Math.PI,
        });
        const landing = this.trunkFoot(tree, angle);
        landing.a += Math.cos(angle) * this.range(0.2, 0.7);
        landing.b += Math.sin(angle) * this.range(0.2, 0.7);
        landing.heading = angle + this.range(-0.5, 0.5);
        this.leap(landing);
        this.stay(this.random() < 0.5 ? 'idle' : 'sit', this.range(0.6, 1.4), { phase: this.range(0, 4) });
    }

    /** Out of the crown, head first, to somewhere on the bark it can be seen. */
    planFromCrown() {
        const here = this.tail.place;
        const tree = here.on;
        const trunk = this.stage.trunks[tree];
        const spot = this.barkSpot(tree, trunk.low + 0.9, trunk.high - 0.3, 0.8);
        this.tail.place = { ...here, b: spot.b };
        this.goBark(spot);
        this.stay('cling', this.range(1.6, 3.0), { phase: this.range(0, 3.6) });
    }

    plan() {
        const here = this.tail.place;
        // Which tree it keeps to now (a crossing or the treetops brought it to the other).
        const home = this.nearestTree(here);
        if (home !== this.home) {
            this.home = home;
            this.homeSince = this.tail.time;
        }
        if (here.on === 'ground') this.planGround();
        else if (here.a > this.stage.trunks[here.on].high + 0.5) {
            this.push({ kind: 'hidden', duration: this.range(3, 7) });
            this.planFromCrown();
        } else this.planTrunk();
    }

    // -- time --------------------------------------------------------------------------------
    advance(time) {
        if (!Number.isFinite(time)) return this.act;
        if (time < this.time) {
            // Back in time: replay from the start (a seek; the events are replayed by whoever seeks).
            this.reset(0);
        }
        this.time = time;
        let guard = 0;
        while (this.act && time >= this.act.t1 && guard++ < 4096) {
            this.prev = this.act;
            this.recent.unshift(this.act);
            if (this.recent.length > 6) this.recent.length = 6;
            if (!this.queue.length) this.plan();
            this.act = this.queue.shift();
        }
        return this.act;
    }

    /** The place an act has reached at `time` (for a move, its place along the way). */
    placeAt(act, time) {
        if (act.kind === 'move') {
            const s = this.travel(act, time);
            return this.between(act.from, act.to, act.length > 0 ? s / act.length : 1, act.heading);
        }
        if (act.kind === 'leap') return time >= act.t1 ? act.to : act.from;
        if (act.kind === 'turn') {
            const u = act.run > 0 ? clamp((time - act.t0) / act.run, 0, 1) : 1;
            return { ...act.from, heading: act.fromHeading + (act.heading - act.fromHeading) * smoother(0, 1, u) };
        }
        return act.to;
    }

    /**
     * Metres along a move at `time`. Its speed eases up over RAMP seconds and down over the last RAMP
     * (a quintic smoothstep, so no jerk), which costs it RAMP seconds over the whole run at full speed.
     */
    travel(act, time) {
        const tau = clamp(time - act.t0, 0, act.duration);
        const v = act.speed;
        const a = RAMP;
        const run = act.run ?? act.duration;
        if (tau < a) return Math.min(act.length, v * a * easedDistance(tau / a));
        if (tau > run - a) return Math.max(0, act.length - v * a * easedDistance((run - tau) / a));
        return v * (tau - a / 2);
    }

    /**
     * Cut the plan at `time` and continue from where the squirrel is then. Returns false (and does
     * nothing) when it cannot be cut: in the air, or out of sight in a crown.
     */
    interrupt(time) {
        this.advance(time);
        const { act } = this;
        if (!act || act.kind === 'leap' || act.kind === 'hidden') return false;
        // Cut where it is: the act keeps its own path and timing (so its clip and its place up to
        // here are what they were) and only its window ends now.
        const place = this.placeAt(act, time);
        act.t1 = time;
        act.duration = time - act.t0;
        this.queue.length = 0;
        this.tail = { time, place };
        this.lastPushed = act;
        return true;
    }

    /**
     * Something happened on the board.
     * @param {'drop'|'clear'|'four'|'combo'|'perfect'|'spin'|'over'} kind
     * @param {number} time
     * @param {number} [strength=1]
     */
    cue(kind, time, strength = 1) {
        this.advance(time);
        const { act } = this;
        if (!act) return false;
        // Frights wear off: each one sets it on edge, and it gets used to them.
        const since = time - this.alarmTime;
        this.alarm *= Math.exp(-since / 14);
        this.alarmTime = time;
        const onGround = act.from.on === 'ground' && act.kind !== 'leap';
        const busy = act.kind === 'leap' || act.kind === 'hidden';
        if (busy) return false;
        const calm = this.motion < 1;
        if (kind === 'drop') {
            const chance = clamp(strength, 0, 1) * (1 - this.alarm) * 0.85;
            if (this.random() > chance) return false;
            this.alarm = Math.min(1, this.alarm + 0.4);
            if (!this.interrupt(time)) return false;
            if (onGround) {
                this.stay(calm ? 'look' : 'startle', calm ? 1.0 : SQUIRREL_CLIPS.startle.length);
                if (this.random() < 0.45) this.toTrunk(this.nearestTree(this.tail.place), { flee: true });
                else this.stay('chatter', this.range(1.4, 2.2), { look: 1 });
            } else {
                this.stay('chatter', this.range(0.9, 1.6), { look: 1 });
            }
            return true;
        }
        if (kind === 'four' || kind === 'perfect') {
            if (!this.interrupt(time)) return false;
            this.alarm = Math.min(1, this.alarm + 0.3);
            if (onGround) {
                if (kind === 'perfect') {
                    this.stay(calm ? 'look' : 'startle', calm ? 1.2 : SQUIRREL_CLIPS.startle.length, { twirl: !calm });
                } else this.stay(calm ? 'look' : 'startle', calm ? 1.0 : SQUIRREL_CLIPS.startle.length);
                if (kind === 'four') this.toTrunk(this.nearestTree(this.tail.place), { flee: true, high: true });
                else this.stay('chatter', 1.6, { look: 1 });
            } else {
                this.stay('chatter', this.range(1.8, 2.6), { look: 1 });
            }
            return true;
        }
        if (kind === 'combo') {
            if (act.kind !== 'stay' || act.clip === 'chatter' || this.random() > 0.6) return false;
            if (!this.interrupt(time)) return false;
            this.stay('chatter', this.range(1.6, 2.4), { look: 1 });
            return true;
        }
        if (kind === 'clear' || kind === 'spin') {
            // A clear turns its head to the board (a sitter sits up to see).
            if (act.kind !== 'stay' || this.random() > 0.55) return false;
            if (!this.interrupt(time)) return false;
            if (onGround && act.clip !== 'nibble') this.stay('look', this.range(1.2, 2.0), { look: 1, phase: 0.2 });
            else if (onGround) this.stay('nibble', this.range(1.2, 2.0), { look: 1, acorn: true });
            else this.stay('cling', this.range(1.2, 2.0), { look: 1, phase: this.range(0, 3.6) });
            return true;
        }
        if (kind === 'over') {
            if (!this.interrupt(time)) return false;
            const tree = this.nearestTree(this.tail.place);
            if (onGround) this.toTrunk(tree, { flee: true });
            const trunk = this.stage.trunks[tree];
            const face = this.stage.facing[tree];
            const h = clamp(this.tail.place.a, trunk.low + 0.6, trunk.high - 0.4);
            this.goBark({
                on: tree, a: h, b: face + Math.PI * 0.95, heading: 0,
            });
            this.stay('cling', 2.5, { phase: 1 });
            this.goBark({
                on: tree, a: h, b: face + 1.3, heading: 0,
            });
            this.stay('cling', 3, { look: 1, phase: 2 });
            return true;
        }
        return false;
    }

    // -- the pose -----------------------------------------------------------------------------
    /** The clip an act plays at `time`, and its time into the clip. */
    clipAt(act, time) {
        if (act.kind === 'hidden') return { name: 'cling', time: 0 };
        if (act.kind === 'leap') {
            // The crouch and the landing at the clip's own pace, the flight stretched to the jump.
            const { length } = SQUIRREL_CLIPS.leap;
            const tau = clamp(time - act.t0, 0, act.duration);
            let clipTime;
            if (tau < act.crouch) clipTime = tau;
            else if (tau < act.crouch + act.flight) {
                const flown = (tau - act.crouch) / act.flight;
                clipTime = (LEAP_MARKS.takeoff + flown * (LEAP_MARKS.landing - LEAP_MARKS.takeoff)) * length;
            } else clipTime = LEAP_MARKS.landing * length + (tau - act.crouch - act.flight);
            return { name: 'leap', time: clipTime };
        }
        const clip = SQUIRREL_CLIPS[act.clip];
        if (act.kind === 'move') {
            const s = this.travel(act, Math.min(time, act.t1));
            const over = Math.max(0, time - act.t1) * act.speed;
            // (A gait starts in its stride where the hind feet are down pushing, as from standing.)
            const start = (GAIT_START[act.clip] ?? 0) * clip.length;
            return { name: act.clip, time: start + (s + over) / Math.max(1e-3, clip.speed * this.scale) };
        }
        const t = (time - act.t0) * act.rate + act.phase;
        return { name: act.clip, time: clip.loop ? t : Math.min(t, clip.length - 1e-3) };
    }

    /** Body frame of an act at `time`: position, orientation, the surface under it, how high over it. */
    bodyAt(act, time, out) {
        if (act.kind === 'leap') {
            // On the ground for the crouch, in the air for the flight, down again for the landing.
            const u = clamp((time - act.t0 - act.crouch) / act.flight, 0, 1);
            const a = this.frame(act.from);
            const b = this.frame(act.to);
            const qa = quatFromBasis(a.left, a.normal, a.forward);
            const qb = quatFromBasis(b.left, b.normal, b.forward);
            const k = smoother(0.05, 0.9, u);
            const arc = 4 * u * (1 - u) * act.height;
            for (let i = 0; i < 3; i++) {
                out.position[i] = a.point[i] + (b.point[i] - a.point[i]) * u + (i === 1 ? arc : 0)
                    + (a.normal[i] * (1 - u) + b.normal[i] * u) * arc * 0.35;
                out.surface[i] = a.point[i] + (b.point[i] - a.point[i]) * u;
                out.normal[i] = a.normal[i] * (1 - k) + b.normal[i] * k;
            }
            quatSlerp(qa, qb, k, out.quaternion);
            out.lift = arc;
            return out;
        }
        const place = this.placeAt(act, Math.min(time, act.t1));
        const f = this.frame(place);
        for (let i = 0; i < 3; i++) {
            out.position[i] = f.point[i];
            out.surface[i] = f.point[i];
            out.normal[i] = f.normal[i];
        }
        quatFromBasis(f.left, f.normal, f.forward, out.quaternion);
        out.lift = 0;
        return out;
    }

    /**
     * Everything the drawing needs at `time`.
     * @returns {{ visible: boolean, position: number[], quaternion: number[], clips: {name:string,time:number,weight:number}[],
     *   acorn: boolean, look: number, attention: readonly number[], surface: number[], normal: number[], lift: number,
     *   act: string, clip: string }}
     */
    pose(time, out = createSquirrelPose()) {
        const act = this.advance(time);
        out.visible = Boolean(act) && act.kind !== 'hidden';
        if (!act) return out;
        this.bodyAt(act, time, out);
        const into = time - act.t0;
        const prev = this.prev && this.prev.t1 <= act.t0 + 1e-9 ? this.prev : null;
        const current = this.clipAt(act, time);
        out.clips.length = 0;
        this.blendClips(time, out.clips);
        if (prev && into < TURN && prev.kind !== 'hidden' && act.kind !== 'leap') {
            const before = this.bodyAt(prev, prev.t1, this.prevScratch || (this.prevScratch = createSquirrelPose()));
            quatSlerp(before.quaternion, out.quaternion, smoother(0, TURN, into), out.quaternion);
        }
        // (The trail is read off the body's path before the twirl: a whole turn in a third of a second
        // is more than half a turn within the trail's look back, which has no side to trail to.)
        this.followThrough(time, out);
        this.flickAt(time, out);
        if (act.twirl && act.clip === 'startle') {
            // A twirl in the air: one whole turn about its own up while it is off the ground (laid on
            // after the hand-over above, which would take the short way round a turn half done).
            quatTurn(out.quaternion, out.normal, TAU * smoother(0.12, 0.5, time - act.t0), out.quaternion);
        }
        out.acorn = Boolean(act.acorn) && act.kind === 'stay';
        const lookIn = act.look ? smooth(0, 0.3, into) * smooth(0, 0.3, act.t1 - time) : 0;
        out.look = lookIn * (act.look || 0);
        out.attention = SQUIRREL_ATTENTION;
        out.act = act.kind;
        out.clip = current.name;
        return out;
    }

    /**
     * The clips showing at `time`: the act's own, handed over from what was showing when it began. That
     * may itself still have been a hand-over (a fright that cuts a dig a moment after it took over from
     * a hop hands over from the hop, not from the dig), so the blend reaches back through the last
     * few acts. A clip that shows twice is one entry.
     */
    blendClips(time, clips) {
        clips.length = 0;
        const chain = [this.act];
        for (const act of this.recent) {
            if (chain.length >= 4 || act.kind === 'hidden' || act.t1 > chain[chain.length - 1].t0 + 1e-9) break;
            chain.push(act);
        }
        let weight = 1;
        for (let i = 0; i < chain.length && weight > 1e-4; i++) {
            const act = chain[i];
            const into = time - act.t0;
            const handing = i + 1 < chain.length && into < BLEND;
            const own = handing ? weight * smoother(0, BLEND, into) : weight;
            const { name, time: clipTime } = this.clipAt(act, time);
            const same = clips.find((entry) => entry.name === name);
            if (same) {
                if (own > same.weight) same.time = clipTime;
                same.weight += own;
            } else if (own > 0) clips.push({ name, time: clipTime, weight: own });
            weight -= own;
            if (!handing) break;
        }
        if (!clips.length) clips.push({ ...this.clipAt(this.act, time), weight: 1 });
        return clips;
    }

    /** The body as it was at `time` (on the act then, among the last few), or null in the crown. */
    bodyBefore(time, out) {
        let found = null;
        for (const act of [this.act, ...this.recent]) {
            if (!act) continue;
            found = act;
            if (time >= act.t0) break;
        }
        if (!found || found.kind === 'hidden') return null;
        return this.bodyAt(found, clamp(time, found.t0, found.t1), out);
    }

    /**
     * What the tail trails by (follow-through, read off the body's own path, so still a function of
     * the clock). For each tail bone, root to brush, `tailTurn` is how far the body has turned about
     * its up since TAIL_DELAY x (bone + 1) seconds ago (radians), and `tailSurge` how much faster it
     * goes now than then (life-size metres a second): the drawing bends each bone back by them, so
     * the tail keeps pointing where the body was and comes round after it.
     */
    followThrough(time, out) {
        const turns = out.tailTurn;
        const surges = out.tailSurge;
        turns.fill(0);
        surges.fill(0);
        if (!out.visible) return out;
        // A leap turns the body over end to end (bark to floor): there the trail is let go during the
        // crouch and taken up again after the landing, rather than read off a tumbling frame.
        const { act, prev } = this;
        let hold = 1;
        if (act.kind === 'leap') hold = 1 - smoother(0, act.crouch, time - act.t0);
        else if (prev && prev.kind === 'leap') hold = smoother(0, TAIL_DELAY * (TAIL_JOINTS + 2), time - prev.t1);
        if (hold <= 0) return out;
        const past = this.pastBodies || (this.pastBodies = Array.from({ length: TAIL_JOINTS + 2 }, createSquirrelPose));
        const n = out.normal;
        const now = rotateForward(out.quaternion);
        const speeds = [];
        let last = out.position;
        let reached = 0;
        for (let k = 1; k <= TAIL_JOINTS + 1; k++) {
            const then = this.bodyBefore(time - k * TAIL_DELAY, past[k]);
            if (!then) break;
            speeds.push(Math.hypot(last[0] - then.position[0], last[1] - then.position[1], last[2] - then.position[2])
                / TAIL_DELAY);
            last = then.position;
            reached = k;
            if (k > TAIL_JOINTS) break;
            // The turn about the body's up since then: the old forward, laid in today's tangent plane,
            // against today's forward. Where the old forward stood up out of that plane the measure
            // fades out rather than flip.
            const old = rotateForward(then.quaternion);
            const lift = old[0] * n[0] + old[1] * n[1] + old[2] * n[2];
            const flat = [old[0] - n[0] * lift, old[1] - n[1] * lift, old[2] - n[2] * lift];
            const size = Math.hypot(flat[0], flat[1], flat[2]);
            const c = cross(flat, now);
            const turn = Math.atan2(
                c[0] * n[0] + c[1] * n[1] + c[2] * n[2],
                flat[0] * now[0] + flat[1] * now[1] + flat[2] * now[2],
            );
            turns[k - 1] = turn * smooth(0.45, 0.85, size) * hold;
        }
        for (let i = 0; i < TAIL_JOINTS && i + 1 < speeds.length; i++) {
            surges[i] = ((speeds[0] - speeds[i + 1]) / this.scale) * hold;
        }
        // (Short of the look back, in or out of a crown: the bones beyond keep the last reading.)
        for (let i = Math.max(1, reached); i < TAIL_JOINTS; i++) {
            turns[i] = turns[i - 1];
            surges[i] = i > 0 ? surges[i - 1] : 0;
        }
        return out;
    }

    /**
     * When the act flicks its tail (seconds), drawn once from the act itself: now and then in a calm
     * sit or cling, a burst of two or three first when it began on edge. (A hash of the act's start and
     * the seed, not the generator: the plans do not change for them, and a cut act keeps its flicks.)
     */
    flicksOf(act) {
        if (act.flicks) return act.flicks;
        act.flicks = [];
        if (act.kind !== 'stay' || !FLICK_CLIPS.has(act.clip)) return act.flicks;
        const key = Math.round(act.t0 * 1000) | 0;
        const draw = (k) => hash01(this.seed ^ key, k);
        const end = act.t0 + act.run;
        let k = 0;
        let at = act.t0 + 0.4 + 1.6 * draw(k++);
        if ((act.alarm || 0) > 0.25) {
            at = act.t0 + 0.2 + 0.2 * draw(k++);
            const burst = 2 + Math.floor(2 * draw(k++));
            for (let i = 0; i < burst && at < end; i++) {
                act.flicks.push({ at, strength: 1 });
                at += 0.4 + 0.18 * draw(k++);
            }
            at += 1.5 + 3 * draw(k++);
        }
        while (at < end - 0.2) {
            act.flicks.push({ at, strength: 0.55 + 0.35 * draw(k++) });
            at += 3.2 + 6.5 * draw(k++);
        }
        return act.flicks;
    }

    /** The latest flick under way at `time` (it runs on into the next act): its age and strength. */
    flickAt(time, out) {
        out.flick = -1;
        out.flickStrength = 0;
        if (!out.visible) return out;
        for (const act of [this.act, ...this.recent]) {
            if (!act || act.t0 > time) continue;
            if (time - act.t1 > FLICK_LENGTH) break;
            let best = null;
            for (const flick of this.flicksOf(act)) {
                if (flick.at <= time && flick.at < act.t1 && (!best || flick.at > best.at)) best = flick;
            }
            if (best && time - best.at < FLICK_LENGTH) {
                out.flick = time - best.at;
                out.flickStrength = best.strength * (this.motion < 1 ? 0.5 : 1);
                break;
            }
        }
        return out;
    }

    /** For tests and diagnostics: the acts planned so far (current first). */
    get planned() {
        return [this.act, ...this.queue].filter(Boolean).map((act) => ({
            kind: act.kind, clip: act.clip, t0: act.t0, t1: act.t1, on: act.from.on,
        }));
    }
}

export function createSquirrelPose() {
    return {
        visible: false,
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        surface: [0, 0, 0],
        normal: [0, 1, 0],
        lift: 0,
        clips: [],
        acorn: false,
        look: 0,
        attention: SQUIRREL_ATTENTION,
        act: '',
        clip: '',
        /** The tail's follow-through, per bone root to brush (see SquirrelMind.followThrough). */
        tailTurn: [0, 0, 0, 0, 0, 0, 0],
        tailSurge: [0, 0, 0, 0, 0, 0, 0],
        /** Seconds into a tail flick (-1: none), and how big it is. */
        flick: -1,
        flickStrength: 0,
    };
}
