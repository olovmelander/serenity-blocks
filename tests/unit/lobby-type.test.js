/**
 * Who can find and join an online match (src/core/multiplayer/lobby-type.js), and what follows
 * from it: "Join game" for friends, the words the create sheet uses, and the match's type as
 * the mode keeps it for chat and presence.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    DEFAULT_LOBBY_TYPE, LOBBY_TYPE_KEY, chatLobbyType, createdLobbyType, joinedLobbyType,
    lobbyOffersJoinToFriends, normalizeLobbyType,
} from '../../src/core/multiplayer/lobby-type.js';

const chat = vi.hoisted(() => ({ setChatLobbyType: vi.fn() }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/core/multiplayer/ffa-p2p-game-state.js', () => ({
    FFAGameStateP2P: class FFAGameStateP2P {
        constructor(network, localPlayerId, options = {}) {
            Object.assign(this, { network, localPlayerId, options, players: new Map() });
        }

        announceJoin() {}

        cleanup() {}
    },
}));
vi.mock('../../src/ui/chat-moderation.js', async (importOriginal) => ({
    ...await importOriginal(),
    setChatLobbyType: chat.setChatLobbyType,
}));
vi.mock('../../src/ui/online-play-notice.js', async (importOriginal) => ({
    ...await importOriginal(),
    hasSeenOnlinePlayNotice: () => true,
}));

const { OnlineMultiplayerMode } = await import('../../src/core/game-modes/OnlineMultiplayerMode.js');
const { default: steamService } = await import('../../src/core/steam/steam-service.js');
const { LOBBY_TYPE_HELP } = await import('../../src/ui/match-config-modal.js');

const source = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

describe('lobby types', () => {
    it('are public, friends and private; a new match is for friends', () => {
        expect(['public', 'friends', 'private'].map(normalizeLobbyType)).toEqual(['public', 'friends', 'private']);
        for (const value of [undefined, null, '', 'Public', 'invisible', 1]) {
            expect(normalizeLobbyType(value)).toBeNull();
        }
        expect(DEFAULT_LOBBY_TYPE).toBe('friends');
        expect(LOBBY_TYPE_KEY).toBe('lobby_type');
    });

    it('a match is created for friends when nothing is chosen, and private for anything unknown', () => {
        expect(createdLobbyType(undefined)).toBe('friends');
        expect(['public', 'friends', 'private'].map(createdLobbyType)).toEqual(['public', 'friends', 'private']);
        for (const value of [null, '', 'Public', 'invisible', 2]) expect(createdLobbyType(value)).toBe('private');
    });

    it('a match from the public list is public, whatever its host says', () => {
        expect(joinedLobbyType({ declared: 'private', listed: true })).toBe('public');
        expect(joinedLobbyType({ declared: 'friends', listed: false })).toBe('friends');
        expect(joinedLobbyType({ declared: 'private' })).toBe('private');
        expect(joinedLobbyType({ declared: null })).toBeNull();
        expect(joinedLobbyType()).toBeNull();
    });

    it('friends are offered "Join game" for public and friends matches only', () => {
        expect(lobbyOffersJoinToFriends('public')).toBe(true);
        expect(lobbyOffersJoinToFriends('friends')).toBe(true);
        expect(lobbyOffersJoinToFriends('private')).toBe(false);
        expect(lobbyOffersJoinToFriends(null)).toBe(false); // not known: never offered
    });

    it('chat counts a match as among friends only when it is known to be', () => {
        expect(chatLobbyType('friends')).toBe('friends');
        expect(chatLobbyType('private')).toBe('private');
        expect(chatLobbyType('public')).toBe('public');
        expect(chatLobbyType(null)).toBe('public'); // not known: as a public match
        expect(chatLobbyType('anything')).toBe('public');
    });
});

describe('the create sheet (src/ui/match-config-modal.js)', () => {
    const sheet = source('ui/match-config-modal.js');

    it('opens on Friends', () => {
        expect(sheet).toContain('<option value="friends" selected>Friends</option>');
        expect(sheet).toContain('<option value="public">Anyone</option>');
        expect(sheet).toContain('<option value="private">Invite only</option>');
        expect(sheet).toContain('this.updateLobbyTypeUI(DEFAULT_LOBBY_TYPE);');
    });

    it('says what each choice does, and that a public match never shows the host\'s IP address', () => {
        expect(LOBBY_TYPE_HELP).toEqual({
            public: 'Anyone can find it in the list and join. '
                + 'Players who join see your Steam name, never your IP address.',
            friends: 'Only your Steam friends can join.',
            private: 'Hidden from the list — players join by invite or lobby ID.',
        });
    });

    it('describes garbage without cancelling in its own words', () => {
        expect(sheet).toContain("? 'Garbage always arrives in full.'");
        expect(sheet).not.toContain('as in the classic game');
    });
});

describe('the host publishes the type; the transport defaults to friends', () => {
    const transport = source('core/steam/steam-networking.js');

    it('creates a friends lobby unless told otherwise, and writes the type as lobby data', () => {
        expect(transport).toContain('const lobbyType = createdLobbyType(chosenLobbyType);');
        expect(transport).toMatch(/'steam:setLobbyData',\s*lobbyId,\s*LOBBY_TYPE_KEY,\s*lobbyType,/);
        expect(transport).toContain("ipcRenderer.invoke('steam:createLobby', { maxPlayers, lobbyType })");
        expect(transport).toContain('if (key === LOBBY_TYPE_KEY) return lobby.lobbyType;');
    });
});

describe('OnlineMultiplayerMode keeps the match\'s type', () => {
    let mode;
    let setKey;
    let clearKey;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        chat.setChatLobbyType.mockReset();
        setKey = vi.spyOn(steamService, 'setRichPresenceKey').mockResolvedValue(true);
        clearKey = vi.spyOn(steamService, 'clearRichPresenceKey').mockResolvedValue(true);
        mode = Object.create(OnlineMultiplayerMode.prototype);
        mode.currentLobbyId = '109775240000000001';
        mode.ffaGameState = { players: new Map([['A', {}], ['B', {}]]) };
        mode.cleanupHandlers = [];
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['public', 'friends'])('offers "Join game" to friends in a %s match', async (type) => {
        mode.lobbyType = type;
        await mode._setLobbyRichPresence();
        expect(setKey.mock.calls).toEqual([
            ['connect', '+connect_lobby 109775240000000001'],
            ['steam_player_group', '109775240000000001'],
            ['steam_player_group_size', '2'],
        ]);
        expect(clearKey).not.toHaveBeenCalled();
    });

    it.each(['private', null])('sets no connect key and no group in a %s match', async (type) => {
        mode.lobbyType = type;
        await mode._setLobbyRichPresence();
        expect(setKey).not.toHaveBeenCalled();
        expect(clearKey.mock.calls.map(([key]) => key))
            .toEqual(['connect', 'steam_player_group', 'steam_player_group_size']);
        // Still in the lobby: the type, and chat's view of it, are kept.
        expect(mode.lobbyType).toBe(type);
        expect(chat.setChatLobbyType).not.toHaveBeenCalled();
    });

    it('forgets the type, for chat too, on every way out of a lobby', () => {
        mode.lobbyType = 'public';
        mode._clearLobbyRichPresence();
        expect(mode.lobbyType).toBeNull();
        expect(chat.setChatLobbyType).toHaveBeenCalledWith(null);
        expect(clearKey).toHaveBeenCalledWith('connect');
    });

    function joinable({ declared, listed = false, mockMode = false } = {}) {
        mode.currentLobbyId = null;
        mode.ffaGameState = null;
        mode._kickedUnsub = () => {};
        mode._joinRejectedUnsub = () => {};
        mode._configureLocalInputHooks = vi.fn();
        mode.showWaitingRoom = vi.fn();
        mode.lobbyBrowser = { hide: vi.fn(), lists: vi.fn(() => listed), showError: vi.fn() };
        mode.steamNetworking = {
            mockMode,
            steamId: 'ME',
            joinLobby: vi.fn().mockResolvedValue(),
            leaveLobby: vi.fn(),
            getLobbyData: vi.fn(async (_id, key) => (key === LOBBY_TYPE_KEY ? declared : 'Friday night')),
        };
    }

    it.each([
        ['a friends match joined by invite', { declared: 'friends' }, 'friends', 'friends'],
        ['an invite-only match', { declared: 'private' }, 'private', 'private'],
        ['a match from the public list, whatever its host says',
            { declared: 'private', listed: true }, 'public', 'public'],
        ['a match that says nothing', { declared: null }, null, 'public'],
    ])('reads the type of %s when joining, also when only watching', async (_name, lobby, type, chatType) => {
        joinable(lobby);
        await mode.handleJoinLobby('109775240000000002', { asSpectator: true });
        expect(mode.steamNetworking.getLobbyData).toHaveBeenCalledWith('109775240000000002', LOBBY_TYPE_KEY);
        expect(mode.lobbyType).toBe(type);
        expect(chat.setChatLobbyType).toHaveBeenLastCalledWith(chatType);
        expect(mode.ffaGameState.options).toEqual({ asSpectator: true });
        expect(mode.showWaitingRoom).toHaveBeenCalledOnce();
        // "Join game" follows the type too.
        expect(setKey.mock.calls.some(([key]) => key === 'connect')).toBe(type === 'public' || type === 'friends');
    });

    it('takes the type a new match was created with', async () => {
        joinable();
        mode.steamNetworking.createLobby = vi.fn().mockResolvedValue('109775240000000003');
        await mode.handleCreateLobby({
            lobbyType: 'private', gameName: 'Friday night', endCondition: 'frags', endConditionValue: 10, maxPlayers: 4,
        });
        expect(mode.lobbyType).toBe('private');
        expect(chat.setChatLobbyType).toHaveBeenLastCalledWith('private');
        expect(setKey).not.toHaveBeenCalled();

        // No choice made (a test harness): a friends match, as the transport creates it.
        await mode.handleCreateLobby({ gameName: 'Quick', endCondition: 'frags', endConditionValue: 10 });
        expect(mode.lobbyType).toBe('friends');
        expect(chat.setChatLobbyType).toHaveBeenLastCalledWith('friends');
    });

    it('does not take a test lobby\'s list for Steam\'s public list', async () => {
        joinable({ declared: 'friends', listed: true, mockMode: true });
        await mode.handleJoinLobby('mock_lobby_1');
        expect(mode.lobbyType).toBe('friends');
        expect(chat.setChatLobbyType).toHaveBeenLastCalledWith('friends');
    });
});
