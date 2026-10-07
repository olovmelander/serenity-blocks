/**
 * Totals carry into the next round as the host counts them. A peer's own board can end
 * a round one lock apart from the host's copy; keeping its own score left the two a
 * lock bonus apart for the whole next round, and the divergence check then froze the
 * player for a resync at the first piece.
 */
import { describe, expect, it } from 'vitest';
import { readRoundCarry, roundCarryTotals } from '../../src/core/multiplayer/ffa-round-policy.js';

describe('round carry', () => {
    it('the host sends every player\'s score, lines and level', () => {
        const game = {
            players: new Map([
                ['A', { gameState: { score: 1800, lines: 4, level: 2 } }],
                ['B', { gameState: { score: 1750, lines: 3, level: 1 } }],
            ]),
        };
        expect(roundCarryTotals(game)).toEqual({
            A: { score: 1800, lines: 4, level: 2 },
            B: { score: 1750, lines: 3, level: 1 },
        });
    });

    it('a peer takes the host\'s totals over its own', () => {
        const own = { score: 1800, lines: 4, level: 2 };
        expect(readRoundCarry({ A: { score: 1750, lines: 4, level: 2 } }, 'A', own))
            .toEqual({ score: 1750, lines: 4, level: 2 });
    });

    it('keeps its own totals when the host sent none or nonsense', () => {
        const own = { score: 1800, lines: 4, level: 2 };
        expect(readRoundCarry(undefined, 'A', own)).toEqual(own);
        expect(readRoundCarry({ A: { score: -5, lines: 4, level: 2 } }, 'A', own)).toEqual(own);
        expect(readRoundCarry({ A: { score: '9', lines: 4, level: 2 } }, 'A', own)).toEqual(own);
        expect(readRoundCarry({ A: { score: 9, lines: 4, level: 0 } }, 'A', own)).toEqual(own);
    });
});
