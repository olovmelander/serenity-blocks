/* eslint-disable max-classes-per-file */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

// Boot-warp handoff contract (ADR-0020):
//   - play() holds the flight on the ident match frame while the caller still covers it;
//   - prewarm anchors the match frame on the measured CSS ident mark (best effort);
//   - the warp's compute pipeline compiles on Dawn's async workers, launched before
//     compileAsync, and a compute timeout / failure falls back instead of presenting;
//   - playBootWarpHandoff wires the hold to the shell dismissal;
//   - the camera FOV curve keeps the match frame at the base 45° the gem size is solved for;
//   - play() follows a window resize (buffer, viewport, re-measured gem anchor, aspect,
//     viewProj) on that frame, and does no per-frame work while the size is unchanged;
//   - ?themeWarmAsync=0 rolls the prime back off compileAsync (compute keeps its own lever);
//   - the handoff arms the ident (`sb-warp-arming`) right before play(), best effort.
// Mocking follows tests/unit/startup-animation-reliability.test.js.

const rendererMocks = vi.hoisted(() => ({
    instances: [],
    bootRendererInit: vi.fn(),
    bootRendererDispose: vi.fn(),
    bootRender: vi.fn(),
    bootRenderAsync: vi.fn(),
    bootCompute: vi.fn(),
    bootCompileAsync: null,
    updateProjectionMatrix: vi.fn(),
    warpDispose: vi.fn(),
}));

const sceneMocks = vi.hoisted(() => ({
    warps: [],
    createWarpParticles: vi.fn(),
    warpFovAt: vi.fn(),
}));

const computeMocks = vi.hoisted(() => ({
    isAsyncComputeCapable: vi.fn(),
    compileComputeAsync: vi.fn(),
}));

const startupMocks = vi.hoisted(() => ({
    markStartup: vi.fn(),
}));

// The real three/webgpu is spread under the overrides so that vi.importActual of the real
// scene module (below) still gets a working three/tsl — three.tsl.js reads `TSL` from
// 'three/webgpu', which would otherwise resolve to this mock and have no TSL namespace.
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();

    class WebGPURenderer {
        constructor() {
            rendererMocks.instances.push(this);
            this.backend = { isWebGPUBackend: true };
            this.domElement = {
                id: '',
                style: {},
                parentNode: null,
                remove() {
                    this.parentNode?.removeChild?.(this);
                },
            };
        }

        init() {
            return rendererMocks.bootRendererInit();
        }

        dispose() {
            rendererMocks.bootRendererDispose();
        }

        setPixelRatio() {}

        setSize() {}

        setClearColor() {}

        compute(node) {
            rendererMocks.bootCompute(node);
        }

        get compileAsync() {
            return rendererMocks.bootCompileAsync;
        }

        renderAsync(scene, camera) {
            return rendererMocks.bootRenderAsync(scene, camera);
        }

        render(scene, camera) {
            rendererMocks.bootRender(scene, camera);
        }
    }

    class Scene {
        add() {}

        remove() {}
    }

    class PerspectiveCamera {
        constructor(fov = 50) {
            this.fov = fov;
            this.position = { set() {} };
            this.projectionMatrix = {};
            this.matrixWorldInverse = {};
        }

        lookAt() {}

        updateMatrixWorld() {}

        updateProjectionMatrix() {
            rendererMocks.updateProjectionMatrix(this.fov);
        }
    }

    class Matrix4 {
        multiplyMatrices() {
            return this;
        }
    }

    return {
        ...actual,
        WebGPURenderer,
        Scene,
        PerspectiveCamera,
        Matrix4,
    };
});

vi.mock('../../src/ui/boot-warp-transition-scene.js', () => ({
    createWarpParticles: sceneMocks.createWarpParticles,
    DEFAULT_MARK_OFFSET_Y_PX: -31,
    warpFovAt: sceneMocks.warpFovAt,
}));

vi.mock('../../src/rendering/webgpu-compute-pipeline-async.js', async (importOriginal) => ({
    ...(await importOriginal()),
    isAsyncComputeCapable: computeMocks.isAsyncComputeCapable,
    compileComputeAsync: computeMocks.compileComputeAsync,
}));

vi.mock('../../src/ui/startup-debug.js', async (importOriginal) => ({
    ...(await importOriginal()),
    markStartup: startupMocks.markStartup,
}));

const MARK_SELECTOR = '#startup-shell .startup-logo__mark';

// ── Minimal DOM (descendant selectors, which the ident-anchor query needs) ──

function createElement(tagName = 'div', { id = '', className = '', rect = null } = {}) {
    const classes = new Set(String(className).split(/\s+/).filter(Boolean));
    return {
        tagName: tagName.toUpperCase(),
        id,
        classList: { contains: (name) => classes.has(name) },
        style: {},
        children: [],
        parentNode: null,
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) {
                child.parentNode = null;
                this.children.splice(index, 1);
            }
            return child;
        },
        remove() {
            this.parentNode?.removeChild?.(this);
        },
        getBoundingClientRect: () => rect || {
            left: 0, top: 0, width: 0, height: 0,
        },
    };
}

function matchesCompound(element, compound) {
    const parsed = /^([a-z]*)((?:#[\w-]+)?)((?:\.[\w-]+)*)$/i.exec(compound);
    if (!parsed || !element?.tagName) return false;
    const [, tag, idPart, classPart] = parsed;
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (idPart && element.id !== idPart.slice(1)) return false;
    return classPart.split('.').filter(Boolean).every((name) => element.classList?.contains?.(name));
}

function collectDescendants(root, compound, out) {
    (root.children || []).forEach((child) => {
        if (matchesCompound(child, compound)) out.push(child);
        collectDescendants(child, compound, out);
    });
}

function queryIn(root, selector) {
    let scopes = [root];
    const compounds = selector.trim().split(/\s+/);
    for (const compound of compounds) {
        const next = [];
        scopes.forEach((scope) => collectDescendants(scope, compound, next));
        if (next.length === 0) return null;
        scopes = next;
    }
    return scopes[0];
}

function installDom({ markRect = null, queryThrows = false } = {}) {
    const body = createElement('body');
    if (markRect) {
        const shell = body.appendChild(createElement('div', { id: 'startup-shell' }));
        const logo = shell.appendChild(createElement('div', { className: 'startup-logo' }));
        logo.appendChild(createElement('div', { className: 'startup-logo__mark', rect: markRect }));
    }
    const document = {
        body,
        querySelector: vi.fn((selector) => {
            if (queryThrows) throw new Error('querySelector exploded');
            return queryIn(body, selector);
        }),
    };
    vi.stubGlobal('document', document);
    return document;
}

// Returns the stubbed window so a test can resize it mid-play. `search` / `storage` drive
// src/core/flags.js readFlag (URL param first, then localStorage `serenity.<name>`).
function installViewport(width, height, { search = '', storage = null } = {}) {
    const win = {
        innerWidth: width,
        innerHeight: height,
        devicePixelRatio: 1,
        location: { search },
    };
    if (storage) {
        win.localStorage = { getItem: (key) => storage[key] ?? null };
    }
    vi.stubGlobal('window', win);
    return win;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// A macrotask turn drains every queued microtask (the prewarm's await chain included).
function settle() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function mockPerformanceNow(initialNow = 0) {
    let currentNow = initialNow;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => currentNow);
    return {
        advance(ms) {
            currentNow += ms;
            return currentNow;
        },
        get value() {
            return currentNow;
        },
        restore() {
            spy.mockRestore();
        },
    };
}

function installRafQueue() {
    const queue = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        queue.push(callback);
        return queue.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return {
        get length() {
            return queue.length;
        },
        runNext() {
            const callback = queue.shift();
            if (callback) callback();
        },
    };
}

function runFrames(clock, raf, count, frameMs) {
    for (let i = 0; i < count && raf.length > 0; i += 1) {
        clock.advance(frameMs);
        raf.runNext();
    }
}

function createMockWarp() {
    const warp = {
        computeNode: { id: 'compute-node' },
        mesh: { id: 'mesh' },
        setAspect: vi.fn(),
        setViewProj: vi.fn(),
        setProgress: vi.fn(),
        setTime: vi.fn(),
        setViewport: vi.fn(),
        setGemCenterPx: vi.fn(),
        dispose: rendererMocks.warpDispose,
    };
    sceneMocks.warps.push(warp);
    return warp;
}

function marksFor(phase) {
    return startupMocks.markStartup.mock.calls
        .filter(([name]) => name === phase)
        .map(([, payload]) => payload);
}

async function primedTransition() {
    const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
    const transition = new BootWarpTransition();
    await expect(transition.prewarm({ timeoutMs: 1000 })).resolves.toBe(true);
    return transition;
}

beforeEach(() => {
    rendererMocks.instances.length = 0;
    rendererMocks.bootRendererInit.mockReset().mockResolvedValue(true);
    rendererMocks.bootRendererDispose.mockReset();
    rendererMocks.bootRender.mockReset();
    rendererMocks.bootRenderAsync.mockReset().mockResolvedValue(undefined);
    rendererMocks.bootCompute.mockReset();
    rendererMocks.bootCompileAsync = null;
    rendererMocks.updateProjectionMatrix.mockReset();
    rendererMocks.warpDispose.mockReset();
    sceneMocks.warps.length = 0;
    sceneMocks.createWarpParticles.mockReset().mockImplementation(createMockWarp);
    sceneMocks.warpFovAt.mockReset().mockReturnValue(45);
    computeMocks.isAsyncComputeCapable.mockReset().mockReturnValue(false);
    computeMocks.compileComputeAsync.mockReset();
    startupMocks.markStartup.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('BootWarpTransition.play hold on the ident match frame', () => {
    it('never passes holdAtProgress while isHeld() is true, then resumes the flight', async () => {
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const { BOOT_WARP_HOLD_PROGRESS } = await import('../../src/ui/boot-warp-startup.js');
        const transition = await primedTransition();
        const warp = sceneMocks.warps.at(-1);
        const primedProgressCalls = warp.setProgress.mock.calls.length;
        const primedTimeCalls = warp.setTime.mock.calls.length;

        let held = true;
        const isHeld = vi.fn(() => held);
        const samples = [];
        const playPromise = transition.play({
            durationMs: 6500,
            holdAtProgress: BOOT_WARP_HOLD_PROGRESS,
            isHeld,
            onProgress: (p) => samples.push(p),
        });

        // ~1 s of healthy frames with the ident still up: well past where the flight would be.
        runFrames(clock, raf, 60, 16);

        expect(samples).toHaveLength(60);
        expect(Math.max(...samples)).toBeLessThanOrEqual(BOOT_WARP_HOLD_PROGRESS);
        expect(samples.at(-1)).toBe(BOOT_WARP_HOLD_PROGRESS);
        // It reached the hold and parked there, rather than being frozen from the start.
        expect(samples.filter((p) => p === BOOT_WARP_HOLD_PROGRESS).length).toBeGreaterThan(40);
        expect(isHeld).toHaveBeenCalled();
        // The GPU side is pinned too: the compute pass never sees a later progress or time.
        const playProgress = warp.setProgress.mock.calls.slice(primedProgressCalls).map(([p]) => p);
        const playTimes = warp.setTime.mock.calls.slice(primedTimeCalls).map(([t]) => t);
        expect(Math.max(...playProgress)).toBeLessThanOrEqual(BOOT_WARP_HOLD_PROGRESS);
        expect(new Set(playTimes.slice(-10)).size).toBe(1);

        held = false;
        runFrames(clock, raf, 1, 16);
        expect(samples.at(-1)).toBeGreaterThan(BOOT_WARP_HOLD_PROGRESS);

        runFrames(clock, raf, 1000, 16);
        const result = await playPromise;
        expect(result).toMatchObject({ status: 'complete', firstFrameRendered: true, progress: 1 });
        // Held frames did not count toward the flight: all of it still played after release.
        expect(result.elapsedMs).toBeGreaterThanOrEqual(6500);
        clock.restore();
    });

    it('treats an isHeld() that throws as not held', async () => {
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const { BOOT_WARP_HOLD_PROGRESS } = await import('../../src/ui/boot-warp-startup.js');
        const transition = await primedTransition();

        const isHeld = vi.fn(() => { throw new Error('hold probe exploded'); });
        const samples = [];
        const playPromise = transition.play({
            durationMs: 6500,
            holdAtProgress: BOOT_WARP_HOLD_PROGRESS,
            isHeld,
            onProgress: (p) => samples.push(p),
        });

        runFrames(clock, raf, 20, 16);
        expect(isHeld).toHaveBeenCalled();
        expect(samples.at(-1)).toBeGreaterThan(BOOT_WARP_HOLD_PROGRESS);

        runFrames(clock, raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });
        clock.restore();
    });

    it('ignores isHeld when no holdAtProgress is given', async () => {
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const transition = await primedTransition();

        const isHeld = vi.fn(() => true);
        const playPromise = transition.play({ durationMs: 6500, isHeld });

        runFrames(clock, raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });
        expect(isHeld).not.toHaveBeenCalled();
        clock.restore();
    });

    it('drives the camera FOV from warpFovAt each frame and re-uploads viewProj on change', async () => {
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const transition = await primedTransition();
        const warp = sceneMocks.warps.at(-1);
        const viewProjCallsAfterPrewarm = warp.setViewProj.mock.calls.length;
        sceneMocks.warpFovAt.mockImplementation((p) => (p >= 0.5 ? 52 : 45));

        const samples = [];
        const playPromise = transition.play({ durationMs: 6500, onProgress: (p) => samples.push(p) });
        runFrames(clock, raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete' });

        // Queried with every frame's progress...
        expect(sceneMocks.warpFovAt.mock.calls.map(([p]) => p)).toEqual(samples);
        // ...but the projection is only rebuilt when the FOV actually changes (45 -> 52 once).
        expect(rendererMocks.updateProjectionMatrix).toHaveBeenCalledTimes(1);
        expect(rendererMocks.updateProjectionMatrix).toHaveBeenCalledWith(52);
        expect(warp.setViewProj.mock.calls.length - viewProjCallsAfterPrewarm).toBe(1);
        clock.restore();
    });
});

describe('BootWarpTransition.play viewport sync', () => {
    // Primes at the given size, then clears every per-frame viewport side effect so the
    // assertions below only see what play() itself does.
    async function primedForResize(width, height, domOptions = {}) {
        const win = installViewport(width, height);
        const document = installDom(domOptions);
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const transition = await primedTransition();
        const warp = sceneMocks.warps.at(-1);
        const renderer = rendererMocks.instances.at(-1);
        const setSize = vi.spyOn(renderer, 'setSize');
        [warp.setViewport, warp.setGemCenterPx, warp.setAspect, warp.setViewProj]
            .forEach((fn) => fn.mockClear());
        document.querySelector.mockClear();
        return {
            win, document, clock, raf, transition, warp, setSize,
        };
    }

    function expectNoViewportWork({ setSize, warp, document }) {
        expect(setSize).not.toHaveBeenCalled();
        // Not even the mark read: getBoundingClientRect forces a layout every frame.
        expect(document.querySelector).not.toHaveBeenCalled();
        expect(warp.setViewport).not.toHaveBeenCalled();
        expect(warp.setGemCenterPx).not.toHaveBeenCalled();
        expect(warp.setAspect).not.toHaveBeenCalled();
        expect(warp.setViewProj).not.toHaveBeenCalled();
        expect(rendererMocks.updateProjectionMatrix).not.toHaveBeenCalled();
    }

    it('does no viewport work on frames where the window size is unchanged', async () => {
        const ctx = await primedForResize(1280, 720, {
            markRect: {
                left: 581, top: 240, width: 118, height: 118,
            },
        });
        const aspectBefore = ctx.transition.camera.aspect;

        const playPromise = ctx.transition.play({ durationMs: 6500 });
        runFrames(ctx.clock, ctx.raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });

        // Hundreds of rendered frames, not one viewport touch among them.
        expect(rendererMocks.bootRender.mock.calls.length).toBeGreaterThan(400);
        expectNoViewportWork(ctx);
        expect(ctx.transition.camera.aspect).toBe(aspectBefore);
        ctx.clock.restore();
    });

    it('re-sizes, re-anchors on the re-measured mark and rebuilds viewProj on the resize frame', async () => {
        const markRect = {
            left: 581, top: 240, width: 118, height: 118,
        };
        const ctx = await primedForResize(1280, 720, { markRect });
        const {
            win, document, clock, raf, transition, warp, setSize,
        } = ctx;
        const aspectsAtProjection = [];
        rendererMocks.updateProjectionMatrix.mockImplementation(() => {
            aspectsAtProjection.push(transition.camera.aspect);
        });

        const playPromise = transition.play({ durationMs: 6500 });
        runFrames(clock, raf, 30, 16);
        expectNoViewportWork(ctx);

        // The window grows and the CSS ident re-centres with it.
        win.innerWidth = 1600;
        win.innerHeight = 900;
        Object.assign(markRect, { left: 741, top: 330 });
        const rendersBeforeResizeFrame = rendererMocks.bootRender.mock.calls.length;
        runFrames(clock, raf, 1, 16);

        expect(setSize).toHaveBeenCalledTimes(1);
        expect(setSize).toHaveBeenCalledWith(1600, 900, false);
        expect(warp.setViewport).toHaveBeenCalledTimes(1);
        expect(warp.setViewport).toHaveBeenCalledWith(1600, 900);
        expect(document.querySelector).toHaveBeenCalledWith(MARK_SELECTOR);
        expect(warp.setGemCenterPx).toHaveBeenCalledTimes(1);
        expect(warp.setGemCenterPx).toHaveBeenCalledWith(800, 389);
        expect(transition.camera.aspect).toBe(1600 / 900);
        expect(warp.setAspect).toHaveBeenCalledTimes(1);
        expect(warp.setAspect).toHaveBeenCalledWith(1600 / 900);
        // The FOV never left 45, yet the projection is rebuilt with the new aspect.
        expect(sceneMocks.warpFovAt.mock.results.every(({ value }) => value === 45)).toBe(true);
        expect(rendererMocks.updateProjectionMatrix).toHaveBeenCalledTimes(1);
        expect(rendererMocks.updateProjectionMatrix).toHaveBeenCalledWith(45);
        expect(aspectsAtProjection).toEqual([1600 / 900]);
        expect(warp.setViewProj).toHaveBeenCalledTimes(1);

        // The gem offset is solved against the viewport, and all of it lands before this
        // frame's draw (not a frame late, with the browser stretching the old buffer).
        const firstCall = (fn) => fn.mock.invocationCallOrder[0];
        const resizeFrameRender = rendererMocks.bootRender.mock.invocationCallOrder[rendersBeforeResizeFrame];
        expect(resizeFrameRender).toBeDefined();
        expect(firstCall(warp.setViewport)).toBeLessThan(firstCall(warp.setGemCenterPx));
        [setSize, warp.setViewport, warp.setGemCenterPx, warp.setAspect, warp.setViewProj]
            .forEach((fn) => expect(firstCall(fn)).toBeLessThan(resizeFrameRender));

        // Steady at the new size: nothing more for the rest of the flight.
        runFrames(clock, raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });
        expect(setSize).toHaveBeenCalledTimes(1);
        expect(document.querySelector).toHaveBeenCalledTimes(1);
        expect(warp.setViewport).toHaveBeenCalledTimes(1);
        expect(warp.setGemCenterPx).toHaveBeenCalledTimes(1);
        expect(warp.setAspect).toHaveBeenCalledTimes(1);
        expect(warp.setViewProj).toHaveBeenCalledTimes(1);
        expect(rendererMocks.updateProjectionMatrix).toHaveBeenCalledTimes(1);
        clock.restore();
    });

    it.each([
        ['the mark is absent', {}],
        ['the mark has no layout box', {
            markRect: {
                left: 10, top: 10, width: 0, height: 0,
            },
        }],
        ['the mark query throws', { queryThrows: true }],
    ])('falls back to the ident layout default for the gem when %s', async (_label, domOptions) => {
        const { DEFAULT_MARK_OFFSET_Y_PX } = await import('../../src/ui/boot-warp-transition-scene.js');
        const {
            win, document, clock, raf, transition, warp, setSize,
        } = await primedForResize(1280, 720, domOptions);

        const playPromise = transition.play({ durationMs: 6500 });
        runFrames(clock, raf, 5, 16);
        win.innerWidth = 1000;
        win.innerHeight = 800;
        runFrames(clock, raf, 1, 16);

        expect(setSize).toHaveBeenCalledWith(1000, 800, false);
        expect(warp.setViewport).toHaveBeenCalledWith(1000, 800);
        expect(document.querySelector).toHaveBeenCalledWith(MARK_SELECTOR);
        expect(warp.setGemCenterPx).toHaveBeenCalledTimes(1);
        expect(warp.setGemCenterPx).toHaveBeenCalledWith(500, 400 + DEFAULT_MARK_OFFSET_Y_PX);
        expect(transition.camera.aspect).toBe(1000 / 800);
        expect(warp.setAspect).toHaveBeenCalledWith(1000 / 800);
        expect(warp.setViewProj).toHaveBeenCalledTimes(1);

        runFrames(clock, raf, 1000, 16);
        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });
        expect(setSize).toHaveBeenCalledTimes(1);
        clock.restore();
    });

    it('ignores a zero-sized window (minimised) and keeps the primed size as its reference', async () => {
        const ctx = await primedForResize(1280, 720, {
            markRect: {
                left: 581, top: 240, width: 118, height: 118,
            },
        });
        const {
            win, clock, raf, transition,
        } = ctx;

        const playPromise = transition.play({ durationMs: 6500 });
        runFrames(clock, raf, 5, 16);
        win.innerWidth = 0;
        win.innerHeight = 0;
        runFrames(clock, raf, 5, 16);
        // Restored to the primed size: still nothing to do (0x0 was never adopted).
        win.innerWidth = 1280;
        win.innerHeight = 720;
        runFrames(clock, raf, 1000, 16);

        await expect(playPromise).resolves.toMatchObject({ status: 'complete', progress: 1 });
        expectNoViewportWork(ctx);
        clock.restore();
    });
});

describe('BootWarpTransition prewarm ident anchor', () => {
    it('sizes the viewport and anchors the gem on the measured #startup-shell mark centre', async () => {
        installViewport(1280, 720);
        const document = installDom({
            markRect: {
                left: 581, top: 240, width: 118, height: 118,
            },
        });
        const transition = await primedTransition();
        const warp = sceneMocks.warps.at(-1);

        expect(sceneMocks.createWarpParticles).toHaveBeenCalledWith(expect.objectContaining({
            viewportWidth: 1280,
            viewportHeight: 720,
        }));
        expect(warp.setViewport).toHaveBeenCalledWith(1280, 720);
        expect(document.querySelector).toHaveBeenCalledWith(MARK_SELECTOR);
        expect(warp.setGemCenterPx).toHaveBeenCalledTimes(1);
        expect(warp.setGemCenterPx).toHaveBeenCalledWith(640, 299);
        // The gem offset is solved against the viewport, so the viewport must be set first.
        expect(warp.setViewport.mock.invocationCallOrder[0])
            .toBeLessThan(warp.setGemCenterPx.mock.invocationCallOrder[0]);
        expect(marksFor('boot-warp:ident-anchor')).toEqual([{
            id: transition.debugId, measured: true, x: 640, y: 299,
        }]);
    });

    it('falls back to the scene default when the mark query throws', async () => {
        installViewport(1280, 720);
        const document = installDom({ queryThrows: true });
        const transition = await primedTransition();
        const warp = sceneMocks.warps.at(-1);

        expect(document.querySelector).toHaveBeenCalledWith(MARK_SELECTOR);
        expect(warp.setViewport).toHaveBeenCalledWith(1280, 720);
        expect(warp.setGemCenterPx).not.toHaveBeenCalled();
        expect(marksFor('boot-warp:ident-anchor')).toEqual([{
            id: transition.debugId, measured: false, x: null, y: null,
        }]);
        expect(transition.lastPrewarmStatus).toBe('ready');
    });

    it.each([
        ['the mark is absent', null],
        ['the mark has no layout box', {
            left: 10, top: 10, width: 0, height: 0,
        }],
    ])('does not anchor when %s', async (_label, markRect) => {
        installViewport(1280, 720);
        installDom({ markRect });
        const transition = await primedTransition();

        expect(sceneMocks.warps.at(-1).setGemCenterPx).not.toHaveBeenCalled();
        expect(marksFor('boot-warp:ident-anchor')).toEqual([{
            id: transition.debugId, measured: false, x: null, y: null,
        }]);
    });
});

describe('BootWarpTransition prewarm async compute compile', () => {
    it('launches the compute compile before compileAsync and primes only once it is ready', async () => {
        const dom = installDom();
        const { BOOT_WARP_PREWARM_TIMEOUT_MS } = await import('../../src/ui/boot-warp-startup.js');
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const order = [];
        const computeDone = deferred();
        computeMocks.isAsyncComputeCapable.mockReturnValue(true);
        computeMocks.compileComputeAsync.mockImplementation(() => {
            order.push('compute-compile');
            return computeDone.promise;
        });
        rendererMocks.bootCompileAsync = vi.fn(async () => { order.push('compileAsync'); });
        rendererMocks.bootCompute.mockImplementation(() => { order.push('compute'); });
        rendererMocks.bootRender.mockImplementation(() => { order.push('render'); });
        const transition = new BootWarpTransition();

        const prewarmPromise = transition.prewarm({ timeoutMs: 5000 });
        await settle();

        // Both compiles are in flight together, compute first; nothing dispatches or draws yet.
        expect(order).toEqual(['compute-compile', 'compileAsync']);
        const renderer = rendererMocks.instances.at(-1);
        expect(computeMocks.isAsyncComputeCapable).toHaveBeenCalledWith(renderer);
        expect(computeMocks.compileComputeAsync).toHaveBeenCalledTimes(1);
        const [compileRenderer, computeNode, compileOptions] = computeMocks.compileComputeAsync.mock.calls[0];
        expect(compileRenderer).toBe(renderer);
        expect(computeNode).toEqual({ id: 'compute-node' });
        // The compute budget must expire before the (retried) outer prewarm timeout, or a
        // compute timeout could never surface as its own non-retryable status.
        expect(compileOptions.timeoutMs).toBeGreaterThan(0);
        expect(compileOptions.timeoutMs).toBeLessThan(BOOT_WARP_PREWARM_TIMEOUT_MS);
        expect(transition.lastPrewarmStatus).toBeNull();

        computeDone.resolve({
            status: 'ready', created: 1, failed: 0, ms: 12,
        });
        await expect(prewarmPromise).resolves.toBe(true);

        expect(transition.lastPrewarmStatus).toBe('ready');
        expect(order.slice(2)).toContain('compute');
        expect(order.slice(2)).toContain('render');
        expect(rendererMocks.bootCompute).toHaveBeenCalledWith({ id: 'compute-node' });
        expect(dom.body.children).toContain(transition.canvas);
    });

    it('keeps the synchronous compute prime when async compute is not available', async () => {
        installDom();
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = await primedTransition();

        expect(computeMocks.isAsyncComputeCapable).toHaveBeenCalled();
        expect(computeMocks.compileComputeAsync).not.toHaveBeenCalled();
        expect(rendererMocks.bootCompileAsync).toHaveBeenCalledTimes(1);
        expect(rendererMocks.bootCompute).toHaveBeenCalledWith({ id: 'compute-node' });
        expect(transition.lastPrewarmStatus).toBe('ready');
    });

    it.each([
        ['timeout', 'compute-timeout'],
        ['failed', 'compute-failed'],
    ])('compute status %s -> prewarm false, %s, renderer disposed, nothing presented', async (status, expected) => {
        const dom = installDom();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        computeMocks.isAsyncComputeCapable.mockReturnValue(true);
        computeMocks.compileComputeAsync.mockResolvedValue({
            status, created: 0, failed: status === 'failed' ? 1 : 0, ms: 9000,
        });
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = new BootWarpTransition();

        await expect(transition.prewarm({ timeoutMs: 5000 })).resolves.toBe(false);

        expect(transition.lastPrewarmStatus).toBe(expected);
        expect(rendererMocks.bootRendererDispose).toHaveBeenCalledTimes(1);
        expect(rendererMocks.warpDispose).toHaveBeenCalledTimes(1);
        // An uncomputed warp is never dispatched, drawn or left on screen.
        expect(rendererMocks.bootCompute).not.toHaveBeenCalled();
        expect(rendererMocks.bootRender).not.toHaveBeenCalled();
        expect(dom.body.children).toHaveLength(0);
        expect(transition.renderer).toBeNull();
        expect(transition._ready).toBe(false);
        await expect(transition.play()).resolves.toMatchObject({ status: 'not-ready' });
    });

    it.each([
        ['resolves with status error', () => Promise.resolve({ status: 'error', message: 'tsl codegen exploded' })],
        ['rejects', () => Promise.reject(new Error('tsl codegen exploded'))],
    ])('compute compile that %s -> setup-failed', async (_label, compileImpl) => {
        const dom = installDom();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        computeMocks.isAsyncComputeCapable.mockReturnValue(true);
        computeMocks.compileComputeAsync.mockImplementation(compileImpl);
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = new BootWarpTransition();

        await expect(transition.prewarm({ timeoutMs: 5000 })).resolves.toBe(false);

        expect(transition.lastPrewarmStatus).toBe('setup-failed');
        expect(marksFor('boot-warp:setup-failed')[0].message).toContain('tsl codegen exploded');
        expect(rendererMocks.bootRendererDispose).toHaveBeenCalled();
        expect(rendererMocks.bootCompute).not.toHaveBeenCalled();
        expect(dom.body.children).toHaveLength(0);
        warnSpy.mockRestore();
    });

    it('does not prime a warp that was disposed while its compute compile was pending', async () => {
        installDom();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const computeDone = deferred();
        computeMocks.isAsyncComputeCapable.mockReturnValue(true);
        computeMocks.compileComputeAsync.mockReturnValue(computeDone.promise);
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = new BootWarpTransition();

        const prewarmPromise = transition.prewarm({ timeoutMs: 5000 });
        await settle();
        transition.dispose();
        computeDone.resolve({
            status: 'ready', created: 1, failed: 0, ms: 40,
        });

        await expect(prewarmPromise).resolves.toBe(false);
        expect(rendererMocks.bootCompute).not.toHaveBeenCalled();
        expect(rendererMocks.bootRender).not.toHaveBeenCalled();
        expect(marksFor('boot-warp:prime-late-after-dispose')).toHaveLength(1);
    });
});

describe('BootWarpTransition prewarm themeWarmAsync rollback (src/core/flags.js readFlag)', () => {
    it('primes the render pipeline through compileAsync(scene, camera) by default', async () => {
        installViewport(1280, 720);
        installDom();
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = await primedTransition();

        expect(rendererMocks.bootCompileAsync).toHaveBeenCalledTimes(1);
        expect(rendererMocks.bootCompileAsync).toHaveBeenCalledWith(transition.scene, transition.camera);
        // Compiled async before the first synchronous prime frame could compile it instead.
        expect(rendererMocks.bootCompileAsync.mock.invocationCallOrder[0])
            .toBeLessThan(rendererMocks.bootRender.mock.invocationCallOrder[0]);
        expect(marksFor('boot-warp:prime-async-compiled')).toHaveLength(1);
        expect(transition.lastPrewarmStatus).toBe('ready');
    });

    it.each([
        ['the URL param ?themeWarmAsync=0', { search: '?themeWarmAsync=0' }],
        ['localStorage serenity.themeWarmAsync=0', { storage: { 'serenity.themeWarmAsync': '0' } }],
    ])('skips compileAsync when the flag is off via %s and primes synchronously', async (_label, flagSource) => {
        installViewport(1280, 720, flagSource);
        installDom();
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const transition = await primedTransition();

        expect(rendererMocks.bootCompileAsync).not.toHaveBeenCalled();
        expect(marksFor('boot-warp:prime-async-compiled')).toHaveLength(0);
        // The pre-async path: the synchronous prime frames compile and exercise the pipelines.
        expect(rendererMocks.bootCompute).toHaveBeenCalledWith({ id: 'compute-node' });
        expect(rendererMocks.bootRender).toHaveBeenCalled();
        expect(transition.lastPrewarmStatus).toBe('ready');
        expect(transition._ready).toBe(true);
    });

    it('leaves the async compute compile to its own lever when themeWarmAsync is off', async () => {
        // ADR-0020 rollbacks: themeWarmAsync=0 covers the compileAsync prime only;
        // compute rolls back separately via ?syncComputePipelines=1.
        installViewport(1280, 720, { search: '?themeWarmAsync=0' });
        installDom();
        const computeDone = deferred();
        computeMocks.isAsyncComputeCapable.mockReturnValue(true);
        computeMocks.compileComputeAsync.mockReturnValue(computeDone.promise);
        rendererMocks.bootCompileAsync = vi.fn(async () => {});
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();

        const prewarmPromise = transition.prewarm({ timeoutMs: 5000 });
        await settle();
        expect(computeMocks.compileComputeAsync).toHaveBeenCalledTimes(1);
        expect(rendererMocks.bootCompileAsync).not.toHaveBeenCalled();
        // Still never dispatched before its pipeline is ready.
        expect(rendererMocks.bootCompute).not.toHaveBeenCalled();

        computeDone.resolve({
            status: 'ready', created: 1, failed: 0, ms: 12,
        });
        await expect(prewarmPromise).resolves.toBe(true);
        expect(rendererMocks.bootCompileAsync).not.toHaveBeenCalled();
        expect(rendererMocks.bootCompute).toHaveBeenCalledWith({ id: 'compute-node' });
        expect(transition.lastPrewarmStatus).toBe('ready');
    });
});

describe('playBootWarpHandoff hold wiring', () => {
    it('holds the flight at BOOT_WARP_HOLD_PROGRESS until the startup shell is dismissed', async () => {
        const {
            BOOT_WARP_HOLD_PROGRESS,
            BOOT_WARP_REVEAL_PROGRESS,
            playBootWarpHandoff,
        } = await import('../../src/ui/boot-warp-startup.js');
        const heldSamples = [];
        let playOptions = null;
        const dismissStartupShell = vi.fn(() => {
            heldSamples.push(['inside-dismiss', playOptions.isHeld()]);
        });
        const warpTransition = {
            play: vi.fn(async (opts) => {
                playOptions = opts;
                heldSamples.push(['before-reveal', opts.isHeld()]);
                // Cadence not yet healthy: the reveal is withheld, so the hold must stay on.
                opts.onProgress(BOOT_WARP_REVEAL_PROGRESS, { firstFrameRendered: true, cadenceHealthy: false });
                heldSamples.push(['stalled-reveal', opts.isHeld()]);
                opts.onProgress(BOOT_WARP_REVEAL_PROGRESS, { firstFrameRendered: true, cadenceHealthy: true });
                heldSamples.push(['after-dismiss', opts.isHeld()]);
                opts.onProgress(1, { firstFrameRendered: true, cadenceHealthy: true });
                return {
                    status: 'complete', firstFrameRendered: true, durationMs: 6500, progress: 1,
                };
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };

        const result = await playBootWarpHandoff({
            warpTransition,
            urlParams: new URLSearchParams(),
            introAnimation: { revealTitle: vi.fn() },
            dismissStartupShell,
            soundManager: { playOneShotFile: vi.fn() },
            setTimeoutFn: (callback) => { callback(); return 1; },
        });

        expect(result.shellDismissed).toBe(true);
        expect(playOptions.holdAtProgress).toBe(BOOT_WARP_HOLD_PROGRESS);
        expect(typeof playOptions.isHeld).toBe('function');
        // The shell's own dismissal already sees the hold released (flag set before the call).
        expect(heldSamples).toEqual([
            ['before-reveal', true],
            ['stalled-reveal', true],
            ['inside-dismiss', false],
            ['after-dismiss', false],
        ]);
        expect(dismissStartupShell).toHaveBeenCalledTimes(1);
        expect(dismissStartupShell).toHaveBeenCalledWith('warp-handoff', { quick: true });
    });

    it('places the hold past the reveal gate so a held flight can still hand over', async () => {
        const {
            BOOT_WARP_FADE_PROGRESS,
            BOOT_WARP_HOLD_PROGRESS,
            BOOT_WARP_REVEAL_PROGRESS,
            BOOT_WARP_TITLE_PROGRESS,
        } = await import('../../src/ui/boot-warp-startup.js');
        // A hold below the reveal gate would pin progress where the ident can never be
        // dismissed: the flight would sit on the match frame until the wall-clock ceiling.
        expect(BOOT_WARP_HOLD_PROGRESS).toBeGreaterThan(BOOT_WARP_REVEAL_PROGRESS);
        expect(BOOT_WARP_HOLD_PROGRESS).toBeLessThan(BOOT_WARP_TITLE_PROGRESS);
        expect(BOOT_WARP_HOLD_PROGRESS).toBeLessThan(BOOT_WARP_FADE_PROGRESS);
    });

    it('releases the hold when the startup pipeline aborts before the shell is dismissed', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const controller = new AbortController();
        const heldSamples = [];
        const warpTransition = {
            play: vi.fn(async (opts) => {
                heldSamples.push(opts.isHeld());
                controller.abort();
                heldSamples.push(opts.isHeld());
                return {
                    status: 'disposed', firstFrameRendered: true, durationMs: 6500, progress: 0.03,
                };
            }),
            fadeOut: vi.fn(),
        };

        const result = await playBootWarpHandoff({
            warpTransition,
            introAnimation: { revealTitle: vi.fn() },
            dismissStartupShell: vi.fn(),
            signal: controller.signal,
        });

        expect(heldSamples).toEqual([true, false]);
        expect(result).toMatchObject({ status: 'startup-pipeline-aborted', shellDismissed: false });
    });

    it('parks the real flight on the match frame through the cadence grace, then flies on', async () => {
        // REAL play() driving the REAL handoff on hardware that never reaches a healthy
        // cadence (100 ms frames): the ident is only handed over when the grace expires, and
        // the flight must not play its ignition unseen behind the opaque ident meanwhile.
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const {
            BOOT_WARP_CADENCE_GRACE_MS,
            BOOT_WARP_HOLD_PROGRESS,
            playBootWarpHandoff,
        } = await import('../../src/ui/boot-warp-startup.js');
        const transition = await primedTransition();

        const samples = [];
        let dismissed = false;
        let dismissedAt = null;
        const observedTransition = {
            play: (opts) => transition.play({
                ...opts,
                onProgress: (p, state) => {
                    samples.push({ p, dismissed, now: clock.value });
                    opts.onProgress?.(p, state);
                },
            }),
            fadeOut: () => Promise.resolve(),
        };

        const handoffPromise = playBootWarpHandoff({
            warpTransition: observedTransition,
            urlParams: new URLSearchParams(),
            introAnimation: { revealTitle: vi.fn() },
            soundManager: { playOneShotFile: vi.fn() },
            dismissStartupShell: vi.fn(() => {
                dismissed = true;
                dismissedAt = samples.at(-1);
            }),
            setTimeoutFn: (callback, ms) => { clock.advance(ms); callback(); return 1; },
        });

        runFrames(clock, raf, 2000, 100);
        const result = await handoffPromise;

        expect(result).toMatchObject({ status: 'complete', shellDismissed: true });
        const beforeDismiss = samples.filter((s) => !s.dismissed);
        expect(Math.max(...beforeDismiss.map((s) => s.p))).toBeLessThanOrEqual(BOOT_WARP_HOLD_PROGRESS);
        const parked = beforeDismiss.filter((s) => s.p === BOOT_WARP_HOLD_PROGRESS);
        expect(parked.length).toBeGreaterThan(5);
        // Handed over on the parked match frame, only once the cadence grace had run out.
        expect(dismissedAt.p).toBe(BOOT_WARP_HOLD_PROGRESS);
        const firstEligible = beforeDismiss.find((s) => s.p >= 0.02);
        expect(dismissedAt.now - firstEligible.now).toBeGreaterThanOrEqual(BOOT_WARP_CADENCE_GRACE_MS);
        // The very next frame flies on.
        const afterDismiss = samples.filter((s) => s.dismissed);
        expect(afterDismiss[0].p).toBeGreaterThan(BOOT_WARP_HOLD_PROGRESS);
        expect(afterDismiss.at(-1).p).toBe(1);
        clock.restore();
    });
});

describe('playBootWarpHandoff ident arming class', () => {
    const ARMING_CLASS = 'sb-warp-arming';

    function createShell() {
        const classes = new Set();
        return {
            id: 'startup-shell',
            classList: {
                add: vi.fn((name) => { classes.add(name); }),
                remove: vi.fn((name) => { classes.delete(name); }),
                contains: (name) => classes.has(name),
            },
        };
    }

    function installShellDocument(shell, { throws = false } = {}) {
        const document = {
            getElementById: vi.fn((id) => {
                if (throws) throw new Error('getElementById exploded');
                return id === 'startup-shell' ? shell : null;
            }),
        };
        vi.stubGlobal('document', document);
        return document;
    }

    function completingTransition(onPlay = () => {}) {
        return {
            play: vi.fn(async (opts) => {
                onPlay(opts);
                opts.onProgress(0.5, { firstFrameRendered: true, cadenceHealthy: true });
                opts.onProgress(1, { firstFrameRendered: true, cadenceHealthy: true });
                return {
                    status: 'complete', firstFrameRendered: true, durationMs: 6500, progress: 1,
                };
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };
    }

    function handoffOptions(warpTransition, extra = {}) {
        return {
            warpTransition,
            urlParams: new URLSearchParams(),
            introAnimation: { revealTitle: vi.fn() },
            dismissStartupShell: vi.fn(),
            soundManager: { playOneShotFile: vi.fn() },
            setTimeoutFn: (callback) => { callback(); return 1; },
            ...extra,
        };
    }

    it('adds sb-warp-arming to #startup-shell right before play()', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        const document = installShellDocument(shell);
        let armedWhenPlayStarted = null;
        const warpTransition = completingTransition(() => {
            armedWhenPlayStarted = shell.classList.contains(ARMING_CLASS);
        });

        const result = await playBootWarpHandoff(handoffOptions(warpTransition));

        expect(result).toMatchObject({ status: 'complete', shellDismissed: true });
        expect(document.getElementById).toHaveBeenCalledWith('startup-shell');
        expect(shell.classList.add).toHaveBeenCalledTimes(1);
        expect(shell.classList.add).toHaveBeenCalledWith(ARMING_CLASS);
        expect(armedWhenPlayStarted).toBe(true);
        // Right before: after the handoff has started, immediately ahead of play().
        const handoffStartIndex = startupMocks.markStartup.mock.calls
            .findIndex(([name]) => name === 'boot-warp:handoff-start');
        expect(handoffStartIndex).toBeGreaterThanOrEqual(0);
        const armedAt = shell.classList.add.mock.invocationCallOrder[0];
        expect(startupMocks.markStartup.mock.invocationCallOrder[handoffStartIndex]).toBeLessThan(armedAt);
        expect(armedAt).toBeLessThan(warpTransition.play.mock.invocationCallOrder[0]);
    });

    it.each([
        ['no transition to play', () => ({ warpTransition: null })],
        ['the startup pipeline already aborted', () => {
            const controller = new AbortController();
            controller.abort();
            return { signal: controller.signal };
        }],
    ])('does not arm the ident when play() will not run (%s)', async (_label, makeExtra) => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        installShellDocument(shell);
        const warpTransition = completingTransition();

        const result = await playBootWarpHandoff(handoffOptions(warpTransition, makeExtra()));

        expect(result.shellDismissed).toBe(false);
        expect(warpTransition.play).not.toHaveBeenCalled();
        expect(shell.classList.add).not.toHaveBeenCalled();
    });

    it.each([
        ['there is no document', () => vi.stubGlobal('document', undefined)],
        ['#startup-shell is missing', () => installShellDocument(null)],
        ['getElementById throws', () => installShellDocument(createShell(), { throws: true })],
        ['the document has no getElementById', () => vi.stubGlobal('document', { querySelector: vi.fn() })],
        ['the shell has no classList', () => installShellDocument({ id: 'startup-shell' })],
        ['classList.add throws', () => installShellDocument({
            id: 'startup-shell',
            classList: { add: () => { throw new Error('classList exploded'); } },
        })],
    ])('still plays the handoff when %s', async (_label, installEnvironment) => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        installEnvironment();
        const warpTransition = completingTransition();
        const dismissStartupShell = vi.fn();

        const result = await playBootWarpHandoff(handoffOptions(warpTransition, { dismissStartupShell }));

        expect(warpTransition.play).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 'complete', shellDismissed: true });
        expect(dismissStartupShell).toHaveBeenCalledWith('warp-handoff', { quick: true });
    });

    // play() settles without ever dismissing the shell: the ident stays up for the CSS fallback,
    // and a left-over arming class would keep its glint hidden and its glow parked.
    it.each([
        ['play() resolves not-ready without a frame', 'not-ready', async () => ({
            status: 'not-ready', firstFrameRendered: false, durationMs: 6500, elapsedMs: 0, progress: 0,
        })],
        ['the flight stalls below the reveal progress', 'stalled', async (opts) => {
            opts.onProgress(0.01, { firstFrameRendered: true, cadenceHealthy: true });
            return {
                status: 'stalled', firstFrameRendered: true, durationMs: 6500, progress: 0.01,
            };
        }],
        ['the cadence is still unhealthy when the flight stalls', 'stalled', async (opts) => {
            opts.onProgress(0.03, { firstFrameRendered: true, cadenceHealthy: false });
            return {
                status: 'stalled', firstFrameRendered: true, durationMs: 6500, progress: 0.03,
            };
        }],
        ['no frame was ever rendered', 'device-lost', async (opts) => {
            opts.onProgress(0.5, { firstFrameRendered: false, cadenceHealthy: true });
            return {
                status: 'device-lost', firstFrameRendered: false, durationMs: 6500, progress: 0.5,
            };
        }],
        ['play() resolves nothing', 'unknown', async () => undefined],
    ])('removes sb-warp-arming when %s', async (_label, expectedStatus, playImpl) => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        installShellDocument(shell);
        const armedDuringPlay = [];
        const warpTransition = {
            play: vi.fn(async (opts) => {
                armedDuringPlay.push(shell.classList.contains(ARMING_CLASS));
                const playResult = await playImpl(opts);
                armedDuringPlay.push(shell.classList.contains(ARMING_CLASS));
                return playResult;
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };
        const dismissStartupShell = vi.fn();

        const result = await playBootWarpHandoff(handoffOptions(warpTransition, { dismissStartupShell }));

        expect(result).toMatchObject({
            status: expectedStatus, shellDismissed: false, titleRevealed: false, visibleMs: 0,
        });
        expect(dismissStartupShell).not.toHaveBeenCalled();
        expect(warpTransition.fadeOut).not.toHaveBeenCalled();
        // Armed for the whole of play(), disarmed once it has settled.
        expect(armedDuringPlay).toEqual([true, true]);
        expect(shell.classList.add).toHaveBeenCalledTimes(1);
        // (arming also clears the ident's pause class; only the arming class counts here)
        expect(shell.classList.remove.mock.calls.filter(([name]) => name === ARMING_CLASS)).toHaveLength(1);
        expect(shell.classList.contains(ARMING_CLASS)).toBe(false);
        // ...before the fallback status is reported (the caller requests the CSS fallback on it).
        const statusIndex = startupMocks.markStartup.mock.calls
            .findIndex(([name]) => name === 'boot-warp:handoff-status');
        expect(statusIndex).toBeGreaterThanOrEqual(0);
        expect(shell.classList.remove.mock.invocationCallOrder[
            shell.classList.remove.mock.calls.findIndex(([name]) => name === ARMING_CLASS)])
            .toBeLessThan(startupMocks.markStartup.mock.invocationCallOrder[statusIndex]);
    });

    it('removes sb-warp-arming when the startup pipeline aborts mid-play before the handoff', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        installShellDocument(shell);
        const controller = new AbortController();
        const warpTransition = {
            play: vi.fn(async (opts) => {
                opts.onProgress(0.01, { firstFrameRendered: true, cadenceHealthy: true });
                controller.abort();
                return {
                    status: 'disposed', firstFrameRendered: true, durationMs: 6500, progress: 0.01,
                };
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };

        const result = await playBootWarpHandoff(handoffOptions(warpTransition, { signal: controller.signal }));

        expect(result).toMatchObject({ status: 'startup-pipeline-aborted', shellDismissed: false });
        // (arming also clears the ident's pause class; only the arming class counts here)
        expect(shell.classList.remove.mock.calls.filter(([name]) => name === ARMING_CLASS)).toHaveLength(1);
        expect(shell.classList.contains(ARMING_CLASS)).toBe(false);
    });

    it('keeps sb-warp-arming when the handoff dismissed the shell', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        installShellDocument(shell);
        const dismissStartupShell = vi.fn();

        const result = await playBootWarpHandoff(handoffOptions(completingTransition(), { dismissStartupShell }));

        expect(result).toMatchObject({ status: 'complete', shellDismissed: true });
        expect(dismissStartupShell).toHaveBeenCalledWith('warp-handoff', { quick: true });
        // The ident is dissolving out on the match frame: its loops must not come back on.
        expect(shell.classList.remove).not.toHaveBeenCalledWith(ARMING_CLASS);
        expect(shell.classList.contains(ARMING_CLASS)).toBe(true);
    });

    it('keeps sb-warp-arming when the startup pipeline aborts after the handoff', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const shell = createShell();
        installShellDocument(shell);
        const controller = new AbortController();
        const warpTransition = {
            play: vi.fn(async (opts) => {
                opts.onProgress(0.5, { firstFrameRendered: true, cadenceHealthy: true });
                controller.abort();
                return {
                    status: 'disposed', firstFrameRendered: true, durationMs: 6500, progress: 0.5,
                };
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };

        const result = await playBootWarpHandoff(handoffOptions(warpTransition, { signal: controller.signal }));

        expect(result).toMatchObject({ status: 'startup-pipeline-aborted', shellDismissed: true });
        expect(shell.classList.remove).not.toHaveBeenCalledWith(ARMING_CLASS);
        expect(shell.classList.contains(ARMING_CLASS)).toBe(true);
    });

    it.each([
        ['classList has no remove', () => {
            const shell = createShell();
            delete shell.classList.remove;
            installShellDocument(shell);
        }],
        ['classList.remove throws', () => {
            const shell = createShell();
            shell.classList.remove = vi.fn(() => { throw new Error('classList exploded'); });
            installShellDocument(shell);
        }],
        ['#startup-shell is gone by the time play() settles', () => {
            const shell = createShell();
            const document = installShellDocument(shell);
            document.getElementById.mockReturnValueOnce(shell).mockReturnValue(null);
        }],
        ['the document is gone by the time play() settles', () => {
            installShellDocument(createShell());
        }, { dropDocumentDuringPlay: true }],
    ])('still returns the fallback status when disarming fails because %s', async (_label, installEnvironment, {
        dropDocumentDuringPlay = false,
    } = {}) => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        installEnvironment();
        const warpTransition = {
            play: vi.fn(async () => {
                if (dropDocumentDuringPlay) vi.stubGlobal('document', undefined);
                return {
                    status: 'stalled', firstFrameRendered: true, durationMs: 6500, progress: 0.01,
                };
            }),
            fadeOut: vi.fn(() => Promise.resolve()),
        };

        const result = await playBootWarpHandoff(handoffOptions(warpTransition));

        expect(warpTransition.play).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 'stalled', shellDismissed: false });
    });
});

describe('warpFovAt (real boot-warp-transition-scene module)', () => {
    let warpFovAt;
    let holdProgress;

    beforeEach(async () => {
        ({ warpFovAt } = await vi.importActual('../../src/ui/boot-warp-transition-scene.js'));
        ({ BOOT_WARP_HOLD_PROGRESS: holdProgress } = await import('../../src/ui/boot-warp-startup.js'));
    });

    it('rests at the base 45 degree FOV at both ends of the shot', () => {
        expect(warpFovAt(0)).toBe(45);
        expect(warpFovAt(1)).toBe(45);
    });

    it('pushes wider on the jump and pulls tighter on the drop-out', () => {
        expect(warpFovAt(0.3)).toBeGreaterThan(45);
        expect(warpFovAt(0.66)).toBeLessThan(45);
    });

    it('holds exactly 45 through the match frame the gem size is solved for', () => {
        // GEM_TARGET_PX / setGemCenterPx assume the fixed 45 degree camera; any FOV drift
        // before the ignition would visibly resize the gem on the handoff frame.
        for (let p = 0; p <= Math.max(0.2, holdProgress); p += 0.005) {
            expect(warpFovAt(p)).toBe(45);
        }
    });

    it('is a bounded, continuous function of progress', () => {
        let previous = warpFovAt(0);
        for (let i = 1; i <= 1000; i += 1) {
            const fov = warpFovAt(i / 1000);
            expect(fov).toBeGreaterThanOrEqual(40);
            expect(fov).toBeLessThanOrEqual(55);
            expect(Math.abs(fov - previous)).toBeLessThan(0.5);
            previous = fov;
        }
    });
});
