/* eslint-disable import/first */

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice { destroy() {} },
}));
vi.mock('../../src/ui/odyssey/FailureModal.js', () => ({
    createFailureModal: vi.fn(() => ({ remove: vi.fn() })),
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { createFailureModal } from '../../src/ui/odyssey/FailureModal.js';
import { hardDrop, move } from '../../src/core/game.js';
import { markBoardDirty, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK,
} from '../../src/core/demo/DemoRecorder.js';

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function createMode(levelConfig = getLevelById(1), {
    fixed = false, persistResults = false, renderFailure = false,
} = {}) {
    const ui = deferred();
    const frameRateController = {
        isRunning: false,
        needsHybridMode: () => true,
        startHybridLoop: vi.fn(function startHybridLoop(logic, render) {
            this.isRunning = true;
            this.logic = logic;
            this.render = render;
        }),
        stopHybridLoop: vi.fn(),
    };
    const mode = new OdysseyMode({
        frameRateController,
        settingsManager: { get: () => ({ reducedMotion: true }) },
        soundManager: {
            sfxPlayer: {
                playLineClear: vi.fn(),
                playPerfectClear: vi.fn(),
                playDrop: vi.fn(),
                playLevelUp: vi.fn(),
                playGarbageSend: vi.fn(),
            },
        },
    });
    mode._getBoardScene = vi.fn(() => null);
    mode._hookInputs = vi.fn();
    mode._refreshNextQueue = vi.fn();
    mode._updateStats = vi.fn();
    mode._updateOdysseyHUD = vi.fn();
    mode._updateMinimap = vi.fn();
    mode._showGoalCompleteOverlay = vi.fn();
    mode._hideGoalCompleteOverlay = vi.fn();
    mode._setupVictoryLapInputs = vi.fn();
    mode._removeVictoryLapInputs = vi.fn();
    mode._showLevelResults = vi.fn(() => ui.promise);
    if (!renderFailure) mode._showLevelFailure = vi.fn(() => ui.promise);
    mode._syncSteamStats = vi.fn().mockResolvedValue();
    mode.returnToBoard = vi.fn().mockResolvedValue();
    if (!persistResults) {
        mode.odysseyState.completeLevel = vi.fn();
        mode.odysseyState.recordAttempt = vi.fn();
    }
    mode.currentLevelId = levelConfig.id;
    mode.currentLevelConfig = levelConfig;
    mode._levelSessionGeneration = 1;
    if (fixed) {
        window.location.search = '?fixedTick=1';
        mode._latchSimulationClock();
    }
    mode._createGameStateForLevel(levelConfig, 1, 1234);
    mode.isRunning = true;
    mode.isInBoardView = false;
    vi.spyOn(mode, 'completeLevel');
    vi.spyOn(mode, 'failLevel');
    return {
        mode, session: mode._activeLevelSession, ui, frameRateController,
    };
}

function prepareTerminalLock({ mode, session }, { blockedSpawn = false } = {}) {
    const { gameState } = session;
    const callbacks = mode._getPhysicsCallbacks(session);
    // Prepared geometry isolates the finish boundary, not an authored-start strategy.
    gameState.lockedPieces = [];
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    markBoardDirty(gameState);
    gameState.simTimeMs = 1000;
    gameState.isSeeking = true;
    gameState.nextPieces = ['O', 'O'];
    callbacks.spawnPiece();
    expect(gameState.isGameOver).toBe(false);
    for (let step = 0; step < 4; step++) expect(move(gameState, -1)).toBe(true);

    if (blockedSpawn) {
        // A supported central column survives physics and blocks the next O,
        // while the current O can still lock on the floor at the left edge.
        gameState.lockedPieces.push({
            pieceId: ++gameState._pieceIdCounter,
            shapeKey: 'I',
            x: 4,
            y: 0,
            shape: Array.from({ length: gameState.boardGrid.length }, () => [1]),
        });
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        markBoardDirty(gameState);
    }
    return callbacks;
}

async function resolveDeath(session, player, killer = null) {
    session.duel.multiplayer.lastAttackerIds[player] = killer;
    session.duel.markTopOut(player);
    session.duel.update(100, 16, {});
    await session.duel.transition;
}

function nextRound(session) {
    for (let frame = 0; frame < 18; frame++) {
        session.duel.update(1000 + frame * 50, 50, {});
    }
}

async function finishUi({ mode, ui }, success) {
    ui.resolve(success ? true : { choice: 'map', modal: { remove: vi.fn() } });
    const calls = success ? mode.completeLevel : mode.failLevel;
    await calls.mock.results[0].value;
}

async function finishFailureView({ mode }) {
    await vi.waitFor(() => expect(createFailureModal).toHaveBeenCalledOnce());
    const view = createFailureModal.mock.calls[0][0];
    view.onChoose('map');
    await mode.failLevel.mock.results[0].value;
    return view;
}

describe('OdysseyMode gameplay objectives', () => {
    it('uses the same chain-wave wording before entering an orb', () => {
        const mode = Object.create(OdysseyMode.prototype);
        expect(mode._formatObjective({ type: 'combo', target: 18 }))
            .toBe('Trigger a chain of at least 18 waves');
    });

    it('stops legacy roof decisions after completion retires the attempt', async () => {
        const config = structuredClone(getLevelById(1));
        config.mechanics.baseMode = 'infinity';
        config.mechanics.board.rows = 40;
        config.victory.bonuses = [{ type: 'no-top-out' }];
        const harness = createMode(config);
        const { mode, session, frameRateController } = harness;
        session.gameState.board[0][0] = { color: '#ffffff' };
        session.hybridEngine.victoryEvaluator.onLineClear(20);
        mode._startGameLoop(session);
        frameRateController.render();
        await finishUi(harness, true);
        expect(session.gameState.isGameOver).toBe(false);
        expect(mode._showLevelResults).toHaveBeenCalledWith(expect.objectContaining({
            stars: 3, bonuses: [true],
        }), session);
    });

    it('reads the live deadline before accepting a goal between interval timer updates', async () => {
        const config = {
            ...getLevelById(1),
            victory: {
                ...getLevelById(1).victory,
                failure: { type: 'time', value: 1 },
            },
        };
        const harness = createMode(config);
        const { mode, session } = harness;
        mode.levelStartTime = 1000000;
        vi.spyOn(Date, 'now').mockReturnValue(1001001);
        session.hybridEngine.victoryEvaluator.onLineClear(20);
        session.hybridEngine.updateTime(0.9);
        mode._checkVictoryConditions(session);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).toHaveBeenCalledWith('time');
        await finishUi(harness, false);
    });

    beforeEach(() => {
        createFailureModal.mockClear();
        const storage = new Map();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => storage.get(key) ?? null),
            setItem: vi.fn((key, value) => storage.set(key, String(value))),
            removeItem: vi.fn((key) => storage.delete(key)),
        });
        vi.stubGlobal('window', { location: { search: '' }, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal('document', {
            body: { appendChild: vi.fn() },
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('completes no-lap solo goals after physics settles and persists a single completion', async () => {
        const harness = createMode();
        const { mode, session, frameRateController } = harness;
        mode._startGameLoop(session);
        const callbacks = mode._getPhysicsCallbacks(session);
        session.gameState.isProcessingPhysics = true;
        callbacks.onLineClear(20);
        frameRateController.render();

        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(session.hybridEngine.getMetrics().lines).toBe(20);

        session.gameState.score = 12000;
        session.gameState.isProcessingPhysics = false;
        frameRateController.render();
        frameRateController.render();

        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        expect(session.retired).toBe(true);
        expect(session.gameState.victoryLapActive).toBeFalsy();
        await finishUi(harness, true);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledTimes(1);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledWith(1, expect.objectContaining({
            score: 12000, lines: 20,
        }));
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
        expect(mode._showLevelResults).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['several short chains', [2, 2, 2], 2],
        ['one deeper chain', [2, 3, 4, 5], 5],
    ])('persists the peak chain, rewards, and one attempt after %s', async (_label, waves, peak) => {
        const harness = createMode(getLevelById(1), { persistResults: true });
        const { mode, session } = harness;
        const callbacks = mode._getPhysicsCallbacks(session);
        // Exercise the live metric/result/save boundary; the callback sequence
        // is prepared input, not a claim about an authored-start playing strategy.
        for (const wave of waves) {
            callbacks.triggerCombo(wave);
            callbacks.triggerCascadeWave(wave);
        }
        for (let clear = 0; clear < 5; clear++) callbacks.onLineClear(4);
        session.gameState.score = 12000;
        session.hybridEngine.updateTime(40);
        expect(session.hybridEngine.getMetrics()).toMatchObject({
            combos: waves.length, maxCombo: peak, maxCascadeDepth: peak,
        });

        mode._checkVictoryConditions(session);
        mode._checkVictoryConditions(session);
        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        await finishUi(harness, true);

        expect(mode._showLevelResults).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            combo: peak, maxCascadeDepth: peak, stars: 3, bonuses: [true],
        }), session);
        const reloaded = new OdysseyStateManager();
        expect(reloaded.statistics).toMatchObject({
            totalAttempts: 1,
            highestCombo: peak,
            maxCascadeDepth: peak,
            totalLinesCleared: 20,
            totalScore: 12000,
            totalStars: 3,
        });
        expect(reloaded.getLevelCompletion(1)).toMatchObject({
            stars: 3, bestScore: 12000, bestTime: 40, completedBonuses: [true], attempts: 1,
        });
        expect(reloaded.isLevelUnlocked(2)).toBe(true);
    });

    it('keeps authored showcase goals playable until the player finishes the victory lap', async () => {
        const harness = createMode(getLevelById(34));
        const { mode, session } = harness;
        for (let sequence = 0; sequence < session.levelConfig.victory.primary.target; sequence++) {
            session.hybridEngine.victoryEvaluator.onCascade(4);
        }
        mode._checkVictoryConditions(session);
        mode._checkVictoryConditions(session);

        expect(session.gameState.goalComplete).toBe(true);
        expect(session.gameState.victoryLapActive).toBe(true);
        expect(mode._showGoalCompleteOverlay).toHaveBeenCalledTimes(1);
        expect(mode.completeLevel).not.toHaveBeenCalled();

        mode._finishVictoryLap();
        await finishUi(harness, true);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledTimes(1);
    });

    it('accepts the Electric Apex goal at 200 seconds and preserves its showcase beyond the deadline', async () => {
        const harness = createMode(getLevelById(59));
        const { mode, session } = harness;
        mode.levelStartTime = 1000000;
        const now = vi.spyOn(Date, 'now').mockReturnValue(1200000);
        session.gameState.score = session.levelConfig.victory.primary.target;
        session.gameState.isProcessingPhysics = true;
        mode._checkVictoryConditions(session);
        expect(session.gameState.goalComplete).toBeFalsy();

        session.gameState.isProcessingPhysics = false;
        mode._checkVictoryConditions(session);
        mode._checkVictoryConditions(session);
        expect(session.gameState.goalComplete).toBe(true);
        expect(session.gameState.victoryLapActive).toBe(true);
        expect(mode._showGoalCompleteOverlay).toHaveBeenCalledTimes(1);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).not.toHaveBeenCalled();

        now.mockReturnValue(1211000);
        session.gameState.score += 5000;
        mode._checkVictoryConditions(session);
        mode._checkVictoryConditions(session);
        expect(session.hybridEngine.getMetrics().time).toBe(211);
        expect(session.gameState.victoryLapActive).toBe(true);
        expect(mode._showGoalCompleteOverlay).toHaveBeenCalledTimes(1);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).not.toHaveBeenCalled();
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();

        mode._finishVictoryLap();
        mode._finishVictoryLap();
        mode._checkVictoryConditions(session);
        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        await finishUi(harness, true);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledTimes(1);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledWith(59, expect.objectContaining({
            score: 165000, time: 211, stars: 1,
        }));
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
        expect(mode._showLevelResults).toHaveBeenCalledTimes(1);
    });

    it('evaluates score after all cascade callbacks and includes the final bonus in results', async () => {
        const level = structuredClone(getLevelById(14));
        level.victory.primary.target = 1000;
        const harness = createMode(level);
        const { mode, session } = harness;
        const callbacks = mode._getPhysicsCallbacks(session);
        session.gameState.isProcessingPhysics = true;
        session.gameState.score = 800;
        callbacks.onLineClear(4);
        mode._checkVictoryConditions(session);
        session.gameState.score = 1300;
        callbacks.onPerfectClear(4, 500);
        mode._checkVictoryConditions(session);

        expect(mode.completeLevel).not.toHaveBeenCalled();
        session.gameState.isProcessingPhysics = false;
        mode._checkVictoryConditions(session);
        await finishUi(harness, true);
        expect(mode._showLevelResults).toHaveBeenCalledWith(expect.objectContaining({ score: 1300 }), session);
    });

    it('treats a timed board top-out as a top-out failure and records one attempt', async () => {
        const harness = createMode(getLevelById(51));
        const { mode, session } = harness;
        session.hybridEngine.updateTime(10);
        session.gameState.isGameOver = true;
        mode._checkVictoryConditions(session);
        await mode._handleGameOver(session);
        mode._checkVictoryConditions(session);

        expect(mode.failLevel).toHaveBeenCalledTimes(1);
        expect(mode.failLevel).toHaveBeenCalledWith('top-out');
        await finishUi(harness, false);
        expect(mode.odysseyState.recordAttempt).toHaveBeenCalledTimes(1);
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
    });

    it('records a loss when the terminal lock reaches the score but its next spawn tops out', async () => {
        const harness = createMode(getLevelById(49), { renderFailure: true });
        const { mode, session, frameRateController } = harness;
        const callbacks = prepareTerminalLock(harness, { blockedSpawn: true });
        const { target } = session.levelConfig.victory.primary;
        session.gameState.score = target - 25;
        mode._startGameLoop(session);
        frameRateController.render();
        expect(mode.completeLevel).not.toHaveBeenCalled();

        expect(hardDrop(session.gameState, null, callbacks)).toBe(true);
        await session.gameState.latestPhysicsPromise;
        expect(session.gameState.score).toBe(target + 25);
        expect(session.hybridEngine.getMetrics()).toMatchObject({ piecesPlaced: 1, lines: 0 });
        expect(session.gameState.isGameOver).toBe(true);
        expect(session.gameState.goalComplete).toBeFalsy();
        expect(mode.failLevel).toHaveBeenCalledExactlyOnceWith('top-out');
        frameRateController.render();
        await mode._handleGameOver(session);

        expect(mode.failLevel).toHaveBeenCalledTimes(1);
        expect(mode.failLevel).toHaveBeenCalledWith('top-out');
        const view = await finishFailureView(harness);
        expect(view).toMatchObject({
            failureReason: 'top-out',
            metrics: { score: target + 25, piecesPlaced: 1, lines: 0 },
        });
        expect(view.levelConfig).toBe(session.levelConfig);
        expect(mode.odysseyState.recordAttempt).toHaveBeenCalledExactlyOnceWith(49);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
    });

    it('builds the retry debrief from the drained attempt and freezes its clock at failure', async () => {
        const harness = createMode(getLevelById(51), { renderFailure: true });
        const { mode, session } = harness;
        const physics = deferred();
        session.hybridEngine.victoryEvaluator.onLineClear(12);
        session.hybridEngine.updateScore(100);
        session.hybridEngine.updateTime(10);
        session.gameState.score = 4300;
        // An in-flight lock may finish scoring after retirement, before the view opens.
        session.gameState.latestPhysicsPromise = physics.promise.then(() => {
            session.gameState.score = 4875;
        });
        mode.levelStartTime = 1000000;
        mode.levelPausedMs = 12000;
        mode._pauseStartedAt = 1040000;
        const now = vi.spyOn(Date, 'now').mockReturnValue(1047000);

        mode.failLevel('top-out');
        expect(session.retired).toBe(true);
        expect(createFailureModal).not.toHaveBeenCalled();
        expect(session.hybridEngine.getMetrics().time).toBe(28);

        // The retired session owns the debrief even if current-mode mirrors change.
        mode.currentLevelId = 1;
        mode.currentLevelConfig = getLevelById(1);
        mode.gameState = { score: 999999 };
        mode.hybridEngine = { getMetrics: () => ({ score: 999999, time: 999, lines: 999 }) };
        now.mockReturnValue(1070000);
        physics.resolve();
        const view = await finishFailureView(harness);

        expect(view.levelConfig).toBe(session.levelConfig);
        expect(view).toMatchObject({
            failureReason: 'top-out',
            metrics: { score: 4875, time: 28, lines: 12 },
            includeLegacyResults: true,
        });
        expect(mode.odysseyState.recordAttempt).toHaveBeenCalledExactlyOnceWith(51);
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
    });

    it('keeps the fixed simulation clock and unranked status in the retry debrief', async () => {
        const harness = createMode(getLevelById(2), { fixed: true, renderFailure: true });
        const { mode, session } = harness;
        session.hybridEngine.updateTime(17.5);
        mode.levelStartTime = 1000000;
        vi.spyOn(Date, 'now').mockReturnValue(1080000);

        mode.failLevel('time');
        const view = await finishFailureView(harness);

        expect(view).toMatchObject({
            failureReason: 'time',
            metrics: { time: 17.5 },
            includeLegacyResults: false,
        });
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
    });

    it('completes once when the same score-crossing lock permits its next spawn', async () => {
        const harness = createMode(getLevelById(49));
        const { mode, session, frameRateController } = harness;
        const callbacks = prepareTerminalLock(harness);
        const { target } = session.levelConfig.victory.primary;
        session.gameState.score = target - 25;
        mode._startGameLoop(session);
        frameRateController.render();
        expect(mode.completeLevel).not.toHaveBeenCalled();

        expect(hardDrop(session.gameState, null, callbacks)).toBe(true);
        await session.gameState.latestPhysicsPromise;
        expect(session.gameState.score).toBe(target + 25);
        expect(session.hybridEngine.getMetrics()).toMatchObject({ piecesPlaced: 1, lines: 0 });
        expect(session.gameState.isGameOver).toBe(false);
        expect(session.gameState.currentPiece.shapeKey).toBe('O');
        frameRateController.render();
        frameRateController.render();

        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        await finishUi(harness, true);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledExactlyOnceWith(49, expect.objectContaining({
            score: target + 25, stars: 1, bonuses: [false, false],
        }));
        expect(mode.failLevel).not.toHaveBeenCalled();
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
    });

    it.each([55, 59])('preserves orb %i showcase rewards when a later real spawn tops out', async (levelId) => {
        const harness = createMode(getLevelById(levelId));
        const { mode, session, frameRateController } = harness;
        const { gameState, hybridEngine, levelConfig } = session;
        gameState.score = levelConfig.victory.primary.target;
        hybridEngine.updateTime(levelConfig.victory.failure.value - 1);
        mode._checkVictoryConditions(session);
        expect(gameState.goalComplete).toBe(true);
        expect(gameState.victoryLapActive).toBe(true);
        expect(mode.completeLevel).not.toHaveBeenCalled();

        // Synthetic prior achievements test retention, not mastery feasibility.
        const tier = levelConfig.stars.three;
        gameState.score = tier.score;
        for (let sequence = 0; sequence < tier.cascades; sequence++) {
            hybridEngine.victoryEvaluator.onCascade(tier.combo);
        }
        hybridEngine.victoryEvaluator.onCombo(tier.combo);
        hybridEngine.updateTime(levelConfig.victory.failure.value + 1);
        const expectedBonuses = levelId === 55 ? [true, true, false, true] : [true, true, true];
        expect(hybridEngine.calculateStars()).toBe(3);
        expect(hybridEngine.evaluateBonuses()).toEqual(expectedBonuses);
        mode._checkVictoryConditions(session);
        expect(mode.failLevel).not.toHaveBeenCalled();

        const callbacks = prepareTerminalLock(harness, { blockedSpawn: true });
        mode._startGameLoop(session);
        expect(hardDrop(gameState, null, callbacks)).toBe(true);
        await gameState.latestPhysicsPromise;
        expect(gameState.isGameOver).toBe(true);
        expect(gameState.victoryLapActive).toBe(false);
        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        frameRateController.render();
        await mode._handleGameOver(session);
        mode._finishVictoryLap();

        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        await finishUi(harness, true);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledExactlyOnceWith(levelId, expect.objectContaining({
            score: tier.score + 50,
            time: levelConfig.victory.failure.value + 1,
            stars: 3,
            bonuses: expectedBonuses,
            cascades: tier.cascades,
            maxCascadeDepth: tier.combo,
        }));
        expect(mode.failLevel).not.toHaveBeenCalled();
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
    });

    it('rejects a primary goal reached after its deadline and fences later callbacks', async () => {
        const harness = createMode(getLevelById(51));
        const { mode, session } = harness;
        const callbacks = mode._getPhysicsCallbacks(session);
        session.gameState.isProcessingPhysics = true;
        session.hybridEngine.updateTime(session.levelConfig.victory.failure.value + 0.01);
        callbacks.onLineClear(session.levelConfig.victory.primary.target);
        mode._checkVictoryConditions(session);
        expect(mode.failLevel).not.toHaveBeenCalled();

        session.gameState.isProcessingPhysics = false;
        mode._checkVictoryConditions(session);
        callbacks.onLineClear(4);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).toHaveBeenCalledWith('time');
        expect(session.hybridEngine.getMetrics().lines).toBe(session.levelConfig.victory.primary.target);
        await finishUi(harness, false);
        expect(mode.odysseyState.recordAttempt).toHaveBeenCalledTimes(1);
    });

    it('restarts an individual unassisted duel top-out without ending the orb', async () => {
        const harness = createMode(getLevelById(4));
        const { mode, session } = harness;
        await mode._handleGameOver(session);
        session.duel.update(100, 16, {});
        await session.duel.transition;
        mode._checkVictoryConditions(session);

        expect(session.duel.multiplayer.frags).toEqual([0, 0]);
        expect(session.duel.multiplayer.deaths).toEqual([1, 0]);
        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).not.toHaveBeenCalled();

        nextRound(session);
        expect(session.duel.round).toBe(2);
        expect(session.gameState.isGameOver).toBe(false);
        expect(session.gameState.isAlive).toBe(true);
        expect(mode._hookInputs).toHaveBeenCalledTimes(1);
        session.duel.stop();
    });

    it('completes the duel only at seven credited human frags and retains the match result', async () => {
        const harness = createMode(getLevelById(4));
        const { mode, session } = harness;
        for (let frag = 1; frag <= 7; frag++) {
            session.gameState.score = frag * 100;
            // Each completed round must settle before the next round can start.
            // eslint-disable-next-line no-await-in-loop
            await resolveDeath(session, 1, 0);
            mode._checkVictoryConditions(session);
            if (frag < 7) {
                expect(mode.completeLevel).not.toHaveBeenCalled();
                expect(mode.failLevel).not.toHaveBeenCalled();
                nextRound(session);
            }
        }
        mode._checkVictoryConditions(session);
        expect(mode.completeLevel).toHaveBeenCalledTimes(1);
        await finishUi(harness, true);

        const result = mode._showLevelResults.mock.calls[0][0];
        expect(result).toMatchObject({
            score: 2800,
            stars: 3,
            duel: {
                playerFrags: 7, botFrags: 0, targetFrags: 7, deaths: 0, difficulty: 1,
            },
        });
        expect(result.duel.botGrid).toBeUndefined();
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledTimes(1);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledWith(4, result);
        expect(mode.odysseyState.recordAttempt).not.toHaveBeenCalled();
    });

    it.each([false, true])('fails a duel at the bot target, with simultaneous seventh frags draw=%s', async (draw) => {
        const harness = createMode(getLevelById(4));
        const { mode, session } = harness;
        session.duel.multiplayer.frags = draw ? [6, 6] : [0, 6];
        session.duel.multiplayer.lastAttackerIds = [1, draw ? 0 : null];
        await mode._handleGameOver(session);
        if (draw) session.duel.markTopOut(1);
        session.duel.update(100, 16, {});
        await session.duel.transition;
        mode._checkVictoryConditions(session);
        mode._checkVictoryConditions(session);

        expect(mode.completeLevel).not.toHaveBeenCalled();
        expect(mode.failLevel).toHaveBeenCalledTimes(1);
        expect(mode.failLevel).toHaveBeenCalledWith(draw ? 'draw' : 'bot');
        await finishUi(harness, false);
        expect(mode.odysseyState.recordAttempt).toHaveBeenCalledTimes(1);
        expect(mode._showLevelFailure).toHaveBeenCalledWith(draw ? 'draw' : 'bot', session);
        expect(session.duel.getResult().botFrags).toBe(7);
    });

    it('uses legacy timing for a requested fixed-tick duel and preserves the fixed clock for the next solo orb', () => {
        const { mode, session, frameRateController } = createMode(getLevelById(4), { fixed: true });
        expect(mode._activationSimulationClock).toBe(DEMO_FIXED_SIMULATION_CLOCK);
        expect(session.simulationClock).toBe(DEMO_LEGACY_SIMULATION_CLOCK);
        mode._startGameLoop(session);
        expect(frameRateController.startHybridLoop).toHaveBeenCalledTimes(1);
        expect(mode._fixedTickLoop).toBeNull();

        mode._retireLevelSession(session);
        const solo = getLevelById(2);
        mode.currentLevelId = solo.id;
        mode.currentLevelConfig = solo;
        window.location.search = '?fixedTick=0';
        mode._createGameStateForLevel(solo, 2, 1234);

        expect(mode._fixedTickEnabled).toBe(true);
        expect(mode._activeLevelSession.simulationClock).toBe(DEMO_FIXED_SIMULATION_CLOCK);
        expect(mode._activeLevelSession.gameState.rngDescriptor).toBeTruthy();
    });
});
