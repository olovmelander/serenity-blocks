import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    adoptFfaJoinSyncpoint,
    computeJoinSyncpoint,
    drainFfaPendingResyncs,
    queueFfaResync,
} from '../../src/core/multiplayer/ffa/join-syncpoint.js';

describe('FFA join syncpoint contract', () => {
    it('marks a settled playing state idle and stamps its simulation epoch', () => {
        expect(computeJoinSyncpoint({
            gamePhase: 'playing',
            simTick: 142,
            roundGeneration: 3,
            players: new Map([
                ['P2', { steamId: 'P2', gameState: { isProcessingPhysics: false } }],
                ['P1', { steamId: 'P1', gameState: { isProcessingPhysics: false } }],
            ]),
        })).toEqual({
            status: 'idle',
            safe: true,
            simTick: 142,
            roundGeneration: 3,
            blockers: [],
        });
    });

    it('keeps a settled pre-match state eligible for a download join', () => {
        expect(computeJoinSyncpoint({
            gamePhase: 'waiting',
            simTick: 0,
            roundGeneration: 0,
            players: [],
        })).toEqual({
            status: 'download',
            safe: true,
            simTick: 0,
            roundGeneration: 0,
            blockers: [],
        });
    });

    it('blocks all boards while any cascade or async physics owner is active', () => {
        expect(computeJoinSyncpoint({
            gamePhase: 'playing',
            simTick: 17,
            roundGeneration: 2,
            players: new Map([
                ['fallback-b', { steamId: 'B', gameState: { isProcessingPhysics: true } }],
                ['fallback-a', { steamId: 'A', gameState: { isProcessingPhysics: true } }],
                ['settled', { steamId: 'C', gameState: { isProcessingPhysics: false } }],
            ]),
        })).toEqual({
            status: 'busy',
            safe: false,
            simTick: 17,
            roundGeneration: 2,
            blockers: [
                { kind: 'active_physics', playerId: 'A' },
                { kind: 'active_physics', playerId: 'B' },
            ],
        });
    });

    it('blocks packet and fixed-tick application at every game phase', () => {
        expect(computeJoinSyncpoint({
            gamePhase: 'waiting',
            simTick: 9,
            roundGeneration: 4,
            packetApplicationDepth: 2,
            fixedTickApplicationDepth: 1,
        })).toEqual({
            status: 'busy',
            safe: false,
            simTick: 9,
            roundGeneration: 4,
            blockers: [
                { kind: 'packet_application', depth: 2 },
                { kind: 'fixed_tick_application', depth: 1 },
            ],
        });
    });

    it('does not mistake retained promises or a missing piece for active physics', () => {
        const retainedSettledPromise = Promise.resolve();
        const marker = computeJoinSyncpoint({
            gamePhase: 'playing',
            players: [{
                steamId: 'P1',
                gameState: {
                    isProcessingPhysics: false,
                    latestPhysicsPromise: retainedSettledPromise,
                    currentPiece: null,
                },
            }],
        });

        expect(marker.status).toBe('idle');
        expect(marker.safe).toBe(true);
        expect(marker.blockers).toEqual([]);
    });

    it('normalizes absent counters and positive application-depth signals', () => {
        expect(computeJoinSyncpoint({
            gamePhase: 'playing',
            simTick: -1,
            roundGeneration: Number.NaN,
            packetApplicationDepth: 0.5,
            fixedTickApplicationDepth: -2,
        })).toEqual({
            status: 'busy',
            safe: false,
            simTick: 0,
            roundGeneration: 0,
            blockers: [{ kind: 'packet_application', depth: 1 }],
        });
    });

    it('does not trust a cached idle value after cascade processing begins', () => {
        const send = vi.fn();
        const player = { steamId: 'P1', gameState: { isProcessingPhysics: true } };
        const game = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            simTick: 33,
            roundGeneration: 4,
            players: new Map([['P1', player]]),
            pendingResyncs: [],
            syncpoint: 'idle',
            _recordNetEvent: vi.fn(),
        };

        queueFfaResync(game, 'P2', send);

        expect(send).not.toHaveBeenCalled();
        expect(game.pendingResyncs).toEqual(['P2']);
        expect(game.syncpoint).toBe('busy');
        expect(game.joinSyncpoint.blockers).toEqual([
            { kind: 'active_physics', playerId: 'P1' },
        ]);

        player.gameState.isProcessingPhysics = false;
        drainFfaPendingResyncs(game, send);

        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith('P2', expect.objectContaining({
            status: 'idle',
            safe: true,
            simTick: 33,
            roundGeneration: 4,
        }), null);
        expect(game.pendingResyncs).toEqual([]);
    });

    it('defers a pre-match resync until the enclosing packet stack drains', () => {
        const send = vi.fn();
        const game = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'waiting',
            players: new Map(),
            pendingResyncs: [],
            _networkDispatch: { depth: 1 },
            _recordNetEvent: vi.fn(),
        };

        queueFfaResync(game, 'P2', send);
        expect(send).not.toHaveBeenCalled();
        expect(game.joinSyncpoint.blockers).toEqual([
            { kind: 'packet_application', depth: 1 },
        ]);

        game._networkDispatch.depth = 0;
        drainFfaPendingResyncs(game, send);

        expect(send).toHaveBeenCalledWith('P2', expect.objectContaining({
            status: 'download',
            safe: true,
        }), null);
    });

    it('defers a waiting-state resync while a round-start thunk is pending', () => {
        const send = vi.fn();
        const game = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'waiting',
            players: new Map(),
            pendingResyncs: [],
            _pendingRoundStart: vi.fn(),
            _recordNetEvent: vi.fn(),
        };

        queueFfaResync(game, 'P2', send);

        expect(send).not.toHaveBeenCalled();
        expect(game.pendingResyncs).toEqual(['P2']);
        expect(game.joinSyncpoint).toMatchObject({
            status: 'busy',
            safe: false,
            blockers: [{ kind: 'pending_round_start' }],
        });

        game._pendingRoundStart = null;
        game.gamePhase = 'playing';
        drainFfaPendingResyncs(game, send);

        expect(send).toHaveBeenCalledWith('P2', expect.objectContaining({
            status: 'idle',
            safe: true,
        }), null);
        expect(game.pendingResyncs).toEqual([]);
    });

    it('adopts the host marker tuple while preserving old-host counter fallbacks', () => {
        const game = {
            syncpoint: 'download',
            simTick: 8,
            roundGeneration: 2,
        };

        expect(adoptFfaJoinSyncpoint(game, {
            syncpoint: 'busy',
            simTick: 9,
            roundGeneration: 3,
            blockers: [{ kind: 'active_physics', playerId: 'HOST' }],
        })).toEqual({
            status: 'busy',
            safe: false,
            simTick: 9,
            roundGeneration: 3,
            blockers: [{ kind: 'active_physics', playerId: 'HOST' }],
        });
        expect(game.syncpoint).toBe('busy');

        expect(adoptFfaJoinSyncpoint(game, { syncpoint: 'idle' })).toMatchObject({
            status: 'idle',
            safe: true,
            simTick: 9,
            roundGeneration: 3,
        });
    });
});
