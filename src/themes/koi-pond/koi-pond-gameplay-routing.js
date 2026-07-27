/**
 * Renderer-neutral gameplay routing for Koi Pond.
 *
 * Canonical gameplay payloads become bounded lock and combo commands. This
 * module owns no renderer objects, subscriptions, timers, or global clock; its
 * consumer supplies time and drains commands from its own update loop.
 */
import { KOI_POND_TETROMINOS } from './koi-pond-tetrominos.js';

const BOARD_COLUMNS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const MAX_SHAPE_SIZE = 8;

const SIDE_LANE_LEFT_X = 0.31;
const SIDE_LANE_RIGHT_X = 0.69;
const SIDE_LANE_TOP = 0.18;
const SIDE_LANE_HEIGHT = 0.64;

const DEFAULT_MAX_COMMANDS = 32;
const MAX_CONFIGURED_COMMANDS = 128;
const MAX_STREAMS = 4;
const REDUCED_MOTION_INTENSITY = 0.45;
const EMPTY_COMMANDS = Object.freeze([]);

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

export const KOI_POND_FX_COMMAND = Object.freeze({
    LOCK: 'koi-pond:lock',
    COMBO: 'koi-pond:combo',
});

export const KOI_POND_COMBO_MILESTONES = Object.freeze([2, 4, 7, 10]);

const COMBO_CONFIG = Object.freeze({
    2: Object.freeze({ tier: 1, intensity: 0.42, durationMs: 620 }),
    4: Object.freeze({ tier: 2, intensity: 0.58, durationMs: 820 }),
    7: Object.freeze({ tier: 3, intensity: 0.78, durationMs: 1080 }),
    10: Object.freeze({ tier: 4, intensity: 1, durationMs: 1420 }),
});

const LOCK_DURATION_MS = 460;
const REDUCED_LOCK_DURATION_MS = 180;
const REDUCED_COMBO_DURATION_MS = 260;

const EVENT_METHODS = Object.freeze({
    pieceLock: 'onPieceLock',
    PIECE_LOCK: 'onPieceLock',
    combo: 'onCombo',
    COMBO: 'onCombo',
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

function normalizePlayer(payload) {
    const player = payload?.player;
    if (Number.isFinite(player)) return Number(player);
    if (typeof player === 'string' && player.length > 0) return player;
    return null;
}

function playerKey(payload) {
    const player = normalizePlayer(payload);
    return player === null ? 'default' : `player:${String(player)}`;
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
    const rowCount = Math.min(shape.length, MAX_SHAPE_SIZE);

    for (let rowIndex = 0; rowIndex < rowCount && cells.length <= 4; rowIndex += 1) {
        const row = shape[rowIndex];
        if (!Array.isArray(row)) continue;
        const columnCount = Math.min(row.length, MAX_SHAPE_SIZE);

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
    return cells;
}

function normalizeFourCells(piece, type) {
    let cells = cellsFromShape(piece?.shape);
    if (cells.length !== 4) cells = cellsFromShape(FALLBACK_SHAPES[type]);

    const bounds = cells.reduce(
        (result, cell) => ({
            minX: Math.min(result.minX, cell.x),
            minY: Math.min(result.minY, cell.y),
            maxX: Math.max(result.maxX, cell.x),
            maxY: Math.max(result.maxY, cell.y),
        }),
        {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
        },
    );

    return {
        cells: cells.map((cell) => ({
            x: cell.x - bounds.minX,
            y: cell.y - bounds.minY,
        })),
        sourceOffset: { x: bounds.minX, y: bounds.minY },
        width: bounds.maxX - bounds.minX + 1,
        height: bounds.maxY - bounds.minY + 1,
    };
}

function shapeFromCells(cells, width, height) {
    const shape = Array.from({ length: height }, () => Array(width).fill(0));
    cells.forEach((cell) => {
        shape[cell.y][cell.x] = 1;
    });
    return shape;
}

function copyFinitePosition(position) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const copy = { x: Number(position.x), y: Number(position.y) };
    if (Number.isFinite(position.z)) copy.z = Number(position.z);
    return copy;
}

function sideLaneFromBoard(normalizedX, normalizedY, preferredSide = null) {
    let side = preferredSide;
    if (side !== 'left' && side !== 'right') {
        side = normalizedX < 0.5 ? 'left' : 'right';
    }
    const x = side === 'left' ? SIDE_LANE_LEFT_X : SIDE_LANE_RIGHT_X;
    const y = SIDE_LANE_TOP + clamp01(normalizedY) * SIDE_LANE_HEIGHT;
    return {
        side,
        normalized: { x, y },
        centered: { x: x * 2 - 1, y: 1 - y * 2 },
    };
}

function defaultSideForPlayer(player) {
    if (Number.isFinite(player) && Math.abs(Number(player)) % 2 === 0) return 'left';
    return 'right';
}

function defaultOrigin(payload = {}) {
    const player = normalizePlayer(payload);
    const normalized = { x: 0.5, y: 0.5 };
    return {
        board: {
            x: BOARD_COLUMNS / 2,
            y: HIDDEN_ROWS + VISIBLE_ROWS / 2,
        },
        normalized,
        centered: { x: 0, y: 0 },
        sideLane: sideLaneFromBoard(
            normalized.x,
            normalized.y,
            defaultSideForPlayer(player),
        ),
        position: copyFinitePosition(payload?.position),
        player,
    };
}

function cloneGlyph(glyph) {
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

/**
 * Resolve the rotated four-cell lock glyph. Malformed shapes use the canonical
 * compact orientation for the reported tetromino type.
 */
export function resolveKoiPondLockGlyph(payload = {}) {
    const piece = payload?.piece || {};
    const type = normalizePieceType(piece);
    const normalized = normalizeFourCells(piece, type);
    const defaultX = (BOARD_COLUMNS - normalized.width) / 2 - normalized.sourceOffset.x;
    const defaultY = HIDDEN_ROWS
        + (VISIBLE_ROWS - normalized.height) / 2
        - normalized.sourceOffset.y;
    const baseX = finiteNumber(piece.x, defaultX);
    const baseY = finiteNumber(piece.y, defaultY);
    const boardCells = normalized.cells.map((cell) => ({
        x: baseX + normalized.sourceOffset.x + cell.x,
        y: baseY + normalized.sourceOffset.y + cell.y,
    }));

    return {
        type,
        color: KOI_POND_TETROMINOS.colors[type],
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
 * Optional visible-playfield origin supplied by modes whose board does not map
 * one-to-one to the fixed 10x20 matrix (notably Infinity's scrolling grid).
 */
function readViewportOrigin(payload) {
    const viewport = payload?.viewportOrigin;
    if (!viewport || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
        return null;
    }
    return {
        x: clamp01(viewport.x),
        y: clamp01(viewport.y),
    };
}

/**
 * Map a lock centroid into board space, the visible 10x20 field, and its safe
 * side lane. Rows 0-3 are hidden and clamp to the top of the visible band. A
 * canonical viewportOrigin wins when a scrolling/nonstandard mode supplies it.
 */
export function resolveKoiPondLockOrigin(payload = {}) {
    const glyph = resolveKoiPondLockGlyph(payload);
    const centroid = glyph.boardCells.reduce(
        (sum, cell) => ({
            x: sum.x + cell.x + 0.5,
            y: sum.y + cell.y + 0.5,
        }),
        { x: 0, y: 0 },
    );
    const boardX = centroid.x / glyph.boardCells.length;
    const boardY = centroid.y / glyph.boardCells.length;
    const viewport = readViewportOrigin(payload);
    const normalizedX = viewport ? viewport.x : clamp01(boardX / BOARD_COLUMNS);
    const normalizedY = viewport
        ? viewport.y
        : clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);

    return {
        board: { x: boardX, y: boardY },
        normalized: { x: normalizedX, y: normalizedY },
        centered: {
            x: normalizedX * 2 - 1,
            y: 1 - normalizedY * 2,
        },
        sideLane: sideLaneFromBoard(normalizedX, normalizedY),
        position: copyFinitePosition(payload?.position),
        player: normalizePlayer(payload),
    };
}

/** Return the highest authored structural milestone reached by a combo count. */
export function comboMilestoneForCount(comboCount) {
    const count = Math.max(0, Math.floor(finiteNumber(comboCount, 0)));
    for (let index = KOI_POND_COMBO_MILESTONES.length - 1; index >= 0; index -= 1) {
        const milestone = KOI_POND_COMBO_MILESTONES[index];
        if (count >= milestone) return milestone;
    }
    return null;
}

function zeroClock() {
    return 0;
}

export class KoiPondGameplayRouting {
    constructor({
        clock = zeroClock,
        maxCommands = DEFAULT_MAX_COMMANDS,
        reducedMotion = false,
        intensityMultiplier = 1,
    } = {}) {
        this.clock = typeof clock === 'function' ? clock : zeroClock;
        this.maxCommands = clamp(
            Math.floor(finiteNumber(maxCommands, DEFAULT_MAX_COMMANDS)),
            1,
            MAX_CONFIGURED_COMMANDS,
        );
        this.reducedMotion = Boolean(reducedMotion);
        this.intensityMultiplier = clamp(finiteNumber(intensityMultiplier, 1), 0, 2);
        this.pendingCommands = [];
        this.streams = new Map();
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

    readClock() {
        const sampled = finiteNumber(this.clock(), this.lastIssuedAtMs);
        this.lastIssuedAtMs = Math.max(this.lastIssuedAtMs, sampled);
        return this.lastIssuedAtMs;
    }

    getStream(payload = {}) {
        const key = playerKey(payload);
        let state = this.streams.get(key);
        if (state) {
            this.streams.delete(key);
            this.streams.set(key, state);
            return state;
        }

        if (this.streams.size >= MAX_STREAMS) {
            const oldestKey = this.streams.keys().next().value;
            this.streams.delete(oldestKey);
        }
        state = {
            player: normalizePlayer(payload),
            lastComboCount: 0,
            reachedMilestones: new Set(),
            lastOrigin: defaultOrigin(payload),
        };
        this.streams.set(key, state);
        return state;
    }

    resetComboState(state) {
        state.lastComboCount = 0;
        state.reachedMilestones.clear();
    }

    effectiveIntensity(baseIntensity) {
        const motionMultiplier = this.reducedMotion ? REDUCED_MOTION_INTENSITY : 1;
        return clamp(baseIntensity * this.intensityMultiplier * motionMultiplier, 0, 2);
    }

    enqueue(type, baseIntensity, issuedAtMs, payload = {}) {
        const intensity = this.effectiveIntensity(baseIntensity);
        if (this.disposed || intensity <= 0) return null;
        const command = {
            id: this.nextCommandId,
            type,
            issuedAtMs,
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
        const issuedAtMs = this.readClock();
        const state = this.getStream(payload);
        const glyph = resolveKoiPondLockGlyph(payload);
        const origin = resolveKoiPondLockOrigin(payload);

        // COMBO is the cascade depth emitted while resolving one locked piece.
        // A new lock therefore starts a new authored milestone sequence.
        this.resetComboState(state);
        state.lastOrigin = cloneOrigin(origin);

        return this.enqueue(
            KOI_POND_FX_COMMAND.LOCK,
            0.34,
            issuedAtMs,
            {
                player: state.player,
                origin: cloneOrigin(origin),
                glyph: cloneGlyph(glyph),
                durationMs: this.reducedMotion
                    ? REDUCED_LOCK_DURATION_MS
                    : LOCK_DURATION_MS,
            },
        );
    }

    onCombo(payload = {}) {
        if (this.disposed) return null;
        const issuedAtMs = this.readClock();
        const state = this.getStream(payload);
        const comboCount = Math.max(
            0,
            Math.floor(finiteNumber(Number(payload?.comboCount), 0)),
        );

        if (comboCount < state.lastComboCount) this.resetComboState(state);
        state.lastComboCount = comboCount;

        const newlyReached = KOI_POND_COMBO_MILESTONES.filter(
            (milestone) => (
                comboCount >= milestone && !state.reachedMilestones.has(milestone)
            ),
        );
        newlyReached.forEach((milestone) => state.reachedMilestones.add(milestone));
        if (newlyReached.length === 0) return null;

        const milestone = newlyReached[newlyReached.length - 1];
        const config = COMBO_CONFIG[milestone];
        return this.enqueue(
            KOI_POND_FX_COMMAND.COMBO,
            config.intensity,
            issuedAtMs,
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                comboCount,
                milestone,
                tier: config.tier,
                durationMs: this.reducedMotion
                    ? REDUCED_COMBO_DURATION_MS
                    : config.durationMs,
            },
        );
    }

    dispatch(eventName, payload = {}) {
        if (this.disposed) return null;
        if (!Object.prototype.hasOwnProperty.call(EVENT_METHODS, eventName)) return null;
        const method = EVENT_METHODS[eventName];
        return typeof this[method] === 'function' ? this[method](payload) : null;
    }

    drain() {
        if (this.disposed || this.pendingCommands.length === 0) return EMPTY_COMMANDS;
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        return commands;
    }

    drainCommands() {
        return this.drain();
    }

    getState() {
        return {
            pendingCommandCount: this.pendingCommands.length,
            droppedCommandCount: this.droppedCommandCount,
            streamCount: this.streams.size,
            reducedMotion: this.reducedMotion,
            intensityMultiplier: this.intensityMultiplier,
            disposed: this.disposed,
        };
    }

    reset() {
        this.pendingCommands = [];
        this.streams.clear();
        this.nextCommandId = 1;
        this.lastIssuedAtMs = 0;
        this.droppedCommandCount = 0;
        this.disposed = false;
    }

    dispose() {
        if (this.disposed) return;
        this.pendingCommands = [];
        this.streams.clear();
        this.disposed = true;
    }
}

export default KoiPondGameplayRouting;
