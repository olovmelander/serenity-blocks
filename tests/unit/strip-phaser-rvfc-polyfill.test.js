import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    RVFC_FINGERPRINT,
    RVFC_FINGERPRINTS,
    RVFC_MARKER,
    createStripPhaserRvfcPolyfillPlugin,
    findRvfcFingerprints,
    stripRvfcPolyfill,
} from '../../scripts/vite-plugins/strip-phaser-rvfc-polyfill.mjs';

const require = createRequire(import.meta.url);
const phaserEsmPath = require.resolve('phaser/package.json').replace(/package\.json$/, 'dist/phaser.esm.js');

/** The polyfill as a later Phaser might word it: the marker kept, the map property renamed. */
function rewordedPolyfill(mapName) {
    return [
        RVFC_MARKER,
        '',
        "if (typeof HTMLVideoElement !== 'undefined' && 'getVideoPlaybackQuality' in HTMLVideoElement.prototype)",
        '{',
        `    HTMLVideoElement.prototype.${mapName} = {}`,
        '    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {',
        '      const quality = this.getVideoPlaybackQuality()',
        '      return this.mozPresentedFrames || quality.totalVideoFrames',
        '    }',
        '}',
    ].join('\n');
}

describe('strip-phaser-rvfc-polyfill', () => {
    it('removes exactly the GPL-3.0 polyfill statement from the pinned Phaser bundle', () => {
        const source = readFileSync(phaserEsmPath, 'utf8');
        const { code, removed } = stripRvfcPolyfill(source);
        if (findRvfcFingerprints(source).length === 0) {
            // A future Phaser without the polyfill: nothing to strip, nothing changed.
            expect(removed).toBe('');
            expect(code).toBe(source);
            return;
        }
        expect(removed.startsWith(RVFC_MARKER)).toBe(true);
        expect(removed.trimEnd().endsWith('}')).toBe(true);
        expect(removed.split('\n').length).toBeLessThan(60);
        expect(findRvfcFingerprints(code)).toEqual([]);
        expect(code).not.toContain('rvfc-polyfill\n');
        // Everything outside the removed block is untouched.
        const at = source.indexOf(RVFC_MARKER);
        expect(code.slice(0, at)).toBe(source.slice(0, at));
        expect(code.slice(code.length - (source.length - at - removed.length))).toBe(source.slice(at + removed.length));
    });

    it('knows the polyfill by three names, all of them in the pinned Phaser bundle', () => {
        expect(RVFC_FINGERPRINTS).toEqual([RVFC_FINGERPRINT, 'getVideoPlaybackQuality', 'mozPresentedFrames']);
        const { removed } = stripRvfcPolyfill(readFileSync(phaserEsmPath, 'utf8'));
        // Pinned Phaser has the polyfill; when a later one drops it, these three go with it.
        if (removed) expect(findRvfcFingerprints(removed)).toEqual([...RVFC_FINGERPRINTS]);
    });

    it.each(RVFC_FINGERPRINTS)('fails loudly when %s is present without the marker', (fingerprint) => {
        expect(() => stripRvfcPolyfill(`x.${fingerprint} = {}`))
            .toThrow(new RegExp(`\\(${fingerprint}\\) but its marker comment moved`));
    });

    it('still strips a polyfill whose map property was renamed', () => {
        const source = `const before = 1;\n${rewordedPolyfill('_frameCallbacks')}\nconst after = 2;\n`;
        expect(source).not.toContain(RVFC_FINGERPRINT);
        const { code, removed } = stripRvfcPolyfill(source);
        expect(removed).toBe(rewordedPolyfill('_frameCallbacks'));
        expect(findRvfcFingerprints(code)).toEqual([]);
        expect(code).toContain('const before = 1;');
        expect(code).toContain('const after = 2;');
    });

    it('fails when part of the polyfill sits outside the block it removed', () => {
        const source = `${rewordedPolyfill(RVFC_FINGERPRINT)}\nvideo.mozPresentedFrames;\n`;
        expect(() => stripRvfcPolyfill(source)).toThrow(/not removed cleanly \(still present: mozPresentedFrames\)/);
    });

    it('only transforms Phaser\'s ESM bundle, and only in builds', () => {
        const plugin = createStripPhaserRvfcPolyfillPlugin();
        expect(plugin.apply).toBe('build');
        expect(plugin.transform(`${RVFC_MARKER}\nif (typeof HTMLVideoElement) {}`, '/src/main.js')).toBeNull();
    });
});
