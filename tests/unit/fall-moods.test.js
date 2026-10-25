/**
 * Fall — the grove's light turns by the clock in every mode, and a level is one light on top
 * (fall-moods.js, FallLight.setMood; the world's step is in fall-world.test.js, where the world
 * can be built with its assets).
 *
 * Only a single-player run and the Odyssey level up; everywhere else the clock alone must carry
 * the grove through its lights. Timings are read from the module, never copied.
 */

import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    FALL_MOODS, FALL_MOOD_COLOURS, FALL_MOOD_HOLD, FALL_MOOD_SCALARS, FALL_MOOD_SECONDS, createFallMood,
    fallMoodAt, fallMoodDrift, fallMoodName,
} from '../../src/themes/fall/fall-moods.js';
import { FallLight } from '../../src/themes/fall/fall-light.js';
import { FALL_TIERS } from '../../src/themes/fall/fall-quality.js';

const N = FALL_MOODS.length;
const PERIOD = FALL_MOOD_SECONDS;
const HOLD = FALL_MOOD_HOLD;
/** The middle of light `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + HOLD * 0.5) * PERIOD;
const melting = (k) => (k + HOLD + (1 - HOLD) * 0.5) * PERIOD;
/** The rig's uniform for each colour of a light. */
const UNIFORM = {
    sun: 'uSunColor',
    skyLight: 'uSkyLight',
    bounce: 'uBounce',
    zenith: 'uZenith',
    skyCool: 'uSkyCool',
    skyWarm: 'uSkyWarm',
    skyRose: 'uSkyRose',
    hazeCool: 'uHazeCool',
    hazeWarm: 'uHazeWarm',
    cloudShade: 'uCloudShade',
    cloudLit: 'uCloudLit',
    cloudBody: 'uCloudBody',
    cloudBodyWarm: 'uCloudBodyWarm',
    shaftShade: 'uShaftShade',
    shaftSun: 'uShaftSun',
};
/** The largest difference in any channel of the key colours of two lights. */
const apart = (a, b) => Math.max(...['sun', 'zenith', 'skyCool', 'skyWarm', 'hazeCool', 'hazeWarm']
    .flatMap((key) => a[key].map((c, i) => Math.abs(c - b[key][i]))));
/** What the rig shows now, as a light's colours. */
const shown = (light) => Object.fromEntries(FALL_MOOD_COLOURS.map((key) => [key, light[UNIFORM[key]].value.toArray()]));
/** A light's colours, as shown() reads them. */
const colours = (mood) => Object.fromEntries(FALL_MOOD_COLOURS.map((key) => [key, [...mood[key]]]));

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
    const light = new FallLight({ tier: FALL_TIERS[quality], rng });
    owned.push(light);
    return light;
}

describe('Fall lights: the table', () => {
    it('opens on the quiet afternoon the grove was built with', () => {
        const light = createLight();
        const first = FALL_MOODS[0];
        expect(shown(light)).toEqual(colours(first));
        expect(light.uHaze.value).toBe(first.haze);
        expect(first.exposure).toBe(1);
        expect(first.name).toBe('quiet afternoon');
        // And a frame of it is that light still, to the last digit.
        light.setMood(0);
        light.update(1, {}, 1 / 60);
        expect(shown(light)).toEqual(colours(first));
        expect(light.uHaze.value).toBe(first.haze);
    });

    it('has four to six lights, each whole, finite and distinct from its neighbours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        const names = new Set();
        FALL_MOODS.forEach((mood, k) => {
            names.add(mood.name);
            for (const key of FALL_MOOD_COLOURS) {
                expect(mood[key], `${mood.name} ${key}`).toHaveLength(3);
                expect(mood[key].every((c) => Number.isFinite(c) && c >= 0), `${mood.name} ${key}`).toBe(true);
            }
            for (const key of FALL_MOOD_SCALARS) expect(Number.isFinite(mood[key]), key).toBe(true);
            // Air that never milks the grove over, and an exposure that only leans the lens.
            expect(mood.haze).toBeGreaterThan(0);
            expect(mood.haze).toBeLessThanOrEqual(0.012);
            expect(Math.abs(mood.exposure - 1)).toBeLessThan(0.25);
            expect(apart(mood, FALL_MOODS[(k + 1) % N]), mood.name).toBeGreaterThan(0.1);
        });
        expect(names.size).toBe(N);
    });

    it('is each light exactly on a whole phase, and melts between two of them', () => {
        const out = createFallMood();
        for (let k = -N; k < N * 2; k++) {
            const mood = FALL_MOODS[((k % N) + N) % N];
            fallMoodAt(k, out);
            for (const key of FALL_MOOD_COLOURS) expect(out[key], `${k} ${key}`).toEqual([...mood[key]]);
            for (const key of FALL_MOOD_SCALARS) expect(out[key], `${k} ${key}`).toBe(mood[key]);
            expect(fallMoodName(k)).toBe(mood.name);
        }
        fallMoodAt(0.5, out);
        expect(out.haze).toBeCloseTo((FALL_MOODS[0].haze + FALL_MOODS[1].haze) / 2, 12);
        expect(apart(out, FALL_MOODS[0])).toBeGreaterThan(0);
        expect(apart(out, FALL_MOODS[1])).toBeGreaterThan(0);
        fallMoodAt(Number.NaN, out);
        expect(out.sun).toEqual([...FALL_MOODS[0].sun]);
    });
});

describe('Fall lights: the clock and the rig', () => {
    it('rests on a light, then melts into the next, a period at a time', () => {
        expect(PERIOD).toBeGreaterThanOrEqual(80);
        expect(PERIOD).toBeLessThanOrEqual(150);
        expect(HOLD).toBeGreaterThanOrEqual(0.3);
        expect(HOLD).toBeLessThanOrEqual(0.4);
        for (let k = 0; k < N * 2; k++) {
            expect(fallMoodDrift(k * PERIOD)).toBe(k);
            expect(fallMoodDrift(resting(k))).toBe(k);
            expect(fallMoodDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
        // The first seconds of a session are the quiet afternoon, pure.
        expect(fallMoodDrift(HOLD * PERIOD - 0.01)).toBe(0);
        expect(fallMoodDrift(Number.NaN)).toBe(0);
    });

    it('lays a light on the rig as the rest play turns toward late amber and clears from', () => {
        const light = createLight();
        const sunHue = (sun) => sun.b / sun.r;
        FALL_MOODS.forEach((mood, k) => {
            light.setMood(k);
            light.update(1, {}, 1 / 60);
            expect(shown(light), mood.name).toEqual(colours(mood));
            expect(light.uHaze.value).toBe(mood.haze);
            expect(light.exposureScale).toBe(mood.exposure);
            // A fever turns whichever light it is toward late amber by the same share, and clears
            // the air from its own haze.
            light.update(1, { turn: 1, surge: { fever: 1 } }, 1 / 60);
            const rest = { r: mood.sun[0], b: mood.sun[2] };
            expect(sunHue(light.uSunColor.value), mood.name).toBeLessThan(sunHue(rest) * 0.8);
            expect(light.uHaze.value, mood.name).toBeLessThan(mood.haze);
            light.update(1, {}, 1 / 60);
            expect(light.uSunColor.value.toArray(), mood.name).toEqual([...mood.sun]);
        });
    });
});
