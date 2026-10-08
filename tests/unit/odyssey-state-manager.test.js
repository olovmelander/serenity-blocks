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
        const saved = new Map();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => saved.get(key) ?? null),
            setItem: vi.fn((key, value) => saved.set(key, String(value))),
            removeItem: vi.fn((key) => saved.delete(key)),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
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

    it('saves the completed session theme rather than a later registry selection', () => {
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const completion = state.completeLevel(22, { stars: 1 }, { themeId: 'aurora' });
        expect(completion).toMatchObject({ themeId: 'aurora', themeIds: ['aurora'], persisted: true });
        const replay = state.completeLevel(22, { stars: 1 });
        expect(replay).toMatchObject({ themeId: 'ice-temple', themeIds: ['aurora', 'ice-temple'] });
    });

    it('does not load or overwrite a future save schema', () => {
        const future = JSON.stringify({ version: 99, completedLevels: { 22: { stars: 3 } } });
        localStorage.setItem('serenityBlocks_odysseyProgress', future);
        const state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.isLevelCompleted(22)).toBe(false);
        expect(state.completeLevel(1, { stars: 1 }).persisted).toBe(false);
        expect(localStorage.getItem('serenityBlocks_odysseyProgress')).toBe(future);
    });

    it('keeps failures locked and completion progress intact across all 59 save/reload boundaries', () => {
        let state = new OdysseyStateManager({ levelRegistry: registry });
        const chapterEnds = [5, 11, 19, 27, 35, 48, 55, 59];

        // Recorded outcomes exercise persistence; these are not gameplay solutions.
        for (let levelId = 1; levelId <= 59; levelId++) {
            expect(state.isLevelUnlocked(levelId)).toBe(true);
            expect(state.isLevelCompleted(levelId)).toBe(false);
            state.recordAttempt(levelId);
            state = new OdysseyStateManager({ levelRegistry: registry });
            expect(state.isLevelCompleted(levelId)).toBe(false);
            expect(state.isLevelUnlocked(levelId + 1)).toBe(false);
            expect(state.getProgressSummary().completedLevels).toBe(levelId - 1);

            state.completeLevel(levelId, {
                stars: 1, score: 1000, time: 60, lines: 20, bonuses: [true, false],
            });
            state = new OdysseyStateManager({ levelRegistry: registry });
            const next = Math.min(levelId + 1, 59);
            expect(state.currentLevel).toBe(next);
            expect(state.currentChapter).toBe(chapterEnds.findIndex((end) => next <= end) + 1);
            expect([...state.unlockedLevels]).toEqual(Array.from({ length: next }, (_, index) => index + 1));
            expect(state.isLevelCompleted(levelId)).toBe(true);
            expect(state.getLevelCompletion(levelId)).toMatchObject({
                stars: 1, bestScore: 1000, bestTime: 60, completedBonuses: [true, false],
            });
            expect(state.getProgressSummary()).toMatchObject({
                completedLevels: levelId,
                totalStars: levelId,
                chaptersCompleted: chapterEnds.filter((end) => levelId >= end).length,
            });
        }
        expect(state.isLevelUnlocked(60)).toBe(false);
        expect(state.getOverallProgress()).toBe(100);
        expect(state.statistics.totalAttempts).toBe(118);
    });

    it('counts failure, success and successful retry once each without erasing earned rewards', () => {
        let state = new OdysseyStateManager({ levelRegistry: registry });
        state.recordAttempt(1);
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics.totalAttempts).toBe(1);
        expect(state.isLevelCompleted(1)).toBe(false);
        expect(state.isLevelUnlocked(2)).toBe(false);

        state.completeLevel(1, {
            stars: 3, score: 12000, time: 90, lines: 20, bonuses: [true, false],
        });
        state = new OdysseyStateManager({ levelRegistry: registry });
        const { completionDate } = state.getLevelCompletion(1);
        expect(state.statistics.totalAttempts).toBe(2);

        state.completeLevel(1, {
            stars: 1, score: 9000, time: 120, lines: 22, bonuses: [false, true],
        });
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.getLevelCompletion(1)).toMatchObject({
            stars: 3,
            bestScore: 12000,
            bestTime: 90,
            completedBonuses: [true, true],
            completionDate,
            attempts: 2, // This per-level field counts successful completions.
        });
        expect(state.statistics).toMatchObject({
            totalAttempts: 3, totalStars: 3, totalLinesCleared: 42, totalScore: 21000,
        });
        expect(state.currentLevel).toBe(2);
        expect(state.isLevelUnlocked(3)).toBe(false);

        state.recordAttempt(1);
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics.totalAttempts).toBe(4);
        expect(state.getLevelStars(1)).toBe(3);
        expect(state.getLevelCompletion(1).completedBonuses).toEqual([true, true]);
    });

    it('persists canonical chain records without replacing a stronger earlier result', () => {
        let state = new OdysseyStateManager({ levelRegistry: registry });
        state.completeLevel(1, { stars: 1, combo: 8, maxCascadeDepth: 8 });
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics).toMatchObject({ highestCombo: 8, maxCascadeDepth: 8 });
        state.completeLevel(1, { stars: 1, combo: 2, maxCascadeDepth: 2 });
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics).toMatchObject({ highestCombo: 8, maxCascadeDepth: 8 });
    });

    it('retains the legacy cascade-depth input while preferring the canonical field when supplied', () => {
        let state = new OdysseyStateManager({ levelRegistry: registry });
        state.completeLevel(1, { stars: 1, cascadeDepth: 3 });
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics.maxCascadeDepth).toBe(3);
        state.completeLevel(1, { stars: 1, maxCascadeDepth: 4, cascadeDepth: 12 });
        state = new OdysseyStateManager({ levelRegistry: registry });
        expect(state.statistics.maxCascadeDepth).toBe(4);
    });
});
