/**
 * Rows the garbage settle completes are cleared inside applyGarbage, at once, on every caller
 * of the shared boundary (audit A18-CORE-2). Rows that were already full before the settle
 * (solid garbage) keep their old behaviour.
 *
 * When garbage rises, a body standing over a garbage hole drops into it. A row that drop
 * fills used to sit on the board until the victim's next lock. Without the versus credit
 * (these tests, and Odyssey) the cleared rows award nothing; versus play credits them as the
 * player's own clear (ADR-0024, tests/unit/versus-rules.test.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    applyGarbage, GameState, fillBag, hardDrop, move, spawnPiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces, markBoardDirty } from '../../src/core/board.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { seededRandom } from '../../src/utils/helpers.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

const holesAt = (...cols) => cols.reduce((mask, col) => mask | (1 << (COLS - 1 - col)), 0);
const line = (holeMask) => ({ type: 'line', holeMask, variant: 'normal' });

function fullRows(gs) {
    return gs.boardGrid
        .map((row, y) => (row.every((cell) => cell !== null) ? y : -1))
        .filter((y) => y >= 0);
}

function occupied(gs) {
    const cells = [];
    gs.boardGrid.forEach((row, y) => row.forEach((cell, x) => { if (cell) cells.push(`${x},${y}`); }));
    return cells;
}

function credit(gs) {
    return {
        lines: gs.lines,
        score: gs.score,
        level: gs.level,
        linesUntilNextLevel: gs.linesUntilNextLevel,
        lineClearCounts: { ...gs.lineClearCounts },
        b2bActive: gs.b2bActive,
        comboCount: gs.comboCount,
        comboMultiplier: gs.comboMultiplier,
    };
}

function stateWith(pieces) {
    const gs = new GameState();
    gs.lockedPieces.push(...pieces);
    rebuildBoardGridFromPieces(gs.lockedPieces, gs.boardGrid);
    markBoardDirty(gs);
    return gs;
}

describe('applyGarbage clears the rows its settle completes, without credit', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    const bodyOverHole = () => stateWith([
        { pieceId: 'body', shapeKey: 'I', color: '#0ff', x: 3, y: BOTTOM - 1, shape: [[1], [1]] },
    ]);

    it('a body that drops into the hole clears the row it completes at once, without credit', () => {
        const gs = bodyOverHole();
        const before = credit(gs);

        const result = applyGarbage(gs, [line(holesAt(3))]);

        expect(result.success).toBe(true);
        expect(fullRows(gs)).toEqual([]);
        expect(result.linesAfterInsertion).toEqual([]);
        expect(result.settleClearedRows).toEqual([BOTTOM]);
        // The garbage row and the body's lower cell are gone; its upper cell fell to the floor.
        expect(occupied(gs)).toEqual([`3,${BOTTOM}`]);
        expect(credit(gs)).toEqual(before);
    });

    it('the next lock that clears nothing is not credited for a row the garbage settle completed', async () => {
        const gs = bodyOverHole();
        gs.randomGenerator = seededRandom(7);
        fillBag(gs.nextPieces, gs.randomGenerator);
        const before = credit(gs);
        applyGarbage(gs, [line(holesAt(3))]);

        // The victim's next piece locks far from column 3 and clears nothing of its own.
        spawnPiece(gs);
        for (let i = 0; i < 6; i++) move(gs, 1);
        const attacks = [];
        gs.isSeeking = true; // skip animation waits; the lock logic is unchanged
        hardDrop(gs, null, {
            spawnPiece: () => spawnPiece(gs),
            onGarbageReady: (summary) => attacks.push(summary),
        });
        await gs.latestPhysicsPromise;

        expect(gs.lines).toBe(0);
        expect(gs.lineClearCounts).toEqual(before.lineClearCounts);
        expect(attacks).toEqual([]);
    });

    it('a vertical I in a well under a four-row burst clears all four rows it completes, without credit', () => {
        // Columns 1-8 stacked four high, column 0 open, and an I standing in the column-9 well:
        // no row is full, so the I's own lock cleared nothing.
        const stack = [0, 1, 2, 3].map((i) => ({
            pieceId: `row-${i}`, shapeKey: 'O', color: '#888', x: 1, y: BOTTOM - i, shape: [Array(8).fill(1)],
        }));
        const wellI = {
            pieceId: 'wellI', shapeKey: 'I', color: '#0ff', x: 9, y: BOTTOM - 3, shape: [[1], [1], [1], [1]],
        };
        const gs = stateWith([...stack, wellI]);
        const before = credit(gs);

        const result = applyGarbage(gs, [0, 1, 2, 3].map(() => line(holesAt(9))));

        expect(fullRows(gs)).toEqual([]);
        expect(result.linesAfterInsertion).toEqual([]);
        expect(result.settleClearedRows).toEqual([BOTTOM - 3, BOTTOM - 2, BOTTOM - 1, BOTTOM]);
        // The four garbage rows and the I are gone; the stack is back where it stood.
        const expected = [];
        for (let y = BOTTOM - 3; y <= BOTTOM; y++) for (let x = 1; x <= 8; x++) expected.push(`${x},${y}`);
        expect(occupied(gs)).toEqual(expected);
        expect(credit(gs)).toEqual(before);
    });

    it('a row emptied by that clear lets another body fall and complete a row, which is cleared too', () => {
        // Two single cells on the floor at columns 3 and 7. The upper garbage row's hole is at 3,
        // the lower one's at 7: the cell in column 3 completes the upper row; once that row is
        // gone, the cell in column 7 falls through to complete the lower one.
        const gs = stateWith([
            { pieceId: 'a', shapeKey: 'T', color: '#f0f', x: 3, y: BOTTOM, shape: [[1]] },
            { pieceId: 'b', shapeKey: 'S', color: '#0f0', x: 7, y: BOTTOM, shape: [[1]] },
        ]);
        const before = credit(gs);

        const result = applyGarbage(gs, [line(holesAt(3)), line(holesAt(7))]);

        expect(fullRows(gs)).toEqual([]);
        expect(gs.lockedPieces).toEqual([]);
        expect(result.settleClearedRows).toEqual([BOTTOM - 1, BOTTOM]);
        expect(occupied(gs)).toEqual([]);
        expect(credit(gs)).toEqual(before);
    });

    it('a solid garbage row with nothing to settle stays full, as before', () => {
        const gs = stateWith([
            { pieceId: 'body', shapeKey: 'I', color: '#0ff', x: 3, y: BOTTOM - 1, shape: [[1], [1]] },
        ]);

        const result = applyGarbage(gs, [line(0)]);

        expect(result.linesAfterInsertion).toEqual([BOTTOM]);
        expect(fullRows(gs)).toEqual([BOTTOM]);
        expect(gs.lines).toBe(0);
    });

    it('a row that was already full stays full even when the settle lets it drop', () => {
        // Top to bottom: a solid row, a row whose only block is in column 5, a row whose only
        // hole is column 5. The lone block completes the bottom row; the solid row then drops
        // onto it. Only the row the settle completed is cleared.
        const gs = new GameState();
        const onlyColumn5 = holesAt(...Array.from({ length: COLS }, (_, x) => x).filter((x) => x !== 5));

        const result = applyGarbage(gs, [line(0), line(onlyColumn5), line(holesAt(5))]);

        expect(fullRows(gs)).toEqual([BOTTOM]);
        expect(result.linesAfterInsertion).toEqual([BOTTOM]);
        expect(occupied(gs)).toHaveLength(COLS);
        expect(result.settleClearedRows).toEqual([BOTTOM]);
    });

    it('settles without clearing when the caller turns settling off', () => {
        const gs = stateWith([
            { pieceId: 'body', shapeKey: 'I', color: '#0ff', x: 3, y: BOTTOM - 1, shape: [[1], [1]] },
        ]);

        applyGarbage(gs, [line(holesAt(3))], { settleFloatingBlocks: false });

        expect(gs.boardGrid[BOTTOM][3]).toBe(null);
        expect(fullRows(gs)).toEqual([]);
    });

    it('the same garbage on two boards leaves identical boards', () => {
        const build = () => stateWith([
            { pieceId: 'a', shapeKey: 'T', color: '#f0f', x: 3, y: BOTTOM, shape: [[1]] },
            { pieceId: 'b', shapeKey: 'S', color: '#0f0', x: 7, y: BOTTOM, shape: [[1]] },
            { pieceId: 'c', shapeKey: 'L', color: '#fa0', x: 0, y: BOTTOM - 1, shape: [[1, 1], [1, 0]] },
            { pieceId: 'wellI', shapeKey: 'I', color: '#0ff', x: 9, y: BOTTOM - 3, shape: [[1], [1], [1], [1]] },
        ]);
        const bursts = [
            [line(holesAt(3)), line(holesAt(7))],
            [line(holesAt(9)), line(holesAt(9)), line(holesAt(2, 9))],
            [line(0), line(holesAt(1))],
        ];
        const host = build();
        const peer = build();
        const hostResults = bursts.map((burst) => applyGarbage(host, burst.map((entry) => ({ ...entry }))));
        const peerResults = bursts.map((burst) => applyGarbage(peer, burst.map((entry) => ({ ...entry }))));

        expect(hostResults.some((r) => r.settleClearedRows.length > 0)).toBe(true);
        expect(peerResults.map((r) => r.settleClearedRows)).toEqual(hostResults.map((r) => r.settleClearedRows));
        expect(JSON.stringify(peer.lockedPieces)).toBe(JSON.stringify(host.lockedPieces));
        expect(JSON.stringify(peer.boardGrid)).toBe(JSON.stringify(host.boardGrid));
        expect(credit(peer)).toEqual(credit(host));
    });
});
