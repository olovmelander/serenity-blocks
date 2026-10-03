import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { HighScoreManager } from '../../src/ui/high-scores.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

function harness({ stats, failAdd, failStats } = {}) {
    const manager = new HighScoreManager();
    const statsRequest = { result: stats };
    const scoreCursor = {};
    const historyCursor = {};
    const scores = {
        add: vi.fn(() => { if (failAdd) throw failAdd; }),
        delete: vi.fn(),
        index: vi.fn(() => ({ openKeyCursor: vi.fn(() => scoreCursor) })),
    };
    const history = {
        add: vi.fn(), delete: vi.fn(),
        index: vi.fn(() => ({ openKeyCursor: vi.fn(() => historyCursor) })),
    };
    const statistics = {
        get: vi.fn(() => statsRequest),
        put: vi.fn(() => { if (failStats) throw failStats; }),
    };
    const stores = { highScores: scores, gameHistory: history, statistics };
    const transaction = {
        objectStore: vi.fn((name) => stores[name]),
        abort: vi.fn(() => queueMicrotask(() => transaction.onabort())),
        error: null,
    };
    manager.db = { transaction: vi.fn(() => transaction) };
    const emitted = vi.spyOn(eventBus, 'emit');
    return {
        manager, scores, history, statistics, statsRequest, scoreCursor, historyCursor, transaction, emitted,
    };
}

afterEach(() => vi.restoreAllMocks());

const game = {
    score: 200, lines: 4, level: 3, speedMultiplier: 1.5,
    theme: 'calm', musicTrack: 'Moon', demoId: 7,
};

describe('atomic local score saves', () => {
    it('writes all stores once and notifies only when the complete transaction commits', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1234);
        const h = harness();
        let settled = false;
        const pending = h.manager.saveScore(game).then((record) => { settled = true; return record; });
        expect(h.manager.db.transaction).toHaveBeenCalledExactlyOnceWith(
            ['highScores', 'statistics', 'gameHistory'], 'readwrite',
        );
        const record = { ...game, timestamp: 1234 };
        expect(h.scores.add).toHaveBeenCalledExactlyOnceWith(record);
        expect(h.history.add).toHaveBeenCalledExactlyOnceWith(record);
        expect(h.statistics.get).toHaveBeenCalledExactlyOnceWith('stats');
        h.statsRequest.onsuccess();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(h.emitted).not.toHaveBeenCalled();
        h.transaction.oncomplete();
        expect(await pending).toEqual(record);
        expect(h.emitted).toHaveBeenCalledExactlyOnceWith(EVENTS.HIGH_SCORE_SAVED, {
            record, source: 'local',
        });
    });

    it('initializes statistics and updates every original aggregate field', async () => {
        const h = harness();
        const pending = h.manager.saveScore(game);
        h.statsRequest.onsuccess();
        expect(h.statistics.put).toHaveBeenCalledExactlyOnceWith({
            id: 'stats', totalGames: 1, totalScore: 200, totalLines: 4,
            highestScore: 200, highestLevel: 3, bestScorePerLevel: { 3: 200 },
        });
        h.transaction.oncomplete();
        await pending;
    });

    it('preserves higher records and other per-level statistics while incrementing totals', async () => {
        const h = harness({
            stats: {
                id: 'stats', totalGames: 5, totalScore: 5000, totalLines: 90,
                highestScore: 1000, highestLevel: 9, bestScorePerLevel: { 2: 700, 3: 600 },
            },
        });
        const pending = h.manager.saveScore(game);
        h.statsRequest.onsuccess();
        expect(h.statistics.put).toHaveBeenCalledExactlyOnceWith({
            id: 'stats', totalGames: 6, totalScore: 5200, totalLines: 94,
            highestScore: 1000, highestLevel: 9, bestScorePerLevel: { 2: 700, 3: 600 },
        });
        h.transaction.oncomplete();
        await pending;
    });

    it('skips retained index entries and deletes overflow by primary key without reading values', async () => {
        const h = harness();
        const pending = h.manager.saveScore(game);
        for (const [request, store, limit] of [
            [h.scoreCursor, h.scores, 100], [h.historyCursor, h.history, 50],
        ]) {
            const cursor = { primaryKey: 203, advance: vi.fn(), continue: vi.fn() };
            Object.defineProperty(cursor, 'value', { get: () => { throw new Error('Unexpected record read'); } });
            request.onsuccess({ target: { result: cursor } });
            expect(cursor.advance).toHaveBeenCalledExactlyOnceWith(limit);
            expect(store.delete).not.toHaveBeenCalled();
            request.onsuccess({ target: { result: cursor } });
            expect(store.delete).toHaveBeenCalledExactlyOnceWith(203);
            expect(cursor.continue).toHaveBeenCalledOnce();
            request.onsuccess({ target: { result: null } });
        }
        h.statsRequest.onsuccess();
        h.transaction.oncomplete();
        await pending;
    });

    it('aborts all changes and suppresses notification after a synchronous add failure', async () => {
        const h = harness({ failAdd: new DOMException('Uncloneable', 'DataCloneError') });
        await expect(h.manager.saveScore(game)).rejects.toMatchObject({ name: 'DataCloneError' });
        expect(h.transaction.abort).toHaveBeenCalledOnce();
        expect(h.history.add).not.toHaveBeenCalled();
        expect(h.emitted).not.toHaveBeenCalled();
    });

    it('aborts a statistics write failure and retains its original error', async () => {
        const h = harness({ failStats: new DOMException('Full disk', 'QuotaExceededError') });
        const pending = h.manager.saveScore(game);
        h.statsRequest.onsuccess();
        h.transaction.onerror({ target: { error: new DOMException('Aborted', 'AbortError') } });
        await expect(pending).rejects.toMatchObject({ name: 'QuotaExceededError' });
        expect(h.transaction.abort).toHaveBeenCalledOnce();
        expect(h.emitted).not.toHaveBeenCalled();
    });

    it('rejects asynchronous transaction errors without notifying a local save', async () => {
        const h = harness();
        const pending = h.manager.saveScore(game);
        h.transaction.error = new DOMException('Read failed', 'UnknownError');
        h.transaction.onerror({ target: { error: h.transaction.error } });
        h.transaction.onabort();
        await expect(pending).rejects.toMatchObject({ name: 'UnknownError' });
        expect(h.emitted).not.toHaveBeenCalled();
    });
});
