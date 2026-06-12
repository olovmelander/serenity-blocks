import { createBoardGrid } from '../board.js';
import { createBlindTimers } from '../blind.js';
import { piecePool } from '../../utils/object-pool.js';
import { seededRandom } from '../../utils/helpers.js';

function clonePlain(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function clonePiece(piece) {
    if (!piece) return null;
    return {
        ...piece,
        shape: Array.isArray(piece.shape) ? piece.shape.map((row) => row.slice()) : piece.shape,
    };
}

function restorePooledPiece(pieceSnapshot) {
    if (!pieceSnapshot) return null;

    const piece = piecePool.acquire();
    Object.assign(piece, clonePiece(pieceSnapshot));
    return piece;
}

export function isStableDemoCheckpointState(gameState) {
    if (!gameState) return false;
    if (gameState.isGameOver) return true;
    if (gameState.isProcessingPhysics) return false;
    return Boolean(gameState.currentPiece);
}

export function isStableDemoCheckpointSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.isGameOver) return true;
    if (snapshot.isProcessingPhysics) return false;
    return Boolean(snapshot.currentPiece);
}

export function captureGameStateSnapshot(gameState) {
    if (!gameState) return null;

    return {
        simTickMs: gameState.simTickMs,
        simTimeMs: gameState.simTimeMs,
        simFrame: gameState.simFrame,
        lastTime: gameState.lastTime,
        dropInterval: gameState.dropInterval,
        dropCounter: gameState.dropCounter,
        pieceSpawnTime: gameState.pieceSpawnTime,
        piecesPlaced: gameState.piecesPlaced,
        lockDelay: gameState.lockDelay,
        lockResetLimit: gameState.lockResetLimit,
        lockTimer: gameState.lockTimer,
        lockResetCount: gameState.lockResetCount,
        isGrounded: gameState.isGrounded,
        lockGroundedSince: gameState.lockGroundedSince,

        score: gameState.score,
        lines: gameState.lines,
        level: gameState.level,
        linesUntilNextLevel: gameState.linesUntilNextLevel,
        pieceCounts: clonePlain(gameState.pieceCounts),
        lineClearCounts: clonePlain(gameState.lineClearCounts),

        lockedPieces: clonePlain(gameState.lockedPieces),
        currentPiece: clonePiece(gameState.currentPiece),
        nextPieces: clonePlain(gameState.nextPieces),
        boardGrid: clonePlain(gameState.boardGrid),
        board: clonePlain(gameState.board),
        boardVersion: gameState.boardVersion || 0,

        isGameOver: gameState.isGameOver,
        isPaused: gameState.isPaused,
        isProcessingPhysics: Boolean(gameState.isProcessingPhysics),
        isStopped: gameState.isStopped,
        isAlive: gameState.isAlive,
        hitStopRemaining: gameState.hitStopRemaining,
        lastMoveWasRotation: gameState.lastMoveWasRotation,
        b2bActive: gameState.b2bActive,
        inputQueue: clonePlain(gameState.inputQueue),

        isInfinityMode: gameState.isInfinityMode,
        currentTopRow: gameState.currentTopRow,
        cameraRow: gameState.cameraRow,
        lastPlacedPieceX: clonePlain(gameState.lastPlacedPieceX),
        comboState: clonePlain(gameState.comboState),
        blindTimers: clonePlain(gameState.blindTimers),
        garbageAttackSequence: gameState.garbageAttackSequence,
        handicap: gameState.handicap,
        handicaps: clonePlain(gameState.handicaps),
        handicapCrowd: gameState.handicapCrowd,

        goalComplete: gameState.goalComplete,
        victoryLapActive: gameState.victoryLapActive,
        victoryLapStartTime: gameState.victoryLapStartTime,

        rngState: typeof gameState.randomGenerator?.getState === 'function'
            ? gameState.randomGenerator.getState()
            : null,
    };
}

export function restoreGameStateSnapshot(gameState, snapshot, options = {}) {
    if (!gameState || !snapshot) return;

    const wasReplay = Boolean(gameState.isReplay);
    const wasSeeking = Boolean(gameState.isSeeking);
    const wasSuppressingExternalInput = Boolean(gameState.suppressExternalInput);

    gameState.reset();

    gameState.simTickMs = snapshot.simTickMs || (1000 / 60);
    gameState.simTimeMs = snapshot.simTimeMs || 0;
    gameState.simFrame = snapshot.simFrame || 0;
    gameState.lastTime = snapshot.lastTime || 0;
    gameState.dropInterval = snapshot.dropInterval;
    gameState.dropCounter = snapshot.dropCounter || 0;
    gameState.pieceSpawnTime = snapshot.pieceSpawnTime;
    gameState.piecesPlaced = snapshot.piecesPlaced || 0;
    gameState.lockDelay = snapshot.lockDelay;
    gameState.lockResetLimit = snapshot.lockResetLimit;
    gameState.lockTimer = snapshot.lockTimer || 0;
    gameState.lockResetCount = snapshot.lockResetCount || 0;
    gameState.isGrounded = Boolean(snapshot.isGrounded);
    gameState.lockGroundedSince = snapshot.lockGroundedSince ?? null;

    gameState.score = snapshot.score || 0;
    gameState.lines = snapshot.lines || 0;
    gameState.level = snapshot.level || 1;
    gameState.linesUntilNextLevel = snapshot.linesUntilNextLevel ?? 15;
    gameState.pieceCounts = clonePlain(snapshot.pieceCounts) || {
        I: 0, J: 0, L: 0, O: 0, S: 0, T: 0, Z: 0,
    };
    gameState.lineClearCounts = clonePlain(snapshot.lineClearCounts) || {
        1: 0, 2: 0, 3: 0, 4: 0,
    };

    gameState.lockedPieces = clonePlain(snapshot.lockedPieces) || [];
    gameState.currentPiece = restorePooledPiece(snapshot.currentPiece);
    gameState.nextPieces = clonePlain(snapshot.nextPieces) || [];
    gameState.boardGrid = clonePlain(snapshot.boardGrid) || createBoardGrid();
    gameState.board = snapshot.board !== undefined
        ? clonePlain(snapshot.board)
        : (gameState.isInfinityMode ? gameState.boardGrid : null);
    if (gameState.isInfinityMode && !gameState.board) {
        gameState.board = gameState.boardGrid;
    }
    gameState.boardVersion = snapshot.boardVersion || 0;
    gameState.boardCache = null;
    gameState.boardCacheDirty = true;
    gameState.ghostCache = { piece: null, y: 0 };
    gameState.ghostCacheDirty = true;

    gameState.isGameOver = Boolean(snapshot.isGameOver);
    gameState.isPaused = Boolean(snapshot.isPaused);
    gameState.isStopped = Boolean(snapshot.isStopped);
    gameState.isAlive = snapshot.isAlive !== false;
    gameState.hitStopRemaining = snapshot.hitStopRemaining || 0;
    gameState.isProcessingPhysics = false;
    gameState.latestPhysicsPromise = null;
    gameState.lastMoveWasRotation = Boolean(snapshot.lastMoveWasRotation);
    gameState.b2bActive = Boolean(snapshot.b2bActive);
    gameState.inputQueue = clonePlain(snapshot.inputQueue) || null;

    gameState.currentTopRow = snapshot.currentTopRow || 0;
    gameState.cameraRow = snapshot.cameraRow || 0;
    gameState.lastPlacedPieceX = clonePlain(snapshot.lastPlacedPieceX) || [];
    gameState.comboState = clonePlain(snapshot.comboState) || {};
    gameState.blindTimers = clonePlain(snapshot.blindTimers) || createBlindTimers();
    gameState.garbageAttackSequence = snapshot.garbageAttackSequence || 0;
    gameState.handicap = snapshot.handicap ?? 2;
    gameState.handicaps = clonePlain(snapshot.handicaps) || {};
    gameState.handicapCrowd = snapshot.handicapCrowd || 0;

    gameState.goalComplete = Boolean(snapshot.goalComplete);
    gameState.victoryLapActive = Boolean(snapshot.victoryLapActive);
    gameState.victoryLapStartTime = snapshot.victoryLapStartTime ?? null;

    const seed = options.seed ?? gameState.randomGenerator?.seed;
    if (typeof options.randomGenerator === 'function') {
        gameState.randomGenerator = options.randomGenerator;
    } else if (Number.isFinite(seed)) {
        gameState.randomGenerator = seededRandom(seed);
    }
    if (
        snapshot.rngState !== null
        && snapshot.rngState !== undefined
        && typeof gameState.randomGenerator?.setState === 'function'
    ) {
        gameState.randomGenerator.setState(snapshot.rngState);
    }

    gameState.isReplay = options.isReplay ?? wasReplay;
    gameState.isSeeking = options.isSeeking ?? wasSeeking;
    gameState.suppressExternalInput = options.suppressExternalInput ?? wasSuppressingExternalInput;
}
