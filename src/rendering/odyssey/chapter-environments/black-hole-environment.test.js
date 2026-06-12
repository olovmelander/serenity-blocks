import { describe, expect, it } from 'vitest';
import { createBlackHoleTranscendenceEnvironment } from './black-hole-transcendence.js';

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
    });

    it('sheathes every infall stream so the swirls read as luminous ribbons', () => {
        const group = createBlackHoleTranscendenceEnvironment({ particleCount: 200 });
        const { infallStreams } = group.userData;

        // 9 core tubes + 9 glow sheaths.
        expect(infallStreams.children.length).toBe(18);
        expect(infallStreams.userData.sharedSheathMaterials).toHaveLength(3);
        infallStreams.userData.sharedSheathMaterials.forEach((material) => {
            expect(material.opacity).toBeLessThan(0.3); // soft envelope, never a wall
        });
    });

    it('scales the corridor dust and ember density with the quality preset', () => {
        const high = createBlackHoleTranscendenceEnvironment({ particleCount: 600 });
        // dust: min(1100, 600*1.8) = 1080 instances.
        expect(high.userData.corridorDust.geometry.instanceCount).toBe(1080);
        // embers: 600*1.6 = 960 requested, hard-capped at 900 in the builder.
        expect(high.userData.infallEmbers.geometry.instanceCount).toBe(900);
    });
});
