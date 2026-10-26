import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    RVFC_FINGERPRINT,
    RVFC_MARKER,
    createStripPhaserRvfcPolyfillPlugin,
    stripRvfcPolyfill,
} from '../../scripts/vite-plugins/strip-phaser-rvfc-polyfill.mjs';

const require = createRequire(import.meta.url);
const phaserEsmPath = require.resolve('phaser/package.json').replace(/package\.json$/, 'dist/phaser.esm.js');

describe('strip-phaser-rvfc-polyfill', () => {
    it('removes exactly the GPL-3.0 polyfill statement from the pinned Phaser bundle', () => {
        const source = readFileSync(phaserEsmPath, 'utf8');
        const { code, removed } = stripRvfcPolyfill(source);
        if (!source.includes(RVFC_FINGERPRINT)) {
            // A future Phaser without the polyfill: nothing to strip, nothing changed.
            expect(removed).toBe('');
            expect(code).toBe(source);
            return;
        }
        expect(removed.startsWith(RVFC_MARKER)).toBe(true);
        expect(removed.trimEnd().endsWith('}')).toBe(true);
        expect(removed.split('\n').length).toBeLessThan(60);
        expect(code).not.toContain(RVFC_FINGERPRINT);
        expect(code).not.toContain('rvfc-polyfill\n');
        // Everything outside the removed block is untouched.
        const at = source.indexOf(RVFC_MARKER);
        expect(code.slice(0, at)).toBe(source.slice(0, at));
        expect(code.slice(code.length - (source.length - at - removed.length))).toBe(source.slice(at + removed.length));
    });

    it('fails loudly when the polyfill is present without its marker', () => {
        expect(() => stripRvfcPolyfill(`x.${RVFC_FINGERPRINT} = {}`)).toThrow(/marker comment moved/);
    });

    it('only transforms Phaser\'s ESM bundle, and only in builds', () => {
        const plugin = createStripPhaserRvfcPolyfillPlugin();
        expect(plugin.apply).toBe('build');
        expect(plugin.transform(`${RVFC_MARKER}\nif (typeof HTMLVideoElement) {}`, '/src/main.js')).toBeNull();
    });
});
