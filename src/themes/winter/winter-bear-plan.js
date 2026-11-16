/**
 * Winter — where the polar bears go, how they put their feet down, and what they do when they stop.
 * Three-free and renderer-free: the body (winter-bear-rig.js) solves the pose this resolves and the
 * model (winter-bear.js) draws it.
 *
 * A polar bear walks the frozen lake beyond the snowfield, forty to a hundred and forty metres out.
 * It knows several ways over the ice (BEAR_ROUTES): the long round it has always walked, a close look
 * in the open ice right of the board, a far crossing, a brisk walk through, a slow wander with
 * many stops, a wide sweep far out. Each is a closed curve laid out in fractions of the frame's half
 * width (as the fox's round is) that leaves from and comes back to the same place just beyond the
 * frame's right edge, out of sight; there it may stand a while before it comes again, by whichever
 * way it chooses (never the same twice running).
 *
 * Each time round is a lap, and each lap is dealt from the bear's seed (dealLap): who walks it (the
 * big male, a smaller and slimmer female, or a female with her cub), at which of the way's stops it
 * stops and what it does there (a dozen things, never the same at two stops running), and its pace
 * over each stretch (a slow amble with its head low and swinging, its walk, a brisk walk, and rarely
 * a short rolling lope). So where its body is and what it is doing are still a function of its
 * clock and its seed and nothing else.
 *
 * Its feet are too. Each paw is put down in the world and stays where it was put while the body
 * goes over it: through a turn, slowing down, stopping. A paw lands where it will stand under the
 * body halfway through its time on the ice, which the course knows in advance, so as the bear slows
 * to a stop its last steps land under it, and a foot that was left behind takes a step to square
 * up once it has stopped. The rhythm is a four-beat walk (left hind, left fore, right hind, right
 * fore), its strides shorter and its swings no slower as it slows, so it never walks in slow
 * motion, and quicker, not longer, as it walks briskly; past that it breaks into a lope (the hind
 * feet one after the other, then the forefeet, then a moment off the ice). A paw swings on a
 * smooth path that leaves and meets the ice at rest, the forepaw curled as it goes, the heel
 * peeling off the ice before it lifts. The body rides the feet: the shoulders roll and the hips
 * sway over whichever feet are down, the head swings to the side of the planted forepaw, and the
 * back follows the curve of the path, the hips walking where the chest has been. All of it is
 * closed form in the clock, so a seek, a replay or a capture shows the same frame at any frame
 * rate.
 *
 * A cub keeps to its own way a little to one side of its mother's. It pulls up behind her a moment
 * after she stops and does something of its own; it dawdles before it follows her off, now and then
 * stops on the way to look at something, and runs to catch up. Its timeline is laid from hers when
 * the lap is dealt (layCub), so it is as much a function of the clock as she is.
 *
 * The board can make it stop. Four lines and the fox of light: it stands up on its hind legs to
 * watch it go. A perfect clear: it stands up, then sits down where it stood and watches the sky.
 * The run ends: it lies down on the ice, head on its paws, until the next run begins, then gets up
 * and walks on. Each is laid over whatever it was doing, and its clock slows to a halt under it and
 * picks up again after, so nothing jumps and the walk resumes where it left off. A level gained
 * and a twist move its head alone (it scents the wind; it looks sharply to the board) without
 * breaking its stride. A cub does what its mother does, a beat later.
 */

import {
    TAU, bearingFor, clamp01, groundHeight, halfWidthFor, mulberry32, smooth,
} from './winter-core.js';
import {
    BEAR_ACTS, BEAR_ACT_SPAN, BEAR_BONES, BEAR_FEET, BEAR_MARKS, BEAR_SCALE, BEAR_SPEC as SPEC, FOOT, HEAD_ONLY, LIE_HOLD,
    OWNS_FEET, bearAct, createBearSpec,
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

/** Metres a second it walks at (it is drawn larger than life: its strides are too). */
export const BEAR_PACE = 1.2;
/**
 * Its paces, metres a second for a bear of the big male's size: a slow sniffing amble, its walk, a
 * brisk walk that means to get somewhere, and a short rolling lope.
 */
export const BEAR_PACES = Object.freeze({
    amble: 0.74, easy: 0.95, walk: BEAR_PACE, brisk: 1.62, lope: 3.0,
});
/** The pace at which a walk begins to break into a lope, and by which it is one. */
const LOPE_FROM = 2.1;
const LOPE_BY = 2.7;
/** Seconds it takes to get going, or to come to a stop. */
export const BEAR_RAMP = 2.2;
/** Seconds a stop takes to cross-fade in (or a walk out of one). */
export const BEAR_BLEND = 1.1;
/** Seconds the board's stops take to bring it to a halt, and to let it go again. */
export const BEAR_EASE = 1.2;
/** How much longer than BEAR_RAMP it takes to break into a run from rest, or to pull up out of one. */
const LOPE_RAMP = 1.4;
/** How fast it changes pace under way (m/s²), and the least a change takes (s). */
const PACE_CHANGE = 0.9;
const PACE_CHANGE_LEAST = 1.2;
/** Where on its clock it starts (seconds): just short of coming out from behind the trees. */
const START_KNOT = SETTING_OUT.length;
const START_LEAD = 6;

/**
 * Its gait, in metres and seconds for a bear of the big male's size.
 *  stride      metres a stride: base + rate × speed (shorter steps as it slows, never slow ones),
 *              and no longer than strideMost: faster than that it steps quicker
 *  falls       when in a stride each paw lands (BEAR_FEET order: FL, FR, BL, BR): left hind, left
 *              fore a fifth of a stride on, then the right pair half a stride after
 *  swingShare  the share of a stride a paw is off the ice at its pace (swingMore more of it at a
 *              brisk walk); swingTime bounds it (s)
 *  lead        the most a landing looks ahead for where the body will be (s)
 *  lift        how high each paw is carried; peel, how far its heel comes up before it leaves the
 *              ice; flick, how far the paw curls as it swings (radians)
 *  turnIn      how far each paw is turned in (radians): a polar bear is pigeon-toed in front
 *  settle      a paw further than this from where it stands takes a step once the bear stops
 *  cadence     the fewest strides a second it takes once under way; setOff, how many more it
 *              takes setting off and coming to a stop (short quick steps, so no paw is left behind)
 *  climb       how much a slope shortens its strides: by 1 / (1 + climb × gradient), up or down
 *  lope        the rolling lope it breaks into past LOPE_FROM: the hind feet land one after the
 *              other, then the forefeet, then a moment with every paw off the ice
 *                lifts       when in a stride each paw leaves the ice (laid as near its walk's as a
 *                            lope allows, so breaking into it no paw waits long or steps twice)
 *                swingShare  the share of a stride each paw is off the ice
 *                stride      metres a stride: base + rate × speed
 *                lift        how much higher its paws are carried
 */
export const BEAR_GAIT = Object.freeze({
    stride: Object.freeze([0.72, 0.88]),
    strideMost: 1.78,
    falls: Object.freeze([0.2, 0.7, 0, 0.5]),
    swingShare: 0.32,
    swingMore: 0.05,
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
    lope: Object.freeze({
        lifts: Object.freeze([-0.2, 0.68, -0.62, 0.26]),
        swingShare: 0.62,
        stride: Object.freeze([0.9, 0.4]),
        lift: 0.6,
    }),
});
const G = BEAR_GAIT;

/** Metres one stride carries it at a speed (m/s). */
export const bearStride = (speed) => Math.min(G.strideMost, G.stride[0] + G.stride[1] * Math.max(0, speed));
/** How much of a lope its gait is at a speed (0 a walk .. 1 a lope). */
export const bearLope = (speed) => clamp01((speed - LOPE_FROM) / (LOPE_BY - LOPE_FROM));
/** Strides a second of its lope at a speed. */
const lopeCadence = (speed) => speed / (G.lope.stride[0] + G.lope.stride[1] * speed);
/** Seconds a paw is off the ice for a step taken at a speed. */
export const bearSwingTime = (speed) => {
    const share = G.swingShare + G.swingMore * smooth(1.3, 2.0, speed);
    const walk = Math.max(G.swingTime[0], Math.min(G.swingTime[1], (share * bearStride(speed)) / Math.max(speed, 1e-3)));
    const lope = bearLope(speed);
    return lope > 0 ? walk + (G.lope.swingShare / lopeCadence(speed) - walk) * lope : walk;
};
/** The fewest strides a second it takes once under way on a leg walked at `ref` m/s. */
const cadenceFloor = (ref) => (ref === BEAR_PACE ? G.cadence : Math.min(G.cadence, (0.92 * ref) / bearStride(ref)));
/**
 * Strides a second at a speed: as many as its stride gives at pace, and never fewer than the floor
 * once it is under way, so getting going and coming to a stop it takes short steps, not slow ones
 * (and none at all standing still). `ref` is the pace of the leg it is on.
 */
const cadence = (speed, grade = 0, ref = BEAR_PACE) => {
    const walk = Math.max(
        (speed * (1 + G.climb * Math.abs(grade))) / bearStride(speed),
        (cadenceFloor(ref) + G.setOff * (1 - smooth(0.3, 0.8, speed / ref))) * smooth(0.04, 0.2, speed / ref),
    );
    const lope = bearLope(speed);
    return lope > 0 ? walk + (lopeCadence(speed) - walk) * lope : walk;
};
/** Where in its stride each paw leaves the ice (a swing's share before it lands): walking. */
const LIFTS = G.falls.map((fall) => fall - G.swingShare);
/** ...and how much later (in strides) loping. */
const LOPE_SHIFT = G.lope.lifts.map((lift, f) => lift - LIFTS[f]);

/**
 * How it carries itself at a pace: −1 ambling (its head low and swinging), 0 walking, 1 brisk,
 * 2 loping, and between.
 */
export function bearManner(pace) {
    const {
        amble, walk, brisk,
    } = BEAR_PACES;
    if (pace <= walk) return -clamp01((walk - pace) / (walk - amble));
    if (pace <= brisk) return (pace - walk) / (brisk - walk);
    return 1 + bearLope(pace);
}

/** ∫₀ˣ smoothstep: how far a ramp from rest to full pace has carried it, in units of pace × ramp. */
const rampArea = (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return x - 0.5;
    return x * x * x - (x * x * x * x) / 2;
};
const wrapAngle = (a) => a - TAU * Math.round(a / TAU);
const lerp = (a, b, t) => a + (b - a) * t;

const JOINT = Object.fromEntries(BEAR_BONES.map((bone) => [bone[0], bone]));
/** How far ahead of the middle its chest walks, and behind it its hips (metres along the path). */
const CHEST_AHEAD = JOINT.chest[4] * BEAR_SCALE;
const HIPS_BEHIND = -JOINT.pelvis[4] * BEAR_SCALE;
/** Each paw's place under what carries it (its chest or its hips), metres: [across, along]. */
const PAW_REST = BEAR_FEET.map((foot) => {
    const ball = BEAR_MARKS[foot.paw];
    const carrier = foot.front ? JOINT.chest[4] : JOINT.pelvis[4];
    return [ball[0] * BEAR_SCALE, (ball[2] - carrier) * BEAR_SCALE];
});

// ── The course ──────────────────────────────────────────────────────────────────
//
// A course is laid in the animal's own measure: metres and seconds as they would be for a bear of
// the big male's size. A smaller bear (the female, a cub) of `size` walks a world scaled up by
// 1 / size, on a clock that runs 1 / √size faster, and is drawn scaled down again: the same legs
// take more and quicker steps over the same ice, as a smaller animal does. For the big male both
// are the world's own.

const MOTION = {};
/** Metres walked (over every lap) at a moment of its clock (motionOf, below). */
const walkedAt = (course, clock) => motionOf(course, clock, MOTION).walked;
/** Its pace at a moment of its clock. */
const speedAt = (course, clock) => motionOf(course, clock, MOTION).speed;

/** Seconds between samples of the gait's clock. */
const PHASE_STEP = 1 / 40;

/** The ground as a bear of `size` measures it: the world's, in its own metres. */
const groundFor = (size) => (size === 1 ? groundHeight : (x, z) => groundHeight(x * size, z * size) / size);

/**
 * The way over the ice for an aspect: the route as a closed Catmull-Rom curve sampled evenly by
 * distance, with its headings, how steep the ground is along it, and where each knot lies.
 * @param {number} aspect
 * @param {object} o
 * @param {Array} o.route
 * @param {number} [o.count]
 * @param {number} [o.size]      the animal's size (1: the big male): the way is laid in its measure
 * @param {object} [o.beside]    lay it beside another way instead (a cub's beside its mother's):
 *                               { course, sides }, `sides` the world metres to her left at each of
 *                               its samples round her way (besideWay, below)
 */
function bearPath(aspect, {
    route, count = 1024, size = 1, beside = null,
}) {
    const ground = groundFor(size);
    const n = route.length;
    const fine = 24;
    const total = beside ? beside.sides.length : n * fine;
    const raw = new Float64Array((total + 1) * 2);
    const cumulative = new Float64Array(total + 1);
    const knots = beside ? null : route.map(([fraction, dist]) => {
        const az = fraction >= BEAR_EDGE ? halfWidthFor(aspect) + EDGE_PAST : bearingFor(fraction, aspect);
        return [(Math.sin(az) * dist) / size, (-Math.cos(az) * dist) / size];
    });
    const at = [0, 0, 0];
    for (let i = 0; i <= total; i++) {
        if (beside) {
            // Her way, each place moved to one side of the way she faces there.
            const her = beside.course;
            bearPlace(her, (i / total) * her.length, at);
            const side = beside.sides[i % total];
            raw[i * 2] = (at[0] * her.size + Math.cos(at[2]) * side) / size;
            raw[i * 2 + 1] = (at[1] * her.size - Math.sin(at[2]) * side) / size;
        } else {
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
    // Where each knot lies along it (beside another way: abreast of that way's knot).
    const knotAt = route.map((_, k) => cumulative[beside
        ? Math.min(total, Math.round((beside.course.knots[k] / beside.course.length) * total))
        : k * fine]);
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
        grade[i] = (ground(x + sx, z + sz) - ground(x - sx, z - sz)) / span;
    }
    return {
        points, count, length, grade, knots: knotAt, size, ground,
    };
}

/**
 * Seconds it takes to get going at a pace, or to come to a stop from it: BEAR_RAMP walking, longer
 * breaking straight into a run (a cub does) or pulling up out of one. `plain`: BEAR_RAMP whatever
 * the pace, as a route walked alone has it.
 */
const rampFor = (pace, plain = false) => (plain || pace <= LOPE_FROM ? BEAR_RAMP : BEAR_RAMP * LOPE_RAMP);
/** Seconds a change of pace under way takes. */
const paceTurn = (a, b) => Math.max(PACE_CHANGE_LEAST, Math.abs(b - a) / PACE_CHANGE);
/** Neighbouring stretches at one pace made one stretch. */
function mergeStretches(run) {
    const merged = [];
    for (let i = 0; i < run.length; i++) {
        const last = merged[merged.length - 1];
        if (last && last.pace === run[i].pace) last.length += run[i].length;
        else merged.push({ ...run[i] });
    }
    return merged;
}
/**
 * What each stretch of a leg has left to cruise once the ramps at its ends have had their share
 * (from rest and to rest at the leg's ends, half of each change of pace between).
 */
function cruiseLengths(run, plain) {
    const m = run.length;
    return run.map((s, i) => {
        const ramp = (s.pace * rampFor(s.pace, plain)) / 2;
        const before = i === 0 ? ramp : ((run[i - 1].pace + s.pace) / 4) * paceTurn(run[i - 1].pace, s.pace);
        const after = i === m - 1 ? ramp : ((s.pace + run[i + 1].pace) / 4) * paceTurn(s.pace, run[i + 1].pace);
        return s.length - before - after;
    });
}

/**
 * How far to one side of its mother's way a cub's lies, round her way: `sides[i]` world metres to
 * her left (negative: her right) at sample i of `count`. It keeps `keeps` metres off on the side
 * `sign`, a little more or less from place to place; on the inside of a bend it keeps no further
 * off than half the bend's radius, so its own way never doubles back on itself.
 */
function besideWay(mother, sign, keeps, stray, phase, count = 2048) {
    const sides = new Float64Array(count);
    const length = mother.length * mother.size;
    const step = length / count;
    const before = [0, 0, 0];
    const after = [0, 0, 0];
    // How far off it may keep at each place: all it wants outside a bend, half the radius inside.
    const room = new Float64Array(count);
    const span = 1.2;
    for (let i = 0; i < count; i++) {
        const d = (i / count) * mother.length;
        bearPlace(mother, d - span / mother.size, before);
        bearPlace(mother, d + span / mother.size, after);
        // (Radians a world metre: + as she turns to her left.)
        const bend = wrapAngle(after[2] - before[2]) / (2 * span);
        const wants = keeps + stray * 0.5 * Math.sin(TAU * ((3 * i) / count) + phase);
        room[i] = bend * sign > 1e-6 ? Math.min(wants, 0.5 / Math.abs(bend)) : wants;
    }
    // It nears a tight bend's inside over a few metres, and leaves it so: the least room within
    // reach, then the mean of that, so its way is smooth.
    const reach = Math.max(1, Math.round(3 / step));
    const least = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        let low = Infinity;
        for (let k = -reach; k <= reach; k++) low = Math.min(low, room[(i + k + count) % count]);
        least[i] = low;
    }
    for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let k = -reach; k <= reach; k++) sum += least[(i + k + count) % count];
        sides[i] = sign * (sum / (2 * reach + 1));
    }
    return sides;
}

/**
 * One leg of a timeline, from rest to rest, as moves: `stretches` are the lengths of path it
 * covers one after the other and the pace of each. Its pace is eased from one to the next over the
 * join; a stretch too short for the pace it was given takes its neighbour's.
 * @returns {Array<{v0: number, v1: number, duration: number, m0: number, m1: number, ref: number}>}
 */
function legMoves(stretches, plain) {
    const manner = (pace) => (plain ? 0 : bearManner(pace));
    const ref = (pace) => (plain ? BEAR_PACE : pace);
    const move = (v0, v1, duration, pace = Math.min(v0 || v1, v1 || v0)) => ({
        v0, v1, duration, m0: manner(v0 || v1), m1: manner(v1 || v0), ref: ref(pace),
    });
    let run = mergeStretches(stretches);
    let cruise = cruiseLengths(run, plain);
    // A stretch too short for its own pace is walked at its slower neighbour's.
    for (let short = cruise.findIndex((left) => left < 0); run.length > 1 && short >= 0; short = cruise.findIndex((left) => left < 0)) {
        const a = short > 0 ? run[short - 1].pace : Infinity;
        const b = short < run.length - 1 ? run[short + 1].pace : Infinity;
        run[short].pace = Math.min(a, b);
        run = mergeStretches(run);
        cruise = cruiseLengths(run, plain);
    }
    const m = run.length;
    if (m === 1) {
        const { pace, length } = run[0];
        const ramp = Math.min(rampFor(pace, plain), length / pace);
        const moves = [move(0, pace, ramp)];
        if (length / pace - ramp > 0) moves.push(move(pace, pace, length / pace - ramp));
        moves.push(move(pace, 0, ramp));
        return moves;
    }
    const moves = [move(0, run[0].pace, rampFor(run[0].pace, plain))];
    for (let i = 0; i < m; i++) {
        const { pace } = run[i];
        if (cruise[i] > 0) moves.push(move(pace, pace, cruise[i] / pace));
        if (i < m - 1) moves.push(move(pace, run[i + 1].pace, paceTurn(pace, run[i + 1].pace)));
    }
    moves.push(move(run[m - 1].pace, 0, rampFor(run[m - 1].pace, plain)));
    return moves;
}

/** Add a leg's moves to a timeline (`state`: its time and the distance walked so far). */
function pushMoves(segments, state, moves, after) {
    const legStart = state.time;
    moves.forEach((move) => {
        const length = ((move.v0 + move.v1) / 2) * move.duration;
        segments.push({
            kind: 'move', start: state.time, duration: move.duration, length, walked: state.walked, legStart, after, ...move,
        });
        state.time += move.duration;
        state.walked += length;
    });
}

/** Add a stop to a timeline. */
function pushStop(segments, state, act, seconds, k = -1) {
    segments.push({
        kind: 'stop', start: state.time, duration: seconds, act, walked: state.walked, k,
    });
    state.time += seconds;
}

/**
 * A timeline of legs and stops along a path: from each stop to the next, then that stop.
 * @param {object} path    bearPath()
 * @param {Array} stops    [{ k, act, seconds }] in the order walked, the first where it starts
 * @param {Array} paces    the pace of the stretch from each knot to the next (m/s)
 * @param {boolean} plain  every leg carried as its walk, whatever its pace
 */
function layTimeline(path, stops, paces, plain) {
    const { knots, length } = path;
    const n = knots.length;
    const segments = [];
    const state = { time: 0, walked: 0 };
    for (let i = 0; i < stops.length; i++) {
        const from = stops[i];
        const to = stops[(i + 1) % stops.length];
        const stretches = [];
        let { k } = from;
        do {
            const next = (k + 1) % n;
            const d = (((knots[next] - knots[k]) % length) + length) % length || length;
            stretches.push({ length: d, pace: paces[k] });
            k = next;
        } while (k !== to.k);
        pushMoves(segments, state, legMoves(stretches, plain), [from.act, from.seconds]);
        pushStop(segments, state, to.act, to.seconds, to.k);
    }
    return { segments, period: state.time, origin: knots[stops[0].k] };
}

/**
 * Its course for an aspect: the way over the ice, the timeline of legs and stops along it, the
 * gait's clock over a lap, and where each foot squares up at each stop.
 *
 * Given a route and a pace alone it walks every leg at that pace and does at each stop what the
 * route says. A lap dealt from the bear's seed (dealLap, below) gives its own `stops` and `paces`,
 * the animal's `size`, and for a cub the way it keeps `beside` its mother's and the `segments` laid
 * from her timeline.
 */
export function bearCourse(aspect, {
    count, route = BEAR_ROUTE, pace = BEAR_PACE, size = 1, beside = null, stops = null, paces = null, segments = null, lazy = false,
} = {}) {
    const path = bearPath(aspect, {
        route, size, beside, count: count ?? Math.min(4096, Math.round(1024 / size)),
    });
    let timeline;
    if (segments) timeline = segments(path);
    else if (stops) timeline = layTimeline(path, stops, paces, false);
    else {
        const marked = route.map((entry, k) => ({ k, act: entry[2]?.[0], seconds: entry[2]?.[1] })).filter((s) => s.act);
        if (!marked.length) throw new Error('the bear\'s route needs a stop');
        timeline = layTimeline(path, marked, route.map(() => pace), true);
    }
    const course = {
        ...path,
        period: timeline.period,
        segments: timeline.segments,
        starts: Float64Array.from(timeline.segments, (s) => s.start),
        origin: timeline.origin,
        start: 0,
        pace,
        phase: null,
    };
    // Its clock starts just short of where it comes out from behind the trees.
    const into = (((path.knots[Math.min(START_KNOT, path.knots.length - 1)] - course.origin) % path.length) + path.length) % path.length;
    course.start = clockAtWalked(course, into) - START_LEAD;
    if (!lazy) finishCourse(course);
    return course;
}

/** The first moment of a lap at which it has walked `walked` metres of it. */
function clockAtWalked(course, walked) {
    const { segments } = course;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.kind !== 'move' || walked > s.walked + s.length) continue;
        let lo = 0;
        let hi = s.duration;
        for (let pass = 0; pass < 60; pass++) {
            const mid = (lo + hi) / 2;
            const x = mid / s.duration;
            const along = s.v0 * mid + (s.v1 - s.v0) * s.duration * rampArea(x);
            if (s.walked + along < walked) lo = mid;
            else hi = mid;
        }
        return s.start + hi;
    }
    return course.period;
}

/**
 * The rest of a course: the gait's clock (strides walked, sampled over a lap and made a whole
 * number to the lap, so its footfalls come round with the course) and where each foot squares up at
 * each stop. A course laid `lazy` is finished the first time its feet are asked for.
 */
function finishCourse(course) {
    const { segments, period: time } = course;
    const samples = Math.ceil(time / PHASE_STEP);
    const phase = new Float64Array(samples + 1);
    const lope = new Float32Array(samples + 1);
    const motion = {};
    let rate = 0;
    let lopes = false;
    for (let i = 1; i <= samples; i++) {
        const c = Math.min(time, i * PHASE_STEP);
        motionOf(course, c, motion);
        const next = cadence(motion.speed, gradeAt(course, course.origin + motion.walked), motion.ref);
        phase[i] = phase[i - 1] + 0.5 * (rate + next) * (c - Math.min(time, (i - 1) * PHASE_STEP));
        rate = next;
        lope[i] = bearLope(motion.speed);
        if (lope[i] > 0) lopes = true;
    }
    const laps = Math.max(1, Math.round(phase[samples]));
    const fit = laps / phase[samples];
    for (let i = 0; i <= samples; i++) phase[i] *= fit;
    course.phase = phase;
    course.strides = laps;
    course.phaseStep = time / samples;
    // Loping, each paw leaves the ice at another moment of the stride: each has its own clock.
    course.steps = lopes ? BEAR_FEET.map((_, f) => phase.map((v, i) => v - LIFTS[f] - LOPE_SHIFT[f] * lope[i])) : null;

    // Where each foot squares up at each stop: a paw left far from where it stands takes a step.
    course.settles = BEAR_FEET.map(() => new Map());
    const at = [0, 0, 0];
    const neutral = [0, 0, 0];
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        // (One stop after another: its feet squared up at the first.)
        if (s.kind !== 'stop' || (i > 0 && segments[i - 1].kind === 'stop')) continue;
        const waiting = [];
        for (let f = 0; f < BEAR_FEET.length; f++) {
            const k = stepAt(course, f, s.start);
            const lifted = liftedAt(course, f, k);
            const landed = lifted + bearSwingTime(speedAt(course, lifted));
            landing(course, f, landed, at);
            pawNeutral(course, f, s.walked, neutral);
            const off = Math.hypot(at[0] - neutral[0], at[1] - neutral[1]);
            if (off > G.settle) {
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
                k: w.k, start: begin, end: begin + G.settleTime, from: w.from, to: w.to,
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

/** The segment of the timeline a moment of a lap falls in. */
function segmentAt(course, c) {
    const { segments, starts } = course;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= c) lo = mid;
        else hi = mid - 1;
    }
    return segments[lo];
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
    if (s.kind === 'move') {
        const x = s.duration > 0 ? Math.min(1, tau / s.duration) : 1;
        const e = x * x * (3 - 2 * x);
        along = s.v0 * tau + (s.v1 - s.v0) * s.duration * rampArea(x);
        speed = s.v0 + (s.v1 - s.v0) * e;
        out.act = 'Walk';
        out.from = s.after[0];
        out.fromTime = s.after[1];
        out.actTime = c - s.legStart;
        out.actLength = 0;
        out.manner = s.m0 + (s.m1 - s.m0) * e;
        out.ref = s.ref;
    } else {
        out.act = s.act;
        out.from = 'Walk';
        out.fromTime = 0;
        out.actTime = tau;
        out.actLength = s.duration;
        out.manner = 0;
        out.ref = BEAR_PACE;
    }
    out.walked = lap * course.length + s.walked + along;
    out.speed = speed;
    out.blend = smooth(0, BEAR_BLEND, out.actTime);
    return out;
}

/** Strides walked (over every lap) at a moment of its clock. */
export function phaseAt(course, clock) {
    if (!course.phase) finishCourse(course);
    return tableAt(course, course.phase, clock);
}

/** A sampled clock of the gait (strides) read at a moment of the course's clock. */
function tableAt(course, table, clock) {
    const { period, phaseStep, strides } = course;
    const lap = Math.floor(clock / period);
    const c = (clock - lap * period) / phaseStep;
    const i = Math.min(table.length - 2, Math.floor(c));
    return lap * strides + table[i] + (table[i + 1] - table[i]) * (c - i);
}

/** The first moment of its clock at which it has walked `strides` strides. */
export function clockAtPhase(course, strides) {
    if (!course.phase) finishCourse(course);
    return clockIn(course, course.phase, strides);
}

/** The first moment of the course's clock at which a sampled clock of the gait reads `value`. */
function clockIn(course, table, value) {
    const { period, phaseStep, strides: laps } = course;
    const lap = Math.floor((value - table[0]) / laps);
    const r = value - lap * laps;
    let lo = 0;
    let hi = table.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid] < r) lo = mid;
        else hi = mid;
    }
    const span = table[hi] - table[lo];
    const t = span > 1e-12 ? (r - table[lo]) / span : 1;
    return lap * period + (lo + Math.max(0, Math.min(1, t))) * phaseStep;
}

/** Which step of paw `f` its clock is in (it leaves the ice at the start of each). */
function stepAt(course, f, clock) {
    if (!course.phase) finishCourse(course);
    return Math.floor(course.steps ? tableAt(course, course.steps[f], clock) : tableAt(course, course.phase, clock) - LIFTS[f]);
}

/** The moment paw `f` leaves the ice for its step `k`. */
function liftedAt(course, f, k) {
    return course.steps ? clockIn(course, course.steps[f], k) : clockIn(course, course.phase, k + LIFTS[f]);
}

const PLACE = [0, 0, 0];
/** Where a paw stands (x, z and the way it points) under a body that has walked `walked`. */
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
    out[2] = PLACE[2] - G.turnIn[f] * foot.side;
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
    const stance = Math.max(0, 1 / Math.max(cadence(v, grade, MOTION.ref), 1e-3) - bearSwingTime(v));
    // (A foreleg reaches a little less far ahead than it pushes back: its stance sits under the
    // shoulder a shade behind the middle.)
    const ahead = Math.min(G.lead, stance * (BEAR_FEET[f].front ? 0.36 : 0.5));
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
    const lifted = liftedAt(course, f, k);
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
/** How far each paw's toes reach ahead of the ball of the foot (metres). */
const TOE_REACH = BEAR_FEET.map((foot) => {
    const ball = BEAR_MARKS[foot.paw];
    const tip = BEAR_MARKS[`tip${foot.name}`];
    return Math.hypot(tip[0] - ball[0], tip[1] - ball[1], tip[2] - ball[2]) * BEAR_SCALE;
});

/**
 * Where paw `f` is at a moment of its clock: (x, z, the way it points), how high, its heel and
 * curl, and how far into a swing it is (0 on the ice). In the course's own measure.
 */
export function pawAt(course, f, clock, out = {}) {
    const k = stepAt(course, f, clock);
    const lifted = liftedAt(course, f, k);
    const pace = speedAt(course, lifted);
    const swing = bearSwingTime(pace);
    const landed = lifted + swing;
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
        // Carried high enough that its curled toes clear the ice (higher loping).
        const toes = TOE_REACH[f] * Math.sin(Math.min(Math.PI / 2, out.curl * 1.25));
        const high = G.lift[f] * (1 + G.lope.lift * bearLope(pace));
        out.lift = Math.max(high * Math.min(1, 0.35 + reach / 0.8) * arc(s), toes + 0.02 * arc(s));
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
        out.curl = G.flick[f] * 0.2 * Math.sin(Math.PI * s);
        // (As in a stride: high enough that its curled toes clear the ice.)
        out.lift = Math.max(G.lift[f] * 0.45 * arc(s), TOE_REACH[f] * Math.sin(Math.min(Math.PI / 2, out.curl * 1.25)) + 0.02 * arc(s));
        out.swing = arc(s) * 0.5;
        settling = smooth(0, 0.12, s) * (1 - smooth(0.88, 1, s));
        since = settle.end + later;
    }
    // Its heel peels up off the ice as the next step comes.
    const next = liftedAt(course, f, k + 1);
    const stance = Math.max(1e-3, next - since);
    out.pitch = G.peel[f] * smooth(0.62, 1, (clock - since) / stance) * (out.swing > 0 ? 0 : 1);
    // It comes off its weight as its heel peels, so the body is not left leaning on a leg that
    // is about to go.
    out.air = Math.max(settling, smooth(0.5, 1, (clock - since) / stance));
    return out;
}

/**
 * Where its course has it at a moment of its own clock: place, heading, pace, how far it has
 * walked and what it is doing. (Its feet: pawAt.) In the course's own measure.
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

// ── Who walks it, and what each lap holds ───────────────────────────────────────

/**
 * The bears that come by. `size` is against the big male (who is drawn BEAR_SCALE × life); `tone`
 * runs from a white coat (0) to old ivory (1); `hair` is how long the coat stands; `slim`, how
 * broad across. The first lap is always the big male as he has always been.
 */
export const BEAR_KINDS = Object.freeze({
    male: Object.freeze({
        size: Object.freeze([0.97, 1.04]), tone: Object.freeze([0.35, 1]), hair: Object.freeze([0.95, 1.12]), slim: 1, weight: 0.4,
    }),
    female: Object.freeze({
        size: Object.freeze([0.8, 0.87]), tone: Object.freeze([0, 0.6]), hair: Object.freeze([0.72, 0.88]), slim: 0.93, weight: 0.27,
    }),
    /** A female with her cub (the cub's numbers are BEAR_CUB). */
    family: Object.freeze({ weight: 0.33 }),
});
/**
 * A cub of the year: its size against the big male, how far to one side of its mother's way it
 * keeps (world metres; `stray` more or less from place to place) and how far behind her it stops
 * (`trail`; where it stands less than `clear` to one side of her, `behind` her instead), how long
 * it dawdles before it follows
 * (seconds, now and then much longer), how long after her it pulls up, and how fast it runs to
 * catch up (in its own measure: a lope).
 */
export const BEAR_CUB = Object.freeze({
    size: Object.freeze([0.4, 0.45]),
    side: Object.freeze([1.5, 2.3]),
    stray: 0.5,
    trail: Object.freeze([0.3, 1.5]),
    clear: 1.3,
    behind: 2.7,
    dawdle: Object.freeze([0.3, 2.4]),
    linger: Object.freeze([3.2, 5.5]),
    lag: Object.freeze([0.3, 1.5]),
    hurry: 3.0,
});

/** How much quicker a bear of `size` moves than the big male: its clock runs this much faster. */
const quickness = (size) => 1 / Math.sqrt(size);

/**
 * What it may do at a stop: [act, how likely near the eye, how likely far out, its seconds (or
 * null: the act's own; BEAR_ACT_SPAN's for those of adjustable length)].
 */
const STOP_ACTS = Object.freeze([
    ['Sniff', 1.0, 0.8, null],
    ['Scent', 1.0, 0.6, null],
    ['Look', 0.9, 0.6, null],
    ['Stand', 0.4, 0.3, [2.4, 3.6]],
    ['Sit', 1.0, 1.0, null],
    ['Rest', 0.5, 0.6, null],
    ['Roll', 0.7, 0.85, null],
    ['Hunt', 0.9, 0.9, null],
    ['Dig', 0.7, 0.4, null],
    ['Stretch', 0.55, 0.5, null],
    ['Upright', 0.7, 1.0, null],
    ['Shake', 0.4, 0.2, null],
]);
/** Those it does at most once a lap. */
const ONCE_A_LAP = Object.freeze({ Rest: true, Roll: true, Hunt: true });
/** What a cub may do at a stop (it has no patience for a long rest): [act, how likely]. */
const CUB_ACTS = Object.freeze([
    ['Look', 0.9], ['Scent', 0.7], ['Sit', 1.1], ['Roll', 1.0], ['Pounce', 1.2], ['Upright', 0.9], ['Shake', 0.4],
    ['Dig', 0.5], ['Stand', 0.3],
]);
/** What it may stop for a moment for on the way, falling behind: [act, how likely]. */
const CUB_PAUSES = Object.freeze([['Look', 1], ['Scent', 0.8], ['Upright', 0.6], ['Pounce', 0.7], ['Shake', 0.3]]);
/** Beyond this far from the eye (metres) a stop is far out. */
const FAR_OUT = 85;

/** One of `table`'s rows by its weight (`weigh(row)`; 0 leaves a row out). */
function pick(rand, table, weigh) {
    const weights = table.map(weigh);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!(total > 0)) return null;
    let r = rand() * total;
    for (let i = 0; i < table.length; i++) {
        r -= weights[i];
        if (weights[i] > 0 && r <= 0) return table[i];
    }
    return table[weights.findIndex((w) => w > 0)];
}

/** How long an act is given at a stop (seconds, in the animal's own measure). */
function actSeconds(rand, name, range) {
    const span = range || BEAR_ACT_SPAN[name];
    if (!span) return BEAR_ACTS[name];
    return span[0] + (span[1] - span[0]) * rand() ** 1.5;
}

/**
 * What lap `n` holds, from the bear's seed: who walks it, at which of the route's stops it stops
 * and what it does there, and its pace over each stretch. Never the same act at two stops running
 * (`before` is the lap before it, for the stop it ended on).
 */
export function dealLap(seed, n, way, before = null) {
    const rand = mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
    const { route, pace } = BEAR_ROUTES[way];
    // Who: the big male first; after that by weight.
    let kind = 'male';
    const who = rand() * (BEAR_KINDS.male.weight + BEAR_KINDS.female.weight + BEAR_KINDS.family.weight);
    if (n > 0 && who > BEAR_KINDS.male.weight) kind = who > BEAR_KINDS.male.weight + BEAR_KINDS.female.weight ? 'family' : 'female';
    const family = kind === 'family';
    const K = BEAR_KINDS[family ? 'female' : kind];
    const draws = [rand(), rand(), rand()];
    const size = n === 0 ? 1 : lerp(K.size[0], K.size[1], draws[0]);
    const tone = n === 0 ? 0.5 : lerp(K.tone[0], K.tone[1], draws[1]);
    const hair = n === 0 ? 1 : lerp(K.hair[0], K.hair[1], draws[2]);

    // Where it stops, and what for.
    const places = [];
    route.forEach((entry, k) => {
        if (k > 0 && entry[2]) places.push(k);
    });
    const stops = [{ k: 0, act: route[0][2][0], seconds: route[0][2][1] }];
    let last = before?.lastAct ?? null;
    const done = new Set();
    let left = places.length;
    places.forEach((k) => {
        const far = route[k][1] > FAR_OUT;
        // (Now and then it walks on past a place it knows; never past all of them.)
        const passes = rand() < 0.14 && left > 2;
        const row = pick(rand, STOP_ACTS, ([name, near, out]) => {
            if (name === last || (ONCE_A_LAP[name] && done.has(name))) return 0;
            return (far ? out : near) * (done.has(name) ? 0.3 : 1);
        });
        const seconds = actSeconds(rand, row[0], row[3]);
        if (passes) {
            left -= 1;
            return;
        }
        stops.push({ k, act: row[0], seconds });
        last = row[0];
        done.add(last);
    });

    // Its pace over each stretch: one manner a leg, now and then changed on the way. It comes in
    // at a walk or briskly; with a cub it never hurries.
    // (A way it has always taken slowly it mostly ambles; one it took quickly, it mostly takes briskly.)
    let moods = [['amble', 0.3], ['walk', 0.42], ['brisk', 0.26]];
    if (pace <= 1.05) moods = [['amble', 0.5], ['walk', 0.42], ['brisk', 0.1]];
    else if (pace >= 1.3) moods = [['amble', 0.15], ['walk', 0.42], ['brisk', 0.45]];
    if (family) moods = [['amble', 0.45], ['easy', 0.35], ['walk', 0.2]];
    const n0 = route.length;
    const paces = new Array(n0).fill(BEAR_PACES.walk);
    const legs = [];
    stops.forEach((stop, i) => {
        const to = stops[(i + 1) % stops.length].k;
        const knots = [];
        let { k } = stop;
        do {
            knots.push(k);
            k = (k + 1) % n0;
        } while (k !== to);
        let [mood] = pick(rand, moods, (row) => row[1]);
        if (i === 0 && mood === 'amble') mood = family ? 'easy' : 'walk';
        const changes = !family && knots.length >= 3 && rand() < 0.3;
        const change = changes ? 1 + Math.floor(rand() * (knots.length - 1)) : -1;
        const [other] = pick(rand, moods, (row) => (row[0] === mood ? 0 : row[1]));
        knots.forEach((at, j) => {
            paces[at] = BEAR_PACES[change >= 0 && j >= change ? other : mood];
        });
        legs.push(knots);
    });
    // Rarely, a lope: over one stretch in the middle of a leg (laid once the way is known: layLope).
    const lope = !family && rand() < 0.28 ? { leg: rand(), stretch: rand() } : null;

    // Her cub, if she has one.
    let cub = null;
    if (family) {
        const C = BEAR_CUB;
        cub = {
            size: lerp(C.size[0], C.size[1], rand()),
            tone: tone * 0.5,
            hair: 1,
            side: (rand() < 0.5 ? -1 : 1),
            seed: (seed ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0,
        };
    }
    return {
        n, way, kind: family ? 'female' : kind, family, size, tone, hair, slim: K.slim, stops, paces, legs, lope, cub, lastAct: last,
    };
}

/**
 * Give a dealt lap its lope, now that its way is laid: one stretch in the middle of a leg (never
 * the stretch it sets off on or pulls up on), long enough and on level ice, is loped.
 */
function layLope(deal, path) {
    if (!deal.lope || deal.lope.done) return;
    deal.lope.done = true;
    const { route } = BEAR_ROUTES[deal.way];
    const n = route.length;
    const fits = [];
    deal.legs.forEach((knots) => {
        for (let j = 1; j < knots.length - 1; j++) {
            const k = knots[j];
            const from = path.knots[k];
            const to = k + 1 < n ? path.knots[k + 1] : path.length;
            if (to - from < 16) continue;
            let level = true;
            for (let d = from; d <= to; d += 1) if (Math.abs(gradeAt(path, d)) > 0.02) level = false;
            // (Where the frame can show it: not far behind the card, not past the frame's edge.)
            const seen = [route[k][0], route[(k + 1) % n][0]].every((f) => f < BEAR_EDGE && Math.abs(f) < 0.95);
            if (level && seen) fits.push(k);
        }
    });
    if (!fits.length) return;
    const k = fits[Math.min(fits.length - 1, Math.floor(deal.lope.stretch * fits.length))];
    deal.paces[k] = BEAR_PACES.lope;
    deal.lope.k = k;
}

/**
 * The cub's timeline, laid from its mother's. It keeps to its own way beside hers (`path`). At each
 * of her stops it pulls up a little behind her, a moment after she does, and does something of its
 * own; it dawdles before it follows her off, and now and then stops on the way to look at
 * something, and then runs to catch up. It is never ahead of her.
 * @param {object} mother  her course
 * @param {object} path    the cub's way (bearPath, in its own measure)
 * @param {object} cub     the cub of the deal
 * @param {number} rate    how many of its seconds pass in one of hers
 * @param {Array} aside    how far to one side of her it stands at each knot (world metres)
 */
function layCub(mother, path, cub, rate, aside) {
    const rand = mulberry32(cub.seed);
    const C = BEAR_CUB;
    const k0 = quickness(cub.size);
    /**
     * How far behind her it stops at knot `k` (its own metres): a little, where it stands well to
     * one side of her; a body's length where a bend has brought its way in beside hers.
     */
    const trail = (k) => (aside[k] >= C.clear ? lerp(C.trail[0], C.trail[1], rand()) : C.behind + rand() * 0.6) / cub.size;
    const home = trail(0);
    /**
     * How far along its own way it stands when she stands at knot `k` (`lap`: which time round;
     * where the ways meet it stands in one place, so its lap closes).
     */
    const standsAt = (k, lap) => path.knots[k] + lap * path.length - (k === 0 ? home : trail(k));

    // Her legs: when she sets off and pulls up (in the cub's seconds), her pace, and her stop.
    const hers = [];
    let leg = null;
    mother.segments.forEach((s) => {
        if (s.kind === 'move') {
            if (!leg) leg = { depart: s.start * rate, pace: 0, length: 0 };
            leg.pace = Math.max(leg.pace, s.v0, s.v1);
            leg.length += s.length;
        } else {
            hers.push({
                ...leg, arrive: s.start * rate, stay: s.duration * rate, act: s.act, k: s.k,
            });
            leg = null;
        }
    });

    const segments = [];
    const origin = standsAt(0, 0);
    const state = { time: 0, walked: 0 };
    /** The stop it last made ([act, seconds]: what its walk off is cross-faded from), and its last act. */
    let last = ['Stand', 0];
    let lastAct = null;
    const stop = (name, seconds, k) => {
        pushStop(segments, state, name, seconds, k);
        last = [name, seconds];
    };
    /** The least time an act takes. */
    const least = (act) => BEAR_ACT_SPAN[act]?.[0] ?? BEAR_ACTS[act];
    /** Something of its own that fits `room` seconds, now and then (`copy`) what its mother does. */
    const choose = (room, hersAct, copy) => {
        const copies = copy && rand() < 0.3 && CUB_ACTS.some((row) => row[0] === hersAct) && least(hersAct) <= room - 0.2;
        if (copies) return hersAct;
        const row = pick(rand, CUB_ACTS, ([act, w]) => (act === lastAct || least(act) > room - 0.2 ? 0 : w));
        return row ? row[0] : 'Stand';
    };
    /** Stand (or do something) from now until `until`. */
    const stay = (until, hersAct, k) => {
        let room = until - state.time;
        if (room <= 1e-6) return;
        let first = true;
        while (room > 0.05) {
            const name = hersAct && room > 3 ? choose(room, hersAct, first) : 'Stand';
            const span = BEAR_ACT_SPAN[name];
            let seconds = name === 'Stand' ? room : BEAR_ACTS[name];
            if (span) seconds = Math.min(span[1], Math.max(span[0], room - rand() * Math.min(3, room - span[0])));
            // (What is left after it is too short for anything else: it stands.)
            stop(name, seconds, k);
            if (name !== 'Stand') lastAct = name;
            room -= seconds;
            // (What is left after it is too short for anything else: it stands.)
            if (room > 0.05 && room < 3.2) {
                stop('Stand', room, k);
                room = 0;
            }
            first = false;
        }
    };
    /**
     * The one pace that covers `length` in exactly `seconds`, from rest to rest: its ramps take
     * rampFor(pace) each, and all of a leg too short for them.
     */
    const evenPace = (length, seconds) => {
        const slow = length / (seconds - BEAR_RAMP);
        if (seconds >= 2 * BEAR_RAMP && slow <= LOPE_FROM) return slow;
        // (At a run its ramps are longer.)
        const fast = length / (seconds - BEAR_RAMP * LOPE_RAMP);
        return fast > LOPE_FROM && seconds >= 2 * BEAR_RAMP * LOPE_RAMP ? fast : (2 * length) / seconds;
    };
    /**
     * Cover `length` in `seconds`, from rest to rest: at `follow` if that does it, else hurrying
     * first and falling in at `follow`; null if it cannot be done at a pace it has.
     */
    const cover = (length, seconds, follow, hurry) => {
        const r1 = rampFor(hurry);
        const r3 = rampFor(follow);
        if (seconds <= 1.5) return null;
        const even = evenPace(length, seconds);
        const plain = (pace) => [{ length, pace }];
        if (even <= follow * 1.02) return even >= 0.3 ? plain(even) : null;
        // Hurrying: [to `hurry`] [at it] [down to `follow`] [at it] [to rest].
        const r2 = Math.max(PACE_CHANGE_LEAST, (hurry - follow) / PACE_CHANGE);
        const rest = seconds - r1 - r2 - r3;
        const t1 = (length - (hurry * r1) / 2 - ((hurry + follow) * r2) / 2 - (follow * r3) / 2 - follow * rest) / (hurry - follow);
        if (rest > 0 && t1 >= 0 && t1 <= rest) {
            const first = (hurry * r1) / 2 + hurry * t1 + ((hurry + follow) * r2) / 4;
            return [{ length: first, pace: hurry }, { length: length - first, pace: follow }];
        }
        // (No room to fall in behind her: one pace all the way, if it has one that is no half lope.)
        if (even <= LOPE_FROM - 0.15 || (even >= LOPE_BY && even <= hurry * 1.12)) return plain(even);
        return null;
    };
    const walk = (stretches) => pushMoves(segments, state, legMoves(stretches, false), last);

    hers.forEach((her, i) => {
        const lap = i === hers.length - 1 ? 1 : 0;
        const target = standsAt(her.k, lap) - origin;
        const length = target - state.walked;
        // Its pace beside hers: the same ground in the same time.
        let follow = (her.pace * mother.size * quickness(mother.size)) / (cub.size * quickness(cub.size));
        // (Its way is a little longer or shorter than hers; whatever that asks, it follows at a walk.)
        if (her.length > 1) follow *= 0.5 + clamp01((length * cub.size) / (her.length * mother.size) - 0.5);
        follow = Math.min(follow, LOPE_FROM - 0.2);
        const lingers = rand() < 0.22;
        const dawdle = (lingers ? lerp(C.linger[0], C.linger[1], rand()) : lerp(C.dawdle[0], C.dawdle[1], rand())) * k0;
        const lag = Math.min(lerp(C.lag[0], C.lag[1], rand()) * k0, Math.max(0.2, her.stay - 0.6));
        const pauses = rand() < 0.4;
        const at = lerp(0.3, 0.62, rand());
        const pause = pick(rand, CUB_PAUSES, (row) => row[1])[0];
        let depart = her.depart + dawdle;
        const arrive = her.arrive + lag;
        // (It cannot set off before it has got there.)
        depart = Math.max(depart, state.time + 0.4);
        let laid = null;
        if (pauses && arrive - depart > 30) {
            // Part of the way at her pace, a stop to look at something, and a run to catch up.
            const a = length * at;
            const there = a / follow + rampFor(follow);
            const b = cover(length - a, arrive - depart - there - BEAR_ACTS[pause], follow, C.hurry);
            if (b && b.length === 2) laid = { a, there, b };
        }
        let direct = laid ? null : cover(length, arrive - depart, follow, C.hurry);
        if (!laid && !direct) {
            // (No time to dawdle: it sets off with her.)
            depart = Math.max(her.depart + 0.2 * k0, state.time + 0.2);
            direct = cover(length, arrive - depart, follow, C.hurry)
                || [{ length, pace: evenPace(length, Math.max(1.5, arrive - depart)) }];
        }
        stay(depart, i === 0 ? null : hers[i - 1].act, i === 0 ? 0 : hers[i - 1].k);
        if (laid) {
            walk([{ length: laid.a, pace: follow }]);
            stop(pause, BEAR_ACTS[pause], -1);
            walk(laid.b);
        } else walk(direct);
        // (Rounding: it pulls up exactly where it meant to.)
        state.walked = target;
    });
    // Its last stop, where the ways meet, lasts as long as hers.
    stay(mother.period * rate, null, 0);
    return { segments, period: mother.period * rate, origin };
}

// ── The mind ────────────────────────────────────────────────────────────────────

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
 * What the board can make it do, each laid over whatever it was doing with its clock held: the act,
 * how long it holds it (seconds; Infinity: until it is let go), and how long a cub waits before it
 * does the same.
 */
const BOARD_ACTS = Object.freeze({
    rear: Object.freeze({ act: 'Rear', seconds: BEAR_ACTS.Rear, copy: 0.5 }),
    wonder: Object.freeze({ act: 'Wonder', seconds: BEAR_ACTS.Wonder, copy: 0.6 }),
    lie: Object.freeze({ act: 'Lie', seconds: Infinity, copy: 0.9 }),
});
/** The numbers of a spec an act of the head alone moves. */
const HEAD_NUMBERS = Object.freeze([SPEC.headYaw, SPEC.headPitch, SPEC.headRoll, SPEC.reach, SPEC.earL, SPEC.earR]);

const newPose = () => ({
    present: true,
    x: 0,
    y: 0,
    z: -60,
    heading: 0,
    speed: 0,
    act: 'Stand',
    actTime: 0,
    actLength: 0,
    from: 'Stand',
    fromTime: 0,
    blend: 1,
    manner: 0,
    over: null,
    overTime: 0,
    overBlend: 0,
    distance: 0,
    walked: 0,
    clip: 'Stand',
    breath: 0,
    /** How tall it stands against a bear on all fours (lying down, less; up on its hind legs, more). */
    tall: 1,
    /** Who it is: its size against the big male, its coat (0 white .. 1 ivory), its hair, how broad. */
    kind: 'male',
    size: 1,
    tone: 0.5,
    hair: 1,
    slim: 1,
    /** The spec its body solves. */
    spec: createBearSpec(),
    /** Each paw in the world: x, y, z (BEAR_FEET order), how far into a swing, how far off its weight. */
    paws: BEAR_FEET.map(() => ({
        x: 0, y: 0, z: 0, swing: 0, air: 0,
    })),
});

/**
 * The bear's mind: its clock, who is walking this lap and what the lap holds, what the board has
 * made it do, and the pose that results — a spec its body (winter-bear-rig.js) solves. A lap with
 * a cub resolves the cub's pose too (`pose.cub`).
 */
export class BearMind {
    /**
     * @param {number} [aspect]
     * @param {object} [o]
     * @param {number} [o.start]  where on its clock it starts (seconds; the course's own when not given)
     * @param {number} [o.seed]   what its laps are dealt from
     */
    constructor(aspect = 16 / 9, { start, seed = 0xbea7 } = {}) {
        this.aspect = aspect;
        this.seed = seed;
        this.startAt = start;
        // Its laps: which way it takes each time, how long it stays out of sight before it, and what
        // the lap holds (dealLap). The first is its first way at once; the rest are dealt from its
        // seed as its clock reaches them.
        this.lapRand = mulberry32(seed);
        this.laps = [this.newLap(0, 0, 0, 0, null)];
        this.pose = newPose();
        this.pose.cub = newPose();
        this.pose.cub.present = false;
        this.pose.cub.kind = 'cub';
        this.course = this.courseOf(this.laps[0]);
        this.reset(0);
    }

    /** A lap: its way, its wait, when it starts, what it holds, and how long it takes (seconds). */
    newLap(n, way, wait, start, before) {
        const deal = dealLap(this.seed, n, way, before);
        const lap = {
            n, way, wait, start, deal, course: null, cubCourse: null, period: 0,
        };
        lap.period = this.layLap(lap).period / quickness(deal.size);
        return lap;
    }

    /** A lap's course for the frame: its way and timeline (its footsteps are laid when first asked for). */
    layLap(lap) {
        const { deal } = lap;
        const { route } = BEAR_ROUTES[deal.way];
        const options = {
            route, size: deal.size, stops: deal.stops, paces: deal.paces, lazy: true,
        };
        let course = bearCourse(this.aspect, options);
        if (deal.lope && !deal.lope.done) {
            layLope(deal, course);
            if (deal.lope.k !== undefined) course = bearCourse(this.aspect, options);
        }
        lap.course = course;
        lap.cubCourse = null;
        return course;
    }

    /** The course of a lap (laid again if it was let go). */
    courseOf(lap) {
        return lap.course || this.layLap(lap);
    }

    /** The cub's course on a lap that has one: its own way beside its mother's, timed from hers. */
    cubCourseOf(lap) {
        if (lap.cubCourse || !lap.deal.cub) return lap.cubCourse;
        const { deal } = lap;
        const { cub } = deal;
        const mother = this.courseOf(lap);
        const { route } = BEAR_ROUTES[deal.way];
        // Its way: hers, moved to one side of her, a little more or less from place to place.
        const rand = mulberry32(cub.seed ^ 0x51ed);
        const keeps = lerp(BEAR_CUB.side[0], BEAR_CUB.side[1], rand());
        const sides = besideWay(mother, cub.side, keeps, BEAR_CUB.stray, rand() * TAU);
        const aside = route.map((_, k) => Math.abs(sides[Math.round((mother.knots[k] / mother.length) * sides.length) % sides.length]));
        const rate = quickness(cub.size) / quickness(deal.size);
        lap.cubCourse = bearCourse(this.aspect, {
            route,
            size: cub.size,
            beside: { course: mother, sides },
            lazy: true,
            segments: (path) => layCub(mother, path, cub, rate, aside),
        });
        return lap.cubCourse;
    }

    /** The lap its clock is in (its number); the laps are dealt up to there if they are not yet. */
    lapIndex(clock) {
        const { laps } = this;
        let last = laps[laps.length - 1];
        while (clock >= last.start + last.wait + last.period) last = this.dealNext();
        let lo = 0;
        let hi = laps.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (laps[mid].start <= clock) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /** Deal the lap after the last one dealt. */
    dealNext() {
        const { laps } = this;
        const last = laps[laps.length - 1];
        const way = chooseWay(this.lapRand, last.way);
        const wait = BEAR_AWAY[0] + (BEAR_AWAY[1] - BEAR_AWAY[0]) * this.lapRand() ** 2;
        const lap = this.newLap(laps.length, way, wait, last.start + last.wait + last.period, last.deal);
        // (Only the lap it is on, the one before and the one to come keep their courses.)
        if (laps.length >= 2) {
            laps[laps.length - 2].course = null;
            laps[laps.length - 2].cubCourse = null;
        }
        laps.push(lap);
        return lap;
    }

    /**
     * The way its clock has it on and its clock along that way (the world's seconds): out of sight
     * past the frame's edge it stands where its ways meet until its wait is over.
     */
    lapClock(clock) {
        const lap = this.laps[this.lapIndex(clock)];
        const course = this.courseOf(lap);
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

    /** Who is walking at a world time: 'male', 'female', or 'family' (a female with her cub). */
    castAt(time = this.time) {
        const { deal } = this.laps[this.lapIndex(this.clockAt(time))];
        return deal.family ? 'family' : deal.kind;
    }

    /**
     * Where on its clock something first happens, for looking at it (a playground capture, a
     * test): `seconds` into the first lap from lap `from` that `holds(deal)`, or into lap `lap`.
     * Laps are dealt as far as `most` to find it; null if none holds.
     */
    clockOf({
        lap = null, holds = null, seconds = 0, from = 0, most = 80,
    } = {}) {
        const dealTo = (n) => {
            while (this.laps.length <= n) this.dealNext();
        };
        let n = lap;
        if (n === null) {
            for (n = from; n < most; n++) {
                dealTo(n);
                if (!holds || holds(this.laps[n].deal)) break;
            }
            if (n >= most) return null;
        }
        dealTo(n);
        return this.laps[n].start + this.laps[n].wait + seconds;
    }

    /**
     * When it (or, `cub`, a cub) first does `act` at a stop, or first goes at a pace ('amble',
     * 'brisk', 'lope'): its clock `seconds` into that. Null if it never does within `most` laps.
     */
    clockWhen(what, {
        cub = false, seconds = 0, from = 0, most = 80,
    } = {}) {
        const paced = {
            amble: (s) => s.v0 === s.v1 && s.m0 < -0.5, brisk: (s) => s.v0 === s.v1 && s.m0 > 0.5 && s.m0 <= 1, lope: (s) => s.v0 === s.v1 && s.m0 > 1.5,
        }[what];
        for (let n = from; n < most; n++) {
            while (this.laps.length <= n) this.dealNext();
            const lap = this.laps[n];
            if (cub && !lap.deal.cub) continue;
            const course = cub ? this.cubCourseOf(lap) : this.courseOf(lap);
            const quick = quickness(cub ? lap.deal.cub.size : lap.deal.size);
            const found = course.segments.find((s) => (paced ? s.kind === 'move' && paced(s) && s.duration > 2 : s.kind === 'stop' && s.act === what));
            // (A pace is looked at from the middle of its stretch.)
            if (found) return lap.start + lap.wait + (found.start + (paced ? found.duration / 2 : 0)) / quick + seconds;
        }
        return null;
    }

    /** Fit its ways to another aspect, keeping which lap it is on and how far along it. */
    setAspect(aspect, time = this.time) {
        if (aspect === this.aspect) return;
        const clock = this.clockAt(time);
        const lap = this.laps[this.lapIndex(clock)];
        const into = clock - lap.start;
        const share = into < lap.wait ? null : (into - lap.wait) / lap.period;
        this.aspect = aspect;
        // The same laps and waits, timed again for the frame's own courses.
        let start = 0;
        this.laps.forEach((l) => {
            /* eslint-disable no-param-reassign */
            l.start = start;
            l.period = this.layLap(l).period / quickness(l.deal.size);
            if (l !== lap) l.course = null;
            /* eslint-enable no-param-reassign */
            start += l.wait + l.period;
        });
        this.course = this.courseOf(lap);
        const target = lap.start + (share === null ? into : lap.wait + share * lap.period);
        this.offset += target - clock;
    }

    /**
     * Nothing the board made it do in flight: where it is is the world clock's alone again (a seek
     * to any time shows it where a world that ran from the start would have it).
     */
    reset(time = 0) {
        this.time = time;
        this.offset = this.startAt ?? this.courseOf(this.laps[0]).start;
        this.held = 0;
        this.cut = null;
        this.nod = null;
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
        const busy = cut && (cut.kind === 'lie' || cut.kind === 'wonder' || (cut.kind === 'rear' && time < cut.end - 1.5));
        if (busy) return false;
        this.hold('rear', time, time + BOARD_ACTS.rear.seconds);
        return true;
    }

    /**
     * The board's greatest moment (a perfect clear): it stands up, then sits down where it stood
     * and watches the sky. It takes over from a four's standing up; a second one while it watches
     * changes nothing.
     */
    wonder(time) {
        const { cut } = this;
        if (cut && (cut.kind === 'lie' || (cut.kind === 'wonder' && time < cut.end - 1.5))) return false;
        // (Already up on its hind legs for a four: it goes on from there, not down and up again.)
        const up = cut?.kind === 'rear' && time < cut.end - 2.5 ? Math.max(0, Math.min(time - cut.from, 3.9)) : 0;
        this.hold('wonder', time, time + BOARD_ACTS.wonder.seconds - up);
        this.cut.from = time - up;
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

    /**
     * A level gained: it lifts its head and scents the wind, without breaking its stride. (Nothing
     * while the board holds it.)
     */
    scent(time) {
        return this.nodWith('Wind', time);
    }

    /**
     * A twist: its head turns sharply to the board (the viewer's side of the lake), holds the look
     * and lets it go, without breaking its stride.
     */
    glance(time) {
        return this.nodWith('Glance', time);
    }

    /** Start an act of its head alone, unless the board holds it or one has only just begun. */
    nodWith(act, time) {
        if (this.cut && this.holdAt(time) > 0.05) return false;
        if (this.nod && time < this.nod.from + 1) return false;
        this.nod = { act, from: time };
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
        if (this.nod && time > this.nod.from + BEAR_ACTS[this.nod.act]) this.nod = null;
        // Which of its ways it is on, who is walking it, and how far along it.
        const { course, local, lap } = this.lapClock(this.clockAt(time));
        this.course = course;
        const { deal } = lap;
        const p = this.pose;
        p.kind = deal.kind;
        p.size = deal.size;
        p.tone = deal.tone;
        p.hair = deal.hair;
        p.slim = deal.slim;
        this.resolve(p, course, local, time, 0);
        const { cub } = p;
        cub.present = Boolean(deal.cub);
        if (deal.cub) {
            cub.size = deal.cub.size;
            cub.tone = deal.cub.tone;
            cub.hair = deal.cub.hair;
            this.resolve(cub, this.cubCourseOf(lap), local, time, 1);
        }
        // (Near the end of a lap the next is dealt and laid, a course a frame, while it is out of sight.)
        const left = lap.period - local;
        if (left < 6 && lap.n === this.laps.length - 1) this.dealNext();
        else if (left < 5) {
            const next = this.laps[lap.n + 1];
            if (next && !next.course?.phase) finishCourse(this.courseOf(next));
            else if (next && next.deal.cub && !next.cubCourse?.phase) finishCourse(this.cubCourseOf(next));
        }
        return p;
    }

    /**
     * One animal's pose on its course at the lap's clock `local` (world seconds): `p` is filled in
     * world metres. `copies` is 1 for a cub: it does what the board makes its mother do a beat later.
     */
    resolve(p, course, local, time, copies) {
        const { size } = p;
        const quick = quickness(size);
        const clock = local * quick;
        const { ground } = course;
        if (!course.phase) finishCourse(course);
        bearOnCourse(course, clock, p);
        const still = this.holdAt(time);
        p.speed *= 1 - still;
        // The chest and the hips ride the ground under them (over a spit's back, the body tilts),
        // or under their feet where that is lower: across a slope, the downhill feet must reach.
        bearPlace(course, p.distance + CHEST_AHEAD, CHEST);
        bearPlace(course, p.distance - HIPS_BEHIND, HIPS);
        const under = (f) => {
            pawNeutral(course, f, p.walked, NEUTRAL);
            return ground(NEUTRAL[0], NEUTRAL[1]);
        };
        const chestY = softLow(ground(CHEST[0], CHEST[1]), under(0), under(1));
        const hipsY = softLow(ground(HIPS[0], HIPS[1]), under(2), under(3));
        p.y = (chestY + hipsY) * 0.5;

        // What it is doing (cross-faded from what it was doing).
        const { spec } = p;
        const mix = p.blend * p.blend * (3 - 2 * p.blend);
        bearAct(spec, p.act, p.actTime, p.actLength);
        if (mix < 1) {
            // (Its trunk and head; an act's paws are stepped by the act itself, from where they stand
            // and back, so they are never part of a cross-fade.)
            bearAct(SPEC_B, p.from, p.fromTime, p.fromTime);
            for (let i = 0; i < SPEC.feet; i++) spec[i] = SPEC_B[i] + (spec[i] - SPEC_B[i]) * mix;
        }
        // The back follows the curve of the path: the chest walks ahead on it, the hips behind.
        spec[SPEC.fore] += (p.y - chestY) / BEAR_SCALE;
        spec[SPEC.drop] += (p.y - hipsY) / BEAR_SCALE;
        const chestYaw = wrapAngle(CHEST[2] - p.heading);
        const hipsYaw = wrapAngle(HIPS[2] - p.heading);
        spec[SPEC.bend] += chestYaw - hipsYaw;
        spec[SPEC.yaw] += (chestYaw + hipsYaw) * 0.5;

        // Its feet, from the course into the model's frame; and the body riding them.
        const c = Math.cos(p.heading);
        const s = Math.sin(p.heading);
        const swings = [0, 0, 0, 0];
        for (let f = 0; f < BEAR_FEET.length; f++) {
            pawAt(course, f, clock, PAW);
            const ball = BEAR_MARKS[BEAR_FEET[f].paw];
            const wx = PAW.x - p.x;
            const wz = PAW.z - p.z;
            const o = SPEC.feet + f * FOOT.size;
            const floor = ground(PAW.x, PAW.z);
            spec[o + FOOT.dx] += (wx * c - wz * s) / BEAR_SCALE - ball[0];
            spec[o + FOOT.dz] += (wx * s + wz * c) / BEAR_SCALE - ball[2];
            spec[o + FOOT.dy] += (PAW.lift + floor - p.y) / BEAR_SCALE;
            spec[o + FOOT.pitch] += PAW.pitch;
            spec[o + FOOT.curl] += PAW.curl;
            spec[o + FOOT.air] += PAW.air;
            spec[o + FOOT.yaw] += wrapAngle(PAW.yaw - p.heading);
            // Set down on a slope, the paw lies along it (toes up the rise, not into it).
            const ahead = TOE_REACH[f];
            const rise = ground(PAW.x + Math.sin(PAW.yaw) * ahead, PAW.z + Math.cos(PAW.yaw) * ahead)
                - ground(PAW.x - Math.sin(PAW.yaw) * ahead, PAW.z - Math.cos(PAW.yaw) * ahead);
            spec[o + FOOT.ground] += -Math.atan2(rise, 2 * ahead);
            swings[f] = PAW.swing;
            const out = p.paws[f];
            out.x = PAW.x * size;
            out.y = (floor + PAW.lift) * size;
            out.z = PAW.z * size;
            out.swing = PAW.swing;
        }
        const [fl, fr, bl, br] = swings;
        const going = smooth(0, 0.5, p.speed / BEAR_PACE);
        const lope = bearLope(p.speed);
        const walks = 1 - lope;
        // The shoulders roll and the hips sway over the feet that are down; the body settles a
        // little on each foot that swings, and rides lower walking than standing.
        const chestRoll = 0.045 * (fr - fl) * walks;
        const hipsRoll = 0.04 * (br - bl) * walks;
        spec[SPEC.roll] += (chestRoll + hipsRoll) * 0.5;
        spec[SPEC.twist] += chestRoll - hipsRoll;
        spec[SPEC.sway] += 0.018 * (fr - fl + br - bl) * 0.5 * walks;
        spec[SPEC.fore] += 0.016 * (fl + fr) + 0.045 * going;
        spec[SPEC.drop] += 0.013 * (bl + br) + 0.04 * going;
        spec[SPEC.shift] += 0.012 * (fl + fr - bl - br) * going;
        // The head swings to the side of the planted forepaw, low, and nods with each step.
        spec[SPEC.headYaw] += 0.12 * (fr - fl) * walks;
        spec[SPEC.headRoll] += 0.05 * (fl - fr) * walks;
        spec[SPEC.headPitch] += 0.03 * (fl + fr) - 0.02 * going;
        spec[SPEC.tailYaw] += 0.15 * (bl - br);
        // How it carries itself at its pace. Ambling, its head is low and swings slowly from side to
        // side over the ice, a sweep to two strides; walking briskly it is carried higher and steady.
        const amble = clamp01(-p.manner) * going;
        const brisk = clamp01(p.manner) * going * walks;
        if (amble > 0) {
            const sweep = Math.sin(Math.PI * phaseAt(course, clock));
            spec[SPEC.headPitch] += -0.2 * amble;
            spec[SPEC.reach] += 0.26 * amble;
            spec[SPEC.headYaw] += 0.3 * sweep * amble;
            spec[SPEC.headRoll] += 0.06 * sweep * amble;
            spec[SPEC.fore] += 0.02 * amble;
        }
        if (brisk > 0) {
            spec[SPEC.headPitch] += 0.07 * brisk;
            spec[SPEC.reach] += -0.07 * brisk;
            spec[SPEC.headYaw] -= 0.05 * (fr - fl) * brisk;
        }
        if (lope > 0) {
            // Loping it rocks: down in front as its forefeet take it, its back rounding as the hind
            // feet come under, up and stretched as they drive it off; its head held level.
            const fore = (fl + fr) * 0.5;
            const hind = (bl + br) * 0.5;
            const rock = (hind - fore) * lope;
            spec[SPEC.pitch] += 0.1 * rock;
            spec[SPEC.arch] += 0.13 * rock + 0.03 * lope;
            spec[SPEC.fore] += -0.05 * fore * lope;
            spec[SPEC.drop] += -0.06 * hind * lope;
            spec[SPEC.headPitch] += (0.1 + 0.06 * rock) * lope;
            spec[SPEC.reach] += -0.06 * lope;
            spec[SPEC.earL] += 0.3 * lope;
            spec[SPEC.earR] += 0.3 * lope;
        }

        // What the board made it do, laid over the rest.
        p.over = null;
        p.overBlend = 0;
        if (this.cut) {
            const k = this.cut;
            const board = BOARD_ACTS[k.kind];
            const wait = copies * board.copy;
            const from = k.from + wait;
            if (k.kind === 'lie' && Number.isFinite(k.end) && k.rise !== undefined) {
                p.over = 'Rise';
                p.overTime = Math.max(0, time - k.rise - wait * 0.4);
                p.overBlend = 1 - smooth(k.end - 0.4, k.end + 0.6, time);
            } else if (k.kind === 'lie') {
                p.over = 'Lie';
                p.overTime = Math.min(Math.max(0, time - from), LIE_HOLD);
                p.overBlend = smooth(from, from + 0.8, time);
            } else {
                p.over = board.act;
                p.overTime = Math.max(0, time - from);
                p.overBlend = smooth(from, from + 0.6, time) * (1 - smooth(k.end - 0.5, k.end + 0.5, time));
            }
        }
        if (p.over && p.overBlend > 0) {
            bearAct(SPEC_B, p.over, p.overTime);
            const w = p.overBlend * p.overBlend * (3 - 2 * p.overBlend);
            // (Only an act that places its own feet takes them from the gait.)
            const feet = OWNS_FEET[p.over] ? SPEC_B.length : SPEC.feet;
            for (let i = 0; i < feet; i++) spec[i] += (SPEC_B[i] - spec[i]) * w;
        }
        // An act of its head alone (a level gained, a twist), laid over whatever else.
        if (this.nod && HEAD_ONLY[this.nod.act]) {
            const age = time - this.nod.from - copies * 0.35;
            const length = BEAR_ACTS[this.nod.act];
            if (age > 0 && age < length) {
                // (A glance looks to the viewer's side of the lake: how far round that is from its nose.)
                const toward = wrapAngle(Math.atan2(-p.x, -p.z) - p.heading);
                bearAct(SPEC_B, this.nod.act, age, length, toward);
                const w = smooth(0, 0.3, age) * (1 - smooth(length - 0.4, length, age)) * (1 - 0.85 * p.overBlend);
                for (let i = 0; i < HEAD_NUMBERS.length; i++) {
                    const n = HEAD_NUMBERS[i];
                    spec[n] += (SPEC_B[n] - spec[n]) * w;
                }
                // (What lies behind it, it turns its shoulders to as well.)
                const behind = this.nod.act === 'Glance' ? clamp01(Math.abs(toward) - 1.2) * Math.sign(toward) : 0;
                spec[SPEC.bend] += 0.18 * behind * w;
            }
        }
        p.clip = p.over && p.overBlend > 0.5 ? p.over : p.act;
        // It breathes: slow and deep, and deeper still once it has walked a while and stopped.
        const resting = p.act === 'Walk' ? 1 - p.blend : 1;
        p.breath = Math.sin(time * TAU * 0.28 * quick) * (0.4 + 0.6 * clamp01(resting + p.overBlend));
        spec[SPEC.arch] += 0.01 * p.breath;
        spec[SPEC.fore] -= 0.006 * p.breath;
        // How tall it stands: lower lying or sitting, taller up on its hind legs.
        const low = clamp01((spec[SPEC.fore] + spec[SPEC.drop]) / 0.94);
        const up = clamp01(-spec[SPEC.fore] / 0.78);
        p.tall = (1 - 0.6 * low) * (1 + 0.7 * up);
        for (let f = 0; f < BEAR_FEET.length; f++) p.paws[f].air = spec[SPEC.feet + f * FOOT.size + FOOT.air];
        // From its own measure into the world's.
        p.x *= size;
        p.y *= size;
        p.z *= size;
        p.distance *= size;
        p.walked *= size;
        p.speed *= size * quick;
        return p;
    }
}
