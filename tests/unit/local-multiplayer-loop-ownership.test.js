import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';

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

describe('LocalMultiplayerMode loop ownership', () => {
    afterEach(() => {
        moduleMocks.spawnPiece.mockReset();
        moduleMocks.transitionCountdown.mockReset();
        vi.unstubAllGlobals();
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

        const startPromise = mode.onStart();
        await vi.waitFor(() => expect(moduleMocks.transitionCountdown).toHaveBeenCalledOnce());
        const stagedState = mode.multiplayerState;

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
});
