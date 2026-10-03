import {
    describe,
    expect,
    it,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = '10';
const PEER_ID = '20';
const PREFIX_TWIN_ID = '200'; // shares the "20" prefix with PEER_ID
const MATCH_ID = 'rejoin-match';
const MATCH_NONCE = 'rejoin-nonce';

function makeNetwork({ isHost = true } = {}) {
    const network = new SteamNetworking();
    network.steamId = isHost ? HOST_ID : PEER_ID;
    network.hostSteamId = HOST_ID;
    network.isHost = isHost;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.lockProtocolSession();
    return network;
}

function envelope(network, msgType, seq, { channel = 0, payload = {} } = {}) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId: network.hostSteamId,
        channel,
        seq,
        tick: null,
        sentAt: 1_000 + seq,
        protocolVersion: network.protocolVersion,
        payload,
    };
}

function hello(network, seq, handshakeNonce) {
    return envelope(network, MessageTypes.NET_HELLO, seq, { payload: { handshakeNonce } });
}

/** A finished first session: hello, then gameplay traffic on two logical channels. */
function playFirstSession(network, sender = PEER_ID) {
    expect(network._validateEnvelope(hello(network, 1, 'join-A'), sender, 0)).toBe(true);
    expect(network._validateEnvelope(envelope(network, MessageTypes.NET_PING, 500), sender, 0)).toBe(true);
    expect(network._validateEnvelope(
        envelope(network, MessageTypes.NET_PING, 300, { channel: 1 }),
        sender,
        0,
    )).toBe(true);
}

describe('SteamNetworking rejoin sequence handling', () => {
    it('accepts a rejoining peer whose send counters restarted', () => {
        const network = makeNetwork();
        playFirstSession(network);

        // The peer left and came back: a fresh client counts from 1 again.
        expect(network._validateEnvelope(hello(network, 1, 'join-B'), PEER_ID, 0)).toBe(true);
        expect(network.packetStats.peerSessionRestarts).toBe(1);

        // The new session's traffic flows on every logical channel.
        expect(network._validateEnvelope(envelope(network, MessageTypes.NET_PING, 2), PEER_ID, 0)).toBe(true);
        expect(network._validateEnvelope(
            envelope(network, MessageTypes.NET_PING, 1, { channel: 1 }),
            PEER_ID,
            0,
        )).toBe(true);
    });

    it('still drops retries and late duplicates of the same join attempt', () => {
        const network = makeNetwork();
        playFirstSession(network);
        expect(network._validateEnvelope(hello(network, 1, 'join-B'), PEER_ID, 0)).toBe(true);

        // Same nonce, sequence not ahead: a duplicate, not a second restart.
        expect(network._validateEnvelope(hello(network, 1, 'join-B'), PEER_ID, 0)).toBe(false);
        expect(network.packetStats.peerSessionRestarts).toBe(1);
        // An in-order retry of that join is still fine.
        expect(network._validateEnvelope(hello(network, 2, 'join-B'), PEER_ID, 0)).toBe(true);
    });

    it('keeps replay protection for everything that is not a new join', () => {
        const network = makeNetwork();
        playFirstSession(network);

        // Ordinary traffic below the high-water mark is still a replay.
        expect(network._validateEnvelope(envelope(network, MessageTypes.NET_PING, 1), PEER_ID, 0)).toBe(false);
        // A hello without a handshake nonce cannot prove it is a new session.
        expect(network._validateEnvelope(hello(network, 1, null), PEER_ID, 0)).toBe(false);
        expect(network._validateEnvelope(hello(network, 1, ''), PEER_ID, 0)).toBe(false);
        expect(network._validateEnvelope(hello(network, 1, 'x'.repeat(129)), PEER_ID, 0)).toBe(false);
        expect(network.packetStats.peerSessionRestarts).toBe(0);
    });

    it('only forgets the rejoining sender', () => {
        const network = makeNetwork();
        playFirstSession(network);
        playFirstSession(network, PREFIX_TWIN_ID);

        expect(network._validateEnvelope(hello(network, 1, 'join-B'), PEER_ID, 0)).toBe(true);

        // The other sender's high-water marks are intact.
        expect(network._validateEnvelope(
            envelope(network, MessageTypes.NET_PING, 400),
            PREFIX_TWIN_ID,
            0,
        )).toBe(false);
        expect(network._validateEnvelope(
            envelope(network, MessageTypes.NET_PING, 501),
            PREFIX_TWIN_ID,
            0,
        )).toBe(true);
    });

    it('never restarts a session on a peer', () => {
        const network = makeNetwork({ isHost: false });
        expect(network._validateEnvelope(hello(network, 5, 'join-A'), HOST_ID, 0)).toBe(true);

        expect(network._validateEnvelope(hello(network, 1, 'join-B'), HOST_ID, 0)).toBe(false);
        expect(network.packetStats.peerSessionRestarts).toBe(0);
    });

    it('forgets handshake nonces with the lobby session', () => {
        const network = makeNetwork();
        playFirstSession(network);
        expect(network.helloNonceByPeer.get(PEER_ID)).toBe('join-A');

        network._resetLobbySession();

        expect(network.helloNonceByPeer.size).toBe(0);
        expect(network.recvSeqByPeer.size).toBe(0);
    });
});
