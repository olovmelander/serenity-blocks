/**
 * Online chat moderation (src/ui/chat-moderation.js): chat on or off, and muting a player on this
 * computer only. The host still relays a muted player's messages; every chat log just leaves
 * them out.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    CHAT_MUTES_KEY, CHAT_OFF_NOTE, MAX_CHAT_MUTES, PUBLIC_CHAT_OFF_NOTE, STEAM_PROFILE_HINT,
    appendChatMessage, chatModerationNote, chatOffNote, chatOffReason, createSteamProfileButton,
    hasSteamProfile, isChatMessageShown, isChatOn, isMuted, mutePlayer, mutedPlayers,
    onChatModerationChange, renderChatLog, resetChatModerationForTests, setChatLobbyType,
    setPlayerMuted, unmutePlayer,
} from '../../src/ui/chat-moderation.js';
import steamService from '../../src/core/steam/steam-service.js';
import { OnlineChat } from '../../src/ui/online-chat.js';
import { InGameChat } from '../../src/ui/ingame-chat.js';
import { handleFfaChat } from '../../src/core/multiplayer/ffa/chat-relay.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

const LOCAL = 'LOCAL';
const ALICE = 'ALICE';
const BOB = 'BOB';

/** Just enough DOM for the chat logs: elements, classes, clicks, closest('.online-chat'). */
function makeElement(tag, panel = null) {
    const listeners = new Map();
    const classes = new Set();
    const el = {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        attributes: {},
        style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
        textContent: '',
        innerHTML: '',
        title: '',
        type: '',
        scrollTop: 0,
        scrollHeight: 100,
        get className() { return [...classes].join(' '); },
        set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
        classList: {
            contains: (c) => classes.has(c),
            toggle: (c, force) => {
                const on = force ?? !classes.has(c);
                if (on) classes.add(c); else classes.delete(c);
                return on;
            },
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
        click() { (listeners.get('click') || []).forEach((fn) => fn({ stopPropagation() {} })); },
        closest: (selector) => (selector === '.online-chat' ? panel : null),
        find(className) { return this.children.find((child) => child.classList.contains(className)) || null; },
    };
    return el;
}

const doc = { createElement: (tag) => makeElement(tag) };

function makeLog() {
    const panel = makeElement('section');
    panel.className = 'online-chat';
    return { panel, log: makeElement('div', panel) };
}

const lineText = (line) => (line.classList.contains('system-message')
    ? line.textContent
    : `${line.find('author').textContent}: ${line.find('text').textContent}`);

function makeStorage() {
    const data = new Map();
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

let settings;
let settingsListeners;

beforeEach(() => {
    resetChatModerationForTests();
    settings = { onlineChat: true };
    settingsListeners = [];
    vi.stubGlobal('localStorage', makeStorage());
    vi.stubGlobal('window', {
        settingsManager: { get: () => settings },
        addEventListener: (type, fn) => { if (type === 'settingsChanged') settingsListeners.push(fn); },
    });
    vi.stubGlobal('document', doc);
});

afterEach(() => {
    resetChatModerationForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function setChat(on) {
    settings = { onlineChat: on };
    settingsListeners.forEach((fn) => fn({ detail: { onlineChat: on } }));
}

const history = () => [
    'Welcome to the lobby.',
    { playerName: 'Alice', message: 'hi all', steamId: ALICE, color: '#ff8800' },
    { playerName: 'Me', message: 'hello', steamId: LOCAL },
    { playerName: 'Bob', message: 'gg', steamId: BOB },
];

describe('chat-moderation: the mute list', () => {
    it('mutes and unmutes by Steam ID, keeps the list on this computer and survives a restart', () => {
        expect(mutePlayer(ALICE, 'Alice')).toBe(true);
        expect(mutePlayer(ALICE, 'Alice')).toBe(false);
        expect(isMuted(ALICE)).toBe(true);
        expect(isMuted(BOB)).toBe(false);
        expect(JSON.parse(localStorage.getItem(CHAT_MUTES_KEY))).toEqual([
            expect.objectContaining({ steamId: ALICE, name: 'Alice' }),
        ]);

        resetChatModerationForTests(); // a new session reads it back
        expect(isMuted(ALICE)).toBe(true);
        expect(mutedPlayers()).toEqual([expect.objectContaining({ steamId: ALICE, name: 'Alice' })]);

        expect(unmutePlayer(ALICE)).toBe(true);
        expect(isMuted(ALICE)).toBe(false);
        expect(JSON.parse(localStorage.getItem(CHAT_MUTES_KEY))).toEqual([]);
    });

    it('ignores a missing ID and a damaged save, and drops the oldest past the cap', () => {
        expect(mutePlayer(undefined, 'Nobody')).toBe(false);
        expect(mutePlayer('', 'Nobody')).toBe(false);

        localStorage.setItem(CHAT_MUTES_KEY, '{not json');
        resetChatModerationForTests();
        expect(mutedPlayers()).toEqual([]);

        localStorage.setItem(CHAT_MUTES_KEY, JSON.stringify([{ steamId: 42 }, null, { steamId: 'X', name: 7 }]));
        resetChatModerationForTests();
        expect(mutedPlayers()).toEqual([{ steamId: 'X', name: '', at: 0 }]);

        for (let i = 0; i < MAX_CHAT_MUTES + 3; i++) mutePlayer(`P${i}`, `Player ${i}`);
        expect(mutedPlayers()).toHaveLength(MAX_CHAT_MUTES);
        expect(isMuted('X')).toBe(false);
        expect(isMuted(`P${MAX_CHAT_MUTES + 2}`)).toBe(true);
    });

    it('tells listeners about mutes, unmutes and chat turned off, with a line to show', () => {
        const changes = [];
        const unsubscribe = onChatModerationChange((change) => changes.push(change));
        setPlayerMuted(ALICE, 'Alice', true);
        setPlayerMuted(ALICE, 'Alice', false);
        setChat(false);
        unsubscribe();
        mutePlayer(BOB, 'Bob');

        expect(changes).toEqual([
            { kind: 'mute', steamId: ALICE, name: 'Alice' },
            { kind: 'unmute', steamId: ALICE, name: 'Alice' },
            { kind: 'chat', on: false },
        ]);
        expect(chatModerationNote(changes[0])).toMatch(/^Alice is muted/);
        expect(chatModerationNote(changes[1])).toBe('Alice is unmuted.');
        expect(chatModerationNote(changes[2])).toBeNull();
    });
});

describe('chat-moderation: what a chat log shows', () => {
    it("leaves out a muted player's lines, never this player's own or the game's", () => {
        mutePlayer(ALICE, 'Alice');
        mutePlayer(LOCAL, 'Me'); // muting yourself (an old save) hides nothing of yours
        const shown = history().filter((msg) => isChatMessageShown(msg, LOCAL));
        expect(shown.map((msg) => (typeof msg === 'string' ? msg : msg.playerName))).toEqual([
            'Welcome to the lobby.', 'Me', 'Bob',
        ]);
    });

    it('with chat off, keeps only the game\'s own lines, adds one saying so and hides the field', () => {
        setChat(false);
        const { panel, log } = makeLog();
        renderChatLog(log, history(), { localPlayerId: LOCAL, doc });
        expect(log.children.map(lineText)).toEqual(['Welcome to the lobby.', CHAT_OFF_NOTE]);
        expect(panel.classList.contains('is-chat-off')).toBe(true);
        expect(appendChatMessage(log, { playerName: 'Bob', message: 'still there?', steamId: BOB }, { doc })).toBe(false);

        setChat(true);
        renderChatLog(log, history(), { localPlayerId: LOCAL, doc });
        expect(panel.classList.contains('is-chat-off')).toBe(false);
        // This player's own line reads "You", as when it was first sent.
        expect(log.children.map(lineText)).toEqual(['Welcome to the lobby.', 'Alice: hi all', 'You: hello', 'Bob: gg']);
    });

    it('draws text as text, the roster hue first, and a mute button only on other players\' lines', () => {
        const { log } = makeLog();
        renderChatLog(log, [
            { playerName: '<img src=x onerror=alert(1)>', message: '<b>bold</b>', steamId: ALICE, color: '#ff8800' },
            { playerName: 'Me', message: 'mine', steamId: LOCAL },
        ], { localPlayerId: LOCAL, colorOf: (id) => (id === ALICE ? '#00ff00' : null), doc });

        const [alice, mine] = log.children;
        expect(alice.find('author').textContent).toBe('<img src=x onerror=alert(1)>');
        expect(alice.find('text').textContent).toBe('<b>bold</b>');
        expect(alice.style.props['--player-color']).toBe('#00ff00');
        expect(alice.dataset.steamId).toBe(ALICE);
        const mute = alice.find('chat-mute-btn');
        expect(mute.attributes['aria-label']).toBe('Mute <img src=x onerror=alert(1)>');
        expect(mine.find('chat-mute-btn')).toBeNull();
    });

    it('a line\'s mute button mutes its author', () => {
        const { log } = makeLog();
        renderChatLog(log, history(), { localPlayerId: LOCAL, doc });
        const bobLine = log.children.find((line) => line.dataset.steamId === BOB);
        bobLine.find('chat-mute-btn').click();
        expect(isMuted(BOB)).toBe(true);
        expect(mutedPlayers()).toEqual([expect.objectContaining({ steamId: BOB, name: 'Bob' })]);
    });
});

describe('chat-moderation in the match panel and the game state', () => {
    function makeMatchChat() {
        const { panel, log } = makeLog();
        const input = { value: '', blur: vi.fn() };
        const elements = { 'chat-messages': log, 'chat-input': input, 'chat-send': {} };
        vi.stubGlobal('document', { ...doc, getElementById: (id) => elements[id] || null });
        const onSend = vi.fn();
        const chat = new OnlineChat(panel, onSend, { localPlayerId: LOCAL });
        return {
            chat, log, input, onSend,
        };
    }

    it('OnlineChat hides what a muted player said, with a line saying so, and sends nothing with chat off', () => {
        const {
            chat, log, input, onSend,
        } = makeMatchChat();
        chat.addMessage({ author: 'Alice', text: 'hi all', steamId: ALICE });
        chat.addMessage({ author: 'Bob', text: 'gg', steamId: BOB });
        mutePlayer(ALICE, 'Alice');
        expect(log.children.map(lineText)).toEqual(['Bob: gg', expect.stringMatching(/^Alice is muted/)]);

        unmutePlayer(ALICE);
        expect(log.children.map(lineText)).toContain('Alice: hi all');

        setChat(false);
        input.value = 'anyone?';
        chat._handleSend();
        expect(onSend).not.toHaveBeenCalled();
        setChat(true);
        chat._handleSend();
        expect(onSend).toHaveBeenCalledWith('anyone?');

        chat.destroy();
        const drawn = log.children;
        mutePlayer(BOB, 'Bob'); // no redraw after destroy
        expect(log.children).toBe(drawn);
    });

    it('the host relays a muted player\'s message to everyone; only its own log leaves it out', () => {
        mutePlayer(ALICE, 'Alice');
        const { log } = makeLog();
        vi.stubGlobal('document', {
            ...doc,
            addEventListener() {},
            removeEventListener() {},
            getElementById: () => null,
            querySelector: (selector) => (selector === '.online-chat .chat-messages' ? log : null),
        });
        const game = {
            isHost: true,
            localPlayerId: LOCAL,
            players: new Map([[ALICE, { name: 'Alice', color: '#ff8800' }], [BOB, { name: 'Bob', color: '#0088ff' }]]),
            spectators: new Set(),
            chatHistory: [],
            broadcastToPeers: vi.fn(),
        };
        game.chat = new InGameChat(game);

        handleFfaChat(game, { from: ALICE, data: { message: 'you all stink' } });
        handleFfaChat(game, { from: BOB, data: { message: 'gg' } });

        expect(game.broadcastToPeers).toHaveBeenCalledWith(
            MessageTypes.GAME_CHAT, expect.objectContaining({ steamId: ALICE, message: 'you all stink' }), ALICE,
        );
        expect(game.broadcastToPeers).toHaveBeenCalledTimes(2);
        expect(game.chatHistory).toHaveLength(2);
        expect(log.children.map(lineText)).toEqual(['Bob: gg']);
        game.chat.destroy();
    });
});

describe('chat-moderation: chat with players you do not know is opt-in', () => {
    function setPublicChat(on) {
        settings = { ...settings, publicMatchChat: on };
        settingsListeners.forEach((fn) => fn({ detail: { publicMatchChat: on } }));
    }

    it('in a public match, shows and sends no chat until "Chat in public matches" is on', () => {
        const { panel, log } = makeLog();
        const input = { value: 'anyone?', blur: vi.fn() };
        const elements = { 'chat-messages': log, 'chat-input': input, 'chat-send': {} };
        vi.stubGlobal('document', { ...doc, getElementById: (id) => elements[id] || null });
        const onSend = vi.fn();
        const chat = new OnlineChat(panel, onSend, { localPlayerId: LOCAL });

        setChatLobbyType('public');
        expect(isChatOn()).toBe(false);
        expect(chatOffReason()).toBe('public');
        renderChatLog(log, history(), { localPlayerId: LOCAL, doc });
        // The game's own lines stay; the last one says why there is no chat and how to get it.
        expect(log.children.map(lineText)).toEqual(['Welcome to the lobby.', PUBLIC_CHAT_OFF_NOTE]);
        expect(PUBLIC_CHAT_OFF_NOTE).toBe('Chat is off in public matches. To chat with players you don\'t know, '
            + 'turn on "Chat in public matches" in Settings › General.');
        expect(panel.classList.contains('is-chat-off')).toBe(true); // the message field is hidden
        expect(appendChatMessage(log, { playerName: 'Bob', message: 'hi', steamId: BOB }, { doc })).toBe(false);
        chat._handleSend();
        expect(onSend).not.toHaveBeenCalled();

        setPublicChat(true);
        expect(isChatOn()).toBe(true);
        renderChatLog(log, history(), { localPlayerId: LOCAL, doc });
        expect(log.children.map(lineText)).toEqual(['Welcome to the lobby.', 'Alice: hi all', 'You: hello', 'Bob: gg']);
        expect(panel.classList.contains('is-chat-off')).toBe(false);
        chat._handleSend();
        expect(onSend).toHaveBeenCalledWith('anyone?');
        chat.destroy();
    });

    it('friends and invite-only matches follow the chat setting alone', () => {
        for (const type of ['friends', 'private']) {
            setChatLobbyType(type);
            expect(isChatOn(), type).toBe(true);
            expect(chatOffReason(), type).toBeNull();
        }
        setChat(false);
        expect(isChatOn()).toBe(false);
        expect(chatOffReason()).toBe('setting');
        expect(chatOffNote()).toBe(CHAT_OFF_NOTE);
    });

    it('a match whose type is not known counts as public; outside a match nothing is narrowed', () => {
        for (const type of ['', 'unknown', 0, 'Public']) {
            setChatLobbyType(type);
            expect(chatOffReason(), String(type)).toBe('public');
        }
        setChatLobbyType(null);
        expect(isChatOn()).toBe(true);
        setChatLobbyType(undefined);
        expect(isChatOn()).toBe(true);
    });

    it('with all chat off, a public match says so the plain way, and turning public chat on changes nothing', () => {
        setChatLobbyType('public');
        settings = { onlineChat: false, publicMatchChat: true };
        expect(chatOffReason()).toBe('setting');
        expect(chatOffNote()).toBe(CHAT_OFF_NOTE);
        expect(isChatOn()).toBe(false);
    });

    it('is off in a public match when the settings cannot be read', () => {
        setChatLobbyType('public');
        vi.stubGlobal('window', { settingsManager: { get: () => { throw new Error('not ready'); } } });
        expect(isChatOn()).toBe(false);
        vi.stubGlobal('window', {});
        expect(isChatOn()).toBe(false);
        setChatLobbyType('friends');
        expect(isChatOn()).toBe(true);
    });

    it('tells every chat log when the match or either setting changes', () => {
        const changes = [];
        onChatModerationChange((change) => changes.push(change));
        setChatLobbyType('public');
        setChatLobbyType('public'); // no change: nothing told
        setPublicChat(true);
        setChatLobbyType('friends');
        setChat(false);
        setChatLobbyType(null);
        expect(changes).toEqual([
            { kind: 'chat', on: false },
            { kind: 'chat', on: true },
            { kind: 'chat', on: true },
            { kind: 'chat', on: false },
            { kind: 'chat', on: false },
        ]);
    });
});

describe('chat-moderation: View Steam profile', () => {
    const STEAM_ALICE = '76561198000000002';

    it('a player with a Steam ID has one; a test lobby\'s stand-in has none', () => {
        expect(hasSteamProfile(STEAM_ALICE)).toBe(true);
        expect(hasSteamProfile(76561198000000002n)).toBe(true);
        for (const id of [ALICE, 'mock_host_1', '', null, undefined, '7656119800000000', `${STEAM_ALICE}x`]) {
            expect(hasSteamProfile(id), String(id)).toBe(false);
            expect(createSteamProfileButton(id, 'Alice', { doc })).toBeNull();
        }
    });

    it('opens that player in the Steam overlay, and says Steam\'s block and report tools are there', () => {
        const open = vi.spyOn(steamService, 'activateOverlayToUser').mockResolvedValue(true);
        const button = createSteamProfileButton(STEAM_ALICE, 'Alice', { doc, className: 'player-profile-btn' });
        expect(button.className).toBe('player-profile-btn');
        expect(button.type).toBe('button');
        expect(button.attributes['aria-label']).toBe('View Alice\'s Steam profile');
        expect(button.title).toBe(STEAM_PROFILE_HINT);
        expect(STEAM_PROFILE_HINT).toBe('View Steam profile. Steam\'s tools to block or report a player are there.');
        button.click();
        expect(open).toHaveBeenCalledWith(STEAM_ALICE);
    });

    it('sits beside Mute on another player\'s chat line, never on this player\'s own', () => {
        const open = vi.spyOn(steamService, 'activateOverlayToUser').mockResolvedValue(true);
        const { log } = makeLog();
        renderChatLog(log, [
            { playerName: 'Alice', message: 'hi all', steamId: STEAM_ALICE },
            { playerName: 'Me', message: 'hello', steamId: '76561198000000009' },
        ], { localPlayerId: '76561198000000009', doc });
        const [alice, mine] = log.children;
        expect(alice.children.map((child) => child.className))
            .toEqual(['color-indicator', 'author', 'text', 'chat-mute-btn', 'chat-profile-btn']);
        expect(mine.find('chat-profile-btn')).toBeNull();
        alice.find('chat-profile-btn').click();
        expect(open).toHaveBeenCalledWith(STEAM_ALICE);
        expect(isMuted(STEAM_ALICE)).toBe(false); // viewing a profile mutes nobody
    });
});
