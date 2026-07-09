/**
 * electron-builder afterPack hook.
 *
 * Release mode (SERENITY_RELEASE=1) — Phase 1.1 of the remediation plan:
 *  - HARD-FAIL if the packaged steam_appid.txt still carries the Spacewar
 *    placeholder AppID (480). The 2026-07-01 installer demonstrably shipped it.
 *  - Strip steam_appid.txt from the packaged output entirely: per Steamworks
 *    docs the txt file is a dev-only convenience; release builds must init
 *    with the explicit AppID + restartAppIfNecessary.
 *
 * Dev mode: keep the file (extraFiles copies it) so local Steam runs work.
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
    const appIdPath = path.join(context.appOutDir, 'steam_appid.txt');

    if (process.env.SERENITY_RELEASE !== '1') {
        console.log('[afterPack] Dev build — steam_appid.txt left in place.');
        return;
    }

    if (fs.existsSync(appIdPath)) {
        const appId = fs.readFileSync(appIdPath, 'utf8').trim();
        if (appId === '480') {
            throw new Error(
                '[afterPack] Release blocker: packaged steam_appid.txt contains the '
                + 'Spacewar placeholder AppID 480. Set the real AppID before a release build.',
            );
        }
        fs.rmSync(appIdPath, { force: true });
        console.log('[afterPack] Release build — stripped steam_appid.txt from packaged output.');
    } else {
        console.log('[afterPack] Release build — no steam_appid.txt in packaged output.');
    }

    // Belt-and-braces: fail if the strip somehow did not take effect.
    if (fs.existsSync(appIdPath)) {
        throw new Error('[afterPack] Release blocker: steam_appid.txt still present after strip.');
    }
};
