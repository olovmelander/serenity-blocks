import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    GameState,
    move,
    pauseGame,
    processAutoDrop,
    resumeGame,
    spawnPiece,
    updateGame,
} from '../../src/core/game.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';

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

function advanceGravity(state, delta) {
    processAutoDrop(state, delta, null, null);
}

describe('lock-delay timing characterization', () => {
    it('keeps a grounded piece movable through 499 ms and locks at 500 ms', () => {
        const state = createGroundedState({ lockDelay: 500 });

        advanceGravity(state, 499);

        expect(state.currentPiece).not.toBeNull();
        expect(state.lockTimer).toBe(499);
        expect(state.isGrounded).toBe(true);

        advanceGravity(state, 1);

        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
        expect(state.lockTimer).toBe(0);
        expect(state.isGrounded).toBe(false);
    });

    it.each([
        [30, 16],
        [60, 30],
        [144, 72],
    ])('pins the legacy float threshold at %i Hz', (renderRate, framesUntilLock) => {
        const state = createGroundedState({ lockDelay: 500 });
        const frameDelta = 1000 / renderRate;

        for (let frame = 0; frame < framesUntilLock - 1; frame += 1) {
            advanceGravity(state, frameDelta);
        }

        expect(state.currentPiece).not.toBeNull();

        advanceGravity(state, frameDelta);

        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
    });

    it('resets elapsed lock time after a successful grounded move', () => {
        const state = createGroundedState({ lockDelay: 500 });

        advanceGravity(state, 400);
        expect(move(state, -1)).toBe(true);

        expect(state.lockTimer).toBe(0);
        expect(state.lockResetCount).toBe(1);
        expect(state.isGrounded).toBe(true);

        advanceGravity(state, 499);
        expect(state.currentPiece).not.toBeNull();

        advanceGravity(state, 1);
        expect(state.currentPiece).toBeNull();
    });

    it('forces a lock on the update after the configured reset cap is reached', () => {
        const state = createGroundedState({ lockDelay: 500, lockResetLimit: 1 });

        advanceGravity(state, 100);
        expect(move(state, -1)).toBe(true);
        expect(state.lockResetCount).toBe(1);
        expect(state.currentPiece).not.toBeNull();

        advanceGravity(state, 1);

        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
    });

    it.each([0, -1])('locks on the first positive update when lockDelay is %i', (lockDelay) => {
        const state = createGroundedState({ lockDelay });

        advanceGravity(state, 1);

        expect(state.currentPiece).toBeNull();
        expect(state.lockedPieces).toHaveLength(1);
    });

    it('preserves a mid-grounded lock state through a demo snapshot round trip', () => {
        const source = createGroundedState({ lockDelay: 500, lockResetLimit: 15 });
        advanceGravity(source, 275);
        source.lockResetCount = 3;

        const restored = new GameState();
        restoreGameStateSnapshot(restored, captureGameStateSnapshot(source));

        expect(restored.lockDelay).toBe(500);
        expect(restored.lockResetLimit).toBe(15);
        expect(restored.lockTimer).toBe(275);
        expect(restored.lockResetCount).toBe(3);
        expect(restored.isGrounded).toBe(true);
        expect(restored.lockGroundedSince).toBe(source.lockGroundedSince);
    });

    it('discards the wall-clock pause gap instead of advancing gameplay timers', () => {
        const state = createGroundedState({ lockDelay: 500 });
        state.lastTime = 100;
        state.hitStopRemaining = 70;
        state.blindTimers.field = 4;
        state.blindTimers.fieldMax = 4;

        advanceGravity(state, 200);
        pauseGame(state);
        updateGame(900, state);

        expect(state.lockTimer).toBe(200);
        expect(state.hitStopRemaining).toBe(70);
        expect(state.blindTimers.field).toBe(4);

        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        resumeGame(state);
        updateGame(1000, state);
        now.mockRestore();

        expect(state.lockTimer).toBe(200);
        expect(state.hitStopRemaining).toBe(70);
        expect(state.blindTimers.field).toBe(4);
    });
});

describe('auto-drop timing characterization', () => {
    it('preserves elapsed remainder across the gravity threshold', () => {
        const state = createSpawnedState();
        state.dropInterval = 100;
        const startY = state.currentPiece.y;

        advanceGravity(state, 99);
        expect(state.currentPiece.y).toBe(startY);
        expect(state.dropCounter).toBe(99);

        advanceGravity(state, 1);
        expect(state.currentPiece.y).toBe(startY + 1);
        expect(state.dropCounter).toBe(0);
    });

    it('runs multiple owed gravity steps and retains the sub-step remainder', () => {
        const state = createSpawnedState();
        state.dropInterval = 100;
        const startY = state.currentPiece.y;

        advanceGravity(state, 250);

        expect(state.currentPiece.y).toBe(startY + 2);
        expect(state.dropCounter).toBe(50);
    });
});
