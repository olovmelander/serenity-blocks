import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';
import {
    captureLocalMultiplayerRound,
    ownsLocalMultiplayerRound,
} from '../../src/core/game-modes/local-multiplayer-loop.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';

const moduleMocks = vi.hoisted(() => ({
    spawnPiece: vi.fn(),
    transitionCountdown: vi.fn(),
}));

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));
vi.mock('../../src/ui/cinematic-loading-overlay.js', () => ({
    dismissCinematicLoadingOverlay: vi.fn(() => Promise.resolve()),
    showCinematicLoadingOverlay: vi.fn(),
    transitionCinematicLoadingOverlayToCountdown: moduleMocks.transitionCountdown,
}));
vi.mock('../../src/ui/intro-animation.js', () => ({
    introAnimation: { dismiss: vi.fn() },
}));
vi.mock('../../src/core/game.js', async () => ({
    ...await vi.importActual('../../src/core/game.js'),
    spawnPiece: moduleMocks.spawnPiece,
}));

function createFixedBatchMode(numPlayers = 2) {
    const mode = Object.create(LocalMultiplayerMode.prototype);
    mode.isRunning = true;
    mode.matchConfig = {
        endCondition: 'frags', endConditionValue: 7, isInfinityLMS: false, numPlayers,
    };
    mode.multiplayerState = new MultiPlayerState(numPlayers);
    mode.multiplayerState.setMatchConfig(mode.matchConfig);
    mode.multiplayerState.reset();
    mode._localSimulationLoop = { fixedTickEnabled: true, transitionGeneration: 3 };
    mode._showPlayerDeathAnimation = vi.fn();
    mode._showVictoryAnimation = vi.fn();
    mode._showMatchEnd = vi.fn(() => Promise.resolve());
    mode._startNewRound = vi.fn(() => Promise.resolve());
    mode.handleRoundEnd = vi.fn(() => Promise.resolve());
    const roundOwner = {
        generation: 3,
        multiplayerState: mode.multiplayerState,
        players: mode.multiplayerState.players.slice(),
        rngDescriptor: mode.multiplayerState.rngDescriptor,
    };
    return { mode, roundOwner };
}

describe('LocalMultiplayerMode loop ownership', () => {
    afterEach(() => {
        vi.useRealTimers();
        moduleMocks.spawnPiece.mockReset();
        moduleMocks.transitionCountdown.mockReset();
        vi.unstubAllGlobals();
    });

    it('binds explicit seed zero to one shared descriptor and player sequence', () => {
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.multiplayerState = new MultiPlayerState(4);

        const descriptor = mode._initializeSharedPieceRng(0);
        const projections = mode.multiplayerState.players.map((player) => ({
            bag: player.nextPieces.slice(),
            cursor: player.randomGenerator.getState(),
            sequence: Array.from({ length: 16 }, () => player.randomGenerator()),
        }));

        expect(descriptor).toEqual({
            algorithm: 'lcg-v1',
            seed: 0,
            stream: 'pieces:shared-v1',
        });
        expect(mode.multiplayerState.sharedPieceSeed).toBe(0);
        expect(mode.multiplayerState.rngDescriptor).toBe(descriptor);
        expect(mode.multiplayerState.players.every(
            (player) => player.rngDescriptor === descriptor,
        )).toBe(true);
        expect(projections.every((projection) => (
            JSON.stringify(projection) === JSON.stringify(projections[0])
        ))).toBe(true);
    });

    it('replaces reset RNG ownership and fences the captured predecessor', () => {
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.isRunning = true;
        mode._localSimulationLoop = { transitionGeneration: 4 };
        mode.multiplayerState = new MultiPlayerState(2);
        const firstDescriptor = mode._initializeSharedPieceRng(17);
        const captured = captureLocalMultiplayerRound(mode);

        expect(captured.rngDescriptor).toBe(firstDescriptor);
        expect(ownsLocalMultiplayerRound(mode, captured)).toBe(true);

        mode.multiplayerState.reset();
        expect(mode.multiplayerState.rngDescriptor).toBeNull();
        expect(mode.multiplayerState.sharedPieceSeed).toBe(0);
        expect(mode.multiplayerState.players.every(
            (player) => player.rngDescriptor === null,
        )).toBe(true);
        const replacementDescriptor = mode._initializeSharedPieceRng(23);

        expect(replacementDescriptor).not.toBe(firstDescriptor);
        expect(mode.multiplayerState.rngDescriptor).toBe(replacementDescriptor);
        expect(mode.multiplayerState.sharedPieceSeed).toBe(23);
        expect(ownsLocalMultiplayerRound(mode, captured)).toBe(false);
    });

    it('cancels and fences the paused predecessor before a round restart takes ownership', () => {
        let nextFrameId = 40;
        const scheduled = new Map();
        const requestAnimationFrame = vi.fn((callback) => {
            nextFrameId += 1;
            scheduled.set(nextFrameId, callback);
            return nextFrameId;
        });
        const cancelAnimationFrame = vi.fn((frameId) => {
            scheduled.delete(frameId);
        });
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.animationFrameId = null;
        mode._gameLoopGeneration = 0;
        mode.isRunning = true;
        mode.multiplayerState = {
            animationId: null,
            isGameOver: false,
            isPaused: true,
        };

        mode._startGameLoop();
        const firstOwner = mode.animationFrameId;
        const firstCallback = scheduled.get(firstOwner);
        scheduled.delete(firstOwner);
        firstCallback(10);
        const staleContinuation = mode.animationFrameId;
        const staleCallback = scheduled.get(staleContinuation);

        mode._startGameLoop();
        const activeOwner = mode.animationFrameId;

        expect(cancelAnimationFrame).toHaveBeenCalledWith(staleContinuation);
        expect(scheduled.size).toBe(1);
        expect([...scheduled.keys()]).toEqual([activeOwner]);

        staleCallback(20);
        expect(scheduled.size).toBe(1);

        const activeCallback = scheduled.get(activeOwner);
        scheduled.delete(activeOwner);
        activeCallback(20);
        expect(scheduled.size).toBe(1);
        expect(mode.animationFrameId).not.toBe(activeOwner);
    });

    it('also cancels rAF id zero instead of treating it as no owner', () => {
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.animationFrameId = 0;
        mode._gameLoopGeneration = 0;
        mode.isRunning = true;
        mode.multiplayerState = {
            animationId: 9,
            isGameOver: false,
            isPaused: true,
        };

        mode._startGameLoop();

        expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
        expect(cancelAnimationFrame).toHaveBeenCalledWith(9);
        expect(mode.multiplayerState.animationId).toBeNull();
        expect(mode.animationFrameId).toBe(1);
    });

    it('does not schedule a successor if ownership changes inside the active callback', () => {
        const scheduled = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            scheduled.push(callback);
            return scheduled.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.animationFrameId = null;
        mode._gameLoopGeneration = 0;
        mode.isRunning = true;
        mode.multiplayerState = { animationId: null, isGameOver: false };
        Object.defineProperty(mode.multiplayerState, 'isPaused', {
            get() {
                mode._gameLoopGeneration += 1;
                return true;
            },
        });

        mode._startGameLoop();
        expect(scheduled).toHaveLength(1);
        scheduled[0](10);

        expect(scheduled).toHaveLength(1);
    });

    it('does not spawn or start its loop when the countdown resolves after deactivation', async () => {
        let resolveCountdown;
        moduleMocks.transitionCountdown.mockImplementation(() => new Promise((resolve) => {
            resolveCountdown = resolve;
        }));
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });

        const playDrop = vi.fn();
        const playMove = vi.fn();
        const mode = new LocalMultiplayerMode({
            modalManager: { hideAll: vi.fn() },
            soundManager: { sfxPlayer: { playDrop, playMove } },
            themeManager: {},
        });
        mode.isActive = true;
        mode.configuredForStart = true;
        mode.matchConfig = { numPlayers: 2 };
        mode.boardScenes = [{}];
        mode._activatePhaserMultiplayerUI = vi.fn();
        mode._cleanupEventListeners = vi.fn();
        mode._clearDeathAnimations = vi.fn();
        mode._deactivatePhaserMultiplayerUI = vi.fn();
        mode._destroyMinimaps = vi.fn();
        mode._dismissMatchStartLoadingOverlay = vi.fn(() => Promise.resolve());
        mode._hideMultiplayerBoardsForCountdown = vi.fn();
        mode._removeInputWrappers = vi.fn();
        mode._resumeSinglePlayerScene = vi.fn();
        mode._revealMultiplayerBoardsForCountdown = vi.fn();
        mode._setupInputWrappers = vi.fn();
        mode._setupLocalBots = vi.fn();
        mode._startGameLoop = vi.fn();
        mode._syncBoardScenes = vi.fn();
        mode._updateMultiplayerStats = vi.fn();
        mode._waitForMatchStartLoadingOverlayMinVisible = vi.fn(() => Promise.resolve());

        const startPromise = mode.onStart({ seed: 0 });
        await vi.waitFor(() => expect(moduleMocks.transitionCountdown).toHaveBeenCalledOnce());
        const stagedState = mode.multiplayerState;
        expect(stagedState.sharedPieceSeed).toBe(0);
        expect(stagedState.rngDescriptor.seed).toBe(0);

        await mode.onDeactivate();
        const countdownOptions = moduleMocks.transitionCountdown.mock.calls[0][0];
        countdownOptions.onCount();
        countdownOptions.onGo();
        countdownOptions.onFirstCountVisible();
        resolveCountdown();
        await expect(startPromise).resolves.toBeUndefined();

        expect(moduleMocks.spawnPiece).not.toHaveBeenCalled();
        expect(mode._startGameLoop).not.toHaveBeenCalled();
        expect(playDrop).not.toHaveBeenCalled();
        expect(playMove).not.toHaveBeenCalled();
        expect(mode._revealMultiplayerBoardsForCountdown).not.toHaveBeenCalled();
        expect(stagedState.players.every((player) => player.currentPiece === null)).toBe(true);
        expect(mode.isActive).toBe(false);
        expect(mode.isRunning).toBe(false);
    });

    it('resolves simultaneous two-player fixed top-outs as a draw', async () => {
        vi.useFakeTimers();
        const { mode, roundOwner } = createFixedBatchMode();
        const checkWinCondition = vi.spyOn(mode.multiplayerState, 'checkWinCondition');

        const resolution = mode._handleFixedTickTopOutBatch([1, 0, 1], roundOwner);

        expect(mode.multiplayerState.players.map((player) => player.isAlive))
            .toEqual([false, false]);
        expect(mode.multiplayerState.isPaused).toBe(true);
        expect(mode._showPlayerDeathAnimation.mock.calls.map(([index]) => index))
            .toEqual([0, 1]);
        expect(mode._showVictoryAnimation).not.toHaveBeenCalled();
        expect(checkWinCondition).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(500);
        await expect(resolution).resolves.toBe(true);
        expect(mode._startNewRound).toHaveBeenCalledOnce();
        expect(mode.handleRoundEnd).not.toHaveBeenCalled();
    });

    it('ends a tied same-tick frag match as a draw instead of starting another round', async () => {
        vi.useFakeTimers();
        const { mode, roundOwner } = createFixedBatchMode();
        mode.matchConfig.endConditionValue = 1;
        mode.multiplayerState.setMatchConfig(mode.matchConfig);
        mode.multiplayerState.lastAttackerIds = [1, 0];

        const resolution = mode._handleFixedTickTopOutBatch([1, 0], roundOwner);
        await vi.advanceTimersByTimeAsync(500);
        await expect(resolution).resolves.toBe(true);

        expect(mode._showMatchEnd).toHaveBeenCalledWith('draw');
        expect(mode._startNewRound).not.toHaveBeenCalled();
        expect(mode.handleRoundEnd).not.toHaveBeenCalled();
    });

    it('awards a single fixed top-out to the surviving player', async () => {
        vi.useFakeTimers();
        const { mode, roundOwner } = createFixedBatchMode();
        mode.multiplayerState.lastAttackerIds[0] = 1;

        const resolution = mode._handleFixedTickTopOutBatch([0], roundOwner);

        expect(mode.multiplayerState.players.map((player) => player.isAlive))
            .toEqual([false, true]);
        expect(mode._showVictoryAnimation).toHaveBeenCalledWith(1);
        await vi.advanceTimersByTimeAsync(500);
        await expect(resolution).resolves.toBe(true);
        expect(mode.handleRoundEnd).toHaveBeenCalledWith('player2', false);
        expect(mode._startNewRound).not.toHaveBeenCalled();
    });

    it('resolves a two-death three-player batch to the sole survivor', async () => {
        vi.useFakeTimers();
        const { mode, roundOwner } = createFixedBatchMode(3);
        mode.multiplayerState.lastAttackerIds[0] = 2;
        mode.multiplayerState.lastAttackerIds[1] = 2;
        const checkWinCondition = vi.spyOn(mode.multiplayerState, 'checkWinCondition');

        const resolution = mode._handleFixedTickTopOutBatch([1, 0], roundOwner);

        expect(mode.multiplayerState.players.map((player) => player.isAlive))
            .toEqual([false, false, true]);
        expect(mode._showVictoryAnimation).toHaveBeenCalledWith(2);
        expect(checkWinCondition).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(500);
        await expect(resolution).resolves.toBe(true);
        expect(mode.handleRoundEnd).toHaveBeenCalledWith('player3', false);
        expect(mode._startNewRound).not.toHaveBeenCalled();
    });

    it('ignores a fixed top-out batch after its round ownership is stale', async () => {
        const { mode, roundOwner } = createFixedBatchMode();
        mode._localSimulationLoop.transitionGeneration += 1;

        await expect(mode._handleFixedTickTopOutBatch([0], roundOwner)).resolves.toBe(false);

        expect(mode.multiplayerState.players.every((player) => player.isAlive)).toBe(true);
        expect(mode._showPlayerDeathAnimation).not.toHaveBeenCalled();
    });

    it('does not build UI or start after a submitted configuration loses ownership', async () => {
        vi.useFakeTimers();
        const mode = new LocalMultiplayerMode({});
        mode.isActive = true;
        mode._setupMultiplayerUI = vi.fn(() => Promise.resolve());
        mode.onStart = vi.fn(() => Promise.resolve());
        const config = { numPlayers: 2 };

        const configuration = mode.handleConfigurationComplete(config);
        mode._startGeneration += 1;
        mode.isActive = false;
        await vi.runAllTimersAsync();
        await configuration;

        expect(mode._setupMultiplayerUI).not.toHaveBeenCalled();
        expect(mode.onStart).not.toHaveBeenCalled();
    });

    it('rolls back a partial configured start and restores its input wrappers', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('alert', vi.fn());
        const mode = new LocalMultiplayerMode({});
        mode.isActive = true;
        mode._setupMultiplayerUI = vi.fn(() => Promise.resolve());
        mode._dismissMatchStartLoadingOverlay = vi.fn(() => Promise.resolve());
        mode._removeInputWrappers = vi.fn();
        mode.onStart = vi.fn(async () => {
            mode.isRunning = true;
            throw new Error('loop startup failed');
        });
        const config = { numPlayers: 2 };

        const configuration = mode.handleConfigurationComplete(config);
        await vi.runAllTimersAsync();
        await configuration;

        expect(mode.isRunning).toBe(false);
        expect(mode.configuredForStart).toBe(false);
        expect(mode._removeInputWrappers).toHaveBeenCalledOnce();
        expect(mode._dismissMatchStartLoadingOverlay).toHaveBeenCalledOnce();
        expect(alert).toHaveBeenCalledWith(
            'Failed to start local multiplayer match: loop startup failed',
        );
    });

    it.each([
        ['points', 'score', 3000],
        ['lines', 'totalLinesCleared', 3],
    ])('allows player four to satisfy a %s match target', (endCondition, field, value) => {
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode.matchConfig = {
            endCondition,
            endConditionValue: 3,
            numPlayers: 4,
        };
        mode.matchStats = {
            player1: { lines: 0, score: 0 },
            player2: { lines: 0, score: 0 },
            player3: { lines: 0, score: 0 },
            player4: { lines: 0, score: 0 },
        };
        mode.multiplayerState = {
            players: Array.from({ length: 4 }, () => ({
                score: 0,
                totalLinesCleared: 0,
            })),
        };
        mode.multiplayerState.players[3][field] = value;

        expect(mode._checkMatchWinCondition('player1')).toBe(true);
    });
});
