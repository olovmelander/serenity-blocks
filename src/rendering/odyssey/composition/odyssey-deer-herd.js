// @ts-check
/**
 * THE GLADE'S DEER, ALIVE — the herd's life on the CPU, without three.js (odyssey-deer.js draws
 * it). Chapter 3, Odyssey's first ground animals (2026-11-01; design and motion pass 2026-11-02).
 *
 * WHERE. A small herd of red deer (hinds, a yearling and a calf) grazes the glade on the rise above
 * the chapter-3 shore, west of the rail. Scouted on the REAL rail camera
 * (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md): in the frame without a break from the breach to L15,
 * and again at L17, 120-240 u off.
 *
 * SIZE. Drawn at three times life (`scale`), like the act's other life: a hind's withers are
 * 24-27 px tall at 1440p from the sea-side parks, 40 at L15 and 51 at L17.
 *
 * HOW IT MOVES (the motion pass). Everything is a function of the board clock, so the herd is
 * world-anchored and deterministic (the camera only passes it):
 *  - THE PATH. Each deer keeps to its own few spots. Between them it walks along a curve that
 *    starts the way it faces (the body follows the head round), with a smooth start and stop; a
 *    turn too sharp for a curve is first made on the spot by pivoting round the hind legs (the
 *    forehand steps round them, never a turntable), its rate limited. While grazing it takes
 *    slow steps along short curves. (`buildDeerSchedule`.)
 *  - THE FEET. A footstep planner, run once when the herd is built (`planFootfalls`), walks every
 *    deer through its loop and decides when each hoof lifts and where it lands: a hoof stays
 *    planted until the body has moved far enough over it, then swings to where it should land
 *    half a stance ahead; when the body stops the feet settle under it with a step or two. It
 *    keeps a walk's order (left hind, left fore, right hind, right fore) and never lifts both
 *    fores or both hinds at once. The result is a table of steps per hoof, read back at any time,
 *    so a planted hoof never slides.
 *  - THE LEGS reach their hooves by a two-segment solve per leg (shoulder to knee, knee to
 *    fetlock; hip to hock, hock to fetlock), the hoof kept flat on the ground while planted and
 *    flicked back in the swing.
 *  - THE BODY rides on its feet: height, pitch and roll from the ground under the hooves, a
 *    little rise and roll of the hips and shoulders with each step, breathing, a slow shift of
 *    weight while it stands.
 *  - THE HEAD AND NECK move through three neck bones. Head down to graze (cropping with small
 *    nods and sways, the jaw chewing), up to look round: a look turns the ears first, then the
 *    head, then the neck down its length, each a moment later. Every state change is blended over
 *    a second or more with a smooth curve that cannot jump, whatever the segments' lengths.
 *  - EARS swivel and flick, the TAIL flicks now and then.
 *
 * OUTPUT. `poseDeer` writes, per bone, the bone's world rotation (a quaternion) and where its rest
 * frame lands (`at - k * q * rest`, with `k` the drawn size), the table odyssey-deer.js uploads,
 * plus the hooves (for tests) and the ground plane under the deer (for its shadow).
 */

/** The herd and its clock. Spots are world (x, z); `size` is a share of a grown hind. */
export const ODYSSEY_DEER = Object.freeze({
    /** Drawn larger than life, like the act's other life. */
    scale: 3.0,
    /**
     * [first, last] journey progress the herd is drawn at. Both ends are where the glade is out of
     * the frame (the first deep in chapter 2's water, the last after L16 has turned the eye away):
     * odyssey-ground-animals.test.js holds the camera to that, so it never appears or leaves in view.
     */
    window: Object.freeze([0.08, 0.26]),
    /** Every schedule repeats after about this many seconds of the board clock. */
    loop: 300,
    /** A walking stride (m, life size) and the seconds one takes at a hind's size. */
    stride: 0.92,
    cycle: 1.5,
    /** Seconds to reach walking speed from standing, and to stop. */
    accel: 1.1,
    /** The fastest a turn on the spot turns (rad/s), and its pivot behind the middle (share of size). */
    turnRate: 0.7,
    pivotBack: 0.34,
    /** A hoof's swing as a share of the stride's time; how far it lifts (share of size). */
    swing: 0.38,
    lift: 0.09,
    /** Once the body has stood still this long (s), hooves this far (share of a stride) off settle. */
    settleAfter: 0.45,
    settleAt: 0.07,
    /** Local rotations of a grazing head (the neck swung down its three bones, the face to the grass). */
    graze: Object.freeze({
        neck0: 1.85, neck1: 0.5, neck2: 0.4, head: -2.3, dip: 0.08,
    }),
    members: Object.freeze([
        Object.freeze({
            name: 'lead hind',
            size: 1.0,
            seed: 11,
            tone: 0.55,
            spots: Object.freeze([[-207, -240], [-203, -235], [-209, -233]]),
        }),
        Object.freeze({
            name: 'hind',
            size: 0.95,
            seed: 23,
            tone: 0.25,
            spots: Object.freeze([[-203, -229], [-199, -227], [-206, -228]]),
        }),
        Object.freeze({
            name: 'hind',
            size: 1.04,
            seed: 37,
            tone: 0.8,
            spots: Object.freeze([[-193, -218], [-191, -214], [-195, -216]]),
        }),
        Object.freeze({
            name: 'yearling',
            size: 0.82,
            seed: 41,
            tone: 0.4,
            spots: Object.freeze([[-213, -230], [-212, -226]]),
        }),
        Object.freeze({
            name: 'calf',
            size: 0.6,
            seed: 67,
            tone: 0.3,
            spots: Object.freeze([[-198, -240], [-195, -237], [-197, -234]]),
        }),
    ]),
});

/** The deer's rest skeleton: what the GLB carries (name, parent index, head in metres). */
/** @typedef {{name: string, parent: number, head: number[]}} DeerBone */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Smootherstep: C2, no jump in speed or acceleration at either end. */
const s5 = (v) => {
    const t = clamp01(v);
    return t * t * t * ((t * ((t * 6) - 15)) + 10);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dir = (h) => [Math.sin(h), Math.cos(h)];

/** Seeded uniform [0, 1) (mulberry32). */
function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth value noise in [-1, 1] over time (deterministic; `seed` picks the stream). */
function noise(t, seed) {
    const i = Math.floor(t);
    const f = t - i;
    const h = (n) => {
        const v = Math.sin((n * 127.1) + (seed * 311.7)) * 43758.5453;
        return ((v - Math.floor(v)) * 2) - 1;
    };
    const u = f * f * (3 - (2 * f));
    return h(i) + ((h(i + 1) - h(i)) * u);
}

/** Distance travelled along a move after a share `u` of its time: a smooth start and stop. */
function moveProfile(u, a) {
    // Speed rises over [0, a] (smoothstep), holds, falls over [1 - a, 1]; its integral, normalised.
    const ramp = (x) => (x * x * x) - (0.5 * x * x * x * x);
    const total = 1 - a;
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < a) return (a * ramp(u / a)) / total;
    if (u > 1 - a) return (total - (a * ramp((1 - u) / a))) / total;
    return ((0.5 * a) + (u - a)) / total;
}

/** A quadratic curve from p0 (leaving along its tangent through p1) to p2, with an arc-length table. */
function curve(p0, p1, p2) {
    const n = 20;
    const lengths = new Float64Array(n + 1);
    let prev = p0;
    for (let i = 1; i <= n; i += 1) {
        const b = i / n;
        const q = [
            ((1 - b) * (1 - b) * p0[0]) + (2 * (1 - b) * b * p1[0]) + (b * b * p2[0]),
            ((1 - b) * (1 - b) * p0[1]) + (2 * (1 - b) * b * p1[1]) + (b * b * p2[1]),
        ];
        lengths[i] = lengths[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
    }
    return {
        p0, p1, p2, lengths, length: lengths[n],
    };
}

/** Position and heading at a share `a` of a curve's length. */
function curveAt(c, a, out) {
    const n = c.lengths.length - 1;
    const target = a * c.length;
    let i = 1;
    while (i < n && c.lengths[i] < target) i += 1;
    const l0 = c.lengths[i - 1];
    const l1 = c.lengths[i];
    const b = ((i - 1) + ((target - l0) / Math.max(1e-9, l1 - l0))) / n;
    const { p0, p1, p2 } = c;
    out.x = ((1 - b) * (1 - b) * p0[0]) + (2 * (1 - b) * b * p1[0]) + (b * b * p2[0]);
    out.z = ((1 - b) * (1 - b) * p0[1]) + (2 * (1 - b) * b * p1[1]) + (b * b * p2[1]);
    const dx = (2 * (1 - b) * (p1[0] - p0[0])) + (2 * b * (p2[0] - p1[0]));
    const dz = (2 * (1 - b) * (p1[1] - p0[1])) + (2 * b * (p2[1] - p1[1]));
    out.heading = Math.atan2(dx, dz);
    return out;
}

/**
 * One deer's schedule: segments back to back over its loop: `graze` and `look` (standing), `step`
 * (a slow grazing step along a short curve), `turn` (on the spot, pivoting round the hind legs)
 * and `walk` (a curve to the next spot). Each carries the channels the pose reads (`head`: 1 down
 * grazing .. 0 up; `look`: the look's yaw; `alert`: the ears' attention).
 * @param {{size: number, seed: number, spots: ReadonlyArray<ReadonlyArray<number>>}} member
 * @param {typeof ODYSSEY_DEER} [cfg]
 */
export function buildDeerSchedule(member, cfg = ODYSSEY_DEER) {
    const k = cfg.scale * member.size;
    const strideW = cfg.stride * k;
    const cycle = cfg.cycle * Math.sqrt(member.size);
    const walkSpeed = strideW / cycle;
    const pivot = cfg.pivotBack * k;
    // The leap's shape (the ibex's config only; ODYSSEY_DEER has none, and deer never leap).
    const leapCfg = /** @type {any} */ (cfg).leap;
    // How far a grazing animal strays from its spot (1: the deer's; the ibex keep closer, off the rocks).
    const roam = /** @type {any} */ (cfg).roam ?? 1;
    const { spots } = member;
    const n = spots.length;
    const build = (h0) => {
        const rand = seeded(member.seed * 7919);
        const segs = [];
        let t = 0;
        let [x, z] = spots[0];
        let h = h0;
        const push = (seg) => {
            segs.push({
                t0: t, x0: x, z0: z, h0: h, look: 0, alert: 0, ...seg,
            });
            t += seg.dur;
        };
        const still = (kind, dur, head, look = 0, alert = 0) => push({
            kind, dur, head, look, alert, x1: x, z1: z, h1: h,
        });
        /** Turn on the spot by `by` (radians), pivoting round a point behind the middle. */
        const turn = (by, about = pivot) => {
            // Smootherstep's peak rate is 1.875x its mean: the duration keeps the peak under the limit.
            const dur = 0.6 + ((1.875 * Math.abs(by)) / cfg.turnRate);
            const [fx, fz] = dir(h);
            const px = x - (fx * about);
            const pz = z - (fz * about);
            const h1 = h + by;
            const [gx, gz] = dir(h1);
            push({
                kind: 'turn',
                dur,
                head: 0.2,
                alert: 0.4,
                px,
                pz,
                about,
                x1: px + (gx * about),
                z1: pz + (gz * about),
                h1,
            });
            x = px + (gx * about);
            z = pz + (gz * about);
            h = h1;
        };
        /** Move along a curve leaving the way it faces, ending at `to`. */
        const move = (kind, to, speed, head, alert) => {
            const d = Math.hypot(to[0] - x, to[1] - z);
            const [fx, fz] = dir(h);
            const c = curve([x, z], [x + (fx * d * 0.55), z + (fz * d * 0.55)], [to[0], to[1]]);
            const ramp = cfg.accel * (kind === 'walk' ? 1 : 0.8);
            const dur = (c.length / speed) + ramp;
            const end = curveAt(c, 1, { x: 0, z: 0, heading: 0 });
            push({
                kind,
                dur,
                head,
                alert,
                curve: c,
                ramp: Math.min(0.45, ramp / dur),
                x1: to[0],
                z1: to[1],
                h1: end.heading,
            });
            x = to[0];
            z = to[1];
            h = end.heading;
        };
        /**
         * LEAP to `to` (the ibex, odyssey-ibex-herd.js; deer never leap): it turns to face the
         * landing on the spot first, then crouches, flies a straight line and lands, absorbing it.
         */
        const leap = (to, fromPerch = false) => {
            const L = leapCfg;
            const want = wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h);
            if (Math.abs(want) > 0.05) turn(want, fromPerch ? 0 : pivot);
            const d = Math.hypot(to[0] - x, to[1] - z);
            const flight = L.flight[0] + ((L.flight[1] - L.flight[0]) * clamp01(d / (L.reach * k)));
            push({
                kind: 'leap',
                dur: L.crouch + flight + L.absorb,
                crouch: L.crouch,
                flight,
                absorb: L.absorb,
                apex: (L.apex * k) + (L.apexPerDistance * d),
                head: 0,
                alert: 0.7,
                x1: to[0],
                z1: to[1],
                h1: h,
            });
            x = to[0];
            z = to[1];
        };
        const walkTime = spots.reduce((sum, s, i) => {
            const next = spots[(i + 1) % n];
            return sum + (Math.hypot(next[0] - s[0], next[1] - s[1]) / walkSpeed) + cfg.accel + 4;
        }, 0);
        const grazeEach = Math.max(20, (cfg.loop - walkTime) / n);
        for (let i = 0; i < n; i += 1) {
            const spot = spots[i];
            // On a perch (an ibex on its rock, `spot[2]`) it stays put: no steps off the top.
            const perched = spot[2] === 1;
            let left = grazeEach;
            while (left > 5) {
                const bite = Math.min(left, 5 + (rand() * 9));
                still('graze', bite, 1);
                left -= bite;
                if (left < 5) break;
                if (rand() < (perched ? 0.6 : 0.32)) {
                    const dur = Math.min(left, 3 + (rand() * 4));
                    still('look', dur, 0, (rand() - 0.5) * 1.6, 1);
                    left -= dur;
                    if (left < 5) break;
                }
                if (perched) continue;
                // A grazing step: a pace or two along a short curve, turning a little, drawn back
                // toward the spot when it has wandered.
                const away = Math.hypot(x - spot[0], z - spot[1]);
                const home = Math.atan2(spot[0] - x, spot[1] - z);
                const wander = h + ((rand() - 0.5) * 0.8);
                const pull = clamp01((away - (0.25 * k * roam)) / (0.7 * k * roam));
                const aim = wrapAngle(wander + (wrapAngle(home - wander) * pull));
                const dist = (0.3 + (rand() * 0.4)) * strideW * (0.5 + (0.5 * roam));
                const before = t;
                if (Math.abs(wrapAngle(aim - h)) > 0.6) turn(wrapAngle(aim - h) * 0.75);
                const [ax, az] = dir(aim);
                move('step', [x + (ax * dist), z + (az * dist)], walkSpeed * 0.42, 0.85, 0);
                left -= t - before;
            }
            if (left > 0) still('graze', left, 1);
            // WALK to the next spot: the head comes up, a turn on the spot only for what a curve
            // cannot take, then the curve.
            const to = spots[(i + 1) % n];
            if (/** @type {any} */ (member).leaps?.[i] && leapCfg) {
                still('look', 1.6, 0.1, wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h) * 0.5, 0.9);
                leap(to, perched);
                continue;
            }
            const want = wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h);
            if (Math.abs(want) > 0.5) turn(want - (Math.sign(want) * 0.3));
            else still('look', 1.2, 0.2, want * 0.6, 0.6);
            move('walk', to, walkSpeed, 0.2, 0.5);
        }
        // Close the loop: settle back to the heading it began with (on the spot, round its middle).
        const close = wrapAngle(h0 - h);
        if (Math.abs(close) > 1e-3) turn(close, 0);
        still('graze', 3.2, 1);
        return { segs, loop: t, hEnd: h };
    };
    // Begin facing the way it will arrive at its first spot after the loop, so little closing is left.
    let h0 = Math.atan2(spots[0][0] - spots[n - 1][0], spots[0][1] - spots[n - 1][1]);
    let built = build(h0);
    for (let i = 0; i < 3; i += 1) {
        h0 = built.hEnd;
        built = build(h0);
    }
    return {
        segments: built.segs, loop: built.loop, k, strideW, cycle, walkSpeed,
    };
}

/** The schedules of the whole herd (built once; pure). Feet come later (`planFootfalls`). */
export function buildHerd(cfg = ODYSSEY_DEER) {
    return cfg.members.map((member) => ({ member, ...buildDeerSchedule(member, cfg), plan: null }));
}

/** The segment index active at time `t` (already within [0, loop)). */
function segmentAt(segs, t) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
}

const wrapTime = (deer, t) => (((t % deer.loop) + deer.loop) % deer.loop);

/** The body's path at time `t`: where it stands and the way it faces (closed-form in the clock). */
export function deerPathAt(deer, time, out = { x: 0, z: 0, heading: 0 }) {
    const t = wrapTime(deer, time);
    const s = deer.segments[segmentAt(deer.segments, t)];
    const u = clamp01((t - s.t0) / s.dur);
    if (s.kind === 'turn') {
        const h = s.h0 + (wrapAngle(s.h1 - s.h0) * s5(u));
        const [fx, fz] = dir(h);
        out.x = s.px + (fx * s.about);
        out.z = s.pz + (fz * s.about);
        out.heading = h;
    } else if (s.kind === 'leap') {
        // Standing through the crouch, a straight line at a steady speed in the air, standing again.
        const f = clamp01((t - s.t0 - s.crouch) / s.flight);
        out.x = s.x0 + ((s.x1 - s.x0) * f);
        out.z = s.z0 + ((s.z1 - s.z0) * f);
        out.heading = s.h0;
    } else if (s.curve) {
        curveAt(s.curve, moveProfile(u, s.ramp), out);
    } else {
        out.x = s.x0;
        out.z = s.z0;
        out.heading = s.h0;
    }
    return out;
}

/**
 * Where a leap is at `time` (all zero outside one): `sink` the crouch before and the give after
 * (0..1, the body lowered), `arc` the body's height over the straight line between the two
 * grounds, `rise` the arc's slope along the ground (for the body's pitch), `f` the flight's share.
 */
export function deerLeapAt(deer, time, out = {
    on: false, f: 0, arc: 0, rise: 0, sink: 0, apex: 0, phase: 0,
}) {
    out.phase = 0;
    out.on = false;
    out.f = 0;
    out.arc = 0;
    out.rise = 0;
    out.sink = 0;
    out.apex = 0;
    const t = wrapTime(deer, time);
    const s = deer.segments[segmentAt(deer.segments, t)];
    if (s.kind !== 'leap') return out;
    const local = t - s.t0;
    out.on = true;
    out.apex = s.apex;
    if (local < s.crouch) {
        // Down over the first part, then springing up through the take-off.
        const u = local / s.crouch;
        out.sink = u < 0.62 ? s5(u / 0.62) : 1 - s5((u - 0.62) / 0.38);
        return out;
    }
    const f = (local - s.crouch) / s.flight;
    if (f <= 1) {
        const d = Math.max(1e-6, Math.hypot(s.x1 - s.x0, s.z1 - s.z0));
        out.phase = 1;
        out.f = f;
        out.arc = 4 * s.apex * f * (1 - f);
        out.rise = (4 * s.apex * (1 - (2 * f))) / d;
        return out;
    }
    const u = clamp01((local - s.crouch - s.flight) / s.absorb);
    out.phase = 2;
    out.f = 1;
    // The give: down fast as the fores take it, then back up more slowly as the hinds come under.
    out.sink = 0.8 * Math.sin(Math.PI * Math.min(1, (u < 0.3 ? u / 0.6 : 0.5 + ((u - 0.3) / 1.4))));
    return out;
}

/**
 * A channel of the schedule (`head`, `look`, `alert`) at time `t`, its steps smoothed over `width`
 * seconds: each change between segments eases in along smootherstep from the moment it begins, so
 * the value never jumps (nor its rate), however short the segments.
 */
export function deerChannel(deer, key, time, width) {
    const segs = deer.segments;
    const t = wrapTime(deer, time);
    let i = segmentAt(segs, wrapTime(deer, t - width));
    let base = (t - width) < 0 ? -deer.loop : 0;
    let value = segs[i][key];
    for (let guard = 0; guard < segs.length; guard += 1) {
        const j = (i + 1) % segs.length;
        if (j === 0) base += deer.loop;
        const tb = base + segs[j].t0;
        if (tb > t) break;
        value += (segs[j][key] - segs[i][key]) * s5((t - tb) / width);
        i = j;
    }
    return value;
}

/**
 * Where a deer is and what it is doing at board time `time`: its path, its speed and turning, and
 * the smoothed channels.
 */
export function deerStateAt(deer, time, out = {
    x: 0, z: 0, heading: 0, speed: 0, turning: 0, head: 0, alert: 0,
}) {
    deerPathAt(deer, time, out);
    const a = deerPathAt(deer, time - 0.05, { x: 0, z: 0, heading: 0 });
    const b = deerPathAt(deer, time + 0.05, { x: 0, z: 0, heading: 0 });
    out.speed = Math.hypot(b.x - a.x, b.z - a.z) / 0.1;
    out.turning = wrapAngle(b.heading - a.heading) / 0.1;
    // (The head goes down to the grass or comes up over about 1.8 s, as a deer's does.)
    out.head = deerChannel(deer, 'head', time, 1.8);
    out.alert = deerChannel(deer, 'alert', time, 0.8);
    return out;
}

// -- the feet --------------------------------------------------------------------------------

/** @type {ReadonlyArray<[string, string, string[], boolean]>} */
const LEGS = Object.freeze([
    // [leg, top bone, the chain below it, front?] in the walk's order of lifting
    ['hindL', 'femurL', ['tibiaL', 'hindCannonL', 'hindHoofL'], false],
    ['foreL', 'humerusL', ['forearmL', 'foreCannonL', 'foreHoofL'], true],
    ['hindR', 'femurR', ['tibiaR', 'hindCannonR', 'hindHoofR'], false],
    ['foreR', 'humerusR', ['forearmR', 'foreCannonR', 'foreHoofR'], true],
]);

/**
 * Plan every hoof's steps through a deer's loop (run once, at load). The deer is walked through
 * three loops at 30 steps a second and the last loop's steps are kept: per hoof a list of
 * [lift time, land time, from x, from z, to x, to z, kind] (times within the loop, a few seconds
 * either side of it for steps across the seam), and where each hoof stands at the loop's start.
 * @param {ReturnType<typeof buildHerd>} herd
 * @param {ReturnType<typeof createDeerRig>} rig
 * @param {typeof ODYSSEY_DEER} [cfg]
 */
export function planFootfalls(herd, rig, cfg = ODYSSEY_DEER) {
    herd.forEach((deer) => { deer.plan = planDeer(deer, rig, cfg); });
    return herd;
}

function planDeer(deer, rig, cfg) {
    const { k, strideW, cycle } = deer;
    const dt = 1 / 30;
    // One loop is enough: the loop ends standing with every hoof settled exactly under the body
    // (see the closing graze below), which is where it began, so the seam cannot jump.
    const loops = 1;
    const swingT = cfg.swing * cycle;
    const lead = 0.3 * cycle;
    const offsets = rig.legs.map((leg) => rig.footOffset[leg.leg]);
    const path = { x: 0, z: 0, heading: 0 };
    /** Where hoof `l` would stand under a body at `p`. */
    const footUnder = (p, l, out) => {
        const [ox, oz] = offsets[l];
        const ch = Math.cos(p.heading);
        const sh = Math.sin(p.heading);
        out[0] = p.x + (((ch * ox) + (sh * oz)) * k);
        out[1] = p.z + (((-sh * ox) + (ch * oz)) * k);
        return out;
    };
    const ideal = (l, t, out) => footUnder(deerPathAt(deer, t, path), l, out);
    const pNow = { x: 0, z: 0, heading: 0 };
    const pSoon = { x: 0, z: 0, heading: 0 };
    const pLead = { x: 0, z: 0, heading: 0 };
    const now = [0, 0];
    const scratch = [0, 0];
    const scratch2 = [0, 0];
    const planted = offsets.map((_, l) => ideal(l, 0, [0, 0]));
    const swinging = offsets.map(() => null);
    const steps = offsets.map(() => []);
    let lastLift = -Infinity;
    let stillFor = 0;
    let phase = 0;
    const due = [false, false, false, false];
    const landedAt = [-Infinity, -Infinity, -Infinity, -Infinity];
    const total = deer.loop * loops;
    const keepFrom = (deer.loop * (loops - 1)) - 4;
    let startState = null;
    const leapPlanned = new Set();
    let leapUntil = -Infinity;
    for (let t = 0; t < total; t += dt) {
        if (!startState && t >= deer.loop * (loops - 1)) startState = planted.map((p) => [...p]);
        // Land any swing that is done.
        swinging.forEach((s, l) => {
            if (s && s[1] <= t) {
                planted[l] = [s[4], s[5]];
                swinging[l] = null;
                landedAt[l] = t;
            }
        });
        // Is the body standing?
        const a = deerPathAt(deer, t - dt, { x: 0, z: 0, heading: 0 });
        const b = deerPathAt(deer, t, { x: 0, z: 0, heading: 0 });
        const moving = Math.hypot(b.x - a.x, b.z - a.z) / dt > 0.03 * k
            || Math.abs(wrapAngle(b.heading - a.heading)) / dt > 0.03;
        stillFor = moving ? 0 : stillFor + dt;
        // THE WALK'S RHYTHM: a phase that advances with the ground the hooves cover (the body's
        // travel and its turning); each hoof lifts when its quarter of the stride comes round
        // (left hind, left fore, right hind, right fore), so the four-beat order holds at any
        // pace and no hoof is left behind. Standing, the phase stops and the hooves settle.
        deerPathAt(deer, t, pNow);
        deerPathAt(deer, t + 0.1, pSoon);
        let pace = 0;
        for (let l = 0; l < 4; l += 1) {
            footUnder(pSoon, l, scratch2);
            footUnder(pNow, l, now);
            pace = Math.max(pace, Math.hypot(scratch2[0] - now[0], scratch2[1] - now[1]) / 0.1);
        }
        // (Slow, it takes shorter steps: a grazing step is two or three short paces, not one long one.)
        const prevPhase = phase;
        phase += (pace / (strideW * (0.42 + (0.58 * clamp01(pace / deer.walkSpeed))))) * dt;
        for (let l = 0; l < 4; l += 1) {
            if (Math.floor(phase + 1 - (l * 0.25)) > Math.floor(prevPhase + 1 - (l * 0.25))) due[l] = true;
        }
        // Of the hooves that may lift (not in the air, nor their partner), the most overdue goes:
        // one left too far is first, then those whose turn has come, then the settling ones; a
        // hoof stands at least a quarter of a stride's time before it lifts again.
        let best = -1;
        let bestTarget = null;
        let bestScore = 0;
        const swingCount = swinging.filter(Boolean).length;
        for (let l = 0; l < 4; l += 1) {
            if (swinging[l] || swinging[l ^ 2]) continue;
            footUnder(pNow, l, now);
            const off = Math.hypot(planted[l][0] - now[0], planted[l][1] - now[1]);
            const rested = t - landedAt[l] > 0.25 * cycle;
            let score = 0;
            let target = null;
            if (off > 0.36 * strideW) {
                score = 10 + (off / strideW);
                target = 'walk';
            } else if (due[l] && pace > 0.04 * deer.walkSpeed && rested) {
                // (A hoof already where it would land stays put.)
                deerPathAt(deer, t + swingT + lead, pLead);
                footUnder(pLead, l, scratch);
                if (Math.hypot(planted[l][0] - scratch[0], planted[l][1] - scratch[1]) > 0.1 * strideW) {
                    score = 1 + (off / strideW);
                    target = 'walk';
                } else due[l] = false;
            } else if (stillFor > cfg.settleAfter && swingCount < 2 && rested && t - lastLift > 0.18 * cycle) {
                // In the loop's closing seconds every hoof settles exactly (the seam).
                const closing = (t % deer.loop) > deer.loop - 2.6;
                if (off > (closing ? 0.002 : cfg.settleAt) * strideW) {
                    score = 0.5 + (off / strideW);
                    target = 'settle';
                }
            }
            if (target && score > bestScore) {
                best = l;
                bestScore = score;
                bestTarget = target;
            }
        }
        // A LEAP (ibex): from the end of the crouch every hoof leaves (the fores a moment first) and
        // lands where it stands under the body at the landing (the fores first); nothing else steps
        // until it is down.
        const seg = deer.segments[segmentAt(deer.segments, t % deer.loop)];
        if (seg.kind === 'leap' && !leapPlanned.has(seg) && (t % deer.loop) >= seg.t0 + seg.crouch - 0.12) {
            leapPlanned.add(seg);
            const base = t - (t % deer.loop);
            const off = base + seg.t0 + seg.crouch;
            const landAt = off + seg.flight;
            for (let l = 0; l < 4; l += 1) {
                const front = l === 1 || l === 3;
                const from = swinging[l] ? [swinging[l][4], swinging[l][5]] : planted[l];
                const lift = Math.max(off - (front ? 0.07 : 0), swinging[l] ? swinging[l][1] : -Infinity);
                const land = landAt + (front ? 0 : 0.08);
                const to = ideal(l, land + 0.02, [0, 0]);
                swinging[l] = [lift, land, from[0], from[1], to[0], to[1], 2];
                if (lift >= keepFrom) {
                    const back = deer.loop * (loops - 1);
                    steps[l].push([lift - back, land - back, from[0], from[1], to[0], to[1], 2]);
                }
            }
            leapUntil = landAt + 0.25;
            lastLift = t;
        }
        if (t < leapUntil) best = -1;
        if (best >= 0) due[best] = false;
        if (best >= 0) {
            const l = best;
            const settle = bestTarget === 'settle';
            const dur = settle ? swingT * 0.8 : swingT;
            const land = settle ? ideal(l, t + dur, [0, 0]) : ideal(l, t + dur + lead, [0, 0]);
            swinging[l] = [t, t + dur, planted[l][0], planted[l][1], land[0], land[1], settle ? 1 : 0];
            if (t >= keepFrom) {
                const base = deer.loop * (loops - 1);
                steps[l].push([
                    t - base, t + dur - base, planted[l][0], planted[l][1], land[0], land[1], settle ? 1 : 0,
                ]);
            }
            lastLift = t;
        }
    }
    // Steps lifted in the last loop's final seconds also play before its start (seen across the seam).
    const tail = steps.map((list) => list.filter((s) => s[0] >= deer.loop - 4).map((s) => {
        const c = [...s];
        c[0] -= deer.loop;
        c[1] -= deer.loop;
        return c;
    }));
    const lists = steps.map((list, l) => [...tail[l], ...list.filter((s) => s[0] >= -4 && s[0] < deer.loop + 4)]
        .sort((p, q) => p[0] - q[0]));
    return { steps: lists, start: startState };
}

/**
 * Where hoof `l` of a planned deer is at `time` (world x, z, the share of its swing done, its lift
 * and whether it is planted). Planted hooves never move.
 */
export function deerFootAt(deer, l, time, out = {
    x: 0, z: 0, swing: 0, planted: true, length: 0, ground: 0, kind: 0, fx: 0, fz: 0, tx: 0, tz: 0,
}) {
    out.kind = 0;
    const t = wrapTime(deer, time);
    const list = deer.plan.steps[l];
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid][0] <= t) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    if (found < 0) {
        // Before the loop's first step: where the plan left it at the loop's start, unless a
        // step from before the seam is still under way.
        const [x, z] = deer.plan.start[l];
        out.x = x;
        out.z = z;
        out.swing = 0;
        out.planted = true;
        out.length = 0;
        return out;
    }
    const s = list[found];
    if (t < s[1]) {
        const u = (t - s[0]) / (s[1] - s[0]);
        // (In a leap the hooves travel with the body, at its steady speed.)
        const e = s[6] === 2 ? u : s5(u);
        out.kind = s[6];
        out.fx = s[2];
        out.fz = s[3];
        out.tx = s[4];
        out.tz = s[5];
        out.x = s[2] + ((s[4] - s[2]) * e);
        out.z = s[3] + ((s[5] - s[3]) * e);
        out.swing = u;
        out.planted = false;
        out.length = Math.hypot(s[4] - s[2], s[5] - s[3]);
        return out;
    }
    out.x = s[4];
    out.z = s[5];
    out.swing = 0;
    out.planted = true;
    out.length = 0;
    return out;
}

// -- the pose --------------------------------------------------------------------------------

/** Row-major 3x3 multiply into `out` (out may not alias a or b). */
function mul3(a, b, out) {
    for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
            out[(r * 3) + c] = (a[r * 3] * b[c]) + (a[(r * 3) + 1] * b[3 + c]) + (a[(r * 3) + 2] * b[6 + c]);
        }
    }
    return out;
}

/** R = Ry * Rz * Rx (pitch about x first, then roll, then yaw): the GLB's convention. */
function rotation(rx, ry, rz, out) {
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    // Rz * Rx
    const a00 = cz;
    const a01 = sz * cx;
    const a02 = -sz * sx;
    const a10 = -sz;
    const a11 = cz * cx;
    const a12 = cz * -sx;
    const a20 = 0;
    const a21 = sx;
    const a22 = cx;
    // Ry * (Rz * Rx)
    out[0] = (cy * a00) + (sy * a20);
    out[1] = (cy * a01) + (sy * a21);
    out[2] = (cy * a02) + (sy * a22);
    out[3] = a10;
    out[4] = a11;
    out[5] = a12;
    out[6] = (-sy * a00) + (cy * a20);
    out[7] = (-sy * a01) + (cy * a21);
    out[8] = (-sy * a02) + (cy * a22);
    return out;
}

/** A unit quaternion [x, y, z, w] from a row-major rotation matrix. */
function quatFrom(m, out, o) {
    const tr = m[0] + m[4] + m[8];
    let x;
    let y;
    let z;
    let w;
    if (tr > 0) {
        const s = 0.5 / Math.sqrt(tr + 1);
        w = 0.25 / s;
        x = (m[7] - m[5]) * s;
        y = (m[2] - m[6]) * s;
        z = (m[3] - m[1]) * s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
        w = (m[7] - m[5]) / s;
        x = 0.25 * s;
        y = (m[1] + m[3]) / s;
        z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
        w = (m[2] - m[6]) / s;
        x = (m[1] + m[3]) / s;
        y = 0.25 * s;
        z = (m[5] + m[7]) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
        w = (m[3] - m[1]) / s;
        x = (m[2] + m[6]) / s;
        y = (m[5] + m[7]) / s;
        z = 0.25 * s;
    }
    // (q and -q turn a vertex alike: the stage blends turned vertices, never quaternions.)
    const sign = w < 0 ? -1 : 1;
    out[o] = x * sign;
    out[o + 1] = y * sign;
    out[o + 2] = z * sign;
    out[o + 3] = w * sign;
}

/**
 * A rig for one skeleton: scratch, lookups and each leg's rest geometry, built once.
 * @param {DeerBone[]} skeleton
 */
export function createDeerRig(skeleton) {
    const count = skeleton.length;
    const index = Object.fromEntries(skeleton.map((b, i) => [b.name, i]));
    const missing = ['root', 'pelvis', 'chest', 'neck0', 'neck1', 'neck2', 'head', 'jaw', 'earL', 'earR', 'tail',
        ...LEGS.flatMap(([, top, chain]) => [top, ...chain])].filter((name) => index[name] == null);
    if (missing.length) throw new Error(`[Odyssey deer] the skeleton lacks ${missing.join(', ')}`);
    const head = (name) => skeleton[index[name]].head;
    const legs = LEGS.map(([leg, top, chain, front]) => {
        const A = head(top);
        const B = head(chain[1]);
        const C = head(chain[2]);
        // Upper (shoulder or hip to knee or hock) and lower (to the fetlock) in the leg's plane (y, z).
        const u1 = [B[1] - A[1], B[2] - A[2]];
        const u2 = [C[1] - B[1], C[2] - B[2]];
        return {
            leg,
            front,
            top: index[top],
            chain: chain.map((name) => index[name]),
            u1,
            u2,
            fetlock: C[1],
            restX: C[0] - A[0],
            reach: Math.hypot(...u1) + Math.hypot(...u2),
        };
    });
    const footOffset = Object.fromEntries(LEGS.map(([leg, , chain]) => {
        const C = head(chain[2]);
        return [leg, [C[0], C[2] + 0.015]];
    }));
    return {
        skeleton,
        count,
        index,
        legs,
        footOffset,
        local: Array.from({ length: count }, () => [0, 0, 0]),
        R: Array.from({ length: count }, () => new Float64Array(9)),
        J: Array.from({ length: count }, () => new Float64Array(3)),
        L: new Float64Array(9),
        T: new Float64Array(9),
        state: {
            x: 0, z: 0, heading: 0, speed: 0, turning: 0, head: 0, alert: 0,
        },
        feet: LEGS.map(() => ({
            x: 0, z: 0, swing: 0, planted: true, length: 0, ground: 0, kind: 0, fx: 0, fz: 0, tx: 0, tz: 0,
        })),
        leap: {
            on: false, f: 0, arc: 0, rise: 0, sink: 0, apex: 0, phase: 0,
        },
        hooves: LEGS.map(() => ({
            x: 0, y: 0, z: 0, ground: 0, stance: 0, planX: 0, planZ: 0,
        })),
    };
}

/**
 * Pose one deer at board time `time`: its bones in the world for the shader table, its hooves, the
 * ground plane under it.
 * @param {ReturnType<typeof createDeerRig>} rig
 * @param {object} deer one of buildHerd()'s, its feet planned (planFootfalls)
 * @param {number} time board clock (s)
 * @param {(x: number, z: number) => number} heightAt the drawn ground
 * @param {Float32Array} [table] shader table, written at `offset` (8 floats a bone)
 * @param {number} [offset]
 * @param {typeof ODYSSEY_DEER} [cfg]
 */
export function poseDeer(rig, deer, time, heightAt, table = null, offset = 0, cfg = ODYSSEY_DEER) {
    const {
        skeleton, index, local, R, J, L,
    } = rig;
    const { k } = deer;
    const { seed } = deer.member;
    const state = deerStateAt(deer, time, rig.state);
    for (const l of local) { l[0] = 0; l[1] = 0; l[2] = 0; }
    const set = (name, rx, ry = 0, rz = 0) => {
        const l = local[index[name]];
        l[0] += rx; l[1] += ry; l[2] += rz;
    };
    // THE FEET, from the plan, on the drawn ground.
    const { feet } = rig;
    rig.legs.forEach((leg, l) => {
        const f = deerFootAt(deer, l, time, feet[l]);
        // (In a leap the ground under a hoof is the line between where it left and where it lands,
        // or the rock under it where that stands higher.)
        f.ground = f.kind === 2 && !f.planted
            ? Math.max(
                heightAt(f.fx, f.fz) + ((heightAt(f.tx, f.tz) - heightAt(f.fx, f.fz)) * f.swing),
                heightAt(f.x, f.z),
            )
            : heightAt(f.x, f.z);
    });
    const leap = deerLeapAt(deer, time, rig.leap);
    // THE BODY rides on them: height from the ground under the hooves, pitch from fore to hind,
    // roll from side to side (part of the way), the hips and shoulders rising and rolling a little
    // with each swing, a slow shift of weight, breathing.
    const sh = Math.sin(state.heading);
    const ch = Math.cos(state.heading);
    const g = state.head;
    const walk = clamp01(state.speed / deer.walkSpeed);
    const fore = 0.5 * (feet[1].ground + feet[3].ground);
    const hind = 0.5 * (feet[0].ground + feet[2].ground);
    const left = 0.5 * (feet[0].ground + feet[1].ground);
    const right = 0.5 * (feet[2].ground + feet[3].ground);
    const pitch = (-Math.atan2(fore - hind, 0.98 * k) * 0.9) + (cfg.graze.dip * g)
        // (In a leap: nose up off the rock, level at the top, nose down to land; held to ~17
        // degrees, as far as the legs can reach for it.)
        - (leap.on ? Math.max(-0.3, Math.min(0.3, Math.atan(leap.rise) * 0.45)) : 0)
        - (leap.on && leap.phase === 0 ? 0.16 * leap.sink : 0)
        + (leap.on && leap.phase === 2 ? 0.12 * leap.sink : 0);
    const roll = -Math.atan2(left - right, 0.22 * k) * 0.12;
    const swingOf = (l) => (feet[l].planted ? 0 : Math.sin(Math.PI * feet[l].swing));
    const breathe = Math.sin(((time / 3.4) + (seed * 0.37)) * TAU);
    const sway = noise((time * 0.21) + seed, seed) * (1 - walk);
    set('root', 0, 0, (sway * 0.02) + (0.025 * (swingOf(1) - swingOf(3)) * walk));
    set('pelvis', 0.012 * breathe, 0, 0.05 * (swingOf(0) - swingOf(2)));
    set('chest', -0.012 * breathe, 0, 0.035 * (swingOf(1) - swingOf(3)));
    // THE HEAD AND NECK: grazing down the three neck bones, a walk's carriage, the look turned
    // through the chain (ears first, then the head, then the neck from the top down), the head
    // nodding with the fore feet in a walk, cropping and swaying while grazing.
    const G = cfg.graze;
    const lookAt = (lag) => deerChannel(deer, 'look', time - lag, 1.1);
    const crop = g * (1 - walk);
    const nod = 0.06 * (swingOf(1) + swingOf(3)) * walk;
    const graze = (time * 0.43) + seed;
    set('neck0', (G.neck0 * g) + (0.18 * walk * (1 - g)) - (0.05 * (1 - g)) + nod, lookAt(0.42) * 0.22);
    set('neck1', G.neck1 * g, lookAt(0.32) * 0.28);
    set('neck2', (G.neck2 * g) - (0.06 * (1 - g) * state.alert), lookAt(0.22) * 0.28);
    set(
        'head',
        (G.head * g) + (0.06 * crop * Math.sin(time * TAU * 1.3)) + (0.05 * (1 - g) * noise(time * 0.6, seed + 3)),
        (lookAt(0.12) * 0.2) + (0.14 * crop * noise(graze, seed + 5)),
    );
    // The jaw: cropping while it grazes, chewing the cud now and then with the head up.
    const cud = (1 - g) * (1 - walk) * Math.max(0, noise(time * 0.15, seed + 9));
    set('jaw', 0.1 * Math.max(0, Math.sin(time * TAU * 1.5)) * Math.min(1, crop + cud));
    // Ears: toward the look, forward when alert, back and turning about on their own while it
    // grazes; a flick now and then.
    const look0 = lookAt(0);
    const listen = (s) => noise((time * 0.35) + s, s) * 0.6 * (1 - state.alert);
    const flick = (s) => Math.max(0, Math.sin((time * 1.9) + (s * 3.1))) ** 14;
    set('earL', 0.15 * g, (look0 * 0.7) + listen(seed + 11), (-0.25 * (1 - state.alert)) + (0.4 * flick(seed)));
    set('earR', 0.15 * g, (look0 * 0.7) + listen(seed + 13), (0.25 * (1 - state.alert)) - (0.4 * flick(seed + 2)));
    // The tail: down, lifted and swished now and then.
    const tailEvent = Math.max(0, noise(time * 0.3, seed + 17) - 0.55) / 0.45;
    set('tail', 0.12 - (0.45 * tailEvent), 0.35 * Math.sin(time * 9) * tailEvent);
    // FORWARD KINEMATICS of the body and head (the legs are solved after).
    const rootIndex = index.root;
    const lr = local[rootIndex];
    rotation(pitch + lr[0], state.heading, roll + lr[2], R[rootIndex]);
    // Height: the root over the mean of the ground under the hooves, carried a little lower in a
    // walk (a deer's legs stand straight; a stride needs a little give), then lowered further
    // below wherever a hoof bearing weight needs it (which makes the walk's own gentle bob).
    const groundMean = 0.25 * (feet[0].ground + feet[1].ground + feet[2].ground + feet[3].ground);
    J[rootIndex][0] = state.x;
    J[rootIndex][1] = groundMean + (skeleton[rootIndex].head[1] * k) - ((0.016 + (0.055 * walk)) * k)
        + (0.003 * k * breathe)
        + (leap.on ? leap.arc - (/** @type {any} */ (cfg).leap.sink * k * leap.sink) : 0);
    J[rootIndex][2] = state.z;
    const fkBone = (b) => {
        const { parent, head } = skeleton[b];
        const pr = R[parent];
        const ph = skeleton[parent].head;
        const dx = (head[0] - ph[0]) * k;
        const dy = (head[1] - ph[1]) * k;
        const dz = (head[2] - ph[2]) * k;
        J[b][0] = J[parent][0] + (pr[0] * dx) + (pr[1] * dy) + (pr[2] * dz);
        J[b][1] = J[parent][1] + (pr[3] * dx) + (pr[4] * dy) + (pr[5] * dz);
        J[b][2] = J[parent][2] + (pr[6] * dx) + (pr[7] * dy) + (pr[8] * dz);
        const l = local[b];
        mul3(pr, rotation(l[0], l[1], l[2], L), R[b]);
    };
    // (The shoulders and hips are placed with the body; below them the legs are solved after.)
    const legBones = new Set(rig.legs.flatMap((leg) => leg.chain));
    const bodyFk = () => {
        for (let b = 0; b < skeleton.length; b += 1) {
            if (b !== rootIndex && !legBones.has(b)) fkBone(b);
        }
    };
    bodyFk();
    // Lower the body if a hoof bearing weight would be out of its leg's reach.
    // Each hoof's say in it fades out over the start of its swing and back in before it lands, so
    // the body never jumps when a hoof lifts.
    let drop = 0;
    rig.legs.forEach((leg, l) => {
        const f = feet[l];
        const say = f.planted ? 1 : 1 - (s5(f.swing / 0.3) * s5((1 - f.swing) / 0.3));
        if (say <= 0) return;
        const A = J[leg.top];
        const reach = leg.reach * k * 0.985;
        const dx = f.x - A[0];
        const dz = f.z - A[2];
        const horiz = (dx * dx) + (dz * dz);
        const tY = f.ground + (leg.fetlock * k);
        const needY = tY + Math.sqrt(Math.max(0, (reach * reach) - horiz));
        drop = Math.max(drop, (A[1] - needY) * say);
    });
    if (drop > 0) {
        // (At most a sixth of its size, easing into that limit: past it a hoof would rather lift.)
        const most = 0.16 * k;
        J[rootIndex][1] -= most * (1 - Math.exp(-drop / most));
        bodyFk();
    }
    // THE LEGS: each reaches its hoof (two segments in the leg's plane, a little out to the side),
    // the hoof flat on the ground while planted, flicked back in the swing.
    const { hooves } = rig;
    rig.legs.forEach((leg, l) => {
        const f = feet[l];
        const { parent } = skeleton[leg.top];
        const P = R[parent];
        const A = J[leg.top];
        let lift = f.planted ? 0
            : cfg.lift * k * Math.min(1, 0.35 + (f.length / deer.strideW)) * Math.sin(Math.PI * f.swing);
        // In a leap the hooves ride the body's arc, folded up under it.
        if (f.kind === 2 && !f.planted) {
            lift = (4 * leap.apex * f.swing * (1 - f.swing))
                + (/** @type {any} */ (cfg).leap.tuck * (leg.front ? 1 : 0.7) * k * Math.sin(Math.PI * f.swing));
        }
        const tx = f.x;
        const ty = f.ground + (leg.fetlock * k) + lift;
        const tz = f.z;
        // Into the parent's frame (the rest axes), in model units.
        const wx = (tx - A[0]) / k;
        const wy = (ty - A[1]) / k;
        const wz = (tz - A[2]) / k;
        const vx = (P[0] * wx) + (P[3] * wy) + (P[6] * wz);
        const vy = (P[1] * wx) + (P[4] * wy) + (P[7] * wz);
        const vz = (P[2] * wx) + (P[5] * wy) + (P[8] * wz);
        const [u1y, u1z] = leg.u1;
        const [u2y, u2z] = leg.u2;
        const l1 = Math.hypot(u1y, u1z);
        const l2 = Math.hypot(u2y, u2z);
        // Out to the side by `side`: the leg's plane rolls out round the hip (abduction), so the
        // plane's own downward reach takes the sideways part too.
        const side = vx - leg.restX;
        const down = -Math.hypot(vy, side);
        const d = Math.min(Math.max(Math.hypot(down, vz), Math.abs(l1 - l2) * 1.05), (l1 + l2) * 0.999);
        // Bend at the knee or hock: |u1 + Rx(b) u2| = d.
        const Pdot = (u1y * u2y) + (u1z * u2z);
        const Q = (u1z * u2y) - (u1y * u2z);
        const m = (((d * d) - ((l1 * l1) + (l2 * l2))) / 2);
        const Rm = Math.hypot(Pdot, Q) || 1e-9;
        const phi0 = Math.atan2(Q, Pdot);
        const spread = Math.acos(Math.max(-1, Math.min(1, m / Rm)));
        // phi0 is the bend at which the leg is straightest; fore knees fold the cannon back from
        // there (+), hocks fold it forward (-). One root each, continuous as the reach changes.
        // (A knee or hock folds no further than about 110 degrees past straight.)
        const bend = leg.front
            ? Math.min(wrapAngle(phi0 + spread), phi0 + 1.9)
            : Math.max(wrapAngle(phi0 - spread), phi0 - 1.9);
        const cb = Math.cos(bend);
        const sb = Math.sin(bend);
        const cy = u1y + ((u2y * cb) - (u2z * sb));
        const cz = u1z + ((u2y * sb) + (u2z * cb));
        const swingAngle = Math.atan2(vz, down) - Math.atan2(cz, cy);
        const abduct = -Math.atan2(side, Math.max(0.2, -vy));
        const [c0, c1, c2] = leg.chain;
        local[leg.top][0] = wrapAngle(swingAngle);
        local[leg.top][2] = abduct;
        local[c0][0] = 0;
        local[c1][0] = bend;
        fkBone(leg.top);
        fkBone(c0);
        fkBone(c1);
        // The hoof: level with the ground along the heading while planted, flicked back in the swing.
        const along = 0.3 * k;
        const ahead = heightAt(f.x + (sh * along), f.z + (ch * along));
        const slope = (ahead - heightAt(f.x - (sh * along), f.z - (ch * along)))
            / (0.6 * k);
        const curl = f.planted ? 0 : (leg.front ? 1.1 : 0.8) * Math.sin(Math.PI * Math.min(1, f.swing * 1.15));
        rotation(-Math.atan(slope) + curl, state.heading, 0, rig.T);
        // local = R_c1^T * desired, taken about x.
        const rc = R[c1];
        const t = rig.T;
        const m21 = (rc[2] * t[1]) + (rc[5] * t[4]) + (rc[8] * t[7]);
        const m22 = (rc[2] * t[2]) + (rc[5] * t[5]) + (rc[8] * t[8]);
        local[c2][0] = Math.atan2(m21, m22);
        fkBone(c2);
        const o = hooves[l];
        const hb = skeleton[c2].head;
        const tip = rig.footOffset[leg.leg];
        const r = R[c2];
        const ddx = (tip[0] - hb[0]) * k;
        const ddy = (0 - hb[1]) * k;
        const ddz = (tip[1] - hb[2]) * k;
        o.x = J[c2][0] + (r[0] * ddx) + (r[1] * ddy) + (r[2] * ddz);
        o.y = J[c2][1] + (r[3] * ddx) + (r[4] * ddy) + (r[5] * ddz);
        o.z = J[c2][2] + (r[6] * ddx) + (r[7] * ddy) + (r[8] * ddz);
        o.ground = heightAt(o.x, o.z);
        o.stance = f.planted ? 1 : 0;
        o.planX = f.x;
        o.planZ = f.z;
    });
    // THE TABLE: per bone its world rotation and where its rest frame lands.
    if (table) {
        for (let b = 0; b < skeleton.length; b += 1) {
            const o = offset + (b * 8);
            const r = R[b];
            const [hx, hy, hz] = skeleton[b].head;
            quatFrom(r, table, o);
            table[o + 4] = J[b][0] - (k * ((r[0] * hx) + (r[1] * hy) + (r[2] * hz)));
            table[o + 5] = J[b][1] - (k * ((r[3] * hx) + (r[4] * hy) + (r[5] * hz)));
            table[o + 6] = J[b][2] - (k * ((r[6] * hx) + (r[7] * hy) + (r[8] * hz)));
            table[o + 7] = k;
        }
    }
    // The ground plane under the deer (its shadow lies on it): centre height and gradient.
    const e = 0.6 * k;
    const gx = (heightAt(state.x + e, state.z) - heightAt(state.x - e, state.z)) / (2 * e);
    const gz = (heightAt(state.x, state.z + e) - heightAt(state.x, state.z - e)) / (2 * e);
    return {
        hooves, ground: heightAt(state.x, state.z), gx, gz, state,
    };
}

/** Reveal (0 or 1) at journey progress `p`: drawn through the window, never faded in view. */
export function deerRevealAt(p, cfg = ODYSSEY_DEER) {
    return p >= cfg.window[0] && p <= cfg.window[1] ? 1 : 0;
}
