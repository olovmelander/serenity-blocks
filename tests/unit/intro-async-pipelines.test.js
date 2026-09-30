import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import ThreeJSIntroRendererWebGPU from '../../src/ui/threejs-intro-renderer-webgpu.js';
import { IntroAnimation } from '../../src/ui/intro-animation.js';

// The intro's two "don't freeze the boot screen" paths:
//  (1) ThreeJSIntroRendererWebGPU.startComputeCompile + the _computeReady gate in update():
//      compute pipelines are created on Dawn's async workers and the dispatch waits for them.
//  (2) IntroAnimation.beginIntroPipelineSession: an async-render-pipelines session owns the
//      intro renderer until its pipelines go quiet, so its first frames never compile sync.
// Both collaborators are mocked; update() is driven for real against stub GPU objects.

const computeMocks = vi.hoisted(() => ({
    isAsyncComputeCapable: vi.fn(),
    compileComputeAsync: vi.fn(),
}));

const pipelineMocks = vi.hoisted(() => ({
    preload: vi.fn(),
    begin: vi.fn(),
    markStartup: vi.fn(),
}));

vi.mock('../../src/rendering/webgpu-compute-pipeline-async.js', () => ({
    isAsyncComputeCapable: computeMocks.isAsyncComputeCapable,
    compileComputeAsync: computeMocks.compileComputeAsync,
}));

vi.mock('../../src/rendering/async-render-pipelines.js', () => ({
    preloadAsyncRenderPipelines: pipelineMocks.preload,
    beginAsyncRenderPipelines: pipelineMocks.begin,
}));

vi.mock('../../src/ui/startup-debug.js', () => ({
    markStartup: pipelineMocks.markStartup,
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let queued promise callbacks (the settle → end chain) run. */
function flush() {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
}

// ---------------------------------------------------------------------------------------------
// (1) startComputeCompile + the compute gate
// ---------------------------------------------------------------------------------------------

/**
 * A constructed intro renderer with just enough stub state for update() to run a whole frame:
 * a fake WebGPURenderer (compute/render/dispose), a real camera + scene, stub particle and
 * tetromino computes, and a post-processing stub. Spawning is disabled so frames are pure.
 */
function makeIntroVisual({ computeFrameSkip = 1, particles = true, tetrominos = true } = {}) {
    const visual = new ThreeJSIntroRendererWebGPU(null);
    visual.renderer = {
        compute: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
    };
    visual.scene = new THREE.Scene();
    visual.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    visual.camera.position.z = 40;
    visual.postProcessing = { render: vi.fn(), dispose: vi.fn() };
    visual.particleCompute = particles ? {
        computeNode: { isComputeNode: true, id: 'particle-compute' },
        setAttractionStrength: vi.fn(),
        setAudioPulse: vi.fn(),
        setWarpFactor: vi.fn(),
        setEventIntensity: vi.fn(),
        update: vi.fn(),
        dispose: vi.fn(),
    } : null;
    visual.tetrominoCompute = tetrominos ? {
        computeNode: { isComputeNode: true, id: 'tetromino-compute' },
        update: vi.fn(),
        spawn: vi.fn(() => -1),
        dispose: vi.fn(),
    } : null;
    visual.quality = { ...visual.quality, computeFrameSkip };
    visual.spawnInterval = Infinity;
    return visual;
}

describe('intro renderer: async compute compile + dispatch gate', () => {
    let warnSpy;
    // Only the intro's own compile warning: three also warns (once) that THREE.Clock is deprecated.
    const compileWarnings = () => warnSpy.mock.calls
        .filter(([message]) => message === '[IntroWebGPU] Async compute compile:');

    beforeEach(() => {
        computeMocks.isAsyncComputeCapable.mockReset().mockReturnValue(true);
        computeMocks.compileComputeAsync.mockReset();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('defaults the gate open so a renderer without the async path keeps dispatching', () => {
        const visual = new ThreeJSIntroRendererWebGPU(null);
        expect(visual._computeReady).toBe(true);
        expect(visual.computeReadyPromise).toBeNull();
        expect(visual._destroyed).toBe(false);
    });

    it('returns null and leaves the gate open when the renderer is not async-compute capable', () => {
        computeMocks.isAsyncComputeCapable.mockReturnValue(false);
        const visual = makeIntroVisual();

        expect(visual.startComputeCompile()).toBeNull();

        expect(computeMocks.isAsyncComputeCapable).toHaveBeenCalledWith(visual.renderer);
        expect(computeMocks.compileComputeAsync).not.toHaveBeenCalled();
        expect(visual._computeReady).toBe(true);
        expect(visual.computeReadyPromise).toBeNull();

        visual.update();
        expect(visual.renderer.compute).toHaveBeenCalledTimes(2);
    });

    it('returns null without consulting the capability check when there is nothing to compile', () => {
        const visual = makeIntroVisual({ particles: false, tetrominos: false });

        expect(visual.startComputeCompile()).toBeNull();

        expect(computeMocks.isAsyncComputeCapable).not.toHaveBeenCalled();
        expect(computeMocks.compileComputeAsync).not.toHaveBeenCalled();
        expect(visual._computeReady).toBe(true);
    });

    it('compiles both compute nodes (tetromino, then particle) in one async batch', () => {
        computeMocks.compileComputeAsync.mockReturnValue(new Promise(() => {}));
        const visual = makeIntroVisual();

        const promise = visual.startComputeCompile();

        expect(promise).toBeInstanceOf(Promise);
        expect(visual.computeReadyPromise).toBe(promise);
        expect(computeMocks.compileComputeAsync).toHaveBeenCalledTimes(1);
        expect(computeMocks.compileComputeAsync).toHaveBeenCalledWith(visual.renderer, [
            visual.tetrominoCompute.computeNode,
            visual.particleCompute.computeNode,
        ]);
    });

    it('keeps drawing but skips every compute dispatch while the pipelines are pending', () => {
        computeMocks.compileComputeAsync.mockReturnValue(new Promise(() => {}));
        const visual = makeIntroVisual();

        visual.startComputeCompile();
        expect(visual._computeReady).toBe(false);

        visual.update();
        visual.update();
        visual.update();

        expect(visual.renderer.compute).not.toHaveBeenCalled();
        // The tetromino CPU→GPU update belongs to the dispatch and is gated with it...
        expect(visual.tetrominoCompute.update).not.toHaveBeenCalled();
        // ...while the frame itself (uniform updates + the post render) still happens.
        expect(visual.particleCompute.update).toHaveBeenCalledTimes(3);
        expect(visual.postProcessing.render).toHaveBeenCalledTimes(3);
    });

    it('opens the gate once the compile resolves ready, then dispatches both nodes', async () => {
        const pending = deferred();
        computeMocks.compileComputeAsync.mockReturnValue(pending.promise);
        const visual = makeIntroVisual();

        const promise = visual.startComputeCompile();
        visual.update();
        expect(visual.renderer.compute).not.toHaveBeenCalled();

        const result = { status: 'ready', created: 2, failed: 0 };
        pending.resolve(result);
        await expect(promise).resolves.toBe(result);

        expect(visual._computeReady).toBe(true);
        expect(compileWarnings()).toHaveLength(0);

        visual.update();
        expect(visual.renderer.compute.mock.calls).toEqual([
            [visual.particleCompute.computeNode],
            [visual.tetrominoCompute.computeNode],
        ]);
        expect(visual.tetrominoCompute.update).toHaveBeenCalledTimes(1);
    });

    it.each(['timeout', 'failed', 'unsupported', 'disabled'])(
        'opens the gate (with a warning) on a non-ready, non-error status: %s',
        async (status) => {
            computeMocks.compileComputeAsync.mockResolvedValue({ status });
            const visual = makeIntroVisual();

            await visual.startComputeCompile();

            expect(visual._computeReady).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith('[IntroWebGPU] Async compute compile:', status, '');
            visual.update();
            expect(visual.renderer.compute).toHaveBeenCalledTimes(2);
        },
    );

    it('keeps the gate closed when the compile reports an error status', async () => {
        computeMocks.compileComputeAsync.mockResolvedValue({ status: 'error', message: 'bad TSL' });
        const visual = makeIntroVisual();

        await visual.startComputeCompile();

        expect(visual._computeReady).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith('[IntroWebGPU] Async compute compile:', 'error', 'bad TSL');
        visual.update();
        expect(visual.renderer.compute).not.toHaveBeenCalled();
    });

    it('turns a rejected compile (TSL build threw) into a resolved error result and stays gated', async () => {
        computeMocks.compileComputeAsync.mockRejectedValue(new Error('TSL build exploded'));
        const visual = makeIntroVisual();

        const promise = visual.startComputeCompile();

        // Never rejects: a rejection here would be unhandled (init() does not await it).
        await expect(promise).resolves.toEqual({ status: 'error', message: 'TSL build exploded' });
        expect(visual._computeReady).toBe(false);
        visual.update();
        expect(visual.renderer.compute).not.toHaveBeenCalled();
        expect(visual.postProcessing.render).toHaveBeenCalledTimes(1);
    });

    it('stringifies a non-Error rejection into the error message', async () => {
        computeMocks.compileComputeAsync.mockRejectedValue('device went away');
        const visual = makeIntroVisual();

        await expect(visual.startComputeCompile()).resolves.toEqual({
            status: 'error',
            message: 'device went away',
        });
        expect(visual._computeReady).toBe(false);
    });

    it('does not reopen the gate when destroy() runs before the compile resolves', async () => {
        const pending = deferred();
        computeMocks.compileComputeAsync.mockReturnValue(pending.promise);
        const visual = makeIntroVisual();
        const { renderer } = visual;

        const promise = visual.startComputeCompile();
        visual.destroy();
        expect(visual._destroyed).toBe(true);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);

        pending.resolve({ status: 'ready' });
        await promise;

        expect(visual._computeReady).toBe(false);
        expect(renderer.compute).not.toHaveBeenCalled();
    });

    it('does not consume computeFrameSkip slots while gated: the first ready frame dispatches', async () => {
        const pending = deferred();
        computeMocks.compileComputeAsync.mockReturnValue(pending.promise);
        const visual = makeIntroVisual({ computeFrameSkip: 2, tetrominos: false });

        const promise = visual.startComputeCompile();
        visual.update();
        visual.update();
        visual.update();
        expect(visual.computeFrameCounter).toBe(0);

        pending.resolve({ status: 'ready' });
        await promise;

        visual.update(); // counter 0 → dispatch
        expect(visual.renderer.compute).toHaveBeenCalledTimes(1);
        visual.update(); // counter 1 → skipped
        expect(visual.renderer.compute).toHaveBeenCalledTimes(1);
        visual.update(); // counter 2 → dispatch
        expect(visual.renderer.compute).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------------------------
// (2) IntroAnimation.beginIntroPipelineSession
// ---------------------------------------------------------------------------------------------

const SESSION_STATS = Object.freeze({
    async: 4,
    syncExempt: 1,
    failed: 0,
    errorScopeRepaired: 0,
    maxInFlight: 3,
    inFlight: 0,
});

function makeSession(stats = SESSION_STATS) {
    const settled = deferred();
    const session = {
        settle: vi.fn(() => settled.promise),
        end: vi.fn(() => ({ ...stats })),
    };
    return { session, settled };
}

function endMarks() {
    return pipelineMocks.markStartup.mock.calls.filter(([phase]) => phase === 'intro:pipelines-async-end');
}

function stubWindow({ search = '', storage = {} } = {}) {
    vi.stubGlobal('window', {
        location: { search },
        localStorage: { getItem: (key) => (key in storage ? storage[key] : null) },
    });
}

describe('IntroAnimation.beginIntroPipelineSession', () => {
    let now;
    let nowSpy;

    beforeEach(() => {
        pipelineMocks.preload.mockReset().mockResolvedValue({ kind: 'WebGPUBackend.prototype' });
        pipelineMocks.begin.mockReset();
        pipelineMocks.markStartup.mockReset();
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    it.each([
        ['the ?themeWarmAsync=0 URL flag', { search: '?themeWarmAsync=0' }],
        ['the serenity.themeWarmAsync=0 localStorage flag', { storage: { 'serenity.themeWarmAsync': '0' } }],
    ])('is skipped entirely under %s', async (_label, windowOptions) => {
        stubWindow(windowOptions);
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession({ renderer: { id: 'intro-renderer' } });

        expect(pipelineMocks.preload).not.toHaveBeenCalled();
        expect(pipelineMocks.begin).not.toHaveBeenCalled();
        expect(pipelineMocks.markStartup).not.toHaveBeenCalled();
    });

    it.each([
        ['no visual', undefined],
        ['a visual without a renderer', {}],
        ['a visual whose renderer is null', { renderer: null }],
    ])('is skipped for %s', async (_label, visual) => {
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession(visual);

        expect(pipelineMocks.preload).not.toHaveBeenCalled();
        expect(pipelineMocks.begin).not.toHaveBeenCalled();
        expect(pipelineMocks.markStartup).not.toHaveBeenCalled();
    });

    it('does nothing more when the session cannot begin (begin returns null)', async () => {
        pipelineMocks.begin.mockReturnValue(null);
        const intro = new IntroAnimation();
        const renderer = { id: 'intro-renderer' };

        await intro.beginIntroPipelineSession({ renderer });

        expect(pipelineMocks.begin).toHaveBeenCalledTimes(1);
        expect(pipelineMocks.markStartup).not.toHaveBeenCalled();
    });

    it('gives up quietly when the preload rejects', async () => {
        pipelineMocks.preload.mockRejectedValue(new Error('three/webgpu failed to load'));
        const intro = new IntroAnimation();

        await expect(intro.beginIntroPipelineSession({ renderer: {} })).resolves.toBeUndefined();

        expect(pipelineMocks.begin).not.toHaveBeenCalled();
        expect(pipelineMocks.markStartup).not.toHaveBeenCalled();
    });

    it('begins only after the preload settles (begin is synchronous and needs the prototype)', async () => {
        const preload = deferred();
        pipelineMocks.preload.mockReturnValue(preload.promise);
        const { session } = makeSession();
        pipelineMocks.begin.mockReturnValue(session);
        const intro = new IntroAnimation();

        const call = intro.beginIntroPipelineSession({ renderer: {} });
        await flush();
        expect(pipelineMocks.begin).not.toHaveBeenCalled();

        preload.resolve({});
        await call;
        expect(pipelineMocks.begin).toHaveBeenCalledTimes(1);
    });

    it('owns the intro renderer, marks the start and returns without waiting for settle', async () => {
        const { session } = makeSession();
        pipelineMocks.begin.mockReturnValue(session);
        const intro = new IntroAnimation();
        const renderer = { id: 'intro-renderer' };

        // settle never resolves here: the call must still return (initRenderer awaits it).
        await intro.beginIntroPipelineSession({ renderer });

        expect(pipelineMocks.begin).toHaveBeenCalledWith({ name: 'intro', renderer }, { label: 'intro' });
        expect(pipelineMocks.markStartup).toHaveBeenCalledWith('intro:pipelines-async-start');
        expect(session.settle).toHaveBeenCalledWith({ maxMs: 15000, quietFrames: 30 });
        expect(session.end).not.toHaveBeenCalled();
        expect(endMarks()).toHaveLength(0);
        expect(typeof intro.endIntroPipelineSession).toBe('function');
    });

    it.each([
        [true, 'quiet'],
        [false, 'timeout'],
    ])('ends the session when settle resolves %s → reason "%s"', async (quiet, reason) => {
        const { session, settled } = makeSession();
        pipelineMocks.begin.mockReturnValue(session);
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession({ renderer: {} });
        now = 1250;
        settled.resolve(quiet);
        await flush();

        expect(session.end).toHaveBeenCalledTimes(1);
        expect(endMarks()).toEqual([[
            'intro:pipelines-async-end',
            { reason, ms: 250, ...SESSION_STATS },
        ]]);
    });

    it('ends the session with reason "error" when settle rejects', async () => {
        const { session, settled } = makeSession();
        pipelineMocks.begin.mockReturnValue(session);
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession({ renderer: {} });
        settled.reject(new Error('raf loop died'));
        await flush();

        expect(session.end).toHaveBeenCalledTimes(1);
        expect(endMarks()).toHaveLength(1);
        expect(endMarks()[0][1]).toMatchObject({ reason: 'error' });
    });

    it('a second call ends the previous session as "replaced", exactly once', async () => {
        const first = makeSession({ ...SESSION_STATS, async: 1 });
        const second = makeSession({ ...SESSION_STATS, async: 2 });
        pipelineMocks.begin
            .mockReturnValueOnce(first.session)
            .mockReturnValueOnce(second.session);
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession({ renderer: { id: 'a' } });
        now = 1100;
        await intro.beginIntroPipelineSession({ renderer: { id: 'b' } });

        expect(first.session.end).toHaveBeenCalledTimes(1);
        expect(second.session.end).not.toHaveBeenCalled();
        expect(endMarks()).toEqual([[
            'intro:pipelines-async-end',
            {
                reason: 'replaced', ms: 100, ...SESSION_STATS, async: 1,
            },
        ]]);

        // The replaced session's own settle landing later must not end/mark it a second time.
        first.settled.resolve(true);
        await flush();
        expect(first.session.end).toHaveBeenCalledTimes(1);
        expect(endMarks()).toHaveLength(1);

        // The replacement still ends on its own settle.
        now = 1400;
        second.settled.resolve(true);
        await flush();
        expect(second.session.end).toHaveBeenCalledTimes(1);
        expect(endMarks()).toHaveLength(2);
        expect(endMarks()[1][1]).toEqual({
            reason: 'quiet', ms: 300, ...SESSION_STATS, async: 2,
        });
    });

    it('treats a late endIntroPipelineSession() after a settled end as a no-op', async () => {
        const { session, settled } = makeSession();
        pipelineMocks.begin.mockReturnValue(session);
        const intro = new IntroAnimation();

        await intro.beginIntroPipelineSession({ renderer: {} });
        settled.resolve(true);
        await flush();
        intro.endIntroPipelineSession();

        expect(session.end).toHaveBeenCalledTimes(1);
        expect(endMarks()).toHaveLength(1);
        expect(endMarks()[0][1]).toMatchObject({ reason: 'quiet' });
    });
});
