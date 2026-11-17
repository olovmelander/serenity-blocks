import { describe, expect, it } from 'vitest';
import { SUMMER_HOUR_SECONDS } from '../../src/themes/summer/summer-hours.js';
import { SUMMER_BREEZE } from '../../src/themes/summer/summer-light.js';
import {
    SUMMER_WEATHER_HOLD, SUMMER_WEATHER_SCALARS, SUMMER_WEATHER_SECONDS, SUMMER_WEATHERS, createSummerWeatherState,
    nearestSummerWeather, summerWeatherAt, summerWeatherPhase, wrapSummerWeather,
} from '../../src/themes/summer/summer-weather.js';

const COUNT = SUMMER_WEATHERS.length;
const byId = (id) => SUMMER_WEATHERS.find((weather) => weather.id === id);
/** Shares of something: how much of the sky a cloud layer covers, how much mist, rain, shade or veil. */
const SHARES = ['low', 'tall', 'mid', 'deck', 'mackerel', 'cirrus', 'mist', 'rain', 'shade', 'veil', 'rays'];
/** Factors against the evening as it was built: 1 is that evening. */
const FACTORS = ['drift', 'ruffle', 'haze', 'shafts'];
/** The weather a moment before a whole phase: the turn into the next is all but done. */
const ALMOST = 1 - 1e-9;

describe('Summer weather', () => {
    describe('the table', () => {
        it('names six weathers in the order they come round, fair first', () => {
            expect(SUMMER_WEATHERS.map((weather) => weather.id))
                .toEqual(['fair', 'breeze', 'towers', 'shower', 'mist', 'still']);
            expect(new Set(SUMMER_WEATHERS.map((weather) => weather.id)).size).toBe(COUNT);
            expect(new Set(SUMMER_WEATHERS.map((weather) => weather.name)).size).toBe(COUNT);
            expect(Object.isFrozen(SUMMER_WEATHERS)).toBe(true);
            for (const weather of SUMMER_WEATHERS) {
                expect(Object.isFrozen(weather), weather.id).toBe(true);
                expect(typeof weather.name === 'string' && weather.name.length > 0, weather.id).toBe(true);
            }
        });

        it('gives every weather every scalar, finite and in a sane range for what it means', () => {
            expect(Object.isFrozen(SUMMER_WEATHER_SCALARS)).toBe(true);
            expect(new Set(SUMMER_WEATHER_SCALARS).size).toBe(SUMMER_WEATHER_SCALARS.length);
            // Every scalar is one this file knows the meaning of.
            expect([...SUMMER_WEATHER_SCALARS].sort()).toEqual([...SHARES, ...FACTORS, 'wind'].sort());
            for (const weather of SUMMER_WEATHERS) {
                expect(Object.keys(weather).sort(), weather.id)
                    .toEqual(['id', 'name', ...SUMMER_WEATHER_SCALARS].sort());
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(Number.isFinite(weather[key]), `${weather.id}.${key}`).toBe(true);
                }
                for (const key of SHARES) {
                    expect(weather[key], `${weather.id}.${key}`).toBeGreaterThanOrEqual(0);
                    expect(weather[key], `${weather.id}.${key}`).toBeLessThanOrEqual(1);
                }
                // Never nothing (a factor of zero would stop the clouds or empty the air), never absurd.
                for (const key of FACTORS) {
                    expect(weather[key], `${weather.id}.${key}`).toBeGreaterThan(0.1);
                    expect(weather[key], `${weather.id}.${key}`).toBeLessThanOrEqual(3);
                }
                // The breeze at rest: from a lake like glass to a fresh wind, never a gale.
                expect(weather.wind, weather.id).toBeGreaterThan(0);
                expect(weather.wind, weather.id).toBeLessThan(1);
            }
        });

        // Fair weather is the scene as it was built and reviewed, and where every session starts.
        it('keeps the fair evening exactly as the scene was built', () => {
            const [fair] = SUMMER_WEATHERS;
            expect(fair.id).toBe('fair');
            expect(fair).toMatchObject({
                wind: 0.3, drift: 1, ruffle: 1, mist: 0, haze: 1, rain: 0, veil: 0, shafts: 1,
            });
            // The breeze the light rig has always rested at.
            expect(fair.wind).toBe(SUMMER_BREEZE);
            // Scattered cumulus, no mackerel field.
            expect(fair.low).toBeGreaterThan(0);
            expect(fair.mackerel).toBe(0);
        });

        it('lets it rain in the sun shower only, and the mist rise after it', () => {
            expect(SUMMER_WEATHERS.filter((weather) => weather.rain > 0).map((weather) => weather.id))
                .toEqual(['shower']);
            const shower = byId('shower');
            expect(shower.rain).toBe(1);
            // The weather that follows the rain is the mistiest of all, and the air stands still in it.
            const after = SUMMER_WEATHERS[(SUMMER_WEATHERS.indexOf(shower) + 1) % COUNT];
            expect(after.id).toBe('mist');
            expect(after.mist).toBe(Math.max(...SUMMER_WEATHERS.map((weather) => weather.mist)));
            expect(after.mist).toBeGreaterThan(shower.mist);
            expect(after.wind).toBeLessThan(shower.wind);
            expect(after.shafts).toBe(Math.max(...SUMMER_WEATHERS.map((weather) => weather.shafts)));
        });

        it('makes each weather what its name says', () => {
            const most = (key) => [...SUMMER_WEATHERS].sort((a, b) => b[key] - a[key])[0].id;
            const least = (key) => [...SUMMER_WEATHERS].sort((a, b) => a[key] - b[key])[0].id;
            const fair = byId('fair');
            // The breeze blows hardest, hurries the clouds and ruffles the lake most, and clears the air.
            for (const key of ['wind', 'drift', 'ruffle']) expect(most(key), key).toBe('breeze');
            expect(least('haze')).toBe('breeze');
            // The towers stand tallest, and the sun fans out between them.
            expect(most('tall')).toBe('towers');
            expect(byId('towers').rays).toBeGreaterThan(fair.rays);
            // The sun shower is the most overcast, with the sun fanning out through it.
            expect(most('low')).toBe('shower');
            expect(byId('shower').rays).toBeGreaterThan(fair.rays);
            // After the rain and under the mackerel sky the air stands still and the lake lies flat.
            for (const id of ['mist', 'still']) {
                for (const key of ['wind', 'drift', 'ruffle']) {
                    expect(byId(id)[key], `${id}.${key}`).toBeLessThan(fair[key]);
                }
            }
            // The mackerel sky has the mackerel field, over a lake like glass.
            expect(most('mackerel')).toBe('still');
            expect(least('ruffle')).toBe('still');
        });

        it('makes each weather a different picture from its neighbours', () => {
            SUMMER_WEATHERS.forEach((weather, index) => {
                const next = SUMMER_WEATHERS[(index + 1) % COUNT];
                const apart = Math.hypot(...SUMMER_WEATHER_SCALARS.map((key) => weather[key] - next[key]));
                expect(apart, `${weather.id} to ${next.id}`).toBeGreaterThan(0.4);
            });
        });

        it('lasts a little over a minute, holds before it turns, and keeps its own clock beside the hours', () => {
            expect(SUMMER_WEATHER_SECONDS).toBeGreaterThan(60);
            expect(SUMMER_WEATHER_SECONDS).toBeLessThan(120);
            // Seen as itself for a good while, and still left time to turn without a lurch.
            expect(SUMMER_WEATHER_HOLD).toBeGreaterThan(0.25);
            expect(SUMMER_WEATHER_HOLD).toBeLessThan(0.75);
            expect((1 - SUMMER_WEATHER_HOLD) * SUMMER_WEATHER_SECONDS).toBeGreaterThan(15);
            // The two clocks never line up for long: an hour of the night is no whole number of weathers.
            expect(Number.isInteger(SUMMER_HOUR_SECONDS / SUMMER_WEATHER_SECONDS)).toBe(false);
            expect(Number.isInteger(SUMMER_WEATHER_SECONDS / SUMMER_HOUR_SECONDS)).toBe(false);
        });
    });

    describe('the wheel', () => {
        it('folds any phase onto the wheel of weathers', () => {
            expect(wrapSummerWeather(0)).toBe(0);
            expect(wrapSummerWeather(COUNT)).toBe(0);
            expect(wrapSummerWeather(COUNT * 7)).toBe(0);
            expect(wrapSummerWeather(COUNT + 1.25)).toBeCloseTo(1.25, 12);
            expect(wrapSummerWeather(-0.5)).toBeCloseTo(COUNT - 0.5, 12);
            expect(wrapSummerWeather(-COUNT * 3)).toBe(0);
            expect(wrapSummerWeather(-COUNT - 2)).toBeCloseTo(COUNT - 2, 12);
            for (const phase of [NaN, Infinity, -Infinity, undefined, null, 'rain', {}, []]) {
                expect(wrapSummerWeather(phase), String(phase)).toBe(0);
            }
            for (let phase = -14; phase < 14; phase += 0.37) {
                const wrapped = wrapSummerWeather(phase);
                expect(wrapped).toBeGreaterThanOrEqual(0);
                expect(wrapped).toBeLessThan(COUNT);
            }
        });

        it('stands at fair when the clock starts, one weather on after each period, and comes round', () => {
            expect(summerWeatherPhase(0)).toBe(0);
            expect(summerWeatherPhase(SUMMER_WEATHER_SECONDS)).toBe(1);
            expect(summerWeatherPhase(SUMMER_WEATHER_SECONDS / 2)).toBeCloseTo(0.5, 12);
            expect(summerWeatherPhase(SUMMER_WEATHER_SECONDS * 3.25)).toBeCloseTo(3.25, 12);
            expect(summerWeatherPhase(SUMMER_WEATHER_SECONDS * COUNT)).toBe(0);
            expect(summerWeatherPhase(SUMMER_WEATHER_SECONDS * (COUNT * 4 + 2))).toBeCloseTo(2, 9);
            // It only ever moves forward, a weather a period.
            let previous = -1;
            for (let seconds = 0; seconds < SUMMER_WEATHER_SECONDS * COUNT - 1; seconds += 7.3) {
                const phase = summerWeatherPhase(seconds);
                expect(phase).toBeGreaterThan(previous);
                expect(phase).toBeCloseTo(seconds / SUMMER_WEATHER_SECONDS, 9);
                previous = phase;
            }
        });

        it('holds the fair evening before the clock starts and for a clock that is not a number', () => {
            for (const seconds of [-1, -1e9, -Infinity, NaN, Infinity, undefined, null, 'soon', {}]) {
                expect(summerWeatherPhase(seconds), String(seconds)).toBe(0);
            }
            // A period of its own for whoever asks; one that is no length of time stops the wheel at fair.
            expect(summerWeatherPhase(30, 20)).toBeCloseTo(1.5, 12);
            expect(summerWeatherPhase(20 * COUNT + 5, 20)).toBeCloseTo(0.25, 12);
            for (const period of [0, -5, NaN, -Infinity, null, 'long']) {
                expect(summerWeatherPhase(100, period), String(period)).toBe(0);
            }
            // No period given is the weather's own.
            expect(summerWeatherPhase(100, undefined)).toBe(summerWeatherPhase(100));
        });
    });

    describe('one weather turning into the next', () => {
        it('is a weather of the table exactly at a whole phase', () => {
            SUMMER_WEATHERS.forEach((weather, index) => {
                for (const phase of [index, index + COUNT, index - COUNT * 2]) {
                    const state = summerWeatherAt(phase);
                    expect(state.phase).toBe(index);
                    for (const key of SUMMER_WEATHER_SCALARS) {
                        expect(state[key], `${weather.id}.${key}`).toBe(weather[key]);
                    }
                }
            });
        });

        it('holds each weather as itself for the first part of its time', () => {
            SUMMER_WEATHERS.forEach((weather, index) => {
                for (const share of [0, 0.01, 0.2, 0.4, SUMMER_WEATHER_HOLD - 1e-6]) {
                    const state = summerWeatherAt(index + share);
                    for (const key of SUMMER_WEATHER_SCALARS) {
                        expect(state[key], `${weather.id}.${key} at ${share}`).toBe(weather[key]);
                    }
                    expect(state.phase).toBeCloseTo(index + share, 9);
                }
                // Once the hold is over it has begun to turn.
                const next = SUMMER_WEATHERS[(index + 1) % COUNT];
                const turning = summerWeatherAt(index + SUMMER_WEATHER_HOLD + (1 - SUMMER_WEATHER_HOLD) * 0.25);
                const moved = SUMMER_WEATHER_SCALARS.filter((key) => next[key] !== weather[key]);
                expect(moved.length, weather.id).toBeGreaterThan(3);
                for (const key of moved) expect(turning[key], `${weather.id}.${key}`).not.toBe(weather[key]);
            });
        });

        it('eases into the next weather: between the two all the way, half way at the middle of the turn', () => {
            SUMMER_WEATHERS.forEach((from, index) => {
                const to = SUMMER_WEATHERS[(index + 1) % COUNT];
                const turn = (share) => index + SUMMER_WEATHER_HOLD + (1 - SUMMER_WEATHER_HOLD) * share;
                let previous = summerWeatherAt(turn(0));
                for (const share of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, ALMOST]) {
                    const state = summerWeatherAt(turn(share));
                    for (const key of SUMMER_WEATHER_SCALARS) {
                        const [low, high] = [Math.min(from[key], to[key]), Math.max(from[key], to[key])];
                        const label = `${from.id}+${share} ${key}`;
                        expect(state[key] >= low - 1e-12 && state[key] <= high + 1e-12, label).toBe(true);
                        // Always on toward the next, never back.
                        expect(Math.abs(state[key] - to[key]), label)
                            .toBeLessThanOrEqual(Math.abs(previous[key] - to[key]) + 1e-12);
                    }
                    previous = { ...state };
                }
                const half = summerWeatherAt(turn(0.5));
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(half[key], `${from.id} ${key}`).toBeCloseTo((from[key] + to[key]) / 2, 12);
                }
                // It sets out and arrives gently: a tenth of the way through the turn, far less than
                // a tenth of the change has happened, and the same at the far end.
                const early = summerWeatherAt(turn(0.1));
                const late = summerWeatherAt(turn(0.9));
                for (const key of SUMMER_WEATHER_SCALARS.filter((name) => to[name] !== from[name])) {
                    const done = (state) => (state[key] - from[key]) / (to[key] - from[key]);
                    expect(done(early), `${from.id} ${key}`).toBeGreaterThan(0);
                    expect(done(early), `${from.id} ${key}`).toBeLessThan(0.05);
                    expect(done(late), `${from.id} ${key}`).toBeGreaterThan(0.95);
                    expect(done(late), `${from.id} ${key}`).toBeLessThan(1);
                }
            });
        });

        it('has become the next weather when its time is up', () => {
            SUMMER_WEATHERS.forEach((from, index) => {
                const to = SUMMER_WEATHERS[(index + 1) % COUNT];
                const arriving = summerWeatherAt(index + ALMOST);
                const arrived = summerWeatherAt(index + 1);
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(arriving[key], `${from.id} ${key}`).toBeCloseTo(to[key], 9);
                    expect(arrived[key], `${from.id} ${key}`).toBe(to[key]);
                }
            });
        });

        it('has no jump anywhere on the wheel, the seam from the mackerel sky back to fair included', () => {
            const step = 1 / 240;
            let previous = { ...summerWeatherAt(-step) };
            for (let phase = 0; phase <= COUNT + 2 * step; phase += step) {
                const state = summerWeatherAt(phase);
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(Math.abs(state[key] - previous[key]), `${key} at phase ${phase}`).toBeLessThan(0.02);
                }
                previous = { ...state };
            }
            // Finer still across the seam itself and across the end of a hold.
            for (const seam of [0, COUNT, 2 + SUMMER_WEATHER_HOLD]) {
                const [before, after] = [{ ...summerWeatherAt(seam - 1e-7) }, { ...summerWeatherAt(seam + 1e-7) }];
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(Math.abs(after[key] - before[key]), `${key} across ${seam}`).toBeLessThan(1e-5);
                }
            }
        });

        it('writes into the state it is given and allocates nothing of its own', () => {
            const state = createSummerWeatherState();
            expect(Object.keys(state).sort()).toEqual(['phase', ...SUMMER_WEATHER_SCALARS].sort());
            // A blank state is all zero until a weather is written into it.
            for (const key of Object.keys(state)) expect(state[key], key).toBe(0);
            const keys = Object.keys(state);
            expect(summerWeatherAt(3.7, state)).toBe(state);
            // The same keys in the same order: nothing was added, removed or replaced.
            expect(Object.keys(state)).toEqual(keys);
            expect(state.phase).toBeCloseTo(3.7, 12);
            for (const key of SUMMER_WEATHER_SCALARS) expect(typeof state[key], key).toBe('number');
            const first = { ...state };
            summerWeatherAt(0, state);
            expect({ ...state }).not.toEqual(first);
            expect(Object.keys(state)).toEqual(keys);
            summerWeatherAt(3.7, state);
            expect({ ...state }).toEqual(first);
            // Left to itself it hands out a state of its own each time.
            const [one, other] = [summerWeatherAt(1), summerWeatherAt(1)];
            expect(one).not.toBe(other);
            expect(one).toEqual(other);
            expect(Object.keys(one).sort()).toEqual([...keys].sort());
        });

        it('falls back to the fair evening for a phase that is not a number', () => {
            const fair = { ...summerWeatherAt(0) };
            for (const phase of [NaN, undefined, null, Infinity, -Infinity, 'rain']) {
                expect({ ...summerWeatherAt(phase) }, String(phase)).toEqual(fair);
            }
            for (const key of SUMMER_WEATHER_SCALARS) expect(fair[key], key).toBe(SUMMER_WEATHERS[0][key]);
        });

        it('keeps every scalar finite and inside the table\'s own range at any phase', () => {
            const range = Object.fromEntries(SUMMER_WEATHER_SCALARS.map((key) => {
                const values = SUMMER_WEATHERS.map((weather) => weather[key]);
                return [key, [Math.min(...values), Math.max(...values)]];
            }));
            const state = createSummerWeatherState();
            for (let phase = -COUNT; phase < COUNT * 2; phase += 0.013) {
                summerWeatherAt(phase, state);
                expect(state.phase).toBeGreaterThanOrEqual(0);
                expect(state.phase).toBeLessThan(COUNT);
                for (const key of SUMMER_WEATHER_SCALARS) {
                    expect(Number.isFinite(state[key]), `${key} at ${phase}`).toBe(true);
                    expect(state[key], `${key} at ${phase}`).toBeGreaterThanOrEqual(range[key][0] - 1e-12);
                    expect(state[key], `${key} at ${phase}`).toBeLessThanOrEqual(range[key][1] + 1e-12);
                }
            }
        });

        it('names the nearest weather', () => {
            expect(nearestSummerWeather(0).id).toBe('fair');
            expect(nearestSummerWeather(0.49).id).toBe('fair');
            expect(nearestSummerWeather(0.51).id).toBe('breeze');
            expect(nearestSummerWeather(3.2).id).toBe('shower');
            expect(nearestSummerWeather(4.6).id).toBe('still');
            // Past the middle of the last weather the nearest is fair again, and so it is round the wheel.
            expect(nearestSummerWeather(COUNT - 0.2).id).toBe('fair');
            expect(nearestSummerWeather(-0.3).id).toBe('fair');
            expect(nearestSummerWeather(COUNT + 2).id).toBe('towers');
            for (const phase of [NaN, undefined, null, Infinity, 'mist']) {
                expect(nearestSummerWeather(phase).id, String(phase)).toBe('fair');
            }
            // Always one of the table's own rows.
            for (let phase = -7; phase < 13; phase += 0.21) {
                expect(SUMMER_WEATHERS).toContain(nearestSummerWeather(phase));
            }
        });
    });
});
