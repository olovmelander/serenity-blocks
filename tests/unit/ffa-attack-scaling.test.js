/**
 * @fileoverview Pins the live FFA attack-scaling behavior.
 *
 * The doc-comment on applyAttackScaling previously claimed scaling was "REMOVED"
 * and that base lines were returned unmodified — the exact opposite of what the
 * code does. This table test locks the real behavior so the comment and code
 * cannot drift apart again (remediation Phase 1 / Phase 3).
 */

import { describe, it, expect } from 'vitest';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';

// applyAttackScaling only reads (baseLines, opponentCount, boringRules); a minimal
// stub game state is sufficient to construct the router.
function makeRouter() {
    return new FFAAttackRouter({ isHost: true, debugGarbage: false });
}

describe('FFAAttackRouter.applyAttackScaling', () => {
    const router = makeRouter();

    it('returns base lines unmodified under boring (classic) rules', () => {
        expect(router.applyAttackScaling(4, 7, true)).toBe(4);
        expect(router.applyAttackScaling(1, 3, true)).toBe(1);
    });

    it('applies no reduction for a single opponent', () => {
        expect(router.applyAttackScaling(4, 1, false)).toBe(4);
        expect(router.applyAttackScaling(4, 0, false)).toBe(4);
    });

    it('reduces garbage ~10% per extra opponent', () => {
        // multiplier = 1 - (opponentCount - 1) * 0.10, then round, clamped >= 1.
        expect(router.applyAttackScaling(10, 2, false)).toBe(9); // 10 * 0.9
        expect(router.applyAttackScaling(10, 3, false)).toBe(8); // 10 * 0.8
        expect(router.applyAttackScaling(4, 7, false)).toBe(2); // 4 * 0.4 = 1.6 -> 2
    });

    it('floors the multiplier at 25% (never below)', () => {
        // 8+ opponents would compute < 0.25, but the multiplier is clamped at 0.25.
        expect(router.applyAttackScaling(100, 12, false)).toBe(25); // 100 * 0.25
        expect(router.applyAttackScaling(100, 50, false)).toBe(25);
    });

    it('always sends at least 1 line when base lines > 0', () => {
        expect(router.applyAttackScaling(1, 7, false)).toBe(1); // 1 * 0.4 = 0.4 -> max(1, 0)
        expect(router.applyAttackScaling(2, 8, false)).toBeGreaterThanOrEqual(1);
    });

    it('sends 0 lines when base lines is 0', () => {
        expect(router.applyAttackScaling(0, 5, false)).toBe(0);
    });
});
