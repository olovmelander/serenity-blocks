/**
 * electron-builder afterPack hook.
 *
 * Every build (Phase 1.1 of the remediation plan, tightened 2026-11-03): the packaged output holds
 * no steam_appid.txt. Per Steamworks the file is a dev-only convenience; a packaged build takes its
 * AppID from electron/steam-app-id.js and, until that is set, runs with Steam off (it never starts
 * as Valve's test app 480). package.json copies no such file and excludes it from app.asar; this
 * hook fails the build if one turns up next to the executable anyway.
 *
 * Release mode (SERENITY_RELEASE=1) also requires the release AppID to be set (the release gate
 * checks it before the build starts; this is the last line).
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async function afterPack(context) {
    const appIdPath = path.join(context.appOutDir, 'steam_appid.txt');
    if (fs.existsSync(appIdPath)) {
        throw new Error(
            '[afterPack] Packaging blocker: steam_appid.txt is in the packaged output. Packaged builds '
            + 'take the Steam AppID from electron/steam-app-id.js; remove whatever copies the file.',
        );
    }

    if (process.env.SERENITY_RELEASE === '1') {
        const appIdModule = path.join(__dirname, '..', 'electron', 'steam-app-id.js');
        const { RELEASE_STEAM_APP_ID, isReleaseSteamAppId } = await import(pathToFileURL(appIdModule).href);
        if (!isReleaseSteamAppId(RELEASE_STEAM_APP_ID)) {
            throw new Error(
                '[afterPack] Release blocker: no release Steam AppID is set in electron/steam-app-id.js.',
            );
        }
        console.log(`[afterPack] Release build — Steam AppID ${RELEASE_STEAM_APP_ID}, no steam_appid.txt.`);
    } else {
        console.log('[afterPack] Test build — no steam_appid.txt; Steam is off unless the release AppID is set.');
    }
};
