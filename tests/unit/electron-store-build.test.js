/**
 * A store build (packaged, with the game's own Steam AppID) cannot be opened up from the
 * player's environment: the debugging switches are read as off. Development runs and packaged
 * test builds without a release AppID keep them. Also: no spell checker, the lobby types as
 * Steam's, and the profile page behind "View Steam profile".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveDebugFlags } from '../../electron/debug-flags.js';
import { debugKeysEnabled } from '../../electron/devtools-shortcuts.js';
import { isStoreBuild } from '../../electron/steam-app-id.js';
import { STEAM_LOBBY_TYPE, steamLobbyType } from '../../electron/steam-lobby-type.js';
import { steamProfileUrl } from '../../electron/steam-profile.js';

const read = (file) => readFileSync(new URL(`../../electron/${file}`, import.meta.url), 'utf8');

const ALL_ON = {
    SERENITY_ENABLE_DIAGNOSTICS: '1',
    SERENITY_DISABLE_CSP: '1',
    SERENITY_MAIN_INSPECT_PORT: '9229',
};

describe('store builds (electron/steam-app-id.js isStoreBuild)', () => {
    it('is a packaged build with the game\'s own AppID, and nothing else', () => {
        expect(isStoreBuild({ isPackaged: true, releaseAppId: 123456 })).toBe(true);
        // A packaged test build: no release AppID yet, or Valve's test app.
        expect(isStoreBuild({ isPackaged: true, releaseAppId: null })).toBe(false);
        expect(isStoreBuild({ isPackaged: true, releaseAppId: 480 })).toBe(false);
        // Development, even once the AppID is set.
        expect(isStoreBuild({ isPackaged: false, releaseAppId: 123456 })).toBe(false);
        expect(isStoreBuild()).toBe(false);
    });
});

describe('debugging switches (electron/debug-flags.js)', () => {
    it('a store build ignores diagnostics, the CSP bypass and the inspector port', () => {
        expect(resolveDebugFlags({
            env: ALL_ON, argv: ['game.exe', '--serenity-main-inspect-port=9230'], storeBuild: true,
        })).toEqual({ diagnosticsEnabled: false, cspDisabled: false, mainInspectPort: 0 });
    });

    it('development and packaged test builds keep them', () => {
        expect(resolveDebugFlags({ env: ALL_ON, storeBuild: false }))
            .toEqual({ diagnosticsEnabled: true, cspDisabled: true, mainInspectPort: 9229 });
        expect(resolveDebugFlags({
            env: { SERENITY_ENABLE_DIAGNOSTICS: '1' }, argv: ['game.exe', '--serenity-main-inspect-port=9230'],
        })).toEqual({ diagnosticsEnabled: true, cspDisabled: false, mainInspectPort: 9230 });
    });

    it('is all off by default, and the inspector never opens without diagnostics', () => {
        expect(resolveDebugFlags()).toEqual({ diagnosticsEnabled: false, cspDisabled: false, mainInspectPort: 0 });
        expect(resolveDebugFlags({ env: { SERENITY_MAIN_INSPECT_PORT: '9229' } }).mainInspectPort).toBe(0);
        expect(resolveDebugFlags({ env: { SERENITY_ENABLE_DIAGNOSTICS: 'true' } }).diagnosticsEnabled).toBe(false);
        for (const port of ['0', '-1', '70000', 'abc', '9229.5']) {
            expect(resolveDebugFlags({
                env: { SERENITY_ENABLE_DIAGNOSTICS: '1', SERENITY_MAIN_INSPECT_PORT: port },
            }).mainInspectPort).toBe(0);
        }
    });

    it('the debug keys and DevTools are never live in a store build', () => {
        expect(debugKeysEnabled({ isPackaged: true, diagnosticsEnabled: true, storeBuild: true })).toBe(false);
        expect(debugKeysEnabled({ isPackaged: true, diagnosticsEnabled: true })).toBe(true);
        expect(debugKeysEnabled({ isPackaged: true })).toBe(false);
        expect(debugKeysEnabled({ isPackaged: false })).toBe(true);
    });

    it('electron/main.js reads the switches only through the store-build check', () => {
        const main = read('main.js');
        expect(main).toContain('const storeBuild = isStoreBuild({ isPackaged });');
        expect(main).toContain('resolveDebugFlags({ env: process.env, argv: process.argv, storeBuild })');
        expect(main).toContain('const { diagnosticsEnabled } = debugFlags;');
        expect(main).toMatch(/function installContentSecurityPolicy\(\) \{\s*if \(debugFlags\.cspDisabled\) \{/);
        expect(main).toContain('const requestedInspectPort = debugFlags.mainInspectPort;');
        for (const name of ['SERENITY_ENABLE_DIAGNOSTICS', 'SERENITY_DISABLE_CSP', 'SERENITY_MAIN_INSPECT_PORT']) {
            expect(main, name).not.toContain(`process.env.${name}`);
        }
        expect(main).not.toContain("startsWith('--serenity-main-inspect-port=')");
    });
});

describe('the game window', () => {
    it.each(['main.js', 'main-minimal.js'])('%s runs no spell checker', (file) => {
        expect(read(file).match(/\bspellcheck\s*:\s*false\b/g) || []).toHaveLength(1);
    });
});

describe('lobby types as Steam\'s (electron/steam-lobby-type.js)', () => {
    it('maps public to 2, friends to 1 and private to 0', () => {
        expect(steamLobbyType('public')).toBe(2);
        expect(steamLobbyType('friends')).toBe(1);
        expect(steamLobbyType('private')).toBe(0);
        expect(STEAM_LOBBY_TYPE).toEqual({ private: 0, friends: 1, public: 2 });
    });

    it('reads anything else as private, the narrowest', () => {
        for (const value of [undefined, null, '', 'Public', 'invisible', 3, 'toString', '__proto__']) {
            expect(steamLobbyType(value), String(value)).toBe(0);
        }
    });

    it('is what the lobby is created with', () => {
        const source = read('steam-integration.js');
        expect(source).toContain('matchmaking.createLobby(steamLobbyType(lobbyType), maxPlayers)');
        expect(source).not.toMatch(/lobbyType === 'public' \? 2 : 1/);
    });
});

describe('a player\'s Steam profile (electron/steam-profile.js)', () => {
    it('is their community profile page, for a SteamID64 only', () => {
        expect(steamProfileUrl('76561198000000001')).toBe('https://steamcommunity.com/profiles/76561198000000001');
        expect(steamProfileUrl(76561198000000001n)).toBe('https://steamcommunity.com/profiles/76561198000000001');
        for (const value of [null, undefined, '', 'mock_host_1', '7656119800000000', '76561198000000001/../x',
            'https://example.com', '76561198000000001?x=1']) {
            expect(steamProfileUrl(value), String(value)).toBeNull();
        }
    });

    it('is what the overlay opens for "View Steam profile"', () => {
        const source = read('steam-integration.js');
        const handler = source.slice(source.indexOf("ipcMain.handle('steam:activateOverlayToUser'"));
        const profile = handler.slice(handler.indexOf("if (kind === 'steamid') {"), 700);
        expect(profile).toMatch(/^if \(kind === 'steamid'\) \{\s*const url = steamProfileUrl\(steamId\);/);
        expect(profile).toMatch(/if \(!url\) return false;\s*steamworksClient\.overlay\.activateToWebPage\(url\);/);
    });
});
