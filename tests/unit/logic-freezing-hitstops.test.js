import {
    describe, expect, it, vi,
} from 'vitest';
import { GameState, updateGame } from '../../src/core/game.js';
import { UnifiedMultiplayerLoop } from '../../src/core/multiplayer/unified-game-loop.js';

describe('Logic-Freezing Hit-Stops', () => {
    it('initializes hitStopRemaining to 0', () => {
        const state = new GameState();
        expect(state.hitStopRemaining).toBe(0);
    });

    it('decrements hitStopRemaining and returns early during updateGame', () => {
        const state = new GameState();
        state.hitStopRemaining = 100;
        state.lastTime = 0;
        state.isPaused = false;
        state.isGameOver = false;

        const drawCallback = vi.fn();
        const updateStatsCallback = vi.fn();

        updateGame(50, state, {
            drawCallback,
            updateStatsCallback,
        });

        expect(state.hitStopRemaining).toBe(50);
        expect(drawCallback).toHaveBeenCalled();
        expect(updateStatsCallback).toHaveBeenCalled();
    });

    it('decrements hitStopRemaining and early returns in UnifiedMultiplayerLoop updatePlayers', () => {
        const loop = new UnifiedMultiplayerLoop();
        const stateMock = {
            hitStopRemaining: 100,
            isProcessingPhysics: false,
            currentPiece: {},
        };

        const physicsMock = {};
        loop.registerPlayer(1, stateMock, physicsMock, null);

        loop.updatePlayers(40);

        expect(stateMock.hitStopRemaining).toBe(60);
    });
});
