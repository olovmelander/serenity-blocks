/**
 * High Coast — the day.
 *
 * The house rule (the owner's, for every theme): the palette drifts with the CLOCK by itself,
 * whatever the level; a level-up adds a whole station on top, stepping forward from where the
 * light was heading, never back; a new run keeps the light where it is.
 *
 * And the owner's word on this theme (2026-10-18): the light must not "pop from dark to light";
 * it should turn as smoothly and naturally as Sunset's. So the light never rests on a station,
 * the sun's direct light follows its real height instead of being switched as it crosses the
 * horizon, and no moment of the day changes the picture's light faster than a bound the old
 * wheel broke three times over.
 *
 * The palettes are still being tuned, so the colour gate holds a property, not a palette: every
 * half-way mix of neighbouring stations keeps its colour (no grey crossing).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TIMING } from '../../src/themes/high-coast/high-coast-core.js';
import {
    DAY_HEIGHTS, HOURS, HOUR_COUNT, HourWheel, LATITUDE, SUN, TIMETABLE, blendLight, chroma, copyLight, createLight,
    countedHourAt, dayAt, dayHourAt, hourMix, hourPlace, lightAt, sunBearingAt, sunClear, sunHeightAt, sunStrength,
} from '../../src/themes/high-coast/high-coast-hours.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';

const COLOUR_KEYS = [
    'sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'water',
];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'day'];
const STATION_SCALARS = ['exposure', 'stars', 'hazeDensity', 'mistDensity'];
const ARRAY_KEYS = [...COLOUR_KEYS, 'dir'];
const GOLDEN = HOURS.findIndex((hour) => hour.name === 'golden hour');
const SUNSET = HOURS.findIndex((hour) => hour.name === 'sunset');
const LIGHT_NIGHT = HOURS.findIndex((hour) => hour.name === 'light night');
const DAWN = HOURS.findIndex((hour) => hour.name === 'dawn mist');
const MORNING = HOURS.findIndex((hour) => hour.name === 'morning');
/** The half-way mixes must keep at least this much colour in the sky. */
const MIN_SKY_CHROMA = 0.15;

const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const stops = (x) => Math.log2(Math.max(x, 1e-4));

/** How far two lights are apart: the largest difference of any colour channel or scalar. */
function distance(a, b) {
    let d = 0;
    for (const key of COLOUR_KEYS) for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[key][c] - b[key][c]));
    for (const key of SCALAR_KEYS) d = Math.max(d, Math.abs(a[key] - b[key]));
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.dir[c] - b.dir[c]));
    return d;
}

/**
 * True when a light is exactly a station's own: its palette, and its sun's hue (the sun's
 * strength comes from its height, not from the station).
 */
function isHour(light, index) {
    const hour = HOURS[index];
    const sunScale = luminance(light.sun) / luminance(hour.sun);
    return COLOUR_KEYS.every((key) => hour[key].every((v, c) => {
        const want = key === 'sun' ? v * sunScale : v;
        return Math.abs(light[key][c] - want) < 1e-9;
    })) && STATION_SCALARS.every((key) => Math.abs(light[key] - hour[key]) < 1e-9);
}

/** The signed step from one azimuth to the next, wrapped into (−180, 180]. */
const azStep = (from, to) => {
    const d = (((to - from) % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
};

const lightOf = (wheel, t) => lightAt(wheel.place(t));
/** The light of a level held still, the clock alone turning it. */
const clockLight = (level, t) => lightAt(hourPlace(level, t));

/**
 * What the eye reads of a light, after the hour's exposure: the land (the sun's light on a
 * half-turned face plus the sky's), the sky overhead, the band toward the sun (its aureole by
 * day, the twilight wedge by night), and a cloud's lit side. The shaders draw these from the same
 * uniforms (high-coast-land, -light, -cumulus).
 */
function reads(light) {
    const e = light.exposure;
    return [
        (luminance(light.sun) * light.sunUp * 0.5 + luminance(light.fill)) * e,
        luminance(light.zenith.map((z, c) => z * 1.9 + light.fill[c] * 0.3)) * e,
        (luminance(light.horizon) + luminance(light.glow) * (0.4 * (0.45 + 0.55 * light.day) + 0.175 * (1 - light.day))) * e,
        luminance(light.cloudLit) * (0.85 * light.day + 0.15) * e,
    ];
}

describe('High Coast day: the stations', () => {
    it('is a day of six stations, each with every colour and scalar the world reads', () => {
        expect(HOUR_COUNT).toBe(6);
        expect(HOURS.map((hour) => hour.name)).toEqual([
            'golden hour', 'sunset', 'light night', 'dawn mist', 'morning', 'afternoon',
        ]);
        HOURS.forEach((hour) => {
            COLOUR_KEYS.forEach((key) => {
                expect(hour[key], `${hour.name}.${key}`).toHaveLength(3);
                hour[key].forEach((v) => expect(v >= 0 && Number.isFinite(v), `${hour.name}.${key}`).toBe(true));
            });
            // Every station gives the sun a hue, even where it has no strength.
            expect(luminance(hour.sun), hour.name).toBeGreaterThan(0);
            STATION_SCALARS.forEach((key) => expect(Number.isFinite(hour[key]), `${hour.name}.${key}`).toBe(true));
            expect(hour.at >= 0 && hour.at < 24, hour.name).toBe(true);
            expect(Number.isFinite(hour.az), hour.name).toBe(true);
        });
    });

    it('places the wheel at the clock plus the level: one station per TIMING.hour seconds', () => {
        expect(hourPlace(1, 0)).toBe(0);
        expect(hourPlace(1, TIMING.hour)).toBeCloseTo(1, 12);
        expect(hourPlace(3, TIMING.hour / 2)).toBeCloseTo(2.5, 12);
        expect(hourPlace(1, -50)).toBe(0);
        expect(hourPlace(1, Number.NaN)).toBe(0);
        expect(hourPlace(undefined, 0)).toBe(0);
    });

    it('stands station k at place k, at its own hour of the day', () => {
        HOURS.forEach((hour, k) => {
            expect(dayHourAt(k), hour.name).toBeCloseTo(hour.at, 9);
            expect(dayHourAt(k + HOUR_COUNT), hour.name).toBeCloseTo(hour.at, 9);
            const light = lightAt(k);
            expect(isHour(light, k), hour.name).toBe(true);
            expect(light).toMatchObject({ from: k, to: (k + 1) % HOUR_COUNT, mix: 0 });
            expect(light.az, hour.name).toBeCloseTo(hour.az, 9);
        });
    });

    it('runs the hour of the day forward through the timetable, never back, and round the day', () => {
        let previous = countedHourAt(0);
        expect(previous).toBeCloseTo(HOURS[0].at, 12);
        for (let place = 0.01; place < HOUR_COUNT; place += 0.01) {
            const counted = countedHourAt(place);
            expect(counted, `place ${place.toFixed(2)}`).toBeGreaterThan(previous);
            previous = counted;
        }
        expect(countedHourAt(HOUR_COUNT - 1e-9)).toBeCloseTo(HOURS[0].at + 24, 6);
        // The timetable's knots rise in both place and hour.
        for (let i = 1; i < TIMETABLE.length; i++) {
            expect(TIMETABLE[i][0]).toBeGreaterThan(TIMETABLE[i - 1][0]);
            expect(TIMETABLE[i][1]).toBeGreaterThan(TIMETABLE[i - 1][1]);
        }
        // It lingers round the setting: the golden hour to sunset is the slowest stretch of the day.
        const hoursPerPlace = (a, b) => (countedHourAt(b) - countedHourAt(a)) / (b - a);
        expect(hoursPerPlace(GOLDEN, SUNSET)).toBeLessThan(hoursPerPlace(MORNING, MORNING + 1) / 5);
    });

    it('wraps round the day', () => {
        expect(hourMix(5.5)).toMatchObject({ from: 5, to: 0 });
        expect(hourMix(6.2)).toMatchObject({ from: 0, to: 1 });
        expect(hourMix(-0.5)).toMatchObject({ from: 5, to: 0 });
        expect(hourMix(Number.NaN)).toMatchObject({ from: 0, to: 1, mix: 0 });
        expect(distance(lightAt(1.3), lightAt(1.3 + 6 * 7))).toBeLessThan(1e-9);
        expect(distance(lightAt(5.999999), lightAt(0))).toBeLessThan(1e-4);
    });
});

describe('High Coast day: the clock alone', () => {
    it('never rests: the light is on its way at every moment of the day', () => {
        for (let t = 0; t < HOUR_COUNT * TIMING.hour; t += 2) {
            expect(distance(clockLight(1, t + 2), clockLight(1, t)), `t = ${t}`).toBeGreaterThan(1e-4);
        }
        // Between two stations the crossing only ever goes forward.
        for (let k = 0; k < HOUR_COUNT; k++) {
            let previous = -1;
            for (let f = 0; f < 1; f += 0.01) {
                const { mix } = hourMix(k + f);
                expect(mix, `${k} + ${f.toFixed(2)}`).toBeGreaterThan(previous);
                previous = mix;
            }
        }
    });

    it('has moved the light within the first minute, at a fixed level with no gameplay', () => {
        for (const level of [1, 2, 5]) {
            const start = clockLight(level, 0);
            expect(isHour(start, (level - 1) % HOUR_COUNT), `level ${level}`).toBe(true);
            expect(distance(clockLight(level, 60), start), `level ${level}`).toBeGreaterThan(0.05);
            expect(distance(clockLight(level, 5), start), `level ${level}`).toBeGreaterThan(0);
        }
    });

    it('stands on the next station one TIMING.hour later, and on each station after it', () => {
        for (let k = 0; k <= 7; k++) {
            const light = clockLight(1, k * TIMING.hour);
            expect(isHour(light, k % HOUR_COUNT), `after ${k} stations`).toBe(true);
            expect(light.from).toBe(k % HOUR_COUNT);
        }
    });

    it('never turns the light faster than 0.12 stops a second (the old wheel: 0.35, Sunset 0.26)', () => {
        const dt = 0.25;
        let previous = reads(clockLight(1, 0));
        let worst = 0;
        for (let t = dt; t <= HOUR_COUNT * TIMING.hour; t += dt) {
            const now = reads(clockLight(1, t));
            for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.abs(stops(now[i]) - stops(previous[i])) / dt);
            previous = now;
        }
        expect(worst).toBeLessThan(0.12);
    });

    it('drifts the same at every level: the level is added on top of the clock, never instead of it', () => {
        for (const level of [1, 2, 4, 7, 12]) {
            const wheel = new HourWheel();
            wheel.levelUp(level, 0, true);
            for (const t of [0, 15, 37, 60, 100, 250, 999]) {
                expect(wheel.place(t), `level ${level}, t = ${t}`).toBeCloseTo(level - 1 + t / TIMING.hour, 9);
                expect(wheel.place(t)).toBeCloseTo(hourPlace(level, t), 9);
            }
            expect(distance(lightOf(wheel, 60), lightOf(wheel, 0)), `level ${level}`).toBeGreaterThan(0.05);
        }
    });

    it('drifts in the world too: the world\'s own light moves with the clock at level 1 and at level 4', () => {
        for (const level of [1, 4]) {
            // No build is needed: the light is CPU state the update writes into the uniforms.
            const world = new HighCoastWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
            world.levelUp(level, { silent: true, time: 0 });
            const at = (time) => {
                world.update({ time, delta: 1 / 30 });
                return copyLight(world.light, createLight());
            };
            const first = at(0);
            expect(first.place).toBeCloseTo(level - 1, 9);
            expect(distance(at(60), first), `level ${level}`).toBeGreaterThan(0.05);
            const later = at(TIMING.hour);
            expect(isHour(later, level % HOUR_COUNT), `level ${level}`).toBe(true);
            expect(world.getState().level).toBe(level);
            // The uniforms follow the light.
            expect(world.u.sun.value.toArray()).toEqual(later.sun);
            expect(world.u.horizon.value.toArray()).toEqual(later.horizon);
            expect(world.u.sunUp.value).toBe(later.sunUp);
            expect(world.u.day.value).toBe(later.day);
            expect(world.getState().hour).toMatchObject({ of: later.hour, day: later.day, sunUp: later.sunUp });
            world.dispose();
        }
    });
});

describe('High Coast day: level-ups', () => {
    it('add a whole station on top of the clock, eased over TIMING.levelTurn from where the light stood', () => {
        const wheel = new HourWheel();
        const t0 = 30;
        const before = wheel.place(t0);
        wheel.levelUp(2, t0);
        expect(wheel.place(t0)).toBeCloseTo(before, 12); // no jump at the instant
        let previous = before;
        for (let k = 1; k <= 20; k++) {
            const t = t0 + (k / 20) * TIMING.levelTurn;
            const place = wheel.place(t);
            expect(place, `step ${k}`).toBeGreaterThan(previous);
            previous = place;
        }
        expect(wheel.levelShare(t0 + TIMING.levelTurn / 2)).toBeCloseTo(0.5, 9);
        for (const t of [t0 + TIMING.levelTurn, t0 + 60, t0 + 400]) {
            expect(wheel.place(t)).toBeCloseTo(1 + t / TIMING.hour, 9);
        }
    });

    it('turn the day visibly but never in a flash, wherever in the day they come', () => {
        // The old wheel switched the sun on within a level's turn at 10 stops a second.
        let worst = 0;
        for (let start = 0; start < HOUR_COUNT * TIMING.hour; start += 5) {
            const wheel = new HourWheel();
            wheel.levelUp(2, start);
            let previous = reads(lightOf(wheel, start));
            for (let t = start + 0.1; t <= start + TIMING.levelTurn; t += 0.1) {
                const now = reads(lightOf(wheel, t));
                for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.abs(stops(now[i]) - stops(previous[i])) / 0.1);
                previous = now;
            }
        }
        expect(worst).toBeLessThan(4);
    });

    it('step forward from where the light was heading when a second level comes mid-turn', () => {
        const wheel = new HourWheel();
        wheel.levelUp(2, 10);
        const t1 = 10 + TIMING.levelTurn * 0.4;
        const before = wheel.place(t1);
        wheel.levelUp(3, t1);
        expect(wheel.place(t1)).toBeCloseTo(before, 12);
        const done = t1 + TIMING.levelTurn;
        // Both stations arrive: the second is added to where the first was heading, not to where it was.
        expect(wheel.place(done)).toBeCloseTo(2 + done / TIMING.hour, 9);
        // And the place never fell back on the way.
        let previous = before;
        for (let t = t1; t <= done; t += 0.1) {
            expect(wheel.place(t), `t = ${t}`).toBeGreaterThanOrEqual(previous - 1e-12);
            previous = wheel.place(t);
        }
    });

    it('step by every level gained at once', () => {
        const wheel = new HourWheel();
        wheel.levelUp(4, 0);
        expect(wheel.place(TIMING.levelTurn)).toBeCloseTo(3 + TIMING.levelTurn / TIMING.hour, 9);
    });

    it('never step back: a new run keeps the light, and its first level-up steps on from it', () => {
        const wheel = new HourWheel();
        const samples = [];
        const sample = (t) => samples.push([t, wheel.place(t)]);
        wheel.levelUp(4, 5);
        for (let t = 5; t <= 20; t += 0.5) sample(t);
        const atRun = wheel.place(20);
        wheel.newRun();
        expect(wheel.level).toBe(1);
        expect(wheel.place(20)).toBeCloseTo(atRun, 12);
        for (let t = 20; t <= 40; t += 0.5) sample(t);
        // The level going back to 1 (the director re-announces it) changes nothing either.
        wheel.levelUp(1, 40);
        expect(wheel.place(40)).toBeCloseTo(atRun + 20 / TIMING.hour, 9);
        wheel.levelUp(2, 40);
        for (let t = 40; t <= 60; t += 0.5) sample(t);
        expect(wheel.place(60)).toBeCloseTo(4 + 60 / TIMING.hour, 9);
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i][1], `t = ${samples[i][0]}`).toBeGreaterThanOrEqual(samples[i - 1][1] - 1e-12);
        }
    });

    it('a silent level-up (a rebuild restoring the run) lands at once', () => {
        const wheel = new HourWheel();
        wheel.levelUp(3, 50, true);
        expect(wheel.place(50)).toBeCloseTo(2 + 50 / TIMING.hour, 9);
    });

    it('export and import restore the place, mid-turn and after it', () => {
        const wheel = new HourWheel();
        wheel.levelUp(3, 12);
        wheel.newRun();
        wheel.levelUp(2, 14);
        const copy = new HourWheel();
        copy.importState(JSON.parse(JSON.stringify(wheel.exportState())));
        expect(copy.exportState()).toEqual(wheel.exportState());
        for (const t of [14, 15.5, 17, 19, 60, 500]) expect(copy.place(t), `t = ${t}`).toBeCloseTo(wheel.place(t), 12);
        expect(copy.level).toBe(wheel.level);
        // Nothing at all changes nothing; nonsense restores a fresh wheel.
        copy.importState(null);
        expect(copy.place(60)).toBeCloseTo(wheel.place(60), 12);
        copy.importState({ turnAt: Number.NaN, level: -4 });
        expect(copy.level).toBe(1);
        expect(copy.place(0)).toBe(0);
        wheel.reset();
        expect(wheel.place(0)).toBe(0);
        expect(wheel.level).toBe(1);
    });
});

describe('High Coast day: the sun', () => {
    it('stands where the real sun stands at 63° north on midsummer', () => {
        expect(LATITUDE).toBe(63);
        // Highest at noon (90° − 63° + 23.44°), lowest just under the north at midnight.
        expect(sunHeightAt(12)).toBeCloseTo(50.44, 2);
        expect(sunHeightAt(0)).toBeCloseTo(-3.56, 2);
        expect(sunHeightAt(24)).toBeCloseTo(sunHeightAt(0), 9);
        // It sets a little before ten in the evening and rises a little after two.
        expect(sunHeightAt(21.8)).toBeGreaterThan(0);
        expect(sunHeightAt(22)).toBeLessThan(0);
        expect(sunHeightAt(2)).toBeLessThan(0);
        expect(sunHeightAt(2.2)).toBeGreaterThan(0);
        // Symmetric about noon.
        for (const h of [3, 7.5, 10]) expect(sunHeightAt(12 - h)).toBeCloseTo(sunHeightAt(12 + h), 9);
    });

    it('walks its bearing the decreasing way round the whole day, through every station\'s own, never in a jump', () => {
        HOURS.forEach((hour) => expect(sunBearingAt(hour.at), hour.name).toBeCloseTo(hour.az, 9));
        let previous = lightAt(0).az;
        for (let place = 0.01; place <= HOUR_COUNT + 0.001; place += 0.01) {
            const { az } = lightAt(place);
            expect(az >= -180 && az < 180, `place ${place.toFixed(2)}`).toBe(true);
            const step = azStep(previous, az);
            expect(step, `place ${place.toFixed(2)}`).toBeLessThanOrEqual(1e-9);
            expect(step, `place ${place.toFixed(2)}`).toBeGreaterThan(-10);
            previous = az;
        }
    });

    it('stands under the horizon only in the light night, a unit direction always', () => {
        expect(LIGHT_NIGHT).toBeGreaterThanOrEqual(0);
        HOURS.forEach((hour, i) => {
            const light = lightAt(i);
            expect(Math.hypot(...light.dir), hour.name).toBeCloseTo(1, 9);
            if (i === LIGHT_NIGHT) {
                expect(light.el, hour.name).toBeLessThan(0);
                expect(light.dir[1]).toBeLessThan(0);
                expect(light.sunUp).toBe(0);
                expect(luminance(light.sun)).toBe(0);
            } else {
                expect(light.el, hour.name).toBeGreaterThan(0);
                expect(light.dir[1]).toBeGreaterThan(0);
                expect(light.sunUp, hour.name).toBeGreaterThan(0.9);
            }
        });
    });

    it('gives the direct light the strength the stations were authored with, from the height alone', () => {
        // The authored lights (colour × the old gate) the fit was made to: within 10 %.
        const authored = {
            'golden hour': 2.47, sunset: 1.0, 'dawn mist': 1.79, morning: 3.66, afternoon: 3.56,
        };
        HOURS.forEach((hour, k) => {
            if (k === LIGHT_NIGHT) return;
            const light = lightAt(k);
            const beam = luminance(light.sun) * light.sunUp;
            expect(beam / authored[hour.name], hour.name).toBeGreaterThan(0.9);
            expect(beam / authored[hour.name], hour.name).toBeLessThan(1.1);
        });
    });

    it('fades the direct light with the height: gone at the far shore, rising without a step', () => {
        expect(sunStrength(SUN.edge)).toBe(0);
        expect(sunStrength(SUN.edge - 3)).toBe(0);
        expect(sunStrength(Number.NaN)).toBe(0);
        expect(sunStrength(90)).toBeLessThanOrEqual(SUN.peak);
        let previous = 0;
        for (let el = SUN.edge; el <= 50; el += 0.05) {
            const beam = sunStrength(el) * sunClear(el);
            expect(beam, `el ${el.toFixed(2)}`).toBeGreaterThanOrEqual(previous);
            // No tenth of a degree adds more than a twentieth of the peak.
            expect(beam - previous, `el ${el.toFixed(2)}`).toBeLessThan(SUN.peak / 20);
            previous = beam;
        }
    });

    it('takes over half a minute of clock to set and to rise, where the old wheel took fifteen seconds', () => {
        const beam = (t) => {
            const light = clockLight(1, t);
            return luminance(light.sun) * light.sunUp;
        };
        const crossing = (from, to, start, end) => {
            let first = null;
            let last = null;
            for (let t = start; t <= end; t += 0.1) {
                const b = beam(t);
                if (first === null && (from > to ? b < from : b > from)) first = t;
                if (last === null && (from > to ? b < to : b > to)) last = t;
            }
            return last - first;
        };
        const atSunset = beam(SUNSET * TIMING.hour);
        expect(crossing(0.9 * atSunset, 0.1 * atSunset, SUNSET * TIMING.hour - 40, LIGHT_NIGHT * TIMING.hour)).toBeGreaterThan(28);
        const atDawn = beam(DAWN * TIMING.hour);
        expect(crossing(0.1 * atDawn, 0.9 * atDawn, LIGHT_NIGHT * TIMING.hour, DAWN * TIMING.hour + 20)).toBeGreaterThan(28);
    });

    it('crosses the sky into the light night over a minute and more of clock', () => {
        expect(dayAt(DAY_HEIGHTS[0])).toBe(0);
        expect(dayAt(DAY_HEIGHTS[1])).toBe(1);
        expect(lightAt(LIGHT_NIGHT).day).toBeLessThan(0.05);
        expect(lightAt(GOLDEN).day).toBe(1);
        const when = (value, start, end, falling) => {
            for (let t = start; t <= end; t += 0.1) {
                const { day } = clockLight(1, t);
                if (falling ? day < value : day > value) return t;
            }
            return null;
        };
        const dusk = when(0.1, 0, 200, true) - when(0.9, 0, 200, true);
        const dawn = when(0.9, 200, 320, false) - when(0.1, 200, 320, false);
        expect(dusk).toBeGreaterThan(90);
        expect(dawn).toBeGreaterThan(60);
    });

    it('lights the windows and the lighthouse in the light night and puts them out by morning', () => {
        expect(MORNING).toBeGreaterThanOrEqual(0);
        expect(lightAt(LIGHT_NIGHT).lamps).toBeGreaterThan(0.99);
        expect(lightAt(MORNING).lamps).toBeLessThan(0.01);
        expect(lightAt(MORNING + 1).lamps).toBeLessThan(0.01);
        for (let place = 0; place < 6; place += 0.1) {
            const { lamps } = lightAt(place);
            expect(lamps >= 0 && lamps <= 1, `place ${place.toFixed(1)}`).toBe(true);
        }
    });
});

describe('High Coast day: the palettes', () => {
    it('mixes only the two stations it stands between, in linear light', () => {
        for (let place = 0; place < HOUR_COUNT; place += 0.13) {
            const light = lightAt(place);
            const a = HOURS[light.from];
            const b = HOURS[light.to];
            for (const key of COLOUR_KEYS.filter((k) => k !== 'sun')) {
                for (let c = 0; c < 3; c++) expect(light[key][c]).toBeCloseTo(a[key][c] + (b[key][c] - a[key][c]) * light.mix, 12);
            }
            for (const key of STATION_SCALARS) expect(light[key]).toBeCloseTo(a[key] + (b[key] - a[key]) * light.mix, 12);
        }
    });

    // BUG (high-coast-hours.js): two neighbouring horizons are near-complementary, so their linear
    // half-way mix goes grey: dawn mist → morning (rose [0.92, 0.68, 0.66] with blue
    // [0.55, 0.66, 0.82]) mixes to chroma 0.095, afternoon → golden hour (blue [0.62, 0.68, 0.80]
    // with peach [0.86, 0.66, 0.52]) to 0.108. Measured fix: dawn mist horizon [0.92, 0.62, 0.72]
    // (rose-lilac; the mix with morning turns lavender, chroma 0.169) and golden hour horizon
    // [0.9, 0.74, 0.46] (more golden; the mix with afternoon stays warm, chroma 0.171). Every other
    // mix stays above 0.15 with both changes.
    it('keeps colour in the sky half-way between every pair of neighbouring stations', () => {
        const grey = [];
        for (let h = 0; h < HOUR_COUNT; h++) {
            const a = HOURS[h];
            const b = HOURS[(h + 1) % HOUR_COUNT];
            const label = `${a.name} → ${b.name}`;
            for (const key of ['zenith', 'horizon']) {
                const half = a[key].map((v, c) => (v + b[key][c]) / 2);
                const c = chroma(half);
                if (!(c > MIN_SKY_CHROMA)) grey.push(`${label}: ${key} chroma ${c.toFixed(3)} [${half.map((v) => v.toFixed(3))}]`);
            }
        }
        expect(grey).toEqual([]);
        for (let place = 0; place < HOUR_COUNT; place += 0.05) {
            const light = lightAt(place);
            COLOUR_KEYS.forEach((key) => light[key].forEach((v) => {
                expect(v >= 0 && Number.isFinite(v), `place ${place.toFixed(2)}: ${key}`).toBe(true);
            }));
        }
    });

    it('measures chroma as saturation of a linear colour', () => {
        expect(chroma([0, 0, 0])).toBe(0);
        expect(chroma([0.5, 0.5, 0.5])).toBe(0);
        expect(chroma([1, 0, 0])).toBe(1);
        expect(chroma([1, 0.5, 0.5])).toBeCloseTo(0.5, 12);
    });
});

describe('High Coast day: lights share nothing', () => {
    it('copyLight copies values, never arrays', () => {
        const src = lightAt(2.4);
        const dst = copyLight(src, createLight());
        ARRAY_KEYS.forEach((key) => {
            expect(dst[key], key).not.toBe(src[key]);
            expect(dst[key], key).toEqual(src[key]);
        });
        expect(distance(dst, src)).toBe(0);
        for (const key of ['az', 'el', 'sunUp', 'day', 'lamps', 'from', 'to', 'mix', 'hour', 'place']) {
            expect(dst[key], key).toBe(src[key]);
        }
        src.sun[0] = 99;
        src.dir[1] = 99;
        expect(dst.sun[0]).not.toBe(99);
        expect(dst.dir[1]).not.toBe(99);
    });

    it('blendLight writes fresh values into its own arrays and leaves both inputs alone', () => {
        const a = lightAt(1.5);
        const b = lightAt(4);
        const aBefore = JSON.stringify(a);
        const bBefore = JSON.stringify(b);
        const out = createLight();
        const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, out[key]]));
        expect(blendLight(a, b, 0.4, out)).toBe(out);
        ARRAY_KEYS.forEach((key) => {
            expect(out[key], key).toBe(arrays[key]);
            expect(out[key], key).not.toBe(a[key]);
            expect(out[key], key).not.toBe(b[key]);
        });
        out.sun[0] = 77;
        out.dir[2] = 77;
        expect(JSON.stringify(a)).toBe(aBefore);
        expect(JSON.stringify(b)).toBe(bBefore);
        // Its ends are its inputs' colours; the elevation follows, the sun's bearing stays a's.
        const zero = blendLight(a, b, 0);
        const one = blendLight(a, b, 1);
        COLOUR_KEYS.forEach((key) => {
            zero[key].forEach((v, c) => expect(v).toBeCloseTo(a[key][c], 12));
            one[key].forEach((v, c) => expect(v).toBeCloseTo(b[key][c], 12));
        });
        expect(zero.day).toBeCloseTo(a.day, 12);
        expect(one.day).toBeCloseTo(b.day, 12);
        expect(one.el).toBeCloseTo(b.el, 12);
        expect(one.az).toBe(a.az);
        expect(Math.hypot(...blendLight(a, b, 0.7).dir)).toBeCloseTo(1, 9);
        // The lamps never go out half-way into a darker light.
        const night = lightAt(LIGHT_NIGHT);
        const day = lightAt(MORNING);
        expect(blendLight(day, night, 0.5).lamps).toBeGreaterThanOrEqual((day.lamps + night.lamps) / 2 - 1e-12);
        // Separate calls never share their arrays either.
        const again = blendLight(a, b, 0);
        ARRAY_KEYS.forEach((key) => expect(again[key], key).not.toBe(zero[key]));
    });

    it('lightAt fills the light it is handed and never writes into the stations', () => {
        const hours = JSON.stringify(HOURS);
        const out = createLight();
        const { sun } = out;
        for (let place = 0; place < 12; place += 0.37) {
            expect(lightAt(place, out)).toBe(out);
            out.sun[0] += 1;
            out.horizon[1] += 1;
            blendLight(out, lightAt(place + 1), 0.5, out);
        }
        expect(out.sun).toBe(sun);
        expect(JSON.stringify(HOURS)).toBe(hours);
        const fresh = [createLight(), createLight()];
        ARRAY_KEYS.forEach((key) => expect(fresh[0][key]).not.toBe(fresh[1][key]));
    });
});
