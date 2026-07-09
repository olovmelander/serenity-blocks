/**
 * @fileoverview Phase A — lobby/start/restart polish (Quadra-experience parity).
 *
 * A2: the host enforces its configured maxPlayers on the join path (Steam enforces the
 *     lobby cap for real play, but the mock transport / in-app add path did not, and a 9th
 *     player wraps the 8-colour palette).
 * A4a: the rematch-vote threshold routes through the CANONICAL full-restart path
 *     (restartFullGame) — the inferior startNewMatch() (no ready-barrier, no host-stamped
 *     roundGeneration) was deleted.
 */

import { describe, it, expect, vi } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function hostStub(overrides = {}) {
    return {
        isHost: true,
        localPlayerId: 'HOST',
        loopRunning: false,
        players: new Map(),
        matchConfig: { maxPlayers: 2, startLevel: 1 },
        network: { sendP2PMessage: vi.fn() },
        broadcastPlayerList: vi.fn(),
        ...overrides,
    };
}

describe('A2 — host enforces maxPlayers on join', () => {
    it('rejects a remote join past the configured cap and sends JOIN_REJECTED', () => {
        const stub = hostStub();
        const r1 = FFAGameStateP2P.prototype.addPlayer.call(stub, 'HOST', 'Host', true); // local host seat
        const r2 = FFAGameStateP2P.prototype.addPlayer.call(stub, 'P2', 'Bravo', false); // fills cap (2)
        expect(r1).toBe(true);
        expect(r2).toBe(true);
        expect(stub.players.size).toBe(2);

        // Third remote join must be rejected (cap = 2) and report false so the NET_HELLO
        // handshake can answer accepted=false (else the joiner proceeds without a seat).
        const r3 = FFAGameStateP2P.prototype.addPlayer.call(stub, 'P3', 'Charlie', false);
        expect(r3).toBe(false);
        expect(stub.players.size).toBe(2);
        expect(stub.players.has('P3')).toBe(false);
        expect(stub.network.sendP2PMessage).toHaveBeenCalledWith(
            'P3',
            expect.stringContaining('rejected'),
            expect.objectContaining({ reason: 'lobby_full', cap: 2 }),
        );
    });

    it('always admits the LOCAL player even at/over cap (you never reject yourself)', () => {
        const stub = hostStub({ matchConfig: { maxPlayers: 1, startLevel: 1 } });
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'HOST', 'Host', true);
        expect(stub.players.has('HOST')).toBe(true);
        expect(stub.players.size).toBe(1);
    });

    it('does not reject when under cap (returns true)', () => {
        const stub = hostStub({ matchConfig: { maxPlayers: 8, startLevel: 1 } });
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'HOST', 'Host', true);
        const added = FFAGameStateP2P.prototype.addPlayer.call(stub, 'P2', 'Bravo', false);
        expect(added).toBe(true);
        expect(stub.players.size).toBe(2);
        expect(stub.network.sendP2PMessage).not.toHaveBeenCalled();
    });

    it('a non-host never rejects joins (only the authoritative host gates the roster)', () => {
        const stub = hostStub({ isHost: false, matchConfig: { maxPlayers: 1, startLevel: 1 } });
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'HOST', 'Host', false);
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'P2', 'Bravo', false);
        expect(stub.players.size).toBe(2); // peer mirrors the host roster, doesn't gate
    });
});

describe('A4a — rematch routes through the canonical restart path', () => {
    it('a majority rematch vote calls restartFullGame (not the deleted startNewMatch)', () => {
        vi.useFakeTimers();
        const restartFullGame = vi.fn();
        const stub = {
            isHost: true,
            players: new Map([['HOST', {}], ['P2', {}]]),
            rematchVotes: new Set(['HOST', 'P2']), // both voted → majority
            restartFullGame,
        };
        FFAGameStateP2P.prototype.checkRematchThreshold.call(stub);
        vi.runAllTimers();
        expect(restartFullGame).toHaveBeenCalledTimes(1);
        expect(stub.rematchVotes.size).toBe(0); // votes cleared on trigger
        vi.useRealTimers();
    });

    it('startNewMatch was removed from the prototype', () => {
        expect(FFAGameStateP2P.prototype.startNewMatch).toBeUndefined();
    });

    it('does not restart below the majority threshold', () => {
        const restartFullGame = vi.fn();
        const stub = {
            isHost: true,
            players: new Map([['HOST', {}], ['P2', {}], ['P3', {}]]),
            rematchVotes: new Set(['HOST']), // 1 of 3 → below ceil(3/2)=2
            restartFullGame,
        };
        FFAGameStateP2P.prototype.checkRematchThreshold.call(stub);
        expect(restartFullGame).not.toHaveBeenCalled();
    });
});

describe('A4c — restart-race snapshot guard', () => {
    // A SENTINEL thrown from state.players.forEach lets us detect whether _applySnapshotState
    // reached player-iteration (guard passed) or returned early (guard dropped the snapshot),
    // without running the heavy per-player apply code.
    const SENTINEL = new Error('reached-player-apply');
    function snapshot() {
        return { roundGeneration: 5, players: { forEach: vi.fn(() => { throw SENTINEL; }) } };
    }
    function peerStub(overrides = {}) {
        return {
            isHost: false,
            localPlayerId: 'P1',
            roundGeneration: 5,
            _localBoardHoldRoundGen: 5,
            _netDiagEnabled: false,
            _peerConsumedBursts: { clear() {} },
            players: new Map([['P1', { gameState: {} }]]),
            ...overrides,
        };
    }
    function apply(stub, state, opts) {
        try {
            FFAGameStateP2P.prototype._applySnapshotState.call(stub, state, opts);
            return false; // returned early (guard dropped it)
        } catch (e) {
            if (e === SENTINEL) return true; // reached player-apply (guard passed)
            throw e;
        }
    }

    it('drops a snapshot while the peer is awaiting GAME_ROUND_START (_pendingRoundStart set)', () => {
        const stub = peerStub({ _pendingRoundStart: () => {} });
        const state = snapshot();
        const reached = apply(stub, state, { forceLocal: false, reconcileLocal: true });
        expect(reached).toBe(false); // guard fired → snapshot dropped, board untouched
        expect(state.players.forEach).not.toHaveBeenCalled();
    });

    it('applies normally when NOT awaiting a round start', () => {
        const stub = peerStub({ _pendingRoundStart: null });
        const reached = apply(stub, snapshot(), { forceLocal: false, reconcileLocal: true });
        expect(reached).toBe(true); // guard passed → reached player-apply
    });

    it('a forceLocal digest-resync bypasses the guard even while awaiting round start', () => {
        const stub = peerStub({ _pendingRoundStart: () => {} });
        const reached = apply(stub, snapshot(), { forceLocal: true, reconcileLocal: true });
        expect(reached).toBe(true); // the one correction path is allowed through
    });

    it('does not apply on the HOST (guard is peer-only)', () => {
        const stub = peerStub({ isHost: true, _pendingRoundStart: () => {} });
        const reached = apply(stub, snapshot(), { forceLocal: false, reconcileLocal: true });
        expect(reached).toBe(true); // host isn't gated by this peer-side guard
    });
});
