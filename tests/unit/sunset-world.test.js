/**
 * Sunset — the world, built for real in Node (no renderer): what the board does to it, where
 * things land on screen, how the hour moves, and the meshes it builds in code.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SUNSET_PARTS, SunsetWorld, birdsForCombo, fireForCombo,
} from '../../src/themes/sunset/sunset-world.js';
import { QUALITY_NAMES } from '../../src/themes/sunset/sunset-quality.js';
import { fallbackLayout, frameFor } from '../../src/themes/sunset/sunset-composition.js';
import { HOUR_SECONDS } from '../../src/themes/sunset/sunset-hours.js';
import { buildSeaFan } from '../../src/themes/sunset/sunset-sea.js';
import { buildLanternGeometry } from '../../src/themes/sunset/sunset-lanterns.js';
import { buildBirdGeometry } from '../../src/themes/sunset/sunset-birds.js';

const W = 1600;
const H = 852;

function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new SunsetWorld({ scene, quality: 'Low', ...options }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.25, 40000);
    world.bindCamera(camera);
    const layout = options.noBoard ? null : fallbackLayout(W, H);
    world.setLayout(layout, W / H);
    world.setViewport(W, H, W / H);
    world.seek(options.start ?? 10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        const n = Math.round(seconds / dt);
        for (let i = 0; i < n; i += 1) {
            t += dt;
            const sim = {
                time: t, delta: dt, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    };
    step(0.5);
    return {
        world, camera, scene, layout, step,
    };
}

const onScreen = (camera, p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
};
const inside = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

describe('sunset world: building', () => {
    it('builds every tier with every part, and draws only the parts asked for', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld({ quality });
            expect(Object.keys(world.parts).sort()).toEqual([...SUNSET_PARTS].sort());
            world.showOnlyParts(['sky', 'sea']);
            expect(world.parts.lanterns.mesh.visible).toBe(false);
            expect(world.parts.sky.mesh.visible).toBe(true);
            world.dispose();
            expect(scene.children).toHaveLength(0);
        });
    });

    it('builds its sea, lanterns and birds facing the way they are seen', () => {
        const fan = buildSeaFan(12, 9);
        const p = fan.positions;
        let up = 0;
        for (let i = 0; i < fan.indices.length; i += 3) {
            const corner = (k) => new THREE.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
            const [a, b, c] = [fan.indices[i], fan.indices[i + 1], fan.indices[i + 2]].map(corner);
            up += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).y;
        }
        expect(up).toBeGreaterThan(0);
        const lantern = buildLanternGeometry();
        expect(lantern.getAttribute('aPart')).toBeDefined();
        lantern.computeBoundingBox();
        expect(lantern.boundingBox.min.y).toBeGreaterThanOrEqual(-1e-6); // it floats on its foot
        const bird = buildBirdGeometry();
        expect(bird.getAttribute('aSpan').array.every((v) => v >= 0 && v <= 1)).toBe(true);
    });
});

describe('sunset world: the frame', () => {
    it('sets the sun left of the card and the moon right of the card and the stats', () => {
        const layout = fallbackLayout(W, H);
        const f = frameFor(W / H, layout);
        expect(f.sunX).toBeLessThan(layout.cards[0].x0);
        expect(f.moonX).toBeGreaterThan(Math.max(layout.cards[0].x1, layout.hud.x1));
        expect(f.horizon).toBeGreaterThan(0.5);
        expect(f.sunAz).toBeLessThan(0);
        expect(f.moonAz).toBeGreaterThan(0);
    });

    it('puts the horizon and the setting sun where the frame says, on screen', () => {
        const { world, camera } = makeWorld({ hour: 1 });
        const horizon = onScreen(camera, { x: 0, y: camera.position.y, z: -20000 });
        expect(horizon.y).toBeCloseTo(world.frame.horizon, 1);
        const sun = world.U.sun.value;
        const s = onScreen(camera, {
            x: camera.position.x + sun.x * 1000,
            y: camera.position.y + sun.y * 1000,
            z: camera.position.z + sun.z * 1000,
        });
        expect(s.x).toBeCloseTo(world.frame.sunX, 1);
        expect(s.y).toBeLessThan(world.frame.horizon + 0.01);
    });
});

describe('sunset world: what the board does', () => {
    it('sets a lock\'s lantern on the sea beside the card, never behind it', () => {
        const {
            world, camera, layout, step,
        } = makeWorld();
        const card = layout.cards[0];
        for (let i = 0; i < 12; i += 1) {
            world.onLock({
                rows: [19 - (i % 12), 18 - (i % 12)], u: (i * 0.29) % 1, color: '#ff4d8f', hardDrop: i % 3 === 0,
            });
            step(0.25);
        }
        step(1);
        const st = {};
        let seen = 0;
        world.pool.records.forEach((r) => {
            world.pool.stateOf(r, world.clock, st);
            if (st.phase !== 'water') return;
            seen += 1;
            const p = onScreen(camera, { x: st.x, y: st.y + 0.3, z: st.z });
            expect(inside(card, p), `lantern at ${p.x.toFixed(2)},${p.y.toFixed(2)}`).toBe(false);
            expect(p.y).toBeGreaterThan(world.frame.horizon);
            expect(p.x).toBeGreaterThan(0);
            expect(p.x).toBeLessThan(1);
        });
        expect(seen).toBeGreaterThan(3);
        expect(world.getState().rings).toBeGreaterThan(0);
    });

    it('lands a piece low on the stack nearer the eye than one high up', () => {
        const { world, step } = makeWorld();
        const low = world.pool.send.bind(world.pool);
        const sent = [];
        world.pool.send = (...args) => {
            const r = low(...args);
            sent.push(Math.hypot(r.x0, r.z0));
            return r;
        };
        world.onLock({ rows: [19], u: 0.1, color: '#ffd700' });
        world.onLock({ rows: [3], u: 0.1, color: '#ffd700' });
        step(0.1);
        expect(sent[0]).toBeLessThan(sent[1]);
    });

    it('lifts a lantern for each line, all of them for four, and turns them for a T-spin', () => {
        const { world, step } = makeWorld();
        for (let i = 0; i < 8; i += 1) {
            world.onLock({ rows: [19 - i], u: (i * 0.37) % 1, color: '#ff8a65' });
            step(0.4);
        }
        step(1);
        const afloat = world.pool.floating(world.clock);
        world.onClear({ lines: 2, rows: [19, 18] });
        step(1.5);
        expect(world.pool.flying(world.clock)).toBe(2);
        world.onClear({ lines: 2, rows: [19, 18], tspin: true });
        step(1.5);
        expect(world.pool.records.some((r) => r.spiral !== 0)).toBe(true);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        step(3);
        expect(world.pool.floating(world.clock)).toBe(0);
        expect(world.getState().lifted).toBe(afloat);
    });

    it('shows the green flash for four lines only while the sun is low', () => {
        const low = makeWorld({ hour: 1 });
        low.world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        low.step(0.8);
        expect(low.world.getState().green).toBeGreaterThan(0.5);
        low.step(4);
        expect(low.world.getState().green).toBe(0);
        const night = makeWorld({ hour: 3 });
        night.world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        night.step(0.8);
        expect(night.world.getState().green).toBe(0);
    });

    it('sets the sky on fire with a chain and calls the gulls from three clears', () => {
        expect(fireForCombo(1)).toBe(0);
        expect(fireForCombo(5)).toBeGreaterThan(fireForCombo(3));
        expect(birdsForCombo(2, 20)).toBe(0);
        expect(birdsForCombo(3, 20)).toBeGreaterThan(0);
        expect(birdsForCombo(9, 20)).toBe(20);
        const { world, step } = makeWorld({ hour: 0.8 });
        world.onCombo(2);
        step(2);
        expect(world.getState().birds).toBe(0);
        world.onCombo(4);
        step(2);
        expect(world.getState().fire).toBeGreaterThan(0.4);
        expect(world.getState().birds).toBeGreaterThan(0);
        world.onCombo(0);
        step(12);
        expect(world.getState().fire).toBeLessThan(0.1);
    });

    it('turns the hour on a level, eased, and the clock turns it on its own', () => {
        const { world, step } = makeWorld({ start: 0 });
        const p0 = world.hourPlace();
        step(60);
        const p1 = world.hourPlace();
        expect(p1 - p0).toBeCloseTo(60 / HOUR_SECONDS, 2);
        world.levelUp(2);
        step(0.5);
        const mid = world.hourPlace() - world.clock / HOUR_SECONDS;
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
        step(10);
        expect(world.hourPlace() - world.clock / HOUR_SECONDS).toBeCloseTo(1, 4);
    });

    it('starts a new run with nothing on the water and the clock still running', () => {
        const { world, step } = makeWorld();
        world.onLock({ rows: [19], u: 0.2, color: '#ffd700' });
        world.levelUp(4);
        step(5);
        const { clock } = world;
        world.resetSession();
        expect(world.pool.floating(world.clock)).toBe(0);
        expect(world.getState().rings).toBe(0);
        expect(world.clock).toBe(clock);
        // The light runs on round the wheel to golden hour, forward.
        const before = world.hourPlace();
        step(1);
        expect(world.hourPlace()).toBeGreaterThan(before);
    });
});
