/**
 * Winter — where the polar bear goes, and when. Three-free and renderer-free: its body
 * (winter-bear-rig.js) solves the pose this resolves and the model (winter-bear.js) draws it.
 *
 * A polar bear walks the frozen lake beyond the snowfield, fifty to a hundred and twenty metres
 * out: it comes in from behind the trees on the left, ambles along past the open ice either side
 * of the board, stops to lift its nose into the wind, looks about, turns in a slow arc and walks
 * back further out, wanders off to the right behind the far spit and, long after, comes back from
 * the left. Its course is a closed curve over the ice laid out in fractions of the frame's half
 * width (as the fox's round is), so a narrow or upright screen sees the same walk drawn closer
 * together; its walk along it is a timeline of legs and stops, so where it is and what it is doing
 * are a function of its clock and nothing else: a seek, a replay or a capture shows the same frame
 * at any frame rate.
 *
 * The board can make it stop. Four lines and the fox of light: it stands up on its hind legs to
 * watch it go. The run ends: it lies down on the ice, head on its paws, until the next run begins,
 * then gets up and walks on. Each is laid over whatever it was doing, and its clock slows to a halt
 * under it and picks up again after, so nothing jumps and the walk resumes where it left off.
 */

import {
    TAU, bearingFor, clamp01, groundHeight, smooth,
} from './winter-core.js';
import { BEAR_ACTS, LIE_HOLD, bearStride } from './winter-bear-rig.js';

const SNIFF = Object.freeze(['Sniff', 7.2]);
const SCENT = Object.freeze(['Scent', 5.4]);
const LOOK = Object.freeze(['Look', 5.6]);
const PAUSE = Object.freeze(['Stand', 2.4]);
const knot = (fraction, dist, stop = null) => Object.freeze([fraction, dist, stop]);

/**
 * Its course: [fraction of the half width, metres from the eye, what it does when it gets there
 * ([act, seconds], or null to walk on)]. A closed loop, walked in this order.
 *
 * Where the game lets the lake be seen decides it. The card stands over the middle of the ice; on
 * its left a group of small snow-loaded spruces stands on the snowfield right in front of the ice;
 * on its right the HUD stands high in the sky and the ice is open from the card's edge to the
 * spruces under the moon (about 0.2 to 0.45 of the half width). That window is where the bear
 * comes to: it walks in from behind the trees on the right, noses about, stops to sniff and to look
 * round, and goes off behind the board; it comes back at another depth, near or far, and once in a
 * while wanders far out over the lake and returns.
 */
export const BEAR_ROUTE = Object.freeze([
    // In from behind the trees on the right: it noses about in the window, nearer and nearer...
    knot(0.85, 70),
    knot(0.55, 63),
    knot(0.37, 58, SNIFF),
    knot(0.28, 52),
    knot(0.34, 46, SCENT),
    // ...and goes off behind the board along the near ice, round behind the spruces on the left...
    knot(0.15, 43),
    knot(-0.2, 45),
    knot(-0.48, 52),
    knot(-0.52, 64),
    knot(-0.25, 72),
    // ...and back across, further out: it stops in the window to look round, turns toward the
    // viewer and back, and sets off into the distance...
    knot(0.12, 74),
    knot(0.3, 72, LOOK),
    knot(0.43, 66),
    knot(0.39, 58, PAUSE),
    knot(0.25, 62),
    knot(0.22, 76),
    knot(0.3, 90, SNIFF),
    knot(0.42, 104),
    // ...far out over the lake, small in the distance, round, and back in to the right-hand trees.
    knot(0.2, 122),
    knot(-0.25, 130),
    knot(-0.5, 118),
    knot(-0.3, 100),
    knot(0.05, 92),
    knot(0.32, 86, SCENT),
    knot(0.62, 84),
    knot(0.95, 80),
]);

/** Metres a second it ambles at (it is drawn larger than life: its strides are too). */
export const BEAR_PACE = 1.2;
/** Seconds it takes to get going, or to come to a stop. */
export const BEAR_RAMP = 1.8;
/** Seconds a stop takes to cross-fade in (or a walk out of one). */
export const BEAR_BLEND = 0.9;
/** Seconds the board's stops take to bring it to a halt, and to let it go again. */
export const BEAR_EASE = 1.2;
/** Where on its clock it starts (seconds): just short of coming out from behind the trees. */
const START_KNOT = 1;
const START_LEAD = 6;

/** ∫₀ˣ smoothstep: how far a ramp from rest to full pace has carried it, in units of pace × ramp. */
const rampArea = (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return x - 0.5;
    return x * x * x - (x * x * x * x) / 2;
};

/**
 * Its course for an aspect: the route as a closed Catmull-Rom curve over the ice, sampled evenly
 * by distance, and its timeline of legs and stops.
 * @returns {{ points: Float32Array, count: number, length: number, stride: number, period: number,
 *             segments: object[], knots: number[], start: number }}
 */
export function bearCourse(aspect, { count = 1024, route = BEAR_ROUTE } = {}) {
    const knots = route.map(([fraction, dist]) => {
        const az = bearingFor(fraction, aspect);
        return [Math.sin(az) * dist, -Math.cos(az) * dist];
    });
    const n = knots.length;
    const fine = 24;
    const total = n * fine;
    const raw = new Float64Array((total + 1) * 2);
    const cumulative = new Float64Array(total + 1);
    for (let i = 0; i <= total; i++) {
        const f = (i / total) * n;
        const k = Math.floor(f) % n;
        const t = f - Math.floor(f);
        const p0 = knots[(k + n - 1) % n];
        const p1 = knots[k];
        const p2 = knots[(k + 1) % n];
        const p3 = knots[(k + 2) % n];
        for (let c = 0; c < 2; c++) {
            raw[i * 2 + c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t
                + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t
                + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t * t * t);
        }
        if (i > 0) {
            const dx = raw[i * 2] - raw[i * 2 - 2];
            const dz = raw[i * 2 + 1] - raw[i * 2 - 1];
            cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dz);
        }
    }
    const length = cumulative[total];
    const points = new Float32Array(count * 3);
    let j = 0;
    for (let i = 0; i < count; i++) {
        const d = (i / count) * length;
        while (j < total - 1 && cumulative[j + 1] < d) j += 1;
        const span = Math.max(1e-9, cumulative[j + 1] - cumulative[j]);
        const t = (d - cumulative[j]) / span;
        points[i * 3] = raw[j * 2] + (raw[j * 2 + 2] - raw[j * 2]) * t;
        points[i * 3 + 1] = raw[j * 2 + 1] + (raw[j * 2 + 3] - raw[j * 2 + 1]) * t;
    }
    for (let i = 0; i < count; i++) {
        const a = ((i + count - 1) % count) * 3;
        const b = ((i + 1) % count) * 3;
        points[i * 3 + 2] = Math.atan2(points[b] - points[a], points[b + 1] - points[a + 1]);
    }
    const knotAt = route.map((_, k) => cumulative[k * fine]);
    // One stride for the whole loop, a whole number of them to a lap: its gait comes round with it.
    const stride = length / Math.max(1, Math.round(length / bearStride(BEAR_PACE)));

    // The timeline: a leg from each stop to the next, then that stop.
    const stops = route.map((entry, k) => ({ k, at: knotAt[k], act: entry[2] })).filter((s) => s.act);
    if (!stops.length) throw new Error('the bear\'s route needs a stop');
    const segments = [];
    let time = 0;
    let walked = 0;
    for (let i = 0; i < stops.length; i++) {
        const from = stops[i];
        const to = stops[(i + 1) % stops.length];
        const leg = (((to.at - from.at) % length) + length) % length || length;
        const ramp = Math.min(BEAR_RAMP, leg / BEAR_PACE);
        const duration = leg / BEAR_PACE + ramp;
        segments.push({
            kind: 'walk', start: time, duration, from: from.at, length: leg, ramp, walked, after: from.act,
        });
        time += duration;
        walked += leg;
        segments.push({
            kind: 'stop', start: time, duration: to.act[1], at: to.at, act: to.act[0], walked,
        });
        time += to.act[1];
    }
    // The segment list starts at the first stop's leg out; its clock starts just short of where it
    // comes out from behind the trees.
    const startAt = knotAt[START_KNOT];
    let start = 0;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.kind !== 'walk') continue;
        const into = (((startAt - s.from) % length) + length) % length;
        if (into <= s.length) {
            start = s.start + s.ramp + (into - (BEAR_PACE * s.ramp) / 2) / BEAR_PACE - START_LEAD;
            break;
        }
    }
    return {
        points, count, length, stride, period: time, segments, knots: knotAt, start,
    };
}

/** A place `distance` metres along the course: (x, z, heading). */
export function bearPlace(course, distance, out = [0, 0, 0]) {
    const { points, length, count } = course;
    const f = ((((distance % length) + length) % length) / length) * count;
    const i = Math.floor(f) % count;
    const k = (i + 1) % count;
    const t = f - Math.floor(f);
    out[0] = points[i * 3] + (points[k * 3] - points[i * 3]) * t;
    out[1] = points[i * 3 + 1] + (points[k * 3 + 1] - points[i * 3 + 1]) * t;
    let dh = points[k * 3 + 2] - points[i * 3 + 2];
    if (dh > Math.PI) dh -= TAU;
    if (dh < -Math.PI) dh += TAU;
    out[2] = points[i * 3 + 2] + dh * t;
    return out;
}

const PLACE = [0, 0, 0];

/**
 * Where its course has it at a moment of its own clock: place, heading, pace, how far it has
 * walked (its gait's phase) and what it is doing.
 * @param {object} course  bearCourse()
 * @param {number} clock   seconds
 * @param {object} out     filled in: x, z, heading, speed, phase, act, actTime, from, fromTime, blend
 */
export function bearOnCourse(course, clock, out) {
    const { segments, period } = course;
    const c = (((clock % period) + period) % period);
    let s = segments[segments.length - 1];
    for (let i = 0; i < segments.length; i++) {
        if (c < segments[i].start + segments[i].duration) {
            s = segments[i];
            break;
        }
    }
    const tau = c - s.start;
    let walked;
    let distance;
    if (s.kind === 'walk') {
        const { ramp, duration } = s;
        // Getting going, at pace, coming to a stop: closed form.
        let along;
        let speed;
        if (tau < ramp) {
            along = BEAR_PACE * ramp * rampArea(tau / ramp);
            speed = BEAR_PACE * smooth(0, 1, tau / ramp);
        } else if (tau > duration - ramp) {
            along = s.length - BEAR_PACE * ramp * rampArea((duration - tau) / ramp);
            speed = BEAR_PACE * smooth(0, 1, (duration - tau) / ramp);
        } else {
            along = (BEAR_PACE * ramp) / 2 + BEAR_PACE * (tau - ramp);
            speed = BEAR_PACE;
        }
        walked = s.walked + along;
        distance = s.from + along;
        out.speed = speed;
        out.act = 'Walk';
        out.actTime = tau;
        // (Out of a stop, the walk takes over from it.)
        out.from = s.after?.[0] ?? 'Walk';
        out.fromTime = s.after?.[1] ?? 0;
        out.blend = smooth(0, BEAR_BLEND, tau);
    } else {
        ({ walked } = s);
        distance = s.at;
        out.speed = 0;
        out.act = s.act;
        out.actTime = tau;
        out.from = 'Walk';
        out.fromTime = 0;
        out.blend = smooth(0, BEAR_BLEND, tau);
    }
    bearPlace(course, distance, PLACE);
    out.x = PLACE[0];
    out.z = PLACE[1];
    out.heading = PLACE[2];
    out.distance = distance;
    out.phase = walked / course.stride;
    return out;
}

/** How long a stop the board makes it take holds it (seconds): the length of `Rear`. */
const REAR_FOR = BEAR_ACTS.Rear;

/**
 * The bear's mind: its clock, what the board has made it do, and the pose that results.
 */
export class BearMind {
    /**
     * @param {number} [aspect]
     * @param {object} [o]
     * @param {number} [o.start]  where on its clock it starts (seconds; the course's own when not given)
     */
    constructor(aspect = 16 / 9, { start } = {}) {
        this.course = bearCourse(aspect);
        this.aspect = aspect;
        this.startAt = start;
        this.pose = {
            x: 0,
            y: 0,
            z: -60,
            heading: 0,
            speed: 0,
            phase: 0,
            act: 'Stand',
            actTime: 0,
            from: 'Stand',
            fromTime: 0,
            blend: 1,
            over: null,
            overTime: 0,
            overBlend: 0,
            lookYaw: 0,
            lookPitch: 0,
            breath: 0,
            distance: 0,
            clip: 'Stand',
        };
        this.reset(0);
    }

    /** Fit the course to another aspect, keeping how far round it the bear is. */
    setAspect(aspect, time = this.time) {
        if (aspect === this.aspect) return;
        const round = (clock, period) => ((clock % period) + period) % period;
        const where = round(this.clockAt(time), this.course.period) / this.course.period;
        this.course = bearCourse(aspect);
        this.aspect = aspect;
        this.offset += where * this.course.period - round(this.clockAt(time), this.course.period);
    }

    /**
     * Nothing the board made it do in flight: where it is is the world clock's alone again (a seek
     * to any time shows it where a world that ran from the start would have it).
     */
    reset(time = 0) {
        this.time = time;
        this.offset = this.startAt ?? this.course.start;
        this.held = 0;
        this.cut = null;
    }

    /** Its own clock at a world time: the world's, less every moment the board held it still. */
    clockAt(time) {
        return time + this.offset - this.held - this.lost(time);
    }

    /** How much of its clock the board's stop now in hand has held back (seconds). */
    lost(time) {
        const { cut } = this;
        if (!cut) return 0;
        const e = BEAR_EASE;
        const after = Number.isFinite(cut.end) ? e * rampArea((time - cut.end) / e) : 0;
        return e * rampArea((time - cut.start) / e) - after;
    }

    /** How nearly still the board holds it (0 walking its course .. 1 held). */
    holdAt(time) {
        const { cut } = this;
        if (!cut) return 0;
        return smooth(cut.start, cut.start + BEAR_EASE, time)
            - (Number.isFinite(cut.end) ? smooth(cut.end, cut.end + BEAR_EASE, time) : 0);
    }

    /** Start a stop the board makes, taking over from one still in hand. */
    hold(kind, time, end) {
        if (this.cut) {
            // (Whatever it was held for, it is still now: the new stop starts from stillness.)
            this.held += this.lost(time);
            const still = this.holdAt(time);
            this.cut = {
                kind, start: time - BEAR_EASE * still, end, from: time,
            };
            this.held -= this.lost(time);
        } else {
            this.cut = {
                kind, start: time, end, from: time,
            };
        }
    }

    /** Four lines: it stands up on its hind legs to watch the fox of light go over. */
    rear(time) {
        const { cut } = this;
        if (cut && (cut.kind === 'lie' || (cut.kind === 'rear' && time < cut.end - 1.5))) return false;
        this.hold('rear', time, time + REAR_FOR);
        return true;
    }

    /** The run is over: it lies down on the ice. */
    lie(time) {
        if (this.cut?.kind === 'lie' && !Number.isFinite(this.cut.end)) return false;
        this.hold('lie', time, Infinity);
        return true;
    }

    /** A new run: it gets up and walks on. */
    rise(time) {
        if (this.cut?.kind !== 'lie' || Number.isFinite(this.cut.end)) return false;
        this.cut.rise = time;
        this.cut.end = time + BEAR_ACTS.Rise;
        return true;
    }

    /** Where it is and what it is doing at a world time. */
    step(time) {
        this.time = time;
        const { cut } = this;
        if (cut && Number.isFinite(cut.end) && time > cut.end + BEAR_EASE) {
            this.held += cut.end - cut.start;
            this.cut = null;
        }
        const p = this.pose;
        bearOnCourse(this.course, this.clockAt(time), p);
        const still = this.holdAt(time);
        p.speed *= 1 - still;
        p.over = null;
        p.overBlend = 0;
        if (this.cut) {
            const c = this.cut;
            if (c.kind === 'rear') {
                p.over = 'Rear';
                p.overTime = time - c.from;
                p.overBlend = smooth(c.from, c.from + 0.6, time) * (1 - smooth(c.end - 0.5, c.end + 0.5, time));
            } else if (Number.isFinite(c.end) && c.rise !== undefined) {
                p.over = 'Rise';
                p.overTime = time - c.rise;
                p.overBlend = 1 - smooth(c.end - 0.4, c.end + 0.6, time);
            } else {
                p.over = 'Lie';
                p.overTime = Math.min(time - c.from, LIE_HOLD);
                p.overBlend = smooth(c.from, c.from + 0.8, time);
            }
        }
        p.clip = p.over && p.overBlend > 0.5 ? p.over : p.act;
        p.y = groundHeight(p.x, p.z);
        // It breathes: slow and deep, and deeper still once it has walked a while and stopped.
        const resting = p.act === 'Walk' ? 1 - p.blend : 1;
        p.breath = Math.sin(time * TAU * 0.28) * (0.4 + 0.6 * clamp01(resting + p.overBlend));
        return p;
    }
}
