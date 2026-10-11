import { describe, expect, it } from 'vitest';
import {
    HOURS, HOUR_COLOURS, HOUR_REST, HOUR_SCALARS, HOUR_SECONDS, hourAt, hourMix, hourPlace, nearestTurn,
} from '../../src/themes/ocean/ocean-hours.js';
import { refractToAir, skyDirection } from '../../src/themes/ocean/ocean-core.js';

const DEG = Math.PI / 180;
const spread = (c) => Math.max(...c) - Math.min(...c);
const differs = (a, b) => HOUR_COLOURS.some((k) => a[k].some((v, i) => Math.abs(v - b[k][i]) > 1e-3));

describe('Ocean hours: six on a wheel', () => {
    it('writes every colour and every number out for every hour', () => {
        expect(HOURS).toHaveLength(6);
        HOURS.forEach((h) => {
            HOUR_COLOURS.forEach((k) => {
                expect(h[k]).toHaveLength(3);
                h[k].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
            });
            HOUR_SCALARS.forEach((k) => expect(Number.isFinite(h[k])).toBe(true));
        });
        expect(new Set(HOURS.map((h) => h.name)).size).toBe(6);
    });

    it('keeps the light inside the window at every hour, so its shafts come down from the frame', () => {
        HOURS.forEach((h) => {
            const sun = skyDirection(h.azimuth * DEG, h.elevation * DEG);
            expect(refractToAir(sun)[1]).toBeGreaterThan(0.05);
        });
    });

    it('rests on each hour\'s own colours at both ends of its turn', () => {
        expect(hourMix(2 + HOUR_REST * 0.5).mix).toBe(0);
        expect(hourMix(2 + 1 - HOUR_REST * 0.5).mix).toBe(1);
        expect(hourMix(2.5).mix).toBeCloseTo(0.5, 6);
        expect(hourMix(-1).from).toBe(5);
        expect(hourMix(Number.NaN).from).toBe(0);
    });

    it('never crosses through grey: the half-way water between neighbours still has its colour', () => {
        for (let i = 0; i < HOURS.length; i++) {
            const mid = hourAt(i + 0.5);
            ['shallow', 'deep'].forEach((k) => {
                const ends = Math.min(spread(HOURS[i][k]), spread(HOURS[(i + 1) % 6][k]));
                expect(spread(mid[k])).toBeGreaterThan(ends * 0.5);
            });
        }
    });
});

describe('Ocean hours: the clock turns them as well as the level', () => {
    it('moves the light on by itself within the first minute, at a fixed level', () => {
        expect(differs(hourAt(hourPlace(0, 0)), hourAt(hourPlace(0, 60)))).toBe(true);
    });

    it('stands on the next hour one hour of the clock later, whatever the level', () => {
        for (let level = 1; level <= 6; level++) {
            const at = hourAt(hourPlace(level - 1, HOUR_SECONDS));
            expect(at.name).toBe(HOURS[level % 6].name);
            expect(at.mix).toBe(0);
        }
    });

    it('is on its way to the next for most of every hour (no hold-then-turn)', () => {
        let moving = 0;
        const steps = 100;
        for (let i = 0; i < steps; i++) {
            const m = hourMix(i / steps).mix;
            if (m > 0 && m < 1) moving += 1;
        }
        expect(moving / steps).toBeGreaterThan(0.65);
    });

    it('adds a level\'s step to the clock\'s drift, and holds the level when told not to drift', () => {
        expect(hourPlace(3, 50)).toBeCloseTo(3.5, 6);
        expect(hourPlace(3, 50, false)).toBe(3);
        expect(hourPlace(0, -10)).toBe(0);
    });

    it('turns the short way round the wheel', () => {
        expect(nearestTurn(0, 2)).toBe(1);
        expect(nearestTurn(5, 1)).toBe(6);
        expect(nearestTurn(0.4, 6)).toBe(-1);
        expect(nearestTurn(0, 'x')).toBe(0);
    });
});
