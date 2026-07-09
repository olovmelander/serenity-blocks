import { describe, expect, it, vi } from 'vitest';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { getBinaryEncoder } from '../../src/core/network/binary-encoding.js';

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

    it('classifies deltas ahead of the current keyframe baseline and requests one resync', () => {
        const network = makeNetwork();
        const handler = vi.fn();
        network.on('game:state:full', handler);

        const currentBaseline = makeSnapshot({ tick: 10, score: 100 });
        const missedBaseline = makeSnapshot({ tick: 20, score: 200 });
        const deltaAgainstMissedBaseline = makeSnapshot({ tick: 21, score: 300 });
        network.incomingSnapshotBaselines.set(HOST_ID, currentBaseline);

        deliver(
            network,
            makeEnvelope(
                network,
                makeBinaryPayload(network, deltaAgainstMissedBaseline, missedBaseline),
                { channel: 1, seq: 1 },
            ),
            'real',
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.getPacketStats().aheadOfBaselineDeltas).toBe(1);
        expect(network.getPacketStats().resyncRequestsSent).toBe(1);
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
