/**
 * @fileoverview Quadra-style "blind" attack effects — a timed obscuring of a
 * target board. Two flavours:
 *   - partial blind  ("blind"):       obscure the incoming garbage rows
 *   - full blind     ("full_blind"):  obscure the whole locked stack
 *
 * These helpers are render-only: they only touch `gameState.blindTimers` and
 * never modify the board, collision, gravity, or line-clear logic, so the board
 * stays fully playable while obscured (Quadra's "hidden but still solid").
 *
 * Durations are in SECONDS of real time and decremented with real `dt` in the
 * logic loop (NOT per-frame), so local and online behave identically.
 */

/**
 * @returns {{field:number, fieldMax:number, pending:number, pendingMax:number}}
 *   field/pending are seconds remaining; *Max are the original durations used
 *   only for render fade ratios.
 */
export function createBlindTimers() {
    return {
        field: 0,
        fieldMax: 0,
        pending: 0,
        pendingMax: 0,
    };
}

function ensureTimers(gameState) {
    if (!gameState) return null;
    if (!gameState.blindTimers) gameState.blindTimers = createBlindTimers();
    const bt = gameState.blindTimers;
    // Tolerate the legacy 2-field shape by backfilling the *Max fields.
    if (bt.fieldMax === undefined) bt.fieldMax = bt.field || 0;
    if (bt.pendingMax === undefined) bt.pendingMax = bt.pending || 0;
    return bt;
}

/**
 * Partial blind — obscure the incoming garbage rows for `duration` seconds.
 * Stacks by extending (never shortening) the existing timer.
 */
export function applyBlindEffect(gameState, duration) {
    const bt = ensureTimers(gameState);
    if (!bt || !(duration > 0)) return;
    bt.pending = Math.max(bt.pending || 0, duration);
    bt.pendingMax = Math.max(bt.pendingMax || 0, bt.pending);
}

/**
 * Full blind — obscure the whole locked stack for `duration` seconds.
 * The active piece and ghost remain visible so the board stays playable.
 */
export function applyFullBlindEffect(gameState, duration) {
    const bt = ensureTimers(gameState);
    if (!bt || !(duration > 0)) return;
    bt.field = Math.max(bt.field || 0, duration);
    bt.fieldMax = Math.max(bt.fieldMax || 0, bt.field);
}

/**
 * Decrement blind timers by real elapsed seconds. Call once per logic tick for
 * each (alive, unpaused) player. Clears the corresponding *Max when a timer
 * reaches 0 so fade math resets cleanly.
 */
export function decrementBlindTimers(gameState, dtSeconds) {
    const bt = gameState && gameState.blindTimers;
    if (!bt || !(dtSeconds > 0)) return;
    if (bt.field > 0) {
        bt.field = Math.max(0, bt.field - dtSeconds);
        if (bt.field === 0) bt.fieldMax = 0;
    }
    if (bt.pending > 0) {
        bt.pending = Math.max(0, bt.pending - dtSeconds);
        if (bt.pending === 0) bt.pendingMax = 0;
    }
}

/**
 * @returns {boolean} true if any blind overlay should currently render.
 */
export function isBlindActive(gameState) {
    const bt = gameState && gameState.blindTimers;
    return !!bt && ((bt.field || 0) > 0 || (bt.pending || 0) > 0);
}
