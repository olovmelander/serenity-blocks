/**
 * Fault Lines' two GameState switches: a finite supply (no bag refill) and waiting
 * gravity (no fall, no auto-lock; only a hard drop places a piece). Both default off,
 * and every other mode keeps today's rules.
 */
import { describe, expect, it } from 'vitest';
import {
    GameState, hardDrop, processAutoDrop, softDrop, spawnPiece,
} from '../../src/core/game.js';

function game(options = {}) {
    const gameState = new GameState({ hitStopEnabled: false, ...options });
    gameState.lastTime = 0;
    return gameState;
}

describe('puzzle rule gates', () => {
    it('are off by default: the bag refills and gravity pulls the piece down', () => {
        const gameState = game();
        expect(gameState.finiteSupply).toBe(false);
        expect(gameState.gravityWaits).toBe(false);
        gameState.nextPieces = ['T'];
        spawnPiece(gameState);
        expect(gameState.nextPieces.length).toBeGreaterThanOrEqual(10);
        const startY = gameState.currentPiece.y;
        processAutoDrop(gameState, gameState.dropInterval + 1, null, null);
        expect(gameState.currentPiece.y).toBe(startY + 1);
    });

    it('deals a finite supply in order, then spawns nothing and ends nothing', () => {
        const gameState = game({ finiteSupply: true });
        gameState.nextPieces = ['I', 'O'];
        let gameOver = false;
        spawnPiece(gameState, null, () => { gameOver = true; });
        expect(gameState.currentPiece.shapeKey).toBe('I');
        expect(gameState.nextPieces).toEqual(['O']);
        spawnPiece(gameState, null, () => { gameOver = true; });
        expect(gameState.currentPiece.shapeKey).toBe('O');
        expect(gameState.nextPieces).toEqual([]);
        expect(spawnPiece(gameState, null, () => { gameOver = true; })).toBeNull();
        expect(gameOver).toBe(false);
        expect(gameState.isGameOver).toBe(false);
    });

    it('waiting gravity never moves or locks a piece; a hard drop places it', () => {
        const gameState = game({ finiteSupply: true, gravityWaits: true });
        gameState.nextPieces = ['O'];
        spawnPiece(gameState);
        const startY = gameState.currentPiece.y;
        processAutoDrop(gameState, 60_000, null, null);
        expect(gameState.currentPiece.y).toBe(startY);

        // Grounded, past every lock reset: soft drop still leaves the piece in hand.
        while (softDrop(gameState, null, {})) { /* fall to the floor */ }
        gameState.lockResetCount = 1_000;
        gameState.lockTimer = 60_000;
        processAutoDrop(gameState, 60_000, null, {});
        expect(softDrop(gameState, null, {})).toBe(false);
        expect(gameState.currentPiece?.shapeKey).toBe('O');
        expect(gameState.lockedPieces).toHaveLength(0);

        expect(hardDrop(gameState, null, null)).toBe(true);
        expect(gameState.lockedPieces).toHaveLength(1);
        expect(gameState.currentPiece).toBeNull();
    });
});
