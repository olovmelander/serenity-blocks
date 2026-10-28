/**
 * Forest — how the eagle owl flies: a route through the air, and the wingbeat.
 *
 * A flight is a smooth curve through a handful of waypoints (centripetal Catmull-Rom, so it never
 * loops on itself between close points), flown at a speed that rises from a drop off the perch to an
 * owl's slow cruise and falls away again for the landing, faster down a slope and slower up one.
 * Everything the bird does along it is found once, when the flight is planned, and kept in a table
 * against time: where it is, how fast, how steeply it climbs, how hard it banks into the turn (from
 * the turn's own curvature: tan(bank) = v² κ / g, eased), and how hard it must work (climbing and
 * speeding up want wingbeats; a level or falling stretch is glided). Sampling the table at any moment
 * gives the same bird at any frame rate, and a seek lands on the frame a night lived through shows.
 *
 * The wingbeat is an eagle owl's: slow and deep, the downstroke longer than the upstroke, the wing
 * fully spread and pressed forward going down, the hand flexed and turned to slice back up, the
 * wingtip lagging the arm so a wave runs out along the wing, the body lifting with each downstroke
 * while the head stays still.
 *
 * No three.js here: the mind, the tests and the Blender previews share it.
 */

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};

export const OWL_FLIGHT = Object.freeze({
    /** Metres a second: off the perch, cruising, touching down. */
    launch: 1.8,
    cruise: 6.4,
    touch: 1.3,
    /** Over how many metres it gathers speed, and sheds it before the perch. */
    gather: 3.6,
    shed: 5.5,
    /** Wingbeats a second (an eagle owl's are slow), and a little quicker taking off. */
    beat: 2.3,
    beatLaunch: 2.9,
    /** The steepest bank, degrees, and the fastest its heading turns, radians a second. */
    bank: 52,
    turnRate: 6,
    /** Stations per route the tables hold. */
    stations: 480,
});

// -- the curve ------------------------------------------------------------------------------
/** A point on a centripetal Catmull-Rom segment between p1 and p2 at t in 0..1. */
function centripetal(p0, p1, p2, p3, t, out) {
    const knot = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const u = t1 + (t2 - t1) * t;
    for (let k = 0; k < 3; k += 1) {
        const a1 = ((t1 - u) * p0[k] + (u - t0) * p1[k]) / (t1 - t0);
        const a2 = ((t2 - u) * p1[k] + (u - t1) * p2[k]) / (t2 - t1);
        const a3 = ((t3 - u) * p2[k] + (u - t2) * p3[k]) / (t3 - t2);
        const b1 = ((t2 - u) * a1 + (u - t0) * a2) / (t2 - t0);
        const b2 = ((t3 - u) * a2 + (u - t1) * a3) / (t3 - t1);
        out[k] = ((t2 - u) * b1 + (u - t1) * b2) / (t2 - t1);
    }
    return out;
}

/** Dense points along the curve through `points` (ends extended straight on). */
function trace(points, count) {
    const n = points.length;
    const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
    const all = [ext(points[0], points[1]), ...points, ext(points[n - 1], points[n - 2])];
    // Share the samples out by chord length so the trace is even.
    const chords = [];
    for (let i = 1; i < all.length - 2; i += 1) {
        const a = all[i];
        const b = all[i + 1];
        chords.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = chords.reduce((s, c) => s + c, 0) || 1;
    const out = [];
    chords.forEach((chord, i) => {
        const m = Math.max(4, Math.round((count * chord) / total));
        for (let k = 0; k < m; k += 1) {
            out.push(centripetal(all[i], all[i + 1], all[i + 2], all[i + 3], k / m, [0, 0, 0]));
        }
    });
    out.push(points[n - 1].slice());
    return out;
}

/**
 * Plan a flight through `points` (body-centre positions, metres; the first is where it leaves, the last
 * where it lands). `work` (0..1) is how hard it flies anyway (a hunter's climb, a showpiece), `cruise`
 * its speed. A flight that `enter`s comes in from beyond the frame already at speed (no take-off); one
 * that `exit`s leaves the frame still at speed (no landing). Returns a table to sample with `sampleFlight`.
 */
export function planFlight(points, {
    cruise = OWL_FLIGHT.cruise, work = 0, beat = OWL_FLIGHT.beat, enter = false, exit = false,
} = {}) {
    const raw = trace(points, OWL_FLIGHT.stations);
    // Arc length.
    const n = raw.length;
    const s = new Float64Array(n);
    for (let i = 1; i < n; i += 1) {
        const a = raw[i - 1];
        const b = raw[i];
        s[i] = s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const length = s[n - 1];
    // Tangents (central differences) and slope.
    const tangent = raw.map((p, i) => {
        const a = raw[Math.max(0, i - 1)];
        const b = raw[Math.min(n - 1, i + 1)];
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l = Math.hypot(...d) || 1;
        return d.map((c) => c / l);
    });
    // Speed: gather, shed, and the slope's pull.
    const speed = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
        const slope = tangent[i][1];
        const base = cruise * (1 - 0.32 * Math.max(-1, Math.min(1, slope * 1.6)));
        const gathered = smooth(0, OWL_FLIGHT.gather, s[i]);
        const shedding = smooth(0, OWL_FLIGHT.shed, length - s[i]);
        const gather = enter ? base : OWL_FLIGHT.launch + (base - OWL_FLIGHT.launch) * gathered;
        const shed = exit ? base : OWL_FLIGHT.touch + (base - OWL_FLIGHT.touch) * shedding;
        speed[i] = Math.max(0.6, Math.min(gather, shed));
    }
    // Time along it.
    const time = new Float64Array(n);
    for (let i = 1; i < n; i += 1) time[i] = time[i - 1] + (s[i] - s[i - 1]) / (0.5 * (speed[i] + speed[i - 1]));
    const duration = time[n - 1];
    // Heading: the way it travels over the ground. Where the path runs nearly straight up or down that is
    // not defined, so the heading holds what it was (or what it will be) and only follows the path as the
    // path leans over; unwrapped, so a turn through south never jumps by a whole turn.
    const flatness = (d) => clamp01((Math.hypot(d[0], d[2]) - 0.08) / 0.3);
    let anchor = tangent.findIndex((d) => flatness(d) > 0.5);
    if (anchor < 0) anchor = 0;
    let held = Math.atan2(tangent[anchor][0], tangent[anchor][2]);
    const headingRaw = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
        const d = tangent[i];
        const toward = Math.atan2(d[0], d[2]);
        held += Math.atan2(Math.sin(toward - held), Math.cos(toward - held)) * flatness(d);
        headingRaw[i] = held;
    }
    // A bird turns its body only so fast (near a stop on a short hop the path's last wiggles would spin it):
    // the heading follows at most OWL_FLIGHT.turnRate, run both ways so it neither lags nor leads.
    const limited = Float64Array.from(headingRaw);
    for (let pass = 0; pass < 2; pass += 1) {
        const order = pass === 0 ? 1 : -1;
        for (let k = 1; k < n; k += 1) {
            const i = order > 0 ? k : n - 1 - k;
            const j = i - order;
            const step = OWL_FLIGHT.turnRate * Math.abs(time[i] - time[j]);
            limited[i] = limited[j] + Math.max(-step, Math.min(step, limited[i] - limited[j]));
        }
    }
    const heading = smoothTable(limited, time, 0.12);
    // Bank: the horizontal turn's lateral acceleration, a² = v² κ, signed (+ = turning left).
    const bank = new Float64Array(n);
    for (let i = 1; i < n - 1; i += 1) {
        const turn = heading[i + 1] - heading[i - 1];
        const ds = s[i + 1] - s[i - 1] || 1e-3;
        const horizontal = Math.hypot(tangent[i][0], tangent[i][2]);
        const lateral = speed[i] * speed[i] * (turn / ds) * horizontal;
        bank[i] = Math.atan(lateral / 9.81) / DEG;
    }
    // Ease the bank (half a second each way), and hold it level at both ends.
    const eased = smoothTable(bank, time, 0.45).map((b, i) => {
        const ends = (enter ? 1 : smooth(0, 1.2, s[i])) * (exit ? 1 : smooth(0, 2.2, length - s[i]));
        return Math.max(-OWL_FLIGHT.bank, Math.min(OWL_FLIGHT.bank, b)) * ends;
    });
    // Work: climbing and speeding up want wingbeats; the first stretch off the perch is all wingbeat.
    const effort = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
        const i2 = Math.min(n - 1, i + 1);
        const accel = (speed[i2] - speed[i]) / Math.max(1e-3, time[i2] - time[i]);
        const climb = tangent[i][1] * speed[i];
        const launch = enter ? 0 : 1 - smooth(1.5, 6, s[i]);
        effort[i] = clamp01(Math.max(work, launch, climb * 0.55 + 0.12 + accel * 0.12 + Math.abs(eased[i]) / 140));
    }
    const amp = smoothTable(effort, time, 0.6).map((e) => smooth(0.18, 0.62, e));
    // The wingbeat's phase, its rate a little quicker while it labours.
    const phase = new Float64Array(n);
    for (let i = 1; i < n; i += 1) {
        const rate = beat + (OWL_FLIGHT.beatLaunch - beat) * amp[i] * (enter ? 0 : 1 - smooth(2, 8, s[i]));
        phase[i] = phase[i - 1] + rate * (time[i] - time[i - 1]);
    }
    // The body's nose follows the path's climb, eased over a quarter second (a kink never jerks it).
    const climb = smoothTable(tangent.map((d) => Math.atan2(d[1], Math.hypot(d[0], d[2])) / DEG), time, 0.25);
    return {
        points: raw, s, time, speed, tangent, heading, bank: eased, climb, amp, phase, length, duration,
    };
}

/** Box-smooth a table over `window` seconds (each side), by time. */
function smoothTable(values, time, window) {
    const n = values.length;
    const out = new Array(n);
    let lo = 0;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
        while (hi < n && time[hi] <= time[i] + window) {
            sum += values[hi];
            hi += 1;
        }
        while (time[lo] < time[i] - window) {
            sum -= values[lo];
            lo += 1;
        }
        out[i] = sum / Math.max(1, hi - lo);
    }
    return out;
}

/**
 * The flight at `t` seconds: `out` gets position (x, y, z), velocity, heading (radians about y),
 * climb (degrees), bank (degrees), the wingbeat's phase and amplitude, and how far through it is.
 */
export function sampleFlight(flight, t, out = {}) {
    const { time } = flight;
    const n = time.length;
    const tc = Math.max(0, Math.min(flight.duration, t));
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (time[mid] <= tc) lo = mid;
        else hi = mid;
    }
    const span = time[hi] - time[lo] || 1;
    const k = (tc - time[lo]) / span;
    const lerp = (a, b) => a + (b - a) * k;
    const pa = flight.points[lo];
    const pb = flight.points[hi];
    out.x = lerp(pa[0], pb[0]);
    out.y = lerp(pa[1], pb[1]);
    out.z = lerp(pa[2], pb[2]);
    const ta = flight.tangent[lo];
    const tb = flight.tangent[hi];
    const tx = lerp(ta[0], tb[0]);
    const ty = lerp(ta[1], tb[1]);
    const tz = lerp(ta[2], tb[2]);
    const v = lerp(flight.speed[lo], flight.speed[hi]);
    out.vx = tx * v;
    out.vy = ty * v;
    out.vz = tz * v;
    out.speed = v;
    out.heading = lerp(flight.heading[lo], flight.heading[hi]);
    out.climb = lerp(flight.climb[lo], flight.climb[hi]);
    out.bank = lerp(flight.bank[lo], flight.bank[hi]);
    out.amp = lerp(flight.amp[lo], flight.amp[hi]);
    out.phase = lerp(flight.phase[lo], flight.phase[hi]);
    out.progress = tc / Math.max(1e-6, flight.duration);
    out.left = flight.duration - tc;
    return out;
}

// -- the wingbeat ---------------------------------------------------------------------------
/** The downstroke's share of a beat. */
const DOWN = 0.56;

/** Phase in beats -> the stroke's own clock u (0 top, 0.5 bottom, 1 top again). */
export function strokeClock(phase) {
    const f = phase - Math.floor(phase);
    return f < DOWN ? (f / DOWN) * 0.5 : 0.5 + ((f - DOWN) / (1 - DOWN)) * 0.5;
}

/**
 * Write a wing's numbers for a beat at `phase` (beats) of amplitude `amp` (0 glides, 1 a full beat)
 * onto `w` (forest-owl-rig.js createWingPose); `glide` sets the resting dihedral. Returns the body's
 * lift (metres) and pitch nudge (degrees) the beat gives.
 */
export function wingbeat(phase, amp, w, { glide = 7, out = { lift: 0, pitch: 0, tail: 0 } } = {}) {
    const u = strokeClock(phase);
    const c = Math.cos(2 * Math.PI * u);
    const s = Math.sin(2 * Math.PI * u);
    const up = Math.max(0, -s);
    const down = Math.max(0, s);
    // The wingtip lags the arm by an eighth of a beat: a wave runs out along the wing.
    const lag = Math.cos(2 * Math.PI * (u - 0.13));
    w.fold = 0;
    w.dihedral = glide + amp * (31 * c + 4);
    w.sweep = amp * (-7 * s - 2 * up);
    w.twist = 2 + amp * (-5 * down + 9 * up);
    w.flex = amp * 0.58 * up ** 0.8;
    w.handTwist = amp * 34 * up;
    w.tip = amp * (-13 * lag);
    w.fan = 1 + amp * (0.07 * s - 0.05 * up);
    w.load = 0.32 + amp * (1.0 * down - 0.55 * up);
    w.alula = 0;
    // The body rides up on the downstroke and sinks on the upstroke; it pitches with it.
    out.lift = amp * 0.022 * -Math.cos(2 * Math.PI * u);
    out.pitch = amp * 1.8 * s;
    out.tail = amp * 3.5 * c;
    return out;
}
