import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const REMOTE_PEER_ID = 'REMOTE_PEER';
const MATCH_ID = 'handler-lifecycle-match';
const MATCH_NONCE = 'handler-lifecycle-nonce';

function installMinimalDom() {
    vi.stubGlobal('document', {
        activeElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => null),
    });
}

function makeSharedHostNetwork() {
    const network = new SteamNetworking();
    network.initialized = true;
    network.steamId = HOST_ID;
    network.playerName = 'Host';
    network.isHost = true;
    network.hostSteamId = HOST_ID;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.sendP2PMessage = vi.fn();
    network.broadcastToAll = vi.fn();
    network.broadcastSnapshot = vi.fn();
    network.setLobbyPlayerCount = vi.fn();
    network.setLobbyStatus = vi.fn();
    network.lockProtocolSession();
    network.seedNegotiatedProtocolPeers([REMOTE_PEER_ID]);
    return network;
}

function countHandlers(network) {
    return Array.from(network.messageHandlers.values())
        .reduce((total, handlers) => total + handlers.length, 0);
}

function deliverInputBatch(network, seq) {
    network.handleP2PPacket({
        steamId: REMOTE_PEER_ID,
        data: {
            envelopeVersion: network.envelopeVersion,
            msgType: MessageTypes.GAME_INPUT_BATCH,
            matchId: network.matchId,
            matchNonce: network.matchNonce,
            hostSteamId: network.hostSteamId,
            channel: 0,
            seq,
            tick: seq,
            sentAt: 1_000 + seq,
            protocolVersion: network.protocolVersion,
            payload: {
                inputs: [{
                    type: 'move',
                    data: { direction: -1 },
                    seq,
                    timestamp: 1_000 + seq,
                }],
            },
        },
    }, 0);
}

let activeStates = [];

describe('FFAGameStateP2P network handler ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        installMinimalDom();
        activeStates = [];
    });

    afterEach(() => {
        activeStates.forEach((state) => {
            state.cleanup?.();
            state.chat?.destroy?.();
        });
        activeStates = [];
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('unregisters only the cleaned-up instance on a shared network', () => {
        const network = makeSharedHostNetwork();
        const unrelatedHandler = vi.fn();
        network.on(MessageTypes.NET_ERROR, unrelatedHandler);
        const baselineHandlerCount = countHandlers(network);

        const first = new FFAGameStateP2P(network, 'STATE_A');
        activeStates.push(first);
        first.stopHeartbeatLoop();
        first.processInputBatch = vi.fn();
        const handlersPerState = countHandlers(network) - baselineHandlerCount;
        expect(handlersPerState).toBeGreaterThan(0);

        const second = new FFAGameStateP2P(network, 'STATE_B');
        activeStates.push(second);
        second.stopHeartbeatLoop();
        second.processInputBatch = vi.fn();
        expect(countHandlers(network)).toBe(baselineHandlerCount + handlersPerState * 2);

        deliverInputBatch(network, 1);
        expect(first.processInputBatch).toHaveBeenCalledOnce();
        expect(second.processInputBatch).toHaveBeenCalledOnce();

        first.cleanup();
        expect(countHandlers(network)).toBe(baselineHandlerCount + handlersPerState);

        deliverInputBatch(network, 2);
        expect(first.processInputBatch).toHaveBeenCalledOnce();
        expect(second.processInputBatch).toHaveBeenCalledTimes(2);

        first.cleanup();
        expect(countHandlers(network)).toBe(baselineHandlerCount + handlersPerState);

        deliverInputBatch(network, 3);
        expect(first.processInputBatch).toHaveBeenCalledOnce();
        expect(second.processInputBatch).toHaveBeenCalledTimes(3);

        second.cleanup();
        expect(countHandlers(network)).toBe(baselineHandlerCount);

        deliverInputBatch(network, 4);
        expect(first.processInputBatch).toHaveBeenCalledOnce();
        expect(second.processInputBatch).toHaveBeenCalledTimes(3);
        expect(network.messageHandlers.get(MessageTypes.NET_ERROR)).toEqual([unrelatedHandler]);
    });
});
