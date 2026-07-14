/**
 * Renderer-neutral gameplay direction for Serenity Warp.
 *
 * The controller deliberately owns no Three.js objects and schedules no timers. Gameplay
 * events become bounded, timestamped commands which either renderer can consume from its
 * own frame loop. This keeps the selectable theme's reactions out of the shared intro.
 */
import { SERENITY_WARP_TETROMINOS } from './serenity-warp-tetrominos.js';

const BOARD_COLUMNS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const SIDE_LANE_LEFT_X = 0.31;
const SIDE_LANE_RIGHT_X = 0.69;
const SIDE_LANE_TOP = 0.18;
const SIDE_LANE_HEIGHT = 0.64;
const DEFAULT_MAX_COMMANDS = 64;
const MAX_CONFIGURED_COMMANDS = 128;
const MAX_RECENT_SEALS = 7;
const REDUCED_MOTION_INTENSITY = 0.45;

const PIECE_TYPES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
const PIECE_TYPE_SET = new Set(PIECE_TYPES);

const FALLBACK_SHAPES = Object.freeze({
    I: Object.freeze([Object.freeze([1, 1, 1, 1])]),
    O: Object.freeze([Object.freeze([1, 1]), Object.freeze([1, 1])]),
    T: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([0, 1, 0])]),
    S: Object.freeze([Object.freeze([0, 1, 1]), Object.freeze([1, 1, 0])]),
    Z: Object.freeze([Object.freeze([1, 1, 0]), Object.freeze([0, 1, 1])]),
    J: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([0, 0, 1])]),
    L: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([1, 0, 0])]),
});

export const SERENITY_WARP_FX_COMMAND = Object.freeze({
    PHASE_SEAL: 'phase-seal',
    LINE_CLEAR: 'line-clear',
    SPECTRUM_GATE: 'spectrum-gate',
    MOBIUS_TWIST: 'mobius-twist',
    PERFECT_CLEAR: 'perfect-clear',
    B2B_ECHO: 'b2b-echo',
});

export const SERENITY_WARP_COMBO_MILESTONES = Object.freeze([2, 3, 6, 10]);

export const SERENITY_WARP_COMBO_STAGES = Object.freeze({
    2: 'echo',
    3: 'constellation',
    6: 'aperture',
    10: 'sevenfold',
});

/**
 * A flat envelope is cheap to upload and can be sampled without allocating keyframe arrays.
 * Times are milliseconds from the command's issuedAtMs timestamp.
 */
export const PHASE_SEAL_ENVELOPE = Object.freeze({
    durationMs: 550,
    rimSnapEndMs: 60,
    convergeStartMs: 60,
    convergeEndMs: 160,
    ringStartMs: 40,
    ringEndMs: 280,
    fadeStartMs: 450,
    fadeEndMs: 550,
});

export const REDUCED_PHASE_SEAL_ENVELOPE = Object.freeze({
    durationMs: 180,
    rimSnapEndMs: 45,
    convergeStartMs: 0,
    convergeEndMs: 0,
    ringStartMs: 0,
    ringEndMs: 0,
    fadeStartMs: 80,
    fadeEndMs: 180,
});

const EVENT_METHODS = Object.freeze({
    pieceLock: 'onPieceLock',
    PIECE_LOCK: 'onPieceLock',
    lineClear: 'onLineClear',
    LINE_CLEAR: 'onLineClear',
    combo: 'onCombo',
    COMBO: 'onCombo',
    tspin: 'onTSpin',
    TSPIN: 'onTSpin',
    perfectClear: 'onPerfectClear',
    PERFECT_CLEAR: 'onPerfectClear',
    b2b: 'onB2B',
    B2B: 'onB2B',
});

const COMBO_BASE_INTENSITY = Object.freeze({
    2: 0.44,
    3: 0.58,
    6: 0.78,
    10: 1,
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function smoothstep01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function rangeProgress(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return smoothstep01((value - start) / (end - start));
}

function normalizePieceType(piece) {
    const candidate = piece?.shapeKey ?? piece?.type;
    if (typeof candidate !== 'string') return 'O';
    const normalized = candidate.trim().toUpperCase();
    return PIECE_TYPE_SET.has(normalized) ? normalized : 'O';
}

function cellsFromShape(shape) {
    if (!Array.isArray(shape)) return [];
    const cells = [];
    const rowCount = Math.min(shape.length, 8);

    for (let rowIndex = 0; rowIndex < rowCount && cells.length <= 4; rowIndex += 1) {
        const row = shape[rowIndex];
        if (Array.isArray(row)) {
            const columnCount = Math.min(row.length, 8);
            for (
                let columnIndex = 0;
                columnIndex < columnCount && cells.length <= 4;
                columnIndex += 1
            ) {
                if (Number(row[columnIndex]) > 0) {
                    cells.push({ x: columnIndex, y: rowIndex });
                }
            }
        }
    }

    return cells;
}

function normalizeFourCells(piece, type) {
    let cells = cellsFromShape(piece?.shape);
    if (cells.length !== 4) cells = cellsFromShape(FALLBACK_SHAPES[type]);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    cells.forEach((cell) => {
        minX = Math.min(minX, cell.x);
        minY = Math.min(minY, cell.y);
        maxX = Math.max(maxX, cell.x);
        maxY = Math.max(maxY, cell.y);
    });

    const normalized = cells.map((cell) => ({
        x: cell.x - minX,
        y: cell.y - minY,
    }));

    return {
        cells: normalized,
        sourceOffset: { x: minX, y: minY },
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

function shapeFromCells(cells, width, height) {
    const shape = Array.from({ length: height }, () => Array(width).fill(0));
    cells.forEach((cell) => {
        shape[cell.y][cell.x] = 1;
    });
    return shape;
}

function resolvePieceColor(piece, type) {
    const supplied = piece?.color;
    if (typeof supplied === 'string' && supplied.trim().length > 0) return supplied;
    if (Number.isFinite(supplied)) return Number(supplied);
    return SERENITY_WARP_TETROMINOS.colors[type] || SERENITY_WARP_TETROMINOS.colors.O;
}

function copyFinitePosition(position) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const copy = { x: Number(position.x), y: Number(position.y) };
    if (Number.isFinite(position.z)) copy.z = Number(position.z);
    return copy;
}

function normalizePlayer(payload) {
    return Number.isFinite(payload?.player) ? Number(payload.player) : null;
}

function playerKey(payloadOrPlayer) {
    const rawPlayer = typeof payloadOrPlayer === 'object' ? normalizePlayer(payloadOrPlayer) : payloadOrPlayer;
    return Number.isFinite(rawPlayer) ? `player:${Number(rawPlayer)}` : 'global';
}

function cloneGlyph(glyph) {
    if (!glyph) return null;
    return {
        type: glyph.type,
        color: glyph.color,
        rotation: glyph.rotation,
        pieceId: glyph.pieceId,
        width: glyph.width,
        height: glyph.height,
        shape: glyph.shape.map((row) => row.slice()),
        cells: glyph.cells.map((cell) => ({ ...cell })),
        boardCells: glyph.boardCells.map((cell) => ({ ...cell })),
    };
}

function cloneOrigin(origin) {
    if (!origin) return null;
    return {
        board: { ...origin.board },
        normalized: { ...origin.normalized },
        centered: { ...origin.centered },
        sideLane: {
            side: origin.sideLane.side,
            normalized: { ...origin.sideLane.normalized },
            centered: { ...origin.sideLane.centered },
        },
        position: origin.position ? { ...origin.position } : null,
        player: origin.player,
    };
}

function cloneSeal(seal) {
    return {
        issuedAtMs: seal.issuedAtMs,
        origin: cloneOrigin(seal.origin),
        glyph: cloneGlyph(seal.glyph),
    };
}

function defaultSideForPlayer(player) {
    if (Number.isFinite(player) && Math.abs(Number(player)) % 2 === 0) return 'left';
    return 'right';
}

function sideLaneFromBoard(normalizedX, normalizedY, preferredSide = null) {
    let side = preferredSide;
    if (side !== 'left' && side !== 'right') side = normalizedX < 0.5 ? 'left' : 'right';
    const x = side === 'left' ? SIDE_LANE_LEFT_X : SIDE_LANE_RIGHT_X;
    const y = SIDE_LANE_TOP + clamp01(normalizedY) * SIDE_LANE_HEIGHT;
    return {
        side,
        normalized: { x, y },
        centered: {
            x: x * 2 - 1,
            y: 1 - y * 2,
        },
    };
}

function defaultOrigin(payload = {}) {
    const player = normalizePlayer(payload);
    const normalized = { x: 0.5, y: 0.5 };
    return {
        board: { x: BOARD_COLUMNS / 2, y: HIDDEN_ROWS + VISIBLE_ROWS / 2 },
        normalized,
        centered: { x: 0, y: 0 },
        sideLane: sideLaneFromBoard(normalized.x, normalized.y, defaultSideForPlayer(player)),
        position: copyFinitePosition(payload?.position),
        player,
    };
}

function originForRows(payload, previousOrigin) {
    const base = previousOrigin ? cloneOrigin(previousOrigin) : defaultOrigin(payload);
    const rows = Array.isArray(payload?.clearedRows)
        ? payload.clearedRows.filter(Number.isFinite).slice(0, VISIBLE_ROWS + HIDDEN_ROWS)
        : [];

    if (rows.length === 0) {
        const explicitPosition = copyFinitePosition(payload?.position);
        if (explicitPosition) base.position = explicitPosition;
        return base;
    }

    const rowTotal = rows.reduce((total, row) => total + Number(row), 0);
    const boardY = rowTotal / rows.length + 0.5;
    const normalizedY = clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);
    base.board.y = boardY;
    base.normalized.y = normalizedY;
    base.centered.y = 1 - normalizedY * 2;
    base.sideLane = sideLaneFromBoard(base.normalized.x, normalizedY, base.sideLane?.side);
    base.position = copyFinitePosition(payload?.position) || base.position;
    return base;
}

function safePositiveInteger(value, fallback = 1) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(Number(value)));
}

function safeNonNegativeInteger(value, fallback = 0) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(Number(value)));
}

function defaultClock() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return 0;
}

/**
 * Resolve the exact rotated four-cell glyph carried by the canonical PIECE_LOCK payload.
 * Invalid/missing shapes fall back to the canonical orientation for the reported piece type.
 */
export function resolveSerenityWarpLockGlyph(payload = {}) {
    const piece = payload?.piece || {};
    const type = normalizePieceType(piece);
    const normalized = normalizeFourCells(piece, type);
    const rawX = finiteNumber(piece.x, (BOARD_COLUMNS - normalized.width) / 2);
    const rawY = finiteNumber(piece.y, HIDDEN_ROWS + (VISIBLE_ROWS - normalized.height) / 2);
    const boardCells = normalized.cells.map((cell) => ({
        x: rawX + normalized.sourceOffset.x + cell.x,
        y: rawY + normalized.sourceOffset.y + cell.y,
    }));

    return {
        type,
        color: resolvePieceColor(piece, type),
        rotation: finiteNumber(piece.rotation, 0),
        pieceId: piece.pieceId ?? null,
        width: normalized.width,
        height: normalized.height,
        shape: shapeFromCells(normalized.cells, normalized.width, normalized.height),
        cells: normalized.cells.map((cell) => ({ ...cell })),
        boardCells,
    };
}

/**
 * Map a locked piece to both board-normalized coordinates and a viewport-normalized side lane.
 * Side-lane X keeps the effect outside the Matrix; Y remains aligned with the lock centroid.
 */
export function resolveSerenityWarpLockOrigin(payload = {}) {
    const glyph = resolveSerenityWarpLockGlyph(payload);
    const player = normalizePlayer(payload);
    const centroid = glyph.boardCells.reduce(
        (sum, cell) => ({
            x: sum.x + cell.x + 0.5,
            y: sum.y + cell.y + 0.5,
        }),
        { x: 0, y: 0 },
    );
    const boardX = centroid.x / glyph.boardCells.length;
    const boardY = centroid.y / glyph.boardCells.length;
    const normalizedX = clamp01(boardX / BOARD_COLUMNS);
    const normalizedY = clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);

    return {
        board: { x: boardX, y: boardY },
        normalized: { x: normalizedX, y: normalizedY },
        centered: {
            x: normalizedX * 2 - 1,
            y: 1 - normalizedY * 2,
        },
        sideLane: sideLaneFromBoard(normalizedX, normalizedY),
        position: copyFinitePosition(payload?.position),
        player,
    };
}

/**
 * Sample Phase Seal animation state from command age. Consumers call this from their own
 * update loop; the controller never creates delayed callbacks.
 */
export function samplePhaseSealEnvelope(elapsedMs, reducedMotion = false) {
    const elapsed = Math.max(0, finiteNumber(elapsedMs, 0));
    const envelope = reducedMotion ? REDUCED_PHASE_SEAL_ENVELOPE : PHASE_SEAL_ENVELOPE;
    const fade = rangeProgress(elapsed, envelope.fadeStartMs, envelope.fadeEndMs);
    const rimSnap = rangeProgress(elapsed, 0, envelope.rimSnapEndMs);

    if (reducedMotion) {
        return {
            opacity: 1 - fade,
            scale: 1,
            rim: 1 - rimSnap + (1 - fade) * 0.22,
            moteProgress: 1,
            moteOpacity: 0,
            ringProgress: 0,
            ringOpacity: 0,
            complete: elapsed >= envelope.durationMs,
        };
    }

    const convergence = rangeProgress(elapsed, envelope.convergeStartMs, envelope.convergeEndMs);
    const ring = rangeProgress(elapsed, envelope.ringStartMs, envelope.ringEndMs);
    const ringEnvelope = Math.sin(Math.PI * ring) * (1 - fade);

    return {
        opacity: 1 - fade,
        scale: 1.12 - convergence * 0.12,
        rim: (1 - rimSnap) * 0.78 + (1 - fade) * 0.22,
        moteProgress: convergence,
        moteOpacity: (1 - convergence) * (1 - fade),
        ringProgress: ring,
        ringOpacity: Math.max(0, ringEnvelope),
        complete: elapsed >= envelope.durationMs,
    };
}

export class SerenityWarpFXController {
    constructor({
        clock = defaultClock,
        maxCommands = DEFAULT_MAX_COMMANDS,
        reducedMotion = false,
        intensityMultiplier = 1,
    } = {}) {
        this.clock = typeof clock === 'function' ? clock : defaultClock;
        this.maxCommands = clamp(
            Math.floor(finiteNumber(maxCommands, DEFAULT_MAX_COMMANDS)),
            1,
            MAX_CONFIGURED_COMMANDS,
        );
        this.reducedMotion = Boolean(reducedMotion);
        this.intensityMultiplier = clamp(finiteNumber(intensityMultiplier, 1), 0, 2);
        this.pendingCommands = [];
        this.playerStates = new Map();
        this.nextCommandId = 1;
        this.lastIssuedAtMs = 0;
        this.droppedCommandCount = 0;
        this.disposed = false;
    }

    setReducedMotion(enabled) {
        this.reducedMotion = Boolean(enabled);
    }

    setIntensityMultiplier(multiplier) {
        this.intensityMultiplier = clamp(finiteNumber(multiplier, 1), 0, 2);
    }

    configure({ reducedMotion, intensityMultiplier } = {}) {
        if (reducedMotion !== undefined) this.setReducedMotion(reducedMotion);
        if (intensityMultiplier !== undefined) this.setIntensityMultiplier(intensityMultiplier);
    }

    getPlayerState(payload = {}) {
        const key = playerKey(payload);
        let state = this.playerStates.get(key);
        if (!state) {
            state = {
                player: normalizePlayer(payload),
                lastComboCount: 0,
                reachedMilestones: new Set(),
                lastOrigin: defaultOrigin(payload),
                lastGlyph: null,
                recentSeals: [],
                b2bActive: false,
            };
            this.playerStates.set(key, state);
        }
        return state;
    }

    readClock() {
        const sampled = finiteNumber(this.clock(), this.lastIssuedAtMs);
        this.lastIssuedAtMs = Math.max(this.lastIssuedAtMs, sampled);
        return this.lastIssuedAtMs;
    }

    effectiveIntensity(baseIntensity) {
        const motionMultiplier = this.reducedMotion ? REDUCED_MOTION_INTENSITY : 1;
        return clamp(baseIntensity * this.intensityMultiplier * motionMultiplier, 0, 2);
    }

    enqueue(type, baseIntensity, payload = {}, durationMs = 0) {
        if (this.disposed) return null;
        const intensity = this.effectiveIntensity(baseIntensity);
        if (intensity <= 0) return null;

        const command = {
            id: this.nextCommandId,
            type,
            issuedAtMs: this.readClock(),
            durationMs,
            intensity,
            reducedMotion: this.reducedMotion,
            motionScale: this.reducedMotion ? 0 : 1,
            ...payload,
        };
        this.nextCommandId += 1;

        if (this.pendingCommands.length >= this.maxCommands) {
            this.pendingCommands.shift();
            this.droppedCommandCount += 1;
        }
        this.pendingCommands.push(command);
        return command;
    }

    onPieceLock(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const glyph = resolveSerenityWarpLockGlyph(payload);
        const origin = resolveSerenityWarpLockOrigin(payload);
        const envelope = this.reducedMotion ? REDUCED_PHASE_SEAL_ENVELOPE : PHASE_SEAL_ENVELOPE;
        const command = this.enqueue(
            // Lock stamp must read at the theme's real ~36u FX plane (0.36 was sub-threshold
            // in-game); the particle burst carries the rest of the "lock felt" feedback.
            SERENITY_WARP_FX_COMMAND.PHASE_SEAL,
            0.72,
            {
                player: state.player,
                origin: cloneOrigin(origin),
                glyph: cloneGlyph(glyph),
                envelope,
                moteCount: this.reducedMotion ? 0 : 4,
                ringCount: this.reducedMotion ? 0 : 1,
            },
            envelope.durationMs,
        );

        const issuedAtMs = command?.issuedAtMs ?? this.readClock();
        state.lastGlyph = cloneGlyph(glyph);
        state.lastOrigin = cloneOrigin(origin);
        state.recentSeals.push({
            issuedAtMs,
            origin: cloneOrigin(origin),
            glyph: cloneGlyph(glyph),
        });
        if (state.recentSeals.length > MAX_RECENT_SEALS) state.recentSeals.shift();
        return command;
    }

    onLineClear(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const lineCount = safePositiveInteger(payload?.lineCount);
        const cascadeCount = safePositiveInteger(payload?.cascadeCount);
        const clearedRows = Array.isArray(payload?.clearedRows)
            ? payload.clearedRows
                .filter(Number.isFinite)
                .slice(0, VISIBLE_ROWS + HIDDEN_ROWS)
                .map(Number)
            : [];
        const origin = originForRows(payload, state.lastOrigin);
        state.lastOrigin = cloneOrigin(origin);
        const baseIntensity = clamp(0.28 + lineCount * 0.12 + (cascadeCount - 1) * 0.05, 0.4, 1);

        return this.enqueue(
            SERENITY_WARP_FX_COMMAND.LINE_CLEAR,
            baseIntensity,
            {
                player: state.player,
                origin: cloneOrigin(origin),
                lineCount,
                cascadeCount,
                clearedRows,
                immediate: true,
            },
            this.reducedMotion ? 160 : 320,
        );
    }

    onCombo(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const rawCombo = Number(payload?.comboCount);
        const comboCount = Number.isFinite(rawCombo) ? Math.max(0, Math.floor(rawCombo)) : 0;

        if (comboCount < state.lastComboCount) {
            state.reachedMilestones.clear();
            const retainedSeals = Math.min(comboCount, MAX_RECENT_SEALS);
            state.recentSeals = retainedSeals > 0 ? state.recentSeals.slice(-retainedSeals) : [];
        }

        state.lastComboCount = comboCount;
        const newlyReached = SERENITY_WARP_COMBO_MILESTONES.filter(
            (milestone) => comboCount >= milestone && !state.reachedMilestones.has(milestone),
        );
        newlyReached.forEach((milestone) => state.reachedMilestones.add(milestone));

        if (newlyReached.length === 0) return null;
        const milestone = newlyReached[newlyReached.length - 1];
        const stage = SERENITY_WARP_COMBO_STAGES[milestone];
        const durationByMilestone = {
            2: 420,
            3: 900,
            6: 1400,
            10: 2200,
        };

        return this.enqueue(
            SERENITY_WARP_FX_COMMAND.SPECTRUM_GATE,
            COMBO_BASE_INTENSITY[milestone],
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                comboCount,
                milestone,
                stage,
                seals: state.recentSeals.map(cloneSeal),
                colors: PIECE_TYPES.map((type) => SERENITY_WARP_TETROMINOS.colors[type]),
                inhaleMs: milestone === 10 && !this.reducedMotion ? 120 : 0,
            },
            this.reducedMotion ? 260 : durationByMilestone[milestone],
        );
    }

    onTSpin(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const lineCount = safeNonNegativeInteger(payload?.lineCount);
        return this.enqueue(
            SERENITY_WARP_FX_COMMAND.MOBIUS_TWIST,
            0.84,
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                lineCount,
                reverseHueOrder: true,
            },
            this.reducedMotion ? 220 : 720,
        );
    }

    onPerfectClear(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const depth = safePositiveInteger(payload?.depth);
        return this.enqueue(
            SERENITY_WARP_FX_COMMAND.PERFECT_CLEAR,
            1,
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                depth,
                colors: PIECE_TYPES.map((type) => SERENITY_WARP_TETROMINOS.colors[type]),
            },
            this.reducedMotion ? 360 : 1800,
        );
    }

    onB2B(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        state.b2bActive = payload?.active !== false;
        if (!state.b2bActive) return null;

        return this.enqueue(
            SERENITY_WARP_FX_COMMAND.B2B_ECHO,
            0.52,
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                delayMs: this.reducedMotion ? 0 : 180,
                echoCount: 1,
            },
            this.reducedMotion ? 180 : 620,
        );
    }

    dispatch(eventName, payload = {}) {
        if (!Object.prototype.hasOwnProperty.call(EVENT_METHODS, eventName)) return null;
        const method = EVENT_METHODS[eventName];
        if (!method || typeof this[method] !== 'function') return null;
        return this[method](payload);
    }

    drainCommands() {
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        return commands;
    }

    getState() {
        return {
            pendingCommandCount: this.pendingCommands.length,
            droppedCommandCount: this.droppedCommandCount,
            playerCount: this.playerStates.size,
            reducedMotion: this.reducedMotion,
            intensityMultiplier: this.intensityMultiplier,
            disposed: this.disposed,
        };
    }

    reset() {
        this.pendingCommands = [];
        this.playerStates.clear();
        this.nextCommandId = 1;
        this.lastIssuedAtMs = 0;
        this.droppedCommandCount = 0;
        this.disposed = false;
    }

    dispose() {
        if (this.disposed) return;
        this.pendingCommands = [];
        this.playerStates.clear();
        this.disposed = true;
    }

    cleanup() {
        this.dispose();
    }
}

export default SerenityWarpFXController;
