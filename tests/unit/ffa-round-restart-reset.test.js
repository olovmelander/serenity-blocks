/**
 * @fileoverview Regression test for the round-restart "topped out on spawn" bug.
 *
 * Root cause: restartMatch / performRoundRestart REPLACED each player's gameState
 * object (`player.gameState = new GameState()`), which orphaned every reference still
 * held to the old object — the unified-loop player registration, the input jitter
 * buffer, the BoardScene, the render slots. On round 2+ the LOCAL player's input and
 * gravity then drove a DETACHED board: pieces fell, no lines cleared, and it "topped
 * out on spawn". The fix resets the board IN PLACE (`gameState.reset()`), preserving
 * the object reference (mirroring the proven initial path initializePlayerForMatch).
 *
 * This pins the invariant: a round restart must NOT swap the gameState object.
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { GameState } from '../../src/core/game.js';

function restartStub(gameState) {
    const player = {
        steamId: 'HOST',
        isAlive: false, // dead at end of previous round — restart must revive
        frags: 1,
        gameState,
        garbageQueue: { clear() {} },
        lastAttackerId: 'SOMEONE',
    };
    let jitterCleared = 0;
    let loopStarted = 0;
    let heartbeatStarts = 0;
    let lastStopWasBeforeHeartbeat = false;
    let sawStopState = false;
    const stub = {
        isHost: true,
        localPlayerId: 'HOST',
        roundGeneration: 0,
        _readyBarrierEnabled: false, // instant-restart path
        players: new Map([['HOST', player]]),
        matchConfig: { startLevel: 1 },
        inputJitterBuffer: { clear() { jitterCleared += 1; }, addPlayer() {} },
        fragTracker: { reset() {} },
        attackRouter: { clearHistory() {} },
        network: { broadcastToAll() {}, resetSnapshotBaselines() {} },
        stopGameLoop() {},
        stopStateSyncLoop() { sawStopState = true; },
        startGameLoop() { loopStarted += 1; },
        startStateSyncLoop() {},
        // A4b: the heartbeat must be re-armed during the restart (before the round actually
        // starts) so the host keeps beating through the barrier/countdown wait.
        startHeartbeatLoop() { heartbeatStarts += 1; if (sawStopState) lastStopWasBeforeHeartbeat = true; },
        stopHeartbeatLoop() {},
        hideCountdownOverlay() {},
        showCountdown() {},
        createSeededRNG: () => () => 0.5,
    };
    const stats = {
        get jitterCleared() { return jitterCleared; },
        get loopStarted() { return loopStarted; },
        get heartbeatStarts() { return heartbeatStarts; },
        get heartbeatRearmedAfterStop() { return lastStopWasBeforeHeartbeat; },
    };
    return { stub, player, stats };
}

describe('FFA round restart — in-place gameState reset (no object swap)', () => {
    it('keeps the SAME gameState object, clears the board, preserves score/lines/level, revives', () => {
        const gs = new GameState();
        gs.score = 5000;
        gs.lines = 14;
        gs.level = 3;
        gs.boardGrid[23][0] = { type: 'I' }; // dirty the board from the previous round

        const { stub, player } = restartStub(gs);
        FFAGameStateP2P.prototype.restartMatch.call(stub);

        // THE invariant: same object reference (in-place reset, not `new GameState()`).
        expect(player.gameState).toBe(gs);
        // Board was cleared by reset() — the stale cell is gone.
        expect(player.gameState.boardGrid[23][0]).toBeNull();
        // Cumulative stats preserved across the round.
        expect(player.gameState.score).toBe(5000);
        expect(player.gameState.lines).toBe(14);
        expect(player.gameState.level).toBe(3);
        // Player revived and round generation bumped.
        expect(player.isAlive).toBe(true);
        expect(stub.roundGeneration).toBe(1);
    });

    it('clears the input jitter buffer and restarts the loop on restart', () => {
        const gs = new GameState();
        const { stub, stats } = restartStub(gs);
        FFAGameStateP2P.prototype.restartMatch.call(stub);
        expect(stats.jitterCleared).toBe(1); // stale round inputs flushed
        expect(stats.loopStarted).toBe(1);
    });

    it('A4b: re-arms the heartbeat during the restart (after stopping state sync)', () => {
        const gs = new GameState();
        const { stub, stats } = restartStub(gs);
        FFAGameStateP2P.prototype.restartMatch.call(stub);
        // Heartbeat must be (re)started so the host keeps beating through the restart
        // window, and it must happen AFTER stopStateSyncLoop() (which kills it).
        expect(stats.heartbeatStarts).toBeGreaterThanOrEqual(1);
        expect(stats.heartbeatRearmedAfterStop).toBe(true);
    });
});
