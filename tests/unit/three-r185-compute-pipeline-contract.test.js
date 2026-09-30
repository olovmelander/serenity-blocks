import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Pinned-version contract for src/rendering/webgpu-compute-pipeline-async.js.
//
// The helper creates r185 compute pipelines through createComputePipelineAsync by running the
// real renderer.compute() inside a synchronous window with an async-capable create hook, and
// guards WebGPUBackend.compute against a still-pending pipeline. It relies on the r185 internals
// pinned here. The app imports 'three/webgpu' (build/three.webgpu.js), so every string is
// checked in the src tree AND in the build. If this fails after a three upgrade: re-verify the
// helper; on r186+ (native renderer.compileComputeAsync) delete the create hook, keep the guard.

const read = (rel) => readFileSync(new URL(`../../node_modules/three/${rel}`, import.meta.url), 'utf8');
const build = read('build/three.webgpu.js');
const srcRenderer = read('src/renderers/common/Renderer.js');
const srcPipelines = read('src/renderers/common/Pipelines.js');
const srcBackend = read('src/renderers/webgpu/WebGPUBackend.js');
const srcPipelineUtils = read('src/renderers/webgpu/utils/WebGPUPipelineUtils.js');
const pkg = JSON.parse(read('package.json'));

const inBoth = (src, snippet) => {
    expect(src).toContain(snippet);
    expect(build).toContain(snippet);
};

describe('three r185 compute-pipeline contract (async compute helper)', () => {
    it('is pinned to three 0.185.1', () => {
        const why = 're-verify webgpu-compute-pipeline-async.js; on r186+ delete the create hook, keep the guard';
        expect(pkg.version, why).toBe('0.185.1');
    });

    it('Renderer.compute keeps the onInit/bindings/pipeline/dispatch sequence the window relies on', () => {
        inBoth(srcRenderer, 'if ( pipelines.has( computeNode ) === false ) {');
        inBoth(srcRenderer, 'const computePipeline = pipelines.getForCompute( computeNode, computeBindings );');
        inBoth(
            srcRenderer,
            'backend.compute( computeNodes, computeNode, computeBindings, computePipeline, dispatchSize );',
        );
        inBoth(srcRenderer, 'backend.finishCompute( computeNodes );');
        inBoth(srcRenderer, 'get initialized()');
    });

    it('r185 still has no native async compute path', () => {
        expect(srcRenderer).not.toContain('compileComputeAsync(');
        expect(build).not.toContain('compileComputeAsync');
        expect(srcPipelineUtils).not.toContain('createComputePipelineAsync');
        expect(build).not.toContain('createComputePipelineAsync');
    });

    it('Pipelines caches the pipeline before asking the backend to create it', () => {
        expect(srcPipelines).toMatch(
            /this\.caches\.set\( cacheKey, pipeline \);\s*this\.backend\.createComputePipeline\( pipeline, bindings \)/,
        );
        inBoth(srcPipelines, 'return data.pipeline === undefined || data.version !== computeNode.version;');
    });

    it('WebGPUBackend.compute reads the GPU pipeline slot and sets it unguarded', () => {
        inBoth(srcBackend, 'groupGPU.currentPipeline = null;');
        inBoth(srcBackend, 'const pipelineGPU = this.get( pipeline ).pipeline;');
        inBoth(srcBackend, 'passEncoderGPU.setPipeline( pipelineGPU );');
        inBoth(srcBackend, 'this.pipelineUtils.createComputePipeline( computePipeline, bindings );');
        expect(srcBackend).toMatch(/programGPU\.module = \{[\s\S]{0,80}entryPoint: 'main'/);
    });

    it('WebGPUPipelineUtils.createComputePipeline builds the descriptor the async create mirrors', () => {
        inBoth(srcPipelineUtils, 'const computeProgram = backend.get( pipeline.computeProgram ).module;');
        inBoth(srcPipelineUtils, 'const { layoutGPU } = bindingsData.layout;');
        inBoth(srcPipelineUtils, 'pipelineGPU.pipeline = device.createComputePipeline( _computePipelineDescriptor );');
        // The label both the async create and the boot probe use: computePipeline_<stage>[_<name>].
        expect(srcPipelineUtils).toMatch(/`computePipeline_\$\{ computeStage\.stage \}/);
    });
});
