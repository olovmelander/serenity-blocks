/* eslint-disable import/first */

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice { destroy() {} },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK,
} from '../../src/core/demo/DemoRecorder.js';

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function createMode(levelConfig = getLevelById(1), { fixed = false } = {}) {
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
    mode._showLevelFailure = vi.fn(() => ui.promise);
    mode._syncSteamStats = vi.fn().mockResolvedValue();
    mode.returnToBoard = vi.fn().mockResolvedValue();
    mode.odysseyState.completeLevel = vi.fn();
    mode.odysseyState.recordAttempt = vi.fn();
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

describe('OdysseyMode gameplay objectives', () => {
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
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(),
        });
        vi.stubGlobal('window', { location: { search: '' }, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal('document', {
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
