/**
 * A headless player for Waystones tests: the game's own placement search and board
 * evaluator choose a landing, and the real controls play it on a live GameState.
 */
import {
    hardDrop, move, rotate, softDrop,
} from '../../../src/core/game.js';
import { HIDDEN_ROWS } from '../../../src/core/constants.js';
import { findReachablePlacements } from '../../../src/core/ai/reachability-pathfinder.js';
import { simulatePlacement } from '../../../src/core/ai/cascade-simulator.js';
import { rankCandidates } from '../../../src/core/ai/board-evaluator.js';

/**
 * The landing the evaluator likes best, with a thumb on the scale for the stop's goal:
 * a cascade now for a cascades goal, a clear now for a lines or score goal.
 * @param {import('../../../src/core/game.js').GameState} gameState
 * @param {'lines' | 'score' | 'cascades'} [goalType]
 */
export function pickPlacement(gameState, goalType = 'lines') {
    const candidates = [];
    for (const placement of findReachablePlacements(gameState)) {
        const outcome = simulatePlacement(gameState, placement);
        if (!outcome) continue;
        candidates.push({
            ...outcome, placement, nextShapeKeys: gameState.nextPieces.slice(0, 2), hiddenRows: HIDDEN_ROWS,
        });
    }
    if (candidates.length === 0) return null;
    const ranked = rankCandidates(candidates);
    const top = ranked.slice(0, 4);
    if (goalType === 'cascades') {
        const cascade = ranked.find((candidate) => candidate.cascadeCount >= 2);
        if (cascade) return cascade.placement;
    } else {
        const clear = top.find((candidate) => candidate.totalLines > 0);
        if (clear) return clear.placement;
    }
    return ranked[0].placement;
}

/**
 * Plays a placement through the real controls and waits for its cascade to settle.
 * @param {import('../../../src/core/game.js').GameState} gameState
 * @param {{ actions: Array<{ type: string, dir?: any }> }} placement
 * @param {Object} callbacks physics callbacks
 */
export async function playPlacement(gameState, placement, callbacks) {
    for (const action of placement.actions) {
        if (action.type === 'move') move(gameState, action.dir);
        else if (action.type === 'rotate') rotate(gameState, action.dir);
        else if (action.type === 'softDrop') softDrop(gameState, null, callbacks);
    }
    hardDrop(gameState, null, callbacks);
    await gameState.latestPhysicsPromise;
}

/**
 * Plays until the predicate holds or the budget is spent; the caller's callbacks deal
 * each next piece. Returns the pieces played.
 * @param {import('../../../src/core/game.js').GameState} gameState
 * @param {() => Object} callbacks
 * @param {() => boolean} done
 * @param {{ maxPieces?: number, goalType?: 'lines' | 'score' | 'cascades' }} [options]
 */
export async function playUntil(gameState, callbacks, done, { maxPieces = 200, goalType = 'lines' } = {}) {
    let pieces = 0;
    while (!done() && pieces < maxPieces && gameState.currentPiece) {
        const placement = pickPlacement(gameState, goalType);
        if (!placement) break;
        // eslint-disable-next-line no-await-in-loop
        await playPlacement(gameState, placement, callbacks());
        pieces += 1;
    }
    return pieces;
}
