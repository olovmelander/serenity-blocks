/**
 * @fileoverview Odyssey modifier wiring (masterplan §2 #3 / C2).
 *
 * Verifies the four previously-dead modifiers are now real:
 *  - combo-multiplier: score scales with the consecutive-clear chain (and single-player is
 *    byte-identical when the flag is unset — the gate is the safety contract);
 *  - speed-up: apply() shortens the drop interval;
 *  - mirror: apply() sets the input-mirror flag;
 *  - invisible: RETIRED (definition removed).
 *
 * The combo behaviour is tested through the REAL shared physics (processPhysics) with
 * gameState.isSeeking=true so the animation delays are skipped — deterministic, no timers.
 */

import { describe, it, expect } from 'vitest';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { processPhysics } from '../../src/core/physics.js';
import { calculateQuadraLineScore } from '../../src/core/scoring.js';
import { createBoardGrid } from '../../src/core/board.js';
import { MODIFIER_DEFINITIONS, ModifierStack } from '../../src/core/odyssey/ModifierStack.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

/** A single locked piece spanning a full bottom row (clears on the next processPhysics). */
function fullBottomRowPiece() {
    return {
        pieceId: 'test-garbage',
        color: '#666',
        type: 'garbage',
        x: 0,
        y: BOTTOM,
        shape: [Array(COLS).fill(1)],
    };
}

/** A single locked block a few rows up — never forms a full row (a non-clearing lock). */
function loneBlockPiece() {
    return {
        pieceId: 'test-block', color: '#888', type: 'block', x: 0, y: BOTTOM - 4, shape: [[1]],
    };
}

function makeState(overrides = {}) {
    const state = {
        boardGrid: createBoardGrid(),
        lockedPieces: [],
        score: 0,
        level: 1,
        lines: 0,
        linesUntilNextLevel: 15,
        disableLevelProgression: true, // isolate scoring from level-up
        isSeeking: true, // skip the animation-frame delays → deterministic
        comboState: { lockFootprint: [], manualColumns: [] },
        ...overrides,
    };
    return state;
}

describe('Odyssey modifier definitions (C2)', () => {
    it('combo-multiplier.apply seeds all combo state', () => {
        const gs = {};
        MODIFIER_DEFINITIONS['combo-multiplier'].apply(gs);
        expect(gs.comboMultiplierEnabled).toBe(true);
        expect(gs.comboMultiplier).toBe(1);
        expect(gs.comboCount).toBe(0);
    });

    it('speed-up.apply sets the multiplier and shortens the starting interval', () => {
        const gs = { dropInterval: 900 };
        MODIFIER_DEFINITIONS['speed-up'].apply(gs);
        expect(gs.speedMultiplier).toBe(1.5);
        expect(gs.dropInterval).toBe(900 / 1.5);
    });

    it('mirror.apply sets the input-mirror flag', () => {
        const gs = {};
        MODIFIER_DEFINITIONS.mirror.apply(gs);
        expect(gs.mirrorControls).toBe(true);
    });

    it('invisible is RETIRED — the definition no longer exists', () => {
        expect(MODIFIER_DEFINITIONS.invisible).toBeUndefined();
        const stack = new ModifierStack();
        stack.activate(['invisible']);
        expect(stack.getActive()).toHaveLength(0); // unknown modifier is dropped
    });
});

describe('combo-multiplier through real physics (C2 flagship)', () => {
    it('scales the line-clear score by comboMultiplier when enabled', async () => {
        const scaled = makeState({
            lockedPieces: [fullBottomRowPiece(), loneBlockPiece()],
            comboMultiplierEnabled: true,
            comboMultiplier: 2,
            comboCount: 1,
        });
        await processPhysics(scaled, {});

        const base = makeState({ lockedPieces: [fullBottomRowPiece(), loneBlockPiece()] });
        await processPhysics(base, {});

        expect(base.score).toBeGreaterThan(0);
        // The gated multiply is the ONLY difference → exactly ×2 (rounded).
        expect(scaled.score).toBe(Math.round(base.score * 2));
    });

    it('is byte-identical for single-player when the flag is unset (the gate)', async () => {
        const noFlag = makeState({ lockedPieces: [fullBottomRowPiece(), loneBlockPiece()] });
        await processPhysics(noFlag, {});
        const expected = calculateQuadraLineScore(1, 1, 1, false);
        expect(noFlag.score).toBe(expected); // untouched Quadra scoring
    });

    it('advances the combo on clears and resets it on a non-clearing lock', async () => {
        const gs = makeState({
            lockedPieces: [fullBottomRowPiece(), loneBlockPiece()],
            comboMultiplierEnabled: true,
            comboMultiplier: 1,
            comboCount: 0,
        });

        await processPhysics(gs, {}); // 1st clearing lock
        expect(gs.comboCount).toBe(1);
        expect(gs.comboMultiplier).toBe(1.5);

        gs.lockedPieces = [fullBottomRowPiece(), loneBlockPiece()];
        await processPhysics(gs, {}); // 2nd consecutive clearing lock
        expect(gs.comboCount).toBe(2);
        expect(gs.comboMultiplier).toBe(2);

        gs.lockedPieces = [loneBlockPiece()]; // non-clearing lock (no full row)
        await processPhysics(gs, {});
        expect(gs.comboCount).toBe(0);
        expect(gs.comboMultiplier).toBe(1);
    });
});
