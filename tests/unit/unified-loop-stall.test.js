/**
 * A stall is rebased, not replayed (audit N10, ADR-0012): one frame carries at most
 * MAX_FRAME_DELTA_MS of simulated time. Before, a host stall landed on every board at
 * once: gravity, lock delay and up to 32 rows of drop in one frame.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { MAX_FRAME_DELTA_MS, UnifiedMultiplayerLoop } from '../../src/core/multiplayer/unified-game-loop.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('unified loop stalls', () => {
    it('hands the boards at most MAX_FRAME_DELTA_MS from one frame, and counts the rest', () => {
        vi.stubGlobal('requestAnimationFrame', () => 1);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const loop = new UnifiedMultiplayerLoop();
        const deltas = [];
        loop.updatePlayers = (delta) => deltas.push(delta);
        loop.isRunning = true;
        loop.lastTime = 1000;

        loop.loop(1016);
        loop.loop(1016 + 2000); // a two-second stall
        loop.loop(3032);

        expect(deltas).toEqual([16, MAX_FRAME_DELTA_MS, 16]);
        expect(loop.rebasedMs).toBe(2000 - MAX_FRAME_DELTA_MS);
    });
});
