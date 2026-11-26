import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: {} }));

const { buildRichPresence, RichPresenceManager } = await import('../../src/core/steam/rich-presence-manager.js');
const { GAME_MODES } = await import('../../src/core/constants.js');

/** The tokens uploaded to Steamworks (steam/rich-presence/english.vdf). */
const TOKENS = Object.fromEntries(
    [...readFileSync(path.resolve(__dirname, '../../steam/rich-presence/english.vdf'), 'utf8')
        .matchAll(/^\s*"(#\w+)"\s+"([^"]*)"/gm)]
        .map(([, token, text]) => [token, text]),
);

const CASES = [
    ['menu', {}],
    [GAME_MODES.SINGLE_PLAYER, {}],
    [GAME_MODES.SINGLE_PLAYER, { level: 7 }],
    [GAME_MODES.INFINITY, { level: 3 }],
    [GAME_MODES.ODYSSEY, {}],
    [GAME_MODES.ODYSSEY, { chapter: 1, levelName: 'Ashen Dawn' }],
    [GAME_MODES.SERENITY, {}],
    [GAME_MODES.STILLFALL, {}],
    [GAME_MODES.LOCAL_MULTIPLAYER, {}],
    [GAME_MODES.LOCAL_MULTIPLAYER, { playerCount: 3 }],
    [GAME_MODES.ONLINE_MULTIPLAYER, {}],
    [GAME_MODES.ONLINE_MULTIPLAYER, { inLobby: true, playerCount: 2, maxPlayers: 8 }],
    [GAME_MODES.ONLINE_MULTIPLAYER, { inMatch: true, playerCount: 4, position: 1 }],
];

describe('Steam Rich Presence', () => {
    it.each(CASES)('%s %o: a defined token, every key filled, the same line as the plain status', (mode, data) => {
        const { token, text, params } = buildRichPresence(mode, data);
        expect(TOKENS[token], token).toBeDefined();
        const filled = TOKENS[token].replace(/%(\w+)%/g, (_, key) => {
            expect(params, `${token} needs %${key}%`).toHaveProperty(key);
            return params[key];
        });
        expect(text).toBe(filled);
    });

    it('uses the main menu names and shows no detail the game did not report', () => {
        const lines = CASES.map(([mode, data]) => buildRichPresence(mode, data).text);
        lines.forEach((line) => expect(line).not.toMatch(/Multiplayer|Mode\b|FFA|Level 1\b/));
        expect(buildRichPresence(GAME_MODES.SINGLE_PLAYER, {}).text).toBe('Single Player');
        expect(buildRichPresence(GAME_MODES.LOCAL_MULTIPLAYER, { playerCount: 3 }).text).toBe('Local Versus · 3 players');
        // The match position is never reported after the start, so no "1st place".
        expect(buildRichPresence(GAME_MODES.ONLINE_MULTIPLAYER, { inMatch: true, playerCount: 4, position: 1 }).text)
            .toBe('Online Versus · 4-player match');
        expect(buildRichPresence('no-such-mode').text).toBe('In the menu');
    });
});

describe('the player count of an online match in progress', () => {
    /** A manager with its timers out of the way: only the data it would publish matters here. */
    function manager(data) {
        const presence = new RichPresenceManager();
        presence._scheduleUpdate = vi.fn();
        presence.currentMode = GAME_MODES.ONLINE_MULTIPLAYER;
        presence.currentData = data;
        return presence;
    }

    it('follows a drop-in and a leave', () => {
        const presence = manager({ inMatch: true, playerCount: 2, position: 1 });
        presence.setMatchRoster(3);
        expect(presence.currentData.playerCount).toBe(3);
        expect(buildRichPresence(presence.currentMode, presence.currentData).text).toBe('Online Versus · 3-player match');
        presence.setMatchRoster(2);
        expect(presence.currentData.playerCount).toBe(2);
        expect(presence._scheduleUpdate).toHaveBeenCalledTimes(2);

        // The same count, or no count, publishes nothing.
        presence.setMatchRoster(2);
        presence.setMatchRoster(undefined);
        presence.setMatchRoster(0);
        expect(presence._scheduleUpdate).toHaveBeenCalledTimes(2);
    });

    it('is left to the lobby status events outside a match', () => {
        const presence = manager({ inLobby: true, playerCount: 2, maxPlayers: 8 });
        presence.setMatchRoster(5);
        expect(presence.currentData.playerCount).toBe(2);
        expect(presence._scheduleUpdate).not.toHaveBeenCalled();
    });
});
