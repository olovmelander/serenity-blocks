/**
 * Nimbus Veil — how the albatrosses fly. Numbers only (no three here), so the tests fly the very
 * birds the screen shows.
 *
 * A passage is a few birds on one course, one behind the other, each where its leader was a
 * moment ago: they come in over one edge of the view, cross it and leave over the other, at one
 * pace and evenly spaced from the first to the last, so the line is whole from the moment it
 * shows. The course is the way the great soaring birds really cross a sea without a wingbeat:
 * a long S, climbing on one side of it and sliding down on the other, banked into each turn
 * (high on the outside of one turn with the belly shown, low over the cloud heads on the outside
 * of the next with the back shown). The wings bend up under the load at the bottom of each swoop
 * and ease at the top; now and then a bird rows a few slow beats on its way up.
 *
 * Everything is a closed form of the passage's age and its slot's own numbers: a capture pinned at
 * a time shows the same birds in the same place, and a seek lands mid-flight.
 *
 * The frame a passage is laid in is the lens's (so it crosses the view whatever the screen's
 * shape): `ahead` metres along the level heading of the view from the eye's foot, `aside` metres
 * to its right, heights in the world's own. `layAlbatrossPassage` draws the plan,
 * `albatrossPlace` is a bird's place on it and `poseAlbatrosses` writes the rows the vertex stage
 * reads (nimbus-veil-albatross.js): (place, size), (heading, roll), (arm, hand, fan, twist).
 */

import { slotHash } from './nimbus-veil-weather.js';

const TAU = Math.PI * 2;

/** The most birds a passage can hold, and the rows of four numbers a bird is drawn from. */
export const ALBATROSS_MOST = 5;
export const ALBATROSS_ROWS = 3;

/**
 * The flight's own numbers.
 *
 *   size     how many times life size a bird is drawn (life: 3.1 from wingtip to wingtip; the
 *            world's unit is no metre, and the birds are the size that reads in this view)
 *   gap      seconds between a bird and the one behind it
 *   period   seconds one whole S takes
 *   sway     how far the S swings to each side of the course (world units)
 *   low/high the heights a bird slides down to and climbs to (the deck's heads top out near 16,
 *            the eye rides at 24)
 *   near/far how far ahead of the eye a course begins and ends (the passage's kind picks which)
 *   pace     how fast a bird covers its course (world units a second; the S and the climbs
 *            are flown on top of it)
 *   steep    the steepest a climb may be (rise over run): the S is flown lower where the course
 *            is slower or the view narrower
 *   open     seconds over which the S opens out of a straight, level course as a bird comes in,
 *            and closes into one as it leaves
 *   clear    how far outside the view's edge a course begins and ends (half a wing and a
 *            follower's own offset are added to it), and the share of the view's half width
 *            added on top (the eye drifts and leans)
 *   pull     the pull a bank is measured against: a turn that pulls this hard banks 45 degrees
 *   bank     the steepest bank (radians)
 *   arm/hand the glide: the arm a little raised, the hand a little lowered (radians, + up)
 *   flex     how far the load bends the arm and the hand up (radians a unit of load)
 *   breathe  the wing's own slow give (radians, radians a second)
 *   beat     a burst of rowing: beats a second, how many, the arm's stroke and the hand's
 *            (radians), how far the hand lags the arm (radians of the beat), and the share of
 *            climbs a bird rows on
 *   fan      the tail: closed in the glide, opened by a bank and by a pull-up
 *   twist    how far the tail turns against the roll (a share of it)
 */
export const ALBATROSS_FLIGHT = Object.freeze({
    size: 1.7,
    gap: Object.freeze([1.5, 2.0]),
    period: Object.freeze([7.8, 9.6]),
    sway: Object.freeze([10, 14]),
    low: Object.freeze([16.5, 18.5]),
    high: Object.freeze([31, 38]),
    near: Object.freeze([27, 35]),
    far: Object.freeze([92, 124]),
    mid: Object.freeze([48, 72]),
    pace: Object.freeze([8.0, 9.2]),
    clear: 3.5,
    margin: 0.07,
    steep: 0.5,
    open: 3.4,
    pull: 8.6,
    bank: 1.0,
    arm: 0.06,
    hand: -0.15,
    flex: Object.freeze([0.2, 0.09]),
    breathe: Object.freeze([0.02, 0.9]),
    beat: Object.freeze({
        rate: 1.9, beats: 3, arm: 0.3, hand: 0.2, lag: 0.7, share: 0.5,
    }),
    fan: Object.freeze([-0.45, 0.9, 0.5]),
    twist: 0.4,
});

const F = ALBATROSS_FLIGHT;
const lerp = (range, k) => range[0] + (range[1] - range[0]) * k;
const smooth = (x) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
};

/** The kinds of passage: where a course begins and ends, ahead of the eye. */
export const ALBATROSS_KINDS = Object.freeze(['overtake', 'approach', 'abeam']);

/**
 * Lay a passage: the course and the birds on it, drawn from the slot's own numbers.
 *
 * @param {number} slot   the happening's slot (its seed)
 * @param {number} most   the most birds this tier flies
 * @param {number} dur    seconds the whole passage has, from its first bird in to its last out
 * @param {object} [out]
 * @returns {{
 *   slot: number, count: number, way: number, kind: string, d0: number, d1: number,
 *   period: number, sway: number, low: number, high: number, lean: number, phase: number,
 *   gap: number, pace: number, dur: number,
 *   birds: Array<{ delay: number, aside: number, ahead: number, lift: number, phase: number,
 *                  reach: number, size: number, rows: number }>,
 * }}
 */
export function layAlbatrossPassage(slot, most, dur, out = {}) {
    const plan = out;
    const h = (salt) => slotHash(slot, 100 + salt);
    const cap = Math.max(1, Math.min(ALBATROSS_MOST, Math.round(most) || 1));
    plan.slot = slot;
    // Now and then one bird alone; otherwise two up to the tier's most.
    plan.count = h(0) < 0.12 || cap < 2 ? 1 : 2 + Math.min(cap - 2, Math.floor(h(1) * (cap - 1)));
    plan.way = h(2) < 0.5 ? 1 : -1;
    plan.kind = ALBATROSS_KINDS[Math.min(ALBATROSS_KINDS.length - 1, Math.floor(h(3) * ALBATROSS_KINDS.length))];
    if (plan.kind === 'overtake') {
        plan.d0 = lerp(F.near, h(4));
        plan.d1 = lerp(F.far, h(5));
    } else if (plan.kind === 'approach') {
        plan.d0 = lerp(F.far, h(4));
        plan.d1 = lerp(F.near, h(5));
    } else {
        plan.d0 = lerp(F.mid, h(4));
        plan.d1 = lerp(F.mid, h(5));
    }
    plan.period = lerp(F.period, h(6));
    plan.sway = lerp(F.sway, h(7));
    plan.low = lerp(F.low, h(8));
    plan.high = lerp(F.high, h(9));
    // Which side of the S is the high one.
    plan.lean = h(10) < 0.5 ? 1 : -1;
    plan.phase = h(11) * TAU;
    plan.gap = lerp(F.gap, h(12));
    plan.pace = lerp(F.pace, h(13));
    plan.dur = dur;
    plan.birds = Array.from({ length: plan.count }, (_, i) => ({
        delay: i * plan.gap,
        // A follower flies its leader's course in its own hand: a little to one side of it and
        // off its height, its S a little wider or narrower and a little early or late (so the
        // line is a company of birds, not one bird drawn five times).
        aside: i ? (h(20 + i) - 0.5) * 5 : 0,
        ahead: i ? (h(30 + i) - 0.5) * 5 : 0,
        lift: i ? (h(40 + i) - 0.5) * 3.2 : 0,
        phase: i ? (h(50 + i) - 0.5) * 1.5 : 0,
        reach: i ? 0.8 + h(60 + i) * 0.36 : 1,
        size: F.size * (0.93 + h(70 + i) * 0.14),
        rows: Math.floor(h(80 + i) * 4096),
    }));
    return plan;
}

/**
 * The lens's frame for a passage: the eye's rest place, the view's level heading (`yaw`, radians:
 * 0 looks down -z, + turns right) and the tangent of half its width.
 * @typedef {{ eyeX: number, eyeZ: number, yaw: number, tanH: number }} AlbatrossFrame
 */

/**
 * The course in the lens's frame, for this lens: a straight line over the deck from outside one
 * edge of the view to outside the other, covered at one pace. `cross` is the seconds a bird takes
 * over it (the same for every bird; never more than leaves the last one out as the passage ends),
 * `sway` how far the S swings to each side of it and `rise` how high it climbs.
 */
export function albatrossCourse(plan, frame) {
    const tanH = Math.max(0.05, frame.tanH);
    // The S is no wider than the view can hold (a tall screen's view is narrow), and no steeper.
    const sway = Math.min(plan.sway, 0.3 * tanH * (plan.d0 + plan.d1) * 0.5);
    const out = (depth) => tanH * depth * (1 + F.margin) + F.clear + 2.2 * F.size + 2.5 * (1 + tanH);
    const a0 = -plan.way * out(plan.d0);
    const a1 = plan.way * out(plan.d1);
    const length = Math.hypot(a1 - a0, plan.d1 - plan.d0) || 1;
    const most = Math.max(1, plan.dur - plan.gap * (plan.count - 1));
    const rate = TAU / plan.period;
    return {
        sway,
        // (At the middle of a climb the bird is at its fastest across the course too.)
        rise: Math.min(plan.high - plan.low, (2 * F.steep * Math.hypot(plan.pace, sway * rate)) / rate),
        a0,
        a1,
        length,
        cross: Math.min(most, Math.max(length / plan.pace, Math.min(6, most))),
        // Square to the course, level.
        perpAside: -(plan.d1 - plan.d0) / length,
        perpAhead: (a1 - a0) / length,
    };
}

/**
 * Where bird `bird` of the plan is `t` seconds into its own crossing (world), into `out` [x, y, z].
 * Defined a little before 0 and after the crossing too (the heading is read across both ends).
 */
export function albatrossPlace(plan, bird, t, frame, out = [0, 0, 0], laid = albatrossCourse(plan, frame)) {
    const s = t / laid.cross;
    const theta = (TAU * t) / plan.period + plan.phase + bird.phase;
    const swing = Math.sin(theta);
    // The S opens out of a straight, level course as the bird comes in and closes into one as it
    // leaves, so its first and last moments in view are the course's own, edge to edge.
    const open = smooth(t / F.open) * smooth((laid.cross - t) / F.open);
    const sway = laid.sway * bird.reach * swing * open;
    const aside = laid.a0 + (laid.a1 - laid.a0) * s + laid.perpAside * sway + bird.aside;
    const ahead = plan.d0 + (plan.d1 - plan.d0) * s + laid.perpAhead * sway + bird.ahead;
    const sinY = Math.sin(frame.yaw);
    const cosY = Math.cos(frame.yaw);
    /* eslint-disable no-param-reassign */
    out[0] = frame.eyeX + ahead * sinY + aside * cosY;
    out[1] = plan.low + laid.rise * (0.5 + 0.5 * swing * plan.lean * open) * bird.reach + bird.lift;
    out[2] = frame.eyeZ - ahead * cosY + aside * sinY;
    /* eslint-enable no-param-reassign */
    return out;
}

/** How far through a burst of rowing a bird is at `t` (0 when it is not rowing), and the beat's angle. */
function rowing(plan, bird, t) {
    const B = F.beat;
    const theta = (TAU * t) / plan.period + plan.phase + bird.phase;
    // A burst begins a sixth of the way up a climb: that is theta = -pi/3 where the high side
    // is the swing's own, pi - pi/3 where it is the other.
    const from = plan.lean > 0 ? -Math.PI / 3 : (2 * Math.PI) / 3;
    const cycle = Math.floor((theta - from) / TAU);
    if (slotHash(plan.slot * 31 + bird.rows, cycle + 7) >= B.share) return 0;
    const since = ((theta - from) - cycle * TAU) * (plan.period / TAU);
    const through = (since * B.rate) / B.beats;
    return through > 0 && through < 1 ? through : 0;
}

const STEP = 0.1;
const a = [0, 0, 0];
const b = [0, 0, 0];
const c = [0, 0, 0];

/**
 * One bird's pose at `t` seconds into its crossing, into `out`: `place` [x, y, z], `heading`
 * [x, y, z] (a unit vector), `roll` (radians, + lifts its left wing), `arm`, `hand`, `fan`,
 * `twist`, `load` (1 in level flight) and `pace` (units a second).
 */
export function albatrossPose(plan, bird, t, frame, out = {}, laid = albatrossCourse(plan, frame)) {
    const pose = out;
    albatrossPlace(plan, bird, t - STEP, frame, a, laid);
    albatrossPlace(plan, bird, t, frame, b, laid);
    albatrossPlace(plan, bird, t + STEP, frame, c, laid);
    const vx = (c[0] - a[0]) / (2 * STEP);
    const vy = (c[1] - a[1]) / (2 * STEP);
    const vz = (c[2] - a[2]) / (2 * STEP);
    const pace = Math.hypot(vx, vy, vz) || 1e-6;
    const ax = (c[0] - 2 * b[0] + a[0]) / (STEP * STEP);
    const ay = (c[1] - 2 * b[1] + a[1]) / (STEP * STEP);
    const az = (c[2] - 2 * b[2] + a[2]) / (STEP * STEP);
    pose.place = pose.place || [0, 0, 0];
    pose.heading = pose.heading || [0, 0, 1];
    pose.place[0] = b[0];
    pose.place[1] = b[1];
    pose.place[2] = b[2];
    pose.heading[0] = vx / pace;
    pose.heading[1] = vy / pace;
    pose.heading[2] = vz / pace;
    pose.pace = pace;
    // The bird's level left (x its left, y up, z forward: left = up x forward).
    const flat = Math.hypot(vx, vz) || 1e-6;
    const lx = vz / flat;
    const lz = -vx / flat;
    const pullLeft = ax * lx + az * lz;
    // It banks into the turn: pulled to its left, its left wing goes down (the roll is negative).
    pose.roll = Math.max(-F.bank, Math.min(F.bank, -Math.atan2(pullLeft, F.pull)));
    pose.load = Math.hypot(pullLeft, F.pull + ay) / F.pull;
    const bend = Math.max(-0.6, Math.min(1.2, pose.load - 1));
    const give = Math.sin(t * F.breathe[1] + bird.rows) * F.breathe[0];
    pose.arm = F.arm + bend * F.flex[0] + give;
    pose.hand = F.hand + bend * F.flex[1] - give * 0.6;
    const through = rowing(plan, bird, t);
    pose.rowing = through;
    if (through > 0) {
        const B = F.beat;
        const swell = smooth(through / 0.18) * (1 - smooth((through - 0.82) / 0.18));
        const angle = through * TAU * B.beats;
        pose.arm += swell * Math.sin(angle) * B.arm;
        pose.hand -= swell * Math.sin(angle - B.lag) * B.hand;
    }
    pose.fan = Math.min(1, F.fan[0] + Math.abs(pose.roll) * F.fan[1] + Math.max(0, bend) * F.fan[2]);
    pose.twist = -pose.roll * F.twist;
    return pose;
}

const scratch = {};

/**
 * Pose the whole passage at `age` seconds (from its first bird's entry) into `rows`, a
 * Float64Array of ALBATROSS_MOST x ALBATROSS_ROWS x 4: a bird that is not in the air has no size.
 * Returns how many are.
 */
export function poseAlbatrosses(plan, age, frame, rows) {
    const laid = albatrossCourse(plan, frame);
    let flying = 0;
    for (let i = 0; i < ALBATROSS_MOST; i += 1) {
        const at = i * ALBATROSS_ROWS * 4;
        const bird = plan.birds[i];
        const t = bird ? age - bird.delay : -1;
        if (!bird || t < 0 || t > laid.cross) {
            rows.fill(0, at, at + ALBATROSS_ROWS * 4);
            // (A heading, so the dormant bird's frame is made of numbers.)
            rows[at + 6] = 1; // eslint-disable-line no-param-reassign
            continue;
        }
        const pose = albatrossPose(plan, bird, t, frame, scratch, laid);
        /* eslint-disable no-param-reassign */
        rows[at] = pose.place[0];
        rows[at + 1] = pose.place[1];
        rows[at + 2] = pose.place[2];
        rows[at + 3] = bird.size;
        rows[at + 4] = pose.heading[0];
        rows[at + 5] = pose.heading[1];
        rows[at + 6] = pose.heading[2];
        rows[at + 7] = pose.roll;
        rows[at + 8] = pose.arm;
        rows[at + 9] = pose.hand;
        rows[at + 10] = pose.fan;
        rows[at + 11] = pose.twist;
        /* eslint-enable no-param-reassign */
        flying += 1;
    }
    return flying;
}
