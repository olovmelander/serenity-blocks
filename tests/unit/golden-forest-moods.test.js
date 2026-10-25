/**
 * Golden Forest — the lake's hour turns by the clock in every mode, and a level is one hour on
 * top (golden-forest-moods.js, GoldenForestLight.setMood; the world's step is in
 * golden-forest-world.test.js, where the world can be built with its assets).
 *
 * Only a single-player run and the Odyssey level up; everywhere else the clock alone must carry
 * the lake through its hours. Timings are read from the module, never copied.
 */

import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    GOLDEN_FOREST_MOODS, GOLDEN_FOREST_MOOD_COLOURS, GOLDEN_FOREST_MOOD_HOLD, GOLDEN_FOREST_MOOD_SCALARS,
    GOLDEN_FOREST_MOOD_SECONDS, createGoldenForestMood, goldenForestMoodAt, goldenForestMoodDrift,
    goldenForestMoodName,
} from '../../src/themes/golden-forest/golden-forest-moods.js';
import { GoldenForestLight } from '../../src/themes/golden-forest/golden-forest-light.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';

const N = GOLDEN_FOREST_MOODS.length;
const PERIOD = GOLDEN_FOREST_MOOD_SECONDS;
const HOLD = GOLDEN_FOREST_MOOD_HOLD;
/** The middle of hour `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + HOLD * 0.5) * PERIOD;
const melting = (k) => (k + HOLD + (1 - HOLD) * 0.5) * PERIOD;
/** The rig's uniform for each colour an hour sets directly (play deepens the others). */
const UNIFORM = {
    skyLight: 'uSkyLight',
    bounce: 'uBounce',
    skyAway: 'uSkyAway',
    hazeCool: 'uHazeCool',
    cloudEmber: 'uCloudEmber',
    cloudGlow: 'uCloudGlow',
    cloudDusk: 'uCloudDusk',
    cloudHigh: 'uCloudHigh',
    cloudGilt: 'uCloudGilt',
    shaftShade: 'uShaftShade',
    shaftSun: 'uShaftSun',
};
/** ...and the colours play deepens, as the rig holds them at rest and as it shows them. */
const DEEPENED = {
    sun: ['sun', 'uSunColor'],
    skyToward: ['toward', 'uSkyToward'],
    skyMid: ['mid', 'uSkyMid'],
    zenith: ['zenith', 'uZenith'],
    hazeWarm: ['hazeWarm', 'uHazeWarm'],
};
/** The largest difference in any channel of the key colours of two hours. */
const apart = (a, b) => Math.max(...['sun', 'zenith', 'skyMid', 'skyToward', 'hazeCool', 'hazeWarm']
    .flatMap((key) => a[key].map((c, i) => Math.abs(c - b[key][i]))));
/** What the rig shows now, as an hour's colours. */
const shown = (light) => Object.fromEntries(GOLDEN_FOREST_MOOD_COLOURS.map((key) => [key, (
    UNIFORM[key] ? light[UNIFORM[key]] : light[DEEPENED[key][1]]).value.toArray()]));
/** An hour's colours, as shown() reads them. */
const colours = (mood) => Object.fromEntries(GOLDEN_FOREST_MOOD_COLOURS.map((key) => [key, [...mood[key]]]));

const owned = [];
afterEach(() => {
    while (owned.length) owned.pop().dispose();
});

function createLight(quality = 'Minimal') {
    let state = 271;
    const rng = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const light = new GoldenForestLight({ tier: GOLDEN_FOREST_TIERS[quality], rng });
    owned.push(light);
    return light;
}

describe('Golden Forest hours: the table', () => {
    it('opens on the golden hour the lake was built with', () => {
        const light = createLight();
        const first = GOLDEN_FOREST_MOODS[0];
        expect(shown(light)).toEqual(colours(first));
        expect(light.uHaze.value).toBe(first.haze);
        expect(light.resting.haze).toBe(first.haze);
        expect(first.exposure).toBe(1);
        expect(first.name).toBe('golden hour');
        // And a frame of it is that hour still, to the last digit.
        light.setMood(0);
        light.update(1, {}, null, null);
        expect(shown(light)).toEqual(colours(first));
        expect(light.uHaze.value).toBe(first.haze);
    });

    it('has four to six hours, each whole, finite and distinct from its neighbours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        const names = new Set();
        GOLDEN_FOREST_MOODS.forEach((mood, k) => {
            names.add(mood.name);
            for (const key of GOLDEN_FOREST_MOOD_COLOURS) {
                expect(mood[key], `${mood.name} ${key}`).toHaveLength(3);
                expect(mood[key].every((c) => Number.isFinite(c) && c >= 0), `${mood.name} ${key}`).toBe(true);
            }
            for (const key of GOLDEN_FOREST_MOOD_SCALARS) expect(Number.isFinite(mood[key]), key).toBe(true);
            // Air that never milks the lake over, and an exposure that only leans the lens.
            expect(mood.haze).toBeGreaterThan(0);
            expect(mood.haze).toBeLessThanOrEqual(0.003);
            expect(Math.abs(mood.exposure - 1)).toBeLessThan(0.25);
            expect(apart(mood, GOLDEN_FOREST_MOODS[(k + 1) % N]), mood.name).toBeGreaterThan(0.1);
        });
        expect(names.size).toBe(N);
    });

    it('is each hour exactly on a whole phase, and melts between two of them', () => {
        const out = createGoldenForestMood();
        for (let k = -N; k < N * 2; k++) {
            const mood = GOLDEN_FOREST_MOODS[((k % N) + N) % N];
            goldenForestMoodAt(k, out);
            for (const key of GOLDEN_FOREST_MOOD_COLOURS) expect(out[key], `${k} ${key}`).toEqual([...mood[key]]);
            for (const key of GOLDEN_FOREST_MOOD_SCALARS) expect(out[key], `${k} ${key}`).toBe(mood[key]);
            expect(goldenForestMoodName(k)).toBe(mood.name);
        }
        goldenForestMoodAt(0.5, out);
        expect(apart(out, GOLDEN_FOREST_MOODS[0])).toBeGreaterThan(0);
        expect(apart(out, GOLDEN_FOREST_MOODS[1])).toBeGreaterThan(0);
        goldenForestMoodAt(Number.NaN, out);
        expect(out.sun).toEqual([...GOLDEN_FOREST_MOODS[0].sun]);
    });
});

describe('Golden Forest hours: the clock and the rig', () => {
    it('rests on an hour, then melts into the next, a period at a time', () => {
        expect(PERIOD).toBeGreaterThanOrEqual(80);
        expect(PERIOD).toBeLessThanOrEqual(150);
        expect(HOLD).toBeGreaterThanOrEqual(0.3);
        expect(HOLD).toBeLessThanOrEqual(0.4);
        for (let k = 0; k < N * 2; k++) {
            expect(goldenForestMoodDrift(k * PERIOD)).toBe(k);
            expect(goldenForestMoodDrift(resting(k))).toBe(k);
            expect(goldenForestMoodDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
        // The first seconds of a session are the golden hour, pure.
        expect(goldenForestMoodDrift(HOLD * PERIOD - 0.01)).toBe(0);
        expect(goldenForestMoodDrift(Number.NaN)).toBe(0);
    });

    it('lays an hour on the rig as the light play deepens from, in that hour\'s own terms', () => {
        const light = createLight();
        GOLDEN_FOREST_MOODS.forEach((mood, k) => {
            light.setMood(k);
            light.update(1, {}, null, null);
            expect(shown(light), mood.name).toEqual(colours(mood));
            expect(light.uHaze.value).toBe(mood.haze);
            expect(light.exposureScale).toBe(mood.exposure);
            for (const [rest] of Object.values(DEEPENED)) expect(light.resting[rest].isColor).toBe(true);
            // Hot play deepens whichever hour it is toward sunset: the sun's green and blue sink,
            // its red rises, the air clears, and nothing goes below black.
            light.update(1, {}, { level: 1, fever: 1 }, null);
            const sun = light.uSunColor.value;
            expect(sun.r, mood.name).toBeGreaterThan(mood.sun[0]);
            expect(sun.g, mood.name).toBeLessThan(mood.sun[1]);
            expect(sun.b, mood.name).toBeLessThan(mood.sun[2]);
            expect(Math.min(sun.r, sun.g, sun.b), mood.name).toBeGreaterThanOrEqual(0);
            expect(light.uHaze.value).toBeLessThan(mood.haze);
            // A dim hour deepens by as much of itself as the golden hour by its own.
            const drop = (mood.sun[1] - sun.g) / mood.sun[1];
            expect(drop, mood.name).toBeGreaterThan(0.1);
            expect(drop, mood.name).toBeLessThan(0.6);
        });
        // The icon's lens pins the air over every hour.
        light.hazePin = 0.0014;
        light.setMood(2);
        light.update(1, {}, null, null);
        expect(light.uHaze.value).toBe(0.0014);
    });
});
