import { describe, expect, it } from 'vitest';
import {
    createBlackHoleTranscendenceEnvironment,
    CH7_FOLD_ARC_SETTINGS,
} from './black-hole-transcendence.js';
import {
    CH7_AMBIENT_WASH_SETTINGS,
    CH7_CORRIDOR_DUST_SETTINGS,
} from './black-hole-transcendence.tsl.js';
import { ODYSSEY_CHAPTER_PROFILES } from './shared/chapter-profile.js';

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
        expect(high.userData.ambientWash.userData.readability.centerFloor)
            .toBe(CH7_AMBIENT_WASH_SETTINGS.centerFloor);
    });

    it('keeps the chapter 7 rail below the lensed hero read', () => {
        const profile = ODYSSEY_CHAPTER_PROFILES.find((chapter) => chapter.id === 7);

        expect(profile.atmosphere.skyColor).toBe(0x160c2a);
        expect(profile.atmosphere.fogColor).toBe(0x160c2a);
        expect(profile.path.emissiveColor).toBe(0x9a2d76);
        expect(profile.path.widthScale).toBeLessThanOrEqual(0.84);
    });
});
