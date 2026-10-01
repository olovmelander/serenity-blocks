import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ShiftingSandsWorld, WORLD_TIERS } from '../../src/themes/shifting-sands/shifting-sands-world.js';
import { FX_TIERS } from '../../src/themes/shifting-sands/shifting-sands-fx.js';
import { TERRAIN_TIERS } from '../../src/themes/shifting-sands/shifting-sands-terrain.js';
import { POST_LOOK } from '../../src/themes/shifting-sands/shifting-sands-post.js';
import { SIGN_LEAD } from '../../src/themes/shifting-sands/shifting-sands-worm.js';

const TIERS = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

function countDescendants(root) {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
}

function makeWorld(quality = 'Minimal') {
    const scene = new THREE.Scene();
    const world = new ShiftingSandsWorld({ scene, quality, capture: true }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 2, 26000);
    return { scene, world, camera };
}

describe('shifting sands tiers', () => {
    it('defines every quality tier for content, terrain, fx and post', () => {
        for (const t of TIERS) {
            expect(WORLD_TIERS[t]).toBeTruthy();
            expect(TERRAIN_TIERS[t]).toBeTruthy();
            expect(FX_TIERS[t]).toBeTruthy();
            expect(POST_LOOK[t]).toBeTruthy();
        }
    });

    it('scales the terrain and particle budgets monotonically with the tier', () => {
        for (let i = 1; i < TIERS.length; i++) {
            const a = TIERS[i - 1];
            const b = TIERS[i];
            const verts = (t) => TERRAIN_TIERS[t].rows * TERRAIN_TIERS[t].cols;
            expect(verts(b)).toBeGreaterThanOrEqual(verts(a));
            expect(FX_TIERS[b].motes).toBeGreaterThanOrEqual(FX_TIERS[a].motes);
            expect(FX_TIERS[b].wormSand).toBeGreaterThanOrEqual(FX_TIERS[a].wormSand);
        }
    });
});

describe('shifting sands world', () => {
    it('stands the camera above the sand and frames the suns on screen', () => {
        const { world, camera } = makeWorld();
        world.updateCamera(camera, { time: 0, pointerX: 0, pointerY: 0 });
        world.update({ time: 0, delta: 0 }, camera);
        const ground = world.field.height(camera.position.x, camera.position.z);
        expect(camera.position.y - ground).toBeGreaterThan(20);
        const sun = world.getSunScreen();
        expect(sun.visible).toBe(1);
        expect(sun.x).toBeGreaterThan(0);
        expect(sun.x).toBeLessThan(0.5);
        expect(sun.horizonY).toBeGreaterThan(sun.y);
        world.dispose();
    });

    it('creates nothing at event time: events are uniform writes', () => {
        const { scene, world, camera } = makeWorld();
        const before = countDescendants(scene);
        world.onPieceLock();
        world.onCombo(5);
        world.onLineClear(2);
        world.onLineClear(4);
        world.onLevelUp(6);
        for (let i = 1; i <= 30; i++) world.update({ time: i / 10, delta: 0.1 }, camera);
        expect(countDescendants(scene)).toBe(before);
        world.dispose();
        expect(scene.children.length).toBe(0);
    });

    it('answers a Tetris with the worm and a spice blow at its emergence', () => {
        const { world, camera } = makeWorld();
        world.seek(10);
        world.update({ time: 10, delta: 0 }, camera);
        world.onLineClear(4);
        expect(world.director.summoned).not.toBeNull();
        const blows = world.blows.uBlows.array;
        expect(blows.some((v) => v.w > 10)).toBe(true);
        const t = 10 + SIGN_LEAD.summoned + 2;
        world.update({ time: t, delta: 0.016 }, camera);
        expect(world.worm.uniforms.uB2.value.y).toBeGreaterThan(0); // the body has a radius
        world.dispose();
    });

    it('deepens the dusk with the level and lowers both suns', () => {
        const { world, camera } = makeWorld();
        const elA = world.shared.uSunA.value.y;
        const zenith = world.shared.uZenith.value.clone();
        world.onLevelUp(15);
        world.update({ time: 1, delta: 30 }, camera); // long dt: the ease completes
        expect(world.dusk).toBeGreaterThan(0.95);
        expect(world.shared.uSunA.value.y).toBeLessThan(elA);
        expect(world.shared.uZenith.value.equals(zenith)).toBe(false);
        world.resetSession();
        world.update({ time: 2, delta: 30 }, camera);
        expect(world.dusk).toBeLessThan(0.05);
        world.dispose();
    });

    it('rate-limits thumper rings and cycles their slots', () => {
        const { world } = makeWorld();
        world.seek(5);
        world.onPieceLock();
        world.onPieceLock(); // same instant: ignored
        const pulses = world.terrain.uniforms.uPulses.array;
        expect(pulses.filter((p) => p.z === 5).length).toBe(1);
        world.dispose();
    });
});
