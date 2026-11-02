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
 * SIZE. Drawn at three times life, like the act's other life: a swan is ~25 px long at 1440p, the
 * heron ~15 px tall.
 *
 * Everything is a function of the board clock (world-anchored; the camera only passes them):
 *  - THE SWANS glide round one closed route through the deep water, the second a few seconds behind
 *    the first and a little to its side, at a speed that slowly breathes. Each carries its neck in an
 *    S that sways; now and then it looks round, dips its head under to feed, or turns its neck back
 *    to preen. Their wakes are drawn by the tarn's own water (`setTarnSwans` on the world).
 *  - THE HERON stands in the shallows, mostly still, as herons do; it leans into a slow stalk, and
 *    now and then strikes (the neck shoots down and comes back). Every so often it walks a few slow
 *    steps along the shallows to its next spot: each foot is planted where it lands and stays there
 *    while the body passes over it (a two-segment leg solve reaches it), so nothing slides.
 *
 * OUTPUT. `poseBird` writes, per bone, its world rotation (a quaternion) and where its rest frame
 * lands (`at - k * q * rest`, with `k` the drawn size): the table odyssey-pond-life.js uploads. The
 * deer's table, the same layout.
 */
import { ODYSSEY_TARN } from '../world/odyssey-world-height.js';
import { ODYSSEY_DEER } from './odyssey-deer-herd.js';

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
        /** The second swan: seconds behind the first along the route, and units to its left. */
        lag: 8.5,
        side: 2.6,
        /** How far the hull sits under the water (drawn units): the model is cut at its waterline. */
        draft: 0.2,
        /** Each swan's events repeat after this many seconds. */
        loop: 150,
    }),
    heron: Object.freeze({
        /** Its spots in the west lobe's shallows (world x, z), walked between in turn. */
        spots: Object.freeze([[-338.6, -432.4], [-333.0, -427.6], [-327.0, -425.2]]),
        /** Seconds it stands at a spot (min, max); how far the body moves a step (m at life size),
         * how long a step takes (s) and the pause after it (min, max s). */
        stand: Object.freeze([38, 70]),
        step: 0.17,
        stepTime: 1.15,
        pause: Object.freeze([0.7, 1.9]),
        /** How high a swinging foot lifts (share of the drawn size). */
        lift: 0.12,
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
            spots: Object.freeze([[-347.4, -439.2], [-367.5, -438.6], [-381.5, -440.2]]),
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
/** The closed route as a dense table: a centripetal Catmull-Rom through the waypoints. */
function buildRoute(points) {
    const n = points.length;
    const out = [];
    const per = 24;
    for (let i = 0; i < n; i += 1) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        for (let s = 0; s < per; s += 1) {
            const t = s / per;
            const t2 = t * t;
            const t3 = t2 * t;
            const c = (a, b, cc, d) => 0.5 * ((2 * b) + ((-a + cc) * t) + (((2 * a) - (5 * b) + (4 * cc) - d) * t2)
                + ((-a + (3 * b) - (3 * cc) + d) * t3));
            out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
        }
    }
    const lengths = new Float64Array(out.length + 1);
    for (let i = 1; i <= out.length; i += 1) {
        const a = out[i - 1];
        const b = out[i % out.length];
        lengths[i] = lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return { points: out, lengths, length: lengths[out.length] };
}

let routeCache = null;
/** The swans' route (built once). */
export function swanRoute() {
    if (!routeCache) routeCache = buildRoute(ODYSSEY_POND.swans.route);
    return routeCache;
}

/** A point on the route at arc length `s` (wrapped), with its unit tangent. */
function routeAt(route, s, out) {
    const L = route.length;
    const u = ((s % L) + L) % L;
    let lo = 0;
    let hi = route.points.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (route.lengths[mid] <= u) lo = mid; else hi = mid - 1;
    }
    const a = route.points[lo];
    const b = route.points[(lo + 1) % route.points.length];
    const seg = Math.max(1e-9, route.lengths[lo + 1] - route.lengths[lo]);
    const f = (u - route.lengths[lo]) / seg;
    const dx = (b[0] - a[0]) / seg;
    const dz = (b[1] - a[1]) / seg;
    out.x = a[0] + ((b[0] - a[0]) * f);
    out.z = a[1] + ((b[1] - a[1]) * f);
    out.tx = dx;
    out.tz = dz;
    return out;
}

/** Each swan's paddle rhythm (strokes a second) and how much a stroke surges it (share of speed). */
const PADDLE = Object.freeze({ rate: Object.freeze([0.92, 1.07]), surge: 0.07 });

/** Distance swan `i` has glided by board time `t`: a steady speed that breathes slowly, surging a
 * little with each paddle stroke (closed form). */
function glided(t, i = 0) {
    const S = ODYSSEY_POND.swans;
    const w = TAU / S.breath;
    const p = TAU * PADDLE.rate[i % 2];
    return S.speed * (t - ((S.breathe / w) * Math.cos(w * t)) + ((PADDLE.surge / p) * Math.sin(p * t)));
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
    const side = i === 0 ? 0 : S.side;
    // The mate swims a little to the lead's left (its tangent turned a quarter to the left).
    out.x = at.x + (-at.tz * side);
    out.z = at.z + (at.tx * side);
    out.heading = Math.atan2(at.tx, at.tz);
    const w = TAU / S.breath;
    const p = TAU * PADDLE.rate[i % 2];
    out.speed = S.speed * (1 + (S.breathe * Math.sin(w * t)) + (PADDLE.surge * Math.cos(p * t)));
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
/**
 * The heron's schedule over one loop: stand at a spot (its stalks, strikes, shakes and small head
 * turns), then stalk to the next, one deliberate step at a time: each step lifts a foot, carries the
 * body over it and sets it down; between steps it stands, a different while each time. The last
 * step brings the trailing foot up beside the other.
 */
function buildHeronSchedule() {
    const H = ODYSSEY_POND.heron;
    const k = ODYSSEY_POND.scale;
    const rand = seeded(H.seed);
    const segs = [];
    let t = 0;
    const n = H.spots.length;
    for (let i = 0; i < n; i += 1) {
        const from = H.spots[i];
        const to = H.spots[(i + 1) % n];
        const stand = H.stand[0] + (rand() * (H.stand[1] - H.stand[0]));
        // Its acts while it stands: stalks (a slow lean, the neck reaching forward and low) and
        // strikes (coil, shoot, hold, recover), some followed by a shake; never in the first or last
        // few seconds, so it is settled before and after a walk.
        const acts = [];
        let a = 4 + (rand() * 6);
        while (a < stand - 12) {
            const strike = rand() < 0.45;
            const dur = strike ? 4.2 + (rand() * 1.2) : 7 + (rand() * 7);
            acts.push({ kind: strike ? 'strike' : 'stalk', t0: a, dur });
            a += dur;
            if (strike && rand() < 0.5) {
                acts.push({ kind: 'shake', t0: a + 0.4, dur: 1.1 });
                a += 1.6;
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
            kind: 'stand', t0: t, dur: stand, x: from[0], z: from[1], acts, looks,
        });
        t += stand;
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const count = Math.max(2, Math.round(dist / (H.step * k)));
        const steps = [];
        let u = 0;
        for (let s = 0; s <= count; s += 1) {
            const dur = H.stepTime * (0.9 + (rand() * 0.25));
            steps.push({ t0: u, dur, closing: s === count });
            u += dur + (s === count ? 0.6 : H.pause[0] + (rand() * (H.pause[1] - H.pause[0])));
        }
        segs.push({
            kind: 'walk', t0: t, dur: u, from, to, dist, count, steps,
        });
        t += u;
    }
    return { segs, loop: t };
}
const HERON = buildHeronSchedule();
export const HERON_LOOP = HERON.loop;

/** Which way the heron faces at a spot: the way it walked in (the walk before it, round the loop). */
function heronFacing(seg) {
    const i = HERON.segs.indexOf(seg);
    const prev = HERON.segs[(i - 1 + HERON.segs.length) % HERON.segs.length];
    return Math.atan2(prev.to[0] - prev.from[0], prev.to[1] - prev.from[1]);
}

/** The stand's head turn at `u`: eased from the last look to the current over 0.35 s. */
function heronLook(seg, u) {
    let i = 0;
    while (i + 1 < seg.looks.length && seg.looks[i + 1].t0 <= u) i += 1;
    const cur = seg.looks[i];
    const prev = seg.looks[Math.max(0, i - 1)];
    const w = s5((u - cur.t0) / 0.35);
    return { yaw: prev.yaw + ((cur.yaw - prev.yaw) * w), pitch: prev.pitch + ((cur.pitch - prev.pitch) * w) };
}

/**
 * The heron at board time `time`: its body (x, z, heading), its feet (world x, z, each planted or
 * swinging with its lift), its posture's channels (`stalk`, the strike's `coil` and `shoot`, `shake`
 * and its clock, the head's `look` and `nod`) and `headLag`, how far (world units, along its heading)
 * the head is held back while the body moves under it.
 */
export function heronStateAt(time, out = { feet: [{}, {}] }) {
    const H = ODYSSEY_POND.heron;
    const k = ODYSSEY_POND.scale;
    const t = ((time % HERON.loop) + HERON.loop) % HERON.loop;
    let seg = HERON.segs[0];
    for (const s of HERON.segs) if (s.t0 <= t) seg = s;
    const u = t - seg.t0;
    const half = 0.04 * k;
    out.stalk = 0;
    out.coil = 0;
    out.shoot = 0;
    out.shake = 0;
    out.shakeT = 0;
    out.walking = 0;
    out.headLag = 0;
    out.look = 0;
    out.nod = 0;
    if (seg.kind === 'stand') {
        out.x = seg.x;
        out.z = seg.z;
        out.heading = heronFacing(seg);
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
                out.shake = envelope(v, a.dur, 0.15, 0.45);
                out.shakeT = v;
            } else {
                // The strike: lean in (1.2 s), coil (0.8 s), the shot (0.2 s, eased so even the
                // fastest move starts and stops), held (0.5 s), back.
                out.stalk = envelope(v, a.dur, 1.2, 1.4);
                out.coil = v < 1.2 ? 0 : s5((v - 1.2) / 0.8) * (1 - s5((v - 2.0) / 0.2));
                const back = a.dur - 2.7;
                if (v >= 2.0 && v < 2.2) out.shoot = s5((v - 2.0) / 0.2);
                else if (v >= 2.2 && v < 2.7) out.shoot = 1;
                else if (v >= 2.7) out.shoot = 1 - s5((v - 2.7) / back);
            }
        }
        if (out.stalk > 0 || out.shoot > 0) out.look *= 1 - Math.max(out.stalk, out.shoot);
        const fx = Math.sin(out.heading);
        const fz = Math.cos(out.heading);
        out.feet.forEach((f, side) => {
            const s = side === 0 ? 1 : -1;
            f.x = out.x + (fz * half * s);
            f.z = out.z - (fx * half * s);
            f.lift = 0;
            f.planted = true;
        });
        return out;
    }
    // A stalk to the next spot, one step at a time, in the stalking posture.
    const D = seg.dist;
    const dx = (seg.to[0] - seg.from[0]) / D;
    const dz = (seg.to[1] - seg.from[1]) / D;
    const walkHeading = Math.atan2(dx, dz);
    const standSeg = HERON.segs[HERON.segs.indexOf(seg) - 1];
    const standHeading = heronFacing(standSeg);
    const turnBy = Math.atan2(Math.sin(walkHeading - standHeading), Math.cos(walkHeading - standHeading));
    out.walking = 1;
    out.stalk = envelope(u, seg.dur, 1.6, 1.6);
    const N = seg.count;
    const delta = D / N;
    // Which step (or the pause after it) this is.
    let j = 0;
    while (j + 1 < seg.steps.length && seg.steps[j + 1].t0 <= u) j += 1;
    const step = seg.steps[j];
    const w = s5((u - step.t0) / step.dur);
    // The body: still between steps, carried one `delta` along over each regular step.
    const bodyAt = (m) => Math.min(D, m * delta);
    const along = step.closing ? D : bodyAt(j) + ((bodyAt(j + 1) - bodyAt(j)) * w);
    out.x = seg.from[0] + (dx * along);
    out.z = seg.from[1] + (dz * along);
    // It turns from the way it stood to the way it walks over the first step.
    out.heading = standHeading + (turnBy * (j === 0 ? w : 1));
    // The head is held where it was while the body moves under it, then glides on in the pause.
    const moved = step.closing ? 0 : (bodyAt(j + 1) - bodyAt(j)) * w;
    const pauseU = u - (step.t0 + step.dur);
    out.headLag = pauseU < 0 ? moved : (bodyAt(j + 1) - bodyAt(j)) * (1 - s5(pauseU / 0.7)) * (step.closing ? 0 : 1);
    // The feet. Step m moves foot m % 2 (left first) to beside the body's end of that step and half a
    // step ahead; the closing step brings the trailing foot up beside the other. Before its first
    // step a foot stands where it stood (the way it stood).
    const sx = Math.sin(standHeading);
    const sz = Math.cos(standHeading);
    const plant = (side, m, pt) => {
        const s = side === 0 ? 1 : -1;
        if (m < 0) {
            pt[0] = seg.from[0] + (sz * half * s);
            pt[1] = seg.from[1] - (sx * half * s);
            return pt;
        }
        const pos = m >= N - 1 ? D : Math.min(D, bodyAt(m + 1) + (delta * 0.5));
        pt[0] = seg.from[0] + (dx * pos) + (dz * half * s);
        pt[1] = seg.from[1] + (dz * pos) - (dx * half * s);
        return pt;
    };
    // The step index of each foot's latest move at or before step j, and whether it is moving now.
    const a = [0, 0];
    const b = [0, 0];
    out.feet.forEach((f, side) => {
        // Foot `side` moves on steps side, side + 2, ... and on the closing step if it trails.
        const trailing = (N % 2) === side; // the foot not moved by step N - 1
        let last = -1;
        for (let m = 0; m <= j; m += 1) {
            const moves = m < N ? m % 2 === side : trailing;
            if (moves) last = m;
        }
        const movingNow = last === j && u < step.t0 + step.dur;
        const prevMove = (() => {
            for (let m = (movingNow ? j : last + 1) - 1; m >= 0; m -= 1) if (m < N ? m % 2 === side : trailing) return m;
            return -1;
        })();
        if (movingNow) {
            plant(side, prevMove, a);
            plant(side, j, b);
            f.x = a[0] + ((b[0] - a[0]) * w);
            f.z = a[1] + ((b[1] - a[1]) * w);
            const lift = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6 ? Math.sin(Math.PI * w) : 0;
            f.lift = lift * H.lift * k;
            f.planted = lift === 0;
        } else {
            plant(side, last, a);
            [f.x, f.z] = a;
            f.lift = 0;
            f.planted = true;
        }
    });
    return out;
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
    skeleton.forEach((bone, i) => {
        const l = local[i];
        qeuler(l[0], l[1], l[2], tmp);
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
            hw[i][0] = hw[p][0] + (v[0] * k);
            hw[i][1] = hw[p][1] + (v[1] * k);
            hw[i][2] = hw[p][2] + (v[2] * k);
        }
        if (table) {
            const o = offset + (i * 8);
            const q = qw[i];
            qrot(q, bone.head, v);
            table[o] = q[0];
            table[o + 1] = q[1];
            table[o + 2] = q[2];
            table[o + 3] = q[3];
            table[o + 4] = hw[i][0] - (v[0] * k);
            table[o + 5] = hw[i][1] - (v[1] * k);
            table[o + 6] = hw[i][2] - (v[2] * k);
            table[o + 7] = k;
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
function setNeck(rig, neck, want, yaw, headPitch) {
    let turned = 0;
    for (let i = 0; i < neck.angles.length; i += 1) {
        const change = want[i] - neck.angles[i];
        setLocal(rig, neck.names[i], change - turned, yaw[i] ?? 0, 0);
        turned = change;
    }
    setLocal(rig, neck.names[neck.names.length - 1], headPitch - turned, yaw[neck.angles.length] ?? 0, 0);
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
    for (let j = 0; j < want.length; j += 1) {
        want[j] = neck.angles[j] + (Math.sin((time * 0.42) + (i * 2.3) - (j * 0.55)) * 0.035);
    }
    // A dip feeds forward and down; a stretch opens the S toward upright.
    mixInto(want, want, SWAN_NECK_POSE.dip, s.dip);
    mixInto(want, want, SWAN_NECK_POSE.stretch, s.stretch * 0.85);
    // A look turns the upper neck and head; a preen swings the whole neck back over the wing, its
    // head low over the back (the yaws add down the chain to ~2.7 rad).
    const pr = s.preen * s.side;
    const lookW = [0.04, 0.08, 0.14, 0.2, 0.24, 0.3];
    const preenW = [0.42, 0.5, 0.55, 0.5, 0.4, 0.3];
    for (let j = 0; j < yaw.length; j += 1) {
        yaw[j] = (s.look * lookW[j]) + (pr * preenW[j]) + (Math.sin((time * 0.31) + (i * 1.7) + j) * 0.012);
    }
    if (s.preen > 0) {
        for (let j = 1; j < want.length; j += 1) want[j] += s.preen * 0.25;
    }
    const headPitch = (s.dip * 0.75) + (s.preen * 0.6) - (s.stretch * 0.25) + (Math.sin((time * 0.7) + i) * 0.03);
    setNeck(rig, neck, want, yaw, headPitch);
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
    const d = Math.min(far, (a + b) * 0.999);
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
    // Coiled for the strike: the S drawn tight, the head pulled back.
    coil: Object.freeze([0.35, -1.25, -0.2, 1.15]),
    // The shot: the neck thrown straight out, forward and down at the water.
    shoot: Object.freeze([1.45, 1.6, 1.7, 1.78]),
});
const HERON_NECK = Object.freeze(['neck0', 'neck1', 'neck2', 'neck3', 'head']);

/**
 * Pose the heron at board time `time` into `table` (at `offset`). `heightAt` is the drawn ground
 * (its feet stand on the tarn's bottom in the shallows).
 * @returns {object} the heron's state (feet included)
 */
export function poseHeron(rig, time, heightAt, table = null, offset = 0, state = { feet: [{}, {}] }) {
    const k = ODYSSEY_POND.scale;
    const s = heronStateAt(time, state);
    const { skeleton, index } = rig;
    const head = (name) => skeleton[index[name]].head;
    // The body over its feet: the mean of the ground under them, breathing, lower while it stalks
    // and leaning into a stalk and a strike.
    s.feet.forEach((f) => { f.ground = heightAt(f.x, f.z); });
    const ground = (s.feet[0].ground + s.feet[1].ground) / 2;
    const breath = Math.sin(time * 1.35) * 0.004;
    const crouch = (s.stalk * 0.05) + (s.coil * 0.03) + (s.shoot * 0.06) + breath;
    const pitch = (s.stalk * 0.2) + (s.coil * 0.05) + (s.shoot * 0.2) + (breath * 1.5);
    const y = ground - (crouch * k);
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
        const reach = legReach(a, b, bf - hip[2], bu - hip[1]);
        const restUpper = Math.atan2(heel[2] - hip[2], -(heel[1] - hip[1]));
        const restLower = Math.atan2(foot[2] - heel[2], -(foot[1] - heel[1]));
        setLocal(rig, `thigh${tag}`, restUpper - reach.upper, 0, 0);
        setLocal(rig, `shin${tag}`, (restLower - reach.lower) - (restUpper - reach.upper), 0, 0);
        // The foot kept level: undo the leg's and the body's turn.
        setLocal(rig, `foot${tag}`, -(restLower - reach.lower) - pitch, 0, 0);
    });
    // The neck: the rest S, a stalk's forward reach, a strike's coil and shot.
    const neck = neckRest(rig, HERON_NECK);
    const want = rig.want || (rig.want = new Array(neck.angles.length).fill(0));
    const yaw = rig.yaw || (rig.yaw = new Array(HERON_NECK.length).fill(0));
    for (let j = 0; j < want.length; j += 1) want[j] = neck.angles[j];
    mixInto(want, want, HERON_NECK_POSE.stalk, s.stalk);
    mixInto(want, want, HERON_NECK_POSE.coil, s.coil);
    mixInto(want, want, HERON_NECK_POSE.shoot, s.shoot);
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
    const headPitch = s.nod + (s.shoot * 0.85) + (s.coil * 0.15) - (pitch * (1 - s.shoot));
    setNeck(rig, neck, want, yaw, headPitch);
    setLocal(rig, 'root', 0, 0, shake * 0.04);
    poseBird(rig, {
        x: s.x, y, z: s.z, heading: s.heading, pitch, roll: 0,
    }, k, table, offset);
    s.y = y;
    return s;
}
