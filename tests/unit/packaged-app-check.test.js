/**
 * What a packaged desktop build holds and never holds (scripts/packaged-app-check.mjs), checked
 * against fake packages: a folder for the executable, resources/ in it, a real app.asar.
 */
import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import asar from '@electron/asar';
import {
    ENGINE_LICENCE_FILES, RESOURCE_DOCUMENTS, STEAM_MODULE_LICENCE, checkPackagedApp,
} from '../../scripts/packaged-app-check.mjs';
import { RVFC_FINGERPRINTS } from '../../scripts/vite-plugins/strip-phaser-rvfc-polyfill.mjs';

const afterPack = createRequire(import.meta.url)('../../scripts/afterPack.cjs');
const manifest = createRequire(import.meta.url)('../../package.json');

const roots = [];

function write(root, rel, text) {
    const file = join(root, ...rel.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
}

const CLEAN_APP = {
    'package.json': '{"name":"serenity-blocks"}',
    'dist/index.html': '<title>Serenity Blocks</title>',
    'dist/assets/phaser-abc123.js': 'export const video = el.requestVideoFrameCallback(tick);',
    'dist/COPYRIGHT.md': 'Copyright',
    'electron/main.js': 'module.exports = {};',
};

/** Everything a package must hold outside app.asar, as paths relative to the executable's folder. */
function completeOutside() {
    const files = {};
    for (const name of ENGINE_LICENCE_FILES) files[name] = `${name} text`;
    for (const name of RESOURCE_DOCUMENTS) files[`resources/${name}`] = `# ${name}`;
    files[`resources/${STEAM_MODULE_LICENCE}`] = 'MIT License';
    files['resources/native_modules/steamworks.js/index.js'] = 'module.exports = {};';
    files['resources/native_modules/steamworks.js/dist/win64/steam_api64.dll'] = 'binary';
    files['Serenity Blocks.exe'] = 'binary';
    return files;
}

/** A packaged build: `inside` goes into resources/app.asar, `outside` beside the executable. */
async function packageBuild({ inside = CLEAN_APP, outside = completeOutside(), without = [] } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'packaged-app-check-'));
    roots.push(root);
    const appSource = join(root, 'app-source');
    for (const [rel, text] of Object.entries(inside)) write(appSource, rel, text);
    const appOutDir = join(root, 'release', 'win-unpacked');
    mkdirSync(join(appOutDir, 'resources'), { recursive: true });
    await asar.createPackage(appSource, join(appOutDir, 'resources', 'app.asar'));
    for (const [rel, text] of Object.entries(outside)) {
        if (!without.includes(rel)) write(appOutDir, rel, text);
    }
    return appOutDir;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('packaged desktop build contents (scripts/packaged-app-check.mjs)', () => {
    it('asks for the documents package.json copies into resources/', () => {
        const copied = manifest.build.extraResources.map((entry) => entry.to);
        expect(copied).toEqual(expect.arrayContaining([...RESOURCE_DOCUMENTS]));
        expect(RESOURCE_DOCUMENTS).toEqual([
            'CREDITS.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.md', 'PRIVACY_POLICY.md', 'COPYRIGHT.md',
        ]);
        expect(ENGINE_LICENCE_FILES).toEqual(['LICENSE.electron.txt', 'LICENSES.chromium.html']);
        for (const platform of ['win', 'linux']) {
            const steam = manifest.build[platform].extraResources
                .find((entry) => entry.from === 'node_modules/steamworks.js');
            expect(`${steam.to}/LICENSE`, platform).toBe(STEAM_MODULE_LICENCE);
        }
    });

    it('passes a complete package', async () => {
        const appOutDir = await packageBuild();
        expect(checkPackagedApp({ appOutDir })).toEqual([]);
        expect(checkPackagedApp({ appOutDir, resourcesDir: join(appOutDir, 'resources') })).toEqual([]);
    });

    it.each(ENGINE_LICENCE_FILES)('reports %s missing beside the executable', async (name) => {
        const appOutDir = await packageBuild({ without: [name] });
        expect(checkPackagedApp({ appOutDir })).toEqual([`${name} is missing beside the executable.`]);
    });

    it.each([...RESOURCE_DOCUMENTS, STEAM_MODULE_LICENCE])('reports resources/%s missing', async (name) => {
        const appOutDir = await packageBuild({ without: [`resources/${name}`] });
        expect(checkPackagedApp({ appOutDir })).toEqual([`resources/${name} is missing.`]);
    });

    it('reports an empty document, and a folder where a document should be', async () => {
        const outside = completeOutside();
        outside['resources/COPYRIGHT.md'] = '';
        delete outside['LICENSES.chromium.html'];
        outside['LICENSES.chromium.html/part.html'] = 'text';
        const appOutDir = await packageBuild({ outside });
        expect(checkPackagedApp({ appOutDir })).toEqual([
            'LICENSES.chromium.html is not a file beside the executable.',
            'resources/COPYRIGHT.md is empty.',
        ]);
    });

    it('reports a link library or a steam_appid.txt anywhere on disk', async () => {
        const outside = completeOutside();
        outside['resources/native_modules/steamworks.js/dist/win64/steam_api64.lib'] = 'binary';
        outside['steam_appid.txt'] = '480';
        outside['resources/native_modules/Steam_AppId.txt'] = '480';
        const appOutDir = await packageBuild({ outside });
        const problems = checkPackagedApp({ appOutDir });
        expect(problems).toHaveLength(3);
        expect(problems).toEqual(expect.arrayContaining([
            'a link library is in the package: resources/native_modules/steamworks.js/dist/win64/steam_api64.lib',
            'a steam_appid.txt is in the package: steam_appid.txt',
            'a steam_appid.txt is in the package: resources/native_modules/Steam_AppId.txt',
        ]));
    });

    it('reports a link library or a steam_appid.txt inside app.asar', async () => {
        const appOutDir = await packageBuild({
            inside: { ...CLEAN_APP, 'steam_appid.txt': '480', 'electron/native/steam_api64.lib': 'binary' },
        });
        const problems = checkPackagedApp({ appOutDir });
        expect(problems).toHaveLength(2);
        expect(problems).toEqual(expect.arrayContaining([
            'a steam_appid.txt is in the package: resources/app.asar/steam_appid.txt',
            'a link library is in the package: resources/app.asar/electron/native/steam_api64.lib',
        ]));
    });

    it.each(RVFC_FINGERPRINTS)('reports the video-frame polyfill inside app.asar (%s)', async (fingerprint) => {
        const appOutDir = await packageBuild({
            inside: { ...CLEAN_APP, 'dist/assets/phaser-abc123.js': `video.${fingerprint};` },
        });
        expect(checkPackagedApp({ appOutDir })).toEqual([
            `app.asar/dist/assets/phaser-abc123.js holds Phaser's video-frame polyfill (${fingerprint}).`,
        ]);
    });

    it('reports the video-frame polyfill in a script beside app.asar, and reads no other kind of file', async () => {
        const outside = completeOutside();
        outside['resources/app.asar.unpacked/dist/assets/phaser-abc123.js'] = 'video._rvfcpolyfillmap = {};';
        outside['resources/notes.txt'] = '_rvfcpolyfillmap';
        const appOutDir = await packageBuild({ outside });
        expect(checkPackagedApp({ appOutDir })).toEqual([
            "resources/app.asar.unpacked/dist/assets/phaser-abc123.js holds Phaser's video-frame polyfill "
            + '(_rvfcpolyfillmap).',
        ]);
    });

    it('reports a package with no app.asar', async () => {
        const appOutDir = await packageBuild();
        rmSync(join(appOutDir, 'resources', 'app.asar'));
        expect(checkPackagedApp({ appOutDir })).toEqual(['resources/app.asar is missing.']);
    });

    it('afterPack passes a complete package and stops an incomplete one, naming what is wrong', async () => {
        const complete = await packageBuild();
        await expect(afterPack({ appOutDir: complete })).resolves.toBeUndefined();

        const incomplete = await packageBuild({
            inside: { ...CLEAN_APP, 'dist/assets/phaser-abc123.js': 'video._rvfcpolyfillmap = {};' },
            without: ['LICENSE.electron.txt', 'resources/COPYRIGHT.md'],
        });
        await expect(afterPack({ appOutDir: incomplete })).rejects.toThrow(new RegExp([
            '3 problem\\(s\\) with what the package holds.*',
            '  LICENSE\\.electron\\.txt is missing beside the executable\\.',
            '  resources/COPYRIGHT\\.md is missing\\.',
            "  app\\.asar/dist/assets/phaser-abc123\\.js holds Phaser's video-frame polyfill \\(_rvfcpolyfillmap\\)\\.",
        ].join('\\n')));
    });
});
