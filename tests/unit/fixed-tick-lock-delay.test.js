import { describe, expect, it } from 'vitest';
import {
    GameState,
    move,
    processAutoDrop,
    spawnPiece,
} from '../../src/core/game.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { FIXED_TICK_MS, planFixedTicks } from '../../src/core/fixed-tick-clock.js';

function createSpawnedState(options = {}) {
    const state = new GameState(options);
    state.nextPieces = ['O'];
    spawnPiece(state);
    return state;
}

function createGroundedState(options = {}) {
    const state = createSpawnedState(options);
    state.currentPiece.y = state.boardGrid.length - state.currentPiece.shape.length;
    return state;
}

function advanceFixedTick(state) {
    processAutoDrop(state, FIXED_TICK_MS, null, null, { fixedTick: true });
}

describe('dark fixed-tick lock delay', () => {
    it('initializes and resets integer lock timing state', () => {
        const state = new GameState({ lockDelay: 500 });

        expect(state.lockDelayTicks).toBe(30);
        expect(state.lockTimerTicks).toBe(0);

        state.lockTimer = 200;
        state.lockTimerTicks = 12;
        state.reset();

        expect(state.lockDelayTicks).toBe(30);
        expect(state.lockTimer).toBe(0);
        expect(state.lockTimerTicks).toBe(0);
    });

    it('locks on canonical tick 30 while retaining a millisecond compatibility mirror', () => {
        const state = createGroundedState({ lockDelay: 500 });

        for (let tick = 0; tick < 29; tick += 1) advanceFixedTick(state);

        expect(state.currentPiece).not.toBeNull();
        expect(state.lockTimerTicks).toBe(29);
        expect(state.lockTimer).toBeCloseTo(29 * FIXED_TICK_MS, 10);

        advanceFixedTick(state);

        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
    });

    it('quantizes a non-boundary duration upward so it never locks early', () => {
        const state = createGroundedState({ lockDelay: 20 });

        expect(state.lockDelayTicks).toBe(2);
        advanceFixedTick(state);
        expect(state.currentPiece).not.toBeNull();

        advanceFixedTick(state);
        expect(state.currentPiece).toBeNull();
    });

    it('arms a newly landed piece without consuming a lock tick', () => {
        const state = createSpawnedState({ lockDelay: 500 });
        state.currentPiece.y = state.boardGrid.length - state.currentPiece.shape.length - 1;
        state.dropInterval = 1;

        advanceFixedTick(state);

        expect(state.currentPiece).not.toBeNull();
        expect(state.isGrounded).toBe(true);
        expect(state.lockTimerTicks).toBe(0);

        advanceFixedTick(state);
        expect(state.lockTimerTicks).toBe(1);
    });

    it('resets both clocks after a successful grounded move', () => {
        const state = createGroundedState({ lockDelay: 500 });
        for (let tick = 0; tick < 20; tick += 1) advanceFixedTick(state);

        expect(move(state, -1)).toBe(true);

        expect(state.lockTimerTicks).toBe(0);
        expect(state.lockTimer).toBe(0);
        expect(state.lockResetCount).toBe(1);
    });

    it('preserves reset-cap semantics by locking on the next simulation update', () => {
        const state = createGroundedState({ lockDelay: 500, lockResetLimit: 1 });
        advanceFixedTick(state);

        expect(move(state, -1)).toBe(true);
        expect(state.currentPiece).not.toBeNull();
        expect(state.lockResetCount).toBe(1);

        advanceFixedTick(state);
        expect(state.currentPiece).toBeNull();
    });

    it('derives both gravity and lock timing from one canonical tick', () => {
        const state = createSpawnedState({ lockDelay: 500 });
        state.dropInterval = 10;
        state.simTickMs = 20;
        const startY = state.currentPiece.y;

        processAutoDrop(state, 999, null, null, { fixedTick: true });

        expect(state.currentPiece.y).toBe(startY + 2);
        expect(state.dropCounter).toBe(0);
        expect(state.lockDelayTicks).toBe(25);
    });

    it('refreshes duration ticks after the simulation tick duration changes', () => {
        const state = createGroundedState({ lockDelay: 500 });
        state.simTickMs = 10;

        for (let tick = 0; tick < 30; tick += 1) advanceFixedTick(state);

        expect(state.lockDelayTicks).toBe(50);
        expect(state.lockTimerTicks).toBe(30);
        expect(state.currentPiece).not.toBeNull();

        for (let tick = 30; tick < 50; tick += 1) advanceFixedTick(state);
        expect(state.currentPiece).toBeNull();
    });

    it.each([30, 60, 144])('locks on tick 30 when scheduled from %i Hz render cadence', (renderRate) => {
        const state = createGroundedState({ lockDelay: 500 });
        let accumulatorMs = 0;
        let ticks = 0;

        for (let frame = 0; frame < renderRate / 2; frame += 1) {
            const plan = planFixedTicks(accumulatorMs, 1000 / renderRate, { maxSteps: 5 });
            accumulatorMs = plan.remainderMs;
            for (let step = 0; step < plan.steps; step += 1) {
                advanceFixedTick(state);
                ticks += 1;
            }
        }

        expect(ticks).toBe(30);
        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
    });

    it('round-trips exact tick state and derives it for legacy snapshots', () => {
        const source = createGroundedState({ lockDelay: 500 });
        for (let tick = 0; tick < 17; tick += 1) advanceFixedTick(source);

        const snapshot = captureGameStateSnapshot(source);
        const restored = new GameState();
        restoreGameStateSnapshot(restored, snapshot);

        expect(restored.lockDelayTicks).toBe(30);
        expect(restored.lockTimerTicks).toBe(17);
        expect(restored.lockTimer).toBeCloseTo(17 * FIXED_TICK_MS, 10);

        delete snapshot.lockDelayTicks;
        delete snapshot.lockTimerTicks;
        snapshot.lockTimer = 275;

        const legacyRestored = new GameState();
        restoreGameStateSnapshot(legacyRestored, snapshot);

        expect(legacyRestored.lockDelayTicks).toBe(30);
        expect(legacyRestored.lockTimerTicks).toBe(16);
    });
});
