/**
 * The shared mood clock (src/themes/shared/mood-clock.js): a theme's moods turn by the clock in
 * every mode, and a level is one step on top. Timings are read from the module, never copied.
 */

import { describe, expect, it } from 'vitest';
import {
    MOOD_HOLD, MOOD_SECONDS, easeStep, meltColour, meltPalettes, moodDrift, nearestStep, pingPong, wheelAt,
} from '../../src/themes/shared/mood-clock.js';

/** The middle of mood `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + MOOD_HOLD * 0.5) * MOOD_SECONDS;
const melting = (k) => (k + MOOD_HOLD + (1 - MOOD_HOLD) * 0.5) * MOOD_SECONDS;

describe('moodDrift', () => {
    it('rests on each mood, then melts half-way through its melt to half a step', () => {
        for (let k = 0; k < 6; k++) {
            expect(moodDrift(k * MOOD_SECONDS)).toBe(k);
            expect(moodDrift(resting(k))).toBe(k);
            expect(moodDrift((k + MOOD_HOLD) * MOOD_SECONDS)).toBeCloseTo(k, 9);
            expect(moodDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
    });

    it('never runs backward and never jumps, the seams between periods included', () => {
        let before = moodDrift(0);
        const dt = 0.05;
        // The steepest smoothstep gets is 1.5 of its mean slope over the melt.
        const steepest = (1.5 / ((1 - MOOD_HOLD) * MOOD_SECONDS)) * dt + 1e-9;
        for (let t = dt; t < MOOD_SECONDS * 7; t += dt) {
            const now = moodDrift(t);
            expect(now).toBeGreaterThanOrEqual(before);
            expect(now - before).toBeLessThanOrEqual(steepest);
            before = now;
        }
    });

    it('takes its own period and hold, and reads a broken clock as its start', () => {
        expect(moodDrift(40, 80, 0.5)).toBe(0);
        expect(moodDrift(60, 80, 0.5)).toBeCloseTo(0.5, 9);
        expect(moodDrift(80, 80, 0.5)).toBe(1);
        expect(moodDrift(Number.NaN)).toBe(0);
        expect(moodDrift(-30)).toBe(0);
        // A hold of the whole period steps without melting; no hold melts all the way.
        expect(moodDrift(150, 100, 1)).toBe(1);
        expect(moodDrift(50, 100, 0)).toBeCloseTo(0.5, 9);
    });
});

describe('the level step', () => {
    it('turns to a new mood the short way round', () => {
        expect(nearestStep(0, 4, 5)).toBe(-1);
        expect(nearestStep(3.6, 0, 5)).toBe(5);
        expect(nearestStep(2, 3, 5)).toBe(3);
    });

    it('eases toward the step, snaps on 1, and lands exactly once close', () => {
        expect(easeStep(0, 1, 1, 5)).toBe(1);
        const half = easeStep(0, 1, 0.5, 5);
        expect(half).toBeCloseTo(0.5, 12);
        let s = 0;
        for (let i = 0; i < 200; i++) s = easeStep(s, 1, 0.1, 5);
        expect(s).toBe(1);
        // From the last mood to the first is one step forward, not four back.
        expect(easeStep(4, 0, 0.5, 5)).toBeCloseTo(4.5, 12);
    });
});

describe('the wheel', () => {
    it('names the mood it is leaving, the next, and the melt, round and round', () => {
        expect(wheelAt(0, 5)).toEqual({ a: 0, b: 1, melt: 0 });
        expect(wheelAt(4.25, 5)).toEqual({ a: 4, b: 0, melt: 0.25 });
        expect(wheelAt(7.5, 5)).toEqual({ a: 2, b: 3, melt: 0.5 });
        expect(wheelAt(-0.5, 5)).toEqual({ a: 4, b: 0, melt: 0.5 });
    });

    it('walks there and back for a mood that is one axis', () => {
        expect(pingPong(0)).toBe(0);
        expect(pingPong(0.25)).toBe(0.25);
        expect(pingPong(1)).toBe(1);
        expect(pingPong(1.25)).toBe(0.75);
        expect(pingPong(2)).toBe(0);
        expect(pingPong(-0.25)).toBe(0.25);
    });
});

describe('melting palettes', () => {
    const PALETTES = [
        { sky: [0.5, 0.1, 0.9], glow: [1.0, 0.6, 0.2] }, // violet, amber
        { sky: [1.0, 0.7, 0.1], glow: [0.2, 0.6, 1.0] }, // amber, blue
        { sky: [0.3, 0.3, 0.3], glow: [0.1, 0.9, 0.4] }, // grey, green
    ];
    const KEYS = ['sky', 'glow'];

    it('is each palette exactly on a whole phase, round the wheel', () => {
        expect(meltPalettes(PALETTES, KEYS, 0)).toEqual({ sky: [0.5, 0.1, 0.9], glow: [1.0, 0.6, 0.2] });
        expect(meltPalettes(PALETTES, KEYS, 2).sky).toEqual([0.3, 0.3, 0.3]);
        expect(meltPalettes(PALETTES, KEYS, 3).glow).toEqual([1.0, 0.6, 0.2]);
    });

    it('melts the short way round the colour wheel, as vivid as its ends (never grey)', () => {
        const mid = meltPalettes(PALETTES, KEYS, 0.5);
        const [r, g, b] = mid.sky;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        // Violet to amber the short way passes through red-magenta, saturated.
        expect((max - min) / max).toBeGreaterThan(0.8);
        expect(r).toBeGreaterThan(g);
        // A straight mix would be [0.75, 0.4, 0.5]: far less saturated.
        expect((max - min) / max).toBeGreaterThan((0.75 - 0.4) / 0.75);
    });

    it('lets a grey take the hue of the colour it melts into', () => {
        const out = [0, 0, 0];
        meltColour([0.3, 0.3, 0.3], [0.5, 0.1, 0.9], 0.5, out);
        // Half-way between grey and violet: violet's hue, half its saturation.
        expect(out[2]).toBeGreaterThan(out[0]);
        expect(out[0]).toBeGreaterThan(out[1]);
    });

    it('stays continuous through a melt', () => {
        const out = {};
        let before = meltPalettes(PALETTES, KEYS, 0, {}).sky.slice();
        for (let p = 0.01; p <= 3; p += 0.01) {
            const now = meltPalettes(PALETTES, KEYS, p, out).sky;
            for (let c = 0; c < 3; c++) expect(Math.abs(now[c] - before[c])).toBeLessThan(0.08);
            before = now.slice();
        }
    });
});
