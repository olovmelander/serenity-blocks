import { describe, expect, it } from 'vitest';
import {
    ODYSSEY_VISIBLE_ROWS, getOdysseyBoardRows, isOdysseyTallBoard,
} from '../../src/core/odyssey/odyssey-board-shape.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { mountOdysseyBoardLayout } from '../../src/ui/odyssey/odyssey-board-layout.js';

function host() {
    return {
        dataset: {}, hasAttribute: () => false, removeAttribute() {}, toggleAttribute() {},
    };
}

describe('Odyssey board shape', () => {
    it('reads rows from a level, its board or a number, defaulting to the visible window', () => {
        expect(getOdysseyBoardRows({ mechanics: { board: { rows: 27 } } })).toBe(27);
        expect(getOdysseyBoardRows({ board: { rows: 36 } })).toBe(36);
        expect(getOdysseyBoardRows(24)).toBe(24);
        expect(getOdysseyBoardRows(null)).toBe(ODYSSEY_VISIBLE_ROWS);
    });

    it('treats every well taller than the visible twenty rows as tall', () => {
        expect(isOdysseyTallBoard(20)).toBe(false);
        expect(isOdysseyTallBoard(21)).toBe(true);
        expect(isOdysseyTallBoard(24)).toBe(true);
        expect(isOdysseyTallBoard(100)).toBe(true);
    });

    it('gives every scrolling campaign board the tower layout, never a bare scrolling well', () => {
        for (const level of LEVEL_CONFIGS) {
            const stage = host();
            mountOdysseyBoardLayout({ stage, container: host(), levelConfig: level });
            const scrolls = level.mechanics.board.rows > ODYSSEY_VISIBLE_ROWS;
            const expected = level.mechanics.versus ? 'duel' : (scrolls ? 'tower' : 'standard');
            expect(stage.dataset.odysseyBoard, `orb ${level.id} (${level.mechanics.board.rows} rows)`).toBe(expected);
        }
        expect(LEVEL_CONFIGS.filter((level) => level.mechanics.board.rows > ODYSSEY_VISIBLE_ROWS
            && level.mechanics.board.rows < 30).length).toBeGreaterThan(5);
    });
});
