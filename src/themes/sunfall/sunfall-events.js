/**
 * Sunfall — the canonical gameplay events (src/events/gameplay-events.js) read into the director.
 *
 * Payloads, as every mode sends them:
 *   PIECE_LOCK { piece: { shapeKey, shape, x, y }, viewportOrigin? }
 *   HARD_DROP  { piece, startY, endY, distance, viewportOrigin? }   (same tick, before the lock)
 *   LINE_CLEAR { lineCount, clearedRows, cascadeCount, comboCount?, viewportOrigin? }
 *   COMBO      { comboCount }   the CASCADE DEPTH of one lock (ADR-0011), never a combo; the
 *              wave's LINE_CLEAR carries it too, so only a Serenity click's (with `position`)
 *              is read, as that click combo
 *   TSPIN      { lineCount }    after the wave's LINE_CLEAR (0 lines: a spin that cleared nothing)
 *   B2B        { active }      after it, on a back-to-back difficult clear
 *   PERFECT_CLEAR { depth }     ~360 ms after the clear's last wave: a crown, not a clear
 *   LEVEL_UP   { level }
 *
 * Board rows in a payload count the hidden rows above the visible twenty; the director wants
 * visible rows (0 the top). A mode whose board scrolls (Infinity) sends an on-screen
 * `viewportOrigin` instead, which wins.
 */
import { EVENTS, eventBus } from '../../events/event-bus.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import { PIECE_SWATCH_RGB, clamp01 } from './sunfall-core.js';

/** The board (src/core/constants.js: its module pulls in the theme registry, so not imported). */
const COLS = 10;
const ROWS = 20;
const HIDDEN_ROWS = 4;
const EMPTY = Object.freeze({});
const finite = (value, fallback) => (Number.isFinite(value) ? Number(value) : fallback);
const visibleRow = (row) => Math.max(0, Math.min(ROWS - 1, Math.round(row)));

/** The piece's code (I, O, T, S, Z, J, L) or null. */
function pieceCode(payload) {
    const piece = payload.piece || EMPTY;
    const raw = piece.shapeKey || piece.type || payload.pieceType;
    const code = typeof raw === 'string' ? raw.toUpperCase() : null;
    return code && PIECE_SWATCH_RGB[code] ? code : null;
}

/**
 * A locked or hard-dropped piece: `{ code, shape, col, row, u }` for the director (its cells at
 * `shape` offset by col/row on the visible board, `u` its centre across the board).
 */
export function readSunfallPiece(payload) {
    const p = payload || EMPTY;
    const code = pieceCode(p);
    const viewport = readLockViewportOrigin(p);
    if (viewport) {
        return {
            code, shape: null, col: viewport.x * (COLS - 1), row: visibleRow(viewport.y * ROWS), u: viewport.x,
        };
    }
    const piece = p.piece || EMPTY;
    const { shape } = piece;
    if (!Array.isArray(shape) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) {
        return {
            code, shape: null, col: 4.5, row: 14, u: null,
        };
    }
    let sum = 0;
    let cells = 0;
    shape.forEach((cellsInRow) => {
        if (!Array.isArray(cellsInRow)) return;
        cellsInRow.forEach((cell, c) => {
            if (cell) {
                sum += piece.x + c + 0.5;
                cells += 1;
            }
        });
    });
    return {
        code,
        shape,
        col: piece.x,
        row: piece.y - HIDDEN_ROWS,
        u: cells > 0 ? clamp01(sum / cells / COLS) : null,
    };
}

/** One wave of a clear: `{ lines, rows, cascade, combo }` (rows visible, 0 the top). */
export function readSunfallClear(payload) {
    const p = payload || EMPTY;
    const raw = Array.isArray(p.clearedRows) ? p.clearedRows.filter(Number.isFinite) : [];
    const lines = Math.max(1, Math.min(4, Math.round(finite(p.lineCount, raw.length || 1))));
    const viewport = readLockViewportOrigin(p);
    let rows;
    if (viewport) {
        const first = visibleRow(viewport.y * ROWS - (lines - 1) * 0.5);
        rows = Array.from({ length: lines }, (_, i) => visibleRow(first + i));
    } else {
        rows = raw.slice(0, 4).map((row) => visibleRow(row - HIDDEN_ROWS));
    }
    return {
        lines,
        rows,
        cascade: Math.max(1, Math.round(finite(p.cascadeCount, 1))),
        combo: Number.isFinite(p.comboCount) ? Number(p.comboCount) : null,
    };
}

/**
 * Subscribe the theme's director to the bus. Reactions run while the theme is active, unpaused
 * and has background reactions on; a lock with the lock ripple off still keeps the combo and
 * the heat (bookkeeping, not decoration). Returns the unsubscribers.
 */
export function wireSunfallEvents(theme) {
    const offs = [];
    const on = (evt, fn) => { if (evt) offs.push(eventBus.on(evt, fn)); };
    const live = () => theme.isActive && !theme.isPaused && theme.reactionsEnabled;
    const director = () => (live() ? theme.director : null);

    on(EVENTS.PIECE_LOCK, (p) => {
        director()?.onPieceLock({ ...readSunfallPiece(p), visual: theme.lockRippleEnabled !== false });
    });
    on(EVENTS.HARD_DROP, (p) => {
        director()?.onHardDrop({ ...readSunfallPiece(p), distance: finite(p?.distance, 10) });
    });
    on(EVENTS.LINE_CLEAR, (p) => director()?.onLineClear(readSunfallClear(p)));
    on(EVENTS.COMBO, (p) => {
        if (p?.position) director()?.onCombo(finite(p.comboCount, 0));
    });
    on(EVENTS.TSPIN, (p) => director()?.onTSpin({ lines: finite(p?.lineCount, 0) }));
    on(EVENTS.B2B, (p) => {
        if (p?.active !== false) director()?.onB2B();
    });
    on(EVENTS.PERFECT_CLEAR, () => director()?.onPerfectClear());
    on(EVENTS.LEVEL_UP, (p) => {
        if (!theme.isActive) return;
        theme.level = finite(p?.level, finite(p?.newLevel, theme.level + 1));
        theme.director?.onLevelUp(theme.level);
    });
    return offs;
}
