/**
 * The legacy Local Multiplayer loop treats a stalled frame like single player does
 * (gameplay-frame-tail-hardening.test.js §4; audit 2026-10-13: INPUT-11). DAS and
 * gravity advance by at most MAX_SIMULATION_DELTA_MS per frame, so a hitch cannot
 * teleport a held piece. Wall-clock timers still see the real elapsed time.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { startLocalMultiplayerModeLoop } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { MAX_SIMULATION_DELTA_MS } from '../../src/core/game.js';
import { createBoardGrid } from '../../src/core/board.js';

let frame;
let updateDAS;

beforeEach(() => {
    frame = null;
    updateDAS = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback) => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('window', {
        inputController: { updateDAS },
        gamepadController: { advanceGameplayInput: vi.fn() },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function fallingPlayer(overrides = {}) {
    return {
        isAlive: true,
        hitStopRemaining: 0,
        isProcessingPhysics: false,
        currentPiece: { shape: [[1]], x: 0, y: 0 },
        boardGrid: createBoardGrid(),
        lockedPieces: [],
        dropCounter: 0,
        dropInterval: 1000,
        blindTimers: null,
        ...overrides,
    };
}

/** Start the legacy loop with its previous frame at t = 1000 ms. */
function startLoop(players) {
    const mode = {
        _gameLoopGeneration: 0,
        isRunning: true,
        multiplayerState: {
            isGameOver: false,
            isPaused: false,
            lastTime: 1000,
            numPlayers: players.length,
            players,
            playerPaused: players.map(() => false),
        },
        matchConfig: {},
        deps: { soundManager: { sfxPlayer: { playDrop: vi.fn() } } },
        botManager: { update: vi.fn() },
        _localSimulationLoop: { fixedTickEnabled: false, transitionGeneration: 0 },
        _getPhysicsCallbacks: () => null,
        _updateMultiplayerStats: vi.fn(),
        _syncBoardScenes: vi.fn(),
    };
    startLocalMultiplayerModeLoop(mode);
    return mode;
}

describe('Local Multiplayer legacy loop frame clamp', () => {
    it('clamps a stalled frame for DAS and gravity, as single player does', () => {
        const player = fallingPlayer();
        startLoop([player]);

        frame(1500); // a 500 ms hitch

        expect(updateDAS).toHaveBeenCalledExactlyOnceWith(MAX_SIMULATION_DELTA_MS);
        expect(player.dropCounter).toBe(MAX_SIMULATION_DELTA_MS);
        expect(player.currentPiece.y).toBe(0);
    });

    it('leaves ordinary frames untouched', () => {
        const player = fallingPlayer();
        startLoop([player]);

        frame(1016);

        expect(updateDAS).toHaveBeenCalledExactlyOnceWith(16);
        expect(player.dropCounter).toBe(16);
    });

    it('expires wall-clock timers on the real elapsed time', () => {
        const stopped = fallingPlayer({ hitStopRemaining: 70 });
        const blinded = fallingPlayer({ blindTimers: { field: 1, fieldMax: 1, pending: 0, pendingMax: 0 } });
        const mode = startLoop([stopped, blinded]);

        frame(1108);

        expect(stopped.hitStopRemaining).toBe(0);
        expect(blinded.blindTimers.field).toBeCloseTo(1 - 0.108, 6);
        expect(mode.botManager.update).toHaveBeenCalledExactlyOnceWith(108, 1108);
    });
});
