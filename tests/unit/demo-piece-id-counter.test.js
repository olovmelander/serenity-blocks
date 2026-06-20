/**
 * @fileoverview Tests that the per-instance _pieceIdCounter survives demo
 * capture/restore, so a seek/restore does not reset it to 0 and then re-issue
 * piece ids that collide with the restored pieces (which key the flood-fill
 * grouping). Regression guard for the remediation review finding.
 */

import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/core/game.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';

describe('demo snapshot _pieceIdCounter', () => {
    it('captures and restores the counter exactly', () => {
        const src = new GameState();
        src._pieceIdCounter = 17;

        const snapshot = captureGameStateSnapshot(src);
        expect(snapshot.pieceIdCounter).toBe(17);

        const dst = new GameState();
        restoreGameStateSnapshot(dst, snapshot, { seed: 1 });
        // reset() inside restore zeroes it; the restore must put it back to 17 so
        // the next ++_pieceIdCounter yields 18, not 1 (which would collide).
        expect(dst._pieceIdCounter).toBe(17);
    });

    it('falls back to a high-water mark from restored pieces for older demos', () => {
        const dst = new GameState();
        // Simulate an older snapshot lacking pieceIdCounter but with locked pieces.
        const legacySnapshot = {
            ...captureGameStateSnapshot(new GameState()),
            lockedPieces: [{ pieceId: 3 }, { pieceId: 9 }, { pieceId: 5 }],
        };
        delete legacySnapshot.pieceIdCounter;

        restoreGameStateSnapshot(dst, legacySnapshot, { seed: 1 });
        // Counter continues strictly above the max restored id (9) so the next
        // locked piece (++ -> 10) cannot collide with a restored id.
        expect(dst._pieceIdCounter).toBe(9);
    });

    it('full reset (not a restore) zeroes the counter', () => {
        const gs = new GameState();
        gs._pieceIdCounter = 42;
        gs.reset();
        expect(gs._pieceIdCounter).toBe(0);
    });
});
