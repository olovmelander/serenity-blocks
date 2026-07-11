/**
 * Demo final-outcome digest pins (plan §5.0 step 2/4).
 *
 * The migration corpus needs VERIFIABLE outcomes: cutover comparisons diff
 * final board digests, but demo metadata previously carried only
 * score/lines/level — the board half had nothing to compare. Pins the digest
 * semantics (occupancy+type only, cosmetic-blind) and the recorder wiring
 * (terminal checkpoint + digest on stop).
 */
import { describe, it, expect } from 'vitest';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import { DemoRecorder } from '../../src/core/demo/DemoRecorder.js';

function emptyGrid(rows = 24, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

describe('computeBoardDigest', () => {
    it('is deterministic and occupancy-sensitive', () => {
        const a = emptyGrid();
        a[23][0] = { type: 'I' };
        const b = emptyGrid();
        b[23][0] = { type: 'I' };
        expect(computeBoardDigest(a)).toBe(computeBoardDigest(b));

        b[23][1] = { type: 'O' };
        expect(computeBoardDigest(a)).not.toBe(computeBoardDigest(b));
    });

    it('is type-sensitive but cosmetic-blind (plan §5.11 digest hygiene)', () => {
        const a = emptyGrid();
        a[10][4] = { type: 'T', color: '#ff0000', id: 1 };
        const b = emptyGrid();
        b[10][4] = { type: 'T', color: '#00ff00', id: 999 }; // different cosmetics
        expect(computeBoardDigest(a)).toBe(computeBoardDigest(b));

        b[10][4] = { type: 'S', color: '#ff0000', id: 1 }; // different TYPE
        expect(computeBoardDigest(a)).not.toBe(computeBoardDigest(b));
    });

    it('handles empty and malformed grids', () => {
        expect(computeBoardDigest(emptyGrid())).toBe(computeBoardDigest(emptyGrid()));
        expect(computeBoardDigest(null)).toBe(null);
        expect(computeBoardDigest(undefined)).toBe(null);
    });
});

describe('DemoRecorder final outcome', () => {
    function makeGameState() {
        const grid = emptyGrid();
        grid[23][3] = { type: 'L' };
        return {
            simFrame: 600,
            simTimeMs: 10000,
            simTickMs: 1000 / 60,
            level: 1,
            dropInterval: 800,
            boardGrid: grid,
            lockedPieces: [],
            currentPiece: null,
            isGameOver: true, // terminal state — checkpoint-stable
            isProcessingPhysics: false,
            randomGenerator: Object.assign(() => 0.5, { getState: () => 42, seed: 7 }),
        };
    }

    it('stopRecording(stats, gameState) records digest + gameOver + a terminal checkpoint', () => {
        const rec = new DemoRecorder();
        const gs = makeGameState();
        rec.startRecording(gs, {}, 7);
        const checkpointsBefore = rec.getDemo().checkpoints.length;

        const demo = rec.stopRecording({ score: 1234, lines: 5 }, gs);
        expect(demo.metadata.finalBoardDigest).toBe(computeBoardDigest(gs.boardGrid));
        expect(demo.metadata.gameOver).toBe(true);
        expect(demo.checkpoints.length).toBeGreaterThan(checkpointsBefore); // terminal checkpoint forced
    });

    it('stopRecording without gameState stays backward-compatible (null digest)', () => {
        const rec = new DemoRecorder();
        rec.startRecording(makeGameState(), {}, 7);
        const demo = rec.stopRecording({ score: 1 });
        expect(demo.metadata.finalBoardDigest).toBe(null);
        expect(demo.metadata.gameOver).toBe(false);
    });
});
