import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    resolveSurfaceWorldAuroraPreviewState,
    updateSurfaceWorldEnvironment,
    resolveSurfaceWorldVisibilityState,
} from './chapter-environments/surface-world.js';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import { getCanonicalMountainRangeWorldSpecs } from './chapter-environments/shared/canonical-mountain-range.js';
import { mountainCpuDisplacement } from './chapter-environments/shared/mountain-language.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathCurve,
    getOdysseyPathPointAt,
    resetOdysseyPathLayout,
    setOdysseyPathLayout,
} from './path-utils.js';

describe('odyssey path layout', () => {
    it('keeps the chapter 3 surfacing path vertical longer before bending into chapter 4', () => {
        const curve = getOdysseyPathCurve();

        const preBreakPoint = getOdysseyPathPointAt(0.18);
        const preBreakTangent = curve.getTangentAt(0.18);
        expect(preBreakPoint.x).toBeGreaterThanOrEqual(-20);
        expect(preBreakPoint.z).toBeGreaterThanOrEqual(-15);
        expect(preBreakTangent.y).toBeGreaterThanOrEqual(0.3);

        const forestAwakeningPoint = getOdysseyPathPointAt(0.204);
        const forestAwakeningTangent = curve.getTangentAt(0.204);
        expect(forestAwakeningPoint.x).toBeGreaterThanOrEqual(-40);
        expect(forestAwakeningPoint.x).toBeLessThanOrEqual(-20);
        expect(forestAwakeningPoint.z).toBeGreaterThanOrEqual(-48);
        expect(forestAwakeningPoint.z).toBeLessThanOrEqual(-20);
        expect(forestAwakeningTangent.y).toBeGreaterThanOrEqual(0.14);

        const chapter4StartPoint = getOdysseyPathPointAt(0.352);
        expect(chapter4StartPoint.x).toBeLessThanOrEqual(-150);
        expect(chapter4StartPoint.z).toBeGreaterThanOrEqual(-270);
        expect(chapter4StartPoint.z).toBeLessThanOrEqual(-240);

        const chapter5StartPoint = getOdysseyPathPointAt(0.500);
        expect(chapter5StartPoint.x).toBeLessThanOrEqual(-190);
        expect(chapter5StartPoint.z).toBeLessThanOrEqual(-450);

        const earlyChapter5Point = getOdysseyPathPointAt(0.556);
        expect(earlyChapter5Point.x).toBeLessThanOrEqual(-185);
        expect(earlyChapter5Point.z).toBeLessThanOrEqual(-500);

        const chapter6StartPoint = getOdysseyPathPointAt(0.648);
        expect(chapter6StartPoint.z).toBeLessThanOrEqual(-550);

        const earlyChapter6Point = getOdysseyPathPointAt(0.685);
        expect(earlyChapter6Point.z).toBeLessThanOrEqual(-590);
    });

    it('keeps the Sky Drift spline above and in front of the canonical summit mass', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch5Start = positions[4];
        const ch6Start = positions[5];
        const heroSpecs = getCanonicalMountainRangeWorldSpecs();
        let minClearance = Infinity;

        for (let i = 0; i <= 80; i += 1) {
            const t = ch5Start + (ch6Start - ch5Start) * (i / 80);
            const point = getOdysseyPathPointAt(t);
            heroSpecs.forEach((spec) => {
                const mountainHeight = mountainCpuDisplacement(
                    point.x - spec.worldPosition.x,
                    point.z - spec.worldPosition.z,
                    {
                        size: spec.size,
                        height: spec.height,
                        seed: spec.seed,
                    },
                );
                const peakSurfaceY = spec.worldPosition.y + mountainHeight;
                minClearance = Math.min(minClearance, point.y - peakSurfaceY);
            });
        }

        expect(minClearance).toBeGreaterThan(60);
    });

    it('uses the same sampled curve in the path renderer and shared path helpers', async () => {
        const scene = new THREE.Scene();
        const renderer = new OdysseyPathRenderer(scene);
        await renderer.buildPath(ODYSSEY_PATH_DATA);

        const utilsPoint = getOdysseyPathPointAt(0.204);
        const rendererPoint = renderer.pathCurve.getPointAt(0.204);

        expect(rendererPoint.x).toBeCloseTo(utilsPoint.x, 6);
        expect(rendererPoint.y).toBeCloseTo(utilsPoint.y, 6);
        expect(rendererPoint.z).toBeCloseTo(utilsPoint.z, 6);
    });

    it('rebuilds the shared curve deterministically when control points change', () => {
        const baselinePoint = getOdysseyPathPointAt(0.352);

        setOdysseyPathLayout({
            controlPoints: [
                { x: 0, y: -30, z: 0 },
                { x: 0, y: 60, z: 0 },
                { x: -50, y: 180, z: -40 },
                { x: -120, y: 320, z: -220 },
                { x: -160, y: 470, z: -500 },
                { x: 0, y: 960, z: -600 },
            ],
            chapterPositions: ODYSSEY_PATH_DATA.chapterPositions,
        });

        const updatedPoint = getOdysseyPathPointAt(0.352);
        expect(updatedPoint.x).not.toBeCloseTo(baselinePoint.x, 3);
        expect(updatedPoint.y).not.toBeCloseTo(baselinePoint.y, 3);

        resetOdysseyPathLayout();
        const resetPoint = getOdysseyPathPointAt(0.352);
        expect(resetPoint.x).toBeCloseTo(baselinePoint.x, 6);
        expect(resetPoint.y).toBeCloseTo(baselinePoint.y, 6);
        expect(resetPoint.z).toBeCloseTo(baselinePoint.z, 6);
    });

    it('reveals chapter 3 surface elements off the path probe instead of raw camera offset', () => {
        const atSurface = resolveSurfaceWorldVisibilityState({
            waterSurfaceY: 204,
            surfaceProbeY: 204,
            cameraY: 203,
        });
        expect(atSurface.isUnderwater).toBe(false);
        expect(atSurface.surfaceOpacity).toBeGreaterThan(0.9);

        const deepBelowSurface = resolveSurfaceWorldVisibilityState({
            waterSurfaceY: 204,
            surfaceProbeY: 192,
            cameraY: 180,
        });
        expect(deepBelowSurface.isUnderwater).toBe(true);
        expect(deepBelowSurface.surfaceOpacity).toBe(0);

        const aboveSurface = resolveSurfaceWorldVisibilityState({
            waterSurfaceY: 204,
            surfaceProbeY: 206,
            cameraY: 205,
        });
        expect(aboveSurface.isUnderwater).toBe(false);
        expect(aboveSurface.surfaceOpacity).toBe(1);
    });

    it('keeps the chapter 3 aurora preview disabled for the Sky Drift handoff', () => {
        const previewState = resolveSurfaceWorldAuroraPreviewState(0.30);
        expect(previewState.previewVisible).toBe(false);
        expect(previewState.previewOpacity).toBe(0);
    });

    it('uses progress-based probing when updating the surface world environment', () => {
        const uniform = { value: 1, __odysseyBaseOpacity: 1 };
        const auroraUniform = { value: 1, __odysseyBaseOpacity: 1 };
        const element = { visible: false };
        const auroraPreview = { visible: false };
        const group = {
            userData: {
                uniforms: { uTime: { value: 0 } },
                waterSurfaceY: 204,
                surfaceElements: [element, auroraPreview],
                surfaceOpacityUniformTargets: [uniform],
                auroraPreviewOpacityUniformTargets: [auroraUniform],
                auroraPreview,
                snowBlendUniformTargets: [],
                skyElement: { visible: false },
                foothillBridge: null,
                butterflies: null,
                snowTransition: null,
            },
        };
        const camera = {
            position: {
                y: 190,
            },
        };

        // Probe PAST the chapter-entry ramp (the creative plan fades all surface
        // elements in across the first ~7% of Chapter 3 so the landscape slab cannot
        // pop at the breach) — this test verifies the progress-based probing itself.
        updateSurfaceWorldEnvironment(group, 0, 1, camera, 0.24);

        expect(element.visible).toBe(true);
        expect(uniform.value).toBeGreaterThan(0.9);
        expect(auroraPreview.visible).toBe(false);
        expect(auroraUniform.value).toBe(0);
        expect(group.userData.skyElement.visible).toBe(true);
    });
});
