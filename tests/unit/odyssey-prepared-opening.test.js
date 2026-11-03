import {
    afterEach, describe, expect, it,
} from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

const show = (row) => row.map((cell) => (cell ? 'X' : '.')).join('');
let engine;
let state;

function seeded(levelId, opening) {
    const level = structuredClone(getLevelById(levelId));
    level.mechanics.board.opening = opening;
    engine = new GameplayHybridEngine();
    engine.configure(level);
    state = engine.createGameState({ rngSeed: 11 });
    return state.boardGrid;
}

afterEach(() => {
    state?.reset?.();
    engine?.reset?.();
    state = null;
    engine = null;
});

describe('prepared openings (level design audit 2026-11, phase 2)', () => {
    it('seeds exactly the authored cells, top row first as the player sees them', () => {
        const opening = ['X.XXXXXXXX', 'XX.XXXXX.X', 'XXXXXXXXX.'];
        const grid = seeded(12, opening);
        expect(grid.slice(-3).map(show)).toEqual(opening);
        expect(grid.slice(0, -3).every((row) => row.every((cell) => !cell))).toBe(true);
    });

    it('replaces the generic rubble pattern when an orb authors one', () => {
        const grid = seeded(8, ['XXXXXXXXX.']);
        expect(grid.slice(-2).map(show)).toEqual(['..........', 'XXXXXXXXX.']);
    });

    it('never fills the spawn clearance', () => {
        const tall = Array.from({ length: 40 }, () => 'XXXX.XXXXX');
        const grid = seeded(12, tall);
        const filled = grid.filter((row) => row.some(Boolean)).length;
        expect(filled).toBeLessThan(grid.length - 4);
    });
});
