/**
 * The IP-string gate over a packaged desktop build (scripts/ip-packaged-scan.mjs): what
 * electron-builder puts in app.asar and beside it is held to dist/'s rules.
 *
 * This file names the tokens it tests for, so the gate's tree scan skips it
 * (scripts/ip-string-gate.mjs, TREE_SKIP), as it does tests/unit/ip-tokens.test.js.
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
import { findPackagedResources, scanPackagedApp } from '../../scripts/ip-packaged-scan.mjs';

const afterPack = createRequire(import.meta.url)('../../scripts/afterPack.cjs');

const NOTICE = 'TETRIS® is a registered trademark of Tetris Holding, LLC.';
const roots = [];

function write(root, rel, text) {
    const file = join(root, ...rel.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
}

/** A packaged build: `inside` goes into resources/app.asar, `beside` next to it. */
async function packageBuild({ inside, beside = {}, layout = 'linux-unpacked/resources' }) {
    const root = mkdtempSync(join(tmpdir(), 'ip-packaged-scan-'));
    roots.push(root);
    const appSource = join(root, 'app-source');
    for (const [rel, text] of Object.entries(inside)) write(appSource, rel, text);
    const resourcesDir = join(root, 'release', ...layout.split('/'));
    mkdirSync(resourcesDir, { recursive: true });
    await asar.createPackage(appSource, join(resourcesDir, 'app.asar'));
    for (const [rel, text] of Object.entries(beside)) write(resourcesDir, rel, text);
    return { root, resourcesDir };
}

const CLEAN_APP = {
    'package.json': '{"name":"serenity-blocks"}',
    'dist/index.html': '<title>Serenity Blocks</title>',
    'dist/assets/index-abc123.js': 'const quad = "Quad"; export default quad;',
    'dist/CREDITS.md': NOTICE,
    'dist/COPYRIGHT.md': 'All rights reserved.',
    'electron/main.js': 'module.exports = {};',
};

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('IP-string gate over the packaged desktop build (scripts/ip-packaged-scan.mjs)', () => {
    it('passes a clean package, allowing the legal notice inside and beside app.asar', async () => {
        const { resourcesDir } = await packageBuild({
            inside: CLEAN_APP,
            beside: { 'CREDITS.md': NOTICE, 'PRIVACY_POLICY.md': 'No servers.' },
        });
        const { violations, fileCount } = scanPackagedApp(resourcesDir);
        expect(violations).toEqual([]);
        expect(fileCount).toBe(Object.keys(CLEAN_APP).length + 2);
    });

    it('fails the genre mark in a bundle, a blocked name in a file name and a world name beside the package', async () => {
        const { resourcesDir } = await packageBuild({
            inside: {
                ...CLEAN_APP,
                'dist/assets/index-abc123.js': 'const label = "Tetris clear";',
                'dist/assets/gargantua-disc.png': 'binary',
            },
            beside: { 'THIRD_PARTY_NOTICES.md': 'Inspired by Arrakis.' },
        });
        const { violations } = scanPackagedApp(resourcesDir);
        expect(violations).toHaveLength(3);
        expect(violations).toEqual(expect.arrayContaining([
            expect.stringMatching(/^app\.asar\/dist\/assets\/gargantua-disc\.png \(file name\): gargantua/),
            expect.stringMatching(/^app\.asar\/dist\/assets\/index-abc123\.js:1: genre mark/),
            expect.stringMatching(/^THIRD_PARTY_NOTICES\.md:1: world name/),
        ]));
    });

    it('holds a README inside the package to the rules: only the credits carry the notice', async () => {
        const { resourcesDir } = await packageBuild({ inside: { ...CLEAN_APP, 'dist/README.md': NOTICE } });
        const { violations } = scanPackagedApp(resourcesDir);
        expect(violations.length).toBeGreaterThan(0);
        for (const violation of violations) expect(violation).toMatch(/^app\.asar\/dist\/README\.md:1: /);
    });

    it('does not scan the third-party packages copied beside app.asar', async () => {
        const { resourcesDir } = await packageBuild({
            inside: CLEAN_APP,
            beside: { 'native_modules/steamworks.js/README.md': 'Tetris' },
        });
        expect(scanPackagedApp(resourcesDir).violations).toEqual([]);
    });

    it('finds the package in the Windows, Linux and macOS layouts, and nothing when there is no release/', async () => {
        const win = await packageBuild({ inside: CLEAN_APP, layout: 'win-unpacked/resources' });
        const mac = await packageBuild({ inside: CLEAN_APP, layout: 'mac/Serenity Blocks.app/Contents/Resources' });
        expect(findPackagedResources(join(win.root, 'release'))).toEqual([win.resourcesDir]);
        expect(findPackagedResources(join(mac.root, 'release'))).toEqual([mac.resourcesDir]);
        expect(findPackagedResources(join(win.root, 'no-such-dir'))).toEqual([]);
    });

    it('afterPack passes a clean package and fails one with a disallowed name, or with no app.asar', async () => {
        // What afterPack also asks of every package (scripts/packaged-app-check.mjs), so that the
        // names are the only thing wrong with the second one.
        const beside = {
            '../LICENSE.electron.txt': 'MIT',
            '../LICENSES.chromium.html': '<p>BSD</p>',
            'CREDITS.md': NOTICE,
            'THIRD_PARTY_NOTICES.md': 'Notices.',
            'THIRD_PARTY_LICENSES.md': 'Licences.',
            'PRIVACY_POLICY.md': 'No servers.',
            'COPYRIGHT.md': 'All rights reserved.',
            'native_modules/steamworks.js/LICENSE': 'MIT',
        };
        const clean = await packageBuild({ inside: CLEAN_APP, beside });
        await expect(afterPack({ appOutDir: join(clean.root, 'release', 'linux-unpacked') })).resolves.toBeUndefined();

        const dirty = await packageBuild({
            inside: { ...CLEAN_APP, 'electron/main.js': '// a Tetris board' },
            beside,
        });
        await expect(afterPack({ appOutDir: join(dirty.root, 'release', 'linux-unpacked') }))
            .rejects.toThrow(/1 disallowed name\(s\).*\n.*app\.asar\/electron\/main\.js:1: genre mark/);

        await expect(afterPack({ appOutDir: join(dirty.root, 'app-source') })).rejects.toThrow(/no app\.asar/);
    });
});
