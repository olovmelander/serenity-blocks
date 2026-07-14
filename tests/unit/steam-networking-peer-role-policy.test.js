import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    MESSAGE_ROLE_POLICIES,
    MessageTypes,
} from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const OTHER_PEER_ID = 'OTHER_PEER';
const MATCH_ID = 'peer-role-policy-match';
const MATCH_NONCE = 'peer-role-policy-nonce';

const PEER_TO_HOST_MESSAGE_TYPES = Object.freeze([
    MessageTypes.GAME_INPUT_BATCH,
    MessageTypes.LOBBY_PLAYER_READY,
    MessageTypes.GAME_ROUND_READY,
    MessageTypes.NET_PING,
]);

const INGRESS_MODES = Object.freeze(['p2p', 'mock']);

function makeNetwork({
    steamId = HOST_ID,
    isHost = true,
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

describe('SteamNetworking staged peer-to-host role policy', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(PEER_TO_HOST_MESSAGE_TYPES)('declares %s as explicitly peer-to-host', (messageType) => {
        expect(MESSAGE_ROLE_POLICIES[messageType]).toEqual({
            sender: 'peer',
            receiver: 'host',
        });
    });

    describe.each(INGRESS_MODES)('%s ingress', (mode) => {
        it.each(PEER_TO_HOST_MESSAGE_TYPES)('accepts %s from a peer', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), PEER_ID, mode);

            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                from: PEER_ID,
                type: messageType,
                data: { marker: messageType },
            }));
            expect(network.connectedPeers.has(PEER_ID)).toBe(true);
            expect(network.getPacketStats()).toMatchObject({
                received: 1,
                validationFailures: 0,
                roleValidationDropsByType: {},
            });
        });

        it.each(PEER_TO_HOST_MESSAGE_TYPES)('rejects %s from the host identity', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(PEER_TO_HOST_MESSAGE_TYPES)('rejects %s when the receiver is a peer', (messageType) => {
            const network = makeNetwork({ steamId: PEER_ID, isHost: false });
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), OTHER_PEER_ID, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(PEER_TO_HOST_MESSAGE_TYPES)('rejects %s without a transport sender', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), undefined, mode);

            expectRejected(network, handler, messageType);
        });
    });
});
