import { describe, expect, it } from 'vitest';
import {
    DEV_TEST_STEAM_APP_ID,
    RELEASE_STEAM_APP_ID,
    isReleaseSteamAppId,
    resolveSteamAppId,
} from '../../electron/steam-app-id.js';

describe('Steam AppID resolution (electron/steam-app-id.js)', () => {
    it('never starts a packaged build as the test app, whatever the environment or files say', () => {
        const resolved = resolveSteamAppId({
            isPackaged: true,
            env: { STEAM_APP_ID: '480' },
            readAppIdFile: () => '480\n',
            releaseAppId: null,
        });
        expect(resolved.appId).toBeNull();
        expect(resolved.reason).toContain('Steam stays off');
        expect(resolveSteamAppId({ isPackaged: true, releaseAppId: DEV_TEST_STEAM_APP_ID }).appId).toBeNull();
    });

    it('starts a packaged build with the release constant only', () => {
        expect(resolveSteamAppId({
            isPackaged: true,
            env: { STEAM_APP_ID: '999' },
            readAppIdFile: () => '888',
            releaseAppId: 123456,
        })).toEqual({ appId: 123456, source: 'release' });
    });

    it('resolves a dev run from the variable, then the file, then the release id, then the test app', () => {
        const file = () => '480\n';
        expect(resolveSteamAppId({ isPackaged: false, env: { STEAM_APP_ID: '777' }, readAppIdFile: file }))
            .toEqual({ appId: 777, source: 'env' });
        expect(resolveSteamAppId({ isPackaged: false, readAppIdFile: file }))
            .toEqual({ appId: 480, source: 'steam_appid.txt' });
        expect(resolveSteamAppId({ isPackaged: false, releaseAppId: 123456 }))
            .toEqual({ appId: 123456, source: 'release' });
        expect(resolveSteamAppId({ isPackaged: false, releaseAppId: null }))
            .toEqual({ appId: DEV_TEST_STEAM_APP_ID, source: 'dev-test' });
    });

    it('accepts only positive integers other than the test app as a release id', () => {
        for (const bad of [null, undefined, 0, -5, 1.5, '123', DEV_TEST_STEAM_APP_ID]) {
            expect(isReleaseSteamAppId(bad)).toBe(false);
        }
        expect(isReleaseSteamAppId(2_345_670)).toBe(true);
    });

    it('holds a valid release id or none at all', () => {
        expect(RELEASE_STEAM_APP_ID === null || isReleaseSteamAppId(RELEASE_STEAM_APP_ID)).toBe(true);
    });
});
