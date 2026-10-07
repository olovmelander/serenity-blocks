/* eslint-disable no-await-in-loop -- Each real clear must settle before the next progression step. */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { COLS, LEVEL_SPEEDS } from '../../src/core/constants.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import { processPhysicsLegacy, processPhysicsResolved } from '../../src/core/physics.js';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function createEngine(level) {
    const engine = new GameplayHybridEngine();
    engine.configure(level);
    engine.createGameState();
    engine.gameState.isSeeking = true; // Skip presentation waits, retaining real physics/scoring.
    return engine;
}

async function clearOneLine(engine, physics) {
    const state = engine.gameState;
    const bottom = state.boardGrid.length - 1;
    // A controlled clear fixture isolates the authored speed boundary from placement
    // strategy. The spare block prevents a perfect-clear score bonus.
    state.lockedPieces = [
        {
            pieceId: 'full-row', color: '#666', x: 0, y: bottom, shape: [Array(COLS).fill(1)],
        },
        {
            pieceId: 'spare', color: '#888', x: 0, y: bottom - 2, shape: [[1]],
        },
    ];
    await physics(state, engine.buildPhysicsCallbacks({}));
}

describe.each([
    ['legacy', processPhysicsLegacy],
    ['resolved', processPhysicsResolved],
])('Odyssey authored speed progression through %s physics', (_name, physics) => {
    it('preserves orb 6 acceleration and score levels across its real 15-line boundary', async () => {
        const level = getLevelById(6);
        const original = structuredClone(level);
        const engine = createEngine(level);
        const state = engine.gameState;

        expect(state.dropInterval).toBe(800);
        expect(state.level).toBe(4);
        expect(state.lockedPieces).toHaveLength(5);
        expect(state.disableLevelProgression).toBe(false);
        expect(state.speedMultiplier).toBe(LEVEL_SPEEDS[3] / 800);

        for (let line = 0; line < 14; line++) await clearOneLine(engine, physics);
        expect(state.lines).toBe(14);
        expect(state.level).toBe(4);
        expect(state.dropInterval).toBe(800);
        expect(engine.checkVictory()).toBe(false);

        const scoreBeforeLevelUp = state.score;
        await clearOneLine(engine, physics);
        expect(state.lines).toBe(15);
        expect(state.level).toBe(5);
        expect(state.dropInterval).toBeCloseTo(LEVEL_SPEEDS[4] * (800 / LEVEL_SPEEDS[3]));
        expect(state.dropInterval).toBeLessThan(800);
        expect(state.score - scoreBeforeLevelUp).toBe(375); // The clear already uses score level 5.
        expect(engine.checkVictory()).toBe(false);

        for (let line = 15; line < 20; line++) await clearOneLine(engine, physics);
        expect(engine.checkVictory()).toBe(true);
        expect(state.score).toBe(14 * 350 + 6 * 375);
        expect(level).toEqual(original); // Primary goal, stars and all authored data stay intact.
    });

    it('retains the canonical schedule when no custom opening interval is authored', async () => {
        const engine = createEngine(getLevelById(1));
        const state = engine.gameState;
        expect(state.dropInterval).toBe(LEVEL_SPEEDS[0]);
        expect(state.speedMultiplier).toBeUndefined();
        state.linesUntilNextLevel = 1;
        await clearOneLine(engine, physics);
        expect(state.level).toBe(2);
        expect(state.dropInterval).toBe(LEVEL_SPEEDS[1]);
    });

    it('retains fixed speed and score level when progression is disabled', async () => {
        const engine = createEngine(getLevelById(7));
        const state = engine.gameState;
        expect(state.dropInterval).toBe(800);
        expect(state.speedMultiplier).toBeUndefined();
        state.linesUntilNextLevel = 1;
        await clearOneLine(engine, physics);
        expect(state.level).toBe(4);
        expect(state.dropInterval).toBe(800);
    });

    it('composes the custom schedule with the persistent speed-up modifier', async () => {
        const level = structuredClone(getLevelById(6));
        level.modifiers.active = ['speed-up'];
        const engine = createEngine(level);
        const state = engine.gameState;
        expect(state.dropInterval).toBeCloseTo(800 / 1.5);
        expect(state.speedMultiplier).toBeCloseTo(1.5 * (LEVEL_SPEEDS[3] / 800));
        state.linesUntilNextLevel = 1;
        await clearOneLine(engine, physics);
        expect(state.dropInterval).toBeCloseTo((LEVEL_SPEEDS[4] * (800 / LEVEL_SPEEDS[3])) / 1.5);
    });

    it('keeps slow-start limited to the opening interval', async () => {
        const level = structuredClone(getLevelById(6));
        level.modifiers.active = ['slow-start'];
        const engine = createEngine(level);
        const state = engine.gameState;
        expect(state.dropInterval).toBe(1200);
        expect(state.speedMultiplier).toBe(LEVEL_SPEEDS[3] / 800);
        state.linesUntilNextLevel = 1;
        await clearOneLine(engine, physics);
        expect(state.dropInterval).toBeCloseTo(LEVEL_SPEEDS[4] * (800 / LEVEL_SPEEDS[3]));
    });
});

it('limits the new progression scaling to orb 6 across all 59 composed configurations', () => {
    const scaledIds = [];
    for (const level of LEVEL_CONFIGS) {
        const state = createEngine(level).gameState;
        const { speed } = level.mechanics;
        expect(state.dropInterval, `orb ${level.id} opening speed`).toBe(
            speed.fixedDropInterval || LEVEL_SPEEDS[speed.startLevel - 1],
        );
        expect(state.level, `orb ${level.id} score level`).toBe(speed.startLevel);
        expect(state.disableLevelProgression, `orb ${level.id} progression`).toBe(!speed.levelProgression);
        if (state.speedMultiplier !== undefined) scaledIds.push(level.id);
    }
    expect(scaledIds).toEqual([6]);
    expect(LEVEL_CONFIGS).toHaveLength(59);
});
