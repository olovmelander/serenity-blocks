import { describe, expect, it } from 'vitest';
import {
    FOREST_HOUR_COLOURS, FOREST_HOUR_PERIOD, FOREST_HOUR_REST, FOREST_HOUR_SCALARS, FOREST_HOURS,
    createForestHour, forestHourAt, forestHourDrift, forestHourName, forestNearestTurn,
} from '../../src/themes/forest/forest-hours.js';
import { ForestLight } from '../../src/themes/forest/forest-light.js';
import { forestTier } from '../../src/themes/forest/forest-quality.js';

// The hours of the night are plain numbers: these tests assert what the light rig, the world
// and a capture rely on (the rest and the melt, the seams, the short way round), not the
// colours an hour is painted in today.
const HOURS = FOREST_HOURS.length;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('Forest hours: the five hours of the night', () => {
    it('are five, each named, each with every colour and number an hour sets', () => {
        expect(HOURS).toBe(5);
        expect(Object.isFrozen(FOREST_HOURS)).toBe(true);
        expect(new Set(FOREST_HOURS.map((hour) => hour.name)).size).toBe(HOURS);
        expect(FOREST_HOURS[0].name).toBe('deep night');
        for (const hour of FOREST_HOURS) {
            expect(Object.isFrozen(hour)).toBe(true);
            expect(Object.keys(hour).sort()).toEqual(['name', ...FOREST_HOUR_COLOURS, ...FOREST_HOUR_SCALARS].sort());
            for (const key of FOREST_HOUR_COLOURS) {
                expect(hour[key], `${hour.name}.${key}`).toHaveLength(3);
                expect(Object.isFrozen(hour[key])).toBe(true);
                for (const channel of hour[key]) expect(Number.isFinite(channel) && channel >= 0).toBe(true);
            }
            for (const key of FOREST_HOUR_SCALARS) expect(Number.isFinite(hour[key]) && hour[key] >= 0).toBe(true);
        }
    });

    it('open in deep night: the forest as it was before the night began to turn', () => {
        // The light rig's colours before there were hours. A change here changes the first
        // thing every player sees, the theme's icon and every older capture.
        expect(FOREST_HOURS[0]).toMatchObject({
            moon: [1.15, 1.6, 2.5],
            skyLight: [0.075, 0.135, 0.27],
            bounce: [0.016, 0.03, 0.045],
            fill: [0.03, 0.055, 0.1],
            zenith: [0.0035, 0.008, 0.023],
            skyMid: [0.011, 0.026, 0.058],
            skyAway: [0.018, 0.04, 0.078],
            skyToward: [0.105, 0.175, 0.29],
            hazeCool: [0.016, 0.034, 0.066],
            hazeMoon: [0.27, 0.41, 0.63],
            nightTint: [0.84, 0.96, 1.12],
            moonFace: [1.0, 0.95, 0.82],
            aureole: [0.62, 0.8, 1.1],
            cloudAway: [0.012, 0.022, 0.042],
            cloudToward: [0.03, 0.055, 0.1],
            beamCool: [0.02, 0.042, 0.082],
            beamMoon: [0.4, 0.6, 0.95],
            shade: [0.9, 1.0, 1.14],
            haze: 0.0062,
            stars: 1,
        });
    });

    it('stay a night: no hour is so bright that a firefly is lost in it, none is black', () => {
        const night = FOREST_HOURS[0];
        for (const hour of FOREST_HOURS) {
            // What the sky gives a surface, and the sky itself, within a few times deep night's.
            for (const key of ['skyLight', 'skyMid', 'hazeCool', 'zenith']) {
                expect(luma(hour[key]), `${hour.name}.${key}`).toBeLessThan(luma(night[key]) * 3.2);
                expect(luma(hour[key]), `${hour.name}.${key}`).toBeGreaterThan(luma(night[key]) * 0.5);
            }
            // The moon is always the brightest thing in the air.
            expect(luma(hour.moon)).toBeGreaterThan(luma(hour.skyLight) * 5);
            expect(hour.haze).toBeGreaterThan(0.004);
            expect(hour.haze).toBeLessThan(0.012);
            expect(hour.stars).toBeLessThanOrEqual(1);
        }
    });

    it('differ: every hour turns the moonlight or the sky to a colour of its own', () => {
        const lean = (colour) => colour.map((channel) => channel / Math.max(...colour));
        for (let a = 0; a < HOURS; a++) {
            for (let b = a + 1; b < HOURS; b++) {
                const apart = ['moon', 'skyLight', 'skyAway', 'skyToward'].map((key) => {
                    const one = lean(FOREST_HOURS[a][key]);
                    const other = lean(FOREST_HOURS[b][key]);
                    return Math.hypot(one[0] - other[0], one[1] - other[1], one[2] - other[2]);
                });
                expect(Math.max(...apart), `${FOREST_HOURS[a].name} and ${FOREST_HOURS[b].name}`).toBeGreaterThan(0.2);
            }
        }
    });
});

describe('Forest hours: the clock', () => {
    const rest = FOREST_HOUR_PERIOD * FOREST_HOUR_REST;

    it('rests, then melts into the next hour, and comes round in ten minutes', () => {
        expect(FOREST_HOUR_PERIOD * HOURS).toBeGreaterThanOrEqual(480);
        expect(FOREST_HOUR_PERIOD * HOURS).toBeLessThanOrEqual(900);
        expect(rest).toBeGreaterThan(25);
        for (let hour = 0; hour < 12; hour++) {
            const start = hour * FOREST_HOUR_PERIOD;
            // The hour rests: nothing moves until its rest is over.
            for (const into of [0, 1, rest * 0.5, rest]) expect(forestHourDrift(start + into)).toBe(hour);
            // Then it melts: on its way, and exactly there when the period is out.
            const half = forestHourDrift(start + rest + (FOREST_HOUR_PERIOD - rest) / 2);
            expect(half).toBeCloseTo(hour + 0.5, 10);
            expect(forestHourDrift(start + FOREST_HOUR_PERIOD - 1e-9)).toBeCloseTo(hour + 1, 6);
            expect(forestHourDrift(start + FOREST_HOUR_PERIOD)).toBe(hour + 1);
        }
    });

    it('never jumps and never turns back: no moment of the passage is seen to move', () => {
        let previous = 0;
        let fastest = 0;
        const step = 1 / 60;
        for (let time = 0; time <= FOREST_HOUR_PERIOD * (HOURS + 1); time += step) {
            const turned = forestHourDrift(time);
            expect(turned).toBeGreaterThanOrEqual(previous);
            fastest = Math.max(fastest, (turned - previous) / step);
            previous = turned;
        }
        // An hour in not much less than a minute at its quickest.
        expect(fastest).toBeLessThan(1 / 38);
        expect(fastest).toBeGreaterThan(1 / FOREST_HOUR_PERIOD);
    });

    it('is a function of the time alone, so a seek and a night lived through agree', () => {
        for (const rate of [24, 60, 144]) {
            // A moment in the middle of a melt, reached frame by frame at this rate.
            const frames = Math.round(FOREST_HOUR_PERIOD * 2.83 * rate);
            let time = 0;
            for (let frame = 0; frame < frames; frame++) time += 1 / rate;
            const lived = forestHourDrift(time);
            expect(lived).toBeGreaterThan(2.5);
            expect(lived).toBeLessThan(3);
            expect(lived).toBeCloseTo(forestHourDrift(frames / rate), 8);
        }
        for (const nothing of [NaN, undefined, null, -40, -Infinity, 'soon']) expect(forestHourDrift(nothing)).toBe(0);
        expect(Number.isFinite(forestHourDrift(1e9))).toBe(true);
    });
});

describe('Forest hours: the colours at any moment', () => {
    it('are an hour\'s own at a whole number, and come round', () => {
        const out = createForestHour();
        for (let hour = 0; hour < HOURS; hour++) {
            for (const turn of [0, 1, -1, 7]) {
                expect(forestHourAt(hour + turn * HOURS, out)).toBe(out);
                for (const key of FOREST_HOUR_COLOURS) {
                    FOREST_HOURS[hour][key].forEach((channel, c) => expect(out[key][c]).toBeCloseTo(channel, 12));
                }
                for (const key of FOREST_HOUR_SCALARS) expect(out[key]).toBeCloseTo(FOREST_HOURS[hour][key], 12);
                expect(forestHourName(hour + turn * HOURS)).toBe(FOREST_HOURS[hour].name);
            }
        }
        // Somewhere of its own when none is given, and deep night for a phase that is no number.
        const fresh = forestHourAt(0);
        expect(fresh).not.toBe(out);
        expect(forestHourAt(NaN, out).moon).toEqual([...FOREST_HOURS[0].moon]);
        expect(forestHourName(NaN)).toBe('deep night');
    });

    it('lie between two hours otherwise: every colour between its two neighbours\'', () => {
        const out = createForestHour();
        for (let hour = 0; hour < HOURS; hour++) {
            const a = FOREST_HOURS[hour];
            const b = FOREST_HOURS[(hour + 1) % HOURS];
            for (const part of [0.1, 0.5, 0.93]) {
                forestHourAt(hour + part, out);
                for (const key of FOREST_HOUR_COLOURS) {
                    for (let c = 0; c < 3; c++) {
                        expect(out[key][c]).toBeCloseTo(a[key][c] + (b[key][c] - a[key][c]) * part, 12);
                    }
                }
                expect(out.haze).toBeCloseTo(a.haze + (b.haze - a.haze) * part, 12);
            }
            // The name is the nearer hour's.
            expect(forestHourName(hour + 0.4)).toBe(a.name);
            expect(forestHourName(hour + 0.6)).toBe(b.name);
        }
    });

    it('move slowly through a whole night: the clock alone never hurries a colour', () => {
        const out = createForestHour();
        const previous = createForestHour();
        forestHourAt(0, previous);
        const step = 0.5;
        for (let time = step; time <= FOREST_HOUR_PERIOD * HOURS; time += step) {
            forestHourAt(forestHourDrift(time), out);
            for (const key of FOREST_HOUR_COLOURS) {
                for (let c = 0; c < 3; c++) {
                    // The moonlight is the widest swing (blue-white to amber): a twentieth of
                    // a unit a second at most, and everything else far less.
                    expect(Math.abs(out[key][c] - previous[key][c]) / step, `${key} at ${time}s`).toBeLessThan(0.05);
                    previous[key][c] = out[key][c];
                }
            }
        }
    });
});

describe('Forest hours: the short way round', () => {
    it('finds the turn nearest where the night is that shows the hour wanted', () => {
        expect(forestNearestTurn(0, 0)).toBe(0);
        expect(forestNearestTurn(0.3, 1)).toBe(1);
        // From the fifth hour to the first is one hour on, not four back.
        expect(forestNearestTurn(4, 0)).toBe(5);
        expect(forestNearestTurn(4.2, 0)).toBe(5);
        // And from the first to the fifth is one hour back.
        expect(forestNearestTurn(0.3, 4)).toBe(-1);
        // Many levels on, the wheel has turned many times: still the nearest.
        expect(forestNearestTurn(37, 2)).toBe(37);
        expect(forestNearestTurn(37.4, 41)).toBe(36);
        for (let from = -12; from <= 12; from += 0.37) {
            for (let wanted = 0; wanted < 40; wanted += 3) {
                const turn = forestNearestTurn(from, wanted);
                expect(Math.abs(turn - from)).toBeLessThanOrEqual(HOURS / 2 + 1e-9);
                expect(((turn - wanted) % HOURS + HOURS) % HOURS).toBeCloseTo(0, 9);
            }
        }
        // No number counts as the start of the night, or the first hour.
        expect(forestNearestTurn(NaN, 3)).toBe(forestNearestTurn(0, 3));
        expect(forestNearestTurn(2, NaN)).toBe(0);
        expect(forestNearestTurn(7, 1, 3)).toBe(7);
    });
});

describe('Forest hours: the light rig', () => {
    function rig(quality = 'Minimal') {
        return new ForestLight({ tier: forestTier(quality), rng: () => 0.5 });
    }

    it('starts in deep night, every colour an hour sets held as a uniform', () => {
        const light = rig();
        expect(Object.keys(light.hourUniforms).sort()).toEqual([...FOREST_HOUR_COLOURS].sort());
        for (const key of FOREST_HOUR_COLOURS) {
            const { value } = light.hourUniforms[key];
            expect([value.r, value.g, value.b], key).toEqual([...FOREST_HOURS[0][key]]);
        }
        expect(light.uHaze.value).toBe(FOREST_HOURS[0].haze);
        expect(light.uStars.value).toBe(FOREST_HOURS[0].stars);
        expect(light.hourPhase).toBe(0);
        light.dispose();
    });

    it('turns to any hour by changing values only: the same uniforms, the same colour objects', () => {
        const light = rig();
        const before = Object.fromEntries(FOREST_HOUR_COLOURS.map((key) => [key, light.hourUniforms[key].value]));
        for (const phase of [1, 2.5, 3, 4.75, 5, -2, 23.2]) {
            light.setHour(phase);
            expect(light.hourPhase).toBe(phase);
            const wanted = forestHourAt(phase);
            for (const key of FOREST_HOUR_COLOURS) {
                const { value } = light.hourUniforms[key];
                expect(value).toBe(before[key]);
                [value.r, value.g, value.b].forEach((channel, c) => expect(channel).toBeCloseTo(wanted[key][c], 6));
            }
            expect(light.uHaze.value).toBeCloseTo(wanted.haze, 12);
            expect(light.uStars.value).toBeCloseTo(wanted.stars, 12);
        }
        // Back in deep night after a whole turn, to the last digit.
        light.setHour(HOURS);
        for (const key of FOREST_HOUR_COLOURS) {
            const { value } = light.hourUniforms[key];
            [value.r, value.g, value.b].forEach((channel, c) => expect(channel).toBeCloseTo(FOREST_HOURS[0][key][c], 6));
        }
        // A phase that is no number is deep night, not a black forest.
        light.setHour(NaN);
        expect(light.hourPhase).toBe(0);
        expect(light.uMoonColor.value.r).toBeCloseTo(FOREST_HOURS[0].moon[0], 6);
        // What an event does to the moon is left alone: the hour sets its colour, not its gain.
        light.update(1, 1 / 60, { moon: 1 });
        const lifted = light.uMoonGain.value;
        light.setHour(3);
        expect(light.uMoonGain.value).toBe(lifted);
        // Nor is the tier's share of moonlit air.
        expect(light.uHazeMoonAmount.value).toBe(0.9);
        light.dispose();
    });
});
