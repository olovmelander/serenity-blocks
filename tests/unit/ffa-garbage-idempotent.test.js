/**
 * @fileoverview Regression test for "garbage looks strange on the peer".
 *
 * The peer PREDICT-CONSUMES a garbage burst the instant its own piece spawns
 * (_insertLocalGarbagePrediction), but the HOST consumes that same burst ~½RTT later
 * (it must receive+replay the peer's input first). In that window the host's serialized
 * queue STILL lists the burst the peer already inserted, so a blind wholesale replace in
 * _applySnapshotState RE-ADDS it → the next predicted spawn double-inserts the rows and
 * the meter drops-then-rebounds.
 *
 * Fix: the peer records bursts it predict-consumes (by attackId:lineIndex) and FILTERS
 * them out of the adopted host queue until the host stops listing them (consumed/cancelled
 * on the host too), then prunes the key. A fresh re-attack with a new attackId still lands.
 * Gated by ?garbageIdempotent (default on).
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { GarbageQueue } from '../../src/core/garbage.js';

function gbEntry(attackId, lineIndex, extra = {}) {
    return {
        type: 'line', attackId, attackSeq: 1, lineIndex, holeMask: 1, variant: 'normal', ...extra,
    };
}

function makePeerStub(consumed = []) {
    return {
        isHost: false,
        localPlayerId: 'P1',
        roundGeneration: 0,
        _localBoardHoldRoundGen: 0, // matches roundGeneration → gen-reset won't clear the set
        _localBoardHoldEnabled: false, // skip the LOCAL-BOARD HOLD logic (not under test)
        _holdStatsEnabled: false,
        _garbageIdempotentEnabled: true,
        _peerConsumedBursts: new Set(consumed),
        _garbageBurstKey: FFAGameStateP2P.prototype._garbageBurstKey,
        _reconcileLocalPiece: FFAGameStateP2P.prototype._reconcileLocalPiece,
        gamePhase: 'playing',
        winner: null,
        hotPotatoState: null,
        players: new Map(),
        renderAllPlayers: () => {},
    };
}

function snapshot(garbageEntries) {
    return {
        roundGeneration: 0,
        gamePhase: 'playing',
        players: [{
            steamId: 'P1', isAlive: true, score: 0, lines: 0, level: 1, frags: 0, garbageEntries,
        }],
    };
}

function apply(stub, state) {
    return FFAGameStateP2P.prototype._applySnapshotState.call(stub, state, { forceLocal: false, reconcileLocal: true });
}

function makeLocalPlayer() {
    return {
        steamId: 'P1', isAlive: true, gameState: {}, garbageQueue: { entries: [] },
    };
}

const ids = (player) => player.garbageQueue.entries.map((e) => `${e.attackId}:${e.lineIndex}`);

describe('idempotent garbage adoption (peer) — fixes "strange garbage"', () => {
    it('does NOT re-add a burst the peer already predict-consumed while the host still lists it', () => {
        const player = makeLocalPlayer();
        const stub = makePeerStub(['r1-a1:0', 'r1-a1:1']); // peer already inserted attack a1's two lines
        stub.players.set('P1', player);

        // Host snapshot STILL lists a1 (host ~½RTT behind consuming it) + a fresh a2.
        apply(stub, snapshot([gbEntry('r1-a1', 0), gbEntry('r1-a1', 1), gbEntry('r1-a2', 0)]));

        // a1's lines are filtered (already on the board); only the new a2 is adopted.
        expect(ids(player)).toEqual(['r1-a2:0']);
    });

    it('prunes the consumed key once the host stops listing it (host consumed/cancelled it too)', () => {
        const player = makeLocalPlayer();
        const stub = makePeerStub(['r1-a1:0']);
        stub.players.set('P1', player);

        apply(stub, snapshot([gbEntry('r1-a2', 0)])); // host no longer lists a1

        expect(stub._peerConsumedBursts.has('r1-a1:0')).toBe(false); // pruned (both sides agree it's gone)
        expect(ids(player)).toEqual(['r1-a2:0']);
    });

    it('lets a fresh re-attack with a NEW attackId land even while an old key is still consumed', () => {
        const player = makeLocalPlayer();
        const stub = makePeerStub(['r1-a1:0']);
        stub.players.set('P1', player);

        apply(stub, snapshot([gbEntry('r1-a1', 0), gbEntry('r1-a3', 0)]));

        expect(ids(player)).toEqual(['r1-a3:0']); // a1 filtered, the new a3 lands
    });

    it('drain-all consumes EVERY pending burst in one call (match local "dump"), single-dequeue takes one', () => {
        const lineEntry = (attackId, lineIndex, isLastInBurst) => ({ type: 'line', attackId, lineIndex, holeMask: 1, variant: 'normal', isLastInBurst });
        const drainAll = FFAGameStateP2P.prototype._drainAllLineBursts; // does not use `this`
        const seed = [
            lineEntry('a1', 0, false), lineEntry('a1', 1, true),
            lineEntry('a2', 0, false), lineEntry('a2', 1, false), lineEntry('a2', 2, true),
        ];

        // single dequeue returns only the first burst (a1), leaving a2 pending
        const single = new GarbageQueue();
        single.enqueue(seed.map((e) => ({ ...e })));
        expect(single.dequeueLineBurst().length).toBe(2);
        expect(single.getTotalLines()).toBe(3);

        // drain-all empties the queue and returns all 5 lines in order
        const all = new GarbageQueue();
        all.enqueue(seed.map((e) => ({ ...e })));
        const drained = drainAll.call({}, all);
        expect(drained.map((e) => `${e.attackId}:${e.lineIndex}`)).toEqual(['a1:0', 'a1:1', 'a2:0', 'a2:1', 'a2:2']);
        expect(all.getTotalLines()).toBe(0);
        expect(drainAll.call({}, new GarbageQueue())).toEqual([]); // empty queue → []
    });

    it('with ?garbageIdempotent=0 it adopts wholesale (no filtering) — clean revert path', () => {
        const player = makeLocalPlayer();
        const stub = makePeerStub(['r1-a1:0']);
        stub._garbageIdempotentEnabled = false;
        stub.players.set('P1', player);

        apply(stub, snapshot([gbEntry('r1-a1', 0)]));

        expect(ids(player)).toEqual(['r1-a1:0']); // not filtered when the flag is off
    });

    it('clears the consumed-set on a round-generation change so a new round adopts cleanly', () => {
        const player = makeLocalPlayer();
        const stub = makePeerStub(['r1-a1:0']);
        stub.roundGeneration = 1; // new round; stub._localBoardHoldRoundGen is still 0 → mismatch → reset+clear
        stub.players.set('P1', player);

        apply(stub, { roundGeneration: 1, gamePhase: 'playing', players: [{ steamId: 'P1', isAlive: true, score: 0, lines: 0, level: 1, frags: 0, garbageEntries: [gbEntry('r1-a1', 0)] }] });

        expect(stub._peerConsumedBursts.size).toBe(0); // cleared on the round boundary
        expect(ids(player)).toEqual(['r1-a1:0']); // adopted (no stale filtering across rounds)
    });
});
