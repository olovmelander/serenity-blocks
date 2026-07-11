/**
 * §5.10 shadow-differential machinery pins: a clean legacy run settles clean,
 * a tampered end-state is reported divergent (with the diverging fields), and
 * samples are discarded — never false-positived — when the board is mutated
 * outside the lock path mid-physics (garbage/restore/reset all bump
 * boardMutationEpoch) or the game ends.
 */
import {
    describe, it, expect, beforeEach, vi, afterEach,
} from 'vitest';
import { processPhysics } from '../../src/core/physics.js';
import {
    armCascadeShadow, settleCascadeShadow, getCascadeShadowStats, resetCascadeShadowStats,
} from '../../src/core/cascade-shadow.js';
import { applyGarbage, restoreBoardState, GameState } from '../../src/core/game.js';
import { createBoardGrid } from '../../src/core/board.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

function fullRowPiece(y, id = `row-${y}`) {
    return {
        pieceId: id, color: '#666', type: 'garbage', x: 0, y, shape: [Array(COLS).fill(1)],
    };
}
function block(x, y, id = `b-${x}-${y}`) {
    return {
        pieceId: id, color: '#888', type: 'block', x, y, shape: [[1]],
    };
}
function makeState(overrides = {}) {
    return {
        boardGrid: createBoardGrid(),
        lockedPieces: [fullRowPiece(BOTTOM), block(0, BOTTOM - 4)],
        score: 0,
        lines: 0,
        level: 1,
        linesUntilNextLevel: 15,
        dropInterval: 800,
        disableLevelProgression: false,
        b2bActive: false,
        isSeeking: true,
        lineClearCounts: {
            1: 0, 2: 0, 3: 0, 4: 0,
        },
        comboState: { lockFootprint: [], manualColumns: [] },
        ...overrides,
    };
}

describe('cascade shadow differential (§5.10 machinery)', () => {
    beforeEach(() => resetCascadeShadowStats());
    afterEach(() => vi.restoreAllMocks());

    it('clean legacy run settles clean and counts toward the soak', async () => {
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        const verdict = settleCascadeShadow(sample, gs);
        expect(verdict.status).toBe('clean');
        expect(getCascadeShadowStats()).toMatchObject({
            armed: 1, clean: 1, divergent: 0, discarded: 0,
        });
    });

    it('tampered end-state is reported divergent with the diverging fields', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        gs.score += 1; // simulate a legacy/resolver divergence
        const verdict = settleCascadeShadow(sample, gs);
        expect(verdict.status).toBe('divergent');
        expect(verdict.diffs.map((d) => d.field)).toContain('score');
        expect(errSpy).toHaveBeenCalledOnce();
        expect(getCascadeShadowStats().divergent).toBe(1);
    });

    it('hole-mask divergence is caught (the §5.2 abort criterion)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        gs.comboState.holeMask[0][0] = !gs.comboState.holeMask[0][0];
        const verdict = settleCascadeShadow(sample, gs);
        expect(verdict.status).toBe('divergent');
        expect(verdict.diffs.map((d) => d.field)).toContain('comboState.holeMask');
    });

    it('mid-physics garbage insertion discards the sample (no false positive)', async () => {
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        applyGarbage(gs, [{ row: 1, holePosition: 3 }]); // bumps boardMutationEpoch
        const verdict = settleCascadeShadow(sample, gs);
        expect(verdict.status).toBe('discarded');
        expect(getCascadeShadowStats()).toMatchObject({ divergent: 0, discarded: 1 });
    });

    it('mid-physics snapshot restore discards the sample', async () => {
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        restoreBoardState(gs, { score: 999 }, { statsMode: 'adopt' });
        expect(settleCascadeShadow(sample, gs).status).toBe('discarded');
    });

    it('GameState.reset() mid-physics discards the sample', async () => {
        const real = new GameState();
        real.isSeeking = true;
        real.lockedPieces = [fullRowPiece(BOTTOM)];
        real.comboState = { lockFootprint: [], manualColumns: [] };
        const sample = armCascadeShadow(real);
        await processPhysics(real, {});
        real.reset();
        expect(settleCascadeShadow(sample, real).status).toBe('discarded');
    });

    it('game over / stop discards the sample', async () => {
        const gs = makeState();
        const sample = armCascadeShadow(gs);
        await processPhysics(gs, {});
        gs.isGameOver = true;
        expect(settleCascadeShadow(sample, gs).status).toBe('discarded');
    });

    it('oversized Infinity boards are skipped and counted, not sampled', () => {
        const pieces = [];
        for (let i = 0; i < 601; i += 1) pieces.push(block(i % COLS, BOTTOM - Math.floor(i / COLS), `p${i}`));
        const gs = makeState({ lockedPieces: pieces });
        expect(armCascadeShadow(gs)).toBeNull();
        expect(getCascadeShadowStats()).toMatchObject({ armed: 0, skipped: 1 });
        expect(settleCascadeShadow(null, gs).status).toBe('skipped');
    });

    it('arming never mutates the live gameState', () => {
        const gs = makeState();
        const before = JSON.stringify({ pieces: gs.lockedPieces, combo: gs.comboState });
        armCascadeShadow(gs);
        expect(JSON.stringify({ pieces: gs.lockedPieces, combo: gs.comboState })).toBe(before);
    });
});
