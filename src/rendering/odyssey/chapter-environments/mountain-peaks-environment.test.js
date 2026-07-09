import { describe, expect, it } from 'vitest';
import {
    createMountainPeaksEnvironment,
    resolveMountainPeaksEntryState,
    updateMountainPeaksEnvironment,
} from './mountain-peaks.js';
import { CANONICAL_HERO_MOUNTAIN_SPEC_IDS } from './shared/canonical-mountain-range.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

describe('Mountain Peaks chapter environment (creative plan ch4)', () => {
    it('mounts the banner plume, prayer flags, waymarks, and eagles — and no stars', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });

        expect(group.userData.bannerPlume?.name).toBe('summit-banner-plume');
        expect(group.userData.prayerFlags?.name).toBe('prayer-flag-line');
        expect(group.userData.waymarks?.name).toBe('alpine-waymarks');
        expect(group.userData.eagles?.name).toBe('mountain-eagles');
        expect(group.userData.mainPeaks?.userData.specIds)
            .toEqual([...CANONICAL_HERO_MOUNTAIN_SPEC_IDS]);
        expect(group.userData.mainPeaks?.children)
            .toHaveLength(CANONICAL_HERO_MOUNTAIN_SPEC_IDS.length);
        expect(group.userData.mainPeaks?.userData.isSingleHeroChain).toBe(true);
        expect(group.userData.foregroundRidge).toBeNull();
        // Cairns ×2 + summit cross live inside the waymarks group.
        expect(group.userData.waymarks.children.length).toBeGreaterThanOrEqual(3);
        // Stars are Chapter 6's identity — the alpine act is starless (creative plan).
        expect(group.userData.stars).toBeUndefined();
        expect(group.getObjectByName('mountain-stars')).toBeUndefined();
    });

    it('keeps aurora out of the 3-4 entry and reveals it only near the 4-5 seam', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });
        const positions = getActiveOdysseyChapterPositions();
        const tStart = positions[3];
        const tEnd = positions[4];
        const targets = group.userData.auroraOpacityUniformTargets;
        expect(targets.length).toBeGreaterThan(0);
        expect(group.userData.aurora.visible).toBe(false);

        // Mid-chapter: still off, so the 3->4 mountain entry stays mountain-only.
        updateMountainPeaksEnvironment(group, 0.016, 1.0, null, tStart + (tEnd - tStart) * 0.5);
        const midRatio = targets[0].value / targets[0].__odysseyBaseOpacity;
        expect(midRatio).toBe(0);
        expect(group.userData.aurora.visible).toBe(false);

        // Late chapter: faint preview begins before the handoff to Sky.
        updateMountainPeaksEnvironment(group, 0.016, 1.5, null, tStart + (tEnd - tStart) * 0.74);
        const lateRatio = targets[0].value / targets[0].__odysseyBaseOpacity;
        expect(lateRatio).toBeGreaterThan(0.02);
        expect(lateRatio).toBeLessThan(0.12);
        expect(group.userData.aurora.visible).toBe(true);

        // At the boundary: a faint READABLE arc — brighter than the preview, still well
        // below full strength (Chapter 5's staged ramp inherits this level).
        updateMountainPeaksEnvironment(group, 0.016, 2.0, null, tEnd);
        const seamRatio = targets[0].value / targets[0].__odysseyBaseOpacity;
        expect(seamRatio).toBeGreaterThan(lateRatio);
        expect(seamRatio).toBeLessThan(0.5);
    });

    it('keeps the hero chain pinned while fading only Ch4-only assets at the seam', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });
        const positions = getActiveOdysseyChapterPositions();
        const tStart = positions[3];
        const tEnd = positions[4];
        const baseY = group.userData.mainPeaks.userData.seamBaseY;

        updateMountainPeaksEnvironment(group, 0.016, 1.0, null, tEnd);
        expect(group.userData.mainPeaks.position.y).toBe(baseY);
        group.userData.mainPeaks.userData.parts.forEach((part) => {
            const target = part.uniforms.uOpacity;
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 1, 5);
        });
        // The new assets ride the same seam fade (uOpacity targets registered).
        const opacityTargets = group.userData.mountainOpacityUniformTargets;
        expect(opacityTargets.length).toBeGreaterThan(4);
        opacityTargets.forEach((target) => {
            expect(target.value).toBeLessThan(target.__odysseyBaseOpacity ?? 1);
        });

        // Mid-chapter: everything restored to authored opacity.
        updateMountainPeaksEnvironment(group, 0.016, 2.0, null, tStart + (tEnd - tStart) * 0.4);
        opacityTargets.forEach((target) => {
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 1, 5);
        });
    });

    it('fades hero peaks into the 3-4 seam without fading them out at 4-5', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });
        const positions = getActiveOdysseyChapterPositions();
        const ch3Start = positions[2];
        const ch4Start = positions[3];
        const ch4End = positions[4];
        const span = ch4Start - ch3Start;
        const targets = group.userData.mainPeakOpacityUniformTargets;

        expect(targets).toHaveLength(CANONICAL_HERO_MOUNTAIN_SPEC_IDS.length);
        expect(resolveMountainPeaksEntryState(ch4Start - span * 0.25, positions).entryOpacity).toBe(0);
        expect(resolveMountainPeaksEntryState(ch4Start, positions).entryOpacity).toBe(1);

        updateMountainPeaksEnvironment(group, 0.016, 1.0, null, ch4Start - span * 0.25);
        targets.forEach((target) => {
            expect(target.value).toBe(0);
        });

        updateMountainPeaksEnvironment(group, 0.016, 1.2, null, ch4Start);
        targets.forEach((target) => {
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 1, 5);
        });

        updateMountainPeaksEnvironment(group, 0.016, 1.4, null, ch4End);
        targets.forEach((target) => {
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 1, 5);
        });
    });
});
