import { describe, expect, it } from 'vitest';
import { GameState, getGhostLandingY, restoreBoardState } from '../../src/core/game.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';

describe('ghost placement after authoritative board adoption', () => {
    it('recalculates a retained local piece when an authoritative stack changes below it', () => {
        const state = new GameState();
        const piece = {
            shapeKey: 'O', shape: [[1, 1], [1, 1]], x: 4, y: 2, rotation: 0,
        };
        state.currentPiece = piece;
        const emptyLanding = state.boardGrid.length - 2;
        expect(getGhostLandingY(state)).toBe(emptyLanding);

        const stackRow = state.boardGrid.length - 5;
        const lockedPieces = [{ pieceId: 1, shape: [[1]], x: 4, y: stackRow }];
        restoreBoardState(state, {
            grid: rebuildBoardGridFromPieces(lockedPieces, createBoardGrid()),
            lockedPieces,
        }, { adoptBoard: true, keepCurrentPiece: true });

        expect(state.currentPiece).toBe(piece);
        expect(getGhostLandingY(state)).toBe(stackRow - 2);

        restoreBoardState(state, { grid: createBoardGrid(), lockedPieces: [] }, {
            adoptBoard: true, keepCurrentPiece: true,
        });
        expect(getGhostLandingY(state)).toBe(emptyLanding);
    });

    it('keeps a valid cached placement when only statistics are adopted', () => {
        const state = new GameState();
        state.currentPiece = { shape: [[1]], x: 4, y: 2 };
        const landing = getGhostLandingY(state);
        const cachedPiece = state.ghostCache.piece;
        restoreBoardState(state, { score: 100, lines: 1, level: 1 }, { statsMode: 'adopt' });
        expect(state.ghostCacheDirty).toBe(false);
        expect(state.ghostCache.piece).toBe(cachedPiece);
        expect(getGhostLandingY(state)).toBe(landing);
    });
});
