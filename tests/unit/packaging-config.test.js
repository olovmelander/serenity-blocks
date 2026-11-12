/**
 * Packaging contract (audit 2026-10-13: R-16, ELEC-07, ELEC-12).
 *
 * electron-builder copies the production `dependencies` into app.asar unless
 * `build.files` excludes them. The packaged app never loads them from there:
 * Vite bundles phaser and three into dist/, and the main process loads the
 * Steam native module from resources/native_modules (extraResources). The
 * exclusion keeps ~190 MiB of dead code out of the install; these checks keep
 * it safe. Any package the main process or a preload imports must be a Node
 * built-in, `electron`, or copied in through extraResources.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

// Module specifiers written as string literals in `from '...'`, `import('...')`
// and `require('...')` (including the `devRequire` alias steam-integration uses).
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\b(?:require|devRequire)\s*\(\s*)['"]([^'"]+)['"]/g;

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

function packageName(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function bareImports(file) {
    const source = stripComments(readFileSync(new URL(`electron/${file}`, root), 'utf8'));
    return [...source.matchAll(SPECIFIER)]
        .map((match) => match[1])
        .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'));
}

/** Top-level and per-platform extraResources (electron-builder applies both). */
function allExtraResources() {
    const { build } = manifest;
    return [...build.extraResources, ...(build.win?.extraResources ?? []), ...(build.linux?.extraResources ?? [])];
}

describe('electron-builder packaging config', () => {
    it('keeps node_modules out of app.asar', () => {
        expect(manifest.build.files).toContain('!**/node_modules/**/*');
    });

    it('ships no steam_appid.txt: not in app.asar, not next to the executable', () => {
        expect(manifest.build.files).toContain('!**/steam_appid.txt');
        expect(manifest.build.extraFiles ?? []).toEqual([]);
        expect(allExtraResources().map((entry) => entry.from)).not.toContain('steam_appid.txt');
    });

    it("ships each platform's Steam binaries only, without link libraries or type files", () => {
        const steam = (platform) => manifest.build[platform].extraResources
            .find((entry) => entry.from === 'node_modules/steamworks.js');
        expect(manifest.build.extraResources.map((entry) => entry.from)).not.toContain('node_modules/steamworks.js');
        expect(steam('win').filter).toEqual(expect.arrayContaining(['!dist/linux64/**', '!dist/osx/**', '!**/*.lib', '!**/*.d.ts']));
        expect(steam('win').filter).not.toContain('!dist/win64/**');
        expect(steam('linux').filter).toEqual(expect.arrayContaining(['!dist/win64/**', '!dist/osx/**', '!**/*.d.ts']));
        expect(steam('linux').filter).not.toContain('!dist/linux64/**');
    });

    it('ships the credits, notices, licences, privacy page and copyright statement beside app.asar', () => {
        const copied = manifest.build.extraResources.map((entry) => entry.to);
        expect(copied).toEqual(expect.arrayContaining([
            'CREDITS.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.md', 'PRIVACY_POLICY.md', 'COPYRIGHT.md',
        ]));
        expect(manifest.build.extraResources.find((entry) => entry.to === 'THIRD_PARTY_LICENSES.md').from)
            .toBe('dist/THIRD_PARTY_LICENSES.md');
        expect(manifest.build.extraResources.find((entry) => entry.to === 'COPYRIGHT.md').from).toBe('COPYRIGHT.md');
        expect(copied).not.toContain('README.md');
    });

    it('checks the web build before packaging it, on Windows and on Linux', () => {
        const check = 'scripts/pages-artifact-check.mjs';
        const linux = manifest.scripts['build:linux'].split('&&').map((step) => step.trim());
        expect(linux.indexOf(`node ${check}`)).toBe(linux.indexOf('vite build') + 1);
        expect(linux.indexOf('electron-builder --linux')).toBe(linux.indexOf(`node ${check}`) + 1);

        // build-win.mjs runs its steps in source order; runCommand exits the build on a failure.
        const windows = readFileSync(new URL('scripts/build-win.mjs', root), 'utf8');
        const viteAt = windows.indexOf("runCommandAsync('vite', ['build'])");
        const checkAt = windows.indexOf(`runCommand('node', ['${check}'])`);
        const packAt = windows.indexOf("runCommand('electron-builder'");
        expect(viteAt).toBeGreaterThan(0);
        expect(checkAt).toBeGreaterThan(viteAt);
        expect(packAt).toBeGreaterThan(checkAt);
        expect(manifest.build.afterPack).toBe('scripts/afterPack.cjs');
    });

    it('pins the engine versions exactly, in package.json and in the lockfile', () => {
        const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
        for (const name of ['phaser', 'three', 'steamworks.js']) {
            expect(manifest.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
            expect(lock.packages[''].dependencies[name], name).toBe(manifest.dependencies[name]);
            expect(lock.packages[`node_modules/${name}`].version, name).toBe(manifest.dependencies[name]);
        }
        // The notices list the code inside these exact versions; an upgrade means reading them again.
        const notices = readFileSync(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8');
        const threeRelease = `r${manifest.dependencies.three.split('.')[1]}`;
        expect(notices).toContain(`# Part 2: code inside the bundled three.js (${threeRelease}) and its add-ons`);
        expect(notices).toContain(`# Part 3: code inside the bundled Phaser (${manifest.dependencies.phaser}) engine`);
    });

    it('generates no auto-update config, since the app has no updater', () => {
        expect(manifest.build.publish).toBeNull();
    });

    it('ships every package the main process and preloads import through extraResources', () => {
        const shipped = new Set(allExtraResources()
            .map((entry) => /^node_modules\/(.+)$/.exec(entry.from)?.[1])
            .filter(Boolean));
        const builtins = new Set(builtinModules);
        const unshipped = [];
        const files = readdirSync(new URL('electron/', root)).filter((file) => /\.[cm]?js$/.test(file));
        expect(files).toContain('main.js');
        for (const file of files) {
            for (const specifier of bareImports(file)) {
                const name = packageName(specifier);
                const provided = specifier.startsWith('node:') || builtins.has(specifier)
                    || name === 'electron' || shipped.has(name);
                if (!provided) unshipped.push(`${file}: ${specifier}`);
            }
        }
        expect(unshipped).toEqual([]);
    });
});
