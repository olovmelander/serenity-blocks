/**
 * @fileoverview Infinity Grid utilities for dynamic grid expansion
 * Handles grid expansion, top row calculation, and position updates for Infinity Mode
 */

import { COLS } from './constants.js';
import { markBoardDirty } from './game.js';

/**
 * Create initial infinity grid
 * @param {number} cols - Number of columns
 * @param {number} initialRows - Initial number of rows to create
 * @returns {Array<Array<null>>} - 2D grid array
 */
export function createInfinityGrid(cols, initialRows) {
    // No hidden rows concept in infinity mode - all rows are scrollable
    return Array.from({ length: initialRows }, () => Array(cols).fill(null));
}

/**
 * Expands the playfield upward when player reaches high rows
 * Adds new rows at the top and updates all piece positions accordingly
 *
 * @param {Object} gameState - Current game state
 * @param {number} requiredRows - Total rows needed
 * @returns {boolean} - True if expansion occurred, false otherwise
 */
export function expandGridIfNeeded(gameState, requiredRows) {
    if (!gameState || !gameState.isInfinityMode) {
        return false;
    }

    const board = gameState.board || gameState.boardGrid;
    if (!board) {
        console.warn('[InfinityGrid] Cannot expand grid: gameState.board is not initialized');
        return false;
    }

    const currentLength = board.length;

    // Already have enough rows
    if (requiredRows <= currentLength) {
        return false;
    }

    // Calculate how many rows to add (capped by maxRows)
    const rowsToAdd = Math.min(
        10, // Add 10 rows at a time for efficiency
        Math.min(
            requiredRows - currentLength,
            gameState.maxRows - currentLength,
        ),
    );

    // No space to expand
    if (rowsToAdd <= 0) {
        return false;
    }

    console.log(`[InfinityGrid] Expanding grid by ${rowsToAdd} rows (${currentLength} → ${currentLength + rowsToAdd})`);

    // Prepend new empty rows at the top
    const newRows = Array.from({ length: rowsToAdd }, () => Array(board[0]?.length || COLS).fill(null));

    const expandedBoard = [...newRows, ...board];
    gameState.board = expandedBoard;
    gameState.boardGrid = expandedBoard;

    // Update all locked pieces to account for new row offset
    if (gameState.lockedPieces && gameState.lockedPieces.length > 0) {
        gameState.lockedPieces.forEach((piece) => {
            // Update piece's y position (row)
            piece.y += rowsToAdd;

            // Update individual block positions if they exist
            if (piece.blocks) {
                piece.blocks.forEach((block) => {
                    block.row += rowsToAdd;
                });
            }
        });

        console.log(`[InfinityGrid] Updated ${gameState.lockedPieces.length} locked pieces`);
    }

    // Update current piece position
    if (gameState.currentPiece) {
        gameState.currentPiece.y += rowsToAdd;
        console.log(`[InfinityGrid] Updated current piece position to row ${gameState.currentPiece.y}`);
    }

    // Update ghost piece position if it exists
    if (gameState.ghostPiece) {
        gameState.ghostPiece.y += rowsToAdd;
    }

    // Invalidate board cache since grid size changed
    markBoardDirty(gameState);

    console.log('[InfinityGrid] Grid expansion complete');

    return true;
}

/**
 * Expands grid and invalidates cache in one operation
 * Convenience function that combines expansion with cache management
 *
 * @param {Object} gameState - Current game state
 * @param {number} requiredRows - Total rows needed
 * @returns {boolean} - True if expansion occurred
 */
export function expandGridAndInvalidateCache(gameState, requiredRows) {
    const expanded = expandGridIfNeeded(gameState, requiredRows);

    if (expanded) {
        // Cache is already invalidated in expandGridIfNeeded
        // This function exists for API consistency and future extensibility
        console.log('[InfinityGrid] Cache invalidated after expansion');
    }

    return expanded;
}

/**
 * Calculates the highest (topmost) row containing any blocks
 * This determines how high the player has built
 *
 * @param {Object} gameState - Current game state
 * @returns {number} - Row index of highest block (lower number = higher position)
 */
export function calculateTopRow(gameState) {
    if (!gameState || (!gameState.board && !gameState.boardGrid)) {
        return 0;
    }

    const board = gameState.board || gameState.boardGrid;
    let topRow = board.length; // Start with max (bottom)

    // Scan from top to bottom
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] !== null) {
                topRow = Math.min(topRow, r);
                break; // Found block in this row, move to next row
            }
        }
    }

    // If no blocks found, return bottom
    if (topRow === board.length) {
        return board.length - 1;
    }

    return topRow;
}

/**
 * Calculates the current height built (in rows from bottom)
 * This is the inverse of topRow - easier to understand for players
 *
 * @param {Object} gameState - Current game state
 * @returns {number} - Height in rows (0 = empty, higher = taller structure)
 */
export function calculateBuildHeight(gameState) {
    if (!gameState || (!gameState.board && !gameState.boardGrid)) {
        return 0;
    }

    const board = gameState.board || gameState.boardGrid;
    const topRow = calculateTopRow(gameState);
    const totalRows = board.length;

    // Height = distance from top block to bottom of grid
    return totalRows - topRow;
}

/**
 * Checks if player is approaching the top and needs expansion
 * Returns true if player is within threshold rows of the top
 *
 * @param {Object} gameState - Current game state
 * @param {number} threshold - How many rows from top to trigger expansion (default: 30)
 * @returns {boolean} - True if expansion should be triggered
 */
export function shouldExpandGrid(gameState, threshold = 30) {
    if (!gameState || !gameState.isInfinityMode) {
        return false;
    }

    // Already at max size
    if (gameState.board.length >= gameState.maxRows) {
        return false;
    }

    const topRow = calculateTopRow(gameState);

    // Within threshold rows of the top
    return topRow < threshold;
}

/**
 * Gets grid statistics for debugging/display
 *
 * @param {Object} gameState - Current game state
 * @returns {Object} - Grid statistics
 */
export function getGridStats(gameState) {
    if (!gameState || (!gameState.board && !gameState.boardGrid)) {
        return {
            totalRows: 0,
            topRow: 0,
            buildHeight: 0,
            blocksCount: 0,
            percentageFull: 0,
        };
    }

    const board = gameState.board || gameState.boardGrid;
    const topRow = calculateTopRow(gameState);
    const buildHeight = calculateBuildHeight(gameState);

    // Count total blocks
    let blocksCount = 0;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] !== null) {
                blocksCount++;
            }
        }
    }

    const totalCells = board.length * COLS;
    const percentageFull = (blocksCount / totalCells) * 100;

    return {
        totalRows: board.length,
        topRow,
        buildHeight,
        blocksCount,
        percentageFull: percentageFull.toFixed(2),
        maxRows: gameState.maxRows,
        canExpand: board.length < gameState.maxRows,
    };
}

/**
 * Check if game over condition is met for infinity mode
 * Different from standard mode - building above row 0 is expected!
 *
 * @param {Object} gameState - Current game state
 * @returns {boolean} - True if game over
 */
export function checkInfinityGameOver(gameState) {
    if (!gameState || !gameState.isInfinityMode) {
        return false;
    }

    // Game over condition 1: Hit the absolute top limit (row 0)
    const topRow = calculateTopRow(gameState);
    if (topRow <= 0) {
        console.log('[InfinityGrid] Game Over: Reached absolute top (row 0)');
        return true;
    }

    // Game over condition 2: Grid at max size and can't expand further
    // REMOVED: User requested to only die when hitting the absolute roof (row 0)
    // if (gameState.board.length >= gameState.maxRows && topRow < 10) {
    //     console.log('[InfinityGrid] Game Over: Max grid size reached and building too high');
    //     return true;
    // }

    // Game over condition 3: Can't spawn next piece at spawn position
    // This will be checked by the game loop when spawning pieces
    // (handled in InfinityMode.js spawn logic)

    return false;
}
