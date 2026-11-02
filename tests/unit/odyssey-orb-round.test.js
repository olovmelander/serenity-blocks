// ROUND ON SCREEN (2026-11-02; Olov: "The nearest orb looks egg-shaped at the bottom edge of the
// screen"). The orb parts are squeezed about the orb's centre so a flat projection draws the orb
// round anywhere in the frame (src/rendering/odyssey/odyssey-orb-round.tsl.js).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { roundOnScreenCpu } from '../../src/rendering/odyssey/odyssey-orb-round.tsl.js';

/** The orb's outline on screen (px at 1280 x 720): its extent along and across the line from the frame's centre. */
function outline(camera, centre, radius, squeeze) {
    const cNdc = centre.clone().project(camera);
    const radial = new THREE.Vector2(cNdc.x * 640, cNdc.y * 360).normalize();
    const across = new THREE.Vector2(-radial.y, radial.x);
    let minR = Infinity; let maxR = -Infinity; let minA = Infinity; let maxA = -Infinity;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let i = 0; i < 64; i += 1) {
        for (let j = 0; j < 128; j += 1) {
            const phi = Math.PI * ((i + 0.5) / 64);
            const theta = 2 * Math.PI * (j / 128);
            p.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
                .multiplyScalar(radius).add(centre);
            if (squeeze) roundOnScreenCpu(p, centre, camera, q); else q.copy(p);
            q.project(camera);
            const s = new THREE.Vector2(q.x * 640, q.y * 360);
            const r = s.dot(radial);
            const a = s.dot(across);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
            minA = Math.min(minA, a); maxA = Math.max(maxA, a);
        }
    }
    return { along: maxR - minR, across: maxA - minA };
}

describe('the orbs draw round on screen', () => {
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 5000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);

    it('was an egg at the frame\'s foot, and is round now', () => {
        // Close, at the foot of the frame (the orb just left): ~28 deg below the axis.
        const centre = new THREE.Vector3(0, -12, -22);
        const before = outline(camera, centre, 3, false);
        const after = outline(camera, centre, 3, true);
        expect(before.along / before.across).toBeGreaterThan(1.12);
        expect(Math.abs((after.along / after.across) - 1)).toBeLessThan(0.03);
        // Its size across is untouched (within half a pixel).
        expect(Math.abs(after.across - before.across)).toBeLessThan(0.5);
    });

    it('works in a corner and leaves an orb at the centre as it was', () => {
        const corner = outline(camera, new THREE.Vector3(14, 8, -24), 2.5, true);
        expect(Math.abs((corner.along / corner.across) - 1)).toBeLessThan(0.03);
        const centred = new THREE.Vector3(0, 0, -30);
        const p = new THREE.Vector3(1.7, 0.6, -29.2);
        expect(roundOnScreenCpu(p, centred, camera, new THREE.Vector3()).distanceTo(p)).toBeLessThan(1e-9);
    });
});
