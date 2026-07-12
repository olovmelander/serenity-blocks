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

import { durationMsToTicks, FIXED_TICK_MS } from './fixed-tick-clock.js';

const FIELD_TICKS = 'fieldTicks';
const FIELD_MAX_TICKS = 'fieldMaxTicks';
const PENDING_TICKS = 'pendingTicks';
const PENDING_MAX_TICKS = 'pendingMaxTicks';

function resolveTickMs(gameState, requestedTickMs) {
    const explicitTickMs = Number(requestedTickMs);
    if (Number.isFinite(explicitTickMs) && explicitTickMs > 0) return explicitTickMs;

    const stateTickMs = Number(gameState?.simTickMs);
    return Number.isFinite(stateTickMs) && stateTickMs > 0
        ? stateTickMs
        : FIXED_TICK_MS;
}

function secondsToTicks(seconds, tickMs) {
    return durationMsToTicks(Number(seconds) * 1000, tickMs);
}

function ticksToSeconds(ticks, tickMs) {
    return (ticks * tickMs) / 1000;
}

function setTickSources(bt, tickMs) {
    bt._blindTickSourceField = bt.field;
    bt._blindTickSourceFieldMax = bt.fieldMax;
    bt._blindTickSourcePending = bt.pending;
    bt._blindTickSourcePendingMax = bt.pendingMax;
    bt._blindTickDurationMs = tickMs;
}

function synchronizeTickMirrors(bt, tickMs) {
    bt[FIELD_TICKS] = secondsToTicks(bt.field, tickMs);
    bt[FIELD_MAX_TICKS] = Math.max(
        bt[FIELD_TICKS],
        secondsToTicks(bt.fieldMax, tickMs),
    );
    bt[PENDING_TICKS] = secondsToTicks(bt.pending, tickMs);
    bt[PENDING_MAX_TICKS] = Math.max(
        bt[PENDING_TICKS],
        secondsToTicks(bt.pendingMax, tickMs),
    );
    setTickSources(bt, tickMs);
}

function hasSynchronizedTickMirrors(bt, tickMs) {
    return Number.isInteger(bt[FIELD_TICKS])
        && bt[FIELD_TICKS] >= 0
        && Number.isInteger(bt[FIELD_MAX_TICKS])
        && bt[FIELD_MAX_TICKS] >= bt[FIELD_TICKS]
        && Number.isInteger(bt[PENDING_TICKS])
        && bt[PENDING_TICKS] >= 0
        && Number.isInteger(bt[PENDING_MAX_TICKS])
        && bt[PENDING_MAX_TICKS] >= bt[PENDING_TICKS]
        && bt.field === bt._blindTickSourceField
        && bt.fieldMax === bt._blindTickSourceFieldMax
        && bt.pending === bt._blindTickSourcePending
        && bt.pendingMax === bt._blindTickSourcePendingMax
        && tickMs === bt._blindTickDurationMs;
}

function normalizeSnapshotSeconds(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function hasExactTickSnapshot(snapshot, tickMs) {
    return snapshot
        && Number(snapshot._blindTickDurationMs) === tickMs
        && snapshot.field === snapshot._blindTickSourceField
        && snapshot.fieldMax === snapshot._blindTickSourceFieldMax
        && snapshot.pending === snapshot._blindTickSourcePending
        && snapshot.pendingMax === snapshot._blindTickSourcePendingMax
        && Number.isInteger(snapshot[FIELD_TICKS])
        && snapshot[FIELD_TICKS] >= 0
        && Number.isInteger(snapshot[FIELD_MAX_TICKS])
        && snapshot[FIELD_MAX_TICKS] >= snapshot[FIELD_TICKS]
        && Number.isInteger(snapshot[PENDING_TICKS])
        && snapshot[PENDING_TICKS] >= 0
        && Number.isInteger(snapshot[PENDING_MAX_TICKS])
        && snapshot[PENDING_MAX_TICKS] >= snapshot[PENDING_TICKS];
}

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
    synchronizeTickMirrors(bt, resolveTickMs(gameState));
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
    synchronizeTickMirrors(bt, resolveTickMs(gameState));
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
    // Keep the integer clock dark on legacy paths: the public seconds above
    // retain their historical arithmetic and remain the source of truth.
    synchronizeTickMirrors(bt, resolveTickMs(gameState));
}

/**
 * Consume exactly one canonical blind-timer tick. Direct writes to any public
 * seconds field, or a changed tick duration, invalidate the integer mirror and
 * are re-quantized before consumption. The public fields remain compatibility
 * mirrors for renderers and the current network protocol.
 *
 * @param {object} gameState
 * @param {number} [requestedTickMs]
 * @returns {boolean} true when at least one blind timer was active for this tick
 */
export function advanceBlindTimersTick(gameState, requestedTickMs) {
    const bt = ensureTimers(gameState);
    if (!bt) return false;

    const tickMs = resolveTickMs(gameState, requestedTickMs);
    if (!hasSynchronizedTickMirrors(bt, tickMs)) synchronizeTickMirrors(bt, tickMs);

    const wasActive = bt[FIELD_TICKS] > 0 || bt[PENDING_TICKS] > 0;
    if (bt[FIELD_TICKS] > 0) bt[FIELD_TICKS] -= 1;
    if (bt[PENDING_TICKS] > 0) bt[PENDING_TICKS] -= 1;

    if (bt[FIELD_TICKS] === 0) bt[FIELD_MAX_TICKS] = 0;
    if (bt[PENDING_TICKS] === 0) bt[PENDING_MAX_TICKS] = 0;

    bt.field = ticksToSeconds(bt[FIELD_TICKS], tickMs);
    bt.fieldMax = bt[FIELD_TICKS] > 0
        ? ticksToSeconds(bt[FIELD_MAX_TICKS], tickMs)
        : 0;
    bt.pending = ticksToSeconds(bt[PENDING_TICKS], tickMs);
    bt.pendingMax = bt[PENDING_TICKS] > 0
        ? ticksToSeconds(bt[PENDING_MAX_TICKS], tickMs)
        : 0;
    setTickSources(bt, tickMs);
    return wasActive;
}

/**
 * Restore blind timers in place. Snapshots carrying a complete integer clock
 * at the target tick duration retain their counters exactly. Historical two-
 * or four-field snapshots are upgraded from their public seconds instead.
 *
 * @param {object} gameState
 * @param {object|null|undefined} snapshot
 * @param {number} [requestedTickMs]
 * @returns {object|null} the restored timer object, or null without a target
 */
export function restoreBlindTimers(gameState, snapshot, requestedTickMs) {
    if (!gameState) return null;

    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const bt = gameState.blindTimers && typeof gameState.blindTimers === 'object'
        ? gameState.blindTimers
        : createBlindTimers();
    gameState.blindTimers = bt;

    bt.field = normalizeSnapshotSeconds(source.field);
    bt.fieldMax = source.fieldMax === undefined
        ? bt.field
        : normalizeSnapshotSeconds(source.fieldMax);
    bt.pending = normalizeSnapshotSeconds(source.pending);
    bt.pendingMax = source.pendingMax === undefined
        ? bt.pending
        : normalizeSnapshotSeconds(source.pendingMax);

    const tickMs = resolveTickMs(gameState, requestedTickMs);
    if (hasExactTickSnapshot(source, tickMs)) {
        bt[FIELD_TICKS] = source[FIELD_TICKS];
        bt[FIELD_MAX_TICKS] = source[FIELD_MAX_TICKS];
        bt[PENDING_TICKS] = source[PENDING_TICKS];
        bt[PENDING_MAX_TICKS] = source[PENDING_MAX_TICKS];
        setTickSources(bt, tickMs);
    } else {
        synchronizeTickMirrors(bt, tickMs);
    }

    return bt;
}

/**
 * @returns {boolean} true if any blind overlay should currently render.
 */
export function isBlindActive(gameState) {
    const bt = gameState && gameState.blindTimers;
    return !!bt && ((bt.field || 0) > 0 || (bt.pending || 0) > 0);
}
