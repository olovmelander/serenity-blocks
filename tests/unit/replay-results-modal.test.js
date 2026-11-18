import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { showDemoCompleteModal } from '../../src/ui/modals.js';

// Audit 2026-11-18 A18-PERS-3: only Single Player records replays, so their
// results sheet is measured against Single Player alone, as its game-over is.
describe('replay results sheet', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('ranks and totals a Single Player replay against Single Player games only', async () => {
        const finalStats = { innerHTML: '' };
        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => (id === 'demo-final-stats' ? finalStats : null)),
        });
        // Sixty Infinity runs above 90,000 and a Single Player best of 50,000.
        const highScoreManager = {
            getRank: vi.fn(async (score, { mode } = {}) => (mode === 'single' ? 1 : 61)),
            getStatistics: vi.fn(async () => ({
                totalGames: 62,
                totalScore: 5_470_000,
                totalLines: 9_000,
                highestScore: 90_059,
                highestLevel: 30,
                byMode: {
                    single: {
                        totalGames: 2, totalScore: 70_000, totalLines: 300, highestScore: 50_000, highestLevel: 12,
                    },
                    infinity: {
                        totalGames: 60, totalScore: 5_400_000, totalLines: 8_700, highestScore: 90_059, highestLevel: 30,
                    },
                },
            })),
        };
        const modalManager = { show: vi.fn(), hide: vi.fn() };

        const presented = await showDemoCompleteModal(modalManager, {
            score: 50_000, lines: 150, level: 12, simTimeMs: 300_000, piecesPlaced: 400,
        }, highScoreManager);

        expect(presented).toBe(true);
        expect(finalStats.innerHTML).not.toContain('Rank #61');
        expect(finalStats.innerHTML).toContain('New record');
        expect(highScoreManager.getRank).toHaveBeenCalledWith(50_000, { mode: 'single' });
        // The career card is Single Player's: no Infinity best, no Infinity lines.
        expect(finalStats.innerHTML).not.toContain('90,059');
        expect(finalStats.innerHTML).not.toContain('9,000');
        expect(modalManager.show).toHaveBeenCalledWith('demoComplete');
    });
});
