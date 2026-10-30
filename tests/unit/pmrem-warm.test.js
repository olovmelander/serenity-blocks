import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { warmPmremPipelines } from '../../src/themes/shared/pmrem-warm.js';

/**
 * shared/pmrem-warm.js compiles three's reflection-map pipelines ahead of a theme's first frame by
 * driving PMREMGenerator's internals (three r186). If an upgrade renames them the warm quietly does
 * nothing (it never throws), so this test is what notices.
 */
describe('the PMREM warm', () => {
    it('finds the PMREMGenerator internals it drives', () => {
        const proto = THREE.PMREMGenerator.prototype;
        for (const name of ['_setSizeFromTexture', '_allocateTarget', '_init', 'compileEquirectangularShader', 'dispose']) {
            expect(typeof proto[name], name).toBe('function');
        }
        // The fields _init fills and the draws read (three's own source, so a rename shows here).
        const src = readFileSync(new URL('../../node_modules/three/src/renderers/common/extras/PMREMGenerator.js', import.meta.url), 'utf8');
        for (const field of ['this._lodMeshes', 'this._ggxMaterial', 'this._equirectMaterial', 'this._pingPongRenderTarget', 'material.fragmentNode.value = texture']) {
            expect(src, field).toContain(field);
        }
    });

    it('leaves a WebGL2 renderer or a texture without an image alone', async () => {
        await expect(warmPmremPipelines({ backend: { isWebGPUBackend: false } }, { image: {} })).resolves.toBeNull();
        await expect(warmPmremPipelines({ backend: { isWebGPUBackend: true } }, {})).resolves.toBeNull();
    });

    it('is released with Chiral Gold\'s runtime', () => {
        const theme = readFileSync(new URL('../../src/themes/chiral-gold/chiral-gold-theme.js', import.meta.url), 'utf8');
        expect(theme).toContain('this.releasePmremWarm = await warmPmremPipelines(renderer, this.world.textures.studio);');
        expect(theme).toContain('this.releasePmremWarm?.();');
    });
});
