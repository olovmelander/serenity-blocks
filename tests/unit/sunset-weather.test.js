/**
 * Sunset — the weather's clock and the things that happen by themselves (no renderer).
 */
import { describe, expect, it } from 'vitest';
import {
    NowAndThen, SKIES, SKY_KEYS, SKY_PERIOD, SKY_REST, skyAt, skyDrift, skyPhaseOf,
} from '../../src/themes/sunset/sunset-weather.js';
import { DAY_SECONDS } from '../../src/themes/sunset/sunset-hours.js';

describe('sunset weather: the skies', () => {
    it('opens on the sky the theme ships: nothing added, nothing taken away', () => {
        const [trade] = SKIES;
        expect(trade.name).toBe('trade');
        expect(trade).toMatchObject({
            cover: 0, mackerel: 0, cirrus: 1, bars: 1, towers: 0, veil: 0, haze: 1, chop: 1,
        });
        expect(skyAt(0)).toMatchObject({ ...trade, mix: 0 });
    });

    it('names five weathers that differ where it shows', () => {
        expect(SKIES.map((sky) => sky.name)).toEqual(['trade', 'towers', 'mackerel', 'clear', 'veil']);
        SKIES.forEach((sky) => SKY_KEYS.forEach((key) => expect(Number.isFinite(sky[key])).toBe(true)));
        const by = Object.fromEntries(SKIES.map((sky) => [sky.name, sky]));
        expect(by.towers.towers).toBe(1);
        expect(by.mackerel.mackerel).toBe(1);
        expect(by.mackerel.cover).toBeGreaterThan(by.trade.cover);
        expect(by.clear.cover).toBeLessThan(by.towers.cover);
        expect(by.clear.haze).toBeGreaterThan(by.trade.haze);
        expect(by.clear.chop).toBeLessThan(by.trade.chop);
        expect(by.veil.veil).toBe(1);
        expect(by.veil.haze).toBeLessThan(by.trade.haze);
    });

    it('mixes two neighbours between them and comes round', () => {
        const half = skyAt(1.5);
        expect(half.towers).toBeCloseTo((SKIES[1].towers + SKIES[2].towers) / 2, 9);
        expect(half.mackerel).toBeCloseTo(0.5, 9);
        expect(skyAt(SKIES.length).name).toBe('trade');
        expect(skyAt(SKIES.length + 1.2).name).toBe('towers');
        expect(skyAt(-1).name).toBe('veil');
        expect(skyAt(Number.NaN).name).toBe('trade');
    });

    it('finds a weather by its name or a phase by its number', () => {
        expect(skyPhaseOf('veil')).toBe(4);
        expect(skyPhaseOf('2.5')).toBe(2.5);
        expect(skyPhaseOf(null)).toBeNull();
        expect(skyPhaseOf('')).toBeNull();
        expect(skyPhaseOf('drizzle')).toBeNull();
    });
});

describe('sunset weather: its clock', () => {
    it('rests on a weather, then melts into the next, and never runs back or jumps', () => {
        expect(skyDrift(0)).toBe(0);
        expect(skyDrift(SKY_PERIOD * SKY_REST * 0.99)).toBe(0);
        expect(skyDrift(SKY_PERIOD)).toBeCloseTo(1, 9);
        expect(skyDrift(SKY_PERIOD * 3)).toBeCloseTo(3, 9);
        let last = 0;
        for (let t = 0; t <= SKY_PERIOD * 6; t += 0.25) {
            const p = skyDrift(t);
            expect(p).toBeGreaterThanOrEqual(last);
            expect(p - last).toBeLessThan(0.03);
            last = p;
        }
        expect(skyDrift(-5)).toBe(0);
        expect(skyDrift(Number.NaN)).toBe(0);
    });

    it('keeps a pace of its own beside the day: the same hour meets another sky each time', () => {
        const round = SKIES.length * SKY_PERIOD;
        expect(round).not.toBe(DAY_SECONDS);
        // The weather a given hour of the day meets, day after day.
        const met = new Set();
        for (let day = 0; day < 8; day += 1) met.add(skyAt(skyDrift(day * DAY_SECONDS + 70)).name);
        expect(met.size).toBeGreaterThanOrEqual(4);
        // The two clocks are back in step only after more than an hour of play.
        let together = 0;
        for (let k = 1; k < 200 && !together; k += 1) {
            const drift = (k * DAY_SECONDS) % round;
            if (Math.min(drift, round - drift) < 1) together = k * DAY_SECONDS;
        }
        expect(together === 0 || together > 3600).toBe(true);
    });
});

describe('sunset weather: now and then', () => {
    it('deals each one a time from the seed, a gap after the one before', () => {
        const kind = new NowAndThen({ seed: 7, every: [10, 20], first: 5 });
        const times = [];
        for (let t = 0; t < 2000; t += 0.1) {
            if (kind.due(t) >= 0) times.push(t);
        }
        expect(times.length).toBeGreaterThan(90);
        expect(times[0]).toBeGreaterThanOrEqual(15);
        expect(times[0]).toBeLessThanOrEqual(25.2);
        for (let i = 1; i < times.length; i += 1) {
            expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(9.8);
            expect(times[i] - times[i - 1]).toBeLessThanOrEqual(20.2);
        }
    });

    it('is the same after a restart, and hands each one out once with a roll of its own', () => {
        const a = new NowAndThen({ seed: 11, every: [3, 9] });
        const b = new NowAndThen({ seed: 11, every: [3, 9] });
        const run = (kind) => {
            const out = [];
            for (let t = 0; t < 300; t += 0.05) {
                const n = kind.due(t);
                if (n >= 0) out.push([n, Math.round(t * 20), kind.roll]);
            }
            return out;
        };
        const first = run(a);
        expect(run(b)).toEqual(first);
        a.restart(0);
        expect(run(a)).toEqual(first);
        expect(first.map((row) => row[0])).toEqual(first.map((_, i) => i));
        first.forEach(([, , roll]) => {
            expect(roll).toBeGreaterThanOrEqual(0);
            expect(roll).toBeLessThan(1);
        });
    });

    it('catches up after a long jump without a burst', () => {
        const kind = new NowAndThen({ seed: 3, every: [2, 4] });
        expect(kind.due(1)).toBe(-1);
        // A minute passes in one step: one is handed out, and the next is still ahead.
        expect(kind.due(60)).toBeGreaterThanOrEqual(0);
        expect(kind.due(60)).toBe(-1);
        expect(kind.next).toBeGreaterThan(60);
        expect(kind.next).toBeLessThanOrEqual(64.01);
    });
});
