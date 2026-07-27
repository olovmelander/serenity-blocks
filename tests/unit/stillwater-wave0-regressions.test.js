/* eslint-disable max-classes-per-file */
import { existsSync, readFileSync } from 'node:fs';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import StillwaterTheme from '../../src/themes/stillwater/stillwater-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

const stillwaterMocks = vi.hoisted(() => ({
    gpuRegistrations: [],
    rendererInit: null,
    rendererInstances: [],
    runtimeFactory: vi.fn(),
    runtimeInstances: [],
    viewport: {
        dpr: 1,
        height: 720,
        width: 1280,
    },
}));

vi.mock('three/webgpu', () => {
    class MockNodeFrame {
        constructor() {
            this.camera = null;
            this.frameId = 0;
            this.material = null;
            this.object = null;
            this.renderer = null;
            this.scene = null;
            this.update = vi.fn(() => {
                this.frameId += 1;
            });
        }
    }

    class MockWebGPURenderer {
        constructor(options = {}) {
            this.options = options;
            this.domElement = document.createElement('canvas');
            const quadDisposeListener = vi.fn();
            const quadGeometry = {
                removeEventListener: vi.fn(),
            };
            this.backend = options.forceWebGL
                ? {
                    isWebGLBackend: true,
                    trackTimestamp: options.trackTimestamp === true,
                }
                : {
                    isWebGPUBackend: true,
                    trackTimestamp: options.trackTimestamp === true,
                    device: {
                        queue: {
                            onSubmittedWorkDone: vi.fn(async () => {}),
                        },
                        lost: new Promise(() => {}),
                        addEventListener: vi.fn(),
                        destroy: vi.fn(),
                        removeEventListener: vi.fn(),
                    },
                };
            this._animation = {
                _requestId: 1,
                start: vi.fn(() => {
                    this._animation._requestId = 1;
                }),
                stop: vi.fn(() => {
                    this._animation._requestId = null;
                }),
            };
            this._bundles = { dispose: vi.fn() };
            this._geometries = {
                _geometryDisposeListeners: new Map([
                    [quadGeometry, quadDisposeListener],
                ]),
            };
            this._nodes = { nodeFrame: new MockNodeFrame() };
            this._nodes.nodeFrame.camera = {};
            this._nodes.nodeFrame.material = {};
            this._nodes.nodeFrame.object = {};
            this._nodes.nodeFrame.renderer = this;
            this._nodes.nodeFrame.scene = {};
            this.initialNodeFrame = this._nodes.nodeFrame;
            this._quad = { geometry: quadGeometry };
            this._renderContexts = { dispose: vi.fn() };
            this._renderLists = { dispose: vi.fn() };
            this.info = {
                autoReset: true,
                compute: {},
                memory: {},
                render: {},
                reset: vi.fn(),
            };
            this.pixelRatio = 1;
            this.init = vi.fn(() => (
                stillwaterMocks.rendererInit?.(this) ?? Promise.resolve()
            ));
            this.compileAsync = vi.fn(async () => {});
            this.dispose = vi.fn();
            this.getPixelRatio = vi.fn(() => this.pixelRatio);
            this.resolveTimestampsAsync = vi.fn(async () => 0.25);
            this.setAnimationLoop = vi.fn();
            this.setClearColor = vi.fn();
            this.setOutputRenderTarget = vi.fn();
            this.setPixelRatio = vi.fn((value) => {
                this.pixelRatio = value;
            });
            this.setRenderTarget = vi.fn();
            this.setSize = vi.fn();
            stillwaterMocks.rendererInstances.push(this);
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
            this.fov = fieldOfView;
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

vi.mock('../../src/themes/stillwater/rendering/stillwater-runtime.js', () => ({
    createStillwaterRuntime: (...args) => stillwaterMocks.runtimeFactory(...args),
}));

vi.mock('../../src/utils/gpu-loss-coordinator.js', () => ({
    initGpuLossCoordinator: vi.fn(),
    registerGpuSurface: (label, surface) => {
        const registration = {
            label,
            surface,
            unregister: vi.fn(),
        };
        stillwaterMocks.gpuRegistrations.push(registration);
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
    getViewport: () => ({ ...stillwaterMocks.viewport }),
}));

function createRuntime(options) {
    const runtime = {
        options,
        attach: vi.fn(),
        camera: vi.fn(),
        configureGameplay: vi.fn(),
        criticalReady: Promise.resolve(true),
        detach: vi.fn(),
        dispose: vi.fn(),
        flushReactions: vi.fn(),
        getCaptureMeta: vi.fn(() => ({ productionBuilders: true })),
        getDiagnostics: vi.fn(() => ({ id: 'stillwater-masterpiece' })),
        getRendererCounters: vi.fn(() => ({ drawCalls: 12 })),
        getResourceState: vi.fn(() => ({ disposed: false })),
        pulse: vi.fn(),
        ready: Promise.resolve(true),
        render: vi.fn(),
        resetReactions: vi.fn(),
        resize: vi.fn(),
        setLayout: vi.fn(),
        setReducedMotion: vi.fn(),
        triggerPreset: vi.fn(() => true),
        update: vi.fn(),
    };
    runtime.attach.mockReturnValue(runtime.detach);
    stillwaterMocks.runtimeInstances.push(runtime);
    return runtime;
}

function createModeManager({
    modeId = 'single',
    playerCount = 1,
} = {}) {
    const handlers = new Map();
    const mode = {
        matchConfig: { numPlayers: playerCount },
        multiplayerState: {
            numPlayers: playerCount,
            players: Array.from({ length: playerCount }, () => ({})),
        },
    };
    return {
        mode,
        getCurrentMode: vi.fn(() => mode),
        getCurrentModeId: vi.fn(() => modeId),
        on: vi.fn((eventName, handler) => {
            if (!handlers.has(eventName)) handlers.set(eventName, new Set());
            handlers.get(eventName).add(handler);
            return vi.fn(() => handlers.get(eventName)?.delete(handler));
        }),
        emit(eventName, payload = {}) {
            handlers.get(eventName)?.forEach((handler) => handler(payload));
        },
    };
}

function createFakeDom({
    modeId = 'single',
    playerCount = 1,
    reducedMotion = false,
    search = '',
} = {}) {
    const listeners = new Map();
    const mediaQueries = [];
    const rafCallbacks = [];
    const children = [];
    const classNames = new Set();
    const modeManager = createModeManager({ modeId, playerCount });

    const container = {
        id: 'stillwater-theme',
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
            if (node.parentNode && node.parentNode !== this) {
                node.parentNode.removeChild(node);
            }
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
        serenityBlocks: { gameModeManager: modeManager },
        settings: {
            backgroundComboEffects: true,
            effectQuality: 'High',
            enableAntialiasing: true,
            enableBloom: true,
            gameMode: modeId,
            graphicsQuality: 'High',
            pieceLockRipple: true,
            reducedMotion: false,
            renderScale: 1,
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
        modeManager,
        rafCallbacks,
    };
}

const themeSource = readFileSync(
    new URL('../../src/themes/stillwater/stillwater-theme.js', import.meta.url),
    'utf8',
);
const indexSource = readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
);
const mainStylesSource = readFileSync(
    new URL('../../public/styles/main.css', import.meta.url),
    'utf8',
);
const retiredShaderUrl = new URL(
    '../../src/themes/stillwater/stillwater-shaders.js',
    import.meta.url,
);

describe('Stillwater production adapter regression gates', () => {
    const activeThemes = [];
    let consoleSpies;

    beforeEach(() => {
        stillwaterMocks.gpuRegistrations.length = 0;
        stillwaterMocks.rendererInit = null;
        stillwaterMocks.rendererInstances.length = 0;
        stillwaterMocks.runtimeInstances.length = 0;
        stillwaterMocks.runtimeFactory.mockReset();
        stillwaterMocks.runtimeFactory.mockImplementation(createRuntime);
        stillwaterMocks.viewport = {
            dpr: 1,
            height: 720,
            width: 1280,
        };
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
        StillwaterTheme.disposeRendererPool();
        consoleSpies.forEach((spy) => spy.mockRestore());
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    function trackTheme() {
        const theme = new StillwaterTheme();
        activeThemes.push(theme);
        return theme;
    }

    it('caps only the WebGL2 fallback render surface for stable frame pacing', () => {
        const theme = trackTheme();
        theme.qualityProfile = { maxPixelRatio: 1.25 };
        theme.isWebGL = false;
        expect(theme.getBackendPixelRatioCap()).toBe(1.25);
        theme.isWebGL = true;
        expect(theme.getBackendPixelRatioCap()).toBe(0.6);
    });

    it('builds the production-native runtime with explicit params and masked warmup', async () => {
        const { container, rafCallbacks } = createFakeDom({
            search: [
                '?stillwaterQuality=Low',
                'event=perfectclear',
                'reflection=off',
                'layout=quad',
                'foo=must-not-leak',
            ].join('&'),
        });
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });

        const [renderer] = stillwaterMocks.rendererInstances;
        const [runtime] = stillwaterMocks.runtimeInstances;
        const { params } = runtime.options;
        expect(theme.isWebGPU).toBe(true);
        expect(theme.backendName).toBe('WebGPU');
        expect(theme.getCurrentQualityLevel()).toBe('Low');
        expect(renderer.info.autoReset).toBe(false);
        expect(renderer.toneMapping).toBe('NoToneMapping');
        expect(renderer.outputColorSpace).toBe('SRGBColorSpace');
        expect(renderer.compileAsync).toHaveBeenCalledTimes(1);
        expect(renderer.info.reset).toHaveBeenCalledTimes(1);
        expect(runtime.render).toHaveBeenCalledTimes(1);
        expect(runtime.attach).toHaveBeenCalledTimes(1);
        expect(runtime.attach).toHaveBeenCalledWith(eventBus, EVENTS);
        expect(runtime.configureGameplay).toHaveBeenCalledWith({
            backgroundComboEffects: true,
            enabled: true,
            intensity: 1,
            pieceLockRipple: true,
            reducedMotion: false,
        });
        expect(params).toBeInstanceOf(URLSearchParams);
        expect(params.get('quality')).toBe('Low');
        expect(params.get('event')).toBe('idle');
        expect(params.get('reflection')).toBe('auto');
        expect(params.get('layout')).toBe('solo');
        expect(params.get('proxies')).toBe('off');
        expect(params.get('post')).toBe('off');
        expect(params.get('boardGuide')).toBe('off');
        expect(params.has('validationTelemetry')).toBe(false);
        expect(params.has('foo')).toBe(false);
        expect(container.children).toHaveLength(1);
        expect(renderer.domElement.style.opacity).toBe('1');
        expect(window.__STILLWATER_MASTERPIECE__.isReady()).toBe(true);
        expect(window.__STILLWATER_MASTERPIECE__.beginValidationDriver).toBeUndefined();
        expect(window.__STILLWATER_THEME__.getDiagnostics().backend).toBe('WebGPU');

        rafCallbacks.shift()(1_000);
        expect(renderer.info.reset).toHaveBeenCalledTimes(2);
        expect(runtime.render).toHaveBeenCalledTimes(2);
        expect(theme.getDiagnostics().counters).toMatchObject({
            animationLoopStarts: 1,
            composedRenders: 2,
            gameplayRenders: 1,
            scheduledFrames: 1,
            simulationUpdates: 1,
            warmupRenders: 1,
        });
    });

    it('warms MRT tiers through the exact post graph instead of a one-target compile', async () => {
        createFakeDom({ search: '?stillwaterQuality=High' });
        stillwaterMocks.runtimeFactory.mockImplementation((options) => {
            const runtime = createRuntime(options);
            runtime.getDiagnostics.mockReturnValue({
                id: 'stillwater-masterpiece',
                post: { useMRT: true },
            });
            return runtime;
        });
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });

        const [renderer] = stillwaterMocks.rendererInstances;
        const [runtime] = stillwaterMocks.runtimeInstances;
        expect(renderer.compileAsync).not.toHaveBeenCalled();
        expect(runtime.render).toHaveBeenCalledTimes(1);
        expect(theme.getDiagnostics().counters.warmupRenders).toBe(1);
    });

    it('verifies the backend exactly and falls back to a fresh forced-WebGL2 renderer', async () => {
        createFakeDom();
        stillwaterMocks.rendererInit = (renderer) => {
            if (!renderer.options.forceWebGL) {
                return Promise.reject(new Error('native unavailable'));
            }
            return Promise.resolve();
        };
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });

        expect(stillwaterMocks.rendererInstances).toHaveLength(2);
        expect(stillwaterMocks.rendererInstances[0].dispose).toHaveBeenCalledTimes(1);
        expect(stillwaterMocks.rendererInstances[1].options.forceWebGL).toBe(true);
        expect(stillwaterMocks.rendererInstances[1].backend.isWebGLBackend).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.isWebGL).toBe(true);
        expect(theme.backendName).toBe('WebGL2');
        expect(stillwaterMocks.gpuRegistrations).toHaveLength(0);
    });

    it('rejects a candidate that initializes with the wrong backend identity', async () => {
        createFakeDom();
        stillwaterMocks.rendererInit = (renderer) => {
            renderer.backend = { isWebGLBackend: true };
            return Promise.resolve();
        };
        const theme = trackTheme();

        await expect(theme.createRendererCandidate(false, true)).rejects.toThrow(
            'Native WebGPU backend verification failed',
        );
        expect(stillwaterMocks.rendererInstances[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('reuses one drained renderer across theme instances and destroys the pool on shutdown', async () => {
        createFakeDom();
        const sharedRenderer = { loadTheme: vi.fn(), stop: vi.fn() };
        const theme = trackTheme();
        await theme.start(sharedRenderer);
        const [renderer] = stillwaterMocks.rendererInstances;
        const { device } = renderer.backend;

        theme.stop();
        const replacementTheme = trackTheme();
        await replacementTheme.start(sharedRenderer);

        expect(stillwaterMocks.rendererInstances).toHaveLength(1);
        expect(replacementTheme.renderer).toBe(renderer);
        expect(replacementTheme.getDiagnostics()).toMatchObject({
            rendererPoolReused: true,
            counters: {
                rendererPoolClaims: 1,
            },
        });
        expect(renderer.dispose).not.toHaveBeenCalled();
        expect(device.destroy).not.toHaveBeenCalled();
        expect(renderer._animation.stop).toHaveBeenCalledTimes(1);
        expect(renderer._animation.start).toHaveBeenCalledTimes(1);
        expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
        expect(renderer.setOutputRenderTarget).toHaveBeenCalledWith(null);
        expect(renderer._renderLists.dispose).toHaveBeenCalledTimes(1);
        expect(renderer._renderContexts.dispose).toHaveBeenCalledTimes(1);
        expect(renderer._bundles.dispose).toHaveBeenCalledTimes(1);
        expect(renderer._nodes.nodeFrame).not.toBe(renderer.initialNodeFrame);
        expect(renderer.initialNodeFrame).toMatchObject({
            camera: null,
            material: null,
            object: null,
            renderer: null,
            scene: null,
        });
        expect(renderer._nodes.nodeFrame).toMatchObject({
            camera: null,
            material: null,
            object: null,
            renderer: null,
            scene: null,
        });
        expect(renderer._quad.geometry.removeEventListener).toHaveBeenCalledWith(
            'dispose',
            expect.any(Function),
        );
        expect(renderer._geometries._geometryDisposeListeners.size).toBe(0);

        replacementTheme.stop();
        StillwaterTheme.disposeSharedResources();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(device.destroy).toHaveBeenCalledTimes(1);
        expect(renderer.backend.device).toBeNull();
        expect(typeof renderer.onDeviceLost).toBe('function');
    });

    it('retains the pool across switch disposal and drains it through ThemeManager cleanup', async () => {
        createFakeDom();
        const sharedRenderer = {
            cleanup: vi.fn(),
            clearThemeResources: vi.fn(),
            loadTheme: vi.fn(),
            stop: vi.fn(),
        };
        const manager = new ThemeManager(sharedRenderer, {
            assetManager: {},
        });
        manager.themeRegistry = new Map([
            ['stillwater', async () => ({ default: StillwaterTheme })],
        ]);
        const theme = await manager.loadTheme('stillwater', true);
        await theme.start(sharedRenderer);
        const [renderer] = stillwaterMocks.rendererInstances;
        const { device } = renderer.backend;

        manager.disposeThemeInstance(theme, 'stillwater', {
            removeFromCache: true,
        });
        expect(renderer.dispose).not.toHaveBeenCalled();
        expect(device.destroy).not.toHaveBeenCalled();

        manager.cleanup();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(device.destroy).toHaveBeenCalledTimes(1);
        expect(renderer.backend.device).toBeNull();
        expect(sharedRenderer.cleanup).toHaveBeenCalledTimes(1);
    });

    it('resolves validation timestamp queries before reusing a pooled renderer', async () => {
        createFakeDom({ search: '?stillwaterValidation=1' });
        const sharedRenderer = { loadTheme: vi.fn(), stop: vi.fn() };
        const theme = trackTheme();
        await theme.start(sharedRenderer);
        const [renderer] = stillwaterMocks.rendererInstances;

        theme.stop();
        const replacementTheme = trackTheme();
        await replacementTheme.start(sharedRenderer);

        expect(stillwaterMocks.rendererInstances).toHaveLength(1);
        expect(replacementTheme.renderer).toBe(renderer);
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledWith('render');
    });

    it('disposes a native renderer that finishes after the 5.5 second timeout', async () => {
        createFakeDom();
        vi.useFakeTimers();
        let resolveInit;
        stillwaterMocks.rendererInit = () => new Promise((resolve) => {
            resolveInit = resolve;
        });
        const theme = trackTheme();

        const candidatePromise = theme.createRendererCandidate(false, true);
        const rejection = expect(candidatePromise).rejects.toThrow('Renderer init timeout');
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_500);
        await rejection;

        const [renderer] = stillwaterMocks.rendererInstances;
        expect(renderer.dispose).not.toHaveBeenCalled();
        resolveInit();
        await Promise.resolve();
        await Promise.resolve();
        expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('rebuilds structural settings once and keeps exactly one canvas and one director', async () => {
        const { container } = createFakeDom();
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const firstRuntime = stillwaterMocks.runtimeInstances[0];
        const [firstRenderer] = stillwaterMocks.rendererInstances;

        eventBus.emit(EVENTS.SETTINGS_CHANGED, {
            settings: {
                ...window.settings,
                effectQuality: 'Minimal',
                enableAntialiasing: false,
                enableBloom: false,
            },
        });
        await vi.waitFor(() => {
            expect(stillwaterMocks.runtimeInstances).toHaveLength(2);
        });

        const secondRuntime = stillwaterMocks.runtimeInstances[1];
        expect(theme.quality).toBe('Minimal');
        expect(secondRuntime.options.params.get('quality')).toBe('Minimal');
        expect(secondRuntime.options.params.get('bloom')).toBe('0');
        expect(stillwaterMocks.rendererInstances[1].options.antialias).toBe(false);
        expect(firstRuntime.detach).toHaveBeenCalledTimes(1);
        expect(firstRuntime.dispose).toHaveBeenCalledTimes(1);
        expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(secondRuntime.attach).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(1);
        expect(theme.getDiagnostics().counters.settingsRebuilds).toBe(1);
    });

    it('applies gameplay settings live without duplicate canonical wrapper listeners', async () => {
        const { listeners, mediaQueries } = createFakeDom();
        const canonicalEvents = [
            EVENTS.PIECE_LOCK,
            EVENTS.LINE_CLEAR,
            EVENTS.COMBO,
            EVENTS.TSPIN,
            EVENTS.B2B,
            EVENTS.PERFECT_CLEAR,
        ];
        const baselineCounts = canonicalEvents.map((name) => eventBus.listenerCount(name));
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;
        runtime.configureGameplay.mockClear();

        listeners.get('settingsChanged')?.forEach((handler) => handler({
            detail: {
                backgroundComboEffects: false,
                pieceLockRipple: false,
            },
        }));
        expect(runtime.configureGameplay).toHaveBeenLastCalledWith({
            backgroundComboEffects: false,
            enabled: true,
            intensity: 1,
            pieceLockRipple: false,
            reducedMotion: false,
        });

        mediaQueries[0].dispatch(true);
        expect(runtime.configureGameplay).toHaveBeenLastCalledWith({
            backgroundComboEffects: true,
            enabled: true,
            intensity: 1,
            pieceLockRipple: true,
            reducedMotion: true,
        });
        canonicalEvents.forEach((name, index) => {
            expect(eventBus.listenerCount(name)).toBe(baselineCounts[index]);
        });
        expect(runtime.attach).toHaveBeenCalledTimes(1);
    });

    it('re-resolves duo, quad, narrow, resume, and diagnostics-driven layouts', async () => {
        const { modeManager } = createFakeDom({
            modeId: 'local-multiplayer',
            playerCount: 2,
        });
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;

        expect(theme.layoutPolicy.layout).toBe('duo');
        expect(runtime.setLayout).toHaveBeenCalledWith(
            expect.objectContaining({ layout: 'duo' }),
        );

        modeManager.mode.matchConfig.numPlayers = 4;
        modeManager.mode.multiplayerState.numPlayers = 4;
        modeManager.mode.multiplayerState.players = [{}, {}, {}, {}];
        modeManager.emit('modeStarted');
        expect(theme.layoutPolicy.layout).toBe('quad');

        theme.resize(900, 800);
        expect(theme.layoutPolicy.narrow).toBe(true);
        expect(theme.layoutPolicy.camera.narrowPullback).toBe(4);

        window.__STILLWATER_THEME__.setLayout({
            height: 720,
            stillwaterLayout: 'odyssey',
            width: 1280,
        });
        expect(theme.layoutPolicy.layout).toBe('odyssey');

        const [renderer] = stillwaterMocks.rendererInstances;
        expect(theme.getDiagnostics().rendererAnimation).toMatchObject({
            requestActive: true,
            pausedByLifecycle: false,
            suspendedForValidation: false,
        });
        expect(theme.pause()).toBe(true);
        expect(renderer._animation.stop).toHaveBeenCalledTimes(1);
        expect(theme.getDiagnostics().rendererAnimation).toMatchObject({
            requestActive: false,
            pausedByLifecycle: true,
            suspendedForValidation: false,
        });
        expect(theme.resume()).toBe(true);
        expect(renderer._animation.start).toHaveBeenCalledTimes(1);
        expect(theme.getDiagnostics().rendererAnimation).toMatchObject({
            requestActive: true,
            pausedByLifecycle: false,
            suspendedForValidation: false,
        });
        expect(theme.getDiagnostics().counters).toMatchObject({
            pauses: 1,
            resumes: 1,
            rendererAnimationPauseStops: 1,
            rendererAnimationResumeStarts: 1,
        });
    });

    it('drains submitted WebGPU work before coalescing renderer resizes', async () => {
        const { rafCallbacks } = createFakeDom();
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;
        const [renderer] = stillwaterMocks.rendererInstances;
        const { queue } = renderer.backend.device;
        let releaseDrain;
        const drain = new Promise((resolve) => {
            releaseDrain = resolve;
        });
        queue.onSubmittedWorkDone.mockImplementationOnce(() => drain);
        renderer.setSize.mockClear();
        runtime.resize.mockClear();
        runtime.render.mockClear();
        runtime.update.mockClear();

        theme.resize(900, 700);
        theme.resize(1100, 800);
        rafCallbacks.shift()(5_000);
        await Promise.resolve();

        expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
        expect(renderer.setSize).not.toHaveBeenCalled();
        expect(runtime.resize).not.toHaveBeenCalled();
        expect(runtime.render).not.toHaveBeenCalled();
        expect(runtime.update).not.toHaveBeenCalled();

        releaseDrain();
        await drain;
        await vi.waitFor(() => {
            expect(renderer.setSize).toHaveBeenCalledTimes(1);
        });
        expect(renderer.setSize).toHaveBeenCalledWith(1100, 800, false);
        expect(runtime.resize).toHaveBeenCalledTimes(1);
        expect(runtime.resize).toHaveBeenCalledWith(1100, 800);

        rafCallbacks.shift()(10_000);
        expect(runtime.render).toHaveBeenCalledTimes(1);
        expect(runtime.update).toHaveBeenCalledTimes(1);
        expect(runtime.update.mock.calls[0][1]).toBeCloseTo(1 / 60);
    });

    it('isolates pending resize drains from replacement renderer generations', async () => {
        createFakeDom();
        const theme = trackTheme();
        const sharedRenderer = { loadTheme: vi.fn(), stop: vi.fn() };
        await theme.start(sharedRenderer);
        const [firstRenderer] = stillwaterMocks.rendererInstances;
        const firstQueue = firstRenderer.backend.device.queue;
        let releaseFirstDrain;
        const firstDrain = new Promise((resolve) => {
            releaseFirstDrain = resolve;
        });
        firstQueue.onSubmittedWorkDone.mockImplementationOnce(() => firstDrain);
        firstRenderer.setSize.mockClear();

        theme.resize(900, 700);
        await Promise.resolve();
        expect(firstQueue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);

        theme.stop();
        await theme.start(sharedRenderer);
        const secondRenderer = stillwaterMocks.rendererInstances[1];
        const secondQueue = secondRenderer.backend.device.queue;
        secondRenderer.setSize.mockClear();

        theme.resize(1100, 800);
        await vi.waitFor(() => {
            expect(secondRenderer.setSize).toHaveBeenCalledWith(1100, 800, false);
        });
        expect(secondQueue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);

        releaseFirstDrain();
        await firstDrain;
        await Promise.resolve();
        expect(firstRenderer.setSize).not.toHaveBeenCalled();
        expect(secondRenderer.setSize).toHaveBeenCalledTimes(1);
    });

    it('does not resize a rejected WebGPU queue and recovers through WebGL2', async () => {
        const { container } = createFakeDom();
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [firstRenderer] = stillwaterMocks.rendererInstances;
        const { queue } = firstRenderer.backend.device;
        queue.onSubmittedWorkDone.mockRejectedValueOnce(
            new Error('device queue rejected'),
        );
        firstRenderer.setSize.mockClear();

        theme.resize(900, 700);

        await vi.waitFor(() => {
            expect(stillwaterMocks.rendererInstances).toHaveLength(2);
            expect(theme.isWebGL).toBe(true);
        });
        expect(firstRenderer.setSize).not.toHaveBeenCalled();
        expect(theme.rendererResizeJob).toBeNull();
        expect(theme.rendererResizeInFlight).toBe(false);
        expect(theme.gpuRecoveryAttempted).toBe(true);
        expect(container.children).toHaveLength(1);
    });

    it('recovers one loss per activation, replaces the debug API, and retains one canvas', async () => {
        const { container } = createFakeDom();
        const sharedRenderer = { loadTheme: vi.fn(), stop: vi.fn() };
        const theme = trackTheme();
        await theme.start(sharedRenderer);
        const firstRenderer = theme.renderer;
        const firstDebug = window.__STILLWATER_MASTERPIECE__;
        const [registration] = stillwaterMocks.gpuRegistrations;

        await registration.surface.recover();
        expect(theme.forceWebGL).toBe(true);
        expect(theme.renderer).not.toBe(firstRenderer);
        expect(theme.isWebGL).toBe(true);
        expect(window.__STILLWATER_MASTERPIECE__).not.toBe(firstDebug);
        expect(container.children).toHaveLength(1);
        expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(registration.unregister).toHaveBeenCalledTimes(1);
        expect(theme.getDiagnostics().counters.recoveries).toBe(1);
        await expect(registration.surface.recover()).rejects.toThrow(
            'Stillwater GPU recovery already attempted',
        );

        theme.stop();
        await theme.start(sharedRenderer);
        expect(theme.gpuRecoveryAttempted).toBe(false);
        await expect(theme.recoverBackend('webgl')).resolves.toBeUndefined();
        expect(theme.gpuRecoveryAttempted).toBe(true);
        expect(container.children).toHaveLength(1);
    });

    it('records raw stalls while clamping simulation and proves gated frames do no work', async () => {
        const { rafCallbacks } = createFakeDom({
            search: '?stillwaterPerf=1',
        });
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;
        const [renderer] = stillwaterMocks.rendererInstances;
        runtime.update.mockClear();
        renderer.info.reset.mockClear();
        runtime.render.mockClear();

        rafCallbacks.shift()(1_000);
        window.isRenderingPaused = true;
        rafCallbacks.shift()(3_000);
        window.isRenderingPaused = false;
        rafCallbacks.shift()(5_000);

        expect(runtime.update).toHaveBeenCalledTimes(2);
        expect(runtime.update.mock.calls[1][1]).toBe(0.1);
        expect(renderer.info.reset).toHaveBeenCalledTimes(2);
        expect(runtime.render).toHaveBeenCalledTimes(2);
        const diagnostics = theme.getDiagnostics();
        expect(diagnostics.counters).toMatchObject({
            allowedFrames: 2,
            gatedFrames: 1,
            scheduledFrames: 3,
            simulationUpdates: 2,
        });
        expect(diagnostics.frame.maximumRawFrameMs).toBe(4_000);
        expect(diagnostics.frame.simulationDeltaCapMs).toBe(100);
    });

    it('steps only Stillwater with the query-gated validation driver and drains WebGPU', async () => {
        createFakeDom({
            search: [
                '?stillwaterValidation=1',
                'stillwaterPerf=1',
                'stillwaterPowerPreference=low-power',
            ].join('&'),
        });
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;
        const [renderer] = stillwaterMocks.rendererInstances;
        const debug = window.__STILLWATER_MASTERPIECE__;
        const { queue } = renderer.backend.device;
        runtime.update.mockClear();
        runtime.render.mockClear();
        renderer.info.reset.mockClear();

        expect(renderer.options.powerPreference).toBe('low-power');
        expect(theme.getDiagnostics()).toMatchObject({
            rendererPowerPreference: 'low-power',
            validation: {
                driverActive: false,
                enabled: true,
                framePending: false,
            },
        });
        expect(runtime.options.params.get('validationTelemetry')).toBe('1');
        expect(theme.getDiagnostics().validation.activation).toMatchObject({
            measurementNotes: {
                heroGltf: expect.stringContaining(
                    'GPU upload is not measured separately',
                ),
            },
            milestones: {
                sceneStart: expect.objectContaining({ elapsedMs: 0 }),
                rendererReady: expect.any(Object),
                runtimeConstructed: expect.any(Object),
                criticalHeroReady: expect.any(Object),
                targetHeroReady: expect.any(Object),
                warmRenderComplete: expect.any(Object),
                canvasReveal: expect.any(Object),
            },
        });
        expect(typeof debug.beginValidationDriver).toBe('function');
        expect(typeof debug.stepValidationFrame).toBe('function');
        expect(typeof debug.endValidationDriver).toBe('function');

        expect(debug.beginValidationDriver()).toMatchObject({
            ok: true,
            alreadyActive: false,
            backend: 'WebGPU',
            powerPreference: 'low-power',
            rendererAnimationSuspended: true,
        });
        expect(cancelAnimationFrame).toHaveBeenCalledWith(101);
        expect(renderer._animation.stop).toHaveBeenCalledTimes(1);
        expect(theme.animationLoopStarted).toBe(false);

        const first = await debug.stepValidationFrame(1_000);
        expect(first).toMatchObject({
            ok: true,
            rendered: true,
            backend: 'WebGPU',
            completionSource: 'webgpu-queue-drained',
            queueCompletionSupported: true,
            queueCompletionError: null,
        });
        expect(first.cpuSubmissionMs).toBeGreaterThanOrEqual(0);
        expect(first.queueWaitMs).toBeGreaterThanOrEqual(0);
        expect(first.completedFrameMs).toBeGreaterThanOrEqual(first.cpuSubmissionMs);
        expect(first.gpuTimestampMs).toBe(0.25);
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledWith('render');
        expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
        expect(renderer._nodes.nodeFrame.update).toHaveBeenCalledTimes(1);
        expect(renderer.info.frame).toBe(1);
        expect(runtime.update).toHaveBeenCalledWith(1 / 60, 1 / 60);
        expect(runtime.render).toHaveBeenCalledTimes(1);

        window.isRenderingPaused = true;
        const gated = await debug.stepValidationFrame(2_000);
        expect(gated).toMatchObject({
            ok: true,
            rendered: false,
            reason: 'Frame was gated by the production lifecycle.',
        });
        expect(runtime.update).toHaveBeenCalledTimes(1);
        expect(runtime.render).toHaveBeenCalledTimes(1);
        expect(renderer._nodes.nodeFrame.update).toHaveBeenCalledTimes(1);
        window.isRenderingPaused = false;

        expect(debug.endValidationDriver()).toMatchObject({
            ok: true,
            wasActive: true,
            rendererAnimationRestarted: true,
            animationRestarted: true,
        });
        expect(renderer._animation.start).toHaveBeenCalledTimes(1);
        expect(theme.animationLoopStarted).toBe(true);
        expect(theme.getDiagnostics().counters).toMatchObject({
            allowedFrames: 1,
            gatedFrames: 1,
            scheduledFrames: 2,
            simulationUpdates: 1,
            validationRenders: 1,
        });
    });

    it('defers a validation-owned renderer animation restart until lifecycle resume', async () => {
        createFakeDom({ search: '?stillwaterValidation=1' });
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [renderer] = stillwaterMocks.rendererInstances;
        const debug = window.__STILLWATER_MASTERPIECE__;

        expect(debug.beginValidationDriver()).toMatchObject({
            ok: true,
            rendererAnimationSuspended: true,
        });
        expect(renderer._animation.stop).toHaveBeenCalledTimes(1);

        expect(theme.pause()).toBe(true);
        expect(debug.endValidationDriver()).toMatchObject({
            ok: true,
            rendererAnimationRestarted: false,
            animationRestarted: false,
        });
        expect(renderer._animation.start).not.toHaveBeenCalled();
        expect(theme.getDiagnostics().rendererAnimation).toMatchObject({
            requestActive: false,
            pausedByLifecycle: true,
            suspendedForValidation: false,
        });

        expect(theme.resume()).toBe(true);
        expect(renderer._animation.start).toHaveBeenCalledTimes(1);
        expect(theme.getDiagnostics().rendererAnimation).toMatchObject({
            requestActive: true,
            pausedByLifecycle: false,
            suspendedForValidation: false,
        });
    });

    it('ignores a low-power renderer query outside explicit validation mode', async () => {
        createFakeDom({ search: '?stillwaterPowerPreference=low-power' });
        const theme = trackTheme();

        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });

        const [renderer] = stillwaterMocks.rendererInstances;
        expect(renderer.options.powerPreference).toBe('high-performance');
        expect(theme.getDiagnostics()).toMatchObject({
            rendererPowerPreference: 'high-performance',
            validation: {
                enabled: false,
            },
        });
        expect(window.__STILLWATER_MASTERPIECE__.beginValidationDriver).toBeUndefined();
    });

    it('removes every listener/resource and both debug globals idempotently', async () => {
        const { listeners, mediaQueries, modeManager } = createFakeDom();
        const theme = trackTheme();
        await theme.start({ loadTheme: vi.fn(), stop: vi.fn() });
        const [runtime] = stillwaterMocks.runtimeInstances;
        const [renderer] = stillwaterMocks.rendererInstances;

        theme.stop();
        theme.disposeRuntime();

        expect(runtime.detach).toHaveBeenCalledTimes(1);
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
        expect(renderer.dispose).not.toHaveBeenCalled();
        StillwaterTheme.disposeRendererPool();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(theme.runtime).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(window.__STILLWATER_MASTERPIECE__).toBeUndefined();
        expect(window.__STILLWATER_THEME__).toBeUndefined();
        expect(listeners.get('settingsChanged')?.size || 0).toBe(0);
        expect(listeners.get('gameModeChanged')?.size || 0).toBe(0);
        expect(mediaQueries[0].removeEventListener).toHaveBeenCalledWith(
            'change',
            expect.any(Function),
            undefined,
        );
        expect(modeManager.on).toHaveBeenCalledTimes(3);
    });

    it('ships only the runtime canvas mount and no retired DOM or shader surface', () => {
        const mount = indexSource.match(
            /<div id="stillwater-theme" class="theme-container">([\s\S]*?)<\/div>/,
        );
        const mountElements = mount?.[1].replace(/<!--[\s\S]*?-->/g, '').trim();
        const stillwaterCssStart = mainStylesSource.indexOf(
            '/* ================== STILLWATER THEME ================== */',
        );
        const stillwaterCssEnd = mainStylesSource.indexOf(
            '/* =================================================================',
            stillwaterCssStart + 1,
        );
        const stillwaterCss = mainStylesSource.slice(
            stillwaterCssStart,
            stillwaterCssEnd,
        );
        const retiredDomIds = [
            'stillwater-sky',
            'stillwater-distant-trees',
            'stillwater-mid-trees',
            'stillwater-close-trees',
            'stillwater-foreground-trees',
            'stillwater-waterline',
            'stillwater-rocks',
            'stillwater-water',
            'stillwater-figure',
            'stillwater-reflection',
            'stillwater-water-ripples',
            'stillwater-mist-back',
            'stillwater-mist-mid',
            'stillwater-mist-front',
            'stillwater-particles',
            'stillwater-glow',
        ];

        expect(mount).not.toBeNull();
        expect(mountElements).toBe('');
        retiredDomIds.forEach((id) => {
            expect(indexSource).not.toContain(`id="${id}"`);
            expect(stillwaterCss).not.toContain(`#${id}`);
        });
        expect(stillwaterCss).toMatch(
            /#stillwater-theme\s*\{\s*background: #010706;\s*overflow: hidden;\s*\}/,
        );
        expect(stillwaterCss).not.toContain('.stillwater-');
        expect(existsSync(retiredShaderUrl)).toBe(false);
        expect(themeSource).not.toContain('stillwater-shaders.js');
    });

    it('keeps the adapter thin and free of the retired raw-GLSL production path', () => {
        const runtimeParamsSource = themeSource.slice(
            themeSource.indexOf('    getRuntimeParams() {'),
            themeSource.indexOf('    getRendererSettingsSnapshot() {'),
        );
        expect(themeSource).toContain("from 'three/webgpu'");
        expect(themeSource).toContain(
            "from './rendering/stillwater-runtime.js'",
        );
        expect(themeSource).not.toContain("from 'three'");
        expect(themeSource).not.toContain('stillwater-shaders.js');
        expect(themeSource).not.toContain('new THREE.ShaderMaterial');
        expect(runtimeParamsSource).toContain('const params = new URLSearchParams();');
        expect(runtimeParamsSource).not.toContain('window.location.search');
        expect(themeSource).toContain('this.renderer.info.reset();');
        expect(themeSource).toContain('this.runtime.render();');
        expect(themeSource.match(/this\.safeAnimate\(/g)).toHaveLength(1);
        expect(themeSource).not.toMatch(/eventBus\.on\(EVENTS\.(PIECE_LOCK|LINE_CLEAR|COMBO|TSPIN|B2B|PERFECT_CLEAR)/);
    });
});
