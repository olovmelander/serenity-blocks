// @ts-check

import {
    captureGameStateSnapshot,
    restoreGameStateSnapshot,
} from '../../demo/demo-state.js';
import { restoreBlindTimers } from '../../blind.js';
import { COLS, HIDDEN_ROWS, ROWS } from '../../constants.js';
import { GarbageQueue } from '../../garbage.js';
import { durationMsToTicks } from '../../fixed-tick-clock.js';
import { PLAYER_INPUT_EDGE_CAPACITY } from '../../player-input-state.js';
import { normalizeSfc32RandomState, restoreSfc32Random } from '../../rng.js';
import { seededRandom } from '../../../utils/helpers.js';
import { normalizeFfaRoundSeed } from '../ffa-round-policy.js';

export const FFA_RESYNC_SIDECAR_SCHEMA = 'serenity.ffa-resync';
export const FFA_RESYNC_SIDECAR_VERSION = 1;

const VALIDATED_SIDECAR = Symbol('validatedFfaResyncSidecar');
const SAFE_SYNCPOINT_STATUSES = new Set(['idle', 'download']);
const MAX_PLAYERS = 8;
const MAX_LOCKED_PIECES = 2048;
const MAX_BOARD_ROWS = 4096;
const MAX_GARBAGE_ENTRIES = 2048;
const MAX_HISTORY_ENTRIES = 512;
const MAX_PLAIN_DEPTH = 16;
const MAX_PLAIN_NODES = 50000;
const MAX_STRING_LENGTH = 4096;
const PIECE_KEYS = new Set(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
const GAME_STATE_SNAPSHOT_FIELDS = [
    'simTickMs', 'simTimeMs', 'simFrame', 'lastTime', 'dropInterval', 'dropCounter',
    'pieceSpawnTime', 'piecesPlaced', 'lockDelay', 'lockDelayTicks', 'lockResetLimit',
    'lockTimer', 'lockTimerTicks', 'lockResetCount', 'isGrounded', 'lockGroundedSince',
    'score', 'lines', 'level', 'linesUntilNextLevel', 'pieceCounts', 'lineClearCounts',
    'lockedPieces', 'currentPiece', 'nextPieces', 'pieceIdCounter', 'boardGrid', 'board',
    'boardVersion', 'isGameOver', 'isPaused', 'isProcessingPhysics', 'isStopped',
    'isAlive', 'hitStopEnabled', 'hitStopRemaining', 'hitStopTicks',
    'lastMoveWasRotation', 'b2bActive', 'inputQueue', 'playerInput', 'isInfinityMode',
    'currentTopRow', 'cameraRow', 'lastPlacedPieceX', 'comboState', 'blindTimers',
    'garbageAttackSequence', 'handicap', 'handicaps', 'handicapCrowd', 'goalComplete',
    'victoryLapActive', 'victoryLapStartTime', 'rngState',
];
export const FFA_RESYNC_SIDECAR_MAX_JSON_CHARS = 1024 * 1024;

/** @param {unknown} value */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function clonePlain(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
    if (!condition) throw new TypeError(`Invalid FFA resync sidecar: ${message}`);
}

/** @param {Record<string, any>} value @param {string[]} expected @param {string} label */
function assertExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const canonical = expected.slice().sort();
    invariant(
        actual.length === canonical.length
        && actual.every((key, index) => key === canonical[index]),
        `${label} fields are not canonical`,
    );
}

/** @param {unknown} value @param {string} label */
function assertCounter(value, label) {
    invariant(Number.isSafeInteger(value) && Number(value) >= 0, `${label} must be a non-negative safe integer`);
}

/** @param {unknown} value */
function normalizeCounter(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/**
 * Plain-data equality used only for duplicated capture fences. Sidecars are
 * JSON-shaped, so prototypes and property descriptors are deliberately ignored.
 * @param {unknown} left
 * @param {unknown} right
 */
function plainEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => plainEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftRecord = /** @type {Record<string, unknown>} */ (left);
    const rightRecord = /** @type {Record<string, unknown>} */ (right);
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (!plainEqual(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => plainEqual(leftRecord[key], rightRecord[key]));
}

/**
 * Bound every nested value before structured cloning/restoration. Wire JSON
 * should contain only finite primitives, arrays, and plain records.
 * @param {unknown} value
 * @param {string} label
 * @param {{remaining: number}} budget
 * @param {number} [depth]
 * @param {Set<object>} [ancestors]
 */
function validatePlainTree(value, label, budget, depth = 0, ancestors = new Set()) {
    invariant(depth <= MAX_PLAIN_DEPTH, `${label} exceeds maximum nesting depth`);
    budget.remaining -= 1;
    invariant(budget.remaining >= 0, `${label} exceeds maximum structural size`);
    if (value === undefined || value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        invariant(Number.isFinite(value), `${label} contains a non-finite number`);
        return;
    }
    if (typeof value === 'string') {
        invariant(value.length <= MAX_STRING_LENGTH, `${label} contains an oversized string`);
        return;
    }
    invariant(typeof value === 'object', `${label} contains a non-JSON value`);
    invariant(!ancestors.has(/** @type {object} */ (value)), `${label} contains a cycle`);
    const nextAncestors = new Set(ancestors).add(/** @type {object} */ (value));
    if (Array.isArray(value)) {
        invariant(value.length <= MAX_PLAIN_NODES, `${label} array is oversized`);
        value.forEach((entry, index) => validatePlainTree(
            entry,
            `${label}[${index}]`,
            budget,
            depth + 1,
            nextAncestors,
        ));
        return;
    }
    const prototype = Object.getPrototypeOf(value);
    invariant(
        prototype === Object.prototype || prototype === null,
        `${label} contains a non-plain object`,
    );
    const entries = Object.entries(value);
    invariant(entries.length <= 256, `${label} object has too many fields`);
    entries.forEach(([key, entry]) => {
        invariant(key.length <= 128, `${label} contains an oversized key`);
        validatePlainTree(entry, `${label}.${key}`, budget, depth + 1, nextAncestors);
    });
}

/** @param {unknown} shape @param {string} label */
function validatePieceShape(shape, label) {
    invariant(
        Array.isArray(shape) && shape.length > 0 && shape.length <= 16,
        `${label} must be a bounded row array`,
    );
    /** @type {unknown[]} */ (shape).forEach((row, rowIndex) => {
        invariant(
            Array.isArray(row) && row.length > 0 && row.length <= COLS,
            `${label}[${rowIndex}] must be a bounded cell array`,
        );
        /** @type {unknown[]} */ (row).forEach(
            (cell) => invariant(cell === 0 || cell === 1, `${label} cells must be binary`),
        );
    });
}

/** @param {unknown} piece @param {string} label */
function validatePiece(piece, label, { active = false } = {}) {
    invariant(isRecord(piece), `${label} must be an object`);
    const value = /** @type {Record<string, any>} */ (piece);
    validatePieceShape(value.shape, `${label}.shape`);
    ['x', 'y'].forEach((field) => invariant(
        Number.isInteger(value[field]),
        `${label}.${field} must be an integer`,
    ));
    invariant(typeof value.shapeKey === 'string' && value.shapeKey.length > 0
        && value.shapeKey.length <= 32, `${label}.shapeKey is invalid`);
    invariant(
        typeof value.type === 'string' && value.type.length > 0 && value.type.length <= 32,
        `${label}.type is invalid`,
    );
    if (active) {
        invariant(Object.hasOwn(value, 'color')
            && (value.color === null || typeof value.color === 'string'), `${label}.color is invalid`);
        invariant(
            Number.isInteger(value.rotation) && value.rotation >= 0 && value.rotation <= 3,
            `${label}.rotation is invalid`,
        );
    } else if (value.rotation !== undefined && value.rotation !== null) {
        invariant(Number.isInteger(value.rotation), `${label}.rotation must be an integer`);
    }
    if (value.pieceId !== undefined && value.pieceId !== null) {
        invariant((typeof value.pieceId === 'string' && value.pieceId.length <= 128)
            || Number.isSafeInteger(value.pieceId), `${label}.pieceId is invalid`);
    }
}

/** @param {unknown} grid @param {string} label */
function validateBoardGrid(grid, label) {
    invariant(Array.isArray(grid) && grid.length === ROWS + HIDDEN_ROWS
        && grid.length <= MAX_BOARD_ROWS, `${label} must have the canonical FFA row count`);
    /** @type {unknown[]} */ (grid).forEach((row, rowIndex) => {
        invariant(
            Array.isArray(row) && row.length === COLS,
            `${label}[${rowIndex}] must contain exactly ${COLS} columns`,
        );
        /** @type {unknown[]} */ (row).forEach((cell, columnIndex) => {
            invariant(
                cell === null || isRecord(cell),
                `${label}[${rowIndex}][${columnIndex}] is invalid`,
            );
        });
    });
}

/** @param {Record<string, any>} playerInput @param {string} label */
function validatePlayerInput(playerInput, label) {
    assertExactKeys(playerInput, [
        'clock', 'config', 'das', 'pendingEdges', 'nextEdgeSequence', 'overflowCount',
    ], label);
    invariant(playerInput.clock === 'input60k', `${label}.clock is invalid`);
    invariant(
        isRecord(playerInput.config) && isRecord(playerInput.das),
        `${label} config/DAS state is required`,
    );
    assertExactKeys(playerInput.config, ['dasDelay', 'dasInterval', 'softDropInterval'], `${label}.config`);
    assertExactKeys(playerInput.das, ['moveLeft', 'moveRight', 'softDrop'], `${label}.das`);
    ['dasDelay', 'dasInterval', 'softDropInterval'].forEach((field) => invariant(
        Number.isFinite(playerInput.config[field]) && playerInput.config[field] >= 0,
        `${label}.config.${field} is invalid`,
    ));
    const directions = [playerInput.das.moveLeft, playerInput.das.moveRight];
    directions.forEach((direction, index) => {
        const directionLabel = `${label}.das.${index === 0 ? 'moveLeft' : 'moveRight'}`;
        invariant(
            isRecord(direction) && direction.clock === 'input60k',
            `${directionLabel}.clock is invalid`,
        );
        assertExactKeys(direction, [
            'active', 'delayAccumulator', 'intervalAccumulator', 'isRepeating', 'clock',
        ], directionLabel);
        invariant(
            typeof direction.active === 'boolean' && typeof direction.isRepeating === 'boolean',
            `${directionLabel} flags are invalid`,
        );
        ['delayAccumulator', 'intervalAccumulator'].forEach((field) => assertCounter(
            direction[field],
            `${directionLabel}.${field}`,
        ));
        invariant(
            direction.active || direction.isRepeating === false,
            `${directionLabel} cannot repeat while inactive`,
        );
    });
    const { softDrop } = playerInput.das;
    invariant(isRecord(softDrop) && softDrop.clock === 'input60k'
        && typeof softDrop.active === 'boolean', `${label}.das.softDrop is invalid`);
    assertExactKeys(softDrop, ['active', 'intervalAccumulator', 'clock'], `${label}.das.softDrop`);
    assertCounter(softDrop.intervalAccumulator, `${label}.das.softDrop.intervalAccumulator`);
    assertCounter(playerInput.nextEdgeSequence, `${label}.nextEdgeSequence`);
    assertCounter(playerInput.overflowCount, `${label}.overflowCount`);
    invariant(
        Array.isArray(playerInput.pendingEdges)
        && playerInput.pendingEdges.length <= PLAYER_INPUT_EDGE_CAPACITY,
        `${label}.pendingEdges is oversized`,
    );
    const sequences = new Set();
    let previousKey = null;
    playerInput.pendingEdges.forEach((edge, index) => {
        invariant(isRecord(edge), `${label}.pendingEdges[${index}] is invalid`);
        assertExactKeys(edge, [
            'tick', 'subframe', 'action', 'value', 'phase', 'sequence',
        ], `${label}.pendingEdges[${index}]`);
        assertCounter(edge.tick, `${label}.pendingEdges[${index}].tick`);
        invariant(
            Number.isInteger(edge.subframe) && edge.subframe >= 0 && edge.subframe <= 9,
            `${label}.pendingEdges[${index}].subframe is invalid`,
        );
        assertCounter(edge.sequence, `${label}.pendingEdges[${index}].sequence`);
        invariant(!sequences.has(edge.sequence), `${label}.pendingEdges has duplicate sequences`);
        sequences.add(edge.sequence);
        const phaseValid = edge.phase === 'down' || edge.phase === 'up';
        const actionValid = (edge.action === 'move' && (edge.value === -1 || edge.value === 1) && phaseValid)
            || (edge.action === 'rotate' && ['left', 'right', 'flip'].includes(edge.value)
                && edge.phase === 'down')
            || (edge.action === 'softDrop' && edge.value === null && phaseValid)
            || (edge.action === 'hardDrop' && edge.value === null && edge.phase === 'down');
        invariant(actionValid, `${label}.pendingEdges[${index}] action is invalid`);
        const key = [edge.tick, edge.subframe, edge.sequence];
        if (previousKey) {
            invariant(key[0] > previousKey[0]
                || (key[0] === previousKey[0] && key[1] > previousKey[1])
                || (key[0] === previousKey[0] && key[1] === previousKey[1]
                    && key[2] > previousKey[2]), `${label}.pendingEdges is not canonical`);
        }
        previousKey = key;
    });
    const sequenceFloor = playerInput.pendingEdges.reduce((highest, edge) => Math.max(highest, edge.sequence + 1), 0);
    invariant(
        playerInput.nextEdgeSequence >= sequenceFloor,
        `${label}.nextEdgeSequence precedes a pending edge`,
    );
}

/** @param {Record<string, any>} entry @param {string} label */
function validateGarbageEntry(entry, label) {
    invariant(['line', 'blind', 'full_blind'].includes(entry.type), `${label}.type is invalid`);
    if (entry.type === 'line') {
        invariant(Number.isInteger(entry.holeMask) && entry.holeMask >= 0
            && entry.holeMask < (2 ** COLS), `${label}.holeMask is invalid`);
    } else {
        invariant(
            Number.isFinite(entry.duration) && entry.duration >= 0,
            `${label}.duration is invalid`,
        );
    }
    ['attackId', 'attackerId', 'targetId'].forEach((field) => {
        invariant(
            entry[field] === undefined || entry[field] === null
            || (typeof entry[field] === 'string' && entry[field].length <= 128),
            `${label}.${field} is invalid`,
        );
    });
}

/** @param {Record<string, any>} value @param {string[]} keys @param {string} label */
function validateCounterRecord(value, keys, label) {
    invariant(isRecord(value), `${label} is required`);
    keys.forEach((key) => assertCounter(value[key], `${label}.${key}`));
}

/** @param {Record<string, any>} timers @param {number} simTickMs @param {string} label */
function validateBlindTimerSnapshot(timers, simTickMs, label) {
    invariant(isRecord(timers), `${label} is required`);
    const publicFields = ['field', 'fieldMax', 'pending', 'pendingMax'];
    publicFields.forEach((field) => invariant(
        Number.isFinite(timers[field]) && timers[field] >= 0,
        `${label}.${field} must be a non-negative finite number`,
    ));
    invariant(timers.fieldMax >= timers.field, `${label}.fieldMax is below field`);
    invariant(timers.pendingMax >= timers.pending, `${label}.pendingMax is below pending`);

    const tickFields = ['fieldTicks', 'fieldMaxTicks', 'pendingTicks', 'pendingMaxTicks'];
    const sourceFields = [
        '_blindTickSourceField', '_blindTickSourceFieldMax',
        '_blindTickSourcePending', '_blindTickSourcePendingMax', '_blindTickDurationMs',
    ];
    const exactFields = [...tickFields, ...sourceFields];
    const present = exactFields.filter((field) => Object.hasOwn(timers, field));
    invariant(present.length === exactFields.length, `${label} requires a fixed-tick mirror`);
    assertExactKeys(timers, [...publicFields, ...exactFields], label);

    tickFields.forEach((field) => assertCounter(timers[field], `${label}.${field}`));
    invariant(
        timers.fieldMaxTicks >= timers.fieldTicks,
        `${label}.fieldMaxTicks is below fieldTicks`,
    );
    invariant(
        timers.pendingMaxTicks >= timers.pendingTicks,
        `${label}.pendingMaxTicks is below pendingTicks`,
    );
    invariant(
        timers._blindTickSourceField === timers.field
        && timers._blindTickSourceFieldMax === timers.fieldMax
        && timers._blindTickSourcePending === timers.pending
        && timers._blindTickSourcePendingMax === timers.pendingMax,
        `${label} fixed-tick source mirrors are stale`,
    );
    invariant(
        timers._blindTickDurationMs === simTickMs,
        `${label} fixed-tick duration is stale`,
    );
}

/** @param {unknown} timers @param {number} simTickMs */
function canonicalizeBlindTimerSnapshot(timers, simTickMs) {
    const holder = {
        simTickMs,
        blindTimers: {},
    };
    restoreBlindTimers(holder, isRecord(timers) ? timers : {}, simTickMs);
    return clonePlain(holder.blindTimers);
}

/** @param {Record<string, any>} gameState @param {string} steamId */
function validateGameStateSnapshot(gameState, steamId) {
    const label = `player ${steamId} GameState`;
    validatePlainTree(gameState, label, { remaining: MAX_PLAIN_NODES });
    assertExactKeys(gameState, GAME_STATE_SNAPSHOT_FIELDS, label);
    invariant(
        Array.isArray(gameState.lockedPieces)
        && gameState.lockedPieces.length <= MAX_LOCKED_PIECES,
        `${label}.lockedPieces must be a bounded array`,
    );
    gameState.lockedPieces.forEach((piece, index) => validatePiece(piece, `${label}.lockedPieces[${index}]`));
    if (gameState.currentPiece !== null) {
        validatePiece(gameState.currentPiece, `${label}.currentPiece`, { active: true });
    }
    validateBoardGrid(gameState.boardGrid, `${label}.boardGrid`);
    if (gameState.board !== undefined && gameState.board !== null) {
        validateBoardGrid(gameState.board, `${label}.board`);
    }
    invariant(
        Array.isArray(gameState.nextPieces) && gameState.nextPieces.length <= 64,
        `${label}.nextPieces must be a bounded array`,
    );
    gameState.nextPieces.forEach((piece) => invariant(
        typeof piece === 'string' && PIECE_KEYS.has(piece),
        `${label}.nextPieces contains an invalid piece`,
    ));
    invariant(
        gameState.inputQueue === null || gameState.inputQueue === undefined
        || (Array.isArray(gameState.inputQueue) && gameState.inputQueue.length <= 256),
        `${label}.inputQueue must be a bounded array`,
    );
    invariant(isRecord(gameState.playerInput), `${label}.playerInput is required`);
    validatePlayerInput(gameState.playerInput, `${label}.playerInput`);
    validateCounterRecord(
        gameState.pieceCounts,
        ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
        `${label}.pieceCounts`,
    );
    validateCounterRecord(
        gameState.lineClearCounts,
        ['1', '2', '3', '4'],
        `${label}.lineClearCounts`,
    );
    invariant(isRecord(gameState.comboState), `${label}.comboState is required`);
    invariant(isRecord(gameState.handicaps), `${label}.handicaps is required`);
    Object.entries(gameState.handicaps).forEach(([opponentId, value]) => {
        invariant(
            opponentId.length > 0 && opponentId.length <= 128,
            `${label}.handicaps contains an invalid opponent id`,
        );
        assertCounter(value, `${label}.handicaps.${opponentId}`);
    });
    validateBlindTimerSnapshot(gameState.blindTimers, gameState.simTickMs, `${label}.blindTimers`);
    const numericFields = [
        'simTickMs', 'simTimeMs', 'simFrame', 'lastTime', 'dropInterval', 'dropCounter',
        'pieceSpawnTime', 'piecesPlaced', 'lockDelay', 'lockDelayTicks', 'lockResetLimit',
        'lockTimer', 'lockTimerTicks', 'lockResetCount', 'score', 'lines', 'level',
        'linesUntilNextLevel', 'pieceIdCounter', 'boardVersion', 'hitStopRemaining',
        'hitStopTicks', 'currentTopRow', 'cameraRow', 'garbageAttackSequence', 'handicap',
        'handicapCrowd', 'victoryLapStartTime',
    ];
    numericFields.forEach((field) => {
        if (gameState[field] !== undefined && gameState[field] !== null) {
            invariant(Number.isFinite(gameState[field]), `${label}.${field} must be finite`);
        }
    });
    [
        'simFrame', 'piecesPlaced', 'lockDelayTicks', 'lockResetLimit', 'lockTimerTicks',
        'lockResetCount', 'score', 'lines', 'level', 'linesUntilNextLevel',
        'pieceIdCounter', 'boardVersion',
        'hitStopTicks', 'currentTopRow', 'cameraRow', 'garbageAttackSequence',
        'handicapCrowd',
    ].forEach((field) => assertCounter(gameState[field], `${label}.${field}`));
    [
        'simTickMs', 'simTimeMs', 'lastTime', 'dropInterval', 'dropCounter',
        'pieceSpawnTime', 'lockDelay', 'lockTimer', 'hitStopRemaining',
    ].forEach((field) => invariant(gameState[field] >= 0, `${label}.${field} must be non-negative`));
    invariant(gameState.simTickMs > 0, `${label}.simTickMs must be positive`);
    invariant(gameState.dropInterval > 0, `${label}.dropInterval must be positive`);
    invariant(gameState.level >= 1, `${label}.level must be at least one`);
    invariant(
        gameState.lockDelayTicks === durationMsToTicks(gameState.lockDelay, gameState.simTickMs),
        `${label}.lockDelayTicks disagrees with lockDelay`,
    );
    invariant(
        gameState.lockGroundedSince === null
        || (Number.isFinite(gameState.lockGroundedSince) && gameState.lockGroundedSince >= 0),
        `${label}.lockGroundedSince is invalid`,
    );
    invariant(
        gameState.victoryLapStartTime === null
        || (Number.isFinite(gameState.victoryLapStartTime)
            && gameState.victoryLapStartTime >= 0),
        `${label}.victoryLapStartTime is invalid`,
    );
    invariant(
        Number.isSafeInteger(gameState.handicap)
        && gameState.handicap >= 0 && gameState.handicap <= 4,
        `${label}.handicap is invalid`,
    );
    invariant(
        Array.isArray(gameState.lastPlacedPieceX)
        && gameState.lastPlacedPieceX.every((column, index) => Number.isInteger(column)
            && column >= 0 && column < COLS
            && (index === 0 || column > gameState.lastPlacedPieceX[index - 1])),
        `${label}.lastPlacedPieceX is invalid`,
    );
    [
        'isGrounded', 'isGameOver', 'isPaused', 'isProcessingPhysics', 'isStopped',
        'isAlive', 'hitStopEnabled', 'lastMoveWasRotation', 'b2bActive', 'isInfinityMode',
        'goalComplete', 'victoryLapActive',
    ].forEach((field) => invariant(typeof gameState[field] === 'boolean', `${label}.${field} must be boolean`));
    invariant(
        gameState.isProcessingPhysics === false,
        `${label}.isProcessingPhysics must be false at a safe capture`,
    );
    invariant(
        gameState.isInfinityMode === false,
        `${label}.isInfinityMode is unsupported for FFA resync`,
    );
    const maxLockedPieceId = gameState.lockedPieces.reduce(
        (highest, piece) => (Number.isSafeInteger(piece.pieceId)
            ? Math.max(highest, piece.pieceId) : highest),
        0,
    );
    invariant(
        gameState.pieceIdCounter >= maxLockedPieceId,
        `${label}.pieceIdCounter is below a locked piece id`,
    );
}

/** @param {unknown} value */
function normalizeOptionalId(value) {
    return value === undefined || value === null ? null : String(value);
}

/** @param {Record<string, any>} playerInput @param {unknown} oldFrame @param {unknown} newFrame */
function rebasePlayerInput(playerInput, oldFrame, newFrame) {
    const rebased = clonePlain(playerInput);
    const fromTick = normalizeCounter(oldFrame);
    const toTick = normalizeCounter(newFrame);
    rebased.pendingEdges.forEach((edge) => {
        const relativeTick = Math.max(0, edge.tick - fromTick);
        edge.tick = toTick + relativeTick;
        invariant(Number.isSafeInteger(edge.tick), 'rebased local input tick exceeds safe range');
    });
    return rebased;
}

/** @param {Record<string, any>} gameState */
function captureRngDescriptor(gameState) {
    const rng = gameState?.randomGenerator;
    const state = typeof rng?.getState === 'function' ? clonePlain(rng.getState()) : null;

    if (state === null || state === undefined) {
        return { algorithm: 'none', seed: null, state: null };
    }

    const isSfc32 = isRecord(state)
        && ['a', 'b', 'c', 'd', 'drawCount', 'seed', 'label']
            .every((key) => Object.hasOwn(state, key));
    if (isSfc32) {
        return {
            algorithm: 'sfc32-v1',
            seed: state.seed,
            state,
        };
    }

    const seed = normalizeFfaRoundSeed(rng?.seed);
    invariant(seed !== null, 'LCG seed is invalid');
    return {
        algorithm: 'lcg-v1',
        seed,
        state,
    };
}

/** @param {Record<string, any>} descriptor */
function createRandomGenerator(descriptor) {
    if (descriptor.algorithm === 'lcg-v1') {
        const rng = /** @type {any} */ (seededRandom(descriptor.seed));
        rng.setState(clonePlain(descriptor.state));
        return rng;
    }

    if (descriptor.algorithm === 'sfc32-v1') {
        return restoreSfc32Random(clonePlain(descriptor.state));
    }

    return Math.random;
}

/** @param {Record<string, any>} game @param {Record<string, any>} joinSyncpoint */
function validateCaptureWindow(game, joinSyncpoint) {
    invariant(isRecord(joinSyncpoint), 'capture requires a join syncpoint marker');
    invariant(joinSyncpoint.safe === true, 'capture syncpoint is not safe');
    invariant(SAFE_SYNCPOINT_STATUSES.has(joinSyncpoint.status), 'capture syncpoint status is not safe');
    invariant(
        Array.isArray(joinSyncpoint.blockers) && joinSyncpoint.blockers.length === 0,
        'capture syncpoint has blockers',
    );
    invariant(joinSyncpoint.simTick === game.simTick, 'capture syncpoint simTick is stale');
    invariant(
        joinSyncpoint.roundGeneration === game.roundGeneration,
        'capture syncpoint roundGeneration is stale',
    );
}

/**
 * Capture the simulation state that packed binary v7 intentionally omits. This
 * payload is for the rare reliable join/resync path, not the 30 Hz snapshot body.
 *
 * @param {Record<string, any>} game
 * @param {Record<string, any>} joinSyncpoint
 */
export function captureFfaResyncSidecar(game, joinSyncpoint) {
    validateCaptureWindow(game, joinSyncpoint);
    invariant(game.players instanceof Map, 'game roster must be a Map');

    const players = Array.from(game.players, ([rosterId, player]) => {
        const steamId = String(player?.steamId ?? rosterId);
        invariant(steamId.length > 0, 'player steamId is required');
        invariant(player?.gameState, `player ${steamId} has no GameState`);
        invariant(
            typeof player?.garbageQueue?.serialize === 'function',
            `player ${steamId} has no serializable garbage queue`,
        );

        const gameState = captureGameStateSnapshot(player.gameState);
        invariant(gameState !== null, `player ${steamId} GameState capture failed`);
        gameState.pieceSpawnTime ??= null;
        if (gameState.currentPiece && !Object.hasOwn(gameState.currentPiece, 'color')) {
            gameState.currentPiece.color = null;
        }
        gameState.blindTimers = canonicalizeBlindTimerSnapshot(
            gameState.blindTimers,
            gameState.simTickMs,
        );
        const rng = captureRngDescriptor(player.gameState);

        return {
            steamId,
            gameState,
            rng,
            wrapper: {
                frags: player.frags ?? 0,
                isAlive: player.isAlive !== false,
                awaitingSpawn: player.awaitingSpawn === true,
                lastInputSeq: player.lastInputSeq ?? 0,
                lockSeq: player._lockSeq ?? 0,
                clearSeq: player._clearSeq ?? 0,
                lastAppliedLockSeq: player._lastAppliedLockSeq ?? 0,
                lastAppliedClearSeq: player._lastAppliedClearSeq ?? 0,
                lastLockHostTick: player._lastLockHostTick ?? null,
                attackCredit: {
                    model: 'last-attacker-v1',
                    lastAttackerId: normalizeOptionalId(player.lastAttackerId),
                },
            },
            garbageEntries: player.garbageQueue.serialize(),
        };
    });

    return {
        schema: FFA_RESYNC_SIDECAR_SCHEMA,
        version: FFA_RESYNC_SIDECAR_VERSION,
        capture: {
            simTick: game.simTick ?? 0,
            roundGeneration: game.roundGeneration ?? 0,
            snapshotSeq: game.snapshotSeq ?? 0,
            hostTick: game.hostTick ?? 0,
            migrationEpoch: game.migrationEpoch ?? 0,
            joinSyncpoint: clonePlain(joinSyncpoint),
        },
        match: {
            attackSeq: game._attackSeq ?? 0,
            hotPotatoState: clonePlain(game.hotPotatoState ?? null),
            histories: {
                attackHistory: clonePlain(game.attackRouter?.attackHistory ?? []),
                deathLog: clonePlain(game.fragTracker?.deathLog ?? []),
                killFeed: clonePlain(game.fragTracker?.killFeed ?? []),
            },
        },
        players,
    };
}

/** @param {unknown[]} players @param {string} label */
function collectUniqueRoster(players, label) {
    const ids = new Set();
    players.forEach((player, index) => {
        invariant(isRecord(player), `${label}[${index}] must be an object`);
        const { steamId } = /** @type {Record<string, any>} */ (player);
        invariant(
            typeof steamId === 'string' && steamId.length > 0,
            `${label}[${index}].steamId is required`,
        );
        invariant(!ids.has(steamId), `${label} contains duplicate player ${steamId}`);
        ids.add(steamId);
    });
    return ids;
}

/**
 * @param {Record<string, any>} rng
 * @param {Record<string, any>} gameState
 * @param {string} steamId
 * @returns {{seed: unknown, state: unknown}}
 */
function validateRng(rng, gameState, steamId) {
    invariant(isRecord(rng), `player ${steamId} RNG descriptor is required`);
    invariant(
        ['none', 'lcg-v1', 'sfc32-v1'].includes(rng.algorithm),
        `player ${steamId} RNG algorithm is unsupported`,
    );

    let canonicalRngState = rng.state ?? null;
    let canonicalSnapshotState = gameState.rngState ?? null;
    let canonicalSeed = rng.seed ?? null;

    if (rng.algorithm === 'none') {
        invariant(
            rng.seed === null && rng.state === null,
            `player ${steamId} unseeded RNG descriptor must be empty`,
        );
    } else if (rng.algorithm === 'lcg-v1') {
        canonicalSeed = normalizeFfaRoundSeed(rng.seed);
        invariant(
            canonicalSeed !== null,
            `player ${steamId} LCG seed is invalid`,
        );
        invariant(
            typeof rng.state === 'number' && Number.isFinite(rng.state)
            && rng.state >= 0 && rng.state < 233280,
            `player ${steamId} LCG state is invalid`,
        );
    } else {
        try {
            canonicalRngState = normalizeSfc32RandomState(rng.state);
            canonicalSnapshotState = normalizeSfc32RandomState(gameState.rngState);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'invalid cursor';
            invariant(false, `player ${steamId} sfc32 state is invalid: ${reason}`);
        }
        invariant(
            rng.seed === canonicalRngState.seed,
            `player ${steamId} sfc32 seed is inconsistent`,
        );
        canonicalSeed = canonicalRngState.seed;
    }

    invariant(
        plainEqual(canonicalSnapshotState, canonicalRngState),
        `player ${steamId} RNG descriptor disagrees with GameState snapshot`,
    );
    const restored = createRandomGenerator({
        ...rng,
        seed: canonicalSeed,
        state: canonicalRngState,
    });
    const restoredState = typeof restored?.getState === 'function' ? restored.getState() : null;
    invariant(
        plainEqual(restoredState, canonicalRngState),
        `player ${steamId} RNG descriptor is not canonically restorable`,
    );
    return { seed: canonicalSeed, state: canonicalRngState };
}

/** @param {Record<string, any>} player */
function validatePlayerPayload(player) {
    const { steamId } = player;
    invariant(isRecord(player.gameState), `player ${steamId} GameState snapshot is required`);
    invariant(isRecord(player.wrapper), `player ${steamId} wrapper state is required`);
    invariant(Array.isArray(player.garbageEntries), `player ${steamId} garbage queue must be an array`);
    invariant(
        player.garbageEntries.length <= MAX_GARBAGE_ENTRIES,
        `player ${steamId} garbage queue is oversized`,
    );
    player.garbageEntries.forEach((entry, index) => {
        invariant(isRecord(entry), `player ${steamId} garbage entry ${index} is invalid`);
        validateGarbageEntry(entry, `player ${steamId} garbage entry ${index}`);
    });
    validateGameStateSnapshot(player.gameState, steamId);

    assertCounter(player.wrapper.frags, `player ${steamId} frags`);
    invariant(typeof player.wrapper.isAlive === 'boolean', `player ${steamId} isAlive must be boolean`);
    invariant(
        typeof player.wrapper.awaitingSpawn === 'boolean',
        `player ${steamId} awaitingSpawn must be boolean`,
    );
    [
        'lastInputSeq',
        'lockSeq',
        'clearSeq',
        'lastAppliedLockSeq',
        'lastAppliedClearSeq',
    ].forEach((field) => {
        assertCounter(player.wrapper[field], `player ${steamId} ${field}`);
    });
    invariant(
        player.wrapper.lastLockHostTick === null
            || (Number.isSafeInteger(player.wrapper.lastLockHostTick)
                && player.wrapper.lastLockHostTick >= 0),
        `player ${steamId} lastLockHostTick is invalid`,
    );
    invariant(isRecord(player.wrapper.attackCredit), `player ${steamId} attack credit is required`);
    invariant(
        player.wrapper.attackCredit.model === 'last-attacker-v1',
        `player ${steamId} attack-credit model is unsupported`,
    );
    invariant(
        player.wrapper.attackCredit.lastAttackerId === null
        || typeof player.wrapper.attackCredit.lastAttackerId === 'string',
        `player ${steamId} last attacker is invalid`,
    );
    return validateRng(player.rng, player.gameState, steamId);
}

/**
 * Validate all duplicated fences and the exact packed-v7 roster before any
 * caller is allowed to mutate live state.
 *
 * @param {unknown} sidecar
 * @param {{header: Record<string, any>, packedSnapshot: Record<string, any>}} context
 */
export function validateFfaResyncSidecar(sidecar, { header, packedSnapshot }) {
    invariant(isRecord(sidecar), 'payload must be an object');
    const candidate = /** @type {Record<string, any>} */ (sidecar);
    invariant(candidate.schema === FFA_RESYNC_SIDECAR_SCHEMA, 'unknown schema');
    invariant(candidate.version === FFA_RESYNC_SIDECAR_VERSION, 'unsupported version');
    invariant(isRecord(candidate.capture), 'capture fence is required');
    invariant(isRecord(candidate.match), 'match state is required');
    invariant(Array.isArray(candidate.players), 'players must be an array');
    invariant(candidate.players.length <= MAX_PLAYERS, 'player roster is oversized');
    invariant(isRecord(header), 'resync header is required');
    invariant(isRecord(packedSnapshot), 'packed snapshot is required');
    invariant(Array.isArray(packedSnapshot.players), 'packed snapshot roster is required');
    let serialized;
    try {
        serialized = JSON.stringify(candidate);
    } catch {
        invariant(false, 'payload is not JSON serializable');
    }
    invariant(serialized.length <= FFA_RESYNC_SIDECAR_MAX_JSON_CHARS, 'payload is oversized');

    const { capture } = candidate;
    ['simTick', 'roundGeneration', 'snapshotSeq', 'hostTick', 'migrationEpoch']
        .forEach((field) => assertCounter(capture[field], `capture.${field}`));
    invariant(isRecord(capture.joinSyncpoint), 'capture join syncpoint is required');
    invariant(capture.joinSyncpoint.safe === true, 'capture join syncpoint is not safe');
    invariant(
        SAFE_SYNCPOINT_STATUSES.has(capture.joinSyncpoint.status),
        'capture join syncpoint status is not safe',
    );
    invariant(
        Array.isArray(capture.joinSyncpoint.blockers)
        && capture.joinSyncpoint.blockers.length === 0,
        'capture join syncpoint has blockers',
    );
    invariant(
        capture.joinSyncpoint.simTick === capture.simTick,
        'capture join syncpoint simTick disagrees with capture fence',
    );
    invariant(
        capture.joinSyncpoint.roundGeneration === capture.roundGeneration,
        'capture join syncpoint roundGeneration disagrees with capture fence',
    );

    ['simTick', 'roundGeneration', 'snapshotSeq', 'migrationEpoch'].forEach((field) => {
        invariant(header[field] === capture[field], `header ${field} fence mismatch`);
    });
    const headerHostTick = header.hostTick ?? header.tick;
    invariant(headerHostTick === capture.hostTick, 'header hostTick fence mismatch');
    invariant(
        plainEqual(header.joinSyncpoint, capture.joinSyncpoint),
        'header join syncpoint fence mismatch',
    );

    invariant(packedSnapshot.simTick === capture.simTick, 'packed simTick fence mismatch');
    invariant(packedSnapshot.snapshotSeq === capture.snapshotSeq, 'packed snapshotSeq fence mismatch');
    invariant(packedSnapshot.tick === capture.hostTick, 'packed hostTick fence mismatch');

    const sidecarRoster = collectUniqueRoster(candidate.players, 'sidecar roster');
    const packedRoster = collectUniqueRoster(packedSnapshot.players, 'packed roster');
    invariant(
        sidecarRoster.size === packedRoster.size
        && Array.from(sidecarRoster).every((steamId) => packedRoster.has(steamId)),
        'sidecar roster does not exactly match packed snapshot roster',
    );

    assertCounter(candidate.match.attackSeq, 'match.attackSeq');
    invariant(
        candidate.match.hotPotatoState === null || isRecord(candidate.match.hotPotatoState),
        'match hot-potato state is invalid',
    );
    invariant(isRecord(candidate.match.histories), 'match histories are required');
    ['attackHistory', 'deathLog', 'killFeed'].forEach((field) => {
        invariant(Array.isArray(candidate.match.histories[field]), `match history ${field} must be an array`);
        invariant(
            candidate.match.histories[field].length <= MAX_HISTORY_ENTRIES,
            `match history ${field} is oversized`,
        );
    });
    validatePlainTree(candidate.match, 'match', { remaining: MAX_PLAIN_NODES });
    const canonicalHeaderSeed = Object.hasOwn(header, 'sharedSeed')
        ? normalizeFfaRoundSeed(header.sharedSeed)
        : null;
    if (Object.hasOwn(header, 'sharedSeed')) {
        invariant(canonicalHeaderSeed !== null, 'header sharedSeed is invalid');
    }
    const canonicalRngDescriptors = candidate.players.map(validatePlayerPayload);
    if (canonicalHeaderSeed !== null) {
        candidate.players.forEach((player, index) => {
            if (player.rng.algorithm !== 'lcg-v1') return;
            invariant(
                canonicalRngDescriptors[index].seed === canonicalHeaderSeed,
                `player ${player.steamId} LCG seed disagrees with header sharedSeed`,
            );
        });
    }

    const validated = /** @type {Record<string | symbol, any>} */ (clonePlain(candidate));
    validated.players.forEach((player, index) => {
        const descriptor = canonicalRngDescriptors[index];
        player.rng.seed = descriptor.seed;
        if (player.rng.algorithm !== 'sfc32-v1') return;
        player.rng.state = clonePlain(descriptor.state);
        player.gameState.rngState = clonePlain(descriptor.state);
    });
    Object.defineProperty(validated, VALIDATED_SIDECAR, { value: true });
    return validated;
}

/**
 * Reject stale authority and stale target-roster state before the FFA wrapper
 * mutates match configuration, clocks, or player objects. Missing target
 * players are allowed because the packed roster creates them during apply;
 * target-only players are not, because they would survive as simulation peers.
 *
 * @param {Record<string, any>} game
 * @param {Record<string, any>} state
 * @returns {{accepted: true}|{accepted: false, reason: string, details?: Record<string, unknown>}}
 */
export function preflightFfaResyncApply(game, state) {
    if (!isRecord(state) || !Array.isArray(state.players)) {
        return { accepted: false, reason: 'invalid_roster' };
    }

    const roster = new Set();
    for (const player of state.players) {
        const steamId = player?.steamId;
        if (typeof steamId !== 'string' || steamId.length === 0 || roster.has(steamId)) {
            return { accepted: false, reason: 'invalid_roster' };
        }
        roster.add(steamId);
    }

    if (Number.isSafeInteger(state.roundGeneration)
        && state.roundGeneration < normalizeCounter(game.roundGeneration)) {
        return {
            accepted: false,
            reason: 'stale_round_generation',
            details: { received: state.roundGeneration, current: game.roundGeneration },
        };
    }
    if (Number.isSafeInteger(state.migrationEpoch)
        && state.migrationEpoch < normalizeCounter(game.migrationEpoch)) {
        return {
            accepted: false,
            reason: 'stale_migration_epoch',
            details: { received: state.migrationEpoch, current: game.migrationEpoch },
        };
    }

    const extraTargetPlayers = game.players instanceof Map
        ? Array.from(game.players.keys(), String).filter((steamId) => !roster.has(steamId))
        : [];
    if (extraTargetPlayers.length > 0) {
        return {
            accepted: false,
            reason: 'target_roster_extra',
            details: { playerIds: extraTargetPlayers.sort() },
        };
    }
    return { accepted: true };
}

/**
 * Apply a previously validated sidecar. The packed snapshot remains responsible
 * for roster identity, phase, winner, and render fallback; this function owns
 * exact deterministic continuation state.
 *
 * @param {Record<string, any>} game
 * @param {Record<string | symbol, any>} validated
 * @param {{restorePlayerInput?: boolean, preservePlayerInputFor?: string|null}} [options]
 */
export function applyFfaResyncSidecar(game, validated, options = {}) {
    invariant(
        validated?.[VALIDATED_SIDECAR] === true,
        'apply requires the result of validateFfaResyncSidecar',
    );
    invariant(game.players instanceof Map, 'target game roster must be a Map');

    const restorePlayerInput = options.restorePlayerInput !== false;
    const stagedPlayers = validated.players.map((playerState) => {
        const player = game.players.get(playerState.steamId);
        invariant(player?.gameState, `target player ${playerState.steamId} is missing`);

        const randomGenerator = createRandomGenerator(playerState.rng);
        const garbageQueue = new GarbageQueue();
        garbageQueue.enqueue(clonePlain(playerState.garbageEntries));
        return {
            player,
            playerState,
            randomGenerator,
            garbageQueue,
            preservedPlayerInput: options.preservePlayerInputFor === playerState.steamId
                ? rebasePlayerInput(
                    player.gameState.playerInput,
                    player.gameState.simFrame,
                    playerState.gameState.simFrame,
                )
                : null,
        };
    });

    stagedPlayers.forEach((staged) => {
        const snapshot = clonePlain(staged.playerState.gameState);
        snapshot.rngState = clonePlain(staged.playerState.rng.state);
        if (staged.preservedPlayerInput) snapshot.playerInput = staged.preservedPlayerInput;
        restoreGameStateSnapshot(staged.player.gameState, snapshot, {
            randomGenerator: staged.randomGenerator,
            restorePlayerInput,
        });

        const { wrapper } = staged.playerState;
        staged.player.frags = wrapper.frags;
        staged.player.isAlive = wrapper.isAlive;
        staged.player.awaitingSpawn = wrapper.awaitingSpawn;
        staged.player.lastInputSeq = wrapper.lastInputSeq;
        staged.player._lockSeq = wrapper.lockSeq;
        staged.player._clearSeq = wrapper.clearSeq;
        staged.player._lastAppliedLockSeq = wrapper.lastAppliedLockSeq;
        staged.player._lastAppliedClearSeq = wrapper.lastAppliedClearSeq;
        staged.player._lastLockHostTick = wrapper.lastLockHostTick;
        staged.player.lastAttackerId = wrapper.attackCredit.lastAttackerId;
        staged.player.garbageQueue = staged.garbageQueue;
    });

    game.simTick = validated.capture.simTick;
    game.roundGeneration = validated.capture.roundGeneration;
    game.snapshotSeq = validated.capture.snapshotSeq;
    game.hostTick = validated.capture.hostTick;
    game.migrationEpoch = validated.capture.migrationEpoch;
    game.joinSyncpoint = clonePlain(validated.capture.joinSyncpoint);
    game.syncpoint = validated.capture.joinSyncpoint.status;
    game._attackSeq = validated.match.attackSeq;
    game.hotPotatoState = clonePlain(validated.match.hotPotatoState);

    if (game.attackRouter) {
        game.attackRouter.attackHistory = clonePlain(validated.match.histories.attackHistory);
    }
    if (game.fragTracker) {
        game.fragTracker.deathLog = clonePlain(validated.match.histories.deathLog);
        game.fragTracker.killFeed = clonePlain(validated.match.histories.killFeed);
    }

    return game;
}
