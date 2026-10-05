import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ShiftingSandsWorld, WORLD_TIERS } from '../../src/themes/shifting-sands/shifting-sands-world.js';
import { FX_TIERS } from '../../src/themes/shifting-sands/shifting-sands-fx.js';
import { TERRAIN_TIERS } from '../../src/themes/shifting-sands/shifting-sands-terrain.js';
import { POST_LOOK } from '../../src/themes/shifting-sands/shifting-sands-post.js';
import { SETTLE, SLOT_SUMMONED } from '../../src/themes/shifting-sands/shifting-sands-worm.js';

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
        const br = world.director.summoned;
        world.update({ time: br.t0 + 2, delta: 0.016 }, camera);
        const { uB2, uB4 } = world.worm.uniforms;
        expect(uB2.array[SLOT_SUMMONED].y).toBeGreaterThan(0); // the body has a radius
        expect(uB4.array[SLOT_SUMMONED].x).toBe(1); // and is drawn
        world.dispose();
    });

    it('lets the sand outlive the worm, then leaves the erg as it found it', () => {
        const { world, camera } = makeWorld('Low');
        world.seek(10);
        world.update({ time: 10, delta: 0 }, camera);
        world.onLineClear(4);
        const br = world.director.summoned;
        const { uB2, uB4 } = world.worm.uniforms;
        const wells = world.terrain.uniforms.uWellH.array;
        const marks = (from, to) => wells.slice(from, to)
            .reduce((sum, v) => sum + Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) + Math.abs(v.w), 0);
        // Two seconds after the tail has gone under: no body, but grains in the air and a crater.
        world.update({ time: br.t0 + br.duration + 2, delta: 0.016 }, camera);
        expect(uB4.array[SLOT_SUMMONED].x).toBe(0);
        expect(uB2.array[SLOT_SUMMONED].y).toBeGreaterThan(0); // the sand still reads the path
        expect(world.wormSand.mesh.geometry.instanceCount).toBeGreaterThan(1);
        expect(world.terrain.uniforms.uWellH.array[SLOT_SUMMONED * 2 + 1].z).toBeGreaterThan(1);
        // After the settle: its marks are gone, and with no other worm about the pool is dormant.
        world.update({ time: br.t0 + br.duration + SETTLE + 0.1, delta: 0.016 }, camera);
        expect(uB2.array[SLOT_SUMMONED].y).toBe(0);
        expect(marks(SLOT_SUMMONED * 2, SLOT_SUMMONED * 2 + 2)).toBe(0);
        expect(world.terrain.uniforms.uSigns.array[SLOT_SUMMONED].w).toBe(0);
        if (!world.director.state.slots.some((slot) => slot.breach)) {
            expect(world.wormSand.mesh.geometry.instanceCount).toBe(1);
            expect(marks(0, wells.length)).toBe(0);
        }
        world.dispose();
    });

    it('tells the worm what the lens shows and what the boards cover', () => {
        const { world, camera } = makeWorld();
        world.setViewport(900, camera);
        expect(world.director.view.halfAz).toBeCloseTo(39.65, 1); // 50° vertical at 16:9
        expect(world.director.view.bands.length).toBe(0);
        world.setKeepOutRects([{
            x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
        }, null]);
        const [band] = world.director.view.bands;
        expect(band[0]).toBeCloseTo(-band[1], 6);
        expect(band[1]).toBeGreaterThan(8);
        expect(band[1]).toBeLessThan(11);
        world.setKeepOutRects([]);
        expect(world.director.view.bands.length).toBe(0);
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
