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
const MATCH_ID = 'host-role-policy-match';
const MATCH_NONCE = 'host-role-policy-nonce';

const HOST_TO_PEER_MESSAGE_TYPES = Object.freeze([
    MessageTypes.GAME_STATE_FULL,
    MessageTypes.GAME_SYNCPOINT,
    MessageTypes.GAME_PLAYER_LOCK,
    MessageTypes.GAME_LINES_CLEAR,
    MessageTypes.GAME_GARBAGE_SENT,
    MessageTypes.GAME_PLAYER_DIED,
    MessageTypes.GAME_PLAYER_FRAG,
    MessageTypes.GAME_MATCH_END,
    MessageTypes.GAME_ROUND_RESTART,
    MessageTypes.GAME_ROUND_START,
    MessageTypes.NET_HEARTBEAT,
    MessageTypes.LOBBY_GAME_START,
    MessageTypes.PLAYER_KICKED,
    MessageTypes.RETURN_TO_LOBBY,
    MessageTypes.NET_PONG,
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

function makeEnvelope(network, type, {
    hostSteamId = network.hostSteamId,
    seq = 1,
} = {}) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: type,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId,
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

describe('SteamNetworking staged host-to-peer role policy', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(HOST_TO_PEER_MESSAGE_TYPES)('declares %s as explicitly host-to-peer', (messageType) => {
        expect(MESSAGE_ROLE_POLICIES[messageType]).toEqual({
            sender: 'host',
            receiver: 'peer',
        });
    });

    describe.each(INGRESS_MODES)('%s ingress', (mode) => {
        it.each(HOST_TO_PEER_MESSAGE_TYPES)('accepts %s from the current host', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                from: HOST_ID,
                type: messageType,
                data: { marker: messageType },
            }));
            expect(network.connectedPeers.has(HOST_ID)).toBe(true);
            expect(network.getPacketStats()).toMatchObject({
                received: 1,
                validationFailures: 0,
                roleValidationDropsByType: {},
            });
        });

        it.each(HOST_TO_PEER_MESSAGE_TYPES)('rejects %s from another peer', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), OTHER_PEER_ID, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(HOST_TO_PEER_MESSAGE_TYPES)('rejects %s when the receiver is the host', (messageType) => {
            const network = makeNetwork({ steamId: HOST_ID, isHost: true });
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(HOST_TO_PEER_MESSAGE_TYPES)('rejects %s without a transport sender', (messageType) => {
            const network = makeNetwork();
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), undefined, mode);

            expectRejected(network, handler, messageType);
        });

        it.each(HOST_TO_PEER_MESSAGE_TYPES)('rejects %s while host authority is unresolved', (messageType) => {
            const network = makeNetwork({ hostSteamId: null });
            const handler = vi.fn();
            network.on(messageType, handler);

            deliver(network, makeEnvelope(network, messageType), HOST_ID, mode);

            expectRejected(network, handler, messageType);
        });
    });
});
