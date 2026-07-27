// @ts-nocheck
/**
 * P0-4 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 §2.6) — defer, don't discard, drops during
 * physics. Pins the shared deferral helpers used by BOTH host (remote-player apply) and peer
 * (local prediction), so a hard drop pressed during a cascade lands on the next piece instead
 * of being ACK-and-discarded (which used to diverge the boards into a resync snap).
 */
import { describe, it, expect, vi } from 'vitest';
import { queueInputDuringPhysics, applyDeferredHardDrop } from '../../src/core/multiplayer/ffa/input-defer.js';

describe('queueInputDuringPhysics (P0-4 §2.6)', () => {
    it('flags a hard drop for deferral instead of discarding it', () => {
        const gs = {};
        queueInputDuringPhysics(gs, 'drop', { type: 'hard' });
        expect(gs._deferredHardDrop).toBe(true);
    });

    it('dedups: a second hard drop while one is pending stays a single flag', () => {
        const gs = {};
        queueInputDuringPhysics(gs, 'drop', { type: 'hard' });
        queueInputDuringPhysics(gs, 'drop', { type: 'hard' });
        expect(gs._deferredHardDrop).toBe(true); // boolean → exactly one drop, never two
    });

    it('does NOT defer a soft drop (replaying a held soft-drop at spawn is never intended)', () => {
        const gs = {};
        queueInputDuringPhysics(gs, 'drop', { type: 'soft' });
        expect(gs._deferredHardDrop).toBeUndefined();
    });

    it('queues move/rotate up to the cap of 4 (matches applyBufferedInputs splice(0,4))', () => {
        const gs = { inputQueue: null };
        for (let i = 0; i < 6; i++) queueInputDuringPhysics(gs, 'move', { direction: 1 });
        expect(Array.isArray(gs.inputQueue)).toBe(true);
        expect(gs.inputQueue.length).toBe(4);
        // The hard-drop flag is independent of the move cap.
        queueInputDuringPhysics(gs, 'drop', { type: 'hard' });
        expect(gs._deferredHardDrop).toBe(true);
    });
});

/** Minimal FFA-like harness exercising applyDeferredHardDrop without the god-class. */
function makeGame({ isHost = true, localPlayerId = 'host', steamId = 'remote', player } = {}) {
    const players = new Map();
    players.set(steamId, player);
    const remoteCallbacks = { kind: 'remote' };
    const hostCallbacks = { kind: 'host-local' };
    const peerCallbacks = { kind: 'peer-local-prediction' };
    return {
        isHost,
        localPlayerId,
        players,
        buildPhysicsCallbacks: vi.fn(() => hostCallbacks),
        buildRemotePlayerCallbacks: vi.fn(() => remoteCallbacks),
        buildLocalPredictionCallbacks: vi.fn(() => peerCallbacks),
        _applyInputToPlayer: vi.fn(),
        _callbacks: { remoteCallbacks, hostCallbacks, peerCallbacks },
    };
}

function alivePlayerWithPiece(deferred = true) {
    return {
        isAlive: true,
        gameState: { currentPiece: { x: 4, y: 0 }, isProcessingPhysics: false, _deferredHardDrop: deferred },
    };
}

describe('applyDeferredHardDrop (P0-4 §2.6)', () => {
    it('applies a pending drop exactly once to the new piece, then clears the flag', () => {
        const game = makeGame({ player: alivePlayerWithPiece(true) });
        applyDeferredHardDrop(game, 'remote');
        expect(game._applyInputToPlayer).toHaveBeenCalledTimes(1);
        expect(game._applyInputToPlayer).toHaveBeenCalledWith(
            'remote', 'drop', { type: 'hard' }, game._callbacks.remoteCallbacks,
        );
        expect(game.players.get('remote').gameState._deferredHardDrop).toBe(false);
        // A second spawn hook must not re-apply it.
        applyDeferredHardDrop(game, 'remote');
        expect(game._applyInputToPlayer).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no drop is pending', () => {
        const game = makeGame({ player: alivePlayerWithPiece(false) });
        applyDeferredHardDrop(game, 'remote');
        expect(game._applyInputToPlayer).not.toHaveBeenCalled();
    });

    it('uses host-local callbacks for the host player, remote callbacks for a peer', () => {
        const hostGame = makeGame({ localPlayerId: 'host', steamId: 'host', player: alivePlayerWithPiece(true) });
        applyDeferredHardDrop(hostGame, 'host');
        expect(hostGame._applyInputToPlayer).toHaveBeenCalledWith(
            'host', 'drop', { type: 'hard' }, hostGame._callbacks.hostCallbacks,
        );
    });

    it('uses local-prediction callbacks when running as a peer (isHost false)', () => {
        const peerGame = makeGame({ isHost: false, player: alivePlayerWithPiece(true) });
        applyDeferredHardDrop(peerGame, 'remote');
        expect(peerGame._applyInputToPlayer).toHaveBeenCalledWith(
            'remote', 'drop', { type: 'hard' }, peerGame._callbacks.peerCallbacks,
        );
    });

    it('does not apply to a dead player (topped out on spawn)', () => {
        const dead = alivePlayerWithPiece(true);
        dead.isAlive = false;
        const game = makeGame({ player: dead });
        applyDeferredHardDrop(game, 'remote');
        expect(game._applyInputToPlayer).not.toHaveBeenCalled();
    });

    it('does not apply while physics is still in progress (defensive guard)', () => {
        const busy = alivePlayerWithPiece(true);
        busy.gameState.isProcessingPhysics = true;
        const game = makeGame({ player: busy });
        applyDeferredHardDrop(game, 'remote');
        expect(game._applyInputToPlayer).not.toHaveBeenCalled();
    });
});
