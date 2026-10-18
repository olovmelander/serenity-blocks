/**
 * Spring — the plan of the valley (CPU only, three-free).
 *
 * A Norrland river in its spring flood. The eye stands among flowers on a low granite knoll at
 * the outside of a bend. Up to the left the river pours over a granite step in a broad fall
 * facing the eye, churns in its plunge pool, and comes down toward the knoll in a staircase of
 * rapids; it swings round under the knoll and runs away to the right, on down the valley toward
 * the snow-patched fells. Between the two arms a wooded tongue of land; forested slopes rise on
 * both sides.
 *
 * This module owns the view, the river's course (a centripetal Catmull-Rom spline sampled every
 * half metre), its water level, depth, width and speed along that course, the fall and the
 * rapids' ledges, and the places on its banks. Metres; x right, y up, z toward the eye (the view
 * looks down −z). The river runs from s = 0 far up the valley to s = RIVER.length downstream.
 */
import {
    DEG, clamp, lerp, smooth,
} from './spring-core.js';

// ── The view ──────────────────────────────────────────────────────────────────────

/** The eye: 1.6 m over the knoll's top, about six metres above the water swinging round under it. */
export const EYE = Object.freeze({ x: 0, y: 8.2, z: 0 });
/** The knoll's height under the eye. */
export const EYE_GROUND = 6.6;

/**
 * Rest rig (degrees). Landscape looks almost level: the fall up to the left, the river leaving
 * to the right, the knoll's flowers along the bottom; a wide screen narrows the lens; portrait
 * turns left toward the fall and lifts the horizon into the strip above the card (`shift`, NDC).
 */
export const RIG = Object.freeze({
    landscape: Object.freeze({ fov: 44, yaw: 0, pitch: -4 }),
    wide: Object.freeze({ fov: 37, yaw: 0, pitch: -4 }),
    portrait: Object.freeze({
        fov: 66, yaw: -14, pitch: -2, shift: 0.62,
    }),
    near: 0.1,
    far: 30000,
});

/** The lens for an aspect ratio. */
export function rigFor(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 0.75) return RIG.portrait;
    if (a > 2.1) return RIG.wide;
    return RIG.landscape;
}

/** Bearing (degrees right of the view axis) of a ground point seen from the eye. */
export function bearingOf(x, z) {
    return Math.atan2(x - EYE.x, -(z - EYE.z)) / DEG;
}

/** The ground point at a bearing (degrees) and a distance (metres) from the eye. */
export function pointAt(bearing, distance) {
    const b = bearing * DEG;
    return { x: EYE.x + Math.sin(b) * distance, z: EYE.z - Math.cos(b) * distance };
}

// ── The river's course ────────────────────────────────────────────────────────────

/**
 * Control points (x, z, half-width), upstream first. The seventh is the fall's lip; the river
 * widens into the plunge pool under it, narrows into the rapids coming down toward the knoll,
 * swings round under it (the bend's apex, 31 m ahead of the eye) and runs away to the right.
 */
export const RIVER_POINTS = Object.freeze([
    [-1060, -2900, 46],
    [-530, -1500, 42],
    [-220, -700, 36],
    [-100, -330, 32],
    [-62, -190, 26],
    [-49, -138, 21],
    [-44, -114, 18], // the lip
    [-41, -102, 21],
    [-38, -91, 25], // the plunge pool
    [-33, -77, 21], // its outlet
    [-29, -62, 18],
    [-23, -49, 16],
    [-13, -39, 15],
    [0, -34, 14.5], // the bend under the knoll
    [13, -37, 15],
    [25, -46, 16.5],
    [36, -63, 18],
    [50, -88, 20],
    [72, -128, 22],
    [104, -186, 24],
    [160, -290, 27],
    [250, -460, 30],
    [400, -760, 34],
    [620, -1250, 38],
    [900, -1900, 42],
]);
const LIP_POINT = 6;
const POOL_OUTLET_POINT = 9;

/** The fall: the lip's level, the pool's, the water's speed over the lip (m/s). */
export const FALL = Object.freeze({
    lip: 31,
    pool: 5,
    drop: 26,
    speed: 3.4,
    gravity: 9.81,
});
/** How far (metres along the river) the water flies before it meets the pool. */
export const THROW = FALL.speed * Math.sqrt((2 * (FALL.lip - FALL.pool)) / FALL.gravity);

/**
 * The rapids' ledges below the pool: metres along the river from the pool's outlet, and the drop
 * (m). Between them the water runs in short, fast pools. Five come down toward the knoll and
 * round under it; below the bend they space out, and the river runs fast between them.
 */
export const LEDGES = Object.freeze([
    [5, 0.5], [13, 0.85], [19, 0.35], [30, 1.0], [43, 0.45], [62, 0.9], [96, 0.8], [151, 1.1],
    [238, 1.0], [335, 1.1],
].map(([at, drop]) => Object.freeze({ at, drop })));
/** A ledge's lip-to-foot length (m): the water slides down it as a chute, not over a step. */
export const LEDGE_LENGTH = 6;

/** Sampling step of the course table (m). */
export const RIVER_STEP = 0.5;

function catmullRom(p0, p1, p2, p3, t) {
    // Centripetal parameterisation (alpha 0.5): no cusps or self-loops at uneven spacing.
    const d = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);
    const u = lerp(t1, t2, t);
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const a1 = ((t1 - u) / (t1 - t0)) * p0[c] + ((u - t0) / (t1 - t0)) * p1[c];
        const a2 = ((t2 - u) / (t2 - t1)) * p1[c] + ((u - t1) / (t2 - t1)) * p2[c];
        const a3 = ((t3 - u) / (t3 - t2)) * p2[c] + ((u - t2) / (t3 - t2)) * p3[c];
        const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3;
        out[c] = ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2;
    }
    return out;
}

/** Build the course table: positions, tangents, half-widths every RIVER_STEP metres. */
function buildCourse() {
    const P = RIVER_POINTS;
    const dense = [];
    const marks = [];
    for (let i = 0; i < P.length - 1; i++) {
        marks.push(dense.length);
        const p0 = P[Math.max(0, i - 1)];
        const p1 = P[i];
        const p2 = P[i + 1];
        const p3 = P[Math.min(P.length - 1, i + 2)];
        const span = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const n = Math.max(8, Math.ceil(span / 0.1));
        for (let k = 0; k < n; k++) dense.push(catmullRom(p0, p1, p2, p3, k / n));
    }
    marks.push(dense.length);
    dense.push([...P[P.length - 1]]);
    // Arc length of the fine polyline, then resample every RIVER_STEP.
    const arc = new Float64Array(dense.length);
    for (let i = 1; i < dense.length; i++) {
        arc[i] = arc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    }
    const length = arc[arc.length - 1];
    const count = Math.floor(length / RIVER_STEP) + 1;
    const x = new Float32Array(count);
    const z = new Float32Array(count);
    const tx = new Float32Array(count);
    const tz = new Float32Array(count);
    const hw = new Float32Array(count);
    let j = 0;
    for (let k = 0; k < count; k++) {
        const s = k * RIVER_STEP;
        while (j < arc.length - 2 && arc[j + 1] < s) j++;
        const f = clamp((s - arc[j]) / Math.max(1e-6, arc[j + 1] - arc[j]), 0, 1);
        x[k] = lerp(dense[j][0], dense[j + 1][0], f);
        z[k] = lerp(dense[j][1], dense[j + 1][1], f);
        hw[k] = lerp(dense[j][2], dense[j + 1][2], f);
    }
    for (let k = 0; k < count; k++) {
        const a = Math.max(0, k - 1);
        const b = Math.min(count - 1, k + 1);
        const dx = x[b] - x[a];
        const dz = z[b] - z[a];
        const l = Math.hypot(dx, dz) || 1;
        tx[k] = dx / l;
        tz[k] = dz / l;
    }
    const sOfPoint = (i) => arc[marks[i]];
    return {
        length, count, x, z, tx, tz, hw, sLip: sOfPoint(LIP_POINT), sOutlet: sOfPoint(POOL_OUTLET_POINT),
    };
}

const COURSE = buildCourse();

/** Where along the river the fall begins (its lip), meets the pool, and the pool drains. */
export const S_LIP = COURSE.sLip;
export const S_POOL = COURSE.sLip + THROW;
export const S_OUTLET = COURSE.sOutlet;
const S_LAST_LEDGE = S_OUTLET + LEDGES[LEDGES.length - 1].at;

/** The course table (read-only views). */
export const RIVER = Object.freeze({
    length: COURSE.length,
    count: COURSE.count,
    step: RIVER_STEP,
    x: COURSE.x,
    z: COURSE.z,
    tx: COURSE.tx,
    tz: COURSE.tz,
    halfWidth: COURSE.hw,
});

/** Index-space sample of a course array at s (linear). */
function sampleCourse(array, s) {
    const f = clamp(s / RIVER_STEP, 0, RIVER.count - 1);
    const i = Math.min(RIVER.count - 2, Math.floor(f));
    return lerp(array[i], array[i + 1], f - i);
}

/** The course at s: position, flow direction (unit), half-width. */
export function courseAt(s, out = {}) {
    out.x = sampleCourse(RIVER.x, s);
    out.z = sampleCourse(RIVER.z, s);
    const tx = sampleCourse(RIVER.tx, s);
    const tz = sampleCourse(RIVER.tz, s);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.halfWidth = sampleCourse(RIVER.halfWidth, s);
    return out;
}

// ── Along the river: level, depth, speed, turbulence ─────────────────────────────

/** The water level the rapids start from (the pool's) less the ledges passed by s. */
function stairs(s) {
    let level = FALL.pool;
    for (const ledge of LEDGES) {
        const at = S_OUTLET + ledge.at;
        level -= ledge.drop * smooth(at - LEDGE_LENGTH * 0.5, at + LEDGE_LENGTH * 0.5, s);
    }
    return level;
}
const STAIRS_FOOT = (() => {
    let level = FALL.pool;
    for (const ledge of LEDGES) level -= ledge.drop;
    return level;
})();

/**
 * The water's surface level at s (m). Far up the valley it falls gently to the lip; below the
 * lip the pool lies level (the falling water itself is spring-fall-plan's); the rapids step down
 * their ledges; then the river runs on down the valley.
 */
export function levelAt(s) {
    if (s <= S_LIP) {
        // Gently down the valley to the lip.
        const u = clamp(s / S_LIP, 0, 1);
        return FALL.lip + 26 * (1 - u) ** 1.35;
    }
    if (s < S_POOL) return FALL.pool;
    if (s <= S_LAST_LEDGE + LEDGE_LENGTH) return stairs(s);
    return STAIRS_FOOT - (s - S_LAST_LEDGE - LEDGE_LENGTH) * 0.004;
}

/** The surface's slope along the river (dLevel/ds, negative downhill), by a central difference. */
export function slopeAt(s) {
    const h = 0.25;
    return (levelAt(s + h) - levelAt(s - h)) / (2 * h);
}

/** The river's depth at its middle (m). */
export function depthAt(s) {
    if (s <= S_LIP) return lerp(2.6, 1.3, smooth(S_LIP - 160, S_LIP, s));
    if (s <= S_OUTLET) return lerp(6, 2.4, smooth(S_POOL, S_OUTLET, s));
    return 1.5 + 0.35 * Math.sin(s * 0.11);
}

/** The surface speed at s (m/s): slow far up, quickening to the lip; boiling out of the pool; fast in the rapids. */
export function speedAt(s) {
    if (s <= S_LIP) return lerp(1.5, FALL.speed, smooth(S_LIP - 220, S_LIP, s) ** 1.5);
    if (s < S_POOL) return 2.8;
    if (s <= S_OUTLET) return lerp(2.8, 1.3, smooth(S_POOL, S_POOL + 20, s)) + 1.6 * smooth(S_OUTLET - 14, S_OUTLET, s);
    let v = 3.1;
    for (const ledge of LEDGES) {
        const after = s - (S_OUTLET + ledge.at);
        if (after > -LEDGE_LENGTH && after < 18) {
            v += 1.4 * Math.exp(-Math.max(0, after) / 7) * smooth(-LEDGE_LENGTH, 0, after);
        }
    }
    return v;
}

/**
 * White water at s, 0..1, before the across-stream and per-obstacle detail: the jump below every
 * ledge, a little everywhere the rapids run, almost none up the valley. (The boil where the
 * fall's tongues land is spring-fall-plan's poolBoil; the falling water whitens on its own.)
 */
export function turbulenceAt(s) {
    if (s <= S_LIP) return 0.02 + 0.1 * smooth(S_LIP - 60, S_LIP - 4, s);
    if (s < S_POOL) return 0;
    let t = 0;
    if (s > S_OUTLET - 10) {
        t = Math.max(t, 0.22);
        for (const ledge of LEDGES) {
            const after = s - (S_OUTLET + ledge.at);
            if (after > -LEDGE_LENGTH * 0.5 && after < 30) {
                const jump = smooth(-LEDGE_LENGTH * 0.5, 0.8, after) * Math.exp(-Math.max(0, after - 1) / 6);
                t = Math.max(t, Math.min(1, 0.35 + ledge.drop) * jump + 0.22);
            }
        }
    }
    return clamp(t, 0, 1);
}

// ── Nearest point on the river (CPU) ──────────────────────────────────────────────

/** Beyond this distance (m) from the control polyline the nearest point is taken from it alone. */
const FAR_ENOUGH = 600;

/** The course's s at each control point (from the table's own arc length). */
const CONTROL_S = (() => {
    const out = new Float64Array(RIVER_POINTS.length);
    let k = 0;
    for (let i = 0; i < RIVER_POINTS.length; i++) {
        const [px, pz] = RIVER_POINTS[i];
        let best = Infinity;
        for (let j = k; j < RIVER.count; j += 1) {
            const d = (RIVER.x[j] - px) ** 2 + (RIVER.z[j] - pz) ** 2;
            if (d < best) {
                best = d;
                k = j;
            } else if (d > best + 400) break;
        }
        out[i] = k * RIVER_STEP;
    }
    return out;
})();

/**
 * The nearest point of the river's course to (x, z): its s, the signed offset across the river
 * (`n` metres; positive on the near bank, the river's right as it runs), the distance and the
 * half-width there. A pass over the control polyline finds the reach, a strided pass over the
 * course table near it finds the sample, and the neighbouring segments refine it.
 */
export function riverNearest(x, z, out = {}, from = 0, to = Infinity) {
    const P = RIVER_POINTS;
    let seg = 0;
    let segF = 0;
    let segD = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
        if (CONTROL_S[i + 1] < from || CONTROL_S[i] > to) continue;
        const ax = P[i][0];
        const az = P[i][1];
        const dx = P[i + 1][0] - ax;
        const dz = P[i + 1][1] - az;
        const f = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = (ax + dx * f - x) ** 2 + (az + dz * f - z) ** 2;
        if (d < segD) {
            segD = d;
            seg = i;
            segF = f;
        }
    }
    const sApprox = clamp(lerp(CONTROL_S[seg], CONTROL_S[seg + 1], segF), from, to);
    if (segD > FAR_ENOUGH * FAR_ENOUGH) {
        // Far from the water the control polyline is near enough: skip the fine search.
        const t = courseAt(sApprox, out);
        const px = P[seg][0] + (P[seg + 1][0] - P[seg][0]) * segF;
        const pz = P[seg][1] + (P[seg + 1][1] - P[seg][1]) * segF;
        out.s = sApprox;
        out.dist = Math.sqrt(segD);
        out.n = (x - px) * -t.tz + (z - pz) * t.tx;
        out.px = px;
        out.pz = pz;
        return out;
    }
    const window = clamp(0.1 * (CONTROL_S[seg + 1] - CONTROL_S[seg]), 30, 140);
    const kFrom = Math.max(0, Math.ceil(from / RIVER_STEP));
    const kTo = Math.min(RIVER.count - 1, Math.floor(to / RIVER_STEP));
    const k0 = Math.max(kFrom, Math.floor((sApprox - window) / RIVER_STEP));
    const k1 = Math.min(kTo, Math.ceil((sApprox + window) / RIVER_STEP));
    let best = k0;
    let bestD = Infinity;
    for (let k = k0; k <= k1; k += 4) {
        const d = (RIVER.x[k] - x) ** 2 + (RIVER.z[k] - z) ** 2;
        if (d < bestD) {
            bestD = d;
            best = k;
        }
    }
    for (let k = Math.max(kFrom, best - 4); k <= Math.min(kTo, best + 4); k++) {
        const d = (RIVER.x[k] - x) ** 2 + (RIVER.z[k] - z) ** 2;
        if (d < bestD) {
            bestD = d;
            best = k;
        }
    }
    // Refine on the neighbouring segments.
    let s = best * RIVER_STEP;
    let px = RIVER.x[best];
    let pz = RIVER.z[best];
    for (const a of [best - 2, best - 1, best, best + 1]) {
        const b = a + 1;
        if (a < kFrom || b > kTo) continue;
        const ax = RIVER.x[a];
        const az = RIVER.z[a];
        const dx = RIVER.x[b] - ax;
        const dz = RIVER.z[b] - az;
        const f = clamp(((x - ax) * dx + (z - az) * dz) / Math.max(1e-9, dx * dx + dz * dz), 0, 1);
        const qx = ax + dx * f;
        const qz = az + dz * f;
        const d = (qx - x) ** 2 + (qz - z) ** 2;
        if (d <= bestD) {
            bestD = d;
            s = (a + f) * RIVER_STEP;
            px = qx;
            pz = qz;
        }
    }
    const t = courseAt(s, out);
    out.s = s;
    out.dist = Math.sqrt(bestD);
    out.n = (x - px) * -t.tz + (z - pz) * t.tx;
    out.px = px;
    out.pz = pz;
    return out;
}

// ── Places ────────────────────────────────────────────────────────────────────────

/** The fall, seen from the eye. */
export const FALL_VIEW = Object.freeze({
    bearing: bearingOf(RIVER_POINTS[LIP_POINT][0], RIVER_POINTS[LIP_POINT][1]),
    distance: Math.hypot(RIVER_POINTS[LIP_POINT][0] - EYE.x, RIVER_POINTS[LIP_POINT][1] - EYE.z),
});

/** Landmarks on the banks (x, z; yaw in degrees). */
export const PLACES = Object.freeze({
    barn: Object.freeze({ x: 132, z: -214, yaw: 30 }),
    farBirches: Object.freeze({ x: 104, z: -236, radius: 34 }),
    nearBirches: Object.freeze({ x: 9, z: -6, radius: 6 }),
    fallBirches: Object.freeze({ x: -96, z: -118, radius: 26 }),
});

// ── Boulders in the river ─────────────────────────────────────────────────────────

/**
 * The boulders the rapids break over: along each ledge's line and scattered between, a few
 * where the pool drains. `s` along the river, `n` across it (−1 … 1 of the half-width), `r` the
 * boulder's radius (m); a boulder's crown stands a third of its radius over the water.
 */
export const BOULDERS = Object.freeze((() => {
    let seed = 0xb0d1;
    const random = () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [];
    for (const ledge of LEDGES) {
        const at = S_OUTLET + ledge.at;
        const count = 2 + Math.floor(random() * 3);
        for (let k = 0; k < count; k++) {
            out.push(Object.freeze({
                s: at + (random() - 0.65) * 3, n: (random() * 2 - 1) * 0.82, r: 0.6 + random() * 1.1,
            }));
        }
        if (random() < 0.6) {
            out.push(Object.freeze({
                s: at + 6 + random() * 8, n: (random() * 2 - 1) * 0.7, r: 0.5 + random() * 0.7,
            }));
        }
    }
    for (let k = 0; k < 5; k++) {
        out.push(Object.freeze({
            s: S_OUTLET - 8 + random() * 10, n: (random() * 2 - 1) * 0.85, r: 0.8 + random() * 1.2,
        }));
    }
    return out;
})());
