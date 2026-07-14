import {
    describe, expect, it, vi,
} from 'vitest';
import {
    completeFfaResyncInputBarrier,
    getFfaSatisfiedResyncInputRequirement,
    preflightFfaResyncInputBarrier,
    registerFfaResyncInputBarrierHandlers,
    drainFfaPeerResyncInputBarrier,
} from '../../src/core/multiplayer/ffa/resync-input-barrier-adapter.js';
import { routeFfaResync } from '../../src/core/multiplayer/ffa/resync-request-handler.js';
import {
    drainFfaPendingResyncs,
    queueFfaResync,
} from '../../src/core/multiplayer/ffa/join-syncpoint.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

const HOST = 'HOST';
const PEER = 'PEER';

function captureRegistry() {
    const handlers = new Map();
    return {
        handlers,
        register(type, handler) { handlers.set(type, handler); },
    };
}

describe('FFA exact-resync input barrier integration', () => {
    it('fences, flushes, waits for authoritative catch-up, and releases only after apply', () => {
        const hostRegistry = captureRegistry();
        const peerRegistry = captureRegistry();
        const sendSnapshot = vi.fn();
        const host = {
            isHost: true,
            localPlayerId: HOST,
            gamePhase: 'playing',
            simTick: 90,
            roundGeneration: 4,
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            players: new Map([
                [HOST, { steamId: HOST, gameState: { isProcessingPhysics: false } }],
                [PEER, {
                    steamId: PEER,
                    isAlive: true,
                    lastInputSeq: 4,
                    gameState: { isProcessingPhysics: false },
                }],
            ]),
            _networkDispatch: { depth: 0 },
            _fixedTickApplicationDepth: 0,
            _recordNetEvent: vi.fn(),
        };
        const peer = {
            isHost: false,
            localPlayerId: PEER,
            gamePhase: 'playing',
            simTick: 89,
            roundGeneration: 4,
            inputSequence: 7,
            pendingInputs: [{ seq: 6 }, { seq: 7 }],
            inputHistory: [{ seq: 5 }, { seq: 6 }, { seq: 7 }],
            players: new Map([[
                PEER,
                { steamId: PEER, gameState: { isProcessingPhysics: false } },
            ]]),
            _networkDispatch: { depth: 0 },
            _fixedTickApplicationDepth: 0,
            _recordNetEvent: vi.fn(),
            _isFromHost: (msg) => msg.from === HOST,
        };

        peer.flushInputBatch = vi.fn(() => {
            expect(peer.resyncInputFrozen).toBe(true);
            expect(peer.pendingInputs.map(({ seq }) => seq)).toEqual([5, 6, 7]);
            peer.pendingInputs = [];
        });
        host.queueResync = (steamId) => queueFfaResync(host, steamId, sendSnapshot);
        host._getSatisfiedResyncInputRequirement = (steamId) => (
            getFfaSatisfiedResyncInputRequirement(host, steamId)
        );
        host.network = {
            sendP2PMessage: vi.fn((steamId, type, data) => {
                expect(steamId).toBe(PEER);
                peerRegistry.handlers.get(type)?.({ from: HOST, data });
            }),
        };
        peer.network = {
            hostSteamId: HOST,
            sendP2PMessage: vi.fn((steamId, type, data) => {
                expect(steamId).toBe(HOST);
                hostRegistry.handlers.get(type)?.({ from: PEER, data });
            }),
        };
        registerFfaResyncInputBarrierHandlers(host, hostRegistry);
        registerFfaResyncInputBarrierHandlers(peer, peerRegistry);

        expect(routeFfaResync(host, PEER, 'digest_mismatch')).toBe(true);
        expect(host.network.sendP2PMessage).toHaveBeenCalledWith(
            PEER,
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ inputFencePlayerId: PEER }),
        );
        expect(peer.flushInputBatch).toHaveBeenCalledOnce();
        expect(peer.resyncInputFrozen).toBe(true);
        expect(peer.pendingInputs).toEqual([]);
        expect(routeFfaResync(host, PEER, 'duplicate')).toBe(true);
        expect(host.network.sendP2PMessage).toHaveBeenCalledTimes(2);
        expect(peer.flushInputBatch).toHaveBeenCalledOnce();

        expect(drainFfaPeerResyncInputBarrier(peer)).not.toBeNull();
        expect(peer.network.sendP2PMessage).toHaveBeenCalledWith(
            HOST,
            MessageTypes.GAME_STATE_RESYNC_READY,
            expect.objectContaining({ inputFence: 7 }),
        );
        expect(host.pendingResyncs).toEqual([PEER]);
        expect(sendSnapshot).not.toHaveBeenCalled();

        host.players.get(PEER).lastInputSeq = 7;
        host.players.get(HOST).gameState.isProcessingPhysics = true;
        expect(drainFfaPendingResyncs(host, sendSnapshot)).toBeNull();
        host.players.get(HOST).gameState.isProcessingPhysics = false;
        expect(drainFfaPendingResyncs(host, sendSnapshot)).not.toBeNull();

        const completion = sendSnapshot.mock.calls[0][2];
        expect(completion).toMatchObject({
            roundGeneration: 4,
            inputFencePlayerId: PEER,
            inputFence: 7,
            inputAck: 7,
        });
        expect(routeFfaResync(host, PEER, 'during_transfer')).toBe(true);
        expect(host.network.sendP2PMessage).toHaveBeenCalledTimes(2);
        expect(host.pendingResyncs).toEqual([]);
        expect(preflightFfaResyncInputBarrier(peer, {
            inputBarrier: completion,
            resyncSidecar: { players: [{ steamId: PEER, wrapper: { lastInputSeq: 6 } }] },
        })).toEqual({ accepted: false, reason: 'authoritative_input_ack_unmet' });
        expect(peer.resyncInputFrozen).toBe(true);
        expect(peer.inputHistory).toHaveLength(3);

        const accepted = preflightFfaResyncInputBarrier(peer, {
            inputBarrier: completion,
            resyncSidecar: { players: [{ steamId: PEER, wrapper: { lastInputSeq: 7 } }] },
        });
        expect(accepted).toEqual({ accepted: true, completion });
        expect(completeFfaResyncInputBarrier(peer, accepted.completion)).toEqual({
            inputAck: 7,
            prunedPendingInputs: 0,
            prunedInputHistory: 3,
        });
        expect(peer.peerResyncInputBarrier).toBeNull();
        expect(peer.resyncInputFrozen).toBe(false);
        expect(peer.inputHistory).toEqual([]);
    });
});
