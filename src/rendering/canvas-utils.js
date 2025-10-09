/**
 * @fileoverview Canvas rendering utilities for Serenity Blocks
 * Handles grid cache generation, block drawing, and canvas styling
 */

import { COLS, ROWS, BLOCK_SIZE, HIDDEN_ROWS } from '../core/constants.js';

/**
 * Offscreen canvas for cached grid (performance optimization)
 * @type {HTMLCanvasElement|null}
 */
let gridCache = null;

/**
 * Context for the grid cache canvas
 * @type {CanvasRenderingContext2D|null}
 */
let gridCacheCtx = null;

/**
 * Last rendered level (for performance optimization)
 * @type {number}
 */
let lastRenderedLevel = 0;

/**
 * Generates a cached grid image to avoid redrawing it every frame
 * @param {HTMLCanvasElement} canvas - The game canvas
 * @returns {HTMLCanvasElement} The cached grid canvas
 */
export function generateGridCache(canvas) {
    // Create offscreen canvas for grid if it doesn't exist
    if (!gridCache) {
        gridCache = document.createElement('canvas');
        gridCacheCtx = gridCache.getContext('2d');
    }

    // Set cache canvas to match game canvas size
    gridCache.width = canvas.width;
    gridCache.height = canvas.height;

    // Draw grid lines onto cache
    gridCacheCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    gridCacheCtx.lineWidth = 1;

    // Draw vertical lines
    for (let x = 0; x <= COLS; x++) {
        gridCacheCtx.beginPath();
        gridCacheCtx.moveTo(x * BLOCK_SIZE, 0);
        gridCacheCtx.lineTo(x * BLOCK_SIZE, canvas.height);
        gridCacheCtx.stroke();
    }

    // Draw horizontal lines
    for (let y = 0; y <= ROWS; y++) {
        gridCacheCtx.beginPath();
        gridCacheCtx.moveTo(0, y * BLOCK_SIZE);
        gridCacheCtx.lineTo(canvas.width, y * BLOCK_SIZE);
        gridCacheCtx.stroke();
    }

    return gridCache;
}

/**
 * Gets the cached grid canvas
 * @returns {HTMLCanvasElement|null} The cached grid canvas
 */
export function getGridCache() {
    return gridCache;
}

/**
 * Clears the grid cache
 */
export function clearGridCache() {
    gridCache = null;
    gridCacheCtx = null;
}

/**
 * Updates canvas border and shadow based on current level
 * @param {HTMLCanvasElement} canvas - The game canvas
 * @param {number} level - Current game level
 */
export function updateCanvasStyle(canvas, level) {
    if (level >= 10) {
        canvas.style.borderColor = '#ef4444';
        canvas.style.boxShadow = '0 0 30px rgba(239, 68, 68, 0.6), 0 0 60px rgba(239, 68, 68, 0.4)';
    } else if (level >= 5) {
        canvas.style.borderColor = '#fbbf24';
        canvas.style.boxShadow = '0 0 30px rgba(251, 191, 36, 0.6), 0 0 60px rgba(251, 191, 36, 0.4)';
    } else {
        canvas.style.borderColor = '#8b5cf6';
        canvas.style.boxShadow = '0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.3)';
    }
    lastRenderedLevel = level;
}

/**
 * Gets the last rendered level
 * @returns {number} Last rendered level
 */
export function getLastRenderedLevel() {
    return lastRenderedLevel;
}

/**
 * Draws a single block with borders
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X coordinate (in grid units)
 * @param {number} y - Y coordinate (in grid units)
 * @param {string} color - Block color
 * @param {Array<Array>|null} boardData - Board data for border detection
 * @param {boolean} isGhost - Whether this is a ghost piece
 * @param {Array<Array>|null} shape - Piece shape for border detection
 * @param {number} pieceX - Piece X position (for shape-based borders)
 * @param {number} pieceY - Piece Y position (for shape-based borders)
 * @param {number} blockX - Block X position within shape
 * @param {number} blockY - Block Y position within shape
 */
export function drawBlock(
    ctx,
    x,
    y,
    color,
    boardData = null,
    isGhost = false,
    shape = null,
    pieceX = 0,
    pieceY = 0,
    blockX = 0,
    blockY = 0
) {
    // Draw the block
    ctx.fillStyle = color;
    ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

    // Draw borders (skip for ghost pieces)
    if (!isGhost) {
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 2;

        if (shape) {
            // Shape-based border detection (for current piece)
            // Top border
            if (blockY === 0 || !shape[blockY - 1] || !shape[blockY - 1][blockX]) {
                ctx.beginPath();
                ctx.moveTo(x * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo((x + 1) * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.stroke();
            }
            // Bottom border
            if (blockY === shape.length - 1 || !shape[blockY + 1] || !shape[blockY + 1][blockX]) {
                ctx.beginPath();
                ctx.moveTo(x * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.lineTo((x + 1) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
            // Left border
            if (blockX === 0 || !shape[blockY][blockX - 1]) {
                ctx.beginPath();
                ctx.moveTo(x * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo(x * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
            // Right border
            if (blockX === shape[blockY].length - 1 || !shape[blockY][blockX + 1]) {
                ctx.beginPath();
                ctx.moveTo((x + 1) * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo((x + 1) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
        } else if (boardData) {
            // Board-based border detection (for locked pieces)
            const by = y + HIDDEN_ROWS;
            const currentCell = boardData[by] ? boardData[by][blockX] : null;
            const currentId = currentCell ? currentCell.id : null;

            // Top border
            if (by === 0 || !boardData[by - 1] || boardData[by - 1][blockX] === null ||
                boardData[by - 1][blockX].id !== currentId) {
                ctx.beginPath();
                ctx.moveTo(blockX * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo((blockX + 1) * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.stroke();
            }
            // Bottom border
            if (by === boardData.length - 1 || !boardData[by + 1] ||
                boardData[by + 1][blockX] === null || boardData[by + 1][blockX].id !== currentId) {
                ctx.beginPath();
                ctx.moveTo(blockX * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.lineTo((blockX + 1) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
            // Left border
            if (blockX === 0 || boardData[by][blockX - 1] === null ||
                boardData[by][blockX - 1].id !== currentId) {
                ctx.beginPath();
                ctx.moveTo(blockX * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo(blockX * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
            // Right border
            if (blockX === boardData[by].length - 1 || boardData[by][blockX + 1] === null ||
                boardData[by][blockX + 1].id !== currentId) {
                ctx.beginPath();
                ctx.moveTo((blockX + 1) * BLOCK_SIZE, y * BLOCK_SIZE);
                ctx.lineTo((blockX + 1) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE);
                ctx.stroke();
            }
        }
    }
}

/**
 * Draws a ghost piece (preview of where piece will land)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} piece - Current piece
 * @param {number} ghostY - Y position where ghost should be drawn
 */
/**
 * Calculates pulsing opacity for ghost piece (Tetris Effect-inspired)
 * @returns {number} Opacity value between 0.2 and 0.35
 */
function getGhostPulseOpacity() {
    // 2-second cycle for gentle breathing effect
    const time = Date.now() / 1000;
    const cycle = (Math.sin(time * Math.PI) + 1) / 2; // 0 to 1
    return 0.2 + (cycle * 0.15); // 0.2 to 0.35
}

export function drawGhostPiece(ctx, piece, ghostY) {
    const opacity = getGhostPulseOpacity();

    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0 && ghostY + y >= HIDDEN_ROWS) {
                const blockX = piece.x + x;
                const blockY = ghostY + y - HIDDEN_ROWS;

                // Draw main ghost block with pulsing opacity
                ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                ctx.fillRect(
                    blockX * BLOCK_SIZE,
                    blockY * BLOCK_SIZE,
                    BLOCK_SIZE,
                    BLOCK_SIZE
                );

                // Add subtle cyan glow on edges for Tetris Effect feel
                ctx.strokeStyle = `rgba(100, 200, 255, ${opacity * 0.6})`;
                ctx.lineWidth = 1;
                ctx.strokeRect(
                    blockX * BLOCK_SIZE,
                    blockY * BLOCK_SIZE,
                    BLOCK_SIZE,
                    BLOCK_SIZE
                );
            }
        });
    });
}
