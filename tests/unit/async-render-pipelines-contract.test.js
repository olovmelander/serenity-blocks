import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CubeUVReflectionMapping } from 'three/src/constants.js';
import QuadMesh from 'three/src/renderers/common/QuadMesh.js';
import { isFinalComposite, isOneShotRenderTarget } from '../../src/rendering/async-render-pipelines.js';

// Pinned-version contract for src/rendering/async-render-pipelines.js.
//
// The session wrapper turns an OWNED renderer's live `backend.createRenderPipeline(renderObject,
// null)` into the compileAsync branch (a promises array) so the compile runs through
// createRenderPipelineAsync, relying on the r186 internals pinned here:
//   - the live path hands the backend promises = null, compileAsync hands it an array;
//   - Pipelines caches the pipeline and sets renderObject.pipeline BEFORE the backend create
//     (its sole caller), so the wrapper can read backend.get(renderObject.pipeline);
//   - a pending pipeline makes Pipelines.isReady false, so _renderObjectDirect skips the draw;
//   - WebGPUBackend.draw drops objects whose pipelineData.error is true (the scope repair);
//   - PMREM bake targets are recognisable (isPMREMTexture / 'PMREM.cubeUv' / CubeUV mapping);
//   - the final composite (RenderPipeline's / the output pass's QuadMesh) draws to a canvas
//     render context whose renderTarget is null (isFinalComposite keeps it synchronous);
//   - compileAsync hands each object a fresh promises array (counted, but passed through).
// The app imports 'three/webgpu' (build/three.webgpu.js), so every snippet is checked in the src
// tree AND in the build. The header of async-render-pipelines.js cites src line numbers; those are
// pinned too so the comment stays honest. If this fails after a three upgrade: re-verify the
// wrapper against the new Pipelines / WebGPUPipelineUtils before touching the pins.

const THREE_ROOT = new URL('../../node_modules/three/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, THREE_ROOT), 'utf8').replace(/\r\n/g, '\n');

const build = read('build/three.webgpu.js');
const buildCore = read('build/three.core.js');
const srcRenderer = read('src/renderers/common/Renderer.js');
const srcPipelines = read('src/renderers/common/Pipelines.js');
const srcBackendBase = read('src/renderers/common/Backend.js');
const srcRenderObject = read('src/renderers/common/RenderObject.js');
const srcCubeRenderTarget = read('src/renderers/common/CubeRenderTarget.js');
const srcPmrem = read('src/renderers/common/extras/PMREMGenerator.js');
const srcBackend = read('src/renderers/webgpu/WebGPUBackend.js');
const srcPipelineUtils = read('src/renderers/webgpu/utils/WebGPUPipelineUtils.js');
const srcQuadMesh = read('src/renderers/common/QuadMesh.js');
const srcRenderPipeline = read('src/renderers/common/RenderPipeline.js');
const srcRenderContext = read('src/renderers/common/RenderContext.js');
const srcRenderContexts = read('src/renderers/common/RenderContexts.js');
const srcConstants = read('src/constants.js');
const srcThreeWebGPU = read('src/Three.WebGPU.js');
const pkg = JSON.parse(read('package.json'));

const CREATE_RENDER_PIPELINE = 'createRenderPipeline( renderObject, promises ) {';
const GET_RENDER_PIPELINE = '_getRenderPipeline( renderObject, stageVertex, stageFragment, cacheKey, promises ) {';
const RENDER_OBJECT_DIRECT = '_renderObjectDirect( object, material, scene, camera, lightsNode, group, '
    + 'clippingContext, passId ) {';
const PMREM_CREATE_TARGET = 'function _createRenderTarget( width, height, depthBuffer ) {';

// Consecutive statements: only whitespace and line comments may sit between the parts.
const adjacent = (...parts) => new RegExp(parts.map((r) => r.source).join(String.raw`\s*(?:\/\/[^\n]*\s*)*`));
// Same order, anything in between.
const inOrder = (...parts) => new RegExp(parts.map((r) => r.source).join(String.raw`[\s\S]*?`));

const inBoth = (src, snippet) => {
    expect(src).toContain(snippet);
    expect(build).toContain(snippet);
};

// Body of a one-tab-indented class method (or a top-level function, with closing '\n}\n') — from
// its signature to the closing brace at the same indentation — searched after `classDecl`, and
// required to sit before the next `class` declaration.
function methodOf(text, classDecl, signature, closing = '\n\t}\n') {
    const classAt = text.indexOf(classDecl);
    expect(classAt, `${classDecl} not found`).toBeGreaterThanOrEqual(0);
    const start = text.indexOf(signature, classAt);
    expect(start, `${signature} not found after ${classDecl}`).toBeGreaterThan(classAt);
    const nextClass = text.indexOf('\nclass ', classAt + classDecl.length);
    if (nextClass !== -1) expect(start, `${signature} is not a member of ${classDecl}`).toBeLessThan(nextClass);
    const end = text.indexOf(closing, start);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
}

const bothMethods = (classDecl, srcText, signature, closing) => [
    methodOf(srcText, classDecl, signature, closing),
    methodOf(build, classDecl, signature, closing),
];

// Line `n` (1-based) of a src file contains `snippet`.
const atLine = (text, n, snippet) => {
    expect(text.split('\n')[n - 1], `line ${n}`).toContain(snippet);
};

function jsFilesUnder(rel) {
    const root = new URL(rel, THREE_ROOT);
    return readdirSync(root, { recursive: true })
        .map((p) => String(p).replace(/\\/g, '/'))
        .filter((p) => p.endsWith('.js'))
        .map((p) => ({ path: `${rel}${p}`, text: readFileSync(new URL(p, root), 'utf8') }));
}

describe('three r186 render-pipeline contract (async render pipelines)', () => {
    it('is pinned to three 0.186.1', () => {
        const why = 're-verify src/rendering/async-render-pipelines.js against the new three';
        expect(pkg.version, why).toBe('0.186.1');
    });

    it('three/webgpu exports the WebGPUBackend class whose prototype the preload resolves', () => {
        expect(srcThreeWebGPU).toContain(
            "export { default as WebGPUBackend } from './renderers/webgpu/WebGPUBackend.js';",
        );
        expect(build).toMatch(/\nexport \{[^}]*\bWebGPUBackend\b[^}]*\};/);
        inBoth(srcBackend, 'class WebGPUBackend extends Backend {');
        const bodies = bothMethods('class WebGPUBackend extends Backend {', srcBackend, CREATE_RENDER_PIPELINE);
        for (const body of bodies) {
            expect(body).toContain('this.pipelineUtils.createRenderPipeline( renderObject, promises );');
        }
    });

    describe('WebGPUPipelineUtils.createRenderPipeline(renderObject, promises)', () => {
        const [srcBody, buildBody] = bothMethods(
            'class WebGPUPipelineUtils {',
            srcPipelineUtils,
            CREATE_RENDER_PIPELINE,
        );

        it('writes the GPU pipeline into backend.get(renderObject.pipeline) — what the wrapper tracks', () => {
            for (const body of [srcBody, buildBody]) {
                expect(body).toContain('const { object, material, geometry, pipeline } = renderObject;');
                expect(body).toContain('const pipelineData = backend.get( pipeline );');
                // Only two writes to the slot: the sync create and the awaited async create.
                expect(body.match(/pipelineData\.pipeline = /g)).toHaveLength(2);
            }
        });

        it('null → sync create; otherwise async create pushed into promises, in that order', () => {
            const order = inOrder(
                /device\.pushErrorScope\( 'validation' \);/,
                adjacent(
                    /if \( promises === null \) \{/,
                    /pipelineData\.pipeline = device\.createRenderPipeline\( _renderPipelineDescriptor \);/,
                ),
                /\} else \{/,
                /pipelinePromise = device\.createRenderPipelineAsync\( _renderPipelineDescriptor \);/,
                /pipelineData\.pipeline = await pipelinePromise;/,
                // The validation scope is popped only after the compile (the misattribution window).
                /const errorScope = await device\.popErrorScope\(\);/,
                adjacent(/if \( errorScope !== null \|\| asyncError !== null \) \{/, /pipelineData\.error = true;/),
                adjacent(/\} finally \{/, /resolve\(\);/, /\}/),
                /promises\.push\( p \);/,
            );
            expect(srcBody).toMatch(order);
            expect(buildBody).toMatch(order);
        });

        it('the async promise never rejects (finally → resolve), so the wrapper needs no reject path', () => {
            for (const body of [srcBody, buildBody]) {
                expect(body).toContain('const p = new Promise( async ( resolve /*, reject*/ ) => {');
                expect(body).not.toMatch(/\breject\(/);
            }
        });

        it('the header\'s WebGPUPipelineUtils.js line numbers still point at the anchors', () => {
            atLine(srcPipelineUtils, 71, CREATE_RENDER_PIPELINE);
            atLine(srcPipelineUtils, 260, 'if ( promises === null ) {');
            atLine(srcPipelineUtils, 291, 'device.createRenderPipelineAsync( _renderPipelineDescriptor );');
            atLine(srcPipelineUtils, 315, 'const errorScope = await device.popErrorScope();');
            atLine(srcPipelineUtils, 338, 'promises.push( p );');
        });
    });

    describe('Pipelines', () => {
        it('getForRender(renderObject, promises = null) forwards promises to _getRenderPipeline', () => {
            inBoth(srcPipelines, 'getForRender( renderObject, promises = null ) {');
            inBoth(
                srcPipelines,
                'pipeline = this._getRenderPipeline( renderObject, stageVertex, stageFragment, cacheKey, promises );',
            );
        });

        it('updateForRender (the live path) passes no promises', () => {
            const re = adjacent(/updateForRender\( renderObject \) \{/, /this\.getForRender\( renderObject \);/, /\}/);
            expect(srcPipelines).toMatch(re);
            expect(build).toMatch(re);
        });

        it('_getRenderPipeline caches + sets renderObject.pipeline BEFORE backend.createRenderPipeline', () => {
            const re = adjacent(
                /this\.caches\.set\( cacheKey, pipeline \);/,
                /renderObject\.pipeline = pipeline;/,
                /this\.backend\.createRenderPipeline\( renderObject, promises \);/,
            );
            const bodies = bothMethods('class Pipelines extends DataMap {', srcPipelines, GET_RENDER_PIPELINE);
            for (const body of bodies) expect(body).toMatch(re);
        });

        it('isReady is false until the GPU pipeline slot is filled', () => {
            const bodies = bothMethods('class Pipelines extends DataMap {', srcPipelines, 'isReady( renderObject ) {');
            for (const body of bodies) {
                expect(body).toContain('if ( pipeline === undefined ) return false;');
                expect(body).toContain('const pipelineData = this.backend.get( pipeline );');
                expect(body).toContain(
                    'return pipelineData.pipeline !== undefined && pipelineData.pipeline !== null;',
                );
            }
        });

        it('the header\'s Pipelines.js line numbers still point at the anchors', () => {
            atLine(srcPipelines, 161, 'getForRender( renderObject, promises = null ) {');
            atLine(srcPipelines, 256, 'isReady( renderObject ) {');
            atLine(srcPipelines, 332, 'updateForRender( renderObject ) {');
            atLine(srcPipelines, 334, 'this.getForRender( renderObject );');
            atLine(srcPipelines, 382, GET_RENDER_PIPELINE);
            atLine(srcPipelines, 402, 'this.backend.createRenderPipeline( renderObject, promises );');
        });
    });

    it('Pipelines._getRenderPipeline is the sole caller of backend.createRenderPipeline', () => {
        const caller = /\bbackend\.createRenderPipeline\(/;
        const callers = new RegExp(caller.source, 'g');
        const hits = [...jsFilesUnder('src/'), ...jsFilesUnder('examples/jsm/')]
            .filter((f) => caller.test(f.text))
            .map((f) => f.path);
        expect(hits).toEqual(['src/renderers/common/Pipelines.js']);
        expect(srcPipelines.match(callers)).toHaveLength(1);
        expect(build.match(callers)).toHaveLength(1);
    }, 30_000); // reads ~1,175 files from node_modules/three: slow on a cold (AV-scanned) file cache

    it('Renderer._renderObjectDirect gates backend.draw on Pipelines.isReady', () => {
        const re = adjacent(
            /this\._pipelines\.updateForRender\( renderObject \);/,
            /if \( this\._pipelines\.isReady\( renderObject \) \) \{/,
            /this\.backend\.draw\( renderObject, this\.info \);/,
        );
        const bodies = bothMethods('class Renderer {', srcRenderer, RENDER_OBJECT_DIRECT);
        for (const body of bodies) expect(body).toMatch(re);
        // No other draw path in the renderer bypasses the gate.
        expect(srcRenderer.match(/\.backend\.draw\(/g)).toHaveLength(1);
        atLine(srcRenderer, 3895, 'if ( this._pipelines.isReady( renderObject ) ) {');
    });

    it('WebGPUBackend.draw returns early on pipelineData.error (what the scope repair clears)', () => {
        const re = adjacent(
            /const pipelineData = this\.get\( pipeline \);/,
            /const pipelineGPU = pipelineData\.pipeline;/,
            /if \( pipelineData\.error === true \) return;/,
        );
        const bodies = bothMethods('class WebGPUBackend extends Backend {', srcBackend, 'draw( renderObject, info ) {');
        for (const body of bodies) expect(body).toMatch(re);
        atLine(srcBackend, 2220, 'if ( pipelineData.error === true ) return;');
    });

    it('Backend exposes backend.renderer (set by init) and a stable per-object get()', () => {
        const initRe = adjacent(/async init\( renderer \) \{/, /this\.renderer = renderer;/, /\}/);
        expect(srcBackendBase).toMatch(initRe);
        expect(build).toMatch(initRe);
        atLine(srcBackendBase, 91, 'this.renderer = renderer;');
        inBoth(srcBackendBase, 'this.data = new WeakMap();');
        const getRe = adjacent(
            /let map = this\.data\.get\( object \);/,
            /if \( map === undefined \) \{/,
            /map = \{\};/,
            /this\.data\.set\( object, map \);/,
        );
        for (const body of bothMethods('class Backend {', srcBackendBase, 'get( object ) {')) {
            expect(body).toMatch(getRe);
        }
        inBoth(srcBackend, 'await super.init( renderer );');
    });

    it('a render object\'s context carries the render target the exemption inspects', () => {
        inBoth(srcRenderObject, 'this.context = renderContext;');
        inBoth(srcRenderer, 'renderContext.renderTarget = renderTarget;');
        inBoth(srcCubeRenderTarget, 'this.isCubeRenderTarget = true;');
    });

    it('PMREMGenerator._createRenderTarget marks its targets the way isOneShotRenderTarget reads them', () => {
        const bodies = bothMethods('class PMREMGenerator {', srcPmrem, PMREM_CREATE_TARGET, '\n}\n');
        for (const body of bodies) {
            expect(body).toContain('cubeUVRenderTarget.texture.mapping = CubeUVReflectionMapping;');
            expect(body).toContain("cubeUVRenderTarget.texture.name = 'PMREM.cubeUv';");
            expect(body).toContain('cubeUVRenderTarget.texture.isPMREMTexture = true;');
        }
        atLine(srcPmrem, 838, PMREM_CREATE_TARGET);
        atLine(srcPmrem, 855, 'return cubeUVRenderTarget;');
    });

    describe('final composite (isFinalComposite)', () => {
        it('QuadMesh carries the isQuadMesh flag', () => {
            inBoth(srcQuadMesh, 'this.isQuadMesh = true;');
            const quad = new QuadMesh();
            expect(quad.isQuadMesh).toBe(true);
            expect(isFinalComposite({ object: quad, context: { renderTarget: null } })).toBe(true);
        });

        it('RenderPipeline draws its output QuadMesh with no output conversion → straight to the canvas', () => {
            inBoth(srcRenderPipeline, 'this._quadMesh = new QuadMesh( material );');
            const renderRe = inOrder(
                /renderer\.toneMapping = NoToneMapping;/,
                /renderer\.outputColorSpace = ColorManagement\.workingColorSpace;/,
                /this\._quadMesh\.render\( renderer \);/,
            );
            for (const body of bothMethods('class RenderPipeline {', srcRenderPipeline, '\n\trender() {')) {
                expect(body).toMatch(renderRe);
            }
            // …and with neither tone mapping nor a colour-space change there is no framebuffer target.
            const needsTargetRe = adjacent(
                /const useToneMapping = this\.currentToneMapping !== NoToneMapping;/,
                /const useColorSpace = this\.currentColorSpace !== ColorManagement\.workingColorSpace;/,
                /return useToneMapping \|\| useColorSpace;/,
            );
            for (const body of bothMethods('class Renderer {', srcRenderer, 'get needsFrameBufferTarget() {')) {
                expect(body).toMatch(needsTargetRe);
            }
            for (const body of bothMethods('class Renderer {', srcRenderer, '_getFrameBufferTarget() {')) {
                expect(body).toContain('if ( this.needsFrameBufferTarget === false ) return null;');
            }
        });

        it('the renderer\'s own output colour-transform pass is a QuadMesh too', () => {
            inBoth(srcRenderer, 'quad = new QuadMesh( new NodeMaterial() );');
        });

        it('a canvas render context keeps renderTarget === null', () => {
            const [srcCtor, buildCtor] = bothMethods('class RenderContext {', srcRenderContext, 'constructor() {');
            for (const body of [srcCtor, buildCtor]) expect(body).toContain('this.renderTarget = null;');
            // Canvas renders get their own context ('default' attachment state)…
            const defaultRe = adjacent(/if \( renderTarget === null \) \{/, /attachmentState = 'default';/);
            expect(srcRenderContexts).toMatch(defaultRe);
            expect(build).toMatch(defaultRe);
            // …and the renderer only ever assigns a context the target it was fetched for.
            const assigns = srcRenderer.match(/renderContext\.renderTarget = [^;]+;/g);
            expect(assigns).toEqual(Array(3).fill('renderContext.renderTarget = renderTarget;'));
        });
    });

    describe('compileAsync drains (passed through, counted for an owned renderer)', () => {
        it('the drain hands each object a fresh promises array and awaits it', () => {
            const re = adjacent(
                /const pipelinePromises = \[\];/,
                /this\._pipelines\.getForRender\( renderObject, pipelinePromises \);/,
                /if \( pipelinePromises\.length > 0 \) \{/,
                /await Promise\.all\( pipelinePromises \);/,
            );
            expect(srcRenderer).toMatch(re);
            expect(build).toMatch(re);
        });

        it('during compileAsync the live path only queues work items; otherwise it passes null', () => {
            const re = inOrder(
                /if \( this\._compilationPromises !== null \) \{/,
                /this\._compilationPromises\.push\( \{/,
                /return;/,
                /this\._pipelines\.getForRender\( renderObject, this\._compilationPromises \);/,
            );
            const signature = '_createObjectPipeline( object, material, scene, camera, lightsNode, group, '
                + 'clippingContext, passId ) {';
            for (const body of bothMethods('class Renderer {', srcRenderer, signature)) {
                expect(body).toMatch(re);
            }
        });
    });

    it('CubeUVReflectionMapping is still 306 (the wrapper hard-codes it)', () => {
        expect(srcConstants).toContain('export const CubeUVReflectionMapping = 306;');
        expect(buildCore).toContain('const CubeUVReflectionMapping = 306;');
        expect(CubeUVReflectionMapping).toBe(306);
        expect(isOneShotRenderTarget({ texture: { mapping: CubeUVReflectionMapping } })).toBe(true);
    });
});
