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

describe('electron-builder packaging config', () => {
    it('keeps node_modules out of app.asar', () => {
        expect(manifest.build.files).toContain('!**/node_modules/**/*');
    });

    it('generates no auto-update config, since the app has no updater', () => {
        expect(manifest.build.publish).toBeNull();
    });

    it('ships every package the main process and preloads import through extraResources', () => {
        const shipped = new Set(manifest.build.extraResources
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
