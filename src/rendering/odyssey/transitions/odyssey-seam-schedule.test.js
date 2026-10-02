import { describe, expect, it } from 'vitest';
import {
    arcToP,
    journeyArcLength,
    pToArc,
    seamHalfWidth,
    seamWindowAt,
    staggeredIncoming,
    staggeredOutgoing,
} from './odyssey-seam-schedule.js';
import {
    getChapterBoardTransition,
    resolveChapterBlendState,
} from '../ChapterEnvironmentManager.js';
import { getActiveOdysseyChapterPositions, getOdysseyPathCurve } from '../path-utils.js';
import { CHAPTER_CONFIGS } from '../../../core/odyssey/data/chapters.js';

describe('odyssey seam schedule', () => {
    const chapterPositions = getActiveOdysseyChapterPositions();

    it('resolves exactly the seam windows the environment manager blends over', () => {
        for (let source = 1; source <= 7; source += 1) {
            expect(seamHalfWidth(source)).toBe(getChapterBoardTransition(source).seamWidth);
            const boundary = chapterPositions[source];
            const win = seamWindowAt(boundary, chapterPositions);
            const blend = resolveChapterBlendState(boundary, CHAPTER_CONFIGS, chapterPositions);
            expect(win.source).toBe(source);
            expect(win.start).toBeCloseTo(blend.seamStart, 9);
            expect(win.end).toBeCloseTo(blend.seamEnd, 9);
            expect(win.t).toBeCloseTo(0.5, 9);
        }
        // Mid-chapter: no window.
        expect(seamWindowAt((chapterPositions[4] + chapterPositions[5]) / 2, chapterPositions)).toBeNull();
    });

    it('staggers opaque fades so coverage never drops below 1', () => {
        for (let i = 0; i <= 100; i += 1) {
            const t = i / 100;
            const a = staggeredOutgoing(t);
            const b = staggeredIncoming(t);
            expect(1 - (1 - a) * (1 - b)).toBeGreaterThan(0.9999);
        }
        expect(staggeredIncoming(0)).toBe(0);
        expect(staggeredIncoming(0.5)).toBe(1);
        expect(staggeredOutgoing(0.5)).toBe(1);
        expect(staggeredOutgoing(1)).toBe(0);
    });

    it('converts world distance to progress against the live spline', () => {
        expect(journeyArcLength()).toBeCloseTo(getOdysseyPathCurve().getLength(), 6);
        expect(pToArc(arcToP(152))).toBeCloseTo(152, 9);
    });
});
