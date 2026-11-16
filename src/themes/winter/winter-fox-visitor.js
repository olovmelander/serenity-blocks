/**
 * Winter — the visitor: a second arctic fox, of the other coat, with its own mind and seed.
 * Three-free and renderer-free.
 *
 * It is the same animal as the fox on its round (winter-fox-life.js is the life they share) on
 * another way: a lane across the back of the snowfield that leaves the frame at both ends and
 * comes round behind the viewer, where it waits a while out of sight. So over a night one sees
 * one fox, then two, then one. It keeps off the fox: with the fox in its way it pulls up short,
 * makes a stop of the wait, and turns back if it is kept waiting.
 */

import { bearingFor, groundHeight, landDistance } from './winter-core.js';
import { VISITOR_RIG } from './winter-fox-rig.js';
import {
    ArcticFoxMind, FOX_TROT, FOX_WANDER, FOX_WANDER_STOPS, arcticPaces, treesFor, withLoops,
} from './winter-fox-life.js';
import { foxCourse } from '../shared/fox-mind.js';
import { foxWalk, wanderingCourse } from '../shared/fox-wander.js';

/**
 * The visitor's way: [fraction of the half width, metres from the eye]. A lane across the back of
 * the snowfield, behind the fox's round and in front of the small trees by the shore, that runs
 * out of the frame at both ends (a fraction past 1 is out of sight) and closes behind the viewer,
 * where nobody sees it. Laid out in fractions like everything else, so an upright screen keeps it.
 */
export const VISITOR_WAY = Object.freeze([
    [-1.6, 23.5], [-1.24, 22.4], [-0.98, 21.6], [-0.74, 21.3], [-0.5, 20.9], [-0.38, 21.1], [-0.22, 23.2], [0, 24.6],
    [0.24, 24.2], [0.46, 21.7], [0.62, 19.5], [0.84, 19.9], [1.04, 23], [1.3, 24.8], [1.7, 25.5],
]);
/** Where along it (indices into VISITOR_WAY) it likes to stop: in the open, left and right of the board. */
const VISITOR_STATIONS = Object.freeze([3, 10]);

/** How the visitor wanders: as the fox does, further back; it stops less and turns back less. */
export const VISITOR_WANDER = Object.freeze({
    ...FOX_WANDER,
    stray: 0.7,
    treeRoom: 2.2,
    rest: Object.freeze([5, 22]),
    anywhere: 0.5,
    turnBack: 0.22,
    turnGap: 40,
    open: Object.freeze([0.3, 0.9]),
    reach: 22,
});

/**
 * How the visitor keeps off the fox: how wide a way it wants clear ahead of it (m either side),
 * how far short of the fox it stops (m), how long it waits there before it turns back (s), and
 * what it does when it has pulled up before the fox (one of these, turn about).
 */
export const VISITOR_MEET = Object.freeze({
    wide: 1.7,
    room: 2.8,
    wait: 9,
    stops: Object.freeze([Object.freeze(['PlayBow']), Object.freeze(['Sit']), Object.freeze(['LookAround'])]),
});

/** Seconds the visitor stays away behind the viewer before it comes round again (shortest, longest). */
export const VISITOR_AWAY = Object.freeze([6, 60]);

/**
 * The visitor's way as a closed course for an aspect: the lane across the frame as a smooth line,
 * then round behind the viewer and back to its start. Sampled evenly by distance, like the fox's
 * round. `gate` is the distance along it of the place behind the viewer where it waits.
 */
export function visitorWay(aspect, count = 384) {
    const lane = VISITOR_WAY.map(([fraction, dist]) => {
        const az = Math.sign(fraction) * Math.min(Math.abs(bearingFor(fraction, aspect)), 1.25);
        return [Math.sin(az) * dist, -Math.cos(az) * dist];
    });
    // Behind the viewer: out past the frame's edge, back alongside, across behind, and in again.
    const [lx, lz] = lane[0];
    const [rx, rz] = lane[lane.length - 1];
    const out = Math.max(Math.abs(lx), Math.abs(rx)) + 6;
    const knots = [...lane, [out, rz * 0.5], [out * 0.8, 9], [0, 14], [-out * 0.8, 9], [-out, lz * 0.5]];
    const n = knots.length;
    const fine = n * 24;
    const raw = new Float32Array((fine + 1) * 2);
    const cumulative = new Float32Array(fine + 1);
    for (let i = 0; i <= fine; i++) {
        const f = (i / fine) * n;
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
            const step = Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]);
            cumulative[i] = cumulative[i - 1] + step;
        }
    }
    const length = cumulative[fine];
    const points = new Float32Array(count * 3);
    let j = 0;
    for (let i = 0; i < count; i++) {
        const d = (i / count) * length;
        while (j < fine - 1 && cumulative[j + 1] < d) j += 1;
        const span = Math.max(1e-6, cumulative[j + 1] - cumulative[j]);
        const t = (d - cumulative[j]) / span;
        points[i * 3] = raw[j * 2] + (raw[j * 2 + 2] - raw[j * 2]) * t;
        points[i * 3 + 1] = raw[j * 2 + 1] + (raw[j * 2 + 3] - raw[j * 2 + 1]) * t;
    }
    for (let i = 0; i < count; i++) {
        const a = ((i + count - 1) % count) * 3;
        const b = ((i + 1) % count) * 3;
        points[i * 3 + 2] = Math.atan2(points[b] - points[a], points[b + 1] - points[a + 1]);
    }
    return {
        points,
        length,
        count,
        stations: VISITOR_STATIONS.map((k) => cumulative[k * 24]),
        gate: cumulative[(lane.length + 2) * 24],
    };
}

/** Where the visitor may stray and stop: clear of the trees, on the snow, in sight when it stops. */
function visitorPlan(aspect, way) {
    const trees = treesFor(aspect);
    const across = Math.tan(bearingFor(1, aspect));
    const clearance = (x, z) => trees.reduce((m, [tx, tz]) => Math.min(m, Math.hypot(tx - x, tz - z)), Infinity);
    const fractionOf = (x, z) => (z < 0 ? Math.abs(x / -z) / across : Infinity);
    const [near, far] = VISITOR_WANDER.open;
    return {
        reach: VISITOR_WANDER.stray,
        allowed: (i, x, z, sx, sz) => clearance(sx, sz) >= Math.min(VISITOR_WANDER.treeRoom, clearance(x, z))
            && landDistance(sx, sz) >= Math.min(4, landDistance(x, z)),
        open: (i, x, z) => {
            const fraction = fractionOf(x, z);
            return fraction >= near && fraction <= far;
        },
        // (It does not tear round in circles out there: the trees stand close.)
        roam: null,
        centre: [0, -12],
        way,
    };
}

/** What the visitor does when it stops: the fox's stops without those that need room or go far. */
export const VISITOR_STOPS = Object.freeze(FOX_WANDER_STOPS.filter(([acts, , sways]) => sways.then !== 'zoom'
    && !acts.includes('Pounce')));

/**
 * The visitor: a second arctic fox with its own mind and seed, on its own way at the back of the
 * snowfield. It crosses the frame, stopping as the fox does, leaves at the far edge, comes round
 * behind the viewer — waiting there a while, out of sight — and crosses again. `present` says
 * whether it is anywhere it could be seen.
 */
export class VisitorMind extends ArcticFoxMind {
    /**
     * @param {number} [aspect]
     * @param {number} [seed]
     */
    constructor(aspect = 16 / 9, seed = 0xb1ce) {
        const way = visitorWay(aspect);
        const plan = visitorPlan(aspect, way);
        const base = VisitorMind.baseOf(way);
        const walk = withLoops(foxWalk(base, plan));
        super({
            rig: VISITOR_RIG,
            course: wanderingCourse(base, walk, { height: groundHeight, viewer: [0, 0] }),
            seed,
            start: way.gate,
            firstStop: 30,
            // (Its prints would take the fox's from the snow: the visitor leaves none.)
            paces: arcticPaces(VISITOR_RIG, { pawPrints: 0, room: VISITOR_MEET.room }),
        }, { ...VISITOR_WANDER, walk, stops: VISITOR_STOPS }, plan);
        this.way = way;
        this.aspect = aspect;
        this.reset(0);
    }

    static baseOf(way) {
        return foxCourse({
            points: way.points, count: way.count, length: way.length, stations: way.stations, height: groundHeight,
        });
    }

    reset(time = 0) {
        /** Until when it waits behind the viewer, and whether it is waiting. */
        this.awayUntil = time;
        this.away = false;
        this.awayRand = null;
        this._gateLap = undefined;
        /** Since when the fox has been in its way, how many times it has met it, and until when it pays it no mind. */
        this.blockedSince = null;
        this.meetings = 0;
        this.heedFrom = time;
        super.reset(time);
        if (this.way) {
            this.awayRand = this.wanderRand;
            // It begins behind the viewer, and is a while coming.
            this.away = true;
            this.awayUntil = time + this.firstAway;
        }
    }

    /** Seconds after a reset before it sets out from behind the viewer. */
    get firstAway() {
        return this._firstAway ?? 6;
    }

    set firstAway(seconds) {
        this._firstAway = Math.max(0, seconds);
    }

    /** Whether it is anywhere it could be seen: ahead of the viewer, not far outside the frame. */
    get present() {
        const { x, z } = this.pose;
        if (!(z < -3)) return false;
        return Math.abs(x / -z) / Math.tan(bearingFor(1, this.aspect)) < 1.45;
    }

    /**
     * The fox on its round is at (x, z): the visitor keeps off it. It slows for a fox in its way
     * ahead, pulls up short of it and makes a stop of the wait — a bow, a look, a sit; kept
     * waiting, it turns round and goes back the way it came. Call before each step while the
     * visitor is in sight (with no fox to mind, `clearWay()`).
     * @returns {boolean} whether the fox is in its way
     */
    keepOff(x, z, time) {
        const { pose } = this;
        const sin = Math.sin(pose.heading);
        const cos = Math.cos(pose.heading);
        const along = (x - pose.x) * sin + (z - pose.z) * cos;
        const across = Math.abs((x - pose.x) * cos - (z - pose.z) * sin);
        const inWay = time >= this.heedFrom && along > 0 && along < 9 && across < VISITOR_MEET.wide;
        if (!inWay) {
            this.clearWay();
            return false;
        }
        this.ahead = along;
        this.aheadSpeed = 0;
        if (along < VISITOR_MEET.room + 1) {
            if (this.blockedSince === null) {
                this.blockedSince = time;
                // (What it pulls up to do before the fox: turn about, so two meetings differ.)
                if (this.mode === 'gait') this.forced = VISITOR_MEET.stops[this.meetings % VISITOR_MEET.stops.length];
                this.meetings += 1;
            } else if (time - this.blockedSince > VISITOR_MEET.wait && this.mode === 'gait') {
                this.turnHere(time);
                this.heedFrom = time + 15;
                this.clearWay();
            }
        }
        return true;
    }

    /** Nothing is in its way. */
    clearWay() {
        this.ahead = Infinity;
        this.aheadSpeed = 0;
        this.blockedSince = null;
    }

    /** Out of sight it does not dawdle: it lopes round behind the viewer. */
    trotAt(time) {
        return this.present ? super.trotAt(time) : 3.2;
    }

    /** The frame changed shape: its way is laid out anew, its place along it kept. */
    setAspect(aspect) {
        if (aspect === this.aspect) return;
        this.aspect = aspect;
        this.way = visitorWay(aspect);
        const plan = visitorPlan(aspect, this.way);
        const base = VisitorMind.baseOf(this.way);
        this.start = this.way.gate;
        this.setBase(base, plan, wanderingCourse(base, this.walk, { height: groundHeight, viewer: [0, 0] }));
    }

    /** Put it on its way across the frame as if it had set out `seconds` ago (captures). */
    arrive(time, seconds = 0) {
        this.away = false;
        this.awayUntil = time;
        this.s = this.way.length + FOX_TROT * Math.max(0, seconds) + 2;
        this.nextStop = time + 4;
    }

    step(dt, time, env) {
        if (dt > 0) {
            if (this.away) {
                if (time < this.awayUntil) {
                    // (Behind the viewer it stands and waits: nothing of it is stepped.)
                    this.events.length = 0;
                    return;
                }
                this.away = false;
                this.nextStop = time + 6;
            } else if (this.mode === 'gait' && this.passedGate()) {
                const [least, most] = VISITOR_AWAY;
                this.away = true;
                this.awayUntil = time + least + (most - least) * this.awayRand() ** 1.5;
                this.speed = 0;
                this.events.length = 0;
                return;
            }
        }
        super.step(dt, time, env);
    }

    /** Whether it has just come to the place behind the viewer where it waits. */
    passedGate() {
        const { length, gate } = this.way;
        const [q] = this.walk.along(this.s);
        const lap = Math.floor((q - gate) / length);
        const before = this._gateLap;
        this._gateLap = lap;
        return before !== undefined && lap !== before;
    }
}
