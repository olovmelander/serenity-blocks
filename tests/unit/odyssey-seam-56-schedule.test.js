import { describe, expect, it } from 'vitest';
import { deriveOdysseyChapterPositions } from '../../src/core/odyssey/data/odyssey-layout.js';
import {
    SUMMIT_EARTH_REVEAL,
    resolveSummitEarthStaging,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import {
    ONE_WORLD_ACT_MARGIN,
    isWorldVisibleAtProgress,
} from '../../src/rendering/odyssey/world/odyssey-world-act-gate.js';

/**
 * THE 5->6 SCHEDULE GUARD (Act II -> Space transition plan, Wave 0).
 *
 * Four independent mechanisms stage the Act II -> deep space handoff and they finish at four
 * different places. That desynchronisation IS the defect the overhaul exists to fix, so this
 * file's job is to make the four endpoints VISIBLE and to fail loudly the moment a layout
 * change moves one of them without the others.
 *
 * Everything here is DERIVED from `deriveOdysseyChapterPositions()`. Nothing is a magic
 * literal, because Wave 1A deliberately re-maps every chapter's p->world and these
 * assertions must survive that by re-deriving rather than by being edited.
 *
 * ⚠️ Derive facts about level data by IMPORTING the modules. A regex over levels.js pairs
 * one object's `id` with a later object's `chapter` and yields a plausible, entirely false
 * table — that mistake produced a fictional "chapter position drift" during this audit.
 */
describe('Act II -> Space (5->6) seam schedule', () => {
    const positions = deriveOdysseyChapterPositions();
    const ch5 = positions[4];
    const ch6 = positions[5];
    const ch7 = positions[6];

    it('reads the chapter boundaries the seam actually runs on', () => {
        // Pinned so a layout edit that moves the seam is a deliberate, visible act.
        expect(ch5).toBeCloseTo(0.5, 6);
        expect(ch6).toBeCloseTo(0.648, 6);
        expect(ch7).toBeCloseTo(0.815, 6);
        // 0.556 is LEVEL 31, not chapter 5's start. The seam's code comments said otherwise
        // for a long time; this assertion is here so that story cannot come back.
        expect(ch5).not.toBeCloseTo(0.556, 3);
    });

    it('places the earth ignite where the comments now claim (0.5873 -> 0.6258)', () => {
        const skySpan = ch6 - ch5;
        const summitStart = ch6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const summitEnd = ch6 - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        expect(summitStart).toBeCloseTo(0.5873, 4);
        expect(summitEnd).toBeCloseTo(0.6258, 4);

        // ...and the staging function must agree with that arithmetic, not drift from it.
        const staging = resolveSummitEarthStaging(summitStart, ch5, ch6, ch7);
        expect(staging.summitStart).toBeCloseTo(summitStart, 6);
        expect(resolveSummitEarthStaging(summitStart - 0.001, ch5, ch6, ch7).earthReveal).toBe(0);
        expect(resolveSummitEarthStaging(summitEnd, ch5, ch6, ch7).earthReveal).toBeCloseTo(1, 6);
    });

    it('opens the space gate over a window far narrower than the crossfade it sits in', () => {
        const gateEnd = ch6 + (ch7 - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;
        expect(gateEnd).toBeCloseTo(0.658, 4);
        // F5 in the plan: space arrives over 0.010 of progress. Recorded, not endorsed —
        // Wave 2 is expected to widen it, and when it does this number must be updated
        // deliberately rather than discovered later.
        expect(gateEnd - ch6).toBeCloseTo(0.010, 3);
    });

    it('KEEPS THE WORLD DRAWING AFTER THE CROSSFADE ENDS — the cliff, pinned', () => {
        // This is the defect, asserted as current behaviour so Wave 1B has a target that
        // fails when it is fixed. The One World is fully visible right up to
        // actEnd + margin and then flips off in a single frame.
        const worldOff = ch6 + ONE_WORLD_ACT_MARGIN;
        expect(worldOff).toBeCloseTo(0.678, 6);

        const actStart = positions[1];
        expect(isWorldVisibleAtProgress(worldOff - 1e-4, actStart, ch6)).toBe(true);
        expect(isWorldVisibleAtProgress(worldOff + 1e-4, actStart, ch6)).toBe(false);

        // The gate outlives the space-content gate, which is the desync in one line.
        const gateEnd = ch6 + (ch7 - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;
        expect(worldOff).toBeGreaterThan(gateEnd);
    });

    it('orders the four schedule endpoints, so a re-layout cannot silently reshuffle them', () => {
        const skySpan = ch6 - ch5;
        const summitStart = ch6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const summitEnd = ch6 - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        const gateEnd = ch6 + (ch7 - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;
        const worldOff = ch6 + ONE_WORLD_ACT_MARGIN;

        // The hero must finish igniting before the boundary; space must arrive after it;
        // and the world must stop drawing last. Wave 1A re-maps p for the whole journey —
        // this ordering is what has to survive it.
        expect(summitStart).toBeLessThan(summitEnd);
        expect(summitEnd).toBeLessThan(ch6);
        expect(ch6).toBeLessThan(gateEnd);
        expect(gateEnd).toBeLessThan(worldOff);
    });
});
