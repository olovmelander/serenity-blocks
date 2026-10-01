import { describe, expect, it } from 'vitest';
import {
    createBloodMoonMotionEnvelope, sampleBloodMoonMotion,
} from '../../src/playground/effects/blood-moon-motion.js';
import { resolveBloodMoonLayout } from '../../src/playground/effects/blood-moon-state.js';

const cases = [
    {
        name: 'wide', width: 1920, height: 1080, rects: [],
    },
    {
        name: 'ultrawide', width: 3440, height: 1440, rects: [],
    },
    {
        name: 'narrow', width: 320, height: 1440, rects: [],
    },
    {
        name: 'compact', width: 720, height: 800, rects: [],
    },
    {
        name: 'central board',
        width: 1280,
        height: 800,
        rects: [{
            left: 500, top: 120, right: 780, bottom: 680,
        }],
    },
    {
        name: 'portrait board',
        width: 600,
        height: 900,
        rects: [{
            left: 160, top: 170, right: 520, bottom: 840,
        }],
    },
    {
        name: 'multiplayer',
        width: 1920,
        height: 1080,
        rects: [
            {
                left: 150, top: 250, right: 720, bottom: 1050,
            },
            {
                left: 1000, top: 250, right: 1570, bottom: 1050,
            },
        ],
    },
];

describe('Blood Moon motion', () => {
    it.each(cases)('keeps every phase and pointer extreme clear in $name', ({ width, height, rects }) => {
        const layout = resolveBloodMoonLayout(width, height, rects);
        const envelope = createBloodMoonMotionEnvelope(layout, width, height, rects);
        const out = {};
        for (let time = 0; time <= 180; time += 0.5) {
            for (const px of [-1, 0, 1]) {
                for (const py of [-1, 0, 1]) {
                    sampleBloodMoonMotion(envelope, time, px, py, false, out);
                    const x = out.x * width;
                    const y = (1 - out.y) * height;
                    const radius = out.radius * height;
                    expect(Math.min(x, width - x, y, height - y) + 1e-7).toBeGreaterThanOrEqual(radius);
                    expect(out.radius).toBeLessThanOrEqual(layout.radius + 1e-7);
                    for (const rect of rects) {
                        const dx = Math.max(rect.left - x, 0, x - rect.right);
                        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
                        expect(Math.hypot(dx, dy) + 1e-7).toBeGreaterThanOrEqual(radius);
                    }
                }
            }
        }
    });

    it('provides visible travel and breathing within twelve seconds of ordinary play', () => {
        const { width, height, rects } = cases.find(({ name }) => name === 'central board');
        const layout = resolveBloodMoonLayout(width, height, rects);
        const envelope = createBloodMoonMotionEnvelope(layout, width, height, rects);
        const first = sampleBloodMoonMotion(envelope, 0);
        let travel = 0;
        let maximum = first.radius;
        let minimum = first.radius;
        for (let t = 0; t <= 12; t += 0.1) {
            const frame = sampleBloodMoonMotion(envelope, t);
            travel = Math.max(travel, Math.hypot((frame.x - first.x) * width, (frame.y - first.y) * height));
            maximum = Math.max(maximum, frame.radius);
            minimum = Math.min(minimum, frame.radius);
        }
        expect(travel).toBeGreaterThan(20);
        expect(travel).toBeLessThan(60);
        expect(maximum / minimum - 1).toBeGreaterThan(0.03);
    });

    it('holds the anchor and radius stationary under reduced motion, including pointer input', () => {
        const layout = resolveBloodMoonLayout(1280, 800);
        const envelope = createBloodMoonMotionEnvelope(layout, 1280, 800);
        const first = sampleBloodMoonMotion(envelope, 0, 0, 0, true);
        expect(first.x).toBeCloseTo(layout.x, 12);
        expect(first.y).toBeCloseTo(layout.y, 12);
        for (let t = 0; t <= 180; t += 3) {
            expect(sampleBloodMoonMotion(envelope, t, Math.sin(t), Math.cos(t), true)).toEqual(first);
        }
    });

    it('reuses output storage and bounds malformed input and fully occupied viewports', () => {
        const envelope = createBloodMoonMotionEnvelope({ x: NaN, y: Infinity, radius: NaN }, NaN, Infinity, [null, {}]);
        expect(Object.values(envelope).every(Number.isFinite)).toBe(true);
        const out = {};
        expect(sampleBloodMoonMotion(envelope, Infinity, NaN, Infinity, false, out)).toBe(out);
        expect(Object.values(out).every(Number.isFinite)).toBe(true);
        const rects = [{
            left: 0, top: 0, right: 800, bottom: 600,
        }];
        const occupied = createBloodMoonMotionEnvelope(resolveBloodMoonLayout(800, 600, rects), 800, 600, rects);
        expect(sampleBloodMoonMotion(occupied, 10, 1, 1).radius).toBe(0);
    });
});
