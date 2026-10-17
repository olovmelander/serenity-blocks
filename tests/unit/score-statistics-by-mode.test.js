import { describe, expect, it } from 'vitest';
import {
    addGameToModeStatistics, createEmptyStatistics, mergeStatisticsSnapshots, modeStatisticsOf,
} from '../../src/core/progression/score-statistics.js';

// A record saved before the split: lifetime counters only, no byMode.
const LEGACY = {
    id: 'stats',
    bestScorePerLevel: {},
    totalGames: 12,
    totalScore: 240000,
    totalLines: 900,
    highestScore: 61000,
    highestLevel: 14,
};

describe('score statistics per mode', () => {
    it('counts a record from before the split as Single Player, so the menu shows what it did', () => {
        expect(modeStatisticsOf(LEGACY)).toEqual({
            single: {
                totalGames: 12, totalScore: 240000, totalLines: 900, highestScore: 61000, highestLevel: 14,
            },
        });
        expect(modeStatisticsOf(createEmptyStatistics())).toEqual({});
        expect(modeStatisticsOf(null)).toEqual({});
    });

    it('keeps an Infinity run out of Single Player', () => {
        const byMode = addGameToModeStatistics(modeStatisticsOf(LEGACY), 'infinity', {
            score: 950000, lines: 400, level: 30,
        });
        expect(byMode.single.highestScore).toBe(61000);
        expect(byMode.single.totalGames).toBe(12);
        expect(byMode.infinity).toEqual({
            totalGames: 1, totalScore: 950000, totalLines: 400, highestScore: 950000, highestLevel: 30,
        });
        const next = addGameToModeStatistics(byMode, 'single', { score: 70000, lines: 90, level: 9 });
        expect(next.single).toEqual({
            totalGames: 13, totalScore: 310000, totalLines: 990, highestScore: 70000, highestLevel: 14,
        });
        expect(next.infinity).toBe(byMode.infinity);
    });

    it("keeps Infinity's bests (deepest cascade, longest run) and leaves Single Player without them", () => {
        let byMode = addGameToModeStatistics({}, 'infinity', {
            score: 400000, lines: 120, level: 12, cascade: 9, duration: 600,
        });
        byMode = addGameToModeStatistics(byMode, 'infinity', {
            score: 300000, lines: 90, level: 10, cascade: 6, duration: 1500,
        });
        byMode = addGameToModeStatistics(byMode, 'single', { score: 9000, lines: 30, level: 4 });
        expect(byMode.infinity).toMatchObject({ totalGames: 2, bestCascade: 9, longestRun: 1500 });
        expect(byMode.single).not.toHaveProperty('bestCascade');
        expect(byMode.single).not.toHaveProperty('longestRun');

        const merged = mergeStatisticsSnapshots(
            { totalGames: 3, byMode },
            { totalGames: 3, byMode: { infinity: { ...byMode.infinity, bestCascade: 11 } } },
        );
        expect(merged.byMode.infinity).toMatchObject({ bestCascade: 11, longestRun: 1500 });
        expect(merged.byMode.single).not.toHaveProperty('bestCascade');
    });

    it('merges two devices mode by mode, keeping the larger counters', () => {
        const desktop = {
            ...LEGACY,
            byMode: {
                single: {
                    totalGames: 12, totalScore: 240000, totalLines: 900, highestScore: 61000, highestLevel: 14,
                },
                infinity: {
                    totalGames: 2, totalScore: 50000, totalLines: 80, highestScore: 40000, highestLevel: 6,
                },
            },
        };
        // A device still on the old version: no byMode, its history read as Single Player.
        const laptop = { ...LEGACY, totalGames: 15, highestScore: 65000 };
        const merged = mergeStatisticsSnapshots(desktop, laptop);
        expect(merged.byMode.single).toMatchObject({ totalGames: 15, highestScore: 65000 });
        expect(merged.byMode.infinity).toEqual(desktop.byMode.infinity);
        // Merging again changes nothing: the counters are snapshots, not deltas.
        expect(mergeStatisticsSnapshots(merged, laptop)).toEqual(merged);
    });
});
