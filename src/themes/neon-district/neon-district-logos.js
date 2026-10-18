/**
 * Neon District — the district's tube-neon marks (CPU only, three-free).
 *
 * Every campaign in neon-district-campaigns.js hangs a mark bent from glass tube, and the trade
 * shops that are nobody's brand hang the street's generic ones: a martini glass, a pharmacy cross,
 * a cup of coffee. A mark is a few continuous strokes of one weight in a 10 × 10 box (y up), split
 * over four channels:
 *
 *  - R: the tube that is always lit.
 *  - G, B, A: the animation's frames, lit as the mark's `anim` says over `period` seconds
 *    (logoFrames is the CPU statement of the rule the shader follows).
 *
 * The atlas holds one distance field per channel, so each frame is a clean line of light at any
 * size and the shader lights frames on their own. No mark is built from the board's pieces, none
 * spells a word, and none draws a real company's logo.
 */

import { bakeOnce } from '../shared/bake-cache.js';

export const LOGO_GRID = 4;
export const LOGO_CELL = 128;
/** Distance (in cells) that maps to 0 in the atlas; 255 is a stroke's centre line. */
export const LOGO_RANGE = 0.07;
/** The authoring box: strokes are drawn in 0..LOGO_UNITS on both axes (y up). */
export const LOGO_UNITS = 10;
/** The stroke box inside a cell (cell units): its margin is wider than the range, so no halo bleeds. */
export const LOGO_BOX = Object.freeze({
    x0: 0.09, x1: 0.91, y0: 0.09, y1: 0.91,
});

/**
 * How a mark's G, B and A frames light (R is always lit):
 *  - none: no frames;  blink: G on, then off;  alt: G, then B;
 *  - cycle: G, then B, then A, one at a time;  build: G, G+B, G+B+A, then all off;
 *  - breath: G inner, B middle, A outer, lit in turn as a breath fills and put out as it empties.
 */
export const LOGO_ANIMS = Object.freeze(['none', 'blink', 'alt', 'cycle', 'build', 'breath']);

/** The fraction of a breath cycle spent breathing in (the game's breath: 4 s in, 6 s out). */
export const LOGO_BREATH_IN = 0.4;

/**
 * The marks in atlas order: mark i sits at column i % 4, row floor(i / 4) (row 0 at the bottom of
 * the data). `period` is one full animation cycle in seconds; the breath mark's is the breath's.
 */
export const LOGOS = Object.freeze([
    Object.freeze({ id: 'cascade', anim: 'cycle', period: 1.5 }),
    Object.freeze({ id: 'combo', anim: 'cycle', period: 2.1 }),
    Object.freeze({ id: 'stack', anim: 'build', period: 2.4 }),
    Object.freeze({ id: 'drop', anim: 'cycle', period: 1.2 }),
    Object.freeze({ id: 'level', anim: 'build', period: 2 }),
    Object.freeze({ id: 'next', anim: 'cycle', period: 0.9 }),
    Object.freeze({ id: 'clear', anim: 'alt', period: 1.6 }),
    Object.freeze({ id: 'spin', anim: 'cycle', period: 0.9 }),
    Object.freeze({ id: 'hale', anim: 'breath', period: 10 }),
    Object.freeze({ id: 'transit', anim: 'cycle', period: 2.4 }),
    Object.freeze({ id: 'cocktail', anim: 'blink', period: 1.4 }),
    Object.freeze({ id: 'cross', anim: 'blink', period: 1.2 }),
    Object.freeze({ id: 'coffee', anim: 'alt', period: 1.6 }),
    Object.freeze({ id: 'note', anim: 'alt', period: 1 }),
    Object.freeze({ id: 'joystick', anim: 'alt', period: 0.8 }),
    Object.freeze({ id: 'heart', anim: 'blink', period: 1.1 }),
]);

/** A mark's atlas cell by id (-1 if the district has no such mark). */
export const logoIndex = (id) => LOGOS.findIndex((logo) => logo.id === id);

/**
 * Which of G, B, A the animation lights at `phase` (cycles of its period; only the fraction
 * counts), as [g, b, a] of 0 or 1. 'breath' reads the phase as the breath: in for the first
 * LOGO_BREATH_IN of it, out for the rest.
 * @param {string} anim
 * @param {number} phase
 * @returns {number[]}
 */
export function logoFrames(anim, phase) {
    const p = phase - Math.floor(phase);
    switch (anim) {
    case 'blink': return [p < 0.5 ? 1 : 0, 0, 0];
    case 'alt': return p < 0.5 ? [1, 0, 0] : [0, 1, 0];
    case 'cycle': {
        const k = Math.min(2, Math.floor(p * 3));
        return [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
    }
    case 'build': {
        const k = Math.min(3, Math.floor(p * 4));
        return [k < 3 ? 1 : 0, k === 1 || k === 2 ? 1 : 0, k === 2 ? 1 : 0];
    }
    case 'breath': {
        const fill = p < LOGO_BREATH_IN ? p / LOGO_BREATH_IN : 1 - (p - LOGO_BREATH_IN) / (1 - LOGO_BREATH_IN);
        return [fill > 1 / 6 ? 1 : 0, fill > 1 / 2 ? 1 : 0, fill > 5 / 6 ? 1 : 0];
    }
    default: return [0, 0, 0];
    }
}

// ---------------------------------------------------------------------------------------------
// The bender's tools: each returns a polyline (a list of [x, y] points). Curves are cut into
// steps of at most STEP units and TURN degrees, so a bowl or a wheel shows no facets at 128
// texels a cell (a step bows at most about a tenth of a texel off the true curve).

const STEP = 0.4;
const TURN = 12;
const RAD = Math.PI / 180;
const steps = (length) => Math.max(2, Math.ceil(length / STEP));
const arcSteps = (r, degrees) => Math.max(steps(Math.abs(degrees) * RAD * r), Math.ceil(Math.abs(degrees) / TURN));

/** A circular arc from angle a0 to a1 (degrees, counter-clockwise from +x). */
export function arc(cx, cy, r, a0, a1, n = arcSteps(r, a1 - a0)) {
    const points = [];
    for (let i = 0; i <= n; i++) {
        const a = (a0 + ((a1 - a0) * i) / n) * RAD;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return points;
}

/** An elliptical arc (degrees, as `arc`), its axes turned by `tilt` degrees. */
export function ellipse(cx, cy, rx, ry, a0 = 0, a1 = 360, n = arcSteps(Math.max(rx, ry), a1 - a0), tilt = 0) {
    const c = Math.cos(tilt * RAD);
    const s = Math.sin(tilt * RAD);
    const points = [];
    for (let i = 0; i <= n; i++) {
        const a = (a0 + ((a1 - a0) * i) / n) * RAD;
        const x = rx * Math.cos(a);
        const y = ry * Math.sin(a);
        points.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return points;
}

/** Points f(t) for t from 0 to 1 in n steps. */
export function curve(n, f) {
    return Array.from({ length: n + 1 }, (_, i) => f(i / n));
}

/** A smooth curve through the given points (Catmull-Rom, ends held). */
export function smooth(points) {
    const out = [points[0]];
    for (let i = 0; i + 1 < points.length; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const n = steps(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            const t2 = t * t;
            const t3 = t2 * t;
            const w0 = -0.5 * t3 + t2 - 0.5 * t;
            const w1 = 1.5 * t3 - 2.5 * t2 + 1;
            const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
            const w3 = 0.5 * t3 - 0.5 * t2;
            out.push([
                w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
                w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
            ]);
        }
    }
    return out;
}

/** One tube through several pieces in turn (a joint shared by two pieces is kept once). */
export function join(...parts) {
    const out = [];
    for (const part of parts) {
        for (const p of part) {
            const last = out[out.length - 1];
            if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
        }
    }
    return out;
}

/** The polyline closed back to its first point. */
export const closed = (points) => join(points, [points[0]]);

/** A closed rectangle with corners bent to radius r. */
export function roundRect(x0, y0, x1, y1, r) {
    return closed(join(
        arc(x1 - r, y0 + r, r, -90, 0),
        arc(x1 - r, y1 - r, r, 0, 90),
        arc(x0 + r, y1 - r, r, 90, 180),
        arc(x0 + r, y0 + r, r, 180, 270),
    ));
}

/** A falling drop: the round of radius r at (cx, cy), its point `tip` above the centre. */
function drop(cx, cy, r, tip) {
    const a = Math.acos(r / tip) / RAD;
    return closed(join([[cx, cy + tip]], arc(cx, cy, r, 90 + a, 450 - a)));
}

/** A petal: a pointed lens from `base` to `tip`, `w` wide at its middle on each side. */
function petal([bx, by], [tx, ty], w) {
    const len = Math.hypot(tx - bx, ty - by);
    const ux = (tx - bx) / len;
    const uy = (ty - by) / len;
    // Each side is a circular arc through base and tip, bowed out by w.
    const r = ((len * len) / 4 + w * w) / (2 * w);
    const half = Math.asin(len / 2 / r) / RAD;
    const mx = (bx + tx) / 2;
    const my = (by + ty) / 2;
    const along = Math.atan2(uy, ux) / RAD;
    const off = r - w;
    // The left side bows round a centre on the right of the axis, and the other way about.
    const left = arc(mx + uy * off, my - ux * off, r, along + 90 + half, along + 90 - half);
    const right = arc(mx - uy * off, my + ux * off, r, along - 90 + half, along - 90 - half);
    return closed(join(left, right));
}

/** Points scaled by k about (cx, cy). */
const scaled = (points, k, cx, cy) => points.map(([x, y]) => [cx + k * (x - cx), cy + k * (y - cy)]);

/** A rising steam wisp: a sine wave up from (x, y0) to y1. */
function wisp(x, y0, y1, amp, waves, phase = 0) {
    return curve(steps((y1 - y0) * 1.6), (t) => [
        x + amp * Math.sin((t * waves + phase) * 2 * Math.PI), y0 + (y1 - y0) * t,
    ]);
}

/** The half-width of a profile (a list of [halfWidth, y] rising in y) at height y. */
function widthAt(profile, y) {
    for (let i = 0; i + 1 < profile.length; i++) {
        const [w0, y0] = profile[i];
        const [w1, y1] = profile[i + 1];
        if (y >= y0 && y <= y1) return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0 || 1);
    }
    return profile[profile.length - 1][0];
}

// ---------------------------------------------------------------------------------------------
// The marks: each returns its channels [R, G, B, A], each a list of polylines.

const DESIGNS = {
    /**
     * A rounded soda bottle with a label band; a drop falls in a column beside it (top, middle,
     * bottom). A plain barrel, no waist and no ribbon: nothing of any real cola's bottle.
     */
    cascade() {
        const cx = 3.7;
        const profile = smooth([
            [1.35, 0.6], [1.85, 1.15], [2.02, 2.6], [1.95, 4.3], [1.55, 5.75], [0.92, 6.85], [0.68, 7.7], [0.66, 9.1],
        ]);
        const bottle = closed(join(
            profile.map(([w, y]) => [cx + w, y]),
            profile.map(([w, y]) => [cx - w, y]).reverse(),
        ));
        const band = (y) => [[cx - widthAt(profile, y), y], [cx + widthAt(profile, y), y]];
        const cap = [[cx - 0.66, 8.4], [cx + 0.66, 8.4]];
        const fall = (y) => [drop(8.2, y, 0.62, 1.25)];
        return [[bottle, band(2.4), band(4.2), cap], fall(7.75), fall(4.95), fall(2.15)];
    },

    /** A noodle bowl with chopsticks in it; three wisps of steam rise in turn. */
    combo() {
        const bowl = join(
            [[0.9, 4.4]],
            ellipse(5, 4.4, 4.1, 2.9, 180, 245),
            [[3, 0.9], [7, 0.9]],
            ellipse(5, 4.4, 4.1, 2.9, 295, 360),
        );
        const rim = [[0.6, 4.4], [9.4, 4.4]];
        const sticks = [[[5.4, 3.2], [8.7, 9.5]], [[6.3, 3.2], [9.5, 8.9]]];
        const steam = (x) => [wisp(x, 5.3, 9.3, 0.33, 1.6, 0)];
        return [[bowl, rim, ...sticks], steam(2.1), steam(3.4), steam(4.7)];
    },

    /** An upward chevron over three coins, which build from the bottom. */
    stack() {
        const coin = (yb) => {
            const rx = 2.6;
            const ry = 0.55;
            const th = 0.9;
            const yt = yb + th;
            return [
                closed(ellipse(5, yt, rx, ry)),
                join([[5 - rx, yt]], ellipse(5, yb, rx, ry, 180, 360), [[5 + rx, yt]]),
            ];
        };
        const chevron = [[2.7, 7.8], [5, 9.7], [7.3, 7.8]];
        return [[chevron], coin(0.95), coin(3.25), coin(5.55)];
    },

    /** A parcel with a tape seam; a bold arrow comes down onto it. */
    drop() {
        const front = closed([[1.8, 0.6], [6.8, 0.6], [6.8, 4], [1.8, 4]]);
        const top = [[1.8, 4], [3.2, 5], [8.2, 5], [6.8, 4]];
        const side = [[6.8, 0.6], [8.2, 1.6], [8.2, 5]];
        // The tape runs along the lid's seam and folds a short way down the front.
        const tape = [[5.7, 5], [4.3, 4], [4.3, 2.8]];
        const arrow = (t) => [closed([
            [5, t], [6.5, t + 1.2], [5.55, t + 1.2], [5.55, t + 2.4], [4.45, t + 2.4], [4.45, t + 1.2], [3.5, t + 1.2],
        ])];
        return [[front, top, side, tape], arrow(7.5), arrow(6.5), arrow(5.5)];
    },

    /** A dumbbell over a level meter that fills bar by bar. */
    level() {
        const y = 6.6;
        const bell = [
            [[0.5, y], [1.1, y]],
            roundRect(1.1, y - 1.3, 2, y + 1.3, 0.3),
            roundRect(2, y - 1.8, 3, y + 1.8, 0.3),
            [[3, y], [7, y]],
            roundRect(7, y - 1.8, 8, y + 1.8, 0.3),
            roundRect(8, y - 1.3, 8.9, y + 1.3, 0.3),
            [[8.9, y], [9.5, y]],
        ];
        const bar = (x, h) => [roundRect(x, 0.6, x + 1.1, 0.6 + h, 0.25)];
        return [bell, bar(2.65, 1.3), bar(4.55, 2.2), bar(6.45, 3.1)];
    },

    /** A taxi in profile with its roof sign; speed lines stream away behind it. */
    next() {
        const wy = 1.6;
        const body = closed(join(
            [[2.9, wy], [3.25, wy]],
            arc(4.6, wy, 1.35, 180, 0),
            [[6.85, wy]],
            arc(8.2, wy, 1.35, 180, 0),
            [[9.8, wy], [9.8, 3], [9.4, 3.45], [8.4, 3.6], [7.4, 5.1], [4.9, 5.1], [4, 3.65], [3.2, 3.6], [2.9, 3.2]],
        ));
        const belt = [[4, 3.65], [8.4, 3.6]];
        const pillar = [[6.2, 5.1], [6.2, 3.63]];
        const sign = [[5.4, 5.1], [5.6, 6], [6.8, 6], [7, 5.1]];
        const wheels = [closed(arc(4.6, wy, 0.85, 0, 360)), closed(arc(8.2, wy, 0.85, 0, 360))];
        // The car is drawn full size, then set back a tenth to leave the streaks their road.
        const car = [body, belt, pillar, sign, ...wheels].map((line) => scaled(line, 0.9, 9.8, 0.75));
        const streak = (x) => [[4.1, 0], [3.2, 0.3], [2.3, 0]].map(([y, off]) => [[x + off, y], [x + off + 1, y]]);
        return [car, streak(1.9), streak(1), streak(0.1)];
    },

    /** Round glasses; a glint crosses one lens, then the other. */
    clear() {
        const lens = (cx) => closed(arc(cx, 5, 1.9, 0, 360));
        const bridge = smooth([[4.54, 5.65], [5, 6.05], [5.46, 5.65]]);
        const arms = [[[0.96, 5.65], [0.25, 6.05]], [[9.04, 5.65], [9.75, 6.05]]];
        const glint = (cx) => [[[cx - 1, 4.6], [cx + 0.1, 6]]];
        return [[lens(2.75), lens(7.25), bridge, ...arms], glint(2.75), glint(7.25), []];
    },

    /** A washing machine's front; the swirl behind the door turns a third at a time. */
    spin() {
        const body = roundRect(1.3, 0.5, 8.7, 9.5, 0.9);
        const panel = [[1.3, 7.7], [8.7, 7.7]];
        const drawer = roundRect(2.2, 8.2, 4.6, 9, 0.2);
        const dial = closed(arc(7.3, 8.6, 0.48, 0, 360));
        const door = closed(arc(5, 4.1, 2.85, 0, 360));
        const glass = closed(arc(5, 4.1, 2.25, 0, 360));
        const swirl = (rot) => [curve(28, (t) => {
            const a = (rot + t * 300) * RAD;
            const r = 0.35 + 1.3 * t;
            return [5 + r * Math.cos(a), 4.1 + r * Math.sin(a)];
        })];
        return [[body, panel, drawer, dial, door, glass], swirl(0), swirl(-120), swirl(-240)];
    },

    /** Hale: a lotus over still water; rings of breath open above it and close again. */
    hale() {
        const lotus = [
            petal([5, 2.4], [5, 5.8], 0.78),
            petal([4.65, 2.5], [2.4, 5], 0.68),
            petal([5.35, 2.5], [7.6, 5], 0.68),
        ];
        const water = curve(32, (t) => [1.2 + 7.6 * t, 1.3 + 0.3 * Math.sin(t * 1.5 * 2 * Math.PI)]);
        // Wide, low arcs that open over the flower, not a narrow fan of radio waves.
        const ring = (r, a) => [arc(5, 2.9, r, a, 180 - a)];
        return [[...lotus, water], ring(3.8, 28), ring(4.75, 30), ring(5.7, 36)];
    },

    /** Serenity Transit: a route through a rounded square; its stops light as the train calls. */
    transit() {
        const frame = roundRect(0.6, 0.6, 9.4, 9.4, 2);
        const r = 0.65;
        const dx = 2.8 / Math.hypot(2.8, 4);
        const dy = 4 / Math.hypot(2.8, 4);
        const route = [
            [[1.2, 3], [2.5 - r, 3]],
            [[2.5 + r, 3], [3.6, 3], [5 - dx * r, 5 - dy * r]],
            [[5 + dx * r, 5 + dy * r], [6.4, 7], [7.5 - r, 7]],
            [[7.5 + r, 7], [8.8, 7]],
        ];
        const stop = (x, y) => [closed(arc(x, y, r, 0, 360))];
        return [[frame, ...route], stop(2.5, 3), stop(5, 5), stop(7.5, 7)];
    },

    /** A martini glass; the olive on its pick blinks in and out. */
    cocktail() {
        const bowl = closed([[1.4, 8.4], [8.6, 8.4], [5, 4.6]]);
        const level = [[2.25, 7.5], [7.75, 7.5]];
        const stem = [[5, 4.6], [5, 1.2]];
        const foot = closed(ellipse(5, 0.7, 2.4, 0.5, 0, 180));
        const olive = closed(arc(5, 6.3, 0.6, 0, 360));
        const pick = [[5 + 0.607 * 0.6, 6.3 + 0.794 * 0.6], [7.6, 9.7]];
        return [[bowl, level, stem, foot], [olive, pick], [], []];
    },

    /** A pharmacy cross in double tube; the inner line blinks. */
    cross() {
        const plus = (h, reach) => closed([
            [5 - h, 5 - reach], [5 + h, 5 - reach], [5 + h, 5 - h], [5 + reach, 5 - h],
            [5 + reach, 5 + h], [5 + h, 5 + h], [5 + h, 5 + reach], [5 - h, 5 + reach],
            [5 - h, 5 + h], [5 - reach, 5 + h], [5 - reach, 5 - h], [5 - h, 5 - h],
        ]);
        return [[plus(1.5, 4.3)], [plus(0.75, 3.55)], [], []];
    },

    /** A cup on its saucer; two wisps of steam sway one way, then the other. */
    coffee() {
        const cup = smooth([
            [2.2, 6.2], [2.35, 4.3], [3, 2.6], [3.9, 1.9], [5.9, 1.9], [6.8, 2.6], [7.45, 4.3], [7.6, 6.2],
        ]);
        const rim = [[2, 6.2], [7.8, 6.2]];
        const handle = smooth([[7.5, 5.4], [8.4, 5.4], [8.9, 4.6], [8.45, 3.8], [7.2, 3.3]]);
        const saucer = closed(join([[0.9, 1.9], [9.1, 1.9]], ellipse(5, 1.9, 4.1, 1, 0, -180)));
        const steam = (phase) => [wisp(4.1, 6.9, 9.6, 0.38, 1, phase), wisp(5.7, 6.9, 9.6, 0.38, 1, phase)];
        return [[cup, rim, handle, saucer], steam(0), steam(0.5), []];
    },

    /** Two beamed notes; a third, lone note bobs beside them. */
    note() {
        const head = (cx, cy, rx, ry) => closed(ellipse(cx, cy, rx, ry, 0, 360, undefined, 22));
        const stemX = (cx, rx) => cx + rx * 0.93;
        const s1 = stemX(4.3, 1.05);
        const s2 = stemX(8.1, 1.05);
        const beam = closed([[s1, 7.6], [s2, 8.5], [s2, 9.35], [s1, 8.45]]);
        const pair = [
            head(4.3, 1.9, 1.05, 0.72), [[s1, 2.3], [s1, 7.6]],
            head(8.1, 2.8, 1.05, 0.72), [[s2, 3.2], [s2, 8.5]],
            beam,
        ];
        const lone = (y) => {
            const s = stemX(1.3, 0.72);
            const top = y + 3;
            const flag = smooth([[s, top], [s + 0.55, top - 0.5], [s + 0.9, top - 1.1], [s + 0.6, top - 1.8]]);
            return [head(1.3, y, 0.72, 0.5), join([[s, y + 0.25]], flag)];
        };
        return [pair, lone(3.9), lone(5.1), []];
    },

    /** An arcade stick on its base, with a button; the stick rocks left and right. */
    joystick() {
        const front = closed([[1.2, 0.7], [8.8, 0.7], [8.8, 2.6], [1.2, 2.6]]);
        const top = [[1.2, 2.6], [2.2, 4], [7.8, 4], [8.8, 2.6]];
        const button = closed(join(ellipse(6.8, 3.2, 0.75, 0.62, 0, 180)));
        const stick = (bx) => {
            const by = 7.6;
            const r = 1.05;
            const len = Math.hypot(bx - 3.8, by - 3.3);
            return [
                [[3.8, 3.3], [bx - ((bx - 3.8) / len) * r, by - ((by - 3.3) / len) * r]],
                closed(arc(bx, by, r, 0, 360)),
            ];
        };
        return [[front, top, button], stick(2.6), stick(5), []];
    },

    /** A heart in tube; a smaller heart inside it beats. */
    heart() {
        const shape = (k) => {
            const pts = curve(100, (t) => {
                const a = t * 2 * Math.PI;
                const x = 16 * Math.sin(a) ** 3;
                const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
                return [5 + 0.275 * x, 5.73 + 0.275 * y];
            });
            // Scale about the point midway between the cleft and the tip, so the gap is even.
            return closed(scaled(pts, k, 5, (pts[0][1] + pts[50][1]) / 2));
        };
        return [[shape(1)], [shape(0.64)], [], []];
    },
};

/** A polyline's segments [ax, ay, bx, by]. */
function toSegments(points) {
    const segments = [];
    for (let i = 0; i + 1 < points.length; i++) {
        segments.push([points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]]);
    }
    return segments;
}

/**
 * Every mark's strokes, in atlas order: per mark its four channels [R, G, B, A], each a list of
 * segments [ax, ay, bx, by] in the 0..LOGO_UNITS box (y up).
 * @returns {number[][][][]}
 */
export function logoStrokes() {
    return LOGOS.map(({ id }) => DESIGNS[id]().map((lines) => lines.flatMap(toSegments)));
}

/**
 * Lower `best` (one cell's squared distances, in texels) to each texel's distance from the segment
 * from (ax, ay) along (dx, dy), visiting only the texels within `range` of its bounding box.
 * Texel (px, py) has its centre at (px + 0.5, py + 0.5). A small function of its own: the bake's
 * hot loop, optimised early on a cold start.
 */
function stamp(best, ax, ay, dx, dy, range) {
    const len2 = dx * dx + dy * dy;
    const inv = len2 > 0 ? 1 / len2 : 0; // a point stamps as a dot
    const x0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - range));
    const x1 = Math.min(LOGO_CELL - 1, Math.ceil(Math.max(ax, ax + dx) + range));
    const y0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - range));
    const y1 = Math.min(LOGO_CELL - 1, Math.ceil(Math.max(ay, ay + dy) + range));
    for (let py = y0; py <= y1; py++) {
        const y = py + 0.5 - ay;
        const rowStart = py * LOGO_CELL;
        for (let px = x0; px <= x1; px++) {
            const x = px + 0.5 - ax;
            let t = (x * dx + y * dy) * inv;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const ex = x - dx * t;
            const ey = y - dy * t;
            const d2 = ex * ex + ey * ey;
            if (d2 < best[rowStart + px]) best[rowStart + px] = d2;
        }
    }
}

/**
 * Bake the atlas: LOGO_GRID² cells of LOGO_CELL² texels, RGBA, each channel the distance field of
 * that channel's strokes (255 = on a stroke, 0 = LOGO_RANGE cells away or more). Row 0 of the
 * data is the BOTTOM row of cell row 0 (texture v up). Each segment only visits the texels its
 * range can reach, so the bake costs tens of milliseconds, not seconds.
 * @returns {{ data: Uint8Array, size: number }}
 */
function computeLogoAtlas() {
    const logos = logoStrokes();
    const size = LOGO_GRID * LOGO_CELL;
    const data = new Uint8Array(size * size * 4);
    const scale = ((LOGO_BOX.x1 - LOGO_BOX.x0) * LOGO_CELL) / LOGO_UNITS; // texels per unit
    const ox = LOGO_BOX.x0 * LOGO_CELL;
    const oy = LOGO_BOX.y0 * LOGO_CELL;
    const range = LOGO_RANGE * LOGO_CELL; // in texels
    const far = range * range;
    const best = new Float32Array(LOGO_CELL * LOGO_CELL);
    for (let i = 0; i < logos.length; i++) {
        const col = i % LOGO_GRID;
        const row = Math.floor(i / LOGO_GRID);
        for (let ch = 0; ch < 4; ch++) {
            const segments = logos[i][ch];
            if (segments.length === 0) continue; // an unused frame stays 0
            best.fill(far);
            for (let s = 0; s < segments.length; s++) {
                const [ax, ay, bx, by] = segments[s];
                stamp(best, ox + ax * scale, oy + ay * scale, (bx - ax) * scale, (by - ay) * scale, range);
            }
            for (let py = 0; py < LOGO_CELL; py++) {
                const base = ((row * LOGO_CELL + py) * size + col * LOGO_CELL) * 4 + ch;
                for (let px = 0; px < LOGO_CELL; px++) {
                    const d2 = best[py * LOGO_CELL + px];
                    if (d2 < far) data[base + px * 4] = Math.round((1 - Math.sqrt(d2) / range) * 255);
                }
            }
        }
    }
    return { data, size };
}

/** The bake cache's key for the atlas (it depends on nothing but this module). */
export const LOGO_ATLAS_KEY = 'neon-district:logo-atlas';

/** The atlas, baked once (read-only: the texture's bytes). */
export function bakeLogoAtlas() {
    return bakeOnce(LOGO_ATLAS_KEY, computeLogoAtlas);
}
