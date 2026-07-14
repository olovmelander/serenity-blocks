import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import {
    registerJoinHandshakeHandlers,
} from '../../src/core/multiplayer/ffa/join-handshake.js';
import {
    createJoinState,
    isJoinHandshakeComplete,
    JOIN_LIFECYCLE_STATES,
} from '../../src/core/multiplayer/ffa/join-lifecycle.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import {
    acceptsProtocolSelection,
    negotiateProtocolVersion,
    PROTOCOL_REJECTION_REASONS,
} from '../../src/core/network/protocol-version.js';
import {
    MULTIPLAYER_EVENTS,
    onMultiplayerEvent,
} from '../../src/events/multiplayer-events.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const MATCH_ID = 'match-1';
const MATCH_NONCE = 'nonce-1';
const HANDSHAKE_NONCE = 'join-attempt-1';
const PROTOCOL_VERSION = '1.0.0';
const ENVELOPE_VERSION = 1;

function captureHandlers() {
    const handlers = new Map();
    return {
        handlers,
        register: vi.fn((messageType, handler) => {
            handlers.set(messageType, handler);
            return handler;
        }),
    };
}

function makeNetwork(overrides = {}) {
    const acceptedPeers = new Set();
    const offer = {
        minVersion: PROTOCOL_VERSION,
        maxVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        minEnvelopeVersion: ENVELOPE_VERSION,
        maxEnvelopeVersion: ENVELOPE_VERSION,
    };
    const network = {
        steamId: HOST_ID,
        isHost: true,
        hostSteamId: HOST_ID,
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        matchId: MATCH_ID,
        matchNonce: MATCH_NONCE,
        getProtocolOffer: vi.fn(() => ({ ...offer })),
        lockProtocolSession: vi.fn(() => true),
        negotiateProtocol: vi.fn((remoteOffer) => negotiateProtocolVersion(remoteOffer)),
        acceptsProtocolSelection: vi.fn((selection, localOffer) => (
            acceptsProtocolSelection(selection, localOffer)
        )),
        setNegotiatedProtocol: vi.fn((steamId, version) => {
            if (!steamId || version !== PROTOCOL_VERSION) return false;
            acceptedPeers.add(steamId);
            return true;
        }),
        clearNegotiatedProtocol: vi.fn((steamId) => acceptedPeers.delete(steamId)),
        hasNegotiatedProtocol: vi.fn((steamId) => acceptedPeers.has(steamId)),
        sendP2PMessage: vi.fn(),
        ...overrides,
    };
    return { network, acceptedPeers, offer };
}

function makeHostGame(overrides = {}) {
    const { network, acceptedPeers, offer } = makeNetwork();
    const game = {
        isHost: true,
        _disposed: false,
        localPlayerId: HOST_ID,
        network,
        players: new Map([[HOST_ID, { steamId: HOST_ID, name: 'Host' }]]),
        spectators: new Set(),
        matchConfig: { maxPlayers: 8 },
        addPlayer: vi.fn(() => true),
        queueResync: vi.fn(),
        broadcastPlayerList: vi.fn(),
        _registerSpectator: vi.fn(),
        ...overrides,
    };
    return {
        game, network, acceptedPeers, offer,
    };
}

function makePeerGame(overrides = {}) {
    const { network, acceptedPeers, offer } = makeNetwork({
        steamId: PEER_ID,
        isHost: false,
        hostSteamId: HOST_ID,
        matchId: null,
        matchNonce: null,
    });
    const game = {
        isHost: false,
        _disposed: false,
        joinState: createJoinState(),
        get handshakeComplete() { return isJoinHandshakeComplete(this.joinState); },
        _announceTimer: null,
        _lastJoinRejection: null,
        _joinHandshakeNonce: HANDSHAKE_NONCE,
        _lastJoinProtocolOffer: { ...offer },
        network,
        ...overrides,
    };
    return {
        game, network, acceptedPeers, offer,
    };
}

function registerFor(game) {
    const registry = captureHandlers();
    registerJoinHandshakeHandlers(game, registry);
    return registry.handlers;
}

function hello(data = {}) {
    return {
        from: PEER_ID,
        protocolVersion: data.protocolVersion ?? PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        data: {
            protocolVersion: PROTOCOL_VERSION,
            envelopeVersion: ENVELOPE_VERSION,
            handshakeNonce: HANDSHAKE_NONCE,
            ...data,
        },
    };
}

function welcome(data = {}) {
    return {
        from: HOST_ID,
        protocolVersion: data.protocolVersion ?? PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        data: {
            accepted: true,
            protocolVersion: PROTOCOL_VERSION,
            selectedVersion: PROTOCOL_VERSION,
            envelopeVersion: ENVELOPE_VERSION,
            matchId: MATCH_ID,
            matchNonce: MATCH_NONCE,
            hostSteamId: HOST_ID,
            handshakeNonce: HANDSHAKE_NONCE,
            ...data,
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('FFA join handshake', () => {
    it('sends WELCOME before admitting a new player, broadcasting its roster, or queuing resync', () => {
        const order = [];
        const { game, network, acceptedPeers } = makeHostGame();
        network.sendP2PMessage = vi.fn((_steamId, messageType) => order.push(messageType));
        game.addPlayer = vi.fn(() => {
            order.push('roster');
            game.players.set(PEER_ID, { steamId: PEER_ID, name: 'Peer' });
            return true;
        });
        game.queueResync = vi.fn(() => order.push('resync'));
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_HELLO)(hello({ name: 'Peer' }));

        expect(order).toEqual([MessageTypes.NET_WELCOME, 'roster', 'resync']);
        expect(network.sendP2PMessage).toHaveBeenNthCalledWith(
            1,
            PEER_ID,
            MessageTypes.NET_WELCOME,
            expect.objectContaining({
                accepted: true,
                reason: 'ok',
                selectedVersion: PROTOCOL_VERSION,
                matchId: MATCH_ID,
                matchNonce: MATCH_NONCE,
                hostSteamId: HOST_ID,
                handshakeNonce: HANDSHAKE_NONCE,
            }),
        );
        expect(acceptedPeers.has(PEER_ID)).toBe(true);
    });

    it.each([
        ['malformed', { protocolVersion: 'not-semver' }],
        ['incompatible', { protocolVersion: '2.0.0' }],
    ])('rejects a %s new-player offer without mutating the roster or resync state', (_label, data) => {
        const { game, network, acceptedPeers } = makeHostGame();
        const rosterBefore = Array.from(game.players.entries());
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_HELLO)(hello(data));

        expect(Array.from(game.players.entries())).toEqual(rosterBefore);
        expect(game.addPlayer).not.toHaveBeenCalled();
        expect(game.broadcastPlayerList).not.toHaveBeenCalled();
        expect(game.queueResync).not.toHaveBeenCalled();
        expect(game._registerSpectator).not.toHaveBeenCalled();
        expect(acceptedPeers.has(PEER_ID)).toBe(false);
        expect(network.sendP2PMessage.mock.calls.map(([, type]) => type)).toEqual([
            MessageTypes.NET_WELCOME,
            MessageTypes.JOIN_REJECTED,
        ]);
        expect(network.sendP2PMessage).toHaveBeenNthCalledWith(
            1,
            PEER_ID,
            MessageTypes.NET_WELCOME,
            expect.objectContaining({ accepted: false, selectedVersion: null }),
            expect.any(Object),
        );
    });

    it('leaves a disconnected player and its grace timer untouched after an incompatible rejoin', () => {
        const disconnectTimeout = setTimeout(vi.fn(), 10_000);
        const disconnected = {
            steamId: PEER_ID,
            name: 'Peer',
            isDisconnected: true,
            disconnectTimeout,
        };
        const { game, network } = makeHostGame({
            players: new Map([
                [HOST_ID, { steamId: HOST_ID, name: 'Host' }],
                [PEER_ID, disconnected],
            ]),
        });
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_HELLO)(hello({ protocolVersion: '2.0.0' }));

        expect(game.players.get(PEER_ID)).toBe(disconnected);
        expect(disconnected).toMatchObject({
            isDisconnected: true,
            disconnectTimeout,
        });
        expect(game.broadcastPlayerList).not.toHaveBeenCalled();
        expect(game.queueResync).not.toHaveBeenCalled();
        expect(network.sendP2PMessage.mock.calls.map(([, type]) => type)).toEqual([
            MessageTypes.NET_WELCOME,
            MessageTypes.JOIN_REJECTED,
        ]);
    });

    it('fences a live reconnect before queuing its authoritative snapshot', () => {
        const disconnectTimeout = setTimeout(vi.fn(), 10_000);
        const disconnected = {
            steamId: PEER_ID,
            name: 'Peer',
            isAlive: true,
            isDisconnected: true,
            disconnectTimeout,
            lastInputSeq: 12,
        };
        const { game, network } = makeHostGame({
            gamePhase: 'playing',
            roundGeneration: 6,
            players: new Map([
                [HOST_ID, { steamId: HOST_ID, name: 'Host' }],
                [PEER_ID, disconnected],
            ]),
            hostResyncInputBarriers: new Map(),
            pendingResyncs: [],
            _recordNetEvent: vi.fn(),
        });
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_HELLO)(hello());

        expect(disconnected).toMatchObject({
            isDisconnected: false,
            disconnectTimeout: null,
        });
        expect(game.queueResync).not.toHaveBeenCalled();
        expect(network.sendP2PMessage.mock.calls.map(([, type]) => type)).toEqual([
            MessageTypes.NET_WELCOME,
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
        ]);
        expect(network.sendP2PMessage).toHaveBeenNthCalledWith(
            2,
            PEER_ID,
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({
                roundGeneration: 6,
                inputFencePlayerId: PEER_ID,
            }),
        );
        expect(game.hostResyncInputBarriers.get(PEER_ID)).toMatchObject({
            status: 'prepare',
            reason: 'reconnect',
        });
    });

    it('ignores the legacy LOBBY_PLAYER_JOINED admission path before negotiation', () => {
        const stub = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            localPlayerId: HOST_ID,
            network: {
                hostSteamId: HOST_ID,
                hasNegotiatedProtocol: vi.fn(() => false),
            },
            players: new Map([[HOST_ID, { steamId: HOST_ID, name: 'Host' }]]),
            addPlayer: vi.fn(),
            queueResync: vi.fn(),
            _registerSpectator: vi.fn(),
            _spoofDrops: 0,
        });

        stub._handleLobbyPlayerJoined({
            from: PEER_ID,
            data: { steamId: PEER_ID, name: 'Legacy peer' },
        });

        expect(stub.network.hasNegotiatedProtocol).toHaveBeenCalledWith(PEER_ID);
        expect(stub.addPlayer).not.toHaveBeenCalled();
        expect(stub.queueResync).not.toHaveBeenCalled();
        expect(stub._registerSpectator).not.toHaveBeenCalled();
        expect(stub._spoofDrops).toBe(1);
    });

    it('validates a selected version before adopting the negotiated session identity', () => {
        const { game, network, acceptedPeers } = makePeerGame();
        const announce = vi.fn();
        game._announceTimer = setTimeout(announce, 700);
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_WELCOME)(welcome());

        expect(network.acceptsProtocolSelection).toHaveBeenCalledWith(
            PROTOCOL_VERSION,
            game._lastJoinProtocolOffer,
        );
        expect(network.acceptsProtocolSelection.mock.results[0]?.value).toBe(true);
        expect(network.setNegotiatedProtocol).toHaveBeenCalledWith(HOST_ID, PROTOCOL_VERSION);
        expect(network.clearNegotiatedProtocol).not.toHaveBeenCalled();
        expect(acceptedPeers.has(HOST_ID)).toBe(true);
        expect(network.matchId).toBe(MATCH_ID);
        expect(network.matchNonce).toBe(MATCH_NONCE);
        expect(network.hostSteamId).toBe(HOST_ID);
        expect(game.handshakeComplete).toBe(true);
        expect(game.joinState).toBe(JOIN_LIFECYCLE_STATES.WELCOMED);
        expect(game._announceTimer).toBe(null);
        vi.runAllTimers();
        expect(announce).not.toHaveBeenCalled();
    });

    it('does not adopt session fields from an invalid WELCOME selection', () => {
        const { game, network, acceptedPeers } = makePeerGame();
        const handlers = registerFor(game);

        handlers.get(MessageTypes.NET_WELCOME)(welcome({
            protocolVersion: '2.0.0',
            selectedVersion: '2.0.0',
            matchId: 'forged-match',
            matchNonce: 'forged-nonce',
        }));

        expect(acceptedPeers.has(HOST_ID)).toBe(false);
        expect(network.matchId).toBe(null);
        expect(network.matchNonce).toBe(null);
        expect(network.hostSteamId).toBe(HOST_ID);
        expect(game.handshakeComplete).toBe(false);
        expect(game.joinState).toBe(JOIN_LIFECYCLE_STATES.REJECTED);
        expect(game._lastJoinRejection).toBe(`${PROTOCOL_REJECTION_REASONS.INVALID_SELECTION}::`);
    });

    it('emits one terminal rejection and cancels retries across duplicate WELCOME/JOIN_REJECTED packets', () => {
        const { game } = makePeerGame();
        const announce = vi.fn();
        game._announceTimer = setTimeout(announce, 700);
        const handlers = registerFor(game);
        const rejections = [];
        const unsubscribe = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.JOIN_REJECTED,
            (payload) => rejections.push(payload),
        );
        const rejection = {
            accepted: false,
            reason: PROTOCOL_REJECTION_REASONS.MISMATCH,
            minVersion: PROTOCOL_VERSION,
            maxVersion: PROTOCOL_VERSION,
        };

        try {
            handlers.get(MessageTypes.NET_WELCOME)(welcome(rejection));
            handlers.get(MessageTypes.NET_WELCOME)(welcome(rejection));
            handlers.get(MessageTypes.JOIN_REJECTED)({ from: HOST_ID, data: rejection });
            handlers.get(MessageTypes.JOIN_REJECTED)({ from: HOST_ID, data: rejection });

            expect(rejections).toHaveLength(1);
            expect(rejections[0]).toMatchObject({
                reason: PROTOCOL_REJECTION_REASONS.MISMATCH,
                minVersion: PROTOCOL_VERSION,
                maxVersion: PROTOCOL_VERSION,
            });
            expect(game.handshakeComplete).toBe(false);
            expect(game.joinState).toBe(JOIN_LIFECYCLE_STATES.REJECTED);
            expect(game._announceTimer).toBe(null);
            vi.runAllTimers();
            expect(announce).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });
});
