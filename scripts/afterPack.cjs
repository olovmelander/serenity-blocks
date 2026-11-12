/**
 * electron-builder afterPack hook.
 *
 * Every build (Phase 1.1 of the remediation plan, tightened 2026-11-03): the packaged output holds
 * no steam_appid.txt. Per Steamworks the file is a dev-only convenience; a packaged build takes its
 * AppID from electron/steam-app-id.js and, until that is set, runs with Steam off (it never starts
 * as Valve's test app 480). package.json copies no such file and excludes it from app.asar; this
 * hook fails the build if one turns up anywhere in the package anyway.
 *
 * Every build also holds what a player is promised and nothing the build strips
 * (scripts/packaged-app-check.mjs): Electron's and Chromium's licences beside the executable; the
 * credits, notices, licences, privacy page and copyright statement in resources/; the Steam
 * module's licence; no link library; and no trace of Phaser's video-frame polyfill.
 *
 * Every build also passes the IP-string gate over what was just packaged: the app.asar and the
 * files beside it, by the rules dist/ is held to (scripts/ip-packaged-scan.mjs).
 *
 * Release mode (SERENITY_RELEASE=1) also requires the release AppID to be set (the release gate
 * checks it before the build starts; this is the last line).
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async function afterPack(context) {
    const scanModule = path.join(__dirname, 'ip-packaged-scan.mjs');
    const { findPackagedResources, scanPackagedApp } = await import(pathToFileURL(scanModule).href);
    const packaged = findPackagedResources(context.appOutDir);
    if (packaged.length === 0) {
        throw new Error(
            `[afterPack] Packaging blocker: no app.asar under ${context.appOutDir} for the checks to read.`,
        );
    }

    const contentsModule = path.join(__dirname, 'packaged-app-check.mjs');
    const { checkPackagedApp } = await import(pathToFileURL(contentsModule).href);
    for (const resourcesDir of packaged) {
        const problems = checkPackagedApp({ appOutDir: context.appOutDir, resourcesDir });
        if (problems.length > 0) {
            throw new Error(
                `[afterPack] Packaging blocker: ${problems.length} problem(s) with what the package holds `
                + `(scripts/packaged-app-check.mjs):\n  ${problems.slice(0, 20).join('\n  ')}`,
            );
        }
        console.log('[afterPack] Package contents: licences and documents in place, nothing stripped came back.');
    }

    for (const resourcesDir of packaged) {
        const { violations, fileCount } = scanPackagedApp(resourcesDir);
        if (violations.length > 0) {
            throw new Error(
                `[afterPack] Packaging blocker: ${violations.length} disallowed name(s) in the package `
                + `(scripts/ip-packaged-scan.mjs):\n  ${violations.slice(0, 20).join('\n  ')}`,
            );
        }
        console.log(`[afterPack] IP-string gate: ${fileCount} packaged files, no disallowed names.`);
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
