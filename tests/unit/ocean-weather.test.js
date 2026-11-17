/**
 * Ocean — the sea's own weather (ocean-weather.js): the wheel of sea states, the clouds over the
 * sun and the small happenings, all pure functions of a clock and a seed.
 */
import { describe, expect, it } from 'vitest';
import {
    HAPPENINGS, HAPPEN_SLOT, SEA_REST, SEA_SCALARS, SEA_SECONDS, SEA_STATES, cloudShadow, happenSlot, happeningAt,
    seaAt, seaPlace, sunGain,
} from '../../src/themes/ocean/ocean-weather.js';
import { HOUR_SECONDS, HOURS } from '../../src/themes/ocean/ocean-hours.js';

describe('Ocean weather: the sea states', () => {
    it('names six states, each with every number a state sets, within what the shaders can take', () => {
        expect(SEA_STATES.length).toBe(6);
        expect(new Set(SEA_STATES.map((s) => s.name)).size).toBe(SEA_STATES.length);
        SEA_STATES.forEach((s) => {
            SEA_SCALARS.forEach((key) => expect(Number.isFinite(s[key]), `${s.name}.${key}`).toBe(true));
            expect(s.swell).toBeGreaterThan(0.3);
            expect(s.swell).toBeLessThan(2);
            // (The water's clearing is a share of its extinction: it must never reach 1 / 0.55.)
            expect(Math.abs(s.clarity)).toBeLessThanOrEqual(0.6);
            expect(s.sun).toBeGreaterThan(0.3);
            expect(s.rain).toBeGreaterThanOrEqual(0);
            expect(s.rain).toBeLessThanOrEqual(1);
        });
        // The reef's own weather is the first: a capture at a low clock sees the sea as it always was.
        expect(SEA_STATES[0]).toMatchObject({
            name: 'trade', swell: 1, chop: 1, clarity: 0, shafts: 1, motes: 1, rain: 0, sun: 1,
        });
    });

    it('rests on a state at each end of its turn and crosses to the next between, round the wheel', () => {
        const at = seaAt(0.1);
        expect(at.name).toBe('trade');
        expect(at.mix).toBe(0);
        expect(at.swell).toBe(SEA_STATES[0].swell);
        const resting = seaAt(1 - SEA_REST * 0.5);
        expect(resting.mix).toBe(1);
        expect(resting.swell).toBeCloseTo(SEA_STATES[1].swell, 9);
        const half = seaAt(0.5);
        expect(half.swell).toBeCloseTo((SEA_STATES[0].swell + SEA_STATES[1].swell) / 2, 6);
        // Past the last state the wheel comes round to the first, and a negative place wraps too.
        expect(seaAt(SEA_STATES.length + 0.1).name).toBe('trade');
        expect(seaAt(-0.9).name).toBe(seaAt(SEA_STATES.length - 0.9).name);
        expect(seaAt(Number.NaN).name).toBe('trade');
    });

    it('never jumps: a small step of the clock is a small step of every number', () => {
        const steps = [];
        for (let t = 0; t < SEA_SECONDS * SEA_STATES.length; t += 0.5) steps.push(seaAt(seaPlace(t), {}));
        steps.slice(1).forEach((now, i) => {
            SEA_SCALARS.forEach((key) => {
                expect(Math.abs(now[key] - steps[i][key]), `${key} at step ${i}`).toBeLessThan(0.06);
            });
        });
    });

    it('turns on a clock of its own: the hour and the weather do not line up again for a long while', () => {
        const hourWheel = HOUR_SECONDS * HOURS.length;
        const seaWheel = SEA_SECONDS * SEA_STATES.length;
        // Neither wheel's turn is a small multiple of the other's.
        for (let k = 1; k <= 6; k += 1) {
            expect(Math.abs((hourWheel * k) % seaWheel)).toBeGreaterThan(20);
            expect(Math.abs((seaWheel * k) % hourWheel)).toBeGreaterThan(20);
        }
    });

    it('starts a capture on the trade wind and every other session somewhere of its own', () => {
        expect(seaPlace(0, 1)).toBe(0);
        expect(seaPlace(SEA_SECONDS, 1)).toBeCloseTo(1, 9);
        const starts = new Set([2, 3, 4, 5, 6, 7, 8].map((seed) => Math.floor(seaPlace(0, seed))));
        expect(starts.size).toBeGreaterThan(2);
        expect(seaPlace(-5, 1)).toBe(0);
    });
});

describe('Ocean weather: the clouds', () => {
    it('keeps the sun between about half and a little over one, and steady under a clear sky', () => {
        let low = Infinity;
        let high = -Infinity;
        let dimmed = 0;
        let n = 0;
        for (let t = 0; t < 900; t += 0.25) {
            const shadow = cloudShadow(t, 1);
            expect(shadow).toBeGreaterThanOrEqual(0);
            expect(shadow).toBeLessThanOrEqual(1);
            const gain = sunGain(t, 1, 1);
            low = Math.min(low, gain);
            high = Math.max(high, gain);
            if (gain < 0.8) dimmed += 1;
            n += 1;
            expect(sunGain(t, 0, 1)).toBe(1);
        }
        expect(low).toBeGreaterThan(0.45);
        expect(low).toBeLessThan(0.7);
        expect(high).toBeLessThan(1.35);
        // Shadows cross, they do not sit: the sun is out most of the time even under a full sky.
        expect(dimmed / n).toBeGreaterThan(0.05);
        expect(dimmed / n).toBeLessThan(0.6);
    });

    it('is one sky per seed, and moves smoothly', () => {
        expect(sunGain(123.4, 0.7, 5)).toBe(sunGain(123.4, 0.7, 5));
        let differs = false;
        for (let t = 0; t < 200; t += 1) if (Math.abs(cloudShadow(t, 1) - cloudShadow(t, 9)) > 0.2) differs = true;
        expect(differs).toBe(true);
        for (let t = 0; t < 300; t += 1 / 30) {
            expect(Math.abs(sunGain(t + 1 / 30, 1, 1) - sunGain(t, 1, 1))).toBeLessThan(0.02);
        }
    });
});

describe('Ocean weather: the happenings', () => {
    it('deals one to a slot, somewhere inside it, the same again for the same seed', () => {
        const kinds = new Set();
        for (let slot = 0; slot < 300; slot += 1) {
            const h = happeningAt(slot, 1);
            expect(h.at).toBeGreaterThan(slot * HAPPEN_SLOT);
            expect(h.at).toBeLessThan((slot + 1) * HAPPEN_SLOT);
            expect(happenSlot(h.at)).toBe(slot);
            expect(h.a).toBeGreaterThanOrEqual(0);
            expect(h.a).toBeLessThan(1);
            kinds.add(h.kind);
            expect(happeningAt(slot, 1)).toEqual(h);
        }
        expect([...kinds].sort()).toEqual(HAPPENINGS.map((h) => h[0]).sort());
        expect(happeningAt(3, 1).at).not.toBe(happeningAt(3, 2).at);
        expect(happenSlot(-4)).toBe(0);
    });
});
