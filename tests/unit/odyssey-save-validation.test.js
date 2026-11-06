import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_SAVE_VERSION } from '../../src/core/odyssey/odyssey-progress-schema.js';

const STORAGE_KEY = 'serenityBlocks_odysseyProgress';

beforeEach(() => {
    const saved = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, String(value)),
        removeItem: (key) => saved.delete(key),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Odyssey save validation', () => {
    it('preserves the canonical completion when a malformed alias names the same orb', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: {
                1: { stars: 3, bestScore: 900 },
                '01': { stars: 1, bestScore: 100 },
            },
        }));
        const state = new OdysseyStateManager();
        expect(state.getLevelCompletion(1)).toEqual({ stars: 3, bestScore: 900 });
        expect(state.getTotalStars()).toBe(3);
    });

    it('recovers valid completions without unlocking malformed or fractional orbs', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION,
            unlockedLevels: [1, 1.5, '2', 'bad', -1, 999],
            completedLevels: {
                1: { stars: 2, bestScore: 500 },
                2: null,
                3: false,
                4: { stars: '3' },
                6: { stars: 4 },
                7.5: { stars: 1 },
                '08': { stars: 1 },
            },
        }));
        const state = new OdysseyStateManager();

        expect(state.load()).toBe(true);
        expect([...state.completedLevels.keys()]).toEqual(['1', '8']);
        expect([...state.unlockedLevels].sort((left, right) => left - right)).toEqual([1, 2, 8, 9]);
        expect(state.getProgressSummary()).toMatchObject({ completedLevels: 2, totalStars: 3, currentLevel: 2 });
        expect(state.getLevelCompletion(8)).toEqual({ stars: 1 });
        expect(state.save()).toBe(true);
        expect(new OdysseyStateManager().getProgressSummary()).toEqual(state.getProgressSummary());
    });

    it('keeps a well-formed clear an older build saved without a star', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION,
            unlockedLevels: [1, 2, 3],
            completedLevels: {
                1: { stars: 1, bestScore: 100 },
                2: { stars: 0, bestScore: 450, attempts: 3 },
            },
        }));
        const state = new OdysseyStateManager();

        expect(state.load()).toBe(true);
        expect(state.isLevelCompleted(2)).toBe(true);
        expect(state.getLevelCompletion(2)).toEqual({ stars: 0, bestScore: 450, attempts: 3 });
        expect(state.getProgressSummary()).toMatchObject({ completedLevels: 2, totalStars: 1, currentLevel: 3 });
        expect(state.save()).toBe(true);
        expect(new OdysseyStateManager().isLevelCompleted(2)).toBe(true);
    });

    it('tolerates malformed containers without leaving partially loaded progress', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION,
            unlockedLevels: { 1: true },
            completedLevels: [{ stars: 3 }, { stars: 3 }],
        }));
        const state = new OdysseyStateManager();
        expect(state.load()).toBe(true);
        expect(state.getProgressSummary()).toMatchObject({ currentLevel: 1, completedLevels: 0, totalStars: 0 });
        expect([...state.unlockedLevels]).toEqual([1]);
    });

    it('keeps statistics numeric after a damaged save and subsequent play', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION,
            statistics: {
                totalAttempts: 'broken', totalScore: 'broken', totalLinesCleared: -50,
                highestCombo: null, maxCascadeDepth: false, totalPlayTime: 12.5,
            },
        }));
        const state = new OdysseyStateManager();
        state.completeLevel(1, { stars: 1, score: 500, lines: 4, combo: 2, maxCascadeDepth: 1 });
        expect(state.statistics).toMatchObject({
            totalAttempts: 1, totalScore: 500, totalLinesCleared: 4,
            highestCombo: 2, maxCascadeDepth: 1, totalPlayTime: 12.5,
        });
    });

    it.each([[], 12, true, 'not a save'].map((document) => [document]))('backs up a non-object save document: %j', (document) => {
        const raw = JSON.stringify(document);
        localStorage.setItem(STORAGE_KEY, raw);
        const state = new OdysseyStateManager();
        expect(state.unreadableSaveKey).toBeTruthy();
        expect(localStorage.getItem(state.unreadableSaveKey)).toBe(raw);
        expect(state.getProgressSummary()).toMatchObject({ currentLevel: 1, completedLevels: 0, totalStars: 0 });
    });
});
