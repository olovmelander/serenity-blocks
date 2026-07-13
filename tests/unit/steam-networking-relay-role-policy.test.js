import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    MessageTypes,
    PROTOCOL_CATALOG,
} from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const OTHER_PEER_ID = 'OTHER_PEER';
const MATCH_ID = 'relay-role-policy-match';
const MATCH_NONCE = 'relay-role-policy-nonce';

const RELAY_MESSAGE_TYPES = Object.freeze([
    MessageTypes.LOBBY_PLAYER_JOINED,
    MessageTypes.LOBBY_PLAYER_LEFT,
    MessageTypes.GAME_CHAT,
    MessageTypes.NET_ERROR,
]);

const INGRESS_MODES = Object.freeze(['p2p', 'mock']);

function makeNetwork({
    steamId = PEER_ID,
    isHost = false,
    hostSteamId = HOST_ID,
} = {}) {
    const network = new SteamNetworking();
    network.steamId = steamId;
    network.isHost = isHost;
    network.hostSteamId = hostSteamId;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.sendP2PMessage = vi.fn();
    network.lockProtocolSession();
    network.seedNegotiatedProtocolPeers([HOST_ID, PEER_ID, OTHER_PEER_ID]);
    return network;
}

function makeEnvelope(network, type, seq = 1) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: type,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId: network.hostSteamId,
        channel: 0,
        seq,
        tick: 42,
        sentAt: 1_000 + seq,
        protocolVersion: network.protocolVersion,
        payload: { marker: type },
    };
}

function deliver(network, envelope, sender, mode) {
    if (mode === 'mock') {
        network.handleMockP2PMessage({
            ...envelope,
            from: sender,
            to: network.steamId,
        });
        return;
    }

    network.handleP2PPacket({ steamId: sender, data: envelope }, envelope.channel);
}

function expectAccepted(network, handler, messageType, sender) {
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        from: sender,
        type: messageType,
        data: { marker: messageType },
    }));
    expect(network.connectedPeers.has(sender)).toBe(true);
    expect(network.getPacketStats()).toMatchObject({
        received: 1,
        validationFailures: 0,
        roleValidationDropsByType: {},
    });
}

function expectRejected(network, handler, messageType) {
    expect(handler).not.toHaveBeenCalled();
    expect(network.connectedPeers.size).toBe(0);
    expect(network.getPacketStats()).toMatchObject({
        received: 0,
        validationFailures: 1,
        roleValidationDropsByType: {
            [messageType]: 1,
        },
    });
    expect(network.getPacketStats().roleValidationDropsByType).toEqual({
        [messageType]: 1,
    });
}

describe('SteamNetworking exact relay role policies', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(RELAY_MESSAGE_TYPES)('declares only peer-to-host and host-to-peer for %s', (messageType) => {
        expect(PROTOCOL_CATALOG[messageType]).toEqual({
            status: 'supported',
            routes: [
                { sender: 'peer', receiver: 'host' },
                { sender: 'host', receiver: 'peer' },
            ],
        });
    });

    describe.each(INGRESS_MODES)('%s ingress', (mode) => {
        it.each(RELAY_MESSAGE_TYPES)('accepts peer-to-host %s', (messageType) => {
            const network = makeNetwork({ steamId: HOST_ID, isHost: true });
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), PEER_ID, mode);

            expectAccepted(network, handler, messageType, PEER_ID);
        });

        it.each(RELAY_MESSAGE_TYPES)('accepts host-to-peer %s', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expectAccepted(network, handler, messageType, HOST_ID);
        });

        it.each(RELAY_MESSAGE_TYPES)('rejects peer-to-peer %s', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), OTHER_PEER_ID, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(RELAY_MESSAGE_TYPES)('rejects host-to-host %s', (messageType) => {
            const network = makeNetwork({ steamId: HOST_ID, isHost: true });
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expectRejected(network, handler, messageType);
        });
    });
});
