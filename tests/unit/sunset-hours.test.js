/**
 * Sunset — the day: the light round the whole twenty-four hours, where the sun and the moon run,
 * and how the clock and the levels move the day. The clock alone must move it (every mode, the
 * ones that never level included); a level carries it further on top, and nothing turns it back.
 */
import { describe, expect, it } from 'vitest';
import {
    BODY_COLOURS, DAY_SECONDS, HOUR_COLOURS, HOUR_SCALARS, LEVEL_SECONDS, MOON_LAG, MOON_PEAK, START_HOUR, STATIONS,
    STATION_COLOURS, STATION_SCALARS, SUN_PEAK, TIMETABLE, TURN_SECONDS, airMass, arcAt, bodyColour, dayHourAt,
    hourAngle, levelOffset, lightAt, moonHeightAt, stationMix, sunHeightAt, turnSeconds, wheelAt,
} from '../../src/themes/sunset/sunset-hours.js';

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c) => Math.max(...c) - Math.min(...c);
const station = (name) => STATIONS.find((s) => s.name === name);
/** The hour as the wheel counts it, from START_HOUR on (so it only rises within a day). */
const counted = (s) => {
    const h = dayHourAt(s);
    return h < START_HOUR - 1e-9 ? h + 24 : h;
};

describe('sunset day: the stations', () => {
    it('names the day from midnight round, every station at its own hour', () => {
        expect(STATIONS.map((s) => s.name)).toEqual([
            'midnight', 'predawn', 'dawn', 'sunrise', 'morning', 'noon', 'afternoon', 'golden', 'sunset',
            'afterglow', 'dusk',
        ]);
        for (let i = 1; i < STATIONS.length; i += 1) expect(STATIONS[i].at).toBeGreaterThan(STATIONS[i - 1].at);
        expect(STATIONS[STATIONS.length - 1].at).toBeLessThan(24);
    });

    it('gives every station every colour and number it authors; the bodies take theirs from the air', () => {
        expect([...STATION_COLOURS, ...BODY_COLOURS].sort()).toEqual([...HOUR_COLOURS].sort());
        STATIONS.forEach((s) => {
            STATION_COLOURS.forEach((key) => {
                expect(s[key], `${s.name}.${key}`).toHaveLength(3);
                s[key].forEach((v) => expect(Number.isFinite(v) && v >= 0, `${s.name}.${key}`).toBe(true));
            });
            STATION_SCALARS.forEach((key) => expect(Number.isFinite(s[key]), `${s.name}.${key}`).toBe(true));
            BODY_COLOURS.forEach((key) => expect(s[key], `${s.name}.${key}`).toBeUndefined());
        });
        const light = lightAt(7.3);
        HOUR_COLOURS.forEach((key) => expect(light[key].every(Number.isFinite), key).toBe(true));
        HOUR_SCALARS.forEach((key) => expect(Number.isFinite(light[key]), key).toBe(true));
    });

    it('never mixes two neighbouring stations through grey', () => {
        for (let h = 0; h < 24; h += 0.05) {
            const light = lightAt(h);
            // The horizon, toward the sun and away from it, keeps a colour of its own across every
            // crossing: a straight mix of two opposite hues would pass through grey.
            ['horizonSun', 'horizonFar'].forEach((key) => {
                const c = light[key];
                expect(chroma(c) / Math.max(1e-3, Math.max(...c)), `${h.toFixed(2)} h ${key}`).toBeGreaterThan(0.2);
            });
        }
    });

    it('is darkest at midnight and keeps the night readable', () => {
        const night = station('midnight');
        STATIONS.filter((s) => s !== night).forEach((s) => {
            expect(luma(s.zenithFar), s.name).toBeGreaterThan(luma(night.zenithFar));
        });
        expect(luma(night.horizonSun)).toBeGreaterThan(0.03);
        expect(lightAt(0).stars).toBe(1);
        expect(lightAt(12).stars).toBe(0);
    });

    it('is always on its way: the crossing eases but never stands still', () => {
        const { at } = station('golden');
        const next = station('sunset').at;
        const a = stationMix(at + 0.001).mix;
        const b = stationMix(at + 0.002).mix;
        expect(b).toBeGreaterThan(a);
        expect(stationMix((at + next) / 2).mix).toBeCloseTo(0.5, 5);
        expect(stationMix(23.9).from).toBe(STATIONS.length - 1);
        expect(stationMix(23.9).to).toBe(0);
    });
});

describe('sunset day: the sun and the moon', () => {
    const SET = -27;
    const RISE = 32;

    it('rises the sun on the right at six, stands it high over the picture at noon, sets it on the left at six', () => {
        const rise = arcAt(hourAngle(6), SUN_PEAK, SET, RISE);
        expect(rise.el).toBeCloseTo(0, 6);
        expect(rise.az).toBeCloseTo(RISE, 6);
        const noon = arcAt(hourAngle(12), SUN_PEAK, SET, RISE);
        expect(noon.el).toBeCloseTo(SUN_PEAK, 6);
        expect(noon.el).toBeGreaterThan(35); // over the top of the picture
        const set = arcAt(hourAngle(18), SUN_PEAK, SET, RISE);
        expect(set.el).toBeCloseTo(0, 6);
        expect(set.az).toBeCloseTo(SET, 6);
        expect(sunHeightAt(0)).toBeCloseTo(-SUN_PEAK, 6);
    });

    it('moves the sun right to left all day, and comes down to the sea on the left side all evening', () => {
        let last = Infinity;
        for (let h = 6; h <= 18; h += 0.1) {
            const { az } = arcAt(hourAngle(h), SUN_PEAK, SET, RISE);
            expect(az).toBeLessThan(last + 1e-9);
            last = az;
        }
        // From golden hour on it stays on its own side of the picture.
        for (let h = 16; h <= 18; h += 0.1) expect(arcAt(hourAngle(h), SUN_PEAK, SET, RISE).az).toBeLessThan(-15);
        // And it comes up on the right side of it.
        for (let h = 6; h <= 7.5; h += 0.1) expect(arcAt(hourAngle(h), SUN_PEAK, SET, RISE).az).toBeGreaterThan(20);
    });

    it('rises the moon on the right just before sunset and sets it on the left just before sunrise', () => {
        const moonrise = 12 + (MOON_LAG - 90) / 15;
        const moonset = 12 + (MOON_LAG + 90) / 15 - 24;
        expect(moonHeightAt(moonrise)).toBeCloseTo(0, 6);
        expect(moonHeightAt(moonset)).toBeCloseTo(0, 6);
        expect(moonrise).toBeGreaterThan(17);
        expect(moonrise).toBeLessThan(18);
        expect(moonset).toBeGreaterThan(5);
        expect(moonset).toBeLessThan(6);
        // Up on the right while the sun sets on the left; high over the picture at midnight.
        const atSunset = arcAt(hourAngle(18, MOON_LAG), MOON_PEAK, SET, RISE);
        expect(atSunset.el).toBeGreaterThan(0);
        expect(atSunset.az).toBeGreaterThan(25);
        expect(moonHeightAt(0)).toBeGreaterThan(35);
        // Coming down on the left before dawn.
        expect(arcAt(hourAngle(4.5, MOON_LAG), MOON_PEAK, SET, RISE).az).toBeLessThan(-20);
    });

    it('reddens a body as it nears the sea and whitens it as it climbs', () => {
        expect(airMass(90)).toBeCloseTo(1, 2);
        expect(airMass(0)).toBeGreaterThan(30);
        const high = bodyColour(50, 1);
        const low = bodyColour(1, 1);
        expect(Math.max(...high)).toBeCloseTo(1, 6);
        expect(high[2]).toBeGreaterThan(0.75);
        expect(low[1]).toBeLessThan(0.3);
        expect(low[2]).toBeLessThan(0.05);
        // The light's own sun: white at noon, a coal on the sea at sunset, gone under it at night.
        expect(lightAt(12).sunDisc[2]).toBeGreaterThan(0.8);
        expect(lightAt(18).sunDisc[2]).toBeLessThan(0.2);
        expect(Math.max(...lightAt(0).sunGlint)).toBe(0);
        expect(Math.max(...lightAt(17).sunGlint)).toBeGreaterThan(2);
        // The moon's road shows at night only, gold low down, silver high up.
        expect(Math.max(...lightAt(12).moonGlint)).toBeLessThan(1e-6);
        const silver = lightAt(21).moonGlint;
        expect(silver[2]).toBeGreaterThan(silver[0]);
        const gold = lightAt(5.3).moonGlint;
        expect(gold[0]).toBeGreaterThan(gold[2]);
    });

    it('hands the clouds to the moon in the night and back to the sun before it rises', () => {
        expect(lightAt(16).moonKey).toBe(0);
        expect(lightAt(21).moonKey).toBeCloseTo(1, 6);
        expect(lightAt(3).moonKey).toBeCloseTo(1, 6);
        expect(lightAt(6).moonKey).toBe(0);
    });
});

describe('sunset day: the clock and the levels', () => {
    it('runs the timetable forward from golden hour, round the whole day, never back', () => {
        expect(TIMETABLE[0]).toEqual([0, START_HOUR]);
        expect(TIMETABLE[TIMETABLE.length - 1]).toEqual([DAY_SECONDS, START_HOUR + 24]);
        expect(dayHourAt(0)).toBeCloseTo(START_HOUR, 6);
        expect(dayHourAt(DAY_SECONDS)).toBeCloseTo(START_HOUR, 6);
        TIMETABLE.forEach(([s, h]) => expect(dayHourAt(s)).toBeCloseTo(h % 24, 6));
        let last = counted(0);
        for (let s = 0.25; s < DAY_SECONDS; s += 0.25) {
            const h = counted(s);
            expect(h, `at ${s} s`).toBeGreaterThanOrEqual(last - 1e-9);
            last = h;
        }
        expect(wheelAt(18)).toBeCloseTo(70, 3);
        expect(dayHourAt(wheelAt(6.05))).toBeCloseTo(6.05, 4);
    });

    it('lingers where the light changes most: the evening and the dawn take most of the day', () => {
        const span = (a, b) => (wheelAt(b) - wheelAt(a) + DAY_SECONDS) % DAY_SECONDS;
        // Golden hour to dusk, and the moon setting to the morning: a quarter of the hours, over
        // two fifths of the clock's day.
        expect((19.5 - START_HOUR + 3) / 24).toBeLessThan(0.25);
        expect(span(START_HOUR, 19.5) + span(5, 8)).toBeGreaterThan(DAY_SECONDS * 0.4);
        // The sun is never seen to race: under six minutes of the day a second.
        for (let s = 0; s < DAY_SECONDS; s += 0.5) {
            let d = dayHourAt(s + 0.5) - dayHourAt(s);
            if (d < 0) d += 24;
            expect(d / 0.5).toBeLessThan(0.1);
        }
    });

    it('moves the light with the clock alone: within the first minute, the whole day in DAY_SECONDS', () => {
        expect(DAY_SECONDS).toBeGreaterThanOrEqual(480);
        expect(DAY_SECONDS).toBeLessThanOrEqual(720);
        const start = lightAt(dayHourAt(0));
        const minute = lightAt(dayHourAt(60));
        expect(minute.horizonSun).not.toEqual(start.horizonSun);
        expect(minute.sunHeight).toBeLessThan(start.sunHeight - 10);
        expect(lightAt(dayHourAt(75)).name).toBe('sunset');
        expect(lightAt(dayHourAt(wheelAt(0))).name).toBe('midnight');
        expect(lightAt(dayHourAt(wheelAt(6.05))).name).toBe('sunrise');
    });

    it('adds a level as an eighth of the day on top of the clock, eased', () => {
        expect(LEVEL_SECONDS * 8).toBeCloseTo(DAY_SECONDS, 6);
        expect(levelOffset(0, LEVEL_SECONDS, TURN_SECONDS * 2)).toBeCloseTo(LEVEL_SECONDS, 6);
        const midway = levelOffset(0, LEVEL_SECONDS, TURN_SECONDS / 2);
        expect(midway).toBeGreaterThan(LEVEL_SECONDS * 0.2);
        expect(midway).toBeLessThan(LEVEL_SECONDS * 0.8);
        expect(levelOffset(0, LEVEL_SECONDS, 0)).toBe(0);
        expect(turnSeconds(LEVEL_SECONDS * 4)).toBeGreaterThan(turnSeconds(LEVEL_SECONDS));
        expect(turnSeconds(LEVEL_SECONDS)).toBeCloseTo(TURN_SECONDS, 6);
    });
});
