import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { performanceMonitor } from '../../src/utils/performance-monitor.js';
import {
    resetAsyncRenderPipelinesForTests,
    getAsyncRenderPipelineDiagnostics,
    isAsyncPipelineBackend,
    preloadAsyncRenderPipelines,
} from '../../src/rendering/async-render-pipelines.js';

// beginLoadingSurface() preloads the backend prototype itself, through the default loader
// (import('three/webgpu')). Route that import to the test's fake backend: real three costs
// ~300 ms to load here, and its prototype is not the one the fake themes render through.
const mockedThreeWebGPU = vi.hoisted(() => ({ WebGPUBackend: undefined }));
vi.mock('three/webgpu', () => ({
    get WebGPUBackend() { return mockedThreeWebGPU.WebGPUBackend; },
}));

// ThemeManager.prewarmTheme's async branch + the loading-surface API
// (beginLoadingSurface / _armLoadingSurfaceSession / whenLoadingSurfacePipelinesSettled /
// whenLoadingSurfaceEngaged / canUseAsyncLoadingSurface / isThemeKnownAsync).
//
// The theme double renders through a fake three r185 WebGPUBackend whose createRenderPipeline
// lives on the prototype (what rendering/async-render-pipelines.js wraps). Its live render always
// passes promises = null, exactly like Pipelines.getForRender; only an owning session turns that
// into the async create. Frames come from a fake-timer driven requestAnimationFrame, and the
// theme's own render loop runs first in every tick, as a browser runs rAF callbacks in order.

const FRAME_MS = 16;
const QUIET_FRAMES_TO_EXIT = 31; // 1 frame to record the child count + 30 stable frames
const STABLE_FRAMES_TO_EXIT = 46; // legacy: 1 + 45 stable frames

function makeBackendClass({ compileMs = 40 } = {}) {
    return class FakeWebGPUBackend {
        constructor(renderer) {
            this.isWebGPUBackend = true;
            this.renderer = renderer; // Backend.js:91 — what sessionFor() resolves ownership from
            this.data = new WeakMap();
            this.syncCreates = 0;
            this.asyncCreates = 0;
        }

        get(object) {
            let entry = this.data.get(object);
            if (!entry) {
                entry = {};
                this.data.set(object, entry);
            }
            return entry;
        }

        createRenderPipeline(renderObject, promises) {
            const pipelineData = this.get(renderObject.pipeline);
            if (promises) {
                this.asyncCreates += 1;
                promises.push(compileMs === Infinity
                    ? new Promise(() => {})
                    : new Promise((resolve) => {
                        setTimeout(() => {
                            pipelineData.pipeline = { ready: true };
                            resolve();
                        }, compileMs);
                    }));
                return;
            }
            this.syncCreates += 1;
            pipelineData.pipeline = { ready: true };
        }
    };
}

function preloadWith(BackendClass) {
    return preloadAsyncRenderPipelines(() => ({ WebGPUBackend: BackendClass }));
}

/** Fake-timer frame clock. Must be installed AFTER vi.useFakeTimers(). */
function installFrameDriver() {
    const callbacks = [];
    const renderers = new Set();
    const state = { rafCalls: 0, stalled: false };
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        state.rafCalls += 1;
        callbacks.push(callback);
        return state.rafCalls;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const timer = setInterval(() => {
        renderers.forEach((render) => render());
        if (state.stalled) return;
        callbacks.splice(0).forEach((callback) => callback(performance.now()));
    }, FRAME_MS);
    return { state, renderers, stop: () => clearInterval(timer) };
}

function makeWarmTheme(BackendClass, driver, {
    name = 'forest',
    objectCount = 3,
    failStart = null,
    renderInStart = false,
    onStart = null,
} = {}) {
    const theme = {
        name,
        hasStarted: false,
        isActive: false,
        isPaused: false,
        lifecycleGeneration: 0,
        lifecycleState: 'initialized',
        scene: { children: [] },
        camera: {},
        renderer: null,
        renderObjects: [],
        renderedFrames: 0,
    };
    theme.addRenderObject = () => {
        const id = theme.renderObjects.length;
        theme.renderObjects.push({
            id,
            pipeline: { id: `pipeline-${id}` },
            context: { renderTarget: null },
            requested: false,
        });
        theme.scene.children.push({ id });
    };
    theme.renderFrame = () => {
        if (!theme.isActive || !theme.renderer) return;
        theme.renderedFrames += 1;
        theme.renderObjects.forEach((renderObject) => {
            if (renderObject.requested) return;
            renderObject.requested = true;
            // r185 live path: Pipelines.getForRender → backend.createRenderPipeline(ro, null).
            theme.renderer.backend.createRenderPipeline(renderObject, null);
        });
    };
    theme.start = vi.fn(async () => {
        const renderer = { compileAsync: vi.fn(async () => {}) };
        renderer.backend = new BackendClass(renderer);
        theme.renderer = renderer;
        for (let i = 0; i < objectCount; i += 1) theme.addRenderObject();
        onStart?.(theme);
        if (failStart) throw failStart;
        theme.hasStarted = true;
        theme.isActive = true;
        theme.lifecycleState = 'running';
        if (renderInStart) theme.renderFrame();
        driver?.renderers.add(theme.renderFrame);
        return true;
    });
    theme.pause = vi.fn(() => {
        theme.isActive = false;
        theme.isPaused = true;
        theme.lifecycleState = 'paused';
        return true;
    });
    theme.resume = vi.fn(() => {
        theme.isActive = true;
        theme.isPaused = false;
        theme.lifecycleState = 'running';
        return true;
    });
    theme.cleanup = vi.fn(() => {
        theme.isActive = false;
        theme.isPaused = false;
        theme.lifecycleState = 'stopped';
        theme.cleanupComplete = true;
    });
    return theme;
}

function makeManager(theme = null) {
    vi.spyOn(ThemeManager.prototype, 'initializeRegistry').mockImplementation(() => {});
    const manager = new ThemeManager({
        cleanup: vi.fn(),
        clearThemeResources: vi.fn(),
        loadTheme: vi.fn(),
    }, { assetManager: {}, audioManager: null });
    if (theme) {
        manager.themeInstances.set(theme.name, theme);
        manager.themeLRU = [theme.name];
        manager.loadTheme = vi.fn(async () => theme);
    }
    return manager;
}

/** Records every onPhase call plus the fake clock / rAF count at that moment. */
function phaseRecorder(driver) {
    const phases = [];
    const onPhase = vi.fn((name, payload) => {
        phases.push({
            name,
            payload,
            at: performance.now(),
            rafCalls: driver?.state.rafCalls ?? 0,
        });
    });
    const get = (name) => phases.find((p) => p.name === name);
    return { phases, onPhase, get };
}

/** Advance the fake clock frame by frame until `promise` settles (bounded). */
async function runUntilSettled(promise, maxMs = 30_000) {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let elapsed = 0; !done && elapsed < maxMs; elapsed += FRAME_MS) {
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(FRAME_MS);
    }
    expect(done).toBe(true);
    return promise;
}

/** Whether (and to what) `promise` has settled once pending microtasks ran — no timer advanced. */
async function peek(promise) {
    const state = { settled: false, value: undefined };
    promise.then((value) => {
        state.settled = true;
        state.value = value;
    });
    for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
    return state;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Drain a preload still in flight BEFORE the reset. beginLoadingSurface() starts one itself,
    // and its .then assigns the module's resolved prototype: settling after the reset, it would
    // overwrite the NEXT test's preloaded fake, whose sessions would then wrap the wrong
    // prototype and its live renders compile synchronously (the once-in-a-while failure of
    // "arms before resume()" in parallel runs: expected 3 to be 4).
    await preloadAsyncRenderPipelines(() => null);
    resetAsyncRenderPipelinesForTests();
    mockedThreeWebGPU.WebGPUBackend = undefined;
});

describe('ThemeManager.prewarmTheme — async render-pipeline branch', () => {
    it('exits on quiet long before maxWarmMs, with no compileAsync sweep and no post-warm frames', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass({ compileMs: 40 });
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const record = vi.spyOn(performanceMonitor, 'recordEvent');
        const { onPhase, get } = phaseRecorder(driver);

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 5_000,
            postWarmFrames: 30,
            onPhase,
        });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        const started = get('started');
        const settled = get('settled');
        expect(started.payload.asyncActive).toBe(true);
        expect(settled.payload).toMatchObject({ asyncActive: true, exitReason: 'quiet', inFlight: 0 });
        expect(settled.at - started.at).toBeLessThan(5_000);
        expect(settled.at - started.at).toBeLessThan(1_000);

        // Every pipeline the live render requested went async; none compiled synchronously.
        const { backend } = theme.renderer;
        expect(backend.asyncCreates).toBe(3);
        expect(backend.syncCreates).toBe(0);
        // No bare whole-scene sweep on the async path.
        expect(theme.renderer.compileAsync).not.toHaveBeenCalled();
        // The loop exited on the exact quiet frame: the 30 postWarmFrames never ran.
        expect(settled.rafCalls).toBe(QUIET_FRAMES_TO_EXIT);
        expect(get('end').rafCalls).toBe(QUIET_FRAMES_TO_EXIT);

        // Parked as the pending resume target; session closed and the prototype restored.
        expect(theme.pause).toHaveBeenCalledTimes(1);
        expect(theme.isPaused).toBe(true);
        expect(theme.lifecycleState).toBe('paused');
        expect(theme.cleanup).not.toHaveBeenCalled();
        expect(manager.pendingThemeInstance).toBe(theme);
        expect(manager.pendingThemeName).toBe('forest');
        expect(manager.activeTheme).toBeNull();
        expect(manager.themesSuspended).toBe(true);
        expect(manager.isTransitioning).toBe(false);
        expect(theme._prewarmHidden).toBe(false);
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });

        expect(record).toHaveBeenCalledWith('theme_prewarm_async_pipelines', expect.objectContaining({
            theme: 'forest',
            exitReason: 'quiet',
            async: 3,
            syncExempt: 0,
            failed: 0,
            inFlight: 0,
        }));
    });

    it('emits start → started → settled → end with the documented payloads', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver, { objectCount: 2 });
        const manager = makeManager(theme);
        const { phases, onPhase } = phaseRecorder(driver);

        await expect(runUntilSettled(manager.prewarmTheme('forest', { onPhase }))).resolves.toBe(true);

        expect(phases.map((p) => p.name)).toEqual(['start', 'started', 'settled', 'end']);
        expect(phases[0].payload).toEqual({ theme: 'forest', session: true });
        expect(phases[1].payload).toEqual({
            theme: 'forest',
            asyncActive: true,
            syncRenderer: false,
            startMs: expect.any(Number),
            async: 0, // start() itself rendered nothing; the loop requests the pipelines
        });
        expect(phases[2].payload).toEqual({
            theme: 'forest', asyncActive: true, exitReason: 'quiet', inFlight: 0,
        });
        expect(phases[3].payload).toEqual({
            theme: 'forest', asyncActive: true, exitReason: 'quiet', endReason: 'settled',
        });
    });

    it('treats a throwing onPhase observer as diagnostics only', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const onPhase = vi.fn(() => { throw new Error('observer exploded'); });

        await expect(runUntilSettled(manager.prewarmTheme('forest', { onPhase }))).resolves.toBe(true);
        expect(onPhase).toHaveBeenCalledTimes(4);
        expect(manager.pendingThemeInstance).toBe(theme);
    });

    it('parks the warm instead of disposing it when a frame times out on the async path', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const phases = [];
        const onPhase = (name, payload) => {
            // A multi-second main-thread stall right after start: no frame ever arrives.
            if (name === 'started') driver.state.stalled = true;
            phases.push({ name, payload, at: performance.now() });
        };

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 60_000,
            postWarmFrames: 30,
            onPhase,
        });
        // The legacy 1 s frame bound must not apply on the async path.
        await vi.advanceTimersByTimeAsync(2_900);
        let done = false;
        prewarm.then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(0);
        expect(done).toBe(false);
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        const started = phases.find((p) => p.name === 'started');
        const settled = phases.find((p) => p.name === 'settled');
        expect(settled.payload).toMatchObject({ asyncActive: true, exitReason: 'frame-timeout' });
        expect(settled.at - started.at).toBeGreaterThanOrEqual(3_000);
        expect(settled.at - started.at).toBeLessThan(3_000 + 5 * FRAME_MS);
        expect(phases.at(-1)).toMatchObject({ name: 'end', payload: { exitReason: 'frame-timeout' } });

        expect(theme.cleanup).not.toHaveBeenCalled();
        expect(theme.renderer.compileAsync).not.toHaveBeenCalled();
        expect(theme.isPaused).toBe(true);
        expect(theme.lifecycleState).toBe('paused');
        expect(manager.pendingThemeInstance).toBe(theme);
        expect(manager.themeInstances.get('forest')).toBe(theme);
        expect(manager.isTransitioning).toBe(false);
        expect(getAsyncRenderPipelineDiagnostics().sessions).toBe(0);
    });

    it('holds while isThemeBusy() is true until maxWarmMs, then parks (exitReason max-warm)', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const { onPhase, get } = phaseRecorder(driver);
        const isThemeBusy = vi.fn(() => true);

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 1_000,
            postWarmFrames: 30,
            isThemeBusy,
            onPhase,
        });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        const held = get('settled').at - get('started').at;
        expect(held).toBeGreaterThanOrEqual(1_000);
        expect(held).toBeLessThan(1_000 + 3 * FRAME_MS);
        expect(get('settled').payload).toMatchObject({ exitReason: 'max-warm', inFlight: 0 });
        expect(isThemeBusy).toHaveBeenCalled();
        expect(isThemeBusy.mock.calls.every(([t]) => t === theme)).toBe(true);
        expect(get('settled').rafCalls).toBeGreaterThan(QUIET_FRAMES_TO_EXIT);
        expect(theme.renderer.compileAsync).not.toHaveBeenCalled();
        expect(manager.pendingThemeInstance).toBe(theme);
    });

    it('exits on quiet as soon as isThemeBusy() clears, and treats a throwing probe as not busy', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const { onPhase, get } = phaseRecorder(driver);
        const BUSY_MS = 800; // longer than the ~31 frames the quiet exit needs on its own
        const isThemeBusy = vi.fn(() => {
            if (performance.now() - get('started').at >= BUSY_MS) {
                throw new Error('probe broke'); // a throwing probe must read as "not busy"
            }
            return true;
        });

        const prewarm = manager.prewarmTheme('forest', { maxWarmMs: 5_000, isThemeBusy, onPhase });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        const held = get('settled').at - get('started').at;
        expect(get('settled').payload.exitReason).toBe('quiet');
        expect(held).toBeGreaterThanOrEqual(BUSY_MS);
        expect(held).toBeLessThan(BUSY_MS + 3 * FRAME_MS);
    });

    it('allows a bounded tail past maxWarmMs while pipelines are in flight (exitReason tail-cap)', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass({ compileMs: Infinity });
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        const { onPhase, get } = phaseRecorder(driver);
        const record = vi.spyOn(performanceMonitor, 'recordEvent');

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 200,
            asyncTailMs: 300,
            onPhase,
        });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        const held = get('settled').at - get('started').at;
        expect(held).toBeGreaterThanOrEqual(500);
        expect(held).toBeLessThan(500 + 3 * FRAME_MS);
        expect(get('settled').payload).toMatchObject({ exitReason: 'tail-cap', inFlight: 3 });
        expect(theme.asyncPipelinesInFlight).toBe(3);
        expect(manager.pendingThemeInstance).toBe(theme);
        // Pipelines still in flight: the parked theme keeps its async session (retained) so late
        // content never compiles synchronously; the report lands when the retainer lets go.
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: true, sessions: 1 });
        expect(record).not.toHaveBeenCalledWith('theme_prewarm_async_pipelines', expect.anything());
        await vi.advanceTimersByTimeAsync(20500);
        expect(record).toHaveBeenCalledWith('theme_prewarm_async_pipelines', expect.objectContaining({
            exitReason: 'tail-cap',
            endReason: 'retain-timeout',
            inFlight: 3,
        }));
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
    });

    it('ends the session in finally when start() throws', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        const originalCreate = Backend.prototype.createRenderPipeline;
        await preloadWith(Backend);
        let duringStart = null;
        const theme = makeWarmTheme(Backend, driver, {
            failStart: new Error('createScene blew up'),
            onStart: () => { duringStart = getAsyncRenderPipelineDiagnostics(); },
        });
        const manager = makeManager(theme);
        const { phases, onPhase } = phaseRecorder(driver);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(runUntilSettled(manager.prewarmTheme('forest', { onPhase }))).resolves.toBe(false);

        // The session was live (and the prototype wrapped) while start() ran ...
        expect(duringStart).toMatchObject({ installed: true, sessions: 1 });
        expect(Backend.prototype.createRenderPipeline).toBe(originalCreate);
        // ... and the finally closed it and restored the prototype.
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
        expect(phases.map((p) => p.name)).toEqual(['start', 'end']);
        expect(phases[1].payload).toEqual({
            theme: 'forest', asyncActive: false, exitReason: 'max-warm', endReason: 'failed',
        });
        expect(theme._prewarmHidden).toBe(false);
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.has('forest')).toBe(false);
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.isTransitioning).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[ThemeManager] prewarmTheme failed for "forest":',
            expect.objectContaining({ message: 'createScene blew up' }),
        );
    });
});

describe('ThemeManager.prewarmTheme — legacy fallbacks', () => {
    const legacyExpectations = async ({ theme, manager, driver }) => {
        const { phases, onPhase, get } = phaseRecorder(driver);
        const postWarmFrames = 7;
        const prewarm = manager.prewarmTheme('forest', { maxWarmMs: 5_000, postWarmFrames, onPhase });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        expect(phases.map((p) => p.name)).toEqual(['start', 'started', 'settled', 'end']);
        expect(get('start').payload.session).toBe(false);
        expect(get('started').payload.asyncActive).toBe(false);
        expect(get('settled').payload).toMatchObject({ asyncActive: false, exitReason: 'stable', inFlight: 0 });
        // Legacy: 45 stable frames, THEN the post-warm frames, THEN one compileAsync sweep.
        expect(get('settled').rafCalls).toBe(STABLE_FRAMES_TO_EXIT + postWarmFrames);
        expect(theme.renderer.compileAsync).toHaveBeenCalledTimes(1);
        expect(theme.renderer.compileAsync).toHaveBeenCalledWith(theme.scene, theme.camera);
        // Live renders compiled synchronously; nothing was wrapped.
        expect(theme.renderer.backend.syncCreates).toBe(3);
        expect(theme.renderer.backend.asyncCreates).toBe(0);
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
        expect(manager.pendingThemeInstance).toBe(theme);
    };

    it.each([
        ['the URL flag', { location: { search: '?themeWarmAsync=0' } }],
        ['the localStorage flag', {
            location: { search: '' },
            localStorage: { getItem: (key) => (key === 'serenity.themeWarmAsync' ? '0' : null) },
        }],
    ])('takes the legacy path when %s rolls themeWarmAsync back', async (_label, fakeWindow) => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend); // preloaded, but the flag must still win
        vi.stubGlobal('window', fakeWindow);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);

        expect(manager.isAsyncWarmEnabled()).toBe(false);
        await expect(manager.preloadAsyncRenderPipelines()).resolves.toBeNull();
        await legacyExpectations({ theme, manager, driver });
        expect(fakeWindow.__THEME_WARM_ASYNC__).toBeUndefined();
    });

    it('takes the legacy path when the backend prototype was never preloaded', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);

        expect(manager.isAsyncWarmEnabled()).toBe(true);
        await legacyExpectations({ theme, manager, driver });
    });

    it('ends a begun session right after start when the renderer is not the preloaded WebGPU backend', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Preloaded = makeBackendClass();
        await preloadWith(Preloaded);
        const WebGL2Fallback = makeBackendClass(); // a different prototype (e.g. a WebGL2 backend)
        const theme = makeWarmTheme(WebGL2Fallback, driver);
        const manager = makeManager(theme);
        let diagnosticsAtStarted = null;
        const onPhase = vi.fn((name) => {
            if (name === 'started') diagnosticsAtStarted = getAsyncRenderPipelineDiagnostics();
        });

        await expect(runUntilSettled(manager.prewarmTheme('forest', {
            maxWarmMs: 5_000,
            postWarmFrames: 2,
            onPhase,
        }))).resolves.toBe(true);

        expect(onPhase).toHaveBeenNthCalledWith(1, 'start', { theme: 'forest', session: true });
        expect(onPhase).toHaveBeenNthCalledWith(2, 'started', expect.objectContaining({ asyncActive: false }));
        expect(diagnosticsAtStarted).toMatchObject({ installed: false, sessions: 0 });
        expect(onPhase).toHaveBeenNthCalledWith(3, 'settled', expect.objectContaining({ exitReason: 'stable' }));
        expect(theme.renderer.compileAsync).toHaveBeenCalledTimes(1);
        expect(theme.renderer.backend.syncCreates).toBe(3);
    });
});

describe('ThemeManager loading-surface API', () => {
    it('refcounts beginLoadingSurface and makes each release idempotent', async () => {
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const manager = makeManager();
        const record = vi.spyOn(performanceMonitor, 'recordEvent');
        const theme = { name: 'forest', renderer: null };

        const releaseOverlay = manager.beginLoadingSurface('overlay');
        const releaseSplash = manager.beginLoadingSurface('splash');
        expect(manager._loadingSurfaceDepth).toBe(2);
        const session = manager._armLoadingSurfaceSession(theme, 'forest');
        expect(session).not.toBeNull();
        expect(session.label).toBe('loading:forest');
        expect(manager._loadingSessions.get(theme)).toBe(session);

        releaseOverlay();
        releaseOverlay(); // idempotent: must not release the splash's hold
        expect(manager._loadingSurfaceDepth).toBe(1);
        expect(session.active).toBe(true);
        expect(getAsyncRenderPipelineDiagnostics().sessions).toBe(1);

        releaseSplash();
        expect(manager._loadingSurfaceDepth).toBe(0);
        expect(session.active).toBe(false);
        expect(manager._loadingSessions.size).toBe(0);
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
        const surfaceEvents = record.mock.calls.filter(([type]) => type === 'theme_loading_surface_async_pipelines');
        expect(surfaceEvents).toEqual([['theme_loading_surface_async_pipelines', expect.objectContaining({
            reason: 'splash', theme: 'forest', async: 0, inFlight: 0,
        })]]);

        releaseSplash();
        releaseOverlay();
        expect(manager._loadingSurfaceDepth).toBe(0);
        expect(record.mock.calls.filter(([type]) => type === 'theme_loading_surface_async_pipelines'))
            .toHaveLength(1);

        // A fresh surface after a full release still works.
        const releaseAgain = manager.beginLoadingSurface('again');
        expect(manager._loadingSurfaceDepth).toBe(1);
        releaseAgain();
        expect(manager._loadingSurfaceDepth).toBe(0);
    });

    it('arms a session only while a loading surface is up (and only once per theme)', async () => {
        const Backend = makeBackendClass();
        mockedThreeWebGPU.WebGPUBackend = Backend; // what the surface's own preload resolves to
        const manager = makeManager();
        const forest = { name: 'forest', renderer: null };
        const ocean = { name: 'ocean', renderer: null };

        // No surface: never arms.
        expect(manager._armLoadingSurfaceSession(forest, 'forest')).toBeNull();

        // Surface up but the backend prototype not resolved yet: null (callers stay sync).
        const release = manager.beginLoadingSurface('overlay');
        expect(manager._armLoadingSurfaceSession(forest, 'forest')).toBeNull();
        expect(manager._loadingSessions.size).toBe(0);

        await manager.preloadAsyncRenderPipelines(); // the preload the surface kicked off
        expect(manager._armLoadingSurfaceSession(null, 'forest')).toBeNull();
        const forestSession = manager._armLoadingSurfaceSession(forest, 'forest');
        expect(forestSession).not.toBeNull();
        expect(manager._armLoadingSurfaceSession(forest, 'forest')).toBeNull(); // already armed
        const oceanSession = manager._armLoadingSurfaceSession(ocean, 'ocean');
        expect(oceanSession).not.toBeNull();
        expect(oceanSession).not.toBe(forestSession);
        expect(manager._loadingSessions.size).toBe(2);

        release();
        expect(forestSession.active).toBe(false);
        expect(oceanSession.active).toBe(false);
        // Surface gone: arming is a no-op again.
        expect(manager._armLoadingSurfaceSession(forest, 'forest')).toBeNull();
        expect(getAsyncRenderPipelineDiagnostics().sessions).toBe(0);
    });

    it('is a no-op when themeWarmAsync is rolled back', async () => {
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        vi.stubGlobal('window', { location: { search: '?themeWarmAsync=0' } });
        const manager = makeManager();

        const release = manager.beginLoadingSurface('overlay');
        expect(manager._loadingSurfaceDepth).toBeUndefined();
        expect(manager._armLoadingSurfaceSession({ name: 'forest' }, 'forest')).toBeNull();
        expect(() => { release(); release(); }).not.toThrow();
        await expect(manager.whenLoadingSurfacePipelinesSettled(10)).resolves.toBe(true);
    });

    it('whenLoadingSurfacePipelinesSettled resolves true at once when nothing is armed', async () => {
        const manager = makeManager();
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        await expect(manager.whenLoadingSurfacePipelinesSettled()).resolves.toBe(true);

        const release = manager.beginLoadingSurface('overlay'); // surface up, still nothing armed
        await expect(manager.whenLoadingSurfacePipelinesSettled()).resolves.toBe(true);
        release();
        expect(raf).not.toHaveBeenCalled(); // no frame was waited on
    });

    it('whenLoadingSurfacePipelinesSettled waits for an armed theme\'s async pipelines to land', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass({ compileMs: 120 });
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver, { renderInStart: true });
        const manager = makeManager(theme);

        const release = manager.beginLoadingSurface('overlay');
        await manager.activateThemeInstance(theme, 'forest');
        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(theme.asyncPipelinesInFlight).toBe(3);

        const t0 = performance.now();
        const settled = manager.whenLoadingSurfacePipelinesSettled(5_000);
        await expect(runUntilSettled(settled)).resolves.toBe(true);
        expect(theme.asyncPipelinesInFlight).toBe(0);
        expect(performance.now() - t0).toBeGreaterThanOrEqual(120);
        expect(performance.now() - t0).toBeLessThan(1_000);
        release();
    });

    it('whenLoadingSurfacePipelinesSettled gives up (false) after maxMs while a pipeline never lands', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass({ compileMs: Infinity });
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver, { renderInStart: true });
        const manager = makeManager(theme);

        const release = manager.beginLoadingSurface('overlay');
        await manager.activateThemeInstance(theme, 'forest');

        const t0 = performance.now();
        await expect(runUntilSettled(manager.whenLoadingSurfacePipelinesSettled(300))).resolves.toBe(false);
        expect(performance.now() - t0).toBeGreaterThanOrEqual(300);
        expect(performance.now() - t0).toBeLessThan(300 + 3 * FRAME_MS);
        release();
    });

    it('arms before themeInstance.start() so an activation under a loading surface compiles async', async () => {
        const Backend = makeBackendClass();
        await preloadWith(Backend);

        // Without a surface: the same activation compiles synchronously.
        const plainTheme = makeWarmTheme(Backend, null, { renderInStart: true });
        const plainManager = makeManager(plainTheme);
        await plainManager.activateThemeInstance(plainTheme, 'forest');
        expect(plainTheme.renderer.backend.syncCreates).toBe(3);
        expect(plainTheme.renderer.backend.asyncCreates).toBe(0);

        const theme = makeWarmTheme(Backend, null, { renderInStart: true });
        const manager = makeManager(theme);
        const arm = vi.spyOn(manager, '_armLoadingSurfaceSession');
        const release = manager.beginLoadingSurface('mode-entry');
        await manager.activateThemeInstance(theme, 'forest');

        expect(arm).toHaveBeenCalledWith(theme, 'forest');
        expect(arm.mock.invocationCallOrder[0]).toBeLessThan(theme.start.mock.invocationCallOrder[0]);
        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(theme.renderer.backend.syncCreates).toBe(0);
        expect(manager._loadingSessions.get(theme).stats.async).toBe(3);
        expect(manager.activeTheme).toBe(theme);
        release();
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
    });

    it('arms before resume() when a prewarmed theme quick-resumes under a loading surface', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        await expect(runUntilSettled(manager.prewarmTheme('forest'))).resolves.toBe(true);
        expect(manager.pendingThemeInstance).toBe(theme);
        const createsAfterWarm = theme.renderer.backend.asyncCreates;

        const arm = vi.spyOn(manager, '_armLoadingSurfaceSession');
        const release = manager.beginLoadingSurface('mode-entry');
        await manager.resumeThemes();

        expect(theme.resume).toHaveBeenCalledTimes(1);
        expect(theme.start).toHaveBeenCalledTimes(1); // quick resume, not a rebuild
        expect(arm).toHaveBeenCalledWith(theme, 'forest');
        expect(arm.mock.invocationCallOrder[0]).toBeLessThan(theme.resume.mock.invocationCallOrder[0]);
        const session = manager._loadingSessions.get(theme);
        expect(session?.active).toBe(true);
        // The session wrapped THIS test's backend prototype (not one a stale preload resolved).
        expect(isAsyncPipelineBackend(theme.renderer.backend)).toBe(true);

        // A material first seen after the resume compiles async under the surface.
        theme.addRenderObject();
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        expect(theme.renderer.backend.asyncCreates).toBe(createsAfterWarm + 1);
        expect(theme.renderer.backend.syncCreates).toBe(0);
        expect(session.stats.async).toBe(1);
        release();
        expect(session.active).toBe(false);
    });
});

describe('ThemeManager.canUseAsyncLoadingSurface', () => {
    it('is false until the backend prototype has resolved, then true', async () => {
        const Backend = makeBackendClass();
        const manager = makeManager();

        expect(manager.canUseAsyncLoadingSurface()).toBe(false); // nothing preloaded
        const preloading = preloadWith(Backend);
        expect(manager.canUseAsyncLoadingSurface()).toBe(false); // in flight, not resolved
        await preloading;
        expect(manager.canUseAsyncLoadingSurface()).toBe(true);
    });

    it.each([
        ['the URL flag', { location: { search: '?themeWarmAsync=0' } }],
        ['the localStorage flag', {
            location: { search: '' },
            localStorage: { getItem: (key) => (key === 'serenity.themeWarmAsync' ? '0' : null) },
        }],
    ])('is false while %s rolls themeWarmAsync back, even with the prototype resolved', async (_label, fakeWindow) => {
        await preloadWith(makeBackendClass());
        const manager = makeManager();
        vi.stubGlobal('window', fakeWindow);

        expect(manager.canUseAsyncLoadingSurface()).toBe(false);
        vi.unstubAllGlobals(); // the flag was the only thing in the way
        expect(manager.canUseAsyncLoadingSurface()).toBe(true);
    });
});

describe('ThemeManager.isThemeKnownAsync', () => {
    it('is false for any theme before an async create, and for empty names', () => {
        const manager = makeManager();
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
        expect(manager.isThemeKnownAsync(null)).toBe(false);
        expect(manager.isThemeKnownAsync(undefined)).toBe(false);
        expect(manager.isThemeKnownAsync('')).toBe(false);
    });

    it('turns true after a prewarm whose session created its pipelines async', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);

        const prewarm = manager.prewarmTheme('forest');
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        expect(manager.isThemeKnownAsync('ocean')).toBe(false); // per theme, not global
        // A memory of this manager, not of the (now closed) session.
        expect(getAsyncRenderPipelineDiagnostics().sessions).toBe(0);
    });

    it('stays false after a prewarm whose session never created anything async', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        // The async session runs the whole warm, but the theme requests no pipeline at all.
        const theme = makeWarmTheme(Backend, driver, { objectCount: 0 });
        const manager = makeManager(theme);
        const { onPhase, get } = phaseRecorder(driver);

        await expect(runUntilSettled(manager.prewarmTheme('forest', { onPhase }))).resolves.toBe(true);
        expect(get('settled').payload).toMatchObject({ asyncActive: true, exitReason: 'quiet' });
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
    });

    it('stays false after a prewarm whose renderer is not the wrapped backend', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        await preloadWith(makeBackendClass());
        const WebGL2Fallback = makeBackendClass(); // a different prototype
        // start() renders while the prewarm session is up: its pipelines still compile sync.
        const theme = makeWarmTheme(WebGL2Fallback, driver, { renderInStart: true });
        const manager = makeManager(theme);

        await expect(runUntilSettled(manager.prewarmTheme('forest', { postWarmFrames: 2 }))).resolves.toBe(true);
        expect(theme.renderer.backend.syncCreates).toBe(3);
        expect(theme.renderer.backend.asyncCreates).toBe(0);
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
    });

    it('turns true after an activation armed under a loading surface compiles async', async () => {
        vi.useFakeTimers(); // the fake backend's compile timers must not outlive the test
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, null, { renderInStart: true });
        const manager = makeManager(theme);

        const release = manager.beginLoadingSurface('mode-entry');
        await manager.activateThemeInstance(theme, 'forest');
        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        release();
        expect(manager.isThemeKnownAsync('forest')).toBe(true); // outlives the surface
    });

    it('turns true once a quick resume under a loading surface creates a pipeline async', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);
        // Not preloaded yet: the warm takes the legacy (synchronous) path, which proves nothing.
        await expect(runUntilSettled(manager.prewarmTheme('forest', { postWarmFrames: 2 }))).resolves.toBe(true);
        expect(theme.renderer.backend.syncCreates).toBe(3);
        expect(manager.isThemeKnownAsync('forest')).toBe(false);

        await preloadWith(Backend);
        const release = manager.beginLoadingSurface('mode-entry');
        await manager.resumeThemes();
        expect(theme.resume).toHaveBeenCalledTimes(1);
        expect(manager._loadingSessions.get(theme)?.active).toBe(true);
        expect(manager.isThemeKnownAsync('forest')).toBe(false); // armed, nothing compiled yet

        theme.addRenderObject(); // a material first seen after the resume
        await vi.advanceTimersByTimeAsync(FRAME_MS * 2);
        expect(theme.renderer.backend.asyncCreates).toBe(1);
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        release();
    });

    it('stays false when the armed theme renders through a backend that is not the wrapped one', async () => {
        await preloadWith(makeBackendClass());
        const WebGL2Fallback = makeBackendClass();
        const theme = makeWarmTheme(WebGL2Fallback, null, { renderInStart: true });
        const manager = makeManager(theme);

        const release = manager.beginLoadingSurface('mode-entry');
        await manager.activateThemeInstance(theme, 'forest');
        expect(manager._loadingSessions.get(theme)?.active).toBe(true); // armed ...
        expect(theme.renderer.backend.syncCreates).toBe(3); // ... but its creates never reach it
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
        release();
        expect(manager.isThemeKnownAsync('forest')).toBe(false);
    });
});

describe('ThemeManager.whenLoadingSurfaceEngaged', () => {
    it('resolves false at once when no loading surface is up', async () => {
        await preloadWith(makeBackendClass());
        const manager = makeManager();
        expect(await peek(manager.whenLoadingSurfaceEngaged())).toEqual({ settled: true, value: false });

        // A rolled-back surface is no surface.
        vi.stubGlobal('window', { location: { search: '?themeWarmAsync=0' } });
        const release = manager.beginLoadingSurface('overlay');
        expect(await peek(manager.whenLoadingSurfaceEngaged())).toEqual({ settled: true, value: false });
        release();
    });

    it('resolves true when an armed theme creates its first pipeline async, and at once after that', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver); // start() renders nothing; its loop does
        const manager = makeManager(theme);

        const release = manager.beginLoadingSurface('mode-entry');
        const engaged = manager.whenLoadingSurfaceEngaged();
        await manager.activateThemeInstance(theme, 'forest');
        expect(manager._loadingSessions.get(theme)?.active).toBe(true); // armed ...
        expect(theme.renderer.backend.asyncCreates).toBe(0); // ... nothing requested yet
        expect(await peek(engaged)).toMatchObject({ settled: false });

        await vi.advanceTimersByTimeAsync(FRAME_MS); // the first frame requests the pipelines
        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(await peek(engaged)).toEqual({ settled: true, value: true });
        // Already engaged: a later ask resolves at once, with no frame advanced.
        expect(await peek(manager.whenLoadingSurfaceEngaged())).toEqual({ settled: true, value: true });
        release();
    });

    it('resolves false when the surface is fully released without engaging', async () => {
        await preloadWith(makeBackendClass());
        const WebGL2Fallback = makeBackendClass();
        const theme = makeWarmTheme(WebGL2Fallback, null, { renderInStart: true });
        const manager = makeManager(theme);

        const releaseOverlay = manager.beginLoadingSurface('overlay');
        const releaseSplash = manager.beginLoadingSurface('splash');
        const engaged = manager.whenLoadingSurfaceEngaged();
        await manager.activateThemeInstance(theme, 'forest'); // armed, but compiles sync
        expect(theme.renderer.backend.syncCreates).toBe(3);
        expect(await peek(engaged)).toMatchObject({ settled: false });

        releaseSplash(); // an inner release does not end the surface
        expect(await peek(engaged)).toMatchObject({ settled: false });
        releaseOverlay();
        expect(await peek(engaged)).toEqual({ settled: true, value: false });
    });

    it('scopes waiters and "already engaged" to one surface', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity }); // no timers outlive the test
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, null, { renderInStart: true });
        const manager = makeManager(theme);

        // Surface A lifts before anything arms: its waiter resolves false ...
        const releaseA = manager.beginLoadingSurface('overlay');
        const waiterA = manager.whenLoadingSurfaceEngaged();
        releaseA();
        expect(await peek(waiterA)).toEqual({ settled: true, value: false });

        // ... surface B engages without it, and B's own waiter resolves true.
        const releaseB = manager.beginLoadingSurface('mode-entry');
        const waiterB = manager.whenLoadingSurfaceEngaged();
        await manager.activateThemeInstance(theme, 'forest');
        expect(await peek(waiterB)).toEqual({ settled: true, value: true });
        expect(await peek(waiterA)).toEqual({ settled: true, value: false });
        releaseB();

        // Surface C: the theme is known async, but nothing has engaged under C.
        const releaseC = manager.beginLoadingSurface('overlay');
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        const waiterC = manager.whenLoadingSurfaceEngaged();
        expect(await peek(waiterC)).toMatchObject({ settled: false });
        releaseC();
        expect(await peek(waiterC)).toEqual({ settled: true, value: false });
    });

    it('never lets a released surface\'s late engagement resolve the next surface\'s waiter', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity });
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, null); // start() renders nothing
        const manager = makeManager(theme);
        const releaseFirst = manager.beginLoadingSurface('overlay');
        await manager.activateThemeInstance(theme, 'forest');
        const firstSession = manager._loadingSessions.get(theme);
        expect(firstSession.engaged).toBe(false);

        // The first async create and the surface hand-off land in one tick: the first session's
        // engaged notification is still queued when the next surface registers its waiter.
        theme.renderFrame();
        expect(firstSession.engaged).toBe(true);
        releaseFirst();
        const releaseNext = manager.beginLoadingSurface('splash');
        const next = manager.whenLoadingSurfaceEngaged();

        expect(await peek(next)).toMatchObject({ settled: false });
        expect(manager.isThemeKnownAsync('forest')).toBe(true); // the engagement itself counts
        releaseNext();
        expect(await peek(next)).toEqual({ settled: true, value: false });
    });

    it('never answers a named waiter with another theme\'s engagement on a still-open surface', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity }); // no timers outlive the test
        await preloadWith(Backend);
        const forest = makeWarmTheme(Backend, null, { name: 'forest', renderInStart: true });
        const manager = makeManager();

        // A previous entry's surface, still held open for forest (e.g. retained past its overlay),
        // plus the next entry's own surface on top of it.
        const releaseRetained = manager.beginLoadingSurface('retained');
        const releaseEntry = manager.beginLoadingSurface('mode-entry');
        const oceanEarly = manager.whenLoadingSurfaceEngaged('ocean'); // pending when forest engages
        const forestWaiter = manager.whenLoadingSurfaceEngaged('forest');
        const anyWaiter = manager.whenLoadingSurfaceEngaged();
        manager._armLoadingSurfaceSession(forest, 'forest');
        await forest.start();
        expect(forest.renderer.backend.asyncCreates).toBe(3);
        expect(manager._loadingSessions.get(forest).engaged).toBe(true);

        // Forest's engagement answers forest and the unscoped waiter ...
        expect(await peek(forestWaiter)).toEqual({ settled: true, value: true });
        expect(await peek(anyWaiter)).toEqual({ settled: true, value: true });
        // ... but never ocean: neither a waiter queued before it nor one asked after it.
        expect(await peek(oceanEarly)).toMatchObject({ settled: false });
        const oceanLate = manager.whenLoadingSurfaceEngaged('ocean');
        expect(await peek(oceanLate)).toMatchObject({ settled: false });
        // The "already engaged" fast path is scoped the same way.
        expect(await peek(manager.whenLoadingSurfaceEngaged('forest'))).toEqual({ settled: true, value: true });
        expect(await peek(manager.whenLoadingSurfaceEngaged())).toEqual({ settled: true, value: true });

        releaseEntry(); // depth 2 → 1: the surface is still up
        expect(await peek(oceanEarly)).toMatchObject({ settled: false });
        expect(await peek(oceanLate)).toMatchObject({ settled: false });
        releaseRetained(); // depth → 0: ocean's waiters are released false
        expect(await peek(oceanEarly)).toEqual({ settled: true, value: false });
        expect(await peek(oceanLate)).toEqual({ settled: true, value: false });
        expect(manager._loadingEngagedWaiters).toEqual([]);
    });

    it('resolves a named waiter true once that theme\'s own session engages', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity });
        await preloadWith(Backend);
        const forest = makeWarmTheme(Backend, null, { name: 'forest', renderInStart: true });
        const ocean = makeWarmTheme(Backend, null, { name: 'ocean', renderInStart: true });
        const manager = makeManager();

        const release = manager.beginLoadingSurface('mode-entry');
        manager._armLoadingSurfaceSession(forest, 'forest');
        await forest.start(); // forest engages first
        const oceanWaiter = manager.whenLoadingSurfaceEngaged('ocean');
        const desertWaiter = manager.whenLoadingSurfaceEngaged('desert');
        expect(await peek(oceanWaiter)).toMatchObject({ settled: false });

        manager._armLoadingSurfaceSession(ocean, 'ocean');
        expect(await peek(oceanWaiter)).toMatchObject({ settled: false }); // armed is not engaged
        await ocean.start();
        expect(ocean.renderer.backend.asyncCreates).toBe(3);
        expect(await peek(oceanWaiter)).toEqual({ settled: true, value: true });
        expect(await peek(manager.whenLoadingSurfaceEngaged('ocean'))).toEqual({ settled: true, value: true });
        // Ocean's engagement answers ocean only.
        expect(await peek(desertWaiter)).toMatchObject({ settled: false });
        release();
        expect(await peek(desertWaiter)).toEqual({ settled: true, value: false });
    });
});

describe('ThemeManager — a theme that builds its own pipelines async (buildsPipelinesAsync)', () => {
    it('engages on a microtask once armed, with no pipeline through three\'s backend', async () => {
        await preloadWith(makeBackendClass());
        const manager = makeManager();
        // A raw-WebGPU theme: no three renderer, its pipelines never reach the wrapper.
        const rawTheme = { name: 'raw-webgpu-theme', renderer: null, buildsPipelinesAsync: true };

        const release = manager.beginLoadingSurface('mode-entry');
        const before = manager.whenLoadingSurfaceEngaged('raw-webgpu-theme'); // main.js asks before arming
        const other = manager.whenLoadingSurfaceEngaged('forest');
        const session = manager._armLoadingSurfaceSession(rawTheme, 'raw-webgpu-theme');
        expect(session).not.toBeNull();
        // Deferred to a microtask, so a waiter registered in the arming tick still gets the answer.
        expect(manager.isThemeKnownAsync('raw-webgpu-theme')).toBe(false);
        const sameTick = manager.whenLoadingSurfaceEngaged('raw-webgpu-theme');
        const unscoped = manager.whenLoadingSurfaceEngaged();

        expect(await peek(before)).toEqual({ settled: true, value: true });
        expect(await peek(sameTick)).toEqual({ settled: true, value: true });
        expect(await peek(unscoped)).toEqual({ settled: true, value: true });
        expect(await peek(other)).toMatchObject({ settled: false }); // scoped like any engagement
        expect(manager.isThemeKnownAsync('raw-webgpu-theme')).toBe(true);
        expect(session.stats.async).toBe(0); // no pipeline was created to prove it
        expect(session.engaged).toBe(false);

        release();
        expect(await peek(other)).toEqual({ settled: true, value: false });
    });

    it('is remembered by prewarmTheme even though no three pipeline went async', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        await preloadWith(makeBackendClass());
        const OwnDevice = makeBackendClass(); // not the wrapped prototype
        // prewarmTheme takes a registered id only: the double borrows one. The flag, not the name,
        // is what makes it a raw-WebGPU theme.
        const theme = makeWarmTheme(OwnDevice, driver, { name: 'forest', objectCount: 0 });
        theme.buildsPipelinesAsync = true;
        const manager = makeManager(theme);
        const { onPhase, get } = phaseRecorder(driver);

        const prewarm = manager.prewarmTheme('forest', { postWarmFrames: 2, onPhase });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);

        // The warm itself ran on the legacy path: three's wrapper saw nothing async.
        expect(get('started').payload).toMatchObject({ asyncActive: false, syncRenderer: false });
        expect(theme.renderer.backend.asyncCreates).toBe(0);
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        expect(manager.isThemeKnownAsync('ocean')).toBe(false);
    });
});

describe('ThemeManager.beginLoadingSurface — release keeps the known-async memo honest', () => {
    it('forgets a theme that rebuilt off the wrapped backend (device loss → WebGL2) and keeps the rest', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity });
        await preloadWith(Backend);
        const forest = makeWarmTheme(Backend, null, { name: 'forest', renderInStart: true });
        const ocean = makeWarmTheme(Backend, null, { name: 'ocean', renderInStart: true });
        const rawTheme = { name: 'raw-webgpu-theme', renderer: null, buildsPipelinesAsync: true };
        const manager = makeManager();

        // Surface A: forest and ocean build on the wrapped WebGPU backend and engage.
        const releaseA = manager.beginLoadingSurface('mode-entry');
        manager._armLoadingSurfaceSession(forest, 'forest');
        manager._armLoadingSurfaceSession(ocean, 'ocean');
        await forest.start();
        await ocean.start();
        await peek(Promise.resolve()); // the engaged notifications
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        expect(manager.isThemeKnownAsync('ocean')).toBe(true);
        releaseA();
        // Still on the wrapped backend at release: both kept.
        expect(manager.isThemeKnownAsync('forest')).toBe(true);
        expect(manager.isThemeKnownAsync('ocean')).toBe(true);

        // Device loss: forest rebuilds on a WebGL2 backend (another prototype); ocean does not.
        const WebGL2Backend = makeBackendClass();
        const rebuilt = { compileAsync: vi.fn(async () => {}) };
        rebuilt.backend = new WebGL2Backend(rebuilt);
        forest.renderer = rebuilt;

        // Surface B arms all three; forest's rebuild compiles synchronously under it.
        const releaseB = manager.beginLoadingSurface('mode-entry');
        manager._armLoadingSurfaceSession(forest, 'forest');
        manager._armLoadingSurfaceSession(ocean, 'ocean');
        manager._armLoadingSurfaceSession(rawTheme, 'raw-webgpu-theme');
        forest.renderObjects.forEach((renderObject) => { renderObject.requested = false; });
        forest.renderFrame();
        expect(rebuilt.backend.syncCreates).toBe(3);
        expect(rebuilt.backend.asyncCreates).toBe(0);
        await peek(Promise.resolve()); // the raw-WebGPU theme's engagement
        expect(manager.isThemeKnownAsync('raw-webgpu-theme')).toBe(true);
        expect(manager.isThemeKnownAsync('forest')).toBe(true); // a stale memory until the release

        releaseB();
        expect(manager.isThemeKnownAsync('forest')).toBe(false); // next entry keeps the calm-hold
        expect(manager.isThemeKnownAsync('ocean')).toBe(true); // still on the wrapped backend
        expect(manager.isThemeKnownAsync('raw-webgpu-theme')).toBe(true); // declares buildsPipelinesAsync
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
    });
});

describe('ThemeManager.prewarmTheme — started.syncRenderer', () => {
    /** Prewarm `theme` (legacy frames kept short) and return its 'started' payload. */
    async function startedPayload(manager, driver, themeName = 'forest') {
        const { onPhase, get } = phaseRecorder(driver);
        const prewarm = manager.prewarmTheme(themeName, { postWarmFrames: 2, onPhase });
        await expect(runUntilSettled(prewarm)).resolves.toBe(true);
        return get('started').payload;
    }

    it('is true for a dedicated renderer on a backend that is not the wrapped one', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        await preloadWith(makeBackendClass());
        const WebGL2Fallback = makeBackendClass();
        const theme = makeWarmTheme(WebGL2Fallback, driver);
        const manager = makeManager(theme);

        expect(await startedPayload(manager, driver)).toMatchObject({ asyncActive: false, syncRenderer: true });
        expect(theme.renderer.backend.syncCreates).toBe(3);
    });

    it('is true for a dedicated WebGPU renderer when the backend prototype never preloaded', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const theme = makeWarmTheme(makeBackendClass(), driver);
        const manager = makeManager(theme);

        expect(await startedPayload(manager, driver)).toMatchObject({ asyncActive: false, syncRenderer: true });
    });

    it('is false for the manager\'s shared renderer', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        await preloadWith(makeBackendClass());
        let manager = null;
        // start() renders through the renderer the manager hands it (no backend of its own).
        const theme = makeWarmTheme(makeBackendClass(), driver, {
            objectCount: 0,
            onStart: (t) => { t.renderer = manager.webglRenderer; },
        });
        manager = makeManager(theme);

        expect(await startedPayload(manager, driver)).toMatchObject({ asyncActive: false, syncRenderer: false });
        expect(theme.renderer).toBe(manager.webglRenderer);
    });

    it('is false for a theme with no renderer of its own', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        await preloadWith(makeBackendClass());
        const theme = makeWarmTheme(makeBackendClass(), driver, {
            objectCount: 0,
            onStart: (t) => { t.renderer = null; },
        });
        const manager = makeManager(theme);

        expect(await startedPayload(manager, driver)).toMatchObject({ asyncActive: false, syncRenderer: false });
    });

    it('is false when the warm runs async', async () => {
        vi.useFakeTimers();
        const driver = installFrameDriver();
        const Backend = makeBackendClass();
        await preloadWith(Backend);
        const theme = makeWarmTheme(Backend, driver);
        const manager = makeManager(theme);

        expect(await startedPayload(manager, driver)).toMatchObject({ asyncActive: true, syncRenderer: false });
        expect(theme.renderer.backend.asyncCreates).toBe(3);
    });
});

describe('ThemeManager.beginLoadingSurface — backend prototype preload', () => {
    it('starts the preload itself, so a boot that never preloaded still arms a theme started later', async () => {
        const Backend = makeBackendClass({ compileMs: Infinity });
        mockedThreeWebGPU.WebGPUBackend = Backend; // what import('three/webgpu') resolves to
        const theme = makeWarmTheme(Backend, null, { renderInStart: true });
        const manager = makeManager(theme);
        const preload = vi.spyOn(manager, 'preloadAsyncRenderPipelines');
        expect(manager.canUseAsyncLoadingSurface()).toBe(false); // the boot never preloaded

        const release = manager.beginLoadingSurface('mode-entry');
        expect(typeof release).toBe('function'); // returned synchronously: fire-and-forget
        expect(preload).toHaveBeenCalledTimes(1);
        // Not awaited: in the same tick the prototype is unresolved and arming stays sync.
        expect(manager.canUseAsyncLoadingSurface()).toBe(false);
        expect(manager._armLoadingSurfaceSession(theme, 'forest')).toBeNull();

        await expect(preload.mock.results[0].value).resolves.toBe(Backend.prototype);
        expect(manager.canUseAsyncLoadingSurface()).toBe(true);
        await manager.activateThemeInstance(theme, 'forest');
        expect(theme.renderer.backend.asyncCreates).toBe(3);
        expect(theme.renderer.backend.syncCreates).toBe(0);
        expect(manager._loadingSessions.get(theme)?.stats.async).toBe(3);
        release();
        expect(getAsyncRenderPipelineDiagnostics()).toMatchObject({ installed: false, sessions: 0 });
    });

    it('swallows a failed preload: the surface still refcounts and releases', async () => {
        const manager = makeManager();
        vi.spyOn(manager, 'preloadAsyncRenderPipelines')
            .mockImplementation(() => Promise.reject(new Error('three/webgpu failed to load')));

        let release = null;
        expect(() => { release = manager.beginLoadingSurface('overlay'); }).not.toThrow();
        await peek(Promise.resolve()); // the rejection is handled, not reported as unhandled
        expect(manager._loadingSurfaceDepth).toBe(1);
        expect(manager.canUseAsyncLoadingSurface()).toBe(false);
        expect(await peek(manager.whenLoadingSurfaceEngaged())).toMatchObject({ settled: false });
        release();
        expect(manager._loadingSurfaceDepth).toBe(0);
    });

    it('does not preload while themeWarmAsync is rolled back', () => {
        vi.stubGlobal('window', { location: { search: '?themeWarmAsync=0' } });
        const manager = makeManager();
        const preload = vi.spyOn(manager, 'preloadAsyncRenderPipelines');

        manager.beginLoadingSurface('overlay')();
        expect(preload).not.toHaveBeenCalled();
    });
});
