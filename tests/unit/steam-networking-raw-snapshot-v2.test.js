import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { PROTOCOL_V1, PROTOCOL_V2 } from '../../src/core/network/protocol-version.js';
import {
    SnapshotFrameKind,
    decodeSnapshotFrameV2,
    encodeSnapshotFrameV2,
} from '../../src/core/network/snapshot-frame-v2.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const MATCH_ID = 'raw-v2-match';
const MATCH_NONCE = '0123456789abcdef';

function emptyGrid() {
    return Array.from({ length: 24 }, () => Array.from({ length: 10 }, () => null));
}

function makePlayer(steamId, lastInputSeq, overrides = {}) {
    return {
        steamId,
        name: steamId,
        color: steamId === HOST_ID ? '#ff0000' : '#00ff00',
        score: 100,
        lines: 1,
        level: 1,
        frags: 0,
        isAlive: true,
        awaitingSpawn: false,
        garbagePending: 0,
        grid: emptyGrid(),
        currentPiece: null,
        nextPieces: ['I', 'O', 'T'],
        dropCounter: 0,
        dropInterval: 1000,
        garbageEntries: [],
        lockedPieces: [],
        blindTimers: null,
        lastInputSeq,
        ...overrides,
    };
}

function makeSnapshot({
    tick,
    hostScore = 100,
    hostAck = 10,
    peerAck = 20,
    digest = '8a2bf791',
} = {}) {
    return {
        players: [
            makePlayer(HOST_ID, hostAck, { score: hostScore }),
            makePlayer(PEER_ID, peerAck),
        ],
        gamePhase: 'playing',
        roundGeneration: 17,
        migrationEpoch: 4,
        winner: null,
        timestamp: 0,
        tick,
        simTick: tick,
        snapshotSeq: tick,
        digest,
        hotPotatoState: null,
    };
}

function makeHost(hostId = HOST_ID) {
    const network = new SteamNetworking();
    network.mockMode = true;
    network.steamId = hostId;
    network.isHost = true;
    network.hostSteamId = hostId;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.broadcastChannel = { postMessage: vi.fn() };
    network.connectedPeers.set(PEER_ID, { steamId: PEER_ID });
    expect(network.lockProtocolSession(PROTOCOL_V2)).toBe(true);
    network.seedNegotiatedProtocolPeers([PEER_ID]);
    return network;
}

function makePeer(protocolVersion = PROTOCOL_V2, matchNonce = MATCH_NONCE) {
    const network = new SteamNetworking();
    network.mockMode = true;
    network.steamId = PEER_ID;
    network.isHost = false;
    network.hostSteamId = HOST_ID;
    network.matchId = MATCH_ID;
    network.matchNonce = matchNonce;
    network.broadcastChannel = { postMessage: vi.fn() };
    expect(network.lockProtocolSession(protocolVersion)).toBe(true);
    return network;
}

function broadcastKeyframeAndDelta(host) {
    const baseline = makeSnapshot({ tick: 10 });
    const current = makeSnapshot({
        tick: 11,
        hostScore: 250,
        hostAck: 11,
        peerAck: 21,
        digest: '1234abcd',
    });
    host.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, baseline);
    host.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, current);
    return host.broadcastChannel.postMessage.mock.calls.map(([message]) => message);
}

function appendSnapshotBodyTail(rawFrame, value = 0xa5) {
    const decoded = decodeSnapshotFrameV2(rawFrame);
    const body = new Uint8Array(decoded.body.byteLength + 1);
    body.set(decoded.body);
    body[decoded.body.byteLength] = value;
    return encodeSnapshotFrameV2({ ...decoded, body });
}

function makeJsonSnapshotEnvelope(network) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: MessageTypes.GAME_STATE_FULL,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId: network.hostSteamId,
        channel: 0,
        seq: 1,
        tick: 10,
        sentAt: 1000,
        protocolVersion: PROTOCOL_V2,
        payload: makeSnapshot({ tick: 10 }),
    };
}

describe('SteamNetworking protocol-v2 raw snapshot lane', () => {
    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('emits a compact raw keyframe/delta without session constants or JSON payload', () => {
        const host = makeHost();
        const [keyframeMessage, deltaMessage] = broadcastKeyframeAndDelta(host);
        const keyframe = decodeSnapshotFrameV2(keyframeMessage.rawFrame);
        const delta = decodeSnapshotFrameV2(deltaMessage.rawFrame);

        expect(keyframe).toMatchObject({
            kind: SnapshotFrameKind.FULL,
            logicalChannel: 0,
            roundGeneration: 17,
            migrationEpoch: 4,
            acknowledgements: [10, 20],
        });
        expect(delta).toMatchObject({
            kind: SnapshotFrameKind.DELTA,
            logicalChannel: 1,
            digest: '1234abcd',
            acknowledgements: [11, 21],
        });
        expect(deltaMessage.rawFrame.byteLength).toBeLessThanOrEqual(80);
        expect(deltaMessage).not.toHaveProperty('matchNonce');
        expect(deltaMessage).not.toHaveProperty('protocolVersion');
        expect(deltaMessage).not.toHaveProperty('payload');
        expect(host.getPacketStats()).toMatchObject({
            snapshotDeltaWireBytesSent: {
                count: 1,
                p95: deltaMessage.rawFrame.byteLength,
            },
            snapshotPayloadBytesSent: { count: 2, p50: delta.body.byteLength },
        });
    });

    it.each(['real', 'mock'])('round-trips keyframe then delta through the %s ingress', (mode) => {
        const host = makeHost();
        const messages = broadcastKeyframeAndDelta(host);
        const peer = makePeer();
        const received = [];
        peer.on(MessageTypes.GAME_STATE_FULL, (message) => received.push(message.data));

        for (const message of messages) {
            const cloned = structuredClone(message);
            if (mode === 'mock') {
                peer.handleMockP2PMessage(cloned);
            } else {
                peer.handleP2PPacket({
                    steamId: HOST_ID,
                    data: cloned.rawFrame,
                    wireBytes: cloned.rawFrame.byteLength,
                });
            }
        }

        expect(received).toHaveLength(2);
        expect(received[1]).toMatchObject({
            tick: 11,
            roundGeneration: 17,
            migrationEpoch: 4,
            digest: '1234abcd',
        });
        expect(received[1].players.map((player) => player.lastInputSeq)).toEqual([11, 21]);
        expect(received[1].players[0].score).toBe(250);
        expect(peer.incomingSnapshotBaselines.get(HOST_ID).tick).toBe(10);
        expect(peer.getPacketStats()).toMatchObject({
            keyframesReceived: 1,
            deltasReceived: 1,
            deltaDecodeFailures: 0,
            resyncRequestsSent: 0,
            snapshotDeltaWireBytesReceived: {
                count: 1,
                p95: messages[1].rawFrame.byteLength,
            },
        });
    });

    it('rejects JSON snapshots in v2 and raw snapshots in v1', () => {
        const v2Peer = makePeer();
        const v2Handler = vi.fn();
        v2Peer.on(MessageTypes.GAME_STATE_FULL, v2Handler);
        v2Peer.handleP2PPacket({
            steamId: HOST_ID,
            data: makeJsonSnapshotEnvelope(v2Peer),
        });
        expect(v2Handler).not.toHaveBeenCalled();
        expect(v2Peer.getPacketStats().validationFailures).toBe(1);

        const v2Host = makeHost();
        expect(v2Host.sendP2PMessage(
            PEER_ID,
            MessageTypes.GAME_STATE_FULL,
            makeSnapshot({ tick: 10 }),
        )).toBe(false);
        expect(v2Host.broadcastChannel.postMessage).not.toHaveBeenCalled();

        const [rawMessage] = broadcastKeyframeAndDelta(makeHost());
        const v1Peer = makePeer(PROTOCOL_V1);
        const v1Handler = vi.fn();
        v1Peer.on(MessageTypes.GAME_STATE_FULL, v1Handler);
        v1Peer.handleP2PPacket({ steamId: HOST_ID, data: rawMessage.rawFrame });
        expect(v1Handler).not.toHaveBeenCalled();
        expect(v1Peer.getPacketStats().validationFailures).toBe(1);
    });

    it('rejects previous-session, duplicate, malformed, and wrong-authority raw frames', () => {
        const [rawMessage] = broadcastKeyframeAndDelta(makeHost());

        const previousSessionPeer = makePeer(PROTOCOL_V2, 'different-session');
        previousSessionPeer.handleP2PPacket({ steamId: HOST_ID, data: rawMessage.rawFrame });
        expect(previousSessionPeer.incomingSnapshotBaselines.size).toBe(0);
        expect(previousSessionPeer.getPacketStats().validationFailures).toBe(1);

        const livePeer = makePeer();
        const handler = vi.fn();
        livePeer.on(MessageTypes.GAME_STATE_FULL, handler);
        livePeer.handleP2PPacket({ steamId: HOST_ID, data: rawMessage.rawFrame });
        livePeer.handleP2PPacket({ steamId: HOST_ID, data: rawMessage.rawFrame });
        expect(handler).toHaveBeenCalledOnce();
        expect(livePeer.getPacketStats().validationFailures).toBe(1);

        const malformedPeer = makePeer();
        malformedPeer.handleP2PPacket({
            steamId: HOST_ID,
            data: Uint8Array.of(0x53, 0x42, 0x53, 0x46, 2),
        });
        expect(malformedPeer.getPacketStats().decodeFailures).toBe(1);
        expect(malformedPeer.incomingSnapshotBaselines.size).toBe(0);

        const forgedPeer = makePeer();
        forgedPeer.handleP2PPacket({ steamId: 'EVIL', data: rawMessage.rawFrame });
        expect(forgedPeer.incomingSnapshotBaselines.size).toBe(0);
        expect(forgedPeer.getPacketStats().roleValidationDropsByType)
            .toMatchObject({ [MessageTypes.GAME_STATE_FULL]: 1 });
    });

    it('rejects tailed SBNE and SBND bodies after valid raw-frame decoding', () => {
        const [keyframeMessage, deltaMessage] = broadcastKeyframeAndDelta(makeHost());

        const keyframePeer = makePeer();
        const keyframeHandler = vi.fn();
        keyframePeer.on(MessageTypes.GAME_STATE_FULL, keyframeHandler);
        keyframePeer.handleP2PPacket({
            steamId: HOST_ID,
            data: appendSnapshotBodyTail(keyframeMessage.rawFrame),
        });

        expect(keyframeHandler).not.toHaveBeenCalled();
        expect(keyframePeer.incomingSnapshotBaselines.size).toBe(0);
        expect(keyframePeer.getPacketStats()).toMatchObject({
            decodeFailures: 1,
            deltaDecodeFailures: 0,
            resyncRequestsSent: 0,
        });

        const deltaPeer = makePeer();
        const deltaHandler = vi.fn();
        deltaPeer.on(MessageTypes.GAME_STATE_FULL, deltaHandler);
        deltaPeer.handleP2PPacket({
            steamId: HOST_ID,
            data: keyframeMessage.rawFrame,
        });
        deltaPeer.handleP2PPacket({
            steamId: HOST_ID,
            data: appendSnapshotBodyTail(deltaMessage.rawFrame),
        });

        expect(deltaHandler).toHaveBeenCalledOnce();
        expect(deltaPeer.incomingSnapshotBaselines.get(HOST_ID).tick).toBe(10);
        expect(deltaPeer.getPacketStats()).toMatchObject({
            decodeFailures: 1,
            deltaDecodeFailures: 1,
            resyncRequestsSent: 1,
        });
    });

    it('does not advance the host baseline when strict v2 metadata cannot be framed', () => {
        const host = makeHost();
        const invalid = makeSnapshot({ tick: 10 });
        invalid.players[0].lastInputSeq = undefined;

        host.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, invalid);

        expect(host.broadcastChannel.postMessage).not.toHaveBeenCalled();
        expect(host.lastKeyframeSnapshot).toBeNull();
        expect(host.getPacketStats().sendFailures).toBe(1);
    });

    it('keeps an explicitly selected v2 session when match identity refreshes', () => {
        const host = makeHost();

        expect(host.lockProtocolSession()).toBe(true);
        expect(host.refreshMatchSession()).toMatchObject({ protocolVersion: PROTOCOL_V2 });
        expect(host.sessionProtocolVersion).toBe(PROTOCOL_V2);
    });

    it('preserves the codec across migration and rejects a queued old-host frame', () => {
        const newHostMessage = broadcastKeyframeAndDelta(makeHost('NEW_HOST'))[0];
        const oldHostMessage = broadcastKeyframeAndDelta(makeHost(HOST_ID))[0];
        const peer = makePeer();
        peer.hostSteamId = 'NEW_HOST';
        const handler = vi.fn();
        peer.on(MessageTypes.GAME_STATE_FULL, handler);

        peer.handleP2PPacket({ steamId: 'NEW_HOST', data: newHostMessage.rawFrame });
        peer.handleP2PPacket({ steamId: HOST_ID, data: oldHostMessage.rawFrame });

        expect(handler).toHaveBeenCalledOnce();
        expect(peer.incomingSnapshotBaselines.has('NEW_HOST')).toBe(true);
        expect(peer.incomingSnapshotBaselines.has(HOST_ID)).toBe(false);
        expect(peer.sessionProtocolVersion).toBe(PROTOCOL_V2);
        expect(peer.getPacketStats().roleValidationDropsByType)
            .toMatchObject({ [MessageTypes.GAME_STATE_FULL]: 1 });
    });
});
