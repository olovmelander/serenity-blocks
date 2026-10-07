/**
 * Online input hooks feed auto-repeat. A move or soft drop the local board cannot make is
 * neither sent nor repeated; one made while no piece falls is sent once and stops the
 * repeat for that frame. Before, the hooks returned nothing, so an instant repeat rate
 * sent its whole budget every frame and the host's rate limit threw inputs away.
 */
import { describe, expect, it, vi } from 'vitest';
import { GameState, spawnPiece } from '../../src/core/game.js';
import { advanceDas, createDasDirectionState } from '../../src/core/das.js';
import { createOnlineInputHooks, localMoveOutcome } from '../../src/core/game-modes/online-input-hooks.js';

function boardWithPiece() {
    const gameState = new GameState();
    gameState.nextPieces = ['O', 'I', 'T', 'S', 'Z', 'J', 'L'];
    spawnPiece(gameState, null, null);
    return gameState;
}

function makeHooks(gameState) {
    const send = vi.fn();
    const juice = { nudge: vi.fn(), tilt: vi.fn() };
    const hooks = createOnlineInputHooks({ send, gameState: () => gameState, juice: () => juice });
    return { hooks, send, juice };
}

describe('localMoveOutcome', () => {
    it('moves where the board allows, is blocked at a wall, and waits without a piece', () => {
        const gameState = boardWithPiece();
        expect(localMoveOutcome(gameState, -1, 0)).toBe('move');
        gameState.currentPiece.x = 0;
        expect(localMoveOutcome(gameState, -1, 0)).toBe('blocked');
        gameState.isProcessingPhysics = true;
        expect(localMoveOutcome(gameState, -1, 0)).toBe('later');
        expect(localMoveOutcome({ currentPiece: null }, 1, 0)).toBe('later');
    });
});

describe('online input hooks under instant auto-repeat', () => {
    it('sends only the moves that move the piece, then stops repeating at the wall', () => {
        const gameState = boardWithPiece();
        const { hooks, send } = makeHooks(gameState);
        const startX = gameState.currentPiece.x;
        const das = createDasDirectionState();
        das.active = true;
        const config = { dasDelay: 0, dasInterval: 0, instantLimit: 10 };
        const applyMove = (dir) => {
            const moved = hooks.move(dir);
            if (moved) gameState.currentPiece.x += dir; // the local prediction
            return moved;
        };

        for (let frame = 0; frame < 60; frame += 1) advanceDas(das, 16, config, () => applyMove(-1));

        expect(gameState.currentPiece.x).toBe(0);
        expect(send).toHaveBeenCalledTimes(startX); // one per cell, none at the wall
    });

    it('does not send a soft drop the piece cannot make', () => {
        const gameState = boardWithPiece();
        const { hooks, send } = makeHooks(gameState);
        gameState.currentPiece.y = 22; // resting on the floor (O piece)
        expect(hooks.softDrop()).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });

    it('sends once while no piece falls, and stops the repeat for that frame', () => {
        const gameState = boardWithPiece();
        const { hooks, send } = makeHooks(gameState);
        gameState.isProcessingPhysics = true;
        expect(hooks.move(1)).toBe(false);
        expect(send).toHaveBeenCalledWith('move', { direction: 1 });
    });

    it('holds every action during hit-stop, as before', () => {
        const gameState = boardWithPiece();
        const { hooks, send } = makeHooks(gameState);
        gameState.hitStopRemaining = 30;
        expect(hooks.move(1)).toBe(false);
        hooks.rotate('right');
        hooks.hardDrop();
        expect(send).not.toHaveBeenCalled();
    });
});
