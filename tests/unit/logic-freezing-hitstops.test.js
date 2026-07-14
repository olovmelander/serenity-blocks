import {
    describe, expect, it, vi,
} from 'vitest';
import {
    consumeFixedHitStopTick,
    GameState,
    updateGame,
} from '../../src/core/game.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { UnifiedMultiplayerLoop } from '../../src/core/multiplayer/unified-game-loop.js';

describe('Logic-Freezing Hit-Stops', () => {
    it('initializes hitStopRemaining to 0', () => {
        const state = new GameState();
        expect(state.hitStopRemaining).toBe(0);
        expect(state.hitStopTicks).toBe(0);
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

    it.each([
        [30, 2],
        [70, 5],
        [110, 7],
    ])('quantizes %ims upward to %i complete frozen ticks', (durationMs, expectedTicks) => {
        const state = new GameState();
        state.hitStopRemaining = durationMs;

        for (let tick = 0; tick < expectedTicks; tick += 1) {
            expect(consumeFixedHitStopTick(state)).toBe(true);
            expect(state.hitStopTicks).toBe(expectedTicks - tick - 1);
        }

        expect(state.hitStopRemaining).toBe(0);
        expect(consumeFixedHitStopTick(state)).toBe(false);
    });

    it('re-quantizes a direct millisecond producer write after fixed ticking began', () => {
        const state = new GameState();
        state.hitStopRemaining = 30;
        consumeFixedHitStopTick(state);
        expect(state.hitStopTicks).toBe(1);

        state.hitStopRemaining = 110;
        expect(consumeFixedHitStopTick(state)).toBe(true);
        expect(state.hitStopTicks).toBe(6);
    });

    it('re-quantizes the remaining duration when the canonical tick changes', () => {
        const state = new GameState();
        state.hitStopRemaining = 70;
        consumeFixedHitStopTick(state);
        expect(state.hitStopTicks).toBe(4);

        state.simTickMs = 10;
        expect(consumeFixedHitStopTick(state)).toBe(true);
        expect(state.hitStopTicks).toBe(6);
        expect(state.hitStopRemaining).toBe(60);
    });

    it('round-trips exact tick state and backfills legacy demo snapshots', () => {
        const source = new GameState();
        source.hitStopRemaining = 70;
        consumeFixedHitStopTick(source);
        const snapshot = captureGameStateSnapshot(source);
        const restored = new GameState();

        restoreGameStateSnapshot(restored, snapshot);
        expect(restored.hitStopTicks).toBe(4);
        expect(restored.hitStopRemaining).toBeCloseTo(4 * (1000 / 60), 10);
        expect(consumeFixedHitStopTick(restored)).toBe(true);
        expect(restored.hitStopTicks).toBe(3);

        const explicitTicks = {
            ...snapshot,
            hitStopRemaining: 70,
            hitStopTicks: 4,
        };
        const explicitlyRestored = new GameState();
        restoreGameStateSnapshot(explicitlyRestored, explicitTicks);
        expect(explicitlyRestored.hitStopRemaining).toBe(70);
        expect(consumeFixedHitStopTick(explicitlyRestored)).toBe(true);
        expect(explicitlyRestored.hitStopTicks).toBe(3);
        expect(explicitlyRestored.hitStopRemaining).toBeCloseTo(3 * (1000 / 60), 10);

        const ticksOnly = new GameState();
        restoreGameStateSnapshot(ticksOnly, {
            ...snapshot,
            hitStopRemaining: 0,
            hitStopTicks: 4,
        });
        expect(consumeFixedHitStopTick(ticksOnly)).toBe(true);
        expect(ticksOnly.hitStopTicks).toBe(3);

        const explicitZero = new GameState();
        restoreGameStateSnapshot(explicitZero, {
            ...snapshot,
            hitStopRemaining: 70,
            hitStopTicks: 0,
        });
        expect(consumeFixedHitStopTick(explicitZero)).toBe(false);
        expect(explicitZero.hitStopRemaining).toBe(0);

        delete snapshot.hitStopTicks;
        snapshot.hitStopRemaining = 30;
        const legacy = new GameState();
        restoreGameStateSnapshot(legacy, snapshot);
        expect(legacy.hitStopTicks).toBe(2);
    });
});
