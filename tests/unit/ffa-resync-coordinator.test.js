import {
    describe, expect, it, vi,
} from 'vitest';
import {
    createResyncChunks,
    crc32,
    decodeBase64,
    decodeResyncChunk,
    decodeUtf8,
    drainPendingInboundResyncApply,
    disposeResyncState,
    DOWNLOAD_JOIN_TIMEOUT_MS,
    encodeBase64,
    encodeUtf8,
    handleResyncChunk,
    mergeResyncChunks,
    resetInboundResyncState,
    RESYNC_CHUNK_SIZE,
    RESYNC_MAX_TRANSFER_BYTES,
    RESYNC_MAX_RETRIES,
    RESYNC_INBOUND_TIMEOUT_MS,
    RESYNC_TIMEOUT_MS,
    RESYNC_WINDOW,
} from '../../src/core/multiplayer/ffa/resync-coordinator.js';

function makeReceiveContext(payload, overrides = {}) {
    if (payload.encoding === 'binary-v1') {
        payload.header = { resyncId: 'R1', downloadEpoch: null, ...payload.header };
    }
    const bytes = encodeUtf8(JSON.stringify(payload));
    const [chunk] = createResyncChunks(bytes, {
        resyncId: 'R1',
        chunkSize: bytes.length + 1,
        baselineSnapshotSeq: 17,
        baselineSimTick: 29,
        roundGeneration: 3,
    });
    const context = {
        state: {
            resyncBuffers: new Map(),
            _downloadJoinEnabled: false,
            downloadJoinInProgress: null,
        },
        now: () => 100,
        sendAck: vi.fn(),
        decodeSnapshot: vi.fn(() => ({
            players: [{ steamId: 'A' }],
            tick: 23,
            simTick: 29,
            snapshotSeq: 17,
        })),
        hydrateSnapshot: vi.fn(() => ({ players: [{ steamId: 'A' }] })),
        setIncomingBaseline: vi.fn(),
        applyState: vi.fn(),
        recordEvent: vi.fn(),
        ...overrides,
    };
    return { chunk, context };
}

describe('FFA resync coordinator primitives', () => {
    it('pins transfer defaults used by both ends of the chunk protocol', () => {
        expect({
            chunkSize: RESYNC_CHUNK_SIZE,
            window: RESYNC_WINDOW,
            timeoutMs: RESYNC_TIMEOUT_MS,
            maxRetries: RESYNC_MAX_RETRIES,
            downloadJoinTimeoutMs: DOWNLOAD_JOIN_TIMEOUT_MS,
        }).toEqual({
            chunkSize: 16 * 1024,
            window: 4,
            timeoutMs: 300,
            maxRetries: 5,
            downloadJoinTimeoutMs: 15000,
        });
    });

    it('round-trips unicode payload bytes through base64 without shared storage', () => {
        const text = 'resync: Δ serenity 🌌';
        const encoded = encodeUtf8(text);
        const decoded = decodeBase64(encodeBase64(encoded));

        expect(decoded).not.toBe(encoded);
        expect(decoded).toEqual(encoded);
        expect(decodeUtf8(decoded)).toBe(text);
    });

    it('matches the standard CRC-32 check vector', () => {
        expect(crc32(encodeUtf8('123456789'))).toBe(0xCBF43926);
    });

    it('chunks and reassembles the exact JSON payload with stamped baselines', () => {
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            snapshot: 'abcdefghijk',
        };
        const payloadBytes = encodeUtf8(JSON.stringify(payload));
        const chunks = createResyncChunks(payloadBytes, {
            resyncId: 'R1',
            downloadEpoch: 'D1',
            chunkSize: 11,
            baselineSnapshotSeq: 17,
            baselineSimTick: 29,
            roundGeneration: 3,
        });

        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((chunk, chunkIndex) => {
            expect(chunk).toMatchObject({
                resyncId: 'R1',
                downloadEpoch: 'D1',
                chunkIndex,
                chunkCount: chunks.length,
                byteOffset: chunkIndex * 11,
                baselineSnapshotSeq: 17,
                baselineSimTick: 29,
                roundGeneration: 3,
            });
        });
        const accepted = chunks.map((chunk) => ({
            byteOffset: chunk.byteOffset,
            bytes: decodeResyncChunk(chunk.data, chunk.crc32),
        }));
        const merged = mergeResyncChunks(accepted.reverse());

        expect(merged).toHaveLength(payloadBytes.length);
        expect(JSON.parse(decodeUtf8(merged))).toEqual(payload);
    });

    it('rejects a chunk whose checksum does not match', () => {
        const data = encodeBase64(encodeUtf8('damaged'));
        expect(decodeResyncChunk(data, 123)).toBeNull();
    });

    it('rejects transfer and chunk sizes beyond the receive budget', () => {
        expect(() => createResyncChunks(new Uint8Array(RESYNC_MAX_TRANSFER_BYTES + 1), {
            resyncId: 'TOO-LARGE',
            baselineSnapshotSeq: 1,
            baselineSimTick: 1,
            roundGeneration: 1,
        })).toThrow(RangeError);
        expect(() => createResyncChunks(Uint8Array.of(1), {
            resyncId: 'CHUNK-TOO-LARGE',
            chunkSize: 64 * 1024 + 1,
            baselineSnapshotSeq: 1,
            baselineSimTick: 1,
            roundGeneration: 1,
        })).toThrow(RangeError);
    });

    it('validates metadata before opening download lifecycle state', () => {
        const transitionJoin = vi.fn();
        const { chunk, context } = makeReceiveContext({ players: [] }, { transitionJoin });

        handleResyncChunk(context, {
            from: 'HOST',
            data: { ...chunk, baselineSnapshotSeq: -1 },
        });

        expect(transitionJoin).not.toHaveBeenCalled();
        expect(context.state.resyncBuffers.size).toBe(0);
        expect(context.sendAck).not.toHaveBeenCalled();
    });

    it('rejects overlapping chunks without growing the aggregate buffer', () => {
        const payloadBytes = encodeUtf8(JSON.stringify({ players: [], marker: 'overlap' }));
        const chunks = createResyncChunks(payloadBytes, {
            resyncId: 'OVERLAP',
            chunkSize: Math.ceil(payloadBytes.length / 2),
            baselineSnapshotSeq: 2,
            baselineSimTick: 3,
            roundGeneration: 1,
        });
        const { context } = makeReceiveContext({ players: [] });

        handleResyncChunk(context, { from: 'HOST', data: chunks[0] });
        handleResyncChunk(context, {
            from: 'HOST', data: { ...chunks[1], byteOffset: 0 },
        });

        const buffer = context.state.resyncBuffers.get('OVERLAP');
        const firstChunkBytes = decodeResyncChunk(chunks[0].data, chunks[0].crc32);
        expect(buffer.received).toBe(1);
        expect(buffer.receivedBytes).toBe(firstChunkBytes.length);
        expect(context.sendAck).toHaveBeenCalledOnce();
        expect(context.applyState).not.toHaveBeenCalled();
    });

    it('defers a decoded transfer until the receiver reports an idle window', () => {
        let idle = false;
        const scheduleTimeout = vi.fn(() => 91);
        const clearTimeout = vi.fn();
        const payload = {
            players: [], migrationEpoch: 2, roundGeneration: 3, snapshotSeq: 17, simTick: 29,
        };
        const { chunk, context } = makeReceiveContext(payload, {
            canApplyState: () => idle,
            scheduleTimeout,
            clearTimeout,
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(context.applyState).not.toHaveBeenCalled();
        expect(context.state.pendingInboundResyncApply).toEqual(expect.objectContaining({
            resyncId: 'R1', timer: 91,
        }));
        expect(context.sendAck.mock.calls.some(([ack]) => ack.isFinal)).toBe(false);

        idle = true;
        expect(drainPendingInboundResyncApply(context)).toBe(true);
        expect(clearTimeout).toHaveBeenCalledWith(91);
        expect(context.applyState).toHaveBeenCalledOnce();
        expect(context.state.pendingInboundResyncApply).toBeNull();
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', chunkIndex: null, isFinal: true,
        });
    });

    it('cannot rewind a newer same-round resync when older chunks arrive late', () => {
        const { context } = makeReceiveContext({ players: [] });
        const makeChunks = (resyncId, snapshotSeq, simTick) => {
            const payload = {
                players: [],
                marker: resyncId,
                migrationEpoch: 4,
                roundGeneration: 7,
                snapshotSeq,
                simTick,
            };
            const bytes = encodeUtf8(JSON.stringify(payload));
            return createResyncChunks(bytes, {
                resyncId,
                chunkSize: Math.ceil(bytes.length / 3),
                baselineSnapshotSeq: snapshotSeq,
                baselineSimTick: simTick,
                roundGeneration: 7,
            });
        };
        const older = makeChunks('OLDER', 20, 200);
        const newer = makeChunks('NEWER', 21, 205);

        handleResyncChunk(context, { from: 'HOST', data: older[0] });
        newer.forEach((data) => handleResyncChunk(context, { from: 'HOST', data }));
        older.slice(1).forEach((data) => handleResyncChunk(context, { from: 'HOST', data }));

        expect(context.applyState).toHaveBeenCalledOnce();
        expect(context.applyState).toHaveBeenCalledWith(expect.objectContaining({
            marker: 'NEWER', snapshotSeq: 21, simTick: 205,
        }));
        expect(context.state.lastAppliedResyncFence).toEqual({
            migrationEpoch: 4, roundGeneration: 7, snapshotSeq: 21, simTick: 205,
        });
        expect(context.recordEvent).toHaveBeenCalledWith('resync_superseded', {
            resyncId: 'OLDER', from: 'HOST',
        });
    });

    it('validates and applies a present sidecar before committing the decoder baseline', () => {
        const order = [];
        const validated = { trusted: true };
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            sidecar: { schema: 'test' },
            snapshot: encodeBase64(Uint8Array.of(1, 2, 3)),
        };
        const { chunk, context } = makeReceiveContext(payload, {
            validateSidecar: vi.fn(() => {
                order.push('validate');
                return validated;
            }),
            setIncomingBaseline: vi.fn(() => order.push('baseline')),
            applyState: vi.fn(() => order.push('apply')),
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(order).toEqual(['validate', 'apply', 'baseline']);
        expect(context.validateSidecar).toHaveBeenCalledWith(payload.sidecar, {
            header: payload.header,
            packedSnapshot: expect.objectContaining({ players: [{ steamId: 'A' }] }),
        });
        expect(context.applyState).toHaveBeenCalledWith(expect.objectContaining({
            resyncSidecar: validated,
        }));
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', chunkIndex: null, isFinal: true,
        });
    });

    it('rejects an invalid present sidecar once and replays the terminal verdict', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            sidecar: { schema: 'unknown' },
            snapshot: encodeBase64(Uint8Array.of(1, 2, 3)),
        };
        const { chunk, context } = makeReceiveContext(payload, {
            validateSidecar: vi.fn(() => { throw new TypeError('bad sidecar'); }),
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });
        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(context.setIncomingBaseline).not.toHaveBeenCalled();
        expect(context.applyState).not.toHaveBeenCalled();
        expect(context.sendAck.mock.calls.some(([ack]) => ack.isFinal)).toBe(false);
        expect(context.state.resyncBuffers.size).toBe(0);
        expect(context.validateSidecar).toHaveBeenCalledOnce();
        expect(context.sendAck.mock.calls
            .filter(([ack]) => ack.rejected === true)
            .map(([ack]) => ack)).toEqual([
            { resyncId: 'R1', rejected: true, reason: 'sidecar_invalid' },
            { resyncId: 'R1', rejected: true, reason: 'sidecar_invalid' },
        ]);
        expect(context.recordEvent.mock.calls
            .filter(([event]) => event === 'resync_rejected')).toEqual([[
            'resync_rejected',
            { resyncId: 'R1', from: 'HOST', reason: 'sidecar_invalid' },
        ]]);
    });

    it('does not commit the decoder baseline when live-state application fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            snapshot: encodeBase64(Uint8Array.of(1, 2, 3)),
        };
        const { chunk, context } = makeReceiveContext(payload, {
            applyState: vi.fn(() => { throw new Error('apply failed'); }),
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(context.setIncomingBaseline).not.toHaveBeenCalled();
        expect(context.sendAck.mock.calls.some(([ack]) => ack.isFinal)).toBe(false);
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', rejected: true, reason: 'apply_failed',
        });
        expect(context.state.pendingInboundResyncApply).toBeNull();
    });

    it('distinguishes a clean application-fence rejection from an apply exception', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            snapshot: encodeBase64(Uint8Array.of(1, 2, 3)),
        };
        const { chunk, context } = makeReceiveContext(payload, {
            applyState: vi.fn(() => false),
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(context.setIncomingBaseline).not.toHaveBeenCalled();
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', rejected: true, reason: 'apply_rejected',
        });
    });

    it('discards malformed payload bytes and reports a bounded parser verdict', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const bytes = encodeUtf8('{not valid json');
        const [chunk] = createResyncChunks(bytes, {
            resyncId: 'MALFORMED',
            chunkSize: bytes.length + 1,
            baselineSnapshotSeq: 17,
            baselineSimTick: 29,
            roundGeneration: 3,
        });
        const { context } = makeReceiveContext({ players: [] });

        handleResyncChunk(context, { from: 'HOST', data: chunk });

        expect(context.applyState).not.toHaveBeenCalled();
        expect(context.setIncomingBaseline).not.toHaveBeenCalled();
        expect(context.state.resyncBuffers.size).toBe(0);
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'MALFORMED', rejected: true, reason: 'payload_invalid',
        });
    });

    it('rejects a complete transfer that cannot reach an idle apply window in time', () => {
        let timestamp = 100;
        const scheduleTimeout = vi.fn(() => 91);
        const clearTimeout = vi.fn();
        const { chunk, context } = makeReceiveContext({
            players: [],
            migrationEpoch: 1,
            roundGeneration: 3,
            snapshotSeq: 17,
            simTick: 29,
        }, {
            now: () => timestamp,
            canApplyState: () => false,
            scheduleTimeout,
            clearTimeout,
        });

        handleResyncChunk(context, { from: 'HOST', data: chunk });
        timestamp += RESYNC_INBOUND_TIMEOUT_MS + 1;

        expect(drainPendingInboundResyncApply(context)).toBe(false);
        expect(clearTimeout).toHaveBeenCalledWith(91);
        expect(context.applyState).not.toHaveBeenCalled();
        expect(context.state.pendingInboundResyncApply).toBeNull();
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', rejected: true, reason: 'apply_timeout',
        });
    });

    it('keeps sidecar-free binary-v1 as an observable mixed-build fallback', () => {
        const payload = {
            encoding: 'binary-v1',
            header: { snapshotSeq: 17, simTick: 29, roundGeneration: 3 },
            snapshot: encodeBase64(Uint8Array.of(1, 2, 3)),
        };
        const { chunk, context } = makeReceiveContext(payload);

        handleResyncChunk(context, { from: 'OLD_HOST', data: chunk });

        expect(context.recordEvent).toHaveBeenCalledWith('resync_sidecar_missing', {
            resyncId: 'R1',
            from: 'OLD_HOST',
            encoding: 'binary-v1',
        });
        expect(context.applyState).toHaveBeenCalledOnce();
        expect(context.sendAck).toHaveBeenLastCalledWith({
            resyncId: 'R1', chunkIndex: null, isFinal: true,
        });
    });

    it('cancels every transfer timer and clears partial state on disposal', () => {
        const clearTimer = vi.fn();
        const first = { timer: 0 };
        const second = { timer: 9 };
        const state = {
            resyncTransfers: new Map([['R1', first], ['R2', second]]),
            resyncBuffers: new Map([['R3', {}]]),
            completedResyncs: new Map([['HOST\u0000R0', { completedAt: 1 }]]),
            pendingResyncs: ['P1'],
            resyncRequestAtByPeer: new Map([['P1', 100]]),
            downloadJoinPeers: new Map([['P1', {}]]),
            downloadJoinInProgress: { resyncId: 'R3' },
        };

        disposeResyncState(state, clearTimer);

        expect(clearTimer.mock.calls).toEqual([[0], [9]]);
        expect(first.timer).toBeNull();
        expect(second.timer).toBeNull();
        expect(state.resyncTransfers.size).toBe(0);
        expect(state.resyncBuffers.size).toBe(0);
        expect(state.completedResyncs.size).toBe(0);
        expect(state.pendingResyncs).toEqual([]);
        expect(state.resyncRequestAtByPeer.size).toBe(0);
        expect(state.downloadJoinPeers.size).toBe(0);
        expect(state.downloadJoinInProgress).toBeNull();
    });

    it('retires inbound partial state without touching outbound transfers', () => {
        const transfer = { timer: 9 };
        const state = {
            resyncTransfers: new Map([['OUT', transfer]]),
            resyncBuffers: new Map([['OLD-A', {}], ['OLD-B', {}]]),
            completedResyncs: new Map([['OLD\u0000DONE', { completedAt: 1 }]]),
            downloadJoinInProgress: { resyncId: 'OLD-A' },
        };

        expect(resetInboundResyncState(state)).toEqual({
            discardedBuffers: 2,
            discardedDownload: true,
        });
        expect(state.resyncBuffers.size).toBe(0);
        expect(state.completedResyncs.size).toBe(0);
        expect(state.downloadJoinInProgress).toBeNull();
        expect(state.resyncTransfers.get('OUT')).toBe(transfer);
    });
});
