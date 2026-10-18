/**
 * The Waystones certifier: every climate's ask, before and at the Keeper, is reached by
 * the game's own bot on a live GameState within a piece budget, so no stop on any road
 * asks for something the rules cannot give. The budgets are generous: a human plays
 * worse than the evaluator's placements but far better than its lack of plans.
 */
import { describe, expect, it } from 'vitest';
import { GameState, fillBag, spawnPiece } from '../../src/core/game.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { ModifierStack } from '../../src/core/odyssey/ModifierStack.js';
import { CLIMATES, OWN_MODIFIERS } from '../../src/core/waystones/climates.js';
import { scaledGoal } from '../../src/core/waystones/road.js';
import { playUntil } from './helpers/waystones-bot.js';

/**
 * Pieces allowed per unit of the goal, plus a floor: a line is 2.5 pieces of cells at best,
 * a single is 275 points, and a two-wave cascade comes to ordinary play about once in
 * twenty pieces.
 */
const BUDGET = {
    lines: (target) => 20 + target * 5,
    score: (target) => 30 + Math.ceil(target / 50),
    cascades: (target) => 40 + target * 45,
};

/**
 * Deals the next piece with no lock bonus. A seeking clock never advances, so the game
 * would pay the instant-lock maximum (50 a piece) and a score ask would certify the clock,
 * not the clears; a careful player earns next to none of it.
 */
function deal(gameState) {
    spawnPiece(gameState);
    gameState.pieceSpawnTime = NaN;
}

function liveGame(seed, climate) {
    const gameState = new GameState({ hitStopEnabled: false, disableLevelProgression: true });
    gameState.isSeeking = true;
    bindLegacySessionRng(gameState, seed);
    // Odyssey's modifiers as the mode applies them: the chain bonus changes what a clear pays.
    const modifiers = new ModifierStack();
    modifiers.activate(climate.modifiers.filter((id) => !OWN_MODIFIERS.includes(id)));
    modifiers.applyToGameState(gameState);
    fillBag(gameState.nextPieces, gameState.randomGenerator);
    deal(gameState);
    return gameState;
}

/** Counts what a Waystones stop counts: lines, points and cascades two waves deep. */
function stopCounter(gameState) {
    const totals = { lines: 0, score: 0, cascades: 0 };
    let lockWaves = 0;
    const callbacks = {
        onPieceLock: () => { lockWaves = 0; },
        onLineClear: (lineCount, ...rest) => {
            totals.lines += lineCount;
            lockWaves = Math.max(lockWaves, rest[3] ?? 1);
        },
        spawnPiece: () => {
            if (lockWaves >= 2) totals.cascades += 1;
            totals.score = gameState.score;
            if (!gameState.isGameOver) deal(gameState);
        },
    };
    return { totals, callbacks };
}

describe('Waystones certifier', () => {
    describe.each(CLIMATES.map((climate) => [climate.id, climate]))('%s', (id, climate) => {
        it.each([[false, 11], [true, 23]])('is reachable by the bot (keeper: %s)', async (keeper, seed) => {
            const goal = scaledGoal(climate, { keeper });
            const gameState = liveGame(seed, climate);
            const { totals, callbacks } = stopCounter(gameState);
            const budget = BUDGET[goal.type](goal.target);
            const pieces = await playUntil(
                gameState,
                () => callbacks,
                () => totals[goal.type] >= goal.target,
                { maxPieces: budget, goalType: goal.type },
            );
            expect(gameState.isGameOver, `${id} topped out`).toBe(false);
            expect(totals[goal.type], `${id}: ${goal.type} ${goal.target} in ${pieces} of ${budget} pieces`)
                .toBeGreaterThanOrEqual(goal.target);
        });
    });
});
