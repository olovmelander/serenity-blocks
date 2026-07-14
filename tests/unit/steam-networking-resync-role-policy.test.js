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
const OTHER_PEER_ID = 'OTHER_PEER';
const MATCH_ID = 'role-policy-match';
const MATCH_NONCE = 'role-policy-nonce';

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
    network.seedNegotiatedProtocolPeers([
        HOST_ID,
        OLD_HOST_ID,
        NEW_HOST_ID,
        PEER_ID,
        OTHER_PEER_ID,
    ]);
    return network;
}

function makeEnvelope(network, type, {
    hostSteamId = network.hostSteamId,
    payload = { resyncId: 'R1' },
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
        tick: null,
        sentAt: 1_000 + seq,
        protocolVersion: network.protocolVersion,
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

describe('SteamNetworking staged resync role policy', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['p2p', 'mock'])('lets a peer accept host resync on the %s ingress path', (mode) => {
        const network = makeNetwork();
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC),
            HOST_ID,
            mode,
        );

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            from: HOST_ID,
            type: MessageTypes.GAME_STATE_RESYNC,
            data: { resyncId: 'R1' },
        }));
        expect(network.getPacketStats()).toMatchObject({
            received: 1,
            validationFailures: 0,
            roleValidationDropsByType: {},
        });
    });

    it.each(['p2p', 'mock'])('rejects non-host resync on the %s ingress path', (mode) => {
        const network = makeNetwork();
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC),
            OTHER_PEER_ID,
            mode,
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.connectedPeers.has(OTHER_PEER_ID)).toBe(false);
        expect(network.getPacketStats()).toMatchObject({
            received: 0,
            validationFailures: 1,
            roleValidationDropsByType: {
                [MessageTypes.GAME_STATE_RESYNC]: 1,
            },
        });
    });

    it('rejects resync while the peer has not resolved a host', () => {
        const network = makeNetwork({ hostSteamId: null });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC),
            HOST_ID,
            'mock',
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.getPacketStats().roleValidationDropsByType).toEqual({
            [MessageTypes.GAME_STATE_RESYNC]: 1,
        });
    });

    it('rejects host-side resync because the staged receiver is peer-only', () => {
        const network = makeNetwork({ steamId: HOST_ID, isHost: true });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC),
            HOST_ID,
            'p2p',
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.getPacketStats().roleValidationDropsByType).toEqual({
            [MessageTypes.GAME_STATE_RESYNC]: 1,
        });
    });

    it.each(['p2p', 'mock'])('lets the host accept a peer resync ACK on the %s ingress path', (mode) => {
        const network = makeNetwork({ steamId: HOST_ID, isHost: true });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC_ACK, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC_ACK, {
                payload: { resyncId: 'R1', chunkIndex: 0 },
            }),
            PEER_ID,
            mode,
        );

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            from: PEER_ID,
            data: { resyncId: 'R1', chunkIndex: 0 },
        }));
        expect(network.getPacketStats()).toMatchObject({
            received: 1,
            validationFailures: 0,
            roleValidationDropsByType: {},
        });
    });

    it('rejects a resync ACK received by a peer', () => {
        const network = makeNetwork();
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC_ACK, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC_ACK),
            OTHER_PEER_ID,
            'mock',
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.getPacketStats().roleValidationDropsByType).toEqual({
            [MessageTypes.GAME_STATE_RESYNC_ACK]: 1,
        });
    });

    it.each(['p2p', 'mock'])('drops a staged message with no sender on the %s ingress path', (mode) => {
        const network = makeNetwork({ steamId: HOST_ID, isHost: true });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC_ACK, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC_ACK),
            undefined,
            mode,
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.connectedPeers.has(undefined)).toBe(false);
        expect(network.getPacketStats()).toMatchObject({
            received: 0,
            validationFailures: 1,
            roleValidationDropsByType: {
                [MessageTypes.GAME_STATE_RESYNC_ACK]: 1,
            },
        });
    });

    it('keeps independent per-type role-drop counters', () => {
        const network = makeNetwork();

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC, { seq: 1 }),
            OTHER_PEER_ID,
            'p2p',
        );
        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC, { seq: 2 }),
            OTHER_PEER_ID,
            'p2p',
        );
        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC_ACK, { seq: 3 }),
            OTHER_PEER_ID,
            'mock',
        );

        expect(network.getPacketStats()).toMatchObject({
            validationFailures: 3,
            roleValidationDropsByType: {
                [MessageTypes.GAME_STATE_RESYNC]: 2,
                [MessageTypes.GAME_STATE_RESYNC_ACK]: 1,
            },
        });
    });

    it('switches resync authority immediately when host ID changes from old to new', () => {
        const network = makeNetwork({ hostSteamId: OLD_HOST_ID });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_STATE_RESYNC, handler);

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC, {
                hostSteamId: OLD_HOST_ID,
                payload: { source: 'old-before-migration' },
                seq: 1,
            }),
            OLD_HOST_ID,
            'p2p',
        );

        network.hostSteamId = NEW_HOST_ID;

        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC, {
                hostSteamId: NEW_HOST_ID,
                payload: { source: 'old-after-migration' },
                seq: 2,
            }),
            OLD_HOST_ID,
            'mock',
        );
        deliver(
            network,
            makeEnvelope(network, MessageTypes.GAME_STATE_RESYNC, {
                hostSteamId: NEW_HOST_ID,
                payload: { source: 'new-after-migration' },
                seq: 1,
            }),
            NEW_HOST_ID,
            'mock',
        );

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls.map(([message]) => [message.from, message.data.source])).toEqual([
            [OLD_HOST_ID, 'old-before-migration'],
            [NEW_HOST_ID, 'new-after-migration'],
        ]);
        expect(network.getPacketStats().roleValidationDropsByType).toEqual({
            [MessageTypes.GAME_STATE_RESYNC]: 1,
        });
    });
});
