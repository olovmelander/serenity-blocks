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

import {
    describe,
    it,
    expect,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';

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

function applySnapshot(stub, state, opts = { forceLocal: false, reconcileLocal: false }) {
    return FFAGameStateP2P.prototype._applySnapshotState.call(stub, state, opts);
}

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
            players: [{
                steamId: 'P1', isAlive: false, score: 0, lines: 0, level: 1, frags: 2,
            }],
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
            players: [{
                steamId: 'P1', isAlive: false, score: 10, lines: 1, level: 1, frags: 3,
            }],
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
            players: [{
                steamId: 'P1', isAlive: false, score: 0, lines: 0, level: 1, frags: 0,
            }],
        });

        expect(stub.gamePhase).toBe('finished'); // undefined gen is never "< current"
    });

    it('applies lastInputSeq from the snapshot (including 0) so reconciliation can prune', () => {
        const player = makePlayer({ lastInputSeq: 99 });
        const stub = makeStub({ roundGeneration: 0, players: new Map([['P1', player]]) });

        applySnapshot(stub, {
            roundGeneration: 0,
            gamePhase: 'playing',
            players: [{
                steamId: 'P1', isAlive: true, score: 0, lines: 0, level: 1, frags: 0, lastInputSeq: 7,
            }],
        });

        expect(player.lastInputSeq).toBe(7);
    });
});

describe('Local-piece ownership — _reconcileLocalPlayer (prune-only) + _reconcileLocalPiece', () => {
    // The peer's falling piece is now LOCALLY OWNED (Quadra model). _reconcileLocalPlayer
    // no longer resets the local board to the host snapshot and replays unacked inputs —
    // that fought the local sim and snapped rotation/x on the peer's OWN board. It now
    // ONLY prunes acked inputs. _reconcileLocalPiece reconciles the piece vs the host
    // ONLY on divergence (no active host piece / type change / illegal pose).
    function pruneStub(lastInputSeq, seqs) {
        const replayed = [];
        const stub = {
            isHost: false,
            localPlayerId: 'P1',
            players: new Map([['P1', { gameState: {}, lastInputSeq }]]),
            inputHistory: seqs.map((seq) => ({ seq, type: 'move', data: {} })),
            _applyInputToPlayer: () => replayed.push(1),
        };
        return { stub, replayed };
    }

    it('prunes acknowledged inputs (keeps unacked) and does NOT replay them', () => {
        const { stub, replayed } = pruneStub(5, [3, 4, 5, 6, 7]);
        FFAGameStateP2P.prototype._reconcileLocalPlayer.call(stub);
        expect(stub.inputHistory.map((i) => i.seq)).toEqual([6, 7]); // ≤5 acked → pruned
        expect(replayed).toHaveLength(0); // local piece is locally owned — never replayed
    });

    it('keeps all inputs when none are acked, and still never replays (no erratic re-spray)', () => {
        const { stub, replayed } = pruneStub(0, [1, 2, 3, 4, 5]);
        FFAGameStateP2P.prototype._reconcileLocalPlayer.call(stub);
        expect(stub.inputHistory).toHaveLength(5);
        expect(replayed).toHaveLength(0); // ack stuck at 0 no longer replays the WHOLE history
    });

    const reconcilePiece = (gs, host) => FFAGameStateP2P.prototype._reconcileLocalPiece.call({}, gs, host);

    it('keeps the local piece when the host shows no active piece (mid-lock / line-clear)', () => {
        const local = { type: 'T', x: 4, y: 6, rotation: 1 };
        const gs = { currentPiece: local };
        reconcilePiece(gs, null);
        expect(gs.currentPiece).toBe(local); // untouched — no snap
    });

    it('adopts the host piece when there is no local piece', () => {
        const gs = { currentPiece: null };
        reconcilePiece(gs, { type: 'O', x: 3, y: 0 });
        expect(gs.currentPiece).toMatchObject({ type: 'O' });
    });

    it('adopts the host piece on a type change (a lock happened → fresh spawn, nothing to snap)', () => {
        const gs = { currentPiece: { type: 'T', x: 4, y: 8, rotation: 2 } };
        reconcilePiece(gs, { type: 'I', x: 4, y: 0, rotation: 0 });
        expect(gs.currentPiece).toMatchObject({ type: 'I', y: 0 });
    });
});

describe('Quadra lock-events — _applyAuthoritativeLock (peer snap)', () => {
    const grid = (cell) => Array.from({ length: 24 }, () => Array.from({ length: 10 }, () => cell));
    const apply = (stub, data) => FFAGameStateP2P.prototype._applyAuthoritativeLock.call(stub, data);

    function lockStub(overrides = {}) {
        return {
            isHost: false,
            _lockEventsEnabled: true,
            localPlayerId: 'ME',
            roundGeneration: 1,
            players: new Map([['OPP', {
                gameState: { boardGrid: grid(null), currentPiece: { type: 'I', x: 4, y: 0 } },
            }]]),
            renderAllPlayers: () => {},
            ...overrides,
        };
    }
    const lockMsg = (over = {}) => ({
        playerSteamId: 'OPP',
        lockSeq: 5,
        roundGeneration: 1,
        hostTick: 100,
        grid: grid({ color: '#fff', type: 'I' }),
        currentPiece: { type: 'O', x: 3, y: 0 },
        topOut: false,
        ...over,
    });

    it('snaps the opponent grid + piece and records lockSeq/hostTick', () => {
        const stub = lockStub();
        apply(stub, lockMsg());
        const opp = stub.players.get('OPP');
        expect(opp.gameState.boardGrid[23][0]).toMatchObject({ type: 'I' });
        expect(opp.gameState.currentPiece).toMatchObject({ type: 'O' });
        expect(opp._lastAppliedLockSeq).toBe(5);
        expect(opp._lastLockHostTick).toBe(100);
    });

    it('emits a local cosmetic PIECE_LOCK event when a remote authoritative lock applies', () => {
        const seen = [];
        const off = onMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, (detail) => seen.push(detail));
        try {
            const stub = lockStub();
            apply(stub, lockMsg());
            expect(seen).toEqual([expect.objectContaining({
                steamId: 'OPP',
                isLocal: false,
                source: 'authoritative-lock',
            })]);
        } finally {
            off();
        }
    });

    it('drops a lock-event from an older round (fence)', () => {
        const stub = lockStub({ roundGeneration: 3 });
        apply(stub, lockMsg({ roundGeneration: 2 }));
        expect(stub.players.get('OPP')._lastAppliedLockSeq).toBeUndefined(); // not applied
    });

    it('is idempotent / ordered — drops a replayed or older lockSeq', () => {
        const stub = lockStub();
        apply(stub, lockMsg({ lockSeq: 5 }));
        const before = stub.players.get('OPP').gameState.boardGrid;
        apply(stub, lockMsg({ lockSeq: 5, grid: grid({ color: '#000', type: 'Z' }) })); // replay
        expect(stub.players.get('OPP').gameState.boardGrid).toBe(before); // unchanged
    });

    it('never snaps the LOCAL player (prediction owns it)', () => {
        const stub = lockStub({
            players: new Map([['ME', { gameState: { boardGrid: grid(null), currentPiece: null } }]]),
        });
        apply(stub, lockMsg({ playerSteamId: 'ME' }));
        expect(stub.players.get('ME')._lastAppliedLockSeq).toBeUndefined();
    });

    it('is a no-op when the flag is off', () => {
        const stub = lockStub({ _lockEventsEnabled: false });
        apply(stub, lockMsg());
        expect(stub.players.get('OPP')._lastAppliedLockSeq).toBeUndefined();
    });
});

describe('Quadra ready-barrier — all-players-ready round syncpoint (host)', () => {
    // These methods call sibling prototype methods (_beginReadyBarrier →
    // _maybeFinalizeRoundStart → _finalizeRoundStart), so the stub puts the prototype
    // in its chain (Object.create) while skipping the constructor.
    function barrierStub(playerIds, overrides = {}) {
        const broadcasts = [];
        const stub = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            localPlayerId: 'HOST',
            roundGeneration: 4,
            players: new Map(playerIds.map((id) => [id, { steamId: id }])),
            hideCountdownOverlay: () => {},
            READY_BARRIER_TIMEOUT_MS: 100000, // never fires within a test
            _roundReady: null,
            _roundReadyExpected: null,
            _pendingRoundStart: null,
            _readyBarrierTimer: null,
            _recordNetEvent: vi.fn(),
            network: { broadcastToAll: (type, data) => broadcasts.push({ type, data }) },
            ...overrides,
        });
        return { stub, broadcasts };
    }
    const goSent = (broadcasts) => broadcasts.filter((b) => b.type === MessageTypes.GAME_ROUND_START);

    it('_expectedReadyPeers is every current player', () => {
        const { stub } = barrierStub(['HOST', 'P2', 'P3']);
        expect([...stub._expectedReadyPeers()].sort()).toEqual(['HOST', 'P2', 'P3']);
    });

    it('a host-only round starts immediately (no peers to wait on)', () => {
        const { stub, broadcasts } = barrierStub(['HOST']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
        expect(stub._readyBarrierTimer).toBeNull(); // timer cleared on finalize
    });

    it('blocks on an un-acked peer, then starts the instant it acks', () => {
        const { stub, broadcasts } = barrierStub(['HOST', 'P2']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });
        expect(started).toBe(0); // host ready, P2 not → blocked
        expect(goSent(broadcasts)).toHaveLength(0);

        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 4 } });
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
    });

    it('_finalizeRoundStart is idempotent — no double start, no double GO', () => {
        const { stub, broadcasts } = barrierStub(['HOST']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; }); // finalizes (solo)
        stub._finalizeRoundStart(); // a late timeout fire after we already started
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
    });

    it('snapshots expected players when the barrier begins', () => {
        const { stub, broadcasts } = barrierStub(['HOST', 'P2']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });

        // A late join/update after the restart should not expand the current
        // barrier to a player who never received that restart packet.
        stub.players.set('P3', { steamId: 'P3' });
        expect([...stub._expectedReadyPeers()].sort()).toEqual(['HOST', 'P2']);

        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 4 } });
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
    });

    it('ignores stale-generation and unexpected readies', () => {
        const { stub, broadcasts } = barrierStub(['HOST', 'P2']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });

        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 3 } });
        stub._handleRoundReady({ from: 'P3', data: { roundGeneration: 4 } });
        expect(started).toBe(0);
        expect(goSent(broadcasts)).toHaveLength(0);
        expect(stub._recordNetEvent).toHaveBeenCalledWith('round_ready_ignored', expect.objectContaining({
            steamId: 'P2',
            reason: 'generation',
        }));
        expect(stub._recordNetEvent).toHaveBeenCalledWith('round_ready_ignored', expect.objectContaining({
            steamId: 'P3',
            reason: 'unexpected_peer',
            expected: ['HOST', 'P2'],
        }));

        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 4 } });
        expect(started).toBe(1);
    });

    it('dedupes repeated readies before the barrier finalizes', () => {
        const { stub, broadcasts } = barrierStub(['HOST', 'P2', 'P3']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });

        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 4 } });
        stub._handleRoundReady({ from: 'P2', data: { roundGeneration: 4 } });
        expect(started).toBe(0);
        expect(stub._recordNetEvent).toHaveBeenCalledWith('round_ready_duplicate', expect.objectContaining({
            steamId: 'P2',
            roundGeneration: 4,
        }));

        stub._handleRoundReady({ from: 'P3', data: { roundGeneration: 4 } });
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
    });

    it('timeout fallback starts the round even if a peer never acks (never hangs)', () => {
        const { stub, broadcasts } = barrierStub(['HOST', 'P2']);
        let started = 0;
        stub._beginReadyBarrier(() => { started += 1; });
        expect(started).toBe(0); // still blocked on P2
        stub._finalizeRoundStart(); // simulate the READY_BARRIER_TIMEOUT_MS callback
        expect(started).toBe(1);
        expect(goSent(broadcasts)).toHaveLength(1);
        expect(stub._recordNetEvent).toHaveBeenCalledWith('round_barrier_finalized', expect.objectContaining({
            ready: ['HOST'],
            missing: ['P2'],
            readyCount: 1,
            expectedCount: 2,
        }));
    });
});
