/**
 * Chromatic Impasto — the painter's gestures (CPU only, three-free).
 *
 * Every function here turns an intention ("block the canvas in", "this piece locked on the left
 * at this height", "three rows went") into strokes for the painter's log. Nothing is random at
 * run time: each gesture is seeded, so the same game paints the same picture.
 *
 * Points are canvas units (the frame at rest: y in [−1, 1] up, x in [−aspect, aspect]); a `card`
 * is the board card's rectangle in the same units ({ x0, y0, x1, y1 }, y0 < y1).
 */

import {
    GOLD, INTRO_SPAN, KIND, TAU, VIEW, clamp, clamp01, fieldDirection, lerp, mixRgb, mulberry32, radicalInverse,
    scaleRgb, valueNoise,
} from './chromatic-impasto-core.js';
import { createBlob, createStroke } from './chromatic-impasto-strokes.js';

/** The painted cloth's half-extent for a frame aspect. */
export function canvasExtent(aspect) {
    return { halfX: Math.max(0.2, aspect) * VIEW.overscan, halfY: VIEW.overscan };
}

// ── Paths ───────────────────────────────────────────────────────────────────────

/**
 * A path that follows the field from (x, y).
 *
 * @param {object} field
 * @param {number} x
 * @param {number} y
 * @param {number} length
 * @param {object} [options]
 * @param {number} [options.step=0.02]
 * @param {boolean} [options.centred=true]  run half the length each way from the point
 * @param {number} [options.sign=1]         −1 = against the current
 * @param {number[]} [options.pull]         [dx, dy]: a direction blended into the field's
 * @param {number} [options.pullWeight=0]   0 = the field alone, 1 = the pull alone
 * @param {number} [options.turn=0]         radians the stroke is laid across the current
 * @returns {number[]} xy pairs
 */
export function flowPath(field, x, y, length, {
    step = 0.02, centred = true, sign = 1, pull = null, pullWeight = 0, turn = 0,
} = {}) {
    const turnCos = Math.cos(turn);
    const turnSin = Math.sin(turn);
    const dir = [1, 0];
    const run = (sx, sy, dist, sgn) => {
        const pts = [];
        let px = sx;
        let py = sy;
        const steps = Math.max(1, Math.round(dist / step));
        const h = dist / steps;
        const heading = (qx, qy) => {
            fieldDirection(field, qx, qy, dir);
            let dx = (dir[0] * turnCos - dir[1] * turnSin) * sgn;
            let dy = (dir[0] * turnSin + dir[1] * turnCos) * sgn;
            if (pull && pullWeight > 0) {
                dx = lerp(dx, pull[0], pullWeight);
                dy = lerp(dy, pull[1], pullWeight);
                const l = Math.hypot(dx, dy) || 1;
                dx /= l;
                dy /= l;
            }
            dir[0] = dx;
            dir[1] = dy;
        };
        for (let i = 0; i < steps; i++) {
            heading(px, py);
            const mx = px + dir[0] * h * 0.5;
            const my = py + dir[1] * h * 0.5;
            heading(mx, my);
            px += dir[0] * h;
            py += dir[1] * h;
            pts.push(px, py);
        }
        return pts;
    };
    if (!centred) return [x, y, ...run(x, y, length, sign)];
    const back = run(x, y, length * 0.5, -sign);
    const out = [];
    for (let i = back.length - 2; i >= 0; i -= 2) out.push(back[i], back[i + 1]);
    out.push(x, y, ...run(x, y, length * 0.5, sign));
    return out;
}

/** A straight pass with a bow and a hand's wobble. */
export function sweepPath(x0, y0, x1, y1, bow = 0, wobble = 0, seed = 1, nodes = 28) {
    const out = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < nodes; i++) {
        const t = i / (nodes - 1);
        const arch = Math.sin(t * Math.PI) * bow;
        const shake = (valueNoise(t * 3.1 + seed * 1.37, seed * 0.71, 91) - 0.5) * 2 * wobble * Math.min(1, t * 4);
        out.push(x0 + dx * t + nx * (arch + shake), y0 + dy * t + ny * (arch + shake));
    }
    return out;
}

/** An arc of a spiral about (cx, cy): radius r0 → r1 over angles a0 → a1; `squash` = y scale. */
export function spiralPath(cx, cy, r0, r1, a0, a1, squash = 1, nodes = 48) {
    const out = [];
    for (let i = 0; i < nodes; i++) {
        const t = i / (nodes - 1);
        const r = lerp(r0, r1, t);
        const a = lerp(a0, a1, t);
        out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash);
    }
    return out;
}

const pick = (list, v) => list[Math.min(list.length - 1, Math.floor(clamp01(v) * list.length))];

/** The nearest a path comes to the eye of any whorl. */
export function eyeDistance(field, points) {
    let nearest = Infinity;
    for (let w = 0; w < field.whorls.length; w++) {
        const eye = field.whorls[w];
        for (let i = 0; i < points.length; i += 2) {
            const d = Math.hypot(points[i] - eye.x, points[i + 1] - eye.y);
            if (d < nearest) nearest = d;
        }
    }
    return nearest;
}

/**
 * A half-width a path can carry: near the eye of a whorl the current turns so tightly that a
 * wide ribbon would fold over itself, so strokes there are narrow, as they are in the eye of
 * any painted whirl.
 */
const fitWidth = (field, points, width) => Math.min(width, Math.max(0.01, eyeDistance(field, points) * 0.5));

const insideCard = (card, x, y, grow = 0) => Boolean(card)
    && x > card.x0 - grow && x < card.x1 + grow && y > card.y0 - grow && y < card.y1 + grow;

// ── The underpainting ───────────────────────────────────────────────────────────

/** A tube colour worked darker or lighter on the palette (k < 1 darker, toward `light` above 1). */
const worked = (color, k, light) => (k <= 1 ? scaleRgb(color, k) : mixRgb(color, light, (k - 1) * 0.45));

/**
 * Block the canvas in. The darks first, in broad flat passes that cover the cloth; then the
 * colour masses, bold and few, so most of the picture stays deep and what is bright counts; the
 * black contour; and the lights on top. The strokes are spread over `span` seconds from `t0`.
 * Most follow the current; some are laid across it, as a hand does.
 *
 * @returns {object[]} strokes (tagged 'under')
 */
export function composeUnderpainting({
    field, aspect, period, seed = 1, t0 = 0, span = INTRO_SPAN, density = 1, card = null,
}) {
    const rand = mulberry32(seed * 9973 + 17);
    const { halfX, halfY } = canvasExtent(aspect);
    const area = (halfX * halfY) / (1.9 * 1.07);
    const out = [];
    const at = (lo, hi) => t0 + span * (lo + (hi - lo) * rand());
    const across = (chance, most) => (rand() < chance ? (rand() - 0.5) * 2 * most : (rand() - 0.5) * 0.3);

    // 1 — the lay-in: dark, thin, wide.
    const cell = 0.34;
    const nx = Math.max(2, Math.ceil((2 * halfX) / cell));
    const ny = Math.max(2, Math.ceil((2 * halfY) / cell));
    for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
            const x = -halfX + ((ix + 0.2 + rand() * 0.6) / nx) * 2 * halfX;
            const y = -halfY + ((iy + 0.2 + rand() * 0.6) / ny) * 2 * halfY;
            const tone = valueNoise(x * 0.7 + 9.1, y * 0.7 + 2.3, seed + 3);
            const a = pick(period.darks, (tone - 0.2) / 0.6);
            const b = pick(period.darks, rand());
            const points = flowPath(field, x, y, 0.6 + rand() * 0.8, { turn: across(0.2, 0.6) });
            out.push(createStroke({
                kind: KIND.KNIFE,
                points,
                width: fitWidth(field, points, 0.1 + rand() * 0.07),
                t0: at(0, 0.3),
                dur: 0.3 + rand() * 0.25,
                colorA: scaleRgb(a, 0.75 + rand() * 0.5),
                colorB: b,
                mixB: 0.3,
                load: 0.9,
                dry: 0.3,
                bristle: 0.3,
                height: 0.32,
                seed: rand() * 4096,
                tag: 'under',
            }));
        }
    }

    // 2 — the masses: each region of the picture takes one tube colour. Bold, and not many.
    const masses = Math.round(64 * density * area);
    for (let i = 0; i < masses; i++) {
        const x = -halfX + radicalInverse(i + 1) * 2 * halfX;
        const y = -halfY + ((i * 0.6180339887 + rand() * 0.02) % 1) * 2 * halfY;
        if (insideCard(card, x, y, -0.06) && rand() < 0.45) continue;
        const region = valueNoise(x * 0.8 + 3.1, y * 0.8 - 7.7, seed + 5);
        const index = Math.floor(clamp01((region - 0.18) / 0.64) * period.masses.length * 0.999);
        const tube = period.masses[index];
        // Worked on the palette: a third of them deep, a few lifted.
        const roll = rand();
        let value = 0.82 + rand() * 0.22;
        if (roll < 0.32) value = 0.4 + rand() * 0.25;
        else if (roll > 0.9) value = 1.15 + rand() * 0.3;
        const a = worked(tube, value, period.light);
        // The second colour is usually the same tube, a tone away; sometimes a neighbour.
        const second = rand();
        let b = worked(tube, value * (rand() < 0.5 ? 0.6 : 1.35), period.light);
        if (second > 0.86) b = pick(period.accents, rand());
        else if (second > 0.66) b = period.masses[(index + 1 + Math.floor(rand() * 2)) % period.masses.length];
        const knife = rand() < 0.3;
        const wide = rand() < 0.3;
        const points = flowPath(field, x, y, 0.4 + rand() * 0.75, { turn: across(0.22, 0.7) });
        out.push(createStroke({
            kind: knife ? KIND.KNIFE : KIND.BRUSH,
            points,
            width: fitWidth(field, points, wide ? 0.085 + rand() * 0.045 : 0.042 + rand() * 0.04),
            t0: at(0.2, 0.72),
            dur: 0.25 + rand() * 0.3,
            colorA: a,
            colorB: b,
            mixB: 0.14 + rand() * 0.28,
            load: 0.9 + rand() * 0.3,
            dry: 0.3 + rand() * 0.55,
            bristle: knife ? 0.15 : 1,
            height: 0.9 + rand() * 0.3,
            seed: rand() * 4096,
            tag: 'under',
        }));
    }

    // 3 — the contour: black lines drawn with the current.
    const contours = Math.round(20 * density * area);
    for (let i = 0; i < contours; i++) {
        const x = (rand() * 2 - 1) * halfX;
        const y = (rand() * 2 - 1) * halfY;
        if (insideCard(card, x, y, 0) && rand() < 0.5) continue;
        out.push(createStroke({
            kind: KIND.BRUSH,
            points: flowPath(field, x, y, 0.5 + rand() * 0.8),
            width: 0.014 + rand() * 0.014,
            widthEnd: 0.008 + rand() * 0.008,
            t0: at(0.5, 0.86),
            dur: 0.3 + rand() * 0.3,
            colorA: period.contour,
            load: 1.05,
            dry: 0.3,
            height: 0.85,
            seed: rand() * 4096,
            tag: 'under',
        }));
    }

    // 4 — the lights: short, loaded, laid last, as often across the current as along it.
    const lights = Math.round(40 * density * area);
    for (let i = 0; i < lights; i++) {
        const x = (rand() * 2 - 1) * halfX;
        const y = (rand() * 2 - 1) * halfY;
        if (insideCard(card, x, y, 0) && rand() < 0.5) continue;
        const bright = rand() < 0.3;
        const a = bright ? period.light : pick(period.accents, rand());
        const knife = rand() < 0.45;
        const points = flowPath(field, x, y, 0.1 + rand() * 0.26, { turn: across(0.5, 1.2) });
        out.push(createStroke({
            kind: knife ? KIND.KNIFE : KIND.BRUSH,
            points,
            width: fitWidth(field, points, 0.02 + rand() * 0.03),
            t0: at(0.68, 0.98),
            dur: 0.16 + rand() * 0.18,
            colorA: a,
            colorB: bright ? pick(period.accents, rand()) : worked(a, 1.4, period.light),
            mixB: 0.2,
            load: 1.25,
            dry: 0.2,
            bristle: knife ? 0.1 : 1,
            height: 1.3,
            seed: rand() * 4096,
            tag: 'under',
        }));
    }
    return out;
}

// ── Gameplay ────────────────────────────────────────────────────────────────────

/**
 * A piece locks: its colour leaves the board's side at the piece's height in one stroke, drawn
 * out thin and pressed down as it goes, bending into the current. How far it reaches differs
 * from lock to lock, so the paint is laid near the board and far from it.
 *
 * @param {object} p
 * @param {object} p.field
 * @param {number} p.x        where the stroke starts: on the card's edge (canvas units)
 * @param {number} p.y
 * @param {number[]} p.out    unit direction away from the board
 * @param {number[]} p.color  the piece's pigment
 * @param {number[]} [p.under] the last piece's pigment (picked up wet)
 * @param {boolean} [p.hard]  a hard drop: a slab laid with the knife
 * @param {number} [p.reach]  0..1: how far out this one goes
 * @param {number} p.t0
 * @param {number} [p.seed]
 * @returns {{ strokes: object[], tip: number[], heading: number[] }}
 */
export function lockGesture({
    field, x, y, out, color, under = null, hard = false, reach = 0.5, t0, seed = 1,
}) {
    const rand = mulberry32(seed * 7717 + 3);
    const length = (hard ? 0.4 : 0.26) + clamp01(reach) * (hard ? 0.5 : 0.5) + rand() * 0.06;
    const points = flowPath(field, x, y, length, {
        centred: false, pull: out, pullWeight: 0.55, step: 0.015,
    });
    const n = points.length;
    const stroke = createStroke({
        kind: hard ? KIND.KNIFE : KIND.BRUSH,
        points,
        width: hard ? 0.032 + rand() * 0.006 : 0.018 + rand() * 0.005,
        widthEnd: hard ? 0.052 + rand() * 0.014 : 0.046 + rand() * 0.012,
        t0,
        dur: hard ? 0.24 : 0.32,
        ease: 'out',
        colorA: color,
        colorB: under || mixRgb(color, [1, 1, 1], 0.5),
        mixB: under ? 0.26 : 0.12,
        load: hard ? 1.3 : 1.2,
        dry: hard ? 0.3 : 0.35,
        bristle: hard ? 0.12 : 1,
        height: hard ? 1.4 : 1.2,
        seed: rand() * 4096,
        tag: 'lock',
    });
    const tip = [points[n - 2], points[n - 1]];
    const hl = Math.hypot(points[n - 2] - points[n - 4], points[n - 1] - points[n - 3]) || 1;
    const heading = [(points[n - 2] - points[n - 4]) / hl, (points[n - 1] - points[n - 3]) / hl];
    return { strokes: [stroke], tip, heading };
}

/**
 * Paint thrown at the cloth: a crater with a thrown rim, and the spatter round it.
 *
 * @returns {object[]} blobs
 */
export function splatGesture({
    x, y, radius, color, colorB = null, t0, seed = 1, fingers = 0.8, spatter = 9, height = 1.2, special = 0,
    tag = 'splat',
}) {
    const rand = mulberry32(seed * 5381 + 11);
    const out = [createBlob({
        x,
        y,
        radius,
        t0,
        colorA: color,
        colorB,
        mixB: 0.3,
        load: 1.1,
        fingers,
        crater: 1,
        height,
        special,
        angle: rand() * TAU,
        seed: rand() * 4096,
        tag,
    })];
    for (let i = 0; i < spatter; i++) {
        const a = rand() * TAU;
        const d = radius * (1.25 + rand() ** 1.6 * 2.6);
        out.push(createBlob({
            x: x + Math.cos(a) * d,
            y: y + Math.sin(a) * d,
            radius: radius * (0.05 + rand() ** 2 * 0.2),
            t0: t0 + 0.02 + rand() * 0.05,
            colorA: color,
            load: 1,
            fingers: 0.25,
            height: 0.9,
            special,
            angle: rand() * TAU,
            seed: rand() * 4096,
            tag,
        }));
    }
    return out;
}

/**
 * A cleared row leaves the board: one loaded brush each way, from the card's side to the edge of
 * the cloth at the row's height, running dry as it goes.
 *
 * @param {object} p
 * @param {number} p.y             the row's height (canvas units)
 * @param {number} p.x0            the card's left side
 * @param {number} p.x1            the card's right side
 * @param {number} p.halfX         the cloth's half-width
 * @param {number} p.width         half-width of the stroke
 * @param {number[]} p.color
 * @param {number[]} [p.colorB]
 * @param {number} p.t0
 * @param {number} [p.seed]
 * @param {number} [p.special]
 * @returns {object[]} strokes
 */
export function sweepGesture({
    y, x0, x1, halfX, width, color, colorB = null, t0, seed = 1, special = 0, dur = 0.42,
}) {
    const rand = mulberry32(seed * 3301 + 29);
    const out = [];
    for (let side = -1; side <= 1; side += 2) {
        const from = side < 0 ? x0 - width * 0.4 : x1 + width * 0.4;
        const to = side * (halfX + 0.05);
        if (Math.abs(to - from) < width * 2) continue;
        const rise = (rand() - 0.5) * 0.16;
        out.push(createStroke({
            kind: KIND.BRUSH,
            points: sweepPath(from, y, to, y + rise, (rand() - 0.5) * 0.12, 0.012, seed + side * 3 + rand() * 9),
            width,
            widthEnd: width * 0.82,
            t0: t0 + rand() * 0.03,
            dur,
            ease: 'out',
            colorA: color,
            colorB: colorB || mixRgb(color, [1, 1, 1], 0.55),
            mixB: 0.36,
            load: 1.3,
            dry: 0.8,
            height: 1.3,
            special,
            seed: rand() * 4096,
            tag: 'sweep',
        }));
    }
    return out;
}

/**
 * Paint flung from behind the board in every direction: heavy throws that taper to nothing, each
 * ending in drops, and great splats where whole brushfuls struck the cloth.
 *
 * @returns {{ strokes: object[], throws: { x:number, y:number, dx:number, dy:number, color:number[] }[] }}
 */
export function burstGesture({
    card, colors, t0, seed = 1, count = 16, reach = 0.8, splats = 5,
}) {
    const rand = mulberry32(seed * 1291 + 5);
    const cx = (card.x0 + card.x1) * 0.5;
    const cy = (card.y0 + card.y1) * 0.5;
    const hx = (card.x1 - card.x0) * 0.5;
    const hy = (card.y1 - card.y0) * 0.5;
    const strokes = [];
    const throws = [];
    /** The point just outside the card along a ray from its centre, `gap` further out. */
    const leave = (dx, dy, gap) => {
        const edge = Math.min(hx / Math.max(1e-3, Math.abs(dx)), hy / Math.max(1e-3, Math.abs(dy)));
        return [cx + dx * (edge + gap), cy + dy * (edge + gap)];
    };
    for (let i = 0; i < count; i++) {
        const a = ((i + rand() * 0.7) / count) * TAU;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const [sx, sy] = leave(dx, dy, 0.02);
        const len = reach * (0.4 + rand() * 0.6);
        const color = colors[i % colors.length];
        const bend = (rand() - 0.5) * 0.5;
        const pts = [];
        for (let k = 0; k <= 16; k++) {
            const t = k / 16;
            const side = Math.sin(t * Math.PI * 0.8) * bend * len;
            pts.push(sx + dx * len * t - dy * side, sy + dy * len * t + dx * side);
        }
        const width = 0.036 + rand() * 0.034;
        const start = t0 + rand() * 0.1;
        strokes.push(createStroke({
            kind: KIND.KNIFE,
            points: pts,
            width,
            widthEnd: width * 0.14,
            t0: start,
            dur: 0.18 + rand() * 0.1,
            ease: 'out',
            colorA: color,
            colorB: colors[(i + 1 + Math.floor(rand() * 2)) % colors.length],
            mixB: 0.22,
            load: 1.35,
            dry: 0.6,
            bristle: 0.4,
            height: 1.45,
            seed: rand() * 4096,
            tag: 'burst',
        }));
        // The drops that fly on past the end of the throw.
        const ex = pts[32];
        const ey = pts[33];
        const beads = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < beads; k++) {
            const d = width * (0.8 + k * (0.9 + rand()));
            strokes.push(createBlob({
                x: ex + dx * d + (rand() - 0.5) * width,
                y: ey + dy * d + (rand() - 0.5) * width,
                radius: width * (0.34 - k * 0.07) * (0.6 + rand() * 0.5),
                t0: start + 0.2 + k * 0.02,
                colorA: color,
                load: 1.1,
                fingers: 0.3,
                height: 1.1,
                angle: rand() * TAU,
                seed: rand() * 4096,
                tag: 'burst',
            }));
        }
        throws.push({
            x: sx, y: sy, dx, dy, color,
        });
    }
    for (let i = 0; i < splats; i++) {
        const a = ((i + rand()) / splats) * TAU;
        const [px, py] = leave(Math.cos(a), Math.sin(a), 0.12 + rand() * 0.3);
        const radius = 0.045 + rand() * 0.035;
        strokes.push(createBlob({
            x: px,
            y: py,
            radius,
            t0: t0 + 0.05 + rand() * 0.15,
            colorA: colors[(i * 2 + 1) % colors.length],
            colorB: colors[(i * 2 + 2) % colors.length],
            mixB: 0.3,
            load: 1.2,
            fingers: 0.95,
            crater: 1,
            height: 1.3,
            angle: rand() * TAU,
            seed: rand() * 4096,
            tag: 'burst',
        }));
    }
    return { strokes, throws };
}

/**
 * Gold leaf laid round the board: a broken ring of broad flat passes, one after another. `ring`
 * counts the rings already there: each new one is laid outside the last.
 *
 * @returns {object[]} strokes
 */
export function haloGesture({
    card, t0, seed = 1, segments = 12, gap = 0.075, width = 0.034, turns = 1, ring = 0, color = GOLD,
}) {
    const rand = mulberry32(seed * 4409 + 71);
    const cx = (card.x0 + card.x1) * 0.5;
    const cy = (card.y0 + card.y1) * 0.5;
    const rx = (card.x1 - card.x0) * 0.5 + gap;
    const ry = (card.y1 - card.y0) * 0.5 + gap;
    // A superellipse hugs the card's rounded rectangle.
    const around = (a, grow) => {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const k = 6;
        const r = (Math.abs(c) ** k + Math.abs(s) ** k) ** (-1 / k);
        return [cx + c * r * (rx + grow), cy + s * r * (ry + grow)];
    };
    const out = [];
    const total = segments * turns;
    for (let i = 0; i < total; i++) {
        const a0 = (i / segments) * TAU + rand() * 0.08;
        const sweep = (TAU / segments) * (0.8 + rand() * 0.32);
        const grow = (ring + Math.floor(i / segments)) * (width * 2.5) + rand() * 0.012;
        const pts = [];
        for (let k = 0; k <= 18; k++) pts.push(...around(a0 + (sweep * k) / 18, grow));
        out.push(createStroke({
            kind: KIND.KNIFE,
            points: pts,
            width: width * (0.85 + rand() * 0.4),
            t0: t0 + (i / total) * 0.55,
            dur: 0.16,
            ease: 'out',
            colorA: color,
            colorB: scaleRgb(color, 0.62),
            mixB: 0.25,
            load: 1.1,
            dry: 0.5,
            bristle: 0.55,
            height: 0.8,
            special: 1,
            keep: 0.1,
            seed: rand() * 4096,
            tag: 'gold',
        }));
    }
    return out;
}

/**
 * Long arcs wound round the board: what a chain of clears, or a T-spin, draws.
 *
 * @returns {object[]} strokes
 */
export function spiralGesture({
    cx, cy, radius, colors, t0, seed = 1, arms = 3, sweep = 3.6, width = 0.026, squash = 1, grow = 0.35, special = 0,
    specialArms = arms, dur = 0.55, tag = 'spiral',
}) {
    const rand = mulberry32(seed * 6151 + 13);
    const out = [];
    for (let i = 0; i < arms; i++) {
        const a0 = (i / arms) * TAU + rand() * 0.9;
        const r0 = radius * (0.9 + rand() * 0.25);
        const r1 = r0 * (1 + grow + rand() * 0.2);
        out.push(createStroke({
            kind: KIND.BRUSH,
            points: spiralPath(cx, cy, r0, r1, a0, a0 + sweep * (0.8 + rand() * 0.4), squash, 56),
            width: width * (0.8 + rand() * 0.5),
            widthEnd: width * 0.45,
            t0: t0 + i * 0.05,
            dur: dur * (0.85 + rand() * 0.3),
            ease: 'out',
            colorA: colors[i % colors.length],
            colorB: colors[(i + 1) % colors.length],
            mixB: 0.3,
            load: 1.15,
            dry: 0.8,
            height: 1.15,
            special: i < specialArms ? special : 0,
            seed: rand() * 4096,
            tag: i < specialArms ? tag : 'spiral',
        }));
    }
    return out;
}

/**
 * The canvas scraped down to its ground: wide flat passes with the knife that leave almost nothing
 * standing. A perfect clear, and every new game, begin with it.
 *
 * @returns {object[]} strokes
 */
export function scrapeGesture({
    field, aspect, ground, t0, seed = 1, span = 0.55,
}) {
    const rand = mulberry32(seed * 8089 + 43);
    const { halfX, halfY } = canvasExtent(aspect);
    const out = [];
    const cell = 0.42;
    const nx = Math.max(2, Math.ceil((2 * halfX) / cell));
    const ny = Math.max(2, Math.ceil((2 * halfY) / cell));
    for (let pass = 0; pass < 2; pass++) {
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const x = -halfX + ((ix + rand()) / nx) * 2 * halfX;
                const y = -halfY + ((iy + rand()) / ny) * 2 * halfY;
                // The knife works outward from the middle.
                const far = clamp(Math.hypot(x / halfX, y / halfY), 0, 1.3) / 1.3;
                out.push(createStroke({
                    kind: KIND.KNIFE,
                    points: flowPath(field, x, y, 0.9 + rand() * 0.6),
                    width: 0.2 + rand() * 0.08,
                    t0: t0 + span * (far * 0.7 + pass * 0.25 + rand() * 0.08),
                    dur: 0.3,
                    ease: 'out',
                    colorA: scaleRgb(ground, 0.9 + rand() * 0.5),
                    load: 0.9,
                    dry: 0.1,
                    bristle: 0.2,
                    height: 0.06 + rand() * 0.05,
                    keep: 0.02,
                    seed: rand() * 4096,
                    tag: 'scrape',
                }));
            }
        }
    }
    return out;
}

/**
 * The painter, between events: one unhurried stroke somewhere in the open cloth.
 *
 * @returns {object[]} strokes
 */
export function ambientGesture({
    field, aspect, period, card, t0, index,
}) {
    const rand = mulberry32(index * 2909 + 97);
    const { halfX, halfY } = canvasExtent(aspect);
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 6; tries++) {
        x = (radicalInverse(index * 7 + tries + 1) * 2 - 1) * halfX * 0.94;
        y = (((index * 7 + tries) * 0.6180339887) % 1) * 2 * halfY * 0.94 - halfY * 0.94;
        if (!insideCard(card, x, y, 0.04)) break;
    }
    const kindRoll = rand();
    const light = kindRoll > 0.82;
    const contour = kindRoll < 0.14;
    let colorA = pick(period.masses, rand());
    if (light) colorA = rand() < 0.5 ? period.light : pick(period.accents, rand());
    if (contour) colorA = period.contour;
    return [createStroke({
        kind: light && rand() < 0.5 ? KIND.KNIFE : KIND.BRUSH,
        points: flowPath(field, x, y, contour ? 0.7 + rand() * 0.5 : 0.22 + rand() * 0.5),
        width: contour ? 0.012 + rand() * 0.008 : 0.022 + rand() * 0.035,
        t0,
        dur: 1.1 + rand() * 0.9,
        ease: 'inout',
        colorA,
        colorB: pick(period.accents, rand()),
        mixB: contour ? 0 : 0.15 + rand() * 0.25,
        load: 1.0 + rand() * 0.25,
        dry: 0.3 + rand() * 0.5,
        bristle: light ? 0.5 : 1,
        height: light ? 1.3 : 1.0,
        seed: rand() * 4096,
        tag: 'ambient',
    })];
}
