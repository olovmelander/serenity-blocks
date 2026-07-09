/**
 * @fileoverview Phase B — spectator (watch-only) role.
 *
 * A spectator is a connected peer that consumes the host's all-boards snapshot stream and
 * renders every player, but is NEVER in the simulated roster (this.players). Because all
 * host-side logic (ready-barrier, win/elimination, attack routing, unified-loop, host-
 * migration) iterates this.players, keeping spectators OUT of it auto-excludes them. These
 * tests pin the two host-authoritative gates: _registerSpectator (roster exclusion + baseline)
 * and the sendInput hard-stop (a spectator owns no board and must never send input).
 */

import { describe, it, expect, vi } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

function hostStub(overrides = {}) {
    return {
        isHost: true,
        localPlayerId: 'HOST',
        spectators: new Set(),
        players: new Map([['HOST', {}], ['P2', {}]]),
        gamePhase: 'waiting',
        sharedSeed: 1234,
        matchConfig: { endCondition: 'frags' },
        broadcastPlayerList: vi.fn(),
        queueResync: vi.fn(),
        network: { sendP2PMessage: vi.fn() },
        ...overrides,
    };
}

describe('B — spectator roster exclusion (_registerSpectator)', () => {
    it('registers a spectator OUTSIDE the player roster and hands it roster + baseline', () => {
        const stub = hostStub();
        FFAGameStateP2P.prototype._registerSpectator.call(stub, 'S1', 'Spec');
        expect(stub.spectators.has('S1')).toBe(true);
        expect(stub.players.has('S1')).toBe(false); // NEVER a player → auto-excluded everywhere
        expect(stub.players.size).toBe(2);
        expect(stub.broadcastPlayerList).toHaveBeenCalled(); // spectator gets the roster to render
        expect(stub.queueResync).toHaveBeenCalledWith('S1'); // + a board baseline
    });

    it('mid-match registration sends LOBBY_GAME_START so the spectator sets up its watch UI', () => {
        const stub = hostStub({ gamePhase: 'playing' });
        FFAGameStateP2P.prototype._registerSpectator.call(stub, 'S1', 'Spec');
        expect(stub.network.sendP2PMessage).toHaveBeenCalledWith(
            'S1',
            MessageTypes.LOBBY_GAME_START,
            expect.objectContaining({ sharedSeed: 1234 }),
        );
    });

    it('does NOT send LOBBY_GAME_START when still in the lobby (normal broadcast covers it)', () => {
        const stub = hostStub({ gamePhase: 'waiting' });
        FFAGameStateP2P.prototype._registerSpectator.call(stub, 'S1', 'Spec');
        expect(stub.network.sendP2PMessage).not.toHaveBeenCalled();
    });

    it('is idempotent — a re-announce only re-baselines, never double-adds', () => {
        const stub = hostStub({ spectators: new Set(['S1']) });
        FFAGameStateP2P.prototype._registerSpectator.call(stub, 'S1', 'Spec');
        expect(stub.spectators.size).toBe(1);
        expect(stub.broadcastPlayerList).not.toHaveBeenCalled(); // re-announce ⇒ just re-baseline
        expect(stub.queueResync).toHaveBeenCalledWith('S1');
    });

    it('a non-host never registers spectators (host is authoritative for the roster)', () => {
        const stub = hostStub({ isHost: false });
        FFAGameStateP2P.prototype._registerSpectator.call(stub, 'S1', 'Spec');
        expect(stub.spectators.size).toBe(0);
        expect(stub.broadcastPlayerList).not.toHaveBeenCalled();
    });
});

describe('C — drop-in mid-match join (join-as-dead, revive next round)', () => {
    it('a player joining while a match is PLAYING is added dead/waiting + sent inProgress LOBBY_GAME_START', () => {
        const stub = hostStub({ gamePhase: 'playing', sharedSeed: 99 });
        const added = FFAGameStateP2P.prototype.addPlayer.call(stub, 'LATE', 'Latecomer', false);
        expect(added).toBe(true);
        const p = stub.players.get('LATE');
        expect(p.isAlive).toBe(false); // waiting — the unified loop skips dead boards
        expect(stub.network.sendP2PMessage).toHaveBeenCalledWith(
            'LATE',
            MessageTypes.LOBBY_GAME_START,
            expect.objectContaining({ inProgress: true, sharedSeed: 99 }),
        );
    });

    it('a normal lobby join (gamePhase waiting) is added ALIVE with no inProgress signal', () => {
        const stub = hostStub({ gamePhase: 'waiting' });
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'NEWBIE', 'Bravo', false);
        expect(stub.players.get('NEWBIE').isAlive).toBe(true);
        const startCalls = stub.network.sendP2PMessage.mock.calls.filter(
            (c) => c[1] === MessageTypes.LOBBY_GAME_START,
        );
        expect(startCalls.length).toBe(0);
    });

    it('the LOCAL player is never treated as a mid-match joiner', () => {
        const stub = hostStub({ gamePhase: 'playing', players: new Map() });
        FFAGameStateP2P.prototype.addPlayer.call(stub, 'HOST', 'Host', true);
        expect(stub.players.get('HOST').isAlive).toBe(true); // host stays alive
    });
});

describe('B — spectator disconnect cleanup (no leak)', () => {
    it('removePlayer drops a disconnected spectator from the set and stops there', () => {
        let finalized = false;
        const stub = {
            spectators: new Set(['S1']),
            players: new Map(),
            _finalizeRemovePlayer() { finalized = true; },
        };
        FFAGameStateP2P.prototype.removePlayer.call(stub, 'S1');
        expect(stub.spectators.has('S1')).toBe(false);
        expect(stub.spectators.size).toBe(0);
        expect(finalized).toBe(false); // spectator path returns early — no player-removal flow
    });

    it('removePlayer for a real player is NOT short-circuited by the spectator check', () => {
        let finalized = false;
        const stub = {
            spectators: new Set(),
            players: new Map([['P2', { name: 'Bravo', isAlive: true }]]),
            gamePhase: 'waiting', // not 'playing' → no grace period, finalizes immediately
            _finalizeRemovePlayer() { finalized = true; },
        };
        FFAGameStateP2P.prototype.removePlayer.call(stub, 'P2');
        expect(finalized).toBe(true);
    });
});

describe('D3 — host kick + spectator count', () => {
    it('host kickPlayer removes a PLAYER immediately (no grace) + signals the kicked client', () => {
        const finalize = vi.fn();
        const stub = {
            isHost: true, localPlayerId: 'HOST',
            players: new Map([['HOST', {}], ['P2', {}]]),
            spectators: new Set(),
            network: { sendP2PMessage: vi.fn() },
            _finalizeRemovePlayer: finalize,
            broadcastPlayerList: vi.fn(),
        };
        const r = FFAGameStateP2P.prototype.kickPlayer.call(stub, 'P2');
        expect(r).toBe(true);
        expect(stub.network.sendP2PMessage).toHaveBeenCalledWith('P2', MessageTypes.PLAYER_KICKED, expect.any(Object));
        expect(finalize).toHaveBeenCalledWith('P2'); // immediate removal, NOT the grace-period path
    });

    it('host kickPlayer removes a SPECTATOR + refreshes the roster broadcast', () => {
        const stub = {
            isHost: true, localPlayerId: 'HOST',
            players: new Map([['HOST', {}]]),
            spectators: new Set(['S1']),
            network: { sendP2PMessage: vi.fn() },
            _finalizeRemovePlayer: vi.fn(),
            broadcastPlayerList: vi.fn(),
        };
        const r = FFAGameStateP2P.prototype.kickPlayer.call(stub, 'S1');
        expect(r).toBe(true);
        expect(stub.spectators.has('S1')).toBe(false);
        expect(stub.broadcastPlayerList).toHaveBeenCalled();
        expect(stub._finalizeRemovePlayer).not.toHaveBeenCalled();
    });

    it('a non-host cannot kick, and the host cannot kick itself', () => {
        const peer = { isHost: false, localPlayerId: 'P', players: new Map(), spectators: new Set(), network: { sendP2PMessage: vi.fn() } };
        expect(FFAGameStateP2P.prototype.kickPlayer.call(peer, 'X')).toBe(false);
        const host = { isHost: true, localPlayerId: 'HOST', players: new Map(), spectators: new Set(), network: { sendP2PMessage: vi.fn() } };
        expect(FFAGameStateP2P.prototype.kickPlayer.call(host, 'HOST')).toBe(false);
        expect(host.network.sendP2PMessage).not.toHaveBeenCalled();
    });

    it('getSpectatorCount: host uses its set, a peer uses the mirrored broadcast count', () => {
        const host = { isHost: true, spectators: new Set(['a', 'b']), spectatorCount: 0 };
        expect(FFAGameStateP2P.prototype.getSpectatorCount.call(host)).toBe(2);
        const peer = { isHost: false, spectators: new Set(), spectatorCount: 3 };
        expect(FFAGameStateP2P.prototype.getSpectatorCount.call(peer)).toBe(3);
    });
});

describe('B — spectator sends no input (sendInput hard-stop)', () => {
    it('sendInput is a no-op for a spectator even while a match is playing', () => {
        const stub = {
            isSpectator: true,
            gamePhase: 'playing',
            isHost: false,
            // If the guard ever fails open, these would be hit and throw.
            processPlayerInput: () => { throw new Error('spectator must not process input'); },
            network: { sendP2PMessage: () => { throw new Error('spectator must not send input'); } },
        };
        expect(() => FFAGameStateP2P.prototype.sendInput.call(stub, 'move', { direction: 1 })).not.toThrow();
    });
});
