/**
 * What a modified client or host can no longer do with values the transport passes on:
 * make viewers fetch a URL through a colour, spoof names with invisible characters, grow
 * the host's memory with invented message types, flood everyone through rejoins, repeated
 * rematch votes or ready toggles, or freeze peers with an oversized lobby.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { capPeerText, MAX_NAME_CHARS, peerColor } from '../../src/core/network/peer-text.js';
import { adoptHostRoster } from '../../src/core/multiplayer/ffa/presence.js';
import { MAX_LOBBY_PLAYERS, mergeHostMatchConfig } from '../../src/core/multiplayer/ffa/host-match-config.js';
import { REJOIN_MIN_INTERVAL_MS, serveRejoin } from '../../src/core/multiplayer/ffa/join-handshake.js';
import { handleFfaChat } from '../../src/core/multiplayer/ffa/chat-relay.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('peer colours', () => {
    it.each(['#a78bfa', '#fff', '#00e67680'])('keeps the hex colour %s', (color) => {
        expect(peerColor(color)).toBe(color);
    });

    it.each([
        'url(https://example.invalid/x?u=76561198000000000)',
        'red',
        '#fff; background: url(x)',
        'var(--x)',
        '',
        42,
        null,
        { color: '#fff' },
    ])('refuses %j', (value) => {
        expect(peerColor(value)).toBeNull();
    });

    it('a roster colour that is not hex leaves the player\'s colour as it was', () => {
        const players = new Map([
            ['LOCAL', { color: '#2979ff' }],
            ['P2', { color: '#ff1744' }],
        ]);
        const game = { localPlayerId: 'LOCAL', players, addPlayer: vi.fn() };
        adoptHostRoster(game, [
            { steamId: 'LOCAL', color: '#2979ff' },
            { steamId: 'P2', color: 'url(https://example.invalid/beacon)' },
        ]);
        expect(players.get('P2').color).toBe('#ff1744');
        adoptHostRoster(game, [{ steamId: 'LOCAL' }, { steamId: 'P2', color: '#00e676' }]);
        expect(players.get('P2').color).toBe('#00e676');
    });

    it('a chat colour that is not hex is replaced by the author\'s roster colour', () => {
        const relayed = [];
        const game = {
            isHost: false,
            players: new Map([['P2', { name: 'Two', color: '#00e676' }]]),
            chatHistory: [],
            chat: { addMessage: (entry) => relayed.push(entry) },
        };
        handleFfaChat(game, {
            from: 'HOST',
            data: {
                message: 'hi', steamId: 'P2', playerName: 'Two', color: 'url(https://example.invalid/x)',
            },
        });
        expect(game.chatHistory.at(-1).color).toBe('#00e676');
    });
});

describe('peer names', () => {
    it('drops bidi overrides, isolates and zero-width spaces', () => {
        expect(capPeerText('Ali\u202Ece\u200B\u2066x\u2069', MAX_NAME_CHARS)).toBe('Alicex');
        expect(capPeerText('\uFEFFBob\u200F', MAX_NAME_CHARS)).toBe('Bob');
    });

    it('keeps joiners that emoji and scripts need', () => {
        const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
        expect(capPeerText(family, MAX_NAME_CHARS)).toBe(family);
        expect(capPeerText('\u0645\u06CC\u200C\u062E\u0648\u0627\u0645', MAX_NAME_CHARS)).toContain('\u200C');
    });
});

describe('a lobby of at most eight players', () => {
    it('clamps the seat count a host sends into 2 to 8', () => {
        expect(mergeHostMatchConfig({ mode: 'ffa' }, { maxPlayers: 1e8 })).toEqual({ mode: 'ffa', maxPlayers: 8 });
        expect(mergeHostMatchConfig({}, { maxPlayers: 1 }).maxPlayers).toBe(2);
        expect(mergeHostMatchConfig({}, { maxPlayers: '4' }).maxPlayers).toBe(4);
        expect(mergeHostMatchConfig({}, { maxPlayers: 'many' }).maxPlayers).toBe(MAX_LOBBY_PLAYERS);
        expect(mergeHostMatchConfig({ endCondition: 'frags' }, null)).toEqual({ endCondition: 'frags' });
        expect(mergeHostMatchConfig({}, { endCondition: 'time' })).not.toHaveProperty('maxPlayers');
    });

    it('ignores a roster longer than a lobby seats', () => {
        const game = { localPlayerId: 'LOCAL', players: new Map(), addPlayer: vi.fn() };
        const list = Array.from({ length: MAX_LOBBY_PLAYERS + 1 }, (_, i) => ({ steamId: `P${i}` }));
        adoptHostRoster(game, list);
        expect(game.addPlayer).not.toHaveBeenCalled();
    });
});

describe('rejected message types', () => {
    it('keep a bounded count however many types a peer invents', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const net = new SteamNetworking();
        for (let i = 0; i < 500; i += 1) {
            net._rejectMessageRole(`${i}:${'x'.repeat(16 * 1024)}`, 'EVIL', 'unsupported or undeclared type');
        }
        const drops = net.packetStats.roleValidationDropsByType;
        expect(Object.keys(drops).length).toBeLessThanOrEqual(33);
        expect(Math.max(...Object.keys(drops).map((key) => key.length))).toBeLessThanOrEqual(64);
        expect(Object.values(drops).reduce((sum, count) => sum + count, 0)).toBe(500);
        expect(String(console.warn.mock.calls[0][0]).length).toBeLessThan(200);
    });
});

describe('the host serves a member\'s rejoins at most once per interval', () => {
    function host() {
        return {
            players: new Map([['P2', {}]]),
            spectators: new Map(),
            broadcastPlayerList: vi.fn(),
            queueResync: vi.fn(),
            isHost: true,
        };
    }

    it('folds a burst of rejoins into one now and one when the interval ends', () => {
        vi.useFakeTimers();
        const game = host();
        for (let i = 0; i < 50; i += 1) serveRejoin(game, 'P2');
        expect(game.broadcastPlayerList).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(REJOIN_MIN_INTERVAL_MS);
        expect(game.broadcastPlayerList).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(REJOIN_MIN_INTERVAL_MS * 5);
        expect(game.broadcastPlayerList).toHaveBeenCalledTimes(2);
    });

    it('drops a deferred rejoin for a member who has left', () => {
        vi.useFakeTimers();
        const game = host();
        serveRejoin(game, 'P2');
        serveRejoin(game, 'P2');
        game.players.delete('P2');
        vi.advanceTimersByTime(REJOIN_MIN_INTERVAL_MS);
        expect(game.broadcastPlayerList).toHaveBeenCalledTimes(1);
    });
});

describe('votes and ready toggles that change nothing are not re-broadcast', () => {
    function hostWithHandlers() {
        const handlers = new Map();
        const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            localPlayerId: 'HOST',
            players: new Map([['HOST', { name: 'Host', isReady: false }], ['P2', { name: 'Two', isReady: false }]]),
            spectators: new Map(),
            rematchVotes: new Set(),
            gamePhase: 'finished',
            network: { hostSteamId: 'HOST', on: (type, handler) => handlers.set(type, handler) },
        });
        game.broadcastRematchStatus = vi.fn();
        game.checkRematchThreshold = vi.fn();
        game.setupNetworkHandlers();
        return { game, handlers };
    }

    it('a repeated rematch vote', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { game, handlers } = hostWithHandlers();
        const vote = handlers.get(MessageTypes.GAME_REMATCH_VOTE);
        for (let i = 0; i < 20; i += 1) vote({ from: 'P2', data: {} });
        expect(game.broadcastRematchStatus).toHaveBeenCalledTimes(1);
    });

    it('a ready toggle to the state it already has, and a non-boolean ready', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { game } = hostWithHandlers();
        game._handleLobbyPlayerReady({ from: 'P2', data: { steamId: 'P2', isReady: 'yes' } });
        expect(game.players.get('P2').isReady).toBe(false);
        game._handleLobbyPlayerReady({ from: 'P2', data: { steamId: 'P2', isReady: true } });
        expect(game.players.get('P2').isReady).toBe(true);
    });
});
