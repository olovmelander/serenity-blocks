import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { CURRENT_PROTOCOL_VERSION } from '../../src/core/network/protocol-version.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const ACCEPTED_PEER_ID = 'ACCEPTED';
const UNACCEPTED_PEER_ID = 'UNACCEPTED';
const MATCH_ID = 'protocol-session-match';
const MATCH_NONCE = 'protocol-session-nonce';
const INGRESS_MODES = Object.freeze(['mock', 'p2p']);

function makeNetwork({
    isHost = true,
    steamId = isHost ? HOST_ID : ACCEPTED_PEER_ID,
    hostSteamId = HOST_ID,
    mockMode = true,
} = {}) {
    const network = new SteamNetworking();
    network.initialized = true;
    network.mockMode = mockMode;
    network.steamId = steamId;
    network.playerName = steamId;
    network.isHost = isHost;
    network.hostSteamId = hostSteamId;
    network.currentLobbyId = MATCH_ID;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.sendP2PMessage = vi.fn();
    return network;
}

function makeEnvelope(network, messageType, {
    envelopeVersion = network.envelopeVersion,
    protocolVersion = network.getNegotiatedProtocolVersion(),
    seq = 1,
    payload = { marker: messageType },
    matchId = network.matchId,
    matchNonce = network.matchNonce,
    hostSteamId = network.hostSteamId,
} = {}) {
    return {
        envelopeVersion,
        msgType: messageType,
        matchId,
        matchNonce,
        hostSteamId,
        channel: 0,
        seq,
        tick: 42,
        sentAt: 1_000 + seq,
        protocolVersion,
        payload,
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

describe('SteamNetworking negotiated protocol-session admission', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe.each(INGRESS_MODES)('%s ingress', (mode) => {
        it('denies a non-bootstrap packet before the sender completes negotiation', () => {
            const network = makeNetwork({ mockMode: mode === 'mock' });
            network.lockProtocolSession(CURRENT_PROTOCOL_VERSION);
            const handler = vi.fn();
            network.on(MessageTypes.GAME_INPUT_BATCH, handler);

            deliver(
                network,
                makeEnvelope(network, MessageTypes.GAME_INPUT_BATCH, {
                    payload: { inputs: [] },
                }),
                UNACCEPTED_PEER_ID,
                mode,
            );

            expect(handler).not.toHaveBeenCalled();
            expect(network.connectedPeers.has(UNACCEPTED_PEER_ID)).toBe(false);
            expect(network.getPacketStats()).toMatchObject({
                received: 0,
                validationFailures: 1,
                roleValidationDropsByType: {
                    [MessageTypes.GAME_INPUT_BATCH]: 1,
                },
            });
        });

        it('keeps HELLO readable across protocol and envelope-version mismatch', () => {
            const network = makeNetwork({ mockMode: mode === 'mock' });
            network.lockProtocolSession(CURRENT_PROTOCOL_VERSION);
            const handler = vi.fn();
            network.on(MessageTypes.NET_HELLO, handler);

            deliver(
                network,
                makeEnvelope(network, MessageTypes.NET_HELLO, {
                    envelopeVersion: network.envelopeVersion + 99,
                    protocolVersion: '999.0.0',
                    payload: {
                        protocolVersion: '999.0.0',
                        minVersion: '999.0.0',
                        maxVersion: '999.0.0',
                    },
                }),
                UNACCEPTED_PEER_ID,
                mode,
            );

            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                from: UNACCEPTED_PEER_ID,
                type: MessageTypes.NET_HELLO,
                protocolVersion: '999.0.0',
                envelopeVersion: network.envelopeVersion + 99,
            }));
            expect(network.connectedPeers.has(UNACCEPTED_PEER_ID)).toBe(true);
        });

        it('drops a non-bootstrap packet stamped with the wrong established version', () => {
            const network = makeNetwork({ mockMode: mode === 'mock' });
            network.setNegotiatedProtocol(ACCEPTED_PEER_ID, CURRENT_PROTOCOL_VERSION);
            const handler = vi.fn();
            network.on(MessageTypes.GAME_INPUT_BATCH, handler);

            deliver(
                network,
                makeEnvelope(network, MessageTypes.GAME_INPUT_BATCH, {
                    protocolVersion: '999.0.0',
                    payload: { inputs: [] },
                }),
                ACCEPTED_PEER_ID,
                mode,
            );

            expect(handler).not.toHaveBeenCalled();
            expect(network.sendP2PMessage).toHaveBeenCalledWith(
                ACCEPTED_PEER_ID,
                MessageTypes.NET_ERROR,
                expect.objectContaining({
                    code: 'PROTOCOL_MISMATCH',
                    originalMsgType: MessageTypes.GAME_INPUT_BATCH,
                }),
            );
            expect(network.getPacketStats().validationFailures).toBe(1);
        });

        it('rejects a replayed WELCOME before dispatching it a second time', () => {
            const network = makeNetwork({
                isHost: false,
                steamId: ACCEPTED_PEER_ID,
                mockMode: mode === 'mock',
            });
            const handler = vi.fn((message) => {
                network.setNegotiatedProtocol(HOST_ID, message.data.selectedVersion);
            });
            network.on(MessageTypes.NET_WELCOME, handler);
            const welcome = makeEnvelope(network, MessageTypes.NET_WELCOME, {
                envelopeVersion: network.envelopeVersion + 1,
                protocolVersion: '999.0.0',
                seq: 7,
                payload: {
                    accepted: true,
                    selectedVersion: CURRENT_PROTOCOL_VERSION,
                },
            });

            deliver(network, welcome, HOST_ID, mode);
            deliver(network, welcome, HOST_ID, mode);

            expect(handler).toHaveBeenCalledOnce();
            expect(network.hasNegotiatedProtocol(HOST_ID)).toBe(true);
            expect(network.sessionProtocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
            expect(network.getPacketStats()).toMatchObject({
                received: 1,
                validationFailures: 1,
            });
        });
    });

    it.each(['mock', 'p2p'])('targets only accepted peers during a %s host broadcast', (mode) => {
        const network = makeNetwork({ mockMode: mode === 'mock' });
        network.connectedPeers.set(ACCEPTED_PEER_ID, { steamId: ACCEPTED_PEER_ID });
        network.connectedPeers.set(UNACCEPTED_PEER_ID, { steamId: UNACCEPTED_PEER_ID });
        network.setNegotiatedProtocol(ACCEPTED_PEER_ID, CURRENT_PROTOCOL_VERSION);
        network._sendEnvelope = vi.fn();

        network.broadcastToAll(MessageTypes.GAME_ROUND_START, { roundGeneration: 3 });

        expect(network._sendEnvelope).toHaveBeenCalledOnce();
        expect(network._sendEnvelope).toHaveBeenCalledWith(
            ACCEPTED_PEER_ID,
            MessageTypes.GAME_ROUND_START,
            expect.objectContaining({
                protocolVersion: CURRENT_PROTOCOL_VERSION,
                payload: { roundGeneration: 3 },
            }),
            expect.any(Object),
        );
    });

    it('clears negotiated admission and replay state even when leaveLobby has no live lobby', () => {
        const network = makeNetwork();
        network.setNegotiatedProtocol(ACCEPTED_PEER_ID, CURRENT_PROTOCOL_VERSION);
        network.connectedPeers.set(ACCEPTED_PEER_ID, { steamId: ACCEPTED_PEER_ID });
        network.sendSeqByChannel.set(0, 8);
        network.recvSeqByPeer.set(`${ACCEPTED_PEER_ID}:0`, 7);
        network.currentLobbyId = null;

        network.leaveLobby();

        expect(network.sessionProtocolVersion).toBeNull();
        expect(network.acceptedProtocolPeers.size).toBe(0);
        expect(network.connectedPeers.size).toBe(0);
        expect(network.sendSeqByChannel.size).toBe(0);
        expect(network.recvSeqByPeer.size).toBe(0);
        expect(network.matchId).toBeNull();
        expect(network.matchNonce).toBeNull();
        expect(network.hostSteamId).toBeNull();
        expect(network.isHost).toBe(false);
    });
});
