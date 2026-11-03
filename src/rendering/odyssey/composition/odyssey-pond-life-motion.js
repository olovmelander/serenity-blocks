// @ts-check
/**
 * LIFE AT THE POND — the swans' and the heron's lives on the CPU, without three.js
 * (odyssey-pond-life.js draws them). Chapter 3's tarn (ODYSSEY_TARN), 2026-11-02.
 *
 * WHERE. Scouted on the real rail camera (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md, "Life at the
 * pond"): the tarn is in frame while the rail glides from L18 to L19 (p 0.23-0.27, nearly all of it)
 * and again at L22-L23 (p 0.28-0.30, its west lobe). So the swans keep to the west and middle lobes
 * and the heron to the west lobe's shallows, which both stretches see.
 *
 * SIZE. The swans are drawn at three times life, like the act's other life (16-28 px long at
 * 1440p). The heron is drawn at 4.2 times (17-33 px tall) and the drinkers at 3.6 times: at three
 * times both were specks on the rail (VISIBILITY, 2026-11-03).
 *
 * Everything is a function of the board clock (world-anchored; the camera only passes them):
 *  - THE SWANS glide round one closed route through the deep water, the second a few seconds behind
 *    the first and a little to its side, at a speed that slowly breathes. Each carries its neck in an
 *    S that sways; now and then it looks round, dips its head under to feed, or turns its neck back
 *    to preen. Their wakes are drawn by the tarn's own water (`setTarnSwans` on the world).
 *  - THE HERON stands in the shallows, mostly still, as herons do; it leans into a slow stalk, and
 *    now and then strikes (the neck shoots down and comes back). Every so often it walks a few slow
 *    steps along the shallows to its next spot: each foot is planted where it lands and stays there
 *    while the body passes over it (a two-segment leg solve reaches it), so nothing slides. Every two
 *    or three minutes it flies to its other place: a take-off from its two feet, a few deep beats,
 *    low over the water or the bank with its neck drawn back and its legs trailing, a glide and
 *    braking beats, a landing and a few steps to settle (keyed in Blender: HERON_FLIGHT).
 *
 * OUTPUT. `poseBird` writes, per bone, its world rotation (a quaternion) and where its rest frame
 * lands (`at - k * q * rest`, with `k` the drawn size): the table odyssey-pond-life.js uploads. The
 * deer's table, the same layout.
 */
import { ODYSSEY_TARN } from '../world/odyssey-world-height.js';
import { ODYSSEY_DEER } from './odyssey-deer-herd.js';
import { HERON_FLIGHT } from './odyssey-heron-flight-keys.js';

/** The pond's life: where, how big, when drawn. */
export const ODYSSEY_POND = Object.freeze({
    /** Drawn larger than life, like the act's other life. */
    scale: 3.0,
    /**
     * [first, last] journey progress the pond's life is drawn at: from deep in chapter 2's water
     * (the eye cannot see the island) to after the tarn and its banks have left the frame.
     * odyssey-pond-life.test.js holds the camera to that, so nothing appears or leaves in view.
     */
    window: Object.freeze([0.09, 0.34]),
    swans: Object.freeze({
        /** The route's waypoints (world x, z), a closed loop through the deep water. */
        route: Object.freeze([
            [-335, -437], [-336, -445], [-323, -449], [-306, -444], [-292, -441], [-268, -444],
            [-250, -439], [-251, -428], [-271, -426], [-293, -437], [-308, -436], [-322, -433],
        ]),
        /** Gliding speed (u/s at the drawn size) and how much it breathes over `breath` seconds. */
        speed: 0.95,
        breathe: 0.18,
        breath: 23,
        /** The second swan: seconds behind the first along the route, and how far it wanders to
         * either side of the lead's line (units). */
        lag: 8.5,
        side: 1.1,
        /** How far the hull sits under the water (drawn units): the model is cut at its waterline. */
        draft: 0.2,
        /** Each swan's events repeat after this many seconds. */
        loop: 150,
    }),
    heron: Object.freeze({
        /**
         * Drawn at 4.2 times life, 1.4 times the pond's: at three times it stood 13-22 px tall on
         * the rail and read as a pale stroke (VISIBILITY, 2026-11-03).
         */
        scale: 4.2,
        /** Its two places in the west lobe's shallows (world x, z): the north shore, which every
         * view of the pond sees, and the south-west shallows by the drinkers' bank. */
        sites: Object.freeze({
            north: Object.freeze([[-336.0, -451.0], [-331.5, -454.0], [-327.0, -455.5]]),
            west: Object.freeze([[-338.6, -432.4], [-333.0, -427.6]]),
        }),
        /**
         * Its round: each stop a spot it stands at, and how it leaves for the next (the last for
         * the first): a walk along the shallows, or a flight low over the water and the west bank
         * through `via` (world x, z), a curve the rail's views of the pond keep in frame.
         */
        tour: Object.freeze([
            Object.freeze({ site: 'north', spot: 2, then: 'walk' }),
            Object.freeze({ site: 'north', spot: 1, then: 'walk' }),
            Object.freeze({
                site: 'north', spot: 0, then: 'fly', via: Object.freeze([[-343.3, -451.0], [-348.7, -446.2], [-349.4, -439.2], [-345.2, -433.7]]),
            }),
            Object.freeze({ site: 'west', spot: 0, then: 'walk' }),
            Object.freeze({
                site: 'west', spot: 1, then: 'fly', via: Object.freeze([[-326, -433], [-320, -440], [-320, -448]]),
            }),
        ]),
        /** Seconds it stands at a spot (min, max); how far the body moves a step (m at life size),
         * how long a step takes (s) and the pause after it (min, max s). */
        stand: Object.freeze([24, 50]),
        step: 0.17,
        stepTime: 1.15,
        pause: Object.freeze([0.7, 1.9]),
        /** How high a swinging foot lifts (share of the drawn size). */
        lift: 0.12,
        /** After landing, the steps it takes to settle (count, m at life size a step). */
        settle: Object.freeze({ steps: 2, step: 0.15 }),
        seed: 17,
    }),
});

/**
 * THE DRINKERS: a hind and her calf from the herd's kind (the glade's deer, odyssey-deer-herd.js),
 * a second small group that keeps to the ground west of the tarn and, a third of their
 * loop, comes down to drink at the west lobe's bank (the gentlest way down through the bowl's rim,
 * the heron's shallows a little to the south): grazing at the water's edge is their drinking (the head
 * down to the water, the muzzle at the waterline). They walk the herd's own paths and feet, on their
 * own clock; the calf keeps spots beside its mother's and walks a little slower, so it follows her
 * down a few seconds behind. Drawn over the pond's window.
 */
export const ODYSSEY_TARN_DEER = Object.freeze({
    ...ODYSSEY_DEER,
    /**
     * Drawn at 3.6 times life, 1.2 times the glade's herd: at three times the hind was a speck at
     * L15-L17 and the calf a shape (VISIBILITY, 2026-11-03).
     */
    scale: 3.6,
    window: ODYSSEY_POND.window,
    members: Object.freeze([
        Object.freeze({
            name: 'hind',
            size: 1.0,
            seed: 131,
            tone: 0.6,
            spots: Object.freeze([[-347.5, -442.0], [-367, -441], [-381, -443]]),
        }),
        Object.freeze({
            name: 'calf',
            size: 0.62,
            seed: 131,
            tone: 0.35,
            spots: Object.freeze([[-347.4, -439.2], [-365.5, -438.1], [-381.5, -440.2]]),
        }),
    ]),
});

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Smootherstep: no jump in speed or acceleration at either end. */
const s5 = (v) => {
    const t = clamp01(v);
    return t * t * t * ((t * ((t * 6) - 15)) + 10);
};

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

// ── THE SWANS' ROUTE ─────────────────────────────────────────────────────────────────
/** A Catmull-Rom point (`d` = 0) or its derivative (`d` = 1) at `t` in the span p1 -> p2. */
function catmull(p0, p1, p2, p3, t, d) {
    const t2 = t * t;
    const c = (a, b, cc, e) => (d === 0
        ? 0.5 * ((2 * b) + ((-a + cc) * t) + (((2 * a) - (5 * b) + (4 * cc) - e) * t2)
            + ((-a + (3 * b) - (3 * cc) + e) * t2 * t))
        : 0.5 * ((-a + cc) + (2 * ((2 * a) - (5 * b) + (4 * cc) - e) * t)
            + (3 * (-a + (3 * b) - (3 * cc) + e) * t2)));
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * The closed route: a Catmull-Rom through the waypoints, with a dense arc-length table that maps a
 * distance along it to the spline's own parameter. Places and tangents are evaluated on the spline
 * itself, so the heading turns smoothly (a table of straight pieces turned it in small steps, a
 * jitter of up to 220 rad/s^2 at the root).
 */
function buildRoute(points) {
    const n = points.length;
    const per = 48;
    const params = [];
    const at = (u) => {
        const i = Math.floor(u) % n;
        return catmull(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n], u - Math.floor(u), 0);
    };
    for (let k = 0; k <= n * per; k += 1) params.push(k / per);
    const lengths = new Float64Array(params.length);
    let prev = at(0);
    for (let k = 1; k < params.length; k += 1) {
        const q = at(params[k] % n);
        lengths[k] = lengths[k - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
    }
    return {
        points, params, lengths, length: lengths[lengths.length - 1], n,
    };
}

let routeCache = null;
/** The swans' route (built once). */
export function swanRoute() {
    if (!routeCache) routeCache = buildRoute(ODYSSEY_POND.swans.route);
    return routeCache;
}

/** A point on the route at arc length `s` (wrapped), with its unit tangent and its curvature. */
function routeAt(route, s, out) {
    const L = route.length;
    const u = ((s % L) + L) % L;
    let lo = 0;
    let hi = route.params.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (route.lengths[mid] <= u) lo = mid; else hi = mid - 1;
    }
    const seg = Math.max(1e-9, route.lengths[lo + 1] - route.lengths[lo]);
    const param = route.params[lo] + ((route.params[lo + 1] - route.params[lo]) * ((u - route.lengths[lo]) / seg));
    const { points, n } = route;
    const i = Math.floor(param) % n;
    const t = param - Math.floor(param);
    const span = [points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    const p = catmull(...span, t, 0);
    const d = catmull(...span, t, 1);
    const len = Math.max(1e-9, Math.hypot(d[0], d[1]));
    out.x = p[0];
    out.z = p[1];
    out.tx = d[0] / len;
    out.tz = d[1] / len;
    return out;
}

/** Each swan's paddle rhythm (strokes a second) and how much a stroke surges it (share of speed). */
const PADDLE = Object.freeze({ rate: Object.freeze([0.92, 1.07]), surge: 0.06 });
/** A paddle stroke's push and glide: a quick surge, then a long, slow ease (two harmonics). */
const paddleShape = (phase) => Math.cos(phase) + (0.35 * Math.cos((2 * phase) - 0.6));
/** Its integral over the phase, for the distance glided. */
const paddleArea = (phase) => Math.sin(phase) + (0.175 * Math.sin((2 * phase) - 0.6));

/** Distance swan `i` has glided by board time `t`: a steady speed that breathes slowly, surging a
 * little with each paddle stroke (closed form). */
function glided(t, i = 0) {
    const S = ODYSSEY_POND.swans;
    const w = TAU / S.breath;
    const p = TAU * PADDLE.rate[i % 2];
    return S.speed * (t - ((S.breathe / w) * Math.cos(w * t)) + ((PADDLE.surge / p) * paddleArea(p * t)));
}

/** Swan event kinds and their weights; a wing stretch is rare. */
const SWAN_KINDS = Object.freeze([
    { kind: 'look', weight: 0.42 }, { kind: 'dip', weight: 0.3 }, { kind: 'preen', weight: 0.18 },
    { kind: 'stretch', weight: 0.1 },
]);
const SWAN_SPANS = Object.freeze({
    look: [5, 4], dip: [7, 5], preen: [8, 6], stretch: [4.6, 1.2],
});

/** A swan's events on its own loop: look round, dip to feed, preen, a wing stretch. Built once a
 * swan; each loop holds one stretch at least, and every swan its own timing. */
function buildSwanEvents(seed) {
    const rand = seeded(seed);
    const { loop } = ODYSSEY_POND.swans;
    const events = [];
    let t = 5 + (rand() * 12);
    let stretched = false;
    while (t < loop - 16) {
        let r = rand();
        let kind = 'look';
        for (const { kind: k, weight } of SWAN_KINDS) {
            if (r < weight) {
                kind = k;
                break;
            }
            r -= weight;
        }
        if (!stretched && t > loop * 0.5) kind = 'stretch';
        if (kind === 'stretch') stretched = true;
        const span = SWAN_SPANS[kind];
        const dur = span[0] + (rand() * span[1]);
        events.push({
            kind, t0: t, dur, side: rand() < 0.5 ? -1 : 1, amount: 0.65 + (rand() * 0.35),
        });
        t += dur + 7 + (rand() * 18);
    }
    return events;
}
const SWAN_EVENTS = [buildSwanEvents(41), buildSwanEvents(77)];

/** An envelope over `dur`: eased in over `a`, held, eased out over `b` (smootherstep both ends). */
const envelope = (u, dur, a, b) => (u < 0 || u > dur ? 0 : s5(u / a) * s5((dur - u) / b));

/**
 * Swan `i` (0 the lead, 1 its mate) at board time `time`: where it floats, the way it faces, how
 * fast and how hard it is turning, its paddle phase, and its neck's channels (`look` yaw, `dip`,
 * `preen`, `stretch` 0..1, their side, and the stretch's own clock).
 */
export function swanStateAt(i, time, out = {}) {
    const S = ODYSSEY_POND.swans;
    const route = swanRoute();
    const t = time - (i * S.lag);
    const s = glided(t, i);
    const at = routeAt(route, s, {
        x: 0, z: 0, tx: 0, tz: 1,
    });
    const ahead = routeAt(route, s + 0.8, {
        x: 0, z: 0, tx: 0, tz: 1,
    });
    const behind = routeAt(route, s - 0.8, {
        x: 0, z: 0, tx: 0, tz: 1,
    });
    // The mate follows the lead's own line a few seconds behind, wandering slowly a little to
    // either side of it (a fixed offset swung wide and cusped round the west lobe's turn).
    const side = i === 0 ? 0 : S.side * Math.sin((t * 0.047) + 1.1);
    out.x = at.x + (-at.tz * side);
    out.z = at.z + (at.tx * side);
    out.heading = Math.atan2(at.tx, at.tz);
    const w = TAU / S.breath;
    const p = TAU * PADDLE.rate[i % 2];
    out.speed = S.speed * (1 + (S.breathe * Math.sin(w * t)) + (PADDLE.surge * paddleShape(p * t)));
    // Turning by the head first: the neck looks into the bend the route takes ~2.5 s ahead.
    const far = routeAt(route, s + (out.speed * 2.5), {
        x: 0, z: 0, tx: 0, tz: 1,
    });
    out.leadYaw = Math.max(-0.45, Math.min(0.45, 0.8 * Math.atan2(
        Math.sin(Math.atan2(far.tx, far.tz) - out.heading),
        Math.cos(Math.atan2(far.tx, far.tz) - out.heading),
    )));
    out.vx = at.tx * out.speed;
    out.vz = at.tz * out.speed;
    // How fast it is turning (rad/s): the route's curvature at its speed. It leans into a turn.
    const dh = Math.atan2(
        Math.sin(Math.atan2(ahead.tx, ahead.tz) - Math.atan2(behind.tx, behind.tz)),
        Math.cos(Math.atan2(ahead.tx, ahead.tz) - Math.atan2(behind.tx, behind.tz)),
    );
    out.turn = (dh / 1.6) * out.speed;
    out.paddle = p * t;
    const local = ((time % S.loop) + S.loop) % S.loop;
    out.look = 0;
    out.dip = 0;
    out.preen = 0;
    out.stretch = 0;
    out.stretchT = 0;
    out.side = 1;
    for (const e of SWAN_EVENTS[i % SWAN_EVENTS.length]) {
        const u = local - e.t0;
        if (u < 0 || u > e.dur) continue;
        out.side = e.side;
        if (e.kind === 'look') {
            // Turn, hold and look, turn back: two eased moves, never a sine's constant sweep.
            const there = s5(u / 1.3) * s5((e.dur - u) / 1.5);
            out.look = e.side * e.amount * 0.75 * there;
        } else if (e.kind === 'dip') {
            out.dip = envelope(u, e.dur, 1.6, 1.8) * e.amount;
        } else if (e.kind === 'preen') {
            out.preen = envelope(u, e.dur, 1.8, 1.8);
        } else {
            out.stretch = envelope(u, e.dur, 0.9, 1.4);
            out.stretchT = u;
        }
    }
    out.time = time;
    return out;
}

// ── THE HERON'S LIFE ─────────────────────────────────────────────────────────────────
/** An open Catmull-Rom path through `points` (world x, z), with its arc-length table. */
function buildPath(points) {
    const n = points.length - 1;
    const per = 32;
    const pt = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
    const span = (i) => [pt(i - 1), pt(i), pt(i + 1), pt(i + 2)];
    const params = [];
    for (let k = 0; k <= n * per; k += 1) params.push(k / per);
    const at = (u) => {
        const i = Math.min(n - 1, Math.floor(u));
        return catmull(...span(i), u - i, 0);
    };
    const lengths = new Float64Array(params.length);
    let prev = at(0);
    for (let k = 1; k < params.length; k += 1) {
        const q = at(params[k]);
        lengths[k] = lengths[k - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
    }
    return {
        params, lengths, length: lengths[lengths.length - 1], n, span,
    };
}

/** A point on an open path at arc length `s` (clamped), with its unit tangent. */
function pathAt(path, s, out) {
    const u = Math.max(0, Math.min(path.length, s));
    let lo = 0;
    let hi = path.params.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (path.lengths[mid] <= u) lo = mid; else hi = mid - 1;
    }
    const seg = Math.max(1e-9, path.lengths[lo + 1] - path.lengths[lo]);
    const param = path.params[lo] + ((path.params[lo + 1] - path.params[lo]) * ((u - path.lengths[lo]) / seg));
    const i = Math.min(path.n - 1, Math.floor(param));
    const sp = path.span(i);
    const p = catmull(...sp, param - i, 0);
    const d = catmull(...sp, param - i, 1);
    const len = Math.max(1e-9, Math.hypot(d[0], d[1]));
    out.x = p[0];
    out.z = p[1];
    out.tx = d[0] / len;
    out.tz = d[1] / len;
    return out;
}

const FLY_AT = {};
const FLY_BEHIND = {};
const FLY_AHEAD = {};
/** A flight's way (heading) at arc length `s`: the chord over 3 units round it (the tangent at an end). */
function flyWay(seg, s, at) {
    const a = pathAt(seg.path, s - 1.5, FLY_BEHIND);
    const b = pathAt(seg.path, s + 1.5, FLY_AHEAD);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : Math.atan2(at.tx, at.tz);
}

/** A flight channel at `u` seconds into the flight (the Blender-keyed table, cubic between samples). */
function flightChannel(name, u) {
    const c = HERON_FLIGHT.channels[name];
    const f = Math.max(0, Math.min(c.length - 1, u * HERON_FLIGHT.rate));
    const i = Math.min(c.length - 2, Math.floor(f));
    const at = (j) => [0, c[Math.max(0, Math.min(c.length - 1, j))]];
    return catmull(at(i - 1), at(i), at(i + 1), at(i + 2), f - i, 0)[1];
}
/** Seconds into the flight its feet touch the water again (the first `height` 0 after the rise). */
const HERON_TOUCHDOWN = (() => {
    const h = HERON_FLIGHT.channels.height;
    let i = h.findIndex((v) => v > 0.5);
    while (i < h.length && h[i] > 1e-4) i += 1;
    return i / HERON_FLIGHT.rate;
})();

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * The heron's schedule over one loop, round its tour: stand at a stop (its stalks, strikes, shakes
 * and small head turns), then leave for the next: a stalk along the shallows, one deliberate step at
 * a time (each step lifts a foot, carries the body over it and sets it down; between steps it
 * stands, a different while each time; the last step brings the trailing foot up beside the other),
 * or a flight low across the water (the Blender-keyed take-off, beats, glide and landing, laid along
 * a curved path), ending in a few quick steps to settle.
 */
function buildHeronSchedule() {
    const H = ODYSSEY_POND.heron;
    const k = H.scale;
    const rand = seeded(H.seed);
    /** @type {any[]} the stands, walks and flights in order */
    const segs = [];
    let t = 0;
    const stops = H.tour.map((s) => H.sites[s.site][s.spot]);
    const n = stops.length;
    const half = 0.04 * k;
    const lateral = (p, h, side) => {
        const s = side === 0 ? 1 : -1;
        return [p[0] + (Math.cos(h) * half * s), p[1] - (Math.sin(h) * half * s)];
    };
    // Each flight's path and where it lands: short of its stop by the settling steps.
    const settleBy = H.settle.steps * H.settle.step * k;
    const flights = H.tour.map((s, i) => {
        if (s.then !== 'fly') return null;
        const to = stops[(i + 1) % n];
        const path = buildPath([stops[i], ...s.via, to]);
        const land = pathAt(path, path.length - settleBy, {});
        return {
            path, length: path.length - settleBy, land: [land.x, land.z], heading: Math.atan2(to[0] - land.x, to[1] - land.z),
        };
    });
    // The heading it arrives at each stop with: its walk's or its settling steps'.
    const arrive = stops.map((at, i) => {
        const j = (i - 1 + n) % n;
        if (flights[j]) return flights[j].heading;
        return Math.atan2(at[0] - stops[j][0], at[1] - stops[j][1]);
    });

    /**
     * A walk's moves from `from` to `to`: first a few small stepped turns toward it (each at most
     * ~0.5 rad, a foot re-placed each time, never a spin), then steps of `step` (drawn units) one
     * at a time, and the trailing foot brought up beside the other at the end.
     */
    function walkMoves(from, to, standHeading, { step, time = 1, pauses = 1 }) {
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const walkHeading = Math.atan2(to[0] - from[0], to[1] - from[1]);
        const turnBy = angleTo(standHeading, walkHeading);
        const turns = Math.abs(turnBy) < 0.05 ? 0 : Math.ceil(Math.abs(turnBy) / 0.5);
        const count = Math.max(2, Math.round(dist / step));
        const delta = dist / count;
        const dx = (to[0] - from[0]) / dist;
        const dz = (to[1] - from[1]) / dist;
        const feet = [lateral(from, standHeading, 0), lateral(from, standHeading, 1)];
        const moves = [];
        let u = 0;
        let along = 0;
        let heading = standHeading;
        // Turning toward the left (positive), the left foot steps first, and the other way round.
        let side = turnBy >= 0 ? 0 : 1;
        const pushMove = (to2, a1, h1, forward, closing = false) => {
            const dur = H.stepTime * time * (0.9 + (rand() * 0.25)) * (forward ? 1 : 0.85);
            moves.push({
                t0: u, dur, side, from: feet[side].slice(), to: to2, feet: [feet[0].slice(), feet[1].slice()], a0: along, a1, h0: heading, h1, forward,
            });
            feet[side] = to2;
            along = a1;
            heading = h1;
            u += dur + (closing ? 0.6 : (H.pause[0] + (rand() * (H.pause[1] - H.pause[0])) * (forward ? 1 : 0.6)) * pauses);
            side = 1 - side;
        };
        for (let m = 1; m <= turns; m += 1) {
            const h1 = standHeading + ((turnBy * m) / turns);
            pushMove(lateral(from, h1, side), 0, h1, false);
        }
        for (let m = 0; m < count; m += 1) {
            const pos = m >= count - 1 ? dist : Math.min(dist, ((m + 1) * delta) + (delta * 0.5));
            const foot = lateral([from[0] + (dx * pos), from[1] + (dz * pos)], walkHeading, side);
            pushMove(foot, (m + 1) * delta, walkHeading, true);
        }
        pushMove(lateral(to, walkHeading, side), dist, walkHeading, false, true);
        return {
            kind: 'walk', dur: u, from, to, dist, moves, heading: walkHeading,
        };
    }

    for (let i = 0; i < n; i += 1) {
        const from = stops[i];
        const to = stops[(i + 1) % n];
        const stand = H.stand[0] + (rand() * (H.stand[1] - H.stand[0]));
        // Its acts while it stands: stalks (a slow lean, the neck reaching forward and low) and
        // strikes (a slow coil, the shot, the hold, the return; half of them come up with a fish,
        // which it swallows), some followed by a shake; never in the first or last few seconds.
        const acts = [];
        let a = 4 + (rand() * 6);
        while (a < stand - 14) {
            const strike = rand() < 0.45;
            const caught = rand() < 0.5;
            const dur = strike ? (caught ? 6.4 : 4.8) + (rand() * 1.2) : 7 + (rand() * 7);
            acts.push({
                kind: strike ? 'strike' : 'stalk', t0: a, dur, caught: strike && caught,
            });
            a += dur;
            if (strike && rand() < 0.5) {
                acts.push({ kind: 'shake', t0: a + 0.5, dur: 1.2 });
                a += 1.8;
            }
            a += 5 + (rand() * 10);
        }
        // Small head turns: hold, then a quick, eased turn to a new place (as a heron's head moves).
        const looks = [];
        let l = 0;
        while (l < stand) {
            looks.push({ t0: l, yaw: (rand() - 0.5) * 0.9, pitch: (rand() - 0.5) * 0.12 });
            l += 1.8 + (rand() * 3.5);
        }
        segs.push({
            kind: 'stand', t0: t, dur: stand, x: from[0], z: from[1], acts, looks, heading: arrive[i],
        });
        t += stand;
        const flight = flights[i];
        if (!flight) {
            segs.push({ ...walkMoves(from, to, arrive[i], { step: H.step * k }), t0: t });
            t += segs[segs.length - 1].dur;
        } else {
            // THE FLIGHT: off from its two feet, along the path, down onto two feet at `land`.
            const h0 = arrive[i];
            const p0 = pathAt(flight.path, 0, {});
            segs.push({
                kind: 'fly',
                t0: t,
                dur: HERON_FLIGHT.seconds,
                path: flight.path,
                length: flight.length,
                h0,
                h1: flight.heading,
                rise: angleTo(h0, Math.atan2(p0.tx, p0.tz)),
                feet0: [lateral(from, h0, 0), lateral(from, h0, 1)],
                feet1: [lateral(flight.land, flight.heading, 0), lateral(flight.land, flight.heading, 1)],
            });
            t += HERON_FLIGHT.seconds;
            // ...and its settling steps, short and quick, to the stop.
            segs.push({
                ...walkMoves(flight.land, to, flight.heading, { step: H.settle.step * k, time: 0.7, pauses: 0.35 }), t0: t, settle: true,
            });
            t += segs[segs.length - 1].dur;
        }
    }
    return { segs, loop: t };
}
const HERON = buildHeronSchedule();
export const HERON_LOOP = HERON.loop;
/** The heron's stops (world x, z), in its tour's order. */
export const HERON_STOPS = Object.freeze(ODYSSEY_POND.heron.tour.map((s) => ODYSSEY_POND.heron.sites[s.site][s.spot]));
/** Its flights in one loop: when each starts (board s), how long it lasts, when its feet touch down. */
export const HERON_FLIGHTS = Object.freeze(HERON.segs.filter((s) => s.kind === 'fly').map((s) => Object.freeze({
    t0: s.t0, dur: s.dur, length: s.length, touchdown: HERON_TOUCHDOWN,
})));

/** The stand's head turn at `u`: eased from the last look to the current over 0.35 s. */
function heronLook(seg, u) {
    let i = 0;
    while (i + 1 < seg.looks.length && seg.looks[i + 1].t0 <= u) i += 1;
    const cur = seg.looks[i];
    const prev = seg.looks[Math.max(0, i - 1)];
    const w = s5((u - cur.t0) / 0.35);
    return { yaw: prev.yaw + ((cur.yaw - prev.yaw) * w), pitch: prev.pitch + ((cur.pitch - prev.pitch) * w) };
}

/** The strike's timing (s from its start): lean in, a slow coil, the shot, the hold, the return. */
const STRIKE = Object.freeze({
    coil: Object.freeze([1.0, 1.5]), shot: 0.24, hold: 0.5,
});

/**
 * The heron at board time `time`: its body (x, z, heading), its feet (world x, z, each planted or
 * swinging with its lift), its posture's channels (`stalk`, the strike's `coil` and `shoot`, `shake`
 * and its clock, the catch's `fish` and `swallow`, the head's `look` and `nod`) and `headLag`, how
 * far (world units, along its heading) the head is held back while the body moves under it.
 */
export function heronStateAt(time, out = { feet: [{}, {}] }) {
    const H = ODYSSEY_POND.heron;
    const t = ((time % HERON.loop) + HERON.loop) % HERON.loop;
    let seg = HERON.segs[0];
    for (const s of HERON.segs) if (s.t0 <= t) seg = s;
    const u = t - seg.t0;
    out.stalk = 0;
    out.coil = 0;
    out.shoot = 0;
    out.shake = 0;
    out.shakeT = 0;
    out.fish = 0;
    out.swallow = 0;
    out.gulp = 0;
    out.walking = 0;
    out.headLag = 0;
    out.look = 0;
    out.nod = 0;
    out.flying = 0;
    out.along = 0;
    out.height = 0;
    out.flyCrouch = 0;
    out.wing = 0;
    out.wingLag = 0;
    out.sweep = 0;
    out.spread = 0;
    out.flyPitch = 0;
    out.flyNeck = 0;
    out.legs = 0;
    out.bank = 0;
    if (seg.kind === 'stand') {
        out.x = seg.x;
        out.z = seg.z;
        out.heading = seg.heading;
        // Its head turns settle to the front before and after a walk (no turn carries across).
        const look = heronLook(seg, u);
        const settle = s5(u / 1.2) * s5((seg.dur - u) / 1.2);
        out.look = look.yaw * settle;
        out.nod = look.pitch * settle;
        for (const a of seg.acts) {
            const v = u - a.t0;
            if (v < 0 || v > a.dur) continue;
            if (a.kind === 'stalk') out.stalk = envelope(v, a.dur, 2.4, 2.6);
            else if (a.kind === 'shake') {
                out.shake = envelope(v, a.dur, 0.15, 0.5);
                out.shakeT = v;
            } else {
                const [c0, c1] = STRIKE.coil;
                const shotAt = c0 + c1;
                const holdEnd = shotAt + STRIKE.shot + STRIKE.hold;
                out.stalk = envelope(v, a.dur, 1.0, 1.4);
                // The coil draws the neck slowly back into a tight S; the shot throws it out (eased
                // at both ends) as the coil lets go; it holds, then draws back slowly.
                out.coil = v < c0 ? 0 : s5((v - c0) / c1) * (1 - s5((v - shotAt) / STRIKE.shot));
                if (v >= shotAt && v < shotAt + STRIKE.shot) out.shoot = s5((v - shotAt) / STRIKE.shot);
                else if (v >= shotAt + STRIKE.shot && v < holdEnd) out.shoot = 1;
                else if (v >= holdEnd) out.shoot = 1 - s5((v - holdEnd) / (a.dur - holdEnd));
                if (a.caught) {
                    // A fish in the bill: it grows in while the bill is under (hidden by the water),
                    // comes up with the head, and is swallowed: the head tips up, two gulps, gone.
                    const swallowAt = holdEnd + 1.3;
                    out.fish = s5((v - (shotAt + STRIKE.shot)) / 0.2) * (1 - s5((v - (swallowAt + 0.5)) / 0.7));
                    out.swallow = envelope(v - swallowAt, 1.8, 0.45, 0.6);
                    const g = v - (swallowAt + 0.4);
                    out.gulp = g > 0 && g < 1.2 ? Math.max(0, Math.sin((g / 1.2) * TAU * 2)) * 0.5 : 0;
                }
            }
        }
        if (out.stalk > 0 || out.shoot > 0) out.look *= 1 - Math.max(out.stalk, out.shoot);
        const [L, R] = HERON_STAND_FEET(seg);
        out.feet[0].x = L[0];
        out.feet[0].z = L[1];
        out.feet[1].x = R[0];
        out.feet[1].z = R[1];
        out.feet.forEach((f) => {
            f.lift = 0;
            f.planted = true;
        });
        return out;
    }
    if (seg.kind === 'fly') {
        // THE FLIGHT: the keyed channels at this moment, laid along the path.
        const F = (name) => flightChannel(name, u);
        out.flying = 1;
        out.along = clamp01(F('along'));
        out.height = Math.max(0, F('height'));
        out.flyCrouch = F('crouch');
        out.wing = F('wing');
        out.wingLag = flightChannel('wing', u - 0.09);
        out.sweep = F('sweep');
        out.spread = clamp01(F('spread'));
        out.flyPitch = F('pitch');
        out.flyNeck = clamp01(F('neck'));
        out.legs = clamp01(F('legs'));
        out.from = seg.feet0;
        out.to = seg.feet1;
        const s = out.along * seg.length;
        const p = pathAt(seg.path, s, FLY_AT);
        out.x = p.x;
        out.z = p.z;
        // It turns from the way it stood to the path's way as it rises, then follows the path (its
        // way over a few units, so the spline's knots never jerk it), and faces its settling steps
        // as it lands.
        const th = flyWay(seg, s, p);
        let h = seg.h0 + (angleTo(seg.h0, th) * s5((u - 0.2) / 1.4));
        h += angleTo(h, seg.h1) * s5((u - (HERON_TOUCHDOWN - 0.9)) / 0.9);
        out.heading = h;
        // Banked into its turns as a bird flies them: tan(bank) = speed x turn rate / g (life size).
        const speed = (flightChannel('along', u + (1 / 60)) - flightChannel('along', u - (1 / 60))) * 30 * seg.length;
        const turnRate = (angleTo(flyWay(seg, s - 2, p), flyWay(seg, s + 2, p)) / 4) * speed;
        const k = H.scale;
        out.bank = -Math.max(-0.5, Math.min(0.5, Math.atan(((speed / k) * turnRate) / 9.8))) * out.spread;
        // Its feet: on the water at the take-off until they leave it, and from the touchdown on.
        out.feet.forEach((f, side) => {
            const at = out.along < 0.5 ? seg.feet0[side] : seg.feet1[side];
            [f.x, f.z] = at;
            f.lift = 0;
            f.planted = out.height < 1e-4 && (u < 1 || u >= HERON_TOUCHDOWN - 1e-6);
        });
        return out;
    }
    // A walk: the move this is (or the pause after it).
    out.walking = 1;
    out.stalk = envelope(u, seg.dur, 1.6, 1.6);
    let j = 0;
    while (j + 1 < seg.moves.length && seg.moves[j + 1].t0 <= u) j += 1;
    const mv = seg.moves[j];
    const w = s5((u - mv.t0) / mv.dur);
    const along = mv.a0 + ((mv.a1 - mv.a0) * w);
    const dx = (seg.to[0] - seg.from[0]) / seg.dist;
    const dz = (seg.to[1] - seg.from[1]) / seg.dist;
    out.x = seg.from[0] + (dx * along);
    out.z = seg.from[1] + (dz * along);
    const dh = Math.atan2(Math.sin(mv.h1 - mv.h0), Math.cos(mv.h1 - mv.h0));
    out.heading = mv.h0 + (dh * w);
    // The head is held where it was while the body moves under it, then glides on in the pause.
    // (It glides on within the pause, however short; a landing's quick settling steps carry it.)
    const pauseU = u - (mv.t0 + mv.dur);
    const next = seg.moves[j + 1];
    const release = Math.max(0.1, Math.min(0.7, (next ? next.t0 : seg.dur) - (mv.t0 + mv.dur)));
    if (mv.forward && !seg.settle) out.headLag = pauseU < 0 ? (mv.a1 - mv.a0) * w : (mv.a1 - mv.a0) * (1 - s5(pauseU / release));
    const moving = pauseU < 0;
    out.feet.forEach((f, side) => {
        if (moving && side === mv.side) {
            f.x = mv.from[0] + ((mv.to[0] - mv.from[0]) * w);
            f.z = mv.from[1] + ((mv.to[1] - mv.from[1]) * w);
            const lift = Math.hypot(mv.to[0] - mv.from[0], mv.to[1] - mv.from[1]) > 1e-6
                ? Math.sin(Math.PI * ((u - mv.t0) / mv.dur)) ** 2.5 : 0;
            f.lift = lift * H.lift * H.scale;
            f.planted = lift === 0;
        } else {
            const p = side === mv.side ? mv.to : mv.feet[side];
            [f.x, f.z] = p;
            f.lift = 0;
            f.planted = true;
        }
    });
    return out;
}

/** A stand's two feet: where the walk before it left them (beside each other, the way it faces). */
function HERON_STAND_FEET(seg) {
    if (!seg.feetCache) {
        const k = ODYSSEY_POND.heron.scale;
        const half = 0.04 * k;
        const h = seg.heading;
        seg.feetCache = [0, 1].map((side) => {
            const s = side === 0 ? 1 : -1;
            return [seg.x + (Math.cos(h) * half * s), seg.z - (Math.sin(h) * half * s)];
        });
    }
    return seg.feetCache;
}

// ── POSING (shared) ──────────────────────────────────────────────────────────────────
/** Quaternion helpers on [x, y, z, w] arrays. */
const qmul = (a, b, out) => {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    out[0] = (aw * bx) + (ax * bw) + (ay * bz) - (az * by);
    out[1] = (aw * by) - (ax * bz) + (ay * bw) + (az * bx);
    out[2] = (aw * bz) + (ax * by) - (ay * bx) + (az * bw);
    out[3] = (aw * bw) - (ax * bx) - (ay * by) - (az * bz);
    return out;
};
const qrot = (q, v, out) => {
    const [qx, qy, qz, qw] = q;
    const [vx, vy, vz] = v;
    const tx = 2 * ((qy * vz) - (qz * vy));
    const ty = 2 * ((qz * vx) - (qx * vz));
    const tz = 2 * ((qx * vy) - (qy * vx));
    out[0] = vx + (qw * tx) + ((qy * tz) - (qz * ty));
    out[1] = vy + (qw * ty) + ((qz * tx) - (qx * tz));
    out[2] = vz + (qw * tz) + ((qx * ty) - (qy * tx));
    return out;
};
/** R = Ry . Rz . Rx (pitch about x first, then roll, then yaw), as a quaternion. */
const qeuler = (rx, ry, rz, out) => {
    const qx = [Math.sin(rx / 2), 0, 0, Math.cos(rx / 2)];
    const qy = [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)];
    const qz = [0, 0, Math.sin(rz / 2), Math.cos(rz / 2)];
    const tmp = [0, 0, 0, 1];
    qmul(qy, qz, tmp);
    return qmul(tmp, qx, out);
};

/**
 * A rig for one bird skeleton: its bones in order, their parents and rest heads, scratch.
 * @param {{name: string, parent: number, head: number[]}[]} skeleton
 */
export function createBirdRig(skeleton) {
    const index = Object.fromEntries(skeleton.map((b, i) => [b.name, i]));
    return {
        skeleton,
        index,
        local: skeleton.map(() => [0, 0, 0]),
        qw: skeleton.map(() => [0, 0, 0, 1]),
        hw: skeleton.map(() => [0, 0, 0]),
        tmp: [0, 0, 0, 1],
        v: [0, 0, 0],
    };
}

/**
 * Forward kinematics from the rig's local Euler angles, the body at (x, y, z) facing `heading`
 * (radians, from +z toward +x) with its own `pitch` and `roll`, drawn `k` times life; writes the
 * shader table (8 floats a bone) at `offset`.
 */
export function poseBird(rig, {
    x, y, z, heading, pitch = 0, roll = 0,
}, k, table = null, offset = 0) {
    const {
        skeleton, local, qw, hw, tmp, v,
    } = rig;
    const base = qeuler(pitch, heading, roll, [0, 0, 0, 1]);
    // A bone may be drawn smaller than the rest (`rig.size`: the heron's fish, its wings; 0 = gone),
    // scaled about its own head, and its children with it.
    const grown = rig.grown || (rig.grown = skeleton.map(() => 1));
    skeleton.forEach((bone, i) => {
        const l = local[i];
        const lq = rig.localQ ? rig.localQ[i] : null;
        if (lq) {
            [tmp[0], tmp[1], tmp[2], tmp[3]] = lq;
        } else {
            qeuler(l[0], l[1], l[2], tmp);
        }
        grown[i] = (bone.parent < 0 ? 1 : grown[bone.parent]) * (rig.size ? rig.size[i] : 1);
        if (bone.parent < 0) {
            qmul(base, tmp, qw[i]);
            qrot(base, bone.head, v);
            hw[i][0] = x + (v[0] * k);
            hw[i][1] = y + (v[1] * k);
            hw[i][2] = z + (v[2] * k);
        } else {
            const p = bone.parent;
            qmul(qw[p], tmp, qw[i]);
            const ph = skeleton[p].head;
            qrot(qw[p], [bone.head[0] - ph[0], bone.head[1] - ph[1], bone.head[2] - ph[2]], v);
            const kp = k * grown[p];
            hw[i][0] = hw[p][0] + (v[0] * kp);
            hw[i][1] = hw[p][1] + (v[1] * kp);
            hw[i][2] = hw[p][2] + (v[2] * kp);
        }
        if (table) {
            const ks = k * grown[i];
            const o = offset + (i * 8);
            const q = qw[i];
            qrot(q, bone.head, v);
            table[o] = q[0];
            table[o + 1] = q[1];
            table[o + 2] = q[2];
            table[o + 3] = q[3];
            table[o + 4] = hw[i][0] - (v[0] * ks);
            table[o + 5] = hw[i][1] - (v[1] * ks);
            table[o + 6] = hw[i][2] - (v[2] * ks);
            table[o + 7] = ks;
        }
    });
    return rig;
}

/** Set one bone's local angles (pitch about x, yaw about y, roll about z). */
function setLocal(rig, name, rx, ry = 0, rz = 0) {
    const l = rig.local[rig.index[name]];
    if (!l) return;
    l[0] = rx;
    l[1] = ry;
    l[2] = rz;
}

/**
 * A neck chain's rest: each segment's angle in the bird's plane (from up toward forward) from one
 * bone's head to the next, and their lengths. Cached on the rig.
 */
function neckRest(rig, names) {
    const key = names.join();
    rig.necks = rig.necks || {};
    if (!rig.necks[key]) {
        const heads = names.map((n) => rig.skeleton[rig.index[n]].head);
        const angles = [];
        const lengths = [];
        for (let i = 0; i + 1 < heads.length; i += 1) {
            const dy = heads[i + 1][1] - heads[i][1];
            const dz = heads[i + 1][2] - heads[i][2];
            angles.push(Math.atan2(dz, dy));
            lengths.push(Math.hypot(dy, dz));
        }
        rig.necks[key] = {
            names, angles, lengths, base: heads[0],
        };
    }
    return rig.necks[key];
}

/**
 * Set a neck chain to segment angles `want` (from up toward forward, in the body's plane), with
 * yaws `yaw` per bone; the head (the chain's last name) keeps the pitch `headPitch` from its rest,
 * whatever the neck above it does. Each bone's local pitch is the change in its segment's angle less
 * what its parents already turned.
 */
function setNeck(rig, neck, want, yaw, headPitch, roll = null) {
    let turned = 0;
    for (let i = 0; i < neck.angles.length; i += 1) {
        const change = want[i] - neck.angles[i];
        setLocal(rig, neck.names[i], change - turned, yaw[i] ?? 0, roll ? roll[i] : 0);
        turned = change;
    }
    setLocal(
        rig,
        neck.names[neck.names.length - 1],
        headPitch - turned,
        yaw[neck.angles.length] ?? 0,
        roll ? roll[neck.angles.length] : 0,
    );
}

/** Mix arrays: a + (b - a) w, into `out`. */
const mixInto = (out, a, b, w) => {
    for (let i = 0; i < a.length; i += 1) out[i] = a[i] + ((b[i] - a[i]) * w);
    return out;
};

/**
 * Move a neck chain's end by (df, du) in the body's plane (life units) with the least change to its
 * angles: a few Jacobian-transpose steps on the segment angles (each pulls the end round its joint).
 */
function reachBy(neck, want, df, du) {
    const n = want.length;
    const pos = new Array(n + 1);
    const fk = () => {
        let y = 0;
        let z = 0;
        pos[0] = [0, 0];
        for (let i = 0; i < n; i += 1) {
            y += Math.cos(want[i]) * neck.lengths[i];
            z += Math.sin(want[i]) * neck.lengths[i];
            pos[i + 1] = [y, z];
        }
        return pos[n];
    };
    const start = fk().slice();
    const goal = [start[0] + du, start[1] + df];
    for (let it = 0; it < 30; it += 1) {
        let moved = 0;
        for (let j = 0; j < n; j += 1) {
            // Turning segment j and all after it by d moves the end by d * (-rz, ry), r from joint j.
            const end = fk();
            const ey = goal[0] - end[0];
            const ez = goal[1] - end[1];
            const ry = end[0] - pos[j][0];
            const rz = end[1] - pos[j][1];
            const g = ((-rz * ey) + (ry * ez)) / Math.max(1e-6, (ry * ry) + (rz * rz));
            const d = Math.max(-0.1, Math.min(0.1, g * 0.5));
            for (let m = j; m < n; m += 1) want[m] += d;
            moved += Math.abs(d);
        }
        if (moved < 1e-5) break;
    }
    return want;
}

/** The swans' neck poses: segment angles (from up toward forward) for its five segments. */
const SWAN_NECK_POSE = Object.freeze({
    // Feeding: the neck straightened forward and down, the head under the water.
    dip: Object.freeze([1.35, 1.6, 1.85, 2.05, 2.2]),
    // Stretching up for a wing stretch: the S opened toward upright.
    stretch: Object.freeze([0.25, -0.15, -0.35, 0.2, 0.75]),
    // Preening: the neck arched back over the body, the head down at the back of the wing.
    preen: Object.freeze([0.2, -0.45, -1.15, -1.75, -2.25]),
});
const SWAN_NECK = Object.freeze(['neck0', 'neck1', 'neck2', 'neck3', 'neck4', 'head']);

/**
 * Pose swan `i` at board time `time` into `table` (at `offset`). The water is at `waterY`.
 * @returns {object} the swan's state (for the wakes and tests)
 */
export function poseSwan(rig, i, time, waterY = ODYSSEY_TARN.waterY, table = null, offset = 0, state = {}) {
    const S = ODYSSEY_POND.swans;
    const k = ODYSSEY_POND.scale;
    const s = swanStateAt(i, time, state);
    const neck = neckRest(rig, SWAN_NECK);
    const want = rig.want || (rig.want = new Array(neck.angles.length).fill(0));
    const yaw = rig.yaw || (rig.yaw = new Array(SWAN_NECK.length).fill(0));
    // The rest S, breathing: a slow sway that travels down the neck (each segment a little later).
    // Against each paddle stroke's surge the neck gives a little at its base and the head rides
    // steady (the S flexes, the head does not bob with the body).
    const surge = paddleShape(s.paddle);
    for (let j = 0; j < want.length; j += 1) {
        want[j] = neck.angles[j] + (Math.sin((time * 0.42) + (i * 2.3) - (j * 0.55)) * 0.03)
            - (surge * 0.012 * (j === 0 ? 1 : -0.5));
    }
    // A dip feeds forward and down; a stretch opens the S toward upright.
    mixInto(want, want, SWAN_NECK_POSE.dip, s.dip);
    mixInto(want, want, SWAN_NECK_POSE.stretch, s.stretch * 0.85);
    // A look turns the upper neck and head; a preen swings the whole neck back over the wing, its
    // head low over the back (the yaws add down the chain to ~2.7 rad).
    // A preen arches the neck back over the body and bends it to one side, so the bill reaches
    // the wing on that side (a yaw of the upright neck only twisted it about its own length).
    mixInto(want, want, SWAN_NECK_POSE.preen, s.preen);
    const roll = rig.roll || (rig.roll = new Array(SWAN_NECK.length).fill(0));
    const bend = [0.1, 0.18, 0.24, 0.24, 0.18, 0.08];
    const lookW = [0.04, 0.08, 0.14, 0.2, 0.24, 0.3];
    for (let j = 0; j < yaw.length; j += 1) {
        // Into a bend the head leads: the upper neck turns toward where the route goes next.
        yaw[j] = (s.look * lookW[j]) + (s.leadYaw * lookW[j] * 1.4) + (Math.sin((time * 0.31) + (i * 1.7) + j) * 0.012);
        roll[j] = -s.side * s.preen * bend[j];
    }
    // Preening, the bill works through the feathers: small quick nibbles, eased in and out, the head
    // turned in toward the wing.
    const nibble = s.preen * ((Math.sin(time * 12.0) * 0.5) + (Math.sin((time * 7.0) + 1.3) * 0.5)) * 0.06;
    yaw[yaw.length - 1] += nibble + (s.side * s.preen * 0.5);
    const headPitch = (s.dip * 0.75) + (s.preen * 0.45) - (s.stretch * 0.25) + (Math.sin((time * 0.7) + i) * 0.03)
        + (nibble * 0.8);
    setNeck(rig, neck, want, yaw, headPitch, roll);
    // The wings: raised over the back at rest, breathing a little; a stretch lifts them high over
    // the back and opens them outward, beating twice before they fold back.
    const flap = s.stretch > 0 ? Math.max(0, Math.sin(s.stretchT * TAU * 0.75)) : 0;
    const raise = (s.stretch * (0.45 + (0.3 * flap))) + (Math.sin((time * 0.3) + i) * 0.02);
    const open = s.stretch * (0.15 + (0.35 * flap));
    setLocal(rig, 'wingL', raise, 0, -open);
    setLocal(rig, 'wingR', raise, 0, open);
    setLocal(rig, 'root', 0, 0, 0);
    // The body: the paddle strokes bob it and rock it a little (one foot, then the other), it leans
    // into a turn, tips forward to feed and sits back to stretch.
    const bob = Math.sin(s.paddle) * 0.012 * k;
    const lean = Math.max(-0.1, Math.min(0.1, -s.turn * 0.45));
    poseBird(rig, {
        x: s.x,
        y: waterY - S.draft + bob,
        z: s.z,
        heading: s.heading,
        pitch: (Math.sin(s.paddle + 0.6) * 0.012) + (s.dip * 0.14) - (s.stretch * 0.22),
        roll: (Math.sin(s.paddle * 0.5) * 0.012) + lean,
    }, k, table, offset);
    return s;
}

/** The two-segment reach of a leg in its own plane: hip to heel `a`, heel to foot `b`, the target
 * (forward, up) from the hip; the heel bends backward. Returns the two segments' angles from
 * straight down (positive = the segment points forward). */
export function legReach(a, b, fwd, up) {
    const far = Math.max(1e-6, Math.hypot(fwd, up));
    // Near full stretch the reach eases off instead of stopping dead (a hard limit kinked the knee
    // into a jolt when a trailing foot pulled the leg straight).
    const R = a + b;
    const knee = 0.93 * R;
    const d = far <= knee ? far : knee + ((0.995 * R - knee) * Math.tanh((far - knee) / (0.995 * R - knee)));
    const toward = Math.atan2(fwd, -up);
    const cosA = Math.max(-1, Math.min(1, ((a * a) + (d * d) - (b * b)) / (2 * a * d)));
    // The heel behind the line from hip to foot (a heron's "knee" bends back).
    const upper = toward - Math.acos(cosA);
    const hf = a * Math.sin(upper);
    const hu = -a * Math.cos(upper);
    const sc = d / far;
    const lower = Math.atan2((fwd * sc) - hf, -((up * sc) - hu));
    return { upper, lower };
}

/** The heron's neck poses: segment angles for its four segments. */
const HERON_NECK_POSE = Object.freeze({
    // Stalking: the neck reaching forward and low in an open S, the head level.
    stalk: Object.freeze([1.05, 0.25, 0.85, 1.2]),
    // Coiled for the strike: the S drawn tight and low, the head pulled back over the shoulders.
    coil: Object.freeze([0.55, -1.35, -0.1, 1.3]),
    // The shot: the neck thrown straight out, forward and down at the water.
    shoot: Object.freeze([1.45, 1.6, 1.7, 1.78]),
    // In flight: drawn back into a tight S, the head just ahead of the shoulders (with the body
    // levelled out, so these lean back by its flight pitch).
    flight: Object.freeze([1.3, -0.4, -1.2, 0.8]),
});
/** The wings' axes in the body's rest frame: the chord's forward (the body's axis) and up out of the wing. */
const WING_ALONG = Object.freeze([0, 0.5708, 0.8211]);
const WING_UP = Object.freeze([0, 0.8211, -0.5708]);
/** A turn of `angle` about a unit `axis`, as a quaternion (into `out`). */
const qaxis = (axis, angle, out) => {
    const h = Math.sin(angle / 2);
    out[0] = axis[0] * h;
    out[1] = axis[1] * h;
    out[2] = axis[2] * h;
    out[3] = Math.cos(angle / 2);
    return out;
};
const WING_A = [0, 0, 0, 1];
const WING_B = [0, 0, 0, 1];
/** A wing bone's local turn: swept by `sweep` about the wing's up, after a stroke of `stroke` about its chord. */
function wingTurn(rig, name, sweep, stroke) {
    const i = rig.index[name];
    rig.localQ = rig.localQ || rig.skeleton.map(() => null);
    const q = rig.localQ[i] || (rig.localQ[i] = [0, 0, 0, 1]);
    qmul(qaxis(WING_UP, sweep, WING_A), qaxis(WING_ALONG, stroke, WING_B), q);
}
/**
 * The legs trailing in flight (body frame, rad from straight down toward forward): thigh and shin
 * straight out behind along the body's axis, drooping a little, the toes in line with them.
 */
const LEG_TRAIL = Object.freeze({ upper: -0.9, lower: -0.85, toes: -0.85 });
const HERON_NECK = Object.freeze(['neck0', 'neck1', 'neck2', 'neck3', 'head']);

/**
 * Pose the heron at board time `time` into `table` (at `offset`). `heightAt` is the drawn ground
 * (its feet stand on the tarn's bottom in the shallows).
 * @returns {object} the heron's state (feet included)
 */
export function poseHeron(rig, time, heightAt, table = null, offset = 0, state = { feet: [{}, {}] }) {
    const k = ODYSSEY_POND.heron.scale;
    const s = heronStateAt(time, state);
    const { skeleton, index } = rig;
    const head = (name) => skeleton[index[name]].head;
    // The body over its feet: the mean of the ground under them, breathing, lower while it stalks
    // and leaning into a stalk and a strike.
    s.feet.forEach((f) => { f.ground = heightAt(f.x, f.z); });
    let ground = (s.feet[0].ground + s.feet[1].ground) / 2;
    if (s.flying) {
        // In flight: from the ground it left to the ground it lands on, as it goes.
        const g0 = (heightAt(s.from[0][0], s.from[0][1]) + heightAt(s.from[1][0], s.from[1][1])) / 2;
        const g1 = (heightAt(s.to[0][0], s.to[0][1]) + heightAt(s.to[1][0], s.to[1][1])) / 2;
        ground = g0 + ((g1 - g0) * s.along);
    }
    const breath = Math.sin(time * 1.35) * 0.004 * (1 - s.flying);
    const crouch = (s.stalk * 0.05) + (s.coil * 0.03) + (s.shoot * 0.06) + breath + s.flyCrouch;
    const pitch = (s.stalk * 0.2) + (s.coil * 0.05) + (s.shoot * 0.2) + (breath * 1.5) + s.flyPitch;
    const y = ground - (crouch * k) + (s.height * k);
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    // Legs: each foot's target in the body's frame (forward, up) from its hip.
    ['L', 'R'].forEach((tag, side) => {
        const f = s.feet[side];
        const relX = f.x - s.x;
        const relZ = f.z - s.z;
        const hip = head(`thigh${tag}`);
        const heel = head(`shin${tag}`);
        const foot = head(`foot${tag}`);
        // The ankle's target at life size: over the foot's ground by the ankle's own height.
        const tf = ((relX * fx) + (relZ * fz)) / k;
        const tu = (((f.ground + f.lift) - y) / k) + foot[1];
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const bf = (cp * tf) - (sp * tu);
        const bu = (cp * tu) + (sp * tf);
        const a = Math.hypot(heel[1] - hip[1], heel[2] - hip[2]);
        const b = Math.hypot(foot[1] - heel[1], foot[2] - heel[2]);
        // Sideways: how far the foot stands out from under its hip (the body's +x is its left).
        // The whole leg swings out toward it about the hip (a roll), so a planted foot stays put
        // while the body turns over it in a stepped turn.
        const lat = (((relX * Math.cos(s.heading)) - (relZ * Math.sin(s.heading))) / k) - hip[0];
        const down = bu - hip[1];
        const roll = Math.atan2(lat, -down);
        const reach = legReach(a, b, bf - hip[2], -Math.hypot(down, lat));
        const restUpper = Math.atan2(heel[2] - hip[2], -(heel[1] - hip[1]));
        const restLower = Math.atan2(foot[2] - heel[2], -(foot[1] - heel[1]));
        // Reaching for the ground (the foot kept level: the leg's and the body's turn undone), or
        // in flight trailing behind (`legs`), mixed.
        const m = s.legs;
        const mix = (a0, a1) => a0 + ((a1 - a0) * m);
        const thigh = mix(restUpper - reach.upper, restUpper - LEG_TRAIL.upper);
        const shin = mix((restLower - reach.lower) - (restUpper - reach.upper), (restLower - LEG_TRAIL.lower) - (restUpper - LEG_TRAIL.upper));
        const toes = mix(-(restLower - reach.lower) - pitch, ((Math.PI / 2) - LEG_TRAIL.toes) - (restLower - LEG_TRAIL.lower));
        setLocal(rig, `thigh${tag}`, thigh, 0, roll * (1 - m));
        setLocal(rig, `shin${tag}`, shin, 0, 0);
        setLocal(rig, `foot${tag}`, toes, 0, -roll * (1 - m));
    });
    // The neck: the rest S, a stalk's forward reach, a strike's coil and shot.
    const neck = neckRest(rig, HERON_NECK);
    const want = rig.want || (rig.want = new Array(neck.angles.length).fill(0));
    const yaw = rig.yaw || (rig.yaw = new Array(HERON_NECK.length).fill(0));
    for (let j = 0; j < want.length; j += 1) want[j] = neck.angles[j];
    mixInto(want, want, HERON_NECK_POSE.stalk, s.stalk);
    mixInto(want, want, HERON_NECK_POSE.coil, s.coil);
    mixInto(want, want, HERON_NECK_POSE.shoot, s.shoot);
    mixInto(want, want, HERON_NECK_POSE.flight, s.flyNeck);
    // While it steps, the head is held still: the neck folds back by as much as the body has moved.
    if (s.headLag > 0) {
        const cp = Math.cos(pitch);
        reachBy(neck, want, -(s.headLag / k) * cp, -(s.headLag / k) * Math.sin(pitch));
    }
    // The head: small turns at rest (and a shake: a few quick, dying turns); level while it stalks,
    // the bill down in the shot.
    const shake = s.shake > 0 ? Math.sin(s.shakeT * TAU * 4) * 0.32 * s.shake : 0;
    for (let j = 0; j < yaw.length; j += 1) {
        yaw[j] = (s.look * [0.05, 0.1, 0.15, 0.25, 0.45][j]) + (shake * [0.05, 0.1, 0.2, 0.3, 0.6][j]);
    }
    // Swallowing: the head tips up (the bill raised) and the neck gulps twice.
    for (let j = 1; j < want.length; j += 1) want[j] -= s.gulp * 0.12 * (j % 2 === 0 ? 1 : -1);
    const headPitch = s.nod + (s.shoot * 0.85) + (s.coil * 0.15) - (pitch * (1 - s.shoot)) - (s.swallow * 0.75);
    setNeck(rig, neck, want, yaw, headPitch);
    // The catch: a small fish in the bill, there only while it is held (0 = gone).
    if (rig.index.fish != null) {
        rig.size = rig.size || new Array(rig.skeleton.length).fill(1);
        rig.size[rig.index.fish] = Math.max(0, Math.min(1, s.fish));
        if (rig.index.wingL != null) {
            // The open wings: drawn only in flight (0 = folded away into the body), unfolding as
            // they grow: the arm swung back along the body, the hand folded forward under it.
            rig.size[rig.index.wingL] = s.spread;
            rig.size[rig.index.wingR] = s.spread;
            const fold = 1 - s.spread;
            // The hand follows the arm's stroke a moment late, and flexes back on the upstroke.
            const lag = (s.wingLag - s.wing) * 0.45;
            const flex = Math.max(0, Math.min(0.45, (s.wing - s.wingLag) * 0.6));
            const arm = (fold * 1.25) - s.sweep;
            const hand = flex - (fold * 2.4);
            wingTurn(rig, 'wingL', arm, s.wing);
            wingTurn(rig, 'handL', hand, lag);
            wingTurn(rig, 'wingR', -arm, -s.wing);
            wingTurn(rig, 'handR', -hand, -lag);
        }
        setLocal(rig, 'fish', Math.sin(time * 9.0) * 0.25 * s.fish, 0, 0);
    }
    setLocal(rig, 'root', 0, 0, shake * 0.04);
    poseBird(rig, {
        x: s.x, y, z: s.z, heading: s.heading, pitch, roll: s.bank,
    }, k, table, offset);
    s.y = y;
    return s;
}
