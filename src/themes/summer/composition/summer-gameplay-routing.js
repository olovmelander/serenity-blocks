/**
 * Summer "Midsommar Solstice" — gameplay-FX routing (renderer-neutral).
 *
 * The pure spine of the "Midsummer Promise" effect suite (docs/
 * SUMMER_MIDSUMMER_COMBO_LOCK_EFFECTS_PLAN_2026-07.md §6, §7.4, §7.5). It owns no
 * Three.js objects, no renderer, and schedules no timers: canonical gameplay
 * events become bounded, timestamped commands that the Summer FX pool drains from
 * its own frame loop.
 *
 * Two discrete reactions are produced here:
 *   - PIECE_LOCK → a four-cell DEW_SEAL at the lock centroid (a new lock starts a
 *     fresh wreath sequence).
 *   - COMBO      → a WREATH milestone that grows a persistent seven-flower crown
 *     from the last lock origin. Lobe count follows the cascade wave number.
 *
 * LINE_CLEAR emits no discrete particle of its own — the SeasonDirector keeps the
 * ambient breeze/line response. It only participates in combo correlation: when a
 * mode carries `comboCount` on LINE_CLEAR (Serenity interaction mode, manual
 * Odyssey celebrations) and no matching COMBO fires, a single fallback WREATH is
 * emitted at the next drain. If a matching COMBO arrives first, the fallback is
 * cancelled — so both COMBO→LINE_CLEAR and LINE_CLEAR→COMBO orders yield exactly
 * one milestone. The drain boundary plays the role of the plan's "generation-
 * guarded microtask" while staying fully deterministic and renderer-free testable.
 *
 * Forked and reskinned from serenity-warp-fx-controller.js (proven, tested); the
 * centroid/side-lane mapping is theme-agnostic and its board constants already
 * match Summer's (COLS 10, ROWS 20, HIDDEN 4).
 */
import { SUMMER_TETROMINOS } from '../summer-tetrominos.js';

const BOARD_COLUMNS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;

// Ceremonial side lanes: keep seals beside the Matrix, aligned to the lock's Y.
const SIDE_LANE_LEFT_X = 0.31;
const SIDE_LANE_RIGHT_X = 0.69;
const SIDE_LANE_TOP = 0.18;
const SIDE_LANE_HEIGHT = 0.64;

const DEFAULT_MAX_COMMANDS = 48;
const MAX_CONFIGURED_COMMANDS = 128;
const MAX_RECENT_SEALS = 7;
// The plan bounds transient state to the supported local-board count.
const MAX_STREAMS = 4;
// A quiet gap this long starts a fresh wreath for non-lock sources (§6).
const INACTIVITY_RESET_MS = 2250;
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

export const SUMMER_FX_COMMAND = Object.freeze({
    DEW_SEAL: 'dew-seal',
    WREATH: 'wreath',
});

// The five-petal wreath grows one lobe per cascade wave and completes a seven-
// flower crown; combo 10+ opens the restrained midnight-sun halo (§5.2, §5.3).
const CROWN_LOBES = 7;
const HALO_COMBO = 10;

/**
 * Structural tier for a cascade wave. Meaning is carried by lobe count,
 * circumference, and duration — hue/brightness are supporting cues only (§5.2).
 * Duration is the plan's per-tier midpoint in milliseconds.
 */
export function wreathTierForCombo(comboCount) {
    const combo = Math.max(0, Math.floor(Number.isFinite(comboCount) ? comboCount : 0));
    if (combo < 2) return null;
    const lobes = Math.min(CROWN_LOBES, combo);
    if (combo >= HALO_COMBO) {
        return {
            tier: 5, lobes: CROWN_LOBES, durationMs: 1200, halo: true, baseIntensity: 1,
        };
    }
    if (combo >= 7) {
        return {
            tier: 4, lobes: CROWN_LOBES, durationMs: 1100, halo: false, baseIntensity: 0.9,
        };
    }
    if (combo >= 5) {
        return {
            tier: 3, lobes, durationMs: 980, halo: false, baseIntensity: 0.78,
        };
    }
    if (combo >= 3) {
        return {
            tier: 2, lobes, durationMs: 880, halo: false, baseIntensity: 0.62,
        };
    }
    return {
        tier: 1, lobes: 2, durationMs: 780, halo: false, baseIntensity: 0.46,
    };
}

/**
 * Flat dew-seal envelope (§5.1). Times are milliseconds from the command's
 * issuedAtMs. Cheap to sample without allocating keyframe arrays.
 */
export const DEW_SEAL_ENVELOPE = Object.freeze({
    durationMs: 520,
    pressEndMs: 70, // four-cell contact/press; immediate confirmation
    liftStartMs: 70,
    liftEndMs: 260, // beads lift, outline relaxes, wisps separate
    fadeStartMs: 400,
    fadeEndMs: 520, // settle + dissolve into the ambient meadow direction
});

// Reduced motion: appear + fade in place, no lifted beads or traveling wisps.
export const REDUCED_DEW_SEAL_ENVELOPE = Object.freeze({
    durationMs: 220,
    pressEndMs: 45,
    liftStartMs: 0,
    liftEndMs: 0,
    fadeStartMs: 90,
    fadeEndMs: 220,
});

const EVENT_METHODS = Object.freeze({
    pieceLock: 'onPieceLock',
    PIECE_LOCK: 'onPieceLock',
    lineClear: 'onLineClear',
    LINE_CLEAR: 'onLineClear',
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

    const normalized = cells.map((cell) => ({ x: cell.x - minX, y: cell.y - minY }));
    return {
        cells: normalized,
        sourceOffset: { x: minX, y: minY },
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

function shapeFromCells(cells, width, height) {
    const shape = Array.from({ length: height }, () => Array(width).fill(0));
    cells.forEach((cell) => { shape[cell.y][cell.x] = 1; });
    return shape;
}

function resolvePieceColor(piece, type) {
    const supplied = piece?.color;
    if (typeof supplied === 'string' && supplied.trim().length > 0) return supplied;
    if (Number.isFinite(supplied)) return Number(supplied);
    return SUMMER_TETROMINOS.colors[type] || SUMMER_TETROMINOS.colors.O;
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

/**
 * Bounded transient state is tracked per (source, levelId, player) so one
 * local-multiplayer board never advances another board's wreath (§6).
 */
function streamKey(payload = {}) {
    const source = typeof payload?.source === 'string' && payload.source.length > 0
        ? payload.source
        : 'default';
    const levelId = payload?.levelId !== undefined && payload?.levelId !== null
        ? String(payload.levelId)
        : 'default';
    const player = Number.isFinite(payload?.player) ? String(Number(payload.player)) : 'default';
    return `${source}|${levelId}|${player}`;
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
        centered: { x: x * 2 - 1, y: 1 - y * 2 },
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

function defaultClock() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return 0;
}

/**
 * Resolve the exact rotated four-cell glyph carried by the canonical PIECE_LOCK
 * payload. Invalid/missing shapes fall back to the canonical orientation for the
 * reported piece type.
 */
export function resolveSummerLockGlyph(payload = {}) {
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
 * Map a locked piece to board-normalized coordinates and a viewport-normalized
 * side lane. Side-lane X keeps the seal outside the Matrix; Y tracks the lock
 * centroid. Averages the occupied cell centers (plan §3).
 */
export function resolveSummerLockOrigin(payload = {}) {
    const glyph = resolveSummerLockGlyph(payload);
    const player = normalizePlayer(payload);
    const centroid = glyph.boardCells.reduce(
        (sum, cell) => ({ x: sum.x + cell.x + 0.5, y: sum.y + cell.y + 0.5 }),
        { x: 0, y: 0 },
    );
    const boardX = centroid.x / glyph.boardCells.length;
    const boardY = centroid.y / glyph.boardCells.length;
    const normalizedX = clamp01(boardX / BOARD_COLUMNS);
    const normalizedY = clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);

    return {
        board: { x: boardX, y: boardY },
        normalized: { x: normalizedX, y: normalizedY },
        centered: { x: normalizedX * 2 - 1, y: 1 - normalizedY * 2 },
        sideLane: sideLaneFromBoard(normalizedX, normalizedY),
        position: copyFinitePosition(payload?.position),
        player,
    };
}

/**
 * Sample dew-seal animation state from command age. Consumers call this from
 * their own update loop; the controller never creates delayed callbacks.
 */
export function sampleDewSealEnvelope(elapsedMs, reducedMotion = false) {
    const elapsed = Math.max(0, finiteNumber(elapsedMs, 0));
    const envelope = reducedMotion ? REDUCED_DEW_SEAL_ENVELOPE : DEW_SEAL_ENVELOPE;
    const fade = rangeProgress(elapsed, envelope.fadeStartMs, envelope.fadeEndMs);
    const press = rangeProgress(elapsed, 0, envelope.pressEndMs);

    if (reducedMotion) {
        return {
            opacity: 1 - fade,
            press,
            lift: 0,
            wispProgress: 0,
            wispOpacity: 0,
            complete: elapsed >= envelope.durationMs,
        };
    }

    const lift = rangeProgress(elapsed, envelope.liftStartMs, envelope.liftEndMs);
    return {
        opacity: 1 - fade,
        press,
        lift,
        // Wisps separate as the beads lift, then are gathered by any combo.
        wispProgress: lift,
        wispOpacity: lift * (1 - fade),
        complete: elapsed >= envelope.durationMs,
    };
}

export class SummerGameplayRouting {
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
        // Insertion-ordered so the first key is the least-recently-active stream.
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

    _createStream(payload, now) {
        return {
            player: normalizePlayer(payload),
            lastActivityMs: now,
            lastComboCount: 0,
            lastEmittedComboCount: 0,
            lastOrigin: defaultOrigin(payload),
            lastGlyph: null,
            recentSeals: [],
            // Pending fallback from a LINE_CLEAR that carried comboCount but has
            // not (yet) been superseded by a matching COMBO. Resolved at drain.
            pendingLineClearCombo: null,
        };
    }

    _resetSequence(state) {
        state.lastComboCount = 0;
        state.lastEmittedComboCount = 0;
        state.recentSeals = [];
        state.pendingLineClearCombo = null;
    }

    /** LRU-bounded stream lookup with inactivity reset (§6). */
    getStream(payload = {}, now = this.lastIssuedAtMs) {
        const key = streamKey(payload);
        let state = this.streams.get(key);
        if (state) {
            if (now - state.lastActivityMs > INACTIVITY_RESET_MS) this._resetSequence(state);
            // Re-insert to mark most-recently-used.
            this.streams.delete(key);
            this.streams.set(key, state);
            state.lastActivityMs = now;
            return state;
        }
        if (this.streams.size >= MAX_STREAMS) {
            const oldestKey = this.streams.keys().next().value;
            this.streams.delete(oldestKey);
        }
        state = this._createStream(payload, now);
        this.streams.set(key, state);
        return state;
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
        const now = this.readClock();
        const state = this.getStream(payload, now);
        const glyph = resolveSummerLockGlyph(payload);
        const origin = resolveSummerLockOrigin(payload);
        const envelope = this.reducedMotion ? REDUCED_DEW_SEAL_ENVELOPE : DEW_SEAL_ENVELOPE;

        // A new lock starts a fresh wreath sequence.
        this._resetSequence(state);
        state.lastGlyph = cloneGlyph(glyph);
        state.lastOrigin = cloneOrigin(origin);
        state.recentSeals.push({ issuedAtMs: now, origin: cloneOrigin(origin), glyph: cloneGlyph(glyph) });
        if (state.recentSeals.length > MAX_RECENT_SEALS) state.recentSeals.shift();

        return this.enqueue(
            SUMMER_FX_COMMAND.DEW_SEAL,
            0.3,
            {
                player: state.player,
                origin: cloneOrigin(origin),
                glyph: cloneGlyph(glyph),
                envelope,
                wispCount: this.reducedMotion ? 0 : 8,
            },
            envelope.durationMs,
        );
    }

    onLineClear(payload = {}) {
        if (this.disposed) return null;
        const now = this.readClock();
        const state = this.getStream(payload, now);
        // Keep the last origin fresh from the cleared rows so a following/absent
        // combo places its wreath sensibly — but emit no discrete particle here.
        state.lastOrigin = cloneOrigin(originForRows(payload, state.lastOrigin));

        const rawCombo = Number(payload?.comboCount);
        const comboCount = Number.isFinite(rawCombo) ? Math.max(0, Math.floor(rawCombo)) : 0;
        if (comboCount >= 2 && comboCount > state.lastEmittedComboCount) {
            // Provisional: a matching COMBO may still arrive this tick and cancel it.
            state.pendingLineClearCombo = { comboCount };
        }
        return null;
    }

    onCombo(payload = {}) {
        if (this.disposed) return null;
        const now = this.readClock();
        const state = this.getStream(payload, now);
        const rawCombo = Number(payload?.comboCount);
        const comboCount = Number.isFinite(rawCombo) ? Math.max(0, Math.floor(rawCombo)) : 0;

        // A dropped combo count starts a fresh wreath.
        if (comboCount < state.lastComboCount) this._resetSequence(state);
        state.lastComboCount = comboCount;
        // A real COMBO cancels any provisional LINE_CLEAR fallback for this stream.
        state.pendingLineClearCombo = null;

        return this._emitWreath(state, comboCount);
    }

    _emitWreath(state, comboCount) {
        const tier = wreathTierForCombo(comboCount);
        // Only advance when this wave is a genuine, monotonic increase.
        if (!tier || comboCount <= state.lastEmittedComboCount) return null;
        state.lastEmittedComboCount = comboCount;

        return this.enqueue(
            SUMMER_FX_COMMAND.WREATH,
            tier.baseIntensity,
            {
                player: state.player,
                origin: cloneOrigin(state.lastOrigin),
                comboCount,
                tier: tier.tier,
                lobeTarget: tier.lobes,
                halo: tier.halo,
                seals: state.recentSeals.map(cloneSeal),
                colors: PIECE_TYPES.map((type) => SUMMER_TETROMINOS.colors[type]),
            },
            this.reducedMotion ? Math.min(320, tier.durationMs) : tier.durationMs,
        );
    }

    dispatch(eventName, payload = {}) {
        if (!Object.prototype.hasOwnProperty.call(EVENT_METHODS, eventName)) return null;
        const method = EVENT_METHODS[eventName];
        if (!method || typeof this[method] !== 'function') return null;
        return this[method](payload);
    }

    /**
     * Emit any provisional LINE_CLEAR combo that no COMBO superseded. Called from
     * drainCommands so the drain boundary acts as the fallback deadline.
     */
    resolvePendingCombos() {
        this.streams.forEach((state) => {
            const pending = state.pendingLineClearCombo;
            if (!pending) return;
            state.pendingLineClearCombo = null;
            state.lastComboCount = Math.max(state.lastComboCount, pending.comboCount);
            this._emitWreath(state, pending.comboCount);
        });
    }

    drainCommands() {
        this.resolvePendingCombos();
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        return commands;
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

    cleanup() {
        this.dispose();
    }
}

export default SummerGameplayRouting;
