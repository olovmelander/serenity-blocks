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
import {
    createNetworkHandlerRegistry,
} from '../../src/core/multiplayer/ffa/network-handler-registry.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const MATCH_ID = 'protocol-default-deny-match';
const MATCH_NONCE = 'protocol-default-deny-nonce';
const UNKNOWN_MESSAGE_TYPE = 'game:test:undeclared';

const EXPECTED_UNSUPPORTED = Object.freeze([
    MessageTypes.LOBBY_CONFIG_UPDATE,
    MessageTypes.LOBBY_MATCH_CONFIG,
    MessageTypes.GAME_INPUT_MOVE,
    MessageTypes.GAME_INPUT_ROTATE,
    MessageTypes.GAME_INPUT_DROP,
    MessageTypes.GAME_INPUT_ACK,
    MessageTypes.GAME_STATE_DELTA,
    MessageTypes.GAME_PIECE_LOCK,
    MessageTypes.GAME_HOST_MIGRATION_ELECT,
    MessageTypes.LEGACY_HOST_MIGRATED,
    MessageTypes.LEGACY_HOST_HANDOFF,
]);

const REJECTED_MESSAGE_TYPES = Object.freeze([
    ['undeclared', UNKNOWN_MESSAGE_TYPE],
    ['known unsupported', MessageTypes.GAME_STATE_DELTA],
    ['retired direct move', MessageTypes.GAME_INPUT_MOVE],
    ['retired direct rotate', MessageTypes.GAME_INPUT_ROTATE],
    ['retired direct drop', MessageTypes.GAME_INPUT_DROP],
]);

function makeNetwork() {
    const network = new SteamNetworking();
    network.steamId = PEER_ID;
    network.isHost = false;
    network.hostSteamId = HOST_ID;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    return network;
}

function makeEnvelope(network, messageType) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: messageType,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId: network.hostSteamId,
        channel: 0,
        seq: 1,
        tick: 42,
        sentAt: 1_000,
        protocolVersion: network.protocolVersion,
        payload: { marker: messageType },
    };
}

function deliver(network, envelope, mode) {
    if (mode === 'mock') {
        network.handleMockP2PMessage({
            ...envelope,
            from: HOST_ID,
            to: PEER_ID,
        });
        return;
    }

    network.handleP2PPacket({ steamId: HOST_ID, data: envelope }, envelope.channel);
}

describe('complete protocol catalog', () => {
    it('has unique wire values and exactly one catalog entry for every MessageTypes value', () => {
        const values = Object.values(MessageTypes);

        expect(new Set(values).size, 'MessageTypes wire values must be unique').toBe(values.length);
        expect(Object.keys(PROTOCOL_CATALOG).sort()).toEqual([...values].sort());
    });

    it('keeps the staged unsupported set explicit and reasoned', () => {
        const unsupported = Object.entries(PROTOCOL_CATALOG)
            .filter(([, entry]) => entry.status === 'unsupported')
            .map(([messageType]) => messageType)
            .sort();

        expect(unsupported).toEqual([...EXPECTED_UNSUPPORTED].sort());
        for (const messageType of unsupported) {
            const entry = PROTOCOL_CATALOG[messageType];
            expect(entry.status).toBe('unsupported');
            expect(entry.reason.trim().length).toBeGreaterThan(0);
            expect('routes' in entry).toBe(false);
        }
    });

    it('gives every supported type one or more valid, non-duplicated route tuples', () => {
        const senderRoles = new Set(['host', 'peer', 'successor']);
        const receiverRoles = new Set(['host', 'peer']);

        for (const [messageType, entry] of Object.entries(PROTOCOL_CATALOG)) {
            if (entry.status !== 'supported') continue;

            expect(entry.routes.length, `${messageType} must declare at least one route`).toBeGreaterThan(0);
            const routeKeys = entry.routes.map((route) => `${route.sender}->${route.receiver}`);
            expect(new Set(routeKeys).size, `${messageType} has a duplicate route`).toBe(routeKeys.length);

            for (const route of entry.routes) {
                expect(Object.keys(route).sort()).toEqual(['receiver', 'sender']);
                expect(senderRoles.has(route.sender), `${messageType} has an invalid sender role`).toBe(true);
                expect(receiverRoles.has(route.receiver), `${messageType} has an invalid receiver role`).toBe(true);
            }
        }
    });
});

describe('protocol default-deny boundaries', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe.each(['mock', 'p2p'])('%s ingress', (mode) => {
        it.each(REJECTED_MESSAGE_TYPES)(
            'rejects an %s type before dispatch or peer tracking',
            (_label, messageType) => {
                const network = makeNetwork();
                const handler = vi.fn();
                // Bypass the registration guard so this test proves inbound validation
                // itself runs before dispatch, not merely that registration was denied.
                network.messageHandlers.set(messageType, [handler]);

                deliver(network, makeEnvelope(network, messageType), mode);

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
            },
        );
    });

    it.each(REJECTED_MESSAGE_TYPES)('rejects an %s type before outbound envelope delivery', (_label, messageType) => {
        const network = makeNetwork();
        network._sendEnvelope = vi.fn();

        expect(network.sendP2PMessage(HOST_ID, messageType, { marker: messageType })).toBe(false);
        expect(network._sendEnvelope).not.toHaveBeenCalled();
        expect(network.getPacketStats()).toMatchObject({
            sent: 0,
            sendFailures: 1,
        });
    });

    it.each(REJECTED_MESSAGE_TYPES)('rejects an %s type at SteamNetworking.on', (_label, messageType) => {
        const network = makeNetwork();
        const handler = vi.fn();

        expect(network.on(messageType, handler)).toBe(false);
        expect(network.messageHandlers.has(messageType)).toBe(false);
    });

    it.each(REJECTED_MESSAGE_TYPES)('rejects an %s type at NetworkHandlerRegistry.register', (_label, messageType) => {
        const network = makeNetwork();
        const registry = createNetworkHandlerRegistry(network);
        const handler = vi.fn();

        expect(() => registry.register(messageType, handler)).toThrow(/unsupported message type/i);
        expect(registry.size).toBe(0);
        expect(network.messageHandlers.has(messageType)).toBe(false);
    });
});
