import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Rainy Window is a classic WebGLRenderer theme: its first frame linked every program on the page's
 * thread, 0.8 s of frozen page with a third of it in the water's mirror (play-feel probe,
 * 2026-10-16). createScene links them with compileAsync, for the canvas and for a render target of
 * the mirror's kind, before the loop starts.
 */
const src = readFileSync(new URL('../../src/themes/rainy-window/rainy-window-theme.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
const scene = src.slice(src.indexOf('    async createScene() {'), src.indexOf('    async precompile() {'));
const pre = src.slice(src.indexOf('    async precompile() {'), src.indexOf('    initThreeJS() {'));

describe('Rainy Window links its programs before the first frame', () => {
    it('awaits the precompile after the scene is built, before the loop starts', () => {
        const at = scene.indexOf('await this.precompile();');
        expect(at).toBeGreaterThan(scene.indexOf('this.setupLighting();'));
        expect(at).toBeLessThan(scene.indexOf('this.animate();'));
        const after = scene.slice(at);
        expect(after.indexOf('if (this.renderer !== renderer || !this.scene) return;'))
            .toBeLessThan(after.indexOf('this.animate();'));
    });

    it('compiles for the canvas and for a half-float target, handing the renderer its target back', () => {
        expect(pre).toContain('new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })');
        expect(pre).toContain('for (const target of [null, mirror])');
        const call = pre.indexOf('renderer.compileAsync(this.scene, this.camera)');
        expect(pre.indexOf('renderer.setRenderTarget(target);')).toBeLessThan(call);
        expect(pre.indexOf('renderer.setRenderTarget(previous);')).toBeGreaterThan(call);
        expect(pre).toContain('mirror.dispose();');
    });

    it('never holds the start on it: a ceiling, then the first frame links what is left', () => {
        expect(src).toMatch(/const PRECOMPILE_CEILING_MS = \d+;/);
        expect(pre).toContain('setTimeout(resolve, PRECOMPILE_CEILING_MS)');
        expect(pre).toContain('await Promise.race([Promise.all(linked), cap]);');
    });
});
