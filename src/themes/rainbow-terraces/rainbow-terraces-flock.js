/**
 * Rainbow Terraces: the gliders' flight, in closed form (three-free).
 *
 * The gliders are small birds of folded paper. At rest they soar on the thermals of their own
 * flock: each thermal wanders slowly on the wind, everyone in it circles the same way (faster
 * downwind, slower into the wind), climbing as they circle; every so often one leaves on a long
 * sinking glide to another thermal of the flock, pushing off with a few wingbeats, and now and
 * then one flaps a short burst. The lean of every glider is the real curvature of its path (a
 * coordinated turn), so it banks into its circles and rolls level on the glide.
 *
 * When the chain holds, one peels off for each link: it dives to the bow with its wings folded,
 * rides the brush round the bow's arc at a fixed distance (so its screen position lies on the
 * bow; its short trail in the colour of the link is the stroke's brush), and when the stroke is
 * laid flies on and home to its flock, beating its wings, its trail fading. A T-spin draws two
 * down to rise in a double helix beside the card; a level up gathers a flight out over the gulf
 * from the Spring Isle; while a back-to-back holds, one larger "long-wing" keeps station along the
 * bow's leg. Each joins its flight from where it was and flies home afterwards: nothing jumps. In
 * a fever of play (`ribbon` 0..1, set by the world) every other glider trails a ribbon of the
 * colours played (`ribbons`), its paper lit in it. When the hour sends some home (`aloft`), the
 * last of them climb away and fade rather than vanish.
 *
 * Everything is a function of the flight clock (integrated by the world, so a hush can freeze
 * them) and the event times, so any frame can be reproduced by seeking: a glider in an event is
 * its pose without the event, blended in and out on Hermite curves whose ends are themselves
 * closed-form, and its velocity and lean are differences of that same function.
 */
import {
    DEG, clamp, clamp01, mulberry32, smooth,
} from './rainbow-terraces-core.js';
import { bowPoint } from './rainbow-terraces-frame.js';

export const PAINT_DISTANCE = 300;
const G = 9.81;

/** Event flights: how long a glider takes to join one (`*Join`) and to fly home after (`*Home`), s. */
export const FLIGHT = Object.freeze({
    paintJoin: 0.55,
    paintHome: 5.5,
    helixSeconds: 2.2,
    helixJoin: 0.6,
    helixHome: 5,
    launchSeconds: 6.5,
    launchJoin: 1.2,
    launchHome: 7,
    wingJoin: 1.4,
    wingHome: 5,
});

/** Soaring at rest. */
export const SOAR = Object.freeze({
    airspeed: 9, // m/s
    downwind: 0.22, // share the turn quickens downwind (and slows into the wind)
    legMin: 38, // s on one thermal before maybe moving to another (each glider its own)
    legSpan: 32,
    glideMin: 11, // s of the glide between two thermals
    glideSpan: 6,
    climbMin: 9, // m: half the height won circling (and lost on the glide)
    climbSpan: 9,
});

/** The wings (radians; + raises the tip). The bird's geometry hinges at shoulder and wrist. */
export const WING = Object.freeze({
    dihedral: 0.12, // held a little up in the glide
    shoulderBeat: 0.62, // a full beat's half-swing at the shoulder
    wristBeat: 0.5, // and at the wrist, lagging
    wristLag: 0.95,
    tuckShoulder: 1.0, // the dive: wings raised in a steep V, hands folded down (a compact dart from below)
    tuckWrist: -2.0,
});

const ROLE = Object.freeze({
    paint: 1, helix: 2, launch: 3, wing: 4,
});
const SLOTS = 4;
const H_VEL = 0.04;
/** The turn a glider leans into is its heading's turn over the last half second (look-back steps). */
const TURN_STEP = 0.1;
const TURN_STEPS = 5;
/** Slots stay filled this long past their flight home, for the look-back. */
const LOOK_BACK = TURN_STEP * TURN_STEPS + 0.1;
/** The brush runs on at about a stroke a second (the dial's slowest rate). */
const PAINT_RATE = 1;

/** A glider's pose: position, heading (velocity), bank (radians), glow, colour, scale, wings. */
function pose() {
    return {
        pos: [0, 0, 0],
        vel: [0, 0, -1],
        bank: 0,
        glow: 0,
        colour: [1, 1, 1],
        scale: 1,
        mode: 0,
        trail: 0,
        /** The shoulder's and the wrist's angle (radians). */
        wings: [WING.dihedral, 0],
        /** 0..1: how much of the glider is here (the aloft share fading it out or in). */
        presence: 1,
    };
}

function slot() {
    return {
        on: false, kind: 0, arg: 0, t0: 0, t1: Infinity, join: 0, home: 0, end: 1, ref: 0,
    };
}

/** A hash of two integers to [0, 1). */
export function hash2(a, b) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * Quintic Hermite from p0 (tangent m0) to p1 (tangent m1) at u in [0, 1], tangents in metres, with
 * no acceleration at either end: a flight leaves and arrives on its heading and eases into its
 * turn (a cubic would start every join with a jolt).
 */
function hermite(p0, m0, p1, m1, u, out) {
    const u3 = u * u * u;
    const u4 = u3 * u;
    const u5 = u4 * u;
    const h0 = 1 - 10 * u3 + 15 * u4 - 6 * u5;
    const h1 = u - 6 * u3 + 8 * u4 - 3 * u5;
    const h4 = -4 * u3 + 7 * u4 - 3 * u5;
    const h5 = 10 * u3 - 15 * u4 + 6 * u5;
    for (let j = 0; j < 3; j++) out[j] = h0 * p0[j] + h1 * m0[j] + h4 * m1[j] + h5 * p1[j];
    return out;
}

/**
 * Add an offset that starts at d0, changing at m0 and curving at a0 (over the whole span, in
 * metres), and settles to nothing at u = 1 with no acceleration (the quintic Hermite's first
 * terms): a blend that keeps position, velocity and turn continuous at both ends.
 */
function settle(d0, m0, a0, u, out) {
    const u2 = u * u;
    const u3 = u2 * u;
    const u4 = u3 * u;
    const u5 = u4 * u;
    const h0 = 1 - 10 * u3 + 15 * u4 - 6 * u5;
    const h1 = u - 6 * u3 + 8 * u4 - 3 * u5;
    const h2 = 0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5;
    for (let j = 0; j < 3; j++) out[j] += h0 * d0[j] + h1 * m0[j] + h2 * a0[j];
    return out;
}

const ZERO = Object.freeze([0, 0, 0]);

/** Shorten a tangent (velocity × seconds) to at most `k` × the chord (+15 m), so no curve loops wide. */
function tame(m, p0, p1, k = 1.4) {
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = Math.hypot(m[0], m[1], m[2]);
    const most = k * chord + 15;
    if (len > most) {
        const f = most / len;
        m[0] *= f; m[1] *= f; m[2] *= f;
    }
    return m;
}

export class GliderFlock {
    /**
     * @param {number} capacity  gliders in the air at most
     * @param {number} [seed]
     */
    constructor(capacity, seed = 33) {
        this.capacity = capacity;
        this.seed = seed | 0;
        this.rand = mulberry32(seed);
        this.poses = Array.from({ length: capacity }, pose);
        this.thermals = [];
        /** The thermals of each flock (indices into `thermals`). */
        this.groups = [];
        this.windOf = [];
        // Per glider: its home thermal, flight traits and wingbeat.
        this.traits = Array.from({ length: capacity }, () => ({
            thermal: 0,
            group: 0,
            phase: this.rand() * Math.PI * 2,
            radius: 0.7 + this.rand() * 0.6,
            speed: 0.85 + this.rand() * 0.3,
            climb: SOAR.climbMin + this.rand() * SOAR.climbSpan,
            bob: this.rand() * Math.PI * 2,
            leg: SOAR.legMin + this.rand() * SOAR.legSpan,
            legOff: 0,
            glide: SOAR.glideMin + this.rand() * SOAR.glideSpan,
            size: 0.85 + this.rand() * 0.35,
            hz: 2.7 + this.rand() * 0.9, // wingbeats a second
            beat: this.rand() * Math.PI * 2,
            gust: this.rand() * Math.PI * 2,
        }));
        this.traits.forEach((tr) => { tr.legOff = this.rand() * tr.leg; });
        this.slots = Array.from({ length: capacity }, () => Array.from({ length: SLOTS }, slot));
        this.helixAt = -1e4;
        this.helixFrom = [0, 0, 0];
        this.launchAt = -1e4;
        this.launchFrom = [0, 0, 0];
        this.launchOrder = [];
        this.launchCount = 0;
        this.wingOnAt = -1e4;
        this.wingOffAt = -1e4;
        this.bankFlash = -1e4;
        /** How far into a fever play runs (0..1): the thermals' gliders trail the colours played. */
        this.ribbon = 0;
        /** The colours they trail ([r, g, b] each), or null. */
        this.ribbons = null;
        this.bow = null;
        this.flying = 0;
        // Scratch (nothing allocated per frame at rest).
        this.s = Array.from({ length: 16 }, () => [0, 0, 0]);
        this.restInfo = { glide: -1 };
        this.roleInfo = { slot: null, phase: 'fly', u: 0 };
    }

    /** The thermals' centres, radii and flocks (world), from the plan. */
    setThermals(thermals) {
        this.thermals = thermals.map((t, k) => ({
            pos: t.pos.slice(),
            radius: t.radius,
            group: t.group ?? 0,
            // Everyone in a thermal circles the same way.
            dir: hash2(this.seed * 7 + k, 11) < 0.5 ? 1 : -1,
            wander: [hash2(k, 21) * 6.283, hash2(k, 22) * 6.283, hash2(k, 23) * 6.283, hash2(k, 24) * 6.283],
        }));
        const groups = [];
        this.thermals.forEach((th, k) => {
            (groups[th.group] || (groups[th.group] = [])).push(k);
        });
        this.groups = Array.from(groups, (g) => g || []);
        // The wind a flock soars in: one heading for all its thermals.
        this.windOf = this.groups.map((_, g) => 0.6 + 0.9 * hash2(this.seed + 5, g + 31));
        this.traits.forEach((tr, i) => {
            tr.thermal = this.thermals.length ? i % this.thermals.length : 0;
            tr.group = this.thermals.length ? this.thermals[tr.thermal].group : 0;
        });
    }

    /** Every glider in the air banks at once (a two-line clear). */
    bank(at) {
        this.bankFlash = at;
    }

    /** Two gliders rise from a point in a double helix (a T-spin). */
    helix(from, at) {
        this.helixFrom = from.slice();
        this.helixAt = at;
    }

    /** A flight of gliders sails out from a point over the gulf (a level up). */
    launch(from, at) {
        this.launchFrom = from.slice();
        this.launchAt = at;
    }

    /** The long-wing takes its station on the bow (a back-to-back) or flies home, at flight clock `at`. */
    setLongWing(on, at) {
        if (on && !this.longWing) this.wingOnAt = at;
        if (!on && this.longWing) this.wingOffAt = at;
    }

    /** Whether the long-wing keeps its station now. */
    get longWing() {
        return this.wingOnAt > this.wingOffAt;
    }

    /** Forget every event (a seek, a new run). */
    resetEvents() {
        this.helixAt = -1e4;
        this.launchAt = -1e4;
        this.wingOnAt = -1e4;
        this.wingOffAt = -1e4;
        this.bankFlash = -1e4;
        this.ribbon = 0;
    }

    // ── At rest ──

    /** The thermal glider `i` circles on its `n`-th leg: one of its flock's, chosen per leg. */
    legThermal(i, n) {
        const g = this.groups[this.traits[i].group];
        if (!g || g.length < 2) return this.traits[i].thermal;
        return g[Math.floor(hash2(i * 131 + this.seed, n) * g.length)];
    }

    /** Thermal `k`'s core at `t`: its place, wandering slowly on the wind. */
    core(k, t, out) {
        const th = this.thermals[k];
        const wd = th.wander;
        out[0] = th.pos[0] + 11 * Math.sin(t * 0.019 + wd[0]) + 5 * Math.sin(t * 0.047 + wd[1]);
        out[1] = th.pos[1] + 4 * Math.sin(t * 0.023 + wd[2]);
        out[2] = th.pos[2] + 11 * Math.sin(t * 0.017 + wd[3]) + 5 * Math.sin(t * 0.041 + wd[0]);
        return out;
    }

    /** Glider `i` circling thermal `k` at `t` (the leg's height is added by restAt). */
    circle(i, k, t, out) {
        const th = this.thermals[k];
        const tr = this.traits[i];
        const R = th.radius * tr.radius;
        const w = (SOAR.airspeed * tr.speed) / R;
        const psi = this.windOf[th.group] ?? 0;
        const theta = tr.phase + th.dir * w * t;
        // Quicker downwind, slower into it (the turn's angle runs unevenly), round a wandering core.
        const a = theta + th.dir * SOAR.downwind * Math.cos(theta - psi);
        this.core(k, t, out);
        out[0] += Math.cos(a) * R;
        out[2] += Math.sin(a) * R;
        return out;
    }

    circleVel(i, k, t, out) {
        const a = this.circle(i, k, t + H_VEL, this.s[14]);
        const b = this.circle(i, k, t - H_VEL, this.s[15]);
        for (let j = 0; j < 3; j++) out[j] = (a[j] - b[j]) / (2 * H_VEL);
        return out;
    }

    /**
     * Glider `i` at rest at `t`: circling the thermal of its leg and climbing, then (if the next
     * leg is another thermal) a sinking glide there on a Hermite curve that leaves and joins the
     * two circles on their own headings. `info.glide` is how far into a glide (or -1).
     */
    restAt(i, t, out, info = null) {
        const tr = this.traits[i];
        const L = tr.leg;
        const x = (t + tr.legOff) / L;
        const n = Math.floor(x);
        const u = x - n;
        const turn = 1 - tr.glide / L;
        const k0 = this.legThermal(i, n);
        const k1 = this.legThermal(i, n + 1);
        if (info) info.glide = -1;
        if (k0 === k1 || u < turn) {
            this.circle(i, k0, t, out);
        } else {
            const { s } = this;
            const ta = (n + turn) * L - tr.legOff;
            const tb = (n + 1) * L - tr.legOff;
            const D = tb - ta;
            const p0 = this.circle(i, k0, ta, s[0]);
            const v0 = this.circleVel(i, k0, ta, s[1]);
            const p1 = this.circle(i, k1, tb, s[2]);
            const v1 = this.circleVel(i, k1, tb, s[3]);
            for (let j = 0; j < 3; j++) { v0[j] *= D; v1[j] *= D; }
            tame(v0, p0, p1, 1.1);
            tame(v1, p0, p1, 1.1);
            hermite(p0, v0, p1, v1, (t - ta) / D, out);
            if (info) info.glide = (t - ta) / D;
        }
        // Won circling, lost on the glide (or circling down, on a leg that keeps its thermal).
        const h = u < turn ? -1 + 2 * smooth(0, turn, u) : 1 - 2 * smooth(turn, 1, u);
        out[1] += tr.climb * h + 2.5 * Math.sin(t * 0.21 + tr.bob);
        return out;
    }

    // ── Events ──

    /** The brush on stroke `s` at `progress`, and (into `vel`) its velocity at a unit of progress a second. */
    brush(s, progress, out, vel = null) {
        const { bow } = this;
        const st = bow.strokes[s];
        const R = (s < 7 ? bow.R1 : bow.R2) - 0.6 * DEG;
        const phi = st.phi0 + (st.phi1 - st.phi0) * progress;
        bowPoint(bow.A, bow.basis, R, phi, out);
        for (let j = 0; j < 3; j++) out[j] *= PAINT_DISTANCE;
        if (vel) {
            const ahead = bowPoint(bow.A, bow.basis, R, phi + (st.phi1 - st.phi0) * 0.01, this.s[13]);
            for (let j = 0; j < 3; j++) vel[j] = (ahead[j] * PAINT_DISTANCE - out[j]) / 0.01;
        }
        return out;
    }

    /** Glider `i`'s own flight in the event of slot `sl` at `t`: closed form, defined for any t. */
    special(i, sl, t, out) {
        switch (sl.kind) {
        case ROLE.paint: {
            // While painting: the dial's progress now, run on at about a stroke a second either
            // side of now (so the flight has a velocity). Once ended: the progress it ended at, and
            // after that flying on a little way along the bow, slowing.
            let progress;
            if (sl.t1 === Infinity) {
                progress = clamp01(this.bow.dial - sl.arg) + (t - this.now) * PAINT_RATE;
            } else if (t <= sl.ref) {
                progress = sl.end + (t - sl.ref) * PAINT_RATE;
            } else {
                progress = sl.end + PAINT_RATE * 0.3 * (1 - Math.exp(-(t - sl.ref) / 0.3));
            }
            return this.brush(sl.arg, progress, out);
        }
        case ROLE.helix: {
            const u = (t - this.helixAt) / 1.6;
            const turn = u * 1.5 * Math.PI * 2 + sl.arg * Math.PI;
            const rise = 140 * (1.4 * u - 0.4 * u * u);
            out[0] = this.helixFrom[0] + Math.cos(turn) * 4;
            out[1] = this.helixFrom[1] + rise;
            out[2] = this.helixFrom[2] + Math.sin(turn) * 4;
            return out;
        }
        case ROLE.launch: {
            const k = sl.arg;
            const count = this.launchCount;
            const u = (t - this.launchAt - k * 0.12) / 6;
            const spread = (k / Math.max(1, count - 1) - 0.5) * 0.9;
            const o = smooth(0, 1, u) + Math.max(0, u - 1) * 0.5;
            const from = this.launchFrom;
            out[0] = from[0] + (120 + 80 * spread) * o + Math.sin(u * 9 + k) * 6;
            out[1] = from[1] + 40 * Math.sin(clamp01(o) * Math.PI) - 20 * u + spread * 30;
            out[2] = from[2] + (60 + 140 * spread) * o;
            return out;
        }
        case ROLE.wing: {
            const s0 = this.bow.strokes[0];
            const u = 0.5 + 0.5 * Math.sin((t / 14) * Math.PI * 2);
            const phi = s0.phi0 + (s0.phi1 - s0.phi0) * u;
            bowPoint(this.bow.A, this.bow.basis, this.bow.R1 - 1.2 * DEG, phi, out);
            for (let j = 0; j < 3; j++) out[j] *= 260;
            return out;
        }
        default:
            return out;
        }
    }

    /** Velocity of the event's own flight at `t`. */
    specialVel(i, sl, t, out) {
        const a = this.special(i, sl, t + H_VEL, this.s[10]);
        const b = this.special(i, sl, t - H_VEL, this.s[11]);
        for (let j = 0; j < 3; j++) out[j] = (a[j] - b[j]) / (2 * H_VEL);
        return out;
    }

    /**
     * Glider `i` at `t` with its event slots up to `level` in effect (-1: at rest). An event joins
     * from the glider's pose without it, and flies home to that pose, on Hermite curves.
     */
    at(i, t, level, out) {
        for (let lv = level; lv >= 0; lv--) {
            const sl = this.slots[i][lv];
            if (sl.on && t >= sl.t0 && t < sl.t1 + sl.home) {
                if (t < sl.t1) return this.inRole(i, sl, lv, t, out);
                // Flying home: on its own path again, offset by where the event left it (and how it
                // was flying), the offset settling to nothing.
                const E = this.inRole(i, sl, lv, sl.t1, [0, 0, 0]);
                const a = this.inRole(i, sl, lv, sl.t1 + H_VEL, [0, 0, 0]);
                const b = this.inRole(i, sl, lv, sl.t1 - H_VEL, [0, 0, 0]);
                const B1 = this.at(i, sl.t1, lv - 1, [0, 0, 0]);
                const Ba = this.at(i, sl.t1 + H_VEL, lv - 1, [0, 0, 0]);
                const Bb = this.at(i, sl.t1 - H_VEL, lv - 1, [0, 0, 0]);
                const d0 = [0, 0, 0];
                const m0 = [0, 0, 0];
                const a0 = [0, 0, 0];
                const T = sl.home;
                for (let j = 0; j < 3; j++) {
                    d0[j] = E[j] - B1[j];
                    m0[j] = (((a[j] - b[j]) - (Ba[j] - Bb[j])) / (2 * H_VEL)) * T;
                    a0[j] = (((a[j] - 2 * E[j] + b[j]) - (Ba[j] - 2 * B1[j] + Bb[j])) / (H_VEL * H_VEL)) * T * T;
                }
                // It leaves on its own heading, a wide arc home rather than a turn on the spot.
                tame(m0, d0, ZERO, 3);
                tame(a0, d0, ZERO, 6);
                this.at(i, t, lv - 1, out);
                return settle(d0, m0, a0, (t - sl.t1) / T, out);
            }
        }
        return this.restAt(i, t, out);
    }

    /**
     * Glider `i` in the event of slot `sl` (level `lv`) at `t`: the event's own flight, offset at
     * first by where the glider was when it began (and how it was flying), the offset settling to
     * nothing over the join.
     */
    inRole(i, sl, lv, t, out) {
        this.special(i, sl, t, out);
        const tj = t - sl.t0;
        if (tj >= sl.join) return out;
        const B0 = this.at(i, sl.t0, lv - 1, [0, 0, 0]);
        const Ba = this.at(i, sl.t0 + H_VEL, lv - 1, [0, 0, 0]);
        const Bb = this.at(i, sl.t0 - H_VEL, lv - 1, [0, 0, 0]);
        const S0 = this.special(i, sl, sl.t0, [0, 0, 0]);
        const Sa = this.special(i, sl, sl.t0 + H_VEL, [0, 0, 0]);
        const Sb = this.special(i, sl, sl.t0 - H_VEL, [0, 0, 0]);
        const d0 = [0, 0, 0];
        const m0 = [0, 0, 0];
        const a0 = [0, 0, 0];
        const T = sl.join;
        for (let j = 0; j < 3; j++) {
            d0[j] = B0[j] - S0[j];
            m0[j] = (((Ba[j] - Bb[j]) - (Sa[j] - Sb[j])) / (2 * H_VEL)) * T;
            a0[j] = (((Ba[j] - 2 * B0[j] + Bb[j]) - (Sa[j] - 2 * S0[j] + Sb[j])) / (H_VEL * H_VEL)) * T * T;
        }
        tame(m0, d0, ZERO);
        tame(a0, d0, ZERO, 6);
        return settle(d0, m0, a0, Math.max(0, tj) / T, out);
    }

    velAt(i, t, level, out) {
        const a = this.at(i, t + H_VEL, level, [0, 0, 0]);
        const b = this.at(i, t - H_VEL, level, [0, 0, 0]);
        for (let j = 0; j < 3; j++) out[j] = (a[j] - b[j]) / (2 * H_VEL);
        return out;
    }

    /** The highest slot in effect for glider `i` at `t`, its phase ('join' | 'fly' | 'home') and progress. */
    roleAt(i, t, out) {
        out.slot = null;
        for (let lv = SLOTS - 1; lv >= 0; lv--) {
            const sl = this.slots[i][lv];
            if (sl.on && t >= sl.t0 && t < sl.t1 + sl.home) {
                out.slot = sl;
                if (t < sl.t0 + sl.join && t < sl.t1) {
                    out.phase = 'join';
                    out.u = (t - sl.t0) / sl.join;
                } else if (t < sl.t1) {
                    out.phase = 'fly';
                    out.u = 1;
                } else {
                    out.phase = 'home';
                    out.u = (t - sl.t1) / sl.home;
                }
                return out;
            }
        }
        return out;
    }

    /** The flock whose thermals lie nearest a world point as seen from the eye (the origin). */
    nearestGroup(p) {
        const r = Math.hypot(p[0], p[1], p[2]) || 1;
        let best = 0;
        let bestC = -2;
        for (const th of this.thermals) {
            const q = th.pos;
            const c = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (r * (Math.hypot(q[0], q[1], q[2]) || 1));
            if (c > bestC) { bestC = c; best = th.group; }
        }
        return best;
    }

    /** The flying gliders of flock `g` (all flying ones if it has none). */
    flyingIn(g, flying) {
        const list = this.memberBuf || (this.memberBuf = []);
        list.length = 0;
        for (let i = 0; i < flying; i++) if (this.traits[i].group === g) list.push(i);
        if (!list.length) for (let i = 0; i < flying; i++) list.push(i);
        return list;
    }

    /**
     * A join long enough for the distance from where glider `g` is at the slot's start to where its
     * flight begins, at about a stoop's speed: a streak, never a jump.
     */
    joinFor(g, lv, sl, speed, least, most) {
        if (!(sl.t0 > -1e3)) return least;
        const from = this.at(g, sl.t0, lv - 1, [0, 0, 0]);
        // (A painter makes for the stroke's start: where the brush is then.)
        const to = sl.kind === ROLE.paint ? this.brush(sl.arg, 0, [0, 0, 0]) : this.special(g, sl, sl.t0, [0, 0, 0]);
        const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        return clamp(d / speed, least, most);
    }

    /** Fill the event slots for the frame at `t`. */
    assign(t, bow, flying) {
        for (let i = 0; i < this.capacity; i++) for (let lv = 0; lv < SLOTS; lv++) this.slots[i][lv].on = false;
        const set = (g, lv, kind, arg, t0, t1, join, home, end = 1) => {
            const sl = this.slots[g][lv];
            if (sl.on && sl.t0 > t0) return null;
            sl.on = true;
            sl.kind = kind; sl.arg = arg; sl.t0 = t0; sl.t1 = t1; sl.join = join; sl.home = home; sl.end = end; sl.ref = t1;
            return sl;
        };
        const at0 = this.s[11];
        // Painting the bow: one glider per stroke being painted (and one flying home from each just
        // laid), from the flock nearest where the stroke begins.
        if (bow && bow.strokes) {
            const { strokes } = bow;
            for (let s = 0; s < strokes.length; s++) {
                const from = bow.paintFrom ? bow.paintFrom[s] : -Infinity;
                const to = bow.paintTo ? bow.paintTo[s] : -Infinity;
                const progress = clamp01(bow.dial - s);
                const ended = from > -1e3 && to >= from;
                const painting = progress > 0 && progress < 1 && !ended;
                if (!painting && !(ended && t < to + 1.8 + FLIGHT.paintHome + LOOK_BACK)) continue;
                const list = this.flyingIn(this.nearestGroup(this.brush(s, 0, at0)), flying);
                const g = list[(s * 5 + 1) % list.length];
                const end = ended && bow.paintEnd ? bow.paintEnd[s] : 1;
                const sl = set(g, 0, ROLE.paint, s, from, painting ? Infinity : to, FLIGHT.paintJoin, FLIGHT.paintHome, end);
                if (!sl) continue;
                sl.join = this.joinFor(g, 0, sl, 120, FLIGHT.paintJoin, 1.8);
                // A stroke laid before its glider arrived: it still dives to the stroke's end first.
                if (ended) sl.t1 = Math.max(to, from + sl.join);
            }
        }
        // A T-spin: two from the flock nearest the card rise in a double helix.
        if (t >= this.helixAt && t < this.helixAt + FLIGHT.helixSeconds + FLIGHT.helixHome + 1.6 + LOOK_BACK && flying >= 4) {
            const list = this.flyingIn(this.nearestGroup(this.helixFrom), flying);
            for (let k = 0; k < 2; k++) {
                const g = list.length >= 2 ? list[list.length - 1 - k] : flying - 1 - k;
                const sl = set(
                    g,
                    1,
                    ROLE.helix,
                    k,
                    this.helixAt,
                    this.helixAt + FLIGHT.helixSeconds,
                    FLIGHT.helixJoin,
                    FLIGHT.helixHome,
                );
                if (sl) {
                    sl.join = this.joinFor(g, 1, sl, 130, FLIGHT.helixJoin, 1.6);
                    sl.t1 = this.helixAt + Math.max(FLIGHT.helixSeconds, sl.join + 0.4);
                }
            }
        }
        // A level up: a flight sails out from the Spring Isle, gathered from the flock nearest it.
        this.launchCount = Math.min(12, flying);
        if (t >= this.launchAt && t < this.launchAt + FLIGHT.launchSeconds + FLIGHT.launchHome + LOOK_BACK) {
            const order = this.launchOrderFor(flying);
            for (let k = 0; k < this.launchCount; k++) {
                set(
                    order[k],
                    2,
                    ROLE.launch,
                    k,
                    this.launchAt + k * 0.12,
                    this.launchAt + FLIGHT.launchSeconds,
                    FLIGHT.launchJoin,
                    FLIGHT.launchHome,
                );
            }
        }
        // Back-to-back: the long-wing (from the flock nearest the bow's leg) keeps station along it.
        if (bow && bow.strokes && bow.strokes[0] && flying > 2 && this.wingOnAt > -1e3) {
            const on = this.longWing;
            if (on || t < this.wingOffAt + FLIGHT.wingJoin + FLIGHT.wingHome + LOOK_BACK) {
                const s0 = bow.strokes[0];
                bowPoint(bow.A, bow.basis, bow.R1, (s0.phi0 + s0.phi1) / 2, at0);
                const list = this.flyingIn(this.nearestGroup(at0), flying);
                const g = list.length >= 3 ? list[list.length - 3] : flying - 3;
                set(
                    g,
                    3,
                    ROLE.wing,
                    0,
                    this.wingOnAt,
                    on ? Infinity : Math.max(this.wingOffAt, this.wingOnAt + FLIGHT.wingJoin),
                    FLIGHT.wingJoin,
                    FLIGHT.wingHome,
                );
            }
        }
    }

    /** The flying gliders, those of the flock nearest the launch first. */
    launchOrderFor(flying) {
        const from = this.launchFrom;
        let best = 0;
        let bestD = Infinity;
        this.thermals.forEach((th) => {
            const d = Math.hypot(th.pos[0] - from[0], th.pos[2] - from[2]);
            if (d < bestD) { bestD = d; best = th.group; }
        });
        const order = this.launchOrder;
        order.length = 0;
        for (let i = 0; i < flying; i++) if (this.traits[i].group === best) order.push(i);
        for (let i = 0; i < flying; i++) if (this.traits[i].group !== best) order.push(i);
        return order;
    }

    /**
     * Sample every glider's pose at flight clock `t` (seconds).
     * @param {number} t
     * @param {object} bow   { A, basis, R1, R2, strokes: [{phi0, phi1}], dial, links: [[r,g,b]],
     *                       and optionally per stroke paintFrom / paintTo (the flight clock its
     *                       painting began / ended) and paintEnd (the progress it ended at) }
     * @param {number} aloft  0..1: share of the gliders flying (the rest sleep in the grotto)
     */
    sample(t, bow, aloft = 1) {
        const n = this.capacity;
        this.bow = bow;
        this.now = t;
        // The aloft share: whole gliders, and the next one fading (climbing away or arriving).
        const share = Math.max(2, n * clamp01(aloft));
        const flying = Math.min(n, Math.floor(share - 0.5) + 1);
        this.flying = flying;
        if (this.thermals.length) this.assign(t, bow, flying);
        const { s } = this;
        const role = this.roleInfo;
        const level = SLOTS - 1;
        for (let i = 0; i < n; i++) {
            const p = this.poses[i];
            const tr = this.traits[i];
            p.glow = 0;
            p.trail = 0;
            p.mode = 0;
            p.colour[0] = 1; p.colour[1] = 1; p.colour[2] = 1;
            p.scale = tr.size;
            const presence = this.thermals.length ? clamp01(share - i + 0.5) : 0;
            p.presence = presence;
            if (presence <= 0) {
                // Asleep (or no thermals yet): parked far below the frame, no area.
                p.pos[0] = 0; p.pos[1] = -1e5; p.pos[2] = 0;
                p.scale = 0;
                continue;
            }
            this.roleAt(i, t, role);
            const sl = role.slot;
            // Position, velocity and acceleration of the one closed-form flight.
            this.at(i, t, level, p.pos);
            {
                const a = this.at(i, t + H_VEL, level, s[6]);
                const b = this.at(i, t - H_VEL, level, s[7]);
                for (let j = 0; j < 3; j++) p.vel[j] = (a[j] - b[j]) / (2 * H_VEL);
            }
            // A coordinated turn: the lift leans into the sideways pull of its turn (its heading's
            // turn rate times its speed over the ground). The lean is averaged over the last half
            // second (looking back, so an event starting now never snaps it, and a hard reversal
            // rolls through level instead of flipping).
            let lean = 0;
            {
                let heading = Math.atan2(p.vel[2], p.vel[0]);
                let speed = Math.hypot(p.vel[0], p.vel[2]);
                let weight = 0;
                const v = s[5];
                for (let k = 1; k <= TURN_STEPS; k++) {
                    const tk = t - k * TURN_STEP;
                    const c = this.at(i, tk + H_VEL, level, s[8]);
                    const d = this.at(i, tk - H_VEL, level, s[9]);
                    for (let j = 0; j < 3; j++) v[j] = (c[j] - d[j]) / (2 * H_VEL);
                    const was = Math.atan2(v[2], v[0]);
                    const ground = Math.hypot(v[0], v[2]);
                    let turn = heading - was;
                    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
                    const w = TURN_STEPS + 1 - k;
                    lean += w * clamp(-Math.atan2((turn / TURN_STEP) * 0.5 * (speed + ground), G), -1.1, 1.1);
                    weight += w;
                    heading = was;
                    speed = ground;
                }
                lean /= weight;
            }
            // An event's own flight leans as it was designed to (eased in as the glider takes it
            // up, and out as it leaves), and a paper wobble.
            p.bank = lean;
            if (sl) {
                const designed = this.leanOf(sl, p.pos, bow);
                if (designed !== null) {
                    // Over the second half of the join, and out again over a moment of the way home.
                    const taken = (at) => smooth(0.4, 1, (at - sl.t0) / sl.join);
                    const w = role.phase === 'home' ? taken(sl.t1) * (1 - smooth(0, 0.35, t - sl.t1)) : taken(t);
                    p.bank += (designed - p.bank) * w;
                }
            }
            p.bank += 0.06 * Math.sin(t * 1.9 + tr.gust) + 0.04 * Math.sin(t * 3.3 + tr.bob);
            // A two-line clear: every glider banks hard at once.
            const bf = t - this.bankFlash;
            if (bf >= 0 && bf < 0.6) p.bank += Math.sin((bf / 0.6) * Math.PI) * 0.9 * (Math.sign(p.bank) || 1);

            // The wings: gliding, a short burst of beats now and then, a push off into each glide.
            let beat = 0;
            let tuck = 0;
            {
                const win = Math.floor((t + tr.legOff) / 7);
                if (hash2(i * 17 + this.seed, win) < 0.3) {
                    const start = win * 7 - tr.legOff + hash2(i, win + 7) * 3;
                    const dur = 1.4 + hash2(i + 3, win);
                    const tau = t - start;
                    if (tau > 0 && tau < dur) beat = smooth(0, 0.3, tau) * (1 - smooth(dur - 0.4, dur, tau));
                }
                this.restAt(i, t, s[4], this.restInfo);
                const gl = this.restInfo.glide;
                if (gl >= 0) beat = Math.max(beat, smooth(0, 0.04, gl) * (1 - smooth(0.12, 0.22, gl)));
            }
            const { ribbons } = this;
            if (!sl || role.phase === 'home') {
                if (this.ribbon > 0.01 && ribbons && ribbons.length && i % 2 === 1) {
                    const c = ribbons[(i >> 1) % ribbons.length];
                    p.colour[0] = c[0]; p.colour[1] = c[1]; p.colour[2] = c[2];
                    p.trail = this.ribbon * 0.55;
                    p.glow = this.ribbon * 0.6;
                }
                beat = Math.min(1, beat + 0.3 * this.ribbon);
            }
            if (sl) {
                this.dress(i, t, sl, role, p, bow);
                const { phase, u } = role;
                if (sl.kind === ROLE.paint) {
                    // Diving to the bow with folded wings, gliding the stroke, beating home.
                    if (phase === 'join') {
                        tuck = smooth(0, 0.15, u) * (1 - smooth(0.8, 1, u));
                        beat = 0;
                    } else if (phase === 'home') {
                        beat = Math.max(beat, 1 - smooth(0.25, 0.45, u));
                    } else {
                        beat = 0;
                    }
                } else if (sl.kind === ROLE.helix) {
                    beat = phase === 'home' ? Math.max(beat, 1 - smooth(0.2, 0.4, u)) : 1;
                } else if (sl.kind === ROLE.launch) {
                    beat = phase === 'home' ? Math.max(beat, 1 - smooth(0.1, 0.3, u)) : 1 - smooth(2.2, 3.2, t - sl.t0);
                } else if (sl.kind === ROLE.wing) {
                    beat = phase === 'fly'
                        ? 0.45 * (0.5 + 0.5 * Math.sin(t * 0.7))
                        : Math.max(beat, 0.8 * (1 - smooth(0.3, 0.6, u)));
                }
            }
            const ph = t * tr.hz * Math.PI * 2 + tr.beat;
            const gust = 0.05 * Math.sin(t * 1.7 + tr.gust) + 0.03 * Math.sin(t * 2.9 + tr.bob);
            const shoulder = WING.dihedral + gust + beat * WING.shoulderBeat * Math.sin(ph);
            const wrist = -0.04 + 0.5 * gust + beat * WING.wristBeat * Math.sin(ph - WING.wristLag);
            p.wings[0] = shoulder + (WING.tuckShoulder - shoulder) * tuck;
            p.wings[1] = wrist + (WING.tuckWrist - wrist) * tuck;

            // Fading out (or in): climbing away as the hour sends it home.
            if (presence < 1) {
                p.pos[1] += (1 - presence) * 45;
                p.scale *= presence;
            }
        }
        return this.poses;
    }

    /** The lean an event's own flight is designed with (null: its path's own turn). */
    leanOf(sl, pos, bow) {
        if (sl.kind === ROLE.helix) return sl.arg ? 0.7 : -0.7;
        if (sl.kind === ROLE.wing) return 0.25;
        if (sl.kind === ROLE.paint && bow) {
            // Round the bow's arc: leaning toward the bow's own axis.
            const { A } = bow;
            const st = bow.strokes[sl.arg];
            const sense = Math.sign(st.phi1 - st.phi0) || 1;
            const along = pos[0] * A[0] + pos[1] * A[1] + pos[2] * A[2];
            const ax = along * A[0] - pos[0];
            const az = along * A[2] - pos[2];
            // The heading along the stroke is d(pos)/dphi; its side (-vz, vx).
            const b = this.brush(sl.arg, 0.5, this.s[12]);
            const c = this.brush(sl.arg, 0.5 + 0.01 * sense, this.s[13]);
            const vx = c[0] - b[0];
            const vz = c[2] - b[2];
            return -0.6 * Math.sign(ax * -vz + az * vx);
        }
        return null;
    }

    /** The look of a glider in an event: mode, glow, trail, colour and size. */
    dress(i, t, sl, role, p, bow) {
        const { phase, u } = role;
        const tr = this.traits[i];
        const home = phase === 'home';
        const k = home ? 1 - smooth(0, 1, u) : 1;
        const toward = (big) => tr.size + (big - tr.size) * (phase === 'join' ? smooth(0, 1, u) : k);
        if (sl.kind === ROLE.paint) {
            const c = bow?.links?.[sl.arg];
            if (c) {
                for (let j = 0; j < 3; j++) p.colour[j] = home ? 1 + (c[j] - 1) * k : c[j];
            }
            p.mode = home ? 0 : 1;
            p.glow = home ? 0.6 * k : 1;
            if (home) p.trail = k ** 1.5;
            else p.trail = phase === 'join' ? 0.4 + 0.6 * u : 1;
            p.scale = toward(1.6);
        } else if (sl.kind === ROLE.helix) {
            const glow = home ? 0 : 1 - smooth(1.6, 2.2, t - this.helixAt);
            p.mode = home ? 0 : 2;
            p.glow = glow;
            p.trail = glow;
            if (!home) { p.colour[0] = 1.0; p.colour[1] = 0.82; p.colour[2] = 0.5; }
            p.scale = toward(1.3);
        } else if (sl.kind === ROLE.launch) {
            p.mode = home ? 0 : 3;
            p.glow = home ? 0 : 0.4 * (1 - clamp01((t - sl.t0) / 6));
        } else if (sl.kind === ROLE.wing) {
            p.mode = home ? 0 : 4;
            p.scale = toward(2.6);
            p.glow = 0.8 * k;
            p.trail = 0.8 * k;
            p.colour[0] = 1; p.colour[1] = 1 + (0.86 - 1) * k; p.colour[2] = 1 + (0.55 - 1) * k;
        }
    }
}

export { clamp };
