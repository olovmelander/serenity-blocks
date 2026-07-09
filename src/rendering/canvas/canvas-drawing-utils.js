/**
 * Canvas Drawing Utilities
 * Shared drawing functions for canvas-based rendering
 * Used by both single-player and multiplayer canvas renderers
 */

import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { calculateGhostY as calculateGhostYCore } from '../../core/pieces.js';
import { hexToRgb } from '../../utils/helpers.js';

/**
 * Calculate optimal block size based on available space
 * @param {number} availableWidth - Available width in pixels
 * @param {number} availableHeight - Available height in pixels
 * @param {number} cols - Number of columns
 * @param {number} rows - Number of rows
 * @param {number} minSize - Minimum block size
 * @param {number} maxSize - Maximum block size
 * @returns {number} Calculated block size
 */
export function calculateBlockSize(availableWidth, availableHeight, cols, rows, minSize = 20, maxSize = 60) {
    const blockSizeFromHeight = Math.floor(availableHeight / rows);
    const blockSizeFromWidth = Math.floor(availableWidth / cols);

    // Use smaller dimension to fit both constraints
    const blockSize = Math.max(minSize, Math.min(blockSizeFromHeight, blockSizeFromWidth, maxSize));

    return blockSize;
}

/**
 * Draw grid lines on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {number} cols - Number of columns
 * @param {number} rows - Number of rows
 */
export function drawGrid(ctx, width, height, cols = COLS, rows = ROWS) {
    const blockSize = width / cols;

    // Use a subtle white grid with low opacity
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;

    // Draw all vertical lines in one path for better performance
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
        const xPos = x * blockSize;
        ctx.moveTo(xPos, 0);
        ctx.lineTo(xPos, height);
    }
    ctx.stroke();

    // Draw all horizontal lines in one path for better performance
    ctx.beginPath();
    for (let y = 0; y <= rows; y++) {
        const yPos = y * blockSize;
        ctx.moveTo(0, yPos);
        ctx.lineTo(width, yPos);
    }
    ctx.stroke();
}

/**
 * Draw a single block
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position in pixels
 * @param {number} y - Y position in pixels
 * @param {number} blockSize - Size of block
 * @param {string} color - Block color
 * @param {boolean} isGhost - Whether this is a ghost piece
 * @param {boolean} isCurrent - Whether this is part of current piece
 */
export function drawBlock(ctx, x, y, blockSize, color, isGhost = false) {
    if (isGhost) {
        // Ghost piece - semi-transparent fill with pulsating effect
        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + (x + y) * 0.1);
        const alpha = 0.1 + 0.25 * pulse;

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(x, y, blockSize, blockSize);
    } else {
        // Solid block - no internal borders
        ctx.fillStyle = color || '#808080';
        ctx.fillRect(x, y, blockSize, blockSize);
    }
}

// ============================================================================
// THEME-BASED STYLED BLOCK RENDERING
// ============================================================================

/**
 * Draw a styled block with theme-specific effects
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position in pixels
 * @param {number} y - Y position in pixels
 * @param {number} blockSize - Size of block
 * @param {Object} styleConfig - Style configuration { color, renderMode, effects, rendererOverrides }
 * @param {boolean} isGhost - Whether this is a ghost piece
 * @param {number} alpha - Opacity (0-1)
 */
export function drawBlockStyled(ctx, x, y, blockSize, styleConfig, isGhost = false, alpha = 1.0) {
    if (isGhost) {
        // Ghost pieces always use simple rendering for clarity
        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + (x + y) * 0.1);
        const ghostAlpha = 0.1 + 0.25 * pulse;
        ctx.fillStyle = `rgba(255, 255, 255, ${ghostAlpha})`;
        ctx.fillRect(x, y, blockSize, blockSize);
        return;
    }

    // Apply canvas-specific overrides if present
    const effects = {
        ...styleConfig.effects,
        ...(styleConfig.rendererOverrides?.canvas || {}),
    };

    const { color, renderMode } = styleConfig;

    // Route to appropriate rendering function based on mode
    switch (renderMode) {
    case 'glow':
        drawBlockGlow(ctx, x, y, blockSize, color, effects, alpha);
        break;
    case 'gradient':
        drawBlockGradient(ctx, x, y, blockSize, color, effects, alpha);
        break;
    case 'solid':
    default:
        drawBlockSolid(ctx, x, y, blockSize, color, effects, alpha);
        break;
    }
}

/**
 * Draw a solid block with optional outline
 * @private
 */
function drawBlockSolid(ctx, x, y, blockSize, color, effects, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Fill block
    ctx.fillStyle = color;
    ctx.fillRect(x, y, blockSize, blockSize);

    // Draw outline if enabled
    if (effects.outline && effects.outlineWidth > 0) {
        const outlineColor = computeOutlineColor(color, effects.outlineColor);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = effects.outlineWidth;
        ctx.strokeRect(x, y, blockSize, blockSize);
    }

    ctx.restore();
}

/**
 * Draw a block with glow effect
 * @private
 */
function drawBlockGlow(ctx, x, y, blockSize, color, effects, alpha) {
    ctx.save();

    // Apply pulse animation if enabled
    let intensity = effects.glowIntensity;
    if (effects.pulse) {
        const time = Date.now() / 1000;
        const pulse = Math.sin(time * effects.pulseSpeed) * effects.pulseAmplitude;
        intensity = effects.glowIntensity * (1 + pulse);
    }

    // Set up glow effect
    const glowColor = effects.glowColor === 'auto' ? color : effects.glowColor;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = effects.glowRadius;
    ctx.globalAlpha = intensity * alpha;

    // Draw main block with glow
    ctx.fillStyle = color;
    ctx.fillRect(x, y, blockSize, blockSize);

    // Draw solid block on top (without glow but with full opacity)
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, blockSize, blockSize);

    // Draw outline if enabled
    if (effects.outline && effects.outlineWidth > 0) {
        const outlineColor = computeOutlineColor(color, effects.outlineColor);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = effects.outlineWidth;
        ctx.strokeRect(x, y, blockSize, blockSize);
    }

    ctx.restore();
}

/**
 * Draw a block with gradient fill
 * @private
 */
function drawBlockGradient(ctx, x, y, blockSize, color, effects, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Create gradient based on configuration
    let gradient;
    if (effects.gradientType === 'radial') {
        const centerX = x + blockSize / 2;
        const centerY = y + blockSize / 2;
        gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, blockSize / 2);
    } else {
        // Linear gradient
        gradient = ctx.createLinearGradient(x, y, x + blockSize, y + blockSize);
    }

    // Add color stops
    if (effects.gradientStops && effects.gradientStops.length > 0) {
        effects.gradientStops.forEach((stop) => {
            const stopColor = computeStopColor(color, stop.color, stop.opacity || 1);
            gradient.addColorStop(stop.offset, stopColor);
        });
    } else {
        // Default gradient if none specified
        const lightColor = computeOutlineColor(color, 'lighten');
        gradient.addColorStop(0, lightColor);
        gradient.addColorStop(1, color);
    }

    // Fill with gradient
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, blockSize, blockSize);

    // Draw outline if enabled
    if (effects.outline && effects.outlineWidth > 0) {
        const outlineColor = computeOutlineColor(color, effects.outlineColor);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = effects.outlineWidth;
        ctx.strokeRect(x, y, blockSize, blockSize);
    }

    ctx.restore();
}

/**
 * Compute outline color based on base color and mode
 * @private
 * @param {string} baseColor - Base color (hex)
 * @param {string} mode - 'lighten', 'darken', or explicit hex color
 * @returns {string} Computed color
 */
function computeOutlineColor(baseColor, mode) {
    // If mode is already a color string (starts with # or rgb), use it directly
    if (typeof mode === 'string' && (mode.startsWith('#') || mode.startsWith('rgb'))) {
        return mode;
    }

    // Parse base color
    const rgb = hexToRgb(baseColor);
    if (!rgb) return mode; // Fallback to mode if parsing fails

    let { r, g, b } = rgb;

    // Apply lighten or darken
    if (mode === 'lighten') {
        const factor = 1.4;
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
    } else if (mode === 'darken') {
        const factor = 0.6;
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
    }

    return rgbToHex(r, g, b);
}

/**
 * Compute gradient stop color
 * @private
 * @param {string} baseColor - Base color (hex)
 * @param {string} stopColorMode - 'base', 'lighten', 'darken', or explicit color
 * @param {number} opacity - Opacity for this stop
 * @returns {string} RGBA color string
 */
function computeStopColor(baseColor, stopColorMode, opacity = 1) {
    let finalColor = baseColor;

    if (stopColorMode === 'base') {
        finalColor = baseColor;
    } else if (stopColorMode === 'lighten' || stopColorMode === 'darken') {
        finalColor = computeOutlineColor(baseColor, stopColorMode);
    } else if (stopColorMode.startsWith('#') || stopColorMode.startsWith('rgb')) {
        finalColor = stopColorMode;
    }

    // Convert to RGBA with opacity
    const rgb = hexToRgb(finalColor);
    if (rgb) {
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    }

    return finalColor;
}

/**
 * Convert RGB to hex color
 * @private
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string
 */
function rgbToHex(r, g, b) {
    const toHex = (n) => {
        const hex = Math.round(n).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Trace the fused outer perimeter of a piece shape as one or more closed loops
 * in pixel coordinates. Mirrors the Phaser board's traceLoops so the next-queue
 * rim is the SAME continuous, centered outline (not per-cell inset segments).
 * @returns {Array<Array<{x:number,y:number}>>}
 */
function traceFusedLoops(shape, offsetX, offsetY, size) {
    const cols = shape[0]?.length ?? 0;
    const has = (x, y) => y >= 0 && y < shape.length && x >= 0 && x < cols && shape[y][x] > 0;
    const edges = [];
    shape.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell) return;
        const x0 = offsetX + x * size; const y0 = offsetY + y * size;
        const x1 = offsetX + (x + 1) * size; const y1 = offsetY + (y + 1) * size;
        if (!has(x, y - 1)) edges.push({
            fx: x0, fy: y0, tx: x1, ty: y0, dx: 1, dy: 0,
        });
        if (!has(x + 1, y)) edges.push({
            fx: x1, fy: y0, tx: x1, ty: y1, dx: 0, dy: 1,
        });
        if (!has(x, y + 1)) edges.push({
            fx: x1, fy: y1, tx: x0, ty: y1, dx: -1, dy: 0,
        });
        if (!has(x - 1, y)) edges.push({
            fx: x0, fy: y1, tx: x0, ty: y0, dx: 0, dy: -1,
        });
    }));
    if (edges.length === 0) return [];

    const startMap = new Map();
    edges.forEach((e) => {
        const k = `${e.fx},${e.fy}`;
        if (!startMap.has(k)) startMap.set(k, []);
        startMap.get(k).push(e);
    });
    const turnScore = (din, c) => {
        const cross = din.dx * c.dy - din.dy * c.dx;
        const dot = din.dx * c.dx + din.dy * c.dy;
        if (cross > 0) return 0;
        if (cross === 0 && dot > 0) return 1;
        if (cross < 0) return 2;
        return 3;
    };
    const used = new Set();
    const loops = [];
    edges.forEach((startEdge) => {
        if (used.has(startEdge)) return;
        const loop = [];
        let e = startEdge;
        let guard = 0;
        while (e && !used.has(e) && guard++ < 100000) {
            used.add(e);
            loop.push({ x: e.fx, y: e.fy });
            const candidates = startMap.get(`${e.tx},${e.ty}`) || [];
            let best = null; let bestScore = 99;
            for (const c of candidates) {
                if (used.has(c)) continue;
                const s = turnScore(e, c);
                if (s < bestScore) { bestScore = s; best = c; }
            }
            e = best;
        }
        if (loop.length >= 3) loops.push(loop);
    });
    return loops;
}

/**
 * Draw a tetromino piece with solid look (no internal borders)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} piece - Piece object with shape, x, y, color
 * @param {number} blockSize - Size of each block
 * @param {boolean} isGhost - Whether this is a ghost piece
 * @param {boolean} isCurrent - Whether this is the current piece
 */
export function drawPiece(ctx, piece, blockSize, isGhost = false, isCurrent = false) {
    if (!piece || !piece.shape) return;

    // First pass: Draw all blocks without borders
    piece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
            if (cell > 0) {
                const worldY = piece.y + localY;
                const x = (piece.x + localX) * blockSize;
                const y = (worldY - HIDDEN_ROWS) * blockSize; // Canvas Y = worldY - HIDDEN_ROWS

                // Draw ALL blocks including those in hidden rows (negative Y = above canvas)
                // The canvas will clip blocks that are above (negative Y), creating smooth drop-in effect
                drawBlock(ctx, x, y, blockSize, piece.color, isGhost, isCurrent);
            }
        });
    });

    // Second pass: Draw outline around entire piece (not individual blocks)
    if (!isGhost && isCurrent) {
        drawPieceOutline(ctx, piece, blockSize);
    }
}

/**
 * Draw outline around entire tetromino piece
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} piece - Piece object with shape, x, y
 * @param {number} blockSize - Size of each block
 */
function drawPieceOutline(ctx, piece, blockSize) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;

    piece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
            if (cell > 0) {
                const worldY = piece.y + localY;
                // Draw outline for ALL blocks, even in hidden rows
                const x = (piece.x + localX) * blockSize;
                const y = (worldY - HIDDEN_ROWS) * blockSize;

                // Check each edge and only draw if it's an outer edge
                const hasTop = localY === 0 || !piece.shape[localY - 1]?.[localX];
                const hasBottom = localY === piece.shape.length - 1 || !piece.shape[localY + 1]?.[localX];
                const hasLeft = localX === 0 || !row[localX - 1];
                const hasRight = localX === row.length - 1 || !row[localX + 1];

                ctx.beginPath();

                if (hasTop) {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + blockSize, y);
                }
                if (hasBottom) {
                    ctx.moveTo(x, y + blockSize);
                    ctx.lineTo(x + blockSize, y + blockSize);
                }
                if (hasLeft) {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, y + blockSize);
                }
                if (hasRight) {
                    ctx.moveTo(x + blockSize, y);
                    ctx.lineTo(x + blockSize, y + blockSize);
                }

                ctx.stroke();
            }
        });
    });
}

/**
 * Draw locked pieces on the board with solid look
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} lockedPieces - Array of locked piece objects
 * @param {number} blockSize - Size of each block
 */
export function drawLockedPieces(ctx, lockedPieces, blockSize) {
    if (!lockedPieces || lockedPieces.length === 0) return;

    // First pass: Draw all blocks solid (no borders at all)
    lockedPieces.forEach((piece) => {
        if (!piece.shape) return;

        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell > 0) {
                    const worldY = piece.y + localY;

                    // Only draw visible area (below hidden rows)
                    if (worldY >= HIDDEN_ROWS) {
                        const x = (piece.x + localX) * blockSize;
                        const y = (worldY - HIDDEN_ROWS) * blockSize;

                        ctx.fillStyle = piece.color || '#808080';
                        ctx.fillRect(x, y, blockSize, blockSize);
                    }
                }
            });
        });
    });

    // Second pass: Draw outlines around each complete piece (not individual blocks)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;

    lockedPieces.forEach((piece) => {
        if (!piece.shape) return;

        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell > 0) {
                    const worldY = piece.y + localY;

                    if (worldY >= HIDDEN_ROWS) {
                        const x = (piece.x + localX) * blockSize;
                        const y = (worldY - HIDDEN_ROWS) * blockSize;

                        // Check each edge and only draw if it's an outer edge of the piece
                        const hasTop = localY === 0 || !piece.shape[localY - 1]?.[localX];
                        const hasBottom = localY === piece.shape.length - 1 || !piece.shape[localY + 1]?.[localX];
                        const hasLeft = localX === 0 || !row[localX - 1];
                        const hasRight = localX === row.length - 1 || !row[localX + 1];

                        // Draw only the outer edges, not full rectangles
                        ctx.beginPath();

                        if (hasTop) {
                            ctx.moveTo(x, y);
                            ctx.lineTo(x + blockSize, y);
                        }
                        if (hasBottom) {
                            ctx.moveTo(x, y + blockSize);
                            ctx.lineTo(x + blockSize, y + blockSize);
                        }
                        if (hasLeft) {
                            ctx.moveTo(x, y);
                            ctx.lineTo(x, y + blockSize);
                        }
                        if (hasRight) {
                            ctx.moveTo(x + blockSize, y);
                            ctx.lineTo(x + blockSize, y + blockSize);
                        }

                        ctx.stroke();
                    }
                }
            });
        });
    });
}

/**
 * Calculate ghost piece Y position (where piece will land)
 * @param {Object} piece - Current piece
 * @param {Array} lockedPieces - Array of locked pieces
 * @returns {number} Y position where piece will land
 */
export function calculateGhostY(piece, lockedPieces, isValidPositionFn) {
    if (!piece) return 0;

    if (typeof isValidPositionFn === 'function') {
        return calculateGhostYCore(piece, isValidPositionFn);
    }

    // Fallback: build a temporary board snapshot when no validator is provided
    const board = Array(ROWS + HIDDEN_ROWS).fill(null).map(() => Array(COLS).fill(false));

    lockedPieces.forEach((lockedPiece) => {
        if (!lockedPiece?.shape) return;
        lockedPiece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell > 0) {
                    const boardY = lockedPiece.y + localY;
                    const boardX = lockedPiece.x + localX;
                    if (boardY >= 0 && boardY < board.length && boardX >= 0 && boardX < COLS) {
                        board[boardY][boardX] = true;
                    }
                }
            });
        });
    });

    const wouldCollide = (testPiece, offsetY = 0) => {
        for (let y = 0; y < testPiece.shape.length; y++) {
            for (let x = 0; x < testPiece.shape[y].length; x++) {
                if (testPiece.shape[y][x] > 0) {
                    const boardX = testPiece.x + x;
                    const boardY = testPiece.y + y + offsetY;

                    if (boardX < 0 || boardX >= COLS || boardY >= board.length) {
                        return true;
                    }

                    if (boardY >= 0 && board[boardY][boardX]) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    let ghostY = piece.y;
    while (!wouldCollide(piece, ghostY - piece.y + 1)) {
        ghostY++;
    }

    return ghostY;
}

/**
 * Clear canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
export function clearCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
}

/**
 * Draw a tetromino piece with theme-based styling as a unified fused shape
 * with no internal borders or gaps between blocks.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array<Array<number>>} shape - 2D array representing piece shape
 * @param {number} offsetX - X offset in pixels
 * @param {number} offsetY - Y offset in pixels
 * @param {number} blockSize - Size of each block in pixels
 * @param {Object} styleConfig - Style configuration { color, renderMode, effects, rendererOverrides }
 * @param {boolean} isGhost - Whether this is a ghost piece
 * @param {number} alpha - Opacity (0-1)
 */
export function drawPieceStyledUnified(
    ctx,
    shape,
    offsetX,
    offsetY,
    blockSize,
    styleConfig,
    isGhost = false,
    alpha = 1.0,
) {
    if (!shape || shape.length === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const size = Math.round(blockSize);

    if (isGhost) {
        // Ghost pieces use semi-transparent fills without overlap to prevent darker overlap lines
        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + (offsetX + offsetY) * 0.01);
        const ghostAlpha = (0.1 + 0.25 * pulse) * alpha;

        ctx.fillStyle = `rgba(255, 255, 255, ${ghostAlpha})`;

        ctx.beginPath();
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);
                    ctx.rect(px, py, size, size);
                }
            });
        });
        ctx.fill();

        // Stroke outer perimeter of ghost piece
        ctx.strokeStyle = `rgba(100, 200, 255, ${ghostAlpha * 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);

                    const hasTop = y === 0 || !shape[y - 1]?.[x];
                    const hasBottom = y === shape.length - 1 || !shape[y + 1]?.[x];
                    const hasLeft = x === 0 || !row[x - 1];
                    const hasRight = x === row.length - 1 || !row[x + 1];

                    if (hasTop) {
                        ctx.moveTo(px, py + 0.5);
                        ctx.lineTo(px + size, py + 0.5);
                    }
                    if (hasBottom) {
                        ctx.moveTo(px, py + size - 0.5);
                        ctx.lineTo(px + size, py + size - 0.5);
                    }
                    if (hasLeft) {
                        ctx.moveTo(px + 0.5, py);
                        ctx.lineTo(px + 0.5, py + size);
                    }
                    if (hasRight) {
                        ctx.moveTo(px + size - 0.5, py);
                        ctx.lineTo(px + size - 0.5, py + size);
                    }
                }
            });
        });
        ctx.stroke();
        ctx.restore();
        return;
    }

    const effects = {
        ...styleConfig.effects,
        ...(styleConfig.rendererOverrides?.canvas || {}),
    };
    const { color, renderMode } = styleConfig;

    ctx.globalAlpha = alpha;

    // First pass: Fill the unified path of the piece
    ctx.beginPath();
    shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const px = Math.round(offsetX + x * size);
                const py = Math.round(offsetY + y * size);
                // Expand rect by 0.25px on all sides to eliminate sub-pixel antialiasing gaps
                ctx.rect(px - 0.25, py - 0.25, size + 0.5, size + 0.5);
            }
        });
    });

    // Apply glow effect
    if (renderMode === 'glow' && effects.glowRadius > 0) {
        let intensity = effects.glowIntensity || 1;
        if (effects.pulse) {
            const time = Date.now() / 1000;
            const pulse = Math.sin(time * (effects.pulseSpeed || 2)) * (effects.pulseAmplitude || 0.3);
            intensity *= (1 + pulse);
        }
        const glowColor = effects.glowColor === 'auto' ? color : effects.glowColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = effects.glowRadius;
        ctx.globalAlpha = intensity * alpha;
    }

    // Apply gradient fill
    if (renderMode === 'gradient' && effects.gradientStops) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + 1);
                    maxY = Math.max(maxY, y + 1);
                }
            });
        });
        const gx1 = offsetX + minX * size;
        const gy1 = offsetY + minY * size;
        const gx2 = offsetX + maxX * size;
        const gy2 = offsetY + maxY * size;

        let gradient;
        if (effects.gradientType === 'radial') {
            const centerX = (gx1 + gx2) / 2;
            const centerY = (gy1 + gy2) / 2;
            const radius = Math.max(gx2 - gx1, gy2 - gy1) / 2;
            gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        } else {
            gradient = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        }
        effects.gradientStops.forEach((stop) => {
            const stopColor = computeStopColor(color, stop.color, stop.opacity || 1);
            gradient.addColorStop(stop.offset, stopColor);
        });
        ctx.fillStyle = gradient;
    } else {
        // Solid/default mode: apply a continuous TL→BR directional gradient across
        // the whole fused shape (premium depth, no internal seams). Falls back to a
        // flat fill if the bounding box can't be computed.
        let sMinX = Infinity; let sMinY = Infinity; let sMaxX = -Infinity; let sMaxY = -Infinity;
        shape.forEach((row, y) => row.forEach((cell, x) => {
            if (cell > 0) {
                sMinX = Math.min(sMinX, x); sMinY = Math.min(sMinY, y);
                sMaxX = Math.max(sMaxX, x + 1); sMaxY = Math.max(sMaxY, y + 1);
            }
        }));
        const rgb = hexToRgb(color);
        if (rgb && sMaxX > sMinX) {
            const shade = (amt) => {
                const f = amt >= 0
                    ? { r: rgb.r + (255 - rgb.r) * amt, g: rgb.g + (255 - rgb.g) * amt, b: rgb.b + (255 - rgb.b) * amt }
                    : { r: rgb.r * (1 + amt), g: rgb.g * (1 + amt), b: rgb.b * (1 + amt) };
                return `rgb(${Math.round(f.r)}, ${Math.round(f.g)}, ${Math.round(f.b)})`;
            };
            const grad = ctx.createLinearGradient(
                offsetX + sMinX * size,
                offsetY + sMinY * size,
                offsetX + sMaxX * size,
                offsetY + sMaxY * size,
            );
            grad.addColorStop(0, shade(0.18));
            grad.addColorStop(0.5, color);
            grad.addColorStop(1, shade(-0.18));
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = color;
        }
    }

    ctx.fill();

    // Reset shadow/alpha for stroke pass
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha;

    // Gloss sheen (solid/default) — a continuous top highlight clipped to the
    // fused silhouette, additive. Mirrors the Phaser board's glossPass (alpha 0.22)
    // so next-queue previews match the on-board pieces.
    if (renderMode !== 'glow' && renderMode !== 'gradient') {
        let mnX = Infinity; let mnY = Infinity; let mxX = -Infinity; let mxY = -Infinity;
        shape.forEach((row, y) => row.forEach((cell, x) => {
            if (cell > 0) {
                mnX = Math.min(mnX, x); mnY = Math.min(mnY, y);
                mxX = Math.max(mxX, x + 1); mxY = Math.max(mxY, y + 1);
            }
        }));
        if (mxX > mnX) {
            const gx1 = offsetX + mnX * size; const gy1 = offsetY + mnY * size;
            const gx2 = offsetX + mxX * size; const gy2 = offsetY + mxY * size;
            ctx.save();
            ctx.beginPath();
            shape.forEach((row, y) => row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);
                    ctx.rect(px - 0.25, py - 0.25, size + 0.5, size + 0.5);
                }
            }));
            ctx.clip();
            ctx.globalCompositeOperation = 'lighter';
            const sheen = ctx.createLinearGradient(0, gy1, 0, gy1 + (gy2 - gy1) * 0.55);
            sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
            sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sheen;
            ctx.fillRect(gx1, gy1, gx2 - gx1, gy2 - gy1);
            ctx.restore();
        }
    }

    // Premium outer rim — the SAME continuous, centered contour outline used on the
    // Phaser board (traceFusedLoops), not per-cell inset segments. This is what makes
    // the previews read identically to the on-board pieces.
    if (renderMode !== 'glow' && renderMode !== 'gradient') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.lineJoin = 'round';
        traceFusedLoops(shape, offsetX, offsetY, size).forEach((loop) => {
            if (loop.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(loop[0].x, loop[0].y);
            for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
            ctx.closePath();
            ctx.stroke();
        });
    }

    // Second pass: Draw outline only on outer perimeter of the piece
    if (effects.outline && effects.outlineWidth > 0) {
        const outlineColor = computeOutlineColor(color, effects.outlineColor);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = effects.outlineWidth;

        ctx.beginPath();
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);

                    const hasTop = y > 0 && shape[y - 1] && shape[y - 1][x];
                    const hasBottom = y < shape.length - 1 && shape[y + 1] && shape[y + 1][x];
                    const hasLeft = x > 0 && row[x - 1];
                    const hasRight = x < row.length - 1 && row[x + 1];

                    if (!hasTop) {
                        ctx.moveTo(px, py + 0.5);
                        ctx.lineTo(px + size, py + 0.5);
                    }
                    if (!hasBottom) {
                        ctx.moveTo(px, py + size - 0.5);
                        ctx.lineTo(px + size, py + size - 0.5);
                    }
                    if (!hasLeft) {
                        ctx.moveTo(px + 0.5, py);
                        ctx.lineTo(px + 0.5, py + size);
                    }
                    if (!hasRight) {
                        ctx.moveTo(px + size - 0.5, py);
                        ctx.lineTo(px + size - 0.5, py + size);
                    }
                }
            });
        });
        ctx.stroke();
    }

    ctx.imageSmoothingEnabled = true;
    ctx.restore();
}

/**
 * Draw an entire tetromino piece with solid look (outer edges only)
 * This renders the piece as a cohesive unit rather than separate blocks
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array<Array<number>>} shape - 2D array representing piece shape
 * @param {number} offsetX - X offset in pixels
 * @param {number} offsetY - Y offset in pixels
 * @param {number} blockSize - Size of each block in pixels
 * @param {Object} styleConfig - Style configuration { color, renderMode, effects, rendererOverrides }
 */
export function drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig) {
    drawPieceStyledUnified(ctx, shape, offsetX, offsetY, blockSize, styleConfig, false, 1.0);
}
