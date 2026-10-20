/**
 * A FOREST CHUNK IS NEVER CULLED WHILE ONE OF ITS TREES IS IN FRAME (2026-10-20 audit of
 * everything that disappears before the camera has passed it).
 *
 * Each chunk is one instanced draw with a culling sphere about its trees' MEAN position. The
 * radius was `0.75 x edge + half height + 40`, which only holds while a cell is evenly filled: in
 * a lopsided one a tree can stand ~1.4 x edge from the mean, outside the sphere, and the whole
 * chunk is then culled while that tree is still on screen. On the shipped forest no trunk was
 * outside, but the tightest stood 6.5 u inside the edge — less than a crown. forestCullRadius now
 * never drops below the real spread plus the 40 u crown allowance.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createOdysseyWorld, forestCullRadius } from './odyssey-world-renderer.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

/** Room every trunk must have inside its chunk's sphere: the crown allowance. */
const CROWN_ROOM = 40;

describe('forest chunk culling spheres', () => {
    it('covers the farthest tree of a lopsided cell', () => {
        // A 420 u cell whose trees huddle in one corner but for one at the far corner.
        const spread = 420 * Math.SQRT2 * 0.95;
        expect(forestCullRadius(420, spread, 30)).toBeGreaterThanOrEqual(Math.hypot(spread, 30) + CROWN_ROOM);
        // An evenly filled cell keeps the old radius (no culling given up for nothing).
        expect(forestCullRadius(420, 250, 30)).toBe((420 * 0.75) + 30 + 40);
    });

    // Building the shipped forest takes a second or two; under a full-suite load it can pass 5 s.
    it('leaves every trunk of the shipped forest a crown inside its own sphere', { timeout: 30000 }, () => {
        const railSamples = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const world = createOdysseyWorld({ quality: 'high', railSamples });
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        let chunks = 0;
        let tightest = Infinity;
        world.group.traverse((o) => {
            if (!o.isInstancedMesh || !o.boundingSphere || !/forest/.test(o.name)) return;
            chunks += 1;
            for (let i = 0; i < o.count; i += 1) {
                o.getMatrixAt(i, m);
                p.setFromMatrixPosition(m);
                tightest = Math.min(tightest, o.boundingSphere.radius - p.distanceTo(o.boundingSphere.center));
            }
        });
        expect(chunks).toBeGreaterThan(10);
        expect(tightest).toBeGreaterThanOrEqual(CROWN_ROOM - 1e-6);
    });
});
