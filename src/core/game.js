/**
 * @fileoverview Main game loop and state management for Serenity Blocks
 * Handles game state, piece movement, rotation, dropping, and game flow
 */

import {
    COLS, ROWS, HIDDEN_ROWS, SHAPES, COLORS, LEVEL_SPEEDS, PIECE_KEYS,
} from './constants.js';
import { generateBoard, createBoardGrid, rebuildBoardGridFromPieces } from './board.js';
import { processPhysics } from './physics.js';
import { piecePool } from '../utils/object-pool.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { createInfinityGrid } from './infinity-grid.js';

function createComboState() {
    return {
        depth: 0,
        complexity: 0,
        sendForClean: false,
        holeMask: [],
        lockFootprint: [],
        manualColumns: [],
        sourceColor: null,
        sourcePiece: null,
        sequence: 0,
    };
}

function ensureBoardCache(gameState) {
    if (!gameState) return null;

    if (!gameState.boardCache || gameState.boardCacheDirty) {
        gameState.boardCache = generateBoard(gameState.lockedPieces, {
            boardGrid: gameState.boardGrid,
        });
        gameState.boardCacheDirty = false;
    }

    return gameState.boardCache;
}

function isValidPositionCached(gameState, piece, checkX, checkY) {
    if (!piece) return false;

    const boardData = ensureBoardCache(gameState);

    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] > 0) {
                const boardX = checkX + x;
                const boardY = checkY + y;

                if (boardX < 0 || boardX >= COLS || boardY >= boardData.length) {
                    return false;
                }

                if (boardY >= 0 && boardData[boardY] && boardData[boardY][boardX] !== null) {
                    return false;
                }
            }
        }
    }

    return true;
}

export function markBoardDirty(gameState) {
    if (gameState) {
        gameState.boardCacheDirty = true;
    }
}

export function canPlacePiece(gameState, piece, checkX, checkY) {
    return isValidPositionCached(gameState, piece, checkX, checkY);
}

export function getGhostLandingY(gameState) {
    if (!gameState || !gameState.currentPiece) return 0;

    const piece = gameState.currentPiece;
    let ghostY = piece.y;

    while (canPlacePiece(gameState, piece, piece.x, ghostY + 1)) {
        ghostY++;
    }

    return ghostY;
}

/**
 * Game state object that holds all game data
 */
export class GameState {
    constructor(options = {}) {
        // Infinity mode configuration
        this.isInfinityMode = options.isInfinityMode || false;
        this.maxRows = options.maxRows || 1000;
        this.disableLevelProgression = options.disableLevelProgression || false;
        this.disableGarbage = options.disableGarbage || false;
        this.initialInfinityRows = options.initialInfinityRows || ROWS + HIDDEN_ROWS;

        // Infinity mode tracking
        this.currentTopRow = 0; // Highest row with blocks
        this.cameraRow = 0; // Current camera viewport offset

        // Pieces
        this.lockedPieces = [];
        this.currentPiece = null;
        this.nextPieces = [];
        this.randomGenerator = Math.random;

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
        this.isAlive = true; // For multiplayer: tracks if player is still in the round

        // Input
        this.inputQueue = null;

        // Animation
        this.animationId = null;

        // Board reference (for visual feedback during line clears)
        this.board = null;
        this.boardCache = null;
        this.boardCacheDirty = true;

        // Initialize board grid based on mode
        if (this.isInfinityMode) {
            const infinityGrid = createInfinityGrid(COLS, this.initialInfinityRows);
            this.boardGrid = infinityGrid;
            this.board = infinityGrid;
            console.log('[GameState] Initialized infinity grid:', this.boardGrid.length, 'rows');
        } else {
            this.boardGrid = createBoardGrid();
        }

        // Infinity mode statistics
        if (this.isInfinityMode) {
            this.infinityStats = {
                maxComboDepth: 0,
                maxComboComplexity: 0,
                totalCascades: 0,
                rowsReached: 0,
                blocksPlaced: 0,
                sessionStartTime: Date.now(),
            };
        }

        // Quadra-style garbage: Track last placed piece columns for deterministic holes
        this.lastPlacedPieceX = [];

        // Quadra-style combo tracking state for deterministic garbage payloads
        this.comboState = createComboState();

        // Store ongoing blind timers for attacks that affect visibility
        this.blindTimers = {
            field: 0,
            pending: 0,
        };

        // Deterministic sequence counter for outbound garbage attacks
        this.garbageAttackSequence = 0;

        // Quadra-style handicap system (net_version 24)
        this.handicap = 2; // 0=Beginner, 1=Apprentice, 2=Intermediate, 3=Master, 4=Grandmaster
        this.handicaps = {}; // Stamps per opponent: { opponentId: stampCount }
        this.handicapCrowd = 0; // Crowd handicap stamps (for 5+ players)
    }

    /**
     * Resets the game state to initial values
     */
    reset() {
        this.lockedPieces = [];
        if (this.currentPiece) {
            piecePool.release(this.currentPiece);
        }
        this.currentPiece = null;
        this.nextPieces = [];
        this.randomGenerator = Math.random;
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.linesUntilNextLevel = 10;
        this.dropInterval = LEVEL_SPEEDS[0];
        this.dropCounter = 0;
        this.piecesPlaced = 0;
        this.isGameOver = false;
        this.isProcessingPhysics = false;
        this.isAlive = true;
        this.inputQueue = null;
        this.startTime = Date.now();
        this.boardCache = null;
        this.boardCacheDirty = true;
        if (this.isInfinityMode) {
            const infinityGrid = createInfinityGrid(COLS, this.initialInfinityRows);
            this.boardGrid = infinityGrid;
            this.board = infinityGrid;
        } else {
            this.board = null;
            this.boardGrid = createBoardGrid();
        }
        this.lastPlacedPieceX = [];
        this.comboState = createComboState();
        this.blindTimers = {
            field: 0,
            pending: 0,
        };
        this.garbageAttackSequence = 0;
        this.handicap = 2;
        this.handicaps = {};
        this.handicapCrowd = 0;
    }
}

/**
 * Fills the next pieces bag using 7-bag randomizer
 * @param {Array<string>} nextPieces - Next pieces array to fill
 */
function shuffleBag(rng) {
    const bag = [...PIECE_KEYS];
    for (let i = bag.length - 1; i > 0; i--) {
        const randomValue = typeof rng === 'function' ? rng() : Math.random();
        const j = Math.floor(randomValue * (i + 1));
        const swapIndex = Math.max(0, Math.min(i, j));
        const temp = bag[i];
        bag[i] = bag[swapIndex];
        bag[swapIndex] = temp;
    }
    return bag;
}

export function fillBag(nextPieces, rng = Math.random) {
    while (nextPieces.length < 10) {
        const bag = shuffleBag(rng);
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

    if (!shapeKey || !shape) {
        return;
    }

    if (gameState.currentPiece) {
        piecePool.release(gameState.currentPiece);
    }

    const piece = piecePool.acquire();
    piece.shapeKey = shapeKey;
    piece.type = shapeKey;
    piece.shape = shape;
    piece.x = Math.floor(COLS / 2) - Math.floor(shape[0].length / 2);

    // Infinity Mode: spawn pieces at the top of the current viewport (where camera is looking)
    // Standard Mode: spawn at fixed position (HIDDEN_ROWS - 2)
    if (gameState.isInfinityMode) {
        // Spawn at the camera's current top row (or slightly above it)
        // This ensures pieces always spawn just above the visible area
        const cameraTopRow = gameState.cameraRow || 0;
        const spawnOffset = 2; // Spawn 2 rows above the camera's top edge
        piece.y = Math.max(0, cameraTopRow - spawnOffset);
    } else {
        piece.y = HIDDEN_ROWS - 2; // Spawn 2 rows above visible area for smooth drop-in animation
    }

    piece.color = COLORS[shapeKey];

    gameState.currentPiece = piece;
    
    // Reset drop counter for new piece (CRITICAL for gravity!)
    gameState.dropCounter = 0;

    const rng = typeof gameState.randomGenerator === 'function' ? gameState.randomGenerator : Math.random;
    fillBag(gameState.nextPieces, rng);
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
    // In Infinity Mode, game over is handled separately by checkInfinityGameOver
    // Don't trigger game over here for Infinity Mode
    if (!gameState.isInfinityMode) {
        if (!canPlacePiece(
            gameState,
            gameState.currentPiece,
            gameState.currentPiece.x,
            gameState.currentPiece.y,
        )) {
            if (gameOverCallback) gameOverCallback();
        }
    }
}

/**
 * Moves the current piece horizontally
 * @param {GameState} gameState - Current game state
 * @param {number} dir - Direction to move (-1 for left, 1 for right)
 * @param {Function} playSoundCallback - Callback to play move sound
 * @param {Function} addTrailCallback - Callback to add piece trail
 * @returns {boolean} True if move was successful
 */
export function move(gameState, dir, playSoundCallback, addTrailCallback) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    if (canPlacePiece(
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x + dir,
        gameState.currentPiece.y,
    )) {
        // Add trail before moving
        if (addTrailCallback) addTrailCallback(gameState.currentPiece);

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
 * @param {Function} addTrailCallback - Callback to add piece trail
 * @returns {boolean} True if rotation was successful
 */
export function rotate(gameState, dir = 'right', playSoundCallback, addTrailCallback) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    // Add trail before rotating
    if (addTrailCallback) addTrailCallback(gameState.currentPiece);

    const originalShape = gameState.currentPiece.shape;
    let rotatedShape;

    if (dir === 'right') {
        // Rotate clockwise
        rotatedShape = originalShape[0].map((_, i) => originalShape.map((row) => row[i]).reverse());
    } else if (dir === 'left') {
        // Rotate counter-clockwise
        rotatedShape = originalShape[0].map((_, i) => originalShape.map((row) => row[i])).reverse();
    } else {
        // Flip 180 degrees
        rotatedShape = originalShape.map((row) => row.slice().reverse()).reverse();
    }

    gameState.currentPiece.shape = rotatedShape;

    // Wall kick: try offsets 0, 1, -1, 2, -2
    for (const kick of [0, 1, -1, 2, -2]) {
        if (canPlacePiece(
            gameState,
            gameState.currentPiece,
            gameState.currentPiece.x + kick,
            gameState.currentPiece.y,
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

    if (canPlacePiece(
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,
    )) {
        gameState.currentPiece.y++;
        gameState.score += gameState.level;
        gameState.dropCounter = 0;
        return true;
    }
    lockPiece(gameState, playDropCallback, physicsCallbacks);
    return false;
}

/**
 * Hard drop - instantly drops piece to bottom
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function hardDrop(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return;

    if (physicsCallbacks?.onHardDrop) {
        physicsCallbacks.onHardDrop();
    }

    let distance = 0;
    while (canPlacePiece(
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,
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

    // Store piece reference before nulling for ripple effect
    const lockedPiece = gameState.currentPiece;

    if (playDropCallback) playDropCallback();

    // Trigger lock ripple effect
    const lockedPieceSnapshot = {
        ...lockedPiece,
        shape: lockedPiece.shape.map((row) => row.slice()),
        pieceId: Date.now() + Math.random(),
    };

    if (physicsCallbacks && physicsCallbacks.onPieceLock) {
        physicsCallbacks.onPieceLock(lockedPieceSnapshot);
    }

    // Calculate and store the occupied columns of the piece (for Quadra-style garbage)
    // We track ALL columns where the piece has blocks for accurate garbage holes
    const occupiedColumns = new Set();
    const lockFootprint = [];
    gameState.currentPiece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
            if (cell > 0) {
                const boardX = gameState.currentPiece.x + localX;
                const boardY = gameState.currentPiece.y + localY;
                if (boardX >= 0 && boardX < COLS) {
                    occupiedColumns.add(boardX);
                }
                if (boardY >= 0 && boardY < ROWS + HIDDEN_ROWS && boardX >= 0 && boardX < COLS) {
                    lockFootprint.push({ x: boardX, y: boardY });
                }
            }
        });
    });
    gameState.lastPlacedPieceX = Array.from(occupiedColumns).sort((a, b) => a - b);

    // Reset combo tracking for the upcoming physics resolution
    const comboState = createComboState();
    comboState.lockFootprint = lockFootprint;
    comboState.manualColumns = [...gameState.lastPlacedPieceX];
    comboState.sourceColor = lockedPieceSnapshot.color || COLORS[lockedPieceSnapshot.shapeKey] || '#808080';
    comboState.sourcePiece = lockedPieceSnapshot.shapeKey;
    comboState.sequence = gameState.garbageAttackSequence++;
    gameState.comboState = comboState;

    // Add piece to locked pieces with unique ID
    gameState.lockedPieces.push(lockedPieceSnapshot);
    markBoardDirty(gameState);
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    piecePool.release(lockedPiece);
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
export function gameLoop(
    time,
    gameState,
    drawCallback,
    updateStatsCallback,
    playDropCallback,
    physicsCallbacks,
) {
    const monitoring = performanceMonitor && performanceMonitor.enabled;
    if (monitoring) {
        performanceMonitor.updateStart();
    }

    if (gameState.isGameOver) {
        if (monitoring) {
            performanceMonitor.updateEnd();
        }
        return;
    }

    if (gameState.isPaused) {
        if (monitoring) {
            performanceMonitor.updateEnd();
        }
        gameState.animationId = requestAnimationFrame((t) => gameLoop(
            t,
            gameState,
            drawCallback,
            updateStatsCallback,
            playDropCallback,
            physicsCallbacks,
        ));
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

    if (monitoring) {
        performanceMonitor.updateEnd();
        performanceMonitor.renderStart();
    }

    if (drawCallback) drawCallback();
    if (monitoring) {
        performanceMonitor.renderEnd();
    }
    if (updateStatsCallback) updateStatsCallback();

    gameState.animationId = requestAnimationFrame((t) => gameLoop(
        t,
        gameState,
        drawCallback,
        updateStatsCallback,
        playDropCallback,
        physicsCallbacks,
    ));
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

    // Initialize bag and spawn first piece
    const rng = typeof gameState.randomGenerator === 'function' ? gameState.randomGenerator : Math.random;
    fillBag(gameState.nextPieces, rng);
    if (callbacks.updateStats) callbacks.updateStats();
    if (callbacks.spawnPiece) callbacks.spawnPiece();

    // Set background
    if (settings && settings.backgroundMode === 'Specific' && settings.backgroundTheme) {
        if (callbacks.setBackground) callbacks.setBackground(settings.backgroundTheme);
    } else if (callbacks.setBackground) callbacks.setBackground('forest');

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
