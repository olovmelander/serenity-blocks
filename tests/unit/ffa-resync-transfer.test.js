import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import {
    createResyncChunks,
    encodeUtf8,
} from '../../src/core/multiplayer/ffa/resync-coordinator.js';
import {
    acceptHostResyncReady,
    prepareHostResyncBarrier,
} from '../../src/core/multiplayer/ffa/resync-input-barrier.js';
import { getHostResyncRetryCount } from '../../src/core/multiplayer/ffa/resync-retry-policy.js';
import { JOIN_LIFECYCLE_STATES } from '../../src/core/multiplayer/ffa/join-lifecycle.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

function makeHost(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        localPlayerId: 'HOST',
        resyncTransfers: new Map(),
        resyncChunkSize: 16,
        resyncWindow: 4,
        resyncTimeoutMs: 100,
        resyncMaxRetries: 2,
        downloadJoinPeers: new Map(),
        _downloadJoinEnabled: true,
        _recordNetEvent: vi.fn(),
        network: {
            sendP2PMessage: vi.fn(),
            forceNextSnapshotKeyframe: vi.fn(),
        },
        _buildResyncPayload: vi.fn(() => ({
            encoding: 'characterization',
            header: {
                snapshotSeq: 17,
                simTick: 29,
                roundGeneration: 3,
            },
            payload: 'x'.repeat(96),
        })),
        ...overrides,
    });
}

function makeReceiver(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        joinState: JOIN_LIFECYCLE_STATES.LIVE,
        resyncBuffers: new Map(),
        _downloadJoinEnabled: false,
        _applyResyncState: vi.fn(),
        network: {
            hostSteamId: 'HOST',
            sendP2PMessage: vi.fn(),
        },
        ...overrides,
    });
}

function getOnlyTransfer(state) {
    expect(state.resyncTransfers.size).toBe(1);
    return Array.from(state.resyncTransfers.values())[0];
}

function clearTransferTimers(state) {
    state.resyncTransfers.forEach((transfer) => {
        if (transfer.timer !== null) clearInterval(transfer.timer);
        transfer.timer = null;
    });
}

function sentResyncChunks(state) {
    return state.network.sendP2PMessage.mock.calls
        .filter(([, type]) => type === MessageTypes.GAME_STATE_RESYNC)
        .map(([, , chunk]) => chunk);
}

function makeWireChunks(payload, resyncId = 'R1') {
    const bytes = encodeUtf8(JSON.stringify(payload));
    return createResyncChunks(bytes, {
        resyncId,
        chunkSize: Math.ceil(bytes.length / 3),
        baselineSnapshotSeq: 17,
        baselineSimTick: 29,
        roundGeneration: 3,
    });
}

describe('FFA resync transfer characterization', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('holds a transfer to four chunks until an ACK opens the fifth slot', () => {
        const state = makeHost();

        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);

        expect(transfer.chunks.length).toBeGreaterThan(state.resyncWindow);
        expect(sentResyncChunks(state).map(({ chunkIndex }) => chunkIndex)).toEqual([0, 1, 2, 3]);
        expect(Array.from(transfer.inFlight)).toEqual([0, 1, 2, 3]);
        expect(transfer.cursor).toBe(4);

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: transfer.resyncId, chunkIndex: 0, isFinal: false },
        });

        expect(sentResyncChunks(state).map(({ chunkIndex }) => chunkIndex)).toEqual([0, 1, 2, 3, 4]);
        expect(Array.from(transfer.inFlight)).toEqual([1, 2, 3, 4]);
        expect(transfer.cursor).toBe(5);

        clearTransferTimers(state);
    });

    it('retransmits a timed-out chunk, then aborts at the retry limit and removes its fence', () => {
        const state = makeHost({
            resyncChunkSize: 1024,
            _buildResyncPayload: vi.fn(() => ({
                header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
                payload: 'one chunk',
            })),
        });

        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        expect(sentResyncChunks(state)).toHaveLength(1);
        expect(state.downloadJoinPeers.get('PEER')?.resyncId).toBe(transfer.resyncId);

        vi.setSystemTime(1099);
        state._tickResyncTransfer(transfer);
        expect(sentResyncChunks(state)).toHaveLength(1);

        vi.setSystemTime(1100);
        state._tickResyncTransfer(transfer);
        expect(sentResyncChunks(state)).toHaveLength(2);
        expect(transfer.retries.get(0)).toBe(2);

        vi.setSystemTime(1200);
        state._tickResyncTransfer(transfer);

        expect(sentResyncChunks(state)).toHaveLength(2);
        expect(transfer.timer).toBeNull();
        expect(state.resyncTransfers.has(transfer.resyncId)).toBe(false);
        expect(state.downloadJoinPeers.has('PEER')).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_aborted', {
            steamId: 'PEER',
            resyncId: transfer.resyncId,
            inFlight: 1,
        });
    });

    it('aborts after the final applied ACK never arrives', () => {
        const state = makeHost({
            resyncChunkSize: 1024,
            _buildResyncPayload: vi.fn(() => ({
                header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
                payload: 'one chunk',
            })),
        });

        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: transfer.resyncId, chunkIndex: 0, isFinal: false },
        });

        vi.setSystemTime(1100);
        state._tickResyncTransfer(transfer);
        expect(transfer.awaitingFinalSince).toBe(1100);

        vi.setSystemTime(1299);
        state._tickResyncTransfer(transfer);
        expect(state.resyncTransfers.has(transfer.resyncId)).toBe(true);

        vi.setSystemTime(1300);
        state._tickResyncTransfer(transfer);

        expect(transfer.timer).toBeNull();
        expect(state.resyncTransfers.has(transfer.resyncId)).toBe(false);
        expect(state.downloadJoinPeers.has('PEER')).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_aborted', {
            steamId: 'PEER',
            resyncId: transfer.resyncId,
            reason: 'final_ack_timeout',
        });
    });

    it('coalesces repeated requests for the same peer into one active transfer', () => {
        const state = makeHost();

        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        const sendCount = sentResyncChunks(state).length;
        state._sendResyncToPeer('PEER');

        expect(state.resyncTransfers.size).toBe(1);
        expect(getOnlyTransfer(state)).toBe(transfer);
        expect(sentResyncChunks(state)).toHaveLength(sendCount);
        expect(state._buildResyncPayload).toHaveBeenCalledOnce();
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'resync_started')).toHaveLength(1);

        clearTransferTimers(state);
    });

    it('reassembles out-of-order chunks once and ACKs duplicate retransmissions', () => {
        const state = makeReceiver({
            joinState: JOIN_LIFECYCLE_STATES.WELCOMED,
            _recordNetEvent: vi.fn(),
        });
        const payload = { players: [], gamePhase: 'playing', marker: 'complete' };
        const chunks = makeWireChunks(payload);
        expect(chunks).toHaveLength(3);

        [chunks[2], chunks[0], chunks[0], chunks[1]].forEach((data) => {
            state._handleResyncChunk({ from: 'HOST', data });
        });

        expect(state._applyResyncState).toHaveBeenCalledOnce();
        expect(state._applyResyncState).toHaveBeenCalledWith(payload);
        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'join_state_transition')
            .map(([, data]) => [data.from, data.to])).toEqual([
            ['welcomed', 'downloading'],
            ['downloading', 'applying'],
            ['applying', 'live'],
        ]);
        expect(state.resyncBuffers.has('R1')).toBe(false);
        expect(state.network.sendP2PMessage.mock.calls.map(([, type, ack]) => ({
            type,
            chunkIndex: ack.chunkIndex,
            isFinal: ack.isFinal,
        }))).toEqual([
            { type: MessageTypes.GAME_STATE_RESYNC_ACK, chunkIndex: 2, isFinal: false },
            { type: MessageTypes.GAME_STATE_RESYNC_ACK, chunkIndex: 0, isFinal: false },
            { type: MessageTypes.GAME_STATE_RESYNC_ACK, chunkIndex: 0, isFinal: false },
            { type: MessageTypes.GAME_STATE_RESYNC_ACK, chunkIndex: 1, isFinal: false },
            { type: MessageTypes.GAME_STATE_RESYNC_ACK, chunkIndex: null, isFinal: true },
        ]);
    });

    it('holds a complete resync until receiver-side async physics is idle', () => {
        const gameState = { isProcessingPhysics: true };
        const state = makeReceiver({
            _disposed: false,
            isHost: false,
            gamePhase: 'playing',
            roundGeneration: 3,
            simTick: 29,
            players: new Map([['PEER', { steamId: 'PEER', gameState }]]),
            _networkDispatch: { depth: 0 },
            pendingInboundResyncApply: null,
            lastAppliedResyncFence: null,
        });
        const chunks = makeWireChunks({
            players: [],
            gamePhase: 'playing',
            migrationEpoch: 1,
            roundGeneration: 3,
            snapshotSeq: 17,
            simTick: 29,
        });

        chunks.forEach((data) => state._handleResyncChunk({ from: 'HOST', data }));

        expect(state._applyResyncState).not.toHaveBeenCalled();
        expect(state.pendingInboundResyncApply).toEqual(expect.objectContaining({
            resyncId: 'R1',
        }));
        expect(state.network.sendP2PMessage.mock.calls.some(([, , ack]) => ack.isFinal)).toBe(false);

        gameState.isProcessingPhysics = false;
        expect(state._processPendingInboundResyncApply()).toBe(true);

        expect(state._applyResyncState).toHaveBeenCalledOnce();
        expect(state.pendingInboundResyncApply).toBeNull();
        expect(state.network.sendP2PMessage).toHaveBeenLastCalledWith(
            'HOST',
            MessageTypes.GAME_STATE_RESYNC_ACK,
            { resyncId: 'R1', chunkIndex: null, isFinal: true },
        );
    });

    it('replays the final ACK without reopening lifecycle state for a late completed chunk', () => {
        const state = makeReceiver({
            joinState: JOIN_LIFECYCLE_STATES.WELCOMED,
            _recordNetEvent: vi.fn(),
        });
        const chunks = makeWireChunks({ players: [], gamePhase: 'playing' }, 'DONE');
        chunks.forEach((data) => state._handleResyncChunk({ from: 'HOST', data }));

        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
        expect(state._applyResyncState).toHaveBeenCalledOnce();
        const transitionsBefore = state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'join_state_transition').length;

        state._handleResyncChunk({ from: 'HOST', data: chunks[0] });

        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
        expect(state._applyResyncState).toHaveBeenCalledOnce();
        expect(state.resyncBuffers.size).toBe(0);
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'join_state_transition')).toHaveLength(transitionsBefore);
        expect(state.network.sendP2PMessage).toHaveBeenLastCalledWith(
            'HOST',
            MessageTypes.GAME_STATE_RESYNC_ACK,
            { resyncId: 'DONE', chunkIndex: null, isFinal: true },
        );
    });

    it('does not buffer or ACK a corrupt chunk', () => {
        const state = makeReceiver();
        const [chunk] = makeWireChunks({ players: [], marker: 'corrupt' }, 'BAD');

        state._handleResyncChunk({
            from: 'HOST',
            data: { ...chunk, crc32: (chunk.crc32 + 1) >>> 0 },
        });

        expect(state.network.sendP2PMessage).not.toHaveBeenCalled();
        expect(state.resyncBuffers.has('BAD')).toBe(false);
        expect(state._applyResyncState).not.toHaveBeenCalled();
    });

    it('returns applying to downloading and withholds the final ACK when apply fails', () => {
        const state = makeReceiver({
            joinState: JOIN_LIFECYCLE_STATES.WELCOMED,
            _recordNetEvent: vi.fn(),
            _applyResyncState: vi.fn(() => { throw new Error('apply failed'); }),
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const chunks = makeWireChunks({ players: [], gamePhase: 'playing' }, 'RETRY');

        chunks.forEach((data) => state._handleResyncChunk({ from: 'HOST', data }));

        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.DOWNLOADING);
        expect(state.network.sendP2PMessage.mock.calls.some(([, , ack]) => ack.isFinal)).toBe(false);
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'join_state_transition')
            .map(([, data]) => [data.from, data.to])).toEqual([
            ['welcomed', 'downloading'],
            ['downloading', 'applying'],
            ['applying', 'downloading'],
        ]);
    });

    it('ignores late resync ingress after the owning game state is disposed', () => {
        const state = makeReceiver({ _disposed: true });
        const [chunk] = makeWireChunks({ players: [], marker: 'late' }, 'LATE');

        state._handleResyncChunk({ from: 'HOST', data: chunk });

        expect(state.resyncBuffers.size).toBe(0);
        expect(state.network.sendP2PMessage).not.toHaveBeenCalled();
        expect(state._applyResyncState).not.toHaveBeenCalled();
    });

    it('rejects resync ingress until an exact host identity is resolved', () => {
        const state = makeReceiver({
            _recordNetEvent: vi.fn(),
            network: {
                hostSteamId: null,
                sendP2PMessage: vi.fn(),
            },
        });
        const [chunk] = makeWireChunks({ players: [], marker: 'unbound' }, 'UNBOUND');

        state._handleResyncChunk({ from: 'STRANGER', data: chunk });

        expect(state.resyncBuffers.size).toBe(0);
        expect(state.network.sendP2PMessage).not.toHaveBeenCalled();
        expect(state._applyResyncState).not.toHaveBeenCalled();
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_chunk_rejected', {
            from: 'STRANGER', expectedHostId: null, reason: 'host_unresolved',
        });
    });

    it('cannot start or advance an outbound transfer after disposal', () => {
        const state = makeHost({ _disposed: true });

        state._sendResyncToPeer('PEER');
        expect(state.resyncTransfers.size).toBe(0);
        expect(state.network.sendP2PMessage).not.toHaveBeenCalled();

        const staleTransfer = {
            resyncId: 'STALE',
            steamId: 'PEER',
            chunks: [],
            inFlight: new Set(),
            retries: new Map(),
            lastSentAt: new Map(),
            cursor: 0,
            timer: null,
            awaitingFinalSince: null,
        };
        state._tickResyncTransfer(staleTransfer);
        expect(staleTransfer.awaitingFinalSince).toBeNull();
    });

    it('does not let another peer advance or finish a transfer', () => {
        const state = makeHost();
        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        const originalInFlight = Array.from(transfer.inFlight);
        const originalSendCount = sentResyncChunks(state).length;

        state._handleResyncAck({
            from: 'OTHER',
            data: { resyncId: transfer.resyncId, chunkIndex: 0, isFinal: true },
        });

        expect(Array.from(transfer.inFlight)).toEqual(originalInFlight);
        expect(sentResyncChunks(state)).toHaveLength(originalSendCount);
        expect(state.resyncTransfers.get(transfer.resyncId)).toBe(transfer);
        clearTransferTimers(state);
    });

    it('accepts the target peer final ACK even when individual chunk ACKs were lost', () => {
        const state = makeHost({ resyncWindow: 100 });
        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        expect(transfer.inFlight.size).toBeGreaterThan(0);
        expect(transfer.cursor).toBe(transfer.chunks.length);

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: transfer.resyncId, chunkIndex: null, isFinal: true },
        });

        expect(state.resyncTransfers.has(transfer.resyncId)).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_completed', {
            steamId: 'PEER',
            resyncId: transfer.resyncId,
            downloadEpoch: transfer.downloadEpoch,
        });
        expect(state.network.forceNextSnapshotKeyframe).toHaveBeenCalledWith('PEER');
    });

    it('does not accept a final ACK before every chunk has been dispatched', () => {
        const state = makeHost();
        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        expect(transfer.cursor).toBeLessThan(transfer.chunks.length);

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: transfer.resyncId, chunkIndex: null, isFinal: true },
        });

        expect(state.resyncTransfers.get(transfer.resyncId)).toBe(transfer);
        expect(transfer.timer).not.toBeNull();
        expect(state.network.forceNextSnapshotKeyframe).not.toHaveBeenCalled();
        clearTransferTimers(state);
    });

    it('default-denies ambiguous and malformed terminal ACK variants', () => {
        const state = makeHost();
        state._sendResyncToPeer('PEER');
        const transfer = getOnlyTransfer(state);
        const queueResync = vi.spyOn(state, 'queueResync');

        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: transfer.resyncId,
                rejected: true,
                reason: 'not_a_closed_reason',
                isFinal: true,
            },
        });
        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: transfer.resyncId,
                requestResync: true,
                rejected: true,
                reason: 'apply_failed',
            },
        });

        expect(state.resyncTransfers.get(transfer.resyncId)).toBe(transfer);
        expect(transfer.timer).not.toBeNull();
        expect(queueResync).not.toHaveBeenCalled();
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'resync_ack_rejected')).toEqual([
            ['resync_ack_rejected', { steamId: 'PEER', reason: 'invalid_variant' }],
            ['resync_ack_rejected', { steamId: 'PEER', reason: 'invalid_variant' }],
        ]);
        clearTransferTimers(state);
    });

    it('replaces a rejected fenced transfer with a fresh token and resets on success', () => {
        const state = makeHost({
            resyncWindow: 100,
            gamePhase: 'playing',
            simTick: 29,
            roundGeneration: 3,
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            _networkDispatch: { depth: 0 },
            _fixedTickApplicationDepth: 0,
            players: new Map([
                ['HOST', { gameState: { isProcessingPhysics: false } }],
                ['PEER', {
                    isAlive: true,
                    lastInputSeq: 4,
                    gameState: { isProcessingPhysics: false },
                }],
            ]),
        });
        const sendPrepare = (steamId, payload) => state.network.sendP2PMessage(
            steamId,
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            payload,
        );
        const firstBarrier = prepareHostResyncBarrier(
            state,
            'PEER',
            'initial',
            sendPrepare,
        );
        expect(acceptHostResyncReady(state, 'PEER', {
            ...firstBarrier,
            inputFence: 4,
        })).not.toBeNull();
        state.queueResync('PEER');
        const firstTransfer = getOnlyTransfer(state);

        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: firstTransfer.resyncId,
                rejected: true,
                reason: 'apply_failed',
            },
        });

        const retryBarrier = state.hostResyncInputBarriers.get('PEER');
        expect(firstTransfer.timer).toBeNull();
        expect(state.resyncTransfers.has(firstTransfer.resyncId)).toBe(false);
        expect(retryBarrier).toMatchObject({ status: 'prepare', reason: 'retry_apply_failed' });
        expect(retryBarrier.requestId).not.toBe(firstBarrier.requestId);
        expect(getHostResyncRetryCount(state, 'PEER')).toBe(1);
        expect(state.network.sendP2PMessage).toHaveBeenCalledWith(
            'PEER',
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ requestId: retryBarrier.requestId }),
        );

        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: firstTransfer.resyncId,
                rejected: true,
                reason: 'apply_failed',
            },
        });
        expect(state.hostResyncInputBarriers.get('PEER')).toBe(retryBarrier);
        expect(getHostResyncRetryCount(state, 'PEER')).toBe(1);

        expect(acceptHostResyncReady(state, 'PEER', {
            requestId: retryBarrier.requestId,
            roundGeneration: retryBarrier.roundGeneration,
            deadlineAt: retryBarrier.deadlineAt,
            inputFencePlayerId: 'PEER',
            inputFence: 4,
        })).not.toBeNull();
        state.queueResync('PEER');
        const retryTransfer = getOnlyTransfer(state);
        expect(retryTransfer.resyncId).not.toBe(firstTransfer.resyncId);
        expect(retryTransfer.inputBarrier).toMatchObject({ requestId: retryBarrier.requestId });

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: retryTransfer.resyncId, chunkIndex: null, isFinal: true },
        });

        expect(state.resyncTransfers.size).toBe(0);
        expect(state.hostResyncInputBarriers.size).toBe(0);
        expect(getHostResyncRetryCount(state, 'PEER')).toBe(0);
        expect(state.network.forceNextSnapshotKeyframe).toHaveBeenCalledWith('PEER');
    });

    it('does not let an old direct-transfer rejection cancel a newer fenced capture', () => {
        const state = makeHost({
            gamePhase: 'playing',
            simTick: 29,
            roundGeneration: 3,
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            _networkDispatch: { depth: 0 },
            _fixedTickApplicationDepth: 0,
            players: new Map([
                ['HOST', { gameState: { isProcessingPhysics: false } }],
                ['PEER', {
                    isAlive: true,
                    lastInputSeq: 4,
                    gameState: { isProcessingPhysics: false },
                }],
            ]),
        });
        state._sendResyncToPeer('PEER');
        const directTransfer = getOnlyTransfer(state);
        const newerBarrier = prepareHostResyncBarrier(state, 'PEER', 'newer', vi.fn());
        acceptHostResyncReady(state, 'PEER', { ...newerBarrier, inputFence: 4 });
        const newerRequirement = state.hostResyncInputBarriers.get('PEER');
        state.queueResync('PEER');
        expect(state.pendingResyncs).toEqual(['PEER']);

        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: directTransfer.resyncId,
                rejected: true,
                reason: 'payload_invalid',
            },
        });

        expect(directTransfer.timer).toBeNull();
        expect(state.hostResyncInputBarriers.get('PEER')).toBe(newerRequirement);
        expect(state.pendingResyncs).toEqual(['PEER']);
        state._processPendingResyncs();
        const fencedTransfer = getOnlyTransfer(state);
        expect(fencedTransfer.inputBarrier).toMatchObject({
            requestId: newerBarrier.requestId,
        });
        clearTransferTimers(state);
    });

    it('does not let a queued stale timer retransmit a rejected transfer', () => {
        const state = makeHost();
        state._sendResyncToPeer('PEER');
        const rejectedTransfer = getOnlyTransfer(state);

        state._handleResyncAck({
            from: 'PEER',
            data: {
                resyncId: rejectedTransfer.resyncId,
                rejected: true,
                reason: 'payload_invalid',
            },
        });
        const sendsAfterRejection = sentResyncChunks(state).length;
        vi.setSystemTime(5000);

        state._tickResyncTransfer(rejectedTransfer);

        expect(sentResyncChunks(state)).toHaveLength(sendsAfterRejection);
        expect(state.resyncTransfers.get(rejectedTransfer.resyncId)).not.toBe(rejectedTransfer);
        clearTransferTimers(state);
    });

    it('keeps a new fenced capture queued behind an older direct transfer', () => {
        const state = makeHost({
            resyncWindow: 100,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            simTick: 29,
            roundGeneration: 3,
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            players: new Map([
                ['HOST', { gameState: { isProcessingPhysics: false } }],
                ['PEER', {
                    isAlive: true,
                    lastInputSeq: 4,
                    gameState: { isProcessingPhysics: false },
                }],
            ]),
        });
        state._sendResyncToPeer('PEER');
        const directTransfer = getOnlyTransfer(state);
        const prepare = prepareHostResyncBarrier(state, 'PEER', 'recovery', vi.fn());
        acceptHostResyncReady(state, 'PEER', { ...prepare, inputFence: 7 });
        state.players.get('PEER').lastInputSeq = 7;

        state.queueResync('PEER');
        expect(state.pendingResyncs).toEqual(['PEER']);
        expect(state.resyncTransfers.get(directTransfer.resyncId)).toBe(directTransfer);

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: directTransfer.resyncId, chunkIndex: null, isFinal: true },
        });
        expect(state.hostResyncInputBarriers.get('PEER')).toMatchObject({
            requestId: prepare.requestId,
            status: 'requirement',
        });
        expect(state.pendingResyncs).toEqual(['PEER']);

        state._processPendingResyncs();
        const fencedTransfer = getOnlyTransfer(state);
        expect(fencedTransfer.resyncId).not.toBe(directTransfer.resyncId);
        expect(fencedTransfer.inputBarrier).toMatchObject({ requestId: prepare.requestId });
        expect(state.pendingResyncs).toEqual([]);
        clearTransferTimers(state);
    });

    it('retires a stale fenced transfer before issuing a reconnect token', () => {
        const player = {
            name: 'Peer',
            isAlive: true,
            isDisconnected: false,
            lastInputSeq: 4,
            gameState: { isProcessingPhysics: false },
        };
        const state = makeHost({
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            simTick: 29,
            roundGeneration: 3,
            pendingResyncs: [],
            hostResyncInputBarriers: new Map(),
            players: new Map([
                ['HOST', { gameState: { isProcessingPhysics: false } }],
                ['PEER', player],
            ]),
            broadcastPlayerList: vi.fn(),
            loopRunning: false,
        });
        state.network.clearNegotiatedProtocol = vi.fn();
        const first = prepareHostResyncBarrier(state, 'PEER', 'recovery', vi.fn());
        acceptHostResyncReady(state, 'PEER', { ...first, inputFence: 4 });
        state.queueResync('PEER');
        const staleTransfer = getOnlyTransfer(state);

        state.removePlayer('PEER');

        expect(player.isDisconnected).toBe(true);
        expect(state.resyncTransfers.size).toBe(0);
        expect(state.hostResyncInputBarriers.size).toBe(0);
        expect(state.pendingResyncs).toEqual([]);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_aborted', {
            steamId: 'PEER', resyncId: staleTransfer.resyncId, reason: 'disconnect',
        });

        state.addPlayer('PEER', 'Peer');
        const next = state.hostResyncInputBarriers.get('PEER');
        expect(next.requestId).not.toBe(first.requestId);
        expect(next).toMatchObject({ status: 'prepare', reason: 'reconnect' });
        expect(state.network.sendP2PMessage).toHaveBeenCalledWith(
            'PEER',
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ requestId: next.requestId }),
        );
    });

    it('authorizes resync requests only for roster players and spectators', () => {
        const queueResync = vi.fn();
        const state = makeHost({
            localPlayerId: 'HOST',
            players: new Map([['PLAYER', {}]]),
            spectators: new Set(['SPECTATOR']),
            resyncRequestAtByPeer: new Map(),
            queueResync,
        });

        state._handleResyncAck({ from: 'STRANGER', data: { requestResync: true } });
        state._handleResyncAck({ from: 'HOST', data: { requestResync: true } });
        state._handleResyncAck({ from: 'PLAYER', data: { requestResync: true, reason: 'digest' } });
        state._handleResyncAck({ from: 'SPECTATOR', data: { requestResync: true } });

        expect(queueResync.mock.calls).toEqual([['PLAYER'], ['SPECTATOR']]);
        expect(state._recordNetEvent.mock.calls
            .filter(([event]) => event === 'resync_request_rejected'))
            .toEqual([
                ['resync_request_rejected', { steamId: 'STRANGER', reason: 'unknown_peer' }],
                ['resync_request_rejected', { steamId: 'HOST', reason: 'unknown_peer' }],
            ]);
    });

    it('rate-limits repeated roster resync requests per peer at the keyframe cadence', () => {
        const queueResync = vi.fn();
        const state = makeHost({
            localPlayerId: 'HOST',
            players: new Map([['PEER', {}]]),
            spectators: new Set(),
            resyncRequestAtByPeer: new Map(),
            queueResync,
            network: {
                fullSnapshotIntervalMs: 250,
                sendP2PMessage: vi.fn(),
            },
        });

        state._handleResyncAck({ from: 'PEER', data: { requestResync: true } });
        vi.setSystemTime(1249);
        state._handleResyncAck({ from: 'PEER', data: { requestResync: true } });
        vi.setSystemTime(1250);
        state._handleResyncAck({ from: 'PEER', data: { requestResync: true } });

        expect(queueResync.mock.calls).toEqual([['PEER'], ['PEER']]);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_request_rejected', {
            steamId: 'PEER',
            reason: 'cooldown',
            retryAfterMs: 1,
        });
    });
});
