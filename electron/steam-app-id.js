/**
 * The game's Steam AppID: the one constant to set once Steamworks issues it.
 *
 * Until it is set (null), a packaged build runs with Steam off (offline play, no lobbies,
 * leaderboards or Cloud). A packaged build never starts Steam as Valve's public test app 480
 * (Spacewar), and no build ships a steam_appid.txt: Steam itself tells a game launched from the
 * Steam client which app it is, and restartAppIfNecessary() relaunches one started outside it.
 *
 * Development runs (`npm run dev:electron`, unpackaged) resolve the id from STEAM_APP_ID, then the
 * repo's steam_appid.txt (480), then this constant, then 480.
 *
 * Imported by electron/steam-integration.js (runtime), scripts/release-gate-policy.mjs (a release
 * build refuses to package without it) and scripts/afterPack.cjs.
 */

/** Set to the AppID Steamworks issues (a positive integer). */
export const RELEASE_STEAM_APP_ID = null;

/** Valve's public test app (Spacewar). Development only, never a packaged build. */
export const DEV_TEST_STEAM_APP_ID = 480;

const APP_ID_TEXT = /^\d+$/;

/** True for an id a shipped build may start Steam with. */
export function isReleaseSteamAppId(appId) {
    return Number.isSafeInteger(appId) && appId > 0 && appId !== DEV_TEST_STEAM_APP_ID;
}

/**
 * Which AppID to start Steam with, or none.
 * @param {object} options
 * @param {boolean} options.isPackaged      app.isPackaged
 * @param {Record<string, string | undefined>} [options.env]
 * @param {() => string | null} [options.readAppIdFile]  dev only: the first steam_appid.txt's text
 * @param {number | null} [options.releaseAppId]          defaults to RELEASE_STEAM_APP_ID
 * @returns {{ appId: number | null, source: string, reason?: string }}
 */
export function resolveSteamAppId({
    isPackaged,
    env = {},
    readAppIdFile = () => null,
    releaseAppId = RELEASE_STEAM_APP_ID,
}) {
    if (isPackaged) {
        // A packaged build reads no environment variable or file: only the release constant.
        if (isReleaseSteamAppId(releaseAppId)) return { appId: releaseAppId, source: 'release' };
        return {
            appId: null,
            source: 'none',
            reason: 'no release Steam AppID is set (electron/steam-app-id.js); Steam stays off',
        };
    }

    const envAppId = env.STEAM_APP_ID;
    if (envAppId && APP_ID_TEXT.test(envAppId)) return { appId: Number(envAppId), source: 'env' };

    const text = readAppIdFile()?.trim();
    if (text && APP_ID_TEXT.test(text)) return { appId: Number(text), source: 'steam_appid.txt' };

    if (isReleaseSteamAppId(releaseAppId)) return { appId: releaseAppId, source: 'release' };
    return { appId: DEV_TEST_STEAM_APP_ID, source: 'dev-test' };
}
