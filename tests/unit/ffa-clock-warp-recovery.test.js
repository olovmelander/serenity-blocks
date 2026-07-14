import {
    describe, expect, it, vi,
} from 'vitest';
import { runFfaFixedTicks } from '../../src/core/multiplayer/ffa-fixed-tick-runner.js';
import { handleFfaResyncAck } from '../../src/core/multiplayer/ffa/resync-input-barrier-adapter.js';
import { beginPeerResyncBarrier } from '../../src/core/multiplayer/ffa/resync-input-barrier.js';
import { JOIN_LIFECYCLE_STATES } from '../../src/core/multiplayer/ffa/join-lifecycle.js';
import { requestFfaAuthoritativeResync } from '../../src/core/multiplayer/ffa/resync-request-handler.js';

function makeLivePeer(overrides = {}) {
    const requestResync = vi.fn(() => true);
    const game = {
        isHost: false,
        _disposed: false,
        isSpectator: false,
        gamePhase: 'playing',
        joinState: JOIN_LIFECYCLE_STATES.LIVE,
        localPlayerId: 'PEER',
        roundGeneration: 4,
        players: new Map([['PEER', {
            isAlive: true,
            awaitingSpawn: false,
            isDisconnected: false,
        }]]),
        network: { hostSteamId: 'HOST', requestResync },
        ...overrides,
    };
    return { game, requestResync };
}

function makeRunnerPeer(overrides = {}) {
    const order = [];
    const { game, requestResync } = makeLivePeer({
        _fixedTickEnabled: true,
        useJitterBuffer: true,
        SIM_TICK_MS: 10,
        MAX_SIM_STEPS_PER_FRAME: 2,
        _simTickAccumulatorMs: 0,
        _fixedInputTimeMs: 0,
        _fixedTickApplicationDepth: 0,
        simTick: 10,
        localInputHooks: {},
        _recordNetEvent: vi.fn(),
        unifiedLoop: {
            runGeneration: 7,
            updatePlayersFixedTick: vi.fn(() => order.push('tick')),
        },
        ...overrides,
    });
    requestResync.mockImplementation((hostSteamId, reason) => {
        order.push(`request:${hostSteamId}:${reason}`);
        return true;
    });
    return { game, order, requestResync };
}

describe('FFA clock-warp authoritative recovery', () => {
    it('requests one peer-only exact recovery after retained ticks finish', () => {
        const { game, order, requestResync } = makeRunnerPeer();

        expect(runFfaFixedTicks(game, 1000, 1000)).toBe(2);

        expect(order).toEqual(['tick', 'tick', 'request:HOST:sim_clock_warp']);
        expect(game._recordNetEvent).toHaveBeenCalledWith('sim_clock_warp', {
            requestedDebtMs: 1000,
            retainedDebtMs: 300,
            warpedMs: 700,
            maxDebtMs: 300,
            maxSteps: 2,
            tickMs: 10,
        });
        expect(requestResync).toHaveBeenCalledOnce();
        expect(game.simTick).toBe(10);
        expect(game._peerFixedInputSimTick).toBe(12);
    });

    it('does not request recovery at the 300 ms no-warp boundary', () => {
        const { game, requestResync } = makeRunnerPeer();

        expect(runFfaFixedTicks(game, 300, 300)).toBe(2);

        expect(game._recordNetEvent).not.toHaveBeenCalledWith(
            'sim_clock_warp',
            expect.anything(),
        );
        expect(requestResync).not.toHaveBeenCalled();
    });

    it('keeps a warped host authoritative without an eager resync fanout', () => {
        const requestResync = vi.fn();
        const { game } = makeRunnerPeer({
            isHost: true,
            localPlayerId: 'HOST',
            players: new Map([
                ['HOST', { isAlive: true }],
                ['PEER', { isAlive: true }],
            ]),
            network: { hostSteamId: 'HOST', requestResync },
            simTick: 10,
            updateAllPlayers: vi.fn(),
            attackRouter: { updateHotPotato: vi.fn() },
        });

        expect(runFfaFixedTicks(game, 1000, 1000)).toBe(2);

        expect(game.simTick).toBe(12);
        expect(game._recordNetEvent).toHaveBeenCalledWith(
            'sim_clock_warp',
            expect.objectContaining({ warpedMs: 700 }),
        );
        expect(requestResync).not.toHaveBeenCalled();
    });

    it('does not send a stale-round request when retained-tick ownership changes', () => {
        const { game, requestResync } = makeRunnerPeer();
        game.unifiedLoop.updatePlayersFixedTick.mockImplementationOnce(() => {
            game.roundGeneration += 1;
        });

        expect(runFfaFixedTicks(game, 1000, 1000)).toBe(1);

        expect(game._recordNetEvent).toHaveBeenCalledWith(
            'sim_clock_warp',
            expect.objectContaining({ warpedMs: 700 }),
        );
        expect(requestResync).not.toHaveBeenCalled();
    });

    it.each([
        ['host', { isHost: true }],
        ['disposed', { _disposed: true }],
        ['spectator', { isSpectator: true }],
        ['non-playing phase', { gamePhase: 'waiting' }],
        ['non-live join', { joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING }],
        ['missing local player', { players: new Map() }],
        ['dead local player', { players: new Map([['PEER', { isAlive: false }]]) }],
        ['awaiting local player', {
            players: new Map([['PEER', { isAlive: true, awaitingSpawn: true }]]),
        }],
        ['disconnected local player', {
            players: new Map([['PEER', { isAlive: true, isDisconnected: true }]]),
        }],
        ['unresolved host', { network: { hostSteamId: null, requestResync: vi.fn() } }],
        ['self host identity', { network: { hostSteamId: 'PEER', requestResync: vi.fn() } }],
        ['frozen input', { resyncInputFrozen: true }],
        ['active input barrier', { peerResyncInputBarrier: { requestId: 'R1' } }],
        ['pending apply', { pendingInboundResyncApply: { resyncId: 'R1' } }],
        ['active download', { downloadJoinInProgress: { resyncId: 'R1' } }],
        ['missing transport API', { network: { hostSteamId: 'HOST' } }],
    ])('suppresses requests for %s', (_label, override) => {
        const { game, requestResync } = makeLivePeer(override);

        expect(requestFfaAuthoritativeResync(game, 'sim_clock_warp')).toBe(false);

        expect(requestResync).not.toHaveBeenCalled();
    });

    it('does not pre-freeze input before the host PREPARE arrives', () => {
        const { game, requestResync } = makeLivePeer();

        expect(requestFfaAuthoritativeResync(game, 'sim_clock_warp')).toBe(true);

        expect(requestResync).toHaveBeenCalledWith('HOST', 'sim_clock_warp');
        expect(game.resyncInputFrozen).toBeUndefined();
        expect(game.peerResyncInputBarrier).toBeUndefined();
    });

    it('composes one peer request into one host PREPARE and coalesces while active', () => {
        const { game: peer } = makeLivePeer({
            inputSequence: 3,
            pendingInputs: [],
            inputHistory: [],
            flushInputBatch: vi.fn(),
        });
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            roundGeneration: 4,
            simTick: 20,
            players: new Map([
                ['HOST', { isAlive: true, gameState: { isProcessingPhysics: false } }],
                ['PEER', {
                    isAlive: true,
                    lastInputSeq: 0,
                    gameState: { isProcessingPhysics: false },
                }],
            ]),
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            resyncRequestAtByPeer: new Map(),
            _recordNetEvent: vi.fn(),
        };
        host.network = {
            fullSnapshotIntervalMs: 250,
            sendP2PMessage: vi.fn((_steamId, _type, data) => {
                beginPeerResyncBarrier(peer, data, {
                    flush: () => peer.flushInputBatch(),
                });
            }),
        };
        peer.network.requestResync = vi.fn((_hostSteamId, reason) => {
            handleFfaResyncAck(host, {
                from: 'PEER',
                data: { requestResync: true, reason },
            });
            return true;
        });

        expect(requestFfaAuthoritativeResync(peer, 'sim_clock_warp')).toBe(true);
        expect(requestFfaAuthoritativeResync(peer, 'sim_clock_warp')).toBe(false);

        expect(peer.resyncInputFrozen).toBe(true);
        expect(peer.peerResyncInputBarrier).toMatchObject({
            roundGeneration: 4,
            inputFence: 3,
        });
        expect(peer.flushInputBatch).toHaveBeenCalledOnce();
        expect(host.network.sendP2PMessage).toHaveBeenCalledOnce();
        expect(peer.network.requestResync).toHaveBeenCalledOnce();
    });
});
