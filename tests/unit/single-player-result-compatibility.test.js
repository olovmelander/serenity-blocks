import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const moduleMocks = vi.hoisted(() => ({
    buildReplayProof: vi.fn(),
    incrementStat: vi.fn(),
    showGameOverModal: vi.fn(),
    uploadScore: vi.fn(),
}));

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

vi.mock('../../src/ui/modals.js', () => ({
    showDemoCompleteModal: vi.fn(),
    showGameOverModal: moduleMocks.showGameOverModal,
}));

vi.mock('../../src/core/anti-cheat/replay-proof.js', () => ({
    buildReplayProof: moduleMocks.buildReplayProof,
}));

vi.mock('../../src/core/steam/steam-service.js', () => ({
    default: {
        incrementStat: moduleMocks.incrementStat,
        uploadScore: moduleMocks.uploadScore,
    },
}));

const { GameState } = await import('../../src/core/game.js');
const {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} = await import('../../src/core/demo/DemoRecorder.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');
const {
    canWriteLegacySinglePlayerResults,
} = await import('../../src/core/game-modes/single-player-result-compatibility.js');

function createGameOverHarness(simulationClock) {
    const highScoreManager = {
        addScore: vi.fn().mockResolvedValue(undefined),
    };
    const mode = new SinglePlayerMode({
        frameRateController: { isRunning: false },
        highScoreManager,
        modalManager: {},
    });
    mode.isActive = true;
    mode.isRunning = true;
    mode.gameState = new GameState();
    mode.gameState.score = 4321;
    mode.gameState.lines = 17;
    mode.gameState.level = 4;
    mode.gameState.simFrame = 600;
    mode.gameState.simTimeMs = 10000;
    mode._fixedTickEnabled = simulationClock === DEMO_FIXED_SIMULATION_CLOCK;
    mode._sessionSimulationClock = simulationClock;
    mode._stopPhaserBoardScene = vi.fn();
    mode._sessionGeneration = 1;
    mode._activeSession = Object.freeze({
        generation: 1,
        gameState: mode.gameState,
        simulationClock,
    });

    const demo = {
        inputs: [{
            f: 1,
            t: 17,
            a: 'move',
            d: -1,
        }],
        metadata: {},
    };
    mode.isRecording = true;
    mode.demoRecorder.stopRecording = vi.fn(() => demo);
    mode._autoSaveDemo = vi.fn().mockResolvedValue(73);

    return {
        demo,
        highScoreManager,
        mode,
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {
        promise,
        reject,
        resolve,
    };
}

function prepareStartHarness(mode) {
    mode.deps.settingsManager = {
        get: vi.fn(() => ({
            autoRecordDemos: true,
            effectQuality: 'high',
            hitStopEnabled: true,
        })),
    };
    mode._prefersReducedMotion = vi.fn(() => false);
    mode._startPhaserBoardScene = vi.fn();
    mode._clearPhaserBoard = vi.fn();
    mode._applyEffectQuality = vi.fn();
    mode._refreshNextQueue = vi.fn();
    mode._updateStats = vi.fn();
    mode._startGameLoop = vi.fn();
    mode.demoRecorder.startRecording = vi.fn();
}

describe('single-player result compatibility', () => {
    beforeEach(() => {
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('CustomEvent', function CustomEvent(type, options) {
            this.type = type;
            this.detail = options?.detail;
        });
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        moduleMocks.buildReplayProof.mockResolvedValue({
            checksum32: 123,
            durationMs: 10000,
            hash: 'proof',
            inputCount: 1,
            issues: [],
            verified: true,
        });
        moduleMocks.incrementStat.mockResolvedValue(undefined);
        moduleMocks.showGameOverModal.mockResolvedValue(undefined);
        moduleMocks.uploadScore.mockResolvedValue(undefined);
    });

    afterEach(() => {
        Object.values(moduleMocks).forEach((mock) => mock.mockReset());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('fails closed for fixed and unknown clocks', () => {
        expect(canWriteLegacySinglePlayerResults(DEMO_LEGACY_SIMULATION_CLOCK)).toBe(true);
        expect(canWriteLegacySinglePlayerResults(DEMO_FIXED_SIMULATION_CLOCK)).toBe(false);
        expect(canWriteLegacySinglePlayerResults('future-clock-v3')).toBe(false);
        expect(canWriteLegacySinglePlayerResults(undefined)).toBe(false);
    });

    it('keeps legacy local, Steam, demo-save, and modal behavior', async () => {
        const { demo, highScoreManager, mode } = createGameOverHarness(
            DEMO_LEGACY_SIMULATION_CLOCK,
        );

        await mode._handleGameOver();
        await vi.waitFor(() => expect(moduleMocks.uploadScore).toHaveBeenCalledTimes(2));

        expect(mode.demoRecorder.stopRecording).toHaveBeenCalledOnce();
        expect(mode._autoSaveDemo).toHaveBeenCalledWith(demo);
        expect(highScoreManager.addScore).toHaveBeenCalledWith({
            score: 4321,
            lines: 17,
            level: 4,
            demoId: 73,
        });
        expect(moduleMocks.incrementStat).toHaveBeenCalledTimes(3);
        expect(moduleMocks.showGameOverModal).toHaveBeenCalledWith(
            mode.deps.modalManager,
            mode._stoppedSession.gameState,
            highScoreManager,
            expect.any(Object),
            expect.objectContaining({ includeLegacyResults: true }),
        );
        expect(Object.isFrozen(mode._stoppedSession)).toBe(true);
        expect(await mode.onStop()).toBe(mode._stoppedSession);
    });

    it.each([
        DEMO_FIXED_SIMULATION_CLOCK,
        'future-clock-v3',
    ])('saves the %s demo and shows unranked stats without legacy writes', async (simulationClock) => {
        const { demo, highScoreManager, mode } = createGameOverHarness(
            simulationClock,
        );

        await mode._handleGameOver();

        // Exercise the real lifecycle order: onStop retires the fixed runtime
        // before _handleGameOver reaches persistence, while the clock latch stays fixed.
        expect(mode._fixedTickEnabled).toBe(false);
        expect(mode._sessionSimulationClock).toBe(simulationClock);
        expect(mode.demoRecorder.stopRecording).toHaveBeenCalledOnce();
        expect(mode._autoSaveDemo).toHaveBeenCalledWith(demo);
        expect(mode.lastSavedDemoId).toBe(73);
        expect(highScoreManager.addScore).not.toHaveBeenCalled();
        expect(moduleMocks.buildReplayProof).not.toHaveBeenCalled();
        expect(moduleMocks.uploadScore).not.toHaveBeenCalled();
        expect(moduleMocks.incrementStat).not.toHaveBeenCalled();
        expect(moduleMocks.showGameOverModal).toHaveBeenCalledWith(
            mode.deps.modalManager,
            mode._stoppedSession.gameState,
            highScoreManager,
            expect.any(Object),
            expect.objectContaining({ includeLegacyResults: false }),
        );
        expect(window.dispatchEvent).toHaveBeenCalledOnce();
    });

    it('defends the Steam sink when called directly for a fixed session', async () => {
        const { mode } = createGameOverHarness(DEMO_FIXED_SIMULATION_CLOCK);

        await mode._syncSteamStats(Object.freeze({
            demo: null,
            demoId: null,
            gameState: mode.gameState,
            generation: 1,
            simulationClock: DEMO_FIXED_SIMULATION_CLOCK,
        }));

        expect(moduleMocks.buildReplayProof).not.toHaveBeenCalled();
        expect(moduleMocks.uploadScore).not.toHaveBeenCalled();
        expect(moduleMocks.incrementStat).not.toHaveBeenCalled();
    });

    it('drains captured physics before deactivation clears the exact state', async () => {
        const { mode } = createGameOverHarness(DEMO_LEGACY_SIMULATION_CLOCK);
        const physics = createDeferred();
        const stoppedState = mode.gameState;
        stoppedState.latestPhysicsPromise = physics.promise;
        stoppedState.isProcessingPhysics = true;
        mode.isRecording = false;

        const firstStop = mode.onStop();
        const repeatedStop = mode.onStop();
        const deactivation = mode.onDeactivate();

        expect(repeatedStop).toBe(firstStop);
        expect(mode.gameState).toBe(stoppedState);
        expect(mode.isActive).toBe(false);

        physics.resolve();
        const stoppedSession = await firstStop;
        await deactivation;

        expect(stoppedSession.gameState).toBe(stoppedState);
        expect(stoppedState.latestPhysicsPromise).toBeNull();
        expect(stoppedState.isProcessingPhysics).toBe(false);
        expect(mode.gameState).toBeNull();
        expect(await mode.onStop()).toBe(stoppedSession);
    });

    it('serializes a restart behind demo auto-save and preserves the stopped bundle', async () => {
        const { demo, mode } = createGameOverHarness(DEMO_LEGACY_SIMULATION_CLOCK);
        const autoSave = createDeferred();
        const stoppedState = mode.gameState;
        mode._autoSaveDemo = vi.fn(() => autoSave.promise);
        prepareStartHarness(mode);

        const stop = mode.onStop();
        await vi.waitFor(() => expect(mode._autoSaveDemo).toHaveBeenCalledWith(demo));

        const restart = mode.onStart();
        await Promise.resolve();

        expect(mode.gameState).toBe(stoppedState);
        expect(mode.demoRecorder.startRecording).not.toHaveBeenCalled();

        autoSave.resolve(73);
        const stoppedSession = await stop;
        await restart;

        expect(stoppedSession).toEqual(expect.objectContaining({
            demo,
            demoId: 73,
            gameState: stoppedState,
            generation: 1,
        }));
        expect(Object.isFrozen(stoppedSession)).toBe(true);
        expect(mode.gameState).not.toBe(stoppedState);
        expect(mode.gameState.isGameOver).toBe(false);
        expect(mode._activeSession).toEqual(expect.objectContaining({
            gameState: mode.gameState,
            generation: 2,
        }));
        expect(mode.demoRecorder.startRecording).toHaveBeenCalledOnce();
    });

    it('keeps an old result immutable when addScore overlaps a later session', async () => {
        const { demo, highScoreManager, mode } = createGameOverHarness(
            DEMO_LEGACY_SIMULATION_CLOCK,
        );
        const addScore = createDeferred();
        const stoppedState = mode.gameState;
        highScoreManager.addScore.mockImplementation(() => addScore.promise);
        prepareStartHarness(mode);

        const gameOver = mode._handleGameOver();
        await vi.waitFor(() => expect(highScoreManager.addScore).toHaveBeenCalledWith({
            score: 4321,
            lines: 17,
            level: 4,
            demoId: 73,
        }));

        await mode.onStart();
        const replacementState = mode.gameState;
        expect(replacementState).not.toBe(stoppedState);

        addScore.resolve();
        await gameOver;
        await vi.waitFor(() => expect(moduleMocks.uploadScore).toHaveBeenCalledTimes(2));

        expect(moduleMocks.buildReplayProof).toHaveBeenCalledWith(expect.objectContaining({
            demo,
            expectedScore: 4321,
            expectedLines: 17,
            expectedLevel: 4,
        }));
        expect(moduleMocks.uploadScore).toHaveBeenCalledWith(
            expect.any(String),
            4321,
            expect.objectContaining({ replayId: 73, score: 4321 }),
        );
        expect(moduleMocks.showGameOverModal).not.toHaveBeenCalled();
        expect(window.dispatchEvent).not.toHaveBeenCalled();
        expect(mode.gameState).toBe(replacementState);
        expect(replacementState.isGameOver).toBe(false);
    });

    it('does not leave a zombie running flag when deactivation lands during base start', async () => {
        const mode = new SinglePlayerMode({
            frameRateController: { isRunning: false },
            highScoreManager: { addScore: vi.fn() },
            modalManager: {},
        });
        mode.isActive = true;
        mode._stopPhaserBoardScene = vi.fn();
        prepareStartHarness(mode);

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
});
