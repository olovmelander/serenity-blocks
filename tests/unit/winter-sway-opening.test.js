/**
 * Winter — the snow ghosts sway (winter-trees.js), and the polar bear opens on a lap of its own
 * each time the theme starts (winter-bear-plan.js `open`, winter-world.js).
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import { REST_RIG } from '../../src/themes/winter/winter-core.js';
import { SWAY, swayPhase } from '../../src/themes/winter/winter-trees.js';
import { BEAR_ROUTES, BearMind, dealLap } from '../../src/themes/winter/winter-bear-plan.js';

const ghosts = planGhosts();

function makeWorld(options = {}) {
    const world = new WinterWorld({
        scene: new THREE.Scene(), quality: 'High', capture: true, ghosts, fox: false, bear: false, ...options,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    return { world, camera };
}

const step = (world, camera, from, to, dt = 1 / 30) => {
    const steps = Math.max(1, Math.round((to - from) / dt));
    for (let i = 1; i <= steps; i++) {
        const time = from + ((to - from) * i) / steps;
        world.updateCamera(camera, { time, delta: (to - from) / steps });
        world.update({ time, delta: (to - from) / steps }, camera);
    }
};

/** Every instanced mesh of the snow ghosts. */
const ghostMeshes = (world) => {
    const out = [];
    world.parts.trees.mesh.traverse((object) => {
        if (object.isInstancedMesh) out.push(object);
    });
    return out;
};

describe('winter trees: they sway', () => {
    it('bends each tree from its foot (nothing) to its top (everything)', () => {
        const { world } = makeWorld();
        ghostMeshes(world).forEach((mesh) => {
            const up = mesh.geometry.getAttribute('aSway').array;
            const y = mesh.geometry.getAttribute('position').array;
            let low = Infinity;
            let high = -Infinity;
            for (let i = 0; i < up.length; i++) {
                expect(up[i]).toBeGreaterThanOrEqual(0);
                expect(up[i]).toBeLessThanOrEqual(1);
                low = Math.min(low, up[i]);
                high = Math.max(high, up[i]);
            }
            // (Its foot stands still, its top moves most, and higher is never bent less.)
            expect(low).toBeLessThan(0.05);
            expect(high).toBeGreaterThan(0.9);
            let lowest = 0;
            for (let i = 0; i < up.length; i++) if (y[i * 3 + 1] < y[lowest * 3 + 1]) lowest = i;
            expect(up[lowest]).toBe(low);
        });
        world.dispose();
    });

    it('gives every tree its own height, phase and place to sway by', () => {
        const { world } = makeWorld();
        const phases = new Set();
        let checked = 0;
        ghostMeshes(world).forEach((mesh) => {
            const own = mesh.geometry.getAttribute('aTree');
            expect(own.isInstancedBufferAttribute).toBe(true);
            expect(own.itemSize).toBe(4);
            const matrix = new THREE.Matrix4();
            const at = new THREE.Vector3();
            for (let i = 0; i < mesh.count; i++) {
                const [height, phase, x, z] = own.array.slice(i * 4, i * 4 + 4);
                mesh.getMatrixAt(i, matrix);
                at.setFromMatrixPosition(matrix);
                // Where it stands is where the sway reads its gust, and its phase is its place's.
                expect(x).toBeCloseTo(at.x, 4);
                expect(z).toBeCloseTo(at.z, 4);
                // (Its phase is a hash of its place: in one turn, and different from its neighbours').
                expect(phase).toBeGreaterThanOrEqual(0);
                expect(phase).toBeLessThan(1);
                expect(height).toBeGreaterThan(1);
                expect(height).toBeLessThan(20);
                phases.add(phase.toFixed(6));
                checked += 1;
            }
            // Every vertex buffer counts toward WebGPU's eight a pipeline.
            expect(Object.keys(mesh.geometry.attributes).length + 1).toBeLessThanOrEqual(8);
        });
        expect(checked).toBe(world.trees.length);
        // (No two trees in step: the phases are spread over the whole turn.)
        expect(phases.size).toBeGreaterThan(checked * 0.9);
        world.dispose();
    });

    it('runs the sway on its own clock, which a seek lands on and reduced motion slows', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 4);
        expect(world.u.sway.value.x).toBeCloseTo(4, 6);
        expect(world.u.sway.value.y).toBe(1);
        const sought = makeWorld();
        sought.world.seek(4);
        sought.world.update({ time: 4, delta: 0 }, sought.camera);
        expect(sought.world.u.sway.value.x).toBeCloseTo(4, 6);
        world.setReducedMotion(true);
        step(world, camera, 4, 6);
        expect(world.u.sway.value.x - 4).toBeCloseTo(2 * 0.3, 6);
        expect(world.u.sway.value.y).toBeLessThan(1);
        // A new run keeps the clock where it stands: no tree jumps.
        const before = world.u.sway.value.x;
        world.resetSession();
        world.update({ time: 6, delta: 0 }, camera);
        expect(world.u.sway.value.x).toBeCloseTo(before, 6);
        [world, sought.world].forEach((w) => w.dispose());
    });

    it('keeps it a sway: a tall tree\'s top moves centimetres at rest, and slowly', () => {
        // A tree's phase is a function of where it stands, in one turn, and differs from its neighbour's.
        expect(swayPhase(3.2, -14)).toBe(swayPhase(3.2, -14));
        expect(swayPhase(3.2, -14)).toBeGreaterThanOrEqual(0);
        expect(swayPhase(3.2, -14)).toBeLessThan(1);
        expect(swayPhase(3.2, -14)).not.toBe(swayPhase(3.3, -14));
        // At rest: at most rest + lean of its height (gale 0.2), here a 10 m sentinel.
        const atRest = 10 * (SWAY.rest * 1.2 + SWAY.lean * 0.2);
        expect(atRest).toBeLessThan(0.12);
        expect(atRest).toBeGreaterThan(0.04);
        // It rocks once in some five seconds; a gnome a metre and a half tall in two.
        expect((2 * Math.PI) / (SWAY.pace / Math.sqrt(10))).toBeGreaterThan(4);
        expect((2 * Math.PI) / (SWAY.pace / Math.sqrt(1.5))).toBeGreaterThan(1.6);
        // The strongest gust (a four, 1.9) moves the sentinel's top well under half a metre.
        expect(11.5 * SWAY.gust * 1.9).toBeLessThan(0.45);
    });
});

describe('winter bear: an open opening', () => {
    it('opens on the big male on its first way unless told otherwise', () => {
        const mind = new BearMind(16 / 9, { start: 0 });
        expect(mind.laps[0].way).toBe(0);
        expect(mind.laps[0].deal.kind).toBe('male');
        expect(mind.laps[0].deal.family).toBe(false);
        expect(mind.laps[0].deal.size).toBe(1);
    });

    it('opens on any of its ways, walked by any of the bears, when its opening is open', () => {
        const ways = new Set();
        const casts = new Set();
        for (let seed = 1; seed <= 120; seed++) {
            const mind = new BearMind(16 / 9, { seed: seed * 7919, open: true });
            const [first] = mind.laps;
            ways.add(first.way);
            casts.add(first.deal.family ? 'family' : first.deal.kind);
            expect(first.way).toBeGreaterThanOrEqual(0);
            expect(first.way).toBeLessThan(BEAR_ROUTES.length);
        }
        expect(ways.size).toBe(BEAR_ROUTES.length);
        expect([...casts].sort()).toEqual(['family', 'female', 'male']);
        // An open first lap is dealt as any other: the same seed gives the same lap.
        const deal = dealLap(4242, 0, 2, null, { open: true });
        expect(dealLap(4242, 0, 2, null, { open: true })).toEqual(deal);
    });

    it('is dealt afresh each time the theme starts in the game, and kept for captures', () => {
        const opens = new Set();
        for (let i = 0; i < 12; i++) {
            const world = new WinterWorld({
                scene: new THREE.Scene(), quality: 'Minimal', ghosts, fox: false, bear: false,
            });
            expect(world.bearMind.open).toBe(true);
            opens.add(world.bearMind.seed);
            world.dispose();
        }
        expect(opens.size).toBeGreaterThan(10);
        // A capture, or a world given a seed, walks the bear as it always has.
        const capture = new WinterWorld({
            scene: new THREE.Scene(), quality: 'Minimal', ghosts, capture: true, fox: false, bear: false,
        });
        expect(capture.bearMind.open).toBe(false);
        expect(capture.bearMind.laps[0].way).toBe(0);
        const seeded = new WinterWorld({
            scene: new THREE.Scene(), quality: 'Minimal', ghosts, seed: 77, fox: false, bear: false,
        });
        expect(seeded.bearMind.open).toBe(false);
        expect(seeded.bearMind.seed).toBe(77);
        [capture, seeded].forEach((w) => w.dispose());
    });
});
