/**
 * @fileoverview Main game loop and state management for Serenity Blocks
 * Handles game state, piece movement, rotation, dropping, and game flow
 */

import {
    COLS,
    ROWS,
    HIDDEN_ROWS,
    SHAPES,
    COLORS,
    LEVEL_SPEEDS,
    PIECE_KEYS,
    LOCK_DELAY_MS,
    LOCK_RESET_LIMIT,
} from './constants.js';
import { generateBoard, createBoardGrid, rebuildBoardGridFromPieces } from './board.js';
import { processPhysics } from './physics.js';
import { piecePool } from '../utils/object-pool.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { createInfinityGrid } from './infinity-grid.js';

function resolveActiveTetrominoColor(shapeKey) {
    const defaultColor = COLORS[shapeKey] || '#808080';

    if (typeof window === 'undefined') {
        return defaultColor;
    }

    const { settingsManager } = window;
    const { themeManager } = window;
    const settings = settingsManager?.get?.();
    const themeBasedEnabled = settings?.themeBasedTetrominos ?? true;

    if (!themeBasedEnabled || !themeManager?.activeTheme?.getTetrominoConfig) {
        return defaultColor;
    }

    const config = themeManager.activeTheme.getTetrominoConfig();
    if (!config) {
        return defaultColor;
    }

    return config.colors?.[shapeKey] || defaultColor;
}

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

// Pre-allocated buffers for piece lock hot path (avoids per-lock GC pressure)
let _pieceIdCounter = 0;
const _columnFlags = new Uint8Array(COLS); // boolean flags for occupied columns

function ensureBoardCache(gameState) {
    if (!gameState) return null;

    if (!gameState.boardCache || gameState.boardCacheDirty) {
        const lockedPieces = gameState.lockedPieces || [];
        const { boardGrid } = gameState;

        if (boardGrid && lockedPieces.length > 0 && !hasLockedCells(boardGrid)) {
            rebuildBoardGridFromPieces(lockedPieces, boardGrid);
        }

        if (gameState.isInfinityMode && boardGrid && gameState.board !== boardGrid) {
            gameState.board = boardGrid;
        }

        gameState.boardCache = generateBoard(lockedPieces, {
            boardGrid,
        });
        gameState.boardCacheDirty = false;
    }

    return gameState.boardCache;
}

function invalidateGhostCache(gameState) {
    if (!gameState) return;
    if (!gameState.ghostCache) {
        gameState.ghostCache = { piece: null, y: 0 };
    }
    gameState.ghostCacheDirty = true;
    gameState.ghostCache.piece = null;
}

function hasLockedCells(grid) {
    if (!grid) return false;
    for (let y = 0; y < grid.length; y++) {
        const row = grid[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
            if (row[x] !== null) {
                return true;
            }
        }
    }
    return false;
}

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function rotateShapeMatrix(shape, dir = 'right') {
    if (dir === 'right') {
        return shape[0].map((_, i) => shape.map((row) => row[i]).reverse());
    }
    if (dir === 'left') {
        return shape[0].map((_, i) => shape.map((row) => row[i])).reverse();
    }
    return shape.map((row) => row.slice().reverse()).reverse();
}

const ROTATION_STEP = {
    right: 1,
    left: -1,
    flip: 2,
};

const ROTATION_NAMES = ['0', 'R', '2', 'L'];
const LEGACY_WALL_KICKS = [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0]];

const JLSTZ_KICKS = {
    '0>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    'R>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    'R>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    'L>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    'L>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const I_KICKS = {
    '0>R': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    'R>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    'R>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>R': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>L': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    'L>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    'L>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>L': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

function getLockDelay(gameState) {
    const configured = Number(gameState?.lockDelay);
    return Number.isFinite(configured) ? Math.max(0, configured) : LOCK_DELAY_MS;
}

function getLockResetLimit(gameState) {
    const configured = Number(gameState?.lockResetLimit);
    return Number.isFinite(configured) ? Math.max(0, configured) : LOCK_RESET_LIMIT;
}

function resetLockState(gameState) {
    if (!gameState) return;
    gameState.lockTimer = 0;
    gameState.lockResetCount = 0;
    gameState.isGrounded = false;
    gameState.lockGroundedSince = null;
}

function isCurrentPieceGrounded(gameState) {
    return Boolean(
        gameState?.currentPiece
        && !canPlacePiece(
            gameState,
            gameState.currentPiece,
            gameState.currentPiece.x,
            gameState.currentPiece.y + 1,
        ),
    );
}

function updateGroundedState(gameState, delta = 0) {
    if (!gameState?.currentPiece) {
        resetLockState(gameState);
        return false;
    }

    const grounded = isCurrentPieceGrounded(gameState);
    if (!grounded) {
        gameState.lockTimer = 0;
        gameState.isGrounded = false;
        gameState.lockGroundedSince = null;
        return false;
    }

    if (!gameState.isGrounded) {
        gameState.isGrounded = true;
        gameState.lockTimer = 0;
        gameState.lockGroundedSince = gameState.lastTime || 0;
    }

    if (Number.isFinite(delta) && delta > 0) {
        gameState.lockTimer += delta;
    }

    return true;
}

function maybeResetLockDelay(gameState, wasGrounded) {
    if (!gameState?.currentPiece || !wasGrounded) return;

    if (!isCurrentPieceGrounded(gameState)) {
        gameState.lockTimer = 0;
        gameState.isGrounded = false;
        gameState.lockGroundedSince = null;
        return;
    }

    if (gameState.lockResetCount < getLockResetLimit(gameState)) {
        gameState.lockTimer = 0;
        gameState.lockResetCount += 1;
        gameState.isGrounded = true;
        gameState.lockGroundedSince = gameState.lastTime || 0;
    }
}

function shouldLockGroundedPiece(gameState) {
    return getLockDelay(gameState) <= 0
        || gameState.lockTimer >= getLockDelay(gameState)
        || gameState.lockResetCount >= getLockResetLimit(gameState);
}

function applyBufferedInputs(gameState) {
    if (!gameState?.inputQueue) return;

    const queuedInputs = Array.isArray(gameState.inputQueue)
        ? gameState.inputQueue.splice(0, 4)
        : [gameState.inputQueue];
    gameState.inputQueue = null;

    for (const action of queuedInputs) {
        if (
            gameState.isPaused
            || gameState.isGameOver
            || gameState.isProcessingPhysics
            || !gameState.currentPiece
        ) {
            return;
        }

        if (action.type === 'move') move(gameState, action.dir);
        else if (action.type === 'rotate') rotate(gameState, action.dir);
    }
}

function createActivePiece(gameState, shapeKey) {
    const shape = SHAPES[shapeKey];
    if (!shape) return null;

    const piece = piecePool.acquire();
    piece.shapeKey = shapeKey;
    piece.type = shapeKey;
    piece.shape = cloneShape(shape);
    piece.rotation = 0;
    piece.x = Math.floor(COLS / 2) - Math.floor(shape[0].length / 2);

    if (gameState.isInfinityMode) {
        const cameraTopRow = gameState.cameraRow || 0;
        const spawnOffset = 2;
        piece.y = Math.max(0, Math.floor(cameraTopRow) - spawnOffset);
    } else {
        piece.y = HIDDEN_ROWS - 2;
    }

    piece.color = resolveActiveTetrominoColor(shapeKey);
    return piece;
}

function isValidPositionCached(gameState, piece, checkX, checkY) {
    if (!piece) return false;

    const boardData = ensureBoardCache(gameState);

    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] > 0) {
                const boardX = Math.floor(checkX + x);
                const boardY = Math.floor(checkY + y);

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
        // Increment board version for rendering change detection
        // This allows the renderer to know when the board content has changed
        gameState.boardVersion = (gameState.boardVersion || 0) + 1;
        invalidateGhostCache(gameState);
    }
}

export function canPlacePiece(gameState, piece, checkX, checkY) {
    return isValidPositionCached(gameState, piece, checkX, checkY);
}

export function getGhostLandingY(gameState) {
    if (!gameState || !gameState.currentPiece) return 0;

    if (!gameState.ghostCache) {
        gameState.ghostCache = { piece: null, y: 0 };
        gameState.ghostCacheDirty = true;
    }

    if (gameState.ghostCacheDirty === false && gameState.ghostCache.piece === gameState.currentPiece) {
        return gameState.ghostCache.y;
    }

    const piece = gameState.currentPiece;
    let ghostY = piece.y;

    while (canPlacePiece(gameState, piece, piece.x, ghostY + 1)) {
        ghostY++;
    }

    gameState.ghostCache.y = ghostY;
    gameState.ghostCache.piece = piece;
    gameState.ghostCacheDirty = false;

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
        this.linesUntilNextLevel = 15; // Quadra: 15 lines per level

        // Detailed Stats
        this.pieceCounts = {
            I: 0, J: 0, L: 0, O: 0, S: 0, T: 0, Z: 0,
        };
        this.lineClearCounts = {
            1: 0, 2: 0, 3: 0, 4: 0,
        };

        // Timing
        this.dropInterval = LEVEL_SPEEDS[0];
        this.dropCounter = 0;
        this.lastTime = 0;
        this.startTime = Date.now();
        this.piecesPlaced = 0;
        this.lockDelay = options.lockDelay ?? LOCK_DELAY_MS;
        this.lockResetLimit = options.lockResetLimit ?? LOCK_RESET_LIMIT;
        this.lockTimer = 0;
        this.lockResetCount = 0;
        this.isGrounded = false;
        this.lockGroundedSince = null;

        // Flags
        this.isGameOver = false;
        this.isPaused = false;
        this.hitStopRemaining = 0; // Tracks remaining hit-stop (impact freeze) milliseconds
        this.isProcessingPhysics = false;
        this.isStopped = false;
        this.isAlive = true; // For multiplayer: tracks if player is still in the round

        // Victory Lap System (Odyssey Mode)
        this.goalComplete = false; // True when primary goal is met
        this.victoryLapActive = false; // True when in victory lap phase
        this.victoryLapStartTime = null; // Timestamp when victory lap began

        // Input
        this.inputQueue = null;

        // Animation
        this.animationId = null;

        // Board reference (for visual feedback during line clears)
        this.board = null;
        this.boardCache = null;
        this.boardCacheDirty = true;
        this.ghostCache = { piece: null, y: 0 };
        this.ghostCacheDirty = true;

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
                maxCombo: 0,
                maxCascadeScore: 0, // Best score from a single cascade sequence
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
        this.linesUntilNextLevel = 15; // Quadra: 15 lines per level
        this.dropInterval = LEVEL_SPEEDS[0];
        this.dropCounter = 0;
        this.piecesPlaced = 0;
        this.pieceCounts = {
            I: 0, J: 0, L: 0, O: 0, S: 0, T: 0, Z: 0,
        };
        this.lineClearCounts = {
            1: 0, 2: 0, 3: 0, 4: 0,
        };
        resetLockState(this);
        this.isGameOver = false;
        this.isStopped = false;
        this.hitStopRemaining = 0;
        this.isProcessingPhysics = false;
        this.isAlive = true;
        this.inputQueue = null;
        this.startTime = Date.now();
        this.boardCache = null;
        this.boardCacheDirty = true;
        this.ghostCache = { piece: null, y: 0 };
        this.ghostCacheDirty = true;
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

    /**
     * Getter for totalLinesCleared - aliases this.lines for multiplayer compatibility
     * Multiplayer code expects totalLinesCleared but GameState uses lines
     */
    get totalLinesCleared() {
        return this.lines;
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
    if (!gameState || gameState.isGameOver || gameState.isStopped) return null;

    const shapeKey = gameState.nextPieces.shift();
    const piece = createActivePiece(gameState, shapeKey);

    if (!shapeKey || !piece) {
        return null;
    }

    if (gameState.pieceCounts) {
        gameState.pieceCounts[shapeKey] = (gameState.pieceCounts[shapeKey] || 0) + 1;
    }

    if (gameState.currentPiece) {
        piecePool.release(gameState.currentPiece);
    }

    gameState.currentPiece = piece;
    invalidateGhostCache(gameState);
    resetLockState(gameState);

    // Track when piece spawned for Quadra time-based lock bonus
    gameState.pieceSpawnTime = performance.now();

    // Reset drop counter for new piece (CRITICAL for gravity!)
    gameState.dropCounter = 0;

    const rng = typeof gameState.randomGenerator === 'function' ? gameState.randomGenerator : Math.random;
    fillBag(gameState.nextPieces, rng);
    if (drawNextPiecesCallback) drawNextPiecesCallback();
    gameState.piecesPlaced++;

    // Check if piece can spawn (game over condition)
    if (!canPlacePiece(
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y,
    )) {
        gameState.isGameOver = true;
        if (gameOverCallback) gameOverCallback();
        return null;
    }

    applyBufferedInputs(gameState);

    return piece;
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
    if (
        !gameState?.currentPiece
        || gameState.isProcessingPhysics
        || gameState.isPaused
        || gameState.isGameOver
    ) return false;

    const wasGrounded = isCurrentPieceGrounded(gameState);

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
        invalidateGhostCache(gameState);
        maybeResetLockDelay(gameState, wasGrounded);
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
    if (
        !gameState?.currentPiece
        || gameState.isProcessingPhysics
        || gameState.isPaused
        || gameState.isGameOver
    ) return false;

    // Add trail before rotating
    if (addTrailCallback) addTrailCallback(gameState.currentPiece);

    const piece = gameState.currentPiece;
    const wasGrounded = isCurrentPieceGrounded(gameState);
    if (piece.shapeKey === 'O' && dir !== 'flip') {
        if (playSoundCallback) playSoundCallback();
        maybeResetLockDelay(gameState, wasGrounded);
        return true;
    }

    const step = ROTATION_STEP[dir] ?? ROTATION_STEP.right;
    const fromRotation = piece.rotation ?? 0;
    const toRotation = (fromRotation + step + 4) % 4;
    const originalShape = piece.shape;
    const originalX = piece.x;
    const originalY = piece.y;

    const tryBoardOffsetKicks = (kicksToTry) => {
        for (const [dx, dy] of kicksToTry) {
            if (canPlacePiece(gameState, piece, originalX + dx, originalY + dy)) {
                piece.x = originalX + dx;
                piece.y = originalY + dy;
                if (playSoundCallback) playSoundCallback();
                invalidateGhostCache(gameState);
                maybeResetLockDelay(gameState, wasGrounded);
                return true;
            }
        }

        return false;
    };

    const rotatedShape = rotateShapeMatrix(originalShape, dir);
    if (dir === 'flip') {
        // 180-degree rotation has no SRS kick table in guideline play; allow the
        // old horizontal probes so existing "flip" bindings remain useful.
        const originalRotation = piece.rotation;
        piece.shape = rotatedShape;
        piece.rotation = toRotation;
        if (tryBoardOffsetKicks(LEGACY_WALL_KICKS)) {
            return true;
        }
        piece.shape = originalShape;
        piece.rotation = originalRotation;
        piece.x = originalX;
        piece.y = originalY;
        return false;
    }

    const key = `${ROTATION_NAMES[fromRotation]}>${ROTATION_NAMES[toRotation]}`;
    const kicks = piece.shapeKey === 'I' ? I_KICKS[key] : JLSTZ_KICKS[key];

    piece.shape = rotatedShape;
    piece.rotation = toRotation;

    for (const [dx, dy] of kicks || [[0, 0]]) {
        if (canPlacePiece(
            gameState,
            piece,
            originalX + dx,
            originalY - dy,
        )) {
            piece.x = originalX + dx;
            piece.y = originalY - dy;
            if (playSoundCallback) playSoundCallback();
            invalidateGhostCache(gameState);
            maybeResetLockDelay(gameState, wasGrounded);
            return true;
        }
    }

    // Keep the old edge feel after SRS: if a vertical piece is flush with a side,
    // try the simple horizontal kicks that players expect from earlier builds.
    if (tryBoardOffsetKicks(LEGACY_WALL_KICKS)) {
        return true;
    }

    // Rotation failed, revert
    piece.shape = originalShape;
    piece.rotation = fromRotation;
    piece.x = originalX;
    piece.y = originalY;
    return false;
}

/**
 * Soft drop - moves piece down one row
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 * @param {Object} options - Drop behavior options
 * @param {boolean} options.preserveDropCounter - Keep accumulator remainder for fixed-step auto-drop
 * @returns {boolean} True if piece moved down, false if it locked
 */
export function softDrop(gameState, playDropCallback, physicsCallbacks, options = {}) {
    if (
        !gameState?.currentPiece
        || gameState.isProcessingPhysics
        || gameState.isPaused
        || gameState.isGameOver
    ) return false;
    const { preserveDropCounter = false } = options;

    if (canPlacePiece(
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,
    )) {
        gameState.currentPiece.y++;
        // Quadra: No points for soft drop - only line clears and time-based lock bonus
        if (!preserveDropCounter) {
            gameState.dropCounter = 0;
        }
        invalidateGhostCache(gameState);
        updateGroundedState(gameState, 0);
        return true;
    }

    updateGroundedState(gameState, 0);
    if (shouldLockGroundedPiece(gameState)) {
        lockPiece(gameState, playDropCallback, physicsCallbacks);
    }
    return false;
}

/**
 * Process automatic gravity using a fixed-step accumulator.
 * Preserves elapsed-time remainder so gameplay timing stays stable across FPS.
 *
 * @param {GameState} gameState - Current game state
 * @param {number} delta - Elapsed milliseconds since last update
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function processAutoDrop(gameState, delta, playDropCallback, physicsCallbacks) {
    if (!gameState || !gameState.currentPiece || gameState.isProcessingPhysics) return;
    if (!Number.isFinite(delta) || delta <= 0) return;

    const dropInterval = Math.max(1, Number(gameState.dropInterval) || LEVEL_SPEEDS[0]);
    const MAX_DROP_STEPS_PER_UPDATE = 32;

    if (updateGroundedState(gameState, delta)) {
        if (shouldLockGroundedPiece(gameState)) {
            lockPiece(gameState, playDropCallback, physicsCallbacks);
            gameState.dropCounter = 0;
        } else {
            gameState.dropCounter = Math.min(gameState.dropCounter + delta, dropInterval);
        }
        return;
    }

    gameState.dropCounter += delta;

    let steps = 0;
    while (
        gameState.dropCounter >= dropInterval
        && gameState.currentPiece
        && !gameState.isProcessingPhysics
        && steps < MAX_DROP_STEPS_PER_UPDATE
    ) {
        const moved = softDrop(gameState, playDropCallback, physicsCallbacks, {
            preserveDropCounter: true,
        });

        if (!moved) {
            // Piece locked and physics started. Reset counter for the next spawned piece.
            gameState.dropCounter = 0;
            return;
        }

        gameState.dropCounter -= dropInterval;
        steps++;
    }

    // Prevent huge backlog after long stalls without throwing away normal-frame remainder.
    if (steps >= MAX_DROP_STEPS_PER_UPDATE && gameState.dropCounter > dropInterval * 2) {
        gameState.dropCounter = dropInterval * 2;
    }
}

/**
 * Hard drop - instantly drops piece to bottom
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function hardDrop(gameState, playDropCallback, physicsCallbacks) {
    if (
        !gameState?.currentPiece
        || gameState.isProcessingPhysics
        || gameState.isPaused
        || gameState.isGameOver
    ) return;

    invalidateGhostCache(gameState);

    // Calculate drop start and end positions for VFX
    const startY = gameState.currentPiece.y;
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
    const endY = gameState.currentPiece.y;

    if (physicsCallbacks?.onHardDrop) {
        // Pass drop data to callback for VFX rendering
        physicsCallbacks.onHardDrop({
            piece: gameState.currentPiece,
            startY,
            endY
        });
    }

    // Quadra: No points for hard drop distance - only line clears and time-based lock bonus
    resetLockState(gameState);
    lockPiece(gameState, playDropCallback, physicsCallbacks);
}

/**
 * Locks the current piece in place and starts physics processing
 * @param {GameState} gameState - Current game state
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
export function lockPiece(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState?.currentPiece || gameState.isGameOver) return;

    // Store piece reference before nulling for ripple effect
    const lockedPiece = gameState.currentPiece;

    // Quadra-style time-based lock bonus: max(0, 100-frames)/2
    // Faster piece placements earn more points (up to 50 for instant lock)
    // One frame ≈ 16.67ms at 60fps
    if (gameState.pieceSpawnTime) {
        const timeHeldMs = performance.now() - gameState.pieceSpawnTime;
        const framesElapsed = timeHeldMs / 16.67;
        const lockBonus = Math.max(0, Math.floor((100 - framesElapsed) / 2));
        gameState.score += lockBonus;
    }

    if (playDropCallback) playDropCallback();

    // Trigger lock ripple effect
    const themedColor = resolveActiveTetrominoColor(lockedPiece.shapeKey);
    const lockedPieceSnapshot = {
        ...lockedPiece,
        shape: lockedPiece.shape.map((row) => row.slice()),
        pieceId: ++_pieceIdCounter,
        color: themedColor,
    };

    if (physicsCallbacks && physicsCallbacks.onPieceLock) {
        physicsCallbacks.onPieceLock(lockedPieceSnapshot);
    }

    // Calculate occupied columns and lock footprint with minimal allocations
    // Uses pre-allocated _columnFlags instead of new Set() + Array.from().sort()
    _columnFlags.fill(0);
    const lockFootprint = [];
    const boardHeight = gameState.boardGrid?.length || (ROWS + HIDDEN_ROWS);
    const shape = gameState.currentPiece.shape;
    const pieceX = gameState.currentPiece.x;
    const pieceY = gameState.currentPiece.y;
    for (let localY = 0; localY < shape.length; localY++) {
        const row = shape[localY];
        for (let localX = 0; localX < row.length; localX++) {
            if (row[localX] > 0) {
                const boardX = pieceX + localX;
                const boardY = pieceY + localY;
                if (boardX >= 0 && boardX < COLS) {
                    _columnFlags[boardX] = 1;
                }
                if (boardY >= 0 && boardY < boardHeight && boardX >= 0 && boardX < COLS) {
                    lockFootprint.push({ x: boardX, y: boardY });
                }
            }
        }
    }
    // Build sorted column array from flags (already in order, no sort needed)
    const sortedColumns = [];
    for (let c = 0; c < COLS; c++) {
        if (_columnFlags[c]) sortedColumns.push(c);
    }
    gameState.lastPlacedPieceX = sortedColumns;

    // Reset combo tracking for the upcoming physics resolution
    const comboState = createComboState();
    comboState.lockFootprint = lockFootprint;
    comboState.manualColumns = sortedColumns;
    comboState.sourceColor = themedColor;
    comboState.sourcePiece = lockedPieceSnapshot.shapeKey;
    comboState.sequence = gameState.garbageAttackSequence++;
    gameState.comboState = comboState;

    // Add piece to locked pieces with unique ID
    gameState.lockedPieces.push(lockedPieceSnapshot);
    markBoardDirty(gameState);
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    piecePool.release(lockedPiece);
    gameState.currentPiece = null;
    invalidateGhostCache(gameState);
    gameState.dropCounter = 0;
    resetLockState(gameState);

    // Start physics processing
    if (physicsCallbacks) {
        gameState.isProcessingPhysics = true;
        gameState.latestPhysicsPromise = processPhysics(gameState, physicsCallbacks)
            .then(() => {
                gameState.isProcessingPhysics = false;
                if (
                    !gameState.isGameOver
                    && !gameState.isStopped
                    && physicsCallbacks.spawnPiece
                ) {
                    try {
                        physicsCallbacks.spawnPiece();
                    } catch (error) {
                        console.error('[Game] spawnPiece failed after physics:', error);
                    }
                }
            })
            .catch((error) => {
                console.error('[Game] Physics processing failed:', error);
                gameState.isProcessingPhysics = false;
                markBoardDirty(gameState);
                if (
                    !gameState.isGameOver
                    && !gameState.isStopped
                    && physicsCallbacks.spawnPiece
                ) {
                    try {
                        physicsCallbacks.spawnPiece();
                    } catch (spawnError) {
                        console.error('[Game] Recovery spawn failed after physics error:', spawnError);
                    }
                }
            });
    }
}

// SAFETY: Track active RAF loops to detect duplicates
let activeLoopCount = 0;
const MAX_CONCURRENT_LOOPS = 2; // Allow 1-2 loops max (safety margin)

/**
 * Main game loop function
 * @param {number} time - Current timestamp from requestAnimationFrame
 * @param {GameState} gameState - Current game state
 * @param {Function} drawCallback - Function to draw the game
 * @param {Function} updateStatsCallback - Function to update stats display
 * @param {Function} playDropCallback - Callback to play drop sound
 * @param {Object} physicsCallbacks - Callbacks for physics processing
 */
/**
 * Core game update logic (separated from loop for external control)
 * @param {number} time - Current timestamp
 * @param {GameState} gameState - Current game state
 * @param {Object} callbacks - Callbacks for draw, stats, sound, physics
 */
export function updateGame(time, gameState, callbacks) {
    const {
        drawCallback, updateStatsCallback, playDropCallback, physicsCallbacks,
    } = callbacks;
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

    // PERFORMANCE FIX: Process game logic only when not paused
    if (!gameState.isPaused) {
        const delta = time - gameState.lastTime;
        gameState.lastTime = time;

        if (gameState.hitStopRemaining > 0) {
            gameState.hitStopRemaining = Math.max(0, gameState.hitStopRemaining - delta);
            if (drawCallback) drawCallback();
            if (updateStatsCallback) updateStatsCallback();
            if (monitoring) {
                performanceMonitor.updateEnd();
            }
            return;
        }

        // Phase 3: Advance input repeat (DAS/ARR) using the same authoritative
        // delta as gravity, so input timing is frame-rate independent and unified
        // under one simulation clock.
        if (window.inputController) {
            window.inputController.updateDAS(delta);
        }
        if (window.gamepadController) {
            window.gamepadController.advanceGameplayInput(time);
        }

        // Auto drop (fixed-step accumulator for frame-rate independent gravity timing)
        processAutoDrop(gameState, delta, playDropCallback, physicsCallbacks);

        if (monitoring) {
            performanceMonitor.updateEnd();
            performanceMonitor.renderStart();
        }
    }

    // Draw if running OR if forced (e.g. during seek)
    if (!gameState.isPaused || gameState.forceDraw) {
        if (drawCallback) drawCallback();
        if (monitoring && !gameState.isPaused) {
            performanceMonitor.renderEnd();
        }
        if (updateStatsCallback) updateStatsCallback();

        // Reset force flag
        gameState.forceDraw = false;
    } else {
        // When paused, still finish monitoring this frame
        if (monitoring) {
            performanceMonitor.updateEnd();
        }
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
    // SAFETY CHECK: Detect duplicate RAF loops
    activeLoopCount++;
    if (activeLoopCount > MAX_CONCURRENT_LOOPS) {
        console.warn(`[PERFORMANCE WARNING] ${activeLoopCount} concurrent game loops detected! Canceling to prevent exponential growth.`);
        activeLoopCount--;
        return; // Exit early to prevent loop multiplication
    }

    try {
        // Delegate to updateGame
        updateGame(time, gameState, {
            drawCallback,
            updateStatsCallback,
            playDropCallback,
            physicsCallbacks,
        });

        if (gameState.isGameOver) {
            return;
        }

        // CRITICAL FIX: Schedule next frame ONCE at the end (not in pause branch)
        // This prevents duplicate RAF loops from multiplying exponentially
        gameState.animationId = requestAnimationFrame((t) => gameLoop(
            t,
            gameState,
            drawCallback,
            updateStatsCallback,
            playDropCallback,
            physicsCallbacks,
        ));
    } finally {
        // SAFETY: Decrement loop counter even if update/draw callbacks throw
        activeLoopCount--;
    }
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
    activeLoopCount = 0;

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
    // Phase 3: Clear input repeat timers to prevent burst moves on resume
    if (window.inputController) {
        window.inputController.clearTimers();
    }
}

/**
 * Resumes the game
 * @param {GameState} gameState - Current game state
 */
export function resumeGame(gameState) {
    if (gameState.isGameOver) return;
    gameState.isPaused = false;
    gameState.lastTime = performance.now();
    // Phase 3: Clear stale input repeat accumulators to prevent burst moves
    if (window.inputController) {
        window.inputController.clearTimers();
    }
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
