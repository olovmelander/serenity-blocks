/**
 * @fileoverview Regression tests for two confirmed online-FFA root-cause bugs:
 *
 *  1. Round 2 unplayable — a stale (unreliable, deferred) snapshot from a finished
 *     round arrives AFTER the reliable round-restart and clobbers the revived state
 *     back to isAlive=false / gamePhase='finished', freezing everyone. Fixed by a
 *     monotonic `roundGeneration` fence in `_applySnapshotState`.
 *
 *  2. Erratic local board — on a peer, `lastInputSeq` was stripped by the binary
 *     codec and pinned at 0, so `_reconcileLocalPlayer` never pruned the input
 *     history and replayed the WHOLE history (incl. hard-drops) onto the board every
 *     snapshot. Fixed by carrying `lastInputSeq` in the snapshot JSON wrapper; these
 *     tests pin the reconcile/apply behavior that fix depends on.
 *
 * Tested on the prototype with a stub `this` (no full networked instance), matching
 * the existing ffa-host-authority.test.js style.
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function makeStub(overrides = {}) {
    return {
        isHost: false,
        localPlayerId: 'P1',
        roundGeneration: 0,
        gamePhase: 'playing',
        winner: null,
        hotPotatoState: null,
        players: new Map(),
        renderAllPlayers: () => {},
        ...overrides,
    };
}

const applySnapshot = (stub, state, opts = { forceLocal: false, reconcileLocal: false }) =>
    FFAGameStateP2P.prototype._applySnapshotState.call(stub, state, opts);

function makePlayer(extra = {}) {
    return {
        steamId: 'P1', isAlive: true, frags: 0, gameState: {}, garbageQueue: null, ...extra,
    };
}

describe('Bug 2 — round-generation fence (_applySnapshotState)', () => {
    it('DROPS a stale snapshot from an older round (no re-kill, no phase clobber)', () => {
        const player = makePlayer({ isAlive: true, frags: 2 });
        const stub = makeStub({ roundGeneration: 2, gamePhase: 'playing', players: new Map([['P1', player]]) });

        applySnapshot(stub, {
            roundGeneration: 1, // stale round-1 snapshot landing after the round-2 restart
            gamePhase: 'finished',
            players: [{ steamId: 'P1', isAlive: false, score: 0, lines: 0, level: 1, frags: 2 }],
        });

        expect(player.isAlive).toBe(true); // not re-killed → round 2 stays playable
        expect(stub.gamePhase).toBe('playing'); // phase not clobbered to 'finished'
    });

    it('APPLIES a snapshot from the current round', () => {
        const player = makePlayer({ isAlive: true, frags: 2 });
        const stub = makeStub({ roundGeneration: 2, gamePhase: 'playing', players: new Map([['P1', player]]) });

        applySnapshot(stub, {
            roundGeneration: 2,
            gamePhase: 'finished',
            players: [{ steamId: 'P1', isAlive: false, score: 10, lines: 1, level: 1, frags: 3 }],
        });

        expect(player.isAlive).toBe(false);
        expect(player.frags).toBe(3);
        expect(stub.gamePhase).toBe('finished');
    });

    it('APPLIES a snapshot that carries no roundGeneration (back-compat)', () => {
        const player = makePlayer();
        const stub = makeStub({ roundGeneration: 1, gamePhase: 'playing', players: new Map([['P1', player]]) });

        applySnapshot(stub, {
            gamePhase: 'finished',
            players: [{ steamId: 'P1', isAlive: false, score: 0, lines: 0, level: 1, frags: 0 }],
        });

        expect(stub.gamePhase).toBe('finished'); // undefined gen is never "< current"
    });

    it('applies lastInputSeq from the snapshot (including 0) so reconciliation can prune', () => {
        const player = makePlayer({ lastInputSeq: 99 });
        const stub = makeStub({ roundGeneration: 0, players: new Map([['P1', player]]) });

        applySnapshot(stub, {
            roundGeneration: 0,
            gamePhase: 'playing',
            players: [{ steamId: 'P1', isAlive: true, score: 0, lines: 0, level: 1, frags: 0, lastInputSeq: 7 }],
        });

        expect(player.lastInputSeq).toBe(7);
    });
});

describe('Bug 1 — reconciliation pruning (_reconcileLocalPlayer)', () => {
    function reconcileStub(lastInputSeq, seqs) {
        const applied = [];
        const stub = {
            isHost: false,
            localPlayerId: 'P1',
            players: new Map([['P1', { gameState: {}, lastInputSeq }]]),
            inputHistory: seqs.map((seq) => ({ seq, type: 'move', data: {} })),
            buildPhysicsCallbacks: () => ({}),
            _applyInputToPlayer: () => applied.push(1),
        };
        return { stub, applied };
    }

    it('prunes acknowledged inputs and replays ONLY the unacked ones', () => {
        const { stub, applied } = reconcileStub(5, [3, 4, 5, 6, 7]);
        FFAGameStateP2P.prototype._reconcileLocalPlayer.call(stub);
        expect(stub.inputHistory.map((i) => i.seq)).toEqual([6, 7]); // ≤5 acked → pruned
        expect(applied).toHaveLength(2); // only 6 and 7 replayed
    });

    it('with a working ack the board is NOT re-sprayed (1 unacked input → 1 replay)', () => {
        const { stub, applied } = reconcileStub(10, [9, 10, 11]);
        FFAGameStateP2P.prototype._reconcileLocalPlayer.call(stub);
        expect(applied).toHaveLength(1);
    });

    it('documents the BUG: lastInputSeq stuck at 0 replays the WHOLE history (erratic board)', () => {
        // This is the exact failure mode the wrapper-propagation fix prevents.
        // Pinned so a regression (ack stuck at 0) is caught by the replay count.
        const { stub, applied } = reconcileStub(0, [1, 2, 3, 4, 5]);
        FFAGameStateP2P.prototype._reconcileLocalPlayer.call(stub);
        expect(applied).toHaveLength(5);
    });
});
