import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIPMAP_WARM_FORMATS, warmMipmapPipelines } from '../../src/rendering/mipmap-pipeline-warm.js';

/**
 * three creates its mipmap pipelines with the synchronous device.createRenderPipeline when a texture
 * first needs mips: the only synchronous pipelines of a theme switch, and the start of the worst frame
 * in 11 of 40 first-visit switches (2026-10-31). The warm compiles them async into three's own cache.
 * The contract half reads the installed three so an upgrade that moves the cache or the descriptor
 * fails here instead of the warm quietly doing nothing.
 */
const read = (rel) => readFileSync(new URL(`../../node_modules/three/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('three\'s mipmap pipelines (the contract the warm relies on)', () => {
    const pass = read('src/renderers/webgpu/utils/WebGPUTexturePassUtils.js');
    const textureUtils = read('src/renderers/webgpu/utils/WebGPUTextureUtils.js');
    const backend = read('src/renderers/webgpu/WebGPUBackend.js');

    it('caches one pipeline per format and view dimension, created synchronously when missing', () => {
        expect(pass).toMatch(/getTransferPipeline\( format, textureBindingViewDimension \) \{\s*textureBindingViewDimension = textureBindingViewDimension \|\| '2d-array';\s*const key = `\$\{ format \}-\$\{ textureBindingViewDimension \}`;\s*let pipeline = this\.transferPipelines\[ key \];\s*if \( pipeline === undefined \) \{/);
        expect(pass).toContain('_renderPipelineDescriptor.label = `mipmap-${ format }-${ textureBindingViewDimension }`;');
        expect(pass).toContain('_renderPipelineDescriptor.vertex = { module: this.mipmapShaderModule };');
        expect(pass).toContain("entryPoint: `main_${ textureBindingViewDimension.replace( '-', '_' ) }`,");
        expect(pass).toContain('targets: [ { format } ]');
        expect(pass).toContain("_renderPipelineDescriptor.layout = 'auto';");
        expect(pass).toContain('pipeline = this.device.createRenderPipeline( _renderPipelineDescriptor );');
        expect(pass).toContain('this.transferPipelines[ key ] = pipeline;');
        // The descriptor's other fields are WebGPU's defaults (an empty primitive, multisample 1).
        const descriptor = read('src/renderers/webgpu/descriptors/GPURenderPipelineDescriptor.js');
        expect(descriptor).toContain('this.primitive = {};');
        expect(descriptor).toContain('this.depthStencil = undefined;');
        expect(descriptor).toMatch(/this\.count = 1;\s*this\.mask = 0xFFFFFFFF;\s*this\.alphaToCoverageEnabled = false;/);
    });

    it('reaches the pass utils through backend.textureUtils._getPassUtils()', () => {
        expect(backend).toContain('this.textureUtils = new WebGPUTextureUtils( this );');
        expect(textureUtils).toMatch(/_getPassUtils\(\) \{\s*let passUtils = this\._passUtils;\s*if \( passUtils === null \) \{\s*this\._passUtils = passUtils = new WebGPUTexturePassUtils\( this\.backend\.device \);/);
        expect(pass).toContain('this.mipmapShaderModule = device.createShaderModule( _shaderModuleDescriptor );');
        expect(pass).toContain('this.transferPipelines = {};');
    });
});

describe('warmMipmapPipelines', () => {
    const makeRenderer = ({ slow = null } = {}) => {
        const created = [];
        const passUtils = { transferPipelines: {}, mipmapShaderModule: { label: 'mipmap' } };
        const device = {
            createRenderPipelineAsync(descriptor) {
                created.push(descriptor);
                const pipeline = { label: descriptor.label };
                return slow ? slow.then(() => pipeline) : Promise.resolve(pipeline);
            },
        };
        return {
            created,
            passUtils,
            renderer: { backend: { isWebGPUBackend: true, device, textureUtils: { _getPassUtils: () => passUtils } } },
        };
    };

    it('compiles each format async with three\'s descriptor and fills three\'s cache', async () => {
        const { renderer, created, passUtils } = makeRenderer();
        await expect(warmMipmapPipelines(renderer)).resolves.toBe(MIPMAP_WARM_FORMATS.length);
        expect(created.map((d) => d.label)).toEqual(MIPMAP_WARM_FORMATS.map((f) => `mipmap-${f}-2d-array`));
        expect(created[0]).toEqual({
            label: 'mipmap-rgba8unorm-2d-array',
            vertex: { module: passUtils.mipmapShaderModule },
            fragment: { module: passUtils.mipmapShaderModule, entryPoint: 'main_2d_array', targets: [{ format: 'rgba8unorm' }] },
            layout: 'auto',
        });
        expect(Object.keys(passUtils.transferPipelines)).toEqual(MIPMAP_WARM_FORMATS.map((f) => `${f}-2d-array`));
    });

    it('keeps the pipeline three made itself when three needed one first', async () => {
        let release;
        const slow = new Promise((resolve) => { release = resolve; });
        const { renderer, passUtils } = makeRenderer({ slow });
        const warming = warmMipmapPipelines(renderer);
        const own = { label: 'three\'s own' };
        passUtils.transferPipelines['rgba8unorm-2d-array'] = own;
        release();
        await expect(warming).resolves.toBe(MIPMAP_WARM_FORMATS.length - 1);
        expect(passUtils.transferPipelines['rgba8unorm-2d-array']).toBe(own);
    });

    it('leaves WebGL2, uninitialised renderers and a failing device alone', async () => {
        await expect(warmMipmapPipelines({ backend: { isWebGPUBackend: false } })).resolves.toBe(0);
        await expect(warmMipmapPipelines({ backend: { isWebGPUBackend: true } })).resolves.toBe(0);
        await expect(warmMipmapPipelines(null)).resolves.toBe(0);
        const failing = {
            backend: {
                isWebGPUBackend: true,
                device: { createRenderPipelineAsync: () => Promise.reject(new Error('lost')) },
                textureUtils: { _getPassUtils: () => ({ transferPipelines: {}, mipmapShaderModule: {} }) },
            },
        };
        await expect(warmMipmapPipelines(failing)).resolves.toBe(0);
    });

    it('runs for every theme renderer BaseTheme initialises', () => {
        const base = readFileSync(new URL('../../src/themes/base-theme.js', import.meta.url), 'utf8');
        expect(base).toContain("if (readFlag('mipmapPipelineWarm', true)) warmMipmapPipelines(renderer);");
    });
});
