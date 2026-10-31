import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { ODYSSEY_WORLD_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_BOW } from '../../src/rendering/odyssey/world/odyssey-sky-optics.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    ODYSSEY_SHOWER, rayMeetsShower, showerBowVolume, showerCloudSpecs,
} from '../../src/rendering/odyssey/world/odyssey-shower.js';
import { validateCloudFieldClearance } from '../../src/rendering/odyssey/world/odyssey-cloud-field.js';
import { CLOUD_FIELD_CLEARANCE } from '../../src/rendering/odyssey/world/odyssey-cloud-field-specs.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';

const DEG = Math.PI / 180;

/** Directions on the primary bow, all the way round (above and below the horizon). */
function bowRing() {
    const anti = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize().negate();
    const u = new THREE.Vector3(0, 1, 0).addScaledVector(anti, -anti.y).normalize();
    const w = new THREE.Vector3().crossVectors(anti, u).normalize();
    const r = ((ODYSSEY_BOW.primary[0] + ODYSSEY_BOW.primary[1]) / 2) * DEG;
    const ring = [];
    for (let i = 0; i < 360; i += 3) {
        ring.push(anti.clone().multiplyScalar(Math.cos(r))
            .addScaledVector(u, Math.sin(r) * Math.cos(i * DEG))
            .addScaledVector(w, Math.sin(r) * Math.sin(i * DEG)));
    }
    return ring;
}

describe('the shower', () => {
    const rig = createOdysseyCameraRig();
    const ring = bowRing();

    it('lays the rain that carries the bow along the whole line, from the sea into the cloud base', () => {
        const v = showerBowVolume();
        expect(v.rx).toBeGreaterThan(ODYSSEY_SHOWER.halfLength);
        expect(v.top).toBeGreaterThan(ODYSSEY_SHOWER.base);
        expect(v.bottom).toBeLessThan(ODYSSEY_SEA_LEVEL);
        // The clouds stand over it, at its top.
        showerCloudSpecs().forEach((m) => expect(m.base).toBeLessThan(v.top));
    });

    it('puts its rain cloud in the field, clear of the rail', () => {
        const specs = showerCloudSpecs();
        expect(specs.length).toBe(ODYSSEY_SHOWER.masses);
        specs.forEach((s) => expect(s.base).toBe(ODYSSEY_SHOWER.base));
        const rail = Array.from({ length: 400 }, (_, i) => getOdysseyPathPointAt(0.063 + ((i / 399) * 0.615)));
        expect(validateCloudFieldClearance(specs, rail, CLOUD_FIELD_CLEARANCE)).toEqual([]);
    });

    it('stands most of the bow (its whole arc above the horizon) in the rain from the meadows', () => {
        [16, 21].forEach((id) => {
            const eye = rig.poseAt(rig.parkOf(id)).position;
            const above = ring.filter((d) => d.y > 0.01);
            const wet = above.filter((d) => rayMeetsShower(eye, d)).length;
            expect(wet / above.length, `L${id}`).toBeGreaterThan(0.9);
        });
    });

    it('still stands a leg of the bow in the rain below the eye from the climb', () => {
        [29, 30, 31].forEach((id) => {
            const eye = rig.poseAt(rig.parkOf(id)).position;
            const wet = ring.filter((d) => rayMeetsShower(eye, d)).length;
            expect(wet, `L${id}`).toBeGreaterThan(4);
        });
    });
});
