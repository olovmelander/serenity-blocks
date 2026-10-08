import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CH7_FALL,
    CH7_FALL_LOCK,
    resolveBlackHoleFall,
    resolveBlackHoleFallCamera,
    resolveBlackHoleFallDepth,
    resolveBlackHoleFallExit,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import {
    resolveChapterFramingForProgress,
    resolveJourneyFraming,
    setOdysseyCameraReducedMotion,
    OdysseyCameraController,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getActiveOdysseyChapterPositions, getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import { seamHalfWidth } from '../../src/rendering/odyssey/transitions/odyssey-seam-schedule.js';

// THE FALL (chapter 7): the black hole grows until the traveller is inside it. These pin the
// guarantees the visuals rely on — read alongside transitions/odyssey-black-hole-fall.js.
const positions = getActiveOdysseyChapterPositions();
const ch7 = positions[6];
const ch8 = positions[7];
const at = (local) => ch7 + (ch8 - ch7) * local;

describe('the ch7 fall schedule', () => {
    afterEach(() => setOdysseyCameraReducedMotion(null));

    it('is the plain camera lock before chapter 7 (the omen handoff lands on it unchanged)', () => {
        const before = resolveBlackHoleFall(ch7 - 0.01, positions);
        expect(before.active).toBe(false);
        expect(before.alpha).toBeCloseTo(Math.asin(CH7_FALL_LOCK.shadowRadius / CH7_FALL_LOCK.distance), 9);
        expect(before.portal).toBe(0);
        expect(before.rollDeg).toBe(0);
        expect(resolveBlackHoleFallDepth(before.alpha)).toBe(CH7_FALL_LOCK.depth);
    });

    it('grows monotonically and swallows the frame just past level 52', () => {
        let last = -Infinity;
        for (let i = 0; i <= 100; i += 1) {
            const { alpha } = resolveBlackHoleFall(at(i / 100), positions);
            expect(alpha).toBeGreaterThanOrEqual(last - 1e-12);
            last = alpha;
        }
        const horizon = resolveBlackHoleFall(at(CH7_FALL.horizon), positions);
        // Wider than the corners of a 70 deg-FOV 16:9 frame (~55 deg half-diagonal).
        expect(horizon.alpha * (180 / Math.PI)).toBeGreaterThan(60);
        expect(horizon.portal).toBe(1);
        expect(horizon.inside).toBeGreaterThan(0.5);
        // Level 52 sits at local 0.4286: still outside the window just before it.
        expect(resolveBlackHoleFall(at(0.2), positions).portal).toBe(0);
    });

    it('never brings the shadow near surface closer than the rail and nodes', () => {
        for (let i = 0; i <= 100; i += 1) {
            const { alpha } = resolveBlackHoleFall(at(i / 100), positions);
            const depth = resolveBlackHoleFallDepth(alpha);
            const radius = depth * Math.sin(alpha); // centred: the radius the hero is scaled to
            expect(depth - radius).toBeGreaterThanOrEqual(CH7_FALL.nearSurface - 1e-6);
        }
    });

    it('crosses the disk plane: the band tilt passes through edge-on, then the band fades', () => {
        expect(resolveBlackHoleFall(at(0.05), positions).diskTilt).toBeGreaterThan(0);
        expect(resolveBlackHoleFall(at(0.4), positions).diskTilt).toBeLessThan(0);
        expect(resolveBlackHoleFall(at(0.2), positions).band).toBe(1);
        expect(resolveBlackHoleFall(at(0.5), positions).band).toBe(0);
    });

    it('compresses during attraction, then pulls forward and holds a wider view inside the warp', () => {
        const exit = resolveBlackHoleFallExit(positions);
        const attraction = resolveBlackHoleFallCamera(exit * 0.18, exit);
        expect(attraction.fovOffset).toBeLessThan(-1.5);
        expect(attraction.camForward).toBeGreaterThan(0);

        const plunge = resolveBlackHoleFallCamera(CH7_FALL.horizon, exit);
        expect(plunge.fovOffset).toBeGreaterThan(8);
        expect(plunge.camForward).toBeGreaterThan(5);
        expect(plunge.rollDeg).toBeGreaterThan(12);

        const inside = resolveBlackHoleFallCamera(exit * 0.62, exit);
        expect(inside.rollDeg).toBe(CH7_FALL.rollPeakDeg);
        expect(inside.fovOffset).toBe(CH7_FALL.fovPeakDeg);
        expect(inside.camForward).toBe(CH7_FALL.camForwardPeak);
        const state = resolveBlackHoleFall(at(exit * 0.62), positions);
        expect(state.camForward).toBeCloseTo(inside.camForward, 9);
    });

    it('settles every camera effect with zero slope before the 7->8 window opens', () => {
        const exit = resolveBlackHoleFallExit(positions);
        expect(exit).toBeGreaterThan(0.7);
        expect(exit).toBeLessThan(0.9);
        const rest = { rollDeg: 0, fovOffset: 0, camForward: 0 };
        expect(resolveBlackHoleFallCamera(0, exit)).toEqual(rest);
        expect(resolveBlackHoleFallCamera(exit, exit)).toEqual(rest);
        let prev = resolveBlackHoleFallCamera(0, exit);
        for (let i = 1; i <= 400; i += 1) {
            const next = resolveBlackHoleFallCamera((i / 400) * exit, exit);
            // Bounded changes under continuous travel, including the held warp's release.
            expect(Math.abs(next.rollDeg - prev.rollDeg)).toBeLessThan(0.20);
            expect(Math.abs(next.fovOffset - prev.fovOffset)).toBeLessThan(0.19);
            expect(Math.abs(next.camForward - prev.camForward)).toBeLessThan(0.13);
            prev = next;
        }
        // A numerical one-sided derivative catches a hard release even when the endpoint is 0.
        const epsilon = 1e-5;
        [resolveBlackHoleFallCamera(epsilon, exit), resolveBlackHoleFallCamera(exit - epsilon, exit)]
            .forEach((nearSeam) => {
                Object.values(nearSeam).forEach((value) => expect(Math.abs(value / epsilon)).toBeLessThan(0.001));
            });
    });

    it('uses live chapter boundaries so an edited layout still restores framing before the city reveal', () => {
        setOdysseyCameraReducedMotion(false);
        const shorter = [...positions];
        shorter[6] = positions[7] - 0.05;
        const exit = resolveBlackHoleFallExit(shorter);
        const windowStart = shorter[7] - seamHalfWidth(7);
        // This short chapter exposes the old default-layout exit leak at the real seam start.
        expect(resolveBlackHoleFallCamera(exit, resolveBlackHoleFallExit(positions)).fovOffset).toBeGreaterThan(1);
        const framing = resolveJourneyFraming(windowStart + 1e-12, shorter);
        expect(framing.rollDeg).toBeCloseTo(0, 9);
        expect(framing.fovOffset).toBeCloseTo(0, 9);
        expect(framing.camForward).toBeCloseTo(0, 9);
        const direct = resolveChapterFramingForProgress(7, exit, shorter);
        expect(direct.rollDeg).toBe(0);
        expect(direct.fovOffset).toBe(0);
        expect(direct.camForward).toBe(0);
    });

    it('feeds the chapter-7 framing and removes fall motion under reduced motion', () => {
        setOdysseyCameraReducedMotion(false);
        const framing = resolveChapterFramingForProgress(7, 0.41);
        expect(framing.rollDeg).toBeGreaterThan(10);
        expect(framing.fovOffset).toBeGreaterThan(4);
        expect(framing.camForward).toBeGreaterThan(5);
        setOdysseyCameraReducedMotion(true);
        const calm = resolveChapterFramingForProgress(7, 0.41);
        expect(calm.rollDeg).toBe(0);
        expect(calm.camForward).toBe(0);
        expect(calm.fovOffset).toBe(0);
        // No other chapter rolls.
        [1, 2, 3, 4, 5, 6, 8].forEach((chapter) => {
            expect(resolveChapterFramingForProgress(chapter, 0.41).rollDeg ?? 0).toBe(0);
        });
    });

    it('returns a neutral camera response for invalid or reversed fall windows', () => {
        [null, NaN, Infinity, -0.1, 0].forEach((exit) => {
            expect(resolveBlackHoleFallCamera(0.3, exit)).toEqual({ rollDeg: 0, fovOffset: 0, camForward: 0 });
        });
    });

    it('removes actual fall framing, eye and FOV offsets at the city window during fast and reverse travel', () => {
        setOdysseyCameraReducedMotion(false);
        const exit = resolveBlackHoleFallExit(positions);
        const seamStart = at(exit);
        const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 20000);
        const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
            chapterPositions: positions,
            startPosition: at(0.55),
            idleAutoDrift: false,
        });
        controller.directorCamera.fovBase = 64;
        const dt = 1 / 60;
        const step = 0.05 * dt; // A quick continuous swipe; no teleport snap hides the leak.
        const draw = (progress) => {
            controller.currentPosition = progress;
            controller.updateChapterFraming(dt);
            controller.updateFollowPosition({ position: progress, positionBlend: 0.12, lookBlend: 0.12 });
            controller.applyBaseFov(dt);
        };
        draw(at(0.55));
        expect(controller._activeFraming.rollDeg).toBeGreaterThan(10);
        expect(camera.fov).toBeGreaterThan(70);
        for (let p = at(0.55); p < seamStart; p += step) draw(Math.min(p + step, seamStart));
        draw(seamStart);
        expect(controller._activeFraming.rollDeg).toBeCloseTo(0, 9);
        expect(controller._activeFraming.fovOffset).toBeCloseTo(0, 9);
        expect(controller._activeFraming.camForward).toBeCloseTo(0, 9);
        expect(controller._appliedFallEyeOffset.length()).toBeCloseTo(0, 9);
        expect(camera.fov).toBeCloseTo(64, 9);

        // The city's existing −3u dolly remains under generic smoothing; it is not reset
        // when the fall's independent contribution is removed.
        for (let i = 0; i < 120; i += 1) draw(ch8 + seamHalfWidth(7));
        expect(controller._activeFraming.camForward).toBeLessThan(-2.9);
        for (let p = ch8 + seamHalfWidth(7); p > seamStart; p -= step) draw(Math.max(p - step, seamStart));
        draw(seamStart);
        expect(controller._activeFraming.rollDeg).toBeCloseTo(0, 9);
        expect(controller._fallCameraFraming.fovOffset).toBeCloseTo(0, 9);
        expect(controller._appliedFallEyeOffset.length()).toBeCloseTo(0, 9);
        expect(controller._activeFraming.camForward).toBeLessThan(0); // Existing city base still eases out.
        draw(seamStart - step);
        const local = (controller.currentPosition - ch7) / (ch8 - ch7);
        expect(controller._activeFraming.rollDeg).toBeCloseTo(resolveBlackHoleFallCamera(local, exit).rollDeg, 9);
    });

    it('keeps the fall FOV separate when a pulse or focus animation owns the lens', () => {
        setOdysseyCameraReducedMotion(false);
        const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 20000);
        const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
            chapterPositions: positions, startPosition: at(0.55), idleAutoDrift: false,
        });
        controller.directorCamera.fovBase = 64;
        controller.updateChapterFraming(1 / 60);
        controller.applyBaseFov(1 / 60, true);
        const warpFov = camera.fov;
        controller.triggerFovPulse('expand', { duration: 0.001 });
        controller.fovPulseStartTime = performance.now() - 10;
        controller.applyBaseFov(1 / 60);
        controller.updateFovPulse();
        controller.applyBaseFov(1 / 60);
        expect(camera.fov).toBeCloseTo(warpFov, 9); // No duplicated fall widening after the pulse.

        controller.mode = 'focus';
        camera.fov = 50;
        controller.applyBaseFov(1 / 60);
        expect(controller._appliedFallFovOffset).toBe(0);
        controller.mode = 'follow';
        controller.currentPosition = at(resolveBlackHoleFallExit(positions));
        controller.updateChapterFraming(1 / 60);
        controller.applyBaseFov(1 / 60, true);
        expect(camera.fov).toBeCloseTo(64, 9);
    });
});
