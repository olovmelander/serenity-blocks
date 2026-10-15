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

// The intro's "don't freeze the boot screen" path: IntroAnimation.beginIntroPipelineSession
// owns the intro renderer with an async-render-pipelines session until its pipelines go quiet,
// so its first frames never compile synchronously. (First Light has no compute: the old
// compute-dispatch gate and its tests went with the particle and tetromino simulations.)

const pipelineMocks = vi.hoisted(() => ({
    preload: vi.fn(),
    begin: vi.fn(),
    markStartup: vi.fn(),
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

describe('intro renderer: unavailable native backend cleanup', () => {
    it('awaits fallback renderer disposal and releases ownership before outer destroy', async () => {
        vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 8 });
        vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
        const disposal = deferred();
        const initSpy = vi.spyOn(THREE.WebGPURenderer.prototype, 'init').mockImplementation(async function init() {
            this.backend = { isWebGLBackend: true };
        });
        const disposeSpy = vi.spyOn(THREE.WebGPURenderer.prototype, 'dispose').mockReturnValue(disposal.promise);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const visual = new ThreeJSIntroRendererWebGPU({ width: 390, height: 844, style: {} });
            const init = visual.init();
            await Promise.resolve();
            expect(disposeSpy).toHaveBeenCalledTimes(1);
            expect(visual.renderer).toBeTruthy();

            disposal.resolve();
            await expect(init).resolves.toBe(false);
            expect(visual.renderer).toBeNull();
            expect(visual.getDevice()).toBeNull();

            visual.destroy();
            expect(disposeSpy).toHaveBeenCalledTimes(1);
        } finally {
            initSpy.mockRestore();
            disposeSpy.mockRestore();
            warnSpy.mockRestore();
            vi.unstubAllGlobals();
        }
    });
});

// ---------------------------------------------------------------------------------------------
// IntroAnimation.beginIntroPipelineSession
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
