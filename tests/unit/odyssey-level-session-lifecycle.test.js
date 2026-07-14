/* eslint-disable import/first */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {
        destroy() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { fillBag, GameState } from '../../src/core/game.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
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
        getMetrics: vi.fn(() => metrics),
        updateScore: vi.fn(),
    };
}

function createMode() {
    const frameRateController = {
        isRunning: true,
        stopHybridLoop: vi.fn(),
    };
    const mode = new OdysseyMode({
        frameRateController,
        settingsManager: { get: vi.fn(() => ({})) },
        soundManager: { sfxPlayer: {} },
    });

    mode._getBoardScene = vi.fn(() => null);
    mode._refreshNextQueue = vi.fn();
    mode._handleGameOver = vi.fn();
    mode.currentLevelId = 7;
    mode.usingHybridLoop = true;

    return { frameRateController, mode };
}

function createSpawnableState() {
    const state = new GameState();
    state.randomGenerator = () => 0.25;
    fillBag(state.nextPieces, state.randomGenerator);
    return state;
}

function createLevelConfig(id = 7) {
    return {
        id,
        name: `Session Test ${id}`,
        mechanics: {
            baseMode: 'standard',
            board: { rows: 20, startingRows: 0 },
            speed: { startLevel: 1 },
        },
        modifiers: { active: [] },
        stars: {},
        victory: { bonuses: [], primary: { target: 40, type: 'lines' } },
    };
}

function bindSession(mode, gameState, hybridEngine, generation) {
    const session = {
        gameState,
        generation,
        hybridEngine,
        levelId: mode.currentLevelId,
        retired: false,
    };

    mode._levelSessionGeneration = generation;
    mode._activeLevelSession = session;
    mode._physicsCallbacks = null;
    mode.gameState = gameState;
    mode.hybridEngine = hybridEngine;
    return session;
}

function stubStopCleanup(mode) {
    mode._restoreTransitionMusicDuck = vi.fn();
    mode._clearLevelThemePrefetchTimer = vi.fn();
    mode._clearNeutralThemeFallbackBackdrop = vi.fn();
    mode._clearGameplayRevealState = vi.fn();
    mode._clearLevelStartCue = vi.fn();
    mode._hideGoalCompleteOverlay = vi.fn();
    mode._removeVictoryLapInputs = vi.fn();
    mode._cleanupOdysseyHUD = vi.fn();
    mode._cleanupMinimap = vi.fn();
    mode._applyInfinityLayout = vi.fn();
    mode._stopPhaserBoardScene = vi.fn();
    mode.journeyEntryTransition = { abort: vi.fn() };
}

describe('OdysseyMode level-session ownership', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            removeItem: vi.fn(),
            setItem: vi.fn(),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects callbacks captured by a retired attempt instead of mutating its replacement', () => {
        const { mode } = createMode();
        const oldState = createSpawnableState();
        const oldSession = bindSession(mode, oldState, createHybridEngine(), 1);
        const oldCallbacks = mode._getPhysicsCallbacks();

        mode._retireLevelSession(oldSession);

        const replacementState = createSpawnableState();
        bindSession(mode, replacementState, createHybridEngine(), 2);
        const nextPieceCount = replacementState.nextPieces.length;

        oldCallbacks.onHardDrop({ distance: 8 });
        oldCallbacks.spawnPiece();

        expect(replacementState.hitStopRemaining).toBe(0);
        expect(replacementState.currentPiece).toBeNull();
        expect(replacementState.piecesPlaced).toBe(0);
        expect(replacementState.nextPieces).toHaveLength(nextPieceCount);
        expect(mode._refreshNextQueue).not.toHaveBeenCalled();
        expect(mode._handleGameOver).not.toHaveBeenCalled();
    });

    it('creates a fresh hybrid evaluator for every attempt', () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.currentLevelConfig = levelConfig;
        mode._createGameStateForLevel(levelConfig, 1);
        const oldSession = mode._activeLevelSession;
        const oldCallbacks = mode._getPhysicsCallbacks(oldSession);

        mode._retireLevelSession(oldSession);
        mode._createGameStateForLevel(levelConfig, 2);
        const replacementSession = mode._activeLevelSession;
        oldCallbacks.onLineClear(1);

        expect(replacementSession.hybridEngine).not.toBe(oldSession.hybridEngine);
        expect(replacementSession.hybridEngine.getMetrics().lines).toBe(0);
        expect(oldSession.hybridEngine.getMetrics().lines).toBe(1);
    });

    it.each([
        ['completion', 'completeLevel'],
        ['failure', 'failLevel'],
    ])('retires the attempt and stops its FRC loop synchronously on %s', async (_label, method) => {
        const { frameRateController, mode } = createMode();
        const session = bindSession(mode, createSpawnableState(), createHybridEngine(), 1);
        const releaseUi = deferred();

        mode._calculateStars = vi.fn(() => 0);
        mode._evaluateBonuses = vi.fn(() => []);
        mode.odysseyState.completeLevel = vi.fn();
        mode.odysseyState.recordAttempt = vi.fn();
        mode._syncSteamStats = vi.fn().mockResolvedValue();
        mode._showLevelResults = vi.fn(() => releaseUi.promise);
        mode._showLevelFailure = vi.fn(() => releaseUi.promise);
        mode._hideGoalCompleteOverlay = vi.fn();
        mode._removeVictoryLapInputs = vi.fn();
        mode.returnToBoard = vi.fn().mockResolvedValue();

        const operation = method === 'completeLevel'
            ? mode.completeLevel({})
            : mode.failLevel('time');

        expect(session.retired).toBe(true);
        expect(frameRateController.stopHybridLoop).toHaveBeenCalledTimes(1);

        releaseUi.resolve(method === 'completeLevel'
            ? true
            : { choice: 'map', modal: { remove: vi.fn() } });
        await operation;
    });

    it('retires a prepared attempt when its runtime fails to start', () => {
        const { frameRateController, mode } = createMode();
        const session = bindSession(mode, createSpawnableState(), createHybridEngine(), 1);
        mode.levelPrepared = true;
        mode._hookInputs = vi.fn();
        mode._startLevelTimer = vi.fn();
        mode._startGameLoop = vi.fn(() => {
            throw new Error('loop start failed');
        });

        expect(() => mode.beginLevelRun()).toThrow('loop start failed');

        expect(session.retired).toBe(true);
        expect(session.gameState.isStopped).toBe(true);
        expect(frameRateController.stopHybridLoop).toHaveBeenCalledTimes(1);
    });

    it('drains the captured attempt on stop without clearing a replacement state', async () => {
        const { frameRateController, mode } = createMode();
        const physics = deferred();
        const oldState = createSpawnableState();
        oldState.isProcessingPhysics = true;
        oldState.latestPhysicsPromise = physics.promise;
        const oldSession = bindSession(mode, oldState, createHybridEngine(), 1);
        stubStopCleanup(mode);
        mode.isRunning = true;

        const stopping = mode.onStop();
        await Promise.resolve();

        expect(oldState.isStopped).toBe(true);
        expect(oldSession.retired).toBe(true);
        expect(frameRateController.stopHybridLoop).toHaveBeenCalledTimes(1);

        const replacementState = createSpawnableState();
        const replacementPhysics = Promise.resolve('replacement');
        replacementState.isProcessingPhysics = true;
        replacementState.latestPhysicsPromise = replacementPhysics;
        const replacementSession = bindSession(mode, replacementState, createHybridEngine(), 2);

        physics.resolve();
        await stopping;

        expect(oldState.latestPhysicsPromise).toBeNull();
        expect(oldState.isProcessingPhysics).toBe(false);
        expect(mode.gameState).toBe(replacementState);
        expect(mode._activeLevelSession).toBe(replacementSession);
        expect(replacementSession.retired).toBe(false);
        expect(replacementState.latestPhysicsPromise).toBe(replacementPhysics);
        expect(replacementState.isProcessingPhysics).toBe(true);
        expect(replacementState.isGameOver).toBe(false);
        expect(replacementState.isStopped).toBe(false);
    });
});
