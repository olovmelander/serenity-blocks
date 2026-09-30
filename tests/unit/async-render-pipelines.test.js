import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import WebGPUBackend from 'three/src/renderers/webgpu/WebGPUBackend.js';
import {
    resetAsyncRenderPipelinesForTests,
    adoptRendererForTheme,
    beginAsyncRenderPipelines,
    getAsyncRenderPipelineDiagnostics,
    isAsyncPipelineBackend,
    isAsyncRenderPipelinesReady,
    isFinalComposite,
    isOneShotRenderTarget,
    preloadAsyncRenderPipelines,
} from '../../src/rendering/async-render-pipelines.js';

// Behaviour of the loading-surface async render-pipeline sessions
// (src/rendering/async-render-pipelines.js) against a fake backend class injected through
// preloadAsyncRenderPipelines(). The fake's createRenderPipeline mirrors the r185
// WebGPUPipelineUtils contract pinned in async-render-pipelines-contract.test.js:
//   promises === null → synchronous create: the pipeline slot is filled before it returns;
//   promises array    → async create: the slot fills when the compile resolves, `error` is set
//                       from the held-open validation scope (or the async rejection), and the
//                       promise pushed into `promises` ALWAYS resolves (three's finally/resolve).

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

// Let every queued promise chain (fake compile → wrapper bookkeeping) run to completion.
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function makeFakeBackendClass() {
    const calls = [];
    const pending = [];

    function createRenderPipeline(renderObject, promises) {
        calls.push({ self: this, renderObject, promises });
        const pipelineData = this.get(renderObject.pipeline);
        if (promises === null) {
            pipelineData.pipeline = { kind: 'sync-gpu-pipeline' };
            return;
        }
        const compile = deferred();
        pending.push({ pipelineData, renderObject, finish: compile.resolve });
        // finish({ pipeline }) = createRenderPipelineAsync resolved; finish({ pipeline: null }) = it
        // rejected; scopeError = another GPU call's validation error landed in the open scope.
        promises.push(compile.promise.then(({ pipeline = null, scopeError = false } = {}) => {
            if (pipeline) pipelineData.pipeline = pipeline;
            if (scopeError || !pipeline) pipelineData.error = true;
        }));
    }

    class FakeWebGPUBackend {
        constructor(renderer = null) {
            this.renderer = renderer; // Backend.init(renderer) → this.renderer = renderer
            this.data = new WeakMap();
        }

        get(object) {
            let map = this.data.get(object);
            if (map === undefined) {
                map = {};
                this.data.set(object, map);
            }
            return map;
        }
    }
    FakeWebGPUBackend.prototype.createRenderPipeline = createRenderPipeline;

    return {
        FakeWebGPUBackend, original: createRenderPipeline, calls, pending,
    };
}

let nextPipelineId = 1;
const renderObjectFor = (renderTarget = null) => ({
    pipeline: { id: nextPipelineId++ },
    context: { renderTarget },
});
const makeRenderer = (label) => ({ label, domElement: null });
const makeTheme = (name) => ({ name, renderer: makeRenderer(`${name}-renderer`) });
const lastCall = (fake) => fake.calls[fake.calls.length - 1];

describe('async-render-pipelines', () => {
    let warnSpy;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        resetAsyncRenderPipelinesForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('before the backend prototype is preloaded', () => {
        it('begin returns null (it is synchronous and never waits for the loader)', () => {
            const fake = makeFakeBackendClass();
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
            expect(fake.FakeWebGPUBackend.prototype.createRenderPipeline).toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
        });

        it('begin returns null while the loader is still pending', async () => {
            const fake = makeFakeBackendClass();
            const loaded = deferred();
            const ready = preloadAsyncRenderPipelines(() => loaded.promise);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
            loaded.resolve({ WebGPUBackend: fake.FakeWebGPUBackend });
            await expect(ready).resolves.toBe(fake.FakeWebGPUBackend.prototype);
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            expect(session).not.toBeNull();
            session.end();
        });

        it('a failed or empty load resolves null and sessions stay off', async () => {
            await expect(preloadAsyncRenderPipelines(() => Promise.reject(new Error('no webgpu'))))
                .resolves.toBeNull();
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
            resetAsyncRenderPipelinesForTests();
            await expect(preloadAsyncRenderPipelines(() => Promise.resolve({}))).resolves.toBeNull();
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
        });

        it('isAsyncRenderPipelinesReady is false until the preload RESOLVES, and again after a reset', async () => {
            const fake = makeFakeBackendClass();
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            const loaded = deferred();
            const ready = preloadAsyncRenderPipelines(() => loaded.promise);
            // Requested is not ready: a caller gating a synchronous begin() on this must not
            // see true while begin() would still return null.
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();

            loaded.resolve({ WebGPUBackend: fake.FakeWebGPUBackend });
            await ready;
            expect(isAsyncRenderPipelinesReady()).toBe(true);
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            expect(session).not.toBeNull();

            resetAsyncRenderPipelinesForTests();
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            expect(session.active).toBe(false);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
        });

        it('a preload still in flight at a reset never marks the module ready after it', async () => {
            const fake = makeFakeBackendClass();
            const loaded = deferred();
            const loader = vi.fn(() => loaded.promise);
            const stale = preloadAsyncRenderPipelines(loader);
            await Promise.resolve(); // the loader starts on a microtask
            expect(loader).toHaveBeenCalledTimes(1);

            resetAsyncRenderPipelinesForTests();
            loaded.resolve({ WebGPUBackend: fake.FakeWebGPUBackend });

            // Its own caller still gets what the loader produced...
            await expect(stale).resolves.toBe(fake.FakeWebGPUBackend.prototype);
            await flush();
            // ...but the state it would have set was reset under it.
            expect(isAsyncRenderPipelinesReady()).toBe(false);
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull();
            expect(fake.FakeWebGPUBackend.prototype.createRenderPipeline).toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
        });

        it('a preload after a reset starts fresh, and a stale one landing late cannot clobber it', async () => {
            const stale = makeFakeBackendClass();
            const fresh = makeFakeBackendClass();
            const staleLoad = deferred();
            const stalePromise = preloadAsyncRenderPipelines(() => staleLoad.promise);
            resetAsyncRenderPipelinesForTests();

            const freshLoader = vi.fn(() => Promise.resolve({ WebGPUBackend: fresh.FakeWebGPUBackend }));
            await expect(preloadAsyncRenderPipelines(freshLoader))
                .resolves.toBe(fresh.FakeWebGPUBackend.prototype);
            expect(freshLoader).toHaveBeenCalledTimes(1); // not the memoized stale promise
            expect(isAsyncRenderPipelinesReady()).toBe(true);

            staleLoad.resolve({ WebGPUBackend: stale.FakeWebGPUBackend });
            await stalePromise;
            await flush();

            expect(isAsyncRenderPipelinesReady()).toBe(true);
            // Sessions install on the fresh prototype, never on the stale one.
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            expect(session).not.toBeNull();
            expect(fresh.FakeWebGPUBackend.prototype.createRenderPipeline).not.toBe(fresh.original);
            expect(stale.FakeWebGPUBackend.prototype.createRenderPipeline).toBe(stale.original);
            session.end();
        });

        it.each([
            ['fails', (settleStale) => settleStale.reject(new Error('stale import failed'))],
            ['resolves without a WebGPUBackend', (settleStale) => settleStale.resolve({})],
        ])('a stale preload that %s after a reset does not un-ready a fresh one', async (_label, finishStale) => {
            const fresh = makeFakeBackendClass();
            const settleStale = {};
            const stalePromise = preloadAsyncRenderPipelines(() => new Promise((resolve, reject) => {
                Object.assign(settleStale, { resolve, reject });
            }));
            await Promise.resolve(); // the stale loader has started
            resetAsyncRenderPipelinesForTests();
            await preloadAsyncRenderPipelines(() => Promise.resolve({ WebGPUBackend: fresh.FakeWebGPUBackend }));
            expect(isAsyncRenderPipelinesReady()).toBe(true);

            finishStale(settleStale);
            await expect(stalePromise).resolves.toBeNull();
            await flush();

            expect(isAsyncRenderPipelinesReady()).toBe(true);
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            expect(session).not.toBeNull();
            session.end();
        });

        it('an explicit backendProto option starts a session without preloading', () => {
            const fake = makeFakeBackendClass();
            const proto = fake.FakeWebGPUBackend.prototype;
            const session = beginAsyncRenderPipelines(makeTheme('forest'), { backendProto: proto });
            expect(session).not.toBeNull();
            expect(proto.createRenderPipeline).not.toBe(fake.original);
            session.end();
            expect(proto.createRenderPipeline).toBe(fake.original);
        });

        it('a prototype without createRenderPipeline is refused', () => {
            expect(beginAsyncRenderPipelines(makeTheme('forest'), { backendProto: {} })).toBeNull();
            expect(getAsyncRenderPipelineDiagnostics().installed).toBe(false);
        });
    });

    describe('with a preloaded fake WebGPUBackend', () => {
        let fake;
        let proto;

        beforeEach(async () => {
            fake = makeFakeBackendClass();
            proto = await preloadAsyncRenderPipelines(
                () => Promise.resolve({ WebGPUBackend: fake.FakeWebGPUBackend }),
            );
        });

        it('preload resolves the injected prototype once (memoized)', async () => {
            expect(proto).toBe(fake.FakeWebGPUBackend.prototype);
            const otherLoader = vi.fn(() => Promise.resolve({ WebGPUBackend: { prototype: {} } }));
            await expect(preloadAsyncRenderPipelines(otherLoader)).resolves.toBe(proto);
            expect(otherLoader).not.toHaveBeenCalled();
        });

        it('with no session the prototype is untouched and creation stays synchronous', () => {
            expect(proto.createRenderPipeline).toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
            const backend = new fake.FakeWebGPUBackend(makeRenderer('r'));
            expect(isAsyncPipelineBackend(backend)).toBe(false);
            const renderObject = renderObjectFor();
            backend.createRenderPipeline(renderObject, null);
            expect(lastCall(fake).promises).toBeNull();
            expect(backend.get(renderObject.pipeline).pipeline).toEqual({ kind: 'sync-gpu-pipeline' });
            const arr = [];
            backend.createRenderPipeline(renderObjectFor(), arr);
            expect(lastCall(fake).promises).toBe(arr);
        });

        it('begin wraps the prototype; the last end restores the exact original', () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            expect(session).toMatchObject({ label: 'forest', active: true, engaged: false });
            expect(proto.createRenderPipeline).not.toBe(fake.original);
            expect(proto.createRenderPipeline.name).toBe('serenityAsyncCreateRenderPipeline');
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: true, sessions: 1 });
            expect(isAsyncPipelineBackend(new fake.FakeWebGPUBackend())).toBe(true);
            expect(isAsyncPipelineBackend({ createRenderPipeline() {} })).toBe(false);
            expect(isAsyncPipelineBackend(null)).toBe(false);

            const stats = session.end();
            expect(stats).toEqual({
                async: 0, syncExempt: 0, failed: 0, errorScopeRepaired: 0, maxInFlight: 0, inFlight: 0,
            });
            expect(session.active).toBe(false);
            expect(proto.createRenderPipeline).toBe(fake.original);
            expect(Object.prototype.hasOwnProperty.call(proto, 'createRenderPipeline')).toBe(true);
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
            expect(isAsyncPipelineBackend(new fake.FakeWebGPUBackend())).toBe(false);
            // end() is idempotent and keeps reporting the stats.
            expect(session.end()).toEqual(stats);
        });

        it('honours a custom label and refuses a second, different prototype while installed', () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'), { label: 'loading:forest' });
            expect(session.label).toBe('loading:forest');
            const other = makeFakeBackendClass();
            const refused = beginAsyncRenderPipelines(makeTheme('aurora'), {
                backendProto: other.FakeWebGPUBackend.prototype,
            });
            expect(refused).toBeNull();
            expect(other.FakeWebGPUBackend.prototype.createRenderPipeline).toBe(other.original);
            expect(beginAsyncRenderPipelines(null)).toBeNull();
            session.end();
        });

        it('an owned renderer\'s live create (promises = null) goes async and is tracked', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            const renderObject = renderObjectFor();

            expect(backend.createRenderPipeline(renderObject, null)).toBeUndefined();
            const call = lastCall(fake);
            expect(call.self).toBe(backend);
            expect(call.renderObject).toBe(renderObject);
            expect(Array.isArray(call.promises)).toBe(true);
            expect(call.promises).toHaveLength(1);
            // Pipelines.isReady would be false: the GPU pipeline slot is still empty.
            expect(backend.get(renderObject.pipeline).pipeline).toBeUndefined();
            expect(session.stats.async).toBe(1);
            expect(session.engaged).toBe(true);
            expect(session.inFlight).toBe(1);
            expect(theme.asyncPipelinesInFlight).toBe(1);

            const second = renderObjectFor();
            backend.createRenderPipeline(second, null);
            expect(session.inFlight).toBe(2);
            expect(session.stats.maxInFlight).toBe(2);

            const gpuPipeline = { kind: 'gpu-render-pipeline' };
            fake.pending[0].finish({ pipeline: gpuPipeline });
            await flush();
            expect(backend.get(renderObject.pipeline).pipeline).toBe(gpuPipeline);
            expect(session.inFlight).toBe(1);
            expect(theme.asyncPipelinesInFlight).toBe(1);

            fake.pending[1].finish({ pipeline: { kind: 'gpu-render-pipeline-2' } });
            await flush();
            expect(session.inFlight).toBe(0);
            expect(theme.asyncPipelinesInFlight).toBe(0);
            expect(session.end()).toMatchObject({
                async: 2, failed: 0, errorScopeRepaired: 0, maxInFlight: 2, inFlight: 0,
            });
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(0);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('an unowned renderer stays synchronous and is counted', () => {
            const theme = makeTheme('forest');
            const session = beginAsyncRenderPipelines(theme);
            const stranger = new fake.FakeWebGPUBackend(makeRenderer('intro-renderer'));
            const renderObject = renderObjectFor();
            stranger.createRenderPipeline(renderObject, null);
            expect(lastCall(fake).promises).toBeNull();
            expect(stranger.get(renderObject.pipeline).pipeline).toEqual({ kind: 'sync-gpu-pipeline' });

            const uninitialised = new fake.FakeWebGPUBackend(null); // backend.renderer not set yet
            uninitialised.createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();

            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(2);
            expect(session.stats.async).toBe(0);
            expect(session.inFlight).toBe(0);
            expect(theme.asyncPipelinesInFlight).toBeUndefined();
        });

        it('passes a compileAsync drain\'s array through; an owned drain is counted until it lands', async () => {
            const theme = makeTheme('forest');
            const session = beginAsyncRenderPipelines(theme);
            const owned = new fake.FakeWebGPUBackend(theme.renderer);
            session.noteFrame();
            session.noteFrame();

            // Entries already in the caller's array are not ours to count, only what this create pushes.
            const workItem = { queued: 'compileAsync work item' };
            const arr = [workItem];
            const renderObject = renderObjectFor();
            owned.createRenderPipeline(renderObject, arr);
            expect(lastCall(fake).promises).toBe(arr); // the caller's own array, not a sink
            expect(arr).toHaveLength(2);
            expect(arr[0]).toBe(workItem);
            expect(session.stats.async).toBe(1);
            expect(session.inFlight).toBe(1);
            expect(theme.asyncPipelinesInFlight).toBe(1);
            expect(session.lastCreateFrame).toBe(2);
            expect(session.isQuiet(0)).toBe(false); // the theme's own drain has not landed yet

            fake.pending[0].finish({ pipeline: { kind: 'drained' } });
            await expect(Promise.all(arr.slice(1))).resolves.toBeDefined(); // what compileAsync awaits
            await flush();
            expect(owned.get(renderObject.pipeline).pipeline).toEqual({ kind: 'drained' });
            expect(session.inFlight).toBe(0);
            expect(theme.asyncPipelinesInFlight).toBe(0);
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(0);
        });

        it('an unowned drain passes through uncounted (and is not an unowned SYNC create)', () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            const idle = new fake.FakeWebGPUBackend(makeRenderer('other'));
            const arr = [];
            idle.createRenderPipeline(renderObjectFor(), arr);
            expect(lastCall(fake).promises).toBe(arr);
            expect(arr).toHaveLength(1);
            expect(session.stats.async).toBe(0);
            expect(session.inFlight).toBe(0);
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(0);
        });

        it('an omitted promises argument is treated like the live path\'s null', () => {
            const theme = makeTheme('forest');
            const session = beginAsyncRenderPipelines(theme);
            new fake.FakeWebGPUBackend(theme.renderer).createRenderPipeline(renderObjectFor());
            expect(Array.isArray(lastCall(fake).promises)).toBe(true); // owned → async
            new fake.FakeWebGPUBackend(makeRenderer('other')).createRenderPipeline(renderObjectFor());
            expect(lastCall(fake).promises).toBeNull(); // unowned → normalised to null, sync
            expect(session.stats.async).toBe(1);
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(1);
        });

        it('PMREM and cube bake targets stay synchronous (syncExempt)', () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            const bakeTargets = [
                { isCubeRenderTarget: true, texture: { name: '' } },
                { texture: { isPMREMTexture: true } },
                { texture: { mapping: 306 } }, // CubeUVReflectionMapping
                { texture: { name: 'PMREM.cubeUv' } },
                { texture: { name: 'PMREM.pingPong' } },
            ];
            for (const rt of bakeTargets) {
                const renderObject = renderObjectFor(rt);
                backend.createRenderPipeline(renderObject, null);
                expect(lastCall(fake).promises).toBeNull();
                expect(backend.get(renderObject.pipeline).pipeline).toEqual({ kind: 'sync-gpu-pipeline' });
            }
            expect(session.stats.syncExempt).toBe(bakeTargets.length);
            expect(session.stats.async).toBe(0);

            // An ordinary offscreen target (post-processing, mirrors) still goes async.
            backend.createRenderPipeline(renderObjectFor({ texture: { name: 'bloom', mapping: 300 } }), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            // A render object without a context (defensive) is treated as a canvas render.
            backend.createRenderPipeline({ pipeline: { id: 'no-context' } }, null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(session.stats.async).toBe(2);
        });

        it('the final composite quad to the canvas stays synchronous; offscreen quads go async', () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            const quad = { isQuadMesh: true, name: 'Render Pipeline' };

            const composite = { ...renderObjectFor(null), object: quad };
            backend.createRenderPipeline(composite, null);
            expect(lastCall(fake).promises).toBeNull();
            expect(backend.get(composite.pipeline).pipeline).toEqual({ kind: 'sync-gpu-pipeline' });
            expect(session.stats.syncExempt).toBe(1);

            // The same quad into a post-processing target (a bloom/blur pass) is not the composite.
            backend.createRenderPipeline({ ...renderObjectFor({ texture: { name: 'bloom' } }), object: quad }, null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            // A scene mesh drawn straight to the canvas is not a composite either.
            backend.createRenderPipeline({ ...renderObjectFor(null), object: { isMesh: true } }, null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(session.stats).toMatchObject({ syncExempt: 1, async: 2 });
        });

        it('isFinalComposite matches only a QuadMesh with no render target', () => {
            expect(isFinalComposite(null)).toBe(false);
            expect(isFinalComposite(undefined)).toBe(false);
            expect(isFinalComposite({})).toBe(false);
            expect(isFinalComposite({ object: { isQuadMesh: 'yes' }, context: { renderTarget: null } })).toBe(false);
            expect(isFinalComposite({ object: { isMesh: true }, context: { renderTarget: null } })).toBe(false);
            expect(isFinalComposite({ object: { isQuadMesh: true }, context: { renderTarget: {} } })).toBe(false);
            expect(isFinalComposite({ object: { isQuadMesh: true }, context: { renderTarget: null } })).toBe(true);
            expect(isFinalComposite({ object: { isQuadMesh: true }, context: {} })).toBe(true);
        });

        it('isOneShotRenderTarget recognises only PMREM / cube-UV / cube targets', () => {
            expect(isOneShotRenderTarget(null)).toBe(false);
            expect(isOneShotRenderTarget(undefined)).toBe(false);
            expect(isOneShotRenderTarget({})).toBe(false);
            expect(isOneShotRenderTarget({ texture: null })).toBe(false);
            expect(isOneShotRenderTarget({ texture: { name: 'scene', mapping: 300 } })).toBe(false);
            expect(isOneShotRenderTarget({ texture: { name: 42 } })).toBe(false);
            expect(isOneShotRenderTarget({ texture: { name: 'my-PMREM' } })).toBe(false);
            expect(isOneShotRenderTarget({ isCubeRenderTarget: true })).toBe(true);
            expect(isOneShotRenderTarget({ texture: { isPMREMTexture: true } })).toBe(true);
            expect(isOneShotRenderTarget({ texture: { mapping: 306 } })).toBe(true);
            expect(isOneShotRenderTarget({ texture: { name: 'PMREM.cubeUv' } })).toBe(true);
        });

        it('repairs a validation error that other GPU work left in a resolved pipeline\'s scope', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme, { label: 'loading:forest' });
            const renderObject = renderObjectFor();
            backend.createRenderPipeline(renderObject, null);
            const gpuPipeline = { kind: 'gpu-render-pipeline' };
            fake.pending[0].finish({ pipeline: gpuPipeline, scopeError: true });
            await flush();
            const data = backend.get(renderObject.pipeline);
            expect(data.pipeline).toBe(gpuPipeline);
            expect(data.error).toBe(false); // WebGPUBackend.draw returns early on error === true
            expect(session.stats.errorScopeRepaired).toBe(1);
            expect(session.stats.failed).toBe(0);
            expect(session.inFlight).toBe(0);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toContain('loading:forest');
        });

        it('counts a rejected async create as failed and leaves its error flag set', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            const renderObject = renderObjectFor();
            backend.createRenderPipeline(renderObject, null);
            fake.pending[0].finish({ pipeline: null });
            await flush();
            const data = backend.get(renderObject.pipeline);
            expect(data.pipeline).toBeUndefined();
            expect(data.error).toBe(true);
            expect(session.stats.failed).toBe(1);
            expect(session.stats.errorScopeRepaired).toBe(0);
            expect(session.inFlight).toBe(0);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('a clean resolve neither repairs nor fails', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            const renderObject = renderObjectFor();
            backend.createRenderPipeline(renderObject, null);
            fake.pending[0].finish({ pipeline: { kind: 'ok' } });
            await flush();
            expect(backend.get(renderObject.pipeline).error).toBeUndefined();
            expect(session.stats).toMatchObject({ failed: 0, errorScopeRepaired: 0, async: 1 });
        });

        it('a tracked promise that REJECTS lands: failed, in-flight back to 0, no unhandled rejection', async () => {
            const unhandled = [];
            const onUnhandled = (reason) => { unhandled.push(reason); };
            process.on('unhandledRejection', onUnhandled);
            try {
                const theme = makeTheme('forest');
                const backend = new fake.FakeWebGPUBackend(theme.renderer);
                // Other code layered under ours (installed before the session) adds its own promise
                // to the compileAsync array it forwards. three's promise always resolves; this one
                // rejects.
                const threeCreate = proto.createRenderPipeline;
                proto.createRenderPipeline = function instrumentedCreateRenderPipeline(renderObject, promises) {
                    const result = threeCreate.call(this, renderObject, promises);
                    if (promises) promises.push(Promise.reject(new Error('instrumentation gave up')));
                    return result;
                };
                const session = beginAsyncRenderPipelines(theme);

                const arr = [];
                backend.createRenderPipeline(renderObjectFor(), arr);
                expect(arr).toHaveLength(2);
                expect(session.stats.async).toBe(2);
                expect(session.inFlight).toBe(2);

                await flush();
                await flush();
                // The rejection landed; three's compile is still in flight.
                expect(session.stats.failed).toBe(1);
                expect(session.inFlight).toBe(1);
                expect(theme.asyncPipelinesInFlight).toBe(1);

                fake.pending[0].finish({ pipeline: { kind: 'gpu' } });
                await flush();
                expect(session.inFlight).toBe(0);
                expect(theme.asyncPipelinesInFlight).toBe(0);
                expect(session.isQuiet(0)).toBe(true); // not "busy forever"
                expect(session.stats).toMatchObject({ async: 2, failed: 1, errorScopeRepaired: 0 });
                expect(unhandled).toEqual([]);
                expect(warnSpy).not.toHaveBeenCalled();
            } finally {
                process.off('unhandledRejection', onUnhandled);
            }
        });

        it('ref-counts concurrent sessions and attributes each create to its owner', async () => {
            const forest = makeTheme('forest');
            const aurora = makeTheme('aurora');
            const forestBackend = new fake.FakeWebGPUBackend(forest.renderer);
            const auroraBackend = new fake.FakeWebGPUBackend(aurora.renderer);
            const a = beginAsyncRenderPipelines(forest);
            const b = beginAsyncRenderPipelines(aurora);
            const wrapped = proto.createRenderPipeline;
            expect(wrapped).not.toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics().sessions).toBe(2);

            forestBackend.createRenderPipeline(renderObjectFor(), null);
            auroraBackend.createRenderPipeline(renderObjectFor(), null);
            auroraBackend.createRenderPipeline(renderObjectFor(), null);
            expect(a.stats.async).toBe(1);
            expect(b.stats.async).toBe(2);
            expect(forest.asyncPipelinesInFlight).toBe(1);
            expect(aurora.asyncPipelinesInFlight).toBe(2);

            a.end();
            expect(proto.createRenderPipeline).toBe(wrapped); // b still needs the wrapper
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: true, sessions: 1 });
            forestBackend.createRenderPipeline(renderObjectFor(), null); // forest no longer owned
            expect(lastCall(fake).promises).toBeNull();
            auroraBackend.createRenderPipeline(renderObjectFor(), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(b.stats.async).toBe(3);

            b.end();
            expect(proto.createRenderPipeline).toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });

            // Tails still settle the per-theme counters after the sessions ended.
            fake.pending.forEach((p) => p.finish({ pipeline: { kind: 'late' } }));
            await flush();
            expect(forest.asyncPipelinesInFlight).toBe(0);
            expect(aurora.asyncPipelinesInFlight).toBe(0);
        });

        it('shares the in-flight count per theme: a prewarm tail holds a later session busy', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const prewarm = beginAsyncRenderPipelines(theme, { label: 'prewarm:forest' });
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(prewarm.end()).toMatchObject({ async: 1, inFlight: 1 });
            expect(proto.createRenderPipeline).toBe(fake.original);

            const loading = beginAsyncRenderPipelines(theme, { label: 'loading:forest' });
            expect(loading.inFlight).toBe(1);
            expect(loading.engaged).toBe(false);
            for (let i = 0; i < 20; i++) loading.noteFrame();
            expect(loading.isQuiet(6)).toBe(false);
            fake.pending[0].finish({ pipeline: { kind: 'late' } });
            await flush();
            expect(loading.inFlight).toBe(0);
            expect(theme.asyncPipelinesInFlight).toBe(0);
            expect(loading.isQuiet(6)).toBe(true);
            loading.end();
        });

        it('two sessions own one renderer: creates are tracked on the NEWEST active one', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const prewarm = beginAsyncRenderPipelines(theme, { label: 'prewarm:forest' }); // retained
            const loading = beginAsyncRenderPipelines(theme, { label: 'loading:forest' });
            for (let i = 0; i < 3; i++) loading.noteFrame();

            backend.createRenderPipeline(renderObjectFor(), null);
            expect(loading.stats.async).toBe(1);
            expect(loading.engaged).toBe(true);
            expect(loading.lastCreateFrame).toBe(3);
            expect(prewarm.stats.async).toBe(0);
            expect(prewarm.engaged).toBe(false);
            expect(prewarm.lastCreateFrame).toBe(-1);

            // A compileAsync drain on that renderer is attributed the same way.
            backend.createRenderPipeline(renderObjectFor(), []);
            expect(loading.stats.async).toBe(2);
            expect(prewarm.stats.async).toBe(0);
            expect(loading.inFlight).toBe(2); // shared per theme, so both sessions read it
            expect(prewarm.inFlight).toBe(2);

            // Landed, but the loading session still waits out its window since ITS last create.
            fake.pending.forEach((p) => p.finish({ pipeline: { kind: 'gpu' } }));
            await flush();
            expect(loading.isQuiet(3)).toBe(false);
            for (let i = 0; i < 3; i++) loading.noteFrame();
            expect(loading.isQuiet(3)).toBe(true);

            // Once the newer session ends, the retained older one owns the renderer again.
            loading.end();
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(prewarm.stats.async).toBe(1);
            expect(loading.stats.async).toBe(2);
            prewarm.end();
        });

        it('leaves a wrapper installed over ours in place; ours stays a pass-through in the chain', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const first = beginAsyncRenderPipelines(theme);
            const ours = proto.createRenderPipeline;
            const outerCalls = [];
            function thirdPartyCreateRenderPipeline(renderObject, promises) {
                outerCalls.push(promises);
                return ours.call(this, renderObject, promises);
            }
            proto.createRenderPipeline = thirdPartyCreateRenderPipeline;

            first.end();
            expect(proto.createRenderPipeline).toBe(thirdPartyCreateRenderPipeline); // not clobbered
            expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });

            // No session: the stale wrapper is inert (and normalises an omitted argument to null).
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            backend.createRenderPipeline(renderObjectFor());
            expect(lastCall(fake).promises).toBeNull();
            expect(backend.createRenderPipeline(renderObjectFor(), null)).toBeUndefined();
            const arr = [];
            backend.createRenderPipeline(renderObjectFor(), arr);
            expect(lastCall(fake).promises).toBe(arr);

            // A later session wraps the third-party wrapper; the owned create reaches the real
            // create exactly once, async, and its pipeline lands.
            const second = beginAsyncRenderPipelines(theme);
            expect(proto.createRenderPipeline).not.toBe(thirdPartyCreateRenderPipeline);
            const renderObject = renderObjectFor();
            const callsBefore = fake.calls.length;
            backend.createRenderPipeline(renderObject, null);
            expect(fake.calls.length).toBe(callsBefore + 1);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(lastCall(fake).promises).toHaveLength(1);
            expect(outerCalls[outerCalls.length - 1]).toBe(lastCall(fake).promises);
            // The stale inner copy of ours sees the array the outer copy forwards, but the
            // module-level re-entrancy guard makes it a pass-through: counted exactly once.
            expect(second.stats).toMatchObject({ async: 1, maxInFlight: 1 });
            expect(second.inFlight).toBe(1);
            expect(theme.asyncPipelinesInFlight).toBe(1);
            fake.pending[fake.pending.length - 1].finish({ pipeline: { kind: 'gpu' } });
            await flush();
            expect(backend.get(renderObject.pipeline).pipeline).toEqual({ kind: 'gpu' });
            expect(second.inFlight).toBe(0);
            expect(theme.asyncPipelinesInFlight).toBe(0);

            second.end();
            expect(proto.createRenderPipeline).toBe(thirdPartyCreateRenderPipeline);
        });

        it('two copies of our wrapper in one chain count every kind of create exactly once', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            // Chain: ours (new session) → third party → ours (stale, left by the first session) → three.
            const first = beginAsyncRenderPipelines(theme);
            const staleOurs = proto.createRenderPipeline;
            proto.createRenderPipeline = function thirdPartyCreateRenderPipeline(renderObject, promises) {
                return staleOurs.call(this, renderObject, promises);
            };
            first.end();
            const session = beginAsyncRenderPipelines(theme);
            expect(proto.createRenderPipeline.name).toBe('serenityAsyncCreateRenderPipeline');
            expect(proto.createRenderPipeline).not.toBe(staleOurs);

            // Owned live create: one real create, one tracked promise.
            const callsBefore = fake.calls.length;
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(fake.calls.length).toBe(callsBefore + 1);
            expect(lastCall(fake).promises).toHaveLength(1);
            expect(session.stats).toMatchObject({ async: 1, maxInFlight: 1 });
            expect(session.inFlight).toBe(1);
            expect(theme.asyncPipelinesInFlight).toBe(1);

            // Owned compileAsync drain: the caller's array is also counted once (and the guard was
            // released after the previous create, or this would not be counted at all).
            const arr = [];
            backend.createRenderPipeline(renderObjectFor(), arr);
            expect(arr).toHaveLength(1);
            expect(session.stats.async).toBe(2);
            expect(session.inFlight).toBe(2);
            expect(theme.asyncPipelinesInFlight).toBe(2);

            // Unowned sync create: one diagnostic count.
            new fake.FakeWebGPUBackend(makeRenderer('intro-renderer')).createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(1);

            // PMREM / cube bakes and the final composite: one syncExempt each.
            backend.createRenderPipeline(renderObjectFor({ texture: { isPMREMTexture: true } }), null);
            expect(lastCall(fake).promises).toBeNull();
            expect(session.stats.syncExempt).toBe(1);
            backend.createRenderPipeline(renderObjectFor({ isCubeRenderTarget: true }), null);
            expect(session.stats.syncExempt).toBe(2);
            backend.createRenderPipeline({ ...renderObjectFor(null), object: { isQuadMesh: true } }, null);
            expect(lastCall(fake).promises).toBeNull();
            expect(session.stats.syncExempt).toBe(3);
            expect(session.stats.async).toBe(2);

            fake.pending.forEach((p) => p.finish({ pipeline: { kind: 'gpu' } }));
            await flush();
            expect(theme.asyncPipelinesInFlight).toBe(0);
            expect(session.end()).toEqual({
                async: 2, syncExempt: 3, failed: 0, errorScopeRepaired: 0, maxInFlight: 2, inFlight: 0,
            });
        });

        it('a create that throws releases the re-entrancy guard', () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            backend.get = () => { throw new Error('device lost'); };
            expect(() => backend.createRenderPipeline(renderObjectFor(), null)).toThrow('device lost');
            expect(session.stats.async).toBe(0);
            delete backend.get; // back to the prototype's get

            // A guard left set would turn every later create into a synchronous pass-through.
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(session.stats.async).toBe(1);
            expect(session.inFlight).toBe(1);
        });

        it('onEngaged fires once, on a microtask, at the first async create — never for sync ones', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const stranger = new fake.FakeWebGPUBackend(makeRenderer('intro-renderer'));
            const session = beginAsyncRenderPipelines(theme);
            const onEngaged = vi.fn();
            session.onEngaged(onEngaged);

            stranger.createRenderPipeline(renderObjectFor(), null); // unowned sync
            stranger.createRenderPipeline(renderObjectFor(), []); // unowned drain
            backend.createRenderPipeline(renderObjectFor({ texture: { isPMREMTexture: true } }), null);
            backend.createRenderPipeline(renderObjectFor({ isCubeRenderTarget: true }), null);
            backend.createRenderPipeline({ ...renderObjectFor(null), object: { isQuadMesh: true } }, null);
            await flush();
            expect(session.stats.syncExempt).toBe(3);
            expect(session.engaged).toBe(false);
            expect(onEngaged).not.toHaveBeenCalled();

            backend.createRenderPipeline(renderObjectFor(), null);
            expect(session.engaged).toBe(true);
            expect(onEngaged).not.toHaveBeenCalled(); // never re-entrantly inside createRenderPipeline
            await Promise.resolve();
            expect(onEngaged).toHaveBeenCalledTimes(1);

            backend.createRenderPipeline(renderObjectFor(), null);
            backend.createRenderPipeline(renderObjectFor(), []);
            await flush();
            expect(onEngaged).toHaveBeenCalledTimes(1);

            // Already engaged: a late listener still runs, once, on a microtask.
            const late = vi.fn();
            session.onEngaged(late);
            expect(late).not.toHaveBeenCalled();
            await Promise.resolve();
            expect(late).toHaveBeenCalledTimes(1);
            await flush();
            expect(late).toHaveBeenCalledTimes(1);
            expect(onEngaged).toHaveBeenCalledTimes(1);
        });

        it('onEngaged is per session, and an owned compileAsync drain engages it', async () => {
            const forest = makeTheme('forest');
            const aurora = makeTheme('aurora');
            const forestSession = beginAsyncRenderPipelines(forest);
            const auroraSession = beginAsyncRenderPipelines(aurora);
            const forestEngaged = vi.fn();
            const auroraEngaged = vi.fn();
            forestSession.onEngaged(forestEngaged);
            auroraSession.onEngaged(auroraEngaged);

            new fake.FakeWebGPUBackend(aurora.renderer).createRenderPipeline(renderObjectFor(), []);
            await Promise.resolve();
            expect(auroraEngaged).toHaveBeenCalledTimes(1);
            expect(forestEngaged).not.toHaveBeenCalled();

            new fake.FakeWebGPUBackend(forest.renderer).createRenderPipeline(renderObjectFor(), null);
            await flush();
            expect(forestEngaged).toHaveBeenCalledTimes(1);
            expect(auroraEngaged).toHaveBeenCalledTimes(1);
        });

        it('isQuiet needs N frames since the last request and nothing in flight', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            expect(session.isQuiet(3)).toBe(false); // nothing requested yet, but no frames either
            session.noteFrame();
            session.noteFrame();
            expect(session.isQuiet(3)).toBe(false);
            session.noteFrame();
            expect(session.isQuiet(3)).toBe(true);
            expect(session.isQuiet()).toBe(false); // default window is 12 frames

            backend.createRenderPipeline(renderObjectFor(), null);
            expect(session.lastCreateFrame).toBe(3);
            expect(session.isQuiet(0)).toBe(false); // in flight beats any window
            for (let i = 0; i < 5; i++) session.noteFrame();
            expect(session.isQuiet(3)).toBe(false);
            fake.pending[0].finish({ pipeline: { kind: 'gpu' } });
            await flush();
            expect(session.frame).toBe(8);
            expect(session.isQuiet(5)).toBe(true);
            expect(session.isQuiet(6)).toBe(false);
        });

        it('noteFrame(stamp) advances once per rAF timestamp; noteFrame() always advances', () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            session.noteFrame(0);
            session.noteFrame(0); // a falsy timestamp still dedupes
            expect(session.frame).toBe(1);
            session.noteFrame(16.7);
            session.noteFrame(16.7);
            session.noteFrame(16.7);
            expect(session.frame).toBe(2);
            session.noteFrame(33.4);
            expect(session.frame).toBe(3);
            session.noteFrame();
            session.noteFrame();
            session.noteFrame(undefined);
            expect(session.frame).toBe(6);

            // The dedupe is per session: another session on the same rAF tick still counts it.
            const other = beginAsyncRenderPipelines(makeTheme('aurora'));
            session.noteFrame(50);
            other.noteFrame(50);
            expect(session.frame).toBe(7);
            expect(other.frame).toBe(1);
        });

        it('settle() resolves true on a fake rAF once nothing is in flight for quietFrames', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            backend.createRenderPipeline(renderObjectFor(), null); // requested at frame 0
            let frames = 0;
            vi.stubGlobal('requestAnimationFrame', (cb) => {
                frames += 1;
                if (frames === 4) fake.pending[0].finish({ pipeline: { kind: 'gpu' } });
                setTimeout(() => cb(frames * 16), 0);
                return frames;
            });
            await expect(session.settle({ quietFrames: 3, maxMs: 60000 })).resolves.toBe(true);
            // Frames 1-3 had the pipeline in flight; frame 4 is in-flight-free and 4 >= 3 since.
            expect(frames).toBe(4);
            expect(session.frame).toBe(4);
        });

        it('settle() restarts the quiet window when a new pipeline is requested mid-wait', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            let frames = 0;
            vi.stubGlobal('requestAnimationFrame', (cb) => {
                frames += 1;
                if (frames === 2) {
                    backend.createRenderPipeline(renderObjectFor(), null); // at session frame 1
                    fake.pending[0].finish({ pipeline: { kind: 'gpu' } });
                }
                setTimeout(() => cb(frames * 16), 0);
                return frames;
            });
            await expect(session.settle({ quietFrames: 3, maxMs: 60000 })).resolves.toBe(true);
            expect(session.lastCreateFrame).toBe(1);
            expect(frames).toBe(4); // would be 3 without the mid-wait request
        });

        it('settle() times out false while a pipeline stays in flight', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            backend.createRenderPipeline(renderObjectFor(), null); // never resolves
            let clock = 0;
            vi.spyOn(performance, 'now').mockImplementation(() => {
                clock += 10;
                return clock;
            });
            const raf = vi.fn((cb) => { setTimeout(cb, 0); return 1; });
            vi.stubGlobal('requestAnimationFrame', raf);
            await expect(session.settle({ maxMs: 50, quietFrames: 1 })).resolves.toBe(false);
            expect(raf.mock.calls.length).toBeGreaterThan(0);
            expect(raf.mock.calls.length).toBeLessThan(10);
            expect(session.active).toBe(true);
        });

        it('settle() returns true once the session ends mid-wait', async () => {
            const theme = makeTheme('forest');
            const backend = new fake.FakeWebGPUBackend(theme.renderer);
            const session = beginAsyncRenderPipelines(theme);
            backend.createRenderPipeline(renderObjectFor(), null); // never resolves
            let frames = 0;
            vi.stubGlobal('requestAnimationFrame', (cb) => {
                frames += 1;
                if (frames === 2) session.end();
                setTimeout(cb, 0);
                return frames;
            });
            await expect(session.settle({ quietFrames: 3, maxMs: 60000 })).resolves.toBe(true);
            expect(frames).toBe(2);
            // Already-ended sessions settle immediately.
            await expect(session.settle()).resolves.toBe(true);
            expect(frames).toBe(2);
        });

        it('settle() falls back to setTimeout frames when requestAnimationFrame is absent', async () => {
            expect(typeof globalThis.requestAnimationFrame).toBe('undefined'); // node test env
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            await expect(session.settle({ quietFrames: 2, maxMs: 60000 })).resolves.toBe(true);
            expect(session.frame).toBe(2);
        });

        describe('settle() in a hidden window (requestAnimationFrame exists but never fires)', () => {
            // Fake timers drive both the timeout fallback and settle()'s performance.now() clock.
            // The rAF stub is installed AFTER vi.useFakeTimers so fake-timers cannot run it.
            let parkedFrames;

            beforeEach(() => {
                vi.useFakeTimers();
                parkedFrames = [];
                vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
                    parkedFrames.push(cb);
                    return parkedFrames.length;
                }));
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            function track(promise) {
                const state = { settled: false, value: undefined };
                promise.then((value) => Object.assign(state, { settled: true, value }));
                return state;
            }

            it('resolves at maxMs rather than waiting forever for a frame', async () => {
                const session = beginAsyncRenderPipelines(makeTheme('forest'));
                const state = track(session.settle({ maxMs: 400, quietFrames: 6 }));

                await vi.advanceTimersByTimeAsync(399);
                expect(state.settled).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                // Bounded, and not quiet: nothing was presented, so 6 quiet frames never elapsed.
                expect(state).toEqual({ settled: true, value: false });
                expect(requestAnimationFrame).toHaveBeenCalled();
                expect(parkedFrames.length).toBeGreaterThan(0); // none of them ever ran
                expect(vi.getTimerCount()).toBe(0);
                expect(session.active).toBe(true);
            });

            it('resolves at maxMs with a pipeline still in flight', async () => {
                const theme = makeTheme('forest');
                const session = beginAsyncRenderPipelines(theme);
                new fake.FakeWebGPUBackend(theme.renderer).createRenderPipeline(renderObjectFor(), null);
                expect(session.inFlight).toBe(1);
                const state = track(session.settle({ maxMs: 250, quietFrames: 1 }));

                await vi.advanceTimersByTimeAsync(249);
                expect(state.settled).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                expect(state).toEqual({ settled: true, value: false });
            });

            it('keeps the ORIGINAL bound when the window hides mid-settle', async () => {
                const session = beginAsyncRenderPipelines(makeTheme('forest'));
                // Two real frames (16 ms apart), then the window is hidden and rAF stops.
                let served = 0;
                vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
                    served += 1;
                    if (served <= 2) setTimeout(() => cb(served * 16), 16);
                    else parkedFrames.push(cb);
                    return served;
                }));
                const state = track(session.settle({ maxMs: 400, quietFrames: 6 }));

                await vi.advanceTimersByTimeAsync(32);
                expect(session.frame).toBe(2);
                // A fresh maxMs per wait would run to 432 ms; the budget left is what bounds it.
                await vi.advanceTimersByTimeAsync(367);
                expect(state.settled).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                expect(state).toEqual({ settled: true, value: false });
            });

            it('a parked rAF that finally fires after the bound adds no frame and throws nothing', async () => {
                const session = beginAsyncRenderPipelines(makeTheme('forest'));
                const state = track(session.settle({ maxMs: 100, quietFrames: 6 }));
                await vi.advanceTimersByTimeAsync(100);
                expect(state.settled).toBe(true);
                const frameAtBound = session.frame;

                // The window is shown again: the browser runs the callbacks it had parked.
                expect(() => parkedFrames.splice(0).forEach((cb) => cb(5000))).not.toThrow();
                await vi.advanceTimersByTimeAsync(0);
                expect(session.frame).toBe(frameAtBound);
                expect(state.value).toBe(false);
            });
        });

        it('two concurrent settle() calls under one rAF advance the frame clock once per frame', async () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            let frames = 0;
            let batch = [];
            vi.stubGlobal('requestAnimationFrame', (cb) => {
                // Like a real rAF: every callback registered before a frame runs in that frame,
                // all with the same timestamp.
                if (batch.length === 0) {
                    setTimeout(() => {
                        frames += 1;
                        const run = batch;
                        batch = [];
                        run.forEach((fn) => fn(frames * 16));
                    }, 0);
                }
                batch.push(cb);
                return frames + 1;
            });
            const settled = await Promise.all([
                session.settle({ quietFrames: 4, maxMs: 60000 }),
                session.settle({ quietFrames: 4, maxMs: 60000 }),
            ]);
            expect(settled).toEqual([true, true]);
            // Counting each caller's noteFrame would advance the clock twice per real frame.
            expect(frames).toBe(4);
            expect(session.frame).toBe(4);
        });

        it('adoptRendererForTheme lets a session claim a renderer created before theme.renderer', () => {
            const theme = { name: 'aurora', renderer: null };
            const session = beginAsyncRenderPipelines(theme);
            const early = makeRenderer('early');
            const backend = new fake.FakeWebGPUBackend(early);

            backend.createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(1);

            // Adoption is by theme identity, not by name.
            adoptRendererForTheme({ name: 'aurora', renderer: null }, early);
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();

            adoptRendererForTheme(theme, null); // ignored
            adoptRendererForTheme(theme, early);
            backend.createRenderPipeline(renderObjectFor(), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(session.stats.async).toBe(1);

            // Once theme.renderer is assigned it is owned without adoption.
            const late = makeRenderer('late');
            theme.renderer = late;
            new fake.FakeWebGPUBackend(late).createRenderPipeline(renderObjectFor(), null);
            expect(session.stats.async).toBe(2);
            session.end();
        });

        it('adoptRendererForTheme without an active session is a no-op', () => {
            const theme = makeTheme('forest');
            const stray = makeRenderer('stray');
            expect(() => adoptRendererForTheme(theme, stray)).not.toThrow();
            const session = beginAsyncRenderPipelines(theme);
            // The earlier adoption did not carry into the new session.
            new fake.FakeWebGPUBackend(stray).createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            session.end();
            adoptRendererForTheme(theme, stray); // ended session: ignored
            const next = beginAsyncRenderPipelines(theme);
            new fake.FakeWebGPUBackend(stray).createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            next.end();
        });

        it('owns a renderer whose canvas sits inside the theme\'s #<name>-theme container', () => {
            const canvas = { tagName: 'CANVAS' };
            const container = { contains: vi.fn((node) => node === canvas) };
            const getElementById = vi.fn((id) => (id === 'nebula-theme' ? container : null));
            vi.stubGlobal('document', { getElementById });
            const theme = { name: 'nebula', renderer: null };
            const session = beginAsyncRenderPipelines(theme);

            new fake.FakeWebGPUBackend({ domElement: canvas }).createRenderPipeline(renderObjectFor(), null);
            expect(Array.isArray(lastCall(fake).promises)).toBe(true);
            expect(getElementById).toHaveBeenCalledWith('nebula-theme');

            new fake.FakeWebGPUBackend({ domElement: { tagName: 'CANVAS' } })
                .createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            new fake.FakeWebGPUBackend({ domElement: null }).createRenderPipeline(renderObjectFor(), null);
            expect(lastCall(fake).promises).toBeNull();
            expect(session.stats.async).toBe(1);
            session.end();
        });

        it('resetAsyncRenderPipelinesForTests ends sessions and restores the prototype', () => {
            const session = beginAsyncRenderPipelines(makeTheme('forest'));
            new fake.FakeWebGPUBackend(null).createRenderPipeline(renderObjectFor(), null);
            expect(getAsyncRenderPipelineDiagnostics().unownedSyncDuringSession).toBe(1);
            resetAsyncRenderPipelinesForTests();
            expect(session.active).toBe(false);
            expect(proto.createRenderPipeline).toBe(fake.original);
            expect(getAsyncRenderPipelineDiagnostics()).toEqual({
                installed: false, sessions: 0, unownedSyncDuringSession: 0,
            });
            expect(beginAsyncRenderPipelines(makeTheme('forest'))).toBeNull(); // preload cleared too
        });
    });

    describe('against the real three r185 WebGPUBackend class', () => {
        it('the default loader resolves three/webgpu\'s WebGPUBackend prototype', async () => {
            const proto = await preloadAsyncRenderPipelines();
            expect(proto).not.toBeNull();
            expect(typeof proto.createRenderPipeline).toBe('function');
            expect(proto.constructor.name).toBe('WebGPUBackend');
        });

        it('wraps WebGPUBackend.prototype, feeds pipelineUtils a sink, and restores it', async () => {
            const original = WebGPUBackend.prototype.createRenderPipeline;
            const loaded = await preloadAsyncRenderPipelines(async () => ({ WebGPUBackend }));
            expect(loaded).toBe(WebGPUBackend.prototype);

            const theme = makeTheme('real');
            const backend = new WebGPUBackend();
            backend.renderer = theme.renderer; // what Backend.init(renderer) assigns
            const received = [];
            backend.pipelineUtils = {
                createRenderPipeline(renderObject, promises) {
                    received.push(promises);
                    // WebGPUPipelineUtils writes into backend.get(renderObject.pipeline).
                    const pipelineData = backend.get(renderObject.pipeline);
                    if (promises === null) {
                        pipelineData.pipeline = { kind: 'sync' };
                    } else {
                        promises.push(Promise.resolve().then(() => { pipelineData.pipeline = { kind: 'async' }; }));
                    }
                },
            };

            const session = beginAsyncRenderPipelines(theme);
            expect(WebGPUBackend.prototype.createRenderPipeline).not.toBe(original);
            expect(isAsyncPipelineBackend(backend)).toBe(true);

            const renderObject = { pipeline: { id: 'real-pipeline' }, context: { renderTarget: null } };
            backend.createRenderPipeline(renderObject, null);
            expect(Array.isArray(received[0])).toBe(true);
            expect(session.inFlight).toBe(1);
            await flush();
            expect(backend.get(renderObject.pipeline).pipeline).toEqual({ kind: 'async' });
            expect(session.inFlight).toBe(0);

            const pmremTarget = { texture: { isPMREMTexture: true } };
            backend.createRenderPipeline({ pipeline: { id: 'pmrem' }, context: { renderTarget: pmremTarget } }, null);
            expect(received[1]).toBeNull();
            expect(session.stats).toMatchObject({ async: 1, syncExempt: 1 });

            session.end();
            expect(WebGPUBackend.prototype.createRenderPipeline).toBe(original);
            expect(isAsyncPipelineBackend(backend)).toBe(false);
        });
    });
});
