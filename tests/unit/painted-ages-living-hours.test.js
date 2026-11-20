/**
 * Painted Ages — the hours' sweep (painted-ages-hours.js, three-free): what lets a perfect clear
 * wheel a whole day round in seconds. By the clock the light RESTS on each hour and then melts
 * on; swept, it runs evenly through the hours so the sun never stops and starts on its way round.
 */
import { describe, expect, it } from 'vitest';
import {
    HOURS, HOUR_COUNT, hourMix, lightAt,
} from '../../src/themes/painted-ages/painted-ages-hours.js';
import { TIMING } from '../../src/themes/painted-ages/painted-ages-core.js';

const COLOURS = [
    'sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'snow',
];
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const sameDirection = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** A copy of a light's numbers (lightAt writes into the object it is handed). */
const lightOf = (place, sweep) => structuredClone(lightAt(place, undefined, sweep));

describe('Painted Ages hours: the sweep of a wheeling day', () => {
    it('without a sweep rests on each hour at both ends of its step', () => {
        const rest = TIMING.hourRest;
        expect(rest).toBeGreaterThan(0);
        for (let hour = 0; hour < HOUR_COUNT * 2; hour += 1) {
            for (const share of [0, 0.3, 0.9]) {
                expect(hourMix(hour + share * rest).mix, `hour ${hour}, into its rest`).toBe(0);
                expect(hourMix(hour + 1 - share * rest - 1e-9).mix, `hour ${hour}, before the next`).toBe(1);
            }
            expect(hourMix(hour + 0.5)).toEqual(hourMix(hour + 0.5, 0));
        }
    });

    it('at full sweep runs evenly through the hour: no rest, the mix is the place\'s own fraction', () => {
        for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
            let last = -1;
            for (let f = 0; f < 1; f += 0.01) {
                const { from, to, mix } = hourMix(hour + f, 1);
                expect(from).toBe(hour);
                expect(to).toBe((hour + 1) % HOUR_COUNT);
                expect(mix).toBeCloseTo(f, 12);
                expect(mix).toBeGreaterThan(last);
                last = mix;
            }
        }
    });

    it('in between lies between the rested mix and the even one, nearer the even one the fuller the sweep', () => {
        for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
            const rested = hourMix(2 + f).mix;
            let last = rested;
            for (const sweep of [0.1, 0.35, 0.7, 1]) {
                const { mix } = hourMix(2 + f, sweep);
                expect(mix).toBeGreaterThanOrEqual(Math.min(rested, f) - 1e-12);
                expect(mix).toBeLessThanOrEqual(Math.max(rested, f) + 1e-12);
                expect(Math.abs(mix - f)).toBeLessThanOrEqual(Math.abs(last - f) + 1e-12);
                last = mix;
            }
        }
    });

    it('takes a sweep that is no share for the nearest one: none below 0 or for NaN, full above 1', () => {
        for (const place of [0.3, 2.5, 4.71]) {
            expect(hourMix(place, -1)).toEqual(hourMix(place));
            expect(hourMix(place, Number.NaN)).toEqual(hourMix(place));
            expect(hourMix(place, 7)).toEqual(hourMix(place, 1));
            const light = lightAt(place, undefined, Number.NaN);
            expect(Number.isFinite(light.el) && Number.isFinite(light.sunUp)).toBe(true);
        }
    });

    it('is the hour itself at a whole place whatever the sweep, and the same light a whole turn on', () => {
        for (const sweep of [0, 0.4, 1]) {
            for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
                const light = lightOf(hour, sweep);
                for (const key of COLOURS) expect(light[key], `${key} at hour ${hour}`).toEqual(HOURS[hour][key]);
                expect(light.el).toBe(HOURS[hour].el);
                expect(light.exposure).toBe(HOURS[hour].exposure);
            }
            // A day wheeled round leaves nothing to undo: the place one turn on shows the same light.
            for (const place of [0, 0.25, 1.5, 3.99, 5.6]) {
                const here = lightOf(place, sweep);
                const turned = lightOf(place + HOUR_COUNT, sweep);
                for (const key of [...COLOURS, 'dir']) {
                    here[key].forEach((v, i) => expect(turned[key][i], `${key}[${i}] at ${place}`).toBeCloseTo(v, 9));
                }
                for (const key of ['el', 'sunUp', 'exposure', 'stars', 'hazeDensity', 'mistDensity']) {
                    expect(turned[key], `${key} at ${place}`).toBeCloseTo(here[key], 9);
                }
            }
        }
    });

    it('never jumps the sun: round the whole day, at any sweep, a small step in place moves it a little', () => {
        for (const sweep of [0, 0.5, 1]) {
            let last = lightOf(0, sweep);
            let largest = 0;
            let low = 1;
            for (let place = 0.001; place <= HOUR_COUNT + 0.001; place += 0.001) {
                const light = lightOf(place, sweep);
                expect(Math.hypot(...light.dir)).toBeCloseTo(1, 12);
                largest = Math.max(largest, angleBetween(light.dir, last.dir));
                low = Math.min(low, light.sunUp);
                last = light;
            }
            // A thousandth of an hour: the sun moves a fraction of a degree, never across the sky.
            expect(largest, `sweep ${sweep}`).toBeLessThan(0.01);
            expect(largest, `sweep ${sweep}`).toBeGreaterThan(0);
            // The day has its night: the sun does go under.
            expect(low, `sweep ${sweep}`).toBe(0);
        }
    });

    it('swept, keeps the sun moving through every hour (rested, it stands still at each)', () => {
        const stillShare = (sweep) => {
            let still = 0;
            let last = lightOf(0, sweep);
            const steps = 6000;
            for (let i = 1; i <= steps; i += 1) {
                const light = lightOf((i / steps) * HOUR_COUNT, sweep);
                if (sameDirection(light.dir, last.dir)) still += 1 / steps;
                last = light;
            }
            return still;
        };
        expect(stillShare(1)).toBe(0);
        // Rested: about twice the rest of every hour is spent standing.
        expect(stillShare(0)).toBeGreaterThan(TIMING.hourRest);
    });
});
