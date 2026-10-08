import { describe, expect, it } from 'vitest';
import {
    DROPLET_GRAVITY, GOLD, IMPASTO_PERIODS, INTRO_SPAN, KIND, RELIEF, SWIRL_FROM, VIEW, VIEW_DISTANCE, createField,
    fieldDirection, hexToLinear, mulberry32, notchForCombo, pigmentFromHex, powerForCombo, radicalInverse, twistPoint,
    twistProfile, valueNoise,
} from '../../src/themes/chromatic-impasto/chromatic-impasto-core.js';
import {
    BLOB_MARGIN, QUAD_FLOATS, StrokeBatch, VERTEX_STRIDE, createBlob, createStroke, emitStroke, resamplePath, strokeReach,
} from '../../src/themes/chromatic-impasto/chromatic-impasto-strokes.js';
import { Painter } from '../../src/themes/chromatic-impasto/chromatic-impasto-painter.js';
import {
    ambientGesture, burstGesture, canvasExtent, composeUnderpainting, eyeDistance, flowPath, haloGesture, lockGesture,
    scrapeGesture, spiralGesture, splatGesture, sweepGesture, sweepPath,
} from '../../src/themes/chromatic-impasto/chromatic-impasto-gestures.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/chromatic-impasto/chromatic-impasto-quality.js';
import { POST_LOOK } from '../../src/themes/chromatic-impasto/chromatic-impasto-post.js';

const ASPECT = 1600 / 900;
const CARD = {
    x0: -0.42, y0: -0.86, x1: 0.42, y1: 0.86,
};

/** Every quad a batch holds, as { s0, s1, corners: [[x, y] × 4] }. */
function quadsOf(batch) {
    const out = [];
    for (let q = 0; q < batch.quads; q++) {
        const o = q * QUAD_FLOATS;
        const corners = [0, 1, 2, 3].map((k) => [batch.data[o + k * VERTEX_STRIDE], batch.data[o + k * VERTEX_STRIDE + 1]]);
        out.push({ s0: batch.data[o + 4], s1: batch.data[o + 2 * VERTEX_STRIDE + 4], corners });
    }
    return out;
}

/** The area of a quad whose corners are (a-left, a-right, b-left, b-right). */
function quadArea({ corners: [al, ar, bl, br] }) {
    const tri = (p, q, r) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
    return tri(al, ar, bl) + tri(bl, ar, br);
}

const arc = (n = 40, r = 0.5) => Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * 2.2;
    return [Math.cos(a) * r, Math.sin(a) * r];
}).flat();

describe('chromatic impasto core maths', () => {
    it('frames the canvas two units tall from the rest distance', () => {
        expect(Math.tan((VIEW.fov * Math.PI) / 360) * VIEW_DISTANCE).toBeCloseTo(1, 9);
        expect(VIEW.overscan).toBeGreaterThan(1.03);
        expect(RELIEF.keep).toBeGreaterThan(0);
        expect(RELIEF.keep).toBeLessThan(0.6);
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2159, 3);
        expect(hexToLinear('nonsense')).toEqual([0.5, 0.5, 0.5]);
        const a = mulberry32(42);
        const b = mulberry32(42);
        const c = mulberry32(43);
        const first = a();
        expect(b()).toBe(first);
        expect(c()).not.toBe(first);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(1);
    });

    it('turns a piece colour into a pigment: never emissive, never a dead black', () => {
        const white = pigmentFromHex('#ffffff');
        expect(Math.max(...white)).toBeCloseTo(0.92, 6);
        const red = pigmentFromHex('#b30000');
        expect(red[0]).toBeGreaterThan(red[1] * 20);
        const black = pigmentFromHex('#000000');
        expect(Math.min(...black)).toBeGreaterThan(0);
        expect(Math.max(...black)).toBeLessThan(0.05);
    });

    it('defines every tube of every period in scene-linear light', () => {
        expect(IMPASTO_PERIODS.length).toBe(5);
        const names = new Set(IMPASTO_PERIODS.map((p) => p.name));
        expect(names.size).toBe(IMPASTO_PERIODS.length);
        IMPASTO_PERIODS.forEach((p) => {
            expect(p.darks.length).toBeGreaterThanOrEqual(3);
            expect(p.masses.length).toBeGreaterThanOrEqual(5);
            expect(p.accents.length).toBeGreaterThanOrEqual(3);
            [p.ground, p.contour, p.light, ...p.darks, ...p.masses, ...p.accents].forEach((c) => {
                expect(c).toHaveLength(3);
                c.forEach((v) => {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                });
            });
            // The ground is dark (the board must read in front of it) and the light is light.
            expect(Math.max(...p.ground)).toBeLessThan(0.02);
            expect(Math.min(...p.light)).toBeGreaterThan(0.6);
            expect(p.key).toHaveLength(3);
        });
        expect(GOLD[0]).toBeGreaterThan(GOLD[2] * 2);
    });

    it('gives the field a unit direction everywhere, turning one way round the board', () => {
        const field = createField({ aspect: ASPECT, seed: 3, heart: { x: 0, y: 0 } });
        expect(field.whorls.length).toBeGreaterThanOrEqual(3);
        const d = [0, 0];
        for (let i = 0; i < 200; i++) {
            const x = (radicalInverse(i + 1) * 2 - 1) * ASPECT;
            const y = ((i * 0.618) % 1) * 2 - 1;
            fieldDirection(field, x, y, d);
            expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 6);
        }
        // Close to the board the great whorl rules: the current runs anticlockwise round it.
        let turning = 0;
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const x = Math.cos(a) * 0.5;
            const y = Math.sin(a) * 0.5;
            fieldDirection(field, x, y, d);
            turning += x * d[1] - y * d[0];
        }
        expect(turning / 24).toBeGreaterThan(0.2);
    });

    it('puts whorls beside the board in a wide frame and above and below it in a tall one', () => {
        const wide = createField({ aspect: 16 / 9, seed: 1 });
        expect(wide.whorls.slice(1).every((w) => Math.abs(w.x) > 0.6)).toBe(true);
        const tall = createField({ aspect: 430 / 932, seed: 1 });
        expect(tall.whorls.slice(1).every((w) => Math.abs(w.y) > 0.6)).toBe(true);
        expect(createField({ aspect: 16 / 9, seed: 1 })).toEqual(wide);
        expect(createField({ aspect: 16 / 9, seed: 2 })).not.toEqual(wide);
    });

    it('twists the paint nowhere under the board and nowhere past its reach', () => {
        expect(twistProfile(0, 1.2)).toBe(0);
        expect(twistProfile(1.2, 1.2)).toBe(0);
        expect(twistProfile(5, 1.2)).toBe(0);
        let peak = 0;
        for (let r = 0; r <= 1.2; r += 0.01) peak = Math.max(peak, twistProfile(r, 1.2));
        expect(peak).toBeGreaterThan(0.75);
        expect(peak).toBeLessThanOrEqual(1);
        // A twist carried there and back is the identity; distance from the centre is kept.
        const there = twistPoint(0.4, 0.3, 0.1, -0.05, 0.9, 1.2);
        expect(Math.hypot(there[0] - 0.1, there[1] + 0.05)).toBeCloseTo(Math.hypot(0.3, 0.35), 9);
        const back = twistPoint(there[0], there[1], 0.1, -0.05, -0.9, 1.2);
        expect(back[0]).toBeCloseTo(0.4, 9);
        expect(back[1]).toBeCloseTo(0.3, 9);
    });

    it('turns the canvas a notch a link from the second, a little more each time, never a rate', () => {
        expect(notchForCombo(0)).toBe(0);
        expect(notchForCombo(SWIRL_FROM - 1)).toBe(0);
        expect(notchForCombo(SWIRL_FROM)).toBeGreaterThan(0.1);
        let last = 0;
        let wound = 0;
        for (let n = SWIRL_FROM; n < 40; n++) {
            const notch = notchForCombo(n);
            expect(notch).toBeGreaterThanOrEqual(last);
            last = notch;
            if (n <= 9) wound += notch;
        }
        expect(last).toBeLessThanOrEqual(0.55);
        // A chain of nine winds the paint less than a turn: arms, not thread.
        expect(wound).toBeLessThan(Math.PI * 1.2);
        expect(powerForCombo(1)).toBe(0);
        expect(powerForCombo(3)).toBeGreaterThan(powerForCombo(2));
        expect(powerForCombo(60)).toBeLessThanOrEqual(1);
    });

    it('keeps its noise in the unit range and its sequence well spread', () => {
        for (let i = 0; i < 300; i++) {
            const v = valueNoise(i * 0.37, i * -0.21, 5);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
        expect(valueNoise(1.5, 2.5, 5)).toBe(valueNoise(1.5, 2.5, 5));
        expect(valueNoise(1.5, 2.5, 5)).not.toBe(valueNoise(1.5, 2.5, 6));
        expect(radicalInverse(1)).toBe(0.5);
        expect(radicalInverse(2)).toBe(0.25);
        expect(radicalInverse(3)).toBe(0.75);
        expect(DROPLET_GRAVITY).toBeGreaterThan(0);
    });
});

describe('chromatic impasto strokes', () => {
    it('resamples a path at an even step and keeps its ends', () => {
        const pts = resamplePath([0, 0, 1, 0, 1, 1], 0.1);
        const n = pts.length / 2;
        expect(pts[0]).toBe(0);
        expect(pts[1]).toBe(0);
        expect(pts[n * 2 - 2]).toBeCloseTo(1, 6);
        expect(pts[n * 2 - 1]).toBeCloseTo(1, 6);
        const steps = [];
        for (let i = 1; i < n; i++) steps.push(Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
        // Even along the path (the one step that cuts the corner is a chord, a little shorter).
        expect(Math.max(...steps)).toBeLessThanOrEqual(0.1 + 1e-6);
        expect(steps.filter((v) => v < 0.09).length).toBeLessThanOrEqual(1);
    });

    it('builds a ribbon with two sides a half-width from its path at every node', () => {
        const s = createStroke({
            points: arc(), width: 0.05, widthEnd: 0.02, t0: 1, dur: 0.5, colorA: [1, 0, 0],
        });
        expect(s.nodes).toBeGreaterThan(8);
        expect(s.length).toBeCloseTo(0.5 * 2.2, 2);
        expect(s.half[0]).toBeCloseTo(0.05, 6);
        expect(s.half[s.nodes - 1]).toBeCloseTo(0.02, 6);
        for (let i = 0; i < s.nodes; i++) {
            const w = Math.hypot(s.left[i * 2] - s.right[i * 2], s.left[i * 2 + 1] - s.right[i * 2 + 1]);
            expect(w).toBeCloseTo(s.half[i] * 2, 5);
        }
        expect(Number.isInteger(s.seed)).toBe(true);
        expect(s.kind).toBe(KIND.BRUSH);
        expect(s.bristle).toBe(1);
        expect(createStroke({
            points: arc(), width: 0.05, kind: KIND.KNIFE, colorA: [1, 0, 0],
        }).bristle).toBe(0);
    });

    it('moves its brush from touch-down to lift-off over its duration, and no further', () => {
        const s = createStroke({
            points: arc(), width: 0.04, t0: 2, dur: 0.4, ease: 'linear', colorA: [1, 1, 1],
        });
        expect(strokeReach(s, 1.9)).toBe(0);
        expect(strokeReach(s, 2.2)).toBeCloseTo(s.length / 2, 6);
        expect(strokeReach(s, 2.4)).toBeCloseTo(s.length, 6);
        expect(strokeReach(s, 99)).toBeCloseTo(s.length, 6);
        const eased = createStroke({
            points: arc(), width: 0.04, t0: 2, dur: 0.4, ease: 'out', colorA: [1, 1, 1],
        });
        expect(strokeReach(eased, 2.2)).toBeGreaterThan(eased.length / 2);
    });

    it('covers every stroke exactly once whatever the frame rate', () => {
        const whole = createStroke({
            points: arc(60, 0.7), width: 0.06, widthEnd: 0.03, t0: 0, dur: 0.5, colorA: [0, 0, 1],
        });
        const full = new StrokeBatch(4096);
        emitStroke(whole, Infinity, full);
        const fullArea = quadsOf(full).reduce((sum, q) => sum + quadArea(q), 0);
        expect(whole.done).toBe(true);
        expect(fullArea).toBeGreaterThan(0.01);

        [30, 60, 144, 240].forEach((fps) => {
            const s = createStroke({
                points: arc(60, 0.7), width: 0.06, widthEnd: 0.03, t0: 0, dur: 0.5, colorA: [0, 0, 1],
            });
            const batch = new StrokeBatch(4096);
            for (let f = 0; f <= fps; f++) emitStroke(s, strokeReach(s, f / fps), batch);
            expect(s.done).toBe(true);
            const quads = quadsOf(batch);
            // The pieces follow one another along the path with no gap and no overlap ...
            expect(quads[0].s0).toBe(0);
            for (let i = 1; i < quads.length; i++) expect(quads[i].s0).toBeCloseTo(quads[i - 1].s1, 6);
            expect(quads[quads.length - 1].s1).toBeCloseTo(s.length, 6);
            // ... each begins on the very edge the last ended on ...
            for (let i = 1; i < quads.length; i++) {
                expect(quads[i].corners[0]).toEqual(quads[i - 1].corners[2]);
                expect(quads[i].corners[1]).toEqual(quads[i - 1].corners[3]);
            }
            // ... and together they are the whole ribbon.
            expect(quads.reduce((sum, q) => sum + quadArea(q), 0)).toBeCloseTo(fullArea, 5);
        });
    });

    it('writes a stroke\'s paint into every vertex', () => {
        const s = createStroke({
            points: [0, 0, 0.4, 0],
            width: 0.05,
            t0: 0,
            dur: 0,
            colorA: [0.9, 0.1, 0.2],
            colorB: [0.1, 0.2, 0.9],
            mixB: 0.4,
            load: 1.2,
            dry: 0.7,
            height: 1.3,
            special: 1,
            keep: 0.1,
            seed: 77,
            kind: KIND.KNIFE,
        });
        const batch = new StrokeBatch(64);
        emitStroke(s, Infinity, batch);
        expect(batch.quads).toBeGreaterThan(0);
        for (let v = 0; v < batch.quads * 4; v++) {
            const o = v * VERTEX_STRIDE;
            const d = batch.data;
            expect(Math.abs(d[o + 3])).toBe(1); // u
            expect(d[o + 5]).toBeCloseTo(s.length, 6);
            expect(d[o + 6]).toBeCloseTo(0.05, 6);
            expect([d[o + 7], d[o + 8], d[o + 9]].map((x) => +x.toFixed(4))).toEqual([0.9, 0.1, 0.2]);
            expect(d[o + 10]).toBe(77);
            expect(d[o + 14]).toBeCloseTo(0.4, 6);
            expect(d[o + 15]).toBe(KIND.KNIFE);
            expect(d[o + 16]).toBeCloseTo(1.2, 6);
            expect(d[o + 17]).toBeCloseTo(0.7, 6);
            expect(d[o + 18]).toBe(0);
            expect(d[o + 19]).toBeCloseTo(1.3, 6);
            expect(d[o + 20]).toBe(1);
            expect(d[o + 21]).toBeCloseTo(0.1, 6);
        }
    });

    it('lays a blob as one quad that reaches past its radius for its thrown rim', () => {
        const blob = createBlob({
            x: 0.3, y: -0.2, radius: 0.05, t0: 0, colorA: [1, 1, 0], fingers: 0.8,
        });
        const batch = new StrokeBatch(8);
        expect(emitStroke(blob, 0, batch)).toBe(1);
        expect(blob.done).toBe(true);
        expect(emitStroke(blob, 0, batch)).toBe(0);
        const [q] = quadsOf(batch);
        q.corners.forEach(([x, y]) => {
            expect(Math.hypot(x - 0.3, y + 0.2)).toBeCloseTo(0.05 * BLOB_MARGIN * Math.SQRT2, 5);
        });
        expect(batch.data[15]).toBe(KIND.BLOB);
        expect(batch.data[17]).toBeCloseTo(0.8, 6); // the rim's fingers ride in `dry`
        expect(batch.data[18]).toBe(0); // a bead, unless it asks to be a crater
        const crater = createBlob({
            x: 0, y: 0, radius: 0.05, t0: 0, colorA: [1, 1, 0], crater: 1,
        });
        expect(crater.bristle).toBe(1);
    });

    it('counts a stroke too short to lay as finished, so it cannot pin the log', () => {
        const speck = createStroke({
            points: [0.5, 0.5, 0.5, 0.5 + 1e-9], width: 0.03, t0: 0, dur: 0.2, colorA: [1, 1, 1],
        });
        expect(speck.done).toBe(true);
        const none = createStroke({
            points: [0.5, 0.5], width: 0.03, t0: 0, dur: 0.2, colorA: [1, 1, 1],
        });
        expect(none.done).toBe(true);
        const painter = new Painter({ maxLog: 20 });
        painter.add(speck);
        for (let i = 0; i < 60; i++) {
            painter.add(createStroke({
                points: [0, 0, 0.3, 0], width: 0.03, t0: 0.01 * (i + 1), dur: 0, colorA: [1, 0, 0],
            }));
        }
        const batch = new StrokeBatch(1024);
        painter.advance(5, batch);
        painter.rewind();
        painter.advance(5, batch);
        expect(painter.cursor).toBe(painter.log.length);
        expect(painter.log.length).toBeLessThanOrEqual(20);
    });

    it('draws a full batch and starts over rather than dropping paint', () => {
        let drawn = 0;
        const batch = new StrokeBatch(8, (b) => {
            drawn += b.quads;
        });
        const s = createStroke({
            points: arc(80, 0.9), width: 0.03, t0: 0, dur: 0, colorA: [1, 1, 1],
        });
        const quads = emitStroke(s, Infinity, batch);
        expect(quads).toBeGreaterThan(16);
        expect(drawn + batch.quads).toBe(quads);
        expect(batch.total).toBe(quads);
    });
});

describe('chromatic impasto painter', () => {
    const stroke = (t0, dur = 0.2, extra = {}) => createStroke({
        points: [0, 0, 0.5, 0.1], width: 0.03, t0, dur, colorA: [1, 0, 0], ...extra,
    });

    it('keeps its log in the order the paint goes on, whatever order it is given in', () => {
        const painter = new Painter();
        painter.add(stroke(3));
        painter.add(stroke(1));
        painter.add(stroke(2));
        const tie = painter.add(stroke(2));
        expect(painter.log.map((s) => s.t0)).toEqual([1, 2, 2, 3]);
        expect(painter.log[2]).toBe(tie);
    });

    it('lays only what is due, and finishes what it started', () => {
        const painter = new Painter();
        painter.addAll([stroke(0, 0.5), stroke(1, 0.5), stroke(5, 0.5)]);
        const batch = new StrokeBatch(256);
        expect(painter.busy(-1)).toBe(false);
        expect(painter.advance(-1, batch)).toBe(0);
        expect(painter.advance(0.25, batch)).toBeGreaterThan(0);
        expect(painter.busy(0.25)).toBe(true);
        expect(painter.cursor).toBe(0);
        painter.advance(2, batch);
        expect(painter.cursor).toBe(2);
        expect(painter.busy(2)).toBe(false);
        expect(painter.lastPaintTime).toBeCloseTo(1.5, 6);
        painter.advance(10, batch);
        expect(painter.cursor).toBe(3);
        const before = batch.total;
        expect(painter.advance(20, batch)).toBe(0);
        expect(batch.total).toBe(before);
    });

    it('replays the same painting after a rewind', () => {
        const painter = new Painter();
        const field = createField({ aspect: ASPECT, seed: 1 });
        painter.addAll(composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 1, t0: 0, density: 0.3, card: CARD,
        }));
        const first = new StrokeBatch(1 << 15);
        painter.advance(INTRO_SPAN + 1, first);
        expect(painter.cursor).toBe(painter.log.length);
        painter.rewind();
        expect(painter.cursor).toBe(0);
        const second = new StrokeBatch(1 << 15);
        painter.advance(INTRO_SPAN + 1, second);
        expect(second.quads).toBe(first.quads);
        expect(Array.from(second.data.subarray(0, second.quads * QUAD_FLOATS)))
            .toEqual(Array.from(first.data.subarray(0, first.quads * QUAD_FLOATS)));
    });

    it('lays a stroke begun under a twist through that twist, and the same way on a replay', () => {
        const painter = new Painter();
        const s = painter.add(stroke(0, 1, { points: [0.5, 0, 0.9, 0] }));
        const twist = {
            cx: 0, cy: 0, angle: 0.6, reach: 1.6,
        };
        const batch = new StrokeBatch(256);
        painter.advance(0.5, batch, twist);
        expect(s.twist).toEqual(twist);
        expect(s.left).not.toBe(s.baseLeft);
        // Carried round the centre: the same distance from it, somewhere else.
        expect(Math.hypot(s.left[0], s.left[1])).toBeCloseTo(Math.hypot(s.baseLeft[0], s.baseLeft[1]), 6);
        expect(Math.abs(s.left[1] - s.baseLeft[1])).toBeGreaterThan(0.01);
        const carried = Array.from(s.left);
        // A replay uses the twist the stroke was laid through, not the one in force now.
        painter.rewind();
        painter.advance(0.5, new StrokeBatch(256), { ...twist, angle: -2 });
        expect(Array.from(s.left)).toEqual(carried);
    });

    it('carries a stroke still under way back through a twist that is baked in', () => {
        const painter = new Painter();
        const s = painter.add(stroke(0, 1, { points: [0.5, 0, 0.9, 0] }));
        const twist = {
            cx: 0, cy: 0, angle: 0.6, reach: 1.6,
        };
        const batch = new StrokeBatch(256);
        painter.advance(0.5, batch, twist);
        const bakes = [];
        painter.addBake(0.6, 0, 0, 0.6, 1.6);
        painter.advance(0.7, batch, { ...twist, angle: 0 }, (entry) => bakes.push(entry.angle));
        expect(bakes).toEqual([0.6]);
        // Baked: the paint now lies where it is seen, so the rest of the stroke is laid straight.
        for (let i = 0; i < s.nodes * 2; i++) expect(s.left[i]).toBeCloseTo(s.baseLeft[i], 6);
        // A stroke begun after the bake is not touched by it.
        const later = painter.add(stroke(0.8, 0.1, { points: [0.5, 0.2, 0.9, 0.2] }));
        painter.advance(1.2, batch, { ...twist, angle: 0 });
        expect(later.twist).toBe(false);
        expect(later.left).toBe(later.baseLeft);
        expect(painter.cursor).toBe(3);
    });

    it('spreads a long replay over frames when it is given a budget', () => {
        const painter = new Painter();
        for (let i = 0; i < 60; i++) painter.add(stroke(i * 0.01, 0));
        const batch = new StrokeBatch(4096);
        const first = painter.advance(10, batch, null, null, 40);
        expect(first).toBeGreaterThanOrEqual(40);
        expect(painter.behind).toBe(true);
        expect(painter.cursor).toBeLessThan(60);
        let frames = 1;
        while (painter.behind && frames < 100) {
            painter.advance(10, batch, null, null, 40);
            frames += 1;
        }
        expect(frames).toBeGreaterThan(2);
        expect(painter.cursor).toBe(60);
        expect(painter.behind).toBe(false);
    });

    it('ages the paint through a replay: a second or more between two pieces is time to dry', () => {
        const painter = new Painter();
        painter.addAll([stroke(0, 0), stroke(0.3, 0), stroke(5, 0), stroke(5.2, 0), stroke(12, 0)]);
        const batch = new StrokeBatch(256);
        const ages = [];
        painter.advance(20, batch, null, null, Infinity, (seconds) => ages.push(seconds));
        expect(ages.map((v) => +v.toFixed(3))).toEqual([5, 7, 8]);
        expect(painter.clock).toBe(20);
        // Frame to frame nothing is reported: that drying is the world's own.
        painter.add(stroke(20.01, 0));
        painter.advance(20.02, batch, null, null, Infinity, (seconds) => ages.push(seconds));
        expect(ages).toHaveLength(3);
        // A rewind starts the clock over.
        painter.rewind();
        ages.length = 0;
        painter.advance(20.02, batch, null, null, Infinity, (seconds) => ages.push(seconds));
        // (Up to the last piece laid: the hundredth of a second since is the world's to dry.)
        expect(ages.reduce((sum, v) => sum + v, 0)).toBeCloseTo(20.01, 6);
    });

    it('forgets the oldest finished strokes once the log is over its limit, never one under way', () => {
        const painter = new Painter({ maxLog: 40 });
        const slow = painter.add(stroke(0, 500));
        for (let i = 0; i < 80; i++) painter.add(stroke(1 + i * 0.01, 0));
        const batch = new StrokeBatch(1024);
        painter.advance(10, batch);
        // The slow stroke is first and unfinished: nothing before it can go.
        expect(painter.log[0]).toBe(slow);
        expect(painter.dropped).toBe(0);
        painter.advance(600, batch);
        expect(painter.log.length).toBeLessThanOrEqual(40);
        expect(painter.dropped).toBeGreaterThan(0);
        expect(painter.cursor).toBe(painter.log.length);
    });
});

describe('chromatic impasto gestures', () => {
    const field = createField({ aspect: ASPECT, seed: 1 });
    const finite = (strokes) => strokes.every((s) => (s.kind === KIND.BLOB
        ? Number.isFinite(s.x) && Number.isFinite(s.y) && s.radius > 0
        : Array.from(s.left).every(Number.isFinite) && Array.from(s.right).every(Number.isFinite) && s.length > 0));

    it('follows the current: a path of the asked length, centred on its point', () => {
        const pts = flowPath(field, 1.1, 0.3, 0.6);
        let len = 0;
        for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        expect(len).toBeCloseTo(0.6, 2);
        const mid = pts.length / 2 - 1;
        expect(Math.hypot(pts[mid - (mid % 2)] - 1.1, pts[mid - (mid % 2) + 1] - 0.3)).toBeLessThan(0.05);
        const from = flowPath(field, 1.1, 0.3, 0.6, { centred: false });
        expect(from[0]).toBe(1.1);
        expect(from[1]).toBe(0.3);
        // A pull bends the path toward it.
        const pulled = flowPath(field, 1.1, 0.3, 0.6, { centred: false, pull: [1, 0], pullWeight: 1 });
        expect(pulled[pulled.length - 2]).toBeCloseTo(1.7, 3);
    });

    it('blocks the canvas in: darks, masses, contour and lights, in that order, on the cloth', () => {
        const strokes = composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 1, t0: 10, card: CARD,
        });
        expect(strokes.length).toBeGreaterThan(150);
        expect(finite(strokes)).toBe(true);
        expect(strokes.every((s) => s.tag === 'under')).toBe(true);
        expect(strokes.every((s) => s.t0 >= 10 && s.t0 + s.dur <= 10 + INTRO_SPAN + 0.6)).toBe(true);
        const mean = (list) => list.reduce((sum, s) => sum + s.t0, 0) / list.length;
        const layIn = strokes.filter((s) => s.height < 0.5);
        const contour = strokes.filter((s) => s.colorA.join() === IMPASTO_PERIODS[0].contour.join());
        const lights = strokes.filter((s) => s.height >= 1.2);
        expect(layIn.length).toBeGreaterThan(20);
        expect(contour.length).toBeGreaterThan(10);
        expect(lights.length).toBeGreaterThan(20);
        expect(mean(layIn)).toBeLessThan(mean(contour));
        expect(mean(contour)).toBeLessThan(mean(lights));
        // The same seed paints the same picture; another seed, another.
        const again = composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 1, t0: 10, card: CARD,
        });
        expect(again.map((s) => [s.t0, s.length, s.seed])).toEqual(strokes.map((s) => [s.t0, s.length, s.seed]));
        const other = composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 2, t0: 10, card: CARD,
        });
        expect(other.map((s) => s.seed)).not.toEqual(strokes.map((s) => s.seed));
        // Fewer strokes on a lower tier, more on a taller cloth.
        expect(composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 1, density: 0.6, card: CARD,
        }).length).toBeLessThan(strokes.length);
    });

    it('lays a wide stroke narrower near the eye of a whorl, where the current turns too tightly', () => {
        const strokes = composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 2, card: CARD,
        });
        const pathOf = (s) => {
            const pts = [];
            for (let i = 0; i < s.nodes; i++) {
                pts.push((s.baseLeft[i * 2] + s.baseRight[i * 2]) / 2, (s.baseLeft[i * 2 + 1] + s.baseRight[i * 2 + 1]) / 2);
            }
            return pts;
        };
        // (The contour is exempt: it is thin anyway.)
        const wide = strokes.filter((s) => s.colorA.join() !== IMPASTO_PERIODS[0].contour.join());
        wide.forEach((s) => {
            const eye = eyeDistance(field, pathOf(s));
            // The path was resampled, so the fit is to within a node's spacing.
            expect(s.half[0]).toBeLessThanOrEqual(Math.max(0.01, eye * 0.5) + 0.02);
        });
        expect(eyeDistance(field, [field.whorls[1].x, field.whorls[1].y])).toBe(0);
    });

    it('spends little of its colour behind the board', () => {
        const strokes = composeUnderpainting({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], seed: 4, card: CARD,
        }).filter((s) => s.height >= 0.5); // (the dark lay-in covers the whole cloth)
        const { halfX, halfY } = canvasExtent(ASPECT);
        const middle = (s) => {
            const i = Math.floor(s.nodes / 2);
            return [(s.left[i * 2] + s.right[i * 2]) / 2, (s.left[i * 2 + 1] + s.right[i * 2 + 1]) / 2];
        };
        const behind = strokes.filter((s) => {
            const [x, y] = middle(s);
            return x > CARD.x0 + 0.1 && x < CARD.x1 - 0.1 && y > CARD.y0 + 0.1 && y < CARD.y1 - 0.1;
        });
        const share = ((CARD.x1 - CARD.x0 - 0.2) * (CARD.y1 - CARD.y0 - 0.2)) / (4 * halfX * halfY);
        expect(behind.length / strokes.length).toBeLessThan(share * 0.85);
    });

    it('lays a lock as one stroke out of its point, pressed down as it goes; a hard drop as a slab', () => {
        const soft = lockGesture({
            field, x: 0.6, y: 0.2, out: [1, 0], color: [0.8, 0.1, 0.1], under: [0.1, 0.1, 0.8], t0: 3, seed: 5,
        });
        expect(soft.strokes).toHaveLength(1);
        const [s] = soft.strokes;
        expect(s.kind).toBe(KIND.BRUSH);
        expect(s.t0).toBe(3);
        expect(s.colorA).toEqual([0.8, 0.1, 0.1]);
        expect(s.colorB).toEqual([0.1, 0.1, 0.8]);
        expect(s.mixB).toBeGreaterThan(0);
        expect((s.left[0] + s.right[0]) / 2).toBeCloseTo(0.6, 3);
        expect(soft.tip[0]).toBeGreaterThan(0.7);
        expect(Math.hypot(...soft.heading)).toBeCloseTo(1, 6);
        // Drawn out thin, pressed down: wider at its end than where it left the board.
        expect(s.half[s.nodes - 1]).toBeGreaterThan(s.half[0] * 2);
        // The further it is asked to reach, the longer it is.
        const near = lockGesture({
            field, x: 0.6, y: 0.2, out: [1, 0], color: [0.8, 0.1, 0.1], reach: 0, t0: 3, seed: 5,
        }).strokes[0];
        const far = lockGesture({
            field, x: 0.6, y: 0.2, out: [1, 0], color: [0.8, 0.1, 0.1], reach: 1, t0: 3, seed: 5,
        }).strokes[0];
        expect(far.length).toBeGreaterThan(near.length + 0.4);
        const hard = lockGesture({
            field, x: 0.6, y: 0.2, out: [1, 0], color: [0.8, 0.1, 0.1], hard: true, t0: 3, seed: 5,
        });
        expect(hard.strokes[0].kind).toBe(KIND.KNIFE);
        expect(hard.strokes[0].length).toBeGreaterThan(s.length);
        expect(hard.strokes[0].half[0]).toBeGreaterThan(s.half[0]);
        expect(hard.strokes[0].height).toBeGreaterThan(s.height);
        expect(hard.strokes[0].dur).toBeLessThan(s.dur);
    });

    it('sends a cleared row out of both sides of the card to the edge of the cloth', () => {
        const { halfX } = canvasExtent(ASPECT);
        const strokes = sweepGesture({
            y: -0.5, x0: CARD.x0, x1: CARD.x1, halfX, width: 0.055, color: [1, 0.8, 0], t0: 2, seed: 9,
        });
        expect(strokes).toHaveLength(2);
        const [left, right] = strokes;
        const startX = (s) => (s.left[0] + s.right[0]) / 2;
        const endX = (s) => (s.left[s.nodes * 2 - 2] + s.right[s.nodes * 2 - 2]) / 2;
        expect(startX(left)).toBeLessThan(CARD.x0);
        expect(startX(left)).toBeGreaterThan(CARD.x0 - 0.06);
        expect(endX(left)).toBeLessThan(-halfX);
        expect(startX(right)).toBeGreaterThan(CARD.x1);
        expect(endX(right)).toBeGreaterThan(halfX);
        strokes.forEach((s) => {
            expect(s.dry).toBeGreaterThanOrEqual(0.7); // it runs dry on the way
            expect(s.t0).toBeGreaterThanOrEqual(2);
        });
        // A card as wide as the cloth leaves nothing to sweep.
        expect(sweepGesture({
            y: 0, x0: -halfX, x1: halfX, halfX, width: 0.05, color: [1, 1, 1], t0: 0,
        })).toHaveLength(0);
        const pts = sweepPath(0, 0, 1, 0, 0.1, 0, 1, 11);
        expect(pts[10]).toBeCloseTo(0.5, 6);
        expect(Math.abs(pts[11])).toBeCloseTo(0.1, 6);
    });

    it('flings paint from every side of the card, each throw tapering into drops', () => {
        const burst = burstGesture({
            card: CARD, colors: [[1, 0, 0], [0, 0, 1], [1, 1, 0]], t0: 4, seed: 2, count: 20,
        });
        expect(burst.throws).toHaveLength(20);
        const ribbons = burst.strokes.filter((s) => s.kind !== KIND.BLOB);
        const drops = burst.strokes.filter((s) => s.kind === KIND.BLOB);
        expect(ribbons).toHaveLength(20);
        expect(drops.length).toBeGreaterThanOrEqual(40);
        expect(finite(burst.strokes)).toBe(true);
        ribbons.forEach((s) => expect(s.half[s.nodes - 1]).toBeLessThan(s.half[0] * 0.3));
        // Among the drops, a few great splats: craters, standing clear of the card.
        const craters = drops.filter((d) => d.bristle === 1);
        expect(craters).toHaveLength(5);
        craters.forEach((d) => {
            expect(d.radius).toBeGreaterThan(0.04);
            expect(d.x < CARD.x0 || d.x > CARD.x1 || d.y < CARD.y0 || d.y > CARD.y1).toBe(true);
        });
        burst.throws.forEach((t) => {
            // Each leaves from just outside the card, heading away from its centre.
            const outside = t.x < CARD.x0 || t.x > CARD.x1 || t.y < CARD.y0 || t.y > CARD.y1;
            expect(outside).toBe(true);
            expect(t.x * t.dx + t.y * t.dy).toBeGreaterThan(0);
        });
        // Every quarter of the compass gets some.
        const quarters = new Set(burst.throws.map((t) => `${Math.sign(t.dx)}${Math.sign(t.dy)}`));
        expect(quarters.size).toBe(4);
        expect(drops.every((d) => d.t0 > 4)).toBe(true);
    });

    it('lays gold leaf round the card, clear of it, one pass after another', () => {
        const ring = haloGesture({ card: CARD, t0: 6, seed: 1 });
        expect(ring.length).toBeGreaterThanOrEqual(12);
        expect(finite(ring)).toBe(true);
        ring.forEach((s, i) => {
            expect(s.special).toBe(1);
            expect(s.colorA).toEqual([...GOLD]);
            if (i > 0) expect(s.t0).toBeGreaterThan(ring[i - 1].t0);
            for (let k = 0; k < s.nodes; k++) {
                const x = (s.left[k * 2] + s.right[k * 2]) / 2;
                const y = (s.left[k * 2 + 1] + s.right[k * 2 + 1]) / 2;
                const inside = x > CARD.x0 && x < CARD.x1 && y > CARD.y0 && y < CARD.y1;
                expect(inside).toBe(false);
            }
        });
        expect(haloGesture({
            card: CARD, t0: 6, seed: 1, turns: 2,
        }).length).toBe(ring.length * 2);
        // A later ring is laid outside an earlier one.
        const outer = haloGesture({
            card: CARD, t0: 6, seed: 1, ring: 2,
        });
        const farthest = (list) => Math.max(...list.map((s) => Math.abs(s.left[0] + s.right[0]) / 2));
        expect(farthest(outer)).toBeGreaterThan(farthest(ring) + 0.1);
    });

    it('winds arcs round a point, splats with spatter, scrapes the whole cloth, and wanders', () => {
        const arcs = spiralGesture({
            cx: 0, cy: 0, radius: 1, colors: [[1, 0, 0], [0, 1, 0]], t0: 1, seed: 3, arms: 3,
        });
        expect(arcs).toHaveLength(3);
        arcs.forEach((s) => {
            const r0 = Math.hypot((s.left[0] + s.right[0]) / 2, (s.left[1] + s.right[1]) / 2);
            const n = s.nodes * 2;
            const r1 = Math.hypot((s.left[n - 2] + s.right[n - 2]) / 2, (s.left[n - 1] + s.right[n - 1]) / 2);
            expect(r0).toBeGreaterThan(0.85);
            expect(r1).toBeGreaterThan(r0);
            expect(s.length).toBeGreaterThan(2);
        });

        const splat = splatGesture({
            x: 0.5, y: 0.5, radius: 0.05, color: [1, 0, 0], t0: 2, seed: 4, spatter: 8,
        });
        expect(splat).toHaveLength(9);
        expect(splat.every((b) => b.kind === KIND.BLOB)).toBe(true);
        expect(splat[0].radius).toBe(0.05);
        expect(splat[0].bristle).toBe(1); // the splat is a crater, its spatter beads
        expect(splat.slice(1).every((b) => b.bristle === 0)).toBe(true);
        splat.slice(1).forEach((b) => {
            expect(b.radius).toBeLessThan(0.02);
            expect(Math.hypot(b.x - 0.5, b.y - 0.5)).toBeGreaterThan(0.05);
            expect(b.t0).toBeGreaterThan(2);
        });

        const scrape = scrapeGesture({
            field, aspect: ASPECT, ground: IMPASTO_PERIODS[0].ground, t0: 5, seed: 1,
        });
        expect(finite(scrape)).toBe(true);
        expect(scrape.every((s) => s.kind === KIND.KNIFE && s.height < 0.15 && s.keep < 0.05)).toBe(true);
        // Enough wide passes to go over the whole cloth more than once.
        const { halfX, halfY } = canvasExtent(ASPECT);
        const covered = scrape.reduce((sum, s) => sum + s.length * s.half[0] * 2, 0);
        expect(covered).toBeGreaterThan(4 * halfX * halfY * 1.5);

        for (let i = 0; i < 40; i++) {
            const [s] = ambientGesture({
                field, aspect: ASPECT, period: IMPASTO_PERIODS[i % 5], card: CARD, t0: 20, index: i,
            });
            expect(finite([s])).toBe(true);
            expect(s.dur).toBeGreaterThan(1); // unhurried
            expect(s.tag).toBe('ambient');
        }
        expect(ambientGesture({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], card: CARD, t0: 20, index: 7,
        })[0].length).toBe(ambientGesture({
            field, aspect: ASPECT, period: IMPASTO_PERIODS[0], card: CARD, t0: 20, index: 7,
        })[0].length);
    });
});

describe('chromatic impasto tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        QUALITY_NAMES.forEach((name) => {
            expect(POST_LOOK[name]).toBeDefined();
            expect(tierFor(name)).toBe(QUALITY[name]);
        });
        expect(tierFor('nonsense')).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier, and keeps thrown paint on all of them', () => {
        const keys = ['canvasScale', 'canvasMax', 'density', 'parallax', 'shadowTaps', 'droplets', 'motes'];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const lo = QUALITY[QUALITY_NAMES[i - 1]];
            const hi = QUALITY[QUALITY_NAMES[i]];
            keys.forEach((k) => expect(hi[k]).toBeGreaterThanOrEqual(lo[k]));
        }
        QUALITY_NAMES.forEach((name) => {
            expect(QUALITY[name].droplets).toBeGreaterThan(0);
            expect(QUALITY[name].density).toBeGreaterThan(0.4);
        });
    });
});
