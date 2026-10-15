import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Moonrise Summit is a classic WebGLRenderer theme: a first render that links every program on the
 * page's thread froze the page for about 1.7 s (play-feel probe, 2026-10-15). createScene links the
 * scene's programs with compileAsync (KHR_parallel_shader_compile) before its first frame.
 */
const src = readFileSync(new URL('../../src/themes/moonrise-summit/moonrise-summit-theme.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
const body = src.slice(src.indexOf('    async createScene() {'), src.indexOf('    async _initRenderer('));

describe('Moonrise Summit links its programs before the first frame', () => {
    it('awaits compileAsync after the scene and post exist, before the loop starts', () => {
        const compile = body.indexOf('await renderer.compileAsync(this.scene, this.camera)');
        expect(compile).toBeGreaterThan(body.indexOf('this._setupPost();'));
        expect(compile).toBeLessThan(body.indexOf('this._startAnimation();'));
    });

    it('stops quietly when the theme was stopped while the programs linked', () => {
        const after = body.slice(body.indexOf('await renderer.compileAsync'));
        expect(after.indexOf('if (this.renderer !== renderer || !this.scene) return;')).toBeGreaterThan(-1);
        expect(after.indexOf('if (this.renderer !== renderer || !this.scene) return;'))
            .toBeLessThan(after.indexOf('this._startAnimation();'));
    });
});
