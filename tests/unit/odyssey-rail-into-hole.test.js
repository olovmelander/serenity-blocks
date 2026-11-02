// THE RAIL RUNS INTO THE HOLE (owner, 2026-11-02: "i dont like that neon line going from our path
// towards the black hole ... use the orb path going into the black hole instead of this neon
// line"). Through chapter 6's last approach the follow camera holds its aim on the rail's drawn end
// (the mouth orb), so the black hole, which hangs on the camera's own aim, stays on the rail: the
// rail climbs into the middle of the hole all the way to the mouth, and the inflow's stream is off.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import {
    GARGANTUA_LOCK, resolveGargantuaLockPosition,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import { RAIL_END_AIM } from '../../src/rendering/odyssey/OdysseyCameraController.js';

describe('the rail runs into the hole', () => {
    const rig = createOdysseyCameraRig();
    const curve = getOdysseyPathCurve();
    const mouthP = rig.cp[6];
    const mouth = curve.getPointAt(mouthP);

    it('keeps the mouth orb inside the hole\'s shadow on screen all the way to it', () => {
        const hole = new THREE.Vector3();
        const v = new THREE.Vector3();
        for (let p = mouthP - 0.03; p <= mouthP + 1e-9; p += 0.002) {
            const cam = rig.poseAt(p);
            resolveGargantuaLockPosition(cam, hole);
            const centre = hole.clone().project(cam);
            const radius = Math.tan(Math.asin(GARGANTUA_LOCK.shadowRadius / hole.distanceTo(cam.position)))
                / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
            v.copy(mouth).project(cam);
            const off = Math.hypot((v.x - centre.x) * cam.aspect, v.y - centre.y);
            // Inside the shadow, with room: the rail ends in the hole, not at its rim (it was outside
            // from p ~0.865, up to 31 degrees off the aim at the mouth).
            expect(off, `p ${p.toFixed(4)}`).toBeLessThan(radius * 0.6);
        }
    });

    it('aims straight at the mouth on the last stretch', () => {
        const forward = new THREE.Vector3();
        for (let p = mouthP - 0.01; p <= mouthP + 1e-9; p += 0.002) {
            const cam = rig.poseAt(p);
            cam.getWorldDirection(forward);
            const toMouth = mouth.clone().sub(cam.position).normalize();
            expect(THREE.MathUtils.radToDeg(forward.angleTo(toMouth)), `p ${p.toFixed(4)}`).toBeLessThan(2.5);
        }
    });

    it('holds nothing far from the hole, and lets go inside it', () => {
        const scratch = new THREE.Vector3();
        expect(rig.controller._resolveRailEndAim(0.5, 0.48, scratch)).toBe(0);
        expect(rig.controller._resolveRailEndAim(mouthP - RAIL_END_AIM.lead - 0.001, mouthP - 0.03, scratch)).toBe(0);
        expect(rig.controller._resolveRailEndAim(mouthP + 0.01, mouthP - 0.01, scratch)).toBe(1);
        expect(rig.controller._resolveRailEndAim(0.95, 0.92, scratch)).toBe(0);
    });
});
