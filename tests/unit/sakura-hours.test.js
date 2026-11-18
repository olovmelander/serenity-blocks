import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SAKURA_HOURS, SAKURA_HOUR_COLOURS, SAKURA_HOUR_HOLD, SAKURA_HOUR_SCALARS, SAKURA_HOUR_SECONDS,
    sakuraHourAt, sakuraHourDrift, sakuraHourName,
} from '../../src/themes/sakura-twilight/sakura-hours.js';
import { SakuraLight } from '../../src/themes/sakura-twilight/sakura-light.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';
import { SAKURA_WEATHERS } from '../../src/themes/sakura-twilight/sakura-weather.js';

const N = SAKURA_HOURS.length;
const P = SAKURA_HOUR_SECONDS;
const REST_END = P * SAKURA_HOUR_HOLD;

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function seeded(seed = 7) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

describe('Sakura Twilight hours of the night', () => {
    it('keeps a house pace: 80 s or more an hour, with a rest before each melt', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        expect(P).toBeGreaterThanOrEqual(80);
        expect(SAKURA_HOUR_HOLD).toBeGreaterThanOrEqual(0.3);
        expect(SAKURA_HOUR_HOLD).toBeLessThanOrEqual(0.4);
        expect(new Set(SAKURA_HOURS.map((hour) => hour.name)).size).toBe(N);
        for (const hour of SAKURA_HOURS) {
            for (const key of SAKURA_HOUR_COLOURS) {
                expect(hour[key], `${hour.name} ${key}`).toHaveLength(3);
                expect(hour[key].every((c) => Number.isFinite(c) && c >= 0), `${hour.name} ${key}`).toBe(true);
            }
            for (const key of SAKURA_HOUR_SCALARS) expect(hour[key] > 0, `${hour.name} ${key}`).toBe(true);
        }
    });

    it('turns by the clock alone: each hour rests, then melts into the next, and never runs back', () => {
        expect(sakuraHourDrift(0)).toBe(0);
        expect(sakuraHourDrift(REST_END - 0.5)).toBe(0);
        expect(sakuraHourDrift(P)).toBe(1);
        expect(sakuraHourDrift(3 * P + 1)).toBe(3);
        const middle = sakuraHourDrift(REST_END + (P - REST_END) / 2);
        expect(middle).toBeGreaterThan(0.3);
        expect(middle).toBeLessThan(0.7);
        let last = 0;
        for (let t = 0; t <= 2 * N * P; t += 0.5) {
            const phase = sakuraHourDrift(t);
            expect(phase).toBeGreaterThanOrEqual(last);
            expect(phase - last).toBeLessThan(0.05);
            last = phase;
        }
    });

    it('is each hour exactly on a whole phase, the night coming round after the last', () => {
        SAKURA_HOURS.forEach((hour, index) => {
            const at = sakuraHourAt(index);
            for (const key of SAKURA_HOUR_COLOURS) expect(at[key]).toEqual([...hour[key]]);
            for (const key of SAKURA_HOUR_SCALARS) expect(at[key]).toBe(hour[key]);
            expect(sakuraHourAt(index + N).moon).toEqual([...hour.moon]);
            expect(sakuraHourAt(index - N).zenith).toEqual([...hour.zenith]);
            expect(sakuraHourName(index + 0.2)).toBe(hour.name);
        });
    });

    it('makes every hour clearly its own: the sky, the moonlight or the lanterns differ from the next', () => {
        for (let i = 0; i < N; i += 1) {
            const a = SAKURA_HOURS[i];
            const b = SAKURA_HOURS[(i + 1) % N];
            const sky = distance(a.afterglow, b.afterglow) + distance(a.vault, b.vault)
                + distance(a.horizon, b.horizon);
            const light = distance(a.moon, b.moon) + distance(a.skyLight, b.skyLight);
            expect(sky + light + Math.abs(a.lampGain - b.lampGain), `${a.name} -> ${b.name}`).toBeGreaterThan(0.15);
        }
    });

    it('opens exactly as the garden always has: the first hour\'s colours are the afterglow\'s', () => {
        // The opening look, colour for colour (the other four hours may be retuned; this one is the
        // picture every session starts in, and the first air scales none of it).
        const [first] = SAKURA_HOURS;
        expect(first).toMatchObject({
            name: 'afterglow',
            moon: [0.5, 0.66, 1.0],
            zenith: [0.004, 0.006, 0.03],
            vault: [0.028, 0.017, 0.085],
            horizon: [0.07, 0.038, 0.13],
            afterglow: [0.46, 0.12, 0.17],
            ember: [0.85, 0.34, 0.2],
            skyLight: [0.2, 0.11, 0.24],
            bounce: [0.06, 0.035, 0.07],
            lampColor: [2.9, 1.28, 0.4],
            haze: 0.0018,
            mist: 0.003,
            lampGain: 1,
            stars: 1,
            exposure: 1,
            beams: 1,
        });
        // The cirrus was written as two sRGB hexes: the same two, in the linear working space.
        const linear = (hex) => new THREE.Color(hex).toArray();
        first.cloudShade.forEach((c, i) => expect(c).toBeCloseTo(linear(0x241a3c)[i], 6));
        first.cloudLit.forEach((c, i) => expect(c).toBeCloseTo(linear(0x4a3a6e)[i], 6));
        expect(Object.isFrozen(first) && Object.isFrozen(first.moon)).toBe(true);
    });

    it('knows how much of the river of heaven each hour is dark enough for, and how dense its shafts stand', () => {
        expect([...SAKURA_HOUR_SCALARS]).toEqual(['haze', 'mist', 'lampGain', 'stars', 'exposure', 'galaxy', 'beams']);
        const by = (name) => SAKURA_HOURS.find((hour) => hour.name === name);
        for (const hour of SAKURA_HOURS) {
            // The river is a share of itself (the air scales it too, and the rig caps the two at one).
            expect(hour.galaxy, hour.name).toBeGreaterThan(0);
            expect(hour.galaxy, hour.name).toBeLessThanOrEqual(1);
            expect(hour.beams, hour.name).toBeGreaterThan(0.3);
            expect(hour.beams, hour.name).toBeLessThan(2.5);
        }
        // All of it in the lantern night, when the sky has gone to ink; next to none at dawn and
        // little in the afterglow and the blue hour.
        expect(by('lantern night').galaxy).toBe(Math.max(...SAKURA_HOURS.map((hour) => hour.galaxy)));
        expect(by('plum dawn').galaxy).toBe(Math.min(...SAKURA_HOURS.map((hour) => hour.galaxy)));
        expect(by('afterglow').galaxy).toBeLessThan(by('moonlit night').galaxy);
        // The shafts are the moon's: the most when it has the garden, the fewest when it is veiled.
        expect(by('moonlit night').beams).toBe(Math.max(...SAKURA_HOURS.map((hour) => hour.beams)));
        expect(by('lantern night').beams).toBe(Math.min(...SAKURA_HOURS.map((hour) => hour.beams)));
        // Between two hours the numbers cross in a straight line, like the rest.
        for (let i = 0; i < N; i += 1) {
            const a = SAKURA_HOURS[i];
            const b = SAKURA_HOURS[(i + 1) % N];
            const half = sakuraHourAt(i + 0.5);
            for (const key of SAKURA_HOUR_SCALARS) {
                expect(half[key], `${a.name} ${key}`).toBeCloseTo((a[key] + b[key]) / 2, 12);
            }
        }
    });

    it('melts through colour, never through grey', () => {
        // Halfway from violet afterglow to the blue hour the vault stays as saturated as either end.
        const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
        const half = sakuraHourAt(0.5).vault;
        expect(saturation(half)).toBeGreaterThan(0.6 * Math.min(
            saturation(SAKURA_HOURS[0].vault),
            saturation(SAKURA_HOURS[1].vault),
        ));
    });
});

describe('Sakura Twilight light rig hours', () => {
    const light = () => new SakuraLight({ tier: sakuraTier('Minimal'), rng: seeded() });

    it('opens on the first hour: the garden looks as it always has at time 0', () => {
        const rig = light();
        const first = SAKURA_HOURS[0];
        const close = (colour, rgb) => colour.toArray().forEach((c, i) => expect(c).toBeCloseTo(rgb[i], 6));
        close(rig.uMoonColor.value, first.moon);
        close(rig.uZenith.value, first.zenith);
        close(rig.uAfterglow.value, first.afterglow);
        close(rig.uCloudShade.value, first.cloudShade);
        close(rig.uCloudLit.value, first.cloudLit);
        expect(rig.uHaze.value).toBe(first.haze);
        expect(rig.uStars.value).toBe(first.stars);
        // A setHour(0) changes nothing.
        const before = [rig.uMoonColor.value.clone(), rig.uVault.value.clone(), rig.uLampColor.value.clone()];
        rig.setHour(0);
        expect(rig.uMoonColor.value.equals(before[0])).toBe(true);
        expect(rig.uVault.value.equals(before[1])).toBe(true);
        expect(rig.uLampColor.value.equals(before[2])).toBe(true);
        rig.dispose();
    });

    it('wears each hour: the sky, the moonlight, the stars and how the lanterns burn', () => {
        const rig = light();
        rig.update(1, {});
        const restLamps = rig.uLampGain.value;
        const lantern = SAKURA_HOURS.findIndex((hour) => hour.name === 'lantern night');
        rig.setHour(lantern);
        rig.update(1, {});
        expect(rig.uMoonColor.value.toArray()).toEqual([...SAKURA_HOURS[lantern].moon]);
        expect(rig.uVault.value.toArray()).toEqual([...SAKURA_HOURS[lantern].vault]);
        expect(rig.uStars.value).toBe(SAKURA_HOURS[lantern].stars);
        expect(rig.uLampGain.value).toBeCloseTo(restLamps * SAKURA_HOURS[lantern].lampGain, 9);
        expect(rig.hourExposure).toBe(SAKURA_HOURS[lantern].exposure);
        // Nonsense keeps the hour it had.
        rig.setHour(NaN);
        expect(rig.hourPhase).toBe(lantern);
        rig.dispose();
    });

    it('shows the river of heaven and stands the shafts as the hour says, in the air it opens in', () => {
        const rig = light();
        const [clear] = SAKURA_WEATHERS;
        SAKURA_HOURS.forEach((hour, index) => {
            expect(rig.setHour(index)).toBe(rig.hour);
            expect(rig.hour.galaxy).toBe(hour.galaxy);
            expect(rig.hour.beams).toBe(hour.beams);
            expect(rig.uGalaxy.value, hour.name).toBeCloseTo(Math.min(1, hour.galaxy * clear.galaxy), 12);
            expect(rig.shafts, hour.name).toBeCloseTo(hour.beams * clear.shafts, 12);
            expect(rig.uStars.value, hour.name).toBeCloseTo(hour.stars * clear.stars, 12);
            expect(rig.uMist.value, hour.name).toBeCloseTo(hour.mist * clear.mist, 12);
        });
        // The darkest hour under the clearest air shows all of the river, and never more than all.
        const dark = SAKURA_HOURS.findIndex((hour) => hour.galaxy === 1);
        const mirror = SAKURA_WEATHERS.findIndex((air) => air.galaxy === 1);
        rig.setHour(dark);
        rig.setWeather(mirror);
        expect(rig.uGalaxy.value).toBe(1);
        // Half way between two hours the shafts are half way between theirs.
        rig.setWeather(0);
        rig.setHour(2.5);
        expect(rig.shafts).toBeCloseTo((SAKURA_HOURS[2].beams + SAKURA_HOURS[3].beams) / 2, 12);
        rig.dispose();
    });

    it('lets the hour set where the lens\'s iris rests', () => {
        const rig = light();
        const renderer = { isWebGPURenderer: true };
        const post = new SakuraPost({
            renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality: 'Minimal', light: rig,
        });
        post.update({});
        const rest = post.uExposure.value;
        const brighter = SAKURA_HOURS.findIndex((hour) => hour.exposure > 1);
        rig.setHour(brighter);
        post.update({});
        expect(post.uExposure.value).toBeCloseTo(rest * SAKURA_HOURS[brighter].exposure, 9);
        post.dispose();
        rig.dispose();
    });
});
