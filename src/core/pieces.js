// =================================================================================
// PIECES - Tetromino piece management for Serenity Blocks
// =================================================================================

import { SHAPES, COLORS, PIECE_KEYS, COLS } from './constants.js';

/**
 * Piece queue and bag state
 */
let nextPieces = [];

/**
 * Get the next pieces queue
 * @returns {Array} Array of piece keys
 */
export function getNextPieces() {
    return nextPieces;
}

/**
 * Set the next pieces queue (used for game reset)
 * @param {Array} pieces - New piece queue
 */
export function setNextPieces(pieces) {
    nextPieces = pieces;
}

/**
 * Fill the piece bag using 7-bag randomizer
 * Ensures all 7 piece types appear before any repeat
 */
export function fillBag() {
    while (nextPieces.length < 10) {
        const bag = [...PIECE_KEYS].sort(() => Math.random() - 0.5);
        nextPieces.push(...bag);
    }
}

/**
 * Spawn a new piece
 * @param {Function} isValidPositionFn - Function to check if position is valid
 * @returns {Object|null} New piece object or null if game over
 */
export function spawnPiece(isValidPositionFn) {
    const shapeKey = nextPieces.shift();
    const shape = SHAPES[shapeKey];

    const piece = {
        shapeKey,
        shape,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: 0,
        color: COLORS[shapeKey],
    };

    fillBag();

    // Check if spawn position is valid (if not, game over)
    if (!isValidPositionFn(piece)) {
        return null;
    }

    return piece;
}

/**
 * Create a piece object from a shape key
 * @param {string} shapeKey - Piece type (I, O, T, S, Z, J, L)
 * @param {number} x - X position
 * @param {number} y - Y position
 * @returns {Object} Piece object
 */
export function createPiece(shapeKey, x = 0, y = 0) {
    return {
        shapeKey,
        shape: SHAPES[shapeKey],
        x,
        y,
        color: COLORS[shapeKey],
        pieceId: Date.now() + Math.random(),
    };
}

/**
 * Rotate a piece shape
 * @param {Array} shape - 2D array representing piece shape
 * @param {string} direction - 'right', 'left', or 'flip'
 * @returns {Array} Rotated shape
 */
export function rotateShape(shape, direction = 'right') {
    if (direction === 'right') {
        // Rotate 90 degrees clockwise
        return shape[0].map((_, i) => shape.map(row => row[i]).reverse());
    }
    if (direction === 'left') {
        // Rotate 90 degrees counterclockwise
        return shape[0].map((_, i) => shape.map(row => row[i])).reverse();
    }
    // Flip 180 degrees
    return shape.map(row => row.slice().reverse()).reverse();
}

/**
 * Get wall kick offsets for rotation attempts
 * Implements simplified SRS (Super Rotation System) wall kicks
 * @returns {Array} Array of x-offsets to try for rotation
 */
export function getWallKickOffsets() {
    return [0, 1, -1, 2, -2];
}

/**
 * Calculate the ghost piece Y position (where piece would land)
 * @param {Object} piece - Current piece
 * @param {Function} isValidPositionFn - Function to check if position is valid
 * @returns {number} Y coordinate of ghost position
 */
export function calculateGhostY(piece, isValidPositionFn) {
    if (!piece) return 0;

    let ghostY = piece.y;
    while (isValidPositionFn(piece, piece.x, ghostY + 1)) {
        ghostY++;
    }
    return ghostY;
}

/**
 * Get the bounding box of a piece shape
 * @param {Array} shape - 2D array representing piece shape
 * @returns {Object} {minX, maxX, minY, maxY, width, height}
 */
export function getPieceBounds(shape) {
    let minX = shape[0].length;
    let maxX = -1;
    let minY = shape.length;
    let maxY = -1;

    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] > 0) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

/**
 * Initialize piece system (fill initial bag)
 */
export function initPieceSystem() {
    nextPieces = [];
    fillBag();
}

/**
 * Reset piece system
 */
export function resetPieceSystem() {
    nextPieces = [];
    fillBag();
}
