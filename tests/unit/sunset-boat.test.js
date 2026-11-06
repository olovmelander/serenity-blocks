/**
 * Sunset — the longtail boat: the model as Blender wrote it, the passages across the far sea,
 * how often they come, the swell it rides, its lantern, and its mirror in the water.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BOAT, buildBoatGeometry, createBoat, lampForSun, longtailModel, passageAt, planPassage,
} from '../../src/themes/sunset/sunset-boat.js';
import { DEG, seaHeight } from '../../src/themes/sunset/sunset-core.js';
import { SUNSET_LONGTAIL } from '../../src/themes/sunset/sunset-longtail-model.js';
import { SunsetWorld } from '../../src/themes/sunset/sunset-world.js';
import { fallbackLayout } from '../../src/themes/sunset/sunset-composition.js';

const bearing = (x, z) => Math.atan2(x, -z) / DEG;

/** A boat out of a world (its uniforms are the world's), and a clock to run it on. */
function makeBoat(seed = 29) {
    const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
    const boat = createBoat({ U: world.U, seed });
    return boat;
}

/** Run a boat from `from` to `to` (seconds), recording when it sails. */
function sail(boat, from, to, dt = 0.5) {
    const runs = [];
    let current = null;
    for (let t = from; t <= to; t += dt) {
        boat.update(t, { halfView: 40, night: 0 });
        const s = boat.getState();
        if (s.sailing && !current) {
            current = { from: t, to: t };
            runs.push(current);
        } else if (s.sailing) {
            current.to = t;
        } else {
            current = null;
        }
    }
    return runs;
}

describe('sunset boat: the model', () => {
    it('is the longtail Blender wrote, real size, its waterline at y = 0', () => {
        const m = longtailModel();
        expect(m.vertexCount).toBe(SUNSET_LONGTAIL.vertexCount);
        expect(m.positions).toHaveLength(m.vertexCount * 3);
        expect(m.index).toHaveLength(SUNSET_LONGTAIL.triangleCount * 3);
        expect(m.colours).toHaveLength(m.vertexCount * 4);
        let minY = Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let i = 1; i < m.positions.length; i += 3) {
            minY = Math.min(minY, m.positions[i]);
            maxY = Math.max(maxY, m.positions[i]);
            maxZ = Math.max(maxZ, m.positions[i + 1]);
        }
        // The keel and the shaft's end under the water, the pennant on the prow's tip above it.
        expect(minY).toBeLessThan(-0.25);
        expect(maxY).toBeGreaterThan(2.6);
        expect(maxY).toBeLessThan(3.2);
        // The bow forward (+z), the hull 11 m from the transom to the prow's tip.
        expect(maxZ).toBeCloseTo(SUNSET_LONGTAIL.bow, 1);
        expect(SUNSET_LONGTAIL.bow - SUNSET_LONGTAIL.stern).toBeCloseTo(11, 0);
        expect(m.triangleCount).toBeLessThan(2500);
    });

    it('faces its hull outward, so the light falls on the side the eye sees', () => {
        const geometry = buildBoatGeometry();
        const pos = geometry.getAttribute('position');
        const nor = geometry.getAttribute('normal');
        const paint = geometry.getAttribute('color');
        let checked = 0;
        let outward = 0;
        for (let i = 0; i < pos.count; i += 1) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            // The hull's flanks amidships, above the waterline and below the sheer.
            if (Math.abs(x) < 0.6 || y < 0.05 || y > 0.45 || Math.abs(z) > 2.5) continue;
            if (paint.getW(i) > 0) continue;
            checked += 1;
            if (Math.sign(nor.getX(i)) === Math.sign(x)) outward += 1;
        }
        expect(checked).toBeGreaterThanOrEqual(8);
        expect(outward / checked).toBeGreaterThan(0.95);
        geometry.dispose();
    });

    it('carries a lantern whose glass alone is lit', () => {
        const m = longtailModel();
        let glass = 0;
        for (let i = 0; i < m.vertexCount; i += 1) {
            if (m.colours[i * 4 + 3] > 0) {
                glass += 1;
                const y = m.positions[i * 3 + 1];
                expect(Math.abs(y - SUNSET_LONGTAIL.lantern[1])).toBeLessThan(0.15);
            }
        }
        expect(glass).toBeGreaterThan(0);
        expect(glass).toBeLessThan(40);
    });
});

describe('sunset boat: a passage', () => {
    it('comes in past one edge of the view and goes out past the other, at its range', () => {
        [1, -1].forEach((dir) => {
            const p = planPassage({
                at: 100, halfView: 40, dir, range: 320, speed: 5.5, slant: 6,
            });
            const at = { x: 0, z: 0, u: 0 };
            passageAt(p, 100, at);
            expect(bearing(at.x, at.z)).toBeCloseTo(-dir * (40 + BOAT.margin), 4);
            passageAt(p, 100 + p.seconds, at);
            expect(bearing(at.x, at.z)).toBeCloseTo(dir * (40 + BOAT.margin), 4);
            expect(at.u).toBeCloseTo(1, 6);
            // Halfway it is straight ahead at its range (the slant turns it a little nearer or further).
            const half = passageAt(p, 100 + p.seconds / 2, {});
            expect(Math.abs(half.z)).toBeGreaterThan(280);
            expect(Math.abs(half.z)).toBeLessThan(360);
            // Its bow points along its course.
            expect(Math.sin(p.heading)).toBeCloseTo(p.dx, 6);
            expect(Math.cos(p.heading)).toBeCloseTo(p.dz, 6);
            expect(Math.sign(p.dx)).toBe(dir);
        });
    });

    it('takes its time: a minute and a half or two across a wide frame, less across a phone', () => {
        const wide = planPassage({
            at: 0, halfView: 40, dir: 1, range: 340, speed: 5.6, slant: 0,
        });
        expect(wide.seconds).toBeGreaterThan(80);
        expect(wide.seconds).toBeLessThan(140);
        const phone = planPassage({
            at: 0, halfView: 23.7, dir: 1, range: 340, speed: 5.6, slant: 0,
        });
        expect(phone.seconds).toBeLessThan(wide.seconds);
    });

    it('stays far out and below the horizon, where the eye sees it on the sea', () => {
        const p = planPassage({
            at: 0, halfView: 40, dir: -1, range: BOAT.range[0], speed: 5, slant: BOAT.angle,
        });
        for (let k = 0; k <= 20; k += 1) {
            const at = passageAt(p, (p.seconds * k) / 20, {});
            const far = Math.hypot(at.x, at.z);
            expect(far).toBeGreaterThan(200);
            // The waterline 3.2 m under the eye, so always under the horizon line.
            expect(Math.atan(3.2 / far) / DEG).toBeGreaterThan(0.3);
        }
    });
});

describe('sunset boat: when it comes', () => {
    it('waits a while after a start, then crosses now and then, never two at once', () => {
        const boat = makeBoat();
        boat.restart(0);
        const runs = sail(boat, 0, 3600);
        expect(runs.length).toBeGreaterThanOrEqual(6);
        expect(runs.length).toBeLessThanOrEqual(14);
        expect(runs[0].from).toBeGreaterThanOrEqual(BOAT.firstWait[0]);
        expect(runs[0].from).toBeLessThanOrEqual(BOAT.firstWait[1] + 0.5);
        for (let i = 1; i < runs.length; i += 1) {
            const gap = runs[i].from - runs[i - 1].to;
            expect(gap).toBeGreaterThanOrEqual(BOAT.gap[0] - 0.5);
            expect(gap).toBeLessThanOrEqual(BOAT.gap[1] + 1);
        }
        // On the water a third of the time or less: now and then, not always.
        const sailing = runs.reduce((sum, r) => sum + (r.to - r.from), 0);
        expect(sailing / 3600).toBeLessThan(0.36);
        expect(sailing / 3600).toBeGreaterThan(0.12);
        boat.dispose();
    });

    it('is the same boat after a seek to the same time', () => {
        const a = makeBoat();
        const b = makeBoat();
        a.restart(50);
        sail(a, 50, 700);
        const first = a.getState();
        // Elsewhere first, then back to the same start: the same passages.
        b.restart(900);
        sail(b, 900, 1200);
        b.restart(50);
        sail(b, 50, 700);
        expect(b.getState()).toEqual(first);
        a.dispose();
        b.dispose();
    });

    it('can be sent across at once, and goes when its passage is done', () => {
        const boat = makeBoat();
        boat.restart(0);
        boat.send(5, 40, { dir: -1, range: 300, speed: 6 });
        boat.update(10, { halfView: 40 });
        const s = boat.getState();
        expect(s.sailing).toBe(true);
        expect(s.dir).toBe(-1);
        expect(s.range).toBe(300);
        boat.update(5 + s.seconds + 1, { halfView: 40 });
        expect(boat.getState().sailing).toBe(false);
        expect(boat.mesh.visible).toBe(false);
        boat.dispose();
    });
});

describe('sunset boat: afloat', () => {
    it('rides the swell under it and turns along its course', () => {
        const boat = makeBoat();
        boat.restart(0);
        boat.send(0, 40, {
            dir: 1, range: 320, speed: 5.5, slant: 0,
        });
        [3, 20, 47.5].forEach((t) => {
            boat.update(t, { halfView: 40 });
            const s = boat.getState();
            expect(s.y).toBeCloseTo(seaHeight(s.x, s.z, t) * 0.75, 6);
            const forward = new THREE.Vector3(0, 0, 1).transformDirection(boat.mesh.matrix);
            expect(forward.x).toBeGreaterThan(0.95);
            // It rocks gently, never more than a few degrees.
            const up = new THREE.Vector3(0, 1, 0).transformDirection(boat.mesh.matrix);
            expect(up.y).toBeGreaterThan(Math.cos(6 * DEG));
        });
        boat.dispose();
    });

    it('lights its lantern from dusk and puts it out by morning', () => {
        expect(lampForSun(20)).toBe(0);
        expect(lampForSun(-10)).toBe(1);
        expect(lampForSun(0)).toBeGreaterThan(0.3);
        expect(lampForSun(0)).toBeLessThan(0.8);
        const boat = makeBoat();
        boat.restart(0);
        boat.send(0, 40, { dir: 1, range: 320 });
        boat.update(30, { halfView: 40, night: 0 });
        expect(boat.lampLight()).toBe(null);
        boat.update(31, { halfView: 40, night: 1 });
        const lamp = boat.lampLight();
        expect(lamp.glow).toBeGreaterThan(0.5);
        const s = boat.getState();
        // The lantern hangs from the canopy, a man's height or so over the water.
        expect(lamp.y - s.y).toBeGreaterThan(1.4);
        expect(lamp.y - s.y).toBeLessThan(2.2);
        expect(Math.hypot(lamp.x - s.x, lamp.z - s.z)).toBeLessThan(2);
        boat.dispose();
    });

    it('is mirrored in the water under it', () => {
        const boat = makeBoat();
        boat.restart(0);
        boat.send(0, 40, { dir: -1, range: 300, slant: 5 });
        boat.update(22, { halfView: 40 });
        boat.mesh.updateMatrixWorld(true);
        const mirror = boat.mesh.children[0];
        expect(mirror.material.name).toBe('sunset-boat-mirror');
        const { y } = boat.getState();
        // A point of the canopy, on the boat and in its mirror: the same place, mirrored in the water.
        const local = new THREE.Vector3(0.4, 2.0, -1.0);
        const real = local.clone().applyMatrix4(boat.mesh.matrixWorld);
        const seen = local.clone().applyMatrix4(mirror.matrixWorld);
        expect(seen.x).toBeCloseTo(real.x, 4);
        expect(seen.z).toBeCloseTo(real.z, 4);
        expect(seen.y).toBeCloseTo(2 * y - real.y, 4);
        boat.dispose();
    });
});

describe('sunset boat: in the world', () => {
    it('crosses the frame on the sea when sent, and a capture can leave it out', () => {
        const scene = new THREE.Scene();
        const world = new SunsetWorld({ scene, quality: 'Low' }).build();
        const camera = new THREE.PerspectiveCamera(50, 1600 / 852, 0.25, 40000);
        world.bindCamera(camera);
        world.setLayout(fallbackLayout(1600, 852), 1600 / 852);
        world.setViewport(1600, 852, 1600 / 852);
        world.seek(10);
        world.sendBoat({ dir: 1, range: 300 });
        let t = world.clock;
        const step = (seconds) => {
            for (let i = 0; i < seconds * 10; i += 1) {
                t += 0.1;
                const sim = {
                    time: t, delta: 0.1, pointerX: 0, pointerY: 0,
                };
                world.updateCamera(camera, sim);
                world.update(sim, camera);
            }
        };
        step(40);
        const { boat } = world.getState();
        expect(boat.sailing).toBe(true);
        expect(world.parts.boat.mesh.visible).toBe(true);
        const p = new THREE.Vector3(boat.x, boat.y, boat.z).project(camera);
        // In the picture, just under the horizon.
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(0.5 - p.y * 0.5).toBeGreaterThan(world.frame.horizon);
        expect(0.5 - p.y * 0.5).toBeLessThan(world.frame.horizon + 0.05);
        world.showOnlyParts(['sky', 'sea']);
        step(1);
        expect(world.parts.boat.mesh.visible).toBe(false);
        world.showOnlyParts(['sky', 'sea', 'boat']);
        step(1);
        expect(world.parts.boat.mesh.visible).toBe(true);
        // A seek starts the evening over: no boat until the first passage is due.
        world.seek(20);
        expect(world.getState().boat.sailing).toBe(false);
        world.dispose();
    });
});
