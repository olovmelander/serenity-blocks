import fs from 'node:fs';
import path from 'node:path';
import {
    DEV_TEST_STEAM_APP_ID,
    RELEASE_STEAM_APP_ID,
    isReleaseSteamAppId,
} from '../electron/steam-app-id.js';

/** The privacy page ships with this until the owner fills in a contact address. */
export const PRIVACY_CONTACT_PLACEHOLDER = /to be added before release/i;

/**
 * The privacy page (PRIVACY_POLICY.md, shown in Settings › Credits & legal) must name a contact
 * before a store build: a warning until then, an error under SERENITY_RELEASE=1.
 */
export function evaluatePrivacyPolicy({ root = process.cwd(), isReleaseBuild = false } = {}) {
    const file = path.join(root, 'PRIVACY_POLICY.md');
    let text = '';
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return {
            diagnostics: [{ level: 'error', message: 'PRIVACY_POLICY.md is missing (the game shows it and ships it).' }],
            failed: true,
        };
    }
    if (!PRIVACY_CONTACT_PLACEHOLDER.test(text)) return { diagnostics: [], failed: false };
    const level = isReleaseBuild ? 'error' : 'warning';
    return {
        diagnostics: [{ level, message: 'PRIVACY_POLICY.md still has no contact address; fill it in before a store build.' }],
        failed: isReleaseBuild,
    };
}

function readManifest(root) {
    try {
        return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}

/** Every copy rule electron-builder applies: top level and per platform. */
function copyRules(build, key) {
    const rules = [...(build?.[key] ?? [])];
    for (const platform of ['win', 'linux', 'mac']) rules.push(...(build?.[platform]?.[key] ?? []));
    return rules.map((rule) => (typeof rule === 'string' ? { from: rule } : rule));
}

/**
 * Evaluate the Steam AppID policy without process exits or console side effects.
 * The CLI gate prints these diagnostics; Vitest asserts them directly.
 *
 * - Always: no build copies a steam_appid.txt (the repo's one is for dev runs), and
 *   electron/ (packed whole into app.asar) holds none.
 * - Release (SERENITY_RELEASE=1): the release AppID in electron/steam-app-id.js is set and is not
 *   Valve's test app. Without it a packaged build runs with Steam off, which is fine for a test
 *   build and a blocker for a store build.
 */
export function evaluateSteamAppIds({
    root = process.cwd(),
    isReleaseBuild = false,
    releaseAppId = RELEASE_STEAM_APP_ID,
    manifest = readManifest(root),
} = {}) {
    const diagnostics = [];
    const error = (message) => diagnostics.push({ level: 'error', message });

    const build = manifest?.build;
    if (!build) {
        error('package.json has no electron-builder "build" config to check.');
    } else {
        if (!(build.files ?? []).includes('!**/steam_appid.txt')) {
            error('build.files must exclude "!**/steam_appid.txt" so no AppID file reaches app.asar.');
        }
        for (const rule of [...copyRules(build, 'extraFiles'), ...copyRules(build, 'extraResources')]) {
            if (/(^|\/)steam_appid\.txt$/.test(String(rule.from ?? ''))) {
                error(`a build copy rule ships ${rule.from}; packaged builds take the AppID from electron/steam-app-id.js.`);
            }
        }
    }
    if (fs.existsSync(path.join(root, 'electron', 'steam_appid.txt'))) {
        error('electron/steam_appid.txt exists; electron/ is packed into app.asar. Delete it.');
    }

    if (!isReleaseSteamAppId(releaseAppId)) {
        const message = releaseAppId === DEV_TEST_STEAM_APP_ID
            ? `the release Steam AppID is Valve's test app (${DEV_TEST_STEAM_APP_ID}); set the game's own in electron/steam-app-id.js.`
            : 'no release Steam AppID is set in electron/steam-app-id.js; packaged builds run with Steam off until it is.';
        diagnostics.push({ level: isReleaseBuild ? 'error' : 'warning', message });
    }

    return { diagnostics, failed: diagnostics.some((d) => d.level === 'error') };
}
