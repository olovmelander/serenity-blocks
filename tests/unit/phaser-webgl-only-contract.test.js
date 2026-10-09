/**
 * The production board is drawn by Phaser 4, which has a WebGL renderer and no Canvas one: there
 * is no Canvas board fallback to configure, to test or to style a theme's pieces for. src/main.js
 * says so where it configures the game, and again in the physics callbacks' empty draw hook.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(
    new URL('../../src/main.js', import.meta.url),
    'utf8',
);

describe('Phaser board renderer contract', () => {
    it('configures the production board as WebGL-only, with no Canvas fallback', () => {
        expect(mainSource).toContain('type: PhaserRef.WEBGL');
        expect(mainSource).toContain('Phaser 4 is WebGL-only (no Canvas renderer)');
        expect(mainSource).toContain('there is no');
        expect(mainSource).toContain('canvas fallback renderer.');
    });
});
