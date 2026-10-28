/**
 * Forest — what the eagle owl does: where it is, which way it looks, and every number its pose is made
 * of, from moment to moment.
 *
 * On a perch an owl is still, and its stillness is what makes it an owl: its eyes are fixed in its
 * skull, so it looks by turning its head, quickly, and then holds it there; it peers at what interests
 * it by bobbing and tilting its head; it blinks slowly, its ear tufts rise when it is alert and sink
 * when it dozes, and now and then it rouses (fluffs out and shakes its whole plumage), settles its
 * wings, or hoots, its white throat swelling. Between the small things come bigger ones, each in its
 * own time: it stretches (one wing and the leg on that side out behind it, or both wings up over its
 * back), preens (its face buried in its breast or under a shoulder, nibbling), dozes (eyes closed,
 * fluffed out, the head sunk, an eye opened now and then), or draws itself up tall and thin, tufts
 * raised, at something it does not trust.
 *
 * It does not keep to a routine. When it has sat a while (a few seconds or a minute and more, drawn
 * fresh each time) it weighs what it can do from where it is: sidle along its limb to another place
 * on it, hop round to face the other way, fly to another perch (the nearer the likelier, the ones it
 * has just left less so, home more so the longer it is away), drop on something it heard in the
 * ferns, which it catches (mantled over it a moment) or misses (it stands in the ferns, looks about,
 * and flies up to whichever perch it likes), or leave the glade altogether: out past the edge of the
 * frame, behind the eye or over its head, gone a while, and back in by another way to any perch. How
 * restless it is drifts slowly (minutes of comings and goings, minutes of stillness), and it is
 * unlikely to do the same thing twice running. Its flights differ: a dip low over the ferns and a
 * swoop up, a level glide, an arc over, a meander, a loop round the glade, flying past the perch and
 * coming back to it, a circle before it comes in; quicker or slower, flapped or glided, a short hop
 * between two limbs of one tree. Every way it takes keeps clear of the trunks, the crowns, the floor
 * and the eye. Out along the ride and back across the moon is for its home limb.
 *
 * A trip is a list of legs; each leg is a crouch and a lean off the perch, a flight planned whole
 * (forest-owl-flight.js) and a landing: the body raised upright, the wings thrown forward and beating
 * against the air, the tail fanned, the talons reaching, then the wings folded away. Between perch and
 * air every number is blended, never switched, so nothing jumps.
 *
 * Each of those is an act with a start and a length, and the pose is a closed-form function of the
 * acts in play, so a seek and a night lived through agree; the acts are dealt by the owl's own seeded
 * generators (one for each kind of act) as they fall due. It only goes where the player can see it
 * land (`setSight`).
 *
 * The game speaks to it through the reactions' owl cues (forest-reactions.js `owlCue`): a hard drop
 * startles it (sometimes into the tall stance), a line clear draws its look, four lines and a perfect
 * clear make it stare and then fly out across the moon (or home), a level-up moves it on, the end of a
 * run lets it doze.
 *
 * No three.js here: the theme, the playground and the tests share it.
 */

import {
    OWL_DRAWN_SCALE, OWL_POSTURE, OWL_ROOT_HEIGHT, createOwlPose, eulerOf, owlFlightBody, qAxis, qConj, qFromBasis,
    qMul, qRotate,
} from './forest-owl-rig.js';
import {
    OWL_FLIGHT, planFlight, sampleFlight, wingbeat,
} from './forest-owl-flight.js';
import {
    FOREST_OWL_HOME, FOREST_OWL_PERCHES, forestOwlLimb, forestOwlNeighbours, forestOwlPerch, limbAt, limbLength,
} from './forest-owl-perches.js';

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
    /** How long it sits before it thinks of moving: mostly well under half a minute, now and then far longer. */
    stay: [5, 75],
    /** At home it sits longer. */
    homeStay: [10, 100],
    /** The crouch and lean before it drops off a perch, and the settling after it lands. */
    launch: 0.62,
    settle: 1.35,
    /** The landing's flare: the last seconds of a flight. */
    flare: 0.85,
    /** Mantled over a catch; standing in the ferns after a miss. */
    mantle: [1.8, 2.8],
    miss: [1.6, 3.2],
    /** Its bigger acts on a perch: how often each comes, and how long it lasts. */
    stretch: [45, 120],
    stretchLength: [2.3, 3.1],
    preen: [35, 95],
    preenLength: [3.6, 7],
    doze: [80, 170],
    dozeLength: [9, 22],
    tall: [90, 200],
    tallLength: [2.6, 4.8],
    /** A hop round to face the other way. */
    turn: 1.0,
    /** Sidling along a limb: seconds a step, metres a step. */
    step: 0.34,
    stride: 0.075,
    /** Gone from the glade, before it comes back. */
    away: [15, 95],
    /** How slowly its restlessness drifts (seconds), and how far. */
    restlessTime: 110,
    restlessSpread: 0.3,
});

/** Places on the floor it may stoop to (x, z): open ground the player sees, clear of the card. */
export const OWL_GROUND = Object.freeze([
    Object.freeze({ x: -6.2, z: 0.6 }),
    Object.freeze({ x: -3.6, z: -0.8 }),
    Object.freeze({ x: -5.0, z: -1.5 }),
    Object.freeze({ x: -7.4, z: -3.6 }),
    Object.freeze({ x: 4.6, z: 2.2 }),
    Object.freeze({ x: 5.2, z: -4.5 }),
    Object.freeze({ x: 7.4, z: -7.2 }),
    Object.freeze({ x: 13.2, z: -8.4 }),
]);

/**
 * Where it leaves the glade and comes back (body centre, world metres): past the frame's left and right
 * edges, behind the eye on either side, and over its head. `via` is where its way through the glade
 * meets the way out. A gate is used only while it is out of frame (`setView`), so a screen wide enough
 * to see one keeps it shut; where a tree of the glade stands in a gate's way in, the nearest open air to it
 * is used instead (the glade's grove grows differently in every forest), or the gate stays shut.
 */
export const OWL_GATES = Object.freeze([
    Object.freeze({ id: 'left', at: [-27, 6.5, -1], via: [-14, 5.5, 2] }),
    Object.freeze({ id: 'leftBack', at: [-14, 5.5, 24], via: [-8.5, 5, 12] }),
    Object.freeze({ id: 'over', at: [2, 13.5, 28], via: [1.5, 9.5, 5] }),
    Object.freeze({ id: 'rightBack', at: [16, 6.5, 24], via: [8.5, 5.5, 11] }),
    Object.freeze({ id: 'right', at: [32, 7, -6], via: [19, 6.5, -4] }),
]);

/** The glade's open air it wanders through: x and z bounds, and heights over the ground. */
export const OWL_AIR = Object.freeze({
    x: Object.freeze([-13, 17]), z: Object.freeze([-26, 9]), low: 1.8, high: 10,
});

/** The eye (forest-plan.js FOREST_EYE at eye height): no way it takes passes nearer than this. */
const EYE = Object.freeze([0, 2.2, 13]);
const EYE_ROOM = 6;

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
/** A stay: most are short, a few are long (the draw is skewed toward the low end). */
const stayFor = (rng, [a, b]) => a + (b - a) * rng() ** 2.2;
/** A normal deviate (Box-Muller, two draws). */
const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
/** One of `options` ([value, weight] pairs) by weight. */
function weighted(rng, options) {
    const total = options.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (!(total > 0)) return options.length ? options[0][0] : null;
    let r = rng() * total;
    for (const [value, w] of options) {
        r -= Math.max(0, w);
        if (r <= 0) return value;
    }
    return options[options.length - 1][0];
}

/** The kinds of act that each draw from a stream of their own (new kinds go at the end). */
const STREAMS = Object.freeze(['gaze', 'blink', 'peer', 'tilt', 'rouse', 'shuffle', 'hoot', 'trips',
    'stretch', 'preen', 'doze', 'tall', 'wander']);
/** The bigger acts that come on their own clocks. */
const BIG_ACTS = Object.freeze(['stretch', 'preen', 'doze', 'tall']);
/** The ways it flies from one perch to another. */
const FLIGHT_KINDS = Object.freeze(['direct', 'meander', 'patrol', 'overshoot', 'circle']);

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
    for (let i = 0; i < 2; i += 1) pose.blink[i] = m(pose.blink[i], from.blink[i]);
    pose.neck = m(pose.neck, from.neck);
    pose.tufts = m(pose.tufts, from.tufts);
    pose.puff = m(pose.puff, from.puff);
    pose.ruffle = m(pose.ruffle, from.ruffle);
    pose.perch = m(pose.perch, from.perch);
    Object.keys(from.tail).forEach((k) => { pose.tail[k] = m(pose.tail[k], from.tail[k]); });
    pose.wings.forEach((wing, i) => Object.keys(from.wings[i]).forEach((k) => {
        wing[k] = m(wing[k], from.wings[i][k]);
    }));
    pose.legs.forEach((leg, i) => Object.keys(from.legs[i]).forEach((k) => {
        leg[k] = m(leg[k] || 0, from.legs[i][k] || 0);
    }));
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
        this.view = null;
        this.trunks = [];
        this.crowns = [];
        this.sample = {};
        this.beat = { lift: 0, pitch: 0, tail: 0 };
        this.pupil = 1.6;
        this.limbPoint = {};
        // Each kind of act draws from a stream of its own, seeded once from the owl's generator: which acts
        // fall due in the same frame never changes what the others draw, so a seek and a night lived
        // through agree at any frame rate, and a reset begins the same life again.
        this.seeds = STREAMS.map(() => Math.floor(this.rng() * 0x7fffffff));
        this.reset();
    }

    reset() {
        this.streams = Object.fromEntries(STREAMS.map((name, i) => [name, stream(this.seeds[i])]));
        const {
            gaze, blink, peer, tilt, rouse, shuffle, hoot, wander,
        } = this.streams;
        this.time = 0;
        this.heard = 0;
        this.mode = 'perched';
        this.perch = this.home;
        this.seatHeading = this.home.heading;
        this.turned = false;
        this.trip = [];
        this.leg = null;
        this.flight = null;
        this.act = null;
        this.actLids = 0;
        this.launchAt = -10;
        this.launchLength = OWL_TIMING.launch;
        this.tufts = 0.7;
        this.flightAt = -10;
        this.landedAt = -10;
        this.departAt = Infinity;
        this.decideAt = stayFor(wander, OWL_TIMING.homeStay) + 6;
        this.leftHomeAt = Infinity;
        this.visits = [];
        this.recent = [];
        this.recentGates = [];
        this.restless = 0.45;
        this.restlessAt = 0;
        this.awayUntil = -Infinity;
        this.still = false;
        this.groundCatch = true;
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
        this.schedule = Object.fromEntries(BIG_ACTS.map((kind) => [kind,
            between(this.streams[kind], OWL_TIMING[kind]) * 0.6]));
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

    /**
     * The trees it must fly round: [{ x, z, radius, y, height, crown }] (forest-trees.js `trunks()`, the
     * crown an ellipsoid { x, y, z, rx, ry }). Its routes keep a clear body's width from every trunk and
     * out of every crown.
     */
    setTrunks(trunks) {
        const list = trunks || [];
        this.trunks = list.map((t) => ({
            x: t.x, z: t.z, r: t.radius || 0.3, top: (t.y || 0) + (t.height || 30),
        }));
        this.crowns = list.filter((t) => t.crown).map((t) => ({ ...t.crown }));
        // Each gate's way in, moved into open air if a tree stands in it (looked for once, nearest first).
        this.gateVias = new Map(OWL_GATES.map((g) => [g.id, this.openAirNear(g.via)]));
    }

    /** The nearest open air to a point (within 4.5 m, a little higher or lower), or null. */
    openAirNear(q) {
        for (const r of [0, 1.5, 3, 4.5]) {
            for (const dy of [0, 1.5, -1]) {
                for (let k = 0; k < (r ? 8 : 1); k += 1) {
                    const a = (k / 8) * 2 * Math.PI;
                    const c = [q[0] + Math.cos(a) * r, q[1] + dy, q[2] + Math.sin(a) * r];
                    if (this.airClear(c, 1.2)) return c;
                }
            }
        }
        return null;
    }

    /** A gate's way in (moved into open air where a tree stands in it), or null if it has none. */
    gateVia(gate) {
        return this.gateVias ? this.gateVias.get(gate.id) ?? null : gate.via;
    }

    /**
     * Whether any of a thing `size` metres across at a world point is in the frame at all (the card makes
     * no difference): `onScreen(x, y, z, size)`. It leaves and comes back only where it is not. Without it
     * the gates count as out of frame.
     */
    setView(onScreen) {
        this.view = typeof onScreen === 'function' ? onScreen : null;
    }

    inFrame(x, y, z, size = 2.5) {
        return this.view ? this.view(x, y, z, size) : false;
    }

    /** The gates it can use now: out of frame, with a way in through open air. */
    openGates() {
        return OWL_GATES.filter((g) => !this.inFrame(g.at[0], g.at[1], g.at[2], 3) && this.gateVia(g));
    }

    seen(x, y, z, size = 0.8) {
        return this.sight ? this.sight(x, y, z, size) : true;
    }

    perchSeen(perch) {
        return this.seen(perch.x, perch.y + ROOT, perch.z, 0.9);
    }

    /** Put it on a perch now, settled, facing the way the perch faces (captures, the playground). */
    placeAt(perchId) {
        const perch = forestOwlPerch(perchId);
        if (!perch || this.mode !== 'perched') return false;
        this.endAct();
        this.trip = [];
        this.departAt = Infinity;
        this.perch = perch;
        this.seatHeading = perch.heading;
        this.turned = false;
        this.attitude.heading = perch.heading;
        this.landedAt = this.time - OWL_TIMING.settle - 1;
        this.place.x = perch.x;
        this.place.y = perch.y;
        this.place.z = perch.z;
        this.place.heading = perch.heading;
        this.fade = null;
        return true;
    }

    /** Keep it where it is (no moves of its own; acts and cues still play): captures. */
    hold(still = true) {
        this.still = Boolean(still);
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
        // The game stirs it (the stir drifts away again with its restlessness); a run's end calms it.
        const stir = {
            drop: 0.05, quad: 0.25, perfect: 0.25, b2b: 0.12, level: 0.15,
        }[cue.kind] || 0;
        if (stir) this.restless = Math.min(0.98, this.restless + stir);
        if (cue.kind === 'over') this.restless = Math.min(this.restless, 0.15);
        // Away from the glade, a great clear or a level-up brings it back soon.
        if (this.mode === 'away') {
            if (['quad', 'perfect', 'level'].includes(cue.kind)) {
                this.departAt = Math.min(this.departAt, this.time + 1.5 + rng() * 3);
            }
            return;
        }
        // Anything the game does wakes a dozing owl.
        if (this.act?.kind === 'doze' && cue.kind !== 'over') this.endAct(0.5);
        const lookAtBoard = (spread = 8) => {
            if (!this.board || !perched || this.act?.kind === 'sidle' || this.act?.kind === 'turn') return;
            const [yaw, pitch] = this.lookToward(this.board);
            this.turnHead(yaw + (rng() - 0.5) * spread, pitch + (rng() - 0.5) * spread * 0.5, (rng() - 0.5) * 12);
        };
        switch (cue.kind) {
        case 'drop':
            this.alert = Math.min(1, this.alert + 0.4 + cue.strength * 0.3);
            this.startleAt = this.time;
            if (this.act?.kind === 'preen' || this.act?.kind === 'stretch') this.endAct(0.4);
            lookAtBoard(4);
            this.gaze.next = this.time + 1.2 + rng() * 1.5;
            // Now and then it draws itself up tall and stares.
            if (perched && !this.act && this.settled() && cue.strength > 0.3 && rng() < 0.45) {
                this.startAct('tall', { delay: 0.25 });
            }
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
            if (this.act && this.act.kind !== 'sidle' && this.act.kind !== 'turn') this.endAct(0.35);
            lookAtBoard(3);
            this.stareUntil = this.time + 2.2;
            this.gaze.next = this.stareUntil + rng();
            // Then out along the ride and back across the moon if it is home, or home if it is not.
            if (cue.kind !== 'b2b' && perched && !this.trip.length && !this.act && !this.still) {
                const home = this.perch === this.home;
                if (home && this.perchSeen(this.home)) this.plan([{ style: 'moon', to: this.home }], 2.0);
                else if (!home && this.perch.kind !== 'ground' && this.perchSeen(this.home)) {
                    this.plan([{ style: this.hopStyle(this.perch, this.home), to: this.home }], 1.2);
                }
            }
            break;
        case 'level':
            this.alert = Math.min(1, this.alert + 0.3);
            if (perched && !this.trip.length && !this.act && !this.still && this.perch.kind !== 'ground') {
                // It moves on: another perch, or along its limb.
                if (!this.planMove(0.9)) this.decideAt = Math.min(this.decideAt, this.time + 0.8);
            } else {
                this.rouseAt.start = this.time + 0.4;
                this.rouseAt.next = this.time + between(this.streams.rouse, OWL_TIMING.rouse);
            }
            break;
        case 'over':
            this.alert = 0.1;
            this.drowsy = 0.85;
            this.schedule.doze = Math.min(this.schedule.doze, this.time + 2.5);
            break;
        default:
            break;
        }
    }

    // -- where next ---------------------------------------------------------------------------
    /** Set out on `legs` in `delay` seconds (it finishes looking, then goes). */
    plan(legs, delay = 0.6) {
        if (this.act) this.endAct(0.3);
        this.trip = legs.slice();
        this.departAt = this.time + delay;
    }

    settled() {
        return this.mode === 'perched' && this.time > this.landedAt + OWL_TIMING.settle;
    }

    /** A short hop between two places close together (two limbs of one tree, two places on a log). */
    hopStyle(from, to) {
        return Math.hypot(to.x - from.x, to.z - from.z) < 4 ? 'hop' : 'plain';
    }

    /** The perches it may fly to from where it is, each weighed. */
    destinations(from = this.perch) {
        const awayFor = Number.isFinite(this.leftHomeAt) ? this.time - this.leftHomeAt : 0;
        return FOREST_OWL_PERCHES.filter((p) => p !== from && this.perchSeen(p)
            // Along its own limb it sidles (a hop would turn it side-on to the limb).
            && !(p.limb && p.limb === from.limb))
            .map((p) => {
                const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
                let w = Math.exp(-d / 15);
                const recent = this.visits.indexOf(p.id);
                if (recent >= 0) w *= 0.3 + recent * 0.2;
                if (p === this.home) w *= 1 + Math.min(3, awayFor / 50);
                if (p.tree && p.tree === from.tree) w *= 1.25;
                return [p, w];
            });
    }

    /**
     * Fly to another perch (by weight) in `delay` seconds; false if there is none it can see. `kind` asks for
     * a way of flying there (else one is chosen as it sets off).
     */
    planMove(delay, to = null, kind = null) {
        const options = this.destinations();
        const pick = to || weighted(this.streams.wander, options);
        if (!pick) return false;
        this.plan([{ style: this.hopStyle(this.perch, pick), to: pick, kind }], delay);
        return true;
    }

    /** Ground it can stoop to from where it is: open, seen, within a short glide (its own side of the card). */
    huntSpots(from = this.perch) {
        return OWL_GROUND.map((g) => ({ ...g, y: this.groundHeight(g.x, g.z) }))
            .filter((g) => {
                const d = Math.hypot(g.x - from.x, g.z - from.z);
                return d > 4.5 && d < 9 && this.seen(g.x, g.y + 0.3, g.z, 0.7);
            });
    }

    /**
     * A stoop into the ferns after something it heard there: it catches it (mantled over it a moment)
     * or misses (it stands and looks about); either way it then flies up to a perch of its choosing.
     */
    planHunt(delay, outcome = null) {
        const rng = this.streams.trips;
        const spots = this.huntSpots();
        if (!spots.length) return false;
        const spot = spots[Math.floor(rng() * spots.length) % spots.length];
        const from = this.perch;
        const caught = outcome ? outcome === 'catch' : rng() < 0.55;
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
            {
                style: 'strike',
                to: ground,
                catch: caught,
                stay: between(rng, caught ? OWL_TIMING.mantle : OWL_TIMING.miss),
            },
            { style: 'climb', to: null, back: from },
        ], delay);
        // It hears it first: it stares down at the place, and peers.
        const [yaw, pitch] = this.lookToward({ x: spot.x, y: spot.y + 0.1, z: spot.z });
        this.turnHead(yaw, pitch, (rng() - 0.5) * 20);
        this.gaze.next = this.departAt + 1;
        this.peerAt.start = this.time + 0.4;
        return true;
    }

    /** From the ground (or wherever it is), a perch to fly up to: near ones, the one it came from most. */
    choosePerch(from, back = null) {
        const options = this.destinations(from).map(([p, w]) => [p, p === back ? w * 2.5 : w]);
        return weighted(this.streams.wander, options) || back || this.home;
    }

    /**
     * How restless it is now (0 still .. 1 restless): a slow random drift (an Ornstein-Uhlenbeck walk,
     * stepped whenever it is asked), so it has spells of comings and goings and spells of stillness
     * rather than the same odds every time. The game's cues push it up (`react`).
     */
    restlessNow() {
        const span = Math.max(0, this.time - this.restlessAt);
        this.restlessAt = this.time;
        const keep = Math.exp(-span / OWL_TIMING.restlessTime);
        const drift = OWL_TIMING.restlessSpread * Math.sqrt(1 - keep * keep) * gauss(this.streams.wander);
        this.restless = Math.max(0.02, Math.min(0.98, 0.45 + (this.restless - 0.45) * keep + drift));
        return this.restless;
    }

    /** What it did last (a few moves back), so it is unlikely to do the same thing twice running. */
    remember(kind) {
        this.recent = [kind, ...this.recent].slice(0, 3);
    }

    fresh(kind) {
        const i = this.recent.indexOf(kind);
        return i < 0 ? 1 : 0.35 + 0.2 * i;
    }

    /** It has sat long enough: what now? Weighed by what it can do from where it is, and its mood. */
    decide() {
        const rng = this.streams.wander;
        const here = this.perch;
        const r = this.restlessNow();
        const neighbours = forestOwlNeighbours(here).filter((p) => this.perchSeen(p));
        const options = [['stay', 0.08 * (1.6 - r)]];
        if (neighbours.length) options.push(['sidle', 0.3 * this.fresh('sidle')]);
        const turnOdds = (this.turned ? 0.34 : 0.1) * (1.3 - 0.6 * r);
        if (here.kind !== 'ground') options.push(['turn', turnOdds * this.fresh('turn')]);
        if (this.destinations().length) options.push(['fly', 0.42 * (0.55 + 0.9 * r)]);
        if (this.huntSpots().length) options.push(['hunt', 0.2 * (0.7 + 0.6 * r) * this.fresh('hunt')]);
        if (this.motion >= 0.5 && this.openGates().length) {
            options.push(['away', 0.19 * (0.3 + 1.4 * r) * this.fresh('away')]);
        }
        if (here === this.home && this.perchSeen(this.home)) {
            options.push(['moon', 0.035 * (0.5 + r) * this.fresh('moon')]);
        }
        const pick = weighted(rng, options);
        let started = false;
        if (pick === 'sidle') {
            const to = weighted(rng, neighbours.map((p, i) => [p, i === 0 ? 1 : 0.45]));
            started = this.startAct('sidle', { to });
        } else if (pick === 'turn') started = this.startAct('turn');
        else if (pick === 'fly') started = this.planMove(0.4 + rng() * 0.8);
        else if (pick === 'hunt') started = this.planHunt(1.8 + rng() * 1.4);
        else if (pick === 'away') started = this.planAway(0.5 + rng() * 0.8);
        else if (pick === 'moon') {
            this.plan([{ style: 'moon', to: this.home }], 0.8);
            started = true;
        }
        if (started && pick !== 'fly') this.remember(pick);
        // Whatever it did (or if it chose to sit on), it thinks again after another stay: shorter when it is
        // restless, longer when it is still.
        const range = here === this.home ? OWL_TIMING.homeStay : OWL_TIMING.stay;
        const mood = mix(1.5, 0.6, r);
        this.decideAt = this.time + (started ? 0 : 3) + stayFor(rng, range) * mood * (pick === 'stay' ? 0.6 : 1);
        if (this.act) this.decideAt = Math.max(this.decideAt, this.act.start + this.act.length + 2);
        return pick;
    }

    /** A gate's place as a perch-like stop (its body centre where the gate is). */
    gateStop(gate) {
        return {
            id: `gate:${gate.id}`,
            gate,
            kind: 'air',
            x: gate.at[0],
            y: gate.at[1] - ROOT,
            z: gate.at[2],
            heading: 0,
            radius: 0.05,
        };
    }

    /** Out of the glade by a gate out of frame (`gateId`, or one by chance: near ones likelier), a while away. */
    planAway(delay, gateId = null) {
        const rng = this.streams.trips;
        const gates = this.openGates();
        if (!gates.length || this.perch.kind === 'ground') return false;
        const from = this.perch;
        const gate = gates.find((g) => g.id === gateId) || weighted(rng, gates.map((g) => {
            const via = this.gateVia(g);
            const d = Math.hypot(via[0] - from.x, via[2] - from.z);
            return [g, Math.exp(-d / 22) * (this.recentGates.includes(g.id) ? 0.4 : 1)];
        }));
        this.recentGates = [gate.id, ...this.recentGates].slice(0, 2);
        this.plan([{ style: 'exit', to: this.gateStop(gate), gate }], delay);
        return true;
    }

    /**
     * Send it now (captures, the playground): 'moon' (out and back across the moon from home), 'hunt'
     * (a stoop into the ferns and back; 'catch' or 'miss' to say how it goes), 'visit' (to `perchId`, or
     * one by chance), 'home', 'sidle' (along its limb, to `perchId` or the nearest place on it), 'turn',
     * or one of its acts on a perch: 'stretch' ('wingsUp' as `perchId` for the other stretch), 'preen',
     * 'doze', 'tall'; 'away' (out of the glade, by the gate `perchId` names or one by chance), or a way of
     * flying to `perchId` (or a perch by chance): 'direct', 'meander', 'patrol', 'overshoot', 'circle'; or,
     * while it is away, 'back' (now, by the gate `perchId` names if it is open). Returns whether it went.
     */
    send(kind, perchId = null) {
        if (kind === 'back') {
            if (this.mode !== 'away') return false;
            this.departAt = this.time;
            this.backBy = perchId;
            return true;
        }
        if (this.mode !== 'perched') return false;
        let went = false;
        if (FLIGHT_KINDS.includes(kind)) {
            const to = forestOwlPerch(perchId);
            const fit = to && to !== this.perch && !(to.limb && to.limb === this.perch.limb);
            went = this.planMove(0.3, fit ? to : null, kind);
        } else if (kind === 'away') {
            went = this.planAway(0.3, perchId);
        } else if (kind === 'moon' && this.perch === this.home) {
            this.plan([{ style: 'moon', to: this.home }], 0.3);
            went = true;
        } else if (kind === 'hunt' || kind === 'catch' || kind === 'miss') {
            went = this.planHunt(1.2, kind === 'hunt' ? null : kind);
        } else if (kind === 'home' && this.perch !== this.home) {
            went = this.planMove(0.3, this.home);
        } else if (kind === 'visit') {
            const to = forestOwlPerch(perchId);
            went = to && to !== this.perch ? this.planMove(0.3, to) : this.planMove(0.3);
        } else if (kind === 'sidle') {
            const to = forestOwlPerch(perchId);
            const neighbours = forestOwlNeighbours(this.perch);
            went = this.startAct('sidle', { to: neighbours.includes(to) ? to : neighbours[0] });
        } else if (kind === 'turn' || BIG_ACTS.includes(kind)) {
            went = this.startAct(kind, { variant: perchId, force: true });
        }
        if (went) this.decideAt = Math.max(this.decideAt, this.time + 60);
        return Boolean(went);
    }

    // -- acts on a perch -------------------------------------------------------------------------
    /** Begin one of its bigger acts now (or after `delay`). Returns whether it began. */
    startAct(kind, {
        to = null, variant = null, delay = 0, force = false,
    } = {}) {
        if (this.mode !== 'perched' || this.act || (!force && !this.settled())) return false;
        const ground = this.perch.kind === 'ground';
        if (ground && kind !== 'tall') return false;
        const start = this.time + delay;
        const rng = this.streams[kind === 'sidle' || kind === 'turn' ? 'wander' : kind];
        const act = { kind, start, length: 1 };
        if (kind === 'sidle') {
            if (!to || !to.limb || to.limb !== this.perch.limb) return false;
            const limb = forestOwlLimb(to.limb);
            const run = Math.abs(to.u - this.perch.u) * limbLength(limb);
            act.limb = limb;
            act.from = this.perch;
            act.to = to;
            act.steps = Math.max(2, Math.round(run / OWL_TIMING.stride));
            act.length = act.steps * OWL_TIMING.step + 0.35;
            // Which foot leads: the one on the side it moves to.
            const a = limbAt(limb, this.perch.u);
            const b = limbAt(limb, to.u);
            const h = this.seatHeading;
            const leftward = (b.x - a.x) * Math.cos(h) - (b.z - a.z) * Math.sin(h);
            act.lead = leftward > 0 ? 0 : 1;
        } else if (kind === 'turn') {
            act.length = OWL_TIMING.turn;
            act.from = this.seatHeading;
            const top = this.perch.kind === 'top';
            const by = top ? (rng() < 0.5 ? -1 : 1) * (100 + rng() * 80) * DEG : Math.PI;
            // Round the way the head is already turned, if it is.
            const sign = this.gazeNow()[0] >= 0 ? 1 : -1;
            act.by = top ? by : sign * Math.PI;
        } else if (kind === 'stretch') {
            act.length = between(rng, OWL_TIMING.stretchLength);
            act.variant = variant === 'wingsUp' || (variant !== 'wingLeg' && rng() < 0.33) ? 'wingsUp' : 'wingLeg';
            act.side = rng() < 0.5 ? 0 : 1;
        } else if (kind === 'preen') {
            act.length = between(rng, OWL_TIMING.preenLength);
            const targets = ['breast', 'left', 'right'];
            act.target = targets.includes(variant) ? variant : targets[Math.floor(rng() * 3) % 3];
            act.seed = rng() * 10;
        } else if (kind === 'doze') {
            act.length = between(rng, OWL_TIMING.dozeLength);
            act.peek = 3 + rng() * 3;
            act.seed = rng();
        } else if (kind === 'tall') {
            act.length = between(rng, OWL_TIMING.tallLength);
            // It stares at the board, or at something off in the trees.
            if (this.board && rng() < 0.6) act.look = this.lookToward(this.board);
            else act.look = [(rng() - 0.5) * 220, -12 + rng() * 22];
        } else return false;
        this.act = act;
        if (kind === 'tall') {
            this.alert = 1;
            this.turnHead(act.look[0], act.look[1], 0);
            this.gaze.start = start;
        }
        // While its head is busy with the act, it does not look about.
        if (kind !== 'tall') this.gaze.next = Math.max(this.gaze.next, start + act.length + 0.3);
        else this.gaze.next = start + act.length + 0.6;
        return true;
    }

    /** The act is over (or cut short, the pose crossed over in `fade` seconds). */
    endAct(fade = 0) {
        const { act } = this;
        if (!act) return;
        if (fade > 0) this.crossfade(fade);
        this.act = null;
        if (act.kind === 'sidle' && this.time >= act.start + act.length) {
            this.perch = act.to;
            this.seatHeading = this.turned ? wrapAngle(act.to.heading + Math.PI) : act.to.heading;
        } else if (act.kind === 'turn' && this.time >= act.start + act.length) {
            this.seatHeading = wrapAngle(act.from + act.by);
            this.turned = Math.abs(wrapAngle(this.seatHeading - this.perch.heading)) > Math.PI / 2;
            this.gaze.from = [0, -6, 0];
            this.gaze.to = [0, -6, 0];
        } else if (act.kind === 'sidle' || act.kind === 'turn') {
            // Cut short: it stays where it was.
            this.crossfade(Math.max(fade, 0.3));
        }
        if (act.kind === 'sidle' || act.kind === 'turn') this.gaze.next = Math.min(this.gaze.next, this.time + 0.6);
    }

    // -- going out --------------------------------------------------------------------------
    /** The body-centre waypoints of a leg from `from` to `leg.to` (`leg.kind` says how it flies there). */
    route(from, leg) {
        const rng = this.streams.trips;
        const { to } = leg;
        const bodyAt = (p, lift = ROOT) => [p.x, p.y + lift, p.z];
        const flat = (v) => {
            const l = Math.hypot(v[0], v[2]) || 1;
            return [v[0] / l, 0, v[2] / l];
        };
        const facing = (p) => [Math.sin(p.heading), 0, Math.cos(p.heading)];
        const add = (p, d, k, dy = 0) => [p[0] + d[0] * k, p[1] + d[1] * k + dy, p[2] + d[2] * k];
        const floored = (points, stoop = 0) => points.map((q, i) => {
            if (i === points.length - 1 || i === 0) return q;
            const floor = this.groundHeight(q[0], q[2]) + (i >= points.length - 1 - stoop ? 0.35 : 1.1);
            return [q[0], Math.max(q[1], floor), q[2]];
        });
        const S0 = from.kind === 'ground' ? bodyAt(from, 0.16) : bodyAt(from);
        if (leg.style === 'moon') {
            const loop = OWL_MOON_LOOP.map((q) => [q[0] + (rng() - 0.5) * 0.8, q[1] + (rng() - 0.5) * 0.5,
                q[2] + (rng() - 0.5) * 0.8]);
            const L = add(S0, flat([-0.25, 0, -1]), 1.0, -0.55);
            return [S0, L, ...loop, add(bodyAt(to), facing(to), -1.0, -0.2), bodyAt(to)];
        }
        // Coming back into the glade it starts at its gate and comes in by the gate's way in.
        const entering = leg.style === 'enter';
        const S = entering ? this.gateVia(from.gate) || from.gate.via : S0;
        const E = to.kind === 'ground' ? bodyAt(to, 0.16) : bodyAt(to);
        const toward = flat([E[0] - S[0], 0, E[2] - S[2]]);
        const dist = Math.hypot(E[0] - S[0], E[2] - S[2]);
        const side = flat([-toward[2], 0, toward[0]]);
        // Off the perch the way it faces when that is roughly the way it goes; otherwise it turns on the
        // perch first (the crouch turns it) and drops straight toward where it goes.
        const dotFacing = (q, d) => facing(q)[0] * d[0] + facing(q)[2] * d[2];
        const seat = { heading: this.seatHeading };
        let launchDir = flat(from.kind === 'ground' || dotFacing(seat, toward) < 0.5 ? toward : [
            mix(facing(seat)[0], toward[0], 0.75), 0, mix(facing(seat)[2], toward[2], 0.75)]);
        // Close by a trunk, a wing spread across the limb would strike the bark: it leaves out along the
        // limb, and comes in along it from the limb's end, travelling in toward the trunk.
        const nearTrunk = (q) => (q.limb && Number.isFinite(q.clear) ? smooth(1.05, 0.5, q.clear) : 0);
        const outward = (q) => [Math.sin(q.run), 0, Math.cos(q.run)];
        if (nearTrunk(from) > 0 && leg.style !== 'hop') {
            const k = nearTrunk(from) * 0.85;
            const o = outward(from);
            launchDir = flat([mix(launchDir[0], o[0], k), 0, mix(launchDir[2], o[2], k)]);
        }
        if (leg.style === 'hop') {
            // A short hop: it turns on the perch toward the other place as it crouches, springs, gives a beat or
            // two in a low arc (up over the gap, or a drop with the wings half open), and comes onto the other
            // place level so it can grip; it turns to face out as it settles. Always toward where it goes.
            const rise = E[1] - S[1];
            const span = Math.max(0.3, dist);
            const ahead = dist > 0.05 ? toward : flat([Math.sin(this.seatHeading), 0, Math.cos(this.seatHeading)]);
            const L = add(S, ahead, Math.min(0.35, span * 0.3), rise > 0.3 ? 0.22 : -0.12);
            const arc = 0.1 + Math.min(0.4, span * 0.1) + Math.max(0, rise) * 0.18;
            const sag = rise < 0 ? Math.min(0.4, -rise * 0.12) : 0;
            const M = [mix(S[0], E[0], 0.55), mix(S[1], E[1], 0.55) + arc - sag, mix(S[2], E[2], 0.55)];
            const A = add(E, ahead, -Math.min(0.3, span * 0.3), rise < -0.5 ? 0.12 : -0.04);
            return this.clearTrunks([S, L, M, A, E]);
        }
        const L = from.kind === 'ground' ? add(S, launchDir, 0.7, 0.35) : add(S, launchDir, 0.95, -0.5);
        if (leg.style === 'exit') {
            // Out of the glade: off the perch, perhaps a turn through the glade, out by the gate's way.
            const { gate } = leg;
            const via = this.gateVia(gate) || gate.via;
            const mids = rng() < 0.55 ? this.meanderPoints(rng, L, via, 1) : [];
            return this.clearTrunks(floored([S, L, ...mids, via, gate.at]));
        }
        let A2;
        let A3;
        // Its way in: low and up into the perch most often, sometimes nearly level, sometimes an arc over.
        const shape = leg.style === 'strike' || leg.style === 'climb' ? 'swoop'
            : weighted(rng, [['swoop', 0.5], ['level', 0.3], ['over', 0.2]]);
        const near = nearTrunk(to);
        const kind = leg.kind || this.flightKind(rng, leg, dist, near);
        leg.kind = kind;
        let mids = null;
        let appr;
        if (leg.style === 'strike') {
            // A long falling glide, then the stoop: in steeply at the end, talons first.
            A3 = add(E, toward, -2.7 - rng() * 0.6, 1.05);
            A2 = add(E, toward, -0.95, 0.34);
        } else {
            // In toward the perch travelling the way it will face when it comes from that side, otherwise
            // the way it comes (it turns on the perch as it settles). Never a U-turn at the end.
            const lean = 0.4 + rng() * 0.35;
            appr = dotFacing(to, toward) > 0.2
                ? flat([mix(toward[0], facing(to)[0], lean), 0, mix(toward[2], facing(to)[2], lean)]) : toward;
            if (kind === 'overshoot') {
                // Past the perch, a little above it, round in a wide turn and back to it from beyond.
                const turnSide = rng() < 0.5 ? -1 : 1;
                const at = (along, across, up) => [E[0] + toward[0] * along + side[0] * across * turnSide,
                    E[1] + up, E[2] + toward[2] * along + side[2] * across * turnSide];
                const loop = [at(-3, 0.3, 1.1), at(4.5, 1.2, 0.9), at(6.5, 4, 1.1), at(4.5, 6.8, 0.7)];
                if (loop.every((q) => this.airClear(q, 0.9))) {
                    mids = loop;
                    appr = flat([E[0] - loop[3][0], 0, E[2] - loop[3][2]]);
                } else {
                    leg.kind = 'meander';
                }
            }
            if (near > 0) {
                const k = near * 0.85;
                const o = outward(to);
                appr = flat([mix(appr[0], -o[0], k), 0, mix(appr[2], -o[2], k)]);
            }
            // The swoop up is shallower where the perch stands low over the floor.
            const room = Math.max(0.1, E[1] - this.groundHeight(E[0] - appr[0] * 3.3, E[2] - appr[2] * 3.3) - 1.2);
            const drop = { swoop: 0.85, level: 0.3, over: 0.4 }[shape];
            A3 = add(E, appr, -3.3, -Math.min(drop, room));
            A2 = add(E, appr, -1.05, -Math.min(shape === 'level' ? 0.08 : 0.22, room * 0.3));
        }
        const begin = entering ? S : L;
        if (!mids && leg.kind === 'patrol') mids = this.patrolPoints(rng, begin, A3);
        if (!mids && leg.kind === 'circle') mids = this.circlePoints(rng, begin, A3);
        if (!mids && leg.kind !== 'direct' && leg.style !== 'strike') {
            mids = this.meanderPoints(rng, begin, A3, Math.max(1, Math.min(4, Math.round(dist / 6))));
            if (leg.kind !== 'meander') leg.kind = 'meander';
        }
        if (!mids) {
            mids = [];
            const count = dist > 22 ? 2 : 1;
            for (let k = 1; k <= count; k += 1) {
                const f = k / (count + 1);
                let dip = Math.min(2.4, dist * 0.09) * Math.sin(Math.PI * f);
                if (leg.style === 'climb') dip = -0.4;
                else if (shape === 'level') dip *= 0.3;
                else if (shape === 'over') dip = -Math.min(2.2, dist * 0.08) * Math.sin(Math.PI * f);
                const sway = (rng() - 0.5) * Math.min(4, dist * 0.18);
                mids.push([mix(begin[0], A3[0], f) + side[0] * sway, mix(begin[1], A3[1], f) - dip,
                    mix(begin[2], A3[2], f) + side[2] * sway]);
            }
        }
        const points = entering ? [from.gate.at, S, ...mids, A3, A2, E] : [S, L, ...mids, A3, A2, E];
        // Never through the floor: everything but the stoop's end keeps a metre over the moss.
        return this.clearTrunks(floored(points, leg.style === 'strike' ? 2 : 0));
    }

    /** How it flies from one perch to another this time: by weight, its mood, and what it did last. */
    flightKind(rng, leg, dist, near) {
        if (!['plain', 'enter', 'climb'].includes(leg.style)) return 'direct';
        const r = this.restless;
        const options = [['direct', 0.3], ['meander', 0.34]];
        if (dist > 5) options.push(['patrol', 0.14 * (0.4 + 1.2 * r)]);
        if (dist > 4 && near < 0.15 && leg.style === 'plain') options.push(['overshoot', 0.11]);
        if (dist > 6) options.push(['circle', 0.1 * (0.4 + 1.2 * r)]);
        const kind = weighted(rng, options.map(([k, w]) => [k, w * this.fresh(k)]));
        this.remember(kind);
        return kind;
    }

    /** Whether a point is open air it can fly through: over the floor, clear of trunks, crowns and the eye. */
    airClear(q, room = 1.0) {
        if (q[1] < this.groundHeight(q[0], q[2]) + 1.4) return false;
        if (Math.hypot(q[0] - EYE[0], q[1] - EYE[1], q[2] - EYE[2]) < EYE_ROOM + 0.5) return false;
        for (const t of this.trunks) {
            if (q[1] < t.top && Math.hypot(q[0] - t.x, q[2] - t.z) < t.r + room) return false;
        }
        for (const c of this.crowns) {
            const e = ((q[0] - c.x) ** 2 + (q[2] - c.z) ** 2) / (c.rx * c.rx) + ((q[1] - c.y) / c.ry) ** 2;
            if (e < 1.15) return false;
        }
        return true;
    }

    /** `count` turns off the straight way from `a` to `b`, to one side and the other, up and down. */
    meanderPoints(rng, a, b, count) {
        const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const l = dist || 1;
        const side = [-(b[2] - a[2]) / l, 0, (b[0] - a[0]) / l];
        const spread = Math.min(4.5, 1 + dist * 0.17);
        const out = [];
        let sign = rng() < 0.5 ? -1 : 1;
        for (let i = 0; i < count; i += 1) {
            const f = (i + 0.5 + (rng() - 0.5) * 0.4) / count;
            const sag = Math.min(2.2, dist * 0.08) * Math.sin(Math.PI * f) * (0.2 + rng() * 0.8);
            let swing = sign * spread * (0.5 + rng() * 0.7);
            const lift = (rng() - 0.5) * (0.6 + dist * 0.04);
            for (let tries = 0; tries < 3; tries += 1, swing *= 0.5) {
                const q = [mix(a[0], b[0], f) + side[0] * swing, mix(a[1], b[1], f) - sag + lift,
                    mix(a[2], b[2], f) + side[2] * swing];
                if (this.airClear(q)) {
                    out.push(q);
                    break;
                }
            }
            if (rng() < 0.7) sign = -sign;
        }
        return out;
    }

    /** A loop round the glade on its way: two to four turns through open air, then on to `b`. */
    patrolPoints(rng, a, b) {
        const out = [];
        let at = a;
        let heading = Math.atan2(b[0] - a[0], b[2] - a[2]) + (rng() - 0.5) * 2.4;
        const legs = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < legs; i += 1) {
            let found = null;
            for (let tries = 0; tries < 8 && !found; tries += 1) {
                const turn = (rng() - 0.5) * 2 * 1.75;
                const h = heading + turn;
                const reach = 6 + rng() * 6;
                const x = Math.max(OWL_AIR.x[0], Math.min(OWL_AIR.x[1], at[0] + Math.sin(h) * reach));
                const z = Math.max(OWL_AIR.z[0], Math.min(OWL_AIR.z[1], at[2] + Math.cos(h) * reach));
                const y = this.groundHeight(x, z) + mix(2.4, 7.5, rng() ** 1.3);
                const q = [x, y, z];
                if (this.airClear(q, 1.2) && Math.hypot(x - at[0], z - at[2]) > 3) {
                    found = q;
                    heading = Math.atan2(x - at[0], z - at[2]);
                }
            }
            if (!found) break;
            out.push(found);
            at = found;
        }
        return out.length ? out : null;
    }

    /** A circle once round open air on its way (radius 3-4.5 m), then on to `b`. */
    circlePoints(rng, a, b) {
        const f = 0.45 + rng() * 0.25;
        const radius = 3 + rng() * 1.5;
        const centre = [mix(a[0], b[0], f), mix(a[1], b[1], f) + 0.5 + rng(), mix(a[2], b[2], f)];
        const turn = rng() < 0.5 ? -1 : 1;
        const from = Math.atan2(a[0] - centre[0], a[2] - centre[2]);
        const out = [];
        for (let k = 0; k <= 6; k += 1) {
            const angle = from + turn * (k / 6) * 2 * Math.PI;
            const q = [centre[0] + Math.sin(angle) * radius, centre[1] + Math.sin(k * 1.1) * 0.3,
                centre[2] + Math.cos(angle) * radius];
            if (!this.airClear(q, 1.0)) return null;
            out.push(q);
        }
        return out;
    }

    /**
     * Keep a route's waypoints (not its ends) a body's width and more from every trunk below its top:
     * a point too near is pushed straight out, and a stretch between two points that passes too near
     * gets a point of its own, pushed out.
     */
    clearTrunks(points) {
        const room = 0.8;
        const push = (q, along) => {
            let moved = q;
            this.trunks.forEach((t) => {
                if (moved[1] > t.top) return;
                const dx = moved[0] - t.x;
                const dz = moved[2] - t.z;
                const d = Math.hypot(dx, dz);
                const need = t.r + room;
                if (d >= need) return;
                // Out the way it already lies from the trunk, or (dead on the axis) to the side of its way.
                const ux = d > 1e-3 ? dx / d : -along[2];
                const uz = d > 1e-3 ? dz / d : along[0];
                moved = [t.x + ux * need, moved[1], t.z + uz * need];
            });
            // Out of a crown sideways, to its edge at that height.
            this.crowns.forEach((c) => {
                const v = (moved[1] - c.y) / c.ry;
                if (v * v >= 1.1) return;
                const need = c.rx * Math.sqrt(1.1 - v * v) + 0.2;
                const dx = moved[0] - c.x;
                const dz = moved[2] - c.z;
                const d = Math.hypot(dx, dz);
                if (d >= need) return;
                const ux = d > 1e-3 ? dx / d : -along[2];
                const uz = d > 1e-3 ? dz / d : along[0];
                moved = [c.x + ux * need, moved[1], c.z + uz * need];
            });
            // And never close by the eye: out from it, upward where it can.
            const ex = moved[0] - EYE[0];
            const ey = moved[1] - EYE[1];
            const ez = moved[2] - EYE[2];
            const de = Math.hypot(ex, ey, ez);
            if (de < EYE_ROOM) {
                const k = EYE_ROOM / Math.max(de, 1e-3);
                moved = [EYE[0] + ex * k, EYE[1] + Math.max(ey * k, 1.5), EYE[2] + ez * k];
            }
            return moved;
        };
        let out = points;
        // A curve through the points cuts the corners between them, so every stretch is looked at every metre
        // and a half along it, and pushed out wherever it passes too near (three times over).
        for (let pass = 0; pass < 3; pass += 1) {
            const next = [out[0]];
            for (let i = 1; i < out.length; i += 1) {
                const a = next[next.length - 1];
                const b = out[i];
                const along = [b[0] - a[0], 0, b[2] - a[2]];
                const l = Math.hypot(along[0], along[2]) || 1;
                along[0] /= l;
                along[2] /= l;
                if (i > 1 && i < out.length - 1) {
                    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
                    const samples = Math.max(3, Math.ceil(span / 1.5));
                    for (let k = 1; k < samples; k += 1) {
                        const f = k / samples;
                        const q = [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)];
                        const pushed = push(q, along);
                        if (pushed !== q) next.push(pushed);
                    }
                }
                next.push(i === out.length - 1 ? b : push(b, along));
            }
            out = next;
        }
        return out;
    }

    beginLaunch() {
        const leg = this.trip.shift();
        if (!leg) return;
        // A leg off the ground goes to whichever perch it likes from there.
        if (!leg.to) leg.to = this.choosePerch(this.perch, leg.back);
        this.leg = leg;
        const rng = this.streams.trips;
        const points = this.route(this.perch, leg);
        // No two flights alike: a little quicker or slower, its wingbeat too, now and then flapped all the way.
        const pace = 0.86 + rng() * 0.26;
        const beat = OWL_FLIGHT.beat * (0.92 + rng() * 0.16);
        const flapped = rng() < 0.25 ? 0.35 : 0;
        this.flight = planFlight(points, {
            work: { climb: 0.8, moon: 0.25, hop: 0.7 }[leg.style] ?? flapped,
            cruise: (leg.style === 'moon' ? 5.6 : OWL_FLIGHT.cruise) * pace,
            beat,
            exit: leg.style === 'exit',
        });
        this.launchFrom = { ...this.attitude };
        const off = this.flight.tangent[2];
        this.launchHeading = Math.atan2(off[0], off[2]);
        // A bigger turn on the perch before it goes takes a little longer.
        const turn = Math.abs(wrapAngle(this.launchHeading - this.attitude.heading));
        this.launchLength = OWL_TIMING.launch * (leg.style === 'hop' ? 0.8 : 1) + 0.5 * (turn / Math.PI);
        if (this.perch === this.home && leg.to !== this.home) this.leftHomeAt = this.time;
        this.crossfade(0.2);
        this.mode = 'launch';
        this.launchAt = this.time;
    }

    /** Back into the glade: out of the gate it chooses (not the one it left by, if it can), already flying. */
    beginEnter() {
        const leg = this.trip.shift();
        if (!leg) return;
        const rng = this.streams.trips;
        const gates = this.openGates();
        const left = this.perch.gate;
        const asked = gates.find((g) => g.id === this.backBy);
        this.backBy = null;
        const gate = asked || (gates.length ? weighted(rng, gates.map((g) => [g, g === left ? 0.3 : 1])) : left);
        const from = this.gateStop(gate);
        this.perch = from;
        // Home likelier than anywhere else (and always home under reduced motion).
        if (!leg.to) leg.to = this.motion < 0.5 ? this.home : this.choosePerch(from, this.home);
        this.leg = leg;
        const points = this.route(from, leg);
        const pace = 0.86 + rng() * 0.26;
        const beat = OWL_FLIGHT.beat * (0.92 + rng() * 0.16);
        this.flight = planFlight(points, {
            cruise: OWL_FLIGHT.cruise * pace, beat, work: rng() < 0.3 ? 0.35 : 0, enter: true,
        });
        const off = this.flight.tangent[0];
        this.launchHeading = Math.atan2(off[0], off[2]);
        this.attitude.heading = this.launchHeading;
        this.fade = null;
        this.mode = 'flight';
        this.flightAt = this.time;
        this.flightHead = [0, 58, 0];
        this.lookDir = null;
    }

    beginFlight() {
        this.crossfade(0.32);
        this.mode = 'flight';
        this.flightAt = this.time;
        this.flightHead = this.pose.head.slice();
        this.lookDir = null;
    }

    arrive() {
        const { leg } = this;
        if (leg.style === 'exit') {
            // Out of the glade: gone a while (longer when it is still, shorter when restless), then back.
            this.mode = 'away';
            this.perch = leg.to;
            this.leg = null;
            this.flight = null;
            const away = stayFor(this.streams.trips, OWL_TIMING.away) * mix(1.3, 0.7, this.restless);
            this.trip = [{ style: 'enter', to: null }];
            this.departAt = this.time + away;
            this.awayUntil = this.departAt;
            return;
        }
        this.crossfade(0.3);
        this.perch = leg.to;
        this.mode = 'perched';
        this.landedAt = this.time;
        this.landFrom = { ...this.attitude };
        this.landBeat = { ...this.sample };
        this.leg = null;
        this.flight = null;
        this.groundCatch = leg.catch !== false;
        if (leg.to === this.home) this.leftHomeAt = Infinity;
        if (leg.to.kind !== 'ground') {
            this.visits = [leg.to.id, ...this.visits.filter((id) => id !== leg.to.id)].slice(0, 3);
        }
        // It lands facing the way it flew and turns on the perch to face out; come in from behind a branch
        // and now and then it stays facing away a while.
        const rng = this.streams.wander;
        const out = leg.to.heading;
        const behind = Math.abs(wrapAngle(this.landFrom.heading - out)) > 2.2;
        this.turned = leg.to.kind === 'branch' && behind && rng() < 0.4;
        this.seatHeading = this.turned ? wrapAngle(out + Math.PI) : out;
        if (leg.to.kind === 'ground') this.seatHeading = this.landFrom.heading;
        const stay = Number.isFinite(leg.stay) ? leg.stay : Infinity;
        this.departAt = this.trip.length ? this.time + stay : Infinity;
        if (!this.trip.length) {
            const range = leg.to === this.home ? OWL_TIMING.homeStay : OWL_TIMING.stay;
            this.decideAt = this.time + OWL_TIMING.settle + stayFor(rng, range);
        }
        this.gaze.from = [0, -8, 0];
        this.gaze.to = [0, -8, 0];
        this.gaze.next = this.time + OWL_TIMING.settle + (leg.to.kind === 'ground' && !this.groundCatch ? -0.5 : 0.4);
    }

    /** From now, for `length` seconds, every number of the pose eases over from what it is this moment. */
    crossfade(length) {
        this.fade = { from: snapshot(this.pose), start: this.time, length };
    }

    // -- the clock ---------------------------------------------------------------------------
    /**
     * Step `dt` seconds. `frame` is the reactions' frame (its `owl` cues are heard); `motion` 0..1 scales
     * the size of every movement, and below a half the owl stays where it is (reduced motion).
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
        const calm = motion < 0.5;
        // Each change happens at the moment it falls due, not at the frame that notices it, so a night
        // lived at any frame rate keeps the same times.
        const actEnd = this.act ? this.act.start + this.act.length : Infinity;
        if (t >= actEnd) this.at(actEnd, () => this.endAct());
        if (this.mode === 'perched' && !this.act) {
            if (calm || this.still) {
                this.trip = this.trip.filter(() => !calm);
                if (calm) this.departAt = Infinity;
                this.decideAt = Math.max(this.decideAt, t + 5);
            }
            // (Never dated before this frame's step: a move held up by an act happens now, not in the past.)
            const since = t - dt;
            if (this.trip.length && t >= this.departAt) {
                this.at(Math.max(this.departAt, since), () => this.beginLaunch());
            } else if (!this.trip.length && t >= this.decideAt && this.settled()) {
                this.at(Math.max(this.decideAt, this.landedAt + OWL_TIMING.settle, since), () => this.decide());
            }
        }
        if (this.mode === 'away') {
            // Under reduced motion it comes straight home.
            if (calm) this.departAt = Math.min(this.departAt, t + 1);
            if (this.trip.length && t >= this.departAt) {
                this.at(Math.max(this.departAt, t - dt), () => this.beginEnter());
            }
        }
        if (this.mode === 'launch' && t >= this.launchAt + this.launchLength) {
            this.at(this.launchAt + this.launchLength, () => this.beginFlight());
        }
        if (this.mode === 'flight' && t >= this.flightAt + this.flight.duration) {
            this.at(this.flightAt + this.flight.duration, () => this.arrive());
        }
        // Its bigger acts, each on its own clock; when one falls due while it is busy it waits a little.
        BIG_ACTS.forEach((kind) => {
            if (t < this.schedule[kind]) return;
            const rng = this.streams[kind];
            const roll = rng();
            const free = this.mode === 'perched' && !this.act && !this.trip.length && this.settled()
                && this.perch.kind !== 'ground' && t < this.decideAt - 1.5;
            // It dozes when it is drowsy or has been left alone; otherwise it lets the chance go by.
            const wanted = kind !== 'doze' || this.drowsy > 0.3 || this.quiet > 40 || roll < 0.3;
            const dueAt = Math.max(this.schedule[kind], t - this.step);
            const went = free && wanted && this.at(dueAt, () => this.startAct(kind));
            this.schedule[kind] = t + (went || (free && !wanted) ? between(rng, OWL_TIMING[kind]) : 3 + rng() * 6);
        });
        // The small acts fall due whatever it is doing (they only show on a perch); blinks always.
        if (this.mode === 'perched' && t >= this.gaze.next && t > this.stareUntil
            && t > this.landedAt + OWL_TIMING.settle && !this.act) this.chooseLook();
        if (t >= this.blinkAt.next) {
            this.blinkAt.start = t;
            const { blink } = this.streams;
            this.blinkAt.length = OWL_TIMING.blinkLength * (1 + this.drowsy * 2.5) * (0.85 + blink() * 0.3);
            const wink = blink() < 0.5 ? -1 : 1;
            this.blinkAt.wink = blink() < 0.12 ? wink : 0;
            this.blinkAt.next = t + between(blink, OWL_TIMING.blink) * (1 + this.alert * 0.6);
        }
        const quietHead = !this.act || this.act.kind === 'tall';
        const due = (act, range, rng) => {
            if (t >= act.next) {
                act.start = this.mode === 'perched' && t > this.landedAt + OWL_TIMING.settle && quietHead ? t : -10;
                act.next = t + between(rng, range);
            }
        };
        due(this.peerAt, OWL_TIMING.peer, this.streams.peer);
        if (t >= this.tiltAt.next) {
            this.tiltAt.start = this.mode === 'perched' && quietHead ? t : -10;
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

    /** Run `fn` as of time `when` (a moment in this frame's step): what it schedules counts from then. */
    at(when, fn) {
        const now = this.time;
        this.time = Math.min(now, when);
        try {
            return fn();
        } finally {
            this.time = now;
        }
    }

    // -- the pose -----------------------------------------------------------------------------
    compose(motion) {
        const { pose } = this;
        // Away from the glade nothing is drawn; the pose waits as it left.
        if (this.mode === 'away') return;
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
            tuck: 0, reach: 0, grip: 1, spread: 0, lift: 0, back: 0,
        }));
        this.actLids = 0;
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
        // up when it is startled; an act (a doze, a preen) may close them further.
        const lids = Math.max(this.actLids, (0.14 * (1 - this.alert * 0.6) + this.drowsy * 0.55 * (1 - this.alert))
            * (this.mode === 'perched' ? 1 : 0.5));
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
        let heading = this.seatHeading;
        this.place.x = p.x;
        this.place.y = p.y;
        this.place.z = p.z;
        this.sway = qAxis(0, 1, 0, (sway * 0.6 + rouse.shake * 3) * DEG, this.sway || [0, 0, 0, 1]);
        if (ground) {
            // Mantled over its catch: bowed over it, the wings spread wide and drooped round it like a cape,
            // the tail fanned flat behind (it keeps the wings open from the strike, no fold between). After a
            // miss it folds them and stands up in the ferns, looking about.
            const mantle = this.groundCatch ? 1 : 1 - smooth(0.3, 1.1, landed);
            const breathe = Math.sin((t - this.landedAt) * 2.1) * 0.5 + 0.5;
            pitch = mix(44, 28, mantle);
            pose.wings.forEach((w) => Object.assign(w, {
                fold: mix(1, 0.12 + breathe * 0.04, mantle),
                dihedral: mix(-5, -16 - breathe * 3, mantle),
                sweep: -16 * mantle,
                twist: 8 * mantle,
                fan: mix(1, 1.15, mantle),
                alula: 0.5 * mantle,
            }));
            pose.tail.fan = mix(1.1, 1.6, mantle);
            pose.tail.pitch = mix(-6, -12, mantle);
            head[1] = mix(head[1], -40, mantle * 0.8);
            pose.tufts = this.groundCatch ? Math.min(pose.tufts, 0.4) : Math.max(pose.tufts, 0.7);
            pose.legs.forEach((leg) => { leg.grip = 0.85; });
            pose.perch = 0.03;
        }
        // The act it is in, if any: a sidle, a hop round, a stretch, a preen, a doze, the tall stance.
        if (this.act && t >= this.act.start) {
            const r = this.composeAct(head, motion);
            pitch += r.pitch;
            bank += r.bank;
            if (Number.isFinite(r.heading)) ({ heading } = r);
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
            const turn = wrapAngle(this.seatHeading - this.landFrom.heading);
            heading = this.landFrom.heading + turn * smooth(0.1, 1.0, age);
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
    }

    /**
     * The current act's share of the perched pose (written into `head` and the pose; the pitch and bank
     * it adds, and the heading it sets if it turns the owl, are returned).
     */
    composeAct(head, motion) {
        const { pose, act, time: t } = this;
        const a = clamp01((t - act.start) / act.length);
        const out = { pitch: 0, bank: 0, heading: NaN };
        switch (act.kind) {
        case 'sidle': {
            // Sideways along the limb a step at a time: one foot lifted and set down further along, the other
            // brought up beside it, the body rocking over the foot that holds; the head held still.
            const run = clamp01((t - act.start - 0.15) / (act.length - 0.35)) * act.steps;
            const step = Math.min(act.steps - 1, Math.floor(run));
            const f = run >= act.steps ? 1 : run - step;
            const along = (step + minJerk(f)) / act.steps;
            const u = mix(act.from.u, act.to.u, along);
            const here = limbAt(act.limb, u, this.limbPoint);
            this.place.x = here.x;
            this.place.y = here.top;
            this.place.z = here.z;
            pose.perch = here.radius;
            const across = this.turned ? wrapAngle(act.to.heading + Math.PI) : act.to.heading;
            const fromH = this.seatHeading;
            out.heading = fromH + wrapAngle(across - fromH) * along;
            const lift = run >= act.steps ? 0 : Math.sin(Math.PI * f);
            const foot = (step % 2 === 0) ? act.lead : 1 - act.lead;
            const leg = pose.legs[foot];
            leg.tuck = 0.24 * lift * motion;
            leg.grip = 1 - 0.7 * lift;
            leg.spread = 0.25 * lift;
            // Weight comes off the lifted foot: the body rolls toward the one that holds.
            out.bank = (foot === 0 ? -1 : 1) * 4 * lift * motion;
            pose.lift[1] -= 0.006 * lift;
            pose.wings.forEach((w) => { w.fold = Math.min(w.fold, 0.97); });
            // The head stays on what it watched while the body turns under it.
            head[0] -= (out.heading - fromH) / DEG;
            break;
        }
        case 'turn': {
            // A hop round: the head swivels round first, then a crouch, a spring with the wings flicked open
            // and the body turned in the air, and down again facing the other way.
            const by = act.by / DEG;
            const lead = minJerk(a / 0.36) * 0.85 + minJerk((a - 0.55) / 0.4) * 0.15;
            const body = minJerk((a - 0.3) / 0.46);
            out.heading = act.from + act.by * body;
            head[0] = mix(head[0], 0, minJerk(a / 0.3)) + by * (lead - body);
            head[1] = mix(head[1], -6, smooth(0, 0.3, a));
            const crouch = bell(a / 0.42, 0.5, 0.3);
            const air = clamp01(Math.sin(Math.PI * clamp01((a - 0.36) / 0.36)));
            pose.lift[1] += -0.025 * crouch + 0.06 * air * motion;
            // The feet loosen their hold for the spring (never flung open: it is a small hop).
            pose.legs.forEach((leg) => {
                leg.lift = crouch;
                leg.grip = 1 - 0.55 * air;
                leg.spread = 0.25 * air;
            });
            pose.wings.forEach((w) => {
                w.fold = 1 - 0.38 * bell((a - 0.3) / 0.5, 0.3, 0.5);
                w.dihedral = 22 * bell((a - 0.3) / 0.5, 0.3, 0.5);
            });
            pose.tail.fan += 0.35 * air;
            out.pitch = -8 * crouch + 4 * air;
            break;
        }
        case 'stretch': {
            if (act.variant === 'wingsUp') {
                // Both wings raised high over its back, half open, held a moment.
                const w = bell(a, 0.32, 0.3) * Math.max(0.5, motion);
                pose.wings.forEach((wing) => {
                    wing.fold = mix(wing.fold, 0.56, w);
                    wing.dihedral = mix(wing.dihedral, 102, w);
                    wing.sweep = mix(wing.sweep, 6, w);
                    wing.twist = mix(wing.twist, 22, w);
                    wing.fan = mix(wing.fan, 1.12, w);
                });
                pose.tufts = Math.max(pose.tufts, 0.8 * w);
                pose.ruffle += 0.2 * w;
                head[1] += 6 * w;
                out.pitch = 3 * w;
            } else {
                // One wing stretched down and back, fanned, with the leg on that side reaching out behind
                // it, the tail fanned and swung the same way; the owl leans onto its other foot.
                const s = act.side;
                const sign = s === 0 ? 1 : -1;
                const w = bell(a, 0.28, 0.32) * Math.max(0.5, motion);
                const wing = pose.wings[s];
                wing.fold = mix(wing.fold, 0.2, w);
                wing.dihedral = mix(wing.dihedral, -46, w);
                wing.sweep = mix(wing.sweep, 36, w);
                wing.twist = mix(wing.twist, -8, w);
                wing.fan = mix(wing.fan, 1.3, w);
                wing.alula = 0.3 * w;
                const leg = pose.legs[s];
                leg.back = w;
                leg.grip = 1 - 0.9 * w;
                leg.spread = 0.3 * w;
                pose.tail.fan += 0.8 * w;
                pose.tail.yaw += sign * 16 * w;
                pose.tail.pitch -= 4 * w;
                out.pitch = -9 * w;
                out.bank = -sign * 6 * w;
                head[0] += sign * 10 * w;
            }
            break;
        }
        case 'preen': {
            // Its face buried in its breast or turned under a shoulder, nibbling and drawing feathers
            // through its bill, the plumage fluffed, its eyes half shut.
            const w = bell(a, 0.14, 0.18);
            const aims = { breast: [0, -62, 8], left: [78, -40, 22], right: [-78, -40, -22] };
            const aim = aims[act.target] || aims.breast;
            const age = t - act.start;
            const tug = Math.max(0, Math.sin(age * 7.1 + act.seed)) ** 6;
            const nibble = [Math.sin(age * 19 + act.seed) * 3, (Math.sin(age * 11.3 + act.seed) * 0.5 + 0.5) * 4
                + tug * 7, Math.sin(age * 13.7) * 3];
            for (let i = 0; i < 3; i += 1) head[i] = mix(head[i], aim[i] + nibble[i] * motion, w);
            pose.ruffle += 0.55 * w;
            pose.neck -= 0.01 * w;
            if (act.target !== 'breast') {
                const wing = pose.wings[act.target === 'left' ? 0 : 1];
                wing.fold = Math.min(wing.fold, 1 - 0.12 * w);
                wing.dihedral += 10 * w;
            }
            this.actLids = 0.55 * w;
            out.pitch = -4 * w;
            break;
        }
        case 'doze': {
            // Eyes closed, fluffed out, the head sunk into its shoulders; now and then an eye opens a slit.
            const w = bell(a, 0.12, 0.15);
            const age = t - act.start;
            const phase = (age + act.seed * act.peek) % act.peek;
            const peek = (phase < 0.9 ? bell(phase / 0.9, 0.3, 0.4) : 0) * smooth(2, 3, age);
            this.actLids = w * (0.94 - 0.45 * peek);
            pose.tufts = mix(pose.tufts, 0.1, w);
            pose.ruffle += 0.4 * w + 0.05 * Math.sin(age * 1.3) * w;
            pose.neck -= 0.012 * w;
            head[0] *= 1 - 0.5 * w;
            head[1] -= 10 * w;
            head[2] += 5 * w;
            out.pitch = -3 * w;
            pose.lift[1] -= 0.006 * w;
            break;
        }
        case 'tall': {
            // Drawn up tall and thin, the plumage sleeked flat, the tufts raised, staring.
            const w = bell(a, 0.1, 0.35);
            pose.ruffle = mix(pose.ruffle, -0.5, w);
            pose.tufts = Math.max(pose.tufts, w);
            pose.neck += 0.024 * w;
            pose.lift[1] += 0.012 * w;
            pose.wings.forEach((wing) => { wing.dihedral -= 3 * w; });
            out.pitch = 7 * w;
            break;
        }
        default:
            break;
        }
        return out;
    }

    composeFlight() {
        const { pose, flight } = this;
        const t = this.time - this.flightAt;
        const s = sampleFlight(flight, t, this.sample);
        const { leg } = this;
        const strike = leg.style === 'strike';
        // Its attitude: nose along the path (a little less steep than the path itself), banked into turns.
        // Leaving the glade it never lands; coming back in it is already flying.
        const flare = leg.style === 'exit' ? 0 : 1 - smooth(0, OWL_TIMING.flare, s.left);
        const start = leg.style === 'enter' ? 1 : smooth(0, 0.45, t);
        const amp = Math.max(s.amp, flare * (strike ? 0.35 : 0.95));
        const beat = wingbeat(s.phase, amp, pose.wings[0], { out: this.beat });
        Object.assign(pose.wings[1], pose.wings[0]);
        let pitch = Math.max(-28, Math.min(22, s.climb * 0.6)) + beat.pitch;
        // The landing: upright, wings forward and braking, tail fanned down, talons reaching; a stoop
        // instead throws the feet far forward under wings raised high and back. A hop between limbs by a
        // trunk is made with the wings half open and held high.
        const flarePitch = strike ? 48 : 58;
        pitch = mix(pitch, flarePitch, flare * flare);
        const hop = leg.style === 'hop';
        pose.wings.forEach((w) => {
            w.sweep += -20 * flare;
            w.twist += (strike ? 10 : 24) * flare;
            w.fan += 0.32 * flare;
            w.alula = flare;
            if (strike) w.dihedral = mix(w.dihedral, 48, flare);
            if (hop) {
                w.fold = Math.max(w.fold, 0.42);
                w.dihedral += 14;
            }
        });
        pose.tail.fan = 1.08 + 0.75 * flare;
        pose.tail.pitch = beat.tail - 22 * flare;
        // The legs tuck up out of the launch and reach down for the landing: on a short hop the two meet,
        // so the tuck is whichever is less, never a switch from one to the other.
        pose.legs.forEach((l) => Object.assign(l, {
            tuck: Math.min(smooth(0.3, 1, start), 1 - smooth(0.05, 0.75, flare)),
            reach: smooth(0.1, 0.8, flare),
            grip: 0.6 * (1 - flare),
            spread: smooth(0.4, 0.95, flare),
            lift: 0,
        }));
        // Out of the launch: from the crouch's lean to the flight's, the wings from half open to spread.
        if (start < 1) {
            pitch = mix(this.launchAttitude().pitch, pitch, start);
            pose.wings.forEach((w) => { w.fold = Math.max(hop ? 0.42 : 0, (1 - smooth(0, 0.6, start)) * 0.35); });
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
        // Never over its shoulder in the air: a mark far off its way (or nearly straight above or below it,
        // where a turn of the head has no sure direction) is let go, gradually, for the way ahead; and it
        // never looks more than 45 degrees up or 55 down.
        const tx = target.x - s.x;
        const tz = target.z - s.z;
        const reach = Math.hypot(tx, tz);
        const off = Math.abs(wrapAngle(Math.atan2(tx, tz) - s.heading));
        const letGo = Math.max(smooth(55 * DEG, 80 * DEG, off) * smooth(0.15, 0.3, reach), 1 - smooth(0.3, 0.7, reach));
        const eyeY = s.y + 0.2;
        const level = Math.max(-reach * 1.43, Math.min(reach, target.y - eyeY));
        const way = {
            x: s.x + Math.sin(s.heading) * 2,
            y: eyeY + Math.max(-1.2, Math.min(0.6, s.vy * 0.3)),
            z: s.z + Math.cos(s.heading) * 2,
        };
        target = {
            x: mix(target.x, way.x, letGo),
            y: mix(eyeY + level, way.y, letGo),
            z: mix(target.z, way.z, letGo),
        };
        // Where it looks is eased as a direction (a mark that changes is turned to quickly, never in a frame,
        // and a look high overhead swings no faster than any other), then the head is turned to it.
        const eye = { x: s.x, y: s.y + 0.2, z: s.z };
        const want = [target.x - eye.x, target.y - eye.y, target.z - eye.z];
        const wl = Math.hypot(...want) || 1;
        if (!this.lookDir) this.lookDir = [Math.sin(heading), 0, Math.cos(heading)];
        const kd = 1 - Math.exp(-(this.step || 0) * 8);
        const ld = this.lookDir.map((c, i) => c + (want[i] / wl - c) * kd);
        const ll = Math.hypot(...ld) || 1;
        this.lookDir = ld.map((c) => c / ll);
        this.headToward(
            { x: eye.x + this.lookDir[0], y: eye.y + this.lookDir[1], z: eye.z + this.lookDir[2] },
            heading,
            pitch,
            bank,
        );
        // And the head's angles still follow quickly but never in a frame (out of the launch's pose).
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
            act: this.act ? this.act.kind : null,
            turned: this.turned,
            leg: this.leg ? `${this.leg.style}:${this.leg.to.id}${this.leg.kind ? `:${this.leg.kind}` : ''}` : null,
            restless: Math.round(this.restless * 100) / 100,
            back: this.mode === 'away' ? Math.round(this.departAt * 10) / 10 : null,
            gates: this.openGates().map((g) => g.id),
            trip: this.trip.map((leg) => `${leg.style}:${leg.to?.id ?? 'any'}`),
            alert: Math.round(this.alert * 100) / 100,
            drowsy: Math.round(this.drowsy * 100) / 100,
            head: this.pose.head.map((v) => Math.round(v)),
            at: [this.place.x, this.place.y, this.place.z].map((v) => Math.round(v * 100) / 100),
            decideAt: Math.round(this.decideAt * 10) / 10,
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
