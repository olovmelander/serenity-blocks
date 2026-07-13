import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

const moduleMocks = vi.hoisted(() => ({
    gameLoop: vi.fn(),
    hardDrop: vi.fn(() => true),
    softDrop: vi.fn(() => true),
    updateGame: vi.fn(),
}));

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));
vi.mock('../../src/core/game.js', async () => ({
    ...await vi.importActual('../../src/core/game.js'),
    gameLoop: moduleMocks.gameLoop,
    hardDrop: moduleMocks.hardDrop,
    softDrop: moduleMocks.softDrop,
    updateGame: moduleMocks.updateGame,
}));

const {
    GameState, fillBag, spawnPiece,
} = await import('../../src/core/game.js');
const { FIXED_TICK_MS } = await import('../../src/core/fixed-tick-clock.js');
const {
    DEMO_FIXED_CLOCK_VERSION,
    DEMO_FIXED_SIMULATION_CLOCK,
} = await import('../../src/core/demo/DemoRecorder.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');
const { InputController } = await import('../../src/ui/controls.js');
const { GamepadController } = await import('../../src/ui/gamepad-controller.js');

function createController() {
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

function createMode({ needsHybrid = false } = {}) {
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
    const inputController = createController();
    const gamepadController = createController();
    const frameRateController = createFrameRateController(needsHybrid);
    const physicsCallbacks = {};
    const settings = {
        backgroundMode: 'Static',
        dasDelay: 100,
        dasInterval: 40,
        effectQuality: 'high',
        hitStopEnabled: true,
        softDropInterval: 40,
    };
    const mode = new SinglePlayerMode({
        frameRateController,
        gamepadController,
        inputController,
        settingsManager: { get: () => settings },
        soundManager: {
            sfxPlayer: {
                playDrop: vi.fn(),
                playMove: vi.fn(),
                playRotate: vi.fn(),
            },
        },
        themeManager: {
            activeThemeName: 'Static',
            getThemeForLevel: vi.fn(() => 'Static'),
            switchTheme: vi.fn(),
        },
    });
    mode.gameState = new GameState({ inputHandling: settings });
    mode.isActive = true;
    mode.isRunning = true;
    mode._getBoardScene = vi.fn(() => null);
    mode._getPhysicsCallbacks = vi.fn(() => physicsCallbacks);
    return {
        frameRateController,
        gamepadController,
        inputController,
        mode,
        physicsCallbacks,
        settings,
    };
}

describe('SinglePlayerMode fixed-tick loop adapter', () => {
    afterEach(() => {
        Object.values(moduleMocks).forEach((mock) => mock.mockClear());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses one generation-bound FrameRateController owner across pause and restart', () => {
        const {
            frameRateController, gamepadController, inputController, mode,
        } = createMode();
        mode._fixedTickEnabled = true;
        const firstState = mode.gameState;

        mode._startGameLoop();
        const firstCallbacks = frameRateController.callbacks[0];

        expect(frameRateController.needsHybridMode).not.toHaveBeenCalled();
        expect(inputController.fixedTickInputAdapter).not.toBeNull();
        expect(gamepadController.fixedTickInputAdapter).not.toBeNull();
        firstCallbacks.logic(100, FIXED_TICK_MS);
        expect(firstState.simFrame).toBe(1);

        mode.onPause();
        firstCallbacks.logic(1100, 1000);
        expect(firstState.simFrame).toBe(1);
        expect(mode._fixedTickRuntime.accumulatorMs).toBeCloseTo(0, 8);
        mode.onResume();
        expect(firstState.lastTime).toBe(firstState.simTimeMs);
        firstCallbacks.logic(1200, FIXED_TICK_MS);
        expect(firstState.simFrame).toBe(2);

        mode._stopGameLoop();
        const secondState = new GameState();
        mode.gameState = secondState;
        mode._fixedTickEnabled = true;
        mode._startGameLoop();
        const secondCallbacks = frameRateController.callbacks[1];

        firstCallbacks.logic(1300, 1000);
        expect(firstState.simFrame).toBe(2);
        expect(secondState.simFrame).toBe(0);
        expect(mode._fixedTickRuntime.accumulatorMs).toBe(0);

        secondCallbacks.logic(1400, FIXED_TICK_MS);
        expect(secondState.simFrame).toBe(1);

        mode._getBoardScene.mockClear();
        mode.gameState = new GameState();
        firstCallbacks.render(1500, 0);
        expect(mode._getBoardScene).not.toHaveBeenCalled();
    });

    it('drains an installed keyboard edge and held DAS repeat on their simulation frames', () => {
        const {
            frameRateController, mode,
        } = createMode();
        const inputController = new InputController();
        mode.deps.inputController = inputController;
        mode._fixedTickEnabled = true;
        fillBag(mode.gameState.nextPieces, () => 0.5);
        spawnPiece(mode.gameState);
        const startingX = mode.gameState.currentPiece.x;
        const appliedFrames = [];
        const applyCommand = mode._applyCommand.bind(mode);
        vi.spyOn(mode, '_applyCommand').mockImplementation((...args) => {
            appliedFrames.push(mode.gameState.simFrame);
            return applyCommand(...args);
        });

        mode._startGameLoop();
        expect(inputController.enqueueFixedTickAction({
            playerIndex: 0,
            logicalAction: 'moveLeft',
            physicalKey: 'ArrowLeft',
            event: { repeat: false },
            keyMapKey: 'ArrowLeft',
        })).toEqual({ handled: true, accepted: true });

        const { logic } = frameRateController.callbacks[0];
        for (let tick = 1; tick <= 6; tick += 1) {
            logic(tick * FIXED_TICK_MS, FIXED_TICK_MS);
        }

        expect(mode.gameState.simFrame).toBe(6);
        expect(appliedFrames).toEqual([1, 6]);
        expect(mode.gameState.currentPiece.x).toBe(startingX - 2);
        expect(mode.gameState.playerInput.pendingEdges).toEqual([]);
    });

    it('drains an edge from the real GamepadController through the mode binding', () => {
        const {
            frameRateController, mode,
        } = createMode();
        const gamepadController = new GamepadController();
        const legacyMove = vi.fn();
        gamepadController.setGameActions({
            move: legacyMove,
            rotate: vi.fn(),
            softDrop: vi.fn(),
            hardDrop: vi.fn(),
            togglePause: vi.fn(),
        });
        mode.deps.gamepadController = gamepadController;
        mode._fixedTickEnabled = true;
        fillBag(mode.gameState.nextPieces, () => 0.5);
        spawnPiece(mode.gameState);
        const startingX = mode.gameState.currentPiece.x;
        const gamepad = {
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
            axes: [0, 0, 0, 0],
        };

        mode._startGameLoop();
        gamepad.buttons[14].pressed = true;
        gamepadController.processGamepadInput(gamepad, 0);

        expect(mode.gameState.playerInput.pendingEdges).toEqual([
            expect.objectContaining({
                tick: 1, action: 'move', value: -1, phase: 'down',
            }),
        ]);
        frameRateController.callbacks[0].logic(FIXED_TICK_MS, FIXED_TICK_MS);
        expect(mode.gameState.currentPiece.x).toBe(startingX - 1);
        expect(mode.gameState.playerInput.pendingEdges).toEqual([]);
        expect(legacyMove).not.toHaveBeenCalled();
    });

    it('cleans up a partially started hybrid owner before rethrowing', () => {
        const {
            frameRateController, gamepadController, inputController, mode,
        } = createMode();
        mode._fixedTickEnabled = true;
        frameRateController.startHybridLoop.mockImplementationOnce(function startHybridLoop() {
            this.isRunning = true;
            throw new Error('start failed');
        });

        expect(() => mode._startGameLoop()).toThrow('start failed');

        expect(frameRateController.stopHybridLoop).toHaveBeenCalledOnce();
        expect(frameRateController.isRunning).toBe(false);
        expect(mode.usingHybridLoop).toBe(false);
        expect(mode._fixedTickRuntime.active).toBe(false);
        expect(mode._fixedTickOwnership).toBeNull();
        expect(mode._fixedTickInputBinding).toBeNull();
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });

    it('latches the URL flag and stamps the normal recording with the fixed clock contract', async () => {
        vi.stubGlobal('window', {
            location: { search: '?fixedTick=1' },
            localStorage: { getItem: vi.fn(() => null) },
            matchMedia: vi.fn(() => ({ matches: false })),
        });
        const {
            frameRateController, gamepadController, inputController, mode,
        } = createMode();
        mode.isRunning = false;
        mode._startPhaserBoardScene = vi.fn();
        mode._clearPhaserBoard = vi.fn();
        mode._applyEffectQuality = vi.fn();
        mode._refreshNextQueue = vi.fn();
        mode._updateStats = vi.fn();

        await mode.onStart();

        expect(mode._fixedTickEnabled).toBe(true);
        expect(mode._fixedTickRuntime.active).toBe(true);
        expect(frameRateController.startHybridLoop).toHaveBeenCalledOnce();
        expect(inputController.fixedTickInputAdapter).not.toBeNull();
        expect(gamepadController.fixedTickInputAdapter).not.toBeNull();
        expect(mode.demoRecorder.getDemo()).toMatchObject({
            version: DEMO_FIXED_CLOCK_VERSION,
            sim: { simulationClock: DEMO_FIXED_SIMULATION_CLOCK },
            initialState: { rulesVersion: DEMO_FIXED_CLOCK_VERSION },
        });
    });

    it('keeps the standard flag-off RAF path free of fixed adapters', () => {
        const {
            frameRateController, gamepadController, inputController, mode, physicsCallbacks,
        } = createMode();
        const state = mode.gameState;

        mode._startGameLoop();

        expect(moduleMocks.gameLoop).toHaveBeenCalledWith(
            expect.any(Number),
            state,
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

    it('preserves the flag-off hybrid callbacks and updateGame call shape', () => {
        const {
            frameRateController, gamepadController, inputController, mode, physicsCallbacks,
        } = createMode({ needsHybrid: true });
        const state = mode.gameState;

        mode._startGameLoop();
        const { logic, render } = frameRateController.callbacks[0];

        expect(logic).toHaveLength(2);
        expect(render).toHaveLength(2);
        logic(123, 999);
        expect(moduleMocks.updateGame).toHaveBeenCalledWith(123, state, {
            drawCallback: null,
            updateStatsCallback: null,
            playDropCallback: expect.any(Function),
            physicsCallbacks,
        });
        expect(inputController.setFixedTickInputAdapter).not.toHaveBeenCalled();
        expect(gamepadController.setFixedTickInputAdapter).not.toHaveBeenCalled();
    });

    it('forwards fixed input-phase timing only on the canonical drop path', () => {
        const { mode, physicsCallbacks } = createMode();
        const playDropCallback = vi.fn();
        const callbacks = { physicsCallbacks, playDropCallback };

        mode._applyCommand({ type: 'hardDrop' }, {
            callbacks,
            fixedTick: true,
            inputPhase: true,
            muted: true,
        });
        expect(moduleMocks.hardDrop).toHaveBeenLastCalledWith(
            mode.gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );

        moduleMocks.hardDrop.mockClear();
        mode._applyCommand({ type: 'hardDrop' }, { callbacks, muted: true });
        expect(moduleMocks.hardDrop).toHaveBeenLastCalledWith(
            mode.gameState,
            playDropCallback,
            physicsCallbacks,
        );

        mode._applyCommand({ type: 'softDrop' }, {
            callbacks,
            fixedTick: true,
            inputPhase: true,
            muted: true,
        });
        expect(moduleMocks.softDrop).toHaveBeenLastCalledWith(
            mode.gameState,
            playDropCallback,
            physicsCallbacks,
            { fixedTick: true, inputPhase: true },
        );
    });

    it('never starts the fixed runtime or installs adapters for DemoPlayer', async () => {
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
        vi.stubGlobal('window', {
            location: { search: '?fixedTick=1' },
            localStorage: { getItem: vi.fn(() => null) },
            matchMedia: vi.fn(() => ({ matches: false })),
        });
        const {
            frameRateController, gamepadController, inputController, mode, settings,
        } = createMode();
        mode.isRunning = false;
        const demo = { initialState: { settings } };
        mode.demoPlayer.loadDemo = vi.fn(() => {
            mode.demoPlayer.demo = demo;
            return true;
        });
        mode.demoPlayer.startPlayback = vi.fn();
        mode.playbackControls.show = vi.fn();
        mode._startPhaserBoardScene = vi.fn();
        mode._clearPhaserBoard = vi.fn();
        mode._applyEffectQuality = vi.fn();

        await mode.onStart({ demo });

        expect(mode.isPlayingDemo).toBe(true);
        expect(mode._fixedTickEnabled).toBe(false);
        expect(mode._fixedTickRuntime.active).toBe(false);
        expect(frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(inputController.setFixedTickInputAdapter).not.toHaveBeenCalled();
        expect(gamepadController.setFixedTickInputAdapter).not.toHaveBeenCalled();
    });
});
