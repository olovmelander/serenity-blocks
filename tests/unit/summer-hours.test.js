import { describe, expect, it } from 'vitest';
import {
    SUMMER_HOUR_COLOURS, SUMMER_HOUR_SCALARS, SUMMER_HOUR_SECONDS, SUMMER_HOUR_TURN_SECONDS, SUMMER_HOURS,
    createSummerHourState, nearestSummerHour, summerHourAt, summerHourForLevel, summerSunDirection, wrapSummerHour,
} from '../../src/themes/summer/summer-hours.js';

const COUNT = SUMMER_HOURS.length;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const plain = (state) => Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, ArrayBuffer.isView(value) ? Array.from(value) : value,
]));

describe('Summer hours of the night', () => {
    describe('the table', () => {
        it('names five hours in the order the night passes, evening first', () => {
            expect(SUMMER_HOURS.map((hour) => hour.id)).toEqual(['evening', 'rose', 'white-night', 'dawn', 'morning']);
            expect(new Set(SUMMER_HOURS.map((hour) => hour.name)).size).toBe(COUNT);
            expect(Object.isFrozen(SUMMER_HOURS)).toBe(true);
            for (const hour of SUMMER_HOURS) {
                expect(Object.isFrozen(hour), hour.id).toBe(true);
                for (const key of SUMMER_HOUR_COLOURS) {
                    expect(Object.isFrozen(hour[key]), `${hour.id}.${key}`).toBe(true);
                }
            }
        });

        it('gives every hour every colour and every scalar, finite and in a sane range', () => {
            expect(new Set([...SUMMER_HOUR_COLOURS, ...SUMMER_HOUR_SCALARS]).size)
                .toBe(SUMMER_HOUR_COLOURS.length + SUMMER_HOUR_SCALARS.length);
            for (const hour of SUMMER_HOURS) {
                expect(Object.keys(hour).sort(), hour.id)
                    .toEqual(['id', 'name', ...SUMMER_HOUR_COLOURS, ...SUMMER_HOUR_SCALARS].sort());
                for (const key of SUMMER_HOUR_COLOURS) {
                    const colour = hour[key];
                    expect(colour, `${hour.id}.${key}`).toHaveLength(3);
                    for (const channel of colour) {
                        expect(Number.isFinite(channel), `${hour.id}.${key}`).toBe(true);
                        expect(channel, `${hour.id}.${key}`).toBeGreaterThan(0);
                        // Linear light before the tone mapper: the sun is the brightest thing there is.
                        expect(channel, `${hour.id}.${key}`).toBeLessThanOrEqual(4);
                    }
                }
                expect(hour.haze, hour.id).toBeGreaterThan(0.0005);
                expect(hour.haze, hour.id).toBeLessThan(0.003);
                expect(hour.lamps, hour.id).toBeGreaterThan(0);
                expect(hour.lamps, hour.id).toBeLessThanOrEqual(3);
                expect(hour.exposure, hour.id).toBeGreaterThan(0.9);
                expect(hour.exposure, hour.id).toBeLessThan(1.15);
            }
        });

        // The evening is the scene as it was built and reviewed: these are its numbers.
        it('keeps the evening exactly as the scene was built', () => {
            const [evening] = SUMMER_HOURS;
            expect(evening).toMatchObject({
                sun: [3.6, 2.6, 1.42],
                skyLight: [0.24, 0.36, 0.58],
                bounce: [0.15, 0.2, 0.065],
                zenith: [0.03, 0.14, 0.44],
                skyMid: [0.09, 0.33, 0.66],
                skyAway: [0.62, 0.4, 0.4],
                skyToward: [1.4, 0.82, 0.3],
                hazeCool: [0.22, 0.32, 0.48],
                hazeWarm: [0.95, 0.58, 0.26],
                cloudShadeAway: [0.3, 0.27, 0.44],
                cloudShadeToward: [0.62, 0.34, 0.3],
                cloudBodyAway: [0.78, 0.47, 0.44],
                cloudBodyToward: [1.12, 0.6, 0.36],
                cloudGiltAway: [1.22, 0.98, 0.84],
                cloudGiltToward: [1.95, 1.4, 0.72],
                cirrusAway: [0.8, 0.5, 0.5],
                cirrusToward: [1.4, 0.95, 0.56],
                shaftCool: [0.05, 0.065, 0.09],
                shaftWarm: [1.25, 0.86, 0.4],
                haze: 0.0012,
                lamps: 1,
                exposure: 1,
                sunAzimuth: -14.5,
                sunElevation: 9,
            });
        });

        it('makes the white night the darkest hour with the brightest lamps, and the morning the brightest', () => {
            const by = (key, measure = luma) => SUMMER_HOURS.map((hour) => [hour.id, measure(hour[key])])
                .sort((a, b) => a[1] - b[1]).map(([id]) => id);
            for (const key of ['sun', 'skyLight', 'zenith', 'hazeCool', 'cloudBodyAway']) {
                expect(by(key)[0], key).toBe('white-night');
            }
            expect(by('sun').at(-1)).toBe('morning');
            expect(by('lamps', (value) => value).at(-1)).toBe('white-night');
            expect(by('lamps', (value) => value)[0]).toBe('morning');
            // Every hour's sun is warm (red over blue), and the rose hour's is the reddest for its green.
            for (const hour of SUMMER_HOURS) expect(hour.sun[0], hour.id).toBeGreaterThan(hour.sun[2]);
            const redness = (hour) => hour.sun[0] / hour.sun[1];
            expect(redness(SUMMER_HOURS[1])).toBeGreaterThan(redness(SUMMER_HOURS[0]));
            expect(redness(SUMMER_HOURS[4])).toBeLessThan(redness(SUMMER_HOURS[0]));
        });

        it('makes each hour a different picture from its neighbours', () => {
            const distance = (a, b) => Math.hypot(...SUMMER_HOUR_COLOURS.flatMap((key) => a[key].map(
                (channel, index) => channel - b[key][index],
            )));
            SUMMER_HOURS.forEach((hour, index) => {
                const next = SUMMER_HOURS[(index + 1) % COUNT];
                expect(distance(hour, next), `${hour.id} to ${next.id}`).toBeGreaterThan(0.5);
            });
        });

        it('moves slowly by itself and turns to a new level in a few seconds', () => {
            expect(SUMMER_HOUR_SECONDS).toBeGreaterThanOrEqual(120);
            expect(SUMMER_HOUR_TURN_SECONDS).toBeGreaterThan(1);
            expect(SUMMER_HOUR_TURN_SECONDS * 20).toBeLessThan(SUMMER_HOUR_SECONDS);
        });
    });

    describe('the sun', () => {
        // The board hides the middle of the screen: it is sized by the window's height (half as
        // wide as it is tall, about 0.2 of the height to each side), which at the 50 degree lens
        // puts its edge 10.7 degrees from straight ahead whatever the window's shape. The
        // maypole's far wreath hangs at about -26: between them is the sky the sun has to itself.
        const BOARD_EDGE = -10.7;
        const SUN_RADIUS = 1.7;

        it('stands in the ring in the evening and somewhere else at every other hour', () => {
            const [evening, ...others] = SUMMER_HOURS;
            expect([evening.sunAzimuth, evening.sunElevation]).toEqual([-14.5, 9]);
            for (const hour of others) {
                const away = Math.hypot(hour.sunAzimuth - evening.sunAzimuth, hour.sunElevation - evening.sunElevation);
                // Clear of the wreath's ring, which is under two degrees across its radius.
                expect(away, hour.id).toBeGreaterThan(2.5);
            }
            const places = SUMMER_HOURS.map((hour) => `${hour.sunAzimuth}/${hour.sunElevation}`);
            expect(new Set(places).size).toBe(COUNT);
        });

        it('sinks to the hills in the white night and stands highest in the morning', () => {
            const lowest = [...SUMMER_HOURS].sort((a, b) => a.sunElevation - b.sunElevation);
            expect(lowest[0].id).toBe('white-night');
            expect(lowest.at(-1).id).toBe('morning');
            // Down through the rose hour, up through the dawn.
            const rise = SUMMER_HOURS.map((hour) => hour.sunElevation);
            expect(rise[0]).toBeGreaterThan(rise[1]);
            expect(rise[1]).toBeGreaterThan(rise[2]);
            expect(rise[3]).toBeGreaterThan(rise[2]);
            expect(rise[4]).toBeGreaterThan(rise[3]);
            // It never sets and never climbs out of a low northern sky.
            for (const hour of SUMMER_HOURS) {
                expect(hour.sunElevation, hour.id).toBeGreaterThan(4);
                expect(hour.sunElevation, hour.id).toBeLessThan(16);
            }
        });

        it('keeps to the sky left of the board at every moment of the night', () => {
            for (let phase = 0; phase < COUNT; phase += 1 / 64) {
                const { sunAzimuth, sunElevation } = summerHourAt(phase);
                expect(sunAzimuth + SUN_RADIUS, `phase ${phase}`).toBeLessThan(BOARD_EDGE);
                expect(sunAzimuth, `phase ${phase}`).toBeGreaterThan(-24);
                expect(sunElevation, `phase ${phase}`).toBeGreaterThan(4);
                expect(sunElevation, `phase ${phase}`).toBeLessThan(16);
            }
        });

        it('moves without a jump, and is back in the ring when the night comes round', () => {
            const step = 1 / 240;
            let previous = summerHourAt(-step);
            let [azimuth, elevation] = [previous.sunAzimuth, previous.sunElevation];
            for (let phase = 0; phase <= COUNT + step; phase += step) {
                previous = summerHourAt(phase);
                expect(Math.hypot(previous.sunAzimuth - azimuth, previous.sunElevation - elevation)).toBeLessThan(0.06);
                [azimuth, elevation] = [previous.sunAzimuth, previous.sunElevation];
            }
            for (const phase of [0, COUNT, COUNT * 3, -COUNT]) {
                const state = summerHourAt(phase);
                expect(state.sunAzimuth).toBeCloseTo(-14.5, 9);
                expect(state.sunElevation).toBeCloseTo(9, 9);
            }
            // It lingers there: a twentieth of an hour on, it has hardly left the middle of the ring.
            const soon = summerHourAt(0.05);
            expect(Math.hypot(soon.sunAzimuth + 14.5, soon.sunElevation - 9)).toBeLessThan(0.05);
        });

        it('turns an azimuth and an elevation into a unit vector toward the sun', () => {
            const close = (actual, expected) => actual.forEach(
                (value, index) => expect(value).toBeCloseTo(expected[index], 12),
            );
            close(summerSunDirection(0, 0), [0, 0, -1]);
            close(summerSunDirection(-90, 0), [-1, 0, 0]);
            close(summerSunDirection(90, 0), [1, 0, 0]);
            close(summerSunDirection(0, 90), [0, 1, 0]);
            for (const hour of SUMMER_HOURS) {
                const [x, y, z] = summerSunDirection(hour.sunAzimuth, hour.sunElevation);
                expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
                // Ahead of the camera, to its left, above the horizon.
                expect(z).toBeLessThan(0);
                expect(x).toBeLessThan(0);
                expect(y).toBeGreaterThan(0);
            }
            const out = [9, 9, 9];
            expect(summerSunDirection(-14.5, 9, out)).toBe(out);
            close(out, summerSunDirection(-14.5, 9));
        });
    });

    describe('levels', () => {
        it('stands each level one hour further on, and comes round after the last', () => {
            expect([1, 2, 3, 4, 5, 6, 7, 11, 16].map(summerHourForLevel)).toEqual([0, 1, 2, 3, 4, 0, 1, 0, 0]);
            expect(summerHourForLevel(COUNT * 40 + 3)).toBe(2);
            expect(summerHourForLevel(2.4)).toBe(1);
            expect(summerHourForLevel(2.6)).toBe(2);
        });

        it('treats anything that is not a level as level 1', () => {
            for (const level of [0, -4, NaN, Infinity, undefined, null, 'three', {}, []]) {
                expect(summerHourForLevel(level), String(level)).toBe(0);
            }
        });
    });

    describe('the circle', () => {
        it('folds any phase onto the circle of hours', () => {
            expect(wrapSummerHour(0)).toBe(0);
            expect(wrapSummerHour(COUNT)).toBe(0);
            expect(wrapSummerHour(COUNT + 1.25)).toBeCloseTo(1.25, 12);
            expect(wrapSummerHour(-0.5)).toBeCloseTo(COUNT - 0.5, 12);
            expect(wrapSummerHour(-COUNT * 3)).toBe(0);
            for (const phase of [NaN, Infinity, -Infinity, undefined, null, 'noon']) {
                expect(wrapSummerHour(phase), String(phase)).toBe(0);
            }
            for (let phase = -12; phase < 12; phase += 0.37) {
                const wrapped = wrapSummerHour(phase);
                expect(wrapped).toBeGreaterThanOrEqual(0);
                expect(wrapped).toBeLessThan(COUNT);
            }
        });

        it('returns an hour of the table exactly at a whole phase', () => {
            SUMMER_HOURS.forEach((hour, index) => {
                for (const phase of [index, index + COUNT, index - COUNT * 2]) {
                    const state = summerHourAt(phase);
                    expect(state.phase).toBe(index);
                    for (const key of SUMMER_HOUR_COLOURS) {
                        hour[key].forEach((channel, at) => {
                            expect(state[key][at], `${hour.id}.${key}`).toBeCloseTo(channel, 6);
                        });
                    }
                    for (const key of SUMMER_HOUR_SCALARS) {
                        expect(state[key], `${hour.id}.${key}`).toBeCloseTo(hour[key], 12);
                    }
                }
            });
        });

        it('stays between two neighbouring hours in between, and passes their middle half way', () => {
            for (let index = 0; index < COUNT; index += 1) {
                const from = SUMMER_HOURS[index];
                const to = SUMMER_HOURS[(index + 1) % COUNT];
                for (const fraction of [0.1, 0.35, 0.5, 0.8, 0.999]) {
                    const state = summerHourAt(index + fraction);
                    for (const key of SUMMER_HOUR_COLOURS) {
                        state[key].forEach((channel, at) => {
                            const low = Math.min(from[key][at], to[key][at]) - 1e-6;
                            const high = Math.max(from[key][at], to[key][at]) + 1e-6;
                            expect(channel >= low && channel <= high, `${from.id}+${fraction} ${key}`).toBe(true);
                        });
                    }
                }
                const half = summerHourAt(index + 0.5);
                expect(half.sun[0]).toBeCloseTo((from.sun[0] + to.sun[0]) / 2, 6);
                expect(half.lamps).toBeCloseTo((from.lamps + to.lamps) / 2, 12);
            }
        });

        it('lingers at each hour: a tenth of the way on, less than a tenth of the change has happened', () => {
            const from = SUMMER_HOURS[1];
            const to = SUMMER_HOURS[2];
            const early = summerHourAt(1.1);
            const done = (early.sun[0] - from.sun[0]) / (to.sun[0] - from.sun[0]);
            expect(done).toBeGreaterThan(0);
            expect(done).toBeLessThan(0.05);
            const late = summerHourAt(1.9);
            expect((late.sun[0] - from.sun[0]) / (to.sun[0] - from.sun[0])).toBeGreaterThan(0.95);
        });

        it('has no jump anywhere on the circle, the seam from morning to evening included', () => {
            const step = 1 / 240;
            const samples = [];
            for (let phase = -step; phase <= COUNT + step; phase += step) samples.push(plain(summerHourAt(phase)));
            samples.slice(1).forEach((state, index) => {
                const previous = samples[index];
                for (const key of SUMMER_HOUR_COLOURS) {
                    state[key].forEach((channel, at) => {
                        expect(Math.abs(channel - previous[key][at]), `${key} at sample ${index}`).toBeLessThan(0.03);
                    });
                }
                expect(Math.abs(state.lamps - previous.lamps)).toBeLessThan(0.02);
            });
        });

        it('writes into the state it is given and allocates nothing of its own', () => {
            const state = createSummerHourState();
            const arrays = SUMMER_HOUR_COLOURS.map((key) => state[key]);
            expect(summerHourAt(2.3, state)).toBe(state);
            SUMMER_HOUR_COLOURS.forEach((key, index) => expect(state[key]).toBe(arrays[index]));
            expect(state.phase).toBeCloseTo(2.3, 12);
            const first = plain(state);
            summerHourAt(0, state);
            expect(plain(state)).not.toEqual(first);
            summerHourAt(2.3, state);
            expect(plain(state)).toEqual(first);
            // A blank state is all zero until an hour is written into it.
            const blank = createSummerHourState();
            expect(Object.keys(blank).sort()).toEqual(['phase', ...SUMMER_HOUR_COLOURS, ...SUMMER_HOUR_SCALARS].sort());
            for (const key of SUMMER_HOUR_COLOURS) expect(Array.from(blank[key])).toEqual([0, 0, 0]);
        });

        it('falls back to the evening for a phase that is not a number', () => {
            const evening = plain(summerHourAt(0));
            for (const phase of [NaN, undefined, null, Infinity, 'dusk']) {
                expect(plain(summerHourAt(phase))).toEqual(evening);
            }
        });

        it('names the nearest hour', () => {
            expect(nearestSummerHour(0).id).toBe('evening');
            expect(nearestSummerHour(0.49).id).toBe('evening');
            expect(nearestSummerHour(0.51).id).toBe('rose');
            expect(nearestSummerHour(2.2).id).toBe('white-night');
            expect(nearestSummerHour(COUNT - 0.2).id).toBe('evening');
            expect(nearestSummerHour(NaN).id).toBe('evening');
        });
    });
});
