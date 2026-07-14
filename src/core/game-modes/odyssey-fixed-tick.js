// @ts-check

import {
    hardDrop as coreHardDrop,
    move as coreMove,
    rotate as coreRotate,
    softDrop as coreSoftDrop,
} from '../game.js';
import { INPUT_DISPOSITIONS } from '../simulation-tick.js';
import { maintainInfinitySimulation } from '../infinity-simulation-maintenance.js';
import {
    createSinglePlayerFixedInputBinding,
    createSinglePlayerFixedTickRuntime,
    ownsSinglePlayerFixedTickRuntime,
    runSinglePlayerFixedTicks,
    startSinglePlayerFixedTickRuntime,
    stopSinglePlayerFixedTickRuntime,
} from './single-player-fixed-tick.js';

export const createOdysseyFixedTickRuntime = createSinglePlayerFixedTickRuntime;

/**
 * @param {import('../game.js').GameState} gameState
 * @param {string} action
 * @param {unknown} value
 */
function queueBusyCommand(gameState, action, value) {
    if (action !== 'move' && action !== 'rotate') {
        return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
    }
    const queued = { type: action, dir: value };
    if (Array.isArray(gameState.inputQueue)) {
        if (gameState.inputQueue.length >= 4) return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
        gameState.inputQueue.push(queued);
    } else if (gameState.inputQueue) {
        gameState.inputQueue = [gameState.inputQueue, queued].slice(0, 4);
    } else {
        gameState.inputQueue = queued;
    }
    return INPUT_DISPOSITIONS.DEFERRED_PHYSICS;
}

/**
 * Apply one canonical player-0 command to a captured Odyssey attempt.
 * @param {{ action: string, value?: any }} command
 * @param {{
 *   gameState: import('../game.js').GameState,
 *   isEnabled: () => boolean,
 *   juice?: Record<string, Function>|null,
 *   physicsCallbacks?: Record<string, Function>|null,
 *   playDropCallback?: Function|null,
 *   soundPlayer?: Record<string, Function>|null,
 * }} context
 */
export function applyOdysseyFixedCommand(command, context) {
    const {
        gameState,
        isEnabled,
        juice,
        physicsCallbacks,
        playDropCallback,
        soundPlayer,
    } = context;
    if (
        isEnabled() !== true
        || gameState.isPaused
        || gameState.isGameOver
        || gameState.isStopped
    ) return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
    if (gameState.hitStopRemaining > 0 || gameState.hitStopTicks > 0) {
        return INPUT_DISPOSITIONS.REJECTED_HIT_STOP;
    }

    const { action, value } = command;
    const mirrorControls = /** @type {any} */ (gameState).mirrorControls === true;
    const commandValue = action === 'move' && mirrorControls ? -value : value;
    if (gameState.isProcessingPhysics) {
        return queueBusyCommand(gameState, action, commandValue);
    }

    let accepted = false;
    if (action === 'move') {
        accepted = coreMove(
            gameState,
            commandValue,
            () => soundPlayer?.playMove?.(),
            () => {},
        );
        if (accepted) {
            juice?.nudge?.(commandValue * 1.5, 0);
            juice?.tilt?.(commandValue * 0.4);
        } else {
            juice?.nudge?.(commandValue * 0.8, 0);
        }
    } else if (action === 'rotate') {
        accepted = coreRotate(
            gameState,
            value,
            () => soundPlayer?.playRotate?.(),
            () => {},
        );
        if (accepted) juice?.tilt?.(value === 'left' ? -0.3 : 0.3);
    } else if (action === 'hardDrop') {
        accepted = coreHardDrop(
            gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
    } else if (action === 'softDrop') {
        const beforeProcessing = gameState.isProcessingPhysics;
        const beforePiece = gameState.currentPiece;
        const moved = coreSoftDrop(
            gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
        accepted = Boolean(moved)
            || (!beforeProcessing && gameState.isProcessingPhysics)
            || (beforePiece && beforePiece !== gameState.currentPiece);
    }
    return accepted ? INPUT_DISPOSITIONS.APPLIED : INPUT_DISPOSITIONS.REJECTED_PHYSICS;
}

/**
 * Install one timer-free Odyssey runner under the existing FRC owner.
 * @param {{
 *   frameRateController: Record<string, any>,
 *   gamepadController?: Record<string, any>|null,
 *   gameState: import('../game.js').GameState,
 *   inputController?: Record<string, any>|null,
 *   runtime: import('./single-player-fixed-tick.js').SinglePlayerFixedTickRuntime,
 *   isEnabled: () => boolean,
 *   isPaused: () => boolean,
 *   applyInput?: (command: any) => any,
 *   playDropCallback?: Function|null,
 *   physicsCallbacks?: Record<string, Function>|null,
 *   onClockWarp?: (clockWarp: any) => void,
 *   afterTick?: (result: any) => void,
 *   render: () => void,
 * }} options
 */
export function startOdysseyFixedTickLoop(options) {
    const {
        frameRateController,
        gamepadController,
        gameState,
        inputController,
        runtime,
    } = options;
    const ownership = startSinglePlayerFixedTickRuntime(runtime, gameState);
    const inputBinding = createSinglePlayerFixedInputBinding({
        gameState,
        inputController,
        gamepadController,
        isEnabled: options.isEnabled,
    });
    const owns = () => options.isEnabled() === true
        && ownsSinglePlayerFixedTickRuntime(runtime, ownership);
    const continues = () => owns()
        && options.isPaused() !== true
        && !gameState.isPaused
        && !gameState.isGameOver
        && !gameState.isStopped;
    const logicUpdate = (_time, delta) => {
        runSinglePlayerFixedTicks(runtime, delta, {
            ownership,
            advanceInput: inputBinding.advanceInput,
            applyInput: options.applyInput,
            playDropCallback: options.playDropCallback,
            physicsCallbacks: options.physicsCallbacks,
            shouldContinue: continues,
            onClockWarp: options.onClockWarp,
            afterTick: options.afterTick,
        });
    };
    const renderUpdate = () => {
        if (owns()) options.render();
    };
    try {
        inputBinding.install();
        frameRateController.startHybridLoop(logicUpdate, renderUpdate);
    } catch (error) {
        inputBinding.dispose();
        stopSinglePlayerFixedTickRuntime(runtime);
        frameRateController?.stopHybridLoop?.();
        throw error;
    }
    return {
        inputBinding,
        ownership,
        owns,
        stop: () => {
            inputBinding.dispose();
            if (ownsSinglePlayerFixedTickRuntime(runtime, ownership)) {
                stopSinglePlayerFixedTickRuntime(runtime);
            }
        },
    };
}

/**
 * Compose the generic single-board runner with one exact Odyssey attempt.
 * Keeping this orchestration outside OdysseyMode prevents its lifecycle god
 * object from becoming the fixed-clock implementation boundary.
 * @param {Record<string, any>} mode
 * @param {Record<string, any>} session
 * @param {{
 *   physicsCallbacks: Record<string, Function>,
 *   playDropCallback: Function,
 *   render: () => void,
 * }} context
 */
export function startOdysseyModeFixedTickLoop(mode, session, context) {
    const { gameState, hybridEngine } = session;
    const commandContext = {
        gameState,
        physicsCallbacks: context.physicsCallbacks,
        playDropCallback: context.playDropCallback,
        session,
    };
    return startOdysseyFixedTickLoop({
        frameRateController: mode.deps.frameRateController,
        gamepadController: mode.deps.gamepadController,
        gameState,
        inputController: mode.deps.inputController,
        runtime: mode._fixedTickRuntime,
        isEnabled: () => (
            mode._fixedTickEnabled
            && mode.isRunning
            && mode._isLevelSessionActive(session)
        ),
        isPaused: () => mode.isPaused,
        applyInput: (command) => mode._applyFixedCommand(command, commandContext),
        playDropCallback: context.playDropCallback,
        physicsCallbacks: context.physicsCallbacks,
        onClockWarp: (clockWarp) => {
            mode._lastFixedTickClockWarp = clockWarp;
            console.warn('[Odyssey] Fixed simulation clock rebased:', clockWarp);
        },
        afterTick: () => {
            hybridEngine.updateTime(gameState.simTimeMs / 1000);
            hybridEngine.updateScore(gameState.score || 0);
            mode._checkVictoryConditions(session);
            if (!mode._isLevelSessionActive(session)) return;
            if (gameState.isProcessingPhysics || !gameState.isInfinityMode) return;
            const maintenance = maintainInfinitySimulation(gameState);
            if (maintenance.gameOverTransitioned) mode._handleGameOver(session);
        },
        render: context.render,
    });
}
