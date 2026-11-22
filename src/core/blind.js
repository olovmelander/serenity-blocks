// @ts-check
/**
 * @fileoverview Blind attacks: hidden cells (versus attack styles 'blind' and 'full_blind').
 *
 * Blind hides cells and never removes them: a hidden cell is still solid for collision, line
 * clears and cascades; only drawing skips it (the falling piece and its landing shadow stay
 * visible). Blind time belongs to each cell. It is kept on the locked piece that owns the cell
 * (`piece.blindTicks`) and mirrored onto the piece's grid cells (`cell.blind`), so it travels
 * with the cell when a clear splits its piece (the grid rebuild and the split carry it), when a
 * cascade drops it and when garbage lifts it, and it leaves with the cell when a clear removes
 * the cell. Every cell of one piece always holds the same blind time.
 *
 * Time counts in blind ticks of BLIND_TICK_MS of the player's own game time. Each board has a
 * blind clock (`gameState.blind.clockMs`) that its simulation advances; every whole blind tick
 * takes one off each hidden cell, and a cell shows again when its time reaches 0. The clock is
 * a plain accumulator of simulation milliseconds, so every copy of a board that runs the same
 * ticks (the online host and the predicting peer) hides and shows the same cells.
 *
 * - A blind piece ('blind' queue entry, one per piece): the board's next placed piece is hidden
 *   for BLIND_PIECE_TICKS from the moment it locks.
 * - A full blind ('full_blind' queue entry): every cell on the board gains `ticks` more blind
 *   time, at most BLIND_MAX_TICKS in all. Pieces placed afterwards are visible.
 *
 * Both arrive through the garbage queue and are taken when the board's next piece spawns
 * (takeSpawnBlinds), the moment rows go in, on every copy of the board alike.
 */

import { COLS } from './constants.js';

/** One blind tick, in milliseconds of the player's game time. */
export const BLIND_TICK_MS = 160;
/** How long a blind piece stays hidden after it is placed (4.8 s). */
export const BLIND_PIECE_TICKS = 30;
/** A full blind hides the board for rows × combo × FULL_BLIND_FACTOR blind ticks. */
export const FULL_BLIND_FACTOR = 12;
/** The most blind time one cell can hold. */
export const BLIND_MAX_TICKS = 255;
const CLOCK_EPSILON_MS = 1e-6;

/**
 * The blind ticks of a full blind: rows × combo × FULL_BLIND_FACTOR, at most BLIND_MAX_TICKS.
 * @param {number} rows the attack's rows (normal and clean)
 * @param {number} combo the clear's cascade waves (at least 1)
 * @returns {number}
 */
export function fullBlindTicks(rows, combo) {
    const count = Math.max(0, Math.floor(Number(rows) || 0));
    const waves = Math.max(1, Math.floor(Number(combo) || 0));
    return Math.min(BLIND_MAX_TICKS, count * waves * FULL_BLIND_FACTOR);
}

/**
 * @typedef {{ clockMs: number, pieceTicks: number, version: number }} BlindState
 *   clockMs: game time into the current blind tick; pieceTicks: the blind the piece in play
 *   takes when it locks (0: none); version: bumped whenever a cell is hidden or shown, so a
 *   renderer knows to redraw.
 */

/** @returns {BlindState} */
export function createBlindState() {
    return { clockMs: 0, pieceTicks: 0, version: 0 };
}

/** @param {unknown} value */
function clampTicks(value) {
    const ticks = Math.floor(Number(value));
    if (!Number.isFinite(ticks) || ticks <= 0) return 0;
    return Math.min(BLIND_MAX_TICKS, ticks);
}

/** @param {unknown} value */
function clampClock(value) {
    const clock = Number(value);
    if (!Number.isFinite(clock) || clock <= 0) return 0;
    return clock % BLIND_TICK_MS;
}

/**
 * A blind state in canonical form (any input, legacy or damaged, gives a valid one).
 * @param {unknown} value
 * @returns {BlindState}
 */
export function normalizeBlindState(value) {
    const source = /** @type {Record<string, unknown>} */ (
        value && typeof value === 'object' ? value : {}
    );
    const version = Math.floor(Number(source.version));
    return {
        clockMs: clampClock(source.clockMs),
        pieceTicks: clampTicks(source.pieceTicks),
        version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
    };
}

/**
 * @param {any} gameState
 * @returns {BlindState|null}
 */
function ensureState(gameState) {
    if (!gameState) return null;
    const state = gameState.blind;
    if (!state || typeof state !== 'object') {
        gameState.blind = createBlindState();
        return gameState.blind;
    }
    if (!Number.isFinite(state.clockMs) || state.clockMs < 0) state.clockMs = 0;
    if (!Number.isInteger(state.pieceTicks) || state.pieceTicks < 0) state.pieceTicks = 0;
    if (!Number.isSafeInteger(state.version)) state.version = 0;
    return state;
}

/** @param {any} gameState */
function bumpVersion(gameState) {
    const state = ensureState(gameState);
    if (state) state.version += 1;
}

/**
 * Blind ticks left on a locked piece's cells (0: visible).
 * @param {{ blindTicks?: unknown }|null|undefined} piece
 */
export function pieceBlindTicks(piece) {
    return clampTicks(piece?.blindTicks);
}

/**
 * Whether a grid cell is hidden.
 * @param {{ blind?: unknown }|null|undefined} cell
 */
export function isCellBlind(cell) {
    return Boolean(cell) && Number(cell?.blind) > 0;
}

/**
 * @param {any} piece
 * @param {(x: number, y: number) => void} visit
 */
function forEachPieceCell(piece, visit) {
    const shape = piece?.shape;
    if (!Array.isArray(shape)) return;
    for (let localY = 0; localY < shape.length; localY += 1) {
        const row = shape[localY];
        if (!Array.isArray(row)) continue;
        for (let localX = 0; localX < row.length; localX += 1) {
            if (row[localX] > 0) visit(piece.x + localX, Math.floor(piece.y + localY));
        }
    }
}

/** @param {any} piece @param {number} ticks */
function setPieceBlind(piece, ticks) {
    if (ticks > 0) piece.blindTicks = ticks;
    else delete piece.blindTicks;
}

/**
 * Copy each locked piece's blind time onto its grid cells (the grid mirrors lockedPieces).
 * @param {any} gameState
 */
export function syncBlindGrid(gameState) {
    const grid = gameState?.boardGrid;
    if (!Array.isArray(grid)) return;
    for (const piece of gameState.lockedPieces || []) {
        const ticks = pieceBlindTicks(piece);
        forEachPieceCell(piece, (x, y) => {
            const cell = grid[y]?.[x];
            if (!cell || typeof cell !== 'object') return;
            if (ticks > 0) cell.blind = ticks;
            else delete cell.blind;
        });
    }
}

/**
 * Whether any locked cell of the board is hidden.
 * @param {any} gameState
 */
export function hasBlindCells(gameState) {
    return (gameState?.lockedPieces || []).some((piece) => pieceBlindTicks(piece) > 0);
}

/**
 * Take `ticks` blind ticks off every hidden cell.
 * @param {any} gameState
 * @param {number} ticks
 * @returns {boolean} true when a cell showed again
 */
function tickBlindCells(gameState, ticks) {
    let changed = false;
    let revealed = false;
    for (const piece of gameState.lockedPieces || []) {
        const before = pieceBlindTicks(piece);
        if (before <= 0) continue;
        const after = Math.max(0, before - ticks);
        setPieceBlind(piece, after);
        changed = true;
        if (after === 0) revealed = true;
    }
    if (changed) syncBlindGrid(gameState);
    if (revealed) bumpVersion(gameState);
    return revealed;
}

/**
 * Advance a board's blind clock by `dtMs` of its game time. Call wherever the board's
 * simulation advances (once per fixed tick, or per frame on the variable-step loops).
 * @param {any} gameState
 * @param {number} dtMs
 * @returns {boolean} true when a cell showed again
 */
export function advanceBlindClock(gameState, dtMs) {
    const state = ensureState(gameState);
    const step = Number(dtMs);
    if (!state || !Number.isFinite(step) || step <= 0) return false;
    state.clockMs += step;
    // Fixed ticks of 1000/60 ms add up to 160 ms only within rounding: a tick boundary
    // reached within CLOCK_EPSILON_MS counts as reached.
    if (state.clockMs + CLOCK_EPSILON_MS < BLIND_TICK_MS) return false;
    const ticks = Math.floor((state.clockMs + CLOCK_EPSILON_MS) / BLIND_TICK_MS);
    state.clockMs = Math.max(0, state.clockMs - ticks * BLIND_TICK_MS);
    return tickBlindCells(gameState, ticks);
}

/**
 * The piece in play is locking: hand it the blind a blind piece left for it.
 * lockPiece calls this once per lock.
 * @param {any} gameState
 * @returns {number} blind ticks for the locking piece (0: it stays visible)
 */
export function takePieceBlind(gameState) {
    const state = gameState?.blind;
    if (!state || typeof state !== 'object') return 0;
    const ticks = clampTicks(state.pieceTicks);
    state.pieceTicks = 0;
    if (ticks > 0) bumpVersion(gameState);
    return ticks;
}

/**
 * Full blind: every cell now on the board gains `ticks` more blind time, at most
 * BLIND_MAX_TICKS in all.
 * @param {any} gameState
 * @param {number} ticks
 * @returns {number} pieces hidden
 */
export function applyFullBlind(gameState, ticks) {
    const add = clampTicks(ticks);
    if (!gameState || add <= 0) return 0;
    let hidden = 0;
    for (const piece of gameState.lockedPieces || []) {
        let solid = false;
        forEachPieceCell(piece, () => { solid = true; });
        if (!solid) continue;
        setPieceBlind(piece, Math.min(BLIND_MAX_TICKS, pieceBlindTicks(piece) + add));
        hidden += 1;
    }
    if (hidden > 0) {
        syncBlindGrid(gameState);
        bumpVersion(gameState);
    }
    return hidden;
}

/**
 * Show every hidden cell at once and forget a blind piece that has not landed yet
 * (a team that gets rid of the hot potato).
 * @param {any} gameState
 * @returns {boolean} true when anything was hidden
 */
export function clearBlind(gameState) {
    const state = ensureState(gameState);
    if (!state) return false;
    let cleared = state.pieceTicks > 0;
    state.pieceTicks = 0;
    for (const piece of gameState.lockedPieces || []) {
        if (pieceBlindTicks(piece) <= 0) continue;
        setPieceBlind(piece, 0);
        cleared = true;
    }
    if (cleared) {
        syncBlindGrid(gameState);
        bumpVersion(gameState);
    }
    return cleared;
}

/**
 * A board's next piece is about to spawn: take the blind entries at the head of its garbage
 * queue. Every full blind there hides the whole board now; the first blind piece marks the
 * piece that spawns now, which is hidden when it locks. A second blind piece waits for the
 * piece after. Rows are never taken here, and blind entries never hold rows back
 * (GarbageQueue.dequeueLineBurst takes the first rows wherever they wait).
 * @param {any} gameState
 * @param {{ entries?: Array<any> }|null|undefined} queue
 * @returns {Array<any>} the entries taken, in queue order
 */
export function takeSpawnBlinds(gameState, queue) {
    /** @type {Array<any>} */
    const taken = [];
    const state = ensureState(gameState);
    const entries = queue?.entries;
    if (!state || !Array.isArray(entries)) return taken;
    let pieceTaken = false;
    while (entries.length > 0) {
        const head = entries[0];
        if (head?.type === 'full_blind') {
            entries.shift();
            applyFullBlind(gameState, head.ticks);
            taken.push(head);
        } else if (head?.type === 'blind' && !pieceTaken) {
            entries.shift();
            state.pieceTicks = clampTicks(head.ticks ?? BLIND_PIECE_TICKS);
            pieceTaken = true;
            taken.push(head);
        } else {
            break;
        }
    }
    return taken;
}

/**
 * @typedef {{ clockMs: number, pieceTicks: number, cells: Array<[number, number]> }} BlindSnapshot
 *   cells: every hidden cell as [y * COLS + x, blind ticks], in board order.
 */

/**
 * A board's blind for the wire.
 * @param {any} gameState
 * @returns {BlindSnapshot}
 */
export function captureBlindSnapshot(gameState) {
    /** @type {Array<[number, number]>} */
    const cells = [];
    for (const piece of gameState?.lockedPieces || []) {
        const ticks = pieceBlindTicks(piece);
        if (ticks <= 0) continue;
        forEachPieceCell(piece, (x, y) => {
            if (y >= 0 && x >= 0 && x < COLS) cells.push([y * COLS + x, ticks]);
        });
    }
    cells.sort((left, right) => left[0] - right[0]);
    const state = gameState?.blind;
    return {
        clockMs: clampClock(state?.clockMs),
        pieceTicks: clampTicks(state?.pieceTicks),
        cells,
    };
}

/**
 * Whether two wire blinds hide the same cells for the same time (the clock aside).
 * @param {BlindSnapshot|null|undefined} left
 * @param {BlindSnapshot|null|undefined} right
 */
export function sameBlindCells(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    if ((left.pieceTicks || 0) !== (right.pieceTicks || 0)) return false;
    const a = left.cells || [];
    const b = right.cells || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    }
    return true;
}

/**
 * Adopt a board's blind from the wire, onto the board adopted with it: the listed cells are
 * hidden for their time, every other cell shows. A piece whose cells disagree takes the
 * longest time among them.
 * @param {any} gameState
 * @param {unknown} snapshot
 */
export function restoreBlindSnapshot(gameState, snapshot) {
    const state = ensureState(gameState);
    if (!state) return;
    const source = /** @type {Record<string, any>} */ (
        snapshot && typeof snapshot === 'object' ? snapshot : {}
    );
    state.clockMs = clampClock(source.clockMs);
    state.pieceTicks = clampTicks(source.pieceTicks);
    /** @type {Map<number, number>} */
    const byIndex = new Map();
    if (Array.isArray(source.cells)) {
        for (const cell of source.cells) {
            if (!Array.isArray(cell)) continue;
            const index = Math.floor(Number(cell[0]));
            const ticks = clampTicks(cell[1]);
            if (Number.isSafeInteger(index) && index >= 0 && ticks > 0) byIndex.set(index, ticks);
        }
    }
    for (const piece of gameState.lockedPieces || []) {
        let ticks = 0;
        forEachPieceCell(piece, (x, y) => {
            if (y < 0 || x < 0 || x >= COLS) return;
            ticks = Math.max(ticks, byIndex.get(y * COLS + x) || 0);
        });
        setPieceBlind(piece, ticks);
    }
    const grid = gameState.boardGrid;
    if (Array.isArray(grid)) {
        grid.forEach((row) => row?.forEach?.((cell) => {
            if (cell && typeof cell === 'object') delete cell.blind;
        }));
    }
    syncBlindGrid(gameState);
    bumpVersion(gameState);
}
