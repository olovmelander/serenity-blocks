/**
 * What a player can tell about an online match before joining it, and what a guest can read in
 * the waiting room: the game type, the attack rules, whether this build can play in the room at
 * all, and whether the room has an ID to pass on. A host publishes the first three as lobby data.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { describeLobbyKind, LobbyBrowser } from '../../src/ui/lobby-browser.js';
import { LOBBY_COMPATIBILITY_KEY, MATCH_COMPATIBILITY } from '../../src/core/network/match-compatibility.js';
import {
    describeVersusAttackRules, describeVersusAttackStyle, listVersusAttackRules, readVersusAttackStyle,
    VERSUS_ATTACK_STYLES,
} from '../../src/core/multiplayer/versus-attack-style.js';
import { lobbySharesItsId } from '../../src/core/multiplayer/lobby-type.js';
import {
    initialLobbyData, LOBBY_ATTACK_STYLE_KEY, LOBBY_GAME_TYPE_KEY, SteamNetworking,
} from '../../src/core/steam/steam-networking.js';
import { LobbyWaitingRoom } from '../../src/ui/lobby-waiting-room.js';
import { waitingTileWords } from '../../src/ui/opponent-watch-manager.js';

beforeEach(() => {
    vi.stubGlobal('document', {
        createElement: () => {
            let text = '';
            return {
                set textContent(value) { text = String(value ?? ''); },
                get innerHTML() {
                    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                },
            };
        },
    });
});
afterEach(() => vi.unstubAllGlobals());

/** A listed match as the main process reports it. */
const listed = (fields = {}) => ({
    id: '109775240917120077',
    name: 'Friday',
    players: 2,
    maxPlayers: 4,
    endCondition: 'frags',
    endConditionValue: '10',
    compatibility: String(MATCH_COMPATIBILITY),
    ...fields,
});

/** @param {Record<string, unknown>} lobby */
const row = (lobby) => Object.create(LobbyBrowser.prototype).lobbyRowHtml(lobby);

describe('a match in the list', () => {
    it('says what kind of room it is, standard attacks unsaid', () => {
        expect(describeLobbyKind({ gameType: 'ffa', attackStyle: 'standard' })).toBe('Free-for-all');
        expect(describeLobbyKind({ gameType: 'survivor', attackStyle: 'blind' })).toBe('Survivor · Blind');
        expect(describeLobbyKind({ gameType: 'ffa', attackStyle: 'hot_potato' })).toBe('Free-for-all · Hot potato');
        // A room that published neither, or words this build does not know, says nothing.
        expect(describeLobbyKind({})).toBe('');
        expect(describeLobbyKind({ gameType: 'capture', attackStyle: 'nukes' })).toBe('');

        expect(row(listed({ gameType: 'survivor', attackStyle: 'full_blind' }))).toContain('Survivor · Full blind');
        expect(row(listed({ gameType: 'ffa', hostName: 'Ada' }))).toContain('Free-for-all · Hosted by Ada');
    });

    it('promises a drop-in the right moment to play, by game type', () => {
        const underWay = { status: 'playing' };
        expect(row(listed({ ...underWay, gameType: 'ffa' })))
            .toContain('aria-label="Drop in to Friday — you play at a key press"');
        expect(row(listed({ ...underWay, gameType: 'survivor' })))
            .toContain('aria-label="Drop in to Friday — you play from the next round"');
        // A room that did not say gets no promise.
        expect(row(listed(underWay))).toContain('aria-label="Drop in to Friday"');
    });

    it.each([
        ['a newer build', MATCH_COMPATIBILITY + 1, 'Update to join', 'runs a newer version'],
        ['an older build', MATCH_COMPATIBILITY - 1, 'Older version', 'hosted on an older version'],
        ['a build that published no number', undefined, 'Older version', 'hosted on an older version'],
    ])('from %s cannot be joined or watched, and says who has to update', (_label, number, label, reason) => {
        const browser = Object.create(LobbyBrowser.prototype);
        const lobby = listed({ compatibility: number });
        expect(browser.canJoinLobby(lobby)).toBe(false);

        const html = browser.lobbyRowHtml(lobby);
        expect(html).toContain(`>${label}</button>`);
        expect(html).toContain(reason);
        expect(html).not.toContain('btn-join');
        expect(html).not.toContain('btn-watch');
        // Under way with a free seat: still no drop-in.
        expect(browser.lobbyRowHtml({ ...lobby, status: 'playing' })).not.toContain('btn-dropin');
    });

    it('on this build keeps Join and Watch', () => {
        const browser = Object.create(LobbyBrowser.prototype);
        expect(browser.canJoinLobby(listed())).toBe(true);
        const html = browser.lobbyRowHtml(listed());
        expect(html).toContain('btn-join');
        expect(html).toContain('btn-watch');
    });

    it('is redrawn when its kind or its build changes', () => {
        const browser = Object.create(LobbyBrowser.prototype);
        const setter = vi.fn();
        const list = { contains: () => false };
        Object.defineProperty(list, 'innerHTML', { set: setter });
        browser.container = { querySelector: () => list };
        browser.lastLobbyRenderSignature = null;

        browser.lobbies = [listed({ gameType: 'ffa' })];
        browser.renderLobbies();
        browser.lobbies = [listed({ gameType: 'ffa' })];
        browser.renderLobbies();
        expect(setter).toHaveBeenCalledTimes(1);

        browser.lobbies = [listed({ gameType: 'survivor' })];
        browser.renderLobbies();
        browser.lobbies = [listed({ gameType: 'survivor', attackStyle: 'blind' })];
        browser.renderLobbies();
        browser.lobbies = [listed({ gameType: 'survivor', attackStyle: 'blind', compatibility: '999' })];
        browser.renderLobbies();
        expect(setter).toHaveBeenCalledTimes(4);
    });
});

describe('what a host publishes for the list', () => {
    it('names the game type, the attack style and the compatibility number', async () => {
        const net = new SteamNetworking();
        net.mockMode = true;
        net.steamId = 'HOST';
        net.playerName = 'Host';
        const saved = [];
        net.saveMockLobby = (lobby) => saved.push(lobby);
        net.setupMockP2P = () => {};
        net.loadMockLobbies = () => saved;

        await net.createLobby({ gameName: 'Friday', gameType: 'survivor', attackStyle: 'hot_potato' });
        expect(saved[0]).toMatchObject({
            gameType: 'survivor', attackStyle: 'hot_potato', compatibility: MATCH_COMPATIBILITY,
        });
        expect(await net.getLobbies()).toEqual([expect.objectContaining({
            gameType: 'survivor', attackStyle: 'hot_potato', compatibility: MATCH_COMPATIBILITY,
        })]);

        // Only a plain word is published.
        saved.length = 0;
        net._resetLobbySession?.();
        await net.createLobby({ gameName: 'Odd', gameType: '<b>', attackStyle: 42 });
        expect(saved[0]).toMatchObject({ gameType: '', attackStyle: '' });
    });

    it('writes the compatibility number first and the key the list filters on last', () => {
        // The list shows a lobby once game_mode is set. Written first, a refresh between two
        // writes listed a new room as an older build with no way in.
        const data = initialLobbyData({
            gameName: 'Friday',
            lobbyType: 'public',
            endCondition: 'frags',
            endConditionValue: 10,
            gameType: 'ffa',
            attackStyle: 'blind',
            protocolVersion: '1.0.0',
        });
        const keys = data.map(([key]) => key);
        expect(keys[0]).toBe(LOBBY_COMPATIBILITY_KEY);
        expect(keys.at(-1)).toBe('game_mode');
        expect(Object.fromEntries(data)).toEqual({
            [LOBBY_COMPATIBILITY_KEY]: String(MATCH_COMPATIBILITY),
            version: '1.0.0',
            game_name: 'Friday',
            lobby_type: 'public',
            end_condition: 'frags',
            end_condition_value: '10',
            [LOBBY_GAME_TYPE_KEY]: 'ffa',
            [LOBBY_ATTACK_STYLE_KEY]: 'blind',
            game_mode: 'ffa',
        });
        // A room that names no kind publishes none.
        const plain = initialLobbyData({
            gameName: 'Plain', lobbyType: 'friends', endCondition: 'never', endConditionValue: 0, protocolVersion: '1.0.0',
        }).map(([key]) => key);
        expect(plain).not.toContain(LOBBY_GAME_TYPE_KEY);
        expect(plain).not.toContain(LOBBY_ATTACK_STYLE_KEY);
        expect(plain.at(-1)).toBe('game_mode');
    });

    it('uses lobby data keys the main process reads back', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const main = readFileSync(
            fileURLToPath(new URL('../../electron/steam-integration.js', import.meta.url)),
            'utf8',
        );
        expect(main).toContain(`l.getData('${LOBBY_GAME_TYPE_KEY}')`);
        expect(main).toContain(`l.getData('${LOBBY_ATTACK_STYLE_KEY}')`);
    });
});

describe('the attack rules in words', () => {
    it('reads the style from the create sheet\'s field or from the rules it sets', () => {
        for (const style of VERSUS_ATTACK_STYLES) expect(readVersusAttackStyle({ attackStyle: style })).toBe(style);
        expect(readVersusAttackStyle({ hotPotato: true })).toBe('hot_potato');
        expect(readVersusAttackStyle({ attackRules: { forceAttackType: 'full_blind' } })).toBe('full_blind');
        expect(readVersusAttackStyle({ attackRules: { disableAttacks: true } })).toBe('peaceful');
        expect(readVersusAttackStyle({ attackStyle: 'nukes' })).toBe('standard');
        expect(readVersusAttackStyle(null)).toBe('standard');
        expect(describeVersusAttackStyle({ attackStyle: 'full_blind' })).toBe('Full blind');
    });

    it('tells a guest every setting that is off its default', () => {
        expect(describeVersusAttackRules({ attackStyle: 'standard', minAttackLines: 2, garbageCancellation: 'disabled' }))
            .toBe('Standard');
        const everything = {
            attackStyle: 'blind', minAttackLines: 3, garbageCancellation: 'full', boringRules: true,
        };
        expect(listVersusAttackRules(everything))
            .toEqual(['Blind', 'attacks from 3 lines', 'cancelling on', 'no attack scaling']);
        expect(describeVersusAttackRules(everything))
            .toBe('Blind · attacks from 3 lines · cancelling on · no attack scaling');
        // Nothing is sent in a peaceful match, so the rest goes unsaid.
        expect(describeVersusAttackRules({ attackStyle: 'peaceful', minAttackLines: 4, boringRules: true }))
            .toBe('Peaceful');
    });
});

describe('a room\'s lobby ID', () => {
    it('is shown to pass on for public and friends rooms only', () => {
        expect(lobbySharesItsId('public')).toBe(true);
        expect(lobbySharesItsId('friends')).toBe(true);
        // A private room is invite only; a room whose type is not known shows none either.
        expect(lobbySharesItsId('private')).toBe(false);
        expect(lobbySharesItsId(null)).toBe(false);
    });

    it('shows a guest the attack rules one to a line', () => {
        const written = {};
        const room = Object.create(LobbyWaitingRoom.prototype);
        room.gameState = {
            matchConfig: {
                maxPlayers: 4, gameType: 'survivor', endCondition: 'frags', endConditionValue: 10,
                attackStyle: 'blind', minAttackLines: 3, garbageCancellation: 'full',
            },
            players: new Map(),
            network: {},
        };
        room.setText = (id, text) => { written[id] = String(text); };
        room.updateMatchInfo();
        expect(written['game-type-value']).toBe('Survivor');
        expect(written['attack-rules-value']).toBe('Blind\nAttacks from 3 lines\nCancelling on');
    });

    it('is hidden in an invite-only waiting room, with a note in its place', () => {
        const code = { hidden: false };
        const note = { hidden: true };
        const room = Object.create(LobbyWaitingRoom.prototype);
        room.container = {
            querySelector: (selector) => (selector === '.room-code-display' ? code : selector === '#invite-only-note' ? note : null),
        };

        room.setLobbyType('private');
        expect(code.hidden).toBe(true);
        expect(note.hidden).toBe(false);

        room.setLobbyType('friends');
        expect(code.hidden).toBe(false);
        expect(note.hidden).toBe(true);

        room.setLobbyType(null);
        expect(code.hidden).toBe(true);
        expect(note.hidden).toBe(true);
    });
});

describe('the tile of a player waiting to come in', () => {
    it('says a key press in a free-for-all and the next round in Survivor', () => {
        expect(waitingTileWords(true)).toEqual({ title: 'Waiting', note: 'Plays at a key press' });
        expect(waitingTileWords(false)).toEqual({ title: 'Next round', note: 'Joined mid-match' });
    });
});
