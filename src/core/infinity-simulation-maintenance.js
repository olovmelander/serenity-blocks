// @ts-check

import {
    calculateTopRow,
    checkInfinityGameOver,
    expandGridIfNeeded,
} from './infinity-grid.js';
import { synchronizeInfinitySimulationCamera } from './infinity-spawn-policy.js';

export const INFINITY_EXPANSION_THRESHOLD_ROWS = 30;
export const INFINITY_EXPANSION_BATCH_ROWS = 10;

/**
 * @typedef {Object} InfinitySimulationMaintenanceResult
 * @property {number} previousRowCount
 * @property {number} rowCount
 * @property {number} rowsAdded
 * @property {number} currentTopRow
 * @property {boolean} expanded
 * @property {boolean} gameOver
 * @property {boolean} gameOverTransitioned
 */

/**
 * Find the top occupied board row without treating an empty board's last row
 * as occupied (the legacy calculateTopRow display convention does that).
 *
 * @param {unknown[][]} board
 * @returns {number} `board.length` when the board is empty
 */
function findHighestOccupiedRow(board) {
    for (let row = 0; row < board.length; row += 1) {
        if (board[row].some((cell) => cell !== null)) return row;
    }
    return board.length;
}

/**
 * Advance Infinity-only simulation maintenance at a canonical tick boundary.
 * This function owns no renderer, DOM, timer, or callback. `rowsAdded` is the
 * presentation handoff future mode wiring can use to compensate its camera.
 *
 * Expansion precedes the roof check, matching Infinity's established rule:
 * reaching row zero is survivable while more rows can still be added above it.
 *
 * @param {import('./game.js').GameState} gameState
 * @returns {InfinitySimulationMaintenanceResult}
 */
export function maintainInfinitySimulation(gameState) {
    if (!gameState?.isInfinityMode) {
        throw new TypeError('Infinity maintenance requires an Infinity GameState');
    }

    const board = gameState.board || gameState.boardGrid;
    if (!Array.isArray(board) || board.length === 0) {
        throw new TypeError('Infinity maintenance requires a non-empty board');
    }

    const previousRowCount = board.length;
    const configuredMaxRows = Number(gameState.maxRows);
    const maxRows = Number.isInteger(configuredMaxRows) && configuredMaxRows >= previousRowCount
        ? configuredMaxRows
        : previousRowCount;
    const wasGameOver = gameState.isGameOver === true;
    const highestOccupiedRow = findHighestOccupiedRow(board);

    if (
        !wasGameOver
        && previousRowCount < maxRows
        && highestOccupiedRow <= INFINITY_EXPANSION_THRESHOLD_ROWS
    ) {
        const requiredRows = Math.min(
            maxRows,
            previousRowCount + INFINITY_EXPANSION_BATCH_ROWS,
        );
        expandGridIfNeeded(gameState, requiredRows);
    }

    const rowCount = gameState.boardGrid.length;
    const rowsAdded = rowCount - previousRowCount;
    const adjustedHighestOccupiedRow = highestOccupiedRow >= previousRowCount
        ? rowCount
        : highestOccupiedRow + rowsAdded;
    synchronizeInfinitySimulationCamera(gameState, adjustedHighestOccupiedRow);
    const currentTopRow = calculateTopRow(gameState);
    gameState.currentTopRow = currentTopRow;

    if (rowsAdded > 0 && gameState.infinityStats) {
        gameState.infinityStats.rowsReached = Math.max(
            Number(gameState.infinityStats.rowsReached) || 0,
            rowCount,
        );
    }

    let gameOverTransitioned = false;
    if (!wasGameOver && checkInfinityGameOver(gameState)) {
        gameState.isGameOver = true;
        gameOverTransitioned = true;
    }

    return {
        previousRowCount,
        rowCount,
        rowsAdded,
        currentTopRow,
        expanded: rowsAdded > 0,
        gameOver: gameState.isGameOver === true,
        gameOverTransitioned,
    };
}
