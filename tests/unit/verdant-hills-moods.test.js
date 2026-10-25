/**
 * Verdant Hills — the day's weather turns by the clock in every mode, and a level is one weather
 * on top (verdant-hills-moods.js, VerdantHillsLight.setMood, VerdantHillsWorld's step).
 *
 * Only a single-player run and the Odyssey level up; everywhere else the clock alone must carry
 * the hills through their weathers. Timings are read from the module, never copied.
 */

import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    VERDANT_HILLS_MOODS, VERDANT_HILLS_MOOD_COLOURS, VERDANT_HILLS_MOOD_HOLD, VERDANT_HILLS_MOOD_SCALARS,
    VERDANT_HILLS_MOOD_SECONDS, createVerdantHillsMood, verdantHillsMoodAt, verdantHillsMoodDrift,
    verdantHillsMoodName,
} from '../../src/themes/verdant-hills/verdant-hills-moods.js';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import { VerdantHillsWorld } from '../../src/themes/verdant-hills/verdant-hills-world.js';

const N = VERDANT_HILLS_MOODS.length;
const PERIOD = VERDANT_HILLS_MOOD_SECONDS;
const HOLD = VERDANT_HILLS_MOOD_HOLD;
const STEP = 1 / 60;
/** The middle of weather `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + HOLD * 0.5) * PERIOD;
const melting = (k) => (k + HOLD + (1 - HOLD) * 0.5) * PERIOD;
/** The rig's uniform for each colour of a weather. */
const UNIFORM = {
    sun: 'uSunColor',
    skyLight: 'uSkyLight',
    bounce: 'uBounce',
    zenith: 'uZenith',
    skyMid: 'uSkyMid',
    horizon: 'uHorizon',
    horizonSun: 'uHorizonSun',
    hazeCool: 'uHazeCool',
    hazeWarm: 'uHazeWarm',
    cloudBase: 'uCloudBase',
    cloudTop: 'uCloudTop',
    cirrus: 'uCirrus',
};
/** The largest difference in any channel of the key colours of two weathers. */
const apart = (a, b) => Math.max(...['sun', 'zenith', 'horizon', 'horizonSun', 'hazeWarm', 'cloudTop']
    .flatMap((key) => a[key].map((c, i) => Math.abs(c - b[key][i]))));
/** What the rig shows now, as a weather's colours. */
const shown = (light) => Object.fromEntries(VERDANT_HILLS_MOOD_COLOURS.map((key) => (
    [key, light[UNIFORM[key]].value.toArray()])));
/** A weather's colours, as shown() reads them. */
const colours = (mood) => Object.fromEntries(VERDANT_HILLS_MOOD_COLOURS.map((key) => [key, [...mood[key]]]));

const owned = [];
afterEach(() => {
    while (owned.length) owned.pop().dispose();
});

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createLight() {
    const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
    owned.push(light);
    return light;
}

/** The hills without their asset pack (the land, the sky and the grass), at the cheapest tier. */
function createWorld() {
    const world = new VerdantHillsWorld({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(46, 16 / 9, 0.3, 30000),
        quality: 'Minimal',
        rng: seededRandom(1107),
        assets: null,
    }).build();
    owned.push(world);
    return world;
}

describe('Verdant Hills weathers: the table', () => {
    it('opens on the kite day the hills were built with', () => {
        const light = createLight();
        const first = VERDANT_HILLS_MOODS[0];
        expect(shown(light)).toEqual(colours(first));
        expect(light.uHaze.value).toBe(first.haze);
        expect(light.uCloudCover.value).toBe(first.cover);
        expect(first.exposure).toBe(1);
        expect(first.name).toBe('kite day');
    });

    it('has four to six weathers, each whole, finite and distinct from its neighbours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        const names = new Set();
        VERDANT_HILLS_MOODS.forEach((mood, k) => {
            names.add(mood.name);
            for (const key of VERDANT_HILLS_MOOD_COLOURS) {
                expect(mood[key], `${mood.name} ${key}`).toHaveLength(3);
                expect(mood[key].every((c) => Number.isFinite(c) && c >= 0), `${mood.name} ${key}`).toBe(true);
            }
            for (const key of VERDANT_HILLS_MOOD_SCALARS) expect(Number.isFinite(mood[key]), key).toBe(true);
            // A share of the sky the cloud field can draw, a haze that never milks the valley over,
            // and an exposure that only leans the lens.
            expect(mood.cover).toBeGreaterThan(0.05);
            expect(mood.cover).toBeLessThan(0.6);
            expect(mood.haze).toBeGreaterThan(0);
            expect(mood.haze).toBeLessThan(0.0004);
            expect(Math.abs(mood.exposure - 1)).toBeLessThan(0.25);
            expect(apart(mood, VERDANT_HILLS_MOODS[(k + 1) % N]), mood.name).toBeGreaterThan(0.1);
        });
        expect(names.size).toBe(N);
    });

    it('is each weather exactly on a whole phase, and melts between two of them', () => {
        const out = createVerdantHillsMood();
        for (let k = -N; k < N * 2; k++) {
            const mood = VERDANT_HILLS_MOODS[((k % N) + N) % N];
            verdantHillsMoodAt(k, out);
            for (const key of VERDANT_HILLS_MOOD_COLOURS) expect(out[key], `${k} ${key}`).toEqual([...mood[key]]);
            for (const key of VERDANT_HILLS_MOOD_SCALARS) expect(out[key], `${k} ${key}`).toBe(mood[key]);
            expect(verdantHillsMoodName(k)).toBe(mood.name);
        }
        const a = VERDANT_HILLS_MOODS[0];
        const b = VERDANT_HILLS_MOODS[1];
        verdantHillsMoodAt(0.5, out);
        expect(out.cover).toBeCloseTo((a.cover + b.cover) / 2, 12);
        expect(apart(out, a)).toBeGreaterThan(0);
        expect(apart(out, b)).toBeGreaterThan(0);
        // Nonsense is the first weather.
        verdantHillsMoodAt(Number.NaN, out);
        expect(out.sun).toEqual([...a.sun]);
    });
});

describe('Verdant Hills weathers: the clock', () => {
    it('rests on a weather, then melts into the next, a period at a time', () => {
        expect(PERIOD).toBeGreaterThanOrEqual(80);
        expect(PERIOD).toBeLessThanOrEqual(150);
        expect(HOLD).toBeGreaterThanOrEqual(0.3);
        expect(HOLD).toBeLessThanOrEqual(0.4);
        for (let k = 0; k < N * 2; k++) {
            expect(verdantHillsMoodDrift(k * PERIOD)).toBe(k);
            expect(verdantHillsMoodDrift(resting(k))).toBe(k);
            expect(verdantHillsMoodDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
        // The first seconds of a session are the kite day, pure.
        expect(verdantHillsMoodDrift(HOLD * PERIOD - 0.01)).toBe(0);
        expect(verdantHillsMoodDrift(Number.NaN)).toBe(0);
        expect(verdantHillsMoodDrift(-40)).toBe(0);
    });

    it('lays a weather on the rig, lets play clear the air from it, and keeps a pinned knob', () => {
        const light = createLight();
        const calm = { wind: 0, gust: 0, warmth: 0 };
        const second = VERDANT_HILLS_MOODS[1];
        light.setMood(1);
        light.update(0, calm);
        expect(shown(light)).toEqual(colours(second));
        expect(light.uHaze.value).toBe(second.haze);
        expect(light.uCloudCover.value).toBe(second.cover);
        expect(light.exposureScale).toBe(second.exposure);
        expect(light.uCloudEdge.value).toBe(light.cloudEdges[Math.round((1 - second.cover) * 255)]);
        // A fever clears the air from the weather's haze, whichever weather it is.
        const third = VERDANT_HILLS_MOODS[2];
        for (let frame = 1; frame <= 240; frame++) {
            light.setMood(2);
            light.update(frame * STEP, { ...calm, clearAir: 1 });
        }
        expect(light.uHaze.value).toBeCloseTo(third.haze * (1 - 0.4), 9);
        for (let frame = 241; frame <= 900; frame++) {
            light.setMood(2);
            light.update(frame * STEP, calm);
        }
        expect(light.uHaze.value).toBe(third.haze);
        // The playground's knobs pin the haze and the cover over every weather.
        light.pinned.haze = 0.0003;
        light.pinned.cover = 0.5;
        light.setMood(3);
        light.update(20, calm);
        expect(light.uHaze.value).toBe(0.0003);
        expect(light.uCloudCover.value).toBe(0.5);
        expect(light.uSunColor.value.toArray()).toEqual([...VERDANT_HILLS_MOODS[3].sun]);
    });
});

describe('Verdant Hills weathers in the world', () => {
    it('turns through every weather by the clock alone, with no level-up', () => {
        const world = createWorld();
        const { light } = world;
        const at = (time) => {
            world.update(time, STEP, {});
            return shown(light);
        };
        const kiteDay = at(resting(0));
        expect(world.level).toBe(1);
        for (let k = 0; k < N + 1; k++) {
            const mood = VERDANT_HILLS_MOODS[k % N];
            const seen = at(k * PERIOD);
            expect(seen, mood.name).toEqual(colours(mood));
            expect(light.uCloudCover.value).toBe(mood.cover);
            expect(light.exposureScale).toBe(mood.exposure);
            expect(world.getDiagnostics().mood).toBe(mood.name);
            // Still that weather at the end of its rest, already another half-way through the melt.
            expect(at(resting(k))).toEqual(seen);
            expect(apart(at(melting(k)), mood)).toBeGreaterThan(0);
        }
        // The next weather is not the kite day; a whole round later it is again.
        expect(apart(at(resting(1)), kiteDay)).toBeGreaterThan(0.1);
        expect(at(N * PERIOD)).toEqual(kiteDay);
        // A function of the time alone: back to the start is the start.
        expect(at(2)).toEqual(kiteDay);
    });

    it('takes a level-up as one weather on top of the clock, eased, the short way round', () => {
        const world = createWorld();
        world.update(2, STEP, {});
        expect(world.moodPhase(2)).toBe(0);
        world.setLevel(2);
        // Eased: a moment after the level-up the day is on its way, not there.
        world.update(2, STEP, {});
        expect(world.moodStep).toBeGreaterThan(0);
        expect(world.moodStep).toBeLessThan(0.1);
        let time = 2;
        for (let frame = 0; frame < 60 * 30; frame++) {
            time += STEP;
            world.update(time, STEP, {});
        }
        // Thirty seconds on, still inside the rest: the next weather, exactly.
        expect(time).toBeLessThan(HOLD * PERIOD);
        expect(world.moodStep).toBe(1);
        expect(shown(world.light)).toEqual(colours(VERDANT_HILLS_MOODS[1]));
        // On top of the clock: a whole period later it is the weather after.
        world.update(PERIOD + 2, STEP, {});
        expect(world.moodPhase(PERIOD + 2)).toBe(2);
        // A new run goes back to the first level's weather the short way round.
        world.setLevel(1, { silent: true });
        expect(world.moodStep).toBe(0);
        world.setLevel(N, { silent: true });
        expect(world.moodStep).toBe(-1);
        world.setLevel(N + 1, { silent: true });
        expect(world.moodStep).toBe(0);
        // Junk keeps the level it had.
        world.setLevel(Number.NaN);
        expect(world.level).toBe(N + 1);
    });

    it('carries the weather a rebuilt world picks up, so the day does not jump back', () => {
        const before = createWorld();
        before.setLevel(3, { silent: true });
        before.update(resting(1), STEP, {});
        const lived = before.moodLived(resting(1));
        const after = createWorld();
        after.setLevel(3, { silent: true });
        after.moodStart = lived;
        after.update(0, STEP, {});
        expect(after.moodPhase(0)).toBe(before.moodPhase(resting(1)));
        expect(shown(after.light)).toEqual(shown(before.light));
    });
});
