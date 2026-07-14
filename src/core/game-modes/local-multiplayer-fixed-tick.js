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

export const LOCAL_MULTIPLAYER_FIXED_TICK_MAX_STEPS = 5;

/**
 * @typedef {Object} LocalMultiplayerClockWarp
 * @property {number} requestedDebtMs
 * @property {number} retainedDebtMs
 * @property {number} warpedMs
 * @property {number} maxDebtMs
 * @property {number} maxSteps
 * @property {number} tickMs
 */

/**
 * @typedef {Object} LocalMultiplayerFixedTickRuntime
 * @property {boolean} active
 * @property {number} generation
 * @property {import('../multi-player-state.js').MultiPlayerState|null} multiplayerState
 * @property {import('../game.js').GameState[]} players
 * @property {number} accumulatorMs
 * @property {number} simFrame
 * @property {number} simTimeMs
 * @property {LocalMultiplayerClockWarp|null} lastClockWarp
 */

/**
 * @typedef {Object} LocalMultiplayerFixedTickOwnership
 * @property {number} generation
 * @property {import('../multi-player-state.js').MultiPlayerState} multiplayerState
 * @property {import('../game.js').GameState[]} players
 */

/**
 * @typedef {Object} FixedInputController
 * @property {unknown} [fixedTickInputAdapter]
 * @property {(adapter?: unknown) => void} [setFixedTickInputAdapter]
 * @property {(options?: unknown) => void} [clearFixedTickInput]
 */

function roundMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}

/** @returns {LocalMultiplayerFixedTickRuntime} */
export function createLocalMultiplayerFixedTickRuntime() {
    return {
        active: false,
        generation: 0,
        multiplayerState: null,
        players: [],
        accumulatorMs: 0,
        simFrame: 0,
        simTimeMs: 0,
        lastClockWarp: null,
    };
}

/**
 * Bind one round. Player identities are captured because MultiPlayerState.reset
 * intentionally reuses its GameState objects between rounds.
 * @param {LocalMultiplayerFixedTickRuntime} runtime
 * @param {import('../multi-player-state.js').MultiPlayerState} multiplayerState
 * @returns {LocalMultiplayerFixedTickOwnership}
 */
export function startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState) {
    const players = Array.isArray(multiplayerState?.players)
        ? multiplayerState.players.slice()
        : [];
    if (!runtime || players.length < 2) {
        throw new TypeError('A fixed-tick runtime and at least two player GameStates are required');
    }

    const firstFrame = Number(players[0]?.simFrame);
    const firstTime = Number(players[0]?.simTimeMs);
    const firstTickMs = Number(players[0]?.simTickMs);
    const clocksMatch = players.every((player) => (
        Number(player?.simFrame) === firstFrame
        && Number(player?.simTimeMs) === firstTime
        && Number(player?.simTickMs) === firstTickMs
    ));
    if (
        !Number.isSafeInteger(firstFrame)
        || firstFrame < 0
        || !Number.isFinite(firstTickMs)
        || firstTickMs <= 0
        || !clocksMatch
    ) {
        throw new TypeError('Local multiplayer players must begin on one canonical clock');
    }

    runtime.generation += 1;
    runtime.multiplayerState = multiplayerState;
    runtime.players = players;
    runtime.accumulatorMs = 0;
    runtime.lastClockWarp = null;
    runtime.active = true;
    return { generation: runtime.generation, multiplayerState, players };
}

/** @param {LocalMultiplayerFixedTickRuntime} runtime */
export function stopLocalMultiplayerFixedTickRuntime(runtime) {
    if (!runtime) return;
    runtime.generation += 1;
    runtime.active = false;
    runtime.multiplayerState = null;
    runtime.players = [];
    runtime.accumulatorMs = 0;
}

/** Reset the match-wide clock before binding the first round of a new match. */
export function resetLocalMultiplayerFixedMatchClock(runtime) {
    if (!runtime || runtime.active) {
        throw new TypeError('The fixed match clock can only reset while no round owns it');
    }
    runtime.simFrame = 0;
    runtime.simTimeMs = 0;
    runtime.lastClockWarp = null;
}

/**
 * @param {LocalMultiplayerFixedTickRuntime} runtime
 * @param {LocalMultiplayerFixedTickOwnership|null|undefined} ownership
 */
export function ownsLocalMultiplayerFixedTickRuntime(runtime, ownership) {
    if (
        !runtime?.active
        || !ownership
        || runtime.generation !== ownership.generation
        || runtime.multiplayerState !== ownership.multiplayerState
        || runtime.players.length !== ownership.players.length
    ) return false;

    return runtime.players.every((player, index) => (
        player === ownership.players[index]
        && ownership.multiplayerState.players?.[index] === player
    ));
}

/**
 * Advance every eligible board once per match tick. Interleaving boards here,
 * instead of running four independent catch-up planners, gives garbage and
 * elimination callbacks one stable player-index order at every render rate.
 *
 * @param {LocalMultiplayerFixedTickRuntime} runtime
 * @param {number} elapsedMs
 * @param {{
 *   ownership: LocalMultiplayerFixedTickOwnership,
 *   advanceInput?: (playerIndex: number, context: {
 *     tick: number,
 *     tickMs: number,
 *     emit: (command: InputCommand) => boolean,
 *   }) => void,
 *   applyInput?: (playerIndex: number, command: InputCommand) => InputDisposition|boolean,
 *   getPlayDropCallback?: (playerIndex: number) => Function|null|undefined,
 *   getPhysicsCallbacks?: (playerIndex: number) => Object|null|undefined,
 *   shouldAdvancePlayer?: (playerIndex: number, gameState: import('../game.js').GameState) => boolean,
 *   shouldContinue?: () => boolean,
 *   onClockWarp?: (clockWarp: LocalMultiplayerClockWarp) => void,
 *   afterPlayerTick?: (playerIndex: number, result: AdvanceTickResult) => void,
 *   afterTick?: (context: { simFrame: number, simTimeMs: number }) => void,
 * }} options
 */
export function runLocalMultiplayerFixedTicks(runtime, elapsedMs, options) {
    const ownership = options?.ownership;
    const emptyResult = {
        executedSteps: 0,
        plannedSteps: 0,
        tickPlan: null,
        clockWarp: null,
    };
    if (
        !ownsLocalMultiplayerFixedTickRuntime(runtime, ownership)
        || options.shouldContinue?.() === false
        || ownership.multiplayerState.isPaused === true
        || ownership.multiplayerState.isGameOver === true
    ) return emptyResult;

    const configuredTickMs = Number(ownership.players[0]?.simTickMs);
    const tickMs = Number.isFinite(configuredTickMs) && configuredTickMs > 0
        ? configuredTickMs
        : FIXED_TICK_MS;
    const tickPlan = planFixedTicks(runtime.accumulatorMs, elapsedMs, {
        tickMs,
        maxSteps: LOCAL_MULTIPLAYER_FIXED_TICK_MAX_STEPS,
        maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
        maxCarryTicks: FIXED_TICK_MAX_DEBT_MS / tickMs,
    });
    runtime.accumulatorMs = tickPlan.accumulatedMs;

    /** @type {LocalMultiplayerClockWarp|null} */
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

    const ownerContinues = () => (
        ownsLocalMultiplayerFixedTickRuntime(runtime, ownership)
        && (options.shouldContinue?.() ?? true)
    );
    const canStartTick = () => (
        ownerContinues()
        && ownership.multiplayerState.isPaused !== true
        && ownership.multiplayerState.isGameOver !== true
    );
    let executedSteps = 0;
    for (let step = 0; step < tickPlan.steps; step += 1) {
        if (!canStartTick()) break;

        let tickStarted = false;
        try {
            tickStarted = true;
            runtime.simFrame += 1;
            runtime.simTimeMs += tickPlan.tickMs;
            for (let playerIndex = 0; playerIndex < ownership.players.length; playerIndex += 1) {
                if (!ownerContinues()) break;
                const gameState = ownership.players[playerIndex];
                const defaultEligibility = gameState.isAlive !== false
                    && ownership.multiplayerState.playerPaused?.[playerIndex] !== true;
                const eligible = options.shouldAdvancePlayer
                    ? options.shouldAdvancePlayer(playerIndex, gameState)
                    : defaultEligibility;
                if (!eligible) continue;

                const result = advanceTick(gameState, {
                    advanceInput: (context) => options.advanceInput?.(playerIndex, context),
                    applyInput: (command) => (
                        options.applyInput?.(playerIndex, command) ?? false
                    ),
                    advancePhysics: (fixedDelta) => processAutoDrop(
                        gameState,
                        fixedDelta,
                        options.getPlayDropCallback?.(playerIndex),
                        options.getPhysicsCallbacks?.(playerIndex),
                        { fixedTick: true },
                    ),
                    shouldContinue: ownerContinues,
                });
                if (ownerContinues()) options.afterPlayerTick?.(playerIndex, result);
            }
            executedSteps += 1;
            if (ownerContinues()) {
                options.afterTick?.({
                    simFrame: runtime.simFrame,
                    simTimeMs: runtime.simTimeMs,
                });
            }
        } catch (error) {
            // A partially applied player barrier is not a resumable state.
            // Retire it before the FrameRateController can invoke us again.
            stopLocalMultiplayerFixedTickRuntime(runtime);
            throw error;
        } finally {
            if (tickStarted && ownsLocalMultiplayerFixedTickRuntime(runtime, ownership)) {
                // A partial shared tick cannot be replayed safely after an
                // exception or synchronous round replacement.
                runtime.accumulatorMs -= tickPlan.tickMs;
            }
        }
    }

    if (
        executedSteps === tickPlan.steps
        && ownsLocalMultiplayerFixedTickRuntime(runtime, ownership)
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
 * Install one adapter that routes keyboard/gamepad slots to exact per-player
 * GameStates. Device arbitration is per player, while controller-wide clear
 * boundaries release every claim together.
 *
 * @param {{
 *   players: import('../game.js').GameState[],
 *   inputController?: FixedInputController|null,
 *   gamepadController?: FixedInputController|null,
 *   isEnabled: () => boolean,
 *   isPlayerEnabled?: (playerIndex: number, gameState: import('../game.js').GameState) => boolean,
 * }} options
 */
export function createLocalMultiplayerFixedInputBinding(options) {
    const {
        players, inputController, gamepadController, isEnabled,
    } = options;
    let disposed = false;
    const playerInputs = players.map((gameState) => (
        /** @type {PlayerInputState} */ (gameState.playerInput)
    ));
    /** @type {Array<'keyboard'|'gamepad'|null>} */
    const activeDevices = players.map(() => null);

    const bindingClaimsPlayer = (playerIndex, gameState) => (
        !disposed
        && isEnabled() === true
        && players[playerIndex] === gameState
    );
    const bindingAcceptsInput = (playerIndex, gameState) => (
        bindingClaimsPlayer(playerIndex, gameState)
        && gameState?.isAlive !== false
        && gameState?.isPaused !== true
        && gameState?.isGameOver !== true
        && gameState?.isStopped !== true
        && gameState?.isReplay !== true
        && gameState?.isSeeking !== true
        && gameState?.suppressExternalInput !== true
        && (options.isPlayerEnabled?.(playerIndex, gameState) ?? true)
    );
    const resolveGameState = (playerIndex) => (
        !disposed && Number.isInteger(playerIndex) ? players[playerIndex] || null : null
    );
    const adapterIsEnabled = ({ playerIndex, gameState }) => (
        bindingClaimsPlayer(playerIndex, gameState)
    );
    const acceptDevice = (device, context = {}) => {
        const { playerIndex, gameState } = context;
        if (!bindingAcceptsInput(playerIndex, gameState)) return false;
        if (activeDevices[playerIndex] === null) activeDevices[playerIndex] = device;
        return activeDevices[playerIndex] === device;
    };
    const releaseDevice = (device, context = {}) => {
        const { playerIndex } = context;
        if (Number.isInteger(playerIndex)) {
            if (activeDevices[playerIndex] === device) activeDevices[playerIndex] = null;
            return;
        }
        activeDevices.forEach((activeDevice, index) => {
            if (activeDevice === device) activeDevices[index] = null;
        });
    };

    const keyboardAdapter = {
        resolveGameState,
        isEnabled: adapterIsEnabled,
        acceptSource: (context) => acceptDevice('keyboard', context),
        releaseSource: (context) => releaseDevice('keyboard', context),
    };
    const gamepadAdapter = {
        resolveGameState,
        isEnabled: adapterIsEnabled,
        acceptSource: (context) => acceptDevice('gamepad', context),
        releaseSource: (context) => releaseDevice('gamepad', context),
    };

    const clear = () => {
        activeDevices.fill(null);
        playerInputs.forEach((playerInput) => clearPlayerInput(playerInput));
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
        return inputController?.fixedTickInputAdapter === keyboardAdapter
            && gamepadController?.fixedTickInputAdapter === gamepadAdapter;
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
        activeDevices.fill(null);
        disposed = true;
        if (!replacementOwnsInput && (ownsKeyboardAdapter || ownsGamepadAdapter)) {
            playerInputs.forEach((playerInput) => clearPlayerInput(playerInput));
        }
        if (ownsKeyboardAdapter) inputController?.clearFixedTickInput?.();
        if (ownsGamepadAdapter) gamepadController?.clearFixedTickInput?.();
        if (ownsKeyboardAdapter) inputController?.setFixedTickInputAdapter?.(null);
        if (ownsGamepadAdapter) gamepadController?.setFixedTickInputAdapter?.(null);
    };

    return {
        keyboardAdapter,
        gamepadAdapter,
        install,
        clear,
        dispose,
        advanceInput: (playerIndex, context) => {
            const gameState = players[playerIndex];
            if (!bindingAcceptsInput(playerIndex, gameState)) {
                if (gameState) clearPlayerInput(playerInputs[playerIndex]);
                return [];
            }
            return advancePlayerInputTick(playerInputs[playerIndex], context);
        },
        getActiveDevice: (playerIndex) => activeDevices[playerIndex] || null,
    };
}
