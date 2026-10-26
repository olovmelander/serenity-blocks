/* eslint-disable max-classes-per-file */
/**
 * Grainfields — how the geese fly (three-free: the vertex stage in grainfields-geese.js only folds
 * each bird's wings by the hinge angles written here and sets it where this module puts it).
 *
 * The bean geese of the goose valley, in two kinds of skein:
 *  - CROSSINGS: skeins passing over the fields by themselves, each a long V a kilometre out
 *    crossing the whole view and coming round again a few minutes later. The V is a living
 *    one (each bird keeps station a little loosely, the arms are rarely equal) and every bird
 *    beats steadily, now and then setting its wings for a short glide.
 *  - FLIGHTS OUT: on a level-up (or a fever, or a perfect clear) a flock bursts out of the
 *    barley in front of the eye. The geese go up one after another in a second or so, each with
 *    a deep, hard take-off stroke, the body pitched up; they climb steeply, gather speed, bank
 *    round onto the heading for Lapporten and close up into a V as they settle into the cruise
 *    beat, then fly out toward the gate, smaller and hazier until they are gone. Where they go
 *    up is chosen when they do: the route that keeps the flock in the open (clear of the board,
 *    the stats and the frame's edges) for longest, read through the rest camera.
 *
 * Everything is a function of the clock and the launches (no state integrated frame to frame),
 * so a seek lands right. Each frame `write()` poses the birds in sight into one instance array:
 * place and drawn size, heading and up (the bank leaning into a turn), the wingbeat's heave and
 * the five hinge angles of the wing (lift, sweep, bend, fold, curl), built from the poses the
 * Blender script authored (scripts/blender/grainfields/goose.py) and wrote into the manifest.
 */
import manifest from './assets/asset-manifest.json';
import {
    DEG, EYE, PLACES, TAU, clamp, rigFor, smooth,
} from './grainfields-core.js';
import { groundHeight, nearField } from './grainfields-plan.js';
import { outsideKeepOut } from './grainfields-composition.js';

const record = manifest.assets.find((entry) => entry.kind === 'goose');

/** The rig the model was built on: hinge pivots, the bands they take hold over, the poses. */
export const GOOSE_RIG = Object.freeze(record?.rig ?? {
    span: 1.6,
    length: 0.8,
    shoulder: [0.072, 0.036, 0.05],
    wrist: [0.372, 0.036, 0.118],
    poses: {},
});
/** A bean goose's span (m); the model is real size. */
export const GOOSE_SPAN = GOOSE_RIG.span;

/** Floats a bird in the instance array: place + size, forward + heave, up + lift, sweep bend fold curl. */
export const GOOSE_STRIDE = 16;

/**
 * Wingbeats a second: a goose's steady cruise and the take-off's hard strokes (the beat eases
 * from one to the other over `settle` seconds), and each bird's own spread about the cruise.
 */
export const GOOSE_BEAT = Object.freeze({
    cruise: 2.9, takeoff: 3.8, settle: 2.4, spread: 0.05,
});

/** The smallest span a bird is drawn at (pixels): far skeins stay a readable size. */
export const GOOSE_MIN_PX = 7;

/**
 * A flight out (metres, seconds): its speed off the ground and in the cruise and how fast it
 * gathers it; the climb (a steep first rise of `rise` metres over `riseTime`, then a steady
 * `climb` m/s); the smooth start; when the flock closes into its V (from `join[0]` to
 * `join[1]` after the first bird is up); the first bird to the last (`stagger`); how far the
 * flock is spread over the field (`spread`: across, along); how high a bird sits in the
 * barley before it goes; how far the body pitches up on the first strokes (rad); and when the
 * least size is let go (`fade`) and the birds are gone (`gone`).
 */
export const FLIGHT_OUT = Object.freeze({
    v0: 4.5,
    cruise: 17.5,
    accel: 3.2,
    rise: 15,
    riseTime: 3.0,
    climb: 0.9,
    start: 0.35,
    join: Object.freeze([3, 20]),
    stagger: 1.3,
    spread: Object.freeze([8, 5.5]),
    sit: 0.25,
    attack: 0.3,
    fade: Object.freeze([50, 85]),
    gone: Object.freeze([95, 105]),
});

/** How long a flight out is in the air (s). */
export const FLIGHT_LIFE = FLIGHT_OUT.gone[1];

/** The V, in spans: each rank this far out to the side and back from the one ahead. */
const V_SHAPE = Object.freeze({ out: 0.8, back: 1.05, rise: 0.05 });

/** How far a bird leans into its turns, as a share of a coordinated turn's bank (and at most). */
const BANK = Object.freeze({ share: 0.85, most: 0.6 });

/**
 * The skeins that cross by themselves: where their line runs (a start and an end, metres),
 * how high (over the fells' summits from the eye, so they are seen against the sky), how fast (m/s), how many birds at most, how long a round takes and where in it the
 * clock starts, and how far the line sways across its heading (amplitude, wavelength m).
 */
export const CROSSINGS = Object.freeze([
    Object.freeze({
        key: 'a', from: [-1400, -620], to: [1500, -780], y: 185, speed: 17, birds: 13, period: 210, phase: 30, sway: [26, 900], seed: 0x6e51,
    }),
    Object.freeze({
        key: 'b', from: [1600, -1250], to: [-1700, -1100], y: 300, speed: 15, birds: 9, period: 260, phase: 160, sway: [34, 1300], seed: 0x6e52,
    }),
]);
/** A crossing's run starts this far before its line (and ends as far past it). */
const CROSSING_LEAD = 200;

const POSE_KEYS = Object.freeze(['lift', 'sweep', 'bend', 'fold', 'curl']);
const ZERO_POSE = Object.freeze({
    lift: 0, sweep: 0, bend: 0, fold: 0, curl: 0,
});
const poseOf = (name) => ({ ...ZERO_POSE, ...(GOOSE_RIG.poses?.[name] || {}) });

/**
 * A beat from four authored poses: X(φ) = A + B cos φ + C sin φ + D sin² φ hits `top` at φ = 0,
 * `down` at π/2 (mid downstroke), `bottom` at π and `up` at 3π/2 (mid upstroke), smooth round.
 */
function fitCycle(top, down, bottom, up) {
    return Object.freeze(Object.fromEntries(POSE_KEYS.map((key) => {
        const A = 0.5 * (top[key] + bottom[key]);
        const B = 0.5 * (top[key] - bottom[key]);
        const C = 0.5 * (down[key] - up[key]);
        const D = 0.5 * (down[key] + up[key]) - A;
        return [key, Object.freeze([A, B, C, D])];
    })));
}

export const CRUISE_BEAT = fitCycle(poseOf('top'), poseOf('down'), poseOf('bottom'), poseOf('up'));
export const TAKEOFF_BEAT = fitCycle(
    poseOf('takeoffTop'),
    poseOf('takeoffDown'),
    poseOf('takeoffBottom'),
    poseOf('takeoffUp'),
);
export const GLIDE_POSE = Object.freeze(poseOf('glide'));

/**
 * The downstroke takes longer than the upstroke (58 % of the beat): the beat's phase θ (uniform
 * in time) is warped to the poses' φ = θ + w (1 − cos θ), monotonic, φ(π·1.16) = π.
 */
const STROKE_WARP = -0.268;
export const strokePhase = (theta) => theta + STROKE_WARP * (1 - Math.cos(theta));

/**
 * The wing's hinge angles at beat phase `theta`: the cruise beat blended toward the take-off's
 * by `effort` (0..1), then from the glide by `flap` (0 a glide … 1 beating).
 */
export function wingPose(theta, effort = 0, flap = 1, out = {}) {
    const phi = strokePhase(theta);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const e = clamp(effort, 0, 1);
    const f = clamp(flap, 0, 1);
    for (const key of POSE_KEYS) {
        const [A, B, C, D] = CRUISE_BEAT[key];
        const [a, b, cc, d] = TAKEOFF_BEAT[key];
        const cruise = A + B * c + C * s + D * s * s;
        const hard = a + b * c + cc * s + d * s * s;
        const beat = cruise + (hard - cruise) * e;
        out[key] = GLIDE_POSE[key] + (beat - GLIDE_POSE[key]) * f;
    }
    // The body rides up on the downstroke and sinks on the upstroke (metres, the bird's frame).
    out.heave = -(0.016 + 0.03 * e) * c * f;
    return out;
}

const rotate = (a, b, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a * c - b * s, a * s + b * c];
};

/**
 * Fold a rest-pose point `p` ([x, y, z], the bird's frame: x its left, y up, z forward) by its
 * hinge weights `w` ([arm, hand, tip]) into `pose`: about the wrist, then the shoulder. The
 * vertex stage's twin (and goose.py's fold()).
 */
export function foldPoint(p, w, pose, out = [0, 0, 0]) {
    const [Sx, Sy, Sz] = GOOSE_RIG.shoulder;
    const [Wx, Wy, Wz] = GOOSE_RIG.wrist;
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

/** A small seeded generator (the theme's mulberry32, kept local so this module stays three-free). */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** How many birds each skein has on a tier whose budget is `birds` (and the budget itself). */
export function gooseFlockSizes(birds) {
    const pool = Math.max(3, Math.round(Number.isFinite(birds) ? birds : 26));
    const out = clamp(Math.round(pool * 0.42), 3, 13);
    const a = clamp(Math.min(Math.round(pool * 0.5), pool - out), 3, CROSSINGS[0].birds);
    const b = clamp(Math.round(pool * 0.35), 3, CROSSINGS[1].birds);
    return {
        pool, out, crossings: [a, b],
    };
}

/**
 * The V's slots for n birds (spans: x across, positive the leader's right; z along, negative
 * behind; y up): the leader at the point, the arms seldom equal.
 */
function vSlots(n, random) {
    const others = n - 1;
    const lean = others > 2 ? Math.round((random() - 0.5) * 2.2) : 0;
    const left = clamp(Math.ceil(others / 2) + lean, 0, others);
    const slots = [[0, 0, 0]];
    let l = 0;
    let r = 0;
    for (let k = 0; k < others; k += 1) {
        const goLeft = (l < left && (k % 2 === 0 || r >= others - left));
        const rank = goLeft ? (l += 1) : (r += 1);
        const side = goLeft ? -1 : 1;
        slots.push([side * rank * V_SHAPE.out, rank * V_SHAPE.rise, -rank * V_SHAPE.back]);
    }
    return slots;
}

/** Each bird's own looseness in its slot: three slow wanders (spans, rates per second, phases). */
function wanderOf(random) {
    return [
        0.13, 0.045 + random() * 0.06, random() * TAU,
        0.09, 0.035 + random() * 0.05, random() * TAU,
        0.24, 0.025 + random() * 0.04, random() * TAU,
    ];
}

const wanderAt = (w, t, out) => {
    out[0] = w[0] * Math.sin(t * w[1] * TAU + w[2]);
    out[1] = w[3] * Math.sin(t * w[4] * TAU + w[5]);
    out[2] = w[6] * Math.sin(t * w[7] * TAU + w[8]);
    return out;
};

// ── The rest camera (for choosing routes) ─────────────────────────────────────

/**
 * The rest lens for an aspect, as a projector of world points to screen fractions (x right,
 * y down; null behind the eye): the theme's pose() at time 0 with no pointer.
 */
export function restProjector(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const rig = rigFor(a);
    const tanH = Math.tan(rig.fov * DEG * 0.5);
    const yaw = rig.yaw * DEG;
    const pitch = rig.pitch * DEG;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const shift = rig.shift || 0;
    return (x, y, z, out = { x: 0, y: 0 }) => {
        const dx = x - EYE.x;
        const dy = y - EYE.y;
        const dz = z - EYE.z;
        // Undo the yaw (about y), then the pitch (about x): the camera's own frame.
        const vx = dx * cy + dz * sy;
        const vz0 = -dx * sy + dz * cy;
        const vy = dy * cp + vz0 * sp;
        const vz = -dy * sp + vz0 * cp;
        if (vz > -0.5) return null;
        out.x = 0.5 + (vx / (-vz * tanH * a)) * 0.5;
        out.y = 0.5 - ((vy / (-vz * tanH)) + shift) * 0.5;
        return out;
    };
}

// ── A flight out's route ──────────────────────────────────────────────────────

const STEP = 4;

/** The ground track: a heading from `psi0` easing onto `psiGate` between d1 and d2 metres along. */
function headingAt(route, d) {
    return route.psi0 + (route.psiGate - route.psi0) * smooth(route.d1, route.d2, d);
}

/** Lay the ground track out from the site (x, z every STEP metres to `reach`, and back behind it). */
function layTrack(route, reach) {
    const n = Math.ceil(reach / STEP) + 1;
    const back = Math.ceil(60 / STEP);
    const xs = new Float64Array(n + back);
    const zs = new Float64Array(n + back);
    xs[back] = route.x;
    zs[back] = route.z;
    for (let i = 1; i < n; i += 1) {
        const h = headingAt(route, (i - 0.5) * STEP);
        xs[back + i] = xs[back + i - 1] + Math.sin(h) * STEP;
        zs[back + i] = zs[back + i - 1] - Math.cos(h) * STEP;
    }
    for (let i = 1; i <= back; i += 1) {
        xs[back - i] = route.x - Math.sin(route.psi0) * STEP * i;
        zs[back - i] = route.z + Math.cos(route.psi0) * STEP * i;
    }
    return {
        xs, zs, back, n,
    };
}

/**
 * A point on the track `d` metres along (x, z, heading): cubic Hermite between the laid points
 * with the heading's own tangents, so the path bends smoothly (its turn is read off it).
 */
function trackAt(route, track, d, out) {
    const f = d / STEP + track.back;
    const i = clamp(Math.floor(f), 0, track.xs.length - 2);
    const t = Math.min(1, Math.max(0, f - i));
    const tail = f > track.xs.length - 1 ? (f - (track.xs.length - 1)) * STEP : 0;
    const psi = headingAt(route, d);
    const h0 = headingAt(route, (i - track.back) * STEP);
    const h1 = headingAt(route, (i + 1 - track.back) * STEP);
    const t2 = t * t;
    const t3 = t2 * t;
    const a = 2 * t3 - 3 * t2 + 1;
    const b = (t3 - 2 * t2 + t) * STEP;
    const c = -2 * t3 + 3 * t2;
    const e = (t3 - t2) * STEP;
    out[0] = a * track.xs[i] + b * Math.sin(h0) + c * track.xs[i + 1] + e * Math.sin(h1) + Math.sin(psi) * tail;
    out[1] = a * track.zs[i] - b * Math.cos(h0) + c * track.zs[i + 1] - e * Math.cos(h1) - Math.cos(psi) * tail;
    out[2] = psi;
    return out;
}

/** The smooth start: a bird's own clock eases from rest (its first stroke out of the barley). */
const started = (s) => (s <= 0 ? 0 : s - FLIGHT_OUT.start * (1 - Math.exp(-s / FLIGHT_OUT.start)));
/** Metres along the track and over the field after `s` seconds of a bird's own flight. */
const along = (s) => {
    const F = FLIGHT_OUT;
    return F.cruise * s - (F.cruise - F.v0) * F.accel * (1 - Math.exp(-s / F.accel));
};
const rise = (s) => FLIGHT_OUT.rise * (1 - Math.exp(-s / FLIGHT_OUT.riseTime)) + FLIGHT_OUT.climb * s;
/** How hard a bird works (1 the take-off's strokes … 0 the cruise). */
const effortAt = (s) => Math.exp(-Math.max(0, s) / GOOSE_BEAT.settle);
/** The beat's phase (radians) after `s` seconds of a bird's own flight: the integral of its rate. */
const beatPhase = (s, cruiseHz) => {
    const B = GOOSE_BEAT;
    return TAU * (cruiseHz * s + (B.takeoff - cruiseHz) * B.settle * (1 - Math.exp(-s / B.settle)));
};

/** How far out a flight may go up (m): inside the near field, before its crest. */
const TAKEOFF_DISTANCES = Object.freeze([44, 54, 66, 78]);

/** The route's straight-line samples through the rest lens (for scoring). */
const SCORE_TIMES = Object.freeze([0.5, 0.9, 1.4, 2, 2.7, 3.5, 4.5, 5.5, 7, 9, 11, 14, 17, 21, 25, 30]);
const scoreWeight = (t) => {
    if (t < 6) return 2;
    return t < 15 ? 1 : 0.5;
};

/**
 * Where a flight out goes up and which way it first heads, for the layout on screen (screen
 * fractions, as grainfields-composition.js reads them) and the aspect: every site in the near
 * field across the frame and every first heading is flown through the rest lens, and the route
 * that keeps the flock in the open longest (its first seconds count double) wins; `seed` stirs
 * near-equal routes so one launch after another need not go up from the same spot.
 */
export function planTakeoff({ layout = null, aspect = 16 / 9, seed = 1 } = {}) {
    const routes = scoredRoutes(layout, aspect);
    const random = seeded(0x9e3779b9 ^ Math.round(seed * 7919));
    let best = null;
    let bestScore = -Infinity;
    for (const route of routes) {
        const score = route.score + random() * 0.6;
        if (score > bestScore) {
            best = route;
            bestScore = score;
        }
    }
    return best ? { ...best } : null;
}

let routeCache = { key: null, routes: null };

/** A layout's key (its rects, to a thousandth of the screen) and the aspect's. */
function layoutKey(layout, aspect) {
    const r = (q) => (q ? [q.x0, q.y0, q.x1, q.y1].map((v) => Math.round(v * 1000)).join(',') : '-');
    return [Math.round(aspect * 1000), ...(layout?.cards || []).map(r), r(layout?.hud)].join('|');
}

/** Every candidate route with how long it keeps the flock in the open (cached per layout). */
function scoredRoutes(layout, aspect) {
    const key = layoutKey(layout, aspect);
    if (routeCache.key === key) return routeCache.routes;
    const project = restProjector(aspect);
    const rig = rigFor(aspect);
    const half = Math.atan(Math.tan(rig.fov * DEG * 0.5) * aspect) / DEG;
    const routes = [];
    const margin = { x: 0.014, y: 0.02 };
    const p = { x: 0, y: 0 };
    const at = [0, 0, 0];
    const seen = (x, y, z) => {
        const s = project(x, y, z, p);
        if (!s || s.x < 0.03 || s.x > 0.97 || s.y < 0.04 || s.y > 0.96) return false;
        return !layout || outsideKeepOut(layout, s, margin);
    };
    for (let bearing = rig.yaw - half + 3; bearing <= rig.yaw + half - 3; bearing += 2) {
        for (const distance of TAKEOFF_DISTANCES) {
            const sx = EYE.x + Math.sin(bearing * DEG) * distance;
            const sz = EYE.z - Math.cos(bearing * DEG) * distance;
            // The near field only (the far land lies below the crest's line of ears).
            if (nearField(sx, sz).behind > 0) continue;
            const ground = groundHeight(sx, sz);
            const psiGate = Math.atan2(PLACES.gate.x - sx, -(PLACES.gate.z - sz));
            for (const turn of [-60, -40, -20, 0, 20, 40, 60]) {
                const route = {
                    x: sx, z: sz, ground, psi0: psiGate + turn * DEG, psiGate, d1: 25, d2: 25 + 2.2 * Math.abs(turn),
                };
                const track = layTrack(route, 520);
                let score = 0;
                for (const t of SCORE_TIMES) {
                    const s = started(t);
                    trackAt(route, track, along(s), at);
                    const y = ground + FLIGHT_OUT.sit + rise(s);
                    const w = scoreWeight(t);
                    if (seen(at[0], y, at[1])) score += w;
                    if (t < 5) {
                        // The flock's spread across its line, early on (a few birds either side).
                        const cx = Math.cos(at[2]) * FLIGHT_OUT.spread[0] * 0.8;
                        const cz = Math.sin(at[2]) * FLIGHT_OUT.spread[0] * 0.8;
                        if (seen(at[0] + cx, y, at[1] + cz)) score += w * 0.4;
                        if (seen(at[0] - cx, y, at[1] - cz)) score += w * 0.4;
                    }
                }
                // A turn shows the flock side on and banking; a nearer site shows it larger.
                score += 0.03 * Math.min(Math.abs(turn), 40) - 0.02 * distance;
                routes.push({
                    ...route, bearing, distance, turn, score,
                });
            }
        }
    }
    routeCache = { key, routes };
    return routes;
}

// ── The flocks ────────────────────────────────────────────────────────────────

/** A flight out: its route, laid track and birds (delay, place in the flock, slot in the V, rhythm). */
class FlightOut {
    constructor(size, key) {
        this.size = size;
        this.key = key;
        this.at = -1e9;
        this.route = null;
        this.track = null;
        this.birds = [];
    }

    launch(time, route, seed) {
        this.at = time;
        this.route = route;
        this.track = layTrack(route, FLIGHT_OUT.cruise * (FLIGHT_LIFE + 10) + 80);
        const random = seeded(0x51ee5e ^ Math.round(seed * 104729));
        const n = this.size;
        // Who goes up when: one bird first, the rest within a second or so, a straggler last.
        const delays = [0];
        for (let i = 1; i < n; i += 1) delays.push(0.1 + FLIGHT_OUT.stagger * random() ** 1.35);
        delays.sort((a, b) => a - b);
        const slots = vSlots(n, random);
        // Where each sits in the barley: scattered over the field, the first ones up toward the front.
        const spots = [];
        for (let i = 0; i < n; i += 1) {
            const r = Math.sqrt(random());
            const a = random() * TAU;
            spots.push([Math.cos(a) * r * FLIGHT_OUT.spread[0], 0, Math.sin(a) * r * FLIGHT_OUT.spread[1]]);
        }
        spots.sort((p, q) => q[2] - p[2]);
        this.birds = delays.map((delay, i) => ({
            delay,
            spot: spots[(i + Math.floor(random() * 2)) % n],
            slot: slots[i],
            wander: wanderOf(random),
            hz: GOOSE_BEAT.cruise * (1 + (random() - 0.5) * 2 * GOOSE_BEAT.spread),
            phase: random() * 0.35,
        }));
        return this;
    }

    reset() {
        this.at = -1e9;
        this.route = null;
    }

    age(time) { return time - this.at; }

    live(time) {
        const a = this.age(time);
        return this.route !== null && a >= 0 && a < FLIGHT_LIFE;
    }
}

/**
 * Every goose over the fields: the two crossings and up to two flights out at once (a new one
 * takes the older's place). `write()` poses the birds in sight.
 */
export class GooseSkies {
    /** @param {number} birds the tier's budget (gooseFlockSizes) */
    constructor(birds = 26) {
        const sizes = gooseFlockSizes(birds);
        this.sizes = sizes;
        this.pool = sizes.pool;
        this.flights = [new FlightOut(sizes.out, 'out'), new FlightOut(sizes.out, 'out')];
        this.newest = 0;
        this.launches = 0;
        this.crossings = CROSSINGS.map((c, k) => {
            const random = seeded(c.seed);
            const n = sizes.crossings[k];
            return {
                ...c,
                n,
                slots: vSlots(n, random),
                birds: Array.from({ length: n }, () => ({
                    wander: wanderOf(random),
                    hz: GOOSE_BEAT.cruise * (1 + (random() - 0.5) * 2 * GOOSE_BEAT.spread),
                    phase: random() * TAU,
                    glide: random() * 100,
                })),
                dir: (() => {
                    const dx = c.to[0] - c.from[0];
                    const dz = c.to[1] - c.from[1];
                    const len = Math.hypot(dx, dz);
                    return [dx / len, dz / len, len];
                })(),
            };
        });
        this._p = [0, 0, 0];
        this._q = [0, 0, 0];
        this._r = [0, 0, 0];
        this._w = [0, 0, 0];
        this._t = [0, 0, 0];
        this._before = [0, 0, 0];
        this._mid = [0, 0, 0];
        this._after = [0, 0, 0];
        this._own = [0];
        this._fwd = [0, 0, 1];
        this._up = [0, 1, 0];
        this._pose = {};
        this._frame = { fwd: this._fwd, up: this._up };
        this.drawn = 0;
    }

    /** A flight out goes up at `time` along `route` (planTakeoff); it takes the older flight's place. */
    launch(time, route) {
        if (!route) return false;
        const older = this.flights[0].at <= this.flights[1].at ? 0 : 1;
        this.launches += 1;
        this.flights[older].launch(time, route, this.launches);
        this.newest = older;
        return true;
    }

    reset() {
        this.flights.forEach((f) => f.reset());
        this.launches = 0;
    }

    /** The newest flight out still in the air (or null). */
    flightOut(time) {
        const f = this.flights[this.newest];
        return f.live(time) ? f : null;
    }

    // ── Where a bird is ──

    /** A crossing's leader at `time`: place (out), heading; null when the crossing is not on its run. */
    crossingLead(c, time, out) {
        const run = (((((time + c.phase) % c.period) + c.period) % c.period) * c.speed) - CROSSING_LEAD;
        if (run < -CROSSING_LEAD || run > c.dir[2] + CROSSING_LEAD) return null;
        const [amp, wave] = c.sway;
        const k = (run / wave) * TAU;
        const across = amp * Math.sin(k + c.seed);
        out[0] = c.from[0] + c.dir[0] * run - c.dir[1] * across;
        out[1] = c.y + 6 * Math.sin(run / 700 + c.seed * 0.3);
        out[2] = c.from[1] + c.dir[1] * run + c.dir[0] * across;
        return run;
    }

    /** Crossing bird i's place at `time` (`scale`: the skein's drawn size), or false off its run. */
    crossingBird(c, i, time, scale, out) {
        const lead = this._r;
        const run = this.crossingLead(c, time, lead);
        if (run === null) return false;
        // The line's heading here (its sway turns it a little).
        const [amp, wave] = c.sway;
        const k = (run / wave) * TAU;
        const slope = ((amp * TAU) / wave) * Math.cos(k + c.seed);
        let fx = c.dir[0] - c.dir[1] * slope;
        let fz = c.dir[1] + c.dir[0] * slope;
        const fl = Math.hypot(fx, fz);
        fx /= fl;
        fz /= fl;
        const rx = -fz;
        const rz = fx;
        const span = GOOSE_SPAN * scale;
        const slot = c.slots[i];
        const w = wanderAt(c.birds[i].wander, time, this._w);
        const ox = (slot[0] + w[0]) * span;
        const oy = (slot[1] + w[1]) * span;
        const oz = (slot[2] + w[2]) * span;
        out[0] = lead[0] + rx * ox + fx * oz;
        out[1] = lead[1] + oy;
        out[2] = lead[2] + rz * ox + fz * oz;
        return true;
    }

    /**
     * Flight-out bird i's place at age `age` (`scale`: the flock's drawn size), or false before it
     * is up. `sOut` gets its own flight clock.
     */
    flightBird(f, i, age, scale, out, sOut = null) {
        const bird = f.birds[i];
        const F = FLIGHT_OUT;
        const join = smooth(F.join[0], F.join[1], age);
        const own = age - bird.delay * (1 - join);
        if (own < 0) return false;
        const s = started(own);
        if (sOut) sOut[0] = s;
        const span = GOOSE_SPAN * scale;
        const w = wanderAt(bird.wander, age, this._w);
        // From its spot in the barley (metres) to its slot in the V (spans), with its looseness.
        const ox = bird.spot[0] + ((bird.slot[0] + w[0]) * span - bird.spot[0]) * join;
        const oy = (bird.slot[1] + w[1]) * span * join;
        const oz = bird.spot[2] + ((bird.slot[2] + w[2]) * span - bird.spot[2]) * join;
        const t = trackAt(f.route, f.track, along(s) + oz, this._t);
        const rx = Math.cos(t[2]);
        const rz = Math.sin(t[2]);
        out[0] = t[0] + rx * ox;
        out[2] = t[1] + rz * ox;
        const lifted = rise(s);
        // Off the ground it is its own; on it, it sits on the field where it is.
        const ground = f.route.ground + (groundHeight(out[0], out[2]) - f.route.ground) * Math.exp(-lifted / 1.5);
        out[1] = ground + F.sit + lifted + oy;
        return true;
    }

    // ── The frame ──

    /** The drawn size for a bird `distance` metres off, with the least size `px` (pixelAngle: radians a pixel). */
    static sizeFor(distance, pixelAngle, px) {
        return Math.max(1, (px * pixelAngle * distance) / GOOSE_SPAN);
    }

    /**
     * Pose every bird in sight into `out` (GOOSE_STRIDE floats each, the newest flight out first,
     * then the crossings, then the older flight; at most the pool). `view`: { eye: [x, y, z],
     * pixelAngle, cull(x, y, z, radius) → true when out of sight (optional) }. Returns the count.
     */
    write(time, view, out) {
        const eye = view.eye || [EYE.x, EYE.y, EYE.z];
        const pixelAngle = view.pixelAngle || 0.0007;
        const cull = view.cull || null;
        let n = 0;
        const put = (x, y, z, scale, fwd, up, pose) => {
            if (n >= this.pool) return;
            const o = n * GOOSE_STRIDE;
            out[o] = x;
            out[o + 1] = y;
            out[o + 2] = z;
            out[o + 3] = scale;
            out[o + 4] = fwd[0];
            out[o + 5] = fwd[1];
            out[o + 6] = fwd[2];
            out[o + 7] = pose.heave;
            out[o + 8] = up[0];
            out[o + 9] = up[1];
            out[o + 10] = up[2];
            out[o + 11] = pose.lift;
            out[o + 12] = pose.sweep;
            out[o + 13] = pose.bend;
            out[o + 14] = pose.fold;
            out[o + 15] = pose.curl;
            n += 1;
        };
        const order = [this.flights[this.newest], 'a', 'b', this.flights[1 - this.newest]];
        for (const entry of order) {
            if (entry === 'a' || entry === 'b') this.writeCrossing(this.crossings[entry === 'a' ? 0 : 1], time, eye, pixelAngle, cull, put);
            else if (entry.live(time)) this.writeFlight(entry, time, eye, pixelAngle, cull, put);
        }
        this.drawn = n;
        return n;
    }

    writeCrossing(c, time, eye, pixelAngle, cull, put) {
        const lead = this._q;
        if (this.crossingLead(c, time, lead) === null) return;
        const distance = Math.hypot(lead[0] - eye[0], lead[1] - eye[1], lead[2] - eye[2]);
        const scale = GooseSkies.sizeFor(distance, pixelAngle, GOOSE_MIN_PX);
        const reach = GOOSE_SPAN * scale * (c.n * 0.6 + 2);
        if (cull && cull(lead[0], lead[1], lead[2], reach)) return;
        const h = 1 / 30;
        const p = this._p;
        const before = this._before;
        const after = this._after;
        for (let i = 0; i < c.n; i += 1) {
            if (!this.crossingBird(c, i, time, scale, p)) continue;
            if (cull && cull(p[0], p[1], p[2], GOOSE_SPAN * scale)) continue;
            this.crossingBird(c, i, time - h, scale, before);
            this.crossingBird(c, i, time + h, scale, after);
            const bird = c.birds[i];
            // Steady beats; now and then the wings set for a short glide.
            const g = Math.sin(time * 0.13 + bird.glide) * Math.sin(time * 0.071 + bird.glide * 0.37);
            const flap = 1 - 0.9 * smooth(0.86, 0.95, g);
            const theta = time * TAU * bird.hz + bird.phase;
            const pose = wingPose(theta, 0, flap, this._pose);
            const { fwd, up } = this.frame(before, p, after, h, 0);
            put(p[0], p[1], p[2], scale, fwd, up, pose);
        }
    }

    writeFlight(f, time, eye, pixelAngle, cull, put) {
        const age = f.age(time);
        const F = FLIGHT_OUT;
        // The flock's drawn size: real near the eye, never under the least size until it is far.
        const lead = this._q;
        if (!this.flightBird(f, 0, Math.max(age, f.birds[0].delay + 1e-3), 1, lead)) return;
        const distance = Math.hypot(lead[0] - eye[0], lead[1] - eye[1], lead[2] - eye[2]);
        const px = GOOSE_MIN_PX * (1 - smooth(F.fade[0], F.fade[1], age));
        const shown = 1 - smooth(F.gone[0], F.gone[1], age);
        const scale = GooseSkies.sizeFor(distance, pixelAngle, px);
        const h = 1 / 30;
        const p = this._p;
        const before = this._before;
        const mid = this._mid;
        const after = this._after;
        const s = this._own;
        for (let i = 0; i < f.birds.length; i += 1) {
            if (!this.flightBird(f, i, age, scale, p, s)) continue;
            if (cull && cull(p[0], p[1], p[2], GOOSE_SPAN * scale)) continue;
            const bird = f.birds[i];
            // Read the heading from just after the bird is up (its very first instant has no motion).
            const tb = Math.max(age - h, bird.delay + 1e-3);
            this.flightBird(f, i, tb, scale, before);
            this.flightBird(f, i, tb + h, scale, mid);
            this.flightBird(f, i, tb + 2 * h, scale, after);
            const effort = effortAt(s[0]);
            const theta = beatPhase(s[0], bird.hz) + bird.phase;
            const pose = wingPose(theta, effort, 1, this._pose);
            const { fwd, up } = this.frame(before, mid, after, h, F.attack * effort);
            put(p[0], p[1], p[2], scale * shown, fwd, up, pose);
        }
    }

    /**
     * The body's frame from its motion: forward along the path, pitched up by `attack` (rad),
     * banked into the turn (the lift leaning toward the centre of the turn). Written into the
     * sky's own two vectors (read them before the next call).
     */
    frame(before, now, after, h, attack) {
        const vx = (after[0] - before[0]) / (2 * h);
        const vy = (after[1] - before[1]) / (2 * h);
        const vz = (after[2] - before[2]) / (2 * h);
        const flat = Math.hypot(vx, vz);
        const psi = Math.atan2(vx, -vz);
        const pitch = Math.atan2(vy, Math.max(flat, 1e-3)) + attack;
        // The turn: the sideways acceleration over gravity.
        const ax = (after[0] - 2 * now[0] + before[0]) / (h * h);
        const az = (after[2] - 2 * now[2] + before[2]) / (h * h);
        const rx = Math.cos(psi);
        const rz = Math.sin(psi);
        const sideways = flat > 0.5 ? ax * rx + az * rz : 0;
        const bank = clamp(Math.atan(sideways / 9.81) * BANK.share, -BANK.most, BANK.most);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const sinPsi = Math.sin(psi);
        const cosPsi = Math.cos(psi);
        const fwd = this._fwd;
        const up = this._up;
        fwd[0] = sinPsi * cp;
        fwd[1] = sp;
        fwd[2] = -cosPsi * cp;
        const cb = Math.cos(bank);
        const sb = Math.sin(bank);
        up[0] = -sinPsi * sp * cb + rx * sb;
        up[1] = cp * cb;
        up[2] = cosPsi * sp * cb + rz * sb;
        return this._frame;
    }

    // ── Inspection (the playground's goose lenses) ──

    /**
     * Where one bird is at `time`: `key` 'out' (the newest flight out), 'a' or 'b' (the
     * crossings), `i` its index. Returns { position, scale, forward } or null.
     */
    locate(key, i, time, view = {}) {
        const now = this.place(key, i, time, view);
        const next = now && this.place(key, i, time + 1 / 30, view);
        if (!now || !next) return now;
        const d = next.position.map((v, k) => v - now.position[k]);
        const l = Math.hypot(...d) || 1;
        return { ...now, forward: d.map((v) => v / l) };
    }

    /** A bird's place and drawn size at `time` (see locate). */
    place(key, i, time, view = {}) {
        const eye = view.eye || [EYE.x, EYE.y, EYE.z];
        const pixelAngle = view.pixelAngle || 0.0007;
        const p = [0, 0, 0];
        if (key === 'a' || key === 'b') {
            const c = this.crossings[key === 'a' ? 0 : 1];
            if (!c || i >= c.n || this.crossingLead(c, time, p) === null) return null;
            const scale = GooseSkies.sizeFor(Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]), pixelAngle, GOOSE_MIN_PX);
            if (!this.crossingBird(c, i, time, scale, p)) return null;
            return { position: p, scale };
        }
        const f = this.flightOut(time);
        if (!f || i >= f.birds.length) return null;
        const age = f.age(time);
        if (!this.flightBird(f, i, age, 1, p)) return null;
        const px = GOOSE_MIN_PX * (1 - smooth(FLIGHT_OUT.fade[0], FLIGHT_OUT.fade[1], age));
        const scale = GooseSkies.sizeFor(Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]), pixelAngle, px);
        this.flightBird(f, i, age, scale, p);
        return { position: p, scale };
    }
}
