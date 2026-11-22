/**
 * The blind clock on the fixed simulation tick (core/blind.js): hidden cells count down one
 * blind tick (160 ms) per 160 ms of the board's own game time, the same at any render cadence,
 * on the variable-step loops and across a demo checkpoint (the online resync sidecar captures
 * the same state).
 */
import { describe, expect, it } from 'vitest';
import {
    BLIND_PIECE_TICKS, BLIND_TICK_MS, advanceBlindClock, applyFullBlind, captureBlindSnapshot,
} from '../../src/core/blind.js';
import { FIXED_TICK_MS, planFixedTicks } from '../../src/core/fixed-tick-clock.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { GameState } from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { advanceTick } from '../../src/core/simulation-tick.js';

/** A board with one locked O piece on the floor. */
function boardWithPiece(extra = {}) {
    const gameState = new GameState();
    gameState.lockedPieces = [{
        pieceId: 1, shapeKey: 'O', color: '#fff', x: 0, y: 22, shape: [[1, 1], [1, 1]], ...extra,
    }];
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    return gameState;
}

const ticksLeft = (gameState) => gameState.lockedPieces[0].blindTicks || 0;

describe('the blind clock on fixed ticks', () => {
    it('advances with every fixed simulation tick', () => {
        const gameState = boardWithPiece();
        applyFullBlind(gameState, 3);

        // 160 ms is 9.6 ticks of 60 Hz: the first blind tick passes on the tenth sim tick.
        for (let tick = 0; tick < 9; tick++) advanceTick(gameState);
        expect(ticksLeft(gameState)).toBe(3);
        advanceTick(gameState);
        expect(ticksLeft(gameState)).toBe(2);
    });

    it.each([30, 60, 144])('shows a blind piece after exactly 30 blind ticks (288 sim ticks) at %i Hz', (renderHz) => {
        const gameState = boardWithPiece({ blindTicks: BLIND_PIECE_TICKS });
        let accumulatorMs = 0;
        let advancedTicks = 0;
        let shownAt = null;

        for (let frame = 0; frame < renderHz * 6 && shownAt === null; frame++) {
            const plan = planFixedTicks(accumulatorMs, 1000 / renderHz);
            accumulatorMs = plan.remainderMs;
            for (let step = 0; step < plan.steps && shownAt === null; step++) {
                advanceTick(gameState);
                advancedTicks += 1;
                if (ticksLeft(gameState) === 0) shownAt = advancedTicks;
            }
        }

        expect(shownAt).toBe(Math.ceil((BLIND_PIECE_TICKS * BLIND_TICK_MS) / FIXED_TICK_MS - 1e-9));
        expect(shownAt).toBe(288);
    });

    it('the variable-step loops count the same game time', () => {
        const fixed = boardWithPiece({ blindTicks: 10 });
        const variable = boardWithPiece({ blindTicks: 10 });
        for (let tick = 0; tick < 60; tick++) advanceBlindClock(fixed, FIXED_TICK_MS);
        [250, 333, 417].forEach((dt) => advanceBlindClock(variable, dt));

        expect(ticksLeft(fixed)).toBe(ticksLeft(variable));
        expect(ticksLeft(fixed)).toBe(10 - Math.floor(1000 / BLIND_TICK_MS));
    });
});

describe('blind across a checkpoint', () => {
    it('round-trips hidden cells, the clock and a waiting blind piece through demo state', () => {
        const source = boardWithPiece();
        applyFullBlind(source, 40);
        for (let tick = 0; tick < 37; tick++) advanceTick(source);
        source.blind.pieceTicks = BLIND_PIECE_TICKS;
        const snapshot = captureGameStateSnapshot(source);
        const target = new GameState();

        restoreGameStateSnapshot(target, snapshot);

        expect(captureBlindSnapshot(target)).toEqual(captureBlindSnapshot(source));
        expect(target.boardGrid[22][0].blind).toBe(source.lockedPieces[0].blindTicks);
        for (let tick = 0; tick < 50; tick++) {
            advanceTick(source);
            advanceTick(target);
        }
        expect(captureBlindSnapshot(target)).toEqual(captureBlindSnapshot(source));
    });

    it('a checkpoint from before hidden cells restores a visible board', () => {
        const source = boardWithPiece();
        const snapshot = captureGameStateSnapshot(source);
        delete snapshot.blind;
        const target = new GameState();

        restoreGameStateSnapshot(target, snapshot);

        expect(target.blind).toMatchObject({ clockMs: 0, pieceTicks: 0 });
        expect(target.lockedPieces[0].blindTicks).toBeUndefined();
    });
});
