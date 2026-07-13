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

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const UNKNOWN_ID = 'UNKNOWN';

function makeHandlerNetwork() {
    const handlers = new Map();
    return {
        handlers,
        hostSteamId: HOST_ID,
        on: vi.fn((messageType, handler) => {
            if (!handlers.has(messageType)) handlers.set(messageType, []);
            handlers.get(messageType).push(handler);
        }),
        off: vi.fn((messageType, handler) => {
            const registered = handlers.get(messageType) || [];
            const index = registered.indexOf(handler);
            if (index >= 0) registered.splice(index, 1);
        }),
    };
}

function makeHostState() {
    const state = Object.create(FFAGameStateP2P.prototype);
    state.network = makeHandlerNetwork();
    state.localPlayerId = HOST_ID;
    state.isHost = true;
    state._disposed = false;
    state.players = new Map();
    state.spectators = new Set();
    state.chatHistory = [];
    state.chat = { addMessage: vi.fn() };
    state.broadcastToPeers = vi.fn();
    state.setupNetworkHandlers();
    return state;
}

function dispatchChat(state, from, data) {
    const handlers = state.network.handlers.get(MessageTypes.GAME_CHAT) || [];
    expect(handlers).toHaveLength(1);
    handlers[0]({ from, data });
}

describe('FFAGameStateP2P chat identity binding', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects chat submitted by an unrostered sender', () => {
        const state = makeHostState();

        dispatchChat(state, UNKNOWN_ID, {
            steamId: HOST_ID,
            playerName: 'Forged Host',
            color: '#ffffff',
            message: 'spoof',
        });

        expect(state.chatHistory).toEqual([]);
        expect(state.chat.addMessage).not.toHaveBeenCalled();
        expect(state.broadcastToPeers).not.toHaveBeenCalled();
        state._networkHandlerRegistry.dispose();
    });

    it('binds peer chat identity to its roster entry before history and rebroadcast', () => {
        const state = makeHostState();
        state.players.set(PEER_ID, {
            steamId: PEER_ID,
            name: 'Canonical Peer',
            color: '#12ab34',
        });
        const spoofed = {
            steamId: HOST_ID,
            playerName: 'Forged Host',
            color: '#ffffff',
            message: 'hello',
            timestamp: 1234,
        };

        dispatchChat(state, PEER_ID, spoofed);

        const canonical = {
            steamId: PEER_ID,
            playerName: 'Canonical Peer',
            color: '#12ab34',
            message: 'hello',
            timestamp: 1234,
        };
        expect(spoofed).toEqual({
            steamId: HOST_ID,
            playerName: 'Forged Host',
            color: '#ffffff',
            message: 'hello',
            timestamp: 1234,
        });
        expect(state.chatHistory).toEqual([canonical]);
        expect(state.chat.addMessage).toHaveBeenCalledWith(canonical);
        expect(state.broadcastToPeers).toHaveBeenCalledWith(
            MessageTypes.GAME_CHAT,
            canonical,
            PEER_ID,
        );
        state._networkHandlerRegistry.dispose();
    });
});
