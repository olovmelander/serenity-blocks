import { describe, expect, it } from 'vitest';
import { BOARDS, isEligibleScore, STAT_NAMES, ACHIEVEMENTS } from '../../src/core/steam/steam-catalogue.js';
import { packScoreDetails } from '../../src/core/steam/leaderboard-score-details.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { hasOdysseyTimeBoard } from '../../src/core/odyssey/odyssey-time-board.js';

describe('published Steam catalogue', () => {
    it('matches the assembled campaign and refuses invalid or assisted times', () => {
        expect(Object.keys(BOARDS)).toHaveLength(64);
        for (const level of Object.values(LEVEL_CONFIGS)) {
            const name = 'OdysseyLevelTime_v6_' + level.id;
            expect(Boolean(BOARDS[name])).toBe(hasOdysseyTimeBoard(level));
        }
        const board = 'OdysseyLevelTime_v6_1';
        expect(isEligibleScore(board, 1234, [1, 1, 0, 1, 1234, 0, 0])).toBe(true);
        expect(isEligibleScore(board, 0, [1, 0, 0, 1, 0, 0, 0])).toBe(false);
        expect(isEligibleScore(board, 1234, [1, 1, 0, 9, 1234, 0, 0])).toBe(false);
        expect(isEligibleScore('FFAWinRate_v1', 10000, [])).toBe(false);
        expect(STAT_NAMES).toHaveLength(9);
        expect(ACHIEVEMENTS).toHaveLength(4);
    });
    it('keeps all checksum bits', () => {
        expect(packScoreDetails({ checksum32: 0xffffffff })[6]).toBe(-1);
        expect(packScoreDetails({ checksum32: 0x80000000 })[6]).toBe(-2147483648);
    });
});
