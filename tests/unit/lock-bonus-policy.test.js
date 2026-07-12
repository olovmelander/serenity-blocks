import { describe, expect, it } from 'vitest';
import {
    fillBag,
    GameState,
    lockPiece,
    spawnPiece,
} from '../../src/core/game.js';

function createLockableState(options = {}) {
    const state = new GameState(options);
    state.randomGenerator = () => 0.25;
    fillBag(state.nextPieces, state.randomGenerator);
    spawnPiece(state);
    state.pieceSpawnTime = 0;
    state.simTimeMs = 1000;
    return state;
}

describe('lock bonus timing policy', () => {
    it('preserves elapsed-time scoring for normal game states', () => {
        const state = createLockableState();

        lockPiece(state, null, null);

        expect(state.score).toBe(20);
    });

    it('preserves the current FFA maximum bonus after its clock becomes real', () => {
        const state = createLockableState({ lockBonusPolicy: 'legacy-max' });

        lockPiece(state, null, null);

        expect(state.score).toBe(50);
    });
});
