/**
 * Plan §1.3 — spoof tests for the five sender-validation holes (+ ready toggle).
 *
 * msg.from is stamped from the transport-level Steam identity in
 * _dispatchEnvelope — never attacker-writable payload — which is exactly what
 * makes these in-process spoof tests meaningful. Guards fail-open (missing
 * from/hostSteamId allows) so mock transports and races can't break legit
 * traffic; the structural replacement is the §6A.3 default-deny role table.
 */
import {
    describe, it, expect, vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

const HOST = 'HOST_ID';

function makeStub(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: false,
        localPlayerId: 'LOCAL',
        roundGeneration: 0,
        network: { hostSteamId: HOST },
        players: new Map(),
        _spoofDrops: 0,
        ...overrides,
    });
}

describe('hole a — LOBBY_GAME_START (match start on another peer)', () => {
    const msg = (from) => ({
        from, data: { sharedSeed: 42, config: {}, roundGeneration: 0 },
    });

    it('rejects a non-host sender', () => {
        const stub = makeStub({ startMatch: vi.fn() });
        stub._handleLobbyGameStart(msg('EVIL'));
        expect(stub.startMatch).not.toHaveBeenCalled();
        expect(stub._spoofDrops).toBe(1);
    });

    it('accepts the host', () => {
        const stub = makeStub({ startMatch: vi.fn() });
        stub._handleLobbyGameStart(msg(HOST));
        expect(stub.startMatch).toHaveBeenCalledWith(42, {}, { inProgress: false });
    });

    it('accepts seed zero but rejects a missing seed before generation adoption', () => {
        const zero = makeStub({ startMatch: vi.fn() });
        zero._handleLobbyGameStart({
            from: HOST,
            data: { sharedSeed: 0, config: {}, roundGeneration: 0 },
        });
        expect(zero.startMatch).toHaveBeenCalledWith(0, {}, { inProgress: false });

        const missing = makeStub({
            roundGeneration: 4,
            pendingInputs: [{ seq: 9 }],
            startMatch: vi.fn(),
        });
        missing._handleLobbyGameStart({
            from: HOST,
            data: { config: {}, roundGeneration: 5 },
        });
        expect(missing.roundGeneration).toBe(4);
        expect(missing.pendingInputs).toEqual([{ seq: 9 }]);
        expect(missing.startMatch).not.toHaveBeenCalled();
    });

    it('canonicalizes numeric-string seeds and rejects invalid types before any mutation', () => {
        const compatible = makeStub({ startMatch: vi.fn() });
        compatible._handleLobbyGameStart({
            from: HOST,
            data: { sharedSeed: ' 42 ', config: {}, roundGeneration: 1 },
        });
        expect(compatible.roundGeneration).toBe(1);
        expect(compatible.startMatch).toHaveBeenCalledWith(42, {}, { inProgress: false });

        [false, true, '', 'not-a-seed', Number.NaN, Number.POSITIVE_INFINITY, [], {}]
            .forEach((sharedSeed) => {
                const invalid = makeStub({
                    roundGeneration: 4,
                    pendingInputs: [{ seq: 9 }],
                    inputHistory: [{ seq: 9 }],
                    inputSequence: 9,
                    _ffaInputGroupSequence: 3,
                    _lastLobbyStartGeneration: 3,
                    startMatch: vi.fn(),
                });
                invalid._handleLobbyGameStart({
                    from: HOST,
                    data: { sharedSeed, config: {}, roundGeneration: 5 },
                });
                expect(invalid.roundGeneration).toBe(4);
                expect(invalid.pendingInputs).toEqual([{ seq: 9 }]);
                expect(invalid.inputHistory).toEqual([{ seq: 9 }]);
                expect(invalid.inputSequence).toBe(9);
                expect(invalid._ffaInputGroupSequence).toBe(3);
                expect(invalid._lastLobbyStartGeneration).toBe(3);
                expect(invalid.startMatch).not.toHaveBeenCalled();
            });
    });

    it('adopts the host match generation before resetting the local board', () => {
        const stub = makeStub({
            roundGeneration: 4,
            pendingInputs: [{ seq: 9 }],
            inputHistory: [{ seq: 9 }],
            inputSequence: 9,
            _ffaInputGroupSequence: 3,
            startMatch: vi.fn(),
        });
        stub._handleLobbyGameStart({
            from: HOST,
            data: { sharedSeed: 42, config: {}, roundGeneration: 5 },
        });

        expect(stub.roundGeneration).toBe(5);
        expect(stub.pendingInputs).toEqual([]);
        expect(stub.inputSequence).toBe(0);
        expect(stub.startMatch).toHaveBeenCalledOnce();
    });

    it('rejects stale or duplicate match-start generations', () => {
        const stale = makeStub({ roundGeneration: 4, startMatch: vi.fn() });
        stale._handleLobbyGameStart({
            from: HOST,
            data: { sharedSeed: 42, config: {}, roundGeneration: 3 },
        });
        expect(stale.roundGeneration).toBe(4);
        expect(stale.startMatch).not.toHaveBeenCalled();

        const duplicate = makeStub({
            roundGeneration: 4,
            _lastLobbyStartGeneration: 4,
            startMatch: vi.fn(),
        });
        duplicate._handleLobbyGameStart({
            from: HOST,
            data: { sharedSeed: 42, config: {}, roundGeneration: 4 },
        });
        expect(duplicate.startMatch).not.toHaveBeenCalled();
    });

    it('fails open when the transport did not stamp a sender', () => {
        const stub = makeStub({ startMatch: vi.fn() });
        stub._handleLobbyGameStart(msg(undefined));
        expect(stub.startMatch).toHaveBeenCalled();
    });
});

describe('hole b — GAME_ROUND_START (premature ready-barrier release)', () => {
    function readyStub() {
        return makeStub({
            roundGeneration: 4,
            _readyBarrierTimer: null,
            _pendingRoundStart: vi.fn(),
        });
    }
    const msg = (from) => ({ from, data: { roundGeneration: 4 } });

    it('a peer cannot release the barrier', () => {
        const stub = readyStub();
        const thunk = stub._pendingRoundStart;
        stub._handleRoundStartSignal(msg('EVIL'));
        expect(thunk).not.toHaveBeenCalled();
        expect(stub._pendingRoundStart).toBe(thunk); // still pending for the real GO
    });

    it('the host GO releases it', () => {
        const stub = readyStub();
        const thunk = stub._pendingRoundStart;
        stub._handleRoundStartSignal(msg(HOST));
        expect(thunk).toHaveBeenCalledTimes(1);
        expect(stub._pendingRoundStart).toBe(null);
    });

    it('a stale round generation is still fenced even from the host', () => {
        const stub = readyStub();
        stub._handleRoundStartSignal({ from: HOST, data: { roundGeneration: 3 } });
        expect(stub._pendingRoundStart).not.toHaveBeenCalled();
    });
});

describe('hole c — LOBBY_PLAYER_LEFT (evict anyone from every roster)', () => {
    const msg = (from, steamId) => ({ from, data: { steamId } });

    it('a peer cannot evict another player', () => {
        const stub = makeStub({ removePlayer: vi.fn() });
        stub._handleLobbyPlayerLeft(msg('EVIL', 'VICTIM'));
        expect(stub.removePlayer).not.toHaveBeenCalled();
    });

    it('a peer may announce its own departure', () => {
        const stub = makeStub({ removePlayer: vi.fn() });
        stub._handleLobbyPlayerLeft(msg('PEER', 'PEER'));
        expect(stub.removePlayer).toHaveBeenCalledWith('PEER');
    });

    it('the host may remove anyone', () => {
        const stub = makeStub({ removePlayer: vi.fn() });
        stub._handleLobbyPlayerLeft(msg(HOST, 'VICTIM'));
        expect(stub.removePlayer).toHaveBeenCalledWith('VICTIM');
    });
});

describe('hole d — LOBBY_PLAYER_JOINED (forged joins + roster rewrite)', () => {
    it('host rejects a join announcement under someone else\'s id', () => {
        const stub = makeStub({
            isHost: true,
            localPlayerId: HOST,
            addPlayer: vi.fn(() => true),
            queueResync: vi.fn(),
            _registerSpectator: vi.fn(),
        });
        stub._handleLobbyPlayerJoined({ from: 'EVIL', data: { steamId: 'FAKE', name: 'Forged' } });
        expect(stub.addPlayer).not.toHaveBeenCalled();
        expect(stub._registerSpectator).not.toHaveBeenCalled();
    });

    it('host accepts a peer announcing itself', () => {
        const stub = makeStub({
            isHost: true,
            localPlayerId: HOST,
            network: {
                hostSteamId: HOST,
                hasNegotiatedProtocol: () => true,
            },
            addPlayer: vi.fn(() => true),
            queueResync: vi.fn(),
        });
        stub._handleLobbyPlayerJoined({ from: 'PEER', data: { steamId: 'PEER', name: 'Real' } });
        expect(stub.addPlayer).toHaveBeenCalledWith('PEER', 'Real');
        expect(stub.queueResync).toHaveBeenCalledWith('PEER');
    });

    it('peer rejects a roster rewrite from a non-host', () => {
        const stub = makeStub({ addPlayer: vi.fn(), spectatorCount: 0 });
        stub._handleLobbyPlayerJoined({
            from: 'EVIL',
            data: {
                players: [{
                    steamId: 'GHOST', name: 'Ghost', isReady: true, isAlive: true,
                }],
            },
        });
        expect(stub.addPlayer).not.toHaveBeenCalled();
        expect(stub.players.size).toBe(0);
    });

    it('peer adopts the host\'s authoritative roster', () => {
        const stub = makeStub({ addPlayer: vi.fn(), spectatorCount: 0 });
        stub._handleLobbyPlayerJoined({
            from: HOST,
            data: { players: [{ steamId: 'P2', name: 'Player2' }], spectatorCount: 1 },
        });
        expect(stub.addPlayer).toHaveBeenCalledWith('P2', 'Player2', false);
        expect(stub.spectatorCount).toBe(1);
    });
});

describe('ready toggle — LOBBY_PLAYER_READY (same class as hole c)', () => {
    function rosterStub() {
        return makeStub({
            players: new Map([['VICTIM', { name: 'Victim', isReady: false }]]),
        });
    }

    it('a peer cannot toggle another player\'s ready state', () => {
        const stub = rosterStub();
        stub._handleLobbyPlayerReady({ from: 'EVIL', data: { steamId: 'VICTIM', isReady: true } });
        expect(stub.players.get('VICTIM').isReady).toBe(false);
    });

    it('a player may toggle itself', () => {
        const stub = rosterStub();
        stub._handleLobbyPlayerReady({ from: 'VICTIM', data: { steamId: 'VICTIM', isReady: true } });
        expect(stub.players.get('VICTIM').isReady).toBe(true);
    });
});

describe('hole e — NET_HEARTBEAT (host-liveness spoof / election suppression)', () => {
    it('a peer heartbeat cannot refresh host liveness or cancel elections', () => {
        const stub = makeStub({ hostMigration: { onHeartbeat: vi.fn() } });
        stub._handleNetHeartbeat({ from: 'EVIL' });
        expect(stub.hostMigration.onHeartbeat).not.toHaveBeenCalled();
        expect(stub._heartbeatSpoofsIgnored).toBe(1);
    });

    it('the host heartbeat refreshes liveness', () => {
        const stub = makeStub({ hostMigration: { onHeartbeat: vi.fn() } });
        stub._handleNetHeartbeat({ from: HOST });
        expect(stub.hostMigration.onHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('fails open when hostSteamId is not yet known', () => {
        const stub = makeStub({
            network: { hostSteamId: null },
            hostMigration: { onHeartbeat: vi.fn() },
        });
        stub._handleNetHeartbeat({ from: 'ANYONE' });
        expect(stub.hostMigration.onHeartbeat).toHaveBeenCalledTimes(1);
    });
});
