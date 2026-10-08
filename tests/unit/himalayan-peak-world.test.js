import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { HIMALAYAN_PEAK_PARTS, HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import {
    DEG, HOURS, SUN_ELEVATION,
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
