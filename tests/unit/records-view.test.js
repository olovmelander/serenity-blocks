import { describe, expect, it } from 'vitest';
import {
    allModesLine, formatRecordDate, formatRunLength, odysseyTabHtml, scoresTabHtml,
} from '../../src/ui/records/records-view.js';

const NOW = new Date('2026-10-17T15:00:00');
const stats = {
    totalGames: 7,
    totalLines: 831,
    byMode: {
        single: {
            totalGames: 4, totalScore: 115360, totalLines: 161, highestScore: 48210, highestLevel: 7,
        },
        infinity: {
            totalGames: 3,
            totalScore: 2054074,
            totalLines: 670,
            highestScore: 987654,
            highestLevel: 22,
            bestCascade: 11,
            longestRun: 1500,
        },
    },
};

describe('Records, Single Player and Infinity', () => {
    it("leads Infinity with its cascade and run length, and shows each run by them", () => {
        const { facts, list } = scoresTabHtml('infinity', {
            scores: [
                {
                    score: 987654, lines: 300, level: 22, cascade: 11, duration: 404, timestamp: NOW.getTime(), mode: 'infinity',
                },
                // Saved before runs kept their cascade: shown by level and lines.
                {
                    score: 612300, lines: 210, level: 18, timestamp: 1700000000000, mode: 'infinity',
                },
            ],
            stats,
            now: NOW,
        });
        expect(facts).toContain('Best cascade');
        expect(facts).toContain('11-chain');
        expect(facts).toContain('25:00');
        expect(facts).toContain('Runs');
        expect(list).toContain('Best runs');
        expect(list).toContain('11-chain cascade · 6:44 · 300 lines');
        expect(list).toContain('Level 18 · 210 lines');
        expect(list).toMatch(/hs-date hs-date--lit"[^>]*>Today</);
    });

    it("counts Single Player's own games, not Infinity's", () => {
        const { facts } = scoresTabHtml('single', {
            scores: [{
                score: 48210, lines: 62, level: 7, timestamp: 1700000000000,
            }],
            stats,
            now: NOW,
        });
        expect(facts).toContain('48,210');
        expect(facts).not.toContain('987,654');
        expect(facts).toContain('28,840'); // the average: 115,360 / 4
    });

    it('offers to play an empty mode only from the main menu', () => {
        const fromMenu = scoresTabHtml('infinity', { scores: [], stats: {}, canStart: true });
        expect(fromMenu.facts).toBe('');
        expect(fromMenu.list).toContain('No Infinity runs yet');
        expect(fromMenu.list).toContain('data-play-card="infinity-card-btn"');
        expect(scoresTabHtml('single', { scores: [], stats: {}, canStart: false }).list)
            .not.toContain('hs-empty__play');
    });
});

describe('Records, Odyssey', () => {
    const chapters = [
        {
            id: 1, name: 'Earth Core', levels: [1, 2], cleared: 2, stars: 5,
        },
        {
            id: 2, name: 'Deep <Ocean>', levels: [3, 4], cleared: 1, stars: 3,
        },
        {
            id: 3, name: 'Surface World', levels: [5, 6], cleared: 0, stars: 0,
        },
    ];
    const odyssey = {
        summary: {
            completedOrbs: 3, totalOrbs: 6, stars: 8, maxStars: 18, completedChapters: 1, totalChapters: 3,
        },
        chapters,
        completedIds: new Set([1, 2, 3]),
        threeStars: 2,
        next: 4,
    };

    it('shows stars, levels and chapters, the journey as cells, and where it goes next', () => {
        const { facts, list } = odysseyTabHtml(odyssey);
        expect(facts).toContain('8 / 18');
        expect(facts).toContain('3 / 6');
        expect(facts).toContain('1 / 3');
        expect(facts).toContain('aria-label="3 of 6 levels cleared"');
        expect(list).toContain('2 of 2 levels · 5 of 6 stars');
        expect(list).toMatch(/Earth Core[\s\S]*Complete/);
        expect(list).toMatch(/Deep &lt;Ocean&gt;[\s\S]*Up next/);
        expect(list).not.toContain('<Ocean>');
    });

    it('invites a new traveller to begin', () => {
        const fresh = odysseyTabHtml({ ...odyssey, summary: { ...odyssey.summary, completedOrbs: 0 } }, { canStart: true });
        expect(fresh.list).toContain('No Odyssey levels cleared yet');
        expect(fresh.list).toContain('Begin the journey');
    });
});

describe('Records formatting', () => {
    it('writes run lengths, today, and the all-modes line', () => {
        expect(formatRunLength(404)).toBe('6:44');
        expect(formatRunLength(4325)).toBe('1:12:05');
        expect(formatRecordDate(NOW.getTime() - 3600000, NOW)).toEqual({ text: 'Today', today: true });
        expect(formatRecordDate(1700000000000, NOW).today).toBe(false);
        expect(allModesLine(stats)).toBe('All modes · 7 games · 831 lines cleared');
        expect(allModesLine({ totalGames: 0 })).toBe('');
    });
});
