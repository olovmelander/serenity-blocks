// @ts-check

import {
    hardDrop as coreHardDrop,
    move as coreMove,
    processAutoDrop,
    rotate as coreRotate,
    softDrop as coreSoftDrop,
} from '../game.js';
import { decrementBlindTimers } from '../blind.js';
import { checkInfinityGameOver } from '../infinity-grid.js';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../fixed-hit-stop-policy.js';
import { updateInputHandlingConfig } from '../player-input-state.js';
import { INPUT_DISPOSITIONS } from '../simulation-tick.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} from '../demo/DemoRecorder.js';
import { readFlag } from '../flags.js';
import {
    createLocalMultiplayerFixedInputBinding,
    createLocalMultiplayerFixedTickRuntime,
    ownsLocalMultiplayerFixedTickRuntime,
    resetLocalMultiplayerFixedMatchClock,
    runLocalMultiplayerFixedTicks,
    startLocalMultiplayerFixedTickRuntime,
    stopLocalMultiplayerFixedTickRuntime,
} from './local-multiplayer-fixed-tick.js';

/** @typedef {Record<string, any>} LocalMultiplayerModeLike */

/**
 * @returns {{
 *   fixedTickEnabled: boolean,
 *   simulationClock: string,
 *   fixedRuntime: import('./local-multiplayer-fixed-tick.js').LocalMultiplayerFixedTickRuntime,
 *   fixedLoop: Record<string, any>|null,
 *   lastClockWarp: import('./local-multiplayer-fixed-tick.js').LocalMultiplayerClockWarp|null,
 *   transitionGeneration: number,
 *   roundActive: boolean,
 *   fixedTickBarrierActive: boolean,
 *   roundStartSimFrame: number,
 *   roundStartSimTimeMs: number,
 * }}
 */
export function createLocalMultiplayerLoopState() {
    return {
        fixedTickEnabled: false,
        simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        fixedRuntime: createLocalMultiplayerFixedTickRuntime(),
        fixedLoop: null,
        lastClockWarp: null,
        transitionGeneration: 0,
        roundActive: false,
        fixedTickBarrierActive: false,
        roundStartSimFrame: 0,
        roundStartSimTimeMs: 0,
    };
}

/** @param {LocalMultiplayerModeLike} mode */
function ensureLoopState(mode) {
    if (!mode._localSimulationLoop) {
        mode._localSimulationLoop = createLocalMultiplayerLoopState();
    }
    return mode._localSimulationLoop;
}

function prefersReducedMotion(settings) {
    return Boolean(
        settings?.reducedMotion
        || (typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    );
}

function getUnsupportedFixedConfigReasons(mode) {
    const config = mode.matchConfig || {};
    const players = mode.multiplayerState?.players || [];
    const reasons = [];
    if (!mode.deps?.frameRateController?.startHybridLoop) reasons.push('FrameRateController unavailable');
    if (typeof mode.deps?.getMultiplayerPhysicsCallbacks !== 'function') {
        reasons.push('multiplayer physics callback binding unavailable');
    }
    if (typeof mode._handleFixedTickTopOutBatch !== 'function') {
        reasons.push('fixed-tick top-out batch resolver unavailable');
    }
    const inputController = mode.deps?.inputController;
    const gamepadController = mode.deps?.gamepadController;
    if (
        typeof inputController?.setFixedTickInputAdapter !== 'function'
        || typeof inputController?.clearFixedTickInput !== 'function'
    ) reasons.push('fixed-tick keyboard input unavailable');
    if (
        typeof gamepadController?.setFixedTickInputAdapter !== 'function'
        || typeof gamepadController?.clearFixedTickInput !== 'function'
    ) reasons.push('fixed-tick gamepad input unavailable');
    if (config.isInfinityLMS) reasons.push('Infinity LMS uses a renderer-derived simulation camera');
    if (config.hotPotato || config.attackStyle === 'hot_potato') reasons.push('Hot Potato uses wall time');
    if (config.endCondition === 'time') reasons.push('time-limit matches use wall time');
    if (config.playerSlots?.some((slot) => (
        slot?.kind === 'bot' || slot?.type === 'bot' || slot?.isBot === true
    ))) reasons.push('bots use wall time and unseeded randomness');
    if (
        players.length < 2
        || players.some((player) => !player?.playerInput?.pendingEdges)
    ) reasons.push('per-player fixed input state unavailable');
    if (players.some((player) => player?.simTickMs !== players[0]?.simTickMs)) {
        reasons.push('player tick durations differ');
    }
    return reasons;
}

/**
 * Latch one clock for the whole match. Unsupported rule variants fall back as
 * a unit; a match never mixes fixed and variable player clocks.
 * @param {LocalMultiplayerModeLike} mode
 */
export function configureLocalMultiplayerSimulationClock(mode) {
    const loopState = ensureLoopState(mode);
    stopLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime);
    resetLocalMultiplayerFixedMatchClock(loopState.fixedRuntime);

    const requested = readFlag('fixedTick', false);
    const unsupportedReasons = requested ? getUnsupportedFixedConfigReasons(mode) : [];
    loopState.fixedTickEnabled = requested && unsupportedReasons.length === 0;
    loopState.simulationClock = loopState.fixedTickEnabled
        ? DEMO_FIXED_SIMULATION_CLOCK
        : DEMO_LEGACY_SIMULATION_CLOCK;
    loopState.lastClockWarp = null;
    loopState.roundStartSimFrame = 0;
    loopState.roundStartSimTimeMs = 0;

    if (requested && unsupportedReasons.length > 0) {
        console.warn(
            `[LocalMultiplayer] fixedTick using legacy clock: ${unsupportedReasons.join('; ')}`,
        );
    }

    const settings = mode.deps?.settingsManager?.get?.() || {};
    const players = mode.multiplayerState?.players || [];
    players.forEach((gameState) => {
        gameState.simulationClock = loopState.simulationClock;
        if (!loopState.fixedTickEnabled) return;
        updateInputHandlingConfig(gameState.playerInput, settings);
        gameState.hitStopEnabled = !prefersReducedMotion(settings);
    });
    return loopState.simulationClock;
}

/** Relatch the whole match after fixed ownership cannot be acquired. */
function fallbackLocalMultiplayerSimulationClock(mode, reason) {
    const loopState = ensureLoopState(mode);
    loopState.fixedTickEnabled = false;
    loopState.simulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
    loopState.lastClockWarp = null;
    (mode.multiplayerState?.players || []).forEach((gameState) => {
        gameState.simulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
    });
    console.warn(`[LocalMultiplayer] fixedTick startup fell back to legacy clock: ${reason}`);
}

/** @param {import('../game.js').GameState} gameState */
function captureHitStop(gameState) {
    return {
        hitStopRemaining: gameState.hitStopRemaining,
        hitStopTicks: gameState.hitStopTicks,
        sourceMs: gameState._hitStopTickSourceMs,
        durationMs: gameState._hitStopTickDurationMs,
    };
}

/**
 * @param {import('../game.js').GameState} gameState
 * @param {ReturnType<typeof captureHitStop>} snapshot
 */
function restoreHitStop(gameState, snapshot) {
    gameState.hitStopRemaining = snapshot.hitStopRemaining;
    gameState.hitStopTicks = snapshot.hitStopTicks;
    gameState._hitStopTickSourceMs = snapshot.sourceMs;
    gameState._hitStopTickDurationMs = snapshot.durationMs;
}

/**
 * Fence application-root callbacks to one round and replace live theme /
 * accessibility hit-stop producers with the match-latched fixed policy.
 * @param {Record<string, any>} callbacks
 * @param {import('../game.js').GameState} gameState
 * @param {() => boolean} ownsRound
 */
export function createLocalMultiplayerFixedPhysicsCallbacks(
    callbacks,
    gameState,
    ownsRound,
) {
    const fenced = {};
    Object.entries(callbacks || {}).forEach(([name, value]) => {
        fenced[name] = typeof value === 'function'
            ? (...args) => (ownsRound() ? value(...args) : undefined)
            : value;
    });

    const wrapHitStopProducer = (name, applyPolicy) => (...args) => {
        if (!ownsRound()) return undefined;
        const snapshot = captureHitStop(gameState);
        let result;
        try {
            result = callbacks?.[name]?.(...args);
        } finally {
            restoreHitStop(gameState, snapshot);
            applyPolicy(...args);
        }
        return result;
    };
    fenced.onHardDrop = wrapHitStopProducer(
        'onHardDrop',
        () => applyFixedHardDropHitStop(gameState),
    );
    fenced.onLineClearImpact = wrapHitStopProducer(
        'onLineClearImpact',
        (lineCount) => applyFixedLineImpactHitStop(gameState, lineCount),
    );
    fenced.onPerfectClear = wrapHitStopProducer(
        'onPerfectClear',
        () => applyFixedPerfectClearHitStop(gameState),
    );
    return fenced;
}

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
 * Apply one canonical command to the exact indexed local board.
 * @param {{action: string, value?: unknown}} command
 * @param {{
 *   gameState: import('../game.js').GameState,
 *   isEnabled: () => boolean,
 *   juice?: Record<string, any>|null,
 *   physicsCallbacks?: Record<string, any>|null,
 *   soundPlayer?: Record<string, any>|null,
 * }} context
 */
export function applyLocalMultiplayerFixedCommand(command, context) {
    const {
        gameState, isEnabled, juice, physicsCallbacks, soundPlayer,
    } = context;
    if (
        isEnabled() !== true
        || gameState.isAlive === false
        || gameState.isPaused
        || gameState.isGameOver
        || gameState.isStopped
    ) return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
    if (gameState.hitStopRemaining > 0 || gameState.hitStopTicks > 0) {
        return INPUT_DISPOSITIONS.REJECTED_HIT_STOP;
    }

    const { action, value } = command;
    if (gameState.isProcessingPhysics) return queueBusyCommand(gameState, action, value);

    let accepted = false;
    if (action === 'move' && (value === -1 || value === 1)) {
        accepted = coreMove(gameState, value, () => soundPlayer?.playMove?.(), () => {});
        juice?.nudge?.(value * 0.5, 0);
    } else if (
        action === 'rotate'
        && (value === 'left' || value === 'right' || value === 'flip')
    ) {
        accepted = coreRotate(gameState, value, () => soundPlayer?.playRotate?.(), () => {});
        if (accepted) {
            let degrees = 1;
            if (value === 'left') degrees = -1;
            else if (value === 'flip') degrees = 2;
            juice?.tilt?.(degrees * 1.5);
            juice?.nudge?.(0, -0.5);
        }
    } else if (action === 'hardDrop') {
        accepted = coreHardDrop(
            gameState,
            () => soundPlayer?.playDrop?.(),
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
        if (accepted) {
            juice?.dip?.(4);
            juice?.bounce?.();
        }
    } else if (action === 'softDrop') {
        const beforeProcessing = gameState.isProcessingPhysics;
        const beforePiece = gameState.currentPiece;
        const moved = coreSoftDrop(
            gameState,
            () => soundPlayer?.playDrop?.(),
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
        accepted = Boolean(moved)
            || (!beforeProcessing && gameState.isProcessingPhysics)
            || (beforePiece && beforePiece !== gameState.currentPiece);
    }
    return accepted ? INPUT_DISPOSITIONS.APPLIED : INPUT_DISPOSITIONS.REJECTED_PHYSICS;
}

/** @param {LocalMultiplayerModeLike} mode */
function startFixedLoop(mode) {
    const loopState = ensureLoopState(mode);
    const { multiplayerState } = mode;
    const frameRateController = mode.deps?.frameRateController;
    if (!multiplayerState || !frameRateController?.startHybridLoop) {
        throw new TypeError('Local fixed-tick loop requires match state and FrameRateController');
    }
    if (frameRateController.isRunning) {
        throw new Error('FrameRateController is already owned');
    }

    const ownership = startLocalMultiplayerFixedTickRuntime(
        loopState.fixedRuntime,
        multiplayerState,
    );
    loopState.roundStartSimFrame = loopState.fixedRuntime.simFrame;
    loopState.roundStartSimTimeMs = loopState.fixedRuntime.simTimeMs;
    /** @type {ReturnType<typeof createLocalMultiplayerFixedInputBinding>|null} */
    let inputBinding = null;
    /** @type {Record<string, any>|null} */
    let loopOwner = null;
    try {
        const roundOwner = captureLocalMultiplayerRound(mode);
        if (!roundOwner) throw new Error('Local Multiplayer round ownership is unavailable');
        const ownsRound = () => (
            loopState.fixedTickEnabled
            && mode.isRunning
            && mode.multiplayerState === multiplayerState
            && ownsLocalMultiplayerRound(mode, roundOwner)
            && ownsLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime, ownership)
        );
        const pendingTopOuts = new Set();
        inputBinding = createLocalMultiplayerFixedInputBinding({
            players: ownership.players,
            inputController: mode.deps?.inputController,
            gamepadController: mode.deps?.gamepadController,
            isEnabled: ownsRound,
            isPlayerEnabled: (playerIndex) => (
                (multiplayerState.isPaused !== true || loopState.fixedTickBarrierActive)
                && multiplayerState.playerPaused?.[playerIndex] !== true
                && !mode._isBotPlayer?.(playerIndex)
            ),
        });
        const physicsCallbacks = ownership.players.map((gameState, playerIndex) => {
            const playerNum = playerIndex + 1;
            const callbacks = mode.deps?.getMultiplayerPhysicsCallbacks?.(playerNum, {
                onPlayerTopOut: (reportedIndex, reportedState) => {
                    if (
                        !ownsRound()
                        || reportedIndex !== playerIndex
                        || reportedState !== gameState
                    ) return false;
                    pendingTopOuts.add(playerIndex);
                    return true;
                },
            }) || mode._getPhysicsCallbacks(playerNum);
            return createLocalMultiplayerFixedPhysicsCallbacks(callbacks, gameState, ownsRound);
        });
        const soundPlayer = mode.deps?.soundManager?.sfxPlayer;
        const logicUpdate = (_time, delta) => {
            loopState.fixedTickBarrierActive = true;
            try {
                runLocalMultiplayerFixedTicks(loopState.fixedRuntime, delta, {
                    ownership,
                    advanceInput: inputBinding.advanceInput,
                    applyInput: (playerIndex, command) => applyLocalMultiplayerFixedCommand(command, {
                        gameState: ownership.players[playerIndex],
                        isEnabled: () => (
                            ownsRound()
                            && multiplayerState.playerPaused?.[playerIndex] !== true
                        ),
                        juice: mode[`boardJuiceP${playerIndex + 1}`],
                        physicsCallbacks: physicsCallbacks[playerIndex],
                        soundPlayer,
                    }),
                    getPlayDropCallback: () => () => soundPlayer?.playDrop?.(),
                    getPhysicsCallbacks: (playerIndex) => physicsCallbacks[playerIndex],
                    shouldContinue: ownsRound,
                    afterTick: () => {
                        if (!ownsRound() || pendingTopOuts.size === 0) return;
                        const playerIndices = Array.from(pendingTopOuts).sort(
                            (left, right) => left - right,
                        );
                        pendingTopOuts.clear();
                        const resolution = mode._handleFixedTickTopOutBatch(
                            playerIndices,
                            roundOwner,
                        );
                        Promise.resolve(resolution).catch((error) => {
                            const ownedAtFailure = ownsRound();
                            loopOwner?.stop?.();
                            if (ownedAtFailure) {
                                console.error(
                                    '[LocalMultiplayer] Fixed top-out batch resolution failed:',
                                    error,
                                );
                            }
                        });
                    },
                    onClockWarp: (clockWarp) => {
                        loopState.lastClockWarp = clockWarp;
                        console.warn('[LocalMultiplayer] Fixed simulation clock rebased:', clockWarp);
                    },
                });
            } catch (error) {
                loopOwner?.stop?.();
                throw error;
            } finally {
                loopState.fixedTickBarrierActive = false;
            }
        };
        const renderUpdate = () => {
            if (!ownsRound()) return;
            mode._updateMultiplayerStats(loopState.fixedRuntime.simFrame);
            mode._syncBoardScenes();
        };

        loopOwner = {
            inputBinding,
            logicUpdate,
            ownership,
            renderUpdate,
            stop: () => {
                pendingTopOuts.clear();
                inputBinding.dispose();
                if (ownsLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime, ownership)) {
                    stopLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime);
                }
                if (
                    frameRateController.updateCallback === logicUpdate
                    && frameRateController.renderCallback === renderUpdate
                ) {
                    frameRateController.stopHybridLoop?.();
                }
                if (loopState.fixedLoop === loopOwner) {
                    loopState.fixedLoop = null;
                    mode.usingHybridLoop = false;
                }
            },
        };
        loopState.fixedLoop = loopOwner;
        if (!inputBinding.install()) {
            throw new Error('Fixed-tick input controllers did not accept Local Multiplayer ownership');
        }
        frameRateController.startHybridLoop(logicUpdate, renderUpdate);
        if (
            frameRateController.updateCallback !== logicUpdate
            || frameRateController.renderCallback !== renderUpdate
            || frameRateController.isRunning !== true
        ) throw new Error('FrameRateController did not accept Local Multiplayer ownership');
        mode.usingHybridLoop = true;
    } catch (error) {
        if (loopOwner) {
            loopOwner.stop();
        } else {
            inputBinding?.dispose?.();
            if (ownsLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime, ownership)) {
                stopLocalMultiplayerFixedTickRuntime(loopState.fixedRuntime);
            }
        }
        throw error;
    }
}

/** @param {LocalMultiplayerModeLike} mode */
function startLegacyLoop(mode) {
    const generation = mode._gameLoopGeneration;
    let frameCount = 0;
    const loop = (currentTime) => {
        if (generation !== mode._gameLoopGeneration) return;
        if (!mode.isRunning || mode.multiplayerState.isGameOver) return;
        if (mode.multiplayerState.isPaused) {
            if (generation === mode._gameLoopGeneration) {
                mode.animationFrameId = requestAnimationFrame(loop);
            }
            return;
        }

        const delta = currentTime - mode.multiplayerState.lastTime;
        mode.multiplayerState.lastTime = currentTime;
        if (mode.multiplayerState.hotPotato?.enabled) {
            const previousHolder = mode.multiplayerState.hotPotato.holderIndex;
            const event = mode.multiplayerState.updateHotPotato(Date.now());
            const currentHolder = mode.multiplayerState.hotPotato.holderIndex;
            if (previousHolder !== currentHolder && currentHolder !== null) {
                if (event?.type === 'detonate') mode.deps.soundManager?.playGarbageReceived();
                else mode.deps.soundManager?.playGarbageSend();
            }
        }
        const globalWindow = /** @type {any} */ (window);
        globalWindow.inputController?.updateDAS(delta);
        globalWindow.gamepadController?.advanceGameplayInput(currentTime);
        mode.botManager?.update(delta, currentTime);
        frameCount += 1;

        for (let playerIndex = 0; playerIndex < mode.multiplayerState.numPlayers; playerIndex += 1) {
            const playerState = mode.multiplayerState.players[playerIndex];
            if (!playerState.isAlive || mode.multiplayerState.playerPaused?.[playerIndex]) continue;
            decrementBlindTimers(playerState, delta / 1000);
            if (playerState.hitStopRemaining > 0) {
                playerState.hitStopRemaining = Math.max(0, playerState.hitStopRemaining - delta);
                continue;
            }
            if (!playerState.isProcessingPhysics && playerState.currentPiece) {
                if (mode.matchConfig?.isInfinityLMS && frameCount % 30 === 0) {
                    mode._maybeExpandPlayerGrid(playerState, mode.boardScenes[playerIndex]);
                }
                const playerNum = playerIndex + 1;
                const callbacks = mode.deps.getMultiplayerPhysicsCallbacks?.(playerNum)
                    || mode._getPhysicsCallbacks(playerNum);
                processAutoDrop(
                    playerState,
                    delta,
                    () => mode.deps.soundManager.sfxPlayer.playDrop(),
                    callbacks,
                );
            }
            if (
                mode.matchConfig?.isInfinityLMS
                && !playerState.isGameOver
                && checkInfinityGameOver(playerState)
            ) {
                playerState.isGameOver = true;
                mode._handleGameOver(playerIndex);
            }
        }
        mode._updateMultiplayerStats(frameCount);
        mode._syncBoardScenes();
        if (generation === mode._gameLoopGeneration) {
            mode.animationFrameId = requestAnimationFrame(loop);
        }
    };
    mode.animationFrameId = requestAnimationFrame(loop);
}

/** Retire every timer/input owner before binding a new round. */
export function stopLocalMultiplayerModeLoop(mode) {
    const loopState = ensureLoopState(mode);
    loopState.transitionGeneration += 1;
    loopState.roundActive = false;
    loopState.fixedLoop?.stop?.();
    loopState.fixedLoop = null;
    mode._gameLoopGeneration = (mode._gameLoopGeneration || 0) + 1;
    if (mode.animationFrameId !== null && mode.animationFrameId !== undefined) {
        cancelAnimationFrame(mode.animationFrameId);
    }
    mode.animationFrameId = null;
    const legacyFrameId = mode.multiplayerState?.animationId;
    if (legacyFrameId !== null && legacyFrameId !== undefined) {
        cancelAnimationFrame(legacyFrameId);
        mode.multiplayerState.animationId = null;
    }
    mode.usingHybridLoop = false;
}

/** Bind the configured fixed or exact legacy loop for the current round. */
export function startLocalMultiplayerModeLoop(mode) {
    stopLocalMultiplayerModeLoop(mode);
    const loopState = ensureLoopState(mode);
    loopState.roundActive = true;
    if (!loopState.fixedTickEnabled) {
        startLegacyLoop(mode);
        return;
    }
    try {
        startFixedLoop(mode);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fallbackLocalMultiplayerSimulationClock(mode, reason);
        startLegacyLoop(mode);
    }
}

/** Clear canonical holds without releasing fixed timer ownership. */
export function clearLocalMultiplayerFixedInput(mode) {
    ensureLoopState(mode).fixedLoop?.inputBinding?.clear?.();
}

/** Capture an exact round token for delayed UI/game-over continuations. */
export function captureLocalMultiplayerRound(mode) {
    const loopState = ensureLoopState(mode);
    if (!mode.isRunning || !mode.multiplayerState) return null;
    return Object.freeze({
        generation: loopState.transitionGeneration,
        multiplayerState: mode.multiplayerState,
        players: mode.multiplayerState.players.slice(),
        rngDescriptor: mode.multiplayerState.rngDescriptor,
    });
}

/** @param {LocalMultiplayerModeLike} mode @param {Record<string, any>|null} round */
export function ownsLocalMultiplayerRound(mode, round) {
    const loopState = ensureLoopState(mode);
    return Boolean(
        round
        && mode.isRunning
        && loopState.transitionGeneration === round.generation
        && mode.multiplayerState === round.multiplayerState
        && mode.multiplayerState.rngDescriptor === round.rngDescriptor
        && round.players.every((player, index) => mode.multiplayerState.players[index] === player),
    );
}

/**
 * Capture presentation-rate metrics from the clock that owns this match.
 * Fixed rounds exclude countdown, pause, outcome animation, and teardown;
 * legacy rounds deliberately retain their existing wall-clock semantics.
 * @param {LocalMultiplayerModeLike} mode
 */
export function captureLocalMultiplayerClock(mode) {
    const loopState = ensureLoopState(mode);
    const usesFixedTiming = loopState.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;
    if (usesFixedTiming) {
        const matchFrames = Math.max(0, Number(loopState.fixedRuntime.simFrame) || 0);
        const matchMs = Math.max(0, Number(loopState.fixedRuntime.simTimeMs) || 0);
        return Object.freeze({
            simulationClock: loopState.simulationClock,
            usesFixedTiming: true,
            matchFrames,
            matchMs,
            roundFrames: Math.max(0, matchFrames - loopState.roundStartSimFrame),
            roundMs: Math.max(0, matchMs - loopState.roundStartSimTimeMs),
        });
    }

    const now = Date.now();
    const matchStart = Number.isFinite(mode.matchStartTime) ? mode.matchStartTime : now;
    const roundStart = Number.isFinite(mode.roundStartTime) ? mode.roundStartTime : matchStart;
    return Object.freeze({
        simulationClock: loopState.simulationClock,
        usesFixedTiming: false,
        matchFrames: null,
        matchMs: Math.max(0, now - matchStart),
        roundFrames: null,
        roundMs: Math.max(0, now - roundStart),
    });
}

/** Map MultiPlayerState's internal match winner to the mode result contract. */
export function resolveLocalMultiplayerMatchResult(multiplayerState) {
    if (multiplayerState?.isGameOver !== true) return null;
    const { winner } = multiplayerState;
    if (Number.isInteger(winner)) return `player${winner + 1}`;
    const teamMatch = typeof winner === 'string' ? /^Team ([A-Z])$/.exec(winner) : null;
    if (teamMatch) {
        return { type: 'team', teamId: teamMatch[1].charCodeAt(0) - 65 };
    }
    return 'draw';
}

/**
 * Retire a round synchronously and capture all physics promises before reset.
 * @param {LocalMultiplayerModeLike} mode
 */
export function retireLocalMultiplayerRound(mode) {
    const { multiplayerState } = mode;
    const clock = captureLocalMultiplayerClock(mode);
    const players = multiplayerState?.players?.slice() || [];
    const physicsPromises = players
        .map((player) => player.latestPhysicsPromise)
        .filter(Boolean);
    stopLocalMultiplayerModeLoop(mode);
    if (multiplayerState) multiplayerState.isPaused = true;
    players.forEach((player) => { player.isStopped = true; });
    return Object.freeze({
        clock,
        generation: ensureLoopState(mode).transitionGeneration,
        multiplayerState,
        players,
        physicsPromises,
        rngDescriptor: multiplayerState?.rngDescriptor ?? null,
    });
}
/**
 * @param {LocalMultiplayerModeLike} mode
 * @param {ReturnType<typeof retireLocalMultiplayerRound>} retired
 */
export async function drainLocalMultiplayerRound(mode, retired) {
    await Promise.allSettled(retired.physicsPromises);
    const loopState = ensureLoopState(mode);
    return Boolean(
        retired.multiplayerState
        && loopState.transitionGeneration === retired.generation
        && mode.multiplayerState === retired.multiplayerState
        && mode.multiplayerState.rngDescriptor === retired.rngDescriptor
        && retired.players.every((player, index) => mode.multiplayerState.players[index] === player),
    );
}
