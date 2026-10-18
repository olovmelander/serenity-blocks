/**
 * Grainfields — the day.
 *
 * The house rule (the owner's, for every theme): the light drifts with the CLOCK by itself,
 * whatever the level. The wheel's place is
 *
 *     place = clock / TIMING.hour + (level − 1)
 *
 * with no rest at any station (the light is always on its way): at level 1 with no gameplay the
 * light has visibly moved within the first minute and stands on the next station one TIMING.hour
 * later. A level-up adds a whole station on top, eased over TIMING.levelTurn, always forward from
 * where the light was heading (never back); a new run keeps the light where it is.
 *
 * And the owner's word on High Coast (2026-10-18), which this theme was built on: the light must
 * not "pop from dark to light", it should turn as smoothly as Sunset's. So the sun's direct light
 * follows its real height (never switched), the sky's daylight follows it over several degrees,
 * nothing changes faster than a bound, and the day sampled finely is continuous.
 *
 * The palettes are still being tuned, so the colour gate holds a property, not a palette. The
 * model is tests/unit/high-coast-hours.test.js.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PLACES, TIMING, bearingOf, mulberry32,
} from '../../src/themes/grainfields/grainfields-core.js';
import {
    DAY_HEIGHTS, DECLINATION, HOURS, HOUR_COUNT, HourWheel, LATITUDE, SUN, TIMETABLE, blendLight, chroma, copyLight,
    countedHourAt, createLight, dayAt, dayHourAt, hourMix, hourPlace, lightAt, sunBearingAt, sunClear, sunHeightAt,
    sunStrength,
} from '../../src/themes/grainfields/grainfields-hours.js';
import { GrainfieldsWorld } from '../../src/themes/grainfields/grainfields-world.js';

const COLOUR_KEYS = ['sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade'];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'cover', 'wind', 'day'];
const STATION_SCALARS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'cover', 'wind'];
const SKY_KEYS = ['zenith', 'horizon', 'glow'];
const ARRAY_KEYS = [...COLOUR_KEYS, 'dir'];
const station = (name) => HOURS.findIndex((hour) => hour.name === name);
const STORM = station('storm break');
const GOLDEN = station('golden hour');
const DUSK = station('dusk');
const DAWN = station('dawn mist');
const MORNING = station('morning');
/** One whole day of clock at level 1. */
const DAY = HOUR_COUNT * TIMING.hour;
/** The half-way mixes must keep at least this much colour in the sky (High Coast's gate). */
const MIN_SKY_CHROMA = 0.15;
/** Sunset's worst rate (stops a second): the smooth day the owner holds up as the model. */
const SUNSET_WORST = 0.26;

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
/** The direct light on the land: the sun's strength through the disc's gate. */
const beamOf = (light) => luminance(light.sun) * light.sunUp;

/**
 * What the eye reads of a light, after the hour's exposure, as the shaders draw it from the same
 * uniforms: the land (grainfields-light lightSurface: the sun on a half-turned face through the
 * deck's average shade at this cover, plus the sky's fill), the sky a little above the horizon
 * (skyColour's `mid`), the band toward the sun (the horizon, the aureole by day and the twilight
 * wedge by night) and the deck's underside (grainfields-sky: the shaded hearts, thin cloud, the
 * sunlit rims).
 */
function reads(light) {
    const e = light.exposure;
    return [
        (beamOf(light) * (1 - 0.88 * light.cover) * 0.5 + luminance(light.fill)) * e,
        luminance(light.zenith.map((z, c) => z * 1.7 + light.fill[c] * 0.35)) * e,
        (luminance(light.horizon) + luminance(light.glow) * (0.4 * (0.45 + 0.55 * light.day) + 0.2 * (1 - light.day))) * e,
        (luminance(light.cloudShade) * 0.65 + luminance(light.cloudLit) * (0.04 + 0.2 * light.sunUp)) * e,
    ];
}

/** The worst rate (stops a second) of any read over a clock-only stretch at level 1. */
function worstRate(from, to, dt = 0.25) {
    let previous = reads(clockLight(1, from));
    let worst = 0;
    let at = from;
    for (let t = from + dt; t <= to + 1e-9; t += dt) {
        const now = reads(clockLight(1, t));
        for (let i = 0; i < now.length; i++) {
            const rate = Math.abs(stops(now[i]) - stops(previous[i])) / dt;
            if (rate > worst) {
                worst = rate;
                at = t;
            }
        }
        previous = now;
    }
    return { worst, at };
}

/** The first time in [from, to] (0.05 s steps) a clock-only light at level 1 satisfies `test`. */
function firstTime(from, to, test) {
    for (let t = from; t <= to; t += 0.05) if (test(clockLight(1, t))) return t;
    return null;
}

describe('Grainfields day: the stations', () => {
    it('is a day of five stations, each with every colour and scalar the world reads', () => {
        expect(HOUR_COUNT).toBe(5);
        expect(HOURS.map((hour) => hour.name)).toEqual(['storm break', 'golden hour', 'dusk', 'dawn mist', 'morning']);
        HOURS.forEach((hour) => {
            COLOUR_KEYS.forEach((key) => {
                expect(hour[key], `${hour.name}.${key}`).toHaveLength(3);
                hour[key].forEach((v) => expect(v >= 0 && Number.isFinite(v), `${hour.name}.${key}`).toBe(true));
            });
            // Every station gives the sun a hue, even where it has no strength.
            expect(luminance(hour.sun), hour.name).toBeGreaterThan(0);
            STATION_SCALARS.forEach((key) => expect(Number.isFinite(hour[key]), `${hour.name}.${key}`).toBe(true));
            for (const key of ['cover', 'wind']) expect(hour[key] >= 0 && hour[key] <= 1, `${hour.name}.${key}`).toBe(true);
            expect(hour.exposure, hour.name).toBeGreaterThan(0);
            expect(hour.at >= 0 && hour.at < 24, hour.name).toBe(true);
            expect(hour.az >= -180 && hour.az < 180, hour.name).toBe(true);
        });
        // The storm breaks up through the evening and gathers again through the morning.
        expect(HOURS[STORM].cover).toBeGreaterThan(HOURS[GOLDEN].cover);
        expect(HOURS[STORM].cover).toBeGreaterThan(HOURS[MORNING].cover);
    });

    it('places the wheel at the clock plus the level: one station per TIMING.hour seconds', () => {
        expect(hourPlace(1, 0)).toBe(0);
        expect(hourPlace(1, TIMING.hour)).toBeCloseTo(1, 12);
        expect(hourPlace(3, TIMING.hour / 2)).toBeCloseTo(2.5, 12);
        expect(hourPlace(7, 0)).toBe(6);
        expect(hourPlace(1, -50)).toBe(0);
        expect(hourPlace(1, Number.NaN)).toBe(0);
        expect(hourPlace(undefined, 0)).toBe(0);
        expect(hourPlace(0, 0)).toBe(0);
    });

    it('stands station k at place k, at its own hour of the day, the sun at that hour', () => {
        HOURS.forEach((hour, k) => {
            expect(dayHourAt(k), hour.name).toBeCloseTo(hour.at, 9);
            expect(dayHourAt(k + HOUR_COUNT), hour.name).toBeCloseTo(hour.at, 9);
            const light = lightAt(k);
            expect(isHour(light, k), hour.name).toBe(true);
            expect(light).toMatchObject({ from: k, to: (k + 1) % HOUR_COUNT, mix: 0 });
            expect(light.az, hour.name).toBeCloseTo(hour.az, 9);
            expect(light.el, hour.name).toBeCloseTo(sunHeightAt(hour.at), 9);
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
        // It lingers round the sunset and runs the night fast.
        const hoursPerPlace = (a, b) => (countedHourAt(b) - countedHourAt(a)) / (b - a);
        expect(hoursPerPlace(GOLDEN, DUSK)).toBeLessThan(hoursPerPlace(MORNING, MORNING + 0.999) / 5);
        expect(hoursPerPlace(DUSK + 0.4, DUSK + 0.65)).toBeGreaterThan(hoursPerPlace(GOLDEN, DUSK) * 10);
    });

    it('wraps round the day', () => {
        expect(hourMix(4.5)).toMatchObject({ from: 4, to: 0 });
        expect(hourMix(5.2)).toMatchObject({ from: 0, to: 1 });
        expect(hourMix(-0.5)).toMatchObject({ from: 4, to: 0 });
        expect(hourMix(Number.NaN)).toMatchObject({ from: 0, to: 1, mix: 0 });
        expect(distance(lightAt(1.3), lightAt(1.3 + HOUR_COUNT * 7))).toBeLessThan(1e-9);
        expect(distance(lightAt(HOUR_COUNT - 1e-6), lightAt(0))).toBeLessThan(1e-4);
    });
});

describe('Grainfields day: the clock alone (the house rule)', () => {
    it('never rests: the light is on its way at every moment of the day', () => {
        for (let t = 0; t < DAY; t += 2) {
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

    it('has visibly moved the light within the first minute, at a fixed level with no gameplay', () => {
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
            const world = new GrainfieldsWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
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
            expect(world.u.zenith.value.toArray()).toEqual(later.zenith);
            expect(world.u.sunDir.value.toArray()).toEqual(later.dir);
            expect(world.u.sunUp.value).toBe(later.sunUp);
            expect(world.u.day.value).toBe(later.day);
            expect(world.getState().hour).toMatchObject({
                of: later.hour, day: later.day, sunUp: later.sunUp, name: HOURS[level % HOUR_COUNT].name,
            });
            world.dispose();
        }
    });
});

describe('Grainfields day: nothing pops', () => {
    it('is continuous: sampled finely over two days, no step moves the sun, the sky or the cover more than 1 % of its range', () => {
        const keys = ['sun', ...SKY_KEYS];
        /** The largest change of each key between neighbouring samples `dt` apart, and its range. */
        const sweep = (dt) => {
            const steps = Object.fromEntries([...keys, 'cover'].map((key) => [key, 0]));
            const lo = Object.fromEntries([...keys, 'cover'].map((key) => [key, Infinity]));
            const hi = Object.fromEntries([...keys, 'cover'].map((key) => [key, -Infinity]));
            const previous = copyLight(clockLight(1, 0), createLight());
            const now = createLight();
            for (let t = dt; t <= 2 * DAY + 1e-9; t += dt) {
                lightAt(hourPlace(1, t), now);
                for (const key of keys) {
                    for (let c = 0; c < 3; c++) {
                        steps[key] = Math.max(steps[key], Math.abs(now[key][c] - previous[key][c]));
                        lo[key] = Math.min(lo[key], now[key][c]);
                        hi[key] = Math.max(hi[key], now[key][c]);
                    }
                }
                steps.cover = Math.max(steps.cover, Math.abs(now.cover - previous.cover));
                lo.cover = Math.min(lo.cover, now.cover);
                hi.cover = Math.max(hi.cover, now.cover);
                copyLight(now, previous);
            }
            return { steps, range: Object.fromEntries(Object.keys(steps).map((key) => [key, hi[key] - lo[key]])) };
        };
        const coarse = sweep(1 / 20);
        const fine = sweep(1 / 40);
        for (const key of Object.keys(coarse.steps)) {
            expect(coarse.range[key], key).toBeGreaterThan(0);
            expect(coarse.steps[key], `${key}: a ${1 / 20} s step`).toBeLessThan(0.01 * coarse.range[key]);
            // Halving the step halves the change (a jump would not shrink).
            expect(fine.steps[key] / coarse.steps[key], `${key}: the finer step`).toBeLessThan(0.6);
        }
    });

    it('gives the direct light the strength its height gives it: the stations\' hue, never a switch', () => {
        const mixed = createLight();
        for (let place = 0; place < 2 * HOUR_COUNT; place += 0.01) {
            const light = lightAt(place);
            const label = `place ${place.toFixed(2)}`;
            expect(light.el, label).toBeCloseTo(sunHeightAt(light.hour), 9);
            expect(luminance(light.sun), label).toBeCloseTo(sunStrength(light.el), 9);
            expect(light.sunUp, label).toBeCloseTo(sunClear(light.el), 12);
            expect(light.day, label).toBeCloseTo(dayAt(light.el), 12);
            // Its hue is the two stations' mix (scaled, never re-coloured).
            if (luminance(light.sun) > 1e-6) {
                const { from, to, mix } = light;
                for (let c = 0; c < 3; c++) mixed.sun[c] = HOURS[from].sun[c] + (HOURS[to].sun[c] - HOURS[from].sun[c]) * mix;
                const k = luminance(light.sun) / luminance(mixed.sun);
                for (let c = 0; c < 3; c++) expect(light.sun[c], label).toBeCloseTo(mixed.sun[c] * k, 9);
            }
        }
    });

    it('turns the light from the storm break through the sunset and the night to the dawn no faster than Sunset\'s worst (0.26 stops a second)', () => {
        const { worst, at } = worstRate(0, DAWN * TIMING.hour);
        expect(worst, `worst at t = ${at.toFixed(2)} s`).toBeLessThan(SUNSET_WORST);
        expect(worst).toBeGreaterThan(0); // and it does turn
    });

    // BUG (grainfields-hours.js, TIMETABLE / LINGER): the sun rises at 05:41 (43° N, declination
    // 5°), just after the dawn mist station (05:30, place 3), where the timetable runs 3.5 hours of
    // the day per station (place 3 → 4 is 05:30 → 09:00); it sets at 18:19 between the golden hour
    // and dusk, at 1.08 hours per station. So at level 1 the direct light returns 3.7 times faster
    // than it leaves: the land's read turns 0.58 stops a second at t ≈ 305 s (Sunset's worst is 0.26,
    // High Coast's old popping wheel 0.35). The "dawn is held again" knot [2.7, 28.3] holds 04:18, an
    // hour and a half before the sun comes up. Measured fix: a LINGER knot [3.45, 29.95] (05:57):
    // the day's worst becomes 0.16 stops a second (the sunset), the sunrise 30 s (next test), a
    // level-up's worst 4.8 stops a second.
    it('never turns the light faster than Sunset\'s worst (0.26 stops a second) at any moment of a clock-only day', () => {
        const { worst, at } = worstRate(0, DAY);
        expect(worst, `worst at t = ${at.toFixed(2)} s`).toBeLessThan(SUNSET_WORST);
    });

    // BUG (grainfields-hours.js): the same fast sunrise. From half its peak to a twentieth the direct
    // light takes 29 s of clock to set but 7.8 s to rise (High Coast's old wheel, which popped, took
    // 15 s); with the knot above, 30 s.
    it('takes over twenty seconds of clock for the direct light to set and to rise (half its peak to a twentieth)', () => {
        const sunset = firstTime(0, DAWN * TIMING.hour, (l) => beamOf(l) < 0.05 * SUN.peak)
            - firstTime(0, DAWN * TIMING.hour, (l) => beamOf(l) < 0.5 * SUN.peak);
        const sunrise = firstTime(DAWN * TIMING.hour - 20, DAY, (l) => beamOf(l) > 0.5 * SUN.peak)
            - firstTime(DAWN * TIMING.hour - 20, DAY, (l) => beamOf(l) > 0.05 * SUN.peak);
        expect(sunset, 'sunset').toBeGreaterThan(20);
        expect(sunrise, 'sunrise').toBeGreaterThan(20);
    });
});

describe('Grainfields day: level-ups', () => {
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
        expect(wheel.level).toBe(2);
    });

    it('turn the day visibly, wherever in the day they come', () => {
        for (let start = 0; start < DAY; start += 5) {
            const wheel = new HourWheel();
            wheel.levelUp(2, start);
            const after = lightOf(wheel, start + TIMING.levelTurn);
            const clockOnly = clockLight(1, start + TIMING.levelTurn);
            expect(distance(after, clockOnly), `level-up at ${start} s`).toBeGreaterThan(0.05);
        }
    });

    // BUG (grainfields-hours.js): the fast sunrise of the clock-only tests above, run thirty times
    // faster: an eased whole station over TIMING.levelTurn moves the place at up to 1.5 × TIMING.hour
    // / TIMING.levelTurn times the clock's pace, so a clock day that kept to Sunset's 0.26 stops a
    // second would keep its level-ups under 7.8. Any level-up from t ≈ 205 s to 300 s at level 1 (the
    // night) carries the sunrise and reaches 8–15 stops a second (High Coast's old wheel: 10); the
    // evening's reach 4.8. With the LINGER knot [3.45, 29.95] every level-up stays under 4.9.
    it('turn the day never in a flash: no faster than the eased turn of a day that keeps to Sunset\'s pace', () => {
        const bound = 1.5 * (TIMING.hour / TIMING.levelTurn) * SUNSET_WORST;
        let worst = 0;
        let worstStart = 0;
        for (let start = 0; start < DAY; start += 5) {
            const wheel = new HourWheel();
            wheel.levelUp(2, start);
            let previous = reads(lightOf(wheel, start));
            for (let t = start + 0.1; t <= start + TIMING.levelTurn + 1e-9; t += 0.1) {
                const now = reads(lightOf(wheel, t));
                for (let i = 0; i < now.length; i++) {
                    const rate = Math.abs(stops(now[i]) - stops(previous[i])) / 0.1;
                    if (rate > worst) {
                        worst = rate;
                        worstStart = start;
                    }
                }
                previous = now;
            }
        }
        expect(worst, `worst for a level-up at ${worstStart} s`).toBeLessThan(bound);
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

    it('never step back, whatever the levels, the new runs and their moments', () => {
        const random = mulberry32(0x9a7e);
        for (let run = 0; run < 40; run++) {
            const wheel = new HourWheel();
            let t = random() * 50;
            let previous = wheel.place(t);
            for (let event = 0; event < 25; event++) {
                const next = t + random() * TIMING.levelTurn * 1.5;
                for (let s = t; s <= next; s += 0.1) {
                    const place = wheel.place(s);
                    expect(place, `run ${run}, t = ${s.toFixed(1)}`).toBeGreaterThanOrEqual(previous - 1e-12);
                    previous = place;
                }
                t = next;
                const roll = random();
                if (roll < 0.15) wheel.newRun();
                else wheel.levelUp(1 + Math.floor(random() * 12), t, roll > 0.9);
            }
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

describe('Grainfields day: the sun', () => {
    it('stands where the real sun stands at 43° north early in September', () => {
        expect(LATITUDE).toBe(43);
        expect(DECLINATION).toBe(5);
        // Highest at noon (90° − 43° + 5°), lowest at midnight (−(90° − 43° − 5°)).
        expect(sunHeightAt(12)).toBeCloseTo(52, 6);
        expect(sunHeightAt(0)).toBeCloseTo(-42, 6);
        expect(sunHeightAt(24)).toBeCloseTo(sunHeightAt(0), 9);
        // It sets a little after a quarter past six and rises a little before a quarter to six.
        expect(sunHeightAt(18.3)).toBeGreaterThan(0);
        expect(sunHeightAt(18.32)).toBeLessThan(0);
        expect(sunHeightAt(5.68)).toBeLessThan(0);
        expect(sunHeightAt(5.7)).toBeGreaterThan(0);
        // Symmetric about noon.
        for (const h of [3, 7.5, 10]) expect(sunHeightAt(12 - h)).toBeCloseTo(sunHeightAt(12 + h), 9);
    });

    it('walks its bearing left to right round the whole day, through every station\'s own, never in a jump', () => {
        HOURS.forEach((hour) => expect(sunBearingAt(hour.at), hour.name).toBeCloseTo(hour.az, 9));
        let previous = lightAt(0).az;
        let turned = 0;
        for (let place = 0.01; place <= HOUR_COUNT + 0.001; place += 0.01) {
            const { az } = lightAt(place);
            expect(az >= -180 && az < 180, `place ${place.toFixed(2)}`).toBe(true);
            const step = azStep(previous, az);
            expect(step, `place ${place.toFixed(2)}`).toBeGreaterThanOrEqual(-1e-9);
            expect(step, `place ${place.toFixed(2)}`).toBeLessThan(10);
            turned += step;
            previous = az;
        }
        // Once round the sky in a day.
        expect(turned).toBeCloseTo(360, 0);
    });

    it('is up at the storm break, the golden hour and the morning, under the horizon at dusk and in the dawn mist', () => {
        HOURS.forEach((hour, i) => {
            const light = lightAt(i);
            expect(Math.hypot(...light.dir), hour.name).toBeCloseTo(1, 9);
            if (i === DUSK || i === DAWN) {
                expect(light.el, hour.name).toBeLessThan(0);
                expect(light.dir[1], hour.name).toBeLessThan(0);
                expect(light.el, hour.name).toBeLessThan(SUN.edge);
                expect(light.sunUp, hour.name).toBe(0);
                expect(luminance(light.sun), hour.name).toBe(0);
            } else {
                expect(light.el, hour.name).toBeGreaterThan(SUN.clear);
                expect(light.dir[1], hour.name).toBeGreaterThan(0);
                expect(light.sunUp, hour.name).toBe(1);
                expect(luminance(light.sun), hour.name).toBeGreaterThan(SUN.peak * 0.5);
            }
        });
    });

    it('stands where the stations were composed: over the gate at the storm break, low on the right in the golden hour, behind the eye at dawn', () => {
        const gate = bearingOf(PLACES.gate.x, PLACES.gate.z).bearing;
        const storm = lightAt(STORM);
        expect(Math.abs(storm.az - gate)).toBeLessThan(10);
        expect(storm.el).toBeGreaterThan(15); // above the fells, behind the deck
        const golden = lightAt(GOLDEN);
        expect(golden.az).toBeGreaterThan(0);
        expect(golden.el).toBeGreaterThan(0);
        expect(golden.el).toBeLessThan(10);
        expect(Math.abs(lightAt(DAWN).az)).toBeGreaterThan(90);
        const morning = lightAt(MORNING);
        expect(morning.az).toBeLessThan(0);
        expect(morning.el).toBeGreaterThan(25);
    });

    it('fades the direct light with the height: gone under the far hills, rising without a step', () => {
        expect(SUN.edge).toBeLessThan(0);
        expect(SUN.clear).toBeGreaterThan(SUN.edge);
        expect(sunStrength(SUN.edge)).toBe(0);
        expect(sunStrength(SUN.edge - 3)).toBe(0);
        expect(sunStrength(Number.NaN)).toBe(0);
        expect(sunStrength(90)).toBeLessThanOrEqual(SUN.peak);
        expect(sunStrength(SUN.edge + SUN.rise)).toBeCloseTo(SUN.peak * (1 - Math.exp(-1)), 9);
        expect(sunClear(SUN.edge)).toBe(0);
        expect(sunClear(SUN.clear)).toBe(1);
        let previous = 0;
        for (let el = SUN.edge; el <= 60; el += 0.05) {
            const beam = sunStrength(el) * sunClear(el);
            expect(beam, `el ${el.toFixed(2)}`).toBeGreaterThanOrEqual(previous);
            // No twentieth of a degree adds more than a fortieth of the peak.
            expect(beam - previous, `el ${el.toFixed(2)}`).toBeLessThan(SUN.peak / 40);
            previous = beam;
        }
    });

    it('crosses the sky between the twilight and the day over several degrees either side of the horizon', () => {
        expect(DAY_HEIGHTS[0]).toBeLessThan(0);
        expect(DAY_HEIGHTS[1]).toBeGreaterThan(0);
        expect(DAY_HEIGHTS[1] - DAY_HEIGHTS[0]).toBeGreaterThan(5);
        expect(dayAt(DAY_HEIGHTS[0])).toBe(0);
        expect(dayAt(DAY_HEIGHTS[1])).toBe(1);
        expect(lightAt(DUSK).day).toBeLessThan(0.05);
        for (const k of [STORM, GOLDEN, MORNING]) expect(lightAt(k).day, HOURS[k].name).toBe(1);
        // The dawn mist is twilight going to day.
        expect(lightAt(DAWN).day).toBeGreaterThan(0);
        expect(lightAt(DAWN).day).toBeLessThan(1);
        for (let place = 0; place < HOUR_COUNT; place += 0.05) {
            const { day, stars } = lightAt(place);
            expect(day >= 0 && day <= 1, `place ${place.toFixed(2)}`).toBe(true);
            expect(stars >= 0 && stars <= 1, `place ${place.toFixed(2)}`).toBe(true);
        }
    });
});

describe('Grainfields day: the palettes', () => {
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

    // BUG (grainfields-hours.js, HOURS): the dawn mist's horizon (rose [0.88, 0.66, 0.70]) and the
    // morning's (blue [0.60, 0.72, 0.86]) are near-complementary, so their linear half-way mix goes
    // grey: [0.74, 0.69, 0.78], chroma 0.115, under the 0.15 High Coast's sky holds (its own grey
    // crossings were 0.095 and 0.108). Every other neighbouring zenith and horizon keeps 0.18 or
    // more. Measured fix: a rose-lilac dawn horizon [0.88, 0.62, 0.76]: the mix with the morning turns
    // lavender (chroma 0.173), with dusk 0.388.
    it('keeps colour in the sky half-way between every pair of neighbouring stations', () => {
        const grey = [];
        for (let h = 0; h < HOUR_COUNT; h++) {
            const a = HOURS[h];
            const b = HOURS[(h + 1) % HOUR_COUNT];
            for (const key of ['zenith', 'horizon']) {
                const half = a[key].map((v, c) => (v + b[key][c]) / 2);
                const c = chroma(half);
                if (!(c > MIN_SKY_CHROMA)) grey.push(`${a.name} → ${b.name}: ${key} chroma ${c.toFixed(3)} [${half.map((v) => v.toFixed(3))}]`);
            }
        }
        expect(grey).toEqual([]);
    });

    it('keeps every colour of every moment finite and non-negative', () => {
        for (let place = 0; place < HOUR_COUNT; place += 0.05) {
            const light = lightAt(place);
            COLOUR_KEYS.forEach((key) => light[key].forEach((v) => {
                expect(v >= 0 && Number.isFinite(v), `place ${place.toFixed(2)}: ${key}`).toBe(true);
            }));
            SCALAR_KEYS.forEach((key) => expect(Number.isFinite(light[key]), `place ${place.toFixed(2)}: ${key}`).toBe(true));
        }
    });

    it('measures chroma as saturation of a linear colour', () => {
        expect(chroma([0, 0, 0])).toBe(0);
        expect(chroma([0.5, 0.5, 0.5])).toBe(0);
        expect(chroma([1, 0, 0])).toBe(1);
        expect(chroma([1, 0.5, 0.5])).toBeCloseTo(0.5, 12);
    });
});

describe('Grainfields day: lights share nothing', () => {
    it('copyLight copies values, never arrays', () => {
        const src = lightAt(2.4);
        const dst = copyLight(src, createLight());
        ARRAY_KEYS.forEach((key) => {
            expect(dst[key], key).not.toBe(src[key]);
            expect(dst[key], key).toEqual(src[key]);
        });
        expect(distance(dst, src)).toBe(0);
        for (const key of ['az', 'el', 'sunUp', 'day', 'cover', 'wind', 'from', 'to', 'mix', 'hour', 'place']) {
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
        for (const key of ['day', 'cover', 'wind', 'exposure']) {
            expect(zero[key], key).toBeCloseTo(a[key], 12);
            expect(one[key], key).toBeCloseTo(b[key], 12);
        }
        expect(one.el).toBeCloseTo(b.el, 12);
        expect(one.az).toBe(a.az);
        expect(Math.hypot(...blendLight(a, b, 0.7).dir)).toBeCloseTo(1, 9);
        expect(blendLight(a, b, 3).cover).toBeCloseTo(b.cover, 12); // k is clamped
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
