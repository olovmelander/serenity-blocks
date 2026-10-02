import {
    afterEach, describe, expect, it,
} from 'vitest';
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
    setOdysseyCameraReducedMotion,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';

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

    it('rolls and widens the view continuously, back to exactly zero where the 7->8 window opens', () => {
        const exit = resolveBlackHoleFallExit(positions);
        expect(exit).toBeGreaterThan(0.7);
        expect(exit).toBeLessThan(0.9);
        expect(resolveBlackHoleFallCamera(0, exit)).toEqual({ rollDeg: 0, fovOffset: 0 });
        expect(resolveBlackHoleFallCamera(exit, exit)).toEqual({ rollDeg: 0, fovOffset: 0 });
        let prev = resolveBlackHoleFallCamera(0, exit);
        for (let i = 1; i <= 400; i += 1) {
            const next = resolveBlackHoleFallCamera((i / 400) * exit, exit);
            // < 0.12 deg of roll per 1/400 of the chapter's fall (~0.0002 p): no snap.
            expect(Math.abs(next.rollDeg - prev.rollDeg)).toBeLessThan(0.12);
            expect(Math.abs(next.fovOffset - prev.fovOffset)).toBeLessThan(0.06);
            prev = next;
        }
        const peak = resolveBlackHoleFallCamera(exit / 2, exit);
        expect(peak.rollDeg).toBeCloseTo(CH7_FALL.rollPeakDeg, 6);
        expect(peak.fovOffset).toBeCloseTo(CH7_FALL.fovPeakDeg, 6);
    });

    it('feeds the chapter-7 framing, and the roll is zero for players who prefer reduced motion', () => {
        setOdysseyCameraReducedMotion(false);
        const framing = resolveChapterFramingForProgress(7, 0.41);
        expect(framing.rollDeg).toBeGreaterThan(10);
        expect(framing.fovOffset).toBeGreaterThan(4);
        setOdysseyCameraReducedMotion(true);
        const calm = resolveChapterFramingForProgress(7, 0.41);
        expect(calm.rollDeg).toBe(0);
        expect(calm.fovOffset).toBeGreaterThan(4);
        // No other chapter rolls.
        [1, 2, 3, 4, 5, 6, 8].forEach((chapter) => {
            expect(resolveChapterFramingForProgress(chapter, 0.41).rollDeg ?? 0).toBe(0);
        });
    });
});
