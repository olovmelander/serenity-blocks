import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { ODYSSEY_SAVE_VERSION } from '../../src/core/odyssey/odyssey-progress-schema.js';

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: {} }));

const STORAGE_KEY = 'serenityBlocks_odysseyProgress';
const document = (overrides = {}) => ({
    version: ODYSSEY_SAVE_VERSION,
    unlockedLevels: [1],
    completedLevels: {},
    statistics: {},
    ...overrides,
});

beforeEach(() => {
    const saved = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, String(value)),
        removeItem: (key) => saved.delete(key),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Odyssey auxiliary completion data', () => {
    it('recovers earned stars and themes without letting corrupt fields poison the next completion', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(document({
            completedLevels: {
                1: {
                    stars: 3, bestScore: 'broken', bestTime: -50, attempts: 'broken',
                    completedBonuses: [true, 'false', 1], themeId: 'forest',
                },
            },
        })));
        const state = new OdysseyStateManager();
        state.completeLevel(1, {
            stars: 1, score: 500, time: 60, bonuses: [false, false, false],
        });

        expect(state.getLevelCompletion(1)).toMatchObject({
            stars: 3, bestScore: 500, bestTime: 60, attempts: 1,
            completedBonuses: [true, false, false],
        });
        expect(state.getLevelCompletion(1).themeIds).toContain('forest');
        expect(new OdysseyStateManager().getLevelCompletion(1)).toEqual(state.getLevelCompletion(1));
    });

    it('preserves valid legacy optional fields, fractional times and unknown metadata', () => {
        const completions = {
            1: { stars: 1 },
            2: {
                stars: 2, bestScore: 0, bestTime: 0, attempts: 0, completedBonuses: [], futureMetadata: 'keep',
            },
            3: { stars: 3, bestScore: 1200, bestTime: 12.5, attempts: 4, completedBonuses: [false, true] },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(document({ completedLevels: completions })));
        const state = new OdysseyStateManager();
        expect(Object.fromEntries(state.completedLevels)).toEqual(completions);
    });

    it.each(['false', { 0: true, length: 2 }, null, 3])('ignores a non-array bonus container: %j', (bonuses) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(document({
            completedLevels: { 1: { stars: 1, completedBonuses: bonuses } },
        })));
        const state = new OdysseyStateManager();
        state.completeLevel(1, { stars: 1, bonuses: [false, true] });
        expect(state.getLevelCompletion(1).completedBonuses).toEqual([false, true]);
    });

    it.each([
        ['bestScore', -1], ['bestScore', '900'], ['bestScore', true],
        ['bestTime', '12'], ['bestTime', false], ['bestTime', -1],
        ['attempts', 1.5], ['attempts', -2], ['attempts', '4'],
    ])('removes an invalid %s value while retaining the completion: %j', (field, value) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(document({
            completedLevels: { 1: { stars: 2, [field]: value } },
        })));
        expect(new OdysseyStateManager().getLevelCompletion(1)).toEqual({ stars: 2 });
    });
});

describe('Odyssey cloud completion validation', () => {
    it('tolerates dates outside the JavaScript date range while retaining earned progress', () => {
        const sync = new SteamCloudSyncManager();
        const merged = sync._mergeOdyssey(
            document({ completedLevels: { 1: { stars: 2, completionDate: 9e15 } } }),
            document({ completedLevels: { 1: { stars: 3, completionDate: 9.1e15 } } }),
        );
        expect(merged.completedLevels[1].stars).toBe(3);
        expect(merged.completedLevels[1].completionDate).toBeUndefined();
    });

    it.each([9e15, 'broken', true, [], [1], ' ', {}].map((value) => [value]))('keeps the valid first completion date beside damaged metadata: %j', (completionDate) => {
        const sync = new SteamCloudSyncManager();
        const valid = document({
            completedLevels: { 1: { stars: 2, completionDate: '2026-10-01T12:00:00.000Z' } },
        });
        const damaged = document({ completedLevels: { 1: { stars: 3, completionDate } } });
        for (const sides of [[valid, damaged], [damaged, valid]]) {
            expect(sync._mergeOdyssey(...sides).completedLevels[1].completionDate).toBe('2026-10-01T12:00:00.000Z');
        }
    });

    it('preserves supported numeric legacy dates and selects the earliest valid completion', () => {
        const sync = new SteamCloudSyncManager();
        const first = Date.parse('2026-10-01T12:00:00.000Z');
        const later = Date.parse('2026-11-01T12:00:00.000Z');
        expect(sync._mergeOdyssey(
            document({ completedLevels: { 1: { stars: 2, completionDate: first } } }),
            document({ completedLevels: { 1: { stars: 3, completionDate: later } } }),
        ).completedLevels[1].completionDate).toBe('2026-10-01T12:00:00.000Z');
    });

    it.each([false, true])('does not let malformed auxiliary fields erase a valid record (reverse=%s)', (reverse) => {
        const sync = new SteamCloudSyncManager();
        const valid = document({
            completedLevels: { 1: { stars: 2, bestScore: 500, bestTime: 60, attempts: 4, completedBonuses: [true, false] } },
            statistics: { totalScore: 500, totalPlayTime: 12.5 },
        });
        const damaged = document({
            completedLevels: { 1: { stars: 3, bestScore: 'broken', bestTime: -1, attempts: 'broken', completedBonuses: 'false' } },
            statistics: { totalScore: 'broken', totalPlayTime: -1 },
        });
        const sides = reverse ? [damaged, valid] : [valid, damaged];
        const merged = sync._mergeOdyssey(...sides);
        expect(merged.completedLevels[1]).toMatchObject({
            stars: 3, bestScore: 500, bestTime: 60, attempts: 4, completedBonuses: [true, false],
        });
        expect(merged.statistics).toMatchObject({ totalScore: 500, totalPlayTime: 12.5 });
    });

    it.each([null, [], 'broken', false])('ignores a malformed completion map without losing good local progress: %j', (completedLevels) => {
        const state = new OdysseyStateManager();
        state.completeLevel(1, { stars: 2, score: 500 });
        const sync = new SteamCloudSyncManager({ getOdysseyState: () => state });
        expect(sync._applyOdyssey(document({ completedLevels, retiredCompletions: null }))).toBe(true);
        expect(state.getLevelCompletion(1)).toMatchObject({ stars: 2, bestScore: 500 });
    });

    it('does not treat array offsets as earned cloud completions', () => {
        const state = new OdysseyStateManager();
        const sync = new SteamCloudSyncManager({ getOdysseyState: () => state });
        expect(sync._applyOdyssey(document({
            completedLevels: [null, { stars: 3, themeId: 'forest' }],
        }))).toBe(true);
        expect(state.isLevelCompleted(1)).toBe(false);
        expect(state.getTotalStars()).toBe(0);
    });

    it.each([1, 2, 3, 4, 5])('rejects array completions before migrating save version %s', (version) => {
        const malformed = document({ version, completedLevels: [null, { stars: 3 }] });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));
        const state = new OdysseyStateManager();
        expect(state.getTotalStars()).toBe(0);
        const sync = new SteamCloudSyncManager({ getOdysseyState: () => state });
        expect(sync._applyOdyssey(malformed)).toBe(true);
        expect(state.getTotalStars()).toBe(0);
    });

    it.each([{ 1: true }, 3, false])('recovers valid cloud clears beside a malformed unlocked container: %j', (unlockedLevels) => {
        const state = new OdysseyStateManager();
        const sync = new SteamCloudSyncManager({ getOdysseyState: () => state });
        expect(sync._applyOdyssey(document({
            unlockedLevels, completedLevels: { 1: { stars: 2, bestScore: 500 } },
        }))).toBe(true);
        expect(state.getLevelCompletion(1)).toMatchObject({ stars: 2, bestScore: 500 });
        expect(state.isLevelUnlocked(2)).toBe(true);
    });

    it('sanitizes the newer journey without bringing progress back from the erased journey', () => {
        const sync = new SteamCloudSyncManager();
        const previous = document({ completedLevels: { 1: { stars: 3, bestScore: 900 } } });
        const current = document({
            journeyStartedAt: '2026-11-05T23:00:00.000Z',
            completedLevels: { 2: { stars: 1, bestScore: 'broken', attempts: 'broken' } },
            retiredCompletions: null,
            unlockedLevels: { 2: true },
            statistics: { totalScore: 'broken', totalPlayTime: 12.5 },
        });
        for (const sides of [[previous, current], [current, previous]]) {
            const merged = sync._mergeOdyssey(...sides);
            expect(merged.completedLevels).toEqual({ 2: { stars: 1 } });
            expect(merged.retiredCompletions).toEqual({});
            expect(merged.unlockedLevels).toEqual([]);
            expect(merged.statistics).toEqual({ totalScore: 0, totalPlayTime: 12.5 });
        }
    });
});
