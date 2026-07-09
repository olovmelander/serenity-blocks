import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

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
            snapshotSeq: 44,
            simTick: 120,
            roundGeneration: 3,
        });
        expect(state.network.sendP2PMessage).toHaveBeenCalled();
        const [, type, chunk] = state.network.sendP2PMessage.mock.calls[0];
        expect(type).toBe(MessageTypes.GAME_STATE_RESYNC);
        expect(chunk).toMatchObject({
            downloadEpoch: transfer.resyncId,
            baselineSnapshotSeq: 44,
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

    it('clears the peer download fence after the resync snapshot applies', () => {
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            _downloadJoinEnabled: true,
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
        }), { forceLocal: true });
    });
});
