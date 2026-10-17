import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { HighScoreManager } from '../../src/ui/high-scores.js';

/** A manager whose score index walks `higher` (the saved scores above the one ranked). */
function managerWithHigherScores(higher) {
    const manager = new HighScoreManager();
    const request = {};
    manager.db = {
        transaction: vi.fn(() => ({
            objectStore: () => ({ index: () => ({ openCursor: vi.fn(() => request) }) }),
        })),
    };
    const walk = () => {
        let at = 0;
        const step = () => {
            const value = higher[at];
            at += 1;
            request.onsuccess({ target: { result: value ? { value, continue: () => queueMicrotask(step) } : null } });
        };
        queueMicrotask(step);
    };
    return { manager, walk };
}

describe('the rank of a score', () => {
    beforeEach(() => {
        vi.stubGlobal('IDBKeyRange', { lowerBound: (value, open) => ({ value, open }) });
    });
    afterEach(() => vi.unstubAllGlobals());

    const higher = [
        { score: 987654, mode: 'infinity' },
        { score: 9000, mode: 'single' },
        // Saved before scores carried their mode: counted as Single Player.
        { score: 7000 },
        { score: 6000, mode: 'infinity' },
    ];

    it('counts every saved score by default, as Records lists them', async () => {
        const { manager, walk } = managerWithHigherScores(higher);
        const rank = manager.getRank(5000);
        walk();
        expect(await rank).toBe(5);
    });

    it('counts only its own mode, so an Infinity run never outranks a Single Player game', async () => {
        const single = managerWithHigherScores(higher);
        const singleRank = single.manager.getRank(5000, { mode: 'single' });
        single.walk();
        expect(await singleRank).toBe(3);

        const infinity = managerWithHigherScores(higher);
        const infinityRank = infinity.manager.getRank(5000, { mode: 'infinity' });
        infinity.walk();
        expect(await infinityRank).toBe(3);

        const best = managerWithHigherScores([{ score: 987654, mode: 'infinity' }]);
        const bestRank = best.manager.getRank(5000, { mode: 'single' });
        best.walk();
        expect(await bestRank).toBe(1);
    });
});
