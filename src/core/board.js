// =================================================================================
// BOARD - Board management and collision detection for Serenity Blocks
// =================================================================================

import { COLS, ROWS, HIDDEN_ROWS } from './constants.js';

/**
 * Generate a 2D board representation from locked pieces
 * @param {Array} pieces - Array of locked piece objects
 * @returns {Array} 2D array representing the board state
 */
export function generateBoard(pieces) {
    const board = Array.from({ length: ROWS + HIDDEN_ROWS }, () => Array(COLS).fill(null));

    for (const piece of pieces) {
        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const boardX = piece.x + x;
                    const boardY = piece.y + y;

                    if (boardY >= 0 && boardY < board.length && boardX >= 0 && boardX < COLS) {
                        board[boardY][boardX] = {
                            color: piece.shapeKey,
                            id: piece.pieceId || piece.shapeKey,
                        };
                    }
                }
            });
        });
    }

    return board;
}

/**
 * Check if a piece position is valid (no collisions)
 * @param {Object} piece - Piece to check
 * @param {number} checkX - X position to check
 * @param {number} checkY - Y position to check
 * @param {Array} lockedPieces - Array of locked pieces
 * @returns {boolean} True if position is valid
 */
export function isValidPosition(piece, checkX, checkY, lockedPieces) {
    const boardData = generateBoard(lockedPieces);

    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] > 0) {
                const boardX = checkX + x;
                const boardY = checkY + y;

                // Check boundaries
                if (boardX < 0 || boardX >= COLS || boardY >= boardData.length) {
                    return false;
                }

                // Check collision with locked pieces
                if (boardData[boardY] && boardData[boardY][boardX] !== null) {
                    return false;
                }
            }
        }
    }

    return true;
}

/**
 * Check if a board position is part of a specific piece
 * @param {number} boardX - Board X coordinate
 * @param {number} boardY - Board Y coordinate
 * @param {Object} piece - Piece to check against
 * @returns {boolean} True if position is part of the piece
 */
export function isPartOfPiece(boardX, boardY, piece) {
    const relX = boardX - piece.x;
    const relY = boardY - piece.y;

    if (relY >= 0 && relY < piece.shape.length && relX >= 0 && relX < piece.shape[relY].length) {
        return piece.shape[relY][relX] > 0;
    }

    return false;
}

/**
 * Find complete (filled) lines on the board
 * @param {Array} boardData - 2D board array
 * @returns {Array} Array of line indices that are complete
 */
export function findCompleteLines(boardData) {
    const completeLines = [];

    for (let y = 0; y < boardData.length; y++) {
        if (boardData[y].every(cell => cell !== null)) {
            completeLines.push(y);
        }
    }

    return completeLines;
}

/**
 * Find connected components (groups of touching blocks) on the board
 * Used for gravity physics after line clears
 * @param {Array} boardData - 2D board array
 * @returns {Array} Array of component objects with cells and pieceIds
 */
export function findConnectedComponents(boardData) {
    const visited = Array.from({ length: boardData.length }, () => Array(COLS).fill(false));
    const components = [];

    function floodFill(startY, startX, pieceId) {
        const stack = [[startY, startX]];
        const cells = [];

        while (stack.length > 0) {
            const [y, x] = stack.pop();

            if (y < 0 || y >= boardData.length || x < 0 || x >= COLS) continue;
            if (visited[y][x]) continue;
            if (!boardData[y][x] || boardData[y][x].id !== pieceId) continue;

            visited[y][x] = true;
            cells.push({ x, y, color: boardData[y][x].color });

            // Check 4 adjacent cells
            stack.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]);
        }

        return cells;
    }

    for (let y = 0; y < boardData.length; y++) {
        for (let x = 0; x < COLS; x++) {
            if (boardData[y][x] && !visited[y][x]) {
                const cells = floodFill(y, x, boardData[y][x].id);
                if (cells.length > 0) {
                    components.push({
                        cells,
                        pieceId: boardData[y][x].id,
                    });
                }
            }
        }
    }

    return components;
}

/**
 * Create an empty board
 * @returns {Array} Empty 2D board array
 */
export function createEmptyBoard() {
    return Array.from({ length: ROWS + HIDDEN_ROWS }, () => Array(COLS).fill(null));
}

/**
 * Check if any blocks are above the visible play area (game over condition)
 * @param {Array} lockedPieces - Array of locked pieces
 * @returns {boolean} True if blocks exist above visible area
 */
export function hasBlocksAbovePlayfield(lockedPieces) {
    for (const piece of lockedPieces) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x] > 0) {
                    const boardY = piece.y + y;
                    if (boardY < HIDDEN_ROWS) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/**
 * Get the highest occupied row on the board
 * @param {Array} lockedPieces - Array of locked pieces
 * @returns {number} Highest row index with a block (-1 if board is empty)
 */
export function getHighestOccupiedRow(lockedPieces) {
    let highest = -1;

    for (const piece of lockedPieces) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x] > 0) {
                    const boardY = piece.y + y;
                    if (highest === -1 || boardY < highest) {
                        highest = boardY;
                    }
                }
            }
        }
    }

    return highest;
}
