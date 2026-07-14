import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    fillBag, spawnPiece,
} from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';
import { INPUT_DISPOSITIONS } from '../../src/core/simulation-tick.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} from '../../src/core/demo/DemoRecorder.js';
import {
    applyLocalMultiplayerFixedCommand,
    captureLocalMultiplayerClock,
    configureLocalMultiplayerSimulationClock,
    createLocalMultiplayerFixedPhysicsCallbacks,
    drainLocalMultiplayerRound,
    retireLocalMultiplayerRound,
    startLocalMultiplayerModeLoop,
    stopLocalMultiplayerModeLoop,
} from '../../src/core/game-modes/local-multiplayer-loop.js';

function createController() {
    return {
        fixedTickInputAdapter: null,
        clearFixedTickInput: vi.fn(),
        setFixedTickInputAdapter(adapter = null) {
            this.fixedTickInputAdapter = adapter;
        },
    };
}

function createFrameRateController({ throwOnStart = false } = {}) {
    return {
        isRunning: false,
        renderCallback: null,
        updateCallback: null,
        startHybridLoop: vi.fn(function startHybridLoop(updateCallback, renderCallback) {
            if (throwOnStart) throw new Error('FRC start failed');
            this.updateCallback = updateCallback;
            this.renderCallback = renderCallback;
            this.isRunning = true;
        }),
        stopHybridLoop: vi.fn(function stopHybridLoop() {
            this.isRunning = false;
            this.updateCallback = null;
            this.renderCallback = null;
        }),
    };
}

function createMode(config = {}, frcOptions = {}) {
    const matchConfig = {
        attackStyle: 'standard',
        endCondition: 'frags',
        endConditionValue: 7,
        isInfinityLMS: false,
        levelProgression: false,
        numPlayers: 2,
        playerSlots: [
            { kind: 'human', slot: 0 },
            { kind: 'human', slot: 1 },
        ],
        ...config,
    };
    const multiplayerState = new MultiPlayerState(matchConfig.numPlayers);
    multiplayerState.setMatchConfig(matchConfig);
    multiplayerState.reset();
    multiplayerState.isPaused = false;
    const frameRateController = createFrameRateController(frcOptions);
    const inputController = createController();
    const gamepadController = createController();
    const physicsCallbacks = multiplayerState.players.map(() => ({ spawnPiece: vi.fn() }));
    const topOutBindings = [];
    return {
        _gameLoopGeneration: 0,
        _getPhysicsCallbacks: vi.fn((playerNum) => physicsCallbacks[playerNum - 1]),
        _handleFixedTickTopOutBatch: vi.fn(() => Promise.resolve(true)),
        _isBotPlayer: vi.fn(() => false),
        _syncBoardScenes: vi.fn(),
        _updateMultiplayerStats: vi.fn(),
        _topOutBindings: topOutBindings,
        animationFrameId: null,
        boardScenes: [],
        botManager: null,
        deps: {
            frameRateController,
            gamepadController,
            getMultiplayerPhysicsCallbacks: (playerNum, options) => {
                topOutBindings[playerNum - 1] = options?.onPlayerTopOut;
                return physicsCallbacks[playerNum - 1];
            },
            inputController,
            settingsManager: {
                get: () => ({
                    arr: 40,
                    dasDelay: 130,
                    reducedMotion: false,
                    softDropInterval: 25,
                }),
            },
            soundManager: {
                sfxPlayer: {
                    playDrop: vi.fn(),
                    playMove: vi.fn(),
                    playRotate: vi.fn(),
                },
            },
        },
        isRunning: true,
        matchConfig,
        multiplayerState,
        usingHybridLoop: false,
    };
}

describe('Local Multiplayer fixed mode integration', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            gamepadController: { advanceGameplayInput: vi.fn() },
            inputController: { updateDAS: vi.fn() },
            localStorage: { getItem: vi.fn(() => null) },
            location: { search: '?fixedTick=1' },
            matchMedia: vi.fn(() => ({ matches: false })),
        });
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 81));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses one FrameRateController owner and keeps render observer-only', () => {
        const mode = createMode();
        expect(configureLocalMultiplayerSimulationClock(mode))
            .toBe(DEMO_FIXED_SIMULATION_CLOCK);

        startLocalMultiplayerModeLoop(mode);
        const { frameRateController, inputController, gamepadController } = mode.deps;
        expect(frameRateController.startHybridLoop).toHaveBeenCalledOnce();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(inputController.fixedTickInputAdapter).not.toBeNull();
        expect(gamepadController.fixedTickInputAdapter).not.toBeNull();

        frameRateController.updateCallback(0, 1000 / 60);
        expect(mode.multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);
        frameRateController.renderCallback();
        expect(mode._updateMultiplayerStats).toHaveBeenCalledOnce();
        expect(mode._syncBoardScenes).toHaveBeenCalledOnce();
        expect(mode.multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);

        stopLocalMultiplayerModeLoop(mode);
        expect(frameRateController.isRunning).toBe(false);
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });

    it.each([30, 60, 144])('reports one second from the fixed match clock at %i Hz', (rate) => {
        const mode = createMode();
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        for (let frame = 0; frame < rate; frame += 1) {
            mode.deps.frameRateController.updateCallback(0, 1000 / rate);
        }

        expect(captureLocalMultiplayerClock(mode)).toMatchObject({
            simulationClock: DEMO_FIXED_SIMULATION_CLOCK,
            usesFixedTiming: true,
            matchFrames: 60,
            roundFrames: 60,
        });
        expect(captureLocalMultiplayerClock(mode).matchMs).toBeCloseTo(1000, 8);
        expect(captureLocalMultiplayerClock(mode).roundMs).toBeCloseTo(1000, 8);
    });

    it('excludes paused wall time and resets only the round clock between fixed rounds', () => {
        const mode = createMode();
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        mode.deps.frameRateController.updateCallback(0, 1000 / 30);
        const firstRound = captureLocalMultiplayerClock(mode);
        mode.multiplayerState.isPaused = true;
        mode.deps.frameRateController.updateCallback(5000, 5000);
        expect(captureLocalMultiplayerClock(mode)).toEqual(firstRound);

        stopLocalMultiplayerModeLoop(mode);
        mode.multiplayerState.reset();
        mode.multiplayerState.isPaused = false;
        startLocalMultiplayerModeLoop(mode);
        mode.deps.frameRateController.updateCallback(0, 1000 / 60);

        expect(captureLocalMultiplayerClock(mode)).toMatchObject({
            matchFrames: 3,
            roundFrames: 1,
        });
        expect(captureLocalMultiplayerClock(mode).matchMs).toBeCloseTo(50, 8);
        expect(captureLocalMultiplayerClock(mode).roundMs).toBeCloseTo(1000 / 60, 8);
    });

    it('keeps legacy duration capture on the existing wall clock', () => {
        window.location.search = '?fixedTick=0';
        const now = vi.spyOn(Date, 'now').mockReturnValue(9000);
        const mode = createMode();
        mode.matchStartTime = 2000;
        mode.roundStartTime = 5000;
        configureLocalMultiplayerSimulationClock(mode);

        expect(captureLocalMultiplayerClock(mode)).toEqual({
            simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
            usesFixedTiming: false,
            matchFrames: null,
            matchMs: 7000,
            roundFrames: null,
            roundMs: 4000,
        });
        now.mockRestore();
    });

    it('applies P1 keyboard and P2 gamepad queues to distinct boards on the same tick', () => {
        const mode = createMode();
        mode.multiplayerState.players.forEach((player) => {
            fillBag(player.nextPieces, () => 0.25);
            spawnPiece(player);
        });
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        const [player1, player2] = mode.multiplayerState.players;
        const initialX = [player1.currentPiece.x, player2.currentPiece.x];
        enqueueInputEdge(player1.playerInput, {
            tick: 1, subframe: 0, action: 'move', value: -1, phase: 'down',
        });
        enqueueInputEdge(player2.playerInput, {
            tick: 1, subframe: 0, action: 'move', value: 1, phase: 'down',
        });
        const keyboardContext = { playerIndex: 0, gameState: player1 };
        const gamepadContext = { playerIndex: 1, gameState: player2 };
        expect(mode.deps.inputController.fixedTickInputAdapter.acceptSource(keyboardContext)).toBe(true);
        expect(mode.deps.gamepadController.fixedTickInputAdapter.acceptSource(gamepadContext)).toBe(true);

        mode.deps.frameRateController.updateCallback(0, 1000 / 60);

        expect(player1.currentPiece.x).toBe(initialX[0] - 1);
        expect(player2.currentPiece.x).toBe(initialX[1] + 1);
        expect(player1.simFrame).toBe(1);
        expect(player2.simFrame).toBe(1);
    });

    it('resolves stable unique top-outs only after the shared player barrier', () => {
        const mode = createMode();
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        const [player1, player2] = mode.multiplayerState.players;

        expect(mode._topOutBindings[1](1, player2)).toBe(true);
        expect(mode._topOutBindings[0](0, player1)).toBe(true);
        expect(mode._topOutBindings[1](1, player2)).toBe(true);
        expect(mode._handleFixedTickTopOutBatch).not.toHaveBeenCalled();

        mode.deps.frameRateController.updateCallback(0, 1000 / 60);

        expect(mode._handleFixedTickTopOutBatch).toHaveBeenCalledOnce();
        expect(mode._handleFixedTickTopOutBatch.mock.calls[0][0]).toEqual([0, 1]);
        stopLocalMultiplayerModeLoop(mode);
        expect(mode._topOutBindings[0](0, player1)).toBe(false);
        expect(mode._handleFixedTickTopOutBatch).toHaveBeenCalledOnce();
    });

    it('retires the exact fixed owner when asynchronous batch resolution fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mode = createMode();
        mode._handleFixedTickTopOutBatch.mockRejectedValue(new Error('outcome failed'));
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        const player1 = mode.multiplayerState.players[0];
        mode._topOutBindings[0](0, player1);

        mode.deps.frameRateController.updateCallback(0, 1000 / 60);
        await vi.waitFor(() => expect(mode._localSimulationLoop.fixedRuntime.active).toBe(false));

        expect(mode.deps.frameRateController.isRunning).toBe(false);
        expect(mode.deps.inputController.fixedTickInputAdapter).toBeNull();
        expect(mode.deps.gamepadController.fixedTickInputAdapter).toBeNull();
        expect(error).toHaveBeenCalledOnce();
    });

    it('claims paused input but permits the rest of an already-started player barrier', () => {
        const mode = createMode();
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        const player2 = mode.multiplayerState.players[1];
        const context = { playerIndex: 1, gameState: player2 };
        mode.multiplayerState.isPaused = true;

        expect(mode.deps.gamepadController.fixedTickInputAdapter.isEnabled(context)).toBe(true);
        expect(mode.deps.gamepadController.fixedTickInputAdapter.acceptSource(context)).toBe(false);
        mode._localSimulationLoop.fixedTickBarrierActive = true;
        expect(mode.deps.gamepadController.fixedTickInputAdapter.acceptSource(context)).toBe(true);
    });

    it.each([
        ['bot', { playerSlots: [{ kind: 'human' }, { kind: 'bot' }] }],
        ['Infinity LMS', { isInfinityLMS: true }],
        ['Hot Potato', { attackStyle: 'hot_potato', hotPotato: true }],
        ['time limit', { endCondition: 'time' }],
    ])('falls back completely for unsupported %s matches', (_label, config) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mode = createMode(config);

        expect(configureLocalMultiplayerSimulationClock(mode))
            .toBe(DEMO_LEGACY_SIMULATION_CLOCK);
        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(false);
        expect(mode.multiplayerState.players.every(
            (player) => player.simulationClock === DEMO_LEGACY_SIMULATION_CLOCK,
        )).toBe(true);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('preserves the exact legacy RAF/DAS/render path when the flag is off', () => {
        window.location.search = '?fixedTick=0';
        const mode = createMode();
        mode.multiplayerState.lastTime = 10;
        const callbacks = [];
        requestAnimationFrame.mockImplementation((callback) => {
            callbacks.push(callback);
            return callbacks.length;
        });

        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        callbacks[0](26);

        expect(mode.deps.frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(window.inputController.updateDAS).toHaveBeenCalledWith(16);
        expect(window.gamepadController.advanceGameplayInput).toHaveBeenCalledWith(26);
        expect(mode._updateMultiplayerStats).toHaveBeenCalledWith(1);
        expect(mode._syncBoardScenes).toHaveBeenCalledOnce();
        expect(callbacks).toHaveLength(2);
    });

    it('latches the fixed clock across an in-place round reset', () => {
        const mode = createMode();
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        mode.deps.frameRateController.updateCallback(0, 1000 / 30);
        stopLocalMultiplayerModeLoop(mode);
        mode.multiplayerState.reset();
        mode.multiplayerState.isPaused = false;
        window.location.search = '?fixedTick=0';

        startLocalMultiplayerModeLoop(mode);
        mode.deps.frameRateController.updateCallback(0, 1000 / 60);

        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(true);
        expect(mode._localSimulationLoop.fixedRuntime.simFrame).toBe(3);
        expect(mode.multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);
    });

    it('atomically falls back to legacy after FrameRateController startup throws', () => {
        const mode = createMode({}, { throwOnStart: true });
        configureLocalMultiplayerSimulationClock(mode);

        expect(() => startLocalMultiplayerModeLoop(mode)).not.toThrow();
        expect(mode._localSimulationLoop.fixedRuntime.active).toBe(false);
        expect(mode._localSimulationLoop.fixedLoop).toBeNull();
        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(false);
        expect(mode._localSimulationLoop.simulationClock).toBe(DEMO_LEGACY_SIMULATION_CLOCK);
        expect(mode.multiplayerState.players.every(
            (player) => player.simulationClock === DEMO_LEGACY_SIMULATION_CLOCK,
        )).toBe(true);
        expect(mode.deps.inputController.fixedTickInputAdapter).toBeNull();
        expect(mode.deps.gamepadController.fixedTickInputAdapter).toBeNull();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('retires fixed runtime ownership when callback construction throws', () => {
        const mode = createMode();
        mode.deps.getMultiplayerPhysicsCallbacks = vi.fn(() => {
            throw new Error('callback construction failed');
        });
        configureLocalMultiplayerSimulationClock(mode);

        expect(() => startLocalMultiplayerModeLoop(mode)).not.toThrow();

        expect(mode._localSimulationLoop.fixedRuntime.active).toBe(false);
        expect(mode._localSimulationLoop.fixedLoop).toBeNull();
        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(false);
        expect(mode.deps.frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(mode.deps.inputController.fixedTickInputAdapter).toBeNull();
        expect(mode.deps.gamepadController.fixedTickInputAdapter).toBeNull();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('does not stop a foreign FrameRateController owner and falls back to legacy', () => {
        const mode = createMode();
        const foreignUpdate = vi.fn();
        const foreignRender = vi.fn();
        Object.assign(mode.deps.frameRateController, {
            isRunning: true,
            updateCallback: foreignUpdate,
            renderCallback: foreignRender,
        });
        configureLocalMultiplayerSimulationClock(mode);

        startLocalMultiplayerModeLoop(mode);

        expect(mode.deps.frameRateController.stopHybridLoop).not.toHaveBeenCalled();
        expect(mode.deps.frameRateController.updateCallback).toBe(foreignUpdate);
        expect(mode.deps.frameRateController.renderCallback).toBe(foreignRender);
        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(false);
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('falls back before startup when either fixed-input controller lacks capabilities', () => {
        const mode = createMode();
        delete mode.deps.gamepadController.setFixedTickInputAdapter;

        expect(configureLocalMultiplayerSimulationClock(mode)).toBe(DEMO_LEGACY_SIMULATION_CLOCK);
        startLocalMultiplayerModeLoop(mode);

        expect(mode.deps.frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('cleans an exact partial adapter install before falling back to legacy', () => {
        const mode = createMode();
        mode.deps.gamepadController.setFixedTickInputAdapter = vi.fn();
        configureLocalMultiplayerSimulationClock(mode);

        startLocalMultiplayerModeLoop(mode);

        expect(mode.deps.inputController.fixedTickInputAdapter).toBeNull();
        expect(mode.deps.gamepadController.fixedTickInputAdapter).toBeNull();
        expect(mode.deps.frameRateController.startHybridLoop).not.toHaveBeenCalled();
        expect(mode._localSimulationLoop.fixedTickEnabled).toBe(false);
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('retires timer/input ownership before awaiting captured cascade physics', async () => {
        const mode = createMode();
        const rngDescriptor = Object.freeze({
            algorithm: 'lcg-v1', seed: 0, stream: 'pieces:shared-v1',
        });
        mode.multiplayerState.rngDescriptor = rngDescriptor;
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);
        let resolvePhysics;
        mode.multiplayerState.players[0].latestPhysicsPromise = new Promise((resolve) => {
            resolvePhysics = resolve;
        });

        const retired = retireLocalMultiplayerRound(mode);
        expect(retired.rngDescriptor).toBe(rngDescriptor);
        const drainPromise = drainLocalMultiplayerRound(mode, retired);
        expect(mode._localSimulationLoop.fixedRuntime.active).toBe(false);
        expect(mode.deps.inputController.fixedTickInputAdapter).toBeNull();
        expect(mode.multiplayerState.players.every((player) => player.isStopped)).toBe(true);

        resolvePhysics();
        await expect(drainPromise).resolves.toBe(true);
    });

    it('rejects a retired drain after an in-place reset adopts a new RNG owner', async () => {
        const mode = createMode();
        mode.multiplayerState.rngDescriptor = Object.freeze({
            algorithm: 'lcg-v1', seed: 11, stream: 'pieces:shared-v1',
        });
        configureLocalMultiplayerSimulationClock(mode);
        startLocalMultiplayerModeLoop(mode);

        const retired = retireLocalMultiplayerRound(mode);
        mode.multiplayerState.reset();
        mode.multiplayerState.rngDescriptor = Object.freeze({
            algorithm: 'lcg-v1', seed: 12, stream: 'pieces:shared-v1',
        });

        await expect(drainLocalMultiplayerRound(mode, retired)).resolves.toBe(false);
    });
});

describe('Local Multiplayer fixed command and callback policy', () => {
    it('applies stable unique death batches with one win-condition check', () => {
        const multiplayerState = new MultiPlayerState(3);
        const checkWinCondition = vi.spyOn(multiplayerState, 'checkWinCondition')
            .mockReturnValue(false);

        expect(multiplayerState.handlePlayerDeaths([2, 0, 2, -1, 4])).toEqual([0, 2]);
        expect(multiplayerState.players.map((player) => player.isAlive)).toEqual([false, true, false]);
        expect(multiplayerState.deaths).toEqual([1, 0, 1]);
        expect(checkWinCondition).toHaveBeenCalledOnce();
    });

    it('declares tied same-tick frag leaders a draw instead of favoring player zero', () => {
        const multiplayerState = new MultiPlayerState(2);
        multiplayerState.setMatchConfig({ endCondition: 'frags', endConditionValue: 1 });
        multiplayerState.lastAttackerIds = [1, 0];

        expect(multiplayerState.handlePlayerDeaths([1, 0])).toEqual([0, 1]);

        expect(multiplayerState.frags).toEqual([1, 1]);
        expect(multiplayerState.isGameOver).toBe(true);
        expect(multiplayerState.winner).toBeNull();
    });

    it('declares tied same-tick team frag leaders a draw instead of favoring team zero', () => {
        const multiplayerState = new MultiPlayerState(4);
        multiplayerState.setMatchConfig({
            endCondition: 'frags',
            endConditionValue: 1,
            isTeamMode: true,
            playerTeams: [0, 0, 1, 1],
        });
        multiplayerState.lastAttackerIds = [2, null, 0, null];

        expect(multiplayerState.handlePlayerDeaths([2, 0])).toEqual([0, 2]);

        expect(multiplayerState.frags).toEqual([1, 0, 1, 0]);
        expect(multiplayerState.isGameOver).toBe(true);
        expect(multiplayerState.winner).toBeNull();
    });

    it('buffers only move/rotate while physics is busy and rejects drops', () => {
        const multiplayerState = new MultiPlayerState(2);
        const gameState = multiplayerState.players[0];
        gameState.isProcessingPhysics = true;
        const context = { gameState, isEnabled: () => true };

        expect(applyLocalMultiplayerFixedCommand(
            { action: 'move', value: -1 },
            context,
        )).toBe(INPUT_DISPOSITIONS.DEFERRED_PHYSICS);
        expect(applyLocalMultiplayerFixedCommand(
            { action: 'hardDrop' },
            context,
        )).toBe(INPUT_DISPOSITIONS.REJECTED_PHYSICS);
        expect(gameState.inputQueue).toEqual({ type: 'move', dir: -1 });
    });

    it('replaces live callback hit-stop writes with deterministic fixed policy', () => {
        const multiplayerState = new MultiPlayerState(2);
        const gameState = multiplayerState.players[0];
        const liveProducer = vi.fn(() => { gameState.hitStopRemaining = 13; });
        const callbacks = createLocalMultiplayerFixedPhysicsCallbacks({
            onHardDrop: liveProducer,
            onLineClearImpact: liveProducer,
            onPerfectClear: liveProducer,
        }, gameState, () => true);

        callbacks.onHardDrop();
        expect(gameState.hitStopRemaining).toBe(30);
        gameState.hitStopRemaining = 0;
        callbacks.onLineClearImpact(2);
        expect(gameState.hitStopRemaining).toBe(0);
        callbacks.onLineClearImpact(4);
        expect(gameState.hitStopRemaining).toBe(70);
        callbacks.onPerfectClear();
        expect(gameState.hitStopRemaining).toBe(110);
        expect(liveProducer).toHaveBeenCalledTimes(4);
    });
});
