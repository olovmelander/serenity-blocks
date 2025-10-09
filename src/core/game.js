/**
 * @fileoverview Main game loop and state management for Serenity Blocks
 * Handles game state, piece movement, rotation, dropping, and game flow
 */

import { COLS, ROWS, HIDDEN_ROWS, SHAPES, COLORS, LEVEL_SPEEDS, PIECE_KEYS } from './constants.js';
import { generateBoard, isValidPosition } from './board.js';
import { processPhysics } from './physics.js';

/**
 * Game state object that holds all game data
 */
export class GameState {
    constructor() {
        // Pieces
        this.lockedPieces = [];
        this.currentPiece = null;
        this.nextPieces = [];

        // Score and level
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.linesUntilNextLevel = 10;

        // Timing
        this.dropInterval = LEVEL_SPEEDS[0];
        this.dropCounter = 0;
        this.lastTime = 0;
        this.startTime = Date.now();
        this.piecesPlaced = 0;

        // Flags
        this.isGameOver = false;
        this.isPaused = false;
        this.isProcessingPhysics = false;

        // Input
        this.inputQueue = null;

        // Animation
        this.animationId = null;

        // Board reference (for visual feedback during line clears)
        this.board = null;
    }

    /**
     * Resets the game state to initial values
     */
    reset() {
        this.lockedPieces = [];
        this.currentPiece = null;
        this.nextPieces = [];
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.linesUntilNextLevel = 10;
        this.dropInterval = LEVEL_SPEEDS[0];
        this.dropCounter = 0;
        this.piecesPlaced = 0;
        this.isGameOver = false;
        this.isProcessingPhysics = false;
        this.inputQueue = null;
        this.startTime = Date.now();
        this.board = null;
    }
}

/**
 * Fills the next pieces bag using 7-bag randomizer
 * @param {Array<string>} nextPieces - Next pieces array to fill
 */
export function fillBag(nextPieces) {
    while (nextPieces.length < 10) {
        const bag = [...PIECE_KEYS].sort(() => Math.random() - 0.5);
        nextPieces.push(...bag);
    }
}

/**
 * Spawns a new piece from the next pieces queue
 * @param {GameState} gameState - Current game state
 * @param {Function} drawNextPiecesCallback - Callback to redraw next pieces display
 * @param {Function} gameOverCallback - Callback to trigger game over
 */
export function spawnPiece(gameState, drawNextPiecesCallback, gameOverCallback) {
    const shapeKey = gameState.nextPieces.shift();
    const shape = SHAPES[shapeKey];

    gameState.currentPiece = {
        shapeKey,
        shape: shape,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: 0,
        color: COLORS[shapeKey]
    };

    fillBag(gameState.nextPieces);
    if (drawNextPiecesCallback) drawNextPiecesCallback();
    gameState.piecesPlaced++;

    // Handle queued input
    if (gameState.inputQueue) {
        const action = gameState.inputQueue;
        gameState.inputQueue = null;
        setTimeout(() => {
            if (action.type === 'move') move(gameState, action.dir);
            else if (action.type === 'rotate') rotate(gameState, action.dir);
        }, 0);
    }

    // Check if piece can spawn (game over condition)
    if (!isValidPosition(gameState.currentPiece, gameState.currentPiece.x, gameState.currentPiece.y, gameState.lockedPieces)) {
        if (gameOverCallback) gameOverCallback();
    }
}

/**
 * Moves the current piece horizontally
 * @param {GameState} gameState - Current game state
 * @param {number} dir - Direction to move (-1 for left, 1 for right)
 * @param {Function} playSoundCallback - Callback to play move sound
 * @returns {boolean} True if move was successful
 */
export function move(gameState, dir, playSoundCallback) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    if (isValidPosition(
        gameState.currentPiece,
        gameState.currentPiece.x + dir,
        gameState.currentPiece.y,
        gameState.lockedPieces
    )) {
        gameState.currentPiece.x += dir;
        if (playSoundCallback) playSoundCallback();
        return true;
    }
    return false;
}

/**
 * Rotates the current piece
 * @param {GameState} gameState - Current game state
 * @param {string} dir - Rotation direction ('right', 'left', or 'flip')
 * @param {Function} playSoundCallback - Callback to play rotate sound
 * @returns {boolean} True if rotation was successful
 */
export function rotate(gameState, dir = 'right', playSoundCallback) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    const originalShape = gameState.currentPiece.shape;
    let rotatedShape;

    if (dir === 'right') {
        // Rotate clockwise
        rotatedShape = originalShape[0].map((_, i) =>
            originalShape.map(row => row[i]).reverse()
        );
    } else if (dir === 'left') {
        // Rotate counter-clockwise
        rotatedShape = originalShape[0].map((_, i) =>
            originalShape.map(row => row[i])
        ).reverse();
    } else {
        // Flip 180 degrees
        rotatedShape = originalShape.map(row =>
            row.slice().reverse()
        ).reverse();
    }

    gameState.currentPiece.shape = rotatedShape;

    // Wall kick: try offsets 0, 1, -1, 2, -2
    for (const kick of [0, 1, -1, 2, -2]) {
        if (isValidPosition(
            gameState.currentPiece,
            gameState.currentPiece.x + kick,
            gameState.currentPiece.y,
            gameState.lockedPieces
        )) {
            gameState.currentPiece.x += kick;
            if (playSoundCallback) playSoundCallback();
            return true;
        }
    }

    // Rotation failed, revert
    gameState.currentPiece.shape = originalShape;
    return false;
}

/**
 * Soft drop - moves piece down one row
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 * @returns {boolean} True if piece moved down, false if it locked
 */
export function softDrop(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    if (isValidPosition(
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,
        gameState.lockedPieces
    )) {
        gameState.currentPiece.y++;
        gameState.score += gameState.level;
        gameState.dropCounter = 0;
        return true;
    } else {
        lockPiece(gameState, playDropCallback, physicsCallbacks);
        return false;
    }
}

/**
 * Hard drop - instantly drops piece to bottom
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function hardDrop(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return;

    let distance = 0;
    while (isValidPosition(
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,
        gameState.lockedPieces
    )) {
        gameState.currentPiece.y++;
        distance++;
    }

    gameState.score += distance * 2 * gameState.level;
    lockPiece(gameState, playDropCallback, physicsCallbacks);
}

/**
 * Locks the current piece in place and starts physics processing
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function lockPiece(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState.currentPiece) return;

    if (playDropCallback) playDropCallback();

    // Add piece to locked pieces with unique ID
    gameState.lockedPieces.push({
        ...gameState.currentPiece,
        shape: [...gameState.currentPiece.shape],
        pieceId: Date.now() + Math.random()
    });

    gameState.currentPiece = null;
    gameState.dropCounter = 0;

    // Start physics processing
    if (physicsCallbacks) {
        gameState.isProcessingPhysics = true;
        processPhysics(gameState, physicsCallbacks).then(() => {
            gameState.isProcessingPhysics = false;
            // Spawn next piece after physics is complete
            if (physicsCallbacks.spawnPiece) {
                physicsCallbacks.spawnPiece();
            }
        });
    }
}

/**
 * Main game loop function
 * @param {number} time - Current timestamp from requestAnimationFrame
 * @param {GameState} gameState - Current game state
 * @param {Function} drawCallback - Function to draw the game
 * @param {Function} updateStatsCallback - Function to update stats display
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function gameLoop(time, gameState, drawCallback, updateStatsCallback, playDropCallback, physicsCallbacks) {
    if (gameState.isGameOver) return;

    if (gameState.isPaused) {
        gameState.animationId = requestAnimationFrame((t) =>
            gameLoop(t, gameState, drawCallback, updateStatsCallback, playDropCallback, physicsCallbacks)
        );
        return;
    }

    const delta = time - gameState.lastTime;
    gameState.lastTime = time;

    // Auto drop
    if (!gameState.isProcessingPhysics && gameState.currentPiece) {
        gameState.dropCounter += delta;
        if (gameState.dropCounter > gameState.dropInterval) {
            softDrop(gameState, playDropCallback, physicsCallbacks);
        }
    }

    if (drawCallback) drawCallback();
    if (updateStatsCallback) updateStatsCallback();

    gameState.animationId = requestAnimationFrame((t) =>
        gameLoop(t, gameState, drawCallback, updateStatsCallback, playDropCallback, physicsCallbacks)
    );
}

/**
 * Starts a new game
 * @param {GameState} gameState - Game state to reset
 * @param {Object} callbacks - Object containing callback functions:
 *   - onStart: Called when game starts
 *   - updateStats: Updates stats display
 *   - spawnPiece: Spawns first piece
 *   - setBackground: Sets initial background
 *   - startRandomThemeChanger: Starts random theme changes (if enabled)
 * @param {Object} settings - Game settings
 */
export function startGame(gameState, callbacks, settings) {
    // Reset game state
    gameState.reset();
    gameState.lastTime = performance.now();

    // Cancel existing animation frame
    if (gameState.animationId) {
        cancelAnimationFrame(gameState.animationId);
    }

    // Initialize bags and spawn first piece
    fillBag(gameState.nextPieces);
    if (callbacks.updateStats) callbacks.updateStats();
    if (callbacks.spawnPiece) callbacks.spawnPiece();

    // Set background
    if (settings && settings.backgroundMode === 'Specific' && settings.backgroundTheme) {
        if (callbacks.setBackground) callbacks.setBackground(settings.backgroundTheme);
    } else {
        if (callbacks.setBackground) callbacks.setBackground('forest');
    }

    // Start random theme changer if enabled
    if (settings && settings.backgroundMode === 'Random' && callbacks.startRandomThemeChanger) {
        callbacks.startRandomThemeChanger();
    }

    // Start game loop
    if (callbacks.onStart) callbacks.onStart();
}

/**
 * Pauses the game
 * @param {GameState} gameState - Current game state
 */
export function pauseGame(gameState) {
    if (gameState.isGameOver) return;
    gameState.isPaused = true;
}

/**
 * Resumes the game
 * @param {GameState} gameState - Current game state
 */
export function resumeGame(gameState) {
    if (gameState.isGameOver) return;
    gameState.isPaused = false;
    gameState.lastTime = performance.now();
}

/**
 * Handles game over state
 * @param {GameState} gameState - Current game state
 * @param {Object} callbacks - Callbacks for game over handling
 */
export async function gameOver(gameState, callbacks) {
    gameState.isGameOver = true;

    if (callbacks.stopRandomThemeChanger) {
        callbacks.stopRandomThemeChanger();
    }

    if (callbacks.playGameOver) {
        callbacks.playGameOver();
    }

    if (callbacks.onGameOver) {
        await callbacks.onGameOver(gameState);
    }
}
