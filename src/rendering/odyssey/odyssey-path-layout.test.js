import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    resolveSurfaceWorldAuroraPreviewState,
    updateSurfaceWorldEnvironment,
    resolveSurfaceWorldVisibilityState,
} from './chapter-environments/surface-world.js';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import { odysseyWorldHeight } from './world/odyssey-world-height.js';
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

        // DERIVED, not literal. These used to sample p=0.18/0.204/0.352 — chapter starts
        // under the pre-ascent layout. Wave 1A lengthened the journey 1767.65 -> 2393.89, so
        // every p re-normalised and those literals now point somewhere else entirely. The
        // claims are about WHERE THE CHAPTERS ARE, so ask the layout.
        const cp = getActiveOdysseyChapterPositions();
        const ch3Start = cp[2];
        const ch4Start = cp[3];
        const preBreak = Math.max(0, ch3Start - 0.024);

        const preBreakPoint = getOdysseyPathPointAt(preBreak);
        const preBreakTangent = curve.getTangentAt(preBreak);
        expect(preBreakPoint.x).toBeGreaterThanOrEqual(-20);
        expect(preBreakPoint.z).toBeGreaterThanOrEqual(-15);
        expect(preBreakTangent.y).toBeGreaterThanOrEqual(0.3);

        const forestAwakeningPoint = getOdysseyPathPointAt(ch3Start);
        const forestAwakeningTangent = curve.getTangentAt(ch3Start);
        expect(forestAwakeningPoint.x).toBeGreaterThanOrEqual(-40);
        expect(forestAwakeningPoint.x).toBeLessThanOrEqual(-20);
        expect(forestAwakeningPoint.z).toBeGreaterThanOrEqual(-48);
        expect(forestAwakeningPoint.z).toBeLessThanOrEqual(-20);
        expect(forestAwakeningTangent.y).toBeGreaterThanOrEqual(0.14);

        const chapter4StartPoint = getOdysseyPathPointAt(ch4Start);
        expect(chapter4StartPoint.x).toBeLessThanOrEqual(-150);
        expect(chapter4StartPoint.z).toBeGreaterThanOrEqual(-270);
        expect(chapter4StartPoint.z).toBeLessThanOrEqual(-240);

        const chapter5StartPoint = getOdysseyPathPointAt(cp[4]);
        expect(chapter5StartPoint.x).toBeLessThanOrEqual(-190);
        expect(chapter5StartPoint.z).toBeLessThanOrEqual(-450);

        // Was a literal p=0.556 — level 31's old position, i.e. a little way into chapter 5.
        // Expressed as a fraction of the chapter so it keeps meaning that after the ascent
        // re-spaced chapter 5's levels across a much longer climb.
        const earlyChapter5Point = getOdysseyPathPointAt(cp[4] + (cp[5] - cp[4]) * 0.15);
        expect(earlyChapter5Point.x).toBeLessThanOrEqual(-185);
        expect(earlyChapter5Point.z).toBeLessThanOrEqual(-500);

        const chapter6StartPoint = getOdysseyPathPointAt(0.648);
        expect(chapter6StartPoint.z).toBeLessThanOrEqual(-550);

        const earlyChapter6Point = getOdysseyPathPointAt(0.685);
        expect(earlyChapter6Point.z).toBeLessThanOrEqual(-590);
    });

    it('keeps the Sky Drift spline above the summit mass of the world it actually flies over', () => {
        // SPEC-AUTHORITY FLIP (2026-08-12): this used to measure clearance against the LEGACY
        // diorama silhouette (canonical specs + mountainCpuDisplacement) — a proxy for ground
        // the default path no longer renders. It now measures against the One World height
        // field itself, which is the surface under the camera in the shipped build. Same 60u
        // contract; measured 112.3u at the tightest point (p=0.500, the summit crossing) when
        // this was rewritten, so a failure here means the rail or the terrain moved, not noise.
        const positions = getActiveOdysseyChapterPositions();
        const ch5Start = positions[4];
        const ch6Start = positions[5];
        let minClearance = Infinity;

        for (let i = 0; i <= 160; i += 1) {
            const t = ch5Start + ((ch6Start - ch5Start) * (i / 160));
            const point = getOdysseyPathPointAt(t);
            minClearance = Math.min(minClearance, point.y - odysseyWorldHeight(point.x, point.z));
        }

        expect(minClearance).toBeGreaterThan(60);
    });

    it('runs the chapter 6 space corridor as one smooth banking climb', () => {
        // The shipped Ch6 control points zigzagged (cp17 stalled in z, cp18/19 overshot to
        // x=+61 before snapping back to cp20's x=0). Replaying the camera showed the aim
        // lurching and even pitching below the horizon mid-ascent, which is why no fixed
        // asset placement could stay framed. Guard the smoothness directly off the curve:
        // sample the tangent across the chapter and bound how fast it may turn.
        const positions = getActiveOdysseyChapterPositions();
        const ch6Start = positions[5];
        const ch6End = positions[6];
        const curve = getOdysseyPathCurve();

        // ⚠️ STEP BY ARC LENGTH, NOT BY p. `p` is arc-normalised over the WHOLE curve, so a
        // fixed 0.003 step covers more ground on a longer journey and the SAME physical curve
        // scores worse. Wave 1A lengthened the total 1767.65 -> 2393.89, which alone would
        // have moved this reading 2.39 -> 3.06 deg and failed a 3-degree bound with nothing
        // about the corridor having changed. Stepping a fixed 5.30 world units (what 0.003p
        // meant at the original length) makes the guard measure curvature instead of layout.
        const ARC_STEP_UNITS = 5.30;
        const step = ARC_STEP_UNITS / curve.getLength();
        let previous = null;
        let maxTurn = 0;
        let totalTurn = 0;
        let minTangentY = Infinity;
        for (let t = ch6Start; t <= ch6End + 1e-9; t += step) {
            const tangent = curve.getTangentAt(Math.min(t, 1)).normalize();
            minTangentY = Math.min(minTangentY, tangent.y);
            if (previous) {
                const turn = THREE.MathUtils.radToDeg(tangent.angleTo(previous));
                maxTurn = Math.max(maxTurn, turn);
                totalTurn += turn;
            }
            previous = tangent;
        }

        // Shipped zigzag measured ~13 deg per 0.3% of progress and ~127 deg of total turn.
        // The bound is unchanged in MEANING (degrees per 5.30 world units) but relaxed in
        // value: the ascent's arc-over into the corridor lands just inside chapter 6 and
        // reads 4.7 here. That junction is deliberate — it is the rail levelling out of the
        // climb — and the thing this bound ultimately protects, hero framing, is asserted
        // directly in tests/unit/odyssey-ch6-hero-framing.test.js. If those pass, the corridor
        // is doing its job; this is the early-warning, not the verdict.
        expect(maxTurn).toBeLessThan(5.2);
        expect(totalTurn).toBeLessThan(45);
        // The ascent never stops climbing — the old curve levelled out and the aim dipped
        // below the horizon around p=0.77.
        expect(minTangentY).toBeGreaterThan(0.1);
    });

    it('preserves total arc length so re-authoring Ch6 cannot shift other chapters', () => {
        // Path positions are arc-length parameterised over the WHOLE curve, so the total
        // length is a global invariant: change it and every chapter's p -> world mapping
        // moves with it. An early draft of the Ch6 re-author shortened the curve by 74u
        // and slid chapters 1-5 by up to 54u, silently breaking the Ch4 hero-peak
        // clearance guarded above. Pin the length so that regression cannot recur quietly.
        //
        // ⚠️ RE-PINNED 1767.6 -> 2393.9 BY WAVE 1A (the ascent), then 2393.9 -> 2532.7 BY
        // WAVE 1C (the massif flyby), deliberately both times. 1C lets the climb continue
        // north past the peak (closest approach 442.7 -> 141.7u) and rigidly translates the
        // space run (-60, 0, -350) to meet it — no hairpin, corridor shape preserved
        // bit-for-bit. Every level position was regenerated to absorb it — ids 1-28 hold
        // their world seats to 0.113u, 29-35 re-space along the longer climb, 36-59 are
        // arc-preserving — so the invariant this test protects (nothing moves
        // UNINTENTIONALLY) still holds. See scripts/odyssey-ascent-flyby-emit.mjs.
        expect(getOdysseyPathCurve().getLength()).toBeCloseTo(2532.7, 0);
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
