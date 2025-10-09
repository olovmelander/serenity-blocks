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
                // Cleared block with alpha transparency for smooth fade effect
                const alpha = cell.alpha !== undefined ? cell.alpha : 1.0;
                ctx.save();
                ctx.globalAlpha = alpha;
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
                ctx.restore();
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
 * Triggers the line clear flash effect on specific rows
 * Tetris Effect-inspired: particles, prismatic waves, and energy bursts
 * @param {Array<number>} clearedRows - Array of Y coordinates of cleared rows
 */
export function triggerLineClearFlash(clearedRows = []) {
    const container = document.getElementById('line-clear-flash');
    if (!container) return;

    // Clear any existing flashes
    container.innerHTML = '';

    // Create a flash element for each cleared row
    clearedRows.forEach((rowY, index) => {
        const flashBar = document.createElement('div');
        flashBar.className = 'line-flash-bar';

        // Position the flash bar at the specific row
        const rowHeight = BLOCK_SIZE;
        const topPosition = (rowY - HIDDEN_ROWS) * rowHeight;

        flashBar.style.top = `${topPosition}px`;
        flashBar.style.height = `${rowHeight}px`;

        // Stagger animation slightly for multiple lines (Tetris Effect technique)
        const staggerDelay = index * 20;
        flashBar.style.animationDelay = `${staggerDelay}ms`;

        container.appendChild(flashBar);

        // Add particle burst effect (Tetris Effect signature)
        createParticleBurst(container, topPosition, rowHeight, staggerDelay);

        // Trigger animation
        setTimeout(() => {
            flashBar.classList.add('active');
        }, 10 + staggerDelay);

        // Remove after animation completes
        setTimeout(() => {
            if (flashBar.parentNode === container) {
                container.removeChild(flashBar);
            }
        }, 600 + staggerDelay);
    });

    // Add center radial burst for multi-line clears (Tetris Effect style)
    if (clearedRows.length >= 2) {
        createRadialBurst(container, clearedRows);
    }
}

/**
 * Creates a particle burst effect from a cleared line
 * Inspired by Tetris Effect's explosive particle systems
 */
function createParticleBurst(container, topPosition, rowHeight, delay) {
    const particleCount = 12;
    const centerY = topPosition + rowHeight / 2;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'line-particle';

        // Position at center of line
        particle.style.top = `${centerY}px`;
        particle.style.left = `${50}%`;

        // Random angle for particle trajectory
        const angle = (Math.PI / 3) + (i / particleCount) * (Math.PI / 1.5);
        const distance = 50 + Math.random() * 50;
        const endX = Math.cos(angle) * distance;
        const endY = Math.sin(angle) * distance * (Math.random() > 0.5 ? 1 : -1);

        particle.style.setProperty('--tx', `${endX}px`);
        particle.style.setProperty('--ty', `${endY}px`);

        // Color variation for prismatic effect
        const hue = (i / particleCount) * 60 + 180; // Cyan to blue range
        particle.style.setProperty('--particle-hue', hue);

        particle.style.animationDelay = `${delay}ms`;

        container.appendChild(particle);

        setTimeout(() => {
            if (particle.parentNode === container) {
                container.removeChild(particle);
            }
        }, 500 + delay);
    }
}

/**
 * Creates a radial energy burst for multi-line clears
 * Tetris Effect-style expanding ring effect
 */
function createRadialBurst(container, clearedRows) {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    // Calculate center point of cleared lines
    const avgRow = clearedRows.reduce((a, b) => a + b, 0) / clearedRows.length;
    const centerY = (avgRow - HIDDEN_ROWS) * BLOCK_SIZE + (BLOCK_SIZE / 2);

    const burst = document.createElement('div');
    burst.className = 'radial-burst';
    burst.style.top = `${centerY}px`;
    burst.style.left = '50%';

    // More intense burst for 4-line clears
    if (clearedRows.length >= 4) {
        burst.classList.add('intense');
    }

    container.appendChild(burst);

    setTimeout(() => {
        if (burst.parentNode === container) {
            container.removeChild(burst);
        }
    }, 600);
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
