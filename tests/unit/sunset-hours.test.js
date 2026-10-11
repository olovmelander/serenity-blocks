/**
 * Sunset — the hours: the wheel of light the sea is seen in, and how the clock and the levels
 * move round it. The clock alone must move it (every mode, the ones that never level included);
 * a level adds a whole hour on top.
 */
import { describe, expect, it } from 'vitest';
import {
    HOURS, HOUR_COLOURS, HOUR_REST, HOUR_SCALARS, HOUR_SECONDS, HOUR_TURNS, TURN_SECONDS, hourAt, hourMix, levelPlace,
    restPlace, turnSeconds,
} from '../../src/themes/sunset/sunset-hours.js';
import { turnHeight } from '../../src/themes/sunset/sunset-core.js';

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c) => Math.max(...c) - Math.min(...c);

describe('sunset hours: the wheel', () => {
    it('names six hours in the order a day runs from golden hour', () => {
        expect(HOURS.map((h) => h.name)).toEqual(['golden', 'sunset', 'afterglow', 'night', 'dawn', 'day']);
    });

    it('gives every hour every colour, number and turn the shaders read', () => {
        HOURS.forEach((h) => {
            HOUR_COLOURS.forEach((key) => {
                expect(h[key], `${h.name}.${key}`).toHaveLength(3);
                h[key].forEach((v) => expect(Number.isFinite(v) && v >= 0, `${h.name}.${key}`).toBe(true));
            });
            [...HOUR_SCALARS, ...HOUR_TURNS].forEach((key) => {
                expect(Number.isFinite(h[key]), `${h.name}.${key}`).toBe(true);
            });
        });
    });

    it('puts the sun on the sea at sunset, under it in the afterglow and at night, and over the eye by day', () => {
        const at = (name, key) => turnHeight(HOURS.find((h) => h.name === name)[key]);
        expect(at('golden', 'sunTurn')).toBeGreaterThan(5);
        expect(Math.abs(at('sunset', 'sunTurn'))).toBeLessThan(2.5);
        expect(at('afterglow', 'sunTurn')).toBeLessThan(0);
        expect(at('night', 'sunTurn')).toBeLessThan(-10);
        expect(at('day', 'sunTurn')).toBeGreaterThan(25);
        // The moon rides the night sky and is setting at first light.
        expect(at('night', 'moonTurn')).toBeGreaterThan(8);
        expect(at('dawn', 'moonTurn')).toBeGreaterThan(0);
        expect(at('dawn', 'moonTurn')).toBeLessThan(at('night', 'moonTurn'));
    });

    it('carries the sun and the moon round one way only, under the world and over the eye', () => {
        let lastSun = Infinity;
        let lastMoon = Infinity;
        for (let p = 0; p <= HOURS.length * 2; p += 0.05) {
            const light = hourAt(p);
            // Unwrap whole turns: a turn on the wheel is a whole turn of the sky.
            const lap = Math.floor(p / HOURS.length) * 360;
            const sun = light.sunTurn - lap;
            const moon = light.moonTurn - lap;
            expect(sun).toBeLessThanOrEqual(lastSun + 1e-9);
            expect(moon).toBeLessThanOrEqual(lastMoon + 1e-9);
            lastSun = sun;
            lastMoon = moon;
        }
    });

    it('never mixes two neighbouring hours through grey', () => {
        for (let i = 0; i < HOURS.length; i += 1) {
            for (let s = 0; s <= 1; s += 0.1) {
                const light = hourAt(i + 0.15 + s * 0.7);
                // The horizon, toward the sun and away from it, keeps a colour of its own across
                // every crossing: a straight mix of two opposite hues would pass through grey.
                ['horizonSun', 'horizonFar'].forEach((key) => {
                    const c = light[key];
                    expect(chroma(c) / Math.max(1e-3, Math.max(...c)), `${light.name} ${key} ${s.toFixed(1)}`)
                        .toBeGreaterThan(0.2);
                });
            }
        }
    });

    it('is darkest at night and keeps the night readable', () => {
        const night = HOURS.find((h) => h.name === 'night');
        HOURS.filter((h) => h !== night).forEach((h) => {
            expect(luma(h.zenithFar)).toBeGreaterThan(luma(night.zenithFar));
        });
        expect(luma(night.horizonSun)).toBeGreaterThan(0.03);
        expect(night.stars).toBe(1);
    });
});

describe('sunset hours: the clock and the levels', () => {
    it('rests on an hour for a short share at each end and is on its way in between', () => {
        expect(HOUR_REST).toBeGreaterThan(0);
        expect(HOUR_REST).toBeLessThanOrEqual(0.15);
        expect(hourMix(1 + HOUR_REST * 0.5).mix).toBe(0);
        expect(hourMix(2 - HOUR_REST * 0.5).mix).toBe(1);
        expect(hourMix(1.5).mix).toBeCloseTo(0.5, 5);
    });

    it('moves the light with the clock alone: within the first minute, a whole hour in HOUR_SECONDS', () => {
        expect(HOUR_SECONDS).toBeGreaterThanOrEqual(80);
        expect(HOUR_SECONDS).toBeLessThanOrEqual(120);
        const start = hourAt(0 / HOUR_SECONDS);
        const minute = hourAt(60 / HOUR_SECONDS);
        expect(minute.mix).toBeGreaterThan(0.3);
        expect(minute.horizonSun).not.toEqual(start.horizonSun);
        const next = hourAt(HOUR_SECONDS / HOUR_SECONDS);
        expect(next.name).toBe('sunset');
        // Round the whole wheel and back to golden hour.
        expect(hourAt((HOURS.length * HOUR_SECONDS) / HOUR_SECONDS).name).toBe('golden');
    });

    it('adds a level as one whole hour on top of the clock, eased', () => {
        const clock = 30;
        const before = 0 + clock / HOUR_SECONDS;
        const after = levelPlace(0, 1, TURN_SECONDS * 2) + clock / HOUR_SECONDS;
        expect(after - before).toBeCloseTo(1, 6);
        const midway = levelPlace(0, 1, TURN_SECONDS / 2);
        expect(midway).toBeGreaterThan(0.2);
        expect(midway).toBeLessThan(0.8);
        expect(levelPlace(0, 1, 0)).toBe(0);
        expect(turnSeconds(4)).toBeGreaterThan(turnSeconds(1));
    });

    it('takes a new run forward round the wheel to golden hour, never back', () => {
        [0, 0.4, 1, 2.6, 5.9, 6, 7.3, 13].forEach((place) => {
            const from = restPlace(place);
            expect(from, `from ${place}`).toBeLessThanOrEqual(1e-9);
            expect(from, `from ${place}`).toBeGreaterThan(-HOURS.length - 1e-9);
            // The same hour, seen one turn of the wheel earlier.
            expect(hourAt(from).name).toBe(hourAt(place).name);
        });
    });
});
