/**
 * Opponents' falling pieces arrive interpolated (y 5.5 between rows 5 and 6). The tile
 * repaints only when the piece's whole cell changes, so it must also draw that whole
 * cell: drawn at the raw y, a piece sat half a cell between rows until the next repaint.
 */
/* eslint-disable import/first */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/rendering/canvas/canvas-drawing-utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    drawPieceSolid: vi.fn(),
}));

import { drawPieceSolid } from '../../src/rendering/canvas/canvas-drawing-utils.js';
import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';

function makeWatcher() {
    return Object.assign(Object.create(OpponentWatchManager.prototype), {
        _colorCache: new Map(),
        _styleConfigCache: new Map(),
        _boardEffects: new Map(),
        allPlayers: [],
        styleManager: null,
        styleInitPending: false,
    });
}

describe('opponent pieces on whole cells', () => {
    it('draws an interpolated piece at the whole cell its repaint check counts', () => {
        const watcher = makeWatcher();
        const piece = {
            type: 'T', color: '#a855f7', shape: [[1, 1, 1]], x: 4.4, y: 5.5, rotation: 0,
        };
        watcher._drawCurrentPiece({}, piece, 10, new Map());

        const [, , offsetX, offsetY] = drawPieceSolid.mock.calls.at(-1);
        // Column 4; row 6 (5.5 rounds as the hash rounds it) less the 4 hidden rows.
        expect(offsetX).toBe(40);
        expect(offsetY).toBe(20);
        expect(watcher._computePieceHash(piece)).toBe('T|4|6|0');
    });
});
