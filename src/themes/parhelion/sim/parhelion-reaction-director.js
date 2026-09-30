/**
 * Parhelion gameplay reaction director (spec §7.1 / §7.6).
 *
 * Renderer-free, DOM-free at import, bus-free. The canonical gameplay events are delivered
 * synchronously inside the simulation tick, so every on*() handler only STAGES numbers into
 * one of five preallocated player slots. update(dt) — called FIRST in the theme frame —
 * resolves each pending slot into ONE dominant cue:
 *
 *   PERFECT > APEX (true combo >= 10, 6 s cooldown per player) > TSPIN > QUAD (lines >= 4)
 *   > CLEAR > STONEFALL (hard drop) > LOCK
 *
 * T-spin, B2B, true combo, cascade depth and line count are modifiers on that one cue, never
 * separate shows. "QUAD" is the four-line clear.
 *
 * Handler names (one per canonical event; `PARHELION_EVENT_HANDLERS` maps EVENTS keys to them):
 *   onPieceLock, onHardDrop, onLineClear, onCombo, onTSpin, onB2B, onPerfectClear, onLevelUp.
 * Serenity-mode clicks arrive as LINE_CLEAR/COMBO carrying `position`; they go through the same
 * onLineClear/onCombo handlers (the "Glint Bloom" is a CLEAR/QUAD/APEX cue with sx/sy >= 0).
 *
 * Sink contract — `{ cue(c), resonance(r), levelUp(n), count(n) }`, every method optional,
 * called synchronously, never retained:
 *   cue(c)       one dominant cue (or a B2B ECHO). `c` is ONE reused object: copy what you need.
 *   resonance(r) the eased combo resonance in [0, 1], whenever it changes (and 0 on reset).
 *   levelUp(n)   LEVEL_UP → the "Lower Sun" level (slow persistent enrichment, not a burst).
 *   count(n)     the "Full Circle" beat, fired after the quiet LOCK/STONEFALL cue that carries
 *                it; `n` is the primary lockCount at which it actually fires (>= the multiple of
 *                12 when it was deferred past a CLEAR+ resolution).
 *
 * Cue fields (`c`):
 *   kind           CUE.* number. ECHO is the delayed B2B answer; `echoOf` holds the kind echoed.
 *   player         payload.player ?? 0 (0 = default board, 1..4 = local-MP boards).
 *   primary        player 0 or 1 — the board that owns the Halo Count stations.
 *   lockU, lockV   BOARD-normalised lock origin (0..1 of the board canvas, y-down):
 *                  readLockViewportOrigin (Infinity) > occupied-cell centroid > last known.
 *   rowV           BOARD-normalised row height the cue climbs from. Clear-family cues use the
 *                  LINE_CLEAR viewportOrigin.y (Infinity) > cleared-row mean > lock centroid.
 *                  LOCK/STONEFALL/TSPIN are lock-anchored: rowV === lockV.
 *   sx, sy         SCREEN-normalised (0..1 of the window, y-down) ONLY for Serenity clicks
 *                  (`position` in CSS px / window size); otherwise -1 and the consumer maps
 *                  lockU/rowV through the board rect. Infinity's viewportOrigin is NOT screen
 *                  space: InfinityMode computes it as col/10 and (row - topRow)/visibleRows, i.e.
 *                  a fraction of the visible playfield, so it feeds lockU/lockV/rowV instead.
 *   lines          1..4 for clear-family cues (T-spin: max of TSPIN/LINE_CLEAR counts), else 0.
 *   combo          true consecutive-clear combo (ComboTracker per player); an explicit
 *                  LINE_CLEAR.comboCount (Serenity clicks, Odyssey victory lap) can raise it.
 *   cascade        LINE_CLEAR.cascadeCount of the deepest wave staged this frame (1 default).
 *   depth          COMBO.comboCount — cascade DEPTH, never a combo. Only a modifier:
 *                  clear strength +0.05 * min(3, depth).
 *   strength       beat-local s of §7.4 (1 = the nominal authored beat), already multiplied by
 *                  intensity (capped at 0.45 under reduced motion).
 *   reducedMotion  current setting, so the consumer picks the static/short form.
 *   lockCount      primary-board PIECE_LOCK count (station k = lockCount % 12).
 *   b2b            the special continues a B2B chain (an ECHO follows 0.18 s later).
 *   echoOf         for ECHO: the CUE kind it repeats; CUE.NONE otherwise.
 *
 * Allocation discipline: handlers and update() create no objects, arrays or closures. The one
 * exception is readLockViewportOrigin's tiny result object, and it is only called when the
 * payload actually carries a viewportOrigin (Infinity). The B2B echo ring is typed arrays,
 * written by value, so a later resolution can never move an in-flight echo.
 */
import { ComboTracker } from '../../../core/combo-tracker.js';
import { readLockViewportOrigin } from '../../../events/lock-origin.js';

const BOARD_COLUMNS = 10;
const HIDDEN_ROWS = 4;
const VISIBLE_ROWS = 20;
const MAX_SHAPE_SIZE = 8;
const MAX_LINES = 4;

export const PARHELION_PLAYER_SLOTS = 5;
export const PARHELION_ECHO_CAPACITY = 8;
export const PARHELION_ECHO_DELAY = 0.18;
export const PARHELION_ECHO_STRENGTH = 0.5;
export const PARHELION_APEX_COMBO = 10;
export const PARHELION_APEX_COOLDOWN = 6;
export const PARHELION_FULL_CIRCLE_LOCKS = 12;
export const PARHELION_RESONANCE = Object.freeze({
    rise: 0.28,
    fall: 0.85,
    hold: 1.65,
});
/** Reduced motion caps the reaction intensity (§7.6). */
export const PARHELION_REDUCED_MOTION_INTENSITY = 0.45;

const MAX_DELTA = 0.1;
const TIME_EPSILON = 1e-9;
const RESONANCE_EPSILON = 1e-5;
const HALF_LIFE_FACTOR = Math.log(2);
// Frostfall (§7.4): s = .4 + .25 * clamp(dist / 18), normalised by its 0.65 peak so a full
// drop is the nominal beat (s = 1) and a zero-distance drop (s ≈ 0.62) still out-punches the
// plain Halo Count station (.3 * .62 > .18), as the §7.5 ladder requires.
const STONEFALL_BASE = 0.4;
const STONEFALL_RANGE = 0.25;
const STONEFALL_ROWS = 18;
const CASCADE_DEPTH_STEP = 0.05;
const CASCADE_DEPTH_MAX = 3;

const EMPTY_PAYLOAD = Object.freeze({});

export const CUE = Object.freeze({
    NONE: 0,
    LOCK: 1,
    STONEFALL: 2,
    CLEAR: 3,
    QUAD: 4,
    TSPIN: 5,
    APEX: 6,
    PERFECT: 7,
    ECHO: 8,
});

/** Canonical EVENTS key → director handler name, for the theme's bus wiring. */
export const PARHELION_EVENT_HANDLERS = Object.freeze({
    PIECE_LOCK: 'onPieceLock',
    HARD_DROP: 'onHardDrop',
    LINE_CLEAR: 'onLineClear',
    COMBO: 'onCombo',
    TSPIN: 'onTSpin',
    B2B: 'onB2B',
    PERFECT_CLEAR: 'onPerfectClear',
    LEVEL_UP: 'onLevelUp',
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

function playerOf(payload) {
    return Number.isFinite(payload.player) ? Math.trunc(Number(payload.player)) : 0;
}

function isPrimaryPlayer(player) {
    return player === 0 || player === 1;
}

function readWindowSize(height) {
    if (typeof window === 'undefined' || !window) return 0;
    const size = height ? window.innerHeight : window.innerWidth;
    return Number.isFinite(size) && size > 0 ? size : 0;
}

function createSlot() {
    return {
        assigned: false,
        player: 0,
        touched: 0,
        pending: false,
        // lock intake
        lockTicks: 0,
        lock: false,
        hardDrop: false,
        drop: 0,
        lockFresh: false,
        lockU: 0.5,
        lockV: 0.5,
        // clear intake
        lines: 0,
        cascade: 1,
        rowFresh: false,
        rowV: 0.5,
        depth: 0,
        explicitCombo: -1,
        // modifiers / specials
        tspin: false,
        tspinLines: 0,
        b2b: false,
        perfect: false,
        perfectDepth: 0,
        level: 0,
        // Serenity click (CSS px)
        hasPosition: false,
        posX: 0,
        posY: 0,
        // persistent per-player state
        tracker: new ComboTracker(),
        apexAt: -Infinity,
        resTarget: 0,
        resHold: 0,
    };
}

function clearPending(slot) {
    slot.pending = false;
    slot.lockTicks = 0;
    slot.lock = false;
    slot.hardDrop = false;
    slot.drop = 0;
    slot.lockFresh = false;
    slot.lines = 0;
    slot.cascade = 1;
    slot.rowFresh = false;
    slot.depth = 0;
    slot.explicitCombo = -1;
    slot.tspin = false;
    slot.tspinLines = 0;
    slot.b2b = false;
    slot.perfect = false;
    slot.perfectDepth = 0;
    slot.level = 0;
    slot.hasPosition = false;
    slot.posX = 0;
    slot.posY = 0;
}

function resetSlot(slot, releaseIdentity) {
    clearPending(slot);
    slot.lockU = 0.5;
    slot.lockV = 0.5;
    slot.rowV = 0.5;
    slot.tracker.reset();
    slot.apexAt = -Infinity;
    slot.resTarget = 0;
    slot.resHold = 0;
    if (releaseIdentity) {
        slot.assigned = false;
        slot.player = 0;
        slot.touched = 0;
    }
}

function createCue() {
    return {
        kind: CUE.NONE,
        player: 0,
        primary: true,
        sx: -1,
        sy: -1,
        rowV: 0.5,
        lockU: 0.5,
        lockV: 0.5,
        lines: 0,
        combo: 0,
        cascade: 1,
        depth: 0,
        strength: 0,
        reducedMotion: false,
        lockCount: 0,
        b2b: false,
        echoOf: CUE.NONE,
    };
}

/**
 * Lock origin: Infinity's on-playfield viewportOrigin wins; otherwise the centroid of the
 * OCCUPIED shape cells (the matrix is padded — never the bounding box). Leaves the slot's
 * last origin untouched when the payload carries neither.
 */
function captureLockOrigin(slot, payload) {
    if (payload.viewportOrigin) {
        const viewport = readLockViewportOrigin(payload);
        if (viewport) {
            slot.lockU = viewport.x;
            slot.lockV = viewport.y;
            slot.lockFresh = true;
            return;
        }
    }
    const piece = payload.piece || EMPTY_PAYLOAD;
    const { shape } = piece;
    if (!Array.isArray(shape)) return;
    const pieceX = finiteNumber(piece.x, BOARD_COLUMNS * 0.5 - 1);
    const pieceY = finiteNumber(piece.y, HIDDEN_ROWS);
    let totalX = 0;
    let totalY = 0;
    let occupied = 0;
    const rowLimit = Math.min(shape.length, MAX_SHAPE_SIZE);
    for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
        const row = shape[rowIndex];
        if (!Array.isArray(row)) continue;
        const columnLimit = Math.min(row.length, MAX_SHAPE_SIZE);
        for (let columnIndex = 0; columnIndex < columnLimit; columnIndex += 1) {
            if (Number(row[columnIndex]) > 0) {
                totalX += pieceX + columnIndex + 0.5;
                totalY += pieceY + rowIndex + 0.5;
                occupied += 1;
            }
        }
    }
    if (occupied === 0) return;
    slot.lockU = clamp01(totalX / occupied / BOARD_COLUMNS);
    slot.lockV = clamp01((totalY / occupied - HIDDEN_ROWS) / VISIBLE_ROWS);
    slot.lockFresh = true;
}

/** Clear origin: LINE_CLEAR viewportOrigin.y (Infinity) > mean of the cleared rows. */
function captureRowOrigin(slot, payload) {
    if (payload.viewportOrigin) {
        const viewport = readLockViewportOrigin(payload);
        if (viewport) {
            slot.rowV = viewport.y;
            slot.rowFresh = true;
            return;
        }
    }
    const rows = payload.clearedRows;
    if (!Array.isArray(rows) || rows.length === 0) return;
    let total = 0;
    let count = 0;
    for (let index = 0; index < rows.length; index += 1) {
        if (Number.isFinite(rows[index])) {
            total += Number(rows[index]);
            count += 1;
        }
    }
    if (count === 0) return;
    slot.rowV = clamp01((total / count + 0.5 - HIDDEN_ROWS) / VISIBLE_ROWS);
    slot.rowFresh = true;
}

function capturePosition(slot, payload) {
    const { position } = payload;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        slot.hasPosition = true;
        slot.posX = Number(position.x);
        slot.posY = Number(position.y);
    }
}

export class ReactionDirector {
    /**
     * @param {{
     *   sink?: { cue?: Function, resonance?: Function, levelUp?: Function, count?: Function },
     *   reducedMotion?: boolean,
     *   intensity?: number,
     *   lockRipple?: boolean,
     * }} [options]
     */
    constructor(options = EMPTY_PAYLOAD) {
        this.sink = options.sink || null;
        this.reducedMotion = options.reducedMotion === true;
        this.intensity = clamp01(finiteNumber(options.intensity, 1));
        this.lockRipple = options.lockRipple !== false;
        this.gain = 1;
        this._updateGain();

        this.time = 0;
        this.touchSerial = 0;
        this.lockCount = 0;
        this.fullCirclePending = false;
        this.resonance = 0;
        this.resonanceTarget = 0;
        this.emittedResonance = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        this.droppedEvents = 0;
        this.droppedEchoes = 0;
        this.sinkErrors = 0;
        this.disposed = false;

        this.slots = new Array(PARHELION_PLAYER_SLOTS);
        for (let index = 0; index < PARHELION_PLAYER_SLOTS; index += 1) {
            this.slots[index] = createSlot();
        }

        this.cue = createCue();

        this.echoHead = 0;
        this.echoCount = 0;
        this.echoDue = new Float64Array(PARHELION_ECHO_CAPACITY);
        this.echoKind = new Uint8Array(PARHELION_ECHO_CAPACITY);
        this.echoPlayer = new Int16Array(PARHELION_ECHO_CAPACITY);
        this.echoPrimary = new Uint8Array(PARHELION_ECHO_CAPACITY);
        this.echoLines = new Uint8Array(PARHELION_ECHO_CAPACITY);
        this.echoCombo = new Uint16Array(PARHELION_ECHO_CAPACITY);
        this.echoSx = new Float32Array(PARHELION_ECHO_CAPACITY);
        this.echoSy = new Float32Array(PARHELION_ECHO_CAPACITY);
        this.echoRowV = new Float32Array(PARHELION_ECHO_CAPACITY);
        this.echoLockU = new Float32Array(PARHELION_ECHO_CAPACITY);
        this.echoLockV = new Float32Array(PARHELION_ECHO_CAPACITY);
        this.echoStrength = new Float32Array(PARHELION_ECHO_CAPACITY);
    }

    /**
     * Settings may change at any time. intensity 0 (reactions off) resets everything so
     * re-enabling can never replay stale gameplay; switching lockRipple off cancels staged
     * lock/hard-drop cues and a pending Full Circle but keeps the captured lock origin for a
     * co-resolving T-spin/clear.
     */
    configure(options = EMPTY_PAYLOAD) {
        if (this.disposed) return;
        if (options.reducedMotion !== undefined) this.reducedMotion = options.reducedMotion === true;
        if (options.intensity !== undefined) {
            this.intensity = clamp01(finiteNumber(options.intensity, this.intensity));
        }
        if (options.lockRipple !== undefined) {
            this.lockRipple = options.lockRipple !== false;
            if (!this.lockRipple) {
                this.fullCirclePending = false;
                for (let index = 0; index < this.slots.length; index += 1) {
                    this.slots[index].lock = false;
                    this.slots[index].hardDrop = false;
                }
            }
        }
        this._updateGain();
        if (this.intensity <= 0) this.reset();
    }

    /**
     * Optional window size (CSS px) for normalising Serenity click positions. When unset the
     * director reads window.innerWidth/innerHeight inside update() — never inside a handler.
     */
    setViewport(width, height) {
        this.viewportWidth = Number.isFinite(width) && width > 0 ? Number(width) : 0;
        this.viewportHeight = Number.isFinite(height) && height > 0 ? Number(height) : 0;
    }

    // ── intake: synchronous bus handlers → stage numbers only ───────────────────

    onPieceLock(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.lock = this.lockRipple;
        slot.lockTicks += 1;
        slot.tracker.notePieceLocked();
        captureLockOrigin(slot, payload);
        return true;
    }

    /** Same tick as, and just BEFORE, the PIECE_LOCK of the same piece. */
    onHardDrop(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.hardDrop = this.lockRipple;
        const span = finiteNumber(payload.endY, 0) - finiteNumber(payload.startY, 0);
        slot.drop = Math.max(slot.drop, Math.max(0, finiteNumber(payload.distance, span)));
        captureLockOrigin(slot, payload);
        return true;
    }

    onLineClear(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        const cascade = clamp(Math.trunc(finiteNumber(payload.cascadeCount, 1)), 1, 255);
        if (slot.lines === 0 || cascade >= slot.cascade) {
            // Keep the deepest wave staged this frame.
            const rows = payload.clearedRows;
            const fallbackLines = Array.isArray(rows) && rows.length > 0 ? rows.length : 1;
            slot.lines = clamp(Math.trunc(finiteNumber(payload.lineCount, fallbackLines)), 1, MAX_LINES);
            slot.cascade = cascade;
            captureRowOrigin(slot, payload);
        }
        slot.tracker.noteLineClear();
        if (Number.isFinite(payload.comboCount)) {
            // Only Serenity clicks and Odyssey's victory lap put a combo on LINE_CLEAR.
            slot.explicitCombo = Math.max(slot.explicitCombo, Math.trunc(Number(payload.comboCount)));
        }
        capturePosition(slot, payload);
        return true;
    }

    /**
     * COMBO carries cascade DEPTH (fires once per wave >= 2), never a combo. The exception is a
     * Serenity click (it carries `position`), where comboCount is the click combo.
     */
    onCombo(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        const count = Math.max(0, Math.trunc(finiteNumber(payload.comboCount, 0)));
        const { position } = payload;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            slot.explicitCombo = Math.max(slot.explicitCombo, count);
            capturePosition(slot, payload);
        } else {
            slot.depth = Math.max(slot.depth, count);
        }
        return true;
    }

    onTSpin(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.tspin = true;
        slot.tspinLines = Math.max(
            slot.tspinLines,
            clamp(Math.trunc(finiteNumber(payload.lineCount, 0)), 0, MAX_LINES),
        );
        return true;
    }

    onB2B(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.b2b = payload.active !== false;
        return true;
    }

    onPerfectClear(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.perfect = true;
        slot.perfectDepth = Math.max(slot.perfectDepth, Math.max(0, finiteNumber(payload.depth, 0)));
        return true;
    }

    onLevelUp(event) {
        const payload = event || EMPTY_PAYLOAD;
        const slot = this._slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.level = Math.max(slot.level, Math.max(1, Math.trunc(finiteNumber(payload.level, 1))));
        return true;
    }

    // ── theme-time loop: call FIRST in the frame so cues land this frame ────────

    update(deltaSeconds) {
        if (this.disposed) return;
        const delta = clamp(finiteNumber(deltaSeconds, 0), 0, MAX_DELTA);
        this.time += delta;
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index];
            if (slot.pending) this._resolve(slot);
        }
        this._fireDueEchoes();
        this._updateResonance(delta);
    }

    /** Window 'gameOver', modeStopped, or intensity 0: forget every chain, count and echo. */
    reset() {
        const hadResonance = this.emittedResonance !== 0;
        this.time = 0;
        this.touchSerial = 0;
        this.lockCount = 0;
        this.fullCirclePending = false;
        this.resonance = 0;
        this.resonanceTarget = 0;
        this.emittedResonance = 0;
        for (let index = 0; index < this.slots.length; index += 1) {
            resetSlot(this.slots[index], true);
        }
        this.echoHead = 0;
        this.echoCount = 0;
        if (hadResonance) this._callSink('resonance', 0);
    }

    dispose() {
        if (this.disposed) return;
        this.reset();
        this.disposed = true;
        this.sink = null;
    }

    /** Diagnostics only (allocates); intake and update() never do. */
    getDebugState() {
        let assignedSlots = 0;
        let pendingSlots = 0;
        for (let index = 0; index < this.slots.length; index += 1) {
            if (this.slots[index].assigned) assignedSlots += 1;
            if (this.slots[index].pending) pendingSlots += 1;
        }
        return {
            time: this.time,
            lockCount: this.lockCount,
            fullCirclePending: this.fullCirclePending,
            resonance: this.resonance,
            resonanceTarget: this.resonanceTarget,
            slotCount: this.slots.length,
            assignedSlots,
            pendingSlots,
            echoCount: this.echoCount,
            droppedEvents: this.droppedEvents,
            droppedEchoes: this.droppedEchoes,
            sinkErrors: this.sinkErrors,
            intensity: this.intensity,
            gain: this.gain,
            reducedMotion: this.reducedMotion,
            lockRipple: this.lockRipple,
            disposed: this.disposed,
            cue: this.cue,
            echoDue: this.echoDue,
            echoKind: this.echoKind,
        };
    }

    // ── internals ────────────────────────────────────────────────────────────────

    _updateGain() {
        this.gain = this.reducedMotion
            ? Math.min(this.intensity, PARHELION_REDUCED_MOTION_INTENSITY)
            : this.intensity;
    }

    /**
     * Player slot keyed by `payload.player ?? 0` only (Infinity tags some events with
     * `source` and not others, so source must not split one lock). Fixed capacity: a sixth
     * concurrent player reuses the least-recently-touched idle slot, or the event is dropped.
     */
    _slotFor(payload) {
        if (this.disposed || this.intensity <= 0) return null;
        const player = playerOf(payload);
        this.touchSerial += 1;
        let unused = null;
        let reusable = null;
        let oldestTouch = Infinity;
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index];
            if (slot.assigned && slot.player === player) {
                slot.touched = this.touchSerial;
                return slot;
            }
            if (!slot.assigned) {
                if (unused === null) unused = slot;
            } else if (!slot.pending && slot.touched < oldestTouch) {
                oldestTouch = slot.touched;
                reusable = slot;
            }
        }
        const selected = unused || reusable;
        if (!selected) {
            this.droppedEvents += 1;
            return null;
        }
        resetSlot(selected, false);
        selected.assigned = true;
        selected.player = player;
        selected.touched = this.touchSerial;
        return selected;
    }

    _resolve(slot) {
        const primary = isPrimaryPlayer(slot.player);
        if (primary && slot.lockTicks > 0) {
            const before = this.lockCount;
            this.lockCount += slot.lockTicks;
            const crossed = Math.floor(this.lockCount / PARHELION_FULL_CIRCLE_LOCKS)
                > Math.floor(before / PARHELION_FULL_CIRCLE_LOCKS);
            if (crossed && this.lockRipple) this.fullCirclePending = true;
        }

        const lines = Math.max(slot.lines, slot.tspin ? slot.tspinLines : 0);
        const combo = Math.max(slot.tracker.combo, slot.explicitCombo);
        const depthBoost = CASCADE_DEPTH_STEP * Math.min(CASCADE_DEPTH_MAX, slot.depth);

        let kind = CUE.NONE;
        let strength = 0;
        if (slot.perfect) {
            kind = CUE.PERFECT;
            strength = 1;
        } else if (
            lines > 0
            && combo >= PARHELION_APEX_COMBO
            && this.time - slot.apexAt >= PARHELION_APEX_COOLDOWN - TIME_EPSILON
        ) {
            kind = CUE.APEX;
            strength = 1;
            slot.apexAt = this.time;
        } else if (slot.tspin) {
            kind = CUE.TSPIN;
            strength = 1;
        } else if (lines >= MAX_LINES) {
            kind = CUE.QUAD;
            strength = 1 + depthBoost;
        } else if (lines > 0) {
            kind = CUE.CLEAR;
            strength = 1 + depthBoost;
        } else if (slot.hardDrop) {
            kind = CUE.STONEFALL;
            strength = (STONEFALL_BASE + STONEFALL_RANGE * clamp01(slot.drop / STONEFALL_ROWS))
                / (STONEFALL_BASE + STONEFALL_RANGE);
        } else if (slot.lock) {
            kind = CUE.LOCK;
            strength = 1;
        }

        if (kind !== CUE.NONE) {
            const special = kind === CUE.QUAD || kind === CUE.TSPIN || kind === CUE.APEX;
            const echo = special && slot.b2b;
            this._emit(slot, kind, strength * this.gain, lines, combo, echo);
            if (echo) this._scheduleEcho(kind);
            const quiet = kind === CUE.LOCK || kind === CUE.STONEFALL;
            if (quiet && primary && this.fullCirclePending) {
                this.fullCirclePending = false;
                this._callSink('count', this.lockCount);
            }
        }

        if (lines > 0) {
            slot.resTarget = clamp01(combo / PARHELION_APEX_COMBO);
            slot.resHold = PARHELION_RESONANCE.hold;
        }
        if (slot.level > 0) this._callSink('levelUp', slot.level);
        clearPending(slot);
    }

    _emit(slot, kind, strength, lines, combo, b2b) {
        const c = this.cue;
        const lockAnchored = kind === CUE.LOCK || kind === CUE.STONEFALL || kind === CUE.TSPIN;
        // Clear-family: this frame's row > this frame's lock > the last known row.
        const clearFromRow = slot.rowFresh || !slot.lockFresh;
        c.kind = kind;
        c.player = slot.player;
        c.primary = isPrimaryPlayer(slot.player);
        c.lockU = slot.lockU;
        c.lockV = slot.lockV;
        c.rowV = !lockAnchored && clearFromRow ? slot.rowV : slot.lockV;
        this._writeScreenOrigin(slot, c);
        c.lines = kind === CUE.LOCK || kind === CUE.STONEFALL ? 0 : lines;
        if (kind === CUE.PERFECT && c.lines === 0) c.lines = Math.min(MAX_LINES, slot.perfectDepth);
        c.combo = combo;
        c.cascade = slot.cascade;
        c.depth = slot.depth;
        c.strength = strength;
        c.reducedMotion = this.reducedMotion;
        c.lockCount = this.lockCount;
        c.b2b = b2b;
        c.echoOf = CUE.NONE;
        this._callSink('cue', c);
    }

    _writeScreenOrigin(slot, c) {
        c.sx = -1;
        c.sy = -1;
        if (!slot.hasPosition) return;
        const width = this.viewportWidth > 0 ? this.viewportWidth : readWindowSize(false);
        const height = this.viewportHeight > 0 ? this.viewportHeight : readWindowSize(true);
        if (width <= 0 || height <= 0) return;
        c.sx = clamp01(slot.posX / width);
        c.sy = clamp01(slot.posY / height);
    }

    /** Copies the cue just emitted BY VALUE; on overflow the oldest echo is replaced. */
    _scheduleEcho(kind) {
        if (this.echoCount >= PARHELION_ECHO_CAPACITY) {
            this.echoHead = (this.echoHead + 1) % PARHELION_ECHO_CAPACITY;
            this.echoCount -= 1;
            this.droppedEchoes += 1;
        }
        const c = this.cue;
        const index = (this.echoHead + this.echoCount) % PARHELION_ECHO_CAPACITY;
        this.echoDue[index] = this.time + PARHELION_ECHO_DELAY;
        this.echoKind[index] = kind;
        this.echoPlayer[index] = c.player;
        this.echoPrimary[index] = c.primary ? 1 : 0;
        this.echoLines[index] = c.lines;
        this.echoCombo[index] = Math.min(65535, c.combo);
        this.echoSx[index] = c.sx;
        this.echoSy[index] = c.sy;
        this.echoRowV[index] = c.rowV;
        this.echoLockU[index] = c.lockU;
        this.echoLockV[index] = c.lockV;
        this.echoStrength[index] = c.strength * PARHELION_ECHO_STRENGTH;
        this.echoCount += 1;
    }

    _fireDueEchoes() {
        while (this.echoCount > 0 && this.echoDue[this.echoHead] <= this.time + TIME_EPSILON) {
            const index = this.echoHead;
            const c = this.cue;
            c.kind = CUE.ECHO;
            c.player = this.echoPlayer[index];
            c.primary = this.echoPrimary[index] === 1;
            c.sx = this.echoSx[index];
            c.sy = this.echoSy[index];
            c.rowV = this.echoRowV[index];
            c.lockU = this.echoLockU[index];
            c.lockV = this.echoLockV[index];
            c.lines = this.echoLines[index];
            c.combo = this.echoCombo[index];
            c.cascade = 1;
            c.depth = 0;
            c.strength = this.echoStrength[index];
            c.reducedMotion = this.reducedMotion;
            c.lockCount = this.lockCount;
            c.b2b = false;
            c.echoOf = this.echoKind[index];
            this.echoHead = (this.echoHead + 1) % PARHELION_ECHO_CAPACITY;
            this.echoCount -= 1;
            this._callSink('cue', c);
        }
    }

    /**
     * r = clamp(trueCombo / 10), eased by half-life (rise 0.28 s, fall 0.85 s) and held 1.65 s
     * after each clear. The shared halo follows the strongest player. r is a tier signal (the
     * §7.4 thresholds sit at combo 2/4/7), so it is not scaled by intensity; the consumer applies
     * intensity to the gains it drives.
     */
    _updateResonance(delta) {
        let target = 0;
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index];
            if (slot.resHold > 0) {
                slot.resHold = Math.max(0, slot.resHold - delta);
                if (slot.resHold === 0) slot.resTarget = 0;
            }
            if (slot.resTarget > target) target = slot.resTarget;
        }
        this.resonanceTarget = target;
        const difference = target - this.resonance;
        if (delta > 0 && difference !== 0) {
            const halfLife = difference > 0 ? PARHELION_RESONANCE.rise : PARHELION_RESONANCE.fall;
            this.resonance += difference * (1 - Math.exp((-HALF_LIFE_FACTOR * delta) / halfLife));
            if (Math.abs(target - this.resonance) <= RESONANCE_EPSILON) this.resonance = target;
        }
        if (this.resonance !== this.emittedResonance) {
            this.emittedResonance = this.resonance;
            this._callSink('resonance', this.resonance);
        }
    }

    _callSink(method, value) {
        const { sink } = this;
        const fn = sink ? sink[method] : null;
        if (typeof fn !== 'function') return;
        try {
            fn.call(sink, value);
        } catch (error) {
            // A throwing sink must not stall the timeline or strand the other players.
            this.sinkErrors += 1;
        }
    }
}

export default ReactionDirector;
