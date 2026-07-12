import fs from 'node:fs';
import path from 'node:path';

export const PLACEHOLDER_APPID = '480';
export const APP_ID_FILES = ['steam_appid.txt', 'electron/steam_appid.txt'];

/**
 * Evaluate the Steam AppID policy without process exits or console side effects.
 * The CLI gate prints these diagnostics; Vitest asserts them directly.
 */
export function evaluateSteamAppIds({
    root = process.cwd(),
    isReleaseBuild = false,
    appIdFiles = APP_ID_FILES,
} = {}) {
    const diagnostics = [];
    let failed = false;

    for (const relativePath of appIdFiles) {
        const fullPath = path.join(root, relativePath);
        if (!fs.existsSync(fullPath)) continue;

        const appId = fs.readFileSync(fullPath, 'utf8').trim();
        if (appId !== PLACEHOLDER_APPID) continue;

        const message = `${relativePath} is still the Spacewar placeholder AppID (480)`
            + ' — set the real Steam AppID before release.';
        diagnostics.push({ level: isReleaseBuild ? 'error' : 'warning', message });
        if (isReleaseBuild) failed = true;
    }

    return { diagnostics, failed };
}
