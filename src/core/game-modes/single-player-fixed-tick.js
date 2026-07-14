// @ts-check

import { processAutoDrop } from '../game.js';
import {
    FIXED_TICK_MAX_DEBT_MS,
    FIXED_TICK_MS,
    planFixedTicks,
} from '../fixed-tick-clock.js';
import {
    advancePlayerInputTick,
    clearPlayerInput,
} from '../player-input-state.js';
import { advanceTick } from '../simulation-tick.js';

export const SINGLE_PLAYER_FIXED_TICK_MAX_STEPS = 5;

/**
 * @typedef {Object} SinglePlayerClockWarp
 * @property {number} requestedDebtMs
 * @property {number} retainedDebtMs
 * @property {number} warpedMs
 * @property {number} maxDebtMs
 * @property {number} maxSteps
 * @property {number} tickMs
 */

/**
 * @typedef {Object} SinglePlayerFixedTickRuntime
 * @property {boolean} active
 * @property {number} generation
 * @property {import('../game.js').GameState|null} gameState
 * @property {number} accumulatorMs
 * @property {SinglePlayerClockWarp|null} lastClockWarp
 */

/**
 * @typedef {Object} SinglePlayerFixedTickOwnership
 * @property {number} generation
 * @property {import('../game.js').GameState} gameState
 */

/**
 * @typedef {Object} FixedInputController
 * @property {unknown} [fixedTickInputAdapter]
 * @property {(adapter?: unknown) => void} [setFixedTickInputAdapter]
 * @property {() => void} [clearFixedTickInput]
 */

function roundMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}

/** @returns {SinglePlayerFixedTickRuntime} */
export function createSinglePlayerFixedTickRuntime() {
    return {
        active: false,
        generation: 0,
        gameState: null,
        accumulatorMs: 0,
        lastClockWarp: null,
    };
}

/**
 * Bind a new normal-single-player session and invalidate every older callback.
 * @param {SinglePlayerFixedTickRuntime} runtime
 * @param {import('../game.js').GameState} gameState
 * @returns {SinglePlayerFixedTickOwnership}
 */
export function startSinglePlayerFixedTickRuntime(runtime, gameState) {
    if (!runtime || !gameState) {
        throw new TypeError('A fixed-tick runtime and GameState are required');
    }

    runtime.generation += 1;
    runtime.gameState = gameState;
    runtime.accumulatorMs = 0;
    runtime.lastClockWarp = null;
    runtime.active = true;
    return { generation: runtime.generation, gameState };
}

/** @param {SinglePlayerFixedTickRuntime} runtime */
export function stopSinglePlayerFixedTickRuntime(runtime) {
    if (!runtime) return;
    runtime.generation += 1;
    runtime.active = false;
    runtime.gameState = null;
    runtime.accumulatorMs = 0;
}

/**
 * @param {SinglePlayerFixedTickRuntime} runtime
 * @param {SinglePlayerFixedTickOwnership} ownership
 */
export function ownsSinglePlayerFixedTickRuntime(runtime, ownership) {
    return Boolean(
        runtime?.active
        && ownership
        && runtime.generation === ownership.generation
        && runtime.gameState === ownership.gameState,
    );
}

/**
 * Advance the canonical single-board simulation without owning a timer. The
 * caller's FrameRateController remains the sole wall-clock owner; this helper
 * owns only debt policy, session fencing, and fixed input/physics ordering.
 *
 * @param {SinglePlayerFixedTickRuntime} runtime
 * @param {number} elapsedMs
 * @param {{
 *   ownership: SinglePlayerFixedTickOwnership,
 *   advanceInput?: (context: {
 *     tick: number,
 *     tickMs: number,
 *     emit: (command: InputCommand) => boolean,
 *   }) => void,
 *   applyInput?: (command: InputCommand) => InputDisposition|boolean,
 *   playDropCallback?: Function|null,
 *   physicsCallbacks?: Object|null,
 *   shouldContinue?: () => boolean,
 *   onClockWarp?: (clockWarp: SinglePlayerClockWarp) => void,
 *   afterTick?: (result: AdvanceTickResult) => void,
 * }} options
 */
export function runSinglePlayerFixedTicks(runtime, elapsedMs, options) {
    const ownership = options?.ownership;
    if (!ownsSinglePlayerFixedTickRuntime(runtime, ownership)) {
        return {
            executedSteps: 0,
            plannedSteps: 0,
            tickPlan: null,
            clockWarp: null,
        };
    }
    if (options.shouldContinue?.() === false) {
        return {
            executedSteps: 0,
            plannedSteps: 0,
            tickPlan: null,
            clockWarp: null,
        };
    }

    const { gameState } = ownership;
    const configuredTickMs = Number(gameState.simTickMs);
    const tickMs = Number.isFinite(configuredTickMs) && configuredTickMs > 0
        ? configuredTickMs
        : FIXED_TICK_MS;
    const tickPlan = planFixedTicks(runtime.accumulatorMs, elapsedMs, {
        tickMs,
        maxSteps: SINGLE_PLAYER_FIXED_TICK_MAX_STEPS,
        maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
        maxCarryTicks: FIXED_TICK_MAX_DEBT_MS / tickMs,
    });
    runtime.accumulatorMs = tickPlan.accumulatedMs;

    /** @type {SinglePlayerClockWarp|null} */
    let clockWarp = null;
    if (tickPlan.debtWasClamped) {
        clockWarp = {
            requestedDebtMs: roundMilliseconds(tickPlan.requestedAccumulatedMs),
            retainedDebtMs: roundMilliseconds(tickPlan.accumulatedMs),
            warpedMs: roundMilliseconds(tickPlan.warpedMs),
            maxDebtMs: tickPlan.maxDebtMs,
            maxSteps: tickPlan.maxSteps,
            tickMs: roundMilliseconds(tickPlan.tickMs),
        };
        runtime.lastClockWarp = clockWarp;
        options.onClockWarp?.(clockWarp);
    }

    const sessionContinues = () => (
        ownsSinglePlayerFixedTickRuntime(runtime, ownership)
        && (options.shouldContinue?.() ?? true)
    );
    let executedSteps = 0;
    for (let step = 0; step < tickPlan.steps; step += 1) {
        if (!sessionContinues()) break;

        let tickStarted = false;
        try {
            tickStarted = true;
            const tickResult = advanceTick(gameState, {
                advanceInput: options.advanceInput,
                applyInput: options.applyInput,
                advancePhysics: (fixedDelta) => processAutoDrop(
                    gameState,
                    fixedDelta,
                    options.playDropCallback,
                    options.physicsCallbacks,
                    { fixedTick: true },
                ),
                shouldContinue: sessionContinues,
            });
            executedSteps += 1;
            // A tick that synchronously stopped/replaced its owner must not
            // leak mode maintenance into the stale GameState. Otherwise the
            // hook runs after a complete canonical tick and before the next
            // catch-up tick begins.
            if (sessionContinues()) {
                options.afterTick?.(tickResult);
            }
        } finally {
            if (tickStarted && ownsSinglePlayerFixedTickRuntime(runtime, ownership)) {
                // A partially applied tick is unsafe to replay. Consume its debt
                // before propagating, but never mutate a replacement session.
                runtime.accumulatorMs -= tickPlan.tickMs;
            }
        }
    }

    if (
        executedSteps === tickPlan.steps
        && ownsSinglePlayerFixedTickRuntime(runtime, ownership)
    ) {
        runtime.accumulatorMs = tickPlan.remainderMs;
    }

    return {
        executedSteps,
        plannedSteps: tickPlan.steps,
        tickPlan,
        clockWarp,
    };
}

/**
 * Install player-0 keyboard and gamepad adapters over the existing controller
 * seam. The first physical source to enqueue an edge owns the session until a
 * pause/visibility/reset boundary clears it.
 *
 * @param {{
 *   gameState: import('../game.js').GameState,
 *   inputController?: FixedInputController|null,
 *   gamepadController?: FixedInputController|null,
 *   isEnabled: () => boolean,
 * }} options
 */
export function createSinglePlayerFixedInputBinding(options) {
    const {
        gameState, inputController, gamepadController, isEnabled,
    } = options;
    const { playerInput: gamePlayerInput } = gameState;
    const playerInput = /** @type {PlayerInputState} */ (gamePlayerInput);
    let disposed = false;
    /** @type {'keyboard'|'gamepad'|null} */
    let activeDevice = null;

    const bindingIsEnabled = () => (
        !disposed
        && isEnabled() === true
        && gameState.isPaused !== true
        && gameState.isGameOver !== true
        && gameState.isStopped !== true
        && gameState.isReplay !== true
        && gameState.isSeeking !== true
        && gameState.suppressExternalInput !== true
    );
    const resolveGameState = (playerIndex) => (
        !disposed && playerIndex === 0 ? gameState : null
    );
    const adapterIsEnabled = ({ playerIndex, gameState: resolvedState }) => (
        playerIndex === 0
        && resolvedState === gameState
        && bindingIsEnabled()
    );
    const acceptDevice = (device) => {
        if (!bindingIsEnabled()) return false;
        if (activeDevice === null) activeDevice = device;
        return activeDevice === device;
    };
    const releaseDevice = (device) => {
        if (activeDevice === device) activeDevice = null;
    };

    const keyboardAdapter = {
        resolveGameState,
        isEnabled: adapterIsEnabled,
        acceptSource: () => acceptDevice('keyboard'),
        releaseSource: () => releaseDevice('keyboard'),
    };
    const gamepadAdapter = {
        resolveGameState,
        isEnabled: adapterIsEnabled,
        acceptSource: () => acceptDevice('gamepad'),
        releaseSource: () => releaseDevice('gamepad'),
    };

    const clear = () => {
        activeDevice = null;
        clearPlayerInput(playerInput);
        if (inputController?.fixedTickInputAdapter === keyboardAdapter) {
            inputController.clearFixedTickInput?.();
        }
        if (gamepadController?.fixedTickInputAdapter === gamepadAdapter) {
            gamepadController.clearFixedTickInput?.();
        }
    };

    const install = () => {
        if (disposed) return false;
        inputController?.setFixedTickInputAdapter?.(keyboardAdapter);
        gamepadController?.setFixedTickInputAdapter?.(gamepadAdapter);
        return true;
    };

    const dispose = () => {
        if (disposed) return;
        const currentKeyboardAdapter = inputController?.fixedTickInputAdapter;
        const currentGamepadAdapter = gamepadController?.fixedTickInputAdapter;
        const ownsKeyboardAdapter = currentKeyboardAdapter === keyboardAdapter;
        const ownsGamepadAdapter = currentGamepadAdapter === gamepadAdapter;
        const replacementOwnsInput = Boolean(
            (currentKeyboardAdapter && !ownsKeyboardAdapter)
            || (currentGamepadAdapter && !ownsGamepadAdapter),
        );
        activeDevice = null;
        disposed = true;
        // A later owner may reuse this GameState. Once either controller has
        // replaced us, even clearing the still-installed sibling could erase
        // the replacement's pending edges through the shared PlayerInputState.
        if (replacementOwnsInput) return;
        if (ownsKeyboardAdapter || ownsGamepadAdapter) {
            clearPlayerInput(playerInput);
        }
        if (ownsKeyboardAdapter) inputController?.clearFixedTickInput?.();
        if (ownsGamepadAdapter) gamepadController?.clearFixedTickInput?.();
        if (ownsKeyboardAdapter) {
            inputController?.setFixedTickInputAdapter?.(null);
        }
        if (ownsGamepadAdapter) {
            gamepadController?.setFixedTickInputAdapter?.(null);
        }
    };

    return {
        keyboardAdapter,
        gamepadAdapter,
        install,
        clear,
        dispose,
        advanceInput: (context) => {
            if (!bindingIsEnabled()) {
                clearPlayerInput(playerInput);
                return [];
            }
            return advancePlayerInputTick(playerInput, context);
        },
        getActiveDevice: () => activeDevice,
    };
}
