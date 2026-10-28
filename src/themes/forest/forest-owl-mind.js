/**
 * Forest — what the eagle owl does: where it is, which way it looks, and every number its pose is made
 * of, from moment to moment.
 *
 * On a perch an owl is still, and its stillness is what makes it an owl: its eyes are fixed in its
 * skull, so it looks by turning its head, quickly, and then holds it there; it peers at what interests
 * it by bobbing and tilting its head; it blinks slowly, its ear tufts rise when it is alert and sink
 * when it dozes, and now and then it rouses (fluffs out and shakes its whole plumage), settles its
 * wings, or hoots, its white throat swelling.
 *
 * Every so often it goes out: down into the ferns after something it heard (a stoop, talons thrown
 * forward, a moment mantled over its catch, a labouring climb back to its limb), across to another
 * perch for a while, or, for four lines and a perfect clear, out along the ride and back across the
 * moon. A trip is a list of legs; each leg is a crouch and a lean off the perch, a flight planned
 * whole (forest-owl-flight.js) and a landing: the body raised upright, the wings thrown forward and
 * beating against the air, the tail fanned, the talons reaching, then the wings folded away. Between
 * perch and air every number is blended, never switched, so nothing jumps.
 *
 * Each of those is an act with a start and a length, and the pose is a closed-form function of the
 * acts in play, so a seek and a night lived through agree; the acts are dealt by the owl's own seeded
 * generator as they fall due. It only goes where the player can see it land (`setSight`).
 *
 * The game speaks to it through the reactions' owl cues (forest-reactions.js `owlCue`): a hard drop
 * startles it, a line clear draws its look, four lines and a perfect clear make it stare and then fly
 * out across the moon, a level-up sends it to another perch, the end of a run lets it doze.
 *
 * No three.js here: the theme, the playground and the tests share it.
 */

import {
    OWL_DRAWN_SCALE, OWL_POSTURE, OWL_ROOT_HEIGHT, createOwlPose, eulerOf, owlFlightBody, qAxis, qConj, qFromBasis,
    qMul, qRotate,
} from './forest-owl-rig.js';
import { planFlight, sampleFlight, wingbeat } from './forest-owl-flight.js';
import { FOREST_OWL_HOME, FOREST_OWL_PERCHES } from './forest-owl-perches.js';

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
/** Minimum jerk from 0 to 1: how a quick, sure movement eases out and in. */
const minJerk = (t) => {
    const u = clamp01(t);
    return u * u * u * (10 + u * (-15 + u * 6));
};
/** Up, hold, and down again over [0, 1], with soft ends. */
const bell = (t, rise = 0.25, fall = 0.3) => smooth(0, rise, t) * (1 - smooth(1 - fall, 1, t));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Where the body's centre stands over the perch (the root joint, drawn). */
const ROOT = OWL_ROOT_HEIGHT * OWL_DRAWN_SCALE;

/** How long its acts take and how often they come (seconds). */
export const OWL_TIMING = Object.freeze({
    look: [1.4, 5.5],
    snap: [0.24, 0.42],
    swivel: [0.9, 1.4],
    blink: [2.5, 9],
    blinkLength: 0.34,
    peer: [14, 34],
    peerLength: 1.7,
    tilt: [9, 26],
    rouse: [55, 120],
    rouseLength: 2.4,
    shuffle: [22, 48],
    shuffleLength: 0.9,
    hoot: [70, 150],
    hootLength: 2.1,
    /** Between outings, when nothing calls it. */
    outing: [38, 80],
    /** The crouch and lean before it drops off a perch, and the settling after it lands. */
    launch: 0.62,
    settle: 1.35,
    /** The landing's flare: the last seconds of a flight. */
    flare: 0.85,
    /** How long it stays on another perch, and mantled over a catch. */
    visit: [16, 34],
    mantle: [1.8, 2.8],
});

/** Places on the floor it may stoop to (x, z): open ground the player sees, clear of the card. */
export const OWL_GROUND = Object.freeze([
    Object.freeze({ x: -6.2, z: 0.6 }),
    Object.freeze({ x: -3.6, z: -0.8 }),
    Object.freeze({ x: -5.0, z: -1.5 }),
    Object.freeze({ x: 4.6, z: 2.2 }),
    Object.freeze({ x: 5.2, z: -4.5 }),
]);

/**
 * The flight out along the ride and back across the moon (world metres, body centre): out past the
 * young spruce, a climbing turn far out on the left, back toward the eye through the moon's disc
 * (from the eye it is 23 m off along the moon's line there), and down onto the limb from behind it.
 */
export const OWL_MOON_LOOP = Object.freeze([
    [-6.6, 4.1, -1.8],
    [-9.5, 6.4, -9.3],
    [-10.6, 8.8, -15.2],
    [-11.7, 10.0, -19.2],
    [-14.4, 10.5, -18.8],
    [-15.4, 10.8, -15.8],
    [-13.5, 10.8, -13.0],
    [-11.4, 10.2, -9.4],
    [-7.9, 9.0, -5.3],
    [-6.0, 7.6, -2.4],
    [-5.2, 6.2, 0.4],
    [-4.6, 5.3, 2.6],
]);

const between = (rng, [a, b]) => a + (b - a) * rng();

/** The kinds of act that each draw from a stream of their own. */
const STREAMS = Object.freeze(['gaze', 'blink', 'peer', 'tilt', 'rouse', 'shuffle', 'hoot', 'trips']);

/** A small seeded generator (mulberry32): one stream per kind of act. */
function stream(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Copy every number of a pose (not the body's turn: the attitude carries that). */
function snapshot(pose) {
    return {
        head: pose.head.slice(),
        neck: pose.neck,
        blink: pose.blink.slice(),
        tufts: pose.tufts,
        puff: pose.puff,
        ruffle: pose.ruffle,
        perch: pose.perch,
        lift: pose.lift.slice(),
        tail: { ...pose.tail },
        wings: pose.wings.map((w) => ({ ...w })),
        legs: pose.legs.map((l) => ({ ...l })),
    };
}

/** Mix every number of `pose` toward `from` by w (1 = all `from`). */
function blendPose(pose, from, w) {
    const m = (a, b) => a + (b - a) * w;
    for (let i = 0; i < 3; i += 1) pose.head[i] = m(pose.head[i], from.head[i]);
    for (let i = 0; i < 3; i += 1) pose.lift[i] = m(pose.lift[i], from.lift[i]);
    pose.neck = m(pose.neck, from.neck);
    pose.tufts = m(pose.tufts, from.tufts);
    pose.puff = m(pose.puff, from.puff);
    pose.ruffle = m(pose.ruffle, from.ruffle);
    pose.perch = m(pose.perch, from.perch);
    Object.keys(from.tail).forEach((k) => { pose.tail[k] = m(pose.tail[k], from.tail[k]); });
    pose.wings.forEach((wing, i) => Object.keys(from.wings[i]).forEach((k) => {
        wing[k] = m(wing[k], from.wings[i][k]);
    }));
    pose.legs.forEach((leg, i) => Object.keys(from.legs[i]).forEach((k) => { leg[k] = m(leg[k], from.legs[i][k]); }));
}

export class ForestOwlMind {
    /**
     * @param {object} o
     * @param {() => number} [o.rng]          the owl's own generator
     * @param {(x: number, z: number) => number} [o.groundHeight]
     * @param {object} [o.home]               the perch it lives on
     */
    constructor({ rng = Math.random, groundHeight = () => 0, home = FOREST_OWL_HOME } = {}) {
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.groundHeight = groundHeight;
        this.home = home;
        this.pose = createOwlPose();
        this.place = {
            x: home.x, y: home.y, z: home.z, heading: home.heading,
        };
        this.board = null;
        this.sight = null;
        this.sample = {};
        this.beat = { lift: 0, pitch: 0, tail: 0 };
        this.pupil = 1.6;
        // Each kind of act draws from a stream of its own, seeded once from the owl's generator: which acts
        // fall due in the same frame never changes what the others draw, so a seek and a night lived
        // through agree at any frame rate, and a reset begins the same life again.
        this.seeds = STREAMS.map(() => Math.floor(this.rng() * 0x7fffffff));
        this.reset();
    }

    reset() {
        this.streams = Object.fromEntries(STREAMS.map((name, i) => [name, stream(this.seeds[i])]));
        const {
            gaze, blink, peer, tilt, rouse, shuffle, hoot, trips,
        } = this.streams;
        this.time = 0;
        this.heard = 0;
        this.mode = 'perched';
        this.perch = this.home;
        this.trip = [];
        this.leg = null;
        this.flight = null;
        this.launchAt = -10;
        this.launchLength = OWL_TIMING.launch;
        this.tufts = 0.7;
        this.flightAt = -10;
        this.landedAt = -10;
        this.departAt = Infinity;
        this.nextOuting = between(trips, OWL_TIMING.outing);
        this.gaze = {
            from: [0, -6, 0], to: [0, -6, 0], start: 0, length: 0.3, next: 1 + gaze() * 2,
        };
        this.blinkAt = {
            start: -10, length: OWL_TIMING.blinkLength, wink: 0, next: between(blink, OWL_TIMING.blink),
        };
        this.peerAt = { start: -10, next: between(peer, OWL_TIMING.peer) };
        this.tiltAt = {
            start: -10, length: 1.6, roll: 0, next: between(tilt, OWL_TIMING.tilt),
        };
        this.rouseAt = { start: -10, next: between(rouse, OWL_TIMING.rouse) };
        this.shuffleAt = { start: -10, next: between(shuffle, OWL_TIMING.shuffle) };
        this.hootAt = { start: -10, next: between(hoot, OWL_TIMING.hoot) };
        this.alert = 0.3;
        this.drowsy = 0;
        this.quiet = 0;
        this.startleAt = -10;
        this.stareUntil = -10;
        this.fade = null;
        this.attitude = { heading: this.home.heading, pitch: OWL_POSTURE, bank: 0 };
        this.place.x = this.home.x;
        this.place.y = this.home.y;
        this.place.z = this.home.z;
        this.place.heading = this.home.heading;
    }

    /** Where the board is, as a world point (the theme passes it as the card moves); null if unknown. */
    setBoard(point) {
        this.board = point ? { x: point.x, y: point.y, z: point.z } : null;
    }

    /**
     * What the player can see: `sight(x, y, z, size)` says whether a thing `size` metres across at that
     * world point is on screen and clear of the card and the panels. Without it, everywhere is seen.
     */
    setSight(sight) {
        this.sight = typeof sight === 'function' ? sight : null;
    }

    seen(x, y, z, size = 0.8) {
        return this.sight ? this.sight(x, y, z, size) : true;
    }

    perchSeen(perch) {
        return this.seen(perch.x, perch.y + ROOT, perch.z, 0.9);
    }

    // -- looking ----------------------------------------------------------------------------
    /** The direction to a world point from the owl's head, as yaw and pitch relative to its body (degrees). */
    lookToward(point, out = [0, 0]) {
        const head = this.headPoint();
        const dx = point.x - head.x;
        const dy = point.y - head.y;
        const dz = point.z - head.z;
        const c = Math.cos(-this.place.heading);
        const s = Math.sin(-this.place.heading);
        const lx = dx * c + dz * s;
        const lz = -dx * s + dz * c;
        out[0] = Math.atan2(lx, lz) / DEG;
        out[1] = Math.atan2(dy, Math.hypot(lx, lz)) / DEG;
        return out;
    }

    headPoint() {
        return { x: this.place.x, y: this.place.y + 0.5 * OWL_DRAWN_SCALE, z: this.place.z };
    }

    turnHead(yaw, pitch, roll = 0, slow = false) {
        const g = this.gaze;
        const now = this.gazeNow();
        g.from = now;
        g.to = [Math.max(-165, Math.min(165, yaw)), Math.max(-55, Math.min(40, pitch)), roll];
        g.start = this.time;
        const turn = Math.abs(g.to[0] - now[0]) + Math.abs(g.to[1] - now[1]);
        const [a, b] = slow ? OWL_TIMING.swivel : OWL_TIMING.snap;
        // A sweep from one shoulder to the other is slower than a glance.
        g.length = a + (b - a) * clamp01(turn / 150) + Math.max(0, turn - 150) / 380;
    }

    gazeNow() {
        const g = this.gaze;
        const k = minJerk((this.time - g.start) / g.length);
        return [0, 1, 2].map((i) => g.from[i] + (g.to[i] - g.from[i]) * k);
    }

    chooseLook() {
        const rng = this.streams.gaze;
        const r = rng();
        const drowse = this.drowsy;
        if (this.board && r < 0.18 + this.alert * 0.3) {
            const [yaw, pitch] = this.lookToward(this.board);
            this.turnHead(yaw + (rng() - 0.5) * 10, pitch + (rng() - 0.5) * 6, (rng() - 0.5) * 8);
        } else if (r < 0.32) {
            const side = rng() < 0.5 ? -1 : 1;
            this.turnHead(side * (120 + rng() * 40), -4 + rng() * 10, side * (rng() * 6), true);
        } else if (r < 0.46) {
            this.turnHead((rng() - 0.5) * 90, -28 - rng() * 18, (rng() - 0.5) * 14);
        } else {
            this.turnHead((rng() - 0.5) * 150 * (1 - drowse * 0.5), -12 + rng() * 22 - drowse * 10, (rng() - 0.5) * 10);
        }
        this.gaze.next = this.time + this.gaze.length + between(rng, OWL_TIMING.look) * (1 + drowse * 1.5)
            * (1 - this.alert * 0.4);
    }

    // -- hearing ----------------------------------------------------------------------------
    hear(owl) {
        if (!owl || !owl.cues) return;
        if (owl.serial < this.heard) this.heard = 0; // the reactions started a new session
        const fresh = owl.cues.filter((cue) => cue.serial > this.heard).sort((a, b) => a.serial - b.serial);
        fresh.forEach((cue) => this.react(cue));
        this.heard = Math.max(this.heard, owl.serial);
    }

    react(cue) {
        const rng = this.streams.gaze;
        this.quiet = 0;
        this.drowsy = Math.max(0, this.drowsy - 0.5);
        const perched = this.mode === 'perched';
        const lookAtBoard = (spread = 8) => {
            if (!this.board || !perched) return;
            const [yaw, pitch] = this.lookToward(this.board);
            this.turnHead(yaw + (rng() - 0.5) * spread, pitch + (rng() - 0.5) * spread * 0.5, (rng() - 0.5) * 12);
        };
        switch (cue.kind) {
        case 'drop':
            this.alert = Math.min(1, this.alert + 0.4 + cue.strength * 0.3);
            this.startleAt = this.time;
            lookAtBoard(4);
            this.gaze.next = this.time + 1.2 + rng() * 1.5;
            break;
        case 'lock':
            this.alert = Math.min(1, this.alert + 0.04);
            if (rng() < 0.12) lookAtBoard(16);
            break;
        case 'clear':
        case 'spin':
        case 'combo':
            this.alert = Math.min(1, this.alert + 0.15 + (cue.lines || 1) * 0.06);
            if (rng() < 0.6 + (cue.lines || 1) * 0.1) {
                lookAtBoard(10);
                this.gaze.next = this.time + 1.5 + rng() * 2;
            }
            break;
        case 'quad':
        case 'perfect':
        case 'b2b':
            this.alert = 1;
            this.startleAt = this.time;
            lookAtBoard(3);
            this.stareUntil = this.time + 2.2;
            this.gaze.next = this.stareUntil + rng();
            // Then out along the ride and back across the moon, if it is home and nothing else is planned.
            if (cue.kind !== 'b2b' && perched && !this.trip.length) {
                const home = this.perch === this.home;
                if (home && this.perchSeen(this.home)) this.plan([{ style: 'moon', to: this.home }], 2.0);
                else if (this.perch !== this.home) this.plan([{ style: 'plain', to: this.home }], 1.2);
            }
            break;
        case 'level':
            this.alert = Math.min(1, this.alert + 0.3);
            if (perched && !this.trip.length) this.planVisit(0.9);
            else {
                this.rouseAt.start = this.time + 0.4;
                this.rouseAt.next = this.time + between(this.streams.rouse, OWL_TIMING.rouse);
            }
            break;
        case 'over':
            this.alert = 0.1;
            this.drowsy = 0.85;
            break;
        default:
            break;
        }
    }

    // -- going out --------------------------------------------------------------------------
    /** Set out on `legs` in `delay` seconds (it finishes looking, then goes). */
    plan(legs, delay = 0.6) {
        this.trip = legs.slice();
        this.departAt = this.time + delay;
    }

    /** Another perch the player can see (not the one it is on), or home. */
    planVisit(delay) {
        const rng = this.streams.trips;
        const away = FOREST_OWL_PERCHES.filter((p) => p !== this.perch && p !== this.home && this.perchSeen(p));
        if (this.perch !== this.home && (rng() < 0.55 || !away.length)) {
            this.plan([{ style: 'plain', to: this.home }], delay);
            return;
        }
        if (!away.length) return;
        const to = away[Math.floor(rng() * away.length) % away.length];
        this.plan([
            { style: 'plain', to, stay: between(rng, OWL_TIMING.visit) },
            { style: 'plain', to: this.home },
        ], delay);
    }

    /** A stoop into the ferns after something it heard there, and back up. */
    planHunt(delay) {
        const rng = this.streams.trips;
        // Within a short glide of the perch (it stays on its own side of the card), where the player sees it.
        const spots = OWL_GROUND.map((g) => ({ ...g, y: this.groundHeight(g.x, g.z) }))
            .filter((g) => {
                const d = Math.hypot(g.x - this.perch.x, g.z - this.perch.z);
                return d > 4.5 && d < 8 && this.seen(g.x, g.y + 0.3, g.z, 0.7);
            });
        if (!spots.length) return false;
        const spot = spots[Math.floor(rng() * spots.length) % spots.length];
        const from = this.perch;
        const ground = {
            id: 'ground',
            x: spot.x,
            y: spot.y,
            z: spot.z,
            kind: 'ground',
            radius: 0.05,
            heading: Math.atan2(spot.x - from.x, spot.z - from.z),
        };
        this.plan([
            { style: 'strike', to: ground, stay: between(rng, OWL_TIMING.mantle) },
            { style: 'climb', to: from },
        ], delay);
        // It hears it first: it stares down at the place, and peers.
        const [yaw, pitch] = this.lookToward({ x: spot.x, y: spot.y + 0.1, z: spot.z });
        this.turnHead(yaw, pitch, (rng() - 0.5) * 20);
        this.gaze.next = this.departAt + 1;
        this.peerAt.start = this.time + 0.4;
        return true;
    }

    /** An outing when nothing calls it: a hunt, a visit, now and then the moon. */
    planOuting() {
        const rng = this.streams.trips;
        const r = rng();
        if (this.perch !== this.home) this.planVisit(0.6);
        else if (r < 0.42) {
            if (!this.planHunt(2.4)) this.planVisit(0.6);
        } else if (r < 0.88) this.planVisit(0.6);
        else if (this.perchSeen(this.home)) this.plan([{ style: 'moon', to: this.home }], 0.8);
        this.nextOuting = this.time + between(rng, OWL_TIMING.outing);
    }

    /**
     * Send it out now (captures, the playground): 'moon' (out and back across the moon from home),
     * 'hunt' (a stoop into the ferns and back), 'visit' (to `perchId`, or one by chance), 'home'.
     * Returns whether it went.
     */
    send(kind, perchId = null) {
        if (this.mode !== 'perched') return false;
        const before = this.trip.length;
        if (kind === 'moon' && this.perch === this.home) this.plan([{ style: 'moon', to: this.home }], 0.3);
        else if (kind === 'hunt') this.planHunt(1.2);
        else if (kind === 'home' && this.perch !== this.home) this.plan([{ style: 'plain', to: this.home }], 0.3);
        else if (kind === 'visit') {
            const to = FOREST_OWL_PERCHES.find((p) => p.id === perchId && p !== this.perch);
            if (to) this.plan([{ style: 'plain', to, stay: 30 }, { style: 'plain', to: this.home }], 0.3);
            else this.planVisit(0.3);
        }
        if (this.trip.length > before || this.trip.length) this.nextOuting = Math.max(this.nextOuting, this.time + 60);
        return this.trip.length > 0;
    }

    /** The body-centre waypoints of a leg from `from` to `leg.to`. */
    route(from, leg) {
        const rng = this.streams.trips;
        const { to } = leg;
        const bodyAt = (p, lift = ROOT) => [p.x, p.y + lift, p.z];
        const S = from.kind === 'ground' ? bodyAt(from, 0.16) : bodyAt(from);
        const E = to.kind === 'ground' ? bodyAt(to, 0.16) : bodyAt(to);
        const flat = (v) => {
            const l = Math.hypot(v[0], v[2]) || 1;
            return [v[0] / l, 0, v[2] / l];
        };
        const facing = (p) => [Math.sin(p.heading), 0, Math.cos(p.heading)];
        const add = (p, d, k, dy = 0) => [p[0] + d[0] * k, p[1] + d[1] * k + dy, p[2] + d[2] * k];
        const toward = flat([E[0] - S[0], 0, E[2] - S[2]]);
        const dist = Math.hypot(E[0] - S[0], E[2] - S[2]);
        if (leg.style === 'moon') {
            const loop = OWL_MOON_LOOP.map((p) => [p[0] + (rng() - 0.5) * 0.8, p[1] + (rng() - 0.5) * 0.5,
                p[2] + (rng() - 0.5) * 0.8]);
            const L = add(S, flat([-0.25, 0, -1]), 1.0, -0.55);
            const appr = facing(to);
            return [S, L, ...loop, add(E, appr, -1.0, -0.2), E];
        }
        // Off the perch the way it faces when that is roughly the way it goes; otherwise it turns on the
        // perch first (the crouch turns it) and drops straight toward where it goes.
        const dotFacing = (p, d) => facing(p)[0] * d[0] + facing(p)[2] * d[2];
        const launchDir = flat(from.kind === 'ground' || dotFacing(from, toward) < 0.5 ? toward : [
            mix(facing(from)[0], toward[0], 0.75), 0, mix(facing(from)[2], toward[2], 0.75)]);
        const L = from.kind === 'ground' ? add(S, launchDir, 0.7, 0.35) : add(S, launchDir, 0.95, -0.5);
        let A2;
        let A3;
        if (leg.style === 'strike') {
            // A long falling glide, then the stoop: in steeply at the end, talons first.
            A3 = add(E, toward, -2.7, 1.05);
            A2 = add(E, toward, -0.95, 0.34);
        } else {
            // In low and up into the perch: travelling the way it will face when it comes from that side,
            // otherwise the way it comes (it turns on the perch as it settles). Never a U-turn at the end.
            const appr = dotFacing(to, toward) > 0.2
                ? flat([mix(toward[0], facing(to)[0], 0.6), 0, mix(toward[2], facing(to)[2], 0.6)]) : toward;
            // The swoop up is shallower where the perch stands low over the floor.
            const room = Math.max(0.1, E[1] - this.groundHeight(E[0] - appr[0] * 3.3, E[2] - appr[2] * 3.3) - 1.2);
            A3 = add(E, appr, -3.3, -Math.min(0.85, room));
            A2 = add(E, appr, -1.05, -Math.min(0.22, room * 0.3));
        }
        const mids = [];
        const count = dist > 22 ? 2 : 1;
        const side = flat([-toward[2], 0, toward[0]]);
        for (let k = 1; k <= count; k += 1) {
            const f = k / (count + 1);
            const dip = leg.style === 'climb' ? -0.4 : Math.min(2.4, dist * 0.09) * Math.sin(Math.PI * f);
            const sway = (rng() - 0.5) * Math.min(4, dist * 0.18);
            const m = [
                mix(L[0], A3[0], f) + side[0] * sway, mix(L[1], A3[1], f) - dip, mix(L[2], A3[2], f) + side[2] * sway,
            ];
            mids.push(m);
        }
        const points = [S, L, ...mids, A3, A2, E];
        // Never through the floor: everything but the stoop's end keeps a metre over the moss.
        return points.map((p, i) => {
            if (i === points.length - 1 || i === 0) return p;
            const stooping = leg.style === 'strike' && i >= points.length - 3;
            const floor = this.groundHeight(p[0], p[2]) + (stooping ? 0.35 : 1.1);
            return [p[0], Math.max(p[1], floor), p[2]];
        });
    }

    beginLaunch() {
        const leg = this.trip.shift();
        if (!leg) return;
        this.leg = leg;
        const points = this.route(this.perch, leg);
        this.flight = planFlight(points, {
            work: { climb: 0.8, moon: 0.25 }[leg.style] || 0,
            cruise: leg.style === 'moon' ? 5.6 : 6.4,
        });
        this.launchFrom = { ...this.attitude };
        const off = this.flight.tangent[2];
        this.launchHeading = Math.atan2(off[0], off[2]);
        // A bigger turn on the perch before it goes takes a little longer.
        const turn = Math.abs(wrapAngle(this.launchHeading - this.attitude.heading));
        this.launchLength = OWL_TIMING.launch + 0.5 * (turn / Math.PI);
        this.crossfade(0.2);
        this.mode = 'launch';
        this.launchAt = this.time;
    }

    beginFlight() {
        this.crossfade(0.32);
        this.mode = 'flight';
        this.flightAt = this.time;
        this.flightHead = this.pose.head.slice();
    }

    arrive() {
        const { leg } = this;
        this.crossfade(0.3);
        this.perch = leg.to;
        this.mode = 'perched';
        this.landedAt = this.time;
        this.landFrom = { ...this.attitude };
        this.landBeat = { ...this.sample };
        this.leg = null;
        this.flight = null;
        const stay = Number.isFinite(leg.stay) ? leg.stay : Infinity;
        this.departAt = this.trip.length ? this.time + stay : Infinity;
        if (!this.trip.length) {
            this.nextOuting = Math.max(this.nextOuting, this.time + between(this.streams.trips, OWL_TIMING.outing));
        }
        this.gaze.from = [0, -8, 0];
        this.gaze.to = [0, -8, 0];
        this.gaze.next = this.time + OWL_TIMING.settle + 0.4;
    }

    /** From now, for `length` seconds, every number of the pose eases over from what it is this moment. */
    crossfade(length) {
        this.fade = { from: snapshot(this.pose), start: this.time, length };
    }

    // -- the clock ---------------------------------------------------------------------------
    /**
     * Step `dt` seconds. `frame` is the reactions' frame (its `owl` cues are heard); `motion` 0..1 scales
     * the size of every movement, and below a half the owl stays home (reduced motion).
     */
    update(dt, frame = {}, { motion = 1 } = {}) {
        if (!Number.isFinite(dt) || dt < 0) return this;
        this.time += dt;
        this.step = dt;
        this.motion = motion;
        this.hear(frame.owl);
        const t = this.time;
        this.alert += (0.25 - this.alert) * (1 - Math.exp(-dt / 9));
        this.quiet += dt;
        if (this.quiet > 50) this.drowsy = Math.min(0.7, this.drowsy + dt * 0.01);
        else this.drowsy = Math.max(0, this.drowsy - dt * 0.004);
        if (this.mode === 'perched') {
            if (motion < 0.5) {
                this.trip = [];
                this.departAt = Infinity;
            }
            if (this.trip.length && t >= this.departAt) this.beginLaunch();
            else if (!this.trip.length && t >= this.nextOuting && motion >= 0.5) this.planOuting();
        }
        if (this.mode === 'launch' && t >= this.launchAt + this.launchLength) this.beginFlight();
        if (this.mode === 'flight' && t >= this.flightAt + this.flight.duration) this.arrive();
        // The perched acts fall due whatever it is doing (they only show on a perch); blinks always.
        if (this.mode === 'perched' && t >= this.gaze.next && t > this.stareUntil
            && t > this.landedAt + OWL_TIMING.settle) this.chooseLook();
        if (t >= this.blinkAt.next) {
            this.blinkAt.start = t;
            const { blink } = this.streams;
            this.blinkAt.length = OWL_TIMING.blinkLength * (1 + this.drowsy * 2.5) * (0.85 + blink() * 0.3);
            const wink = blink() < 0.5 ? -1 : 1;
            this.blinkAt.wink = blink() < 0.12 ? wink : 0;
            this.blinkAt.next = t + between(blink, OWL_TIMING.blink) * (1 + this.alert * 0.6);
        }
        const due = (act, range, rng) => {
            if (t >= act.next) {
                act.start = this.mode === 'perched' && t > this.landedAt + OWL_TIMING.settle ? t : -10;
                act.next = t + between(rng, range);
            }
        };
        due(this.peerAt, OWL_TIMING.peer, this.streams.peer);
        if (t >= this.tiltAt.next) {
            this.tiltAt.start = this.mode === 'perched' ? t : -10;
            const { tilt } = this.streams;
            this.tiltAt.length = 1.2 + tilt() * 1.6;
            this.tiltAt.roll = (tilt() < 0.5 ? -1 : 1) * (14 + tilt() * 14);
            this.tiltAt.next = t + between(tilt, OWL_TIMING.tilt);
        }
        due(this.rouseAt, OWL_TIMING.rouse, this.streams.rouse);
        due(this.shuffleAt, OWL_TIMING.shuffle, this.streams.shuffle);
        due(this.hootAt, OWL_TIMING.hoot, this.streams.hoot);
        this.compose(motion);
        return this;
    }

    // -- the pose -----------------------------------------------------------------------------
    compose(motion) {
        const { pose } = this;
        // Defaults every frame: folded, gripping, level.
        pose.lift[0] = 0;
        pose.lift[1] = 0;
        pose.lift[2] = 0;
        pose.neck = 0;
        pose.puff = 0;
        pose.tail.pitch = 0;
        pose.tail.yaw = 0;
        pose.tail.fan = 1;
        pose.wings.forEach((w) => Object.assign(w, {
            fold: 1, dihedral: 0, sweep: 0, twist: 0, flex: 0, handTwist: 0, tip: 0, fan: 1, load: 0, alula: 0,
        }));
        pose.legs.forEach((leg) => Object.assign(leg, {
            tuck: 0, reach: 0, grip: 1, spread: 0, lift: 0,
        }));
        if (this.mode === 'flight') this.composeFlight();
        else this.composePerched(motion);
        this.composeEyes();
        // The tufts rise and fall quickly, never in a frame.
        this.tufts += (pose.tufts - this.tufts) * (1 - Math.exp(-(this.step || 0) * 9));
        pose.tufts = this.tufts;
        if (this.fade) {
            const w = 1 - smooth(0, this.fade.length, this.time - this.fade.start);
            if (w > 0) blendPose(pose, this.fade.from, w);
            else this.fade = null;
        }
        // The body's attitude: model heading, root pitch and roll.
        const a = this.attitude;
        this.place.heading = a.heading;
        owlFlightBody(0, a.pitch, a.bank, pose.body);
        if (this.sway) qMul(pose.body, this.sway, pose.body);
    }

    composeEyes() {
        const { pose, time: t } = this;
        const b = this.blinkAt;
        const ba = (t - b.start) / b.length;
        const blink = ba >= 0 && ba <= 1 ? Math.sin(Math.PI * ba) ** 0.7 : 0;
        // The upper lids ride a little low at rest (the eagle owl's hooded stare), lower as it dozes,
        // up when it is startled.
        const lids = (0.14 * (1 - this.alert * 0.6) + this.drowsy * 0.55 * (1 - this.alert))
            * (this.mode === 'perched' ? 1 : 0.5);
        pose.blink[0] = Math.min(1, lids + blink * (b.wink === 1 ? 0.35 : 1));
        pose.blink[1] = Math.min(1, lids + blink * (b.wink === -1 ? 0.35 : 1));
        this.pupil = 1.65 - this.alert * 0.35 + this.drowsy * 0.1 - (this.mode === 'flight' ? 0.15 : 0);
    }

    composePerched(motion) {
        const { pose, time: t } = this;
        const p = this.perch;
        const ground = p.kind === 'ground';
        pose.perch = p.radius || 0.045;
        const landed = t - this.landedAt;
        const settling = landed < OWL_TIMING.settle ? 1 - smooth(0, OWL_TIMING.settle, landed) : 0;
        const launching = this.mode === 'launch' ? clamp01((t - this.launchAt) / this.launchLength) : 0;
        // The head: the current turn, a tilt now and then, the peering bob, the startle's snap.
        const gaze = this.gazeNow();
        const tilt = this.tiltAt;
        const tilting = bell((t - tilt.start) / tilt.length, 0.18, 0.3);
        const peerAge = (t - this.peerAt.start) / OWL_TIMING.peerLength;
        const peering = peerAge >= 0 && peerAge <= 1 ? bell(peerAge, 0.2, 0.3) : 0;
        const bob = Math.sin((t - this.peerAt.start) * 2 * Math.PI * 1.55);
        const startle = t >= this.startleAt ? Math.exp(-(t - this.startleAt) * 3) : 0;
        const rouse = this.rouseState(t);
        const hoot = ground ? { puff: 0, lean: 0 } : this.hootState(t);
        const quietBody = 1 - Math.max(settling, launching);
        const head = [
            gaze[0] + (bob * 9 * peering * motion + rouse.shake * 6) * quietBody,
            gaze[1] + (Math.abs(bob) * 4 * peering * motion + startle * 6) * quietBody,
            gaze[2] + (tilt.roll * tilting * motion + bob * 7 * peering * motion + rouse.shake * 9) * quietBody,
        ];
        pose.neck = (peering * 0.012 * (0.5 + 0.5 * Math.sin((t - this.peerAt.start) * 5.1)) + startle * 0.014
            + rouse.ruffle * 0.004) * quietBody;
        pose.tufts = clamp01(0.55 + this.alert * 0.45 - this.drowsy * 0.35 - rouse.ruffle * 0.4 + startle * 0.3);
        const breath = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 3.4);
        pose.ruffle = 0.05 + breath * 0.05 + rouse.ruffle * 0.95 + this.drowsy * 0.15;
        pose.puff = hoot.puff;
        const sh = (t - this.shuffleAt.start) / OWL_TIMING.shuffleLength;
        const shuffle = sh >= 0 && sh <= 1 ? Math.sin(Math.PI * sh) : 0;
        const wingLoose = (shuffle * 0.08 + rouse.ruffle * 0.06) * quietBody;
        pose.wings.forEach((w, side) => {
            w.fold = 1 - wingLoose * (side === 0 ? 1 : 0.85);
        });
        pose.tail.pitch = hoot.lean * 12 + rouse.shake * 4;
        pose.tail.yaw = rouse.shake * 5;
        pose.tail.fan = 1 + rouse.ruffle * 0.15;
        const sway = (Math.sin(t * 0.43) * 0.8 + Math.sin(t * 0.17 + 1.3) * 0.6) * motion * quietBody;
        let pitch = OWL_POSTURE - hoot.lean * 9 - startle * 2;
        let bank = sway * 0.4 + rouse.shake * 5;
        let { heading } = p;
        this.sway = qAxis(0, 1, 0, (sway * 0.6 + rouse.shake * 3) * DEG, this.sway || [0, 0, 0, 1]);
        if (ground) {
            // Mantled over its catch: bowed over it, the wings spread wide and drooped round it like a cape,
            // the tail fanned flat behind. It keeps the wings open from the strike (no fold between).
            const mantle = 1;
            const breathe = Math.sin((t - this.landedAt) * 2.1) * 0.5 + 0.5;
            pitch = mix(pitch, 28, mantle);
            pose.wings.forEach((w) => Object.assign(w, {
                fold: 0.12 + breathe * 0.04, dihedral: -16 - breathe * 3, sweep: -16, twist: 8, fan: 1.15, alula: 0.5,
            }));
            pose.tail.fan = mix(pose.tail.fan, 1.6, mantle);
            pose.tail.pitch = -12 * mantle;
            head[1] = mix(head[1], -40, mantle * 0.8);
            pose.tufts = Math.min(pose.tufts, 0.4);
            pose.legs.forEach((leg) => { leg.grip = 0.85; });
            pose.perch = 0.03;
        }
        // Landed: from the flare's upright body and thrown-open wings to the perched owl, wings folded
        // away (lifted a little first), a bob as it takes its weight.
        if (settling > 0 && this.landFrom) {
            const age = landed;
            const fold = smooth(0.18, 1.0, age);
            const lift = bell(age / 0.7, 0.25, 0.5) * (1 - fold);
            if (!ground) {
                pose.wings.forEach((w) => Object.assign(w, {
                    fold,
                    dihedral: 18 * (1 - fold) + lift * 16,
                    sweep: -14 * (1 - fold),
                    twist: 12 * (1 - fold),
                    fan: 1 + 0.25 * (1 - fold),
                }));
            }
            const bobble = Math.exp(-age * 4.5) * Math.sin(age * 10) * 6;
            pitch = mix(pitch, this.landFrom.pitch, settling * settling) - bobble;
            pose.tail.fan = mix(pose.tail.fan, 1.7, settling);
            pose.tail.pitch = mix(pose.tail.pitch, -18, settling);
            pose.lift[1] = -Math.exp(-age * 5) * 0.03 * (1 - Math.exp(-age * 30));
            pose.legs.forEach((leg) => {
                leg.grip = smooth(0, 0.25, age);
                leg.reach = 1 - smooth(0, 0.3, age);
                leg.spread = (1 - smooth(0, 0.18, age)) * 0.6;
            });
            bank *= 1 - settling;
            heading = this.landFrom.heading + wrapAngle(p.heading - this.landFrom.heading) * smooth(0.1, 1.0, age);
        }
        // Off: a crouch and a lean forward, turning toward where it goes; the tufts go flat, the wings open.
        if (launching > 0) {
            const k = launching;
            const crouch = bell(k, 0.45, 0.25);
            pitch = mix(pitch, ground ? 25 : 34, smooth(0.15, 0.9, k));
            pose.lift[1] = -0.04 * crouch;
            pose.legs.forEach((leg) => { leg.lift = crouch; });
            pose.tufts = mix(pose.tufts, 0.15, k);
            pose.wings.forEach((w) => {
                w.fold = Math.min(w.fold, 1 - smooth(0.55, 1, k) * 0.35);
                w.dihedral = mix(w.dihedral, 26, smooth(0.6, 1, k));
            });
            const turn = wrapAngle(this.launchHeading - this.launchFrom.heading);
            heading = this.launchFrom.heading + turn * minJerk(k / 0.9);
            // It looks where it is going.
            head[0] = mix(head[0], 0, smooth(0, 0.6, k));
            head[1] = mix(head[1], ground ? 20 : -14, smooth(0, 0.6, k));
            head[2] = mix(head[2], 0, smooth(0, 0.6, k));
        }
        pose.head[0] = head[0];
        pose.head[1] = head[1];
        pose.head[2] = head[2];
        this.attitude.heading = heading;
        this.attitude.pitch = pitch;
        this.attitude.bank = bank;
        this.place.x = p.x;
        this.place.y = p.y;
        this.place.z = p.z;
    }

    composeFlight() {
        const { pose, flight } = this;
        const t = this.time - this.flightAt;
        const s = sampleFlight(flight, t, this.sample);
        const { leg } = this;
        const strike = leg.style === 'strike';
        // Its attitude: nose along the path (a little less steep than the path itself), banked into turns.
        const flare = 1 - smooth(0, OWL_TIMING.flare, s.left);
        const start = smooth(0, 0.45, t);
        const amp = Math.max(s.amp, flare * (strike ? 0.35 : 0.95));
        const beat = wingbeat(s.phase, amp, pose.wings[0], { out: this.beat });
        Object.assign(pose.wings[1], pose.wings[0]);
        let pitch = Math.max(-28, Math.min(22, s.climb * 0.6)) + beat.pitch;
        // The landing: upright, wings forward and braking, tail fanned down, talons reaching; a stoop
        // instead throws the feet far forward under wings raised high and back.
        const flarePitch = strike ? 48 : 58;
        pitch = mix(pitch, flarePitch, flare * flare);
        pose.wings.forEach((w) => {
            w.sweep += -20 * flare;
            w.twist += (strike ? 10 : 24) * flare;
            w.fan += 0.32 * flare;
            w.alula = flare;
            if (strike) w.dihedral = mix(w.dihedral, 48, flare);
        });
        pose.tail.fan = 1.08 + 0.75 * flare;
        pose.tail.pitch = beat.tail - 22 * flare;
        pose.legs.forEach((l) => Object.assign(l, {
            tuck: 1 - smooth(0.05, 0.75, flare) - (1 - start),
            reach: smooth(0.1, 0.8, flare),
            grip: 0.6 * (1 - flare),
            spread: smooth(0.4, 0.95, flare),
            lift: 0,
        }));
        // Out of the launch: from the crouch's lean to the flight's, the wings from half open to spread.
        if (start < 1) {
            pitch = mix(this.launchAttitude().pitch, pitch, start);
            pose.wings.forEach((w) => { w.fold = (1 - smooth(0, 0.6, start)) * 0.35; });
            pose.legs.forEach((l) => { l.tuck = smooth(0.3, 1, start); });
        }
        const bank = s.bank * (1 - flare);
        // The body rides the beat; the place is the body's centre less the root's height.
        pose.lift[1] = beat.lift;
        this.place.x = s.x;
        this.place.y = s.y - ROOT;
        this.place.z = s.z;
        const heading = start < 1 ? this.launchHeading + wrapAngle(s.heading - this.launchHeading) * start : s.heading;
        this.attitude.heading = heading;
        this.attitude.pitch = pitch;
        this.attitude.bank = bank;
        this.sway = null;
        pose.tufts = 0.1 + flare * 0.3;
        pose.ruffle = 0.02;
        pose.perch = 0.045;
        // The head stays level and looks ahead (at the perch as it comes in), whatever the body does.
        const ahead = sampleFlight(flight, t + 0.9, this.ahead || (this.ahead = {}));
        const end = flight.points[flight.points.length - 1];
        let target = s.left < 1.6
            ? { x: end[0], y: end[1] - 0.3, z: end[2] } : { x: ahead.x, y: ahead.y - 0.2, z: ahead.z };
        // In the last half second it looks past the perch, not down at its own feet.
        const past = smooth(0.7, 0.15, s.left);
        if (past > 0) {
            const fwd = 2.2;
            target = {
                x: mix(target.x, end[0] + Math.sin(s.heading) * fwd, past),
                y: mix(target.y, end[1] + 0.05, past),
                z: mix(target.z, end[2] + Math.cos(s.heading) * fwd, past),
            };
        }
        // Never over its shoulder in the air: a mark more than 70 degrees off its way is let go for the way.
        const tx = target.x - s.x;
        const tz = target.z - s.z;
        const off = Math.abs(wrapAngle(Math.atan2(tx, tz) - s.heading));
        if (off > 70 * DEG && Math.hypot(tx, tz) > 0.2) target = { x: s.x + s.vx, y: s.y + s.vy - 0.2, z: s.z + s.vz };
        this.headToward(target, heading, pitch, bank);
        // The head follows its mark quickly but never in a frame (a mark that changes is eased to).
        const k = 1 - Math.exp(-(this.step || 0) * 9);
        for (let i = 0; i < 3; i += 1) {
            this.flightHead[i] += (pose.head[i] - this.flightHead[i]) * k;
            pose.head[i] = this.flightHead[i];
        }
    }

    launchAttitude() {
        return { pitch: this.perch.kind === 'ground' ? 25 : 34 };
    }

    /** Head angles (relative to the body) that look at a world point with the head held level. */
    headToward(target, heading, pitch, bank) {
        const body = qMul(qAxis(0, 1, 0, heading), owlFlightBody(0, pitch, bank, [0, 0, 0, 1]));
        const inv = qConj(body);
        const head = { x: this.place.x, y: this.place.y + ROOT + 0.2, z: this.place.z };
        const d = [target.x - head.x, target.y - head.y, target.z - head.z];
        const l = Math.hypot(...d) || 1;
        const look = qRotate(inv, [d[0] / l, d[1] / l, d[2] / l]);
        const upW = qRotate(inv, [0, 1, 0]);
        // The head's frame: forward along the look, up as near the world's up as it can be.
        const z = look;
        const dotUp = upW[0] * z[0] + upW[1] * z[1] + upW[2] * z[2];
        let y = [upW[0] - z[0] * dotUp, upW[1] - z[1] * dotUp, upW[2] - z[2] * dotUp];
        const ly = Math.hypot(...y) || 1;
        y = y.map((c) => c / ly);
        const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
        const e = eulerOf(qFromBasis(x, y, z));
        this.pose.head[0] = Math.max(-100, Math.min(100, e[0]));
        this.pose.head[1] = Math.max(-80, Math.min(85, -e[1]));
        this.pose.head[2] = Math.max(-70, Math.min(70, e[2]));
    }

    /** What it is doing, for diagnostics and captures. */
    status() {
        return {
            mode: this.mode,
            perch: this.perch?.id ?? null,
            leg: this.leg ? `${this.leg.style}:${this.leg.to.id}` : null,
            trip: this.trip.map((leg) => `${leg.style}:${leg.to.id}`),
            alert: Math.round(this.alert * 100) / 100,
            drowsy: Math.round(this.drowsy * 100) / 100,
            head: this.pose.head.map((v) => Math.round(v)),
            at: [this.place.x, this.place.y, this.place.z].map((v) => Math.round(v * 100) / 100),
            nextOuting: Math.round(this.nextOuting * 10) / 10,
        };
    }

    rouseState(t) {
        const a = (t - this.rouseAt.start) / OWL_TIMING.rouseLength;
        if (a < 0 || a > 1) return { ruffle: 0, shake: 0 };
        const ruffle = smooth(0, 0.22, a) * (1 - smooth(0.55, 1, a));
        const shakeWindow = smooth(0.25, 0.32, a) * (1 - smooth(0.5, 0.6, a));
        return { ruffle, shake: Math.sin(a * OWL_TIMING.rouseLength * 2 * Math.PI * 6.5) * shakeWindow };
    }

    hootState(t) {
        const a = (t - this.hootAt.start) / OWL_TIMING.hootLength;
        if (a < 0 || a > 1) return { puff: 0, lean: 0 };
        const lean = bell(a, 0.15, 0.25);
        const puff = Math.max(bell((a - 0.18) / 0.3, 0.3, 0.4), bell((a - 0.55) / 0.3, 0.3, 0.4) * 0.8) * lean;
        return { puff, lean };
    }
}
