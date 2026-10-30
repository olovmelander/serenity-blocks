import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { warmPmremPipelines } from '../../src/themes/shared/pmrem-warm.js';

/**
 * shared/pmrem-warm.js compiles three's reflection-map pipelines ahead of a theme's first frame by
 * driving PMREMGenerator's internals (three r187: the cube-target PMREM of #34585). If an upgrade
 * renames them the warm quietly does nothing (it never throws), so this test is what notices.
 */
describe('the PMREM warm', () => {
    it('finds the PMREMGenerator internals it drives', () => {
        const proto = THREE.PMREMGenerator.prototype;
        for (const name of ['_setSize', '_allocateTarget', '_textureToCubemap', '_applyPMREM', '_renderCube', 'dispose']) {
            expect(typeof proto[name], name).toBe('function');
        }
        const generator = new THREE.PMREMGenerator({});
        expect(generator._boxMesh?.isMesh).toBe(true); // eslint-disable-line no-underscore-dangle
        expect(generator._cubeCamera?.children?.[0]?.isPerspectiveCamera).toBe(true); // eslint-disable-line no-underscore-dangle
        // Every pass of a conversion goes through _renderCube, and an equirect texture is sized as
        // the warm sizes it (three's own source, so a rename or a new draw path shows here).
        const src = readFileSync(new URL('../../node_modules/three/src/renderers/common/extras/PMREMGenerator.js', import.meta.url), 'utf8')
            .replace(/\r\n/g, '\n');
        expect(src).toContain('this._setSize( texture.image.width / 4 );');
        expect(src).toContain("this._renderCube( this._getSourceTarget(), 0, material );");
        expect(src).toContain('this._renderCube( pmremTarget, lod, this._integrationMaterial );');
        expect(src).toContain('this._renderCube( pmremTarget, lod, this._ggxMaterial );');
        expect(src.match(/cubeCamera\.update\(/g)).toHaveLength(2); // _renderCube's and fromScene's
        const node = readFileSync(new URL('../../node_modules/three/src/nodes/pmrem/PMREMNode.js', import.meta.url), 'utf8');
        expect(node).toContain('renderTarget = generator.fromEquirectangular( texture, renderTarget );');
    });

    it('leaves a WebGL2 renderer or a texture without an image alone', async () => {
        await expect(warmPmremPipelines({ backend: { isWebGPUBackend: false } }, { image: {} })).resolves.toBeNull();
        await expect(warmPmremPipelines({ backend: { isWebGPUBackend: true } }, {})).resolves.toBeNull();
    });

    it('records the conversion\'s passes and compiles each once into its target, drawing nothing', async () => {
        const compiled = [];
        let bound = { target: 'canvas', face: 0, level: 0 };
        const renderer = {
            backend: { isWebGPUBackend: true },
            init: async () => {},
            hasInitialized: () => true,
            getRenderTarget: () => bound.target,
            getActiveCubeFace: () => bound.face,
            getActiveMipmapLevel: () => bound.level,
            setRenderTarget(target, face = 0, level = 0) { bound = { target, face, level }; },
            compileAsync: async (mesh) => { compiled.push({ target: bound.target, level: bound.level, material: mesh.material.name }); },
            render: () => { throw new Error('the warm must not draw'); },
        };
        const release = await warmPmremPipelines(renderer, { image: { width: 2048, height: 1024 } });
        expect(typeof release).toBe('function');
        // The equirect pass into the source cube; GGX and integration into the PMREM (3 rough levels).
        expect(compiled.map((c) => c.material)).toEqual(['PMREM_equirect', 'PMREM_ggx', 'PMREM_integration']);
        expect(compiled[0].target.isCubeRenderTarget).toBe(true);
        expect(compiled[1].target).toBe(compiled[2].target);
        expect(compiled[1].target.texture.isPMREMTexture).toBe(true);
        expect(compiled[2].level).toBeGreaterThan(compiled[1].level);
        expect(bound).toEqual({ target: 'canvas', face: 0, level: 0 });
        release();
        release();
    });

    it('is released with Chiral Gold\'s runtime', () => {
        const theme = readFileSync(new URL('../../src/themes/chiral-gold/chiral-gold-theme.js', import.meta.url), 'utf8');
        expect(theme).toContain('this.releasePmremWarm = await warmPmremPipelines(renderer, this.world.textures.studio);');
        expect(theme).toContain('this.releasePmremWarm?.();');
    });
});
