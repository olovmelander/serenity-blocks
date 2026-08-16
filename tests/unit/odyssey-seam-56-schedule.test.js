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
        // POST-FLYBY (Wave 1C, after Wave 1A's ascent). The climb now continues north past
        // the massif (closest approach 141.7u) and the space run is rigidly translated to
        // meet it, so the whole curve grew 2393.89 -> 2532.66 and every boundary
        // re-normalised. Chapter 5's share of the traversal is now 0.405.
        expect(ch5).toBeCloseTo(0.3489, 4);
        expect(ch6).toBeCloseTo(0.7543, 4);
        expect(ch7).toBeCloseTo(0.8709, 4);
        // 0.556 is LEVEL 31, not chapter 5's start. The seam's code comments said otherwise
        // for a long time; this assertion is here so that story cannot come back.
        expect(ch5).not.toBeCloseTo(0.556, 3);
        expect(ch5).not.toBeCloseTo(0.5, 3); // the PRE-ascent value
    });

    it('places the earth ignite across the ascent (0.5881 -> 0.6935)', () => {
        const skySpan = ch6 - ch5;
        const summitStart = ch6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const summitEnd = ch6 - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        // The window WIDENED 0.039 -> 0.097 as a free consequence of the ascent, then
        // widened again slightly under Wave 1C's flyby re-map: SUMMIT_EARTH_REVEAL is
        // expressed as fractions of the ch5 span, and that span keeps growing with the
        // climb. The gas giant now fades up across the whole climb instead of in a blink.
        expect(summitStart).toBeCloseTo(0.5881, 3);
        expect(summitEnd).toBeCloseTo(0.6935, 3);

        // ...and the staging function must agree with that arithmetic, not drift from it.
        const staging = resolveSummitEarthStaging(summitStart, ch5, ch6, ch7);
        expect(staging.summitStart).toBeCloseTo(summitStart, 6);
        expect(resolveSummitEarthStaging(summitStart - 0.001, ch5, ch6, ch7).earthReveal).toBe(0);
        expect(resolveSummitEarthStaging(summitEnd, ch5, ch6, ch7).earthReveal).toBeCloseTo(1, 6);
    });

    it('opens the space gate as a ramp, not a flip — and stays under the worldOff ceiling', () => {
        const gateEnd = ch6 + (ch7 - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;
        // WIDENED 0.06 -> 0.16 (Act II->Space §8.3 step 3). The old 0.0074-wide gate was a
        // binary flip: the bank-off capture arm measures +96.2 luma per 0.01p at p=0.7441,
        // and that pop is invisible today only because the cloud bank is a fully opaque
        // wall in front of it. The previous version of this test predicted its own
        // replacement ("Wave 2 is expected to widen it"); this is that update.
        expect(gateEnd).toBeCloseTo(0.7730, 3);
        expect(gateEnd - ch6).toBeCloseTo(0.0187, 3);

        // THE CEILING, which nothing asserted before and which is the reason 0.16 was
        // chosen over 0.175. `gateEnd` must stay below `worldOff`; the band that puts it
        // exactly there is (worldOff - ch6) / (ch7 - ch6) = 0.19039 post-flyby (it was
        // 0.18004 pre-1C — the flyby's added arc shrank the ch6-ch7 span in p). A future
        // re-layout changes ch6/ch7 and therefore moves this ceiling, so it is DERIVED,
        // not pinned.
        const bandCeiling = ONE_WORLD_ACT_MARGIN / (ch7 - ch6);
        expect(bandCeiling).toBeCloseTo(0.19039, 4);
        expect(SUMMIT_EARTH_REVEAL.spaceGateBand).toBeLessThan(bandCeiling);
        // ...with real margin, not a hair. Post-flyby 0.16 leaves 0.0304 of ceiling.
        expect(bandCeiling - SUMMIT_EARTH_REVEAL.spaceGateBand).toBeGreaterThan(0.002);
    });

    it('completes the hand-off before the metric window closes, and not one station early', () => {
        // Act II->Space §8.3 step 2. The void dome and nebula field are driven by a
        // camera-y `approach` ramp still climbing inside the sampled window — that climb is
        // the +6.7 and +4.7 luma per 0.01p tail rises the seam metric fails on. The
        // hand-off raises them to full BEFORE the metric's window ends.
        const spaceSpan = ch7 - ch6;
        const start = ch6 - spaceSpan * SUMMIT_EARTH_REVEAL.handoverBeforeBoundary;
        const end = ch6 + spaceSpan * SUMMIT_EARTH_REVEAL.handoverAfterBoundary;
        expect(start).toBeCloseTo(0.7543, 3);
        expect(end).toBeCloseTo(0.7978, 3);

        // ⚠️ It deliberately does NOT start before the boundary any more. Every reveal it
        // raises is multiplied by `spaceReveal`, which is exactly 0 below ch6Start, so a
        // pre-boundary hand-off is arithmetically inert — measured: the bank-off arm read
        // luma 1.78 at p=0.7221 both with and without it. Filling the pre-boundary trough
        // is the cloud LIMB's job, not this one's.
        expect(start).toBeCloseTo(ch6, 6);
        expect(end).toBeGreaterThan(ch6);
        // And it must be complete before the seam metric's window closes at
        // boundary + 0.06 = 0.8143, otherwise the tail rises it exists to remove are
        // still inside the measurement.
        expect(end).toBeLessThan(ch6 + 0.06);
    });

    it('KEEPS THE WORLD DRAWING AFTER THE CROSSFADE ENDS — the cliff, pinned', () => {
        // This is the defect, asserted as current behaviour so Wave 1B has a target that
        // fails when it is fixed. The One World is fully visible right up to
        // actEnd + margin and then flips off in a single frame.
        const worldOff = ch6 + ONE_WORLD_ACT_MARGIN;
        expect(worldOff).toBeCloseTo(0.7765, 4);

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
