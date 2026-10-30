import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Private contracts used by the native compiler's readiness and dispatch guards.
// Check the shipped bundle AND source. On an upgrade, re-audit rather than loosening the pin.
const read = (rel) => readFileSync(new URL('../../node_modules/three/' + rel, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
// r187: three.webgpu.js imports the node system from three.tsl.js; both ship.
const build = `${read('build/three.webgpu.js')}\n${read('build/three.tsl.js')}`;
const renderer = read('src/renderers/common/Renderer.js');
const pipelines = read('src/renderers/common/Pipelines.js');
const backend = read('src/renderers/webgpu/WebGPUBackend.js');
const utils = read('src/renderers/webgpu/utils/WebGPUPipelineUtils.js');

function method(source, signature) {
    const start = source.indexOf(signature);
    expect(start, signature).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n\t}', start);
    expect(end, signature).toBeGreaterThan(start);
    return source.slice(start, end);
}

const bothMethods = (source, signature) => [method(source, signature), method(build, signature)];

describe('three r187 native compute-pipeline contract', () => {
    it('pins both the manifest and installed library to 0.187.0', () => {
        expect(JSON.parse(read('package.json')).version).toBe('0.187.0');
        const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
        expect(manifest.dependencies.three).toBe('0.187.0');
    });

    it('native compilation owns onInit, disposal listeners and the async node build before pipeline creation', () => {
        for (const body of bothMethods(renderer, 'async compileComputeAsync( computeNodes, onProgress = null ) {')) {
            expect(body).toMatch(/if \( pipelines\.has\( computeNode \) === false \)[\s\S]*computeNode\.addEventListener\( 'dispose', dispose \);[\s\S]*onInitFn\.call\( computeNode, \{ renderer: this \} \);/);
            expect(body).toContain('pipelines.delete( computeNode );');
            expect(body).toContain('bindings.deleteForCompute( computeNode );');
            expect(body).toContain('nodes.delete( computeNode );');
            // r187 (#34816): the node build may yield (yieldCompile), and up to 16 pipelines compile
            // at once; compileComputeAsync still resolves only once every one has settled.
            expect(body).toMatch(/await nodes\.getForComputeAsync\( computeNode, yieldCompile \);[\s\S]*const compilationPromises = \[\];[\s\S]*pipelines\.getForCompute\( computeNode, computeBindings, compilationPromises \);[\s\S]*const promise = Promise\.all\( compilationPromises \)\.then\([\s\S]*await Promise\.all\( compilingPipelines \);/);
            expect(body).not.toContain('backend.compute(');
        }
    });

    it('native GPU compilation fills the guarded slot but resolves even on failure', () => {
        for (const body of bothMethods(utils, 'createComputePipeline( pipeline, bindings, promises = null ) {')) {
            expect(body).toContain('const pipelineGPU = backend.get( pipeline );');
            expect(body).toMatch(/device\.createComputePipelineAsync\( _computePipelineDescriptor \);[\s\S]*pipelineGPU\.pipeline = await pipelinePromise;[\s\S]*if \( errorScope !== null \|\| asyncError !== null \)[\s\S]*pipelineGPU\.error = true;/);
            expect(body).toMatch(/finally \{[\s\S]*resolve\(\);/);
            expect(body).toContain('promises.push( promise );');
        }
    });

    it('cached node data exposes the pipeline and native creation receives the promise sink', () => {
        for (const source of [pipelines, build]) {
            expect(source).toContain('data.pipeline = pipeline;');
            expect(source).toMatch(/this\.caches\.set\( cacheKey, pipeline \);\s*this\.backend\.createComputePipeline\( pipeline, bindings, promises \)/);
            expect(source).toContain('return data.pipeline === undefined || data.version !== computeNode.version;');
        }
        const map = read('src/renderers/common/DataMap.js');
        expect(map).toContain('this.data.set( object, map );');
        expect(map).toContain('return this.data.has( object );');
    });

    it('live compute can still create synchronously and dispatch an unguarded GPU slot', () => {
        for (const source of [renderer, build]) {
            expect(source).toContain('const computePipeline = pipelines.getForCompute( computeNode, computeBindings );');
            expect(source).toContain('backend.compute( computeNodes, computeNode, computeBindings, computePipeline, dispatchSize );');
        }
        for (const body of bothMethods(backend, 'compute( computeGroup, computeNode, bindings, pipeline, dispatchSize = null ) {')) {
            expect(body).toContain('const pipelineGPU = this.get( pipeline ).pipeline;');
            expect(body).toContain('passEncoderGPU.setPipeline( pipelineGPU );');
        }
        for (const source of [backend, build]) {
            expect(source).toContain('this.pipelineUtils.createComputePipeline( computePipeline, bindings, promises );');
        }
    });
});
