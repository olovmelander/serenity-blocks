import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Misty Lake is a classic WebGLRenderer theme: a first render that links every program on the
 * page's thread froze the page for about 1.5 s (play-feel probe, 2026-10-15). createScene links the
 * scene's programs with compileAsync (KHR_parallel_shader_compile) before its first frame.
 */
const src = readFileSync(new URL('../../src/themes/misty-lake/misty-lake-theme.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
const body = src.slice(src.indexOf('    async createScene() {'), src.indexOf('    getGraphicsQuality() {'));

describe('Misty Lake links its programs before the first frame', () => {
    it('awaits compileAsync after the scene and post exist, before the loop starts', () => {
        const compile = body.indexOf('await Promise.race([linked');
        expect(body.indexOf('renderer.compileAsync(this.scene, this.camera)')).toBeGreaterThan(-1);
        expect(compile).toBeGreaterThan(body.indexOf('this.setupPostProcessing();'));
        expect(compile).toBeLessThan(body.indexOf('this.startRenderLoop();'));
    });

    it('compiles for the composer\'s buffer and hands the renderer back its target', () => {
        const from = body.indexOf('const target = this.composer?.readBuffer ?? null;');
        const call = body.slice(from, body.indexOf('await Promise.race([linked'));
        expect(from).toBeGreaterThan(-1);
        const compile = call.indexOf('renderer.compileAsync(');
        expect(call.indexOf('renderer.setRenderTarget(target);')).toBeLessThan(compile);
        expect(call.indexOf('renderer.setRenderTarget(previous);')).toBeGreaterThan(compile);
        expect(call.slice(compile)).toContain('} finally {');
    });

    it('stops quietly when the theme was stopped while the programs linked', () => {
        const after = body.slice(body.indexOf('await Promise.race([linked'));
        expect(after.indexOf('if (this.renderer !== renderer || !this.scene) return;')).toBeGreaterThan(-1);
        expect(after.indexOf('if (this.renderer !== renderer || !this.scene) return;'))
            .toBeLessThan(after.indexOf('this.startRenderLoop();'));
    });
});

describe('Misty Lake never holds its start on the precompile', () => {
    it('waits for the programs at most a ceiling, then starts anyway', () => {
        expect(src).toMatch(/const PRECOMPILE_CEILING_MS = \d+;/);
        const from = body.indexOf('const cap = new Promise');
        const cap = body.slice(from, body.indexOf('await Promise.race([linked, cap]);'));
        expect(cap.split('\n')[0]).toContain('setTimeout(resolve, PRECOMPILE_CEILING_MS)');
        expect(body).toContain('await Promise.race([linked, cap]);');
    });
});
