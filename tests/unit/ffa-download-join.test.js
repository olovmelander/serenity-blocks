import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { DOWNLOAD_JOIN_TIMEOUT_MS } from '../../src/core/multiplayer/ffa/resync-coordinator.js';
import { JOIN_LIFECYCLE_STATES } from '../../src/core/multiplayer/ffa/join-lifecycle.js';

function makeHost(overrides = {}) {
    const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        localPlayerId: 'HOST',
        players: new Map(),
        lastBroadcastState: new Map(),
        hostTick: 0,
        simTick: 120,
        snapshotSeq: 44,
        roundGeneration: 3,
        gamePhase: 'playing',
        matchConfig: { mode: 'ffa' },
        sharedSeed: 123,
        matchStartTime: 456,
        resyncTransfers: new Map(),
        resyncChunkSize: 64 * 1024,
        resyncWindow: 4,
        resyncTimeoutMs: 20,
        resyncMaxRetries: 2,
        downloadJoinPeers: new Map(),
        _downloadJoinEnabled: true,
        _netDiagEnabled: false,
        _recordNetEvent: vi.fn(),
        network: {
            broadcastSnapshot: vi.fn(),
            sendP2PMessage: vi.fn(),
        },
        buildStateSnapshot: vi.fn(function buildStateSnapshot() {
            return {
                players: [],
                gamePhase: this.gamePhase,
                roundGeneration: this.roundGeneration,
                tick: this.hostTick,
                simTick: this.simTick,
                snapshotSeq: this.snapshotSeq,
            };
        }),
        ...overrides,
    });
    return state;
}

function clearTransferTimers(state) {
    state.resyncTransfers?.forEach((transfer) => {
        if (transfer.timer) clearInterval(transfer.timer);
    });
}

describe('FFA download-then-stream join fence', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('skips live snapshot broadcasts to peers with an active download baseline', () => {
        const state = makeHost();
        state.downloadJoinPeers.set('PEER', {
            resyncId: 'r1',
            downloadEpoch: 'r1',
            startedAt: Date.now(),
        });

        state.broadcastGameState();

        expect(state.network.broadcastSnapshot).toHaveBeenCalledOnce();
        const [type, snapshot, options] = state.network.broadcastSnapshot.mock.calls[0];
        expect(type).toBe(MessageTypes.GAME_STATE_FULL);
        expect(snapshot.snapshotSeq).toBe(45);
        expect(options.skipPeers.has('PEER')).toBe(true);
    });

    it('stamps resync chunks and host blocklist entries with a download epoch', () => {
        const state = makeHost();

        state._sendResyncToPeer('PEER');
        const transfer = Array.from(state.resyncTransfers.values())[0];

        expect(transfer.downloadEpoch).toBe(transfer.resyncId);
        expect(state.downloadJoinPeers.get('PEER')).toMatchObject({
            resyncId: transfer.resyncId,
            downloadEpoch: transfer.resyncId,
            snapshotSeq: 45,
            simTick: 120,
            roundGeneration: 3,
        });
        expect(state.network.sendP2PMessage).toHaveBeenCalled();
        const [, type, chunk] = state.network.sendP2PMessage.mock.calls[0];
        expect(type).toBe(MessageTypes.GAME_STATE_RESYNC);
        expect(chunk).toMatchObject({
            downloadEpoch: transfer.resyncId,
            baselineSnapshotSeq: 45,
            baselineSimTick: 120,
            roundGeneration: 3,
        });

        clearTransferTimers(state);
    });

    it('keeps the host block active until the peer sends the final applied ACK', () => {
        const timer = setInterval(() => {}, 1000);
        const state = makeHost({
            resyncTransfers: new Map([['r1', {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                steamId: 'PEER',
                timer,
                inFlight: new Set(),
                cursor: 1,
                chunks: [{ chunkIndex: 0 }],
            }]]),
            downloadJoinPeers: new Map([['PEER', {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                startedAt: Date.now(),
            }]]),
        });

        state._handleResyncAck({
            from: 'PEER',
            data: { resyncId: 'r1', chunkIndex: null, isFinal: true },
        });

        expect(state.resyncTransfers.has('r1')).toBe(false);
        expect(state.downloadJoinPeers.has('PEER')).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_completed', expect.objectContaining({
            steamId: 'PEER',
            downloadEpoch: 'r1',
        }));
    });

    it('drops live snapshots on the peer while a download baseline is in progress', () => {
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            _downloadJoinEnabled: true,
            joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING,
            downloadJoinInProgress: {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                startedAt: Date.now(),
            },
            _recordNetEvent: vi.fn(),
        });

        expect(state._shouldDropLiveSnapshotDuringDownload({
            snapshotSeq: 45,
            simTick: 122,
        }, { from: 'HOST' })).toBe(true);
    });

    it('keeps the host block through the timeout boundary, then expires it with telemetry', () => {
        const startedAt = 1_000;
        const state = makeHost({
            downloadJoinPeers: new Map([['PEER', {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                startedAt,
            }]]),
        });
        const now = vi.spyOn(Date, 'now');

        now.mockReturnValue(startedAt + DOWNLOAD_JOIN_TIMEOUT_MS);
        expect(state._getDownloadJoinBlockedPeers()).toEqual(new Set(['PEER']));
        expect(state.downloadJoinPeers.has('PEER')).toBe(true);

        now.mockReturnValue(startedAt + DOWNLOAD_JOIN_TIMEOUT_MS + 1);
        expect(state._getDownloadJoinBlockedPeers()).toEqual(new Set());
        expect(state.downloadJoinPeers.has('PEER')).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('download_timeout', {
            steamId: 'PEER',
            resyncId: 'r1',
            downloadEpoch: 'r1',
        });
    });

    it('keeps the peer fence through the timeout boundary, then accepts live state', () => {
        const startedAt = 1_000;
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            _downloadJoinEnabled: true,
            joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING,
            downloadJoinInProgress: {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                startedAt,
            },
            _recordNetEvent: vi.fn(),
        });
        const now = vi.spyOn(Date, 'now');

        now.mockReturnValue(startedAt + DOWNLOAD_JOIN_TIMEOUT_MS);
        expect(state._shouldDropLiveSnapshotDuringDownload(
            { snapshotSeq: 45, simTick: 122 },
            { from: 'HOST' },
        )).toBe(true);

        now.mockReturnValue(startedAt + DOWNLOAD_JOIN_TIMEOUT_MS + 1);
        expect(state._shouldDropLiveSnapshotDuringDownload(
            { snapshotSeq: 46, simTick: 123 },
            { from: 'HOST' },
        )).toBe(false);
        expect(state.downloadJoinInProgress).toBeNull();
        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
        expect(state._recordNetEvent).toHaveBeenCalledWith('download_timeout', {
            resyncId: 'r1',
            downloadEpoch: 'r1',
            peerSide: true,
        });
    });

    it('clears the peer download fence after the resync snapshot applies', () => {
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            _downloadJoinEnabled: true,
            joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING,
            downloadJoinInProgress: {
                resyncId: 'r1',
                downloadEpoch: 'r1',
                startedAt: Date.now(),
            },
            players: new Map(),
            gamePhase: 'waiting',
            loopRunning: false,
            _recordNetEvent: vi.fn(),
            _applySnapshotState: vi.fn(),
            startGameLoop: vi.fn(),
        });

        state._applyResyncState({
            downloadEpoch: 'r1',
            resyncId: 'r1',
            snapshotSeq: 45,
            simTick: 122,
            roundGeneration: 3,
            players: [],
            gamePhase: 'waiting',
        });

        expect(state.downloadJoinInProgress).toBeNull();
        expect(state._applySnapshotState).toHaveBeenCalledWith(expect.objectContaining({
            downloadEpoch: 'r1',
        }), { forceLocal: true, render: false });
    });

    it('retires an old-host download fence so successor live snapshots are accepted', () => {
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            _downloadJoinEnabled: true,
            joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING,
            resyncBuffers: new Map([['old-r', {}]]),
            downloadJoinInProgress: {
                resyncId: 'old-r',
                downloadEpoch: 'old-r',
                startedAt: Date.now(),
            },
            network: {
                incomingSnapshotBaselines: new Map([['OLD', {}]]),
                lastResyncRequestAt: new Map([['OLD', Date.now()]]),
            },
            _recordNetEvent: vi.fn(),
        });

        expect(state._shouldDropLiveSnapshotDuringDownload(
            { snapshotSeq: 45, simTick: 122 },
            { from: 'OLD' },
        )).toBe(true);

        state.onHostAuthorityChanged({
            previousHostId: 'OLD',
            newHostId: 'NEW',
            source: 'migration_claim',
        });

        expect(state._shouldDropLiveSnapshotDuringDownload(
            { snapshotSeq: 46, simTick: 123 },
            { from: 'NEW' },
        )).toBe(false);
        expect(state.resyncBuffers.size).toBe(0);
        expect(state.network.incomingSnapshotBaselines.has('OLD')).toBe(false);
        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
    });
});
