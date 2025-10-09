/**
 * @fileoverview Physics and line clearing system for Serenity Blocks
 * Handles multi-phase physics processing including line detection, clearing,
 * gravity application, and cascade checking.
 */

import { COLS, SCORE_VALUES, LEVEL_SPEEDS } from './constants.js';
import { generateBoard } from './board.js';

/**
 * Determines if a specific board position is part of a given piece
 * @param {number} boardX - X coordinate on the board
 * @param {number} boardY - Y coordinate on the board
 * @param {Object} piece - The piece to check against
 * @returns {boolean} True if the position is part of the piece
 */
export function isPartOfPiece(boardX, boardY, piece) {
    const localX = boardX - piece.x;
    const localY = boardY - piece.y;
    if (localY >= 0 && localY < piece.shape.length &&
        localX >= 0 && localX < piece.shape[0].length) {
        return piece.shape[localY][localX] > 0;
    }
    return false;
}

/**
 * Splits the board into connected components (individual blocks or clusters)
 * Uses flood fill algorithm to find connected blocks with the same ID
 * @param {Array<Array>} boardData - The current board state
 * @returns {Array<Object>} Array of piece objects representing connected components
 */
export function findConnectedComponents(boardData) {
    const pieces = [];
    const visited = Array.from({ length: boardData.length }, () =>
        Array(boardData[0].length).fill(false)
    );

    for (let r = 0; r < boardData.length; r++) {
        for (let c = 0; c < boardData[0].length; c++) {
            if (boardData[r][c] !== null && !visited[r][c]) {
                const cellData = boardData[r][c];
                const component = [];
                const queue = [[r, c]];
                visited[r][c] = true;

                let minR = r, maxR = r, minC = c, maxC = c;

                // Flood fill to find all connected blocks
                while (queue.length > 0) {
                    const [row, col] = queue.shift();
                    component.push({ r: row, c: col });

                    minR = Math.min(minR, row);
                    maxR = Math.max(maxR, row);
                    minC = Math.min(minC, col);
                    maxC = Math.max(maxC, col);

                    // Check 4 adjacent cells (up, down, left, right)
                    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
                        const nr = row + dr;
                        const nc = col + dc;
                        if (nr >= 0 && nr < boardData.length &&
                            nc >= 0 && nc < boardData[0].length &&
                            !visited[nr][nc] &&
                            boardData[nr][nc] !== null &&
                            boardData[nr][nc].id === cellData.id) {
                            visited[nr][nc] = true;
                            queue.push([nr, nc]);
                        }
                    });
                }

                // Create shape array for this component
                const shape = Array.from({ length: maxR - minR + 1 }, () =>
                    Array(maxC - minC + 1).fill(0)
                );
                component.forEach(({ r, c }) => {
                    shape[r - minR][c - minC] = 1;
                });

                pieces.push({
                    x: minC,
                    y: minR,
                    shape,
                    shapeKey: cellData.color,
                    color: cellData.color, // Will need COLORS mapping from constants
                    pieceId: cellData.id
                });
            }
        }
    }

    return pieces;
}

/**
 * Applies gravity to blocks after line clears, making them fall independently
 * Uses smooth animation with variable speed based on fall distance
 * @param {Array<Object>} lockedPieces - Array of locked pieces (modified in place)
 * @param {Function} drawCallback - Function to call for visual updates
 * @returns {Promise<void>} Resolves when all blocks have settled
 */
export async function applyGravity(lockedPieces, drawCallback) {
    let blocksStillFalling = true;

    while (blocksStillFalling) {
        blocksStillFalling = false;
        const currentBoard = generateBoard(lockedPieces);

        // Process blocks from bottom to top to prevent double-processing
        lockedPieces.sort((a, b) => (b.y + b.shape.length) - (a.y + a.shape.length));

        for (const piece of lockedPieces) {
            let canFall = true;

            // Check if this entire block cluster can fall one row
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        const boardX = piece.x + localX;
                        const boardY = piece.y + localY + 1; // Check one row below

                        // Check boundaries
                        if (boardY >= currentBoard.length) {
                            canFall = false;
                            return;
                        }

                        // Check if there's a block below that's NOT part of this piece
                        if (currentBoard[boardY][boardX] !== null &&
                            !isPartOfPiece(boardX, boardY, piece)) {
                            canFall = false;
                            return;
                        }
                    }
                });
            });

            if (canFall) {
                piece.y++;
                blocksStillFalling = true;
            }
        }

        // Smoother visual feedback for falling blocks with faster animation
        if (blocksStillFalling && drawCallback) {
            drawCallback();
            await new Promise(resolve => setTimeout(resolve, 25)); // Reduced from 50ms for smoother motion
        }
    }
}

/**
 * Detects all complete lines on the board
 * @param {Array<Array>} boardData - The current board state
 * @returns {Array<number>} Array of Y coordinates of full lines
 */
export function detectFullLines(boardData) {
    const fullLines = [];
    for (let y = boardData.length - 1; y >= 0; y--) {
        if (boardData[y].every(cell => cell !== null)) {
            fullLines.push(y);
        }
    }
    return fullLines;
}

/**
 * Removes cleared lines from locked pieces
 * @param {Array<Object>} lockedPieces - Array of locked pieces
 * @param {Array<number>} fullLines - Y coordinates of lines to remove
 * @returns {Array<Object>} New array of pieces with cleared lines removed
 */
export function removeClearedLines(lockedPieces, fullLines) {
    const newPieces = [];

    lockedPieces.forEach(p => {
        const newShape = [];
        p.shape.forEach((row, localY) => {
            const globalY = p.y + localY;
            if (!fullLines.includes(globalY)) {
                newShape.push(row);
            }
        });

        if (newShape.length > 0) {
            p.shape = newShape;
            newPieces.push(p);
        }
    });

    return newPieces;
}

/**
 * Main physics processing loop
 * Handles line detection, clearing, gravity, and cascading in multiple phases
 * Enhanced with smooth transitions and optimized timing for seamless cascades
 *
 * @param {Object} gameState - Game state object containing:
 *   - lockedPieces: Array of locked pieces (modified in place)
 *   - level: Current game level
 *   - lines: Total lines cleared
 *   - linesUntilNextLevel: Lines needed for next level
 *   - score: Current score
 * @param {Object} callbacks - Callback functions:
 *   - draw: Function to redraw the game board
 *   - onLevelUp: Function called when level increases (level)
 *   - onScoreAdd: Function called when score increases (points)
 *   - onLineClear: Function called when lines are cleared (count)
 *   - updateBoard: Function to update the visible board (boardData)
 *   - playLineClear: Sound effect for line clear
 *   - playLevelUp: Sound effect for level up
 *   - updateBackground: Function to update background theme (level)
 *   - spawnPiece: Function to spawn next piece
 *   - triggerCombo: Function called when a cascade combo occurs (comboCount)
 * @returns {Promise<void>} Resolves when all physics processing is complete
 */
export async function processPhysics(gameState, callbacks) {
    let linesClearedThisTurn = 0;
    let cascadeCount = 0; // Track number of cascades for combo timing

    while (true) {
        // Phase 1: Line detection and clearing
        const boardData = generateBoard(gameState.lockedPieces);
        const fullLines = detectFullLines(boardData);

        if (fullLines.length === 0) {
            break; // No more lines to clear, physics are stable
        }

        cascadeCount++;

        if (cascadeCount >= 2 && callbacks.triggerCombo) {
            callbacks.triggerCombo(cascadeCount);
        }

        // --- Line Clear Animation and Scoring ---
        linesClearedThisTurn += fullLines.length;
        const oldLevel = gameState.level;
        gameState.lines += fullLines.length;
        gameState.linesUntilNextLevel -= fullLines.length;

        if (gameState.linesUntilNextLevel <= 0) {
            gameState.level++;
            gameState.linesUntilNextLevel += 10; // Use += in case of multi-level-up
            gameState.dropInterval = LEVEL_SPEEDS[Math.min(gameState.level - 1, LEVEL_SPEEDS.length - 1)];

            if (callbacks.playLevelUp) callbacks.playLevelUp();
            if (callbacks.onLevelUp) callbacks.onLevelUp(gameState.level);
        }

        if (oldLevel !== gameState.level && callbacks.updateBackground) {
            callbacks.updateBackground(gameState.level);
        }

        const points = (SCORE_VALUES[fullLines.length] || SCORE_VALUES[4]) * gameState.level;
        gameState.score += points;

        if (callbacks.playLineClear) callbacks.playLineClear();
        if (callbacks.onScoreAdd) callbacks.onScoreAdd(points);
        if (callbacks.triggerFlash) callbacks.triggerFlash(fullLines);
        if (callbacks.triggerBackgroundPulse) callbacks.triggerBackgroundPulse(fullLines.length);

        // --- Enhanced Visual Feedback with Smooth Fade Animation ---
        // Multi-stage flash effect for smoother, faster transition
        // Timing gets progressively faster for cascades to maintain momentum
        const markedBoard = generateBoard(gameState.lockedPieces);

        // Speed multiplier: first clear is normal, cascades get 30% faster
        const speedMultiplier = cascadeCount === 1 ? 1.0 : 0.7;

        // Stage 1: Bright white flash - snappier feel
        fullLines.forEach(y => {
            for (let x = 0; x < COLS; x++) {
                markedBoard[y][x] = { color: 'C', id: 'cleared', alpha: 1.0 };
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await new Promise(resolve => setTimeout(resolve, 80 * speedMultiplier));

        // Stage 2: Slightly dimmed - reduced timing for smoother flow
        fullLines.forEach(y => {
            for (let x = 0; x < COLS; x++) {
                markedBoard[y][x] = { color: 'C', id: 'cleared', alpha: 0.6 };
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await new Promise(resolve => setTimeout(resolve, 40 * speedMultiplier));

        // Stage 3: Fade to transparent - quick final fade
        fullLines.forEach(y => {
            for (let x = 0; x < COLS; x++) {
                markedBoard[y][x] = { color: 'C', id: 'cleared', alpha: 0.2 };
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await new Promise(resolve => setTimeout(resolve, 30 * speedMultiplier));

        // --- Remove cleared lines from pieces ---
        gameState.lockedPieces = removeClearedLines(gameState.lockedPieces, fullLines);

        // Split pieces into individual blocks for independent gravity
        gameState.lockedPieces = findConnectedComponents(generateBoard(gameState.lockedPieces));

        // Phase 2: Apply gravity to individual blocks
        await applyGravity(gameState.lockedPieces, callbacks.draw);

        // Phase 3: Recursive cascade - continue the loop to check for new lines
        // The while(true) loop will automatically check for new complete lines
    }

    // --- Finalize ---
    // Note: spawnPiece should be called AFTER isProcessingPhysics is set to false
    // to avoid input blocking issues
}
