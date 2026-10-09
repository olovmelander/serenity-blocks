import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { HIMALAYAN_PEAK_PARTS, HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import {
    DEG, HOURS, HOUR_KEYS, HOUR_SPAN, SUN_ELEVATION, hourAt,
} from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import { QUALITY_NAMES } from '../../src/themes/himalayan-peak/himalayan-peak-quality.js';

/** One small stand-in amphitheatre for every world in this file. */
let massif;
beforeAll(() => {
    massif = planMassif(96);
});

function makeWorld(quality = 'High') {
    const scene = new THREE.Scene();
    const world = new HimalayanPeakWorld({
        scene, quality, capture: true, massif, eagle: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 60000);
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    return { world, scene, camera };
}

const step = (world, camera, from, to, dt = 1 / 60) => {
    for (let t = from + dt; t <= to + 1e-9; t += dt) {
        world.updateCamera(camera, { time: t, delta: dt });
        world.update({ time: t, delta: dt }, camera);
    }
};

describe('HimalayanPeakWorld', () => {
    it('builds every part at every tier and lets go of all of it', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            // (The eagle joins when its model arrives; no model is fetched here.)
            const expected = HIMALAYAN_PEAK_PARTS
                .filter((name) => name !== 'eagle' && (name !== 'dust' || world.tier.dust > 0));
            expect(Object.keys(world.parts).sort()).toEqual([...expected].sort());
            expect(world.getState().flags).toBeGreaterThan(20);
            world.dispose();
            expect(scene.children).toHaveLength(0);
            expect(world.u).toBeNull();
        });
    });

    it('rests with the sun under the wall and raises it with the chain', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const rest = world.getState();
        expect(rest.elevation).toBeLessThan(rest.sunClears);
        expect(Math.abs(rest.elevation - SUN_ELEVATION.rest / DEG)).toBeLessThan(1);
        expect(world.u.nearSun.value).toBe(0);
        world.onCombo(6);
        step(world, camera, 2, 9);
        const lit = world.getState();
        expect(lit.elevation).toBeGreaterThan(lit.sunClears);
        expect(world.u.nearSun.value).toBeGreaterThan(0.9);
        world.onCombo(0);
        step(world, camera, 9, 24);
        expect(world.getState().elevation).toBeLessThan(world.getState().sunClears);
    });

    it('throws papers, sends a gust and leaves light in the flags on a lock', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ u: 0.2, rows: [10, 9], color: '#e84118' });
        const state = world.getState();
        expect(state.counts.locks).toBe(1);
        expect(state.counts.papers).toBeGreaterThan(5);
        expect(state.counts.blessed).toBeGreaterThan(0);
        expect(world.u.ringA[0].value.w).toBeGreaterThan(0);
        step(world, camera, 1, 2.5);
        expect(world.getState().held).toBeGreaterThan(0.2);
    });

    it('lets every flag go on a clear and lifts the sun for a moment', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        for (let i = 0; i < 6; i++) world.onLock({ u: i % 2 ? 0.8 : 0.2, rows: [4 + i * 2], color: '#fbc531' });
        step(world, camera, 1, 2.5);
        expect(world.getState().held).toBeGreaterThan(0.5);
        const before = world.getState().elevation;
        world.onClear({ rows: [19, 18], lines: 2 });
        step(world, camera, 2.5, 3.6);
        const after = world.getState();
        expect(after.held).toBeLessThan(0.05);
        expect(after.elevation).toBeGreaterThan(before + 1);
        expect(world.u.waveA[0].value.z).toBeGreaterThan(0);
        step(world, camera, 3.6, 16);
        expect(world.getState().elevation).toBeLessThan(before + 1);
    });

    it('holds its breath on four lines, then brings the sun over the wall and an avalanche down', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, 1, 1.1);
        expect(world.u.breath.value).toBeLessThan(0.5);
        step(world, camera, 1.1, 2.6);
        const state = world.getState();
        expect(state.counts.quads).toBe(1);
        expect(state.surge).toBeGreaterThan(0.4);
        expect(state.elevation).toBeGreaterThan(state.sunClears);
        expect(world.u.avalanche.value.y).toBeGreaterThan(0);
        expect(world.u.breath.value).toBeGreaterThan(0.8);
    });

    it('turns the hour with the level and comes back round', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 0.5);
        world.levelUp(2);
        expect(world.getState().hour).toBe(HOURS[1].name);
        world.levelUp(HOURS.length + 1, { silent: true });
        expect(world.getState().hour).toBe(HOURS[0].name);
    });

    it('places the light among the hours by the level and by the clock', () => {
        const count = HOURS.length;
        expect(hourAt(1, 0)).toEqual({
            from: 0, to: 1, mix: 0, turn: 0,
        });
        // Half a span on, the light is halfway to the next hour; a whole span on, it is there,
        // exactly where a level-up would have put it at once.
        expect(hourAt(1, HOUR_SPAN / 2)).toMatchObject({ from: 0, to: 1 });
        expect(hourAt(1, HOUR_SPAN / 2).mix).toBeCloseTo(0.5, 9);
        expect(hourAt(1, HOUR_SPAN).from).toBe(1);
        expect(hourAt(1, HOUR_SPAN).mix).toBeCloseTo(0, 9);
        expect(hourAt(2, 0)).toEqual(hourAt(1, HOUR_SPAN));
        // The level and the clock turn the same wheel, and it comes round: night into dawn.
        expect(hourAt(3, HOUR_SPAN * 1.5).turn).toBeCloseTo(3.5, 9);
        expect(hourAt(count, HOUR_SPAN / 2)).toMatchObject({ from: count - 1, to: 0 });
        expect(hourAt(1, HOUR_SPAN * count).turn).toBeCloseTo(0, 9);
        expect(hourAt(count + 1, 0)).toEqual(hourAt(1, 0));
        // An hour is held a while and the passage between two is slow: eased at both ends,
        // never backwards.
        expect(hourAt(1, HOUR_SPAN * 0.1).mix).toBeLessThan(0.03);
        expect(hourAt(1, HOUR_SPAN * 0.9).mix).toBeGreaterThan(0.97);
        let previous = 0;
        for (let time = 0; time < HOUR_SPAN; time += 1) {
            const { mix } = hourAt(1, time);
            expect(mix).toBeGreaterThanOrEqual(previous);
            expect(mix - previous).toBeLessThan(1.6 / HOUR_SPAN);
            previous = mix;
        }
        // A clock that has not started is the level's own hour; a result object is reused.
        expect(hourAt(2, -5)).toEqual(hourAt(2, 0));
        const out = {};
        expect(hourAt(1, 30, out)).toBe(out);
        // Slow: more than a minute an hour, and the whole round within a quarter of an hour.
        expect(HOUR_SPAN).toBeGreaterThan(60);
        expect(HOUR_SPAN * count).toBeLessThan(900);
    });

    it('turns the hours with the clock as well, with no level reached', () => {
        const UNIFORMS = {
            sun: 'sunCol', glow: 'glow', zenith: 'zenith', horizon: 'horizon', shade: 'shade', cloud: 'cloudCol',
        };
        const light = (world) => Object.fromEntries(
            HOUR_KEYS.map((key) => [key, world.u[UNIFORMS[key]].value.toArray()]),
        );
        /** The most any channel differs between two readings of the light. */
        const apart = (a, b) => Math.max(
            ...HOUR_KEYS.map((key) => Math.max(...a[key].map((v, c) => Math.abs(v - b[key][c])))),
        );
        const cold = (index) => Object.fromEntries(HOUR_KEYS.map((key) => [key, [...HOURS[index].cold[key]]]));
        const near = (got, want, digits, label) => HOUR_KEYS.forEach((key) => {
            got[key].forEach((v, c) => expect(v, `${label} ${key}[${c}]`).toBeCloseTo(want[key][c], digits));
        });
        const at = (world, camera, time) => {
            world.updateCamera(camera, { time, delta: 0 });
            world.update({ time, delta: 0 }, camera);
        };
        const { world, camera } = makeWorld();
        // The sun held under the wall: only the hours' waiting ends are in play.
        world.holdSun(SUN_ELEVATION.rest);
        at(world, camera, 0);
        near(light(world), cold(0), 6, 'start');
        expect(world.u.stars.value).toBeCloseTo(HOURS[0].cold.stars, 6);
        expect(world.getState()).toMatchObject({ level: 1, hour: HOURS[0].name, hourNow: HOURS[0].name });

        // A whole span with no event at all, a tenth of a second at a time.
        const dt = 0.1;
        let before = light(world);
        let fastest = 0;
        let half = null;
        const steps = Math.round(HOUR_SPAN / dt);
        for (let i = 1; i <= steps; i++) {
            const time = i * dt;
            world.updateCamera(camera, { time, delta: dt });
            world.update({ time, delta: dt }, camera);
            const now = light(world);
            fastest = Math.max(fastest, apart(now, before) / dt);
            before = now;
            if (i === steps / 2) half = now;
        }
        // No moment of it moves fast: under a twentieth of a unit a second, in a scene whose
        // sunlight is three or four units.
        expect(fastest).toBeGreaterThan(0);
        expect(fastest).toBeLessThan(0.05);
        // Halfway it was between the two, and it has arrived at the second hour, stars and all,
        // though the level is still the first.
        const gold = cold(1);
        HOUR_KEYS.forEach((key) => half[key].forEach((v, c) => {
            const lo = Math.min(HOURS[0].cold[key][c], gold[key][c]);
            const hi = Math.max(HOURS[0].cold[key][c], gold[key][c]);
            expect(v, `half ${key}[${c}]`).toBeGreaterThanOrEqual(lo - 1e-6);
            expect(v, `half ${key}[${c}]`).toBeLessThanOrEqual(hi + 1e-6);
        }));
        // (The live colours trail the place they are heading for by a few thousandths.)
        expect(Math.abs(half.sun[1] - (HOURS[0].cold.sun[1] + gold.sun[1]) / 2)).toBeLessThan(0.01);
        near(light(world), gold, 3, 'a span on');
        expect(world.u.stars.value).toBeCloseTo(HOURS[1].cold.stars, 3);
        expect(world.getState()).toMatchObject({ level: 1, hour: HOURS[0].name, hourNow: HOURS[1].name });
        expect(world.getState().hourTurn).toBeCloseTo(1, 6);

        // A level reached there turns the wheel a whole step further.
        world.levelUp(2, { silent: true });
        at(world, camera, HOUR_SPAN);
        near(light(world), cold(2), 6, 'level two, a span on');
        expect(world.getState()).toMatchObject({ level: 2, hour: HOURS[1].name, hourNow: HOURS[2].name });

        // A new run goes back to the first level but not back in time: the clock's turn stays.
        world.resetSession();
        at(world, camera, HOUR_SPAN);
        near(light(world), gold, 6, 'new run');
        world.dispose();

        // A seek lands on the same light as living through it.
        const other = makeWorld();
        other.world.holdSun(SUN_ELEVATION.rest);
        other.world.seek(HOUR_SPAN / 2);
        at(other.world, other.camera, HOUR_SPAN / 2);
        expect(apart(light(other.world), half)).toBeLessThan(0.01);
        expect(other.world.getState().hourTurn).toBeCloseTo(0.5, 9);
        other.world.dispose();
    });

    it('replays to the same state after a seek', () => {
        const run = () => {
            const { world, camera } = makeWorld();
            world.seek(5);
            world.updateCamera(camera, { time: 5, delta: 0 });
            world.update({ time: 5, delta: 0 }, camera);
            world.onLock({
                u: 0.7, rows: [12], hardDrop: true, color: '#00a8ff',
            });
            world.onCombo(3);
            step(world, camera, 5, 7, 1 / 120);
            const state = world.getState();
            world.dispose();
            return state;
        };
        expect(run()).toEqual(run());
    });

    it('draws the amphitheatre narrower on an upright screen but never the pass', () => {
        const { world } = makeWorld();
        world.setViewport(430, 932, 430 / 932);
        expect(world.squeeze).toBeLessThan(0.8);
        expect(world.root.scale.x).toBeCloseTo(world.squeeze, 6);
        expect(world.near.scale.x).toBe(1);
        expect(world.getState().lines).toBeGreaterThan(3);
    });
});
