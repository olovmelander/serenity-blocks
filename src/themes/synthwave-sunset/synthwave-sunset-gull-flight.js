/* eslint-disable max-classes-per-file */
/**
 * Synthwave Sunset — how the gulls fly (no shader code: the vertex stage in
 * synthwave-sunset-gulls.js is this module's twin, line for line).
 *
 * Each gull wheels on its own loop in the free sky round the wheel: across the sun's disc low over
 * the sea, high over the wheel's crown, in the strip of sky left of it, in a lazy eight above the
 * coaster; on the richer tiers a mate flies a wing's length out and a beat behind, a far bird
 * crosses the whole sky on a long glide and one skims the surf. A loop is an ellipse (or an eight)
 * laid square to the line of sight, its centre drifting and its size breathing so no lap repeats;
 * the bird climbs as it heads out to sea into the onshore breeze and sinks as it comes back.
 * Everything is a closed function of the gulls' clock, so a seek lands right.
 *
 * Three things move them off their loops, both closed functions of a few uniforms:
 *   - a STARTLE: the fireworks' bangs. An accumulating envelope (the shared Swell's two
 *     exponentials, rebased to the last hit, so the shader evaluates it at any time): the loops
 *     widen, the birds climb and beat hard away from the barge, then settle.
 *   - the ROOST: as the evening runs out each bird in turn (pairs together) breaks off and flies
 *     away, out to sea into the afterglow or off along the coast, and comes back the same way when
 *     the evening turns back toward sunset. A small state machine on the clock decides when.
 *   - the WINGBEAT: long glides in the gull's crank (arms up, hands down), broken by bouts of
 *     flapping, steady beats when climbing, commuting or startled. The cycle is built from the four
 *     flap poses the Blender script wrote into the asset manifest (top, down, bottom, up).
 */

import manifest from './assets/asset-manifest.json';
import { RIG } from './synthwave-sunset-tsl.js';
import { FIREWORKS } from './synthwave-sunset-fireworks.js';

const DEG = Math.PI / 180;

/** The rig the model was built on (scripts/blender/synthwave_gull.py): hinge pivots, poses. */
export const GULL_RIG = Object.freeze(manifest.rig);

/** The model is a real gull (1.4 m span); the theme's are generous so the far ones read. */
export const GULL_SCALE = 1.9;

/** Loop shapes. */
export const GULL_KIND = Object.freeze({ LOOP: 0, EIGHT: 1 });

/** The step (s) either side of now that the heading and the bank are read from. */
export const GULL_DT = 0.12;

/** Wingbeats a second when flapping (a herring gull's ~2.6 Hz) and the startle's boost. */
export const GULL_BEAT = Object.freeze({ hz: 2.6, startleBoost: 0.35 });

/**
 * The startle: an accumulating envelope (attack, release s), what a burst adds at scale 1, where
 * it stops adding, and how far it moves a bird of sensitivity 1 at a reading of 1.
 */
export const GULL_STARTLE = Object.freeze({
    attack: 0.25,
    release: 4.0,
    perBurst: 0.45,
    ceiling: 1.4,
    widen: 0.5,
    climb: 6.0,
    flee: 8.0,
    rush: 0.7,
});

/**
 * The roost: how fast a leaving bird flies (m/s) and climbs, how long its turn out of the loop
 * takes, when it has gone (s after it set off: far out and a few pixels across), how long a
 * returning bird is on its way, and the evening's hysteresis (dusk units) before it turns back.
 */
export const GULL_ROOST = Object.freeze({
    speed: 10,
    climb: 0.5,
    turn: 7,
    gone: 48,
    back: 40,
    hysteresis: 0.03,
});

/**
 * The flights, in tier order (the first three are on every tier). Bearings from the rest eye
 * (deg, 0 = the sun; the free sky beside a game's board runs from about −14° to +20°, the wheel
 * fills −9° to +12° below 24° of elevation), distance and height (m), the loop's radius (m),
 * its extent across the view and in depth (× radius), pace (m/s; the sign is the way round), its
 * shape, how much it climbs into the breeze (m), how far its centre drifts across and in depth
 * (m), where the bird goes to roost (a direction on the sea's plane, x and z) and the evening
 * (dusk) it leaves at (clear of the evening's stops, 0.57 and 1, by more than the hysteresis, or
 * it would wait out a whole stop away). A `mate` row flies its leader's loop a wing's length out
 * and behind, at its pace, its loop breathing with the leader's.
 */
const { LOOP, EIGHT } = GULL_KIND;
/** One row of the table (the columns as the comment above names them). */
const flight = (bearing, distance, height, radius, across, depth, pace, kind, climb, drift, exit, leaves) => ({
    bearing, distance, height, radius, across, depth, pace, kind, climb, drift, exit, leaves,
});
/** A mate: whose loop, how much wider (m), how far behind (rad) and how much higher (m). */
const mate = (lead, radius, lag, height) => ({
    mate: lead, radius, lag, height,
});
const ROWS = [
    // bearing, distance, height, radius, across, depth, pace, shape, climb, drift, exit, leaves
    // 0 — over the sea in front of the sun: across its disc twice a lap, low enough to be mirrored.
    flight(0, 58, 8.5, 13, 1, 0.55, 7.0, LOOP, 1.2, [5, 6], [0.05, -1], 0.8),
    // 1 — high over the wheel's crown, in the violet.
    flight(3, 62, 32, 13, 1, 1, -7.5, LOOP, 1.5, [6, 6], [-0.95, -0.3], 0.66),
    // 2 — the strip of sky left of the wheel: a deep, narrow loop toward the eye and away.
    flight(-12, 46, 12, 9, 0.42, 1, 5.5, LOOP, 1.5, [0.5, 5], [-1, 0.1], 0.62),
    // 3 — a lazy eight in the gap above the coaster, between the wheel and the board.
    flight(15.5, 75, 25, 8, 0.75, 1.2, 6.5, EIGHT, 1.5, [1.5, 6], [-0.2, -1], 0.74),
    // 4 — 1's mate.
    mate(1, 2.5, 0.45, 1.2),
    // 5 — far out, a long glide across the whole sky and back behind it.
    flight(2, 135, 50, 75, 1, 0.35, 9.0, LOOP, 3.0, [10, 12], [-1, -0.2], 0.7),
    // 6 — skimming the surf near the beach, its reflection under it.
    flight(-3, 40, 4.5, 8, 1, 0.6, 6.5, LOOP, 0.6, [3, 3], [0.1, -1], 0.84),
    // 7 — 3's mate.
    mate(3, 1.0, 0.5, 1.0),
    // 8 — a far bird circling in front of the wheel and the sun.
    flight(-6, 150, 20, 18, 1, 1, 8.0, LOOP, 2.0, [8, 8], [-0.9, -0.4], 0.64),
];

const fract = (x) => x - Math.floor(x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (e0, e1, x) => {
    const k = clamp01((x - e0) / (e1 - e0));
    return k * k * (3 - 2 * k);
};

/**
 * One bird's numbers, ready for the vertex stage (and for gullPosition): the loop's centre (x, y,
 * z) and radius, its start phase, angular pace (rad/s), seed and shape; its extents, climb and
 * axis (the bearing: across is square to the line of sight); its drift, drift seed and startle
 * sensitivity; the way it flees the barge (x, z) and the way it roosts (x, z); when it leaves.
 */
function flightOf(i) {
    const own = ROWS[i];
    const isMate = own.mate !== undefined;
    const leadIndex = isMate ? own.mate : i;
    const lead = ROWS[leadIndex];
    // A mate flies its leader's loop (and drift) a little wider and higher, a beat behind.
    const row = isMate ? { ...lead, radius: lead.radius + own.radius, height: lead.height + own.height } : own;
    const seed = fract(i * 0.618);
    const group = fract(leadIndex * 0.618);
    const phase = leadIndex * 2.39 - (isMate ? Math.sign(lead.pace) * own.lag : 0);
    const b = row.bearing * DEG;
    const cx = RIG.x + Math.sin(b) * row.distance;
    const cz = RIG.z - Math.cos(b) * row.distance;
    // A mate keeps its leader's angular pace (a little quicker on its wider loop), so it stays beside.
    const omega = lead.pace / (lead.radius * 0.5 * (lead.across + lead.depth));
    const away = [cx - FIREWORKS.barge.x, cz - FIREWORKS.barge.z];
    const al = Math.hypot(away[0], away[1]) || 1;
    const el = Math.hypot(row.exit[0], row.exit[1]) || 1;
    return Object.freeze({
        centre: [cx, row.height, cz],
        radius: row.radius,
        phase,
        omega,
        seed,
        kind: row.kind,
        across: row.across,
        depth: row.depth,
        climb: row.climb,
        axis: b,
        drift: row.drift,
        group,
        sensitivity: 0.8 + 0.35 * fract(seed * 7.31),
        away: [away[0] / al, away[1] / al],
        exit: [row.exit[0] / el, row.exit[1] / el],
        leaves: row.leaves,
    });
}

/** Every flight, in tier order. */
export const GULL_FLIGHTS = Object.freeze(ROWS.map((_, i) => flightOf(i)));

// ── The startle envelope ────────────────────────────────────────────────────

const STARTLE_R = 1 / GULL_STARTLE.release;
const STARTLE_Q = 1 / GULL_STARTLE.attack;
const STARTLE_GAIN = (() => {
    const peakAt = Math.log(STARTLE_Q / STARTLE_R) / (STARTLE_Q - STARTLE_R);
    return 1 / (Math.exp(-STARTLE_R * peakAt) - Math.exp(-STARTLE_Q * peakAt));
})();
/** The envelope's rates and gain, for the shader. */
export const GULL_STARTLE_RATES = Object.freeze({ r: STARTLE_R, q: STARTLE_Q, gain: STARTLE_GAIN });

/** The startle's reading at `t` from its folded state (slow, fast, t0): the shader's twin. */
export function startleAt(slow, fast, t0, t) {
    const dt = Math.max(t - t0, 0);
    return Math.max(slow * Math.exp(-STARTLE_R * dt) - fast * Math.exp(-STARTLE_Q * dt), 0);
}

/**
 * The gulls' startle: hits ADD to what is still there (a volley builds a scatter, it never
 * restarts it), folded into two exponentials rebased to the last hit, so any time can be read.
 * `rush` is its integral (the extra way round the loop and the extra wingbeats it bought).
 */
export class GullStartle {
    constructor() {
        this.reset();
    }

    reset() {
        this.slow = 0;
        this.fast = 0;
        this.t0 = 0;
        this.rush = 0;
        this.clock = Number.NaN;
    }

    value(t) {
        return startleAt(this.slow, this.fast, this.t0, t);
    }

    /** Add a hit of `amount` at `at` (the gulls' clock). Past the ceiling it adds nothing. */
    hit(amount, at) {
        if (!(amount > 0) || !Number.isFinite(at)) return;
        const when = Math.max(at, this.t0);
        const room = Math.max(0, GULL_STARTLE.ceiling - this.value(when));
        const add = Math.min(amount, room);
        if (!(add > 0)) return;
        const dt = when - this.t0;
        this.slow *= Math.exp(-STARTLE_R * dt);
        this.fast *= Math.exp(-STARTLE_Q * dt);
        this.t0 = when;
        this.slow += add * STARTLE_GAIN;
        this.fast += add * STARTLE_GAIN;
    }

    /** Integrate the rush up to `t` (call once a frame). */
    advance(t) {
        if (Number.isFinite(this.clock) && t > this.clock && t - this.clock < 1) {
            this.rush += 0.5 * (this.value(this.clock) + this.value(t)) * (t - this.clock);
        }
        this.clock = t;
    }
}

// ── The roost ───────────────────────────────────────────────────────────────

/** Far in the past: a bird that has never left nor come back (keeps the shader's sums small). */
export const GULL_NEVER = -1e4;

/**
 * When each bird left for the night and when it set off back (the gulls' clock). A bird leaves
 * once the evening passes its hour and it is home; it sets off back once the evening is
 * `hysteresis` short of that hour again and it has gone. Pairs share an hour, so they go together.
 */
export class GullRoost {
    constructor(count) {
        this.count = count;
        this.leaveAt = new Float64Array(count).fill(GULL_NEVER);
        this.backAt = new Float64Array(count).fill(GULL_NEVER);
        this.version = 0;
    }

    reset() {
        this.leaveAt.fill(GULL_NEVER);
        this.backAt.fill(GULL_NEVER);
        this.version += 1;
    }

    /** One step at `t` with the evening at `dusk`. */
    update(t, dusk) {
        let changed = false;
        for (let i = 0; i < this.count; i += 1) {
            const hour = GULL_FLIGHTS[i].leaves;
            const away = this.leaveAt[i] > this.backAt[i];
            if (!away && dusk > hour && t >= this.backAt[i] + GULL_ROOST.back) {
                this.leaveAt[i] = t;
                changed = true;
            } else if (away && dusk < hour - GULL_ROOST.hysteresis && t >= this.leaveAt[i] + GULL_ROOST.gone) {
                this.backAt[i] = t;
                changed = true;
            }
        }
        if (changed) this.version += 1;
        return changed;
    }

    /**
     * Rebuild the state at `t` from the evening's history (`duskAt(time)` on the gulls' clock):
     * the walk over the last five minutes, so a seek shows a bird where the clock alone put it.
     */
    seek(t, duskAt) {
        this.leaveAt.fill(GULL_NEVER);
        this.backAt.fill(GULL_NEVER);
        const start = t - 300;
        const d0 = duskAt(start);
        for (let i = 0; i < this.count; i += 1) {
            // Already away at the start of the history: it left long ago.
            if (d0 > GULL_FLIGHTS[i].leaves) this.leaveAt[i] = start - GULL_ROOST.gone;
        }
        for (let s = start; s <= t + 1e-6; s += 0.5) this.update(s, duskAt(s));
        this.version += 1;
    }
}

// ── The path (the vertex stage's twin) ──────────────────────────────────────

/**
 * Where bird `f` is at `t` on its loop alone (the startle's reading `S` and its integral `rush`
 * move it off), written into `out` ([x, y, z]).
 */
export function loopPosition(f, t, S = 0, rush = 0, out = [0, 0, 0]) {
    const k = f.sensitivity * S;
    const ang = f.phase + f.omega * (t + GULL_STARTLE.rush * f.sensitivity * rush);
    const R = f.radius * (1 + 0.15 * Math.sin(t * 0.043 + f.group * 11)) * (1 + GULL_STARTLE.widen * k);
    let ox;
    let oz;
    if (f.kind === GULL_KIND.EIGHT) {
        ox = Math.sin(ang) * f.across;
        oz = Math.sin(2 * ang) * 0.5 * f.depth;
    } else {
        ox = Math.cos(ang) * f.across;
        oz = Math.sin(ang) * f.depth;
    }
    // Across: square to the line of sight; depth: toward the eye (+) and away.
    const ca = Math.cos(f.axis);
    const sa = Math.sin(f.axis);
    const dx = Math.sin(t * 0.031 + f.group * 40) * f.drift[0];
    const dz = Math.cos(t * 0.027 + f.group * 29) * f.drift[1];
    const lx = ox * R + dx;
    const lz = oz * R + dz;
    // It climbs heading out into the breeze and sinks coming back: high on the far side.
    const depthShare = f.depth > 0 ? oz / f.depth : 0;
    const y = f.centre[1] - f.climb * depthShare + 0.5 * Math.sin(t * 0.21 + f.seed * 13) + GULL_STARTLE.climb * k;
    out[0] = f.centre[0] + lx * ca - lz * sa + f.away[0] * GULL_STARTLE.flee * k;
    out[1] = y;
    out[2] = f.centre[2] + lx * sa + lz * ca + f.away[1] * GULL_STARTLE.flee * k;
    return out;
}

/**
 * Where bird `i` is at `t`, with its roost (`leaveAt`, `backAt`) and the startle's state
 * (`startle`: { slow, fast, t0, rush }, `now`: the time its rush was read at), and how large it is
 * drawn (0 once it has gone), written into `out` ([x, y, z, scale]).
 */
export function gullPosition(i, t, out = [0, 0, 0, 1], opts = {}) {
    const f = GULL_FLIGHTS[i];
    const leaveAt = opts.leaveAt ?? GULL_NEVER;
    const backAt = opts.backAt ?? GULL_NEVER;
    const st = opts.startle ?? null;
    const S = st ? startleAt(st.slow, st.fast, st.t0, t) : 0;
    // The rush is read at `now` and carried to `t` at the present rate (as the vertex stage does).
    const now = opts.now ?? t;
    const rush = st ? st.rush + (t - now) * startleAt(st.slow, st.fast, st.t0, now) : 0;
    const p = loopPosition(f, t, S, rush, [0, 0, 0]);
    const scale = GULL_SCALE * (0.92 + 0.16 * fract(f.seed * 3.7));
    const ex = f.exit[0];
    const ez = f.exit[1];
    const R = GULL_ROOST;
    if (leaveAt > backAt) {
        const e = t - leaveAt;
        const s = loopPosition(f, leaveAt, 0, 0, [0, 0, 0]);
        const w = smoothstep(0, R.turn, e);
        out[0] = p[0] + (s[0] + ex * R.speed * e - p[0]) * w;
        out[1] = p[1] + (s[1] + R.climb * e - p[1]) * w;
        out[2] = p[2] + (s[2] + ez * R.speed * e - p[2]) * w;
        out[3] = scale * (1 - smoothstep(R.gone - 8, R.gone, e));
        return out;
    }
    const e = t - backAt;
    const a = loopPosition(f, backAt + R.back, 0, 0, [0, 0, 0]);
    const left = Math.max(R.back - e, 0);
    const w = smoothstep(R.back - R.turn, R.back, e);
    const inbound = [a[0] + ex * R.speed * left, a[1] + R.climb * left, a[2] + ez * R.speed * left];
    out[0] = inbound[0] + (p[0] - inbound[0]) * w;
    out[1] = inbound[1] + (p[1] - inbound[1]) * w;
    out[2] = inbound[2] + (p[2] - inbound[2]) * w;
    out[3] = scale * smoothstep(0, 4, e);
    return out;
}

// ── The wingbeat ────────────────────────────────────────────────────────────

const POSE_KEYS = Object.freeze(['lift', 'sweep', 'bend', 'fold', 'curl']);

/**
 * The flap cycle from the four authored poses: X(φ) = A + B cos φ + C sin φ + D sin² φ hits
 * `top` at φ = 0, `down` at π/2 (mid downstroke), `bottom` at π and `up` at 3π/2 (mid upstroke,
 * the wrist flexed), smooth all the way round.
 */
export const GULL_FLAP = Object.freeze(Object.fromEntries(POSE_KEYS.map((key) => {
    const {
        top, down, bottom, up,
    } = GULL_RIG.poses;
    const A = 0.5 * (top[key] + bottom[key]);
    const B = 0.5 * (top[key] - bottom[key]);
    const C = 0.5 * (down[key] - up[key]);
    const D = 0.5 * (down[key] + up[key]) - A;
    return [key, Object.freeze([A, B, C, D])];
})));

/** The glide pose (the gull's crank), by key. */
export const GULL_GLIDE = Object.freeze({ ...GULL_RIG.poses.glide });

/** The hinge angles at cycle phase `phi` blended from the glide by `flap` (0..1). */
export function wingPose(phi, flap, out = {}) {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (const key of POSE_KEYS) {
        const [A, B, C, D] = GULL_FLAP[key];
        const cyc = A + B * c + C * s + D * s * s;
        out[key] = GULL_GLIDE[key] + (cyc - GULL_GLIDE[key]) * clamp01(flap);
    }
    return out;
}

/** How many gulls a tier flies (the first `count` rows). */
export function gullCount(count) {
    return Math.max(1, Math.min(GULL_FLIGHTS.length, Math.round(count ?? 7)));
}

const rotate = (a, b, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a * c - b * s, a * s + b * c];
};

/**
 * Fold a rest-pose point `p` ([x, y, z], the bird's frame: x left, y up, z forward) by its hinge
 * weights `w` ([arm, hand, tip]) into `pose`: about the wrist, then the shoulder. The vertex stage's
 * twin (and scripts/blender/synthwave_gull.py's fold()).
 */
export function foldPoint(p, w, pose, out = [0, 0, 0]) {
    const [Sx, Sy, Sz] = GULL_RIG.shoulder;
    const [Wx, Wy, Wz] = GULL_RIG.wrist;
    const side = p[0] >= 0 ? 1 : -1;
    let [du, dz] = rotate(Math.abs(p[0]) - Wx, p[2] - Wz, -pose.fold * w[1]);
    let dy;
    [du, dy] = rotate(du, p[1] - Wy, pose.bend * w[1] + pose.curl * w[2]);
    [du, dz] = rotate(du + Wx - Sx, dz + Wz - Sz, -pose.sweep * w[0]);
    [du, dy] = rotate(du, dy + Wy - Sy, pose.lift * w[0]);
    out[0] = side * (du + Sx);
    out[1] = dy + Sy;
    out[2] = dz + Sz;
    return out;
}
