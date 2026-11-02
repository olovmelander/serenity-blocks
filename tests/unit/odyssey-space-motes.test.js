// SPACE THAT MOVES PAST YOU (2026-11-02; Olov: "Can we improve the particles in space?"). A sparse
// near field in chapter 6, world-fixed in a box that travels with the eye, streaked by the eye's own
// speed and pulled toward the hole as it rises (chapter-environments/odyssey-space-motes.js).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    SPACE_MOTES, createSpaceMotes, updateSpaceMotes,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-space-motes.js';
import {
    CH6_AMBIENT, SPACE_MOTES_STAGE, createCosmicExpanseEnvironment, updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { deriveOdysseyChapterPositions } from '../../src/core/odyssey/data/odyssey-layout.js';

describe('the near motes in space', () => {
    it('are sparse, seeded, and mostly small and dim', () => {
        const a = createSpaceMotes({ uTime: uniform(0) });
        const b = createSpaceMotes({ uTime: uniform(0) });
        const look = a.mesh.geometry.getAttribute('aLook').array;
        expect(Array.from(look)).toEqual(Array.from(b.mesh.geometry.getAttribute('aLook').array));
        const n = look.length / 4;
        expect(n).toBe(SPACE_MOTES.count);
        let small = 0;
        let glints = 0;
        for (let i = 0; i < n; i += 1) {
            if (look[i * 4] < (SPACE_MOTES.sizeMin + SPACE_MOTES.sizeMax) / 2) small += 1;
            glints += look[(i * 4) + 1];
        }
        expect(small / n).toBeGreaterThan(0.75);
        expect(glints / n).toBeLessThan(0.15);
        expect(CH6_AMBIENT.motes).toBe(true);
    });

    it('track the eye\'s speed, flow toward the hole, and hide without a camera', () => {
        const motes = createSpaceMotes({ uTime: uniform(0) });
        const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 5000);
        const origin = new THREE.Vector3(100, 0, 0);
        const hole = new THREE.Vector3(0, 0, -900);
        for (let f = 0; f < 60; f += 1) {
            camera.position.set(0, 0, -f * 0.5); // 30 u/s at 60 fps
            updateSpaceMotes(motes, camera, origin, 1 / 60, { reveal: 1, pull: 1, hole });
        }
        const u = motes.uniforms;
        expect(u.velocity.value.length()).toBeGreaterThan(25);
        expect(u.velocity.value.length()).toBeLessThan(35);
        expect(u.eye.value.x).toBeCloseTo(-100, 6);
        // The field drifts toward the hole (-z here).
        expect(u.flow.value.z).toBeLessThan(0);
        expect(u.warm.value).toBe(1);
        expect(motes.mesh.visible).toBe(true);
        updateSpaceMotes(motes, null, origin, 1 / 60, { reveal: 1, pull: 0 });
        expect(motes.mesh.visible).toBe(false);
        // A cut is not a speed.
        updateSpaceMotes(motes, camera, origin, 1 / 60, { reveal: 1, pull: 0 });
        camera.position.set(5000, 0, 0);
        updateSpaceMotes(motes, camera, origin, 1 / 60, { reveal: 1, pull: 0 });
        expect(u.velocity.value.length()).toBe(0);
    });

    it('come in after the Earth falls away and are gone before the mouth', () => {
        const cp = deriveOdysseyChapterPositions();
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        group.userData.chapterOpacity = 1;
        const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 20000);
        camera.position.set(0, 1200, 0);
        camera.updateMatrixWorld(true);
        const reveal = (p) => {
            updateCosmicExpanseEnvironment(group, 1 / 60, 1, camera, p);
            return group.userData.spaceMotes.uniforms.reveal.value;
        };
        expect(reveal(cp[5] + 0.005)).toBe(0);
        expect(reveal((cp[5] + cp[6]) / 2)).toBeCloseTo(1, 6);
        expect(reveal(cp[6] - (SPACE_MOTES_STAGE.outTo / 2))).toBe(0);
    });
});
