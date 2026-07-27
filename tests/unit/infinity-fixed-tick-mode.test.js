import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const moduleMocks = vi.hoisted(() => ({
    gameLoop: vi.fn(),
    hardDrop: vi.fn(() => true),
    maintainInfinitySimulation: vi.fn(),
    move: vi.fn(() => true),
    processAutoDrop: vi.fn(),
    rotate: vi.fn(() => true),
    softDrop: vi.fn(() => true),
    updateGame: vi.fn(),
}));

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: function BoardJuice() {},
}));

vi.mock('../../src/ui/infinity/InfinityMinimap.js', () => ({
    InfinityMinimap: function InfinityMinimap() {
        this.container = { addEventListener: vi.fn() };
        this.destroy = vi.fn();
        this.onPause = vi.fn();
        this.onUnpause = vi.fn();
        this.show = vi.fn();
        this.update = vi.fn();
    },
}));

vi.mock('../../src/ui/infinity/InfinityHUD.js', () => ({
    InfinityHUD: function InfinityHUD() {
        this.destroy = vi.fn();
        this.show = vi.fn();
        this.update = vi.fn();
    },
}));

vi.mock('../../src/core/game.js', async (importOriginal) => ({
    ...await importOriginal(),
    gameLoop: moduleMocks.gameLoop,
    hardDrop: moduleMocks.hardDrop,
    move: moduleMocks.move,
    processAutoDrop: moduleMocks.processAutoDrop,
    rotate: moduleMocks.rotate,
    softDrop: moduleMocks.softDrop,
    updateGame: moduleMocks.updateGame,
}));

vi.mock('../../src/core/infinity-simulation-maintenance.js', () => ({
    maintainInfinitySimulation: moduleMocks.maintainInfinitySimulation,
}));

const { GameState } = await import('../../src/core/game.js');
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
const { InfinityMode } = await import('../../src/core/game-modes/InfinityMode.js');
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
        startHybridLoop: vi.fn(function startHybridLoop(logic, render) {
            this.isRunning = true;
            callbacks.push({ logic, render });
        }),
        stopHybridLoop: vi.fn(function stopHybridLoop() {
            this.isRunning = false;
        }),
        pauseHybridLoop: vi.fn(),
        resumeHybridLoop: vi.fn(),
    };
}

function createBoardScene() {
    return {
        boardConfig: { blockSize: 30 },
        cameraSettings: {
            activeTopRow: 4,
            currentTopRow: 4,
            manualControl: false,
            targetTopRow: 6,
            visibleRows: 20,
        },
        cameras: { main: { centerOn: vi.fn() } },
        getBoardDimensions: vi.fn(() => ({ height: 600, width: 300 })),
        playHardDropEffect: vi.fn(),
        playLineClearImpact: vi.fn(),
        sharedEffects: {
            getClearTier: vi.fn(() => ({ hitStop: 999 })),
            playPerfectClear: vi.fn(),
        },
        syncFromGameState: vi.fn(),
        updateCameraBounds: vi.fn(),
        updateCameraPosition: vi.fn(),
    };
}

function createMode({
    fixed = false,
    inputController = createInputController(),
    gamepadController = createInputController(),
    needsHybrid = false,
} = {}) {
    const frameRateController = createFrameRateController(needsHybrid);
    const boardScene = createBoardScene();
    const settings = {
        dasDelay: 100,
        dasInterval: 40,
        effectQuality: 'high',
        reducedMotion: false,
        softDropInterval: 40,
    };
    const settingsManager = {
        get: vi.fn(() => settings),
    };
    const mode = new InfinityMode({
        frameRateController,
        gamepadController,
        highScoreManager: { addScore: vi.fn() },
        inputController,
        modalManager: {},
        phaserGame: null,
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
    const gameState = new GameState({
        hitStopEnabled: true,
        initialInfinityRows: 44,
        inputHandling: settings,
        isInfinityMode: true,
        maxRows: 64,
    });
    const simulationClock = fixed
        ? DEMO_FIXED_SIMULATION_CLOCK
        : DEMO_LEGACY_SIMULATION_CLOCK;
    const session = Object.freeze({
        gameState,
        generation: 1,
        simulationClock,
    });

    mode.boardScene = boardScene;
    mode.gameState = gameState;
    mode.isActive = true;
    mode.isRunning = true;
    mode._activeSession = session;
    mode._fixedTickEnabled = fixed;
    mode._sessionGeneration = session.generation;
    mode._sessionSimulationClock = simulationClock;

    const physicsCallbacks = {};
    mode.getPhysicsCallbacks = vi.fn(() => physicsCallbacks);
    mode._handleGameOver = vi.fn();
    mode._maybeExpandGrid = vi.fn();
    mode._updateCameraPosition = vi.fn();
    mode._updateMinimapView = vi.fn();
    mode._updateStats = vi.fn();

    return {
        boardScene,
        frameRateController,
        gamepadController,
        gameState,
        inputController,
        mode,
        physicsCallbacks,
        session,
        settings,
        settingsManager,
    };
}

function noMaintenance(gameState) {
    return {
        currentTopRow: gameState.currentTopRow,
        expanded: false,
        gameOver: false,
        gameOverTransitioned: false,
        previousRowCount: gameState.board.length,
        rowCount: gameState.board.length,
        rowsAdded: 0,
    };
}

describe('InfinityMode fixed-tick loop adapter', () => {
    beforeEach(() => {
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('window', {
            matchMedia: vi.fn(() => ({ matches: false })),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        moduleMocks.hardDrop.mockImplementation(() => true);
        moduleMocks.maintainInfinitySimulation.mockImplementation(noMaintenance);
        moduleMocks.move.mockImplementation(() => true);
        moduleMocks.rotate.mockImplementation(() => true);
        moduleMocks.softDrop.mockImplementation(() => true);
    });

    afterEach(() => {
        Object.values(moduleMocks).forEach((mock) => mock.mockReset());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses FrameRateController as the sole fixed timer and never enters a legacy game loop', () => {
        const {
            frameRateController, gameState, mode,
        } = createMode({ fixed: true });

        mode._startGameLoop();
        const { logic } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);

        expect(frameRateController.startHybridLoop).toHaveBeenCalledOnce();
        expect(frameRateController.needsHybridMode).not.toHaveBeenCalled();
        expect(moduleMocks.gameLoop).not.toHaveBeenCalled();
        expect(moduleMocks.updateGame).not.toHaveBeenCalled();
        expect(gameState.animationId).toBeNull();
        expect(gameState.simFrame).toBe(1);
    });

    it('retires a partially installed fixed owner when the timer start throws', () => {
        const {
            frameRateController, gamepadController, inputController, mode,
        } = createMode({ fixed: true });
        frameRateController.startHybridLoop.mockImplementationOnce(function startHybridLoop() {
            this.isRunning = true;
            throw new Error('timer start failed');
        });

        expect(() => mode._startGameLoop()).toThrow('timer start failed');

        expect(frameRateController.stopHybridLoop).toHaveBeenCalledOnce();
        expect(frameRateController.isRunning).toBe(false);
        expect(mode.usingHybridLoop).toBe(false);
        expect(mode._fixedTickRuntime.active).toBe(false);
        expect(mode._fixedTickOwnership).toBeNull();
        expect(mode._fixedTickInputBinding).toBeNull();
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });

    it('latches the URL flag and fixed Infinity rules before publishing the session', async () => {
        vi.stubGlobal('window', {
            location: { search: '?fixedTick=1' },
            localStorage: { getItem: vi.fn(() => null) },
            matchMedia: vi.fn(() => ({ matches: true })),
            move: vi.fn(),
            rotate: vi.fn(),
        });
        const {
            frameRateController, gamepadController, inputController, mode, settings,
        } = createMode();
        settings.reducedMotion = false;
        mode.gameState = null;
        mode.isRunning = false;
        mode._activeSession = null;
        mode._sessionGeneration = 0;
        mode._preparePhaserScene = vi.fn(() => {
            mode.boardScene = null;
            mode.physicsCallbacks = null;
        });
        mode._initBoardJuice = vi.fn();
        mode._disableGamepadExploration = vi.fn();
        mode._enableGamepadExploration = vi.fn();
        mode._enableScrollExploration = vi.fn();
        mode._refreshNextQueue = vi.fn();
        mode._updateStats = vi.fn();

        await mode.onStart({ seed: 0 });

        expect(mode._fixedTickEnabled).toBe(true);
        expect(mode._activeSession).toMatchObject({
            gameState: mode.gameState,
            rngDescriptor: {
                algorithm: 'lcg-v1',
                seed: 0,
                stream: 'pieces:shared-v1',
            },
            simulationClock: DEMO_FIXED_SIMULATION_CLOCK,
        });
        expect(mode.gameState).toMatchObject({
            hitStopEnabled: false,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: mode.visibleRows,
            randomGenerator: expect.any(Function),
            rngDescriptor: mode._activeSession.rngDescriptor,
        });
        expect(mode.gameState.randomGenerator.seed).toBe(0);
        expect(mode.gameState.playerInput.config).toMatchObject({
            dasDelay: settings.dasDelay,
            dasInterval: settings.dasInterval,
            softDropInterval: settings.softDropInterval,
        });
        expect(frameRateController.startHybridLoop).toHaveBeenCalledOnce();
        expect(inputController.fixedTickInputAdapter).not.toBeNull();
        expect(gamepadController.fixedTickInputAdapter).not.toBeNull();
        expect(mode._legacyBoardJuiceInputOwner).toBeNull();

        const descriptor = mode._activeSession.rngDescriptor;
        const stoppedSession = await mode.onStop();
        expect(stoppedSession.rngDescriptor).toBe(descriptor);
        expect(mode._stoppedSession.rngDescriptor).toBe(descriptor);
    });

    it('keeps fixed rendering observer-only and runs no Infinity maintenance writes', () => {
        const {
            boardScene, frameRateController, gameState, mode,
        } = createMode({ fixed: true });
        gameState.currentTopRow = 37;
        const initialRows = gameState.board.length;

        mode._startGameLoop();
        const { render } = frameRateController.callbacks[0];
        render(123, 0.5);
        render(124, 0.75);

        expect(boardScene.syncFromGameState).toHaveBeenCalledTimes(2);
        expect(mode._maybeExpandGrid).not.toHaveBeenCalled();
        expect(moduleMocks.maintainInfinitySimulation).not.toHaveBeenCalled();
        expect(mode._handleGameOver).not.toHaveBeenCalled();
        expect(gameState.currentTopRow).toBe(37);
        expect(gameState.board).toHaveLength(initialRows);
    });

    it('runs maintenance only after completed stable ticks', () => {
        const {
            frameRateController, gameState, mode,
        } = createMode({ fixed: true });
        const maintenanceFrames = [];
        moduleMocks.maintainInfinitySimulation.mockImplementation((state) => {
            maintenanceFrames.push(state.simFrame);
            return noMaintenance(state);
        });

        mode._startGameLoop();
        const { logic, render } = frameRateController.callbacks[0];
        render(1, 0);
        logic(FIXED_TICK_MS / 2, FIXED_TICK_MS / 2);
        expect(moduleMocks.maintainInfinitySimulation).not.toHaveBeenCalled();

        gameState.isProcessingPhysics = true;
        logic(FIXED_TICK_MS, FIXED_TICK_MS);
        expect(gameState.simFrame).toBe(1);
        expect(moduleMocks.maintainInfinitySimulation).not.toHaveBeenCalled();

        gameState.isProcessingPhysics = false;
        logic(FIXED_TICK_MS * 2, FIXED_TICK_MS);

        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledOnce();
        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledWith(gameState);
        expect(maintenanceFrames).toEqual([2]);
    });

    it('applies expansion camera compensation and roof game-over handoff once after a tick', () => {
        const {
            boardScene, frameRateController, mode, session,
        } = createMode({ fixed: true });
        moduleMocks.maintainInfinitySimulation.mockReturnValueOnce({
            currentTopRow: 14,
            expanded: true,
            gameOver: true,
            gameOverTransitioned: true,
            previousRowCount: 44,
            rowCount: 54,
            rowsAdded: 10,
        });

        mode._startGameLoop();
        const { logic, render } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);
        render(100, 0);
        render(101, 0.5);

        expect(boardScene.cameraSettings).toMatchObject({
            activeTopRow: 14,
            currentTopRow: 14,
            targetTopRow: 16,
        });
        expect(boardScene.updateCameraBounds).toHaveBeenCalledOnce();
        expect(boardScene.cameras.main.centerOn).toHaveBeenCalledOnce();
        expect(boardScene.cameras.main.centerOn).toHaveBeenCalledWith(150, 720);
        expect(mode._handleGameOver).toHaveBeenCalledOnce();
        expect(mode._handleGameOver).toHaveBeenCalledWith(session.generation);
    });

    it('stops a catch-up batch after the first roof transition', () => {
        const {
            frameRateController, gameState, mode,
        } = createMode({ fixed: true });
        moduleMocks.maintainInfinitySimulation.mockImplementationOnce((state) => {
            state.isGameOver = true;
            return {
                ...noMaintenance(state),
                gameOver: true,
                gameOverTransitioned: true,
            };
        });

        mode._startGameLoop();
        frameRateController.callbacks[0].logic(FIXED_TICK_MS * 3, FIXED_TICK_MS * 3);

        expect(gameState.simFrame).toBe(1);
        expect(moduleMocks.maintainInfinitySimulation).toHaveBeenCalledOnce();
        expect(mode._handleGameOver).toHaveBeenCalledOnce();
    });

    it('routes real keyboard input through the owned adapter and cleans up both owners', () => {
        const inputController = new InputController();
        const gamepadController = createInputController();
        const {
            frameRateController, gameState, mode, physicsCallbacks,
        } = createMode({
            fixed: true,
            gamepadController,
            inputController,
        });

        mode._startGameLoop();
        const keyboardAdapter = inputController.fixedTickInputAdapter;
        const gamepadAdapter = gamepadController.fixedTickInputAdapter;
        expect(keyboardAdapter).not.toBeNull();
        expect(gamepadAdapter).not.toBeNull();

        expect(inputController.enqueueFixedTickAction({
            event: { repeat: false },
            keyMapKey: 'Space',
            logicalAction: 'hardDrop',
            physicalKey: 'Space',
            playerIndex: 0,
        })).toEqual({ accepted: true, handled: true });
        expect(gamepadAdapter.acceptSource()).toBe(false);

        frameRateController.callbacks[0].logic(FIXED_TICK_MS, FIXED_TICK_MS);

        expect(moduleMocks.hardDrop).toHaveBeenCalledWith(
            gameState,
            expect.any(Function),
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
        expect(gameState.playerInput.pendingEdges).toEqual([]);

        mode._stopGameLoop(gameState);
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
        expect(mode._fixedTickRuntime.active).toBe(false);
        expect(keyboardAdapter.isEnabled({ playerIndex: 0, gameState })).toBe(false);
        expect(gamepadAdapter.isEnabled({ playerIndex: 0, gameState })).toBe(false);
    });

    it('discards paused wall time and resumes from the canonical clock', () => {
        const {
            frameRateController, gameState, inputController, mode,
        } = createMode({ fixed: true });

        mode._startGameLoop();
        const { logic } = frameRateController.callbacks[0];
        logic(FIXED_TICK_MS, FIXED_TICK_MS);
        expect(gameState.simFrame).toBe(1);

        inputController.fixedTickInputAdapter.acceptSource();
        mode.onPause();
        logic(1000, 1000);
        expect(gameState.simFrame).toBe(1);
        expect(mode._fixedTickRuntime.accumulatorMs).toBeCloseTo(0, 8);
        expect(frameRateController.pauseHybridLoop).toHaveBeenCalledOnce();

        mode.onResume();
        expect(gameState.lastTime).toBe(gameState.simTimeMs);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
        logic(1000 + FIXED_TICK_MS, FIXED_TICK_MS);
        expect(gameState.simFrame).toBe(2);
    });

    it('passes fixed input-phase timing to both canonical drop functions', () => {
        const {
            gameState, mode, physicsCallbacks, session,
        } = createMode({ fixed: true });
        const playDropCallback = vi.fn();
        const context = {
            gameState,
            physicsCallbacks,
            playDropCallback,
            session,
        };

        mode._applyFixedCommand({ action: 'hardDrop' }, context);
        expect(moduleMocks.hardDrop).toHaveBeenLastCalledWith(
            gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );

        mode._applyFixedCommand({ action: 'softDrop' }, context);
        expect(moduleMocks.softDrop).toHaveBeenLastCalledWith(
            gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
    });

    it('defers only bounded movement commands while async physics owns the board', () => {
        const {
            gameState, mode, physicsCallbacks, session,
        } = createMode({ fixed: true });
        const context = {
            gameState,
            physicsCallbacks,
            playDropCallback: vi.fn(),
            session,
        };
        gameState.isProcessingPhysics = true;

        expect(mode._applyFixedCommand({ action: 'move', value: -1 }, context))
            .toBe('deferred_physics');
        expect(mode._applyFixedCommand({ action: 'rotate', value: 'right' }, context))
            .toBe('deferred_physics');
        expect(mode._applyFixedCommand({ action: 'hardDrop' }, context))
            .toBe('rejected_physics');
        expect(gameState.inputQueue).toEqual([
            { dir: -1, type: 'move' },
            { dir: 'right', type: 'rotate' },
        ]);
        expect(moduleMocks.hardDrop).not.toHaveBeenCalled();

        gameState.inputQueue.push(
            { dir: 1, type: 'move' },
            { dir: 'left', type: 'rotate' },
        );
        expect(mode._applyFixedCommand({ action: 'move', value: 1 }, context))
            .toBe('rejected_physics');
        expect(gameState.inputQueue).toHaveLength(4);
    });

    it('preserves the flag-off RAF callback contract without fixed adapters', () => {
        const {
            frameRateController, gameState, gamepadController, inputController, mode,
            physicsCallbacks,
        } = createMode();

        mode._startGameLoop();

        expect(moduleMocks.gameLoop).toHaveBeenCalledWith(
            expect.any(Number),
            gameState,
            expect.any(Function),
            expect.any(Function),
            expect.any(Function),
            physicsCallbacks,
        );
        expect(frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(inputController.setFixedTickInputAdapter).not.toHaveBeenCalled();
        expect(gamepadController.setFixedTickInputAdapter).not.toHaveBeenCalled();
        expect(mode._fixedTickRuntime.active).toBe(false);
    });

    it('preserves the flag-off hybrid callback and updateGame contract', () => {
        const {
            frameRateController, gameState, gamepadController, inputController, mode,
            physicsCallbacks,
        } = createMode({ needsHybrid: true });

        mode._startGameLoop();
        const { logic, render } = frameRateController.callbacks[0];

        expect(logic).toHaveLength(2);
        expect(render).toHaveLength(0);
        logic(123, 999);
        expect(moduleMocks.updateGame).toHaveBeenCalledWith(123, gameState, {
            drawCallback: null,
            physicsCallbacks,
            playDropCallback: expect.any(Function),
            updateStatsCallback: null,
        });
        render();
        expect(mode._maybeExpandGrid).toHaveBeenCalledOnce();
        expect(inputController.setFixedTickInputAdapter).not.toHaveBeenCalled();
        expect(gamepadController.setFixedTickInputAdapter).not.toHaveBeenCalled();
    });

    it('uses captured fixed hit-stop policy independently of live settings and scene tiers', () => {
        const {
            boardScene, gameState, mode, settings, settingsManager,
        } = createMode({ fixed: true });
        mode.physicsCallbacks = null;
        const callbacks = mode._getPhysicsCallbacks();
        settings.reducedMotion = true;
        settingsManager.get.mockClear();

        callbacks.onHardDrop({ distance: 8 });
        expect(gameState.hitStopRemaining).toBe(FIXED_HARD_DROP_HIT_STOP_MS);

        gameState.hitStopRemaining = 0;
        callbacks.onLineClearImpact(4, 1);
        expect(gameState.hitStopRemaining).toBe(FIXED_LINE_IMPACT_HIT_STOP_MS);

        gameState.hitStopRemaining = 0;
        callbacks.onPerfectClear(1, 3500);
        expect(gameState.hitStopRemaining).toBe(FIXED_PERFECT_CLEAR_HIT_STOP_MS);
        expect(settingsManager.get).not.toHaveBeenCalled();
        expect(boardScene.sharedEffects.getClearTier).not.toHaveBeenCalled();
    });
});

describe('InfinityMode on-screen lock origin (theme reaction placement)', () => {
    // Exercise the pure camera-window arithmetic directly on the prototype — no full mode
    // construction required. This is the emit-side mapping that turns an absolute grid row
    // into the ON-SCREEN normalized origin themes place lock effects at.
    const origin = (ctx, piece) => InfinityMode.prototype._pieceLockViewportOrigin.call(ctx, piece);
    const tPiece = (x, y) => ({ shape: [[1, 1, 1], [0, 1, 0]], x, y });

    it('maps an absolute grid row to its on-screen position via the camera window', () => {
        const ctx = {
            visibleRows: 20,
            boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 90 } },
        };
        // centroidRow = 100 + mean(row∈{0,0,0,1}) + 0.5 = 100.75 → (100.75-90)/20 = 0.5375
        // centroidCol = 3 + mean(col∈{0,1,2,1}) + 0.5 = 4.5 → 4.5/10 = 0.45
        expect(origin(ctx, tPiece(3, 100))).toEqual({ x: 0.45, y: 0.5375 });
    });

    it('tracks the scroll: the same piece row reads higher when the camera has scrolled up', () => {
        const near = origin(
            { visibleRows: 20, boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 98 } } },
            tPiece(3, 100),
        );
        const far = origin(
            { visibleRows: 20, boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 90 } } },
            tPiece(3, 100),
        );
        expect(near.y).toBeLessThan(far.y); // closer to the viewport top when camera trails it
    });

    it('prefers activeTopRow, then currentTopRow, then the gameState camera mirror', () => {
        expect(origin({
            visibleRows: 20,
            gameState: { cameraRow: 40 },
            boardScene: { cameraSettings: { visibleRows: 20, currentTopRow: 95 } },
        }, tPiece(3, 100)).y).toBeCloseTo((100.75 - 95) / 20);
        expect(origin({
            visibleRows: 20,
            gameState: { cameraRow: 90 },
            boardScene: { cameraSettings: { visibleRows: 20 } },
        }, tPiece(3, 100)).y).toBeCloseTo((100.75 - 90) / 20);
    });

    it('clamps to [0,1] and returns undefined without a usable piece', () => {
        const ctx = { visibleRows: 20, boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 0 } } };
        expect(origin(ctx, tPiece(3, 1000)).y).toBe(1); // far below the window
        expect(origin(ctx, null)).toBeUndefined();
        expect(origin(ctx, { x: 3, y: 5 })).toBeUndefined(); // no shape
        expect(origin(ctx, { shape: [[0, 0]], x: 3, y: 5 })).toBeUndefined(); // no filled cells
    });

    // Line-clear origin: cleared rows' mean row mapped through the same camera window.
    const clearOrigin = (ctx, rows) => InfinityMode.prototype._lineClearViewportOrigin.call(ctx, rows);

    it('maps cleared rows to a horizontally centered on-screen origin', () => {
        const ctx = { visibleRows: 20, boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 90 } } };
        // meanRow = mean(100,102) + 0.5 = 101.5 → (101.5 - 90)/20 = 0.575; x centered.
        expect(clearOrigin(ctx, [100, 102])).toEqual({ x: 0.5, y: 0.575 });
    });

    it('returns undefined for empty/absent cleared rows', () => {
        const ctx = { visibleRows: 20, boardScene: { cameraSettings: { visibleRows: 20, activeTopRow: 90 } } };
        expect(clearOrigin(ctx, [])).toBeUndefined();
        expect(clearOrigin(ctx, undefined)).toBeUndefined();
        expect(clearOrigin(ctx, ['x', null])).toBeUndefined(); // no finite rows
    });
});
