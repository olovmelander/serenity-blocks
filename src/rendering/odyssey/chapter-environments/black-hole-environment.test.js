import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    createBlackHoleTranscendenceEnvironment,
    updateBlackHoleTranscendenceEnvironment,
    poseGargantua,
    CH7_FOLD_ARC_SETTINGS,
    CH7_GARGANTUA,
} from './black-hole-transcendence.js';
import {
    CH7_CORRIDOR_DUST_SETTINGS,
} from './black-hole-transcendence.tsl.js';
import { ODYSSEY_CHAPTER_PROFILES } from './shared/chapter-profile.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

describe('Black Hole chapter environment (creative plan ch7)', () => {
    it('caps the locked hero shadow with the lensed fold arcs', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const { distantHole } = group.userData;

        const folds = distantHole.userData.foldArcs;
        expect(folds).toHaveLength(2);
        expect(folds[0].name).toBe('lensed-fold-top');
        expect(folds[1].name).toBe('lensed-fold-bottom');
        // The two arcs bow over and under the shadow (opposite z rotations).
        expect(folds[0].rotation.z).toBeGreaterThan(0);
        expect(folds[1].rotation.z).toBeLessThan(0);
        expect(folds[0].material.userData.emitsBloom).toBe(true);
        expect(folds[0].material.userData.foldArcOpacity).toBe(CH7_FOLD_ARC_SETTINGS.opacity);
        expect(folds[0].geometry.parameters.tube).toBe(CH7_FOLD_ARC_SETTINGS.tube);
        expect(folds[0].geometry.parameters.arc)
            .toBeCloseTo(Math.PI * CH7_FOLD_ARC_SETTINGS.sweepRatio, 5);
    });

    it('is ONE Gargantua: a face pivot square to the eye and a disk tilted near edge-on', () => {
        // Masterpiece pass (2026-10): the hero's disk used to face the camera with an 18 deg
        // tilt (a bullseye). The shadow, photon ring and fold arcs now live on a face pivot,
        // and the disk on its own pivot whose normal is within ~10 deg of the screen plane.
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const { distantHole } = group.userData;
        const { face, diskPivot, disk } = distantHole.userData;
        expect(face.name).toBe('dominant-event-horizon-anchor');
        expect(group.userData.eventHorizon).toBe(face);
        distantHole.updateMatrixWorld(true);
        const diskNormal = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(diskPivot.getWorldQuaternion(new THREE.Quaternion()));
        const towardEye = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));
        const tiltOutOfEdgeOn = Math.asin(Math.abs(diskNormal.dot(towardEye)));
        expect(tiltOutOfEdgeOn).toBeCloseTo(CH7_GARGANTUA.diskTilt, 3);
        // The disk wraps the shadow: inner edge outside the photon ring.
        expect(disk.geometry.parameters.innerRadius)
            .toBeGreaterThan(CH7_GARGANTUA.shadowRadius * CH7_GARGANTUA.photonOuter);
        // Retired: the lensing shell that sat INSIDE the opaque horizon, the off-frame halo,
        // the entry hero, the five secondary mini-holes, the glow rings, the violet wash.
        const names = [];
        group.traverse((o) => names.push(o.name));
        ['lensing-shell', 'distant-lensing-shell', 'secondary-lensing-motifs',
            'accretion-glow-rings', 'ambient-violet-wash-tsl', 'infall-streams'].forEach((n) => {
            expect(names, n).not.toContain(n);
        });
    });

    it('keeps the hero square to the eye even on the near-vertical climb', () => {
        // The ch7 spline looks almost straight up at times; a world-up lookAt basis
        // degenerates there. The pose is built on the camera's own up vector.
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 9000);
        camera.position.set(267, 1358, -1146);
        camera.lookAt(camera.position.x - 0.2, camera.position.y + 10, camera.position.z + 0.1);
        camera.updateMatrixWorld(true);
        expect(poseGargantua(group, camera, 3)).toBe(true);
        const { distantHole } = group.userData;
        group.updateMatrixWorld(true);
        const hero = distantHole.getWorldPosition(new THREE.Vector3());
        const toEye = camera.position.clone().sub(hero).normalize();
        const z = new THREE.Vector3(0, 0, 1).applyQuaternion(distantHole.getWorldQuaternion(new THREE.Quaternion()));
        expect(Number.isFinite(z.x + z.y + z.z)).toBe(true);
        expect(z.dot(toEye)).toBeGreaterThan(0.999);
        expect(hero.distanceTo(camera.position)).toBeGreaterThan(CH7_GARGANTUA.lockDepth * 0.99);
        // The lens target carries the shadow radius for the post pass.
        expect(group.userData.lensWorldPos.distanceTo(hero)).toBeLessThan(1e-3);
        expect(group.userData.lensWorldPos.lensRadius).toBe(CH7_GARGANTUA.shadowRadius);
    });

    it('scales the corridor dust and ember density with the quality preset', () => {
        const high = createBlackHoleTranscendenceEnvironment({ particleCount: 600 });
        // dust: min(maxCount, 600*2.0) = maxCount instances.
        expect(high.userData.corridorDust.geometry.instanceCount)
            .toBe(CH7_CORRIDOR_DUST_SETTINGS.maxCount);
        // embers: 600*1.6 = 960 requested, hard-capped at 620 in the builder (perf pass).
        expect(high.userData.infallEmbers.geometry.instanceCount).toBe(620);

        const sizes = high.userData.corridorDust.geometry.getAttribute('aSize').array;
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(CH7_CORRIDOR_DUST_SETTINGS.minSize);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(
            CH7_CORRIDOR_DUST_SETTINGS.minSize + CH7_CORRIDOR_DUST_SETTINGS.sizeSpan,
        );
    });

    it('keeps the chapter 7 rail below the lensed hero read', () => {
        const profile = ODYSSEY_CHAPTER_PROFILES.find((chapter) => chapter.id === 7);

        expect(profile.atmosphere.skyColor).toBe(0x160c2a);
        expect(profile.atmosphere.fogColor).toBe(0x160c2a);
        expect(profile.path.emissiveColor).toBe(0x9a2d76);
        expect(profile.path.widthScale).toBeLessThanOrEqual(0.84);
    });
});

// ── SEAMLESS PASS (2026-10) ───────────────────────────────────────────────────────────
describe('Gargantua at the seams', () => {
    const positions = getActiveOdysseyChapterPositions();
    const ch7 = positions[6];
    const ch8 = positions[7];
    // A camera that looks roughly up the chapter-8 approach.
    const cameraAt = () => {
        const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 9000);
        camera.position.set(258, 1389, -1114);
        camera.lookAt(camera.position.x - 0.05, camera.position.y + 0.72, camera.position.z - 0.69);
        camera.updateMatrixWorld(true);
        return camera;
    };

    it('takes the shadow over from the omen exactly where ch7 is first drawn, opaque', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const { horizon } = group.userData.distantHole.userData;
        expect(horizon.userData.odysseyFadeExempt).toBe(true);
        const takeover = ch7 - 0.0222;
        updateBlackHoleTranscendenceEnvironment(group, 0.016, 1, cameraAt(), takeover + 1e-4);
        expect(horizon.visible).toBe(true);
        expect(horizon.material.opacity).toBe(1);
        expect(horizon.material.transparent).toBe(false);
        updateBlackHoleTranscendenceEnvironment(group, 0.016, 1, cameraAt(), takeover - 1e-4);
        expect(horizon.visible).toBe(false);
        expect(ch8).toBeGreaterThan(ch7);
    });
});
