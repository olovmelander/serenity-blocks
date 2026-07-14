/* eslint-disable max-classes-per-file */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

const rendererMocks = vi.hoisted(() => ({
    webgpuInit: vi.fn(),
    webgpuDestroy: vi.fn(),
    webglInit: vi.fn(() => true),
    webglDestroy: vi.fn(),
    webglCanvases: [],
    bootRendererInit: vi.fn(),
    bootRendererDispose: vi.fn(),
    bootRender: vi.fn(),
    bootRenderAsync: vi.fn(),
    bootCompute: vi.fn(),
    warpDispose: vi.fn(),
}));

vi.mock('../../src/ui/threejs-intro-renderer-webgpu.js', () => ({
    default: class MockIntroWebGPURenderer {
        constructor(canvas) {
            this.canvas = canvas;
        }

        init() {
            return rendererMocks.webgpuInit();
        }

        destroy() {
            rendererMocks.webgpuDestroy(this.canvas);
        }
    },
}));

vi.mock('../../src/ui/threejs-intro-renderer.js', () => ({
    default: class MockIntroWebGLRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            rendererMocks.webglCanvases.push(canvas);
        }

        init() {
            return rendererMocks.webglInit();
        }

        destroy() {
            rendererMocks.webglDestroy(this.canvas);
        }
    },
}));

vi.mock('three/webgpu', () => {
    class WebGPURenderer {
        constructor() {
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
        constructor() {
            this.position = { set() {} };
            this.projectionMatrix = {};
            this.matrixWorldInverse = {};
        }

        lookAt() {}

        updateMatrixWorld() {}
    }

    class Matrix4 {
        multiplyMatrices() {
            return this;
        }
    }

    return {
        WebGPURenderer,
        Scene,
        PerspectiveCamera,
        Matrix4,
        ACESFilmicToneMapping: 'ACESFilmicToneMapping',
        NoToneMapping: 'NoToneMapping',
        SRGBColorSpace: 'SRGBColorSpace',
    };
});

vi.mock('../../src/ui/boot-warp-transition-scene.js', () => ({
    createWarpParticles: () => ({
        computeNode: { id: 'compute-node' },
        mesh: { id: 'mesh' },
        setAspect() {},
        setViewProj() {},
        setProgress() {},
        setTime() {},
        dispose: rendererMocks.warpDispose,
    }),
}));

function createClassList(element) {
    const classes = new Set();
    return {
        add(...names) {
            names.forEach((name) => classes.add(name));
            element.className = Array.from(classes).join(' ');
        },
        remove(...names) {
            names.forEach((name) => classes.delete(name));
            element.className = Array.from(classes).join(' ');
        },
        contains(name) {
            return classes.has(name);
        },
        _setFromString(value) {
            classes.clear();
            String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
        },
    };
}

function createElement(tagName = 'div') {
    const element = {
        tagName: tagName.toUpperCase(),
        id: '',
        style: {},
        children: [],
        parentNode: null,
        innerHTML: '',
        textContent: '',
        offsetWidth: 100,
        offsetHeight: 40,
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        replaceChild(newChild, oldChild) {
            const index = this.children.indexOf(oldChild);
            if (index >= 0) {
                oldChild.parentNode = null;
                newChild.parentNode = this;
                this.children[index] = newChild;
            }
            return oldChild;
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
        contains(target) {
            if (target === this) return true;
            return this.children.some((child) => child.contains?.(target));
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 100,
            height: 40,
        }),
        getClientRects: () => [{ width: 100, height: 40 }],
        querySelector(selector) {
            return querySelectorIn(this, selector);
        },
        querySelectorAll(selector) {
            const results = [];
            collectMatches(this, selector, results);
            return results;
        },
    };

    const classList = createClassList(element);
    Object.defineProperty(element, 'className', {
        get() {
            return this._className || '';
        },
        set(value) {
            this._className = String(value || '');
            classList._setFromString(this._className);
        },
    });
    element.classList = classList;
    element.className = '';
    return element;
}

function matchesSelector(element, selector) {
    if (!selector || !element) return false;
    if (selector.startsWith('#')) return element.id === selector.slice(1);
    if (selector.startsWith('.')) {
        return selector.split('.').filter(Boolean).every((name) => element.classList.contains(name));
    }
    return element.tagName?.toLowerCase() === selector.toLowerCase();
}

function collectMatches(element, selector, results) {
    element.children.forEach((child) => {
        if (matchesSelector(child, selector)) {
            results.push(child);
        }
        collectMatches(child, selector, results);
    });
}

function querySelectorIn(element, selector) {
    for (const child of element.children) {
        if (matchesSelector(child, selector)) {
            return child;
        }
        const nested = querySelectorIn(child, selector);
        if (nested) return nested;
    }
    return null;
}

function installDom() {
    const body = createElement('body');
    const document = {
        body,
        createElement,
        querySelector(selector) {
            return body.querySelector(selector);
        },
        querySelectorAll(selector) {
            return body.querySelectorAll(selector);
        },
    };
    vi.stubGlobal('document', document);
    return document;
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

function mockPerformanceNow(initialNow = 0) {
    let currentNow = initialNow;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => currentNow);
    return {
        set(value) {
            currentNow = value;
        },
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

beforeEach(() => {
    rendererMocks.webgpuInit.mockReset();
    rendererMocks.webgpuDestroy.mockReset();
    rendererMocks.webglInit.mockReset().mockReturnValue(true);
    rendererMocks.webglDestroy.mockReset();
    rendererMocks.webglCanvases.length = 0;
    rendererMocks.bootRendererInit.mockReset().mockResolvedValue(true);
    rendererMocks.bootRendererDispose.mockReset();
    rendererMocks.bootRender.mockReset();
    rendererMocks.bootRenderAsync.mockReset().mockResolvedValue(undefined);
    rendererMocks.bootCompute.mockReset();
    rendererMocks.warpDispose.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('intro startup reliability', () => {
    it('creates title and prompt visible when reveal happens before DOM creation', async () => {
        installDom();
        const { IntroAnimation } = await import('../../src/ui/intro-animation.js');
        const intro = new IntroAnimation();
        intro.titleDeferred = true;
        intro.titleRevealed = false;
        intro.interactionEnabled = false;
        intro.initRenderer = vi.fn().mockResolvedValue('failed');

        intro.revealTitle('test-early');
        await intro.createIntroHTML();

        expect(intro.titleRevealed).toBe(true);
        expect(intro.interactionEnabled).toBe(true);
        const title = intro.container.querySelector('.intro-title-container');
        expect(title.classList.contains('intro-title-hold')).toBe(false);
        expect(intro.container.querySelector('.intro-prompt').classList.contains('intro-prompt-hold')).toBe(false);
    });

    it('resolves renderer readiness and keeps DOM fallback when renderer init throws', async () => {
        installDom();
        const { IntroAnimation } = await import('../../src/ui/intro-animation.js');
        const intro = new IntroAnimation();
        let readyResolved = false;
        intro._rendererReadyResolve = () => { readyResolved = true; };
        intro.initRenderer = vi.fn().mockRejectedValue(new Error('renderer exploded'));

        await expect(intro.createIntroHTML()).resolves.toBeUndefined();

        expect(readyResolved).toBe(true);
        expect(intro.threeRenderer).toBeNull();
        expect(intro.container.querySelector('.intro-title-container')).toBeTruthy();
        expect(intro.container.querySelector('.intro-prompt')).toBeTruthy();
    });

    it('keeps a postponed title safety authoritative over show()\'s default arming', async () => {
        vi.useFakeTimers();
        installDom();
        const { IntroAnimation } = await import('../../src/ui/intro-animation.js');
        const intro = new IntroAnimation();
        const introHtml = deferred();
        intro.ensureIntroMusic = vi.fn();
        intro.clearPhaseTimers = vi.fn();
        intro.createIntroHTML = vi.fn().mockReturnValue(introHtml.promise);
        intro.setupEventListeners = vi.fn();
        intro.setRendererPhase = vi.fn();
        intro.schedulePhase = vi.fn();
        intro.startRenderLoop = vi.fn();
        intro.startAnimations = vi.fn();

        // Boot calls show() WITHOUT awaiting, then postpones the title safety while
        // createIntroHTML is still pending (cold renderer init on a first-ever run).
        intro.show(null, { deferTitle: true });
        intro.postponeTitleSafety(120000);

        // Renderer init finally settles; show() resumes past its await. The old bug:
        // show() re-armed the 4500ms default HERE, clobbering the 120s postpone, so the
        // title + PRESS-ANY-KEY unlocked behind the opaque ident/warp.
        introHtml.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(10000);
        expect(intro.titleRevealed).toBe(false);

        await vi.advanceTimersByTimeAsync(120000);
        expect(intro.titleRevealed).toBe(true);
    });

    it('replaces the timed-out WebGPU canvas before WebGL fallback uses it', async () => {
        vi.useFakeTimers();
        installDom();
        vi.stubGlobal('navigator', { gpu: {} });
        const webgpu = deferred();
        rendererMocks.webgpuInit.mockReturnValue(webgpu.promise);
        const { IntroAnimation } = await import('../../src/ui/intro-animation.js');
        const intro = new IntroAnimation();
        const container = createElement('div');
        const canvas = createElement('canvas');
        canvas.id = 'intro-webgl-canvas';
        canvas.style.cssText = 'position:absolute;inset:0;';
        container.appendChild(canvas);
        intro.threeCanvas = canvas;

        const resultPromise = intro.initRenderer(canvas);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(10000);
        const result = await resultPromise;

        expect(result).toBe('webgl');
        expect(intro.threeCanvas).not.toBe(canvas);
        expect(rendererMocks.webglCanvases[0]).toBe(intro.threeCanvas);
        expect(container.contains(canvas)).toBe(false);

        webgpu.resolve(true);
        await Promise.resolve();
        expect(rendererMocks.webgpuDestroy).toHaveBeenCalledWith(canvas);
    });
});

describe('startup pipeline state machine', () => {
    it('separates menu readiness from intro duration and exposes the menu only after both', async () => {
        const {
            STARTUP_IDENT_MIN_VISIBLE_MS,
            STARTUP_PIPELINE_EVENTS,
            STARTUP_WATCHDOG_MS,
            createStartupPipelineStateMachine,
        } = await import('../../src/ui/startup-pipeline-state-machine.js');
        let now = 100;
        const transitions = [];
        const clearTimeoutFn = vi.fn();
        const pipeline = createStartupPipelineStateMachine({
            nowFn: () => now,
            setTimeoutFn: vi.fn(() => 77),
            clearTimeoutFn,
            onTransition: ({ event }) => transitions.push(event),
        });

        expect(STARTUP_IDENT_MIN_VISIBLE_MS).toBe(4000);
        expect(STARTUP_WATCHDOG_MS).toBe(45000);
        pipeline.start();
        now = 350;
        pipeline.markAppReady();
        now = 500;
        pipeline.markMenuReady();
        now = 600;
        pipeline.markIntroRunning();

        expect(pipeline.snapshot()).toMatchObject({
            menuReady: true,
            menuVisible: false,
            introStatus: 'running',
            metrics: { timeToMenuReadyMs: 400 },
        });

        now = 5600;
        pipeline.markIntroDone();
        const finalState = await pipeline.waitForMenuVisible();

        expect(finalState).toMatchObject({
            menuVisible: true,
            introStatus: 'done',
            metrics: {
                timeToMenuReadyMs: 400,
                introDurationMs: 5000,
                timeToMenuVisibleMs: 5500,
            },
        });
        expect(transitions).toEqual([
            STARTUP_PIPELINE_EVENTS.BOOT_STARTED,
            STARTUP_PIPELINE_EVENTS.APP_READY,
            STARTUP_PIPELINE_EVENTS.MENU_READY,
            STARTUP_PIPELINE_EVENTS.INTRO_RUNNING,
            STARTUP_PIPELINE_EVENTS.INTRO_DONE,
            STARTUP_PIPELINE_EVENTS.MENU_VISIBLE,
        ]);
        expect(clearTimeoutFn).toHaveBeenCalledWith(77);
    });

    it('rejects menu readiness before app readiness', async () => {
        const { createStartupPipelineStateMachine } = await import(
            '../../src/ui/startup-pipeline-state-machine.js'
        );
        const pipeline = createStartupPipelineStateMachine();
        pipeline.start();

        expect(() => pipeline.markMenuReady()).toThrow('MENU_READY requires APP_READY');
        pipeline.dispose();
    });

    it('watchdog-aborts a hung startup task and reaches the menu through skip', async () => {
        vi.useFakeTimers();
        const {
            createStartupPipelineStateMachine,
            waitForStartupStep,
        } = await import('../../src/ui/startup-pipeline-state-machine.js');
        const callbackOrder = [];
        const pipeline = createStartupPipelineStateMachine({
            watchdogMs: 45000,
            onIntroSkipped: () => callbackOrder.push('dispose-visuals'),
            onMenuVisible: () => callbackOrder.push('menu-visible'),
        });
        pipeline.start();
        pipeline.markAppReady();
        pipeline.markMenuReady();
        pipeline.markIntroRunning();

        const hungStep = waitForStartupStep(new Promise(() => {}), pipeline.signal);
        const rejection = expect(hungStep).rejects.toMatchObject({
            name: 'StartupPipelineAbortError',
            reason: 'watchdog',
        });
        await vi.advanceTimersByTimeAsync(45000);
        await rejection;

        expect(pipeline.snapshot()).toMatchObject({
            menuVisible: true,
            introStatus: 'skipped',
            introSkipReason: 'watchdog',
            watchdogFired: true,
        });
        expect(callbackOrder).toEqual(['dispose-visuals', 'menu-visible']);
    });

    it('keeps the shell-gated menu pending when watchdog fires before app readiness', async () => {
        vi.useFakeTimers();
        const { createStartupPipelineStateMachine } = await import(
            '../../src/ui/startup-pipeline-state-machine.js'
        );
        const pipeline = createStartupPipelineStateMachine({ watchdogMs: 100 });
        pipeline.start();
        pipeline.markIntroRunning();

        await vi.advanceTimersByTimeAsync(100);
        expect(pipeline.snapshot()).toMatchObject({
            menuReady: false,
            menuVisible: false,
            introStatus: 'skipped',
        });

        pipeline.markAppReady();
        pipeline.markMenuReady();
        await expect(pipeline.waitForMenuVisible()).resolves.toMatchObject({
            menuVisible: true,
            introSkipReason: 'watchdog',
        });
    });

    it('treats an explicit pre-title input as an idempotent intro skip', async () => {
        const { createStartupPipelineStateMachine } = await import(
            '../../src/ui/startup-pipeline-state-machine.js'
        );
        const pipeline = createStartupPipelineStateMachine();
        pipeline.start();
        pipeline.markAppReady();
        pipeline.markMenuReady();
        pipeline.markIntroRunning();

        pipeline.skipIntro('user-input', { inputType: 'keydown' });
        pipeline.skipIntro('user-input', { inputType: 'keydown' });

        await expect(pipeline.waitForMenuVisible()).resolves.toMatchObject({
            menuVisible: true,
            introStatus: 'skipped',
            introSkipReason: 'user-input',
        });
        expect(pipeline.snapshot().history.filter(
            ({ event }) => event === 'INTRO_SKIPPED',
        )).toHaveLength(1);
    });
});

describe('boot warp startup decision', () => {
    it('defaults boot warp timing to 6500ms and clamps short URL overrides', async () => {
        const {
            BOOT_WARP_DEFAULT_DURATION_MS,
            BOOT_WARP_FADE_PROGRESS,
            BOOT_WARP_MIN_VISIBLE_MS,
            BOOT_WARP_REVEAL_PROGRESS,
            BOOT_WARP_TITLE_PROGRESS,
            resolveBootWarpTiming,
        } = await import('../../src/ui/boot-warp-startup.js');

        const defaultTiming = resolveBootWarpTiming(new URLSearchParams());
        expect(BOOT_WARP_DEFAULT_DURATION_MS).toBe(6500);
        expect(BOOT_WARP_MIN_VISIBLE_MS).toBe(5000);
        expect(defaultTiming.durationMs).toBe(BOOT_WARP_DEFAULT_DURATION_MS);
        expect(defaultTiming.minVisibleMs).toBe(BOOT_WARP_MIN_VISIBLE_MS);

        const shortTiming = resolveBootWarpTiming(new URLSearchParams('warpDur=100'));
        const visibleWindowMs = shortTiming.durationMs * (BOOT_WARP_FADE_PROGRESS - BOOT_WARP_REVEAL_PROGRESS);
        expect(shortTiming.requestedDurationMs).toBe(100);
        expect(shortTiming.durationMs).toBe(5953);
        expect(shortTiming.durationMs).toBeGreaterThanOrEqual(shortTiming.minDurationMs);
        expect(visibleWindowMs).toBeGreaterThanOrEqual(BOOT_WARP_MIN_VISIBLE_MS);
        expect(BOOT_WARP_TITLE_PROGRESS).toBeLessThan(BOOT_WARP_FADE_PROGRESS);
    });

    it('declines the warp when intro renderer readiness exceeds the boot budget', async () => {
        const { waitForIntroRendererDecision } = await import('../../src/ui/boot-warp-startup.js');
        const clearTimeoutFn = vi.fn();
        let scheduled;

        const decisionPromise = waitForIntroRendererDecision({
            rendererReady: new Promise(() => {}),
        }, {
            timeoutMs: 8000,
            setTimeoutFn: (callback, ms) => {
                scheduled = { callback, ms };
                return 42;
            },
            clearTimeoutFn,
        });

        expect(scheduled.ms).toBe(8000);
        scheduled.callback();

        await expect(decisionPromise).resolves.toEqual({
            canAttemptWarp: false,
            reason: 'intro-renderer-timeout',
        });
        expect(clearTimeoutFn).toHaveBeenCalledWith(42);
    });

    it('waits for warmed theme background work before allowing warp prewarm', async () => {
        vi.useFakeTimers();
        const {
            getStartupThemeBusyState,
            waitForStartupThemeIdle,
        } = await import('../../src/ui/boot-warp-startup.js');
        const theme = {
            name: 'neon-district',
            buildingLoadPromise: Promise.resolve(),
            buildingLoadInProgress: true,
            buildingLoadComplete: false,
            backgroundLoadPromise: Promise.resolve(),
            backgroundLoadInProgress: true,
            backgroundLoadComplete: false,
            deferredMaterialLoadPromise: Promise.resolve(),
            deferredMaterialLoadInProgress: true,
            deferredMaterialLoadComplete: false,
        };

        expect(getStartupThemeBusyState(theme)).toMatchObject({
            busy: true,
            theme: 'neon-district',
            buildingLoadInProgress: true,
            buildingLoadComplete: false,
            backgroundLoadInProgress: true,
            backgroundLoadComplete: false,
            deferredMaterialLoadInProgress: true,
            deferredMaterialLoadComplete: false,
        });

        const progressEvents = [];
        const waitPromise = waitForStartupThemeIdle(() => theme, {
            pollMs: 10,
            stableMs: 20,
            onProgress: (event) => {
                progressEvents.push(event);
            },
        });

        await vi.advanceTimersByTimeAsync(30);
        theme.buildingLoadInProgress = false;
        theme.buildingLoadComplete = true;
        await vi.advanceTimersByTimeAsync(30);
        theme.backgroundLoadInProgress = false;
        theme.backgroundLoadComplete = true;
        await vi.advanceTimersByTimeAsync(40);
        let resolved = false;
        waitPromise.then(() => { resolved = true; });
        await Promise.resolve();
        expect(resolved).toBe(false);

        theme.deferredMaterialLoadInProgress = false;
        theme.deferredMaterialLoadComplete = true;
        await vi.advanceTimersByTimeAsync(70);

        await expect(waitPromise).resolves.toMatchObject({
            busy: false,
            theme: 'neon-district',
        });
        expect(progressEvents).toContain('busy-change');
        expect(progressEvents).toContain('idle-ready');
    });

    it('gives up the theme-idle wait at the hard cap instead of hanging on a stuck flag', async () => {
        vi.useFakeTimers();
        const { waitForStartupThemeIdle } = await import('../../src/ui/boot-warp-startup.js');
        // A theme whose busy flag NEVER clears (e.g. a bug leaves buildingLoadInProgress
        // true forever). The wait must return with timedOut instead of looping forever.
        const stuckTheme = {
            name: 'stuck-theme',
            buildingLoadInProgress: true,
        };

        const progressEvents = [];
        const waitPromise = waitForStartupThemeIdle(() => stuckTheme, {
            pollMs: 10,
            stableMs: 20,
            maxWaitMs: 1000,
            onProgress: (event) => { progressEvents.push(event); },
        });

        await vi.advanceTimersByTimeAsync(1100);

        await expect(waitPromise).resolves.toMatchObject({
            busy: true,
            timedOut: true,
            theme: 'stuck-theme',
        });
        expect(progressEvents).toContain('idle-timeout');
    });

    it('stops a theme-idle poll when the startup pipeline aborts', async () => {
        vi.useFakeTimers();
        const { waitForStartupThemeIdle } = await import('../../src/ui/boot-warp-startup.js');
        const controller = new AbortController();
        const progressEvents = [];
        const waitPromise = waitForStartupThemeIdle(() => ({
            name: 'hung-theme',
            buildingLoadInProgress: true,
        }), {
            pollMs: 10,
            signal: controller.signal,
            onProgress: (event) => progressEvents.push(event),
        });

        controller.abort();
        await vi.advanceTimersByTimeAsync(20);

        await expect(waitPromise).resolves.toMatchObject({
            aborted: true,
            busy: true,
            theme: 'hung-theme',
        });
        expect(progressEvents).toContain('aborted');
    });

    it('exports a finite prewarm retry cap so deterministic failures cannot retry forever', async () => {
        const { BOOT_WARP_MAX_PREWARM_ATTEMPTS } = await import('../../src/ui/boot-warp-startup.js');
        expect(Number.isInteger(BOOT_WARP_MAX_PREWARM_ATTEMPTS)).toBe(true);
        expect(BOOT_WARP_MAX_PREWARM_ATTEMPTS).toBeGreaterThanOrEqual(1);
        expect(BOOT_WARP_MAX_PREWARM_ATTEMPTS).toBeLessThanOrEqual(5);
    });

    it('keeps the warp visible for the minimum before fade or title reveal', async () => {
        const clock = mockPerformanceNow(100);
        const {
            BOOT_WARP_MIN_VISIBLE_MS,
            playBootWarpHandoff,
        } = await import('../../src/ui/boot-warp-startup.js');
        const events = [];
        const warpTransition = {
            play: vi.fn(async ({ onProgress }) => {
                events.push(`play:${clock.value}`);
                onProgress(1, { firstFrameRendered: true });
                return {
                    status: 'complete',
                    firstFrameRendered: true,
                    durationMs: 6500,
                    progress: 1,
                };
            }),
            fadeOut: vi.fn(() => {
                events.push(`fade:${clock.value}`);
                return Promise.resolve();
            }),
        };
        const introAnimation = {
            revealTitle: vi.fn((source) => events.push(`title:${source}:${clock.value}`)),
        };
        const dismissStartupShell = vi.fn((reason) => events.push(`dismiss:${reason}:${clock.value}`));

        const result = await playBootWarpHandoff({
            warpTransition,
            urlParams: new URLSearchParams('warpDur=100'),
            introAnimation,
            dismissStartupShell,
            soundManager: { playOneShotFile: vi.fn() },
            setTimeoutFn: (callback, ms) => {
                events.push(`wait:${ms}`);
                clock.advance(ms);
                callback();
                return 1;
            },
        });

        expect(result.shellDismissed).toBe(true);
        expect(result.visibleMs).toBeGreaterThanOrEqual(BOOT_WARP_MIN_VISIBLE_MS);
        expect(events).toEqual([
            'play:100',
            'dismiss:warp-handoff:100',
            `wait:${BOOT_WARP_MIN_VISIBLE_MS}`,
            `fade:${100 + BOOT_WARP_MIN_VISIBLE_MS}`,
            `title:warp-progress:${100 + BOOT_WARP_MIN_VISIBLE_MS}`,
        ]);
        clock.restore();
    });

    it('falls back without quick-dismissing when play fails before the first visible frame', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const warpTransition = {
            play: vi.fn(async () => ({
                status: 'render-failed-before-visible',
                firstFrameRendered: false,
                durationMs: 6500,
                progress: 0,
            })),
            fadeOut: vi.fn(),
        };
        const introAnimation = { revealTitle: vi.fn() };
        const dismissStartupShell = vi.fn();

        const result = await playBootWarpHandoff({
            warpTransition,
            introAnimation,
            dismissStartupShell,
        });

        expect(result).toMatchObject({
            status: 'render-failed-before-visible',
            shellDismissed: false,
            firstFrameRendered: false,
            visibleMs: 0,
        });
        expect(warpTransition.fadeOut).not.toHaveBeenCalled();
        expect(introAnimation.revealTitle).not.toHaveBeenCalled();
        expect(dismissStartupShell).not.toHaveBeenCalled();
    });

    it('does not reveal the title after an active handoff is aborted', async () => {
        const { playBootWarpHandoff } = await import('../../src/ui/boot-warp-startup.js');
        const controller = new AbortController();
        const introAnimation = { revealTitle: vi.fn() };
        const warpTransition = {
            play: vi.fn(async ({ onProgress }) => {
                onProgress(0.1, { firstFrameRendered: true });
                return {
                    status: 'disposed',
                    firstFrameRendered: true,
                    durationMs: 6500,
                    progress: 0.1,
                };
            }),
            fadeOut: vi.fn(),
        };
        const dismissStartupShell = vi.fn(() => controller.abort());

        const result = await playBootWarpHandoff({
            warpTransition,
            introAnimation,
            dismissStartupShell,
            signal: controller.signal,
        });

        expect(result).toMatchObject({
            status: 'startup-pipeline-aborted',
            shellDismissed: true,
            titleRevealed: false,
        });
        expect(warpTransition.fadeOut).not.toHaveBeenCalled();
        expect(introAnimation.revealTitle).not.toHaveBeenCalled();
    });

    it('routes a disabled warp through the orchestrator CSS fallback', async () => {
        const { playBootWarpStartupSequence } = await import(
            '../../src/ui/boot-warp-orchestrator.js'
        );
        const shellDismissal = deferred();
        const dismissStartupShell = vi.fn(() => shellDismissal.promise);
        const startupPipeline = {
            signal: new AbortController().signal,
            waitForStep: (value) => Promise.resolve(value),
            trackVisual: vi.fn(),
            releaseVisual: vi.fn(),
            disposeVisuals: vi.fn(),
        };

        const result = await playBootWarpStartupSequence({
            urlParams: new URLSearchParams('noBootWarp=1'),
            dismissStartupShell,
            startupPipeline,
        });

        expect(result).toMatchObject({
            status: 'css-fallback',
            shellDismissed: false,
        });
        expect(dismissStartupShell).toHaveBeenCalledWith('intro-begin');
        expect(startupPipeline.trackVisual).not.toHaveBeenCalled();

        let surfaceReady = false;
        result.surfaceReadyPromise.then(() => { surfaceReady = true; });
        await Promise.resolve();
        expect(surfaceReady).toBe(false);

        shellDismissal.resolve();
        await result.surfaceReadyPromise;
        expect(surfaceReady).toBe(true);
    });
});

describe('boot warp prewarm budget', () => {
    it('primes with sync render after renderer init', async () => {
        installDom();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();

        await expect(transition.prewarm({ timeoutMs: 100 })).resolves.toBe(true);

        expect(rendererMocks.bootCompute).toHaveBeenCalledWith({ id: 'compute-node' });
        expect(rendererMocks.bootRender).toHaveBeenCalled();
        expect(rendererMocks.bootRenderAsync).not.toHaveBeenCalled();
        expect(transition.lastPrewarmStatus).toBe('ready');
    });

    it('disposes and reports timeout when full prewarm exceeds the hard budget', async () => {
        vi.useFakeTimers();
        installDom();
        rendererMocks.bootRendererInit.mockReturnValue(new Promise(() => {}));
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();

        const resultPromise = transition.prewarm({ timeoutMs: 5 });
        await vi.advanceTimersByTimeAsync(5);

        await expect(resultPromise).resolves.toBe(false);
        expect(transition.lastPrewarmStatus).toBe('prewarm-timeout');
        expect(rendererMocks.bootRendererDispose).toHaveBeenCalled();
    });

    it('does not consume progress while waiting for the first play frame', async () => {
        installDom();
        const clock = mockPerformanceNow(1000);
        const raf = installRafQueue();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();
        await transition.prewarm({ timeoutMs: 100 });

        const progress = [];
        const playPromise = transition.play({
            durationMs: 6500,
            onProgress: (p) => progress.push(p),
        });

        expect(raf.length).toBe(1);
        clock.advance(9000);
        raf.runNext();
        await Promise.resolve();

        expect(progress[0]).toBe(0);

        clock.advance(6500);
        raf.runNext();
        await expect(playPromise).resolves.toMatchObject({
            status: 'complete',
            firstFrameRendered: true,
            progress: 1,
        });
        clock.restore();
    });

    it('reports render-failed-before-visible when first play render throws', async () => {
        installDom();
        installRafQueue();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();
        await transition.prewarm({ timeoutMs: 100 });
        rendererMocks.bootRender.mockImplementationOnce(() => {
            throw new Error('first frame exploded');
        });

        const resultPromise = transition.play({ durationMs: 6500 });
        requestAnimationFrame.mock.calls[0][0]();

        await expect(resultPromise).resolves.toMatchObject({
            status: 'render-failed-before-visible',
            firstFrameRendered: false,
        });
    });

    it('settles active playback when the startup pipeline disposes the warp', async () => {
        installDom();
        installRafQueue();
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');
        const transition = new BootWarpTransition();
        await transition.prewarm({ timeoutMs: 100 });

        const playPromise = transition.play({ durationMs: 6500 });
        transition.dispose();

        await expect(playPromise).resolves.toMatchObject({
            status: 'disposed',
            firstFrameRendered: false,
            durationMs: 6500,
        });
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('skips boot warp for explicit disable and forced WebGL flags', async () => {
        vi.stubGlobal('navigator', { gpu: {} });
        vi.stubGlobal('window', {
            matchMedia: () => ({ matches: false }),
        });
        const { BootWarpTransition } = await import('../../src/ui/boot-warp-transition.js');

        expect(BootWarpTransition.isSupported(new URLSearchParams('noBootWarp=1'))).toBe(false);
        expect(BootWarpTransition.isSupported(new URLSearchParams('forceWebGL=1'))).toBe(false);
    });
});
