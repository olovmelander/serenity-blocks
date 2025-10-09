/**
 * @fileoverview Main drawing logic for Serenity Blocks
 * Handles rendering of the game board, pieces, and next pieces
 */

import { COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE, SHAPES, COLORS } from '../core/constants.js';
import { generateBoard } from '../core/board.js';
import { isValidPosition } from '../core/board.js';
import {
    getGridCache,
    drawBlock,
    drawGhostPiece,
    updateCanvasStyle,
    getLastRenderedLevel
} from './canvas-utils.js';

/**
 * Main draw function - renders the entire game state
 * @param {HTMLCanvasElement} canvas - The game canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} gameState - Current game state containing:
 *   - lockedPieces: Array of locked pieces
 *   - currentPiece: Currently falling piece
 *   - level: Current level (for canvas styling)
 */
export function draw(canvas, ctx, gameState) {
    const { lockedPieces, currentPiece, level } = gameState;

    // Only update canvas styles when level changes (performance optimization)
    if (level !== getLastRenderedLevel()) {
        updateCanvasStyle(canvas, level);
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use cached grid instead of redrawing it every frame
    const gridCache = getGridCache();
    if (gridCache) {
        ctx.drawImage(gridCache, 0, 0);
    }

    // Draw locked pieces
    const boardData = generateBoard(lockedPieces);
    boardData.forEach((row, y) => {
        if (y < HIDDEN_ROWS) return; // Skip hidden rows

        row.forEach((cell, x) => {
            if (cell !== null && cell.color !== 'C') {
                // Normal block
                drawBlock(
                    ctx,
                    x,
                    y - HIDDEN_ROWS,
                    COLORS[cell.color],
                    boardData,
                    false,
                    null,
                    0,
                    0,
                    x,
                    y
                );
            } else if (cell !== null && cell.color === 'C') {
                // Cleared block (white flash)
                drawBlock(
                    ctx,
                    x,
                    y - HIDDEN_ROWS,
                    '#ffffff',
                    boardData,
                    false,
                    null,
                    0,
                    0,
                    x,
                    y
                );
            }
        });
    });

    // Draw current piece with ghost
    if (currentPiece) {
        // Calculate ghost position
        let ghostY = currentPiece.y;
        while (isValidPosition(currentPiece, currentPiece.x, ghostY + 1, lockedPieces)) {
            ghostY++;
        }

        // Draw ghost piece first (so it appears behind the actual piece)
        drawGhostPiece(ctx, currentPiece, ghostY);

        // Draw current piece
        currentPiece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0 && currentPiece.y + y >= HIDDEN_ROWS) {
                    drawBlock(
                        ctx,
                        currentPiece.x + x,
                        currentPiece.y + y - HIDDEN_ROWS,
                        currentPiece.color,
                        null,
                        false,
                        currentPiece.shape,
                        currentPiece.x,
                        currentPiece.y - HIDDEN_ROWS,
                        x,
                        y
                    );
                }
            });
        });
    }
}

/**
 * Draws the next pieces in their preview canvases
 * @param {Array<HTMLCanvasElement>} nextCanvases - Array of canvas elements for next pieces
 * @param {Array<string>} nextPieces - Array of next piece keys (e.g., 'I', 'O', 'T')
 */
export function drawNextPieces(nextCanvases, nextPieces) {
    nextCanvases.forEach((canv, idx) => {
        const ctx = canv.getContext('2d');
        ctx.clearRect(0, 0, canv.width, canv.height);

        if (nextPieces[idx]) {
            const shape = SHAPES[nextPieces[idx]];
            const color = COLORS[nextPieces[idx]];

            // Scale blocks based on which preview (first is larger)
            const blockSize = BLOCK_SIZE * (idx === 0 ? 0.4 : 0.33);

            // Center the shape in the canvas
            const offsetX = (canv.width - shape[0].length * blockSize) / 2;
            const offsetY = (canv.height - shape.length * blockSize) / 2;

            shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        // Draw block
                        ctx.fillStyle = color;
                        ctx.fillRect(
                            offsetX + x * blockSize,
                            offsetY + y * blockSize,
                            blockSize,
                            blockSize
                        );

                        // Add highlight for first piece (most prominent)
                        if (idx === 0) {
                            const highlightSize = Math.max(1, blockSize / 4);
                            const highlightOffset = Math.max(1, blockSize / 12);
                            ctx.fillStyle = 'rgba(255,255,255,0.3)';
                            ctx.fillRect(
                                offsetX + x * blockSize + highlightOffset,
                                offsetY + y * blockSize + highlightOffset,
                                highlightSize,
                                highlightSize
                            );
                        }

                        // Draw border
                        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                        ctx.lineWidth = Math.max(0.5, blockSize / 15);
                        ctx.strokeRect(
                            offsetX + x * blockSize,
                            offsetY + y * blockSize,
                            blockSize,
                            blockSize
                        );
                    }
                });
            });
        }
    });
}

/**
 * Shows a score popup notification
 * @param {number} points - Points to display
 */
export function showScorePopup(points) {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = `+${points}`;
    el.style.left = '50%';
    el.style.top = '50%';

    const container = document.getElementById('score-popups');
    container.appendChild(el);

    setTimeout(() => container.removeChild(el), 1000);
}

/**
 * Shows a level up notification
 * @param {number} level - New level number
 */
export function showLevelUpNotification(level) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: absolute;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-family: 'Orbitron', sans-serif;
        font-size: 32px;
        font-weight: 900;
        color: #fbbf24;
        text-shadow: 0 0 20px rgba(251, 191, 36, 0.8);
        animation: levelUp 1.5s ease-out forwards;
        pointer-events: none;
        z-index: 100;
    `;
    notification.textContent = `LEVEL ${level}!`;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes levelUp {
            0% {
                transform: translate(-50%, -50%) scale(0.5);
                opacity: 0;
            }
            50% {
                transform: translate(-50%, -50%) scale(1.2);
                opacity: 1;
            }
            100% {
                transform: translate(-50%, -200%) scale(1);
                opacity: 0;
            }
        }
    `;

    document.head.appendChild(style);
    const container = document.getElementById('score-popups');
    container.appendChild(notification);

    setTimeout(() => {
        container.removeChild(notification);
        document.head.removeChild(style);
    }, 1500);
}

/**
 * Updates the stats display
 * @param {Object} stats - Game statistics:
 *   - score: Current score
 *   - lines: Lines cleared
 *   - level: Current level
 *   - linesUntilNextLevel: Lines needed for next level
 *   - startTime: Game start timestamp
 *   - piecesPlaced: Total pieces placed
 */
export function updateStats(stats) {
    const { score, lines, level, linesUntilNextLevel, startTime, piecesPlaced } = stats;

    document.getElementById('score').textContent = score;
    document.getElementById('lines').textContent = lines;

    const levelEl = document.getElementById('level');
    levelEl.textContent = level;
    levelEl.className = 'stat-value';
    if (level >= 10) levelEl.classList.add('danger');
    else if (level >= 5) levelEl.classList.add('warning');

    document.getElementById('next-level').textContent = linesUntilNextLevel;

    // Speed multiplier
    const LEVEL_SPEEDS = [1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60, 50];
    const baseSpeed = LEVEL_SPEEDS[0];
    const currentSpeed = LEVEL_SPEEDS[Math.min(level - 1, LEVEL_SPEEDS.length - 1)];
    const speedMultiplier = (baseSpeed / currentSpeed).toFixed(1);

    const speedEl = document.getElementById('speed');
    speedEl.textContent = `${speedMultiplier}x`;
    speedEl.className = 'stat-value';
    if (parseFloat(speedMultiplier) >= 20) speedEl.classList.add('danger');
    else if (parseFloat(speedMultiplier) >= 5) speedEl.classList.add('warning');

    // BPM (Blocks Per Minute)
    const elapsedMinutes = (Date.now() - startTime) / 60000;
    const bpm = elapsedMinutes > 0 ? Math.floor(piecesPlaced * 4 / elapsedMinutes) : 0;
    document.getElementById('bpm').textContent = bpm;
}
