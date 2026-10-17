/**
 * The Waystones certifier: every climate's ask, before and at the Keeper, is reached by
 * the game's own bot on a live GameState within a piece budget, so no stop on any road
 * asks for something the rules cannot give. The budgets are generous: a human plays
 * worse than the evaluator's placements but far better than its lack of plans.
 */
import { describe, expect, it } from 'vitest';
import { GameState, fillBag, spawnPiece } from '../../src/core/game.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { CLIMATES } from '../../src/core/waystones/climates.js';
import { scaledGoal } from '../../src/core/waystones/road.js';
import { playUntil } from './helpers/waystones-bot.js';

/** Pieces allowed per unit of the goal, plus a floor: a line is 2.5 pieces of cells at best. */
const BUDGET = {
    lines: (target) => 20 + target * 5,
    score: (target) => 20 + Math.ceil(target / 100) * 2,
    cascades: (target) => 40 + target * 45,
};

function liveGame(seed) {
    const gameState = new GameState({ hitStopEnabled: false, disableLevelProgression: true });
    gameState.isSeeking = true;
    bindLegacySessionRng(gameState, seed);
    fillBag(gameState.nextPieces, gameState.randomGenerator);
    spawnPiece(gameState);
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
            if (!gameState.isGameOver) spawnPiece(gameState);
        },
    };
    return { totals, callbacks };
}

describe('Waystones certifier', () => {
    describe.each(CLIMATES.map((climate) => [climate.id, climate]))('%s', (id, climate) => {
        it.each([[false, 11], [true, 23]])('is reachable by the bot (keeper: %s)', async (keeper, seed) => {
            const goal = scaledGoal(climate, { keeper });
            const gameState = liveGame(seed);
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
