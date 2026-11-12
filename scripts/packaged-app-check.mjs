/**
 * What a packaged desktop build holds, and what it never holds. scripts/afterPack.cjs runs this on
 * every build as electron-builder finishes packing it, so a store build cannot skip it. The layout
 * is the Windows and Linux one, the two platforms package.json builds: the executable's folder
 * (`appOutDir`) with `resources/` in it.
 *
 * Must be there:
 *  - Electron's and Chromium's licences beside the executable (LICENSE.electron.txt and
 *    LICENSES.chromium.html, which Settings › Credits & legal and CREDITS.md point players to);
 *  - the game's credits, notices, bundled-package licences, privacy page and copyright statement
 *    in resources/ (package.json, build.extraResources);
 *  - the licence of the Steam module, in its folder under resources/native_modules/;
 *  - koffi beside it, with its licence and a binary for the platform: online play's relay
 *    transport (electron/steam-relay-transport.js) needs it, and refuses to play without it.
 *
 * Must not be there:
 *  - a link library (`*.lib`) or a steam_appid.txt, anywhere on disk or inside app.asar;
 *  - Phaser's video-frame polyfill, which the web build strips
 *    (scripts/vite-plugins/strip-phaser-rvfc-polyfill.mjs): none of its fingerprints may be in
 *    the scripts and pages inside app.asar or beside it.
 *
 * `checkPackagedApp` only reads; it returns the problems it found, one line each.
 */
import fs from 'node:fs';
import path from 'node:path';
import asar from '@electron/asar';
import { findRvfcFingerprints } from './vite-plugins/strip-phaser-rvfc-polyfill.mjs';
import { findTriNoiseFingerprints } from './vite-plugins/strip-three-tri-noise.mjs';

export const ENGINE_LICENCE_FILES = Object.freeze(['LICENSE.electron.txt', 'LICENSES.chromium.html']);
export const RESOURCE_DOCUMENTS = Object.freeze([
    'CREDITS.md',
    'THIRD_PARTY_NOTICES.md',
    'THIRD_PARTY_LICENSES.md',
    'PRIVACY_POLICY.md',
    'COPYRIGHT.md',
]);
export const STEAM_MODULE_LICENCE = 'native_modules/steamworks.js/LICENSE';
/** koffi, copied beside steamworks.js (package.json, build.<platform>.extraResources). */
export const RELAY_MODULE_FILES = Object.freeze([
    'native_modules/koffi/package.json',
    'native_modules/koffi/index.cjs',
    'native_modules/koffi/LICENSE.txt',
]);
/** koffi's binary: native_modules/@koromix/koffi-<platform>/<triplet>/koffi.node. */
export const RELAY_BINARY = /^koffi-[^/]+\/[^/]+\/koffi\.node$/;

const SCRIPT_OR_PAGE = /\.(js|mjs|cjs|html)$/i;

/** 'link library' or 'steam_appid.txt' for a file name no package may hold, else null. */
function forbiddenKind(name) {
    if (/\.lib$/i.test(name)) return 'a link library';
    if (name.toLowerCase() === 'steam_appid.txt') return 'a steam_appid.txt';
    return null;
}

/** Why `file` is not a document a player can read, or null when it is one. */
function missingOrEmpty(file) {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch {
        return 'is missing';
    }
    if (!stat.isFile()) return 'is not a file';
    return stat.size > 0 ? null : 'is empty';
}

/** Every file under `dir`, as forward-slash paths relative to it. Links are not followed. */
function* filesUnder(dir, prefix = '') {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) yield* filesUnder(path.join(dir, entry.name), rel);
        else yield rel;
    }
}

/** Every file in an asar header, as forward-slash paths relative to the archive root. */
function* asarFiles(node, prefix = '') {
    for (const [name, child] of Object.entries(node.files ?? {})) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if ('files' in child) yield* asarFiles(child, rel);
        else if (!('link' in child)) yield rel;
    }
}

function baseName(rel) {
    return rel.slice(rel.lastIndexOf('/') + 1);
}

/**
 * Check one packaged build.
 * @param {{ appOutDir: string, resourcesDir?: string }} packaged  the executable's folder, and
 *   the folder that holds app.asar (default: `resources` in it)
 * @returns {string[]} the problems found; empty when the package is as it should be
 */
export function checkPackagedApp({ appOutDir, resourcesDir = path.join(appOutDir, 'resources') }) {
    const problems = [];
    const resourcesLabel = path.relative(appOutDir, resourcesDir).split(path.sep).join('/') || '.';

    for (const name of ENGINE_LICENCE_FILES) {
        const why = missingOrEmpty(path.join(appOutDir, name));
        if (why) problems.push(`${name} ${why} beside the executable.`);
    }
    for (const name of [...RESOURCE_DOCUMENTS, STEAM_MODULE_LICENCE, ...RELAY_MODULE_FILES]) {
        const why = missingOrEmpty(path.join(resourcesDir, ...name.split('/')));
        if (why) problems.push(`${resourcesLabel}/${name} ${why}.`);
    }
    const relayBinaries = [...filesUnder(path.join(resourcesDir, 'native_modules', '@koromix'))]
        .filter((rel) => RELAY_BINARY.test(rel));
    if (relayBinaries.length === 0) {
        problems.push(`${resourcesLabel}/native_modules/@koromix holds no koffi binary (online play would be refused).`);
    }

    for (const rel of filesUnder(appOutDir)) {
        const kind = forbiddenKind(baseName(rel));
        if (kind) problems.push(`${kind} is in the package: ${rel}`);
    }
    for (const rel of filesUnder(resourcesDir)) {
        if (!SCRIPT_OR_PAGE.test(rel)) continue;
        const found = findRvfcFingerprints(fs.readFileSync(path.join(resourcesDir, ...rel.split('/')), 'utf8'));
        if (found.length > 0) {
            problems.push(`${resourcesLabel}/${rel} holds Phaser's video-frame polyfill (${found.join(', ')}).`);
        }
    }

    const archive = path.join(resourcesDir, 'app.asar');
    if (!fs.existsSync(archive)) {
        problems.push(`${resourcesLabel}/app.asar is missing.`);
        return problems;
    }
    for (const rel of asarFiles(asar.getRawHeader(archive).header)) {
        const kind = forbiddenKind(baseName(rel));
        if (kind) problems.push(`${kind} is in the package: ${resourcesLabel}/app.asar/${rel}`);
        if (!SCRIPT_OR_PAGE.test(rel)) continue;
        // @electron/asar splits paths on the platform separator.
        const text = asar.extractFile(archive, rel.split('/').join(path.sep)).toString('utf8');
        const found = findRvfcFingerprints(text);
        if (found.length > 0) {
            problems.push(`app.asar/${rel} holds Phaser's video-frame polyfill (${found.join(', ')}).`);
        }
        const noise = findTriNoiseFingerprints(text);
        if (noise.length > 0) {
            problems.push(`app.asar/${rel} holds three's triNoise3D loop (${noise.join(', ')}).`);
        }
    }
    asar.uncache(archive);
    return problems;
}
