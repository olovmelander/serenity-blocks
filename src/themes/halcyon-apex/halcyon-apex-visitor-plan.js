/**
 * Halcyon Apex — the visitors (CPU only, three-free).
 *
 * Now and then something not of this world passes over the sanctuary, drawn by its light:
 *
 *   saucer      a chrome disc that glides in over the causeway, passes behind the card, stops to
 *               hang over the lagoon on the right and is gone in a blink, straight up.
 *   halcyon     a saucer that comes down out of the sky to the Halcyon, hangs over the diamond and
 *               lays a pale beam on it, then rises and zips away.
 *   triangle    a dark delta with three white lamps at its corners and an amber one at its heart,
 *               gliding slowly out of the sun's side of the sky and away over the pyramid.
 *   mothership  a long pale hull crossing high and far over the whole sky, its belly lit like a
 *               liner at night.
 *   orbs        three balls of light that swoop down to the water in front of the causeway, dance
 *               round each other and scatter.
 *   capsule      a plain white capsule that hops in jumps in front of the pyramid, hanging still
 *               between them, and leaves straight up.
 *
 * One visitor at a time, about once a minute (the first some fifteen seconds in). The schedule is a
 * pure function of the world clock, and so is every pose, so a seek shows the same sky a replay does.
 *
 * This module holds everything that needs no three: the hulls as triangle lists (one buffer, one
 * contiguous range per kind, so the world draws only the kind that flies), where their lamps sit,
 * the routes, the schedule and the poses.
 */

import {
    DEG, SITE, TAU, clamp01, mulberry32, smooth,
} from './halcyon-apex-core.js';

/** The hull kinds, in the order their ranges lie in the buffer. */
export const VISITOR_KINDS = Object.freeze(['saucer', 'triangle', 'cigar', 'orbs', 'capsule']);
export const VISITOR_KIND = Object.freeze(Object.fromEntries(VISITOR_KINDS.map((k, i) => [k, i])));

/**
 * What a hull vertex is made of (aPart.x). `param` (aPart.y) is the albedo for satin and matte, the
 * lamp group (0 | 1) for lamps.
 */
export const SURFACE = Object.freeze({
    chrome: 0, satin: 1, matte: 2, glass: 3, lamp: 4, orb: 5,
});

/** How many orbs fly together. */
export const ORB_COUNT = 3;
/** Lamp sprites a visitor may show at once (the rest of the pool is collapsed). */
export const LAMP_SLOTS = 16;

// ── Hulls ───────────────────────────────────────────────────────────────────────

class HullBuilder {
    constructor() {
        this.position = [];
        this.normal = [];
        this.part = [];
    }

    get vertexCount() {
        return this.position.length / 3;
    }

    /**
     * One triangle. Its winding is set from the normals it is given, so every face is front-facing
     * from the side its normals point to (a mesh built the wrong way round is lit from behind).
     */
    tri(a, b, c, na, nb, nc, part) {
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        if (Math.hypot(cx, cy, cz) < 1e-9) return;
        const sx = na[0] + nb[0] + nc[0];
        const sy = na[1] + nb[1] + nc[1];
        const sz = na[2] + nb[2] + nc[2];
        const flip = cx * sx + cy * sy + cz * sz < 0;
        const order = flip ? [[a, na], [c, nc], [b, nb]] : [[a, na], [b, nb], [c, nc]];
        order.forEach(([p, n]) => {
            this.position.push(p[0], p[1], p[2]);
            this.normal.push(n[0], n[1], n[2]);
            this.part.push(part[0], part[1], part[2], part[3]);
        });
    }
}

const normalize3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * A surface of revolution about y. `profile` runs from the bottom of the axis up the outside to the
 * top: { r, y, s (surface of the band that starts here), p (its param), hard (a crease here) }.
 * `along` turns the axis onto +x (a long hull's nose at +x).
 */
function revolve(builder, profile, segments, kind, { unit = 0, along = false } = {}) {
    const n = profile.length;
    // Each segment's outward normal in the (r, y) half-plane: the tangent turned clockwise.
    const seg = [];
    for (let i = 0; i < n - 1; i++) {
        const dr = profile[i + 1].r - profile[i].r;
        const dy = profile[i + 1].y - profile[i].y;
        const l = Math.hypot(dr, dy) || 1;
        seg.push([dy / l, -dr / l]);
    }
    const pointNormal = (i, band) => {
        const pt = profile[i];
        if (pt.r === 0) return [0, i === 0 ? -1 : 1];
        if (pt.hard) return seg[band];
        const a = seg[Math.max(0, i - 1)];
        const b = seg[Math.min(n - 2, i)];
        const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
        return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
    };
    const place = (r, y, theta) => {
        const p = [r * Math.cos(theta), y, r * Math.sin(theta)];
        return along ? [p[1], -p[0], p[2]] : p;
    };
    for (let i = 0; i < n - 1; i++) {
        const lo = profile[i];
        const hi = profile[i + 1];
        const part = [lo.s, lo.p ?? 0, kind, unit];
        const nLo = pointNormal(i, i);
        const nHi = pointNormal(i + 1, i);
        for (let j = 0; j < segments; j++) {
            const t0 = (j / segments) * TAU;
            const t1 = ((j + 1) / segments) * TAU;
            const A = place(lo.r, lo.y, t0);
            const B = place(lo.r, lo.y, t1);
            const C = place(hi.r, hi.y, t1);
            const D = place(hi.r, hi.y, t0);
            const nA = place(nLo[0], nLo[1], t0);
            const nB = place(nLo[0], nLo[1], t1);
            const nC = place(nHi[0], nHi[1], t1);
            const nD = place(nHi[0], nHi[1], t0);
            builder.tri(A, C, B, nA, nC, nB, part);
            builder.tri(A, D, C, nA, nD, nC, part);
        }
    }
}

/** The saucer: 15 m across. A lens of chrome, a dark belt for its rim lamps, a glass dome. */
export const SAUCER_RADIUS = 7.5;
const SAUCER_PROFILE = [
    {
        r: 0, y: -1.05, s: SURFACE.lamp, p: 0, hard: true,
    },
    {
        r: 1.25, y: -1.0, s: SURFACE.satin, p: 0.05, hard: true,
    },
    {
        r: 1.6, y: -0.9, s: SURFACE.chrome, hard: true,
    },
    {
        r: 3.0, y: -0.78, s: SURFACE.satin, p: 0.05, hard: true,
    },
    {
        r: 3.5, y: -0.73, s: SURFACE.chrome, hard: true,
    },
    { r: 4.3, y: -0.6, s: SURFACE.chrome },
    { r: 6.5, y: -0.24, s: SURFACE.chrome },
    {
        r: 7.5, y: 0.0, s: SURFACE.satin, p: 0.06, hard: true,
    },
    {
        r: 7.45, y: 0.16, s: SURFACE.chrome, hard: true,
    },
    { r: 6.1, y: 0.44, s: SURFACE.chrome },
    { r: 3.5, y: 0.9, s: SURFACE.chrome },
    {
        r: 2.75, y: 1.02, s: SURFACE.satin, p: 0.05, hard: true,
    },
    {
        r: 2.6, y: 1.12, s: SURFACE.glass, hard: true,
    },
    { r: 2.4, y: 1.6, s: SURFACE.glass },
    { r: 1.85, y: 2.08, s: SURFACE.glass },
    { r: 1.0, y: 2.4, s: SURFACE.glass },
    { r: 0, y: 2.5 },
];

/** The mothership: about 200 m nose to tail, banded, an engine glowing in its tail. */
const CIGAR_SCALE = 1.35;
const CIGAR_PROFILE = (() => {
    const pale = { s: SURFACE.matte, p: 0.2 };
    const band = { s: SURFACE.satin, p: 0.05 };
    return [
        {
            r: 0, y: -72, s: SURFACE.lamp, p: 1, hard: true,
        },
        {
            r: 3.4, y: -72, s: SURFACE.satin, p: 0.06, hard: true,
        },
        {
            r: 4.4, y: -70.5, ...pale, hard: true,
        },
        { r: 6.6, y: -62, ...pale },
        {
            r: 7.8, y: -50, ...band, hard: true,
        },
        {
            r: 7.8, y: -48.6, ...pale, hard: true,
        },
        { r: 8, y: -38, ...pale },
        {
            r: 8, y: -1, ...band, hard: true,
        },
        {
            r: 8, y: 1, ...pale, hard: true,
        },
        {
            r: 8, y: 30, ...band, hard: true,
        },
        {
            r: 8, y: 31.4, ...pale, hard: true,
        },
        { r: 7.6, y: 48, ...pale },
        { r: 6.2, y: 60, ...pale },
        { r: 4.0, y: 69, ...pale },
        { r: 1.8, y: 73.6, ...pale },
        { r: 0, y: 75, ...pale },
    ].map((pt) => ({ ...pt, r: pt.r * CIGAR_SCALE, y: pt.y * CIGAR_SCALE }));
})();

/** The capsule: a plain white pill 13 m long. */
const CAPSULE_PROFILE = (() => {
    const out = [];
    const R = 2.4;
    const H = 4.1;
    for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * (Math.PI / 2);
        out.push({ r: R * Math.sin(a), y: -H - R * Math.cos(a) });
    }
    out.push({ r: R, y: H });
    for (let k = 1; k <= 6; k++) {
        const a = (k / 6) * (Math.PI / 2);
        out.push({ r: k === 6 ? 0 : R * Math.cos(a), y: H + R * Math.sin(a) });
    }
    return out.map((pt) => ({ ...pt, s: SURFACE.matte, p: 0.8 }));
})();

/** An orb: a ball of light 2.2 m across. */
export const ORB_RADIUS = 1.1;
const ORB_PROFILE = Array.from({ length: 11 }, (_, k) => {
    const a = (k / 10) * Math.PI;
    return { r: k === 0 || k === 10 ? 0 : ORB_RADIUS * Math.sin(a), y: -ORB_RADIUS * Math.cos(a), s: SURFACE.orb };
});

/** The triangle: a dark delta 36 m on a side with rounded corners, its nose at +x. */
export const TRIANGLE = Object.freeze({
    radius: 21, corner: 3.6, top: 1.5, edgeTop: 0.3, edgeBottom: -0.3, bottom: -0.62,
});

/** Where the triangle's three corner lamps sit (on its belly's plane, toward each corner). */
const TRIANGLE_CORNER_LAMPS = [0, 1, 2].map((c) => {
    const a = (c / 3) * TAU;
    const r = (TRIANGLE.radius - TRIANGLE.corner) * 0.86;
    return [r * Math.cos(a), 0, r * Math.sin(a)];
});

function triangleHull(builder, kind) {
    const T = TRIANGLE;
    const dc = T.radius - T.corner;
    const steps = 6;
    const ring = [];
    for (let c = 0; c < 3; c++) {
        const alpha = (c / 3) * TAU;
        const cx = dc * Math.cos(alpha);
        const cz = dc * Math.sin(alpha);
        for (let k = 0; k <= steps; k++) {
            const phi = alpha - TAU / 6 + (TAU / 3) * (k / steps);
            ring.push({
                x: cx + T.corner * Math.cos(phi), z: cz + T.corner * Math.sin(phi), nx: Math.cos(phi), nz: Math.sin(phi),
            });
        }
    }
    const body = [SURFACE.satin, 0.035, kind, 0];
    const apex = [0, T.top, 0];
    const foot = [0, T.bottom, 0];
    for (let j = 0; j < ring.length; j++) {
        const q0 = ring[j];
        const q1 = ring[(j + 1) % ring.length];
        const t0 = [q0.x, T.edgeTop, q0.z];
        const t1 = [q1.x, T.edgeTop, q1.z];
        const b0 = [q0.x, T.edgeBottom, q0.z];
        const b1 = [q1.x, T.edgeBottom, q1.z];
        // Top and bottom: faceted fans (each face its own flat normal), a low pyramid each way.
        const faceUp = faceNormal(apex, t0, t1, 1);
        builder.tri(apex, t0, t1, faceUp, faceUp, faceUp, body);
        const faceDown = faceNormal(foot, b0, b1, -1);
        builder.tri(foot, b1, b0, faceDown, faceDown, faceDown, body);
        // The edge band: smooth round the corners.
        const n0 = [q0.nx, 0, q0.nz];
        const n1 = [q1.nx, 0, q1.nz];
        builder.tri(t0, b0, b1, n0, n0, n1, body);
        builder.tri(t0, b1, t1, n0, n1, n1, body);
    }
    // Lamps under the corners and the heart: discs a hair below the belly, facing down.
    const disc = (x, z, radius, y, group) => {
        const down = [0, -1, 0];
        const part = [SURFACE.lamp, group, kind, 0];
        for (let k = 0; k < 12; k++) {
            const a0 = (k / 12) * TAU;
            const a1 = ((k + 1) / 12) * TAU;
            builder.tri(
                [x, y, z],
                [x + radius * Math.cos(a1), y, z + radius * Math.sin(a1)],
                [x + radius * Math.cos(a0), y, z + radius * Math.sin(a0)],
                down,
                down,
                down,
                part,
            );
        }
    };
    TRIANGLE_CORNER_LAMPS.forEach(([x, , z]) => disc(x, z, 1.5, bellyAt(Math.hypot(x, z), T.radius) - 0.04, 0));
    disc(0, 0, 3.2, T.bottom - 0.05, 1);
}

/**
 * Height of the triangle's belly `r` metres out from its centre, toward a point of its outline
 * `reach` metres out (the belly is a fan from the centre to the outline).
 */
function bellyAt(r, reach) {
    const T = TRIANGLE;
    return T.bottom + (T.edgeBottom - T.bottom) * Math.min(1, r / reach);
}

function faceNormal(a, b, c, sign) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = normalize3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    return n[1] * sign < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/**
 * Every hull in one triangle list: position, normal and part (surface, param, kind, unit). Each
 * kind's vertices are one contiguous range (`ranges[kind] = [start, count]`), so the world draws only
 * the kind that flies.
 */
export function buildHulls() {
    const b = new HullBuilder();
    const ranges = [];
    const mark = (kind, build) => {
        const start = b.vertexCount;
        build();
        ranges[kind] = [start, b.vertexCount - start];
    };
    mark(VISITOR_KIND.saucer, () => revolve(b, SAUCER_PROFILE, 48, VISITOR_KIND.saucer));
    mark(VISITOR_KIND.triangle, () => triangleHull(b, VISITOR_KIND.triangle));
    mark(VISITOR_KIND.cigar, () => revolve(b, CIGAR_PROFILE, 28, VISITOR_KIND.cigar, { along: true }));
    mark(VISITOR_KIND.orbs, () => {
        for (let unit = 0; unit < ORB_COUNT; unit++) revolve(b, ORB_PROFILE, 16, VISITOR_KIND.orbs, { unit });
    });
    mark(VISITOR_KIND.capsule, () => revolve(b, CAPSULE_PROFILE, 24, VISITOR_KIND.capsule, { along: true }));
    return {
        position: new Float32Array(b.position),
        normal: new Float32Array(b.normal),
        part: new Float32Array(b.part),
        ranges,
        vertexCount: b.vertexCount,
    };
}

// ── Lamps ───────────────────────────────────────────────────────────────────────

/**
 * Where each kind's lamps sit on its hull (metres, hull space), and what kind of lamp each is.
 * The world lights them as sprites, so a lamp still reads as a point of light when its hull is a
 * few pixels across.
 */
export const VISITOR_LAMPS = Object.freeze({
    saucer: Object.freeze([
        ...Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * TAU;
            return Object.freeze({
                at: [7.36 * Math.cos(a), 0.08, 7.36 * Math.sin(a)], group: 'rim', index: i, size: 0.9,
            });
        }),
        Object.freeze({
            at: [0, -1.3, 0], group: 'under', index: 0, size: 5,
        }),
    ]),
    triangle: Object.freeze([
        ...TRIANGLE_CORNER_LAMPS.map((at, i) => Object.freeze({
            at: [at[0], bellyAt(Math.hypot(at[0], at[2]), TRIANGLE.radius) - 0.35, at[2]], group: 'corner', index: i, size: 2.4,
        })),
        Object.freeze({
            at: [0, TRIANGLE.bottom - 0.4, 0], group: 'core', index: 0, size: 4.5,
        }),
    ]),
    cigar: Object.freeze([
        // A row of six windows down each lower flank, whichever side faces the eye.
        ...Array.from({ length: 12 }, (_, i) => {
            const side = i < 6 ? 1 : -1;
            const k = i % 6;
            return Object.freeze({
                at: [(-36 + k * 14.4) * CIGAR_SCALE, -4.1 * CIGAR_SCALE, side * 7.3 * CIGAR_SCALE], group: 'window', index: k, size: 3.6,
            });
        }),
        Object.freeze({
            at: [75.8 * CIGAR_SCALE, 0, 0], group: 'nose', index: 0, size: 6,
        }),
        Object.freeze({
            at: [-60 * CIGAR_SCALE, 7.6 * CIGAR_SCALE, 0], group: 'tail', index: 0, size: 5.5,
        }),
        Object.freeze({
            at: [-73 * CIGAR_SCALE, 0, 0], group: 'engine', index: 0, size: 16,
        }),
    ]),
    orbs: Object.freeze(Array.from({ length: ORB_COUNT }, (_, i) => Object.freeze({
        at: [0, 0, 0], group: 'orb', index: i, size: 4.2,
    }))),
    capsule: Object.freeze([]),
});

// ── Routes ──────────────────────────────────────────────────────────────────────
//
// A route is a list of keys, each a place at a time. A place is given as seen from the rest camera
// (`az` degrees right of where it looks, `el` degrees over the horizon, `d` metres away over the
// water), or as metres in the camera's own frame (`x` right, `y` up, `z` toward the view, negative),
// or over the Halcyon (`halcyon: metres over its top`). A `stop` key is a standstill: the visitor
// comes to rest there and leaves from rest. Between keys it flies a cubic through them.

/**
 * @typedef {object} RouteKey
 * @property {number} t
 * @property {number} [az] @property {number} [el] @property {number} [d]
 * @property {number} [x] @property {number} [y] @property {number} [z]
 * @property {number} [halcyon]
 * @property {boolean} [stop]
 * @property {number} [yaw]  degrees (the capsule turns between hops; it never faces where it goes)
 */

function line(from, to, t0, t1, count) {
    const keys = [];
    for (let i = 0; i <= count; i++) {
        const k = i / count;
        keys.push({
            t: t0 + (t1 - t0) * k,
            x: from.x + (to.x - from.x) * k,
            y: from.y + (to.y - from.y) * k,
            z: from.z + (to.z - from.z) * k,
        });
    }
    return keys;
}

export const VISITOR_ROUTES = Object.freeze([
    Object.freeze({
        name: 'saucer',
        kind: 'saucer',
        calm: false,
        keys: Object.freeze([
            // Over the pyramid's shoulder, down across its face to skim the lagoon by the causeway,
            // behind the card, up to hang over the right of the lagoon, and gone.
            {
                t: 0, az: -55, el: 26, d: 300,
            },
            {
                t: 3, az: -36, el: 22, d: 200,
            },
            {
                t: 6, az: -24, el: 6, d: 120,
            },
            {
                t: 8.4, az: -6, el: 7, d: 140,
            },
            {
                t: 10.6, az: 20, el: 13, d: 200,
            },
            {
                t: 12.4, az: 35, el: 19, d: 260, stop: true,
            },
            {
                t: 14.4, az: 36, el: 19.6, d: 260, stop: true,
            },
            {
                t: 14.95, az: 42, el: 55, d: 3800, stop: true,
            },
        ]),
        fadeIn: 0,
        fadeOut: 0.25,
        warp: 14.4,
    }),
    Object.freeze({
        name: 'halcyon',
        kind: 'saucer',
        calm: false,
        keys: Object.freeze([
            {
                t: 0, az: 54, el: 30, d: 620,
            },
            {
                t: 3.6, az: 38, el: 25, d: 320,
            },
            { t: 5.6, halcyon: 12, stop: true },
            { t: 11.4, halcyon: 13.5, stop: true },
            { t: 12.8, halcyon: 24, stop: true },
            {
                t: 13.35, az: 22, el: 52, d: 4200, stop: true,
            },
        ]),
        fadeIn: 0,
        fadeOut: 0.25,
        warp: 12.8,
        beam: Object.freeze([6.0, 11.2]),
    }),
    Object.freeze({
        name: 'triangle',
        kind: 'triangle',
        calm: true,
        // In from the right, high over the HUD (clear of the sun's glare), it slows to a stop and
        // hangs there, turning one notch of its three about its heart, then lifts away up and out.
        keys: Object.freeze([
            {
                t: 0, x: 540, y: 150, z: -330, yaw: 180,
            },
            {
                t: 7.5, x: 125, y: 132, z: -300, stop: true, yaw: 180,
            },
            {
                t: 12.5, x: 118, y: 134, z: -298, stop: true, yaw: 300,
            },
            {
                t: 21, x: 760, y: 560, z: -820, yaw: 330,
            },
        ]),
        fadeIn: 0.4,
        fadeOut: 0.5,
    }),
    Object.freeze({
        name: 'mothership',
        kind: 'cigar',
        calm: true,
        // A straight line high and far, square to the view: it holds one height on screen, high
        // over the HUD and the sun, and passes behind the Apex's tip on the left.
        keys: Object.freeze(line({ x: 1300, y: 453, z: -1000 }, { x: -1300, y: 453, z: -1000 }, 0, 42, 4)),
        fadeIn: 0.6,
        fadeOut: 0.6,
    }),
    Object.freeze({
        name: 'orbs',
        kind: 'orbs',
        calm: false,
        keys: Object.freeze([
            {
                t: 0, az: -46, el: 30, d: 620,
            },
            {
                t: 2.8, az: -27, el: 2.6, d: 105, stop: true,
            },
            {
                t: 7.8, az: -24.5, el: 3.4, d: 110, stop: true,
            },
            {
                t: 8.6, az: -24.5, el: 3.4, d: 110, stop: true,
            },
        ]),
        fadeIn: 0,
        fadeOut: 0.3,
        warp: 7.8,
        /** When the three fall in from a line into a ring, and when they scatter. */
        dance: Object.freeze({ lag: 0.26, ring: 2.8, scatter: 7.8 }),
    }),
    Object.freeze({
        name: 'capsule',
        kind: 'capsule',
        calm: false,
        keys: Object.freeze([
            {
                t: 0, az: -33, el: 9, d: 150, stop: true, yaw: 8,
            },
            {
                t: 1.9, az: -33.3, el: 9.2, d: 150, stop: true, yaw: 8,
            },
            {
                t: 2.08, az: -21, el: 13, d: 158, stop: true, yaw: -22,
            },
            {
                t: 3.5, az: -21.2, el: 13.1, d: 158, stop: true, yaw: -22,
            },
            {
                t: 3.68, az: -37, el: 15.5, d: 168, stop: true, yaw: 30,
            },
            {
                t: 5.0, az: -36.7, el: 15.3, d: 168, stop: true, yaw: 30,
            },
            {
                t: 5.16, az: -27, el: 6.5, d: 140, stop: true, yaw: -5,
            },
            {
                t: 6.7, az: -27.2, el: 6.7, d: 140, stop: true, yaw: -5,
            },
            {
                t: 7.1, az: -48, el: 64, d: 4600, stop: true, yaw: -5,
            },
        ]),
        fadeIn: 0.7,
        fadeOut: 0.2,
        warp: 6.7,
    }),
].map((route) => Object.freeze({ ...route, duration: route.keys[route.keys.length - 1].t })));

export const VISITOR_ROUTE = Object.freeze(Object.fromEntries(VISITOR_ROUTES.map((r) => [r.name, r])));

// ── The schedule ────────────────────────────────────────────────────────────────

/** Seconds per slot of the schedule; a slot holds one visit or none. */
export const VISIT_SLOT = 50;
/** The share of slots that hold a visit (the first always does). */
export const VISIT_CHANCE = 0.8;
/** A visit keeps this far from either end of its slot. */
const SLOT_MARGIN = 4;
/** When the first visit of a session starts (seconds of world time), and who flies it. */
export const FIRST_VISIT = 14;
const SCHEDULE_SEED = 0x51ce;

function shuffled(count, seed) {
    const rand = mulberry32(seed);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** The routes a schedule draws from: all of them, or under reduced motion only the slow ones. */
export function scheduleRoutes(reduced = false) {
    return reduced ? VISITOR_ROUTES.filter((r) => r.calm) : VISITOR_ROUTES;
}

/**
 * Which route slot `k` flies: every route once per cycle of slots, in a shuffled order, and never
 * the same one twice running across a cycle's seam (two routes simply take turns).
 */
function routeForSlot(k, routes) {
    const n = routes.length;
    if (n <= 2) return routes[k % n];
    const cycle = Math.floor(k / n);
    const order = shuffled(n, SCHEDULE_SEED + cycle * 7919);
    if (cycle > 0 && shuffled(n, SCHEDULE_SEED + (cycle - 1) * 7919)[n - 1] === order[0]) {
        [order[0], order[1]] = [order[1], order[0]];
    }
    return routes[order[k % n]];
}

/**
 * The visit planned for slot `k`, or null: { route, start }.
 * @param {number} k
 * @param {boolean} [reduced]
 */
export function slotVisit(k, reduced = false) {
    if (!(k >= 0)) return null;
    const routes = scheduleRoutes(reduced);
    if (k === 0) {
        const route = reduced ? VISITOR_ROUTE.triangle : VISITOR_ROUTE.saucer;
        return { route, start: FIRST_VISIT };
    }
    const rand = mulberry32((SCHEDULE_SEED ^ Math.imul(k, 0x9e3779b1)) >>> 0);
    if (rand() > VISIT_CHANCE) return null;
    const route = routeForSlot(k, routes);
    const room = Math.max(0, VISIT_SLOT - 2 * SLOT_MARGIN - route.duration);
    return { route, start: k * VISIT_SLOT + SLOT_MARGIN + rand() * room };
}

/**
 * The visit in the sky at world time `t`, or null: { route, start, age }.
 * @param {number} t
 * @param {boolean} [reduced]
 */
export function visitAt(t, reduced = false) {
    if (!(t >= 0)) return null;
    const plan = slotVisit(Math.floor(t / VISIT_SLOT), reduced);
    if (!plan) return null;
    const age = t - plan.start;
    if (age < 0 || age > plan.route.duration) return null;
    return { route: plan.route, start: plan.start, age };
}

// ── Poses ───────────────────────────────────────────────────────────────────────

/**
 * Where each key of `route` lies in the world, for the rest camera turned `frame.yaw` (radians left
 * of −Z) at `frame.eye` metres, and the Halcyon's top at `frame.halcyonTop` ([x, y, z]).
 */
export function routePoints(route, frame) {
    const yaw = frame.yaw || 0;
    const eye = frame.eye ?? 3.2;
    const upright = clamp01(frame.upright || 0);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return route.keys.map((k) => {
        if (k.halcyon !== undefined) {
            const top = frame.halcyonTop || [70, SITE.halcyon.height + SITE.halcyon.half, -135];
            return [top[0], top[1] + k.halcyon, top[2]];
        }
        let { az } = k;
        let { el } = k;
        let { d } = k;
        if (k.x !== undefined) {
            d = Math.hypot(k.x, k.z);
            az = Math.atan2(k.x, -k.z) / DEG;
            el = Math.atan2(k.y - eye, d) / DEG;
        }
        // An upright screen is too narrow for the sky round the card, and its card covers the
        // middle: the routes close in toward the view and rise into the band of sky over the card.
        if (upright > 0 && el < 40) {
            az *= 1 - 0.45 * upright;
            el += (15.5 + el * 0.27 - el) * upright;
        }
        const a = az * DEG;
        const h = [fx * Math.cos(a) + rx * Math.sin(a), fz * Math.cos(a) + rz * Math.sin(a)];
        return [h[0] * d, eye + Math.tan(el * DEG) * d, h[1] * d];
    });
}

/** Velocity at each key: zero at a stop, else the chord across its neighbours over their time. */
function keyVelocities(keys, points) {
    const n = keys.length;
    return points.map((p, i) => {
        if (keys[i].stop || n < 2) return [0, 0, 0];
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const dt = keys[b].t - keys[a].t || 1;
        return [0, 1, 2].map((c) => (points[b][c] - points[a][c]) / dt);
    });
}

/**
 * Position, velocity and acceleration on the route's cubic at `age` (clamped to the route).
 * @returns {{ p: number[], v: number[], a: number[], segment: number, s: number }}
 */
export function routeSample(route, points, velocities, age, out = { p: [0, 0, 0], v: [0, 0, 0], a: [0, 0, 0] }) {
    const { keys } = route;
    const n = keys.length;
    const t = Math.max(keys[0].t, Math.min(keys[n - 1].t, age));
    let i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i += 1;
    const h = Math.max(1e-6, keys[i + 1].t - keys[i].t);
    const s = clamp01((t - keys[i].t) / h);
    const s2 = s * s;
    const s3 = s2 * s;
    const P0 = points[i];
    const P1 = points[i + 1];
    const V0 = velocities[i];
    const V1 = velocities[i + 1];
    for (let c = 0; c < 3; c++) {
        out.p[c] = (2 * s3 - 3 * s2 + 1) * P0[c] + (s3 - 2 * s2 + s) * h * V0[c] + (-2 * s3 + 3 * s2) * P1[c] + (s3 - s2) * h * V1[c];
        out.v[c] = ((6 * s2 - 6 * s) * P0[c] + (3 * s2 - 4 * s + 1) * h * V0[c] + (-6 * s2 + 6 * s) * P1[c] + (3 * s2 - 2 * s) * h * V1[c]) / h;
        out.a[c] = ((12 * s - 6) * P0[c] + (6 * s - 4) * h * V0[c] + (-12 * s + 6) * P1[c] + (6 * s - 2) * h * V1[c]) / (h * h);
    }
    out.segment = i;
    out.s = s;
    return out;
}

/** A smooth hum: the sum of two sines (deterministic jitter for hovering hulls). */
const hum = (t, a, b, phase) => Math.sin(t * a + phase) * 0.6 + Math.sin(t * b + phase * 1.7) * 0.4;

/**
 * Everything the world needs to draw a visitor at `age` seconds into its route.
 * @param {object} route
 * @param {number} age
 * @param {{ yaw?: number, eye?: number, halcyonTop?: number[], upright?: number }} frame  upright: 0 for a
 *   wide screen, 1 for a phone held upright (routes close in and rise over the card)
 * @returns {object} pose: kind, p (world), v, yaw, tilt [x, z] (radians, the way its top leans),
 *   spin (radians about its own axis), units (orbs' world places), presence (0..1, how much of it
 *   is here), flash (0..1, its lamps flaring as it leaves), beam (0..1) and beamTo (world)
 */
export function visitorPose(route, age, frame = {}) {
    const points = routePoints(route, frame);
    const velocities = keyVelocities(route.keys, points);
    const smp = routeSample(route, points, velocities, age);
    const { kind } = route;
    const pose = {
        kind,
        route: route.name,
        age,
        p: [...smp.p],
        v: [...smp.v],
        yaw: 0,
        tilt: [0, 0],
        spin: 0,
        units: null,
        presence: 1,
        flash: 0,
        beam: 0,
        beamFrom: null,
        beamTo: null,
    };
    const T = route.duration;
    pose.presence = (route.fadeIn > 0 ? smooth(0, route.fadeIn, age) : 1)
        * (route.fadeOut > 0 ? 1 - smooth(T - route.fadeOut, T, age) : 1);
    if (route.warp !== undefined) {
        const x = (age - route.warp) / 0.14;
        pose.flash = Math.exp(-x * x);
    }
    const speed = Math.hypot(smp.v[0], smp.v[1], smp.v[2]);
    const heading = Math.atan2(-smp.v[2], smp.v[0]);
    const hover = Math.exp(-speed / 4);
    if (kind === 'saucer') {
        // A saucer leans the way it flies, and into its turns; hanging still, it rocks and bobs.
        const k = 0.009;
        let tx = smp.v[0] * k + smp.a[0] * 0.02;
        let tz = smp.v[2] * k + smp.a[2] * 0.02;
        const lean = Math.hypot(tx, tz);
        if (lean > 0.36) {
            tx *= 0.36 / lean;
            tz *= 0.36 / lean;
        }
        pose.tilt[0] = tx + Math.sin(age * 1.9) * 0.05 * hover;
        pose.tilt[1] = tz + Math.cos(age * 1.37) * 0.05 * hover;
        pose.p[1] += Math.sin(age * 1.3) * 0.45 * hover;
        // It turns on its axis, and spins up as it leaves.
        const lift = route.warp !== undefined ? Math.max(0, age - route.warp) : 0;
        pose.spin = age * 0.9 + lift * lift * 14;
    } else if (kind !== 'capsule' && route.keys[0].yaw !== undefined) {
        // A route that sets its own heading (the triangle turns in place while it hangs still).
        const { keys } = route;
        const i = smp.segment;
        const y0 = keys[i].yaw;
        const y1 = keys[i + 1].yaw ?? y0;
        const e = smp.s * smp.s * (3 - 2 * smp.s);
        pose.yaw = (frame.yaw || 0) + (y0 + (y1 - y0) * e) * DEG;
        pose.tilt[0] = Math.sin(age * 0.53) * 0.03 + smp.a[0] * 0.004;
        pose.tilt[1] = Math.cos(age * 0.41) * 0.03 + smp.a[2] * 0.004;
        pose.p[1] += Math.sin(age * 0.9) * 0.6 * hover;
    } else if (kind === 'triangle' || kind === 'cigar') {
        pose.yaw = heading;
        // Bank into a turn: the top leans toward the sideways part of the acceleration.
        const right = [-Math.sin(heading), Math.cos(heading)];
        const lateral = smp.a[0] * right[0] + smp.a[2] * right[1];
        const bank = Math.max(-0.25, Math.min(0.25, lateral * (kind === 'triangle' ? 0.12 : 0.04)));
        pose.tilt[0] = right[0] * bank;
        pose.tilt[1] = right[1] * bank;
        if (kind === 'triangle') {
            pose.tilt[0] += Math.sin(age * 0.53) * 0.025;
            pose.tilt[1] += Math.cos(age * 0.41) * 0.025;
        }
    } else if (kind === 'capsule') {
        // It never faces where it goes: it turns while it hops and hangs still between, humming.
        const { keys } = route;
        const i = smp.segment;
        const y0 = keys[i].yaw ?? 0;
        const y1 = keys[i + 1].yaw ?? y0;
        const e = smp.s * smp.s * (3 - 2 * smp.s);
        pose.yaw = (frame.yaw || 0) + (y0 + (y1 - y0) * e) * DEG;
        pose.p[0] += hum(age, 7.1, 11.3, 0.4) * 0.22 * hover;
        pose.p[1] += hum(age, 6.3, 9.7, 1.9) * 0.18 * hover;
        pose.p[2] += hum(age, 5.7, 12.9, 3.1) * 0.22 * hover;
        pose.tilt[0] = hum(age, 4.3, 8.9, 2.2) * 0.03 * hover;
        pose.tilt[1] = hum(age, 3.9, 7.7, 0.7) * 0.03 * hover;
    } else if (kind === 'orbs') {
        pose.units = orbPlaces(route, points, velocities, age);
    }
    if (route.beam) {
        const [on, off] = route.beam;
        pose.beam = smooth(on, on + 0.6, age) * (1 - smooth(off - 0.7, off, age));
        const top = frame.halcyonTop || [70, SITE.halcyon.height + SITE.halcyon.half, -135];
        pose.beamFrom = [pose.p[0], pose.p[1] - 1.2, pose.p[2]];
        pose.beamTo = [top[0], top[1] - 1.5, top[2]];
    }
    return pose;
}

/** Where scattering orb `i` heads (a unit direction, then how far it goes). */
const ORB_EXITS = [
    [[-0.55, 0.8, -0.25], 3600],
    [[0.35, 0.92, -0.2], 3900],
    [[-0.15, 0.35, -0.92], 4200],
];

/**
 * The three orbs: they come in on a line, each a moment behind the one before; at the dance's ring
 * they fall into a ring that turns, tilted to the eye; at the scatter each shoots off its own way.
 */
function orbPlaces(route, points, velocities, age) {
    const { lag, ring, scatter } = route.dance;
    const centre = routeSample(route, points, velocities, age).p;
    const places = [];
    for (let i = 0; i < ORB_COUNT; i++) {
        const trail = routeSample(route, points, velocities, age - i * lag).p;
        // The ring: radius 5.5 m, tilted 55° toward the eye, turning a third of a turn a second.
        const a = (i / ORB_COUNT) * TAU + age * 2.1;
        const r = 5.5 + Math.sin(age * 1.7 + i * 2.1) * 1.2;
        const ringAt = [
            centre[0] + Math.cos(a) * r,
            centre[1] + Math.sin(a) * r * 0.82 + 1.5,
            centre[2] + Math.sin(a) * r * 0.57,
        ];
        const fall = smooth(ring - 0.1, ring + 0.9, age);
        const at = [0, 1, 2].map((c) => trail[c] + (ringAt[c] - trail[c]) * fall);
        // The scatter: from rest to thousands of metres in half a second.
        const go = clamp01((age - scatter) / 0.55);
        const [dir, reach] = ORB_EXITS[i];
        const throwOut = go * go * go * reach;
        places.push([at[0] + dir[0] * throwOut, at[1] + dir[1] * throwOut, at[2] + dir[2] * throwOut]);
    }
    return places;
}
