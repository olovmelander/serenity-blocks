/**
 * @fileoverview Demo-replay DETERMINISM test (Quadra-grade CI guard).
 *
 * Host-authoritative FFA round restart hands every player the SAME seed and trusts
 * that, given identical inputs, every machine simulates the identical board. If the
 * piece RNG, the 7-bag shuffle, or the lock/rebuild path ever becomes
 * non-deterministic, opponent boards silently diverge from the host's authoritative
 * state — the exact class of desync this mode has fought. These tests pin that
 * contract: replay the SAME input demo on the SAME seed twice → byte-identical board;
 * a DIFFERENT seed → a different piece sequence (proving the seed actually drives it).
 *
 * Uses the REAL production RNG (FFAGameStateP2P.createSeededRNG) and the REAL
 * game-core sim (fillBag/spawnPiece/move/rotate/hardDrop), so a regression in any of
 * them trips this test.
 */

import { describe, it, expect } from 'vitest';
import {
    GameState, fillBag, spawnPiece, move, rotate, hardDrop,
} from '../../src/core/game.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

// The exact LCG the host seeds every player with on a round restart. Called on a
// bare object so we exercise the production code path without a full instance.
const seededRNG = (seed) => FFAGameStateP2P.prototype.createSeededRNG.call({}, seed);

// A fixed "demo": per piece, slide to a column then hard-drop. Spread across the
// well so the stack stays low enough not to top out (which would still be
// deterministic, but we want a rich non-empty board to compare).
const DEMO = [
    { left: 5, rot: 0 }, { left: 3, rot: 1 }, { left: 1, rot: 0 }, { right: 1, rot: 1 },
    { right: 3, rot: 0 }, { right: 5, rot: 1 }, { left: 4, rot: 2 }, { left: 2, rot: 0 },
    { right: 0, rot: 1 }, { right: 2, rot: 0 }, { right: 4, rot: 1 }, { left: 5, rot: 0 },
];

function gridSignature(gs) {
    return gs.boardGrid.map((row) => row.map((c) => (c ? '#' : '.')).join('')).join('\n');
}

/** Run the demo on a fresh seeded GameState; return final board + piece sequence. */
function replay(seed, demo = DEMO) {
    const gs = new GameState();
    gs.randomGenerator = seededRNG(seed);
    fillBag(gs.nextPieces, gs.randomGenerator); // mirror restartMatch's startRound()
    spawnPiece(gs, null, null);

    const sequence = [];
    for (const step of demo) {
        if (!gs.currentPiece) break; // topped out — stop driving (still deterministic)
        sequence.push(gs.currentPiece.type || gs.currentPiece.shapeKey);
        for (let i = 0; i < (step.left || 0); i++) move(gs, -1, null, null);
        for (let i = 0; i < (step.right || 0); i++) move(gs, 1, null, null);
        for (let i = 0; i < (step.rot || 0); i++) rotate(gs, 'right');
        hardDrop(gs, null, null);
        spawnPiece(gs, null, null); // advance to the next piece, as the live loop does
    }
    return { signature: gridSignature(gs), sequence, lockedCount: gs.lockedPieces.length };
}

describe('FFA demo-replay determinism (seed contract)', () => {
    it('same seed + same inputs → byte-identical board and piece sequence', () => {
        const a = replay(123456);
        const b = replay(123456);
        expect(b.sequence).toEqual(a.sequence);
        expect(b.signature).toBe(a.signature);
    });

    it('actually built a non-trivial board (the demo locked real pieces)', () => {
        const { lockedCount, signature } = replay(123456);
        expect(lockedCount).toBeGreaterThan(5);
        expect(signature).toContain('#'); // board is not empty
    });

    it('the bag is a pure function of the seed (two RNGs, same seed → same queue)', () => {
        const q1 = [];
        const q2 = [];
        fillBag(q1, seededRNG(987654));
        fillBag(q2, seededRNG(987654));
        expect(q2).toEqual(q1);
        expect(q1.length).toBeGreaterThanOrEqual(7);
    });

    it('a different seed drives a different piece sequence (seed is load-bearing)', () => {
        const a = replay(123456);
        const c = replay(654321);
        // Astronomically unlikely to match across two LCG streams; pins that the seed
        // is what selects pieces (a regression that ignored the seed would fail here).
        expect(c.sequence).not.toEqual(a.sequence);
    });
});
