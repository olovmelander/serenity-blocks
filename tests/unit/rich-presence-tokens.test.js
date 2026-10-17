import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: {} }));

const { buildRichPresence } = await import('../../src/core/steam/rich-presence-manager.js');
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
