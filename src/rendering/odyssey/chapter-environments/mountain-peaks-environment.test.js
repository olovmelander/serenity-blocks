import { describe, expect, it } from 'vitest';
import {
    createMountainPeaksEnvironment,
    updateMountainPeaksEnvironment,
} from './mountain-peaks.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

describe('Mountain Peaks chapter environment (creative plan ch4)', () => {
    it('mounts the banner plume, prayer flags, waymarks, and eagles — and no stars', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });

        expect(group.userData.bannerPlume?.name).toBe('summit-banner-plume');
        expect(group.userData.prayerFlags?.name).toBe('prayer-flag-line');
        expect(group.userData.waymarks?.name).toBe('alpine-waymarks');
        expect(group.userData.eagles?.name).toBe('mountain-eagles');
        // Cairns ×2 + summit cross live inside the waymarks group.
        expect(group.userData.waymarks.children.length).toBeGreaterThanOrEqual(3);
        // Stars are Chapter 6's identity — the alpine act is starless (creative plan).
        expect(group.userData.stars).toBeUndefined();
        expect(group.getObjectByName('mountain-stars')).toBeUndefined();
    });

    it('caps the aurora at a faint preview and brightens it only into the 4→5 seam', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });
        const positions = getActiveOdysseyChapterPositions();
        const tStart = positions[3];
        const tEnd = positions[4];
        const targets = group.userData.auroraOpacityUniformTargets;
        expect(targets.length).toBeGreaterThan(0);

        // Mid-chapter: faint preview (~22% of authored opacity).
        updateMountainPeaksEnvironment(group, 0.016, 1.0, null, tStart + (tEnd - tStart) * 0.5);
        const midRatio = targets[0].value / targets[0].__odysseyBaseOpacity;
        expect(midRatio).toBeGreaterThan(0.15);
        expect(midRatio).toBeLessThan(0.3);

        // At the boundary: a faint READABLE arc — brighter than the preview, still well
        // below full strength (Chapter 5's staged ramp inherits this level).
        updateMountainPeaksEnvironment(group, 0.016, 2.0, null, tEnd);
        const seamRatio = targets[0].value / targets[0].__odysseyBaseOpacity;
        expect(seamRatio).toBeGreaterThan(midRatio);
        expect(seamRatio).toBeLessThan(0.5);
    });

    it('sinks the peaks and fades the new assets across the seam-exit band', () => {
        const group = createMountainPeaksEnvironment({ particleCount: 200 });
        const positions = getActiveOdysseyChapterPositions();
        const tStart = positions[3];
        const tEnd = positions[4];
        const baseY = group.userData.mainPeaks.userData.seamBaseY;

        updateMountainPeaksEnvironment(group, 0.016, 1.0, null, tEnd);
        expect(group.userData.mainPeaks.position.y).toBeLessThan(baseY);
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
});
