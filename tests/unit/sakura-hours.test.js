import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SAKURA_HOURS, SAKURA_HOUR_COLOURS, SAKURA_HOUR_HOLD, SAKURA_HOUR_SCALARS, SAKURA_HOUR_SECONDS,
    sakuraHourAt, sakuraHourDrift, sakuraHourName,
} from '../../src/themes/sakura-twilight/sakura-hours.js';
import { SakuraLight } from '../../src/themes/sakura-twilight/sakura-light.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';

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
