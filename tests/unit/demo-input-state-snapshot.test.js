import {
    describe, expect, it,
} from 'vitest';
import { startDas } from '../../src/core/das.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { GameState } from '../../src/core/game.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';

describe('demo player-input snapshot state', () => {
    it('captures deeply and restores state without replacing its GameState-owned identity', () => {
        const source = new GameState({
            inputHandling: { dasDelay: 85, dasInterval: 25, softDropInterval: 10 },
        });
        startDas(source.playerInput.das.moveRight);
        source.playerInput.das.moveRight.delayAccumulator = 41;
        source.playerInput.das.moveRight.intervalAccumulator = 3;
        enqueueInputEdge(source.playerInput, {
            tick: 12, subframe: 4, action: 'move', value: 1, phase: 'up',
        });
        source.playerInput.overflowCount = 2;

        const snapshot = captureGameStateSnapshot(source);
        source.playerInput.config.dasDelay = 999;
        source.playerInput.pendingEdges[0].tick = 999;
        expect(snapshot.playerInput.config.dasDelay).toBe(85);
        expect(snapshot.playerInput.pendingEdges[0].tick).toBe(12);

        const target = new GameState();
        const identity = target.playerInput;
        restoreGameStateSnapshot(target, snapshot);

        expect(target.playerInput).toBe(identity);
        expect(target.playerInput).toEqual(snapshot.playerInput);
        snapshot.playerInput.pendingEdges[0].tick = 555;
        expect(target.playerInput.pendingEdges[0].tick).toBe(12);
    });

    it('accepts legacy snapshots without playerInput and clears stale holds safely', () => {
        const source = new GameState();
        const legacySnapshot = captureGameStateSnapshot(source);
        delete legacySnapshot.playerInput;

        const target = new GameState({ inputHandling: { dasDelay: 73 } });
        const identity = target.playerInput;
        startDas(target.playerInput.das.moveLeft);
        enqueueInputEdge(target.playerInput, {
            tick: 1, subframe: 0, action: 'move', value: -1, phase: 'up',
        });
        restoreGameStateSnapshot(target, legacySnapshot);

        expect(target.playerInput).toBe(identity);
        expect(target.playerInput.config.dasDelay).toBe(73);
        expect(target.playerInput.das.moveLeft.active).toBe(false);
        expect(target.playerInput.pendingEdges).toEqual([]);
    });

    it('can ignore serialized input state for accepted-command replay checkpoints', () => {
        const source = new GameState({ inputHandling: { dasDelay: 85 } });
        startDas(source.playerInput.das.moveRight);
        enqueueInputEdge(source.playerInput, {
            tick: 12, subframe: 0, action: 'move', value: 1, phase: 'up',
        });
        const snapshot = captureGameStateSnapshot(source);

        const target = new GameState({ inputHandling: { dasDelay: 73 } });
        const identity = target.playerInput;
        restoreGameStateSnapshot(target, snapshot, { restorePlayerInput: false });

        expect(target.playerInput).toBe(identity);
        expect(target.playerInput.config.dasDelay).toBe(73);
        expect(target.playerInput.das.moveRight.active).toBe(false);
        expect(target.playerInput.pendingEdges).toEqual([]);
    });

    it('restores the hit-stop policy while legacy snapshots preserve the target policy', () => {
        const source = new GameState({ hitStopEnabled: false });
        const snapshot = captureGameStateSnapshot(source);
        const target = new GameState({ hitStopEnabled: true });

        restoreGameStateSnapshot(target, snapshot);
        expect(target.hitStopEnabled).toBe(false);

        const legacySnapshot = structuredClone(snapshot);
        delete legacySnapshot.hitStopEnabled;
        const legacyTarget = new GameState({ hitStopEnabled: true });
        restoreGameStateSnapshot(legacyTarget, legacySnapshot);
        expect(legacyTarget.hitStopEnabled).toBe(true);
    });
});
