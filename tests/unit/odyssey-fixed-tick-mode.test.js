/* eslint-disable import/first */

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const moduleMocks = vi.hoisted(() => ({
    checkInfinityGameOver: vi.fn(() => false),
    gameLoop: vi.fn(),
    hardDrop: vi.fn(() => true),
    maintainInfinitySimulation: vi.fn((gameState) => ({
        gameOverTransitioned: false,
        rowCount: gameState.board.length,
        rowsAdded: 0,
    })),
    move: vi.fn(() => true),
    rotate: vi.fn(() => true),
    softDrop: vi.fn(() => true),
    updateGame: vi.fn(),
}));

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: function BoardJuice() {
        this.bounce = vi.fn();
        this.destroy = vi.fn();
        this.dip = vi.fn();
        this.nudge = vi.fn();
        this.pulse = vi.fn();
        this.tilt = vi.fn();
    },
}));

vi.mock('../../src/core/game.js', async (importOriginal) => ({
    ...await importOriginal(),
    gameLoop: moduleMocks.gameLoop,
    hardDrop: moduleMocks.hardDrop,
    move: moduleMocks.move,
    rotate: moduleMocks.rotate,
    softDrop: moduleMocks.softDrop,
    updateGame: moduleMocks.updateGame,
}));

vi.mock('../../src/core/infinity-grid.js', async (importOriginal) => ({
    ...await importOriginal(),
    checkInfinityGameOver: moduleMocks.checkInfinityGameOver,
}));

vi.mock('../../src/core/infinity-simulation-maintenance.js', () => ({
    maintainInfinitySimulation: moduleMocks.maintainInfinitySimulation,
}));

const { fillBag, GameState, spawnPiece } = await import('../../src/core/game.js');
const { FIXED_TICK_MS } = await import('../../src/core/fixed-tick-clock.js');
const {
    FIXED_HARD_DROP_HIT_STOP_MS,
    FIXED_LINE_IMPACT_HIT_STOP_MS,
    FIXED_PERFECT_CLEAR_HIT_STOP_MS,
} = await import('../../src/core/fixed-hit-stop-policy.js');
const {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} = await import('../../src/core/demo/DemoRecorder.js');
const {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
} = await import('../../src/core/infinity-spawn-policy.js');
const { GameplayHybridEngine } = await import('../../src/core/odyssey/GameplayHybridEngine.js');
const { OdysseyMode } = await import('../../src/core/game-modes/OdysseyMode.js');
const { default: steamService } = await import('../../src/core/steam/steam-service.js');
const { InputController } = await import('../../src/ui/controls.js');

function createInputController() {
    return {
        fixedTickInputAdapter: null,
        setFixedTickInputAdapter: vi.fn(function setFixedTickInputAdapter(adapter) {
            this.fixedTickInputAdapter = adapter;
        }),
        clearFixedTickInput: vi.fn(),
    };
}

function createFrameRateController(needsHybrid = false) {
    const callbacks = [];
    return {
        callbacks,
        isRunning: false,
        needsHybridMode: vi.fn(() => needsHybrid),
        pauseHybridLoop: vi.fn(),
        resumeHybridLoop: vi.fn(),
        startHybridLoop: vi.fn(function startHybridLoop(logic, render) {
            this.isRunning = true;
            callbacks.push({ logic, render });
        }),
        stopHybridLoop: vi.fn(function stopHybridLoop() {
            this.isRunning = false;
        }),
    };
}

function createHybridEngine() {
    const metrics = {
        cascades: 0,
        combos: 0,
        lines: 0,
        maxCascadeDepth: 0,
        tetrises: 0,
        time: 0,
    };
    return {
        buildPhysicsCallbacks: vi.fn((callbacks) => callbacks),
        checkFailure: vi.fn(() => false),
        checkVictory: vi.fn(() => false),
        getMetrics: vi.fn(() => metrics),
        updateScore: vi.fn(),
        updateTime: vi.fn((time) => {
            metrics.time = time;
        }),
    };
}

function createBoardScene() {
    return {
        cameraSettings: {
            manualControl: false,
        },
        playHardDropEffect: vi.fn(),
        playLineClearImpact: vi.fn(),
        sharedEffects: {
            getClearTier: vi.fn(() => ({ hitStop: 999 })),
            playPerfectClear: vi.fn(),
        },
        syncFromGameState: vi.fn(),
    };
}

function createLevelConfig({ baseMode = 'standard', id = 7, rows = 20 } = {}) {
    return {
        id,
        name: `Fixed Tick Test ${id}`,
        mechanics: {
            baseMode,
            board: { rows, startingRows: 0 },
            speed: { startLevel: 1 },
        },
        modifiers: { active: [] },
        stars: {},
        victory: { bonuses: [], primary: { target: 40, type: 'lines' } },
    };
}

function bindSession(mode, {
    fixed = false,
    gameState = null,
    generation = 1,
    hybridEngine = createHybridEngine(),
    levelConfig = createLevelConfig(),
    simulationClock = fixed
        ? DEMO_FIXED_SIMULATION_CLOCK
        : DEMO_LEGACY_SIMULATION_CLOCK,
} = {}) {
    const settings = mode.deps.settingsManager.get();
    const state = gameState || new GameState({
        hitStopEnabled: true,
        inputHandling: settings,
        isInfinityMode: levelConfig.mechanics.baseMode === 'infinity',
        maxRows: levelConfig.mechanics.board.rows,
    });
    const session = {
        gameState: state,
        generation,
        hybridEngine,
        levelConfig,
        levelId: levelConfig.id,
        physicsCallbacks: null,
        retired: false,
        retirementGeneration: null,
        simulationClock,
    };

    mode._activeLevelSession = session;
    mode._fixedTickEnabled = fixed;
    mode._levelSessionGeneration = generation;
    mode._physicsCallbacks = null;
    mode.currentLevelConfig = levelConfig;
    mode.currentLevelId = levelConfig.id;
    mode.gameState = state;
    mode.hybridEngine = hybridEngine;
    mode.isActive = true;
    mode.isInBoardView = false;
    mode.isRunning = true;
    mode.levelCompleting = false;
    return session;
}

function createMode({
    fixed = false,
    gamepadController = createInputController(),
    inputController = createInputController(),
    levelConfig = createLevelConfig(),
    needsHybrid = false,
    simulationClock,
} = {}) {
    const boardScene = createBoardScene();
    const frameRateController = createFrameRateController(needsHybrid);
    const settings = {
        dasDelay: 100,
        dasInterval: 40,
        reducedMotion: false,
        softDropInterval: 40,
    };
    const settingsManager = {
        get: vi.fn(() => settings),
    };
    const mode = new OdysseyMode({
        frameRateController,
        gamepadController,
        inputController,
        settingsManager,
        soundManager: {
            sfxPlayer: {
                playDrop: vi.fn(),
                playHardDrop: vi.fn(),
                playLineClear: vi.fn(),
                playMove: vi.fn(),
                playPerfectClear: vi.fn(),
                playRotate: vi.fn(),
            },
        },
    });
    const session = bindSession(mode, {
        fixed,
        levelConfig,
        simulationClock,
    });

    mode._getBoardScene = vi.fn(() => boardScene);
    mode._handleGameOver = vi.fn();
    mode._updateCameraPosition = vi.fn();
    mode._updateMinimap = vi.fn();
    mode._updateOdysseyHUD = vi.fn();
    mode._updateStats = vi.fn();

    return {
        boardScene,
        frameRateController,
        gamepadController,
        inputController,
        mode,
        session,
        settings,
        settingsManager,
    };
}

function resetActivationClock(mode) {
    mode._fixedTickEnabled = false;
    mode._activationSimulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
    mode._simulationClockLatched = false;
}

function prepareActivationLifecycle(mode) {
    mode._activeLevelSession = null;
    mode.gameState = null;
    mode.isActive = false;
    mode.isRunning = false;
    resetActivationClock(mode);

    mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
    mode._cancelBoardParkTimer = vi.fn();
    mode._captureBoardTrack = vi.fn();
    mode._cleanupEventListeners = vi.fn();
    mode._clearBoardReturnFallbackVeil = vi.fn();
    mode._clearDeferredWarpPreinit = vi.fn();
    mode._clearGameplayRevealState = vi.fn();
    mode._clearLevelStartCue = vi.fn();
    mode._clearLevelThemePrefetchTimer = vi.fn();
    mode._clearNeutralThemeFallbackBackdrop = vi.fn();
    mode._disposeOdysseyBoard = vi.fn();
    mode._hideOdysseyUI = vi.fn();
    mode._restoreInputs = vi.fn();
    mode._restoreTransitionMusicDuck = vi.fn();
    mode._retireLevelSession = vi.fn();
    mode._showBoardView = vi.fn().mockResolvedValue();
    mode._showOdysseyUI = vi.fn();
    mode._stopPhaserBoardScene = vi.fn();
    mode.journeyEntryTransition = { dispose: vi.fn() };
    mode.journeyReturnTransition = { dispose: vi.fn() };
    mode.odysseyState.endSession = vi.fn();
    mode.odysseyState.getOverallProgress = vi.fn(() => 0);
    mode.odysseyState.load = vi.fn();
    mode.odysseyState.save = vi.fn();
    mode.odysseyState.startSession = vi.fn();
}

describe('OdysseyMode fixed-tick loop adapter', () => {
    beforeEach(() => {
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            removeItem: vi.fn(),
            setItem: vi.fn(),
        });
        vi.stubGlobal('window', {
            location: { search: '' },
            localStorage: { getItem: vi.fn(() => null) },
            matchMedia: vi.fn(() => ({ matches: false })),
        });
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        moduleMocks.checkInfinityGameOver.mockReturnValue(false);
        moduleMocks.hardDrop.mockReturnValue(true);
        moduleMocks.maintainInfinitySimulation.mockImplementation((gameState) => ({
            gameOverTransitioned: false,
            rowCount: gameState.board.length,
            rowsAdded: 0,
        }));
        moduleMocks.move.mockReturnValue(true);
        moduleMocks.rotate.mockReturnValue(true);
        moduleMocks.softDrop.mockReturnValue(true);
    });

    afterEach(() => {
        Object.values(moduleMocks).forEach((mock) => mock.mockReset());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('latches fixedTick and its rules before publishing an Infinity-based attempt', () => {
        window.location.search = '?fixedTick=1';
        const { mode, settings } = createMode();
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });
        const flagAtGameStateCreation = [];
        const originalCreateGameState = GameplayHybridEngine.prototype.createGameState;
        vi.spyOn(GameplayHybridEngine.prototype, 'createGameState')
            .mockImplementation(function createGameState(...args) {
                flagAtGameStateCreation.push(mode._fixedTickEnabled);
                return originalCreateGameState.apply(this, args);
            });

        mode._createGameStateForLevel(levelConfig, 2, 0);

        expect(flagAtGameStateCreation).toEqual([true]);
        expect(mode._activeLevelSession).toMatchObject({
            gameState: mode.gameState,
            rngDescriptor: {
                algorithm: 'lcg-v1',
                seed: 0,
                stream: 'pieces:shared-v1',
            },
            simulationClock: DEMO_FIXED_SIMULATION_CLOCK,
        });
        expect(mode.gameState).toMatchObject({
            hitStopEnabled: true,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: mode.visibleRows,
            rngDescriptor: mode._activeLevelSession.rngDescriptor,
        });
        expect(mode.gameState.randomGenerator.seed).toBe(0);
        expect(mode.gameState.playerInput.config).toMatchObject({
            dasDelay: settings.dasDelay,
            dasInterval: settings.dasInterval,
            softDropInterval: settings.softDropInterval,
        });
    });

    it('falls back to the exact legacy clock when fixedTick has no FRC owner', () => {
        window.location.search = '?fixedTick=1';
        const {
            frameRateController, mode,
        } = createMode();
        delete frameRateController.startHybridLoop;
        resetActivationClock(mode);
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });

        mode._createGameStateForLevel(levelConfig, 2);
        const session = mode._activeLevelSession;
        mode._startGameLoop(session);

        expect(mode._fixedTickEnabled).toBe(false);
        expect(session.simulationClock).toBe(DEMO_LEGACY_SIMULATION_CLOCK);
        expect(session.gameState.infinitySpawnPolicy).not
            .toBe(INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1);
        expect(moduleMocks.gameLoop).toHaveBeenCalledOnce();
        expect(console.warn).toHaveBeenCalledWith(
            '[Odyssey] fixedTick requires FrameRateController; using legacy loop',
        );
    });

    it.each([
        ['fixed', '?fixedTick=1', '?fixedTick=0', DEMO_FIXED_SIMULATION_CLOCK, true],
        ['legacy', '?fixedTick=0', '?fixedTick=1', DEMO_LEGACY_SIMULATION_CLOCK, false],
    ])('retains one %s activation clock across retry and flag mutation', (
        _label,
        initialSearch,
        retrySearch,
        expectedClock,
        expectedFixed,
    ) => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });
        resetActivationClock(mode);
        window.location.search = initialSearch;

        mode._createGameStateForLevel(levelConfig, 2);
        const firstSession = mode._activeLevelSession;
        mode._retireLevelSession(firstSession);
        window.location.search = retrySearch;
        mode._createGameStateForLevel(levelConfig, 3);

        expect(firstSession.simulationClock).toBe(expectedClock);
        expect(mode._activeLevelSession.simulationClock).toBe(expectedClock);
        expect(mode._fixedTickEnabled).toBe(expectedFixed);
    });

    it('keeps the legacy HybridEngine createGameState call exactly argument-free', () => {
        window.location.search = '?fixedTick=0';
        const { mode } = createMode();
        const calls = [];
        const originalCreateGameState = GameplayHybridEngine.prototype.createGameState;
        vi.spyOn(GameplayHybridEngine.prototype, 'createGameState')
            .mockImplementation(function createGameState(...args) {
                calls.push(args);
                return originalCreateGameState.apply(this, args);
            });
        resetActivationClock(mode);

        mode._createGameStateForLevel(createLevelConfig(), 2);

        expect(calls).toEqual([[]]);
        expect(mode._activeLevelSession.simulationClock)
            .toBe(DEMO_LEGACY_SIMULATION_CLOCK);
    });

    it('limits HybridEngine supplements to deterministic clock and input policy', () => {
        const engine = new GameplayHybridEngine();
        engine.configure(createLevelConfig({ baseMode: 'infinity', rows: 40 }));
        const inputHandling = {
            dasDelay: 91,
            dasInterval: 37,
            softDropInterval: 29,
        };

        const gameState = engine.createGameState({
            cameraRow: 999,
            disableGarbage: false,
            hitStopEnabled: false,
            infinitySpawnOffsetRows: 99,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: 31,
            initialInfinityRows: 1,
            inputHandling,
            isInfinityMode: false,
            maxRows: 1,
            score: 999,
        });

        expect(gameState).toMatchObject({
            // Empty deterministic 44-row board, 31-row virtual viewport.
            // The malicious cameraRow=999 supplement was ignored.
            cameraRow: 13,
            disableGarbage: true,
            hitStopEnabled: false,
            infinitySpawnOffsetRows: 2,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: 31,
            isInfinityMode: true,
            maxRows: 40,
            score: 0,
        });
        expect(gameState.board).toHaveLength(44);
        expect(gameState.playerInput.config).toMatchObject(inputHandling);
    });

    it.each([0, 6, 16])(
        'matches the legacy tall-board first spawn with %i authored starting rows',
        (startingRows) => {
            window.location.search = '?fixedTick=1';
            const { mode } = createMode();
            const boardRows = 40;
            const levelConfig = createLevelConfig({
                baseMode: 'infinity',
                id: 70 + startingRows,
                rows: boardRows,
            });
            levelConfig.mechanics.board.startingRows = startingRows;
            resetActivationClock(mode);

            mode._createGameStateForLevel(levelConfig, 2);
            const { gameState } = mode._activeLevelSession;
            gameState.randomGenerator = () => 0.25;
            fillBag(gameState.nextPieces, gameState.randomGenerator);
            spawnPiece(gameState, null, null);

            const virtualVisibleRows = mode.visibleRows + startingRows;
            const legacyCameraRow = Math.max(
                0,
                boardRows + 4 - startingRows - mode.visibleRows,
            );
            expect(gameState.infinityVisibleRows).toBe(virtualVisibleRows);
            expect(gameState.cameraRow).toBe(legacyCameraRow);
            expect(gameState.cameraCenterRow)
                .toBe(legacyCameraRow + virtualVisibleRows / 2);
            expect(gameState.currentPiece?.y).toBe(Math.max(0, legacyCameraRow - 2));
        },
    );

    it('uses FrameRateController as the sole timer for a live fixed attempt', () => {
        const {
            frameRateController, mode, session,
        } = createMode({ fixed: true, needsHybrid: true });
        const intervalSpy = vi.spyOn(globalThis, 'setInterval');
        mode.levelPrepared = true;
        mode.levelRunStarted = false;
        mode.entryPhase = 'prepared';
        mode._hookInputs = vi.fn();

        expect(mode.beginLevelRun()).toBe(true);

        expect(intervalSpy).not.toHaveBeenCalled();
        expect(frameRateController.startHybridLoop).toHaveBeenCalledOnce();
        expect(frameRateController.needsHybridMode).not.toHaveBeenCalled();
        expect(moduleMocks.gameLoop).not.toHaveBeenCalled();
        expect(moduleMocks.updateGame).not.toHaveBeenCalled();
        expect(session.gameState.animationId).toBeNull();

        const { logic } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);
        expect(session.gameState.simFrame).toBe(1);
    });

    it('keeps fixed rendering observer-only', () => {
        const {
            boardScene, frameRateController, mode, session,
        } = createMode({ fixed: true, needsHybrid: true });
        const victorySpy = vi.spyOn(mode, '_checkVictoryConditions');

        mode._startGameLoop(session);
        const { render } = frameRateController.callbacks[0];
        render(100, 0.25);
        render(101, 0.75);

        expect(boardScene.syncFromGameState).toHaveBeenCalledTimes(2);
        expect(victorySpy).not.toHaveBeenCalled();
        expect(moduleMocks.checkInfinityGameOver).not.toHaveBeenCalled();
        expect(session.hybridEngine.updateTime).not.toHaveBeenCalled();
        expect(session.gameState.isGameOver).toBe(false);
        expect(session.gameState.simFrame).toBe(0);
    });

    it('does not project a Phaser tall-board camera into fixed simulation state', () => {
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });
        const {
            boardScene, frameRateController, mode, session,
        } = createMode({ fixed: true, levelConfig, needsHybrid: true });
        session.gameState.infinitySpawnPolicy = INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1;
        session.gameState.infinityVisibleRows = 26;
        session.gameState.cameraRow = 18;
        session.gameState.cameraCenterRow = 31;
        boardScene.cameraSettings.currentTopRow = 33;
        mode.isTallBoard = true;
        mode._updateCameraPosition.mockImplementation(() => {
            session.gameState.cameraRow = boardScene.cameraSettings.currentTopRow;
        });

        mode._startGameLoop(session);
        frameRateController.callbacks[0].render(100, 0.5);

        expect(mode._updateCameraPosition).not.toHaveBeenCalled();
        expect(session.gameState.cameraRow).toBe(18);
        expect(session.gameState.cameraCenterRow).toBe(31);
        expect(boardScene.cameraSettings.currentTopRow).toBe(33);
    });

    it('updates time, victory, and roof state only at a canonical stable boundary', () => {
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });
        const {
            frameRateController, mode, session,
        } = createMode({ fixed: true, levelConfig, needsHybrid: true });
        const victorySpy = vi.spyOn(mode, '_checkVictoryConditions');
        moduleMocks.maintainInfinitySimulation.mockImplementationOnce((gameState) => {
            gameState.isGameOver = true;
            return {
                gameOverTransitioned: true,
                rowCount: gameState.board.length,
                rowsAdded: 0,
            };
        });

        mode._startGameLoop(session);
        frameRateController.callbacks[0].logic(FIXED_TICK_MS * 3, FIXED_TICK_MS * 3);

        expect(session.gameState.simFrame).toBe(1);
        expect(session.hybridEngine.updateTime).toHaveBeenCalledOnce();
        expect(session.hybridEngine.updateTime)
            .toHaveBeenCalledWith(FIXED_TICK_MS / 1000);
        expect(victorySpy).toHaveBeenCalledOnce();
        expect(victorySpy).toHaveBeenCalledWith(session);
        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledOnce();
        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledWith(session.gameState);
        expect(session.gameState.isGameOver).toBe(true);
        expect(mode._handleGameOver).toHaveBeenCalledOnce();
        expect(mode._handleGameOver).toHaveBeenCalledWith(session);
    });

    it('advances canonical level rules during physics but defers roof maintenance', () => {
        const levelConfig = createLevelConfig({ baseMode: 'infinity', rows: 40 });
        const {
            frameRateController, mode, session,
        } = createMode({ fixed: true, levelConfig, needsHybrid: true });
        const victorySpy = vi.spyOn(mode, '_checkVictoryConditions');
        session.gameState.isProcessingPhysics = true;

        mode._startGameLoop(session);
        const { logic } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);

        expect(session.hybridEngine.updateTime)
            .toHaveBeenLastCalledWith(FIXED_TICK_MS / 1000);
        expect(victorySpy).toHaveBeenCalledOnce();
        expect(moduleMocks.maintainInfinitySimulation).not.toHaveBeenCalled();

        session.gameState.isProcessingPhysics = false;
        logic(FIXED_TICK_MS * 2, FIXED_TICK_MS);

        expect(session.hybridEngine.updateTime)
            .toHaveBeenLastCalledWith((FIXED_TICK_MS * 2) / 1000);
        expect(victorySpy).toHaveBeenCalledTimes(2);
        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledOnce();
    });

    it('stops a catch-up batch on the first canonical time failure', () => {
        const {
            frameRateController, mode, session,
        } = createMode({ fixed: true, needsHybrid: true });
        session.hybridEngine.checkFailure.mockReturnValue(true);
        mode.failLevel = vi.fn(() => {
            mode._retireLevelSession(session);
        });

        mode._startGameLoop(session);
        frameRateController.callbacks[0].logic(FIXED_TICK_MS * 3, FIXED_TICK_MS * 3);

        expect(session.gameState.simFrame).toBe(1);
        expect(mode.failLevel).toHaveBeenCalledOnce();
        expect(mode.failLevel).toHaveBeenCalledWith('time');
        expect(session.retired).toBe(true);
    });

    it('disposes both input owners and the runtime when fixed FRC start throws', () => {
        const inputController = new InputController();
        const gamepadController = createInputController();
        const {
            frameRateController, mode, session,
        } = createMode({
            fixed: true,
            gamepadController,
            inputController,
            needsHybrid: true,
        });
        frameRateController.startHybridLoop.mockImplementationOnce(function startHybridLoop() {
            this.isRunning = true;
            throw new Error('timer start failed');
        });

        expect(() => mode._startGameLoop(session)).toThrow('timer start failed');

        expect(frameRateController.stopHybridLoop).toHaveBeenCalledOnce();
        expect(frameRateController.isRunning).toBe(false);
        expect(mode._fixedTickRuntime.active).toBe(false);
        expect(mode._fixedTickOwnership).toBeNull();
        expect(mode._fixedTickInputBinding).toBeNull();
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });

    it('owns player 0 directly, mirrors movement, and stamps both drop commands', () => {
        const inputController = new InputController();
        const gamepadController = createInputController();
        const {
            frameRateController, mode, session,
        } = createMode({
            fixed: true,
            gamepadController,
            inputController,
            needsHybrid: true,
        });
        session.gameState.mirrorControls = true;

        mode._startGameLoop(session);
        expect(inputController.fixedTickInputAdapter.resolveGameState(0))
            .toBe(session.gameState);
        expect(inputController.fixedTickInputAdapter.resolveGameState(1)).toBeNull();

        const context = {
            gameState: session.gameState,
            physicsCallbacks: mode._getPhysicsCallbacks(session),
            playDropCallback: vi.fn(),
            session,
        };
        mode._applyFixedCommand({ action: 'move', value: 1 }, context);
        expect(moduleMocks.move).toHaveBeenCalledWith(
            session.gameState,
            -1,
            expect.any(Function),
            expect.any(Function),
        );

        mode._applyFixedCommand({ action: 'hardDrop' }, context);
        expect(moduleMocks.hardDrop).toHaveBeenCalledWith(
            session.gameState,
            context.playDropCallback,
            context.physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );

        mode._applyFixedCommand({ action: 'softDrop' }, context);
        expect(moduleMocks.softDrop).toHaveBeenCalledWith(
            session.gameState,
            context.playDropCallback,
            context.physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );

        mode._stopFixedTickSession();
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
        expect(frameRateController.isRunning).toBe(true);
    });

    it('uses pure fixed hit-stop independently of live settings and render tiers', () => {
        const {
            boardScene, mode, session, settings, settingsManager,
        } = createMode({ fixed: true });
        const callbacks = mode._getPhysicsCallbacks(session);
        settings.reducedMotion = true;
        settingsManager.get.mockClear();

        callbacks.onHardDrop({ distance: 8 });
        expect(session.gameState.hitStopRemaining).toBe(FIXED_HARD_DROP_HIT_STOP_MS);

        session.gameState.hitStopRemaining = 0;
        callbacks.onLineClearImpact(4, 1);
        expect(session.gameState.hitStopRemaining).toBe(FIXED_LINE_IMPACT_HIT_STOP_MS);

        session.gameState.hitStopRemaining = 0;
        callbacks.onPerfectClear(1, 3500);
        expect(session.gameState.hitStopRemaining).toBe(FIXED_PERFECT_CLEAR_HIT_STOP_MS);
        expect(settingsManager.get).not.toHaveBeenCalled();
        expect(boardScene.sharedEffects.getClearTier).not.toHaveBeenCalled();
    });

    it('discards paused wall time and resumes from canonical simulation time', () => {
        const {
            frameRateController, mode, session,
        } = createMode({ fixed: true, needsHybrid: true });
        const intervalSpy = vi.spyOn(globalThis, 'setInterval');

        mode._startGameLoop(session);
        const { logic } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);
        expect(session.gameState.simFrame).toBe(1);

        mode.onPause();
        logic(1000, 1000);
        expect(session.gameState.simFrame).toBe(1);
        expect(mode._fixedTickRuntime.accumulatorMs).toBeCloseTo(0, 8);
        expect(frameRateController.pauseHybridLoop).toHaveBeenCalledOnce();

        mode.onResume();
        expect(session.gameState.lastTime).toBe(session.gameState.simTimeMs);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
        expect(intervalSpy).not.toHaveBeenCalled();
        logic(1000 + FIXED_TICK_MS, FIXED_TICK_MS);
        expect(session.gameState.simFrame).toBe(2);
    });

    it('preserves the flag-off RAF callback contract', () => {
        const {
            frameRateController, mode, session,
        } = createMode();

        mode._startGameLoop(session);

        expect(moduleMocks.gameLoop).toHaveBeenCalledWith(
            expect.any(Number),
            session.gameState,
            expect.any(Function),
            expect.any(Function),
            expect.any(Function),
            expect.any(Object),
        );
        expect(frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(mode._fixedTickInputBinding).toBeNull();
    });

    it('preserves the flag-off hybrid callback and updateGame contract', () => {
        const {
            frameRateController, mode, session,
        } = createMode({ needsHybrid: true });

        mode._startGameLoop(session);
        const { logic, render } = frameRateController.callbacks[0];
        logic(123, 999);
        render();

        expect(logic).toHaveLength(2);
        expect(moduleMocks.updateGame).toHaveBeenCalledWith(123, session.gameState, {
            drawCallback: null,
            physicsCallbacks: expect.any(Object),
            playDropCallback: expect.any(Function),
            updateStatsCallback: null,
        });
        expect(mode._fixedTickInputBinding).toBeNull();
    });

    it.each([
        ['fixed', DEMO_FIXED_SIMULATION_CLOCK],
        ['unknown', 'future-sim-v9'],
    ])('keeps %s-clock completion out of legacy progress and Steam sinks', async (
        _label,
        simulationClock,
    ) => {
        const { mode, session } = createMode({
            fixed: simulationClock === DEMO_FIXED_SIMULATION_CLOCK,
            simulationClock,
        });
        mode.odysseyState.completeLevel = vi.fn();
        mode._calculateStars = vi.fn(() => 2);
        mode._evaluateBonuses = vi.fn(() => []);
        mode._syncSteamStats = vi.fn().mockResolvedValue();
        mode._showLevelResults = vi.fn().mockResolvedValue(true);
        mode.returnToBoard = vi.fn().mockResolvedValue();

        await mode.completeLevel({});

        expect(session.retired).toBe(true);
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
        expect(mode._syncSteamStats).not.toHaveBeenCalled();
        expect(mode._showLevelResults).toHaveBeenCalledOnce();
    });

    it.each([
        ['fixed', DEMO_FIXED_SIMULATION_CLOCK],
        ['unknown', 'future-sim-v9'],
    ])('keeps %s-clock failures out of the legacy attempt sink', async (
        _label,
        simulationClock,
    ) => {
        const { mode, session } = createMode({
            fixed: simulationClock === DEMO_FIXED_SIMULATION_CLOCK,
            simulationClock,
        });
        const modal = { remove: vi.fn() };
        mode.odysseyState.recordAttempt = vi.fn();
        mode._hideGoalCompleteOverlay = vi.fn();
        mode._removeVictoryLapInputs = vi.fn();
        mode._showLevelFailure = vi.fn().mockResolvedValue({ choice: 'map', modal });
        mode.returnToBoard = vi.fn().mockResolvedValue();

        await mode.failLevel('time');

        expect(session.retired).toBe(true);
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
        expect(mode._showLevelFailure).toHaveBeenCalledOnce();
    });

    it.each([
        ['fixed', DEMO_FIXED_SIMULATION_CLOCK],
        ['unknown', 'future-sim-v9'],
    ])('makes direct %s-clock Steam synchronization a no-op', async (
        _label,
        simulationClock,
    ) => {
        const { mode, session } = createMode({
            fixed: simulationClock === DEMO_FIXED_SIMULATION_CLOCK,
            simulationClock,
        });
        const uploadScore = vi.spyOn(steamService, 'uploadScore').mockResolvedValue();
        const incrementStat = vi.spyOn(steamService, 'incrementStat').mockResolvedValue();
        const setStat = vi.spyOn(steamService, 'setStat').mockResolvedValue();
        mode.odysseyState.getTotalStars = vi.fn(() => 99);

        await mode._syncSteamStats({
            lines: 40,
            score: 12000,
            stars: 3,
            time: 55,
        }, session);

        expect(mode.odysseyState.getTotalStars).not.toHaveBeenCalled();
        expect(uploadScore).not.toHaveBeenCalled();
        expect(incrementStat).not.toHaveBeenCalled();
        expect(setStat).not.toHaveBeenCalled();
    });

    it.each([
        ['fixed', '?fixedTick=1', false],
        ['legacy', '?fixedTick=0', true],
    ])('%s activation/deactivation applies the expected persistence policy', async (
        _label,
        search,
        writesLegacySession,
    ) => {
        window.location.search = search;
        const { mode } = createMode();
        prepareActivationLifecycle(mode);

        await mode.onActivate();
        await mode.onDeactivate();

        expect(mode.odysseyState.load).toHaveBeenCalledOnce();
        expect(mode.odysseyState.startSession).toHaveBeenCalledTimes(
            writesLegacySession ? 1 : 0,
        );
        expect(mode.odysseyState.endSession).toHaveBeenCalledTimes(
            writesLegacySession ? 1 : 0,
        );
        expect(mode.odysseyState.save).toHaveBeenCalledTimes(
            writesLegacySession ? 1 : 0,
        );
    });

    it('preserves legacy-clock Odyssey progress and Steam writes', async () => {
        const { mode } = createMode();
        mode.odysseyState.completeLevel = vi.fn();
        mode._calculateStars = vi.fn(() => 2);
        mode._evaluateBonuses = vi.fn(() => []);
        mode._syncSteamStats = vi.fn().mockResolvedValue();
        mode._showLevelResults = vi.fn().mockResolvedValue(true);
        mode.returnToBoard = vi.fn().mockResolvedValue();

        await mode.completeLevel({});

        expect(mode.odysseyState.completeLevel).toHaveBeenCalledOnce();
        expect(mode._syncSteamStats).toHaveBeenCalledOnce();
    });
});
