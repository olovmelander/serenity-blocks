/**
 * Neon District — the dragon's flights (CPU only, three-free).
 *
 * A four-line clear calls a drone-show dragon into the street. It never flies the same way twice:
 * every call plans a new FLIGHT from a seed and from what the frame leaves free.
 *
 * The stage. The gameplay card covers the canyon's vanishing point, so the dragon can only be
 * seen in the wedges of street beside the card (a LANE on each side that has room), or, on a
 * tall frame with no room beside it, in the band of air above the card. A lane is wide near the
 * camera and closes with distance; everything a flight does is laid out inside it, and the way
 * from one lane to the other runs behind the card.
 *
 * A flight is a recipe: a way in (out of the far haze round the card's edge, down out of the
 * smog, past the camera from behind, low along the wet street, or gathered out of sparks), one
 * or two figures (a ring flown facing the viewer, a spire climbed round an upright axis, a
 * corkscrew bored along the street, a loop, a dive that skims the road, a weave from wall to
 * wall behind the card, a figure of eight), sometimes a burst (the swarm flies apart into a
 * cloud of sparks and gathers again, there or in the other lane), and a way out. A bag of
 * recipes is dealt without a repeat, and each deal draws its own sides, sizes, turns and colours.
 *
 * What a flight is made of:
 *   knots     the curve, DRAGON_KNOTS points one `spacing` of arc apart (the shader's path)
 *   frames    the body's right-hand side at each knot, carried along the curve without twist
 *             and eased upright, so the dragon banks through a loop and levels out after it
 *   times     when the head reaches each knot (figures are flown slower than the way between)
 *   bursts    when the swarm leaves its seats for a cloud, where the cloud hangs, and when it
 *             comes back; a `jump` moves the head to another piece of the curve while every
 *             drone is in the cloud
 *
 * Everything is a pure function of (seed, stage): flightState(plan, age) gives the same numbers
 * at any frame rate, so a seek and a replay agree.
 */

import {
    STREET, TAU, clamp01, mulberry32, smooth,
} from './neon-district-core.js';

/** Points of the curve the shader reads (one row of a float texture, the frames in a second). */
export const DRAGON_KNOTS = 192;

/** The body at scale 1 (metres). A flight scales it to fit its lane. */
export const DRAGON_BODY = Object.freeze({
    length: 40,
    radius: 1.25,
    /** How far the head fades in from the start of the curve, and out before its end. */
    fadeIn: 7,
    fadeOut: 9,
});

/** The head is drawn this much larger than the body's scale. */
export const DRAGON_HEAD = 1.4;

/** Head speeds (m/s): on the way between figures, in a figure, and low along the street. */
const SPEED = Object.freeze({
    travel: 22, figure: 10.5, skim: 12.5, enter: 34,
});

/**
 * Colour schemes, scene-linear. `body` the lines down the flanks, `belly` the ribs and the
 * underside, `crest` the fins and the tail fan, `hot` the head, whiskers, horns and claws.
 * Scheme 0 borrows the district's two accents for the belly and the crest.
 */
export const DRAGON_SCHEMES = Object.freeze([
    {
        name: 'imperial', body: [1.0, 0.7, 0.22], belly: null, crest: null, hot: [1.0, 0.95, 0.85],
    },
    {
        name: 'jade', body: [0.2, 1.0, 0.62], belly: [1.0, 0.78, 0.3], crest: [0.55, 1.0, 0.95], hot: [0.9, 1.0, 0.92],
    },
    {
        name: 'ultraviolet', body: [0.62, 0.36, 1.0], belly: [1.0, 0.24, 0.62], crest: [0.25, 0.9, 1.0], hot: [0.95, 0.9, 1.0],
    },
    {
        name: 'ember', body: [1.0, 0.3, 0.12], belly: [1.0, 0.72, 0.2], crest: [1.0, 0.86, 0.5], hot: [1.0, 0.9, 0.72],
    },
    {
        name: 'azure', body: [0.16, 0.62, 1.0], belly: [0.75, 0.92, 1.0], crest: [1.0, 0.42, 0.72], hot: [0.9, 0.97, 1.0],
    },
    {
        name: 'moon', body: [1.0, 0.9, 0.66], belly: [0.82, 0.9, 1.0], crest: [1.0, 0.98, 0.9], hot: [1.0, 1.0, 1.0],
    },
]);
/** The white-gold scheme a perfect clear's dragons wear. */
export const DRAGON_SCHEME_MOON = 5;

// ── The stage ───────────────────────────────────────────────────────────────────

/**
 * @typedef {object} DragonStage
 * @property {number[]} cam        the camera's position
 * @property {number} tanH         tan(half the horizontal field of view)
 * @property {number} tanV         tan(half the vertical field of view)
 * @property {number} pitch        the rest pitch (radians, up)
 * @property {{a: number, b: number}|null} left   free screen-x range left of the cards
 * @property {{a: number, b: number}|null} right  free screen-x range right of the cards and HUD
 * @property {number} top          screen y of the cards' top edge (0 = top of the frame)
 */

/** The stage of a 16:9 solo board: what the tests and a world with no camera yet plan against. */
export const DEFAULT_STAGE = Object.freeze({
    cam: Object.freeze([0, 3, 0]),
    tanH: 1,
    tanV: 0.5625,
    pitch: (8 * Math.PI) / 180,
    left: Object.freeze({ a: 0, b: 0.39 }),
    right: Object.freeze({ a: 0.74, b: 1 }),
    top: 0.08,
});

/** World x of a screen-x fraction, `depth` metres ahead of the camera. */
const xAt = (stage, sx, depth) => stage.cam[0] + (2 * sx - 1) * depth * stage.tanH;

/** World y of a screen-y fraction (y down), `depth` metres ahead of the camera. */
function yAt(stage, sy, depth) {
    const n = (1 - 2 * sy) * stage.tanV;
    const tp = Math.tan(stage.pitch);
    return stage.cam[1] + (depth * (n + tp)) / Math.max(0.2, 1 - n * tp);
}

/** The nearest and farthest a figure is flown, and the least room a lane must have (metres). */
const NEAR = 6.5;
const FAR = 34;
const WALL = STREET.halfStreet - 0.7;

/**
 * A lane: a wedge of air the frame leaves free. `side` −1 left, +1 right, 0 the band over the
 * card. `x(depth, across)` (across 0 = the outer edge, 1 = the card's edge), `lo(depth)` and
 * `hi(depth)` the heights a centre line may take, `width(depth)`, and `near`..`far` the depths
 * at which it has room for a body of radius `r`.
 * @param {DragonStage} stage
 * @param {number} side
 * @param {number} r  body radius (metres)
 */
export function dragonLane(stage, side, r) {
    const zone = side < 0 ? stage.left : stage.right;
    let span;
    let lo;
    let hi;
    if (side === 0) {
        // The band over the card: as wide as the frame, between its top edge and the card's.
        const top = Math.max(0.04, stage.top);
        span = (depth) => {
            const half = Math.min(depth * stage.tanH * 0.86, WALL - r);
            return [stage.cam[0] - half, stage.cam[0] + half];
        };
        lo = (depth) => yAt(stage, top - 0.012, depth) + r * 0.5;
        hi = (depth) => Math.min(yAt(stage, 0.012, depth) - r * 0.5, 38);
    } else {
        if (!zone || zone.b - zone.a < 0.12) return null;
        span = (depth) => {
            // The centre line may run half a body into the card's edge or out of the frame: a
            // body cut by either still reads; one buried in a wall does not.
            const a = Math.max(xAt(stage, zone.a, depth) + r * 0.2, -(WALL - r));
            const b = Math.max(a, Math.min(xAt(stage, zone.b, depth) - r * 0.2, WALL - r));
            return side < 0 ? [a, b] : [b, a];
        };
        lo = () => r + 0.45;
        hi = (depth) => Math.min(yAt(stage, 0.03, depth) - r * 0.6, 19);
    }
    const width = (depth) => {
        const [a, b] = span(depth);
        return Math.abs(b - a);
    };
    const room = (depth) => Math.min(width(depth), hi(depth) - lo(depth));
    let near = Infinity;
    let far = -Infinity;
    for (let depth = NEAR; depth <= FAR; depth += 0.5) {
        if (room(depth) >= r * 2.4) {
            near = Math.min(near, depth);
            far = Math.max(far, depth);
        }
    }
    if (!(far - near >= 5)) return null;
    return {
        side,
        near,
        far,
        width,
        lo,
        hi,
        room,
        /** A point of the lane: `across` 0 (outer edge) .. 1 (the card's edge), `up` 0..1. */
        point(depth, across, up) {
            const [a, b] = span(depth);
            const y0 = lo(depth);
            return {
                x: a + (b - a) * across,
                y: y0 + (hi(depth) - y0) * up,
                z: stage.cam[2] - depth,
            };
        },
    };
}

// ── The curve ───────────────────────────────────────────────────────────────────

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const lerp = (a, b, t) => a + (b - a) * t;

/** Centripetal Catmull–Rom through p1..p2 (Barry–Goldman), at u in 0..1. */
function catmull(p0, p1, p2, p3, u, out) {
    const knot = (a, b) => Math.sqrt(Math.max(1e-4, len(sub(b, a))));
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const t = lerp(t1, t2, u);
    const mix3 = (a, b, ta, tb) => {
        const k = (t - ta) / (tb - ta);
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
    };
    const a1 = mix3(p0, p1, t0, t1);
    const a2 = mix3(p1, p2, t1, t2);
    const a3 = mix3(p2, p3, t2, t3);
    const b1 = mix3(a1, a2, t0, t2);
    const b2 = mix3(a2, a3, t1, t3);
    const c = mix3(b1, b2, t1, t2);
    out.x = c.x;
    out.y = c.y;
    out.z = c.z;
    return out;
}

/**
 * What a recipe draws with: control points with a head speed each, cut into pieces (a `cut`
 * starts a new piece: the head jumps there while the swarm is a cloud).
 */
class Trail {
    constructor() {
        this.pieces = [[]];
        this.marks = [];
        this.cuts = [];
    }

    get piece() {
        return this.pieces[this.pieces.length - 1];
    }

    get last() {
        const p = this.piece;
        return p[p.length - 1] || null;
    }

    /** A control point, flown at `v` m/s. Points closer than 0.4 m to the last are dropped. */
    to(p, v) {
        const { last } = this;
        if (last && len(sub(p, last)) < 0.4) return this;
        this.piece.push({
            x: p.x, y: p.y, z: p.z, v,
        });
        return this;
    }

    /** Mark the last control point (a burst begins there, a skim's spray, a roar). */
    mark(kind, detail = {}) {
        this.marks.push({
            kind, piece: this.pieces.length - 1, index: this.piece.length - 1, ...detail,
        });
        return this;
    }

    /** Start a new piece: the swarm leaves the last one as a cloud `radius` wide. */
    cut(radius = 7) {
        this.cuts.push(radius);
        this.pieces.push([]);
        return this;
    }
}

/** A piece as a dense polyline: { pts: [{x,y,z,v}], arc: cumulative length, at: control → dense index }. */
function densify(points) {
    const pts = [];
    const at = [];
    const n = points.length;
    const get = (i) => points[Math.max(0, Math.min(n - 1, i))];
    const tmp = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n - 1; i++) {
        at.push(pts.length);
        const a = get(i);
        const b = get(i + 1);
        // A phantom point beyond each end keeps the end tangents along the first and last legs.
        const before = i > 0 ? get(i - 1) : { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
        const after = i < n - 2 ? get(i + 2) : { x: 2 * b.x - a.x, y: 2 * b.y - a.y, z: 2 * b.z - a.z };
        const steps = Math.max(3, Math.min(40, Math.ceil(len(sub(b, a)) / 0.7)));
        for (let s = 0; s < steps; s++) {
            const u = s / steps;
            catmull(before, a, b, after, u, tmp);
            pts.push({
                x: tmp.x, y: tmp.y, z: tmp.z, v: lerp(a.v, b.v, u),
            });
        }
    }
    at.push(pts.length);
    const end = get(n - 1);
    pts.push({ ...end });
    const arc = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) arc[i] = arc[i - 1] + len(sub(pts[i], pts[i - 1]));
    return { pts, arc, at };
}

/** The point of a dense polyline at arc length `s` (clamped), written into `out`. */
function atArc(dense, s, out, cursor = { i: 0 }) {
    const { pts, arc } = dense;
    const last = pts.length - 1;
    let { i } = cursor;
    while (i < last - 1 && arc[i + 1] < s) i += 1;
    while (i > 0 && arc[i] > s) i -= 1;
    cursor.i = i;
    const span = Math.max(1e-6, arc[i + 1] - arc[i]);
    const k = clamp01((s - arc[i]) / span);
    const a = pts[i];
    const b = pts[i + 1];
    out.x = lerp(a.x, b.x, k);
    out.y = lerp(a.y, b.y, k);
    out.z = lerp(a.z, b.z, k);
    out.v = lerp(a.v, b.v, k);
    return out;
}

// ── Figures ─────────────────────────────────────────────────────────────────────

/** The ways in, the figures and the ways out a recipe is put together from. */
const ACTS = {
    /** Out of the far haze behind the card, round its edge into the lane. */
    fromFar(ctx, lane) {
        const { trail, stage, rand } = ctx;
        const s = lane.side || (rand() < 0.5 ? -1 : 1);
        const z = stage.cam[2];
        const high = lane.side === 0 ? lane.lo(60) + 3 : 9 + rand() * 6;
        trail.to({ x: s * (0.5 + rand() * 2), y: high + 2, z: z - lane.far - 24 }, SPEED.enter);
        trail.to({ x: s * 2.2, y: lerp(high, lane.hi(lane.far) * 0.6, 0.6), z: z - lane.far - 13 }, SPEED.travel);
        trail.to(lane.point(lane.far - 1, 0.62, 0.45 + rand() * 0.3), SPEED.travel);
        trail.mark('roar');
    },

    /** Down out of the smog, through the top of the frame. */
    fromTop(ctx, lane) {
        const { trail, rand } = ctx;
        const depth = lerp(lane.near + 5, lane.far - 4, rand());
        const top = lane.point(depth + 5, 0.4 + rand() * 0.3, 1);
        trail.to({ x: top.x, y: top.y + 17, z: top.z - 8 }, SPEED.enter);
        trail.to({ x: top.x, y: top.y + 7, z: top.z - 3 }, SPEED.enter);
        trail.to(lane.point(depth, 0.5, 0.8), SPEED.travel);
        trail.mark('roar');
    },

    /** Past the camera from behind it, into the lane and away up the street. */
    fromBehind(ctx, lane) {
        const { trail, stage, rand } = ctx;
        const z = stage.cam[2];
        const side = lane.side || (rand() < 0.5 ? -1 : 1);
        const y = lane.side === 0 ? lane.lo(lane.near) + 1 : 5.5 + rand() * 3;
        trail.to({ x: side * (4.5 + rand() * 2), y: y + 3, z: z + 20 }, SPEED.enter);
        trail.to({ x: side * (4.2 + rand()), y: y + 1.5, z: z + 9 }, SPEED.enter);
        trail.to(lane.point(lane.near + 1.5, 0.45, lane.side === 0 ? 0.5 : 0.42 + rand() * 0.2), SPEED.travel);
    },

    /** Low along the wet street from behind the camera, its mirror image under it. */
    fromStreet(ctx, lane) {
        const {
            trail, stage, rand, r,
        } = ctx;
        const z = stage.cam[2];
        const side = lane.side || (rand() < 0.5 ? -1 : 1);
        const low = r + 0.5;
        trail.to({ x: side * (3.2 + rand() * 1.5), y: low + 0.4, z: z + 18 }, SPEED.enter);
        trail.to({ x: side * (3.6 + rand()), y: low, z: z + 6 }, SPEED.skim);
        trail.to(lane.point(lane.near + 2, 0.4, 0), SPEED.skim);
        trail.mark('skim');
        trail.to(lane.point(lerp(lane.near + 6, lane.far - 6, 0.45), 0.5, 0.06), SPEED.skim);
    },

    /** A straight leg to a point of the lane. */
    glide(ctx, lane, depth, across, up, v = SPEED.travel) {
        ctx.trail.to(lane.point(Math.max(lane.near, Math.min(lane.far, depth)), across, up), v);
    },

    /**
     * Circling: laps of a ring that faces the viewer, each lap a little nearer (so the laps lie
     * beside each other as a coil, not on top of each other).
     */
    ring(ctx, lane, {
        depth, laps = 2, turn = 1, drift = 1,
    } = {}) {
        const { trail, r } = ctx;
        const d = Math.max(lane.near + 1, Math.min(lane.far - 1, depth));
        const rho = Math.min(lane.room(d) * 0.5 - r * 0.15, 3.6);
        if (rho < r * 1.25) return false;
        const c = lane.point(d, 0.5, 0.5);
        // Meet the ring where the way in touches it.
        const from = trail.last || c;
        const start = Math.atan2(from.y - c.y, from.x - c.x) + turn * 1.15;
        const steps = Math.ceil(laps * 10);
        for (let i = 0; i <= steps; i++) {
            const a = start + turn * (i / 10) * TAU;
            // Each lap a little smaller than the last: the laps lie inside one another.
            const rad = rho * Math.max(0.62, 1 - 0.11 * (i / 10));
            trail.to({
                x: c.x + Math.cos(a) * rad,
                y: c.y + Math.sin(a) * rad,
                z: c.z + drift * (i / 10) * r * 1.9 - drift * laps * r * 0.95,
            }, SPEED.figure);
        }
        return true;
    },

    /** Coiling: turns round an upright axis, climbing (or coming down). */
    spire(ctx, lane, {
        depth, turns = 2.5, rise = 1, turn = 1,
    } = {}) {
        const { trail, r } = ctx;
        const d = Math.max(lane.near + 2, Math.min(lane.far - 2, depth));
        const rho = Math.min(lane.width(d) * 0.5 - r * 0.1, 3.2);
        const y0 = lane.lo(d) + 0.3;
        const y1 = lane.hi(d);
        if (rho < r * 1.25 || y1 - y0 < turns * r * 1.7) return false;
        const c = lane.point(d, 0.5, 0);
        const from = trail.last || c;
        const start = Math.atan2(from.z - c.z, from.x - c.x) + turn * 1.15;
        const steps = Math.ceil(turns * 10);
        for (let i = 0; i <= steps; i++) {
            const k = i / steps;
            const a = start + turn * (i / 10) * TAU;
            // It tightens as it climbs.
            const rad = rho * (rise > 0 ? lerp(1, 0.72, k) : lerp(0.72, 1, k));
            trail.to({
                x: c.x + Math.cos(a) * rad,
                y: rise > 0 ? lerp(y0, y1, k) : lerp(y1, y0, k),
                z: c.z + Math.sin(a) * rad * 0.9,
            }, SPEED.figure * 1.1);
        }
        return true;
    },

    /** A corkscrew bored along the street, toward the camera or away from it. */
    corkscrew(ctx, lane, {
        from, to, turn = 1, turns,
    } = {}) {
        const { trail, r } = ctx;
        const d0 = Math.max(lane.near + 0.5, Math.min(lane.far, from));
        const d1 = Math.max(lane.near + 0.5, Math.min(lane.far, to));
        const count = turns || Math.max(1.5, Math.abs(d1 - d0) / (r * 5.2));
        const rhoAt = (d) => Math.min(lane.room(d) * 0.5 - r * 0.1, 3.3);
        if (Math.min(rhoAt(d0), rhoAt(d1)) < r * 1.1 || Math.abs(d1 - d0) < 5) return false;
        const first = lane.point(d0, 0.5, 0.5);
        const last = trail.last || first;
        const start = Math.atan2(last.y - first.y, last.x - first.x) + turn * 1.0;
        const steps = Math.ceil(count * 10);
        for (let i = 0; i <= steps; i++) {
            const k = i / steps;
            const d = lerp(d0, d1, k);
            const c = lane.point(d, 0.5, 0.5);
            const rho = rhoAt(d);
            const a = start + turn * (i / 10) * TAU;
            trail.to({ x: c.x + Math.cos(a) * rho, y: c.y + Math.sin(a) * rho, z: c.z }, SPEED.figure * 1.25);
        }
        return true;
    },

    /** A loop over on its back, flown toward the camera (or away). */
    loop(ctx, lane, { depth, toward = 1 } = {}) {
        const { trail, r, rand } = ctx;
        const d = Math.max(lane.near + 4, Math.min(lane.far - 4, depth));
        const rho = Math.min((lane.hi(d) - lane.lo(d)) * 0.5 - 0.1, 4.2);
        if (rho < r * 1.5) return false;
        const across = 0.35 + rand() * 0.3;
        const c = lane.point(d, across, 0.5);
        const slide = (lane.side || 1) * -r * 1.4;
        for (let i = 0; i <= 12; i++) {
            const a = (i / 12) * TAU;
            trail.to({
                x: c.x + slide * (i / 12 - 0.5),
                y: c.y - Math.cos(a) * rho,
                z: c.z + toward * Math.sin(a) * rho,
            }, SPEED.figure * 1.35);
        }
        return true;
    },

    /** A figure of eight facing the viewer. */
    eight(ctx, lane, { depth, cycles = 1.25, turn = 1 } = {}) {
        const { trail, r } = ctx;
        const d = Math.max(lane.near + 1, Math.min(lane.far - 1, depth));
        const half = Math.min(lane.width(d) * 0.5, 3.4);
        const tall = Math.min((lane.hi(d) - lane.lo(d)) * 0.5, 4.4);
        if (half < r * 1.2 || tall < r * 2.2) return false;
        const c = lane.point(d, 0.5, 0.5);
        const steps = Math.ceil(cycles * 16);
        for (let i = 0; i <= steps; i++) {
            const a = (i / 16) * TAU * turn;
            // An upright lemniscate: two loops stacked, crossing at the middle.
            trail.to({
                x: c.x + Math.sin(a * 2) * half * 0.78,
                y: c.y + Math.sin(a) * tall,
                z: c.z + Math.cos(a) * r * 1.4,
            }, SPEED.figure * 1.1);
        }
        return true;
    },

    /** A dive to the street and a run along it toward the camera, throwing spray. */
    skim(ctx, lane, { from, to } = {}) {
        const { trail, r } = ctx;
        const d0 = Math.max(lane.near + 4, Math.min(lane.far, from ?? lane.far - 2));
        const d1 = Math.max(lane.near, Math.min(d0 - 6, to ?? lane.near + 0.5));
        if (lane.side === 0 || d0 - d1 < 6) return false;
        trail.to(lane.point(d0 + 3, 0.55, 0.42), SPEED.travel);
        trail.to(lane.point(d0, 0.5, 0.02), SPEED.skim);
        trail.mark('skim');
        trail.to(lane.point(lerp(d0, d1, 0.5), 0.4, 0), SPEED.skim);
        trail.to({ ...lane.point(d1, 0.5, 0), y: r + 0.5 }, SPEED.skim);
        trail.mark('skimEnd');
        return true;
    },

    /** Behind the card to the other lane (the body is hidden for a moment, as behind a pillar). */
    cross(ctx, lane, other, { depth } = {}) {
        const { trail, stage, rand } = ctx;
        const z = stage.cam[2];
        const last = trail.last || lane.point(lane.far, 0.5, 0.5);
        const behind = Math.max(lane.far, other.far, 26) + 6 + rand() * 6;
        const y = lerp(last.y, 8 + rand() * 4, 0.6);
        trail.to({ x: (lane.side || -1) * 2.5, y, z: z - behind + 3 }, SPEED.travel);
        trail.to({ x: (other.side || 1) * 2.5, y: y + 0.6, z: z - behind + 1 }, SPEED.travel);
        const d = depth ?? lerp(other.near + 2, other.far - 2, 0.35 + rand() * 0.4);
        trail.to(other.point(d, 0.55, 0.4 + rand() * 0.3), SPEED.travel);
    },

    /** Up over the camera and out of the top of the frame. */
    overCamera(ctx, lane) {
        const { trail, stage, rand } = ctx;
        const z = stage.cam[2];
        const side = lane.side || (rand() < 0.5 ? -1 : 1);
        const { last } = trail;
        const lift = Math.max(last ? last.y : 6, lane.hi(lane.near) * 0.7);
        trail.to({ x: side * (2.6 + rand() * 1.6), y: lift + 1.5, z: z - 5 }, SPEED.travel);
        trail.to({ x: side * (1.5 + rand()), y: lift + 7, z: z + 9 }, SPEED.enter);
        trail.to({ x: side * 1.5, y: lift + 13, z: z + 34 }, SPEED.enter);
    },

    /** Away into the haze behind the card. */
    intoHaze(ctx, lane) {
        const { trail, stage, rand } = ctx;
        const z = stage.cam[2];
        const side = lane.side || (rand() < 0.5 ? -1 : 1);
        const { last } = trail;
        const y = last ? last.y : 9;
        trail.to({ x: side * 2.4, y: lerp(y, 12, 0.5), z: z - Math.max(lane.far, 26) - 12 }, SPEED.travel);
        trail.to({ x: side * 0.8, y: 15 + rand() * 5, z: z - 74 }, SPEED.enter);
        trail.to({ x: 0, y: 20, z: z - 112 }, SPEED.enter);
    },

    /** Straight up out of the top of the frame. */
    upAndOut(ctx, lane) {
        const { trail, rand } = ctx;
        const { last } = trail;
        const depth = last ? Math.max(lane.near + 2, Math.min(lane.far, ctx.stage.cam[2] - last.z)) : lane.near + 6;
        const top = lane.point(depth, 0.5, 1);
        trail.to({ x: top.x + (rand() - 0.5), y: top.y + 6, z: top.z + 1.5 }, SPEED.travel);
        trail.to({ x: top.x, y: top.y + 24, z: top.z + 5 }, SPEED.enter);
        trail.to({ x: top.x, y: top.y + 46, z: top.z + 12 }, SPEED.enter);
    },
};

// ── Recipes ─────────────────────────────────────────────────────────────────────

/** One of the named ways in, drawn from those a recipe allows. */
function enter(ctx, lane, ways) {
    const way = ways[Math.floor(ctx.rand() * ways.length) % ways.length];
    ctx.entry = way;
    ACTS[way](ctx, lane);
}

/** One of the named ways out. A lane over the card has no room to climb out of. */
function leave(ctx, lane, ways) {
    const open = lane.side === 0 ? ways.filter((way) => way !== 'upAndOut') : ways;
    const list = open.length ? open : ['overCamera'];
    const way = list[Math.floor(ctx.rand() * list.length) % list.length];
    ctx.exit = way;
    ACTS[way](ctx, lane);
}

/** A depth for a figure: in the roomy near part of the lane, never the same twice. */
const figureDepth = (ctx, lane, deep = 0) => lane.near + 2.5 + deep
    + ctx.rand() * Math.max(1, Math.min(7.5, lane.far - lane.near - 6 - deep));
const eitherWay = (ctx) => (ctx.rand() < 0.5 ? 1 : -1);

/**
 * Each recipe draws a flight on `ctx.trail`. `main` is the roomier lane, `other` the second lane
 * or null (a recipe that needs one falls back to `main`). A figure that has no room in this frame
 * returns false and the recipe carries on without it.
 */
export const DRAGON_RECIPES = Object.freeze([
    {
        // A weave from wall to wall behind the card, close past on the far side, over the camera.
        name: 'serpent',
        fly(ctx, main, other) {
            const { rand } = ctx;
            enter(ctx, main, ['fromFar', 'fromTop']);
            ACTS.glide(ctx, main, figureDepth(ctx, main, 3), 0.3, 0.25 + rand() * 0.35);
            if (other) {
                ACTS.cross(ctx, main, other, { depth: other.near + 2 + rand() * 3 });
                ACTS.glide(ctx, other, other.near + 0.5, 0.35, 0.55, SPEED.figure * 1.6);
                ctx.exit = 'overCamera';
                ACTS.overCamera(ctx, other);
            } else {
                ACTS.eight(ctx, main, { depth: figureDepth(ctx, main), cycles: 1, turn: eitherWay(ctx) });
                leave(ctx, main, ['overCamera', 'upAndOut']);
            }
        },
    },
    {
        // A spire climbed round an upright axis, out of the top of the frame.
        name: 'spire',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromStreet', 'fromBehind', 'fromFar']);
            const ok = ACTS.spire(ctx, main, { depth: figureDepth(ctx, main, 1), turns: 2.4 + rand() * 0.9, turn: eitherWay(ctx) });
            if (!ok) ACTS.ring(ctx, main, { depth: figureDepth(ctx, main), laps: 1.6 });
            leave(ctx, main, ['upAndOut', 'overCamera']);
        },
    },
    {
        // A ring flown facing the viewer; it bursts apart, gathers again and leaves.
        name: 'ouroboros',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromTop', 'fromFar', 'fromBehind']);
            ACTS.ring(ctx, main, { depth: figureDepth(ctx, main), laps: 2.2 + rand() * 0.6, turn: eitherWay(ctx) });
            ctx.trail.mark('burst', { hold: 0.45 + rand() * 0.35, radius: 5.5 + rand() * 2 });
            ACTS.glide(ctx, main, figureDepth(ctx, main, 5), 0.6, 0.5 + rand() * 0.3, SPEED.figure * 1.5);
            leave(ctx, main, ['intoHaze', 'overCamera']);
        },
    },
    {
        // A dive to the street, a run along it in a sheet of spray, and up over the camera.
        name: 'skimmer',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromFar', 'fromTop']);
            const ok = ACTS.skim(ctx, main, { from: main.far - 4 - rand() * 6 });
            if (!ok) ACTS.corkscrew(ctx, main, { from: main.far - 2, to: main.near + 1 });
            ctx.exit = 'overCamera';
            ACTS.overCamera(ctx, main);
        },
    },
    {
        // Past the camera and away, boring a corkscrew down the lane into the haze.
        name: 'borer',
        fly(ctx, main) {
            enter(ctx, main, ['fromBehind', 'fromStreet']);
            ACTS.corkscrew(ctx, main, { from: main.near + 2, to: main.far - 1, turn: eitherWay(ctx) });
            ctx.exit = 'intoHaze';
            ACTS.intoHaze(ctx, main);
        },
    },
    {
        // Gathered out of sparks into a ring, which unwinds toward the camera.
        name: 'phoenix',
        fly(ctx, main) {
            const { rand } = ctx;
            const depth = figureDepth(ctx, main, 1.5);
            const c = main.point(depth, 0.5, 0.5);
            // The way in is never seen: the swarm is a cloud while the head runs it.
            ctx.trail.to({ x: c.x, y: c.y - 2.5, z: c.z - 3 }, SPEED.figure);
            ctx.assemble = { radius: 9 + rand() * 4 };
            ctx.entry = 'assemble';
            ACTS.ring(ctx, main, {
                depth, laps: 3.4, turn: eitherWay(ctx), drift: 0.6,
            });
            ctx.trail.mark('formed');
            if (rand() < 0.6) {
                ACTS.corkscrew(ctx, main, {
                    from: depth - 1, to: main.near + 1, turn: eitherWay(ctx), turns: 1.6,
                });
                ctx.exit = 'overCamera';
                ACTS.overCamera(ctx, main);
            } else leave(ctx, main, ['upAndOut', 'intoHaze']);
        },
    },
    {
        // A loop over on its back, then behind the card and close past on the far side.
        name: 'leap',
        fly(ctx, main, other) {
            const { rand } = ctx;
            enter(ctx, main, ['fromFar', 'fromBehind']);
            ACTS.glide(ctx, main, figureDepth(ctx, main, 6), 0.45, 0.3);
            ACTS.loop(ctx, main, { depth: figureDepth(ctx, main, 3), toward: ctx.entry === 'fromBehind' ? -1 : 1 });
            if (other && rand() < 0.7) {
                ACTS.glide(ctx, main, main.far - 2, 0.7, 0.45);
                ACTS.cross(ctx, main, other);
                ctx.exit = 'overCamera';
                ACTS.overCamera(ctx, other);
            } else {
                ACTS.glide(ctx, main, main.near + 2, 0.4, 0.5, SPEED.figure * 1.6);
                leave(ctx, main, ['overCamera', 'upAndOut']);
            }
        },
    },
    {
        // A figure, a burst, and the swarm gathers again somewhere else.
        name: 'vanish',
        fly(ctx, main, other) {
            const { rand, r } = ctx;
            enter(ctx, main, ['fromTop', 'fromFar']);
            const depth = figureDepth(ctx, main, 2);
            if (!ACTS.spire(ctx, main, {
                depth, turns: 2 + rand() * 0.6, rise: -1, turn: eitherWay(ctx),
            })) ACTS.ring(ctx, main, { depth, laps: 1.8 });
            // The other lane if it can seat a ring, else further up this one.
            const across = Boolean(other) && other.room(other.near + 3) > r * 3.4;
            const there = across ? other : main;
            const d2 = across ? other.near + 2 + rand() * 3 : Math.min(main.far - 3, depth + 6 + rand() * 4);
            ctx.trail.cut(6 + rand() * 2);
            const c = there.point(d2, 0.5, 0.5);
            ctx.trail.to({ x: c.x, y: c.y + 2.2, z: c.z - 2 }, SPEED.figure);
            ACTS.ring(ctx, there, {
                depth: d2, laps: 3.2, turn: eitherWay(ctx), drift: 0.7,
            });
            ctx.trail.mark('formed');
            leave(ctx, there, across ? ['overCamera'] : ['intoHaze', 'overCamera', 'upAndOut']);
        },
    },
    {
        // Up into a ring, and it dissolves into sparks that rise.
        name: 'lantern',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromStreet', 'fromBehind', 'fromFar']);
            ACTS.ring(ctx, main, { depth: figureDepth(ctx, main), laps: 2.6, turn: eitherWay(ctx) });
            ctx.trail.mark('scatter', { radius: 8 + rand() * 3 });
            ACTS.glide(ctx, main, main.near + 4, 0.5, 0.9, SPEED.figure);
            ctx.exit = 'scatter';
            ACTS.upAndOut(ctx, main);
        },
    },
    {
        // Out of the haze boring a corkscrew at the camera, and over it.
        name: 'gyre',
        fly(ctx, main) {
            enter(ctx, main, ['fromFar', 'fromTop']);
            if (!ACTS.corkscrew(ctx, main, { from: main.far - 3, to: main.near + 0.5, turn: eitherWay(ctx) })) {
                ACTS.glide(ctx, main, main.near + 2, 0.5, 0.5);
            }
            ctx.exit = 'overCamera';
            ACTS.overCamera(ctx, main);
        },
    },
    {
        // A figure of eight facing the viewer.
        name: 'eight',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromTop', 'fromBehind', 'fromFar']);
            if (!ACTS.eight(ctx, main, { depth: figureDepth(ctx, main), cycles: 1.5 + rand() * 0.5, turn: eitherWay(ctx) })) {
                ACTS.ring(ctx, main, { depth: figureDepth(ctx, main) });
            }
            leave(ctx, main, ['intoHaze', 'overCamera', 'upAndOut']);
        },
    },
    {
        // Past the camera and away, a loop back toward it, a burst, and a skim home.
        name: 'comet',
        fly(ctx, main) {
            const { rand } = ctx;
            enter(ctx, main, ['fromBehind', 'fromStreet']);
            ACTS.glide(ctx, main, figureDepth(ctx, main, 7), 0.5, 0.7);
            ACTS.loop(ctx, main, { depth: figureDepth(ctx, main, 5), toward: -1 });
            ctx.trail.mark('burst', { hold: 0.3 + rand() * 0.3, radius: 5 + rand() * 2 });
            if (!ACTS.skim(ctx, main, { from: main.far - 8 })) ACTS.glide(ctx, main, main.near + 2, 0.5, 0.4);
            ctx.exit = 'overCamera';
            ACTS.overCamera(ctx, main);
        },
    },
]);

/** The recipes' names, in order. */
export const DRAGON_RECIPE_NAMES = Object.freeze(DRAGON_RECIPES.map((recipe) => recipe.name));

// ── Planning ────────────────────────────────────────────────────────────────────

/** Seconds a burst takes to fly apart, and to gather again. */
const BURST_RISE = 0.22;
const BURST_FALL = 1.05;
/** A jump: the cloud crosses to where the swarm gathers again in this long. */
const JUMP_HOLD = 0.85;
/** Gathering out of sparks at the start of a flight. */
const ASSEMBLE = 1.7;
/** Dissolving at the end of one. */
const SCATTER = 1.5;

/**
 * Plan a flight.
 * @param {object} [options]
 * @param {number} [options.seed]    what makes this flight its own
 * @param {number} [options.recipe]  index into DRAGON_RECIPES (default: drawn from the seed)
 * @param {DragonStage} [options.stage]
 * @param {number} [options.scale]   body scale (default: drawn to fit the lane)
 * @param {number} [options.scheme]  colour scheme (default: drawn)
 * @param {number} [options.mirror]  −1 / +1: fly it in the left / right lane when both have room
 * @returns {object} the flight (see the module header), or null when the frame has no room at all
 */
export function planDragonFlight({
    seed = 1, recipe, stage = DEFAULT_STAGE, scale, scheme, mirror,
} = {}) {
    const rand = mulberry32((seed >>> 0) * 2654435761 + 0x9e37);
    const sc = scale ?? 0.6 + rand() * 0.14;
    const r = DRAGON_BODY.radius * sc;
    const left = dragonLane(stage, -1, r);
    const right = dragonLane(stage, 1, r);
    const over = left || right ? null : dragonLane(stage, 0, r);
    const reach = (lane) => (lane ? lane.far - lane.near : 0);
    let main = reach(left) >= reach(right) ? left : right;
    let other = main === left ? right : left;
    // With room on both sides, half the flights start on the narrower one.
    const want = mirror ?? (rand() < 0.38 ? 1 : -1);
    if (main && other && reach(other) >= 9 && (mirror ? other.side === want : want > 0)) [main, other] = [other, main];
    if (!main) main = over;
    if (!main) return null;
    const index = recipe ?? Math.floor(rand() * DRAGON_RECIPES.length);
    const pick = DRAGON_RECIPES[((index % DRAGON_RECIPES.length) + DRAGON_RECIPES.length) % DRAGON_RECIPES.length];
    const ctx = {
        stage, rand, r, sc, trail: new Trail(), assemble: null, entry: '', exit: '',
    };
    pick.fly(ctx, main, other);
    const plan = bakeFlight(ctx, sc);
    plan.seed = seed >>> 0;
    plan.recipe = pick.name;
    plan.side = main.side;
    plan.entry = ctx.entry;
    plan.exit = ctx.exit || 'overCamera';
    plan.scheme = scheme ?? Math.floor(rand() * (DRAGON_SCHEMES.length - 1));
    return plan;
}

/** Turn a recipe's trail into knots, frames, times and bursts. */
function bakeFlight(ctx, sc) {
    const { trail } = ctx;
    const body = DRAGON_BODY.length * sc;
    const pieces = trail.pieces.filter((points) => points.length >= 2).map(densify);
    const total = pieces.reduce((sum, piece) => sum + piece.arc[piece.arc.length - 1], 0);
    // Three knots are spent at every cut (see below), and a few at the end as a margin.
    const spare = (pieces.length - 1) * 3 + 2;
    const spacing = Math.max(0.7, total / (DRAGON_KNOTS - spare - pieces.length));
    const knots = new Float32Array(DRAGON_KNOTS * 4);
    const frames = new Float32Array(DRAGON_KNOTS * 4);
    const speeds = new Float64Array(DRAGON_KNOTS);
    const times = new Float64Array(DRAGON_KNOTS).fill(NaN);
    const starts = [];
    const ends = [];
    let k = 0;
    const p = {
        x: 0, y: 0, z: 0, v: 0,
    };
    const put = (point) => {
        knots[k * 4] = point.x;
        knots[k * 4 + 1] = point.y;
        knots[k * 4 + 2] = point.z;
        speeds[k] = point.v;
        k += 1;
    };
    pieces.forEach((piece, i) => {
        const length = piece.arc[piece.arc.length - 1];
        const count = Math.min(Math.floor(length / spacing) + 1, DRAGON_KNOTS - k - (pieces.length - 1 - i) * 6 - 1);
        if (i > 0) {
            // A cut: the last knot of the piece before and the first of this one are both doubled,
            // so the curve on either side never bends toward the other piece.
            put({
                x: knots[(k - 1) * 4], y: knots[(k - 1) * 4 + 1], z: knots[(k - 1) * 4 + 2], v: speeds[k - 1],
            });
            atArc(piece, 0, p);
            put(p);
        }
        starts.push(k);
        const cursor = { i: 0 };
        for (let j = 0; j < count; j++) put(atArc(piece, j * spacing, p, cursor));
        ends.push(k - 1);
    });
    const used = k;
    // The rest repeat the last knot: a read past the end stays there.
    while (k < DRAGON_KNOTS) {
        put({
            x: knots[(used - 1) * 4], y: knots[(used - 1) * 4 + 1], z: knots[(used - 1) * 4 + 2], v: speeds[used - 1],
        });
    }

    // ── Frames: the body's right-hand side, carried along the curve and eased upright ──
    const tangent = (i, out) => {
        const a = Math.max(0, i - 1);
        const b = Math.min(used - 1, i + 1);
        out.x = knots[b * 4] - knots[a * 4];
        out.y = knots[b * 4 + 1] - knots[a * 4 + 1];
        out.z = knots[b * 4 + 2] - knots[a * 4 + 2];
        const l = len(out) || 1;
        out.x /= l;
        out.y /= l;
        out.z /= l;
        return out;
    };
    const t = { x: 0, y: 0, z: 0 };
    const n = { x: 1, y: 0, z: 0 };
    const level = { x: 0, y: 0, z: 0 };
    starts.forEach((start, i) => {
        tangent(start, t);
        // Level flight's right-hand side: up × forward.
        let hl = Math.hypot(t.z, t.x);
        n.x = hl > 1e-3 ? t.z / hl : 1;
        n.y = 0;
        n.z = hl > 1e-3 ? -t.x / hl : 0;
        for (let j = start; j <= ends[i]; j++) {
            tangent(j, t);
            // Carry: drop what lies along the new tangent.
            const along = n.x * t.x + n.y * t.y + n.z * t.z;
            n.x -= t.x * along;
            n.y -= t.y * along;
            n.z -= t.z * along;
            let l = len(n);
            if (l < 1e-4) {
                n.x = 1;
                n.y = 0;
                n.z = 0;
                l = 1;
            }
            n.x /= l;
            n.y /= l;
            n.z /= l;
            // Ease upright, the more the flatter it flies (a loop is left alone at its top).
            hl = Math.hypot(t.z, t.x);
            if (hl > 0.3) {
                level.x = t.z / hl;
                level.z = -t.x / hl;
                const ease = 0.085 * smooth(0.3, 0.8, hl);
                n.x += (level.x - n.x) * ease;
                n.y += (0 - n.y) * ease;
                n.z += (level.z - n.z) * ease;
                l = len(n) || 1;
                n.x /= l;
                n.y /= l;
                n.z /= l;
            }
            frames[j * 4] = n.x;
            frames[j * 4 + 1] = n.y;
            frames[j * 4 + 2] = n.z;
        }
    });
    // The doubled knots at a cut and the padding at the end borrow their neighbour's frame.
    const blank = (j) => frames[j * 4] === 0 && frames[j * 4 + 1] === 0 && frames[j * 4 + 2] === 0;
    for (let j = 1; j < DRAGON_KNOTS; j++) {
        if (blank(j) && !blank(j - 1)) frames.copyWithin(j * 4, (j - 1) * 4, j * 4);
    }
    for (let j = DRAGON_KNOTS - 2; j >= 0; j--) {
        if (blank(j) && !blank(j + 1)) frames.copyWithin(j * 4, (j + 1) * 4, (j + 2) * 4);
    }

    // ── Times: when the head reaches each knot ──
    for (let pass = 0; pass < 4; pass++) {
        let before = speeds[0];
        for (let j = 1; j < used - 1; j++) {
            const here = speeds[j];
            speeds[j] = (before + here * 2 + speeds[j + 1]) * 0.25;
            before = here;
        }
    }
    // Where a mark sits, as a knot.
    const knotOf = (mark) => {
        const pieceIndex = trail.pieces.filter((points) => points.length >= 2).indexOf(trail.pieces[mark.piece]);
        if (pieceIndex < 0) return starts[0];
        const dense = pieces[pieceIndex];
        const arc = dense.arc[Math.min(dense.at[Math.min(mark.index, dense.at.length - 1)], dense.arc.length - 1)];
        return Math.min(ends[pieceIndex], starts[pieceIndex] + Math.round(arc / spacing));
    };
    const bodyKnots = Math.ceil(body / spacing);
    const bursts = [];
    const jumps = [];
    let clock = 0;
    // A flight that gathers out of sparks starts with its body already laid along the curve.
    let first = 0;
    const formed = trail.marks.filter((mark) => mark.kind === 'formed').map(knotOf);
    if (ctx.assemble) {
        first = Math.min(ends[0], Math.max(bodyKnots + 2, formed.length ? Math.min(formed[0], bodyKnots + 8) : bodyKnots + 2));
        bursts.push({
            kind: 'assemble', t0: -1, t1: 0, t2: 0.25, t3: ASSEMBLE, radius: ctx.assemble.radius, at: first,
        });
    }
    times[first] = 0;
    let piece = 0;
    for (let j = first + 1; j < used; j++) {
        if (piece < ends.length - 1 && j > ends[piece]) {
            // The cut: the head waits at the end of the piece while the cloud crosses, then is
            // at once a body's length into the next piece.
            const landing = Math.min(ends[piece + 1], starts[piece + 1] + bodyKnots + 2);
            jumps.push({ from: ends[piece], to: landing, at: clock + JUMP_HOLD });
            bursts.push({
                kind: 'jump',
                t0: clock - BURST_RISE,
                t1: clock,
                t2: clock + JUMP_HOLD,
                t3: clock + JUMP_HOLD + BURST_FALL,
                radius: trail.cuts[piece] ?? 7,
                at: ends[piece],
                to: landing,
            });
            clock += JUMP_HOLD;
            times[landing] = clock;
            j = landing;
            piece += 1;
        } else {
            clock += spacing / Math.max(4, (speeds[j - 1] + speeds[j]) * 0.5);
            times[j] = clock;
        }
    }
    const lastKnot = ends[ends.length - 1];
    const lastSpeed = Math.max(8, speeds[lastKnot]);
    const flown = times[lastKnot];
    trail.marks.forEach((mark) => {
        const at = knotOf(mark);
        const when = Number.isFinite(times[at]) ? times[at] : 0;
        if (mark.kind === 'burst') {
            bursts.push({
                kind: 'burst',
                t0: when,
                t1: when + BURST_RISE,
                t2: when + BURST_RISE + (mark.hold ?? 0.5),
                t3: when + BURST_RISE + (mark.hold ?? 0.5) + BURST_FALL,
                radius: mark.radius ?? 6,
                at,
            });
        } else if (mark.kind === 'scatter') {
            bursts.push({
                kind: 'scatter', t0: when, t1: when + 0.5, t2: when + SCATTER + 4, t3: when + SCATTER + 5, radius: mark.radius ?? 8, at,
            });
        }
    });
    bursts.sort((a, b) => a.t0 - b.t0);
    const scatter = bursts.find((burst) => burst.kind === 'scatter');
    const skims = [];
    const skimStart = trail.marks.filter((mark) => mark.kind === 'skim').map(knotOf);
    const skimEnd = trail.marks.filter((mark) => mark.kind === 'skimEnd').map(knotOf);
    skimStart.forEach((from, i) => {
        const to = skimEnd[i] ?? Math.min(lastKnot, from + Math.ceil(14 / spacing));
        if (to > from && Number.isFinite(times[from]) && Number.isFinite(times[to])) skims.push({ from, to });
    });
    // The knots the head stops at, in order (a jump leaps over the ones between).
    const stops = [];
    for (let j = first; j <= lastKnot; j++) {
        if (Number.isFinite(times[j])) stops.push(j);
    }
    return {
        knots,
        frames,
        times,
        stops,
        spacing,
        used,
        first,
        lastKnot,
        /** Arc length of the last knot the head runs to; it runs on past it at `lastSpeed`. */
        end: lastKnot * spacing,
        lastSpeed,
        scale: sc,
        body,
        bursts,
        jumps,
        skims,
        roars: trail.marks.filter((mark) => mark.kind === 'roar').map((mark) => times[knotOf(mark)] || 0),
        /** Seconds until the tail has left the curve (or the swarm has dissolved). */
        duration: scatter ? Math.min(flown + body / lastSpeed, scatter.t0 + SCATTER) + 0.2 : flown + (body + DRAGON_BODY.fadeOut) / lastSpeed,
        dissolves: scatter ? scatter.t0 : Infinity,
    };
}

// ── Reading a flight ────────────────────────────────────────────────────────────

/**
 * The point of the curve at arc length `d` (the shader's own interpolation: uniform Catmull–Rom
 * over the knots), written into `out`.
 */
export function flightPoint(plan, d, out = { x: 0, y: 0, z: 0 }) {
    const f = Math.max(0, Math.min(DRAGON_KNOTS - 1.001, d / plan.spacing));
    const i = Math.floor(f);
    const u = f - i;
    const at = (j) => Math.max(0, Math.min(DRAGON_KNOTS - 1, j)) * 4;
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const e = at(i + 2);
    const u2 = u * u;
    const u3 = u2 * u;
    const w0 = -0.5 * u3 + u2 - 0.5 * u;
    const w1 = 1.5 * u3 - 2.5 * u2 + 1;
    const w2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
    const w3 = 0.5 * u3 - 0.5 * u2;
    const { knots } = plan;
    out.x = knots[a] * w0 + knots[b] * w1 + knots[c] * w2 + knots[e] * w3;
    out.y = knots[a + 1] * w0 + knots[b + 1] * w1 + knots[c + 1] * w2 + knots[e + 1] * w3;
    out.z = knots[a + 2] * w0 + knots[b + 2] * w1 + knots[c + 2] * w2 + knots[e + 2] * w3;
    return out;
}

/** A blank flight state (what flightState fills in). */
export const createFlightState = () => ({
    head: 0, speed: 0, burst: 0, cloud: [0, 0, 0], radius: 6, swirl: 0, strength: 0, jaw: 0, live: false,
});
const POINT = { x: 0, y: 0, z: 0 };
const POINT_B = { x: 0, y: 0, z: 0 };

/**
 * Where the flight is `age` seconds after it was called: the head's arc length and speed, how far
 * the swarm has left its seats (`burst` 0..1), where its cloud hangs and how wide, how far the
 * cloud has turned, the swarm's light (0..1: it fades in, and out as it dissolves) and how wide
 * the jaws stand open.
 */
export function flightState(plan, age, out = createFlightState()) {
    const {
        times, spacing, first, lastKnot, lastSpeed, bursts, body,
    } = plan;
    out.live = age >= 0 && age <= plan.duration;
    // ── The head ──
    let head;
    let speed = lastSpeed;
    if (age <= 0) {
        head = first * spacing;
        speed = 0;
    } else if (age >= times[lastKnot]) {
        head = lastKnot * spacing + (age - times[lastKnot]) * lastSpeed;
    } else {
        // The last stop the head has reached.
        const { stops } = plan;
        let lo = 0;
        let hi = stops.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (times[stops[mid]] <= age) lo = mid;
            else hi = mid;
        }
        const a = stops[lo];
        const b = stops[hi];
        if (b - a > 1) {
            head = a * spacing; // waiting at a cut while the cloud crosses
            speed = 0;
        } else {
            const span = Math.max(1e-5, times[b] - times[a]);
            head = (a + clamp01((age - times[a]) / span)) * spacing;
            speed = spacing / span;
        }
    }
    out.head = head;
    out.speed = speed;

    // ── The cloud ──
    let burst = 0;
    let radius = 6;
    let swirl = 0;
    let strength = smooth(0, 0.35, age);
    flightPoint(plan, head - body * 0.45, POINT);
    out.cloud[0] = POINT.x;
    out.cloud[1] = POINT.y;
    out.cloud[2] = POINT.z;
    for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        if (age < b.t0 || age > b.t3) continue; // eslint-disable-line no-continue
        // Apart at once (it eases out), together again slowly (it eases both ways).
        const up = clamp01((age - b.t0) / Math.max(1e-3, b.t1 - b.t0));
        const down = clamp01((age - b.t2) / Math.max(1e-3, b.t3 - b.t2));
        const amount = age < b.t2 ? 1 - (1 - up) * (1 - up) : 1 - down * down * (3 - 2 * down);
        if (amount <= burst) continue; // eslint-disable-line no-continue
        burst = amount;
        ({ radius } = b);
        swirl = (age - b.t0) * 1.7;
        if (b.kind === 'jump') {
            // The cloud crosses from where the swarm left its seats to where it takes them again.
            flightPoint(plan, b.at * spacing - body * 0.45, POINT);
            flightPoint(plan, b.to * spacing - body * 0.5, POINT_B);
            const k = smooth(b.t1, b.t2, age);
            out.cloud[0] = lerp(POINT.x, POINT_B.x, k);
            out.cloud[1] = lerp(POINT.y, POINT_B.y, k) + Math.sin(k * Math.PI) * 2.5;
            out.cloud[2] = lerp(POINT.z, POINT_B.z, k);
            // Drawn out along the way as it goes.
            radius = b.radius * (1 - 0.35 * Math.sin(k * Math.PI));
        } else if (b.kind === 'assemble') {
            // Sparks from all over the street draw in.
            radius = b.radius * (0.55 + 0.45 * (1 - down));
            strength = smooth(0, 0.7, age);
        } else if (b.kind === 'scatter') {
            const gone = clamp01((age - b.t0) / SCATTER);
            radius = b.radius * (0.5 + 0.9 * Math.sqrt(gone));
            out.cloud[1] += gone * gone * 7;
            strength = 1 - smooth(0.25, 1, gone);
        }
    }
    out.burst = burst;
    out.radius = radius;
    out.swirl = swirl;
    out.strength = age < 0 || age > plan.duration ? 0 : strength;
    // The jaws: wide as it comes in and as it bursts, working a little all the while.
    let jaw = 0.3 + 0.18 * Math.sin(age * 5.1);
    for (let i = 0; i < plan.roars.length; i++) jaw = Math.max(jaw, 1 - Math.abs(age - plan.roars[i] - 0.15) / 0.75);
    out.jaw = clamp01(Math.max(jaw, burst * 0.9));
    return out;
}

// ── Drone seats ─────────────────────────────────────────────────────────────────

/**
 * What a drone is. A drone show draws with LINES of drones, so most of the swarm sits on contours.
 * aSeat = (s along the body 0..1, turn 0..1 round it / line id, q along a line 0..1, seed).
 */
export const DRAGON_KIND = Object.freeze({
    scale: 0, // the skin between the lines, a lattice of scales
    crest: 1, // a sawtooth of fins along the spine
    whisker: 2, // two long tendrils from the snout
    horn: 3, // two antlers, each forked
    fan: 4, // the tail's ribs
    eye: 5,
    glow: 6, // big soft cards: the light the swarm throws on the rain
    contour: 7, // six lines down the body
    rib: 8, // rings round the body
    jaw: 9, // four lines from the skull to the snout, the lower pair dropped open
    mane: 10, // strands streaming back from the skull
    leg: 11, // four legs, three claws each
    ember: 12, // sparks the body sheds, hanging where they were let go
});

export const DRAGON_RIBS = 34;
export const DRAGON_FINS = 24;
export const DRAGON_CONTOURS = 6;
export const DRAGON_STRANDS = 22;

/** Share of the swarm each kind of drone takes (the eyes and the glow cards come off the top). */
export const DRAGON_SHARES = Object.freeze([
    [DRAGON_KIND.jaw, 0.085], [DRAGON_KIND.contour, 0.23], [DRAGON_KIND.rib, 0.1], [DRAGON_KIND.scale, 0.15],
    [DRAGON_KIND.crest, 0.1], [DRAGON_KIND.mane, 0.075], [DRAGON_KIND.whisker, 0.05], [DRAGON_KIND.horn, 0.04],
    [DRAGON_KIND.leg, 0.075], [DRAGON_KIND.fan, 0.045], [DRAGON_KIND.ember, 0.05],
]);

/**
 * Seats for `count` drones. The drones of a line are dealt evenly along it (a row of drones is
 * drawn as one tube: a gap in the row would be a gap in the tube), line by line in turn.
 * @returns {{ aSeat: Float32Array, aKind: Float32Array }}
 */
export function dragonSeats(count, seed) {
    const rand = mulberry32(seed);
    const aSeat = new Float32Array(count * 4);
    const aKind = new Float32Array(count);
    const K = DRAGON_KIND;
    const glows = Math.min(36, Math.max(6, Math.floor(count * 0.012)));
    const rest = Math.max(0, count - 2 - glows);
    let i = 0;
    const put = (kind, s, turn, q, w = rand()) => {
        if (i >= count) return;
        aSeat.set([s, turn, q, w], i * 4);
        aKind[i] = kind;
        i += 1;
    };
    put(K.eye, 0, 0.25, 0.5);
    put(K.eye, 0, 0.75, 0.5);
    for (let g = 0; g < glows; g++) put(K.glow, (g + 0.5) / glows, rand(), rand());
    let dealt = 0;
    let acc = 0;
    DRAGON_SHARES.forEach(([kind, share], index) => {
        acc += share;
        const upTo = index === DRAGON_SHARES.length - 1 ? rest : Math.round(rest * acc);
        const n = Math.max(0, upTo - dealt);
        dealt = upTo;
        // `lines` rows of `per` drones each: drone j sits on line j % lines, step floor(j / lines).
        const deal = (lines, each) => {
            const per = Math.max(1, Math.ceil(n / lines));
            for (let j = 0; j < n; j++) each(j % lines, (Math.floor(j / lines) + 0.5) / per);
        };
        if (kind === K.contour) deal(DRAGON_CONTOURS, (line, k) => put(kind, k, (line + 0.5) / DRAGON_CONTOURS, rand()));
        else if (kind === K.rib) deal(DRAGON_RIBS, (line, k) => put(kind, (line + 0.5) / DRAGON_RIBS, k, rand()));
        else if (kind === K.scale) {
            // A lattice: rings of twelve, every other ring turned half a step.
            const rings = Math.max(1, Math.floor(n / 12));
            for (let j = 0; j < n; j++) {
                const ring = Math.floor(j / 12) % rings;
                put(kind, (ring + 0.5) / rings, ((j % 12) + (ring % 2) * 0.5) / 12, rand());
            }
        } else if (kind === K.crest) deal(1, (line, k) => put(kind, k, rand(), rand()));
        else if (kind === K.jaw) deal(4, (line, k) => put(kind, rand(), (line + 0.5) / 4, k));
        else if (kind === K.whisker) deal(2, (line, k) => put(kind, rand(), line ? 0.75 : 0.25, k));
        // An antler is a beam and a tine: lines 0 and 1 are the beams, 2 and 3 the tines.
        else if (kind === K.horn) deal(4, (line, k) => put(kind, rand(), line % 2 ? 0.75 : 0.25, k, line < 2 ? 0.2 : 0.8));
        else if (kind === K.mane) deal(DRAGON_STRANDS, (line, k) => put(kind, rand(), (line + 0.5) / DRAGON_STRANDS, k ** 0.85));
        else if (kind === K.fan) deal(5, (line, k) => put(kind, rand(), (line + 0.5) / 5, k));
        // A leg is a limb (q < 0.6) and three claws (the seed says which).
        else if (kind === K.leg) deal(12, (line, k) => put(kind, rand(), ((line % 4) + 0.5) / 4, k, (Math.floor(line / 4) + 0.5) / 3));
        else for (let j = 0; j < n; j++) put(kind, rand(), rand(), rand());
    });
    while (i < count) put(K.ember, rand(), rand(), rand());
    return { aSeat, aKind };
}
