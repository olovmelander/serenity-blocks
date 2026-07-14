import { createBoardGrid } from '../board.js';
import { restoreBlindTimers } from '../blind.js';
import { durationMsToTicks, elapsedMsToTicks } from '../fixed-tick-clock.js';
import { clearPlayerInput, restorePlayerInputState } from '../player-input-state.js';
import {
    normalizeInfinitySpawnPolicy,
    synchronizeInfinitySimulationCamera,
} from '../infinity-spawn-policy.js';
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

/**
 * Deterministic digest of a board grid (plan §5.0 step 4 / §5.10): the
 * verifiable half of a demo's final outcome — cutover comparisons diff final
 * BOARD digests, not just score/lines. DJB2 over row:col:type of occupied
 * cells in fixed scan order; returns an unsigned hex string. Cosmetic fields
 * (color, id) are deliberately excluded — theme-dependent state must never
 * enter a digest (plan §5.11 digest hygiene).
 * @param {Array<Array<{type?: string}|null>>} boardGrid
 * @returns {string|null}
 */
export function computeBoardDigest(boardGrid) {
    if (!Array.isArray(boardGrid)) return null;
    let hash = 5381;
    for (let y = 0; y < boardGrid.length; y += 1) {
        const row = boardGrid[y];
        if (!Array.isArray(row)) continue;
        for (let x = 0; x < row.length; x += 1) {
            const cell = row[x];
            if (!cell) continue;
            const token = `${y}:${x}:${cell.type || ''}`;
            for (let i = 0; i < token.length; i += 1) {
                hash = ((hash * 33) ^ token.charCodeAt(i)) >>> 0;
            }
        }
    }
    return hash.toString(16);
}

export function isStableDemoCheckpointSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.isGameOver) return true;
    if (snapshot.isProcessingPhysics) return false;
    return Boolean(snapshot.currentPiece);
}

export function captureGameStateSnapshot(gameState) {
    if (!gameState) return null;

    const hitStopCounterIsSynchronized = Number.isInteger(gameState.hitStopTicks)
        && gameState.hitStopTicks >= 0
        && gameState.hitStopRemaining === gameState._hitStopTickSourceMs
        && gameState.simTickMs === gameState._hitStopTickDurationMs;

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
        lockDelayTicks: durationMsToTicks(gameState.lockDelay, gameState.simTickMs),
        lockResetLimit: gameState.lockResetLimit,
        lockTimer: gameState.lockTimer,
        lockTimerTicks: gameState.lockTimerTicks,
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
        // Per-instance piece-id counter. Captured so a seek/restore does not
        // reset it to 0 and then re-issue ids (1,2,3...) that collide with the
        // restored pieces' ids — which would corrupt the flood-fill grouping
        // that keys purely on piece id.
        pieceIdCounter: gameState._pieceIdCounter,
        boardGrid: clonePlain(gameState.boardGrid),
        board: clonePlain(gameState.board),
        boardVersion: gameState.boardVersion || 0,

        isGameOver: gameState.isGameOver,
        isPaused: gameState.isPaused,
        isProcessingPhysics: Boolean(gameState.isProcessingPhysics),
        isStopped: gameState.isStopped,
        isAlive: gameState.isAlive,
        hitStopEnabled: gameState.hitStopEnabled !== false,
        hitStopRemaining: gameState.hitStopRemaining,
        hitStopTicks: hitStopCounterIsSynchronized
            ? gameState.hitStopTicks
            : durationMsToTicks(gameState.hitStopRemaining, gameState.simTickMs),
        lastMoveWasRotation: gameState.lastMoveWasRotation,
        b2bActive: gameState.b2bActive,
        inputQueue: clonePlain(gameState.inputQueue),
        playerInput: clonePlain(gameState.playerInput),

        isInfinityMode: gameState.isInfinityMode,
        ...(gameState.isInfinityMode ? {
            infinitySpawnPolicy: gameState.infinitySpawnPolicy,
            infinityVisibleRows: gameState.infinityVisibleRows,
            infinitySpawnOffsetRows: gameState.infinitySpawnOffsetRows,
            cameraCenterRow: gameState.cameraCenterRow,
        } : {}),
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

    // Infinity's deterministic spawn rule is match state. Bind it before the
    // restored board/camera is published. Checkpoints are subordinate to the
    // session/header rule chosen by the target constructor, so the default is
    // validate-only; silently switching policy mid-session would turn a mixed
    // or corrupt checkpoint into a rules change. Legacy checkpoints omit the
    // descriptor and retain the target's configuration.
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(snapshot, key);
    const spawnDescriptorPresence = [
        'infinitySpawnPolicy',
        'infinityVisibleRows',
        'infinitySpawnOffsetRows',
    ].map(hasOwn);
    const hasInfinitySpawnDescriptor = spawnDescriptorPresence.some(Boolean);
    if (snapshot.isInfinityMode && hasInfinitySpawnDescriptor) {
        if (!spawnDescriptorPresence.every(Boolean)) {
            throw new TypeError('Incomplete Infinity spawn rule descriptor in checkpoint');
        }
        if (!gameState.isInfinityMode) {
            throw new TypeError('Infinity checkpoint requires an Infinity session');
        }
        const snapshotPolicy = normalizeInfinitySpawnPolicy(snapshot.infinitySpawnPolicy);
        const snapshotVisibleRows = snapshot.infinityVisibleRows;
        const snapshotSpawnOffsetRows = snapshot.infinitySpawnOffsetRows;
        if (!Number.isSafeInteger(snapshotVisibleRows) || snapshotVisibleRows <= 0) {
            throw new TypeError('Invalid Infinity visible-row rule in checkpoint');
        }
        if (!Number.isSafeInteger(snapshotSpawnOffsetRows) || snapshotSpawnOffsetRows < 0) {
            throw new TypeError('Invalid Infinity spawn-offset rule in checkpoint');
        }

        if (options.adoptInfinitySpawnRules === true) {
            gameState.infinitySpawnPolicy = snapshotPolicy;
            gameState.infinityVisibleRows = snapshotVisibleRows;
            gameState.infinitySpawnOffsetRows = snapshotSpawnOffsetRows;
        } else if (
            gameState.infinitySpawnPolicy !== snapshotPolicy
            || gameState.infinityVisibleRows !== snapshotVisibleRows
            || gameState.infinitySpawnOffsetRows !== snapshotSpawnOffsetRows
        ) {
            throw new TypeError('Infinity checkpoint rules do not match the active session');
        }
    }

    gameState.reset();

    gameState.simTickMs = snapshot.simTickMs || (1000 / 60);
    gameState.simTimeMs = snapshot.simTimeMs || 0;
    gameState.simFrame = snapshot.simFrame || 0;
    gameState.lastTime = snapshot.lastTime || 0;
    gameState.dropInterval = snapshot.dropInterval;
    gameState.dropCounter = snapshot.dropCounter || 0;
    gameState.pieceSpawnTime = snapshot.pieceSpawnTime;
    gameState.piecesPlaced = snapshot.piecesPlaced || 0;
    gameState.lockDelay = snapshot.lockDelay ?? gameState.lockDelay;
    gameState.lockDelayTicks = Number.isFinite(snapshot.lockDelayTicks)
        ? Math.max(0, Math.floor(snapshot.lockDelayTicks))
        : durationMsToTicks(gameState.lockDelay, gameState.simTickMs);
    gameState.lockResetLimit = snapshot.lockResetLimit ?? gameState.lockResetLimit;
    gameState.lockTimer = snapshot.lockTimer || 0;
    gameState.lockTimerTicks = Number.isFinite(snapshot.lockTimerTicks)
        ? Math.max(0, Math.floor(snapshot.lockTimerTicks))
        : elapsedMsToTicks(gameState.lockTimer, gameState.simTickMs);
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
    // Restore the piece-id counter AFTER reset() (which zeroed it) and AFTER
    // lockedPieces are in place, so subsequent locks issue ids strictly above the
    // restored pieces. Older demos lack the field, so fall back to a high-water
    // mark derived from the restored pieces' ids.
    if (Number.isFinite(snapshot.pieceIdCounter)) {
        gameState._pieceIdCounter = snapshot.pieceIdCounter;
    } else {
        let maxPieceId = 0;
        for (const piece of gameState.lockedPieces) {
            if (Number.isFinite(piece?.pieceId) && piece.pieceId > maxPieceId) {
                maxPieceId = piece.pieceId;
            }
        }
        gameState._pieceIdCounter = maxPieceId;
    }
    gameState.currentPiece = restorePooledPiece(snapshot.currentPiece);
    gameState.nextPieces = clonePlain(snapshot.nextPieces) || [];
    gameState.boardGrid = clonePlain(snapshot.boardGrid) || createBoardGrid();
    if (gameState.isInfinityMode) {
        // Infinity's board is a compatibility alias, never a second source of
        // truth. captureGameStateSnapshot necessarily clones the two fields
        // separately, so restoring both objects would break the invariant.
        gameState.board = gameState.boardGrid;
    } else if (snapshot.board !== undefined) {
        gameState.board = clonePlain(snapshot.board);
    } else {
        gameState.board = null;
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
    if (typeof snapshot.hitStopEnabled === 'boolean') {
        gameState.hitStopEnabled = snapshot.hitStopEnabled;
    }
    gameState.hitStopRemaining = snapshot.hitStopRemaining || 0;
    gameState.hitStopTicks = Number.isFinite(snapshot.hitStopTicks)
        ? Math.max(0, Math.floor(snapshot.hitStopTicks))
        : durationMsToTicks(gameState.hitStopRemaining, gameState.simTickMs);
    // Keep the legacy millisecond rollback value untouched. These markers let
    // the dark fixed path honor an explicit restored tick counter on its first
    // consume even if a migrated snapshot's two representations disagree.
    gameState._hitStopTickSourceMs = gameState.hitStopRemaining;
    gameState._hitStopTickDurationMs = gameState.simTickMs;
    gameState.isProcessingPhysics = false;
    gameState.latestPhysicsPromise = null;
    gameState.lastMoveWasRotation = Boolean(snapshot.lastMoveWasRotation);
    gameState.b2bActive = Boolean(snapshot.b2bActive);
    gameState.inputQueue = clonePlain(snapshot.inputQueue) || null;
    if (options.restorePlayerInput === false) {
        clearPlayerInput(gameState.playerInput);
    } else {
        restorePlayerInputState(gameState.playerInput, snapshot.playerInput);
    }

    gameState.currentTopRow = snapshot.currentTopRow || 0;
    gameState.cameraRow = snapshot.cameraRow || 0;
    gameState.cameraCenterRow = snapshot.cameraCenterRow ?? gameState.cameraCenterRow;
    synchronizeInfinitySimulationCamera(gameState);
    gameState.lastPlacedPieceX = clonePlain(snapshot.lastPlacedPieceX) || [];
    gameState.comboState = clonePlain(snapshot.comboState) || {};
    restoreBlindTimers(gameState, snapshot.blindTimers);
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
