/**
 * Sakura Twilight — the airs of the night (sakura-weather.js) and what the light rig makes of
 * them (sakura-light.js): six airs on a clock of their own beside the five hours.
 *
 * Plain numbers, no GPU. Where the source does not do what its contract says the test is kept
 * as `it.fails` under a `// FAULT:` comment, so it turns red the day the source is put right.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SAKURA_HOURS, SAKURA_HOUR_HOLD, SAKURA_HOUR_SECONDS, sakuraHourAt, sakuraHourDrift,
} from '../../src/themes/sakura-twilight/sakura-hours.js';
import { SAKURA_BREEZE, SakuraLight } from '../../src/themes/sakura-twilight/sakura-light.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';
import {
    SAKURA_WEATHERS, SAKURA_WEATHER_HOLD, SAKURA_WEATHER_SCALARS, SAKURA_WEATHER_SECONDS, createSakuraWeather,
    sakuraWeatherAt, sakuraWeatherDrift, sakuraWeatherIndex, sakuraWeatherName,
} from '../../src/themes/sakura-twilight/sakura-weather.js';

const N = SAKURA_WEATHERS.length;
const P = SAKURA_WEATHER_SECONDS;
const HOLD_END = P * SAKURA_WEATHER_HOLD;
const IDS = ['clear', 'wind', 'mackerel', 'haze', 'mist', 'mirror'];
/** The scalars that are a share of something (0..1); the rest scale the garden's own value. */
const SHARES = ['cloud', 'wisps', 'mackerel', 'veil', 'galaxy', 'fall', 'stream', 'calm', 'cap', 'sea', 'banner',
    'fireflies'];
const SCALES = ['drift', 'stars', 'wind', 'mist', 'banks', 'shafts'];
const STEP = 1 / 60;

function seeded(seed = 7) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const rig = (quality = 'Minimal') => new SakuraLight({ tier: sakuraTier(quality), rng: seeded() });

/** Every number the weather and the hour write into the rig, by name. */
function airUniforms(light) {
    return {
        uCloud: light.uCloud.value,
        uWisps: light.uWisps.value,
        uMackerel: light.uMackerel.value,
        uVeil: light.uVeil.value,
        uGalaxy: light.uGalaxy.value,
        uCalm: light.uCalm.value,
        uBanks: light.uBanks.value,
        uCap: light.uCap.value,
        uSea: light.uSea.value,
        uBanner: light.uBanner.value,
        uFireflies: light.uFireflies.value,
        uCloudClock: light.uCloudClock.value,
        uHaze: light.uHaze.value,
        uMist: light.uMist.value,
        uStars: light.uStars.value,
        uWind: light.uWind.value,
        shafts: light.shafts,
    };
}

describe('Sakura Twilight airs of the night', () => {
    it('has six airs in the order the night takes them, each with every number', () => {
        expect(SAKURA_WEATHERS.map((air) => air.id)).toEqual(IDS);
        expect(new Set(SAKURA_WEATHERS.map((air) => air.name)).size).toBe(N);
        expect(Object.isFrozen(SAKURA_WEATHERS)).toBe(true);
        expect(Object.isFrozen(SAKURA_WEATHER_SCALARS)).toBe(true);
        expect([...SAKURA_WEATHER_SCALARS].sort()).toEqual([...SHARES, ...SCALES].sort());
        for (const air of SAKURA_WEATHERS) {
            expect(Object.isFrozen(air), air.id).toBe(true);
            expect(typeof air.name).toBe('string');
            expect(Object.keys(air).sort(), air.id).toEqual(['id', 'name', ...SAKURA_WEATHER_SCALARS].sort());
            for (const key of SAKURA_WEATHER_SCALARS) {
                expect(Number.isFinite(air[key]) && air[key] >= 0, `${air.id}.${key} = ${air[key]}`).toBe(true);
            }
            for (const key of SHARES) expect(air[key], `${air.id}.${key}`).toBeLessThanOrEqual(1);
            // Nothing an air scales runs away: the wind at most doubles or so, the mist a few times.
            for (const key of SCALES) expect(air[key], `${air.id}.${key}`).toBeLessThanOrEqual(4);
            // The cloud always travels (a sky that stood still would read as a painted one).
            expect(air.drift, air.id).toBeGreaterThan(0);
        }
    });

    it('opens on the clear evening: the garden as it was built, every scale at one', () => {
        const [clear] = SAKURA_WEATHERS;
        expect(clear.id).toBe('clear');
        for (const key of SCALES) expect(clear[key], key).toBe(1);
        // All of the crowns' petals fall, the wind itself keeps no blizzard going, no veil, no scales.
        expect(clear).toMatchObject({
            fall: 1, stream: 0, veil: 0, mackerel: 0, wisps: 1, cap: 0,
        });
        // And at time zero the clock stands on it.
        expect(sakuraWeatherDrift(0)).toBe(0);
        expect(sakuraWeatherName(sakuraWeatherDrift(0))).toBe(clear.name);
    });

    it('gives every air a look of its own: each differs from the next in several numbers', () => {
        for (let index = 0; index < N; index += 1) {
            const a = SAKURA_WEATHERS[index];
            const b = SAKURA_WEATHERS[(index + 1) % N];
            const moved = SAKURA_WEATHER_SCALARS.filter((key) => Math.abs(a[key] - b[key]) > 0.15);
            expect(moved.length, `${a.id} -> ${b.id}: ${moved}`).toBeGreaterThanOrEqual(4);
        }
        // Each of the things an air can show is shown, whole, by at least one air.
        for (const key of ['mackerel', 'veil', 'cap', 'sea', 'banner', 'calm', 'galaxy', 'fireflies']) {
            expect(Math.max(...SAKURA_WEATHERS.map((air) => air[key])), key).toBe(1);
        }
        expect(Math.max(...SAKURA_WEATHERS.map((air) => air.stream))).toBeGreaterThan(0.3);
    });

    it('hands out a place for an air with every number at zero', () => {
        const place = createSakuraWeather();
        expect(Object.keys(place).sort()).toEqual([...SAKURA_WEATHER_SCALARS].sort());
        expect(Object.values(place).every((value) => value === 0)).toBe(true);
        expect(createSakuraWeather()).not.toBe(place);
    });

    it('is each air exactly on a whole phase, coming round after the last', () => {
        SAKURA_WEATHERS.forEach((air, index) => {
            for (const turns of [0, 1, -1, 7, -13, 1e6]) {
                const at = sakuraWeatherAt(index + N * turns);
                for (const key of SAKURA_WEATHER_SCALARS) expect(at[key], `${air.id}.${key} @${turns}`).toBe(air[key]);
            }
            expect(Object.keys(sakuraWeatherAt(index)).sort()).toEqual([...SAKURA_WEATHER_SCALARS].sort());
        });
        // It fills the place it is given and returns that, and makes one when given none.
        const place = createSakuraWeather();
        expect(sakuraWeatherAt(3, place)).toBe(place);
        expect(place.veil).toBe(SAKURA_WEATHERS[3].veil);
        expect(sakuraWeatherAt(2)).not.toBe(sakuraWeatherAt(2));
    });

    it('crosses from one air to the next in a straight line, never outside the two', () => {
        for (let index = 0; index < N; index += 1) {
            const a = SAKURA_WEATHERS[index];
            const b = SAKURA_WEATHERS[(index + 1) % N];
            for (const melt of [0.001, 0.25, 0.5, 0.75, 0.999]) {
                const at = sakuraWeatherAt(index + melt);
                for (const key of SAKURA_WEATHER_SCALARS) {
                    expect(at[key], `${a.id}+${melt} ${key}`).toBeCloseTo(a[key] + (b[key] - a[key]) * melt, 12);
                    expect(at[key]).toBeGreaterThanOrEqual(Math.min(a[key], b[key]) - 1e-12);
                    expect(at[key]).toBeLessThanOrEqual(Math.max(a[key], b[key]) + 1e-12);
                }
            }
        }
        // Negative phases come round the same wheel (half way back from clear is half way to it from mirror).
        const back = sakuraWeatherAt(-0.5);
        const round = sakuraWeatherAt(N - 0.5);
        for (const key of SAKURA_WEATHER_SCALARS) expect(back[key], key).toBeCloseTo(round[key], 12);
    });

    it('never steps: a small turn of the phase is a small change in every number, all the way round', () => {
        const before = createSakuraWeather();
        const after = createSakuraWeather();
        const step = 0.002;
        // (The biggest crossing is the mist's, 0.55 to 3.1 between two airs: 2.6 a phase.)
        for (let phase = -1; phase < N + 1; phase += step) {
            sakuraWeatherAt(phase, before);
            sakuraWeatherAt(phase + step, after);
            for (const key of SAKURA_WEATHER_SCALARS) {
                expect(Math.abs(after[key] - before[key]), `${key} @${phase.toFixed(3)}`).toBeLessThan(3.2 * step);
            }
        }
    });

    it('reads nonsense as the first air, and stays finite at any phase', () => {
        const [first] = SAKURA_WEATHERS;
        for (const phase of [NaN, Infinity, -Infinity, undefined, null, 'mist', {}, []]) {
            const at = sakuraWeatherAt(phase);
            for (const key of SAKURA_WEATHER_SCALARS) expect(at[key], `${String(phase)} ${key}`).toBe(first[key]);
        }
        for (const phase of [1e6 + 0.37, -1e6 - 0.37, 1e15 + 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE,
            -Number.MAX_VALUE, Number.MIN_VALUE, -0]) {
            const at = sakuraWeatherAt(phase);
            for (const key of SAKURA_WEATHER_SCALARS) {
                expect(Number.isFinite(at[key]) && at[key] >= 0, `${phase} ${key} = ${at[key]}`).toBe(true);
                expect(at[key]).toBeLessThanOrEqual(Math.max(...SAKURA_WEATHERS.map((air) => air[key])));
            }
        }
    });
});

describe('Sakura Twilight weather clock', () => {
    it('keeps a house pace of its own: an air holds, then turns, and the hours take a different time', () => {
        expect(P).toBe(84);
        expect(SAKURA_WEATHER_HOLD).toBeGreaterThanOrEqual(0.3);
        expect(SAKURA_WEATHER_HOLD).toBeLessThanOrEqual(0.5);
        expect(P).not.toBe(SAKURA_HOUR_SECONDS);
        // Neither period is a whole number of the other: they slide past each other.
        expect(Number.isInteger(SAKURA_HOUR_SECONDS / P)).toBe(false);
        expect(Number.isInteger(P / SAKURA_HOUR_SECONDS)).toBe(false);
        // And the whole rounds differ too (six airs, five hours).
        expect(N * P).not.toBe(SAKURA_HOURS.length * SAKURA_HOUR_SECONDS);
    });

    it('holds each air, eases to the next and is whole again a period on', () => {
        expect(sakuraWeatherDrift(0)).toBe(0);
        expect(sakuraWeatherDrift(HOLD_END - 0.5)).toBe(0);
        expect(sakuraWeatherDrift(HOLD_END + 0.5)).toBeGreaterThan(0);
        expect(sakuraWeatherDrift(P)).toBe(1);
        expect(sakuraWeatherDrift(3 * P + 1)).toBe(3);
        expect(sakuraWeatherDrift(N * P)).toBe(N);
        const middle = sakuraWeatherDrift(HOLD_END + (P - HOLD_END) / 2);
        expect(middle).toBeCloseTo(0.5, 9);
        // The turn is eased at both ends: slow out of the hold, slow into the next air.
        expect(sakuraWeatherDrift(HOLD_END + 1)).toBeLessThan(0.01);
        expect(sakuraWeatherDrift(P - 1)).toBeGreaterThan(0.99);
    });

    it('never runs back and never jumps, over two whole rounds of the airs', () => {
        let last = 0;
        let steepest = 0;
        for (let t = 0; t <= 2 * N * P; t += 0.25) {
            const phase = sakuraWeatherDrift(t);
            expect(phase).toBeGreaterThanOrEqual(last);
            steepest = Math.max(steepest, phase - last);
            last = phase;
        }
        // A smoothstep over the turn's 50 s is at its steepest 1.5 / 50.4 a second.
        expect(steepest).toBeLessThan(0.25 * (1.5 / (P - HOLD_END)) + 1e-9);
        expect(last).toBe(2 * N);
    });

    it('is a function of the time alone, and a clock that never started reads as the opening', () => {
        for (const t of [0.1, 33.3, 84, 500.5, 5000]) expect(sakuraWeatherDrift(t)).toBe(sakuraWeatherDrift(t));
        for (const t of [-1, -1e9, NaN, undefined, null, 'soon', {}, []]) {
            expect(sakuraWeatherDrift(t), String(t)).toBe(0);
        }
    });

    it('stays finite, in step and unbroken after days and after ages', () => {
        for (const start of [1e6, 86400 * 30, 1e9]) {
            let last = sakuraWeatherDrift(start);
            expect(Number.isFinite(last)).toBe(true);
            expect(last).toBeGreaterThanOrEqual(Math.floor(start / P));
            expect(last).toBeLessThanOrEqual(Math.floor(start / P) + 1);
            for (let frame = 1; frame <= 60 * 120; frame += 1) {
                const phase = sakuraWeatherDrift(start + frame * STEP);
                expect(phase).toBeGreaterThanOrEqual(last);
                // (At a billion seconds a double still tells frames apart to a few microseconds.)
                expect(phase - last).toBeLessThan(0.002);
                last = phase;
            }
            const air = sakuraWeatherAt(last);
            for (const key of SAKURA_WEATHER_SCALARS) {
                expect(Number.isFinite(air[key]) && air[key] >= 0, `${start} ${key}`).toBe(true);
            }
            expect(SAKURA_WEATHERS.map((entry) => entry.name)).toContain(sakuraWeatherName(last));
        }
        // The hours beside it, at the same great times.
        for (const t of [1e6, 1e9]) {
            const phase = sakuraHourDrift(t);
            expect(Number.isFinite(phase)).toBe(true);
            const hour = sakuraHourAt(phase);
            for (const value of Object.values(hour).flat()) expect(Number.isFinite(value) && value >= 0).toBe(true);
        }
    });

    it('does not keep step with the hours: within two hours every air has met every hour', () => {
        const met = new Set();
        const together = [];
        for (let t = 0; t < 7200; t += 1) {
            const air = Math.round(sakuraWeatherDrift(t)) % N;
            const hour = Math.round(sakuraHourDrift(t)) % SAKURA_HOURS.length;
            met.add(`${air}/${hour}`);
            // The two begin to turn at different moments: both at rest and both turning are seen.
            const airTurning = sakuraWeatherDrift(t) % 1 !== 0;
            const hourTurning = sakuraHourDrift(t) % 1 !== 0;
            together.push(`${airTurning}/${hourTurning}`);
        }
        expect(met.size).toBe(N * SAKURA_HOURS.length);
        expect(new Set(together).size).toBe(4);
        // After the first, no two turns of the air and the hour begin together for a long while.
        const airStarts = Array.from({ length: 40 }, (_, k) => (k + SAKURA_WEATHER_HOLD) * P);
        const hourStarts = Array.from({ length: 40 }, (_, k) => (k + SAKURA_HOUR_HOLD) * SAKURA_HOUR_SECONDS);
        for (const a of airStarts) {
            for (const h of hourStarts) expect(Math.abs(a - h), `${a} / ${h}`).toBeGreaterThan(0.5);
        }
    });

    it('names the air a phase is nearest, round the wheel', () => {
        SAKURA_WEATHERS.forEach((air, index) => {
            expect(sakuraWeatherName(index)).toBe(air.name);
            expect(sakuraWeatherName(index + 0.3)).toBe(air.name);
            expect(sakuraWeatherName(index - 0.3)).toBe(air.name);
            expect(sakuraWeatherName(index + N * 4)).toBe(air.name);
            expect(sakuraWeatherName(index - N * 4)).toBe(air.name);
        });
        for (const phase of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
            expect(sakuraWeatherName(phase)).toBe(SAKURA_WEATHERS[0].name);
        }
        expect(SAKURA_WEATHERS.map((air) => air.name)).toContain(sakuraWeatherName(1e300));
    });
});

describe('Sakura Twilight weather by name or number', () => {
    it('finds an air by its id, whatever the case', () => {
        IDS.forEach((id, index) => {
            expect(sakuraWeatherIndex(id)).toBe(index);
            expect(sakuraWeatherIndex(id.toUpperCase())).toBe(index);
            expect(sakuraWeatherIndex(id[0].toUpperCase() + id.slice(1))).toBe(index);
        });
    });

    it('takes a number, or a number written out, rounding and coming round', () => {
        for (let index = 0; index < N; index += 1) {
            expect(sakuraWeatherIndex(index)).toBe(index);
            expect(sakuraWeatherIndex(String(index))).toBe(index);
            expect(sakuraWeatherIndex(index + N)).toBe(index);
            expect(sakuraWeatherIndex(index - N * 3)).toBe(index);
            expect(sakuraWeatherIndex(index + 0.4)).toBe(index);
        }
        expect(sakuraWeatherIndex(-1)).toBe(N - 1);
        expect(sakuraWeatherIndex(N - 0.5)).toBe(0);
        expect(Object.is(sakuraWeatherIndex(-0.4), -0)).toBe(false);
        for (const huge of [1e9, -1e9, 1e300, -1e300, Number.MAX_SAFE_INTEGER]) {
            const index = sakuraWeatherIndex(huge);
            expect(Number.isInteger(index) && index >= 0 && index < N, String(huge)).toBe(true);
        }
    });

    it('is null for nothing and for what is neither an id nor a number', () => {
        for (const value of [null, undefined, '', 'garbage', 'clear evening', 'winds', ' wind ', NaN, Infinity,
            -Infinity, '1e400', {}, { id: 'mist' }, () => 2, 'NaN', '--1']) {
            expect(sakuraWeatherIndex(value), String(value)).toBeNull();
        }
    });

    // FAULT: sakura-weather.js sakuraWeatherIndex() — Number(' ') and Number([]) are 0 and
    // Number(true) is 1, so blank text, an empty list and a boolean pin an air instead of handing
    // the weather back to the clock (`?weather=%20` holds the clear evening still). The contract:
    // null for null, '' and garbage.
    it.fails('is null for blank text, a list and a boolean too', () => {
        const pinned = [' ', '\t', [], true, false].filter((value) => sakuraWeatherIndex(value) !== null);
        expect(pinned).toEqual([]);
    });
});

describe('Sakura Twilight light rig weather', () => {
    it('opens on the first air: every uniform the weather owns is the clear evening\'s', () => {
        const light = rig();
        const [clear] = SAKURA_WEATHERS;
        expect(light.weatherPhase).toBe(0);
        expect(light.uCloud.value).toBe(clear.cloud);
        expect(light.uWisps.value).toBe(clear.wisps);
        expect(light.uMackerel.value).toBe(clear.mackerel);
        expect(light.uVeil.value).toBe(clear.veil);
        expect(light.uCalm.value).toBe(clear.calm);
        expect(light.uBanks.value).toBe(clear.banks);
        expect(light.uCap.value).toBe(clear.cap);
        expect(light.uSea.value).toBe(clear.sea);
        expect(light.uBanner.value).toBe(clear.banner);
        expect(light.uFireflies.value).toBe(clear.fireflies);
        expect(light.uCloudClock.value).toBe(0);
        expect(light.shafts).toBe(1);
        // What the hour and the air share is the hour's own: the first air scales none of it.
        expect(light.uHaze.value).toBe(SAKURA_HOURS[0].haze);
        expect(light.uMist.value).toBe(SAKURA_HOURS[0].mist);
        expect(light.uStars.value).toBe(SAKURA_HOURS[0].stars);
        // Where the moon stands, as the sky's cloud is drawn: its azimuth right of -Z and the sine
        // of its elevation.
        const moon = light.uMoonDir.value;
        expect(light.uMoonAzEl.value.x).toBeCloseTo(Math.atan2(moon.x, -moon.z), 12);
        expect(light.uMoonAzEl.value.y).toBeCloseTo(moon.y, 12);
        light.setMoon(4, 27);
        expect(light.uMoonAzEl.value.x).toBeCloseTo(THREE.MathUtils.degToRad(4), 9);
        expect(light.uMoonAzEl.value.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(27)), 9);
        light.dispose();
    });

    // FAULT: sakura-light.js constructor (`this.uGalaxy = uniform(0)`, line 122) never calls
    // paintAir(): a rig that has not yet been given an hour or an air shows no river of heaven
    // (uGalaxy 0, not hour.galaxy x weather.galaxy = 0.22) and has no `mistAtRest`, so update()
    // cannot close the mist in at game over. SakuraWorld sets both every frame before the first
    // draw, so the game never shows it; a rig used by itself (a probe, a capture, these tests) does.
    it.fails('opens with the river of heaven and the mist the first hour and air give it', () => {
        const light = rig();
        expect(light.uGalaxy.value).toBeCloseTo(SAKURA_HOURS[0].galaxy * SAKURA_WEATHERS[0].galaxy, 12);
        light.update(0, { hush: 1 });
        expect(light.uMist.value).toBeCloseTo(SAKURA_HOURS[0].mist * 2.5, 12);
        light.dispose();
    });

    it('is the garden at rest at time zero: an empty frame leaves the resting breeze and no clock', () => {
        const light = rig();
        light.setHour(0);
        light.setWeather(0);
        const before = airUniforms(light);
        light.update(0, {});
        expect(light.uWind.value).toBe(SAKURA_BREEZE);
        expect(light.uGust.value).toBe(0);
        expect(light.uCloudClock.value).toBe(0);
        expect(airUniforms(light)).toEqual({ ...before, uWind: SAKURA_BREEZE });
        // Setting the first air again changes nothing at all.
        light.setWeather(0);
        light.update(0, {});
        expect(airUniforms(light)).toEqual({ ...before, uWind: SAKURA_BREEZE });
        expect(light.uGalaxy.value).toBeCloseTo(SAKURA_HOURS[0].galaxy * SAKURA_WEATHERS[0].galaxy, 12);
        light.dispose();
    });

    it('wears each air exactly, with every hour: the mist, the stars, the river and the shafts are shared', () => {
        const light = rig();
        for (let h = 0; h < SAKURA_HOURS.length; h += 1) {
            for (let w = 0; w < N; w += 1) {
                const hour = SAKURA_HOURS[h];
                const air = SAKURA_WEATHERS[w];
                light.setHour(h);
                expect(light.setWeather(w)).toBe(light.weather);
                light.update(10, {});
                const label = `${hour.name} / ${air.id}`;
                expect(light.weatherPhase, label).toBe(w);
                expect(light.uCloud.value, label).toBe(air.cloud);
                expect(light.uWisps.value, label).toBe(air.wisps);
                expect(light.uMackerel.value, label).toBe(air.mackerel);
                expect(light.uVeil.value, label).toBe(air.veil);
                expect(light.uCalm.value, label).toBe(air.calm);
                expect(light.uCap.value, label).toBe(air.cap);
                expect(light.uSea.value, label).toBe(air.sea);
                expect(light.uBanner.value, label).toBe(air.banner);
                expect(light.uBanks.value, label).toBeCloseTo(air.banks, 12);
                expect(light.uFireflies.value, label).toBeCloseTo(air.fireflies, 12);
                expect(light.uMist.value, label).toBeCloseTo(hour.mist * air.mist, 12);
                expect(light.uStars.value, label).toBeCloseTo(hour.stars * air.stars, 12);
                expect(light.uGalaxy.value, label).toBeCloseTo(Math.min(1, hour.galaxy * air.galaxy), 12);
                expect(light.uHaze.value, label).toBeCloseTo(hour.haze * (1 + 0.3 * air.veil), 12);
                expect(light.shafts, label).toBeCloseTo(hour.beams * air.shafts, 12);
                expect(light.uGalaxy.value).toBeLessThanOrEqual(1);
            }
        }
        light.dispose();
    });

    it('keeps the phase it had when given nonsense', () => {
        const light = rig();
        light.setWeather(4);
        for (const phase of [NaN, Infinity, -Infinity, undefined, null, 'mist', {}]) {
            light.setWeather(phase);
            expect(light.weatherPhase, String(phase)).toBe(4);
            expect(light.uCap.value).toBe(SAKURA_WEATHERS[4].cap);
        }
        light.dispose();
    });

    it('stays finite and inside its ranges at every phase of both clocks, great times included', () => {
        const light = rig();
        const top = (key) => Math.max(...SAKURA_WEATHERS.map((air) => air[key]));
        const check = (label) => {
            const values = airUniforms(light);
            for (const [key, value] of Object.entries(values)) {
                expect(Number.isFinite(value) && value >= 0, `${label} ${key} = ${value}`).toBe(true);
            }
            for (const [uniform, key] of [['uCloud', 'cloud'], ['uWisps', 'wisps'], ['uMackerel', 'mackerel'],
                ['uVeil', 'veil'], ['uCalm', 'calm'], ['uCap', 'cap'], ['uSea', 'sea'], ['uBanner', 'banner'],
                ['uFireflies', 'fireflies']]) {
                expect(values[uniform], `${label} ${uniform}`).toBeLessThanOrEqual(top(key));
            }
            expect(values.uGalaxy, label).toBeLessThanOrEqual(1);
            expect(values.uBanks, label).toBeLessThanOrEqual(top('banks') * 1.9 + 1e-9);
            expect(values.uStars, label).toBeLessThanOrEqual(1.35 * 1.3 + 1e-9);
            expect(values.uMist, label).toBeLessThanOrEqual(0.0045 * 3.1 * 2.5 + 1e-9);
            expect(values.uWind, label).toBeLessThanOrEqual(SAKURA_BREEZE * top('wind') + 0.13 + 1e-9);
        };
        for (let t = 0; t < 2 * 550; t += 1.7) {
            light.setHour(sakuraHourDrift(t));
            light.setWeather(sakuraWeatherDrift(t));
            light.update(t, { hush: (t % 7) / 7, level: (t % 3) / 3, fever: (t % 5) / 5 });
            check(`t=${t.toFixed(1)}`);
        }
        for (const t of [1e6, 1e6 + 40, 1e6 + 60, 86400 * 365]) {
            light.setHour(sakuraHourDrift(t));
            light.setWeather(sakuraWeatherDrift(t));
            light.update(t, {});
            check(`t=${t}`);
            expect(light.uTime.value).toBe(t);
        }
        light.dispose();
    });

    it('lets the air set the breeze, and holds a fresh wind to the garden\'s own under Reduce motion', () => {
        const light = rig();
        const windy = SAKURA_WEATHERS.findIndex((air) => air.id === 'wind');
        const still = SAKURA_WEATHERS.findIndex((air) => air.id === 'mirror');
        light.setWeather(windy);
        light.update(1, {});
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE * SAKURA_WEATHERS[windy].wind, 12);
        light.update(1, { motion: 0 });
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE, 12);
        light.update(1, { motion: 0.35 });
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE * (1 + (SAKURA_WEATHERS[windy].wind - 1) * 0.35), 12);
        // A still air is less motion, not more: it is still under Reduce motion as well.
        light.setWeather(still);
        light.update(1, { motion: 0 });
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE * SAKURA_WEATHERS[still].wind, 12);
        light.update(1, {});
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE * SAKURA_WEATHERS[still].wind, 12);
        // Hot play freshens whatever the air set, and the game's end stills it.
        light.setWeather(0);
        light.update(1, { level: 1, fever: 1 });
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE + 0.13, 12);
        light.update(1, { level: 1, fever: 1, hush: 1 });
        expect(light.uWind.value).toBeCloseTo(SAKURA_BREEZE * 0.4, 12);
        light.dispose();
    });

    it('closes the mist in, thickens the banks and settles the fireflies when the game ends, in any air', () => {
        const light = rig();
        for (let w = 0; w < N; w += 1) {
            const air = SAKURA_WEATHERS[w];
            light.setHour(3);
            light.setWeather(w);
            for (const hush of [0, 0.3, 1]) {
                light.update(5, { hush });
                expect(light.uMist.value, air.id).toBeCloseTo(SAKURA_HOURS[3].mist * air.mist * (1 + 1.5 * hush), 12);
                expect(light.uBanks.value, air.id).toBeCloseTo(air.banks * (1 + 0.9 * hush), 12);
                expect(light.uFireflies.value, air.id).toBeCloseTo(air.fireflies * (1 - 0.6 * hush), 12);
            }
            // Out-of-range and nonsense hush is no hush or all of it, never more.
            light.update(5, { hush: 7 });
            expect(light.uMist.value).toBeCloseTo(SAKURA_HOURS[3].mist * air.mist * 2.5, 12);
            for (const hush of [-3, NaN, 'x', null, undefined, Infinity]) {
                light.update(5, { hush });
                expect(light.uMist.value, String(hush)).toBeCloseTo(SAKURA_HOURS[3].mist * air.mist, 12);
                expect(light.uFireflies.value, String(hush)).toBeCloseTo(air.fireflies, 12);
            }
        }
        light.dispose();
    });
});

describe('Sakura Twilight cloud clock', () => {
    it('counts seconds of travel at the air\'s own pace', () => {
        const light = rig();
        light.setWeather(0);
        light.update(0, {});
        for (let frame = 1; frame <= 600; frame += 1) light.update(frame * STEP, {});
        // At the resting pace it is the clock itself.
        expect(light.uCloudClock.value).toBeCloseTo(10, 9);
        const windy = SAKURA_WEATHERS.findIndex((air) => air.id === 'wind');
        light.setWeather(windy);
        for (let frame = 601; frame <= 1200; frame += 1) light.update(frame * STEP, {});
        expect(light.uCloudClock.value).toBeCloseTo(10 + 10 * SAKURA_WEATHERS[windy].drift, 9);
        // Changing the pace moved nothing by itself.
        const here = light.uCloudClock.value;
        light.setWeather(5);
        expect(light.uCloudClock.value).toBe(here);
        light.update(20, {});
        expect(light.uCloudClock.value).toBe(here);
        light.dispose();
    });

    it('never jumps and never runs back through ten minutes of turning weather, at any frame rate', () => {
        const slowest = Math.min(...SAKURA_WEATHERS.map((air) => air.drift));
        const fastest = Math.max(...SAKURA_WEATHERS.map((air) => air.drift));
        for (const fps of [30, 60, 144]) {
            const light = rig();
            const dt = 1 / fps;
            light.update(0, {});
            let last = light.uCloudClock.value;
            let sum = 0;
            for (let frame = 1; frame <= 600 * fps; frame += 1) {
                const t = frame * dt;
                light.setHour(sakuraHourDrift(t));
                light.setWeather(sakuraWeatherDrift(t));
                light.update(t, {});
                const moved = light.uCloudClock.value - last;
                // Exactly this frame's time at this frame's pace: between the calmest and the windiest.
                expect(moved).toBeGreaterThanOrEqual(slowest * dt - 1e-9);
                expect(moved).toBeLessThanOrEqual(fastest * dt + 1e-9);
                sum += light.weather.drift * dt;
                last = light.uCloudClock.value;
            }
            expect(last).toBeCloseTo(sum, 6);
            light.dispose();
        }
        // The same night at 30 and at 144 frames a second carries the cloud to the same place.
        const carried = [30, 144].map((fps) => {
            const light = rig();
            for (let frame = 0; frame <= 300 * fps; frame += 1) {
                const t = frame / fps;
                light.setWeather(sakuraWeatherDrift(t));
                light.update(t, {});
            }
            const { value } = light.uCloudClock;
            light.dispose();
            return value;
        });
        expect(Math.abs(carried[0] - carried[1])).toBeLessThan(0.5);
    });

    it('stands still while the clock does, and lands on the clock when it went back or jumped', () => {
        const light = rig();
        const windy = SAKURA_WEATHERS.findIndex((air) => air.id === 'wind');
        light.setWeather(windy);
        light.update(0, {});
        for (let frame = 1; frame <= 300; frame += 1) light.update(frame * STEP, {});
        const carried = light.uCloudClock.value;
        expect(carried).toBeCloseTo(5 * SAKURA_WEATHERS[windy].drift, 9);
        // A paused clock, a frame drawn twice, a clock that is nonsense: the cloud stays put.
        for (const time of [5, 5, NaN, undefined, Infinity, 'later', null]) {
            light.update(time, {});
            expect(light.uCloudClock.value, String(time)).toBe(carried);
        }
        // Half a second is still a frame (a slow one); more is a seek.
        light.update(5.5, {});
        expect(light.uCloudClock.value).toBeCloseTo(carried + 0.5 * SAKURA_WEATHERS[windy].drift, 9);
        light.update(6.01, {});
        expect(light.uCloudClock.value).toBe(6.01);
        light.update(300, {});
        expect(light.uCloudClock.value).toBe(300);
        // Back: a new run, a seek.
        light.update(12, {});
        expect(light.uCloudClock.value).toBe(12);
        // A negative clock is the opening (the rig's clock never goes below zero).
        light.update(-40, {});
        expect(light.uTime.value).toBe(0);
        expect(light.uCloudClock.value).toBe(0);
        // The first frame of a rig built late (a rebuild that carries the clock) lands on it too.
        const late = rig();
        late.update(4321, {});
        expect(late.uCloudClock.value).toBe(4321);
        late.dispose();
        light.dispose();
    });
});

describe('Sakura Twilight lens and the weather', () => {
    function lens(light) {
        return new SakuraPost({
            renderer: { isWebGPURenderer: true },
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            quality: 'Minimal',
            light,
        });
    }

    it('rests the beams at the density the hour and the air give the moon\'s shafts', () => {
        const light = rig();
        const post = lens(light);
        post.update({});
        expect(post.uBeams.value).toBe(1);
        for (let h = 0; h < SAKURA_HOURS.length; h += 1) {
            for (let w = 0; w < N; w += 1) {
                light.setHour(h);
                light.setWeather(w);
                post.update({});
                expect(post.uBeams.value).toBeCloseTo(SAKURA_HOURS[h].beams * SAKURA_WEATHERS[w].shafts, 12);
                expect(post.uBeams.value).toBe(light.shafts);
            }
        }
        // An event's flare and the crown open them further, from wherever they rest.
        const rest = post.uBeams.value;
        post.update({ moon: 1, crown: 1 });
        expect(post.uBeams.value).toBeGreaterThan(rest + 0.5);
        // The thickest shafts of all: the moonlit night in a mist.
        const densest = Math.max(...SAKURA_HOURS.map((hour) => hour.beams))
            * Math.max(...SAKURA_WEATHERS.map((air) => air.shafts));
        expect(densest).toBeLessThan(4);
        post.dispose();
        light.dispose();
    });

    it('dims the garden a little when the game ends, and no further for nonsense', () => {
        const light = rig();
        const post = lens(light);
        post.update({});
        const rest = post.uExposure.value;
        post.update({ hush: 1 });
        expect(post.uExposure.value).toBeCloseTo(rest * 0.86, 12);
        post.update({ hush: 0.5 });
        expect(post.uExposure.value).toBeCloseTo(rest * 0.93, 12);
        for (const hush of [9, Infinity]) {
            post.update({ hush });
            expect(post.uExposure.value, String(hush)).toBeGreaterThanOrEqual(rest * 0.86 - 1e-12);
        }
        for (const hush of [-2, NaN, 'x', null]) {
            post.update({ hush });
            expect(post.uExposure.value, String(hush)).toBeCloseTo(rest, 12);
        }
        // A lens with no rig rests its beams at one.
        const bare = new SakuraPost({
            renderer: { isWebGPURenderer: true },
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            quality: 'Minimal',
        });
        bare.update({});
        expect(bare.uBeams.value).toBe(1);
        bare.dispose();
        post.dispose();
        light.dispose();
    });
});
