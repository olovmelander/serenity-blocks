/**
 * Renderer-neutral gameplay choreography for the Black Hole theme.
 *
 * The controller consumes the canonical gameplay-event payloads, converts board
 * coordinates into a stable normalized origin, and emits bounded commands for
 * the renderer. It owns timing state, but never reads gameplay state or touches
 * Three.js objects.
 */
import { readLockViewportOrigin } from '../../events/lock-origin.js';

const BOARD_COLUMNS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const MAX_SHAPE_SIZE = 8;

const DEFAULT_MAX_COMMANDS = 24;
const MAX_CONFIGURED_COMMANDS = 64;

// Shared, immutable empty result for drainCommands() on the common (idle) frame — avoids a
// per-frame array allocation. Frozen so any accidental mutation by a caller fails loudly.
const EMPTY_COMMANDS = Object.freeze([]);

export const BLACK_HOLE_FX_COMMAND = Object.freeze({
    PIECE_LOCK: 'black-hole:piece-lock',
    LINE_CLEAR: 'black-hole:line-clear',
    COMBO: 'black-hole:combo',
});

export const BLACK_HOLE_COMBO_PHENOMENON = Object.freeze({
    RING_PULSE: 'ring-pulse',
    SHEAR_DOPPLER: 'shear-doppler',
    STELLAR_ARC: 'stellar-arc',
    CAUSTIC: 'caustic',
});

export const BLACK_HOLE_FX_LIMITS = Object.freeze({
    maxActiveLocks: 8,
    maxComboCount: 99,
    maxVisualLineCount: 4,
    maxCascadeCount: 8,
    maxClearedRows: VISIBLE_ROWS + HIDDEN_ROWS,
    maxRingEchoes: 3,
    maxHotKnots: 2,
    maxStellarArcs: 1,
    maxPolarFilaments: 1,
    maxLockMotes: 12,
    maxMatterStreamParticles: 16,
});

export const BLACK_HOLE_LOCK_ENVELOPE = Object.freeze({
    durationMs: 420,
    compressionStartMs: 0,
    compressionPeakMs: 55,
    compressionEndMs: 135,
    rippleStartMs: 55,
    ripplePeakMs: 95,
    rippleEndMs: 300,
    streamStartMs: 95,
    streamEndMs: 235,
    coreStartMs: 185,
    corePeakMs: 245,
    coreEndMs: 420,
});

export const REDUCED_BLACK_HOLE_LOCK_ENVELOPE = Object.freeze({
    durationMs: 180,
    compressionStartMs: 0,
    compressionPeakMs: 0,
    compressionEndMs: 0,
    rippleStartMs: 0,
    ripplePeakMs: 0,
    rippleEndMs: 0,
    streamStartMs: 0,
    streamEndMs: 0,
    coreStartMs: 0,
    corePeakMs: 45,
    coreEndMs: 180,
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

function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function safeInteger(value, fallback, min, max) {
    if (!Number.isFinite(value)) return fallback;
    return clamp(Math.floor(Number(value)), min, max);
}

function smoothstep01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function rangeProgress(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return smoothstep01((value - start) / (end - start));
}

function pulse(value, start, peak, end) {
    if (end <= start || peak < start || peak > end) return 0;
    const attack = rangeProgress(value, start, peak);
    const release = 1 - rangeProgress(value, peak, end);
    return clamp01(attack * release);
}

function copyFinitePosition(position) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const copy = { x: Number(position.x), y: Number(position.y) };
    if (Number.isFinite(position.z)) copy.z = Number(position.z);
    return copy;
}

function normalizePlayer(payload) {
    const player = payload?.player;
    if (Number.isFinite(player)) return Number(player);
    if (typeof player === 'string' && player.length > 0) return player;
    return null;
}

function playerKey(payloadOrPlayer) {
    const player = payloadOrPlayer && typeof payloadOrPlayer === 'object'
        ? normalizePlayer(payloadOrPlayer)
        : payloadOrPlayer;
    return player === null || player === undefined ? 'global' : `player:${String(player)}`;
}

function cloneOrigin(origin) {
    if (!origin) return null;
    return {
        board: { ...origin.board },
        normalized: { ...origin.normalized },
        centered: { ...origin.centered },
        position: origin.position ? { ...origin.position } : null,
        player: origin.player ?? null,
    };
}

function cloneGlyph(glyph) {
    if (!glyph) return null;
    return {
        type: glyph.type,
        color: glyph.color,
        rotation: glyph.rotation,
        pieceId: glyph.pieceId,
        shape: glyph.shape.map((row) => row.slice()),
        cells: glyph.cells.map((cell) => ({ ...cell })),
        boardCells: glyph.boardCells.map((cell) => ({ ...cell })),
        hasBoardPosition: glyph.hasBoardPosition,
    };
}

function defaultOrigin(payload = {}) {
    const normalized = { x: 0.5, y: 0.5 };
    return {
        board: {
            x: BOARD_COLUMNS / 2,
            y: HIDDEN_ROWS + (VISIBLE_ROWS / 2),
        },
        normalized,
        centered: { x: 0, y: 0 },
        position: copyFinitePosition(payload?.position),
        player: normalizePlayer(payload),
    };
}

function originFromBoardPoint(boardX, boardY, payload = {}) {
    const normalizedX = clamp01(boardX / BOARD_COLUMNS);
    const normalizedY = clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);
    return {
        board: { x: boardX, y: boardY },
        normalized: { x: normalizedX, y: normalizedY },
        centered: {
            x: normalizedX * 2 - 1,
            y: 1 - normalizedY * 2,
        },
        position: copyFinitePosition(payload?.position),
        player: normalizePlayer(payload),
    };
}

function copyShape(shape) {
    if (!Array.isArray(shape)) return [];
    return shape.slice(0, MAX_SHAPE_SIZE).map((row) => (
        Array.isArray(row) ? row.slice(0, MAX_SHAPE_SIZE) : []
    ));
}

/**
 * Resolve the exact occupied cells carried by the canonical PIECE_LOCK snapshot.
 * Real gameplay pieces always contain four cells; malformed synthetic payloads
 * stay bounded and do not invent a replacement piece.
 */
export function resolveBlackHoleLockGlyph(payload = {}) {
    const piece = payload?.piece || {};
    const shape = copyShape(piece.shape);
    const hasBoardPosition = Number.isFinite(piece.x) && Number.isFinite(piece.y);
    const baseX = hasBoardPosition ? Number(piece.x) : 0;
    const baseY = hasBoardPosition ? Number(piece.y) : 0;
    const cells = [];
    const boardCells = [];

    for (let rowIndex = 0; rowIndex < shape.length; rowIndex += 1) {
        const row = shape[rowIndex];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
            if (!row[columnIndex]) continue;
            const cell = { x: columnIndex, y: rowIndex };
            cells.push(cell);
            if (hasBoardPosition) {
                boardCells.push({
                    x: baseX + columnIndex,
                    y: baseY + rowIndex,
                });
            }
        }
    }

    const rawType = piece.shapeKey ?? piece.type;
    return {
        type: typeof rawType === 'string' ? rawType.toUpperCase() : null,
        color: typeof piece.color === 'string' ? piece.color : null,
        rotation: finiteNumber(piece.rotation, 0),
        pieceId: piece.pieceId ?? null,
        shape,
        cells,
        boardCells,
        hasBoardPosition: hasBoardPosition && boardCells.length > 0,
    };
}

/** Map a lock snapshot to board, normalized (top-left), and centered coordinates. */
export function resolveBlackHoleLockOrigin(payload = {}, fallbackOrigin = null) {
    const glyph = resolveBlackHoleLockGlyph(payload);
    if (!glyph.hasBoardPosition) {
        const fallback = cloneOrigin(fallbackOrigin) || defaultOrigin(payload);
        fallback.position = copyFinitePosition(payload?.position) || fallback.position;
        fallback.player = normalizePlayer(payload) ?? fallback.player;
        return fallback;
    }

    const centroid = glyph.boardCells.reduce(
        (sum, cell) => ({
            x: sum.x + cell.x + 0.5,
            y: sum.y + cell.y + 0.5,
        }),
        { x: 0, y: 0 },
    );
    const origin = originFromBoardPoint(
        centroid.x / glyph.boardCells.length,
        centroid.y / glyph.boardCells.length,
        payload,
    );
    // A scrolling/nonstandard mode (Infinity) supplies the ON-SCREEN lock position; prefer it
    // over the fixed-board normalization so the effect tracks where the piece actually landed.
    // Keep origin.board as the true centroid (the onPieceLock coalesce key reads it).
    const viewport = readLockViewportOrigin(payload);
    if (viewport) {
        origin.normalized = { x: viewport.x, y: viewport.y };
        origin.centered = { x: viewport.x * 2 - 1, y: 1 - viewport.y * 2 };
    }
    return origin;
}

/** Resolve a row-aligned origin, retaining the previous action as a safe fallback. */
export function resolveBlackHoleLineOrigin(payload = {}, fallbackOrigin = null) {
    const rows = Array.isArray(payload?.clearedRows)
        ? payload.clearedRows
            .filter(Number.isFinite)
            .slice(0, BLACK_HOLE_FX_LIMITS.maxClearedRows)
            .map(Number)
        : [];

    if (rows.length === 0) {
        const fallback = cloneOrigin(fallbackOrigin) || defaultOrigin(payload);
        fallback.position = copyFinitePosition(payload?.position) || fallback.position;
        fallback.player = normalizePlayer(payload) ?? fallback.player;
        return fallback;
    }

    const meanRow = rows.reduce((total, row) => total + row, 0) / rows.length;
    const origin = originFromBoardPoint(BOARD_COLUMNS / 2, meanRow + 0.5, payload);
    // Infinity supplies the ON-SCREEN clear origin; prefer its Y over the fixed-board row
    // normalization (clearedRows are absolute rows in Infinity → the fallback pins to bottom).
    const viewport = readLockViewportOrigin(payload);
    if (viewport) {
        origin.normalized.y = viewport.y;
        origin.centered.y = 1 - viewport.y * 2;
    }
    return origin;
}

/** Sample the three lock beats without timers or refresh-rate assumptions. */
export function sampleBlackHoleLockEnvelope(elapsedMs, reducedMotion = false) {
    const elapsed = Math.max(0, finiteNumber(elapsedMs, 0));
    const envelope = reducedMotion
        ? REDUCED_BLACK_HOLE_LOCK_ENVELOPE
        : BLACK_HOLE_LOCK_ENVELOPE;

    if (reducedMotion) {
        return {
            compression: 0,
            rippleProgress: 0,
            rippleOpacity: 0,
            streamProgress: 0,
            streamOpacity: 0,
            core: pulse(
                elapsed,
                envelope.coreStartMs,
                envelope.corePeakMs,
                envelope.coreEndMs,
            ),
            complete: elapsed >= envelope.durationMs,
        };
    }

    const streamProgress = rangeProgress(
        elapsed,
        envelope.streamStartMs,
        envelope.streamEndMs,
    );
    return {
        compression: pulse(
            elapsed,
            envelope.compressionStartMs,
            envelope.compressionPeakMs,
            envelope.compressionEndMs,
        ),
        rippleProgress: rangeProgress(
            elapsed,
            envelope.rippleStartMs,
            envelope.rippleEndMs,
        ),
        rippleOpacity: pulse(
            elapsed,
            envelope.rippleStartMs,
            envelope.ripplePeakMs,
            envelope.rippleEndMs,
        ),
        streamProgress,
        streamOpacity: Math.sin(streamProgress * Math.PI),
        core: pulse(
            elapsed,
            envelope.coreStartMs,
            envelope.corePeakMs,
            envelope.coreEndMs,
        ),
        complete: elapsed >= envelope.durationMs,
    };
}

export function resolveBlackHoleComboPhenomenon(comboCount) {
    const count = safeInteger(
        comboCount,
        0,
        0,
        BLACK_HOLE_FX_LIMITS.maxComboCount,
    );
    if (count >= 8) return BLACK_HOLE_COMBO_PHENOMENON.CAUSTIC;
    if (count >= 5) return BLACK_HOLE_COMBO_PHENOMENON.STELLAR_ARC;
    if (count >= 3) return BLACK_HOLE_COMBO_PHENOMENON.SHEAR_DOPPLER;
    if (count >= 1) return BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE;
    return null;
}

function comboDirectives(phenomenon) {
    const directives = {
        ringEchoes: 0,
        hotKnots: 0,
        shear: 0,
        doppler: 0,
        stellarArcs: 0,
        polarFilaments: 0,
        caustic: 0,
        farSideDisk: 0,
        backgroundWarp: 0,
    };

    switch (phenomenon) {
    case BLACK_HOLE_COMBO_PHENOMENON.CAUSTIC:
        return {
            ...directives,
            ringEchoes: BLACK_HOLE_FX_LIMITS.maxRingEchoes,
            hotKnots: BLACK_HOLE_FX_LIMITS.maxHotKnots,
            shear: 0.8,
            doppler: 0.85,
            stellarArcs: BLACK_HOLE_FX_LIMITS.maxStellarArcs,
            polarFilaments: BLACK_HOLE_FX_LIMITS.maxPolarFilaments,
            caustic: 0.72,
            farSideDisk: 0.9,
            backgroundWarp: 0.48,
        };
    case BLACK_HOLE_COMBO_PHENOMENON.STELLAR_ARC:
        return {
            ...directives,
            ringEchoes: 2,
            hotKnots: 2,
            shear: 0.62,
            doppler: 0.68,
            stellarArcs: 1,
            polarFilaments: 1,
            farSideDisk: 0.62,
            backgroundWarp: 0.24,
        };
    case BLACK_HOLE_COMBO_PHENOMENON.SHEAR_DOPPLER:
        return {
            ...directives,
            ringEchoes: 1,
            hotKnots: 2,
            shear: 0.48,
            doppler: 0.52,
            farSideDisk: 0.32,
            backgroundWarp: 0.12,
        };
    case BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE:
        return {
            ...directives,
            ringEchoes: 1,
            hotKnots: 1,
            doppler: 0.18,
        };
    default:
        return directives;
    }
}

export default class BlackHoleFXController {
    constructor({
        maxCommands = DEFAULT_MAX_COMMANDS,
        reducedMotion = false,
        intensityMultiplier = 1,
    } = {}) {
        this.maxCommands = clamp(
            Math.floor(finiteNumber(maxCommands, DEFAULT_MAX_COMMANDS)),
            1,
            MAX_CONFIGURED_COMMANDS,
        );
        this.reducedMotion = Boolean(reducedMotion);
        this.intensityMultiplier = clamp(finiteNumber(intensityMultiplier, 1), 0, 2);
        this.pendingCommands = [];
        this.playerStates = new Map();
        this.activeLocks = [];
        this.nextCommandId = 1;
        this.timeMs = 0;
        this.droppedCommandCount = 0;
        this.coalescedCommandCount = 0;
        this.disposed = false;
        this.signals = this.createEmptySignals();
    }

    createEmptySignals() {
        return {
            lockCompression: 0,
            lockRipple: 0,
            lockRippleProgress: 0,
            matterStream: 0,
            matterStreamProgress: 0,
            delayedCore: 0,
            linePulse: 0,
            comboEnergy: 0,
            ringPulse: 0,
            shearDoppler: 0,
            stellarArc: 0,
            caustic: 0,
        };
    }

    setReducedMotion(enabled) {
        this.reducedMotion = Boolean(enabled);
        this.activeLocks.forEach((lock) => {
            lock.reducedMotion = this.reducedMotion;
            lock.motionScale = this.reducedMotion ? 0 : 1;
        });
    }

    setIntensityMultiplier(multiplier) {
        this.intensityMultiplier = clamp(finiteNumber(multiplier, 1), 0, 2);
    }

    configure({ reducedMotion, intensityMultiplier } = {}) {
        if (reducedMotion !== undefined) this.setReducedMotion(reducedMotion);
        if (intensityMultiplier !== undefined) this.setIntensityMultiplier(intensityMultiplier);
    }

    effectiveIntensity(baseIntensity) {
        const reducedScale = this.reducedMotion ? 0.45 : 1;
        return clamp(baseIntensity * this.intensityMultiplier * reducedScale, 0, 1);
    }

    getPlayerState(payload = {}) {
        const key = playerKey(payload);
        let state = this.playerStates.get(key);
        if (!state) {
            state = {
                key,
                player: normalizePlayer(payload),
                lastOrigin: defaultOrigin(payload),
                lastComboCount: 0,
            };
            this.playerStates.set(key, state);
        }
        return state;
    }

    enqueue(type, coalesceKey, payload = {}) {
        if (this.disposed) return null;
        const command = {
            id: this.nextCommandId,
            type,
            issuedAtMs: this.timeMs,
            reducedMotion: this.reducedMotion,
            motionScale: this.reducedMotion ? 0 : 1,
            ...payload,
        };
        this.nextCommandId += 1;

        const existingIndex = this.pendingCommands.findIndex(
            (candidate) => candidate.coalesceKey === coalesceKey,
        );
        if (existingIndex >= 0) {
            const existing = this.pendingCommands[existingIndex];
            command.id = existing.id;
            this.pendingCommands[existingIndex] = command;
            this.coalescedCommandCount += 1;
            return command;
        }

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
        const glyph = resolveBlackHoleLockGlyph(payload);
        const origin = resolveBlackHoleLockOrigin(payload, state.lastOrigin);
        state.lastOrigin = cloneOrigin(origin);
        const intensity = this.effectiveIntensity(0.42);
        const pieceKey = glyph.pieceId ?? `${origin.board.x.toFixed(3)}:${origin.board.y.toFixed(3)}`;
        const coalesceKey = `lock:${state.key}:${String(pieceKey)}`;
        const envelope = this.reducedMotion
            ? REDUCED_BLACK_HOLE_LOCK_ENVELOPE
            : BLACK_HOLE_LOCK_ENVELOPE;
        const command = this.enqueue(
            BLACK_HOLE_FX_COMMAND.PIECE_LOCK,
            coalesceKey,
            {
                coalesceKey,
                player: state.player,
                origin: cloneOrigin(origin),
                glyph: cloneGlyph(glyph),
                intensity,
                durationMs: envelope.durationMs,
                envelope,
                lockMotes: this.reducedMotion ? 0 : BLACK_HOLE_FX_LIMITS.maxLockMotes,
                matterStreamParticles: this.reducedMotion
                    ? 0
                    : BLACK_HOLE_FX_LIMITS.maxMatterStreamParticles,
                rippleCount: this.reducedMotion ? 0 : 1,
            },
        );

        const existing = this.activeLocks.find((lock) => lock.coalesceKey === coalesceKey);
        const activeLock = {
            coalesceKey,
            issuedAtMs: this.timeMs,
            intensity,
            reducedMotion: this.reducedMotion,
            motionScale: this.reducedMotion ? 0 : 1,
        };
        if (existing) {
            Object.assign(existing, activeLock);
        } else {
            if (this.activeLocks.length >= BLACK_HOLE_FX_LIMITS.maxActiveLocks) {
                this.activeLocks.shift();
            }
            this.activeLocks.push(activeLock);
        }
        return command;
    }

    onLineClear(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const origin = resolveBlackHoleLineOrigin(payload, state.lastOrigin);
        state.lastOrigin = cloneOrigin(origin);
        const rawLineCount = safeInteger(payload?.lineCount, 1, 1, VISIBLE_ROWS);
        const lineCount = Math.min(rawLineCount, BLACK_HOLE_FX_LIMITS.maxVisualLineCount);
        const cascadeCount = safeInteger(
            payload?.cascadeCount,
            1,
            1,
            BLACK_HOLE_FX_LIMITS.maxCascadeCount,
        );
        const clearedRows = Array.isArray(payload?.clearedRows)
            ? payload.clearedRows
                .filter(Number.isFinite)
                .slice(0, BLACK_HOLE_FX_LIMITS.maxClearedRows)
                .map(Number)
            : [];
        const intensity = this.effectiveIntensity(
            clamp(0.28 + lineCount * 0.12 + (cascadeCount - 1) * 0.04, 0, 0.9),
        );
        this.signals.linePulse = Math.max(this.signals.linePulse, intensity);
        const coalesceKey = `line:${state.key}`;
        return this.enqueue(
            BLACK_HOLE_FX_COMMAND.LINE_CLEAR,
            coalesceKey,
            {
                coalesceKey,
                player: state.player,
                origin: cloneOrigin(origin),
                rawLineCount,
                lineCount,
                cascadeCount,
                clearedRows,
                intensity,
                durationMs: this.reducedMotion ? 160 : 320,
            },
        );
    }

    onCombo(payload = {}) {
        if (this.disposed) return null;
        const state = this.getPlayerState(payload);
        const comboCount = safeInteger(
            payload?.comboCount,
            0,
            0,
            BLACK_HOLE_FX_LIMITS.maxComboCount,
        );
        if (comboCount <= 0) {
            state.lastComboCount = 0;
            return null;
        }
        if (comboCount === state.lastComboCount) return null;
        if (comboCount < state.lastComboCount) state.lastComboCount = 0;
        state.lastComboCount = comboCount;

        const explicitPosition = copyFinitePosition(payload?.position);
        const origin = cloneOrigin(state.lastOrigin) || defaultOrigin(payload);
        if (explicitPosition) origin.position = explicitPosition;
        origin.player = state.player;
        state.lastOrigin = cloneOrigin(origin);

        const phenomenon = resolveBlackHoleComboPhenomenon(comboCount);
        const intensity = this.effectiveIntensity(clamp(0.28 + comboCount * 0.075, 0, 1));
        const directives = comboDirectives(phenomenon);
        this.signals.comboEnergy = Math.max(this.signals.comboEnergy, intensity);
        this.signals[this.signalNameForPhenomenon(phenomenon)] = Math.max(
            this.signals[this.signalNameForPhenomenon(phenomenon)] || 0,
            intensity,
        );
        const coalesceKey = `combo:${state.key}:${phenomenon}`;
        return this.enqueue(
            BLACK_HOLE_FX_COMMAND.COMBO,
            coalesceKey,
            {
                coalesceKey,
                player: state.player,
                origin: cloneOrigin(origin),
                comboCount,
                phenomenon,
                directives,
                intensity,
                durationMs: this.reducedMotion
                    ? 240
                    : clamp(420 + comboCount * 80, 420, 1200),
            },
        );
    }

    signalNameForPhenomenon(phenomenon) {
        switch (phenomenon) {
        case BLACK_HOLE_COMBO_PHENOMENON.SHEAR_DOPPLER:
            return 'shearDoppler';
        case BLACK_HOLE_COMBO_PHENOMENON.STELLAR_ARC:
            return 'stellarArc';
        case BLACK_HOLE_COMBO_PHENOMENON.CAUSTIC:
            return 'caustic';
        case BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE:
        default:
            return 'ringPulse';
        }
    }

    dispatch(eventName, payload = {}) {
        if (!Object.prototype.hasOwnProperty.call(EVENT_METHODS, eventName)) return null;
        const method = EVENT_METHODS[eventName];
        return typeof this[method] === 'function' ? this[method](payload) : null;
    }

    step(deltaSeconds) {
        if (this.disposed) return this.getSignals();
        const delta = clamp(finiteNumber(deltaSeconds, 0), 0, 0.25);
        this.timeMs += delta * 1000;

        let lockCompression = 0;
        let lockRipple = 0;
        let lockRippleProgress = 0;
        let matterStream = 0;
        let matterStreamProgress = 0;
        let delayedCore = 0;
        const remainingLocks = [];

        for (let index = 0; index < this.activeLocks.length; index += 1) {
            const lock = this.activeLocks[index];
            const sample = sampleBlackHoleLockEnvelope(
                this.timeMs - lock.issuedAtMs,
                lock.reducedMotion,
            );
            const motionIntensity = lock.intensity * lock.motionScale;
            lockCompression = Math.max(lockCompression, sample.compression * motionIntensity);
            lockRipple = Math.max(lockRipple, sample.rippleOpacity * motionIntensity);
            lockRippleProgress = Math.max(lockRippleProgress, sample.rippleProgress);
            matterStream = Math.max(matterStream, sample.streamOpacity * motionIntensity);
            matterStreamProgress = Math.max(matterStreamProgress, sample.streamProgress);
            delayedCore = Math.max(delayedCore, sample.core * lock.intensity);
            if (!sample.complete) remainingLocks.push(lock);
        }
        this.activeLocks = remainingLocks;

        this.signals.lockCompression = lockCompression;
        this.signals.lockRipple = lockRipple;
        this.signals.lockRippleProgress = lockRippleProgress;
        this.signals.matterStream = matterStream;
        this.signals.matterStreamProgress = matterStreamProgress;
        this.signals.delayedCore = delayedCore;
        this.signals.linePulse = Math.max(0, this.signals.linePulse - delta * 2.4);
        this.signals.comboEnergy *= Math.exp(-1.15 * delta);
        this.signals.ringPulse *= Math.exp(-2.6 * delta);
        this.signals.shearDoppler *= Math.exp(-1.8 * delta);
        this.signals.stellarArc *= Math.exp(-1.35 * delta);
        this.signals.caustic *= Math.exp(-1.1 * delta);
        return this.getSignals();
    }

    getSignals() {
        // Reuse a persistent view object. step() calls this every animation frame, so a fresh
        // spread here was a steady per-frame allocation. Object.assign copies into the existing
        // object (no allocation) and stays robust if the signal shape changes. Callers read the
        // fields immediately within the frame and never retain the object across a step, so a
        // shared instance is safe.
        const view = this._signalsView || (this._signalsView = {});
        Object.assign(view, this.signals);
        view.activeLockCount = this.activeLocks.length;
        view.timeMs = this.timeMs;
        return view;
    }

    drainCommands() {
        // The queue is empty on the vast majority of frames (commands only enqueue on
        // lock/clear/combo events). Return a shared empty array in that case so the per-frame
        // drain allocates nothing; only swap in a fresh backing array when there is real work.
        if (this.pendingCommands.length === 0) return EMPTY_COMMANDS;
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        return commands;
    }

    getState() {
        return {
            pendingCommandCount: this.pendingCommands.length,
            activeLockCount: this.activeLocks.length,
            playerCount: this.playerStates.size,
            droppedCommandCount: this.droppedCommandCount,
            coalescedCommandCount: this.coalescedCommandCount,
            reducedMotion: this.reducedMotion,
            intensityMultiplier: this.intensityMultiplier,
            disposed: this.disposed,
        };
    }

    reset() {
        this.pendingCommands = [];
        this.playerStates.clear();
        this.activeLocks = [];
        this.nextCommandId = 1;
        this.timeMs = 0;
        this.droppedCommandCount = 0;
        this.coalescedCommandCount = 0;
        this.disposed = false;
        this.signals = this.createEmptySignals();
    }

    dispose() {
        if (this.disposed) return;
        this.pendingCommands = [];
        this.playerStates.clear();
        this.activeLocks = [];
        this.disposed = true;
    }

    cleanup() {
        this.dispose();
    }
}
