import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const OLD_HOST_ID = 'OLD_HOST';
const NEW_HOST_ID = 'NEW_HOST';
const PEER_ID = 'PEER';
const MATCH_ID = 'outbound-role-policy-match';
const MATCH_NONCE = 'outbound-role-policy-nonce';

function makeMockNetwork({
    steamId = PEER_ID,
    isHost = false,
    hostSteamId = HOST_ID,
} = {}) {
    const network = new SteamNetworking();
    network.mockMode = true;
    network.steamId = steamId;
    network.isHost = isHost;
    network.hostSteamId = hostSteamId;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.lockProtocolSession();
    if (isHost) {
        network.connectedPeers.set(PEER_ID, { steamId: PEER_ID });
        network.seedNegotiatedProtocolPeers([PEER_ID]);
    } else if (hostSteamId) {
        network.setNegotiatedProtocol(hostSteamId, network.protocolVersion);
    }
    network._sendEnvelope = vi.fn();
    return network;
}

function expectOneEnvelope(network, target, messageType, payload) {
    expect(network._sendEnvelope).toHaveBeenCalledOnce();
    expect(network._sendEnvelope).toHaveBeenCalledWith(
        target,
        messageType,
        expect.objectContaining({
            msgType: messageType,
            matchId: MATCH_ID,
            matchNonce: MATCH_NONCE,
            hostSteamId: network.hostSteamId,
            payload,
        }),
        expect.objectContaining({ delivery: 'reliable' }),
    );
    expect(network.getPacketStats().sendFailures).toBe(0);
}

function expectRejected(network) {
    expect(network._sendEnvelope).not.toHaveBeenCalled();
    expect(network.getPacketStats()).toMatchObject({
        sent: 0,
        sendFailures: 1,
    });
}

describe('SteamNetworking outbound role enforcement', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['host-to-peer', MessageTypes.GAME_ROUND_START],
        ['relay', MessageTypes.GAME_CHAT],
    ])('lets a host send and broadcast a %s message', (_label, messageType) => {
        const payload = { marker: messageType };
        const direct = makeMockNetwork({ steamId: HOST_ID, isHost: true });

        expect(direct.sendP2PMessage(PEER_ID, messageType, payload)).toBe(true);
        expectOneEnvelope(direct, PEER_ID, messageType, payload);

        const broadcast = makeMockNetwork({ steamId: HOST_ID, isHost: true });
        broadcast.broadcastToAll(messageType, payload);
        expectOneEnvelope(broadcast, PEER_ID, messageType, payload);
    });

    it('prevents a host from sending or broadcasting a peer-to-host message', () => {
        const direct = makeMockNetwork({ steamId: HOST_ID, isHost: true });
        expect(direct.sendP2PMessage(PEER_ID, MessageTypes.GAME_INPUT_BATCH, { inputs: [] })).toBe(false);
        expectRejected(direct);

        const broadcast = makeMockNetwork({ steamId: HOST_ID, isHost: true });
        broadcast.broadcastToAll(MessageTypes.GAME_INPUT_BATCH, { inputs: [] });
        expectRejected(broadcast);
    });

    it.each([
        ['peer-to-host', MessageTypes.GAME_INPUT_BATCH],
        ['relay', MessageTypes.GAME_CHAT],
    ])('lets a peer send a %s message to the host', (_label, messageType) => {
        const network = makeMockNetwork();
        const payload = { marker: messageType };

        expect(network.sendP2PMessage(HOST_ID, messageType, payload)).toBe(true);

        expectOneEnvelope(network, HOST_ID, messageType, payload);
    });

    it('prevents a peer from sending a host-to-peer message', () => {
        const network = makeMockNetwork();

        expect(network.sendP2PMessage(HOST_ID, MessageTypes.GAME_ROUND_START, {
            roundGeneration: 4,
        })).toBe(false);

        expectRejected(network);
    });

    it.each([
        ['peer-to-host', MessageTypes.GAME_INPUT_BATCH],
        ['relay', MessageTypes.GAME_CHAT],
        ['host-to-peer', MessageTypes.GAME_ROUND_START],
    ])('prevents a peer from broadcasting an ordinary %s message', (_label, messageType) => {
        const network = makeMockNetwork();

        network.broadcastToAll(messageType, { marker: messageType });

        expectRejected(network);
    });

    it('lets an unpromoted candidate peer broadcast its migration CLAIM', () => {
        const network = makeMockNetwork({
            steamId: NEW_HOST_ID,
            hostSteamId: OLD_HOST_ID,
        });
        const payload = { newHostId: NEW_HOST_ID, migrationEpoch: 3 };

        network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_CLAIM, payload);

        expectOneEnvelope(network, 'all', MessageTypes.GAME_HOST_MIGRATION_CLAIM, payload);
    });

    it('lets only the promoted, self-identifying successor broadcast migration SYNC', () => {
        const network = makeMockNetwork({
            steamId: NEW_HOST_ID,
            isHost: true,
            hostSteamId: NEW_HOST_ID,
        });
        const payload = { newHostId: NEW_HOST_ID, migrationEpoch: 3, snapshot: { players: [] } };

        network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_SYNC, payload);

        expectOneEnvelope(network, PEER_ID, MessageTypes.GAME_HOST_MIGRATION_SYNC, payload);
    });

    it.each([
        [
            'not promoted',
            { steamId: NEW_HOST_ID, isHost: false, hostSteamId: OLD_HOST_ID },
            { newHostId: NEW_HOST_ID },
        ],
        [
            'host authority still names the old host',
            { steamId: NEW_HOST_ID, isHost: true, hostSteamId: OLD_HOST_ID },
            { newHostId: NEW_HOST_ID },
        ],
        [
            'payload names another successor',
            { steamId: NEW_HOST_ID, isHost: true, hostSteamId: NEW_HOST_ID },
            { newHostId: PEER_ID },
        ],
        [
            'local Steam identity is unresolved',
            { steamId: null, isHost: true, hostSteamId: null },
            { newHostId: NEW_HOST_ID },
        ],
    ])('rejects successor SYNC when %s', (_label, networkState, payload) => {
        const network = makeMockNetwork(networkState);

        network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_SYNC, payload);

        expectRejected(network);
    });
});
