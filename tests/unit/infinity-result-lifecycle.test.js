import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const moduleMocks = vi.hoisted(() => ({
    incrementStat: vi.fn(),
    setStatMax: vi.fn(),
    showGameOverModal: vi.fn(),
    spawnPiece: vi.fn(),
    uploadScore: vi.fn(),
}));

vi.mock('../../src/core/game.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        spawnPiece: moduleMocks.spawnPiece,
    };
});

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: function BoardJuice() {},
}));

vi.mock('../../src/ui/infinity/InfinityMinimap.js', () => {
    function InfinityMinimap() {
        this.container = { addEventListener: vi.fn() };
    }
    InfinityMinimap.prototype.destroy = vi.fn();
    InfinityMinimap.prototype.hide = vi.fn();
    InfinityMinimap.prototype.onPause = vi.fn();
    InfinityMinimap.prototype.onUnpause = vi.fn();
    InfinityMinimap.prototype.show = vi.fn();
    InfinityMinimap.prototype.update = vi.fn();
    return { InfinityMinimap };
});

vi.mock('../../src/ui/infinity/InfinityHUD.js', () => {
    function InfinityHUD() {}
    InfinityHUD.prototype.destroy = vi.fn();
    InfinityHUD.prototype.hide = vi.fn();
    InfinityHUD.prototype.show = vi.fn();
    InfinityHUD.prototype.update = vi.fn();
    return { InfinityHUD };
});

vi.mock('../../src/ui/modals.js', () => ({
    showGameOverModal: moduleMocks.showGameOverModal,
}));

vi.mock('../../src/core/steam/steam-service.js', () => ({
    default: {
        incrementStat: moduleMocks.incrementStat,
        setStatMax: moduleMocks.setStatMax,
        uploadScore: moduleMocks.uploadScore,
    },
}));

const {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} = await import('../../src/core/demo/DemoRecorder.js');
const { eventBus, EVENTS } = await import('../../src/events/event-bus.js');
const { InfinityMode } = await import('../../src/core/game-modes/InfinityMode.js');
const {
    canWriteLegacySimulationResults,
    canWriteLegacySinglePlayerResults,
} = await import('../../src/core/game-modes/single-player-result-compatibility.js');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function createMode() {
    const highScoreManager = {
        addScore: vi.fn().mockResolvedValue(undefined),
    };
    const frameRateController = {
        isRunning: false,
        pauseHybridLoop: vi.fn(),
        resumeHybridLoop: vi.fn(),
        stopHybridLoop: vi.fn(function stopHybridLoop() {
            this.isRunning = false;
        }),
    };
    const mode = new InfinityMode({
        frameRateController,
        highScoreManager,
        modalManager: {},
        phaserGame: null,
        settingsManager: {
            get: vi.fn(() => ({ effectQuality: 'high' })),
        },
        soundManager: {
            sfxPlayer: {
                playMove: vi.fn(),
                playRotate: vi.fn(),
            },
        },
    });
    mode.isActive = true;

    // Keep these tests on lifecycle and result ownership. Infinity's visual,
    // input, and loop behavior have their own contracts and are unchanged.
    mode._applyInfinityLayout = vi.fn();
    mode._cleanupScrollState = vi.fn();
    mode._disableGamepadExploration = vi.fn();
    mode._enableGamepadExploration = vi.fn();
    mode._enableScrollExploration = vi.fn();
    mode._initBoardJuice = vi.fn();
    mode._preparePhaserScene = vi.fn(() => {
        mode.physicsCallbacks = null;
    });
    mode._refreshNextQueue = vi.fn();
    mode._startGameLoop = vi.fn();
    mode._updateStats = vi.fn();

    return { frameRateController, highScoreManager, mode };
}

async function startSession(mode, options) {
    await mode.onStart(options);
    return mode._activeSession;
}

describe('Infinity captured-session lifecycle and result compatibility', () => {
    beforeEach(() => {
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
        });
        vi.stubGlobal('window', {
            dispatchEvent: vi.fn(),
            move: undefined,
            rotate: undefined,
        });
        vi.stubGlobal('CustomEvent', function CustomEvent(type, options) {
            this.type = type;
            this.detail = options?.detail;
        });
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        moduleMocks.incrementStat.mockResolvedValue(undefined);
        moduleMocks.setStatMax.mockResolvedValue(undefined);
        moduleMocks.showGameOverModal.mockResolvedValue(true);
        moduleMocks.spawnPiece.mockReturnValue(undefined);
        moduleMocks.uploadScore.mockResolvedValue(undefined);
    });

    afterEach(() => {
        Object.values(moduleMocks).forEach((mock) => mock.mockReset());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('generalizes the fail-closed clock policy without breaking the Single export', () => {
        expect(canWriteLegacySimulationResults(DEMO_LEGACY_SIMULATION_CLOCK)).toBe(true);
        expect(canWriteLegacySimulationResults(DEMO_FIXED_SIMULATION_CLOCK)).toBe(false);
        expect(canWriteLegacySimulationResults('future-clock-v3')).toBe(false);
        expect(canWriteLegacySimulationResults(undefined)).toBe(false);

        expect(canWriteLegacySinglePlayerResults(DEMO_LEGACY_SIMULATION_CLOCK)).toBe(true);
        expect(canWriteLegacySinglePlayerResults(DEMO_FIXED_SIMULATION_CLOCK)).toBe(false);
    });

    it('invalidates synchronously and publishes one exact frozen stopped bundle', async () => {
        const { frameRateController, mode } = createMode();
        const session = await startSession(mode);
        const physics = createDeferred();
        session.gameState.animationId = 91;
        session.gameState.latestPhysicsPromise = physics.promise;
        session.gameState.isProcessingPhysics = true;
        frameRateController.isRunning = true;

        const firstStop = mode.onStop();
        const repeatedStop = mode.onStop();

        expect(repeatedStop).toBe(firstStop);
        expect(mode.isRunning).toBe(false);
        expect(session.gameState.isGameOver).toBe(true);
        expect(session.gameState.isStopped).toBe(true);
        expect(session.gameState.animationId).toBeNull();
        expect(cancelAnimationFrame).toHaveBeenCalledWith(91);
        expect(frameRateController.stopHybridLoop).toHaveBeenCalledOnce();

        physics.resolve();
        const stoppedSession = await firstStop;

        expect(Object.keys(stoppedSession).sort()).toEqual([
            'gameState',
            'generation',
            'simulationClock',
        ]);
        expect(stoppedSession).toEqual({
            gameState: session.gameState,
            generation: session.generation,
            simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        });
        expect(Object.isFrozen(stoppedSession)).toBe(true);
        expect(mode._stoppedSession).toBe(stoppedSession);
        expect(await mode.onStop()).toBe(stoppedSession);
    });

    it('serializes a replacement session behind captured physics teardown', async () => {
        const { mode } = createMode();
        const firstSession = await startSession(mode);
        const physics = createDeferred();
        firstSession.gameState.latestPhysicsPromise = physics.promise;
        firstSession.gameState.isProcessingPhysics = true;

        const stop = mode.onStop();
        const restart = mode.onStart();
        await Promise.resolve();

        expect(mode.gameState).toBe(firstSession.gameState);
        expect(mode._sessionGeneration).toBe(1);

        physics.resolve();
        const stoppedSession = await stop;
        await restart;

        expect(stoppedSession.gameState).toBe(firstSession.gameState);
        expect(firstSession.gameState.latestPhysicsPromise).toBeNull();
        expect(firstSession.gameState.isProcessingPhysics).toBe(false);
        expect(mode.gameState).not.toBe(firstSession.gameState);
        expect(mode._activeSession).toMatchObject({
            gameState: mode.gameState,
            generation: 2,
        });
    });

    it('drains captured physics before deactivation clears the state', async () => {
        const { mode } = createMode();
        const session = await startSession(mode);
        const physics = createDeferred();
        session.gameState.latestPhysicsPromise = physics.promise;
        session.gameState.isProcessingPhysics = true;

        const stop = mode.onStop();
        const deactivation = mode.onDeactivate();

        expect(mode.isActive).toBe(false);
        expect(mode.gameState).toBe(session.gameState);

        physics.resolve();
        const stoppedSession = await stop;
        await deactivation;

        expect(stoppedSession.gameState).toBe(session.gameState);
        expect(session.gameState.latestPhysicsPromise).toBeNull();
        expect(session.gameState.isProcessingPhysics).toBe(false);
        expect(mode.gameState).toBeNull();
        expect(await mode.onStop()).toBe(stoppedSession);
    });

    it('does not leave a zombie running flag when deactivation lands during base start', async () => {
        const { mode } = createMode();

        const start = mode.onStart();
        expect(mode.isRunning).toBe(true);
        const deactivate = mode.onDeactivate();

        await Promise.all([start, deactivate]);

        expect(mode.isActive).toBe(false);
        expect(mode.isRunning).toBe(false);
        expect(mode.gameState).toBeNull();
        expect(mode._activeSession).toBeNull();
        expect(mode._sessionGeneration).toBe(0);
    });

    it('fences every old physics write plus spawn/game-over callbacks by generation', async () => {
        const { highScoreManager, mode } = createMode();
        const firstSession = await startSession(mode);
        firstSession.gameState.hitStopRemaining = 0;
        firstSession.gameState.comboState.depth = 9;
        firstSession.gameState.comboState.complexity = 4;
        firstSession.gameState.infinityStats.maxComboDepth = 0;
        firstSession.gameState.infinityStats.maxComboComplexity = 0;
        const initialSpawn = moduleMocks.spawnPiece.mock.calls[0];
        const oldRefresh = initialSpawn[1];
        const oldGameOver = initialSpawn[2];
        const oldPhysicsCallbacks = mode._getPhysicsCallbacks();

        await mode.onStop();
        await mode.onStart();
        const replacementSession = mode._activeSession;
        const spawnCount = moduleMocks.spawnPiece.mock.calls.length;
        const refreshCount = mode._refreshNextQueue.mock.calls.length;

        oldRefresh();
        oldPhysicsCallbacks.onHardDrop({ distance: 8 });
        oldPhysicsCallbacks.onLineClear(4, null, null, [20, 21, 22, 23], 2);
        oldPhysicsCallbacks.onPerfectClear(2, 3500);
        oldPhysicsCallbacks.spawnPiece();
        await oldGameOver();

        expect(firstSession.generation).toBe(1);
        expect(replacementSession.generation).toBe(2);
        expect(moduleMocks.spawnPiece).toHaveBeenCalledTimes(spawnCount);
        expect(mode._refreshNextQueue).toHaveBeenCalledTimes(refreshCount);
        expect(highScoreManager.addScore).not.toHaveBeenCalled();
        expect(moduleMocks.showGameOverModal).not.toHaveBeenCalled();
        expect(firstSession.gameState.hitStopRemaining).toBe(0);
        expect(firstSession.gameState.infinityStats.maxComboDepth).toBe(0);
        expect(firstSession.gameState.infinityStats.maxComboComplexity).toBe(0);
        expect(replacementSession.gameState.hitStopRemaining).toBe(0);
        expect(replacementSession.gameState.infinityStats.maxComboDepth).toBe(0);
        expect(replacementSession.gameState.infinityStats.maxComboComplexity).toBe(0);
        expect(mode.lastDropWasHard).toBe(false);
        expect(mode.suppressFollowUntilLock).toBe(false);
        expect(mode.isRunning).toBe(true);
        expect(mode._activeSession).toBe(replacementSession);
    });

    it('preserves legacy local, Steam, modal, and event behavior', async () => {
        const { highScoreManager, mode } = createMode();
        const session = await startSession(mode);
        session.gameState.score = 4321;
        session.gameState.lines = 17;
        session.gameState.level = 4;
        session.gameState.currentTopRow = 23;
        session.gameState.infinityStats.maxComboDepth = 5;

        await mode._handleGameOver(session.generation);
        await vi.waitFor(() => expect(moduleMocks.uploadScore).toHaveBeenCalledTimes(3));

        const stoppedSession = mode._stoppedSession;
        expect(highScoreManager.addScore).toHaveBeenCalledWith({
            score: 4321,
            lines: 17,
            level: 4,
            mode: 'infinity',
        });
        expect(moduleMocks.incrementStat).toHaveBeenCalledTimes(3);
        expect(moduleMocks.setStatMax).toHaveBeenCalledTimes(2);
        expect(moduleMocks.showGameOverModal).toHaveBeenCalledWith(
            mode.deps.modalManager,
            stoppedSession.gameState,
            highScoreManager,
            expect.any(Object),
            expect.objectContaining({ includeLegacyResults: true }),
        );
        expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
            detail: {
                gameState: stoppedSession.gameState,
                infinityStats: stoppedSession.gameState.infinityStats,
                mode: 'infinity',
            },
            type: 'gameOver',
        }));
    });

    it.each([
        DEMO_FIXED_SIMULATION_CLOCK,
        'future-clock-v3',
    ])('shows %s as unranked and skips every legacy result sink', async (simulationClock) => {
        const { highScoreManager, mode } = createMode();
        const session = await startSession(mode, { simulationClock });
        session.gameState.score = 9876;
        session.gameState.lines = 31;
        session.gameState.level = 7;

        await mode._handleGameOver(session.generation);

        expect(highScoreManager.addScore).not.toHaveBeenCalled();
        expect(moduleMocks.uploadScore).not.toHaveBeenCalled();
        expect(moduleMocks.incrementStat).not.toHaveBeenCalled();
        expect(moduleMocks.setStatMax).not.toHaveBeenCalled();
        expect(moduleMocks.showGameOverModal).toHaveBeenCalledWith(
            mode.deps.modalManager,
            mode._stoppedSession.gameState,
            highScoreManager,
            expect.any(Object),
            expect.objectContaining({ includeLegacyResults: false }),
        );
        expect(window.dispatchEvent).toHaveBeenCalledOnce();

        await mode._syncSteamStats(mode._stoppedSession);
        expect(moduleMocks.uploadScore).not.toHaveBeenCalled();
        expect(moduleMocks.incrementStat).not.toHaveBeenCalled();
        expect(moduleMocks.setStatMax).not.toHaveBeenCalled();
    });

    it('keeps old persistence exact but suppresses stale UI after a restart', async () => {
        const { highScoreManager, mode } = createMode();
        const firstSession = await startSession(mode);
        const addScore = createDeferred();
        firstSession.gameState.score = 2468;
        firstSession.gameState.lines = 12;
        firstSession.gameState.level = 3;
        highScoreManager.addScore.mockImplementation(() => addScore.promise);

        const gameOver = mode._handleGameOver(firstSession.generation);
        await vi.waitFor(() => expect(highScoreManager.addScore).toHaveBeenCalledWith({
            score: 2468,
            lines: 12,
            level: 3,
            mode: 'infinity',
        }));

        await mode.onStart();
        const replacementSession = mode._activeSession;
        expect(replacementSession.gameState).not.toBe(firstSession.gameState);

        addScore.resolve();
        await gameOver;
        await vi.waitFor(() => expect(moduleMocks.uploadScore).toHaveBeenCalledTimes(3));

        expect(moduleMocks.uploadScore).toHaveBeenCalledWith(
            expect.any(String),
            2468,
            expect.objectContaining({ score: 2468 }),
        );
        expect(moduleMocks.showGameOverModal).not.toHaveBeenCalled();
        expect(window.dispatchEvent).not.toHaveBeenCalled();
        expect(mode.gameState).toBe(replacementSession.gameState);
        expect(mode.isRunning).toBe(true);
    });

    it('suppresses a stale modal action after a replacement session starts', async () => {
        const { mode } = createMode();
        const session = await startSession(mode);
        const modal = createDeferred();
        moduleMocks.showGameOverModal.mockImplementation(() => modal.promise);

        const gameOver = mode._handleGameOver(session.generation);
        await vi.waitFor(() => expect(moduleMocks.showGameOverModal).toHaveBeenCalledOnce());
        const modalCallbacks = moduleMocks.showGameOverModal.mock.calls[0][3];
        const modalPolicy = moduleMocks.showGameOverModal.mock.calls[0][4];

        await mode.onStart();
        const emit = vi.spyOn(eventBus, 'emit');
        expect(modalPolicy.shouldPresent()).toBe(false);

        modalCallbacks.onMainMenu();

        expect(emit).not.toHaveBeenCalledWith(EVENTS.EXIT_TO_MAIN_MENU);
        modal.resolve(true);
        await gameOver;
        expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('owns exploration pause/resume exactly once and fences delayed camera restore', async () => {
        vi.useFakeTimers();
        try {
            const { frameRateController, mode } = createMode();
            const session = await startSession(mode);
            const boardScene = {
                cameraSettings: { currentTopRow: 24, lerpSpeed: 0.08 },
                disableManualCameraControl: vi.fn(),
                enableManualCameraControl: vi.fn(),
                updateCameraPosition: vi.fn(),
            };
            mode.boardScene = boardScene;
            mode.usingHybridLoop = true;
            frameRateController.isRunning = true;
            mode._calculatePieceCameraPosition = vi.fn(() => 19);
            mode.cosmicExploration = {
                start: vi.fn(),
                stop: vi.fn(),
            };

            expect(await mode._beginMinimapExploration()).toBe(true);
            expect(await mode._beginMinimapExploration()).toBe(false);
            expect(mode.isPaused).toBe(true);
            expect(session.gameState.isPaused).toBe(true);
            expect(frameRateController.pauseHybridLoop).toHaveBeenCalledOnce();
            expect(boardScene.enableManualCameraControl).toHaveBeenCalledOnce();
            expect(mode.cosmicExploration.start).toHaveBeenCalledOnce();

            expect(mode._endMinimapExploration()).toBe(true);
            expect(mode._endMinimapExploration()).toBe(false);
            expect(mode.isPaused).toBe(false);
            expect(session.gameState.isPaused).toBe(false);
            expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
            expect(boardScene.disableManualCameraControl).toHaveBeenCalledOnce();
            expect(boardScene.updateCameraPosition).toHaveBeenCalledWith(19);
            expect(mode.cosmicExploration.stop).toHaveBeenCalledOnce();

            // A later exploration invalidates the first return timer, so it
            // cannot restore an obsolete lerp policy into the same scene.
            expect(await mode._beginMinimapExploration()).toBe(true);
            vi.advanceTimersByTime(400);
            expect(boardScene.cameraSettings.lerpSpeed).toBe(0.15);
            expect(frameRateController.pauseHybridLoop).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps an external pause layered over exploration until its matching resume', async () => {
        vi.useFakeTimers();
        try {
            const { frameRateController, mode } = createMode();
            const session = await startSession(mode);
            const boardScene = {
                cameraSettings: { currentTopRow: 24, lerpSpeed: 0.08 },
                disableManualCameraControl: vi.fn(),
                enableManualCameraControl: vi.fn(),
                updateCameraPosition: vi.fn(),
            };
            const cosmicExploration = {
                start: vi.fn(),
                stop: vi.fn(),
            };
            mode.boardScene = boardScene;
            mode.usingHybridLoop = true;
            frameRateController.isRunning = true;
            mode._calculatePieceCameraPosition = vi.fn(() => 19);
            mode.cosmicExploration = cosmicExploration;

            expect(await mode._beginMinimapExploration()).toBe(true);
            mode.onPause();

            expect(mode._endMinimapExploration()).toBe(true);
            expect(mode.isInExplorationMode).toBe(false);
            expect(mode.isPaused).toBe(true);
            expect(session.gameState.isPaused).toBe(true);
            expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
            expect(boardScene.disableManualCameraControl).toHaveBeenCalledOnce();
            expect(cosmicExploration.stop).toHaveBeenCalledOnce();

            mode.onResume();

            expect(mode.isPaused).toBe(false);
            expect(session.gameState.isPaused).toBe(false);
            expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
            expect(boardScene.disableManualCameraControl).toHaveBeenCalledOnce();
            expect(cosmicExploration.stop).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not let a delayed top-area snap mutate a replacement session scene', async () => {
        vi.useFakeTimers();
        try {
            const { mode } = createMode();
            await startSession(mode);
            const firstScene = {
                cameraSettings: { lerpSpeed: 0.08, visibleRows: 20 },
                updateCameraPosition: vi.fn(),
            };
            mode.boardScene = firstScene;
            mode._findHighestBlockRow = vi.fn(() => 10);

            mode._snapCameraToTopArea();

            expect(firstScene.cameraSettings.lerpSpeed).toBe(0.25);
            expect(firstScene.updateCameraPosition).toHaveBeenCalledOnce();

            await mode.onStop();
            await startSession(mode);
            const replacementScene = {
                cameraSettings: { lerpSpeed: 0.37, visibleRows: 20 },
                updateCameraPosition: vi.fn(),
            };
            mode.boardScene = replacementScene;

            vi.advanceTimersByTime(300);

            expect(replacementScene.cameraSettings.lerpSpeed).toBe(0.37);
            expect(firstScene.cameraSettings.lerpSpeed).toBe(0.25);
        } finally {
            vi.useRealTimers();
        }
    });

    it('restores legacy input wrappers on stop and keeps wheel cleanup session-local', async () => {
        const addEventListener = vi.fn();
        const removeEventListener = vi.fn();
        document.addEventListener = addEventListener;
        document.removeEventListener = removeEventListener;

        const originalMove = vi.fn();
        const originalRotate = vi.fn();
        window.move = originalMove;
        window.rotate = originalRotate;

        const { mode } = createMode();
        mode._initBoardJuice = vi.fn(() => {
            mode.boardJuice = {
                destroy: vi.fn(),
                disabled: false,
                nudge: vi.fn(),
                tilt: vi.fn(),
            };
        });
        await startSession(mode);
        const firstMoveWrapper = window.move;
        const firstRotateWrapper = window.rotate;
        InfinityMode.prototype._enableScrollExploration.call(mode);
        const firstWheelHandler = mode._wheelHandler;
        const staleWheelCleanup = mode.cleanupHandlers.at(-1);

        expect(firstMoveWrapper).not.toBe(originalMove);
        expect(firstRotateWrapper).not.toBe(originalRotate);
        expect(addEventListener).toHaveBeenCalledWith(
            'wheel',
            firstWheelHandler,
            { passive: false },
        );

        await mode.onStop();

        expect(window.move).toBe(originalMove);
        expect(window.rotate).toBe(originalRotate);
        expect(removeEventListener).toHaveBeenCalledWith('wheel', firstWheelHandler);
        expect(mode._wheelHandler).toBeNull();

        await startSession(mode);
        InfinityMode.prototype._enableScrollExploration.call(mode);
        const replacementWheelHandler = mode._wheelHandler;

        expect(replacementWheelHandler).not.toBe(firstWheelHandler);
        staleWheelCleanup();
        expect(mode._wheelHandler).toBe(replacementWheelHandler);
        expect(removeEventListener).toHaveBeenLastCalledWith('wheel', firstWheelHandler);
    });
});
