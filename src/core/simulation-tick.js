// @ts-check

import { consumeFixedHitStopTick } from './game.js';
import { FIXED_TICK_MS } from './fixed-tick-clock.js';
import { advanceBlindTimersTick } from './blind.js';

export const INPUT_DISPOSITIONS = Object.freeze({
    APPLIED: 'applied',
    DEFERRED_PHYSICS: 'deferred_physics',
    REJECTED_HIT_STOP: 'rejected_hit_stop',
    REJECTED_PHYSICS: 'rejected_physics',
});

const VALID_DISPOSITIONS = new Set(Object.values(INPUT_DISPOSITIONS));

/** @param {unknown} result @returns {InputDisposition} */
function normalizeDisposition(result) {
    if (
        typeof result === 'string'
        && VALID_DISPOSITIONS.has(/** @type {InputDisposition} */ (result))
    ) {
        return /** @type {InputDisposition} */ (result);
    }
    if (result === true) return INPUT_DISPOSITIONS.APPLIED;
    if (result === false) return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
    throw new TypeError('applyInput must return a boolean or InputDisposition');
}

/** @param {import('./game.js').GameState} gameState */
export function hasActiveHitStop(gameState) {
    return Number(gameState?.hitStopTicks) > 0
        || Number(gameState?.hitStopRemaining) > 0;
}

/**
 * Advance clocks, blind timers, input, hit-stop, and physics in canonical order.
 * This is deliberately callback-driven and dark: mode/controller adapters can
 * be characterized against it without importing DOM state or changing a live
 * loop. Input is still advanced during hit-stop so release edges and online's
 * existing DAS phase are preserved; the emitted gameplay commands are rejected.
 *
 * @param {import('./game.js').GameState} gameState
 * @param {{
 *   advanceInput?: (context: {
 *     tick: number,
 *     tickMs: number,
 *     emit: (command: InputCommand) => boolean,
 *   }) => void,
 *   applyInput?: (command: InputCommand) => InputDisposition|boolean,
 *   advancePhysics?: (tickMs: number) => void,
 *   shouldContinue?: () => boolean,
 * }} [options]
 * @returns {AdvanceTickResult}
 */
export function advanceTick(gameState, options = {}) {
    if (!gameState) throw new TypeError('advanceTick requires a GameState');

    // Ephemeral same-tick spawn guard. Clearing before the frame advances also
    // prevents a reset/restore from reviving a stale input-phase marker.
    gameState._fixedInputSpawnFrame = null;
    const configuredTickMs = Number(gameState.simTickMs);
    const tickMs = Number.isFinite(configuredTickMs) && configuredTickMs > 0
        ? configuredTickMs
        : FIXED_TICK_MS;
    const priorFrame = Number.isInteger(gameState.simFrame) && gameState.simFrame >= 0
        ? gameState.simFrame
        : 0;
    const priorSimTime = Number(gameState.simTimeMs);
    const priorLastTime = Number(gameState.lastTime);
    let timeBase = 0;
    if (Number.isFinite(priorSimTime)) timeBase = priorSimTime;
    else if (Number.isFinite(priorLastTime)) timeBase = priorLastTime;

    gameState.simFrame = priorFrame + 1;
    gameState.simTimeMs = timeBase + tickMs;
    gameState.lastTime = gameState.simTimeMs;
    advanceBlindTimersTick(gameState, tickMs);

    /** @type {InputDispositionRecord[]} */
    const input = [];
    const emit = (command) => {
        /** @type {InputDisposition} */
        let disposition = INPUT_DISPOSITIONS.REJECTED_PHYSICS;
        if (gameState._fixedInputSpawnFrame === gameState.simFrame) {
            disposition = INPUT_DISPOSITIONS.REJECTED_PHYSICS;
        } else if (hasActiveHitStop(gameState)) {
            disposition = INPUT_DISPOSITIONS.REJECTED_HIT_STOP;
        } else if (options.applyInput) {
            disposition = normalizeDisposition(options.applyInput(command));
        }
        input.push({ command, disposition });
        return disposition === INPUT_DISPOSITIONS.APPLIED;
    };

    options.advanceInput?.({
        tick: gameState.simFrame,
        tickMs,
        emit,
    });

    // Input callbacks may synchronously end/restart a round. The lifecycle
    // owner resets the board in place, so stale post-input work must not consume
    // the new round's hit-stop or advance its physics.
    if (options.shouldContinue && !options.shouldContinue()) {
        return {
            tick: gameState.simFrame,
            tickMs,
            simTimeMs: gameState.simTimeMs,
            input,
            frozen: false,
            physicsAdvanced: false,
        };
    }

    // Consume once after input: pre-existing freezes reject this tick's batch;
    // hit-stop produced by an accepted command freezes before gravity and makes
    // every later command in the same batch reject via emit's per-command gate.
    const frozen = consumeFixedHitStopTick(gameState);
    let physicsAdvanced = false;
    if (!frozen && options.advancePhysics) {
        options.advancePhysics(tickMs);
        physicsAdvanced = true;
    }

    return {
        tick: gameState.simFrame,
        tickMs,
        simTimeMs: gameState.simTimeMs,
        input,
        frozen,
        physicsAdvanced,
    };
}
