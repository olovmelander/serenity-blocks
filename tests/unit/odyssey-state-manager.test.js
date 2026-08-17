import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';

describe('OdysseyStateManager progression', () => {
    let registry = null;

    beforeEach(() => {
        registry = new LevelRegistry();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses registry-backed chapter progression instead of fixed 8-level math', () => {
        const state = new OdysseyStateManager({ levelRegistry: registry });
        state.currentLevel = 5;
        state.currentChapter = 1;

        state.completeLevel(5, {
            stars: 2,
            score: 1200,
            time: 90,
            bonuses: [],
        });

        expect(state.isLevelUnlocked(6)).toBe(true);
        expect(state.currentLevel).toBe(6);
        expect(state.currentChapter).toBe(2);
        expect(state.getChapterProgress(1)).toMatchObject({
            totalLevels: 5,
            maxStars: 15,
        });
    });

    it('does not unlock a non-existent level after the campaign finale', () => {
        const state = new OdysseyStateManager({ levelRegistry: registry });
        state.currentLevel = 59;
        state.currentChapter = 8;

        state.completeLevel(59, {
            stars: 3,
            score: 9000,
            time: 180,
            bonuses: [],
        });

        expect(state.isLevelUnlocked(60)).toBe(false);
        expect(state.currentLevel).toBe(59);
        expect(state.currentChapter).toBe(8);
    });

    it('reports total levels and chapters from the registry', () => {
        const state = new OdysseyStateManager({ levelRegistry: registry });

        expect(state.getProgressSummary()).toMatchObject({
            totalLevels: 59,
            maxStars: 177,
            totalChapters: 8,
        });
        expect(state.getChapterProgress(8)).toMatchObject({
            totalLevels: 4,
            maxStars: 12,
        });
    });
});
