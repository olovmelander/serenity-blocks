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
import { drainOdysseyLevelSession } from '../../src/core/odyssey/odyssey-level-session.js';

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

    it('creates a fresh hybrid evaluator and fences every metric callback of the retired real engine', () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.currentLevelConfig = levelConfig;
        mode._createGameStateForLevel(levelConfig, 1);
        const oldSession = mode._activeLevelSession;
        const oldCallbacks = mode._getPhysicsCallbacks(oldSession);
        const oldMetrics = oldSession.hybridEngine.getMetrics();

        mode._retireLevelSession(oldSession);
        mode._createGameStateForLevel(levelConfig, 2);
        const replacementSession = mode._activeLevelSession;
        oldCallbacks.onLineClear(1);
        oldCallbacks.triggerCombo(5);
        oldCallbacks.triggerCascadeWave(2);
        oldCallbacks.onPieceLock({ shape: [[1]], x: 0, y: 23 });

        expect(replacementSession.hybridEngine).not.toBe(oldSession.hybridEngine);
        expect(replacementSession.hybridEngine.getMetrics().lines).toBe(0);
        expect(oldSession.hybridEngine.getMetrics()).toEqual(oldMetrics);
    });

    it.each([false, true])('waits for both captured duel boards when human physics rejects=%s', async (rejectHuman) => {
        const humanPhysics = deferred();
        const botPhysics = deferred();
        const human = createSpawnableState();
        const bot = createSpawnableState();
        human.isProcessingPhysics = true;
        bot.isProcessingPhysics = true;
        human.latestPhysicsPromise = humanPhysics.promise;
        bot.latestPhysicsPromise = botPhysics.promise;
        const session = { gameState: human, duel: { players: [human, bot] } };
        let drainFinished = false;
        const draining = drainOdysseyLevelSession(session).then(
            () => { drainFinished = true; return 'resolved'; },
            () => { drainFinished = true; return 'rejected'; },
        );

        if (rejectHuman) humanPhysics.reject(new Error('human physics failed'));
        else humanPhysics.resolve();
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(drainFinished).toBe(false);
        expect(bot.latestPhysicsPromise).toBe(botPhysics.promise);
        expect(bot.isProcessingPhysics).toBe(true);

        botPhysics.resolve();
        expect(await draining).toBe(rejectHuman ? 'rejected' : 'resolved');
        expect(human.latestPhysicsPromise).toBeNull();
        expect(bot.latestPhysicsPromise).toBeNull();
        expect(human.isProcessingPhysics).toBe(false);
        expect(bot.isProcessingPhysics).toBe(false);
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

    it.each(['results', 'failure'])('cancels a pending %s view on exact-attempt retirement', async (view) => {
        const { mode } = createMode();
        const session = bindSession(mode, createSpawnableState(), createHybridEngine(), 1);
        const modal = { dispose: vi.fn() };
        vi.stubGlobal('document', { body: { appendChild: vi.fn() } });
        mode._cleanupOdysseyHUD = vi.fn();
        mode._cleanupMinimap = vi.fn();
        mode._createResultsModal = vi.fn(() => modal);
        mode._createFailureModal = vi.fn(() => modal);
        const waiting = view === 'results'
            ? mode._showLevelResults({
                stars: 1, score: 0, lines: 0, time: 1,
            }, session)
            : mode._showLevelFailure('time', session);
        expect(document.body.appendChild).toHaveBeenCalledWith(modal);
        expect(session.disposeOutcome).toBeTypeOf('function');

        mode._retireLevelSession(session);
        const replacement = bindSession(mode, createSpawnableState(), createHybridEngine(), 2);
        expect(modal.dispose).toHaveBeenCalledOnce();
        expect(session.disposeOutcome).toBeNull();
        expect(await waiting).toEqual(view === 'results' ? false : { choice: null, modal });
        expect(mode._activeLevelSession).toBe(replacement);
        expect(replacement.retired).toBe(false);
        mode._retireLevelSession(session);
        expect(modal.dispose).toHaveBeenCalledOnce();
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
