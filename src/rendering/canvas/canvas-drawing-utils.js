/**
 * Canvas Drawing Utilities
 * Shared drawing functions for canvas-based rendering
 * Used by both single-player and multiplayer canvas renderers
 */

import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { calculateGhostY as calculateGhostYCore } from '../../core/pieces.js';

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
export function drawBlock(ctx, x, y, blockSize, color, isGhost = false, isCurrent = false) {
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
        const y = (worldY - HIDDEN_ROWS) * blockSize;  // Canvas Y = worldY - HIDDEN_ROWS

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
  lockedPieces.forEach(piece => {
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
  
  lockedPieces.forEach(piece => {
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

  lockedPieces.forEach(lockedPiece => {
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
