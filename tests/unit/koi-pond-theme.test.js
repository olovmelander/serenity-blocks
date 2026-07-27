/* eslint-disable max-classes-per-file */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import KoiPondTheme from '../../src/themes/koi-pond/koi-pond-theme.js';

const koiMocks = vi.hoisted(() => ({
    gpuRegistrations: [],
    rendererInit: null,
    rendererInstances: [],
    runtimeFactory: vi.fn(),
    runtimeInstances: [],
}));

vi.mock('three/webgpu', () => {
    class MockWebGPURenderer {
        constructor(options = {}) {
            const { forceWebGL = false } = options;
            this.options = options;
            this.domElement = document.createElement('canvas');
            this.backend = forceWebGL
                ? {}
                : {
                    isWebGPUBackend: true,
                    device: {
                        lost: new Promise(() => {}),
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                    },
                };
            this.info = {
                memory: {},
                render: {},
            };
            this.pixelRatio = 1;
            this.init = vi.fn(() => (
                koiMocks.rendererInit?.(this) ?? Promise.resolve()
            ));
            this.compileAsync = vi.fn(async () => {});
            this.dispose = vi.fn();
            this.getPixelRatio = vi.fn(() => this.pixelRatio);
            this.render = vi.fn();
            this.setAnimationLoop = vi.fn();
            this.setClearColor = vi.fn();
            this.setPixelRatio = vi.fn((value) => {
                this.pixelRatio = value;
            });
            this.setSize = vi.fn();
            koiMocks.rendererInstances.push(this);
        }
    }

    class MockScene {
        constructor() {
            this.children = [];
        }

        add(...children) {
            this.children.push(...children);
        }

        clear() {
            this.children.length = 0;
        }
    }

    class MockPerspectiveCamera {
        constructor(fieldOfView, aspect, near, far) {
            this.aspect = aspect;
            this.far = far;
            this.fieldOfView = fieldOfView;
            this.near = near;
            this.updateProjectionMatrix = vi.fn();
        }
    }

    return {
        NoToneMapping: 'NoToneMapping',
        PerspectiveCamera: MockPerspectiveCamera,
        Scene: MockScene,
        SRGBColorSpace: 'SRGBColorSpace',
        WebGPURenderer: MockWebGPURenderer,
    };
});

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-runtime.js', () => ({
    createKoiPondRuntime: (...args) => koiMocks.runtimeFactory(...args),
}));

vi.mock('../../src/utils/gpu-loss-coordinator.js', () => ({
    initGpuLossCoordinator: vi.fn(),
    registerGpuSurface: (label, surface) => {
        const registration = {
            label,
            surface,
            unregister: vi.fn(),
        };
        koiMocks.gpuRegistrations.push(registration);
        return registration.unregister;
    },
}));

vi.mock('../../src/utils/gpu-context-resilience.js', () => ({
    gpuResilience: {
        monitorWebGL: vi.fn(() => vi.fn()),
        monitorWebGPU: vi.fn(() => vi.fn()),
    },
}));

vi.mock('../../src/utils/viewport.js', () => ({
    getViewport: () => ({
        dpr: 1,
        height: 720,
        width: 1280,
    }),
}));

function createRuntime(options) {
    const runtime = {
        options,
        camera: vi.fn(),
        configureGameplay: vi.fn(),
        dispose: vi.fn(),
        getDiagnostics: vi.fn(() => ({})),
        prepareForCompile: vi.fn(() => vi.fn()),
        pulse: vi.fn(),
        resetPointer: vi.fn(),
        resize: vi.fn(),
        setPointer: vi.fn(),
        update: vi.fn(),
    };
    koiMocks.runtimeInstances.push(runtime);
    return runtime;
}

function createFakeDom({ reducedMotion = false, search = '' } = {}) {
    const listeners = new Map();
    const mediaQueries = [];
    const rafCallbacks = [];
    const children = [];
    const classNames = new Set();

    const container = {
        id: 'koi-pond-theme',
        children,
        classList: {
            add: vi.fn((value) => classNames.add(value)),
            remove: vi.fn((value) => classNames.delete(value)),
        },
        style: {
            removeProperty(name) {
                delete this[name];
            },
        },
        appendChild(node) {
            if (node.parentNode && node.parentNode !== this) node.parentNode.removeChild(node);
            node.parentNode = this;
            children.push(node);
            return node;
        },
        removeChild(node) {
            const index = children.indexOf(node);
            if (index >= 0) children.splice(index, 1);
            node.parentNode = null;
            return node;
        },
        replaceChildren(...nodes) {
            children.splice(0).forEach((node) => {
                node.parentNode = null;
            });
            nodes.forEach((node) => this.appendChild(node));
        },
    };

    const createElement = (tagName) => ({
        tagName: tagName.toUpperCase(),
        id: '',
        parentNode: null,
        style: {},
        textContent: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setAttribute: vi.fn(),
    });

    vi.stubGlobal('document', {
        createElement: vi.fn(createElement),
        getElementById: vi.fn((id) => (id === container.id ? container : null)),
        querySelectorAll: vi.fn(() => [container]),
    });
    vi.stubGlobal('window', {
        devicePixelRatio: 1,
        isRenderingPaused: false,
        isRenderingReduced: false,
        location: { search },
        settings: {
            backgroundComboEffects: true,
            effectQuality: 'High',
            pieceLockRipple: true,
            reducedMotion: false,
        },
        addEventListener: vi.fn((type, handler) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
        }),
        removeEventListener: vi.fn((type, handler) => {
            listeners.get(type)?.delete(handler);
        }),
        matchMedia: vi.fn(() => {
            const handlers = new Set();
            const query = {
                matches: reducedMotion,
                addEventListener: vi.fn((type, handler) => {
                    if (type === 'change') handlers.add(handler);
                }),
                removeEventListener: vi.fn((type, handler) => {
                    if (type === 'change') handlers.delete(handler);
                }),
                dispatch(matches) {
                    this.matches = matches;
                    handlers.forEach((handler) => handler({ matches }));
                },
            };
            mediaQueries.push(query);
            return query;
        }),
    });
    vi.stubGlobal('navigator', {
        deviceMemory: 8,
        gpu: {},
        hardwareConcurrency: 8,
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        rafCallbacks.push(callback);
        return 100 + rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    return {
        container,
        listeners,
        mediaQueries,
        rafCallbacks,
    };
}

describe('Koi Pond theme lifecycle', () => {
    const activeThemes = [];
    let consoleSpies;

    beforeEach(() => {
        koiMocks.gpuRegistrations.length = 0;
        koiMocks.rendererInit = null;
        koiMocks.rendererInstances.length = 0;
        koiMocks.runtimeInstances.length = 0;
        koiMocks.runtimeFactory.mockReset();
        koiMocks.runtimeFactory.mockImplementation(createRuntime);
        consoleSpies = [
            vi.spyOn(console, 'error').mockImplementation(() => {}),
            vi.spyOn(console, 'log').mockImplementation(() => {}),
            vi.spyOn(console, 'warn').mockImplementation(() => {}),
        ];
    });

    afterEach(() => {
        activeThemes.splice(0).forEach((theme) => {
            try { theme.cleanup(); } catch (error) { /* noop */ }
        });
        consoleSpies.forEach((spy) => spy.mockRestore());
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    function trackTheme() {
        const theme = new KoiPondTheme();
        activeThemes.push(theme);
        return theme;
    }

    it('rebuilds once for real nested quality and AA changes without duplicating listeners', async () => {
        const { mediaQueries } = createFakeDom();
        const baselineListeners = new Map(
            [
                EVENTS.PIECE_LOCK,
                EVENTS.LINE_CLEAR,
                EVENTS.COMBO,
                EVENTS.TSPIN,
                EVENTS.B2B,
                EVENTS.PERFECT_CLEAR,
            ].map((eventName) => [eventName, eventBus.listenerCount(eventName)]),
        );
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const firstRuntime = koiMocks.runtimeInstances[0];
        const firstRenderer = koiMocks.rendererInstances[0];
        const firstMediaQuery = mediaQueries[0];
        for (const [eventName, count] of baselineListeners) {
            expect(eventBus.listenerCount(eventName)).toBe(count + 1);
        }

        eventBus.emit(EVENTS.SETTINGS_CHANGED, {
            settings: {
                ...window.settings,
                effectQuality: 'Low',
                enableAntialiasing: false,
            },
        });
        await vi.waitFor(() => expect(koiMocks.runtimeInstances).toHaveLength(2));
        await Promise.resolve();

        expect(theme.quality).toBe('Low');
        expect(koiMocks.runtimeInstances).toHaveLength(2);
        expect(koiMocks.runtimeInstances[1].options.quality).toBe('Low');
        expect(koiMocks.rendererInstances[1].options.antialias).toBe(false);
        expect(firstRuntime.dispose).toHaveBeenCalledTimes(1);
        expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(firstMediaQuery.removeEventListener).toHaveBeenCalledWith(
            'change',
            expect.any(Function),
            undefined,
        );
        for (const [eventName, count] of baselineListeners) {
            expect(eventBus.listenerCount(eventName)).toBe(count + 1);
        }

        theme.cleanup();
        activeThemes.length = 0;
        for (const [eventName, count] of baselineListeners) {
            expect(eventBus.listenerCount(eventName)).toBe(count);
        }
        expect(koiMocks.runtimeInstances[1].dispose).toHaveBeenCalledTimes(1);
        expect(koiMocks.rendererInstances[1].dispose).toHaveBeenCalledTimes(1);
    });

    it('does not rebuild for an unrelated full settings snapshot', async () => {
        createFakeDom();
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = koiMocks.runtimeInstances;
        const [renderer] = koiMocks.rendererInstances;
        runtime.configureGameplay.mockClear();
        renderer.setSize.mockClear();

        eventBus.emit(EVENTS.SETTINGS_CHANGED, {
            settings: {
                ...window.settings,
                enableAntialiasing: true,
                musicVolume: 0.35,
            },
            source: 'local',
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(koiMocks.runtimeInstances).toHaveLength(1);
        expect(koiMocks.rendererInstances).toHaveLength(1);
        expect(runtime.dispose).not.toHaveBeenCalled();
        expect(runtime.configureGameplay).toHaveBeenCalledTimes(1);
        expect(renderer.setSize).not.toHaveBeenCalled();
    });

    it('coalesces duplicate render-scale deliveries into one canvas resize', async () => {
        const { listeners } = createFakeDom();
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [renderer] = koiMocks.rendererInstances;
        renderer.setSize.mockClear();

        listeners.get('settingsChanged')?.forEach((handler) => handler({
            detail: { renderScale: 0.75 },
        }));
        eventBus.emit(EVENTS.SETTINGS_CHANGED, {
            settings: {
                ...window.settings,
                renderScale: 0.75,
            },
            source: 'local',
        });
        await Promise.resolve();

        expect(renderer.setSize).toHaveBeenCalledTimes(1);
    });

    it('reconciles a quality and AA change that lands during renderer initialization', async () => {
        createFakeDom();
        let initializeCount = 0;
        let resolveFirstInit;
        koiMocks.rendererInit = () => {
            initializeCount += 1;
            if (initializeCount > 1) return Promise.resolve();
            return new Promise((resolve) => {
                resolveFirstInit = resolve;
            });
        };
        const theme = trackTheme();

        const startPromise = theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        await Promise.resolve();
        window.settings.effectQuality = 'Low';
        window.settings.enableAntialiasing = false;
        resolveFirstInit();
        await startPromise;
        await vi.waitFor(() => expect(koiMocks.runtimeInstances).toHaveLength(2));

        expect(koiMocks.runtimeInstances[1].options.quality).toBe('Low');
        expect(koiMocks.rendererInstances[1].options.antialias).toBe(false);
        expect(koiMocks.runtimeInstances).toHaveLength(2);
    });

    it('disposes a renderer that finishes initialization after its timeout', async () => {
        createFakeDom();
        vi.useFakeTimers();
        let resolveInit;
        koiMocks.rendererInit = () => new Promise((resolve) => {
            resolveInit = resolve;
        });
        const theme = trackTheme();

        const candidatePromise = theme.createRendererCandidate(false, true);
        const timeoutExpectation = expect(candidatePromise).rejects.toThrow(
            'Renderer init timeout',
        );
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_500);
        await timeoutExpectation;

        const [renderer] = koiMocks.rendererInstances;
        expect(renderer.dispose).not.toHaveBeenCalled();
        resolveInit();
        await Promise.resolve();
        await Promise.resolve();

        expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('propagates reduced-motion media changes without rebuilding the scene', async () => {
        const { mediaQueries } = createFakeDom();
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = koiMocks.runtimeInstances;
        runtime.configureGameplay.mockClear();

        mediaQueries[0].dispatch(true);

        expect(koiMocks.runtimeInstances).toHaveLength(1);
        expect(runtime.configureGameplay).toHaveBeenLastCalledWith({
            intensity: 1,
            quality: 'High',
            reducedMotion: true,
        });
    });

    it('falls back to a fresh WebGL2 runtime after coordinated WebGPU loss', async () => {
        createFakeDom();
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const firstRuntime = koiMocks.runtimeInstances[0];
        const firstRenderer = koiMocks.rendererInstances[0];
        const [registration] = koiMocks.gpuRegistrations;

        expect(theme.isWebGPU).toBe(true);
        expect(registration.label).toBe('koi-pond');
        await registration.surface.recover();

        expect(theme.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(koiMocks.runtimeInstances).toHaveLength(2);
        expect(koiMocks.rendererInstances).toHaveLength(2);
        expect(koiMocks.rendererInstances[1].backend.isWebGPUBackend).not.toBe(true);
        expect(firstRuntime.dispose).toHaveBeenCalledTimes(1);
        expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(registration.unregister).toHaveBeenCalledTimes(1);
        expect(koiMocks.gpuRegistrations).toHaveLength(1);
    });

    it('can stop and restart with one live RAF and a fresh runtime', async () => {
        createFakeDom();
        const sharedRenderer = {
            loadTheme: vi.fn(),
            stop: vi.fn(),
        };
        const theme = trackTheme();

        await theme.start(sharedRenderer);
        const firstRuntime = koiMocks.runtimeInstances[0];
        const firstRenderer = koiMocks.rendererInstances[0];
        expect(theme.animationIds).toHaveLength(1);

        theme.stop();
        expect(firstRuntime.dispose).toHaveBeenCalledTimes(1);
        expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(theme.animationIds).toHaveLength(0);
        expect(theme.runtime).toBeNull();
        expect(theme.renderer).toBeNull();

        await theme.start(sharedRenderer);
        expect(koiMocks.runtimeInstances).toHaveLength(2);
        expect(koiMocks.rendererInstances).toHaveLength(2);
        expect(theme.animationIds).toHaveLength(1);
        expect(theme.runtime).toBe(koiMocks.runtimeInstances[1]);
        expect(theme.renderer).toBe(koiMocks.rendererInstances[1]);
    });

    it('forwards bounded mouse parallax and recenters on touch, blur, and pause', async () => {
        const { listeners } = createFakeDom();
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = koiMocks.runtimeInstances;

        listeners.get('pointermove')?.forEach((handler) => handler({
            clientX: 1280,
            clientY: 0,
            isPrimary: true,
            pointerType: 'mouse',
        }));
        expect(runtime.setPointer).toHaveBeenLastCalledWith(1, 1);

        runtime.resetPointer.mockClear();
        listeners.get('pointermove')?.forEach((handler) => handler({
            clientX: 640,
            clientY: 360,
            isPrimary: true,
            pointerType: 'touch',
        }));
        expect(runtime.resetPointer).toHaveBeenCalledTimes(1);

        listeners.get('blur')?.forEach((handler) => handler());
        expect(runtime.resetPointer).toHaveBeenCalledTimes(2);

        theme.pause();
        expect(runtime.resetPointer).toHaveBeenLastCalledWith({ immediate: true });
    });
});
