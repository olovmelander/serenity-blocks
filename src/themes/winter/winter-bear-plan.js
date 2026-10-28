/**
 * Winter — where the polar bear goes, how it puts its feet down, and what it does when it stops.
 * Three-free and renderer-free: its body (winter-bear-rig.js) solves the pose this resolves and the
 * model (winter-bear.js) draws it.
 *
 * A polar bear walks the frozen lake beyond the snowfield, forty to a hundred and forty metres out.
 * It knows several ways over the ice (BEAR_ROUTES): the long round it has always walked, a close look
 * in the open ice right of the board, a far crossing, a brisk walk through, a slow wander with
 * many stops, a wide sweep far out. Each is a closed curve laid out in fractions of the frame's half
 * width (as the fox's round is) that leaves from and comes back to the same place just beyond the
 * frame's right edge, out of sight; there it may stand a while before it comes again, by whichever
 * way it chooses (never the same twice running). Its walk along each is a timeline of legs and
 * stops, and which way it takes each time, and how long it stays away, are dealt from its own seed,
 * so where its body is and what it is doing are still a function of its clock and nothing else.
 *
 * Its feet are too. Each paw is put down in the world and stays where it was put while the body
 * goes over it: through a turn, slowing down, stopping. A paw lands where it will stand under the
 * body halfway through its time on the ice, which the course knows in advance, so as the bear slows
 * to a stop its last steps land under it, and a foot that was left behind takes a step to square
 * up once it has stopped. The rhythm is a four-beat walk (left hind, left fore, right hind, right
 * fore), its strides shorter and its swings no slower as it slows, so it never walks in slow
 * motion; a paw swings on a smooth path that leaves and meets the ice at rest, the forepaw curled
 * as it goes, the heel peeling off the ice before it lifts. The body rides the feet: the shoulders
 * roll and the hips sway over whichever feet are down, the head swings to the side of the planted
 * forepaw, and the back follows the curve of the path, the hips walking where the chest has been.
 * All of it is closed form in the clock, so a seek, a replay or a capture shows the same frame at
 * any frame rate.
 *
 * The board can make it stop. Four lines and the fox of light: it stands up on its hind legs to
 * watch it go. The run ends: it lies down on the ice, head on its paws, until the next run begins,
 * then gets up and walks on. Each is laid over whatever it was doing, and its clock slows to a halt
 * under it and picks up again after, so nothing jumps and the walk resumes where it left off.
 */

import {
    TAU, bearingFor, clamp01, groundHeight, halfWidthFor, mulberry32, smooth,
} from './winter-core.js';
import {
    BEAR_ACTS, BEAR_BONES, BEAR_FEET, BEAR_MARKS, BEAR_SCALE, BEAR_SPEC as SPEC, FOOT, LIE_HOLD, OWNS_FEET, bearAct,
    createBearSpec,
} from './winter-bear-rig.js';

const SNIFF = Object.freeze(['Sniff', 7.2]);
const SCENT = Object.freeze(['Scent', 5.4]);
const LOOK = Object.freeze(['Look', 5.6]);
const PAUSE = Object.freeze(['Stand', 2.4]);
/** Where its ways meet, out of sight: it stands there a moment between one and the next. */
const AWAY = Object.freeze(['Stand', 2.8]);
const knot = (fraction, dist, stop = null) => Object.freeze([fraction, dist, stop]);

/**
 * A knot's fraction at or past this is not a fraction: it stands just beyond the frame's own right
 * edge (however wide the screen), out of sight.
 */
export const BEAR_EDGE = 9;
/** How far past the frame's edge that is (radians). */
const EDGE_PAST = (9 * Math.PI) / 180;

/** Every way starts here, out of sight past the right edge, and comes in behind the trees. */
const SETTING_OUT = Object.freeze([knot(BEAR_EDGE, 76, AWAY), knot(1.06, 72), knot(0.85, 70)]);
/** ...and leaves by the trees on the right, back to where it started. */
const COMING_BACK = Object.freeze([knot(0.95, 80), knot(1.1, 79)]);
const wayVia = (...middle) => Object.freeze([...SETTING_OUT, ...middle, ...COMING_BACK]);

/**
 * Its first way: [fraction of the half width, metres from the eye, what it does when it gets there
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
export const BEAR_ROUTE = wayVia(
    // In from behind the trees on the right: it noses about in the window, nearer and nearer...
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
);

/**
 * Every way it knows, with the pace it walks it at (m/s) and how likely it is to choose it. The
 * first is the way above; it always begins with that.
 */
export const BEAR_ROUTES = Object.freeze([
    Object.freeze({
        name: 'round', route: BEAR_ROUTE, pace: 1.2, weight: 1.2,
    }),
    // A close look: in near the board's edge, a long sniff, a look round, a pause, and away.
    Object.freeze({
        name: 'close',
        route: wayVia(
            knot(0.6, 61),
            knot(0.42, 54),
            knot(0.32, 47, Object.freeze(['Sniff', 6.4])),
            knot(0.38, 43),
            knot(0.43, 49, LOOK),
            knot(0.34, 57),
            knot(0.27, 63),
            knot(0.36, 70, Object.freeze(['Stand', 3.4])),
            knot(0.62, 84),
        ),
        pace: 1.05,
        weight: 1,
    }),
    // A far crossing: out over the lake behind the board and back, scenting the wind on the way.
    Object.freeze({
        name: 'far',
        route: wayVia(
            knot(0.62, 86),
            knot(0.4, 95, SCENT),
            knot(0.1, 99),
            knot(-0.3, 103),
            knot(-0.52, 112),
            knot(-0.3, 124),
            knot(0.1, 124),
            knot(0.32, 116, LOOK),
            knot(0.5, 104),
            knot(0.68, 92),
        ),
        pace: 1.3,
        weight: 0.8,
    }),
    // Passing through: a short pause in the window, then off behind the board and round.
    Object.freeze({
        name: 'through',
        route: wayVia(
            knot(0.55, 63),
            knot(0.32, 62, PAUSE),
            knot(0.08, 58),
            knot(-0.25, 60),
            knot(-0.5, 68),
            knot(-0.42, 82),
            knot(-0.05, 88),
            knot(0.3, 86),
            knot(0.6, 84),
        ),
        pace: 1.3,
        weight: 1,
    }),
    // Lingering: slow, stopping again and again in the window, deeper each time.
    Object.freeze({
        name: 'linger',
        route: wayVia(
            knot(0.6, 62),
            knot(0.41, 56, SNIFF),
            knot(0.3, 50),
            knot(0.24, 54, SCENT),
            knot(0.29, 62),
            knot(0.4, 68, LOOK),
            knot(0.3, 76, Object.freeze(['Stand', 3])),
            knot(0.38, 86, Object.freeze(['Sniff', 5.4])),
            knot(0.62, 88),
        ),
        pace: 1.0,
        weight: 0.9,
    }),
    // A wide sweep far out, small in the distance.
    Object.freeze({
        name: 'wide',
        route: wayVia(
            knot(0.7, 90),
            knot(0.4, 108, SNIFF),
            knot(0.12, 124),
            knot(-0.25, 130),
            knot(-0.48, 120),
            knot(-0.15, 110),
            knot(0.28, 100, LOOK),
            knot(0.6, 92),
        ),
        pace: 1.2,
        weight: 0.7,
    }),
]);

/** Seconds it may stay out of sight between one way and the next (drawn skewed toward short). */
export const BEAR_AWAY = Object.freeze([0, 70]);

/** Metres a second it ambles at (it is drawn larger than life: its strides are too). */
export const BEAR_PACE = 1.2;
/** Seconds it takes to get going, or to come to a stop. */
export const BEAR_RAMP = 2.2;
/** Seconds a stop takes to cross-fade in (or a walk out of one). */
export const BEAR_BLEND = 1.1;
/** Seconds the board's stops take to bring it to a halt, and to let it go again. */
export const BEAR_EASE = 1.2;
/** Where on its clock it starts (seconds): just short of coming out from behind the trees. */
const START_KNOT = SETTING_OUT.length;
const START_LEAD = 6;

/**
 * Its gait, in world metres and seconds.
 *  stride      metres a stride: base + rate × speed (shorter steps as it slows, never slow ones)
 *  falls       when in a stride each paw lands (BEAR_FEET order: FL, FR, BL, BR): left hind, left
 *              fore a fifth of a stride on, then the right pair half a stride after
 *  swingShare  the share of a stride a paw is off the ice at its pace; swingTime bounds it (s)
 *  lead        the most a landing looks ahead for where the body will be (s)
 *  lift        how high each paw is carried; peel, how far its heel comes up before it leaves the
 *              ice; flick, how far the paw curls as it swings (radians)
 *  turnIn      how far each paw is turned in (radians): a polar bear is pigeon-toed in front
 *  settle      a paw further than this from where it stands takes a step once the bear stops
 *  cadence     the fewest strides a second it takes once under way; setOff, how many more it
 *              takes setting off and coming to a stop (short quick steps, so no paw is left behind)
 *  climb       how much a slope shortens its strides: by 1 / (1 + climb × gradient), up or down
 */
export const BEAR_GAIT = Object.freeze({
    stride: Object.freeze([0.72, 0.88]),
    falls: Object.freeze([0.2, 0.7, 0, 0.5]),
    swingShare: 0.32,
    swingTime: Object.freeze([0.36, 0.56]),
    lead: 1.3,
    lift: Object.freeze([0.15, 0.15, 0.09, 0.09]),
    peel: Object.freeze([0.65, 0.65, 0.55, 0.55]),
    flick: Object.freeze([1.45, 1.45, 0.4, 0.4]),
    turnIn: Object.freeze([0.16, 0.16, 0.07, 0.07]),
    settle: 0.13,
    settleTime: 0.45,
    cadence: 0.62,
    setOff: 0.36,
    climb: 2.4,
});

/** Metres one stride carries it at a speed (m/s, world). */
export const bearStride = (speed) => BEAR_GAIT.stride[0] + BEAR_GAIT.stride[1] * Math.max(0, speed);
/** Seconds a paw is off the ice for a step taken at a speed. */
export const bearSwingTime = (speed) => Math.max(BEAR_GAIT.swingTime[0], Math.min(
    BEAR_GAIT.swingTime[1],
    (BEAR_GAIT.swingShare * bearStride(speed)) / Math.max(speed, 1e-3),
));
/**
 * Strides a second at a speed: as many as its stride gives at pace, and never fewer than
 * BEAR_GAIT.cadence once it is under way, so getting going and coming to a stop it takes short
 * steps, not slow ones (and none at all standing still).
 */
const cadence = (speed, grade = 0) => Math.max(
    (speed * (1 + BEAR_GAIT.climb * Math.abs(grade))) / bearStride(speed),
    (BEAR_GAIT.cadence + BEAR_GAIT.setOff * (1 - smooth(0.3, 0.8, speed / BEAR_PACE))) * smooth(0.04, 0.2, speed / BEAR_PACE),
);
/** Where in its stride each paw leaves the ice (a swing's share before it lands). */
const LIFTS = BEAR_GAIT.falls.map((fall) => fall - BEAR_GAIT.swingShare);

/** ∫₀ˣ smoothstep: how far a ramp from rest to full pace has carried it, in units of pace × ramp. */
const rampArea = (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return x - 0.5;
    return x * x * x - (x * x * x * x) / 2;
};
const wrapAngle = (a) => a - TAU * Math.round(a / TAU);

const JOINT = Object.fromEntries(BEAR_BONES.map((bone) => [bone[0], bone]));
/** How far ahead of the middle its chest walks, and behind it its hips (world metres along the path). */
const CHEST_AHEAD = JOINT.chest[4] * BEAR_SCALE;
const HIPS_BEHIND = -JOINT.pelvis[4] * BEAR_SCALE;
/** Each paw's place under what carries it (its chest or its hips), world metres: [across, along]. */
const PAW_REST = BEAR_FEET.map((foot) => {
    const ball = BEAR_MARKS[foot.paw];
    const carrier = foot.front ? JOINT.chest[4] : JOINT.pelvis[4];
    return [ball[0] * BEAR_SCALE, (ball[2] - carrier) * BEAR_SCALE];
});

// ── The course ──────────────────────────────────────────────────────────────────

const MOTION = {};
/** Metres walked (over every lap) at a moment of its clock (motionOf, below). */
const walkedAt = (course, clock) => motionOf(course, clock, MOTION).walked;
/** Its pace at a moment of its clock. */
const speedAt = (course, clock) => motionOf(course, clock, MOTION).speed;

/** Seconds between samples of the gait's clock. */
const PHASE_STEP = 1 / 40;

/**
 * Its course for an aspect: the route as a closed Catmull-Rom curve over the ice sampled evenly by
 * distance, the timeline of legs and stops, the gait's clock over a lap, and where each foot squares
 * up at each stop.
 */
export function bearCourse(aspect, { count = 1024, route = BEAR_ROUTE, pace = BEAR_PACE } = {}) {
    const knots = route.map(([fraction, dist]) => {
        const az = fraction >= BEAR_EDGE ? halfWidthFor(aspect) + EDGE_PAST : bearingFor(fraction, aspect);
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
    // Headings, smoothed over a few metres of path: the body turns, it does not swivel at a knot.
    const raw0 = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const a = ((i + count - 1) % count) * 3;
        const b = ((i + 1) % count) * 3;
        raw0[i] = Math.atan2(points[b] - points[a], points[b + 1] - points[a + 1]);
    }
    const reachSamples = Math.max(1, Math.round((1.5 / length) * count));
    for (let i = 0; i < count; i++) {
        let sx = 0;
        let sz = 0;
        for (let k = -reachSamples; k <= reachSamples; k++) {
            const h = raw0[(i + k + count) % count];
            const w = 1 - Math.abs(k) / (reachSamples + 1);
            sx += Math.sin(h) * w;
            sz += Math.cos(h) * w;
        }
        points[i * 3 + 2] = Math.atan2(sx, sz);
    }
    const knotAt = route.map((_, k) => cumulative[k * fine]);
    // How steep the ground is along the way (rise over run, across the length of its body): on a
    // slope it takes shorter steps.
    const grade = new Float32Array(count);
    const span = 1.4;
    for (let i = 0; i < count; i++) {
        const h = points[i * 3 + 2];
        const sx = Math.sin(h) * span * 0.5;
        const sz = Math.cos(h) * span * 0.5;
        const x = points[i * 3];
        const z = points[i * 3 + 1];
        grade[i] = (groundHeight(x + sx, z + sz) - groundHeight(x - sx, z - sz)) / span;
    }

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
        const ramp = Math.min(BEAR_RAMP, leg / pace);
        const duration = leg / pace + ramp;
        segments.push({
            kind: 'walk', start: time, duration, length: leg, ramp, walked, after: from.act,
        });
        time += duration;
        walked += leg;
        segments.push({
            kind: 'stop', start: time, duration: to.act[1], act: to.act[0], walked,
        });
        time += to.act[1];
    }
    const course = {
        points, count, length, grade, period: time, segments, knots: knotAt, origin: stops[0].at, start: 0, pace,
    };
    // Its clock starts just short of where it comes out from behind the trees.
    const startAt = knotAt[START_KNOT];
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.kind !== 'walk') continue;
        const into = (((startAt - (course.origin + s.walked)) % length) + length) % length;
        if (into <= s.length) {
            course.start = s.start + s.ramp + (into - (pace * s.ramp) / 2) / pace - START_LEAD;
            break;
        }
    }

    // The gait's clock: strides walked, sampled over a lap and made a whole number to the lap, so its
    // footfalls come round with the course.
    const samples = Math.ceil(time / PHASE_STEP);
    const phase = new Float64Array(samples + 1);
    const motion = {};
    let rate = 0;
    for (let i = 1; i <= samples; i++) {
        const c = Math.min(time, i * PHASE_STEP);
        motionOf(course, c, motion);
        const next = cadence(motion.speed, gradeAt(course, course.origin + motion.walked));
        phase[i] = phase[i - 1] + 0.5 * (rate + next) * (c - Math.min(time, (i - 1) * PHASE_STEP));
        rate = next;
    }
    const laps = Math.max(1, Math.round(phase[samples]));
    const fit = laps / phase[samples];
    for (let i = 0; i <= samples; i++) phase[i] *= fit;
    course.phase = phase;
    course.strides = laps;
    course.phaseStep = time / samples;

    // Where each foot squares up at each stop: a paw left far from where it stands takes a step.
    course.settles = BEAR_FEET.map(() => new Map());
    const at = [0, 0, 0];
    const neutral = [0, 0, 0];
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.kind !== 'stop') continue;
        const phi = phaseAt(course, s.start);
        const waiting = [];
        for (let f = 0; f < BEAR_FEET.length; f++) {
            const k = Math.floor(phi - LIFTS[f]);
            const lifted = clockAtPhase(course, k + LIFTS[f]);
            const landed = lifted + bearSwingTime(speedAt(course, lifted));
            landing(course, f, landed, at);
            pawNeutral(course, f, s.walked, neutral);
            const off = Math.hypot(at[0] - neutral[0], at[1] - neutral[1]);
            if (off > BEAR_GAIT.settle) {
                waiting.push({
                    f, k, off, landed, from: [...at], to: [...neutral],
                });
            }
        }
        waiting.sort((a, b) => b.off - a.off);
        waiting.forEach((w, rank) => {
            const begin = Math.max(s.start + 0.25 + 0.38 * rank, w.landed + 0.12);
            const key = (((w.k % laps) + laps) % laps);
            // (Its times are on the first lap's clock, for step `k`: a later lap's step k + n·laps
            // takes them n periods on.)
            course.settles[w.f].set(key, {
                k: w.k, start: begin, end: begin + BEAR_GAIT.settleTime, from: w.from, to: w.to,
            });
        });
    }
    return course;
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
    out[2] = points[i * 3 + 2] + wrapAngle(points[k * 3 + 2] - points[i * 3 + 2]) * t;
    return out;
}

/** How steep the ground is `distance` metres along the course (rise over run, + uphill). */
function gradeAt(course, distance) {
    const { grade, length, count } = course;
    const f = ((((distance % length) + length) % length) / length) * count;
    const i = Math.floor(f) % count;
    const t = f - Math.floor(f);
    return grade[i] + (grade[(i + 1) % count] - grade[i]) * t;
}

/** The segment of the timeline a moment of a lap falls in, and how far into it. */
function segmentAt(course, c) {
    const { segments } = course;
    for (let i = 0; i < segments.length; i++) {
        if (c < segments[i].start + segments[i].duration) return segments[i];
    }
    return segments[segments.length - 1];
}

/**
 * How far it has walked (metres, over every lap so far), how fast, and what it is doing, at a
 * moment of its clock.
 */
function motionOf(course, clock, out) {
    const { period } = course;
    const lap = Math.floor(clock / period);
    const c = clock - lap * period;
    const s = segmentAt(course, c);
    const tau = c - s.start;
    let along = 0;
    let speed = 0;
    if (s.kind === 'walk') {
        const { ramp, duration } = s;
        const pace = course.pace || BEAR_PACE;
        if (tau < ramp) {
            along = pace * ramp * rampArea(tau / ramp);
            speed = pace * smooth(0, 1, tau / ramp);
        } else if (tau > duration - ramp) {
            along = s.length - pace * ramp * rampArea((duration - tau) / ramp);
            speed = pace * smooth(0, 1, (duration - tau) / ramp);
        } else {
            along = (pace * ramp) / 2 + pace * (tau - ramp);
            speed = pace;
        }
        out.act = 'Walk';
        out.from = s.after?.[0] ?? 'Walk';
        out.fromTime = s.after?.[1] ?? 0;
    } else {
        out.act = s.act;
        out.from = 'Walk';
        out.fromTime = 0;
    }
    out.walked = lap * course.length + s.walked + along;
    out.speed = speed;
    out.actTime = tau;
    out.blend = smooth(0, BEAR_BLEND, tau);
    return out;
}

/** Strides walked (over every lap) at a moment of its clock. */
export function phaseAt(course, clock) {
    const {
        period, phase, phaseStep, strides,
    } = course;
    const lap = Math.floor(clock / period);
    const c = (clock - lap * period) / phaseStep;
    const i = Math.min(phase.length - 2, Math.floor(c));
    return lap * strides + phase[i] + (phase[i + 1] - phase[i]) * (c - i);
}

/** The first moment of its clock at which it has walked `strides` strides. */
export function clockAtPhase(course, strides) {
    const {
        period, phase, phaseStep, strides: laps,
    } = course;
    const lap = Math.floor(strides / laps);
    const r = strides - lap * laps;
    let lo = 0;
    let hi = phase.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (phase[mid] < r) lo = mid;
        else hi = mid;
    }
    const span = phase[hi] - phase[lo];
    const t = span > 1e-12 ? (r - phase[lo]) / span : 1;
    return lap * period + (lo + Math.max(0, Math.min(1, t))) * phaseStep;
}

const PLACE = [0, 0, 0];
/** Where a paw stands (world x, z and the way it points) under a body that has walked `walked`. */
function pawNeutral(course, f, walked, out) {
    const foot = BEAR_FEET[f];
    const carrier = course.origin + walked + (foot.front ? CHEST_AHEAD : -HIPS_BEHIND);
    bearPlace(course, carrier, PLACE);
    const [across, along] = PAW_REST[f];
    const c = Math.cos(PLACE[2]);
    const s = Math.sin(PLACE[2]);
    out[0] = PLACE[0] + across * c + along * s;
    out[1] = PLACE[1] - across * s + along * c;
    // (Turned in: a left paw's toes to its right.)
    out[2] = PLACE[2] - BEAR_GAIT.turnIn[f] * foot.side;
    return out;
}

/**
 * Where a paw lands for a step that touches down at `landed`: where it will stand under the body
 * half-way through its time on the ice (or as far ahead as the course can see).
 */
function landing(course, f, landed, out) {
    motionOf(course, landed, MOTION);
    const v = MOTION.speed;
    const grade = gradeAt(course, course.origin + MOTION.walked);
    const stance = Math.max(0, 1 / Math.max(cadence(v, grade), 1e-3) - bearSwingTime(v));
    // (A foreleg reaches a little less far ahead than it pushes back: its stance sits under the
    // shoulder a shade behind the middle.)
    const ahead = Math.min(BEAR_GAIT.lead, stance * (BEAR_FEET[f].front ? 0.36 : 0.5));
    return pawNeutral(course, f, walkedAt(course, landed + ahead), out);
}

/** Where a paw stands after step `k` (and after any squaring-up step at a stop that follows it). */
function standing(course, f, k, out) {
    const settle = course.settles[f].get(((k % course.strides) + course.strides) % course.strides);
    if (settle) {
        out[0] = settle.to[0];
        out[1] = settle.to[1];
        out[2] = settle.to[2];
        return out;
    }
    const lifted = clockAtPhase(course, k + LIFTS[f]);
    return landing(course, f, lifted + bearSwingTime(speedAt(course, lifted)), out);
}

/** 6s⁵ − 15s⁴ + 10s³: from rest to rest with no jolt at either end. */
const glide = (s) => s * s * s * (s * (s * 6 - 15) + 10);
/** A bump that leaves and meets the ice at rest, its top a little before half-way. */
const arc = (s) => {
    const t = s ** 0.85;
    return 16 * t * t * (1 - t) * (1 - t);
};

const FROM = [0, 0, 0];
const TO = [0, 0, 0];
/** How far each paw's toes reach ahead of the ball of the foot (world metres). */
const TOE_REACH = BEAR_FEET.map((foot) => {
    const ball = BEAR_MARKS[foot.paw];
    const tip = BEAR_MARKS[`tip${foot.name}`];
    return Math.hypot(tip[0] - ball[0], tip[1] - ball[1], tip[2] - ball[2]) * BEAR_SCALE;
});

/**
 * Where paw `f` is at a moment of its clock: world (x, z, the way it points), how high, its heel and
 * curl, and how far into a swing it is (0 on the ice).
 */
export function pawAt(course, f, clock, out = {}) {
    const phi = phaseAt(course, clock);
    const k = Math.floor(phi - LIFTS[f]);
    const lifted = clockAtPhase(course, k + LIFTS[f]);
    const swing = bearSwingTime(speedAt(course, lifted));
    const landed = lifted + swing;
    const G = BEAR_GAIT;
    if (clock < landed) {
        // In the air: from where it stood to where it lands, on a smooth path.
        const s = Math.max(0, (clock - lifted) / swing);
        standing(course, f, k - 1, FROM);
        landing(course, f, landed, TO);
        const g = glide(s);
        out.x = FROM[0] + (TO[0] - FROM[0]) * g;
        out.z = FROM[1] + (TO[1] - FROM[1]) * g;
        out.yaw = FROM[2] + wrapAngle(TO[2] - FROM[2]) * g;
        const reach = Math.hypot(TO[0] - FROM[0], TO[1] - FROM[1]);
        out.pitch = G.peel[f] * (1 - smooth(0, 0.35, s));
        out.curl = G.flick[f] * Math.sin(Math.PI * Math.min(1, s * 1.3)) * (1 - smooth(0.68, 1, s));
        // Carried high enough that its curled toes clear the ice.
        const toes = TOE_REACH[f] * Math.sin(Math.min(Math.PI / 2, out.curl * 1.25));
        out.lift = Math.max(G.lift[f] * Math.min(1, 0.35 + reach / 0.8) * arc(s), toes + 0.02 * arc(s));
        out.swing = arc(s);
        // (It takes its weight again as it comes down.)
        out.air = 1 - smooth(0.6, 1, s);
        return out;
    }
    // On the ice: where it landed, unless it has squared up since.
    landing(course, f, landed, TO);
    let since = landed;
    const settle = course.settles[f].get(((k % course.strides) + course.strides) % course.strides);
    const later = settle ? ((k - settle.k) / course.strides) * course.period : 0;
    out.x = TO[0];
    out.z = TO[1];
    out.yaw = TO[2];
    out.lift = 0;
    out.curl = 0;
    out.swing = 0;
    let settling = 0;
    if (settle && clock >= settle.start + later) {
        const s = Math.min(1, (clock - settle.start - later) / (settle.end - settle.start));
        const g = glide(s);
        out.x = settle.from[0] + (settle.to[0] - settle.from[0]) * g;
        out.z = settle.from[1] + (settle.to[1] - settle.from[1]) * g;
        out.yaw = settle.from[2] + wrapAngle(settle.to[2] - settle.from[2]) * g;
        out.lift = G.lift[f] * 0.45 * arc(s);
        out.curl = G.flick[f] * 0.35 * Math.sin(Math.PI * s);
        out.swing = arc(s) * 0.5;
        settling = smooth(0, 0.3, s) * (1 - smooth(0.7, 1, s));
        since = settle.end + later;
    }
    // Its heel peels up off the ice as the next step comes.
    const next = clockAtPhase(course, k + 1 + LIFTS[f]);
    const stance = Math.max(1e-3, next - since);
    out.pitch = G.peel[f] * smooth(0.62, 1, (clock - since) / stance) * (out.swing > 0 ? 0 : 1);
    // It comes off its weight as its heel peels, so the body is not left leaning on a leg that
    // is about to go.
    out.air = Math.max(settling, smooth(0.5, 1, (clock - since) / stance));
    return out;
}

/**
 * Where its course has it at a moment of its own clock: place, heading, pace, how far it has
 * walked and what it is doing. (Its feet: pawAt.)
 */
export function bearOnCourse(course, clock, out) {
    motionOf(course, clock, out);
    bearPlace(course, course.origin + out.walked, PLACE);
    out.x = PLACE[0];
    out.z = PLACE[1];
    out.heading = PLACE[2];
    out.distance = course.origin + out.walked;
    return out;
}

// ── The mind ────────────────────────────────────────────────────────────────────

/** How long a stop the board makes it take holds it (seconds): the length of `Rear`. */
const REAR_FOR = BEAR_ACTS.Rear;
const SPEC_B = createBearSpec();
const PAW = {};
const CHEST = [0, 0, 0];
const HIPS = [0, 0, 0];
const NEUTRAL = [0, 0, 0];
/**
 * The ground under the body (`a`), or under its feet (`b`, `c`) where that is lower: exactly `a`
 * on level ground, and easing into the feet's ground (no corner) as it falls away.
 */
const softLow = (a, b, c) => {
    const k = 0.06;
    const x = a - Math.min(b, c);
    if (x <= 0) return a;
    return a - (x < k ? (x * x) / (2 * k) : x - k / 2);
};

/** Its next way, by weight, never the one it has just walked. */
function chooseWay(rand, previous) {
    const weights = BEAR_ROUTES.map((w, i) => (i === previous ? 0 : w.weight));
    let r = rand() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (weights[i] > 0 && r <= 0) return i;
    }
    return (previous + 1) % BEAR_ROUTES.length;
}

/**
 * The bear's mind: its clock, what the board has made it do, and the pose that results — a spec
 * its body (winter-bear-rig.js) solves.
 */
export class BearMind {
    /**
     * @param {number} [aspect]
     * @param {object} [o]
     * @param {number} [o.start]  where on its clock it starts (seconds; the course's own when not given)
     */
    constructor(aspect = 16 / 9, { start, seed = 0xbea7 } = {}) {
        this.aspect = aspect;
        this.seed = seed;
        this.courses = new Map();
        this.course = this.courseFor(0);
        this.startAt = start;
        // Its laps: which way it takes each time and how long it stays out of sight before it. The first
        // is its first way at once; the rest are dealt from its seed as its clock reaches them.
        this.laps = [{ way: 0, wait: 0, start: 0 }];
        this.lapRand = mulberry32(seed);
        this.pose = {
            x: 0,
            y: 0,
            z: -60,
            heading: 0,
            speed: 0,
            act: 'Stand',
            actTime: 0,
            from: 'Stand',
            fromTime: 0,
            blend: 1,
            over: null,
            overTime: 0,
            overBlend: 0,
            distance: 0,
            walked: 0,
            clip: 'Stand',
            breath: 0,
            /** The spec its body solves. */
            spec: createBearSpec(),
            /** Each paw in the world: x, y, z (BEAR_FEET order), and how far into a swing. */
            paws: BEAR_FEET.map(() => ({
                x: 0, y: 0, z: 0, swing: 0,
            })),
        };
        this.reset(0);
    }

    /** One of its ways laid out for the frame (built once, the first time it takes it). */
    courseFor(way) {
        if (!this.courses.has(way)) {
            const { route, pace } = BEAR_ROUTES[way];
            this.courses.set(way, bearCourse(this.aspect, { route, pace }));
        }
        return this.courses.get(way);
    }

    /** The lap its clock is in (its number); the laps are dealt up to there if they are not yet. */
    lapIndex(clock) {
        const { laps } = this;
        let last = laps[laps.length - 1];
        while (clock >= last.start + last.wait + this.courseFor(last.way).period) {
            const next = chooseWay(this.lapRand, last.way);
            const wait = BEAR_AWAY[0] + (BEAR_AWAY[1] - BEAR_AWAY[0]) * this.lapRand() ** 2;
            last = { way: next, wait, start: last.start + last.wait + this.courseFor(last.way).period };
            laps.push(last);
        }
        let lo = 0;
        let hi = laps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (laps[mid].start <= clock) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /**
     * The way its clock has it on and its clock along that way: out of sight past the frame's edge it
     * stands where its ways meet until its wait is over.
     */
    lapClock(clock) {
        const lap = this.laps[this.lapIndex(clock)];
        const course = this.courseFor(lap.way);
        const into = clock - lap.start;
        // (Before its first lap, or between laps, its clock stands at the start of the way.)
        const local = lap.start === 0 && into < 0 ? into : Math.max(0, into - lap.wait);
        return { course, local, lap };
    }

    /** Which of its ways it is on at a world time (its name), and which lap that is. */
    wayAt(time = this.time) {
        const n = this.lapIndex(this.clockAt(time));
        return `${BEAR_ROUTES[this.laps[n].way].name}#${n}`;
    }

    /** Fit its ways to another aspect, keeping which lap it is on and how far along it. */
    setAspect(aspect, time = this.time) {
        if (aspect === this.aspect) return;
        const clock = this.clockAt(time);
        const lap = this.laps[this.lapIndex(clock)];
        const into = clock - lap.start;
        const share = into < lap.wait ? null : (into - lap.wait) / this.courseFor(lap.way).period;
        this.aspect = aspect;
        this.courses.clear();
        // The same ways and waits, timed again for the frame's own courses.
        let start = 0;
        this.laps.forEach((l) => {
            // eslint-disable-next-line no-param-reassign
            l.start = start;
            start += l.wait + this.courseFor(l.way).period;
        });
        this.course = this.courseFor(lap.way);
        const target = lap.start + (share === null ? into : lap.wait + share * this.course.period);
        this.offset += target - clock;
    }

    /**
     * Nothing the board made it do in flight: where it is is the world clock's alone again (a seek
     * to any time shows it where a world that ran from the start would have it).
     */
    reset(time = 0) {
        this.time = time;
        this.offset = this.startAt ?? this.courseFor(0).start;
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

    /** Where it is and what it is doing at a world time, and the spec its body solves. */
    step(time) {
        this.time = time;
        const { cut } = this;
        if (cut && Number.isFinite(cut.end) && time > cut.end + BEAR_EASE) {
            this.held += cut.end - cut.start;
            this.cut = null;
        }
        const p = this.pose;
        // Which of its ways it is on, and how far along it.
        const { course, local: clock } = this.lapClock(this.clockAt(time));
        this.course = course;
        bearOnCourse(course, clock, p);
        const still = this.holdAt(time);
        p.speed *= 1 - still;
        // The chest and the hips ride the ground under them (over a spit's back, the body tilts),
        // or under their feet where that is lower: across a slope, the downhill feet must reach.
        bearPlace(course, p.distance + CHEST_AHEAD, CHEST);
        bearPlace(course, p.distance - HIPS_BEHIND, HIPS);
        const under = (f) => groundHeight(...pawNeutral(course, f, p.walked, NEUTRAL));
        const chestY = softLow(groundHeight(CHEST[0], CHEST[1]), under(0), under(1));
        const hipsY = softLow(groundHeight(HIPS[0], HIPS[1]), under(2), under(3));
        p.y = (chestY + hipsY) * 0.5;

        // What it is doing (cross-faded from what it was doing).
        const { spec } = p;
        const mix = p.blend * p.blend * (3 - 2 * p.blend);
        bearAct(spec, p.act, p.actTime);
        if (mix < 1) {
            bearAct(SPEC_B, p.from, p.fromTime);
            for (let i = 0; i < spec.length; i++) spec[i] = SPEC_B[i] + (spec[i] - SPEC_B[i]) * mix;
        }
        // The back follows the curve of the path: the chest walks ahead on it, the hips behind.
        spec[SPEC.fore] += (p.y - chestY) / BEAR_SCALE;
        spec[SPEC.drop] += (p.y - hipsY) / BEAR_SCALE;
        const chestYaw = wrapAngle(CHEST[2] - p.heading);
        const hipsYaw = wrapAngle(HIPS[2] - p.heading);
        spec[SPEC.bend] += chestYaw - hipsYaw;
        spec[SPEC.yaw] += (chestYaw + hipsYaw) * 0.5;

        // Its feet, from the world into the model's frame; and the body riding them.
        const c = Math.cos(p.heading);
        const s = Math.sin(p.heading);
        const swings = [0, 0, 0, 0];
        for (let f = 0; f < BEAR_FEET.length; f++) {
            pawAt(course, f, clock, PAW);
            const ball = BEAR_MARKS[BEAR_FEET[f].paw];
            const wx = PAW.x - p.x;
            const wz = PAW.z - p.z;
            const o = SPEC.feet + f * FOOT.size;
            spec[o + FOOT.dx] += (wx * c - wz * s) / BEAR_SCALE - ball[0];
            spec[o + FOOT.dz] += (wx * s + wz * c) / BEAR_SCALE - ball[2];
            spec[o + FOOT.dy] += (PAW.lift + groundHeight(PAW.x, PAW.z) - p.y) / BEAR_SCALE;
            spec[o + FOOT.pitch] += PAW.pitch;
            spec[o + FOOT.curl] += PAW.curl;
            spec[o + FOOT.air] += PAW.air;
            spec[o + FOOT.yaw] += wrapAngle(PAW.yaw - p.heading);
            // Set down on a slope, the paw lies along it (toes up the rise, not into it).
            const ahead = TOE_REACH[f];
            const rise = groundHeight(PAW.x + Math.sin(PAW.yaw) * ahead, PAW.z + Math.cos(PAW.yaw) * ahead)
                - groundHeight(PAW.x - Math.sin(PAW.yaw) * ahead, PAW.z - Math.cos(PAW.yaw) * ahead);
            spec[o + FOOT.ground] += -Math.atan2(rise, 2 * ahead);
            swings[f] = PAW.swing;
            const out = p.paws[f];
            out.x = PAW.x;
            out.y = groundHeight(PAW.x, PAW.z) + PAW.lift;
            out.z = PAW.z;
            out.swing = PAW.swing;
        }
        const [fl, fr, bl, br] = swings;
        const going = smooth(0, 0.5, p.speed / BEAR_PACE);
        // The shoulders roll and the hips sway over the feet that are down; the body settles a
        // little on each foot that swings, and rides lower walking than standing.
        const chestRoll = 0.045 * (fr - fl);
        const hipsRoll = 0.04 * (br - bl);
        spec[SPEC.roll] += (chestRoll + hipsRoll) * 0.5;
        spec[SPEC.twist] += chestRoll - hipsRoll;
        spec[SPEC.sway] += 0.018 * (fr - fl + br - bl) * 0.5;
        spec[SPEC.fore] += 0.016 * (fl + fr) + 0.045 * going;
        spec[SPEC.drop] += 0.013 * (bl + br) + 0.04 * going;
        spec[SPEC.shift] += 0.012 * (fl + fr - bl - br) * going;
        // The head swings to the side of the planted forepaw, low, and nods with each step.
        spec[SPEC.headYaw] += 0.12 * (fr - fl);
        spec[SPEC.headRoll] += 0.05 * (fl - fr);
        spec[SPEC.headPitch] += 0.03 * (fl + fr) - 0.02 * going;
        spec[SPEC.tailYaw] += 0.15 * (bl - br);

        // What the board made it do, laid over the rest.
        p.over = null;
        p.overBlend = 0;
        if (this.cut) {
            const k = this.cut;
            if (k.kind === 'rear') {
                p.over = 'Rear';
                p.overTime = time - k.from;
                p.overBlend = smooth(k.from, k.from + 0.6, time) * (1 - smooth(k.end - 0.5, k.end + 0.5, time));
            } else if (Number.isFinite(k.end) && k.rise !== undefined) {
                p.over = 'Rise';
                p.overTime = time - k.rise;
                p.overBlend = 1 - smooth(k.end - 0.4, k.end + 0.6, time);
            } else {
                p.over = 'Lie';
                p.overTime = Math.min(time - k.from, LIE_HOLD);
                p.overBlend = smooth(k.from, k.from + 0.8, time);
            }
        }
        if (p.over && p.overBlend > 0) {
            bearAct(SPEC_B, p.over, p.overTime);
            const w = p.overBlend * p.overBlend * (3 - 2 * p.overBlend);
            // (Only an act that places its own feet takes them from the gait.)
            const feet = OWNS_FEET[p.over] ? SPEC_B.length : SPEC.feet;
            for (let i = 0; i < feet; i++) spec[i] += (SPEC_B[i] - spec[i]) * w;
        }
        p.clip = p.over && p.overBlend > 0.5 ? p.over : p.act;
        // It breathes: slow and deep, and deeper still once it has walked a while and stopped.
        const resting = p.act === 'Walk' ? 1 - p.blend : 1;
        p.breath = Math.sin(time * TAU * 0.28) * (0.4 + 0.6 * clamp01(resting + p.overBlend));
        spec[SPEC.arch] += 0.01 * p.breath;
        spec[SPEC.fore] -= 0.006 * p.breath;
        return p;
    }
}
