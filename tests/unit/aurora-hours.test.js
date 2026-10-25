/**
 * Aurora — the hours of the night turn by the clock in every mode, and a level is one hour on
 * top (aurora-hours.js, and how the director and the world stand the sky on them). Timings
 * are read from the module, never copied.
 */
import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { AuroraDirector } from '../../src/themes/aurora/aurora-director.js';
import { ExcitationMap } from '../../src/themes/aurora/aurora-field.js';
import {
    AURORA_HOURS, AuroraHours, HOUR_COLOURS, HOUR_HOLD, HOUR_SCALARS, HOUR_SECONDS, LEVEL_EASE, MOON_DIRECTION,
    hourAt, hourDrift,
} from '../../src/themes/aurora/aurora-hours.js';
import { AURORA_COLORS } from '../../src/themes/aurora/aurora-palette.js';
import { AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

const N = AURORA_HOURS.length;
/** The middle of hour `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + HOUR_HOLD * 0.5) * HOUR_SECONDS;
const melting = (k) => (k + HOUR_HOLD + (1 - HOUR_HOLD) * 0.5) * HOUR_SECONDS;
/** The largest difference in any channel of any of two nights' colours. */
const far = (a, b) => Math.max(...HOUR_COLOURS.flatMap(
    (key) => a.colours[key].map((c, i) => Math.abs(c - b.colours[key][i])),
));

function director() {
    return new AuroraDirector({ excitation: new ExcitationMap(), seed: 11 });
}

/** Run a director from `from` to `to` seconds on the world clock, at 30 Hz, with no events. */
function run(sky, from, to, hz = 30) {
    let clock = from;
    while (clock < to - 1e-9) {
        const dt = Math.min(1 / hz, to - clock);
        clock += dt;
        sky.update(dt, clock);
    }
    return clock;
}

const worlds = [];
afterEach(() => {
    for (const world of worlds) world.dispose();
    worlds.length = 0;
});

describe('aurora hours: the night itself', () => {
    it('opens on the night the theme has always shown', () => {
        const quiet = AURORA_HOURS[0];
        expect(quiet.skyZenith).toEqual(AURORA_COLORS.skyZenith);
        expect(quiet.skyHorizon).toEqual(AURORA_COLORS.skyHorizon);
        expect(quiet.airglow).toEqual(AURORA_COLORS.airglow);
        // The constants the shaders and the director used before the hours.
        expect(quiet.skylight).toEqual([0.013, 0.022, 0.047]);
        expect(quiet.mistLight).toEqual([0.009, 0.017, 0.034]);
        expect(quiet.glow).toEqual([0.03, 0.105, 0.07]);
        expect(quiet.moonLight).toEqual([0, 0, 0]);
        expect([quiet.stars, quiet.galaxy, quiet.gain, quiet.height]).toEqual([1, 1, 1, 1]);
        expect([quiet.moon, quiet.crown, quiet.violet, quiet.fringe]).toEqual([0, 0, 0, 0]);
    });

    it('gives every hour every value, and each hour is plainly a different night from its neighbours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        for (const night of AURORA_HOURS) {
            for (const key of HOUR_COLOURS) {
                expect(night[key]).toHaveLength(3);
                expect(night[key].every((c) => c >= 0 && c < 0.25)).toBe(true);
            }
            for (const key of HOUR_SCALARS) expect(Number.isFinite(night[key])).toBe(true);
        }
        for (let k = 0; k < N; k++) {
            const a = hourAt(k);
            const b = hourAt(k + 1);
            const scalars = Math.max(...HOUR_SCALARS.map((key) => Math.abs(a[key] - b[key])));
            expect(Math.max(far(a, b) * 10, scalars), `${a.name} -> ${b.name}`).toBeGreaterThan(0.1);
        }
        // Only the moonlit hour has a moon, and its light comes from where it stands.
        expect(AURORA_HOURS.filter((night) => night.moon > 0).map((night) => night.name)).toEqual(['Moonlit night']);
        expect(Math.hypot(...MOON_DIRECTION)).toBeCloseTo(1, 9);
        expect(MOON_DIRECTION[1]).toBeGreaterThan(0.3);
    });

    it('is exactly an hour on a whole phase, and melts the short way round between', () => {
        for (let k = 0; k < N * 2; k++) {
            const night = hourAt(k);
            const exact = AURORA_HOURS[k % N];
            for (const key of HOUR_COLOURS) expect(night.colours[key]).toEqual([...exact[key]]);
            for (const key of HOUR_SCALARS) expect(night[key]).toBe(exact[key]);
        }
        const half = hourAt(2.5);
        for (const key of HOUR_SCALARS) {
            expect(half[key]).toBeCloseTo((AURORA_HOURS[2][key] + AURORA_HOURS[3][key]) / 2, 9);
        }
    });
});

describe('aurora hours: the clock turns them', () => {
    it('rests on an hour, then melts into the next, a period at a time', () => {
        for (let k = 0; k < N + 1; k++) {
            expect(hourDrift(k * HOUR_SECONDS)).toBe(k);
            expect(hourDrift(resting(k))).toBe(k);
            expect(hourDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
        // The whole night comes round in N hours: 6-10 minutes.
        expect(N * HOUR_SECONDS).toBeGreaterThanOrEqual(360);
        expect(N * HOUR_SECONDS).toBeLessThanOrEqual(600);
        expect(HOUR_SECONDS).toBeGreaterThanOrEqual(80);
    });

    it('turns the director through every hour with no event at all', () => {
        const sky = director();
        const seen = [];
        let clock = 0;
        for (let k = 0; k < N; k++) {
            clock = run(sky, clock, resting(k));
            expect(sky.hours.phase).toBe(k);
            expect(sky.hours.name).toBe(AURORA_HOURS[k].name);
            seen.push({
                crown: sky.crown, violet: sky.violet, height: sky.height, light: [...sky.light],
            });
        }
        // The display itself answers the hour: the crowned night stands tallest under the red,
        // the blue hour's ray tops are the most violet, the deep midnight the quietest.
        const crowned = AURORA_HOURS.findIndex((night) => night.name === 'Crowned night');
        const blue = AURORA_HOURS.findIndex((night) => night.name === 'Blue hour');
        const midnight = AURORA_HOURS.findIndex((night) => night.name === 'Deep midnight');
        expect(seen[crowned].crown).toBeGreaterThan(seen[0].crown + 0.1);
        expect(seen[crowned].height).toBeGreaterThan(seen[0].height);
        expect(seen[blue].violet).toBeGreaterThan(seen[0].violet + 0.2);
        expect(sky.arcGain[0]).toBeGreaterThan(0);
        expect(seen[midnight].light[1]).toBeLessThan(seen[0].light[1]);
    });

    it('stands where the clock says, whatever happened to the director (a seek, a rebuild)', () => {
        const a = director();
        run(a, 0, melting(2));
        const b = director();
        b.update(1 / 30, melting(2));
        expect(b.hours.phase).toBeCloseTo(a.hours.phase, 9);
        expect(far(b.hours, a.hours)).toBeLessThan(1e-9);
    });
});

describe('aurora hours: a level is an hour on top', () => {
    it('moves the night an hour on, eased over a few seconds, on top of the clock', () => {
        const sky = director();
        let clock = run(sky, 0, 5);
        expect(sky.hours.phase).toBe(0);
        sky.onLevelUp({ level: 2 });
        clock = run(sky, clock, clock + 0.5);
        expect(sky.hours.phase).toBeGreaterThan(0);
        expect(sky.hours.phase).toBeLessThan(0.5);
        clock = run(sky, clock, clock + LEVEL_EASE * 10);
        expect(sky.hours.phase).toBe(1);
        // And the clock still turns underneath it: the next melt goes on from the new hour.
        run(sky, clock, melting(0));
        expect(sky.hours.phase).toBeCloseTo(1.5, 6);
    });

    it('still plays the level-up cue: the sky wakes, a band climbs, a meteor and a ring', () => {
        const sky = director();
        run(sky, 0, 2);
        sky.onLevelUp({ level: 2 });
        sky.update(1 / 60, 2 + 1 / 60);
        expect(sky.activityTarget).toBeGreaterThanOrEqual(0.3);
        expect(sky.sweeps.some((band) => band.strength > 0)).toBe(true);
        expect(sky.meteorCount).toBe(1);
        expect(sky.rippleCount).toBe(1);
        expect(sky.heightKick).toBeGreaterThan(0.2);
    });

    it('steps the night without the cue when the cue is not to play', () => {
        const sky = director();
        run(sky, 0, 2);
        sky.stepHours();
        sky.update(1 / 60, 2 + 1 / 60);
        expect(sky.meteorCount).toBe(0);
        expect(sky.activityTarget).toBe(0);
        run(sky, 2, 2 + LEVEL_EASE * 10);
        expect(sky.hours.phase).toBe(1);
    });

    it('goes the short way round and lands exactly, and a restart can stand it at once', () => {
        const hours = new AuroraHours();
        for (let i = 0; i < N + 1; i++) hours.levelUp();
        hours.update(1 / 30, 1);
        // N + 1 levels on is one hour on: it never spins the whole night round.
        expect(hours.step).toBeGreaterThan(0);
        expect(hours.step).toBeLessThan(1);
        hours.setLevelSteps(3);
        expect(hours.levelSteps).toBe(3);
        expect(hours.phase).toBe(3);
        hours.reset();
        expect([hours.levelSteps, hours.step, hours.phase]).toEqual([0, 0, 0]);
    });
});

describe('aurora hours: what the world shows', () => {
    function create() {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 12000);
        const world = new AuroraWorld({ scene, camera, quality: 'Minimal' });
        worlds.push(world);
        return world;
    }

    const read = (world) => ({
        zenith: world.uniforms.skyZenith.value.toArray(),
        skylight: world.uniforms.skylight.value.toArray(),
        moonLight: world.uniforms.moonLight.value.toArray(),
        stars: world.uniforms.starGain.value,
        moon: world.uniforms.moonGlow.value,
    });

    it('opens on today\'s light and turns every surface\'s light with the clock', () => {
        const world = create();
        world.update(resting(0), 1 / 60);
        const first = read(world);
        expect(first.zenith.map((c) => Math.fround(c))).toEqual(AURORA_COLORS.skyZenith.map((c) => Math.fround(c)));
        expect(first.moon).toBe(0);
        expect(first.stars).toBe(1);
        const moonlit = AURORA_HOURS.findIndex((night) => night.moon > 0);
        world.update(resting(moonlit), 1 / 60);
        const moon = read(world);
        expect(moon.moon).toBe(1);
        expect(moon.moonLight.every((c) => c > 0)).toBe(true);
        expect(moon.stars).toBeLessThan(1);
        expect(moon.skylight[2]).toBeGreaterThan(first.skylight[2]);
    });
});
