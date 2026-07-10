// @ts-check
// =================================================================================
// BOARD - Board management and collision detection for Serenity Blocks
// =================================================================================
//
// Grid contract: `BoardGrid` cells are the ambient `BoardCell` interface from
// core/types.d.ts — the same shape the MP snapshot mirrors over the wire.

import { COLS, ROWS, HIDDEN_ROWS } from './constants.js';

/** @typedef {Array<Array<BoardCell | null>>} BoardGrid */

/** @returns {BoardGrid} */
export function createBoardGrid() {
    return Array.from({ length: ROWS + HIDDEN_ROWS }, () => Array(COLS).fill(null));
}

export function clearBoardGrid(grid) {
    if (!grid) return;
    for (let y = 0; y < grid.length; y++) {
        grid[y].fill(null);
    }
}

export function cloneBoardGrid(grid) {
    if (!grid) return null;
    return grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

export function rebuildBoardGridFromPieces(pieces, targetGrid = createBoardGrid()) {
    clearBoardGrid(targetGrid);

    for (const piece of pieces) {
        const pieceId = piece.pieceId || piece.shapeKey;
        const color = piece.color || piece.shapeKey;
        const type = piece.type || piece.shapeKey; // Store piece type for themed rendering

        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const boardX = piece.x + x;
                    // CRITICAL: Floor the Y position to ensure integer indexing
                    const boardY = Math.floor(piece.y + y);

                    if (boardY >= 0 && boardY < targetGrid.length && boardX >= 0 && boardX < COLS) {
                        // Defensive check: ensure row exists
                        if (!targetGrid[boardY]) {
                            console.warn(`[Board] Row ${boardY} is undefined in targetGrid (length=${targetGrid.length}). Creating row.`);
                            targetGrid[boardY] = Array(COLS).fill(null);
                        }
                        targetGrid[boardY][boardX] = {
                            color,
                            id: pieceId,
                            type, // Add piece type for themed colors
                        };
                    }
                }
            });
        });
    }

    return targetGrid;
}

/**
 * PERFORMANCE: Incremental grid update - removes a piece from the grid without full rebuild
 * @param {Object} piece - The piece to remove from the grid
 * @param {Array<Array>} targetGrid - The grid to update
 */
export function removePieceFromGrid(piece, targetGrid) {
    if (!piece || !targetGrid) return;

    const pieceId = piece.pieceId || piece.shapeKey;

    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const boardX = piece.x + x;
                const boardY = piece.y + y;

                if (boardY >= 0 && boardY < targetGrid.length && boardX >= 0 && boardX < COLS) {
                    // Only clear if it's actually this piece
                    if (targetGrid[boardY][boardX] && targetGrid[boardY][boardX].id === pieceId) {
                        targetGrid[boardY][boardX] = null;
                    }
                }
            }
        });
    });
}

/**
 * PERFORMANCE: Incremental grid update - adds/updates a piece in the grid without full rebuild
 * @param {Object} piece - The piece to add to the grid
 * @param {Array<Array>} targetGrid - The grid to update
 */
export function addPieceToGrid(piece, targetGrid) {
    if (!piece || !targetGrid) return;

    const pieceId = piece.pieceId || piece.shapeKey;
    const color = piece.color || piece.shapeKey;
    const type = piece.type || piece.shapeKey;

    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const boardX = piece.x + x;
                const boardY = piece.y + y;

                if (boardY >= 0 && boardY < targetGrid.length && boardX >= 0 && boardX < COLS) {
                    targetGrid[boardY][boardX] = {
                        color,
                        id: pieceId,
                        type,
                    };
                }
            }
        });
    });
}

/**
 * PERFORMANCE: Incremental grid update - updates a piece's position in the grid
 * More efficient than remove + add when piece is just moving
 * @param {Object} piece - The piece to update
 * @param {number} oldY - Previous Y position
 * @param {Array<Array>} targetGrid - The grid to update
 */
export function updatePiecePositionInGrid(piece, oldY, targetGrid) {
    if (!piece || !targetGrid || oldY === piece.y) return;

    const pieceId = piece.pieceId || piece.shapeKey;
    const color = piece.color || piece.shapeKey;
    const type = piece.type || piece.shapeKey;

    // Remove from old position
    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const boardX = piece.x + x;
                const boardY = oldY + y;

                if (boardY >= 0 && boardY < targetGrid.length && boardX >= 0 && boardX < COLS) {
                    if (targetGrid[boardY][boardX] && targetGrid[boardY][boardX].id === pieceId) {
                        targetGrid[boardY][boardX] = null;
                    }
                }
            }
        });
    });

    // Add to new position
    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const boardX = piece.x + x;
                const boardY = piece.y + y;

                if (boardY >= 0 && boardY < targetGrid.length && boardX >= 0 && boardX < COLS) {
                    targetGrid[boardY][boardX] = {
                        color,
                        id: pieceId,
                        type,
                    };
                }
            }
        });
    });
}

/**
 * Generate a 2D board representation from locked pieces
 * @param {Array} pieces - Array of locked piece objects
 * @returns {Array} 2D array representing the board state
 */
export function generateBoard(pieces, options = {}) {
    const { boardGrid } = options;

    if (boardGrid) {
        return cloneBoardGrid(boardGrid);
    }

    return rebuildBoardGridFromPieces(pieces);
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
                const boardX = Math.floor(checkX + x);
                // CRITICAL: Floor Y position for proper collision detection
                const boardY = Math.floor(checkY + y);

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

    for (let y = HIDDEN_ROWS; y < boardData.length; y++) {
        if (boardData[y].every((cell) => cell !== null)) {
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
            cells.push({
                x,
                y,
                color: boardData[y][x].color,
                type: boardData[y][x].type || boardData[y][x].color,
            });

            // Check 4 adjacent cells
            stack.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]);
        }

        return cells;
    }

    for (let y = 0; y < boardData.length; y++) {
        for (let x = 0; x < COLS; x++) {
            const cell = boardData[y][x];
            if (cell && !visited[y][x]) {
                const cells = floodFill(y, x, cell.id);
                if (cells.length > 0) {
                    components.push({
                        cells,
                        pieceId: cell.id,
                        type: cell.type || cell.color,
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
