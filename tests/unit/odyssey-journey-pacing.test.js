import { describe, expect, it } from 'vitest';
import {
    COMPLETION_HOLD_LIMITS, COMPLETION_REVEAL_MS, MS_PER_NEW_WORD, countWords, getCompletionHoldMs,
} from '../../src/ui/odyssey/journey-pacing.js';

describe('Odyssey completion pacing', () => {
    it('counts the words a reader parses, ignoring separators', () => {
        expect(countWords('New song · Cinder Drift')).toBe(4);
        expect(countWords(['2 of 61 themes collected', 'Playing now · yours to keep in Music'])).toBe(12);
        expect(countWords('You’re ready', undefined, null)).toBe(2);
        expect(countWords()).toBe(0);
    });

    it('keeps a familiar orb brief so a run of replays still flows', () => {
        const hold = getCompletionHoldMs({ hasReward: false, briefingWords: 20 });
        expect(hold).toBeGreaterThanOrEqual(COMPLETION_HOLD_LIMITS.brief.min);
        expect(hold).toBeLessThanOrEqual(COMPLETION_HOLD_LIMITS.brief.max);
        expect(getCompletionHoldMs({ hasReward: false })).toBe(COMPLETION_HOLD_LIMITS.brief.min);
        expect(getCompletionHoldMs({ hasReward: false, briefingWords: 1000 })).toBe(COMPLETION_HOLD_LIMITS.brief.max);
    });

    it('gives a first-time reward its reveal plus reading time at 200 words a minute', () => {
        const rewardWords = 19;
        const hold = getCompletionHoldMs({ hasReward: true, rewardWords, briefingWords: 0 });
        expect(hold).toBe(COMPLETION_REVEAL_MS + rewardWords * MS_PER_NEW_WORD);
        expect(MS_PER_NEW_WORD).toBe(300);
        // A typical theme + song + next goal lands between the old 2.6 s and a long wait.
        const typical = getCompletionHoldMs({ hasReward: true, rewardWords: 19, briefingWords: 20 });
        expect(typical).toBeGreaterThan(8000);
        expect(typical).toBeLessThan(COMPLETION_HOLD_LIMITS.reward.max);
    });

    it('never cuts off a short reward or waits forever on a long one', () => {
        expect(getCompletionHoldMs({ hasReward: true, rewardWords: 1 })).toBe(COMPLETION_HOLD_LIMITS.reward.min);
        expect(getCompletionHoldMs({ hasReward: true, rewardWords: 500, briefingWords: 500 }))
            .toBe(COMPLETION_HOLD_LIMITS.reward.max);
        expect(getCompletionHoldMs({ hasReward: true, rewardWords: -4, briefingWords: Number.NaN }))
            .toBe(COMPLETION_HOLD_LIMITS.reward.min);
    });
});
