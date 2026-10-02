import { describe, expect, it } from 'vitest';
import { resolveCh7LensDrive } from './odyssey-tsl-pipeline.js';
import { OdysseyDirector } from '../composition/OdysseyDirector.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';
import { seamHalfWidth } from '../transitions/odyssey-seam-schedule.js';

// SEAMLESS PASS (2026-10-02): the black-hole post terms follow the chapter-7 crossfade weight.
// They used to key on the active-chapter flip: lens 0 -> 0.196 and crush 1 -> 0.675 in one frame
// at the 6->7 boundary, lens 0.623 -> 0.273 at the 7->8 boundary.

const lensTarget = (drive) => 0.7 * drive.presence * (0.45 + 0.55 * drive.late);
const crushScale = (drive) => 1 + (0.35 - 1) * drive.presence;

describe('chapter-7 lens / crush drive', () => {
    const chapterPositions = getActiveOdysseyChapterPositions();

    for (const source of [6, 7]) {
        it(`is continuous across the ${source}->${source + 1} seam`, () => {
            const director = new OdysseyDirector({ chapterPositions });
            const boundary = chapterPositions[source];
            const w = seamHalfWidth(source);
            const dp = 0.0002;
            let prev = null;
            let worstLens = 0;
            let worstCrush = 0;
            for (let p = boundary - w - 0.003; p <= boundary + w + 0.003; p += dp) {
                const state = director.update(1 / 60, { ascentProgress: p, audio: null });
                const drive = resolveCh7LensDrive(state);
                if (prev) {
                    worstLens = Math.max(worstLens, Math.abs(lensTarget(drive) - lensTarget(prev)) * (0.001 / dp));
                    worstCrush = Math.max(worstCrush, Math.abs(crushScale(drive) - crushScale(prev)) * (0.001 / dp));
                }
                prev = drive;
            }
            // Smooth ramps over the half-window (~0.011-0.016 p) stay well under these; the old
            // flip stepped 0.196 / 0.35 lens and 0.325 crush between two adjacent samples.
            expect(worstLens, 'lens per 0.001 p').toBeLessThan(0.12);
            expect(worstCrush, 'crush per 0.001 p').toBeLessThan(0.12);
        });
    }

    it('is fully present at the 6->7 boundary and still present at the 7->8 boundary', () => {
        const director = new OdysseyDirector({ chapterPositions });
        const at67 = director.update(1 / 60, { ascentProgress: chapterPositions[6], audio: null });
        expect(resolveCh7LensDrive(at67).presence).toBeCloseTo(1, 5);
        const at78 = director.update(1 / 60, { ascentProgress: chapterPositions[7], audio: null });
        expect(resolveCh7LensDrive(at78).presence).toBeCloseTo(1, 5);
        const after = director.update(1 / 60, {
            ascentProgress: chapterPositions[7] + seamHalfWidth(7) + 0.001,
            audio: null,
        });
        expect(resolveCh7LensDrive(after).presence).toBe(0);
    });

    it('keeps the legacy flip only for a state without ch7Weight (falsification)', () => {
        const before = resolveCh7LensDrive({
            activeChapter: 6, sourceChapter: 6, targetChapter: 7, seamProgress: 0.49,
        });
        const after = resolveCh7LensDrive({
            activeChapter: 7, sourceChapter: 6, targetChapter: 7, seamProgress: 0.51,
        });
        expect(lensTarget(after) - lensTarget(before)).toBeGreaterThan(0.15);
    });
});
