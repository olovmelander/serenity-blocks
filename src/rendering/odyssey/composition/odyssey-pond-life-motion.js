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
        /** Seconds it stands at a spot (min, max), its walking speed (u/s) and step cycle (s). */
        stand: Object.freeze([38, 70]),
        speed: 0.28,
        cycle: 2.6,
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

/** Distance glided by board time `t`: a steady speed that breathes slowly (closed form). */
function glided(t) {
    const S = ODYSSEY_POND.swans;
    const w = TAU / S.breath;
    return S.speed * (t - ((S.breathe / w) * Math.cos(w * t)));
}

/** A swan's events on its own loop: look round, dip to feed, preen. Built once a swan. */
function buildSwanEvents(seed) {
    const rand = seeded(seed);
    const { loop } = ODYSSEY_POND.swans;
    const events = [];
    let t = 6 + (rand() * 10);
    while (t < loop - 14) {
        const r = rand();
        let kind = 'preen';
        if (r < 0.45) kind = 'look';
        else if (r < 0.78) kind = 'dip';
        const span = { look: [5, 4], dip: [6, 4], preen: [7, 5] }[kind];
        const dur = span[0] + (rand() * span[1]);
        events.push({
            kind, t0: t, dur, side: rand() < 0.5 ? -1 : 1, amount: 0.6 + (rand() * 0.4),
        });
        t += dur + 8 + (rand() * 16);
    }
    return events;
}
const SWAN_EVENTS = [buildSwanEvents(41), buildSwanEvents(77)];

/**
 * Swan `i` (0 the lead, 1 its mate) at board time `time`: where it floats, the way it faces, how
 * fast, and its neck's channels (`look` yaw, `dip`, `preen` 0..1 and their side).
 */
export function swanStateAt(i, time, out = {}) {
    const S = ODYSSEY_POND.swans;
    const route = swanRoute();
    const t = time - (i * S.lag);
    const at = routeAt(route, glided(t), {
        x: 0, z: 0, tx: 0, tz: 1,
    });
    const side = i === 0 ? 0 : S.side;
    // The mate swims a little to the lead's left (its tangent turned a quarter to the left).
    out.x = at.x + (-at.tz * side);
    out.z = at.z + (at.tx * side);
    out.heading = Math.atan2(at.tx, at.tz);
    const w = TAU / S.breath;
    out.speed = S.speed * (1 + (S.breathe * Math.sin(w * t)));
    out.vx = at.tx * out.speed;
    out.vz = at.tz * out.speed;
    const local = ((time % S.loop) + S.loop) % S.loop;
    out.look = 0;
    out.dip = 0;
    out.preen = 0;
    out.side = 1;
    for (const e of SWAN_EVENTS[i % SWAN_EVENTS.length]) {
        const u = local - e.t0;
        if (u < 0 || u > e.dur) continue;
        const env = s5(u / 1.6) * s5((e.dur - u) / 1.6);
        if (e.kind === 'look') out.look = e.side * e.amount * 0.7 * env * Math.sin(Math.min(1, u / e.dur) * Math.PI);
        else if (e.kind === 'dip') out.dip = env * e.amount;
        else out.preen = env;
        out.side = e.side;
    }
    out.time = time;
    return out;
}

// ── THE HERON'S LIFE ─────────────────────────────────────────────────────────────────
/**
 * The heron's schedule over one loop: stand at a spot (with its stalks and strikes), walk to the
 * next. Walks are straight lines along the shallows, a whole number of step cycles long.
 */
function buildHeronSchedule() {
    const H = ODYSSEY_POND.heron;
    const rand = seeded(H.seed);
    const segs = [];
    let t = 0;
    const n = H.spots.length;
    for (let i = 0; i < n; i += 1) {
        const from = H.spots[i];
        const to = H.spots[(i + 1) % n];
        const stand = H.stand[0] + (rand() * (H.stand[1] - H.stand[0]));
        // Its acts while it stands: stalks (a slow lean forward) and strikes, never in the first or
        // last few seconds (so it is settled before and after a walk).
        const acts = [];
        let a = 5 + (rand() * 6);
        while (a < stand - 10) {
            const strike = rand() < 0.45;
            acts.push({ kind: strike ? 'strike' : 'stalk', t0: a, dur: strike ? 3.2 : 8 + (rand() * 6) });
            a += acts[acts.length - 1].dur + 6 + (rand() * 10);
        }
        segs.push({
            kind: 'stand', t0: t, dur: stand, x: from[0], z: from[1], acts, look: rand() * TAU,
        });
        t += stand;
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const cycles = Math.max(2, Math.round(dist / (H.speed * H.cycle)));
        segs.push({
            kind: 'walk', t0: t, dur: cycles * H.cycle, from, to, dist, cycles,
        });
        t += cycles * H.cycle;
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

/**
 * The heron at board time `time`: its body (x, z, heading), its feet (world x, z, each planted or
 * swinging with its lift), and its neck's channels (`stalk` and `strike` 0..1, a slow `look`).
 */
export function heronStateAt(time, out = { feet: [{}, {}] }) {
    const H = ODYSSEY_POND.heron;
    const k = ODYSSEY_POND.scale;
    const t = ((time % HERON.loop) + HERON.loop) % HERON.loop;
    let seg = HERON.segs[0];
    for (const s of HERON.segs) if (s.t0 <= t) seg = s;
    const u = t - seg.t0;
    const half = 0.045 * k;
    out.stalk = 0;
    out.strike = 0;
    out.walking = 0;
    if (seg.kind === 'stand') {
        out.x = seg.x;
        out.z = seg.z;
        out.heading = heronFacing(seg);
        // A slow look about, as a standing heron turns its head.
        out.look = 0.35 * Math.sin((u * 0.11) + seg.look) * Math.sin((u * 0.047) + 1.3);
        for (const a of seg.acts) {
            const v = u - a.t0;
            if (v < 0 || v > a.dur) continue;
            if (a.kind === 'stalk') out.stalk = s5(v / 2.5) * s5((a.dur - v) / 2.5);
            else {
                // The strike: a crouch (1 s), the shot (0.18 s), held under (0.5 s), back (1.5 s).
                out.stalk = s5(v / 0.8) * s5((a.dur - v) / 1.0) * 0.8;
                if (v < 1.0) out.strike = 0;
                else if (v < 1.18) out.strike = s5((v - 1.0) / 0.18);
                else if (v < 1.7) out.strike = 1;
                else out.strike = s5(1 - ((v - 1.7) / 1.5));
            }
        }
        const fx = Math.sin(out.heading);
        const fz = Math.cos(out.heading);
        out.feet.forEach((f, side) => {
            const s = side === 0 ? 1 : -1;
            // Left foot (+x of the bird) is to the left of its heading.
            f.x = out.x + (fz * half * s);
            f.z = out.z - (fx * half * s);
            f.lift = 0;
            f.planted = true;
        });
        return out;
    }
    // A walk: the body glides at a steady pace (eased at both ends), turning from the way it stood
    // to the way it walks over the first cycle; the feet alternate.
    const D = seg.dist;
    const S = D / seg.cycles;
    const dx = (seg.to[0] - seg.from[0]) / D;
    const dz = (seg.to[1] - seg.from[1]) / D;
    const walkHeading = Math.atan2(dx, dz);
    const standHeading = heronFacing(HERON.segs[HERON.segs.indexOf(seg) - 1] ?? HERON.segs[HERON.segs.length - 2]);
    out.walking = 1;
    const phase = u / H.cycle;
    const turnBy = Math.atan2(Math.sin(walkHeading - standHeading), Math.cos(walkHeading - standHeading));
    out.heading = standHeading + (turnBy * s5(phase));
    // The body: smooth start and stop over the first and last half cycle.
    const ease = (p) => {
        const n = seg.cycles;
        if (p < 0.5) return S * (p * p);
        if (p > n - 0.5) return D - (S * ((n - p) * (n - p)));
        return S * (p - 0.25);
    };
    const along = ease(phase);
    out.x = seg.from[0] + (dx * along);
    out.z = seg.from[1] + (dz * along);
    out.look = 0;
    // Each foot's n-th stance point in the world: before the first step, where it stood (the way it
    // stood); then where the body will be at the middle of that stance (left swings over [0, 0.5) of
    // a cycle, right over [0.5, 1)); the last step lands beside the other at the end.
    const sx = Math.sin(standHeading);
    const sz = Math.cos(standHeading);
    const stancePoint = (side, n, pt) => {
        const s = side === 0 ? 1 : -1;
        if (n < 0) {
            pt[0] = seg.from[0] + (sz * half * s);
            pt[1] = seg.from[1] - (sx * half * s);
            return pt;
        }
        const pos = n >= seg.cycles - 1 ? D : Math.max(0, Math.min(D, ease(side === 0 ? n + 0.75 : n + 0.25)));
        pt[0] = seg.from[0] + (dx * pos) + (dz * half * s);
        pt[1] = seg.from[1] + (dz * pos) - (dx * half * s);
        return pt;
    };
    const a = [0, 0];
    const b = [0, 0];
    out.feet.forEach((f, side) => {
        const c = Math.floor(phase);
        const p = phase - c;
        const swingFrom = side === 0 ? 0 : 0.5;
        const inSwing = p >= swingFrom && p < swingFrom + 0.5;
        let lift = 0;
        if (inSwing) {
            stancePoint(side, c - 1, a);
            stancePoint(side, c, b);
            const w = s5((p - swingFrom) / 0.5);
            f.x = a[0] + ((b[0] - a[0]) * w);
            f.z = a[1] + ((b[1] - a[1]) * w);
            lift = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6 ? Math.sin(Math.PI * clamp01((p - swingFrom) / 0.5)) : 0;
        } else {
            stancePoint(side, p < swingFrom ? c - 1 : c, a);
            [f.x, f.z] = a;
        }
        f.lift = lift * H.lift * k;
        f.planted = !inSwing || lift === 0;
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
 * Pose swan `i` at board time `time` into `table` (at `offset`). The water is at `waterY`.
 * @returns {object} the swan's state (for the wakes and tests)
 */
export function poseSwan(rig, i, time, waterY = ODYSSEY_TARN.waterY, table = null, offset = 0, state = {}) {
    const S = ODYSSEY_POND.swans;
    const k = ODYSSEY_POND.scale;
    const s = swanStateAt(i, time, state);
    const sway = Math.sin((time * 0.37) + (i * 2.1)) * 0.06;
    const nod = Math.sin((time * 0.61) + (i * 1.3)) * 0.04;
    // The neck's channels: a look turns it down its length (more toward the head); a dip bends it
    // forward and down until the head is under; a preen turns it back over the wing.
    const { look } = s;
    const { dip } = s;
    const preen = s.preen * s.side;
    setLocal(rig, 'root', 0, 0, 0);
    setLocal(rig, 'neck0', (dip * 1.05) + (Math.abs(preen) * 0.15), (look * 0.15) + (preen * 0.55) + sway, 0);
    setLocal(rig, 'neck1', (dip * 0.55) - (Math.abs(preen) * 0.1), (look * 0.25) + (preen * 0.6) + sway, 0);
    setLocal(rig, 'neck2', (dip * 0.35) + nod - (Math.abs(preen) * 0.1), (look * 0.3) + (preen * 0.5), 0);
    setLocal(rig, 'neck3', (dip * 0.2) + nod, (look * 0.3) + (preen * 0.35), 0);
    setLocal(rig, 'head', (dip * 0.5) + (Math.abs(preen) * 0.7) - nod, (look * 0.35) + (preen * 0.3), 0);
    poseBird(rig, {
        x: s.x,
        y: waterY - S.draft,
        z: s.z,
        heading: s.heading,
        pitch: (Math.sin((time * 1.1) + i) * 0.02) + (dip * 0.06),
        roll: Math.sin((time * 0.83) + (i * 2)) * 0.02,
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
    // The body over its feet: the mean of the ground under them, the hips at their rest height
    // (a little lower while it stalks), its pitch forward with the stalk.
    s.feet.forEach((f) => { f.ground = heightAt(f.x, f.z); });
    const ground = (s.feet[0].ground + s.feet[1].ground) / 2;
    const crouch = (s.stalk * 0.06) + (s.walking * 0.03);
    const pitch = (s.stalk * 0.22) + (s.strike * 0.18);
    // The body's origin (its feet's plane) sits on the ground; the crouch lowers it.
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
        // The ankle's target (forward, up) from the body's origin at life size: over the foot's
        // ground by the ankle's own height, plus the swing's lift.
        const tf = ((relX * fx) + (relZ * fz)) / k;
        const tu = (((f.ground + f.lift) - y) / k) + foot[1];
        // Into the body's pitched frame, then from the hip.
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const bf = (cp * tf) - (sp * tu);
        const bu = (cp * tu) + (sp * tf);
        const a = Math.hypot(heel[1] - hip[1], heel[2] - hip[2]);
        const b = Math.hypot(foot[1] - heel[1], foot[2] - heel[2]);
        const reach = legReach(a, b, bf - hip[2], bu - hip[1]);
        const restUpper = Math.atan2(heel[2] - hip[2], -(heel[1] - hip[1]));
        const restLower = Math.atan2(foot[2] - heel[2], -(foot[1] - heel[1]));
        // A bone's pitch about x turns its "down" toward forward by -angle (Rx maps -y to +z for a
        // negative angle), so the local angle is the rest angle minus the wanted one.
        setLocal(rig, `thigh${tag}`, restUpper - reach.upper, 0, 0);
        setLocal(rig, `shin${tag}`, (restLower - reach.lower) - (restUpper - reach.upper), 0, 0);
        // The foot kept level: undo the leg's and the body's turn.
        setLocal(rig, `foot${tag}`, -(restLower - reach.lower) - pitch, 0, 0);
    });
    // The neck: its resting S; a stalk reaches it forward and low; a strike shoots it out and down.
    const st = s.stalk;
    const sk = s.strike;
    setLocal(rig, 'root', 0, 0, 0);
    setLocal(rig, 'neck0', (st * 0.35) + (sk * 0.55), s.look * 0.25, 0);
    setLocal(rig, 'neck1', (st * -0.25) + (sk * -0.6), s.look * 0.3, 0);
    setLocal(rig, 'neck2', (st * 0.3) + (sk * 0.6), s.look * 0.3, 0);
    setLocal(rig, 'head', (st * 0.25) + (sk * 0.55), s.look * 0.35, 0);
    poseBird(rig, {
        x: s.x, y, z: s.z, heading: s.heading, pitch, roll: 0,
    }, k, table, offset);
    s.y = y;
    return s;
}
