import { describe, expect, it, vi } from 'vitest';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { getBinaryEncoder } from '../../src/core/network/binary-encoding.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';

function emptyGrid() {
    return Array.from({ length: 24 }, () => Array.from({ length: 10 }, () => null));
}

function makePlayer(overrides = {}) {
    return {
        steamId: '1000',
        name: 'Alpha',
        color: '#ff0000',
        score: 100,
        lines: 1,
        level: 1,
        frags: 0,
        isAlive: true,
        garbagePending: 0,
        grid: emptyGrid(),
        currentPiece: null,
        nextPieces: ['I', 'O', 'T'],
        dropCounter: 0,
        dropInterval: 1000,
        garbageEntries: [],
        lockedPieces: [],
        blindTimers: null,
        lastInputSeq: 0,
        ...overrides,
    };
}

function makeSnapshot({
    tick,
    score = 100,
    lastInputSeq = 0,
    roundGeneration = 3,
    migrationEpoch = 2,
    digest = `digest-${tick}`,
} = {}) {
    return {
        players: [makePlayer({ score, lastInputSeq })],
        gamePhase: 'playing',
        roundGeneration,
        migrationEpoch,
        winner: null,
        timestamp: 0,
        tick,
        digest,
    };
}

function makeNetwork() {
    const network = new SteamNetworking();
    network.steamId = PEER_ID;
    network.isHost = false;
    network.hostSteamId = HOST_ID;
    network.matchId = 'match-1';
    network.matchNonce = 'nonce-1';
    network.sendP2PMessage = vi.fn();
    network.lockProtocolSession();
    return network;
}

function makeHostNetwork() {
    const network = new SteamNetworking();
    network.mockMode = true;
    network.steamId = HOST_ID;
    network.isHost = true;
    network.hostSteamId = HOST_ID;
    network.matchId = 'match-1';
    network.matchNonce = 'nonce-1';
    network.broadcastChannel = { postMessage: vi.fn() };
    network.connectedPeers.set(PEER_ID, { steamId: PEER_ID });
    network.lockProtocolSession();
    network.seedNegotiatedProtocolPeers([PEER_ID]);
    return network;
}

function makeBinaryPayload(network, snapshot, baseline = null) {
    const encoder = getBinaryEncoder();
    const buffer = baseline
        ? encoder.encodeDeltaSnapshot(snapshot, baseline)
        : encoder.encodeSnapshot(snapshot);

    return {
        _binary: true,
        _delta: baseline != null,
        _data: network._arrayBufferToBase64(buffer),
        _gen: snapshot.roundGeneration,
        _migrationEpoch: snapshot.migrationEpoch,
        _acks: Object.fromEntries(snapshot.players.map((p) => [p.steamId, p.lastInputSeq])),
        _digest: snapshot.digest,
        _encodedSize: buffer.byteLength,
    };
}

function makeEnvelope(network, payload, { channel, seq }) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: 'game:state:full',
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId: network.hostSteamId,
        channel,
        seq,
        tick: null,
        sentAt: 1000 + seq,
        protocolVersion: network.protocolVersion,
        payload,
    };
}

function deliver(network, envelope, mode) {
    if (mode === 'mock') {
        network.handleMockP2PMessage({
            ...envelope,
            from: HOST_ID,
            to: PEER_ID,
        });
    } else {
        network.handleP2PPacket({ steamId: HOST_ID, data: envelope }, envelope.channel);
    }
}

describe('SteamNetworking binary snapshot handling', () => {
    it('omits the whole-world debug stringify and measures complete keyframe/delta envelopes', () => {
        const network = makeHostNetwork();
        const snapshot = makeSnapshot({ tick: 9, score: 300 });
        const deltaSnapshot = makeSnapshot({ tick: 10, score: 350 });
        const stringify = vi.spyOn(JSON, 'stringify');

        network.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, snapshot);
        network.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, deltaSnapshot);

        const serializedOriginalState = stringify.mock.calls
            .some(([value]) => value === snapshot || value === deltaSnapshot);
        expect(serializedOriginalState).toBe(false);
        expect(network.broadcastChannel.postMessage).toHaveBeenCalledTimes(2);
        const sentMessages = network.broadcastChannel.postMessage.mock.calls.map(([message]) => message);
        const expectedWireBytes = sentMessages.map((sentMessage) => {
            expect(sentMessage.payload).not.toHaveProperty('_originalSize');
            const wireEnvelope = { ...sentMessage };
            delete wireEnvelope.type;
            delete wireEnvelope.from;
            delete wireEnvelope.to;
            return new TextEncoder().encode(JSON.stringify(wireEnvelope)).byteLength;
        });
        expect(network.getPacketStats()).toMatchObject({
            snapshotBytesSent: { count: 2, max: Math.max(...expectedWireBytes) },
            snapshotKeyframeWireBytesSent: { count: 1, p95: expectedWireBytes[0] },
            snapshotDeltaWireBytesSent: { count: 1, p95: expectedWireBytes[1] },
        });
        expect(expectedWireBytes[1]).toBeGreaterThan(sentMessages[1].payload._encodedSize);
    });

    it('diffs deltas against the keyframe\'s values while the live board changes in place', () => {
        // The host builds snapshots from live objects: the same grid rows, piece and
        // queue are mutated between broadcasts. The baseline must not follow them.
        const host = makeHostNetwork();
        const live = makeSnapshot({ tick: 20, score: 100 });
        const [player] = live.players;
        player.currentPiece = {
            type: 'T', shapeKey: 'T', x: 4, y: 2, rotation: 0,
        };
        host.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, live);

        player.grid[23][0] = { type: 'garbage', color: '#808080' };
        player.currentPiece.x = 6;
        player.nextPieces.shift();
        host.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, { ...live, tick: 21 });

        const [keyframe, delta] = host.broadcastChannel.postMessage.mock.calls.map(([message]) => message);
        expect(delta.payload._delta).toBe(true);
        const peer = makeNetwork();
        const received = [];
        peer.on('game:state:full', (msg) => received.push(msg.data));
        deliver(peer, makeEnvelope(peer, keyframe.payload, { channel: 0, seq: 1 }), 'real');
        deliver(peer, makeEnvelope(peer, delta.payload, { channel: 1, seq: 1 }), 'real');

        const latest = received.at(-1).players[0];
        expect(String(latest.grid[23][0]?.type).toLowerCase()).toBe('garbage');
        expect(latest.currentPiece.x).toBe(6);
        expect(latest.nextPieces).toEqual(['O', 'T']);
    });

    it.each(['real', 'mock'])('decodes full then delta snapshots on the %s path and reattaches wrapper metadata', (mode) => {
        const network = makeNetwork();
        const received = [];
        network.on('game:state:full', (msg) => received.push(msg.data));

        const baseline = makeSnapshot({ tick: 10, score: 100, lastInputSeq: 4, digest: 'baseline-digest' });
        const current = makeSnapshot({ tick: 11, score: 250, lastInputSeq: 9, digest: 'current-digest' });

        deliver(network, makeEnvelope(network, makeBinaryPayload(network, baseline), { channel: 0, seq: 1 }), mode);
        deliver(network, makeEnvelope(network, makeBinaryPayload(network, current, baseline), { channel: 1, seq: 1 }), mode);

        expect(received).toHaveLength(2);
        expect(received[0].tick).toBe(10);
        expect(received[1].tick).toBe(11);
        expect(received[1].players[0].score).toBe(250);
        expect(received[1].players[0].lastInputSeq).toBe(9);
        expect(received[1].roundGeneration).toBe(3);
        expect(received[1].migrationEpoch).toBe(2);
        expect(received[1].digest).toBe('current-digest');
        expect(network.incomingSnapshotBaselines.get(HOST_ID).players[0])
            .not.toHaveProperty('lastInputSeq');

        const stats = network.getPacketStats();
        expect(stats.keyframesReceived).toBe(1);
        expect(stats.deltasReceived).toBe(1);
        expect(stats.decodeFailures).toBe(0);
        expect(stats.snapshotBytesReceived.count).toBe(2);
    });

    it('drops superseded delta stragglers silently in mock mode, matching the real Steam path', () => {
        const network = makeNetwork();
        const handler = vi.fn();
        network.on('game:state:full', handler);

        const oldBaseline = makeSnapshot({ tick: 10, score: 100 });
        const oldDelta = makeSnapshot({ tick: 11, score: 150 });
        const newerBaseline = makeSnapshot({ tick: 20, score: 200 });
        network.incomingSnapshotBaselines.set(HOST_ID, newerBaseline);

        deliver(network, makeEnvelope(network, makeBinaryPayload(network, oldDelta, oldBaseline), { channel: 1, seq: 1 }), 'mock');

        expect(handler).not.toHaveBeenCalled();
        expect(network.getPacketStats().staleDeltasDropped).toBe(1);
        expect(network.sendP2PMessage).not.toHaveBeenCalled();
    });

    it('waits for a late keyframe instead of asking for a resync, then decodes on', () => {
        const network = makeNetwork();
        const received = [];
        network.on('game:state:full', (msg) => received.push(msg.data));

        const currentBaseline = makeSnapshot({ tick: 10, score: 100 });
        const lateBaseline = makeSnapshot({ tick: 20, score: 200 });
        const deltaAgainstLateBaseline = makeSnapshot({ tick: 21, score: 300 });
        network.incomingSnapshotBaselines.set(HOST_ID, currentBaseline);

        // The delta overtook its keyframe (a resent reliable datagram): drop it, ask nothing.
        deliver(
            network,
            makeEnvelope(
                network,
                makeBinaryPayload(network, deltaAgainstLateBaseline, lateBaseline),
                { channel: 1, seq: 1 },
            ),
            'real',
        );
        expect(received).toHaveLength(0);
        expect(network.getPacketStats().aheadOfBaselineDeltas).toBe(1);
        expect(network.getPacketStats().resyncRequestsSent).toBe(0);
        expect(network.sendP2PMessage).not.toHaveBeenCalled();

        // The keyframe lands and the stream decodes again.
        deliver(network, makeEnvelope(network, makeBinaryPayload(network, lateBaseline), { channel: 0, seq: 1 }), 'real');
        deliver(
            network,
            makeEnvelope(
                network,
                makeBinaryPayload(network, deltaAgainstLateBaseline, lateBaseline),
                { channel: 1, seq: 2 },
            ),
            'real',
        );
        expect(received.map((state) => state.tick)).toEqual([20, 21]);
        expect(network.undecodableDeltaRuns.has(HOST_ID)).toBe(false);
    });

    it('asks for one resync only when the delta stream stays undecodable for a long run', () => {
        const network = makeNetwork();
        network.incomingSnapshotBaselines.set(HOST_ID, makeSnapshot({ tick: 10, score: 100 }));
        const missedBaseline = makeSnapshot({ tick: 20, score: 200 });

        for (let seq = 1; seq <= 60; seq += 1) {
            const delta = makeSnapshot({ tick: 20 + seq, score: 200 + seq });
            deliver(
                network,
                makeEnvelope(network, makeBinaryPayload(network, delta, missedBaseline), { channel: 1, seq }),
                'real',
            );
            expect(network.getPacketStats().resyncRequestsSent).toBe(seq < 60 ? 0 : 1);
        }
        expect(network.sendP2PMessage).toHaveBeenCalledTimes(1);
        expect(network.sendP2PMessage).toHaveBeenCalledWith(
            HOST_ID,
            'game:state:resync:ack',
            { requestResync: true, reason: 'delta_ahead_of_baseline' },
        );
    });

    it('allows a chunked resync snapshot to seed the next delta baseline', () => {
        const network = makeNetwork();
        const received = [];
        network.on('game:state:full', (msg) => received.push(msg.data));
        const resyncSnapshot = makeSnapshot({ tick: 30, score: 500 });
        const current = makeSnapshot({ tick: 31, score: 650 });

        network.setIncomingSnapshotBaseline(HOST_ID, resyncSnapshot);
        deliver(
            network,
            makeEnvelope(network, makeBinaryPayload(network, current, resyncSnapshot), { channel: 1, seq: 1 }),
            'real',
        );

        expect(received).toHaveLength(1);
        expect(received[0].tick).toBe(31);
        expect(received[0].players[0].score).toBe(650);
        expect(network.getPacketStats().resyncRequestsSent).toBe(0);
    });
});
