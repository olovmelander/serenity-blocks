/**
 * @fileoverview Canvas rendering utilities for Serenity Blocks
 * Handles grid cache generation, block drawing, and canvas styling
 */

import {
    COLS, ROWS, BLOCK_SIZE, HIDDEN_ROWS,
} from '../core/constants.js';

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

const BLOCK_SHADOW_BASE_BLUR = 6;
const BLOCK_SHADOW_VARIATION = 6;
const PULSE_SPEED = 0.005; // Controls speed of pulsing shadow (radians per ms)
const POSITION_PHASE_SHIFT = 0.45; // Phase offset between neighboring blocks

function clampColorComponent(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function parseColorToRgb(color) {
    if (!color || typeof color !== 'string') {
        return null;
    }

    let value = color.trim();

    if (value.startsWith('#')) {
        value = value.slice(1);
        if (value.length === 3) {
            value = value
                .split('')
                .map((char) => char + char)
                .join('');
        }
        if (value.length !== 6) {
            return null;
        }

        const r = parseInt(value.substring(0, 2), 16);
        const g = parseInt(value.substring(2, 4), 16);
        const b = parseInt(value.substring(4, 6), 16);

        if ([r, g, b].some((component) => Number.isNaN(component))) {
            return null;
        }

        return { r, g, b };
    }

    const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        return {
            r: clampColorComponent(Number(rgbMatch[1])),
            g: clampColorComponent(Number(rgbMatch[2])),
            b: clampColorComponent(Number(rgbMatch[3])),
        };
    }

    return null;
}

function colorToCss(rgb, alpha = 1) {
    if (!rgb) {
        return null;
    }
    return `rgba(${clampColorComponent(rgb.r)}, ${clampColorComponent(rgb.g)}, ${clampColorComponent(rgb.b)}, ${alpha})`;
}

function lightenRgb(rgb, amount) {
    return {
        r: clampColorComponent(rgb.r + (255 - rgb.r) * amount),
        g: clampColorComponent(rgb.g + (255 - rgb.g) * amount),
        b: clampColorComponent(rgb.b + (255 - rgb.b) * amount),
    };
}

function darkenRgb(rgb, amount) {
    return {
        r: clampColorComponent(rgb.r * (1 - amount)),
        g: clampColorComponent(rgb.g * (1 - amount)),
        b: clampColorComponent(rgb.b * (1 - amount)),
    };
}

function getPulseIntensity(gridX, gridY) {
    const timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const phase = timestamp * PULSE_SPEED + (gridX + gridY) * POSITION_PHASE_SHIFT;
    return 0.5 + 0.5 * Math.sin(phase);
}

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
    blockY = 0,
) {
    const size = BLOCK_SIZE;
    const visibleY = y - HIDDEN_ROWS;
    if (visibleY < 0 || visibleY >= ROWS) {
        return;
    }

    // Use Math.round to ensure pixel-perfect integer coordinates
    const pixelX = Math.round(x * size);
    const pixelY = Math.round(visibleY * size);
    const endX = pixelX + size;
    const endY = pixelY + size;
    const baseColor = color || '#808080';

    if (isGhost) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(pixelX + 0.5, pixelY + 0.5, size - 1, size - 1);
        return;
    }

    // Disable image smoothing for crisp pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;

    // Draw solid block fill
    ctx.fillStyle = baseColor;
    ctx.fillRect(pixelX, pixelY, size, size);

    // Draw borders - use edge detection if shape data is provided
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;

    if (shape) {
        // Edge-only borders: only draw borders on outer edges of the piece
        const worldX = pieceX + blockX;
        const worldY = pieceY + blockY;

        const hasShapeAbove = blockY > 0 && shape[blockY - 1] && shape[blockY - 1][blockX] > 0;
        const hasShapeBelow = blockY < shape.length - 1 && shape[blockY + 1] && shape[blockY + 1][blockX] > 0;
        const hasShapeLeft = blockX > 0 && shape[blockY][blockX - 1] > 0;
        const hasShapeRight = blockX < shape[blockY].length - 1 && shape[blockY][blockX + 1] > 0;

        const hasBoardAbove = boardData && worldY > 0 && boardData[worldY - 1] && boardData[worldY - 1][worldX];
        const hasBoardBelow = boardData && worldY < boardData.length - 1 && boardData[worldY + 1] && boardData[worldY + 1][worldX];
        const hasBoardLeft = boardData && worldX > 0 && boardData[worldY] && boardData[worldY][worldX - 1];
        const hasBoardRight = boardData && boardData[worldY] && worldX < boardData[worldY].length - 1 && boardData[worldY][worldX + 1];

        const hasBlockAbove = hasShapeAbove || hasBoardAbove;
        const hasBlockBelow = hasShapeBelow || hasBoardBelow;
        const hasBlockLeft = hasShapeLeft || hasBoardLeft;
        const hasBlockRight = hasShapeRight || hasBoardRight;

        // Draw individual edge lines only where there's no adjacent block
        ctx.beginPath();

        // Top edge
        if (!hasBlockAbove) {
            ctx.moveTo(pixelX, pixelY + 0.5);
            ctx.lineTo(pixelX + size, pixelY + 0.5);
        }

        // Bottom edge
        if (!hasBlockBelow) {
            ctx.moveTo(pixelX, pixelY + size - 0.5);
            ctx.lineTo(pixelX + size, pixelY + size - 0.5);
        }

        // Left edge
        if (!hasBlockLeft) {
            ctx.moveTo(pixelX + 0.5, pixelY);
            ctx.lineTo(pixelX + 0.5, pixelY + size);
        }

        // Right edge
        if (!hasBlockRight) {
            ctx.moveTo(pixelX + size - 0.5, pixelY);
            ctx.lineTo(pixelX + size - 0.5, pixelY + size);
        }

        ctx.stroke();
    } else if (boardData) {
        const worldY = y;
        const worldX = x;

        const rowData = boardData[worldY] || [];
        const topEmpty = worldY <= HIDDEN_ROWS || !boardData[worldY - 1] || !boardData[worldY - 1][worldX];
        const bottomEmpty = worldY >= boardData.length - 1 || !boardData[worldY + 1] || !boardData[worldY + 1][worldX];
        const leftEmpty = worldX === 0 || !rowData[worldX - 1];
        const rightEmpty = worldX === rowData.length - 1 || !rowData[worldX + 1];

        ctx.beginPath();
        if (topEmpty) {
            ctx.moveTo(pixelX, pixelY + 0.5);
            ctx.lineTo(pixelX + size, pixelY + 0.5);
        }
        if (bottomEmpty) {
            ctx.moveTo(pixelX, pixelY + size - 0.5);
            ctx.lineTo(pixelX + size, pixelY + size - 0.5);
        }
        if (leftEmpty) {
            ctx.moveTo(pixelX + 0.5, pixelY);
            ctx.lineTo(pixelX + 0.5, pixelY + size);
        }
        if (rightEmpty) {
            ctx.moveTo(pixelX + size - 0.5, pixelY);
            ctx.lineTo(pixelX + size - 0.5, pixelY + size);
        }
        ctx.stroke();
    } else {
        ctx.strokeRect(pixelX + 0.5, pixelY + 0.5, size - 1, size - 1);
    }

    // Re-enable image smoothing for other rendering operations
    ctx.imageSmoothingEnabled = true;
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
    return 0.2 + cycle * 0.15; // 0.2 to 0.35
}

export function drawGhostPiece(ctx, piece, ghostY) {
    const opacity = getGhostPulseOpacity();

    piece.shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const worldY = ghostY + y;
                if (worldY < HIDDEN_ROWS) return;

                const visibleY = worldY - HIDDEN_ROWS;
                const blockX = piece.x + x;

                ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                ctx.fillRect(blockX * BLOCK_SIZE, visibleY * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

                ctx.strokeStyle = `rgba(100, 200, 255, ${opacity * 0.6})`;
                ctx.lineWidth = 1;
                ctx.strokeRect(blockX * BLOCK_SIZE, visibleY * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
            }
        });
    });
}
