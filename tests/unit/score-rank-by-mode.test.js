import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { HighScoreManager, keepTopScoresPerMode } from '../../src/ui/high-scores.js';

/** A manager whose indexes answer count() with `above` (the saved scores above the one ranked). */
function managerCounting(above) {
    const manager = new HighScoreManager();
    const index = vi.fn((name) => ({
        count: vi.fn((range) => {
            const request = {};
            queueMicrotask(() => {
                request.result = above(name, range);
                request.onsuccess();
            });
            return request;
        }),
    }));
    manager.db = { transaction: vi.fn(() => ({ objectStore: () => ({ index }) })) };
    return { manager, index };
}

describe('the rank of a score', () => {
    beforeEach(() => {
        vi.stubGlobal('IDBKeyRange', {
            lowerBound: (value, open) => ({ lower: value, open }),
            bound: (lower, upper, lowerOpen) => ({ lower, upper, lowerOpen }),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('counts every saved score by default, as Records once listed them', async () => {
        const { manager, index } = managerCounting(() => 4);
        expect(await manager.getRank(5000)).toBe(5);
        expect(index).toHaveBeenCalledWith('score');
    });

    it('counts only its own mode through the (mode, score) index', async () => {
        const { manager, index } = managerCounting((name, range) => (range.lower[0] === 'single' ? 2 : 0));
        expect(await manager.getRank(5000, { mode: 'single' })).toBe(3);
        expect(index).toHaveBeenCalledWith('mode_score');
        // Above 5,000 in that mode only, and not 5,000 itself.
        expect(index.mock.results[0].value.count).toHaveBeenCalledWith({
            lower: ['single', 5000], upper: ['single', Infinity], lowerOpen: true,
        });
        expect(await manager.getRank(5000, { mode: 'infinity' })).toBe(1);
    });
});

describe('scores kept per mode', () => {
    it("keeps each mode's best, so Infinity runs never push Single Player scores out", () => {
        const infinityRuns = Array.from({ length: 5 }, (_, i) => ({ score: 900000 + i, mode: 'infinity' }));
        const single = [{ score: 3000, mode: 'single' }, { score: 2000 }, { score: 1000, mode: 'single' }];
        const kept = keepTopScoresPerMode([...single, ...infinityRuns], 3);
        expect(kept.filter((entry) => entry.mode === 'infinity').map((entry) => entry.score))
            .toEqual([900004, 900003, 900002]);
        // A score without a mode is Single Player's.
        expect(kept.filter((entry) => (entry.mode || 'single') === 'single').map((entry) => entry.score))
            .toEqual([3000, 2000, 1000]);
    });

    it('ranks ties newest first', () => {
        const kept = keepTopScoresPerMode([
            { score: 500, timestamp: 1, mode: 'single' },
            { score: 500, timestamp: 2, mode: 'single' },
        ], 1);
        expect(kept).toEqual([{ score: 500, timestamp: 2, mode: 'single' }]);
    });
});
