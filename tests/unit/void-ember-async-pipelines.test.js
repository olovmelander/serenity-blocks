import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import VoidEmberTheme from '../../src/themes/void-ember/void-ember-theme.js';

// VoidEmber builds its own raw WebGPU pipelines, so the three-renderer session in
// rendering/async-render-pipelines.js never sees them (ADR-0020). It must create every pipeline
// with the *Async variants and survive a stop()/rebuild landing while the shaders compile.

const COMPUTE_PIPELINE_KEYS = [
    'flowComputePipeline',
    'particleComputePipeline',
];

const RENDER_PIPELINE_KEYS = [
    'scenePipeline',
    'particlePipeline',
    'postPipeline',
    'presentPipeline',
    'bloomPrefilterPipeline',
    'bloomDownPipeline',
    'bloomUpPipeline',
];

const PIPELINE_KEYS = [...COMPUTE_PIPELINE_KEYS, ...RENDER_PIPELINE_KEYS];

function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function makeDevice({ async = true, gate = null } = {}) {
    const created = [];
    const device = {
        limits: { maxTextureDimension2D: 8192 },
        createShaderModule: vi.fn((descriptor) => ({ label: descriptor.label })),
        createComputePipeline: vi.fn((descriptor) => ({ sync: true, label: descriptor.label })),
        createRenderPipeline: vi.fn((descriptor) => ({ sync: true, label: descriptor.label })),
        createTexture: vi.fn(() => ({ destroy() {} })),
        createSampler: vi.fn(() => ({})),
        destroy: vi.fn(),
        created,
    };
    if (async) {
        const make = (descriptor) => {
            const pipeline = { async: true, label: descriptor.label };
            created.push(pipeline);
            return gate ? gate.promise.then(() => pipeline) : Promise.resolve(pipeline);
        };
        device.createComputePipelineAsync = vi.fn(make);
        device.createRenderPipelineAsync = vi.fn(make);
    }
    return device;
}

// Every render pipeline rejects (a GPUPipelineError from the compile), once `gate` opens.
function failRenderPipelines(device, gate = null) {
    device.createRenderPipelineAsync = vi.fn(() => (gate ? gate.promise : Promise.resolve()).then(() => {
        throw new Error('GPUPipelineError');
    }));
}

function makeTheme(device) {
    const theme = Object.create(VoidEmberTheme.prototype);
    theme.buildVersion = 1;
    theme.webgpu = {
        device, sceneFormat: 'rgba16float', format: 'bgra8unorm',
    };
    return theme;
}

// readFlag (src/core/flags.js) reads `window.location.search`, then `window.localStorage`
// `serenity.<name>`; under node there is no window, so every flag reads its default.
function stubWindow({ search = '', storage = {} } = {}) {
    vi.stubGlobal('window', {
        location: { search },
        localStorage: { getItem: (key) => (key in storage ? storage[key] : null) },
    });
}

describe('VoidEmberTheme async pipeline creation', () => {
    const originalGpu = globalThis.navigator?.gpu;

    afterEach(() => {
        if (globalThis.navigator) {
            globalThis.navigator.gpu = originalGpu;
        }
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('creates every pipeline with the async variants and publishes them once all land', async () => {
        const gate = deferred();
        const device = makeDevice({ gate });
        const theme = makeTheme(device);

        const ready = theme.createPipelines();
        expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
        expect(device.createRenderPipelineAsync).toHaveBeenCalledTimes(7);
        expect(device.createComputePipeline).not.toHaveBeenCalled();
        expect(device.createRenderPipeline).not.toHaveBeenCalled();
        // Nothing is published while any compile is still in flight.
        expect(theme.webgpu.scenePipeline).toBeUndefined();

        gate.resolve();
        await expect(ready).resolves.toBe(true);
        for (const key of PIPELINE_KEYS) {
            // flowComputePipeline → 'void-ember/flow-compute-pipeline'
            const label = `void-ember/${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            expect(theme.webgpu[key], key).toMatchObject({ async: true, label });
        }
    });

    it('falls back to the synchronous creates when the device has no async variants', async () => {
        const device = makeDevice({ async: false });
        const theme = makeTheme(device);

        await expect(theme.createPipelines()).resolves.toBe(true);
        expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
        expect(device.createRenderPipeline).toHaveBeenCalledTimes(7);
        for (const key of PIPELINE_KEYS) {
            expect(theme.webgpu[key], key).toMatchObject({ sync: true });
        }
    });

    it('does not publish into a runtime whose device was replaced while compiling', async () => {
        const gate = deferred();
        const device = makeDevice({ gate });
        const theme = makeTheme(device);

        const ready = theme.createPipelines();
        const replacement = { device: makeDevice() };
        theme.webgpu = replacement;
        gate.resolve();

        await expect(ready).resolves.toBe(false);
        expect(replacement.scenePipeline).toBeUndefined();
    });

    it('a pipeline rejection propagates so initWebGPU falls back to 2D', async () => {
        const device = makeDevice();
        device.createRenderPipelineAsync = vi.fn(() => Promise.reject(new Error('GPUPipelineError')));
        const theme = makeTheme(device);

        await expect(theme.createPipelines()).rejects.toThrow('GPUPipelineError');
    });

    describe('rollback flags (src/core/flags.js readFlag)', () => {
        it.each([
            ['the ?themeWarmAsync=0 URL flag', { search: '?themeWarmAsync=0' }],
            ['the serenity.themeWarmAsync=0 localStorage flag', { storage: { 'serenity.themeWarmAsync': '0' } }],
        ])('%s rolls the render pipelines back to the sync creates; compute stays async', async (_label, win) => {
            stubWindow(win);
            const device = makeDevice();
            const theme = makeTheme(device);

            await expect(theme.createPipelines()).resolves.toBe(true);
            expect(device.createRenderPipeline).toHaveBeenCalledTimes(7);
            expect(device.createRenderPipelineAsync).not.toHaveBeenCalled();
            expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
            expect(device.createComputePipeline).not.toHaveBeenCalled();
            for (const key of RENDER_PIPELINE_KEYS) {
                expect(theme.webgpu[key], key).toMatchObject({ sync: true });
            }
            for (const key of COMPUTE_PIPELINE_KEYS) {
                expect(theme.webgpu[key], key).toMatchObject({ async: true });
            }
        });

        it.each([
            ['the ?syncComputePipelines=1 URL flag', { search: '?syncComputePipelines=1' }],
            [
                'the serenity.syncComputePipelines=1 localStorage flag',
                { storage: { 'serenity.syncComputePipelines': '1' } },
            ],
        ])('%s rolls the compute pipelines back to the sync creates; render stays async', async (_label, win) => {
            stubWindow(win);
            const device = makeDevice();
            const theme = makeTheme(device);

            await expect(theme.createPipelines()).resolves.toBe(true);
            expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
            expect(device.createComputePipelineAsync).not.toHaveBeenCalled();
            expect(device.createRenderPipelineAsync).toHaveBeenCalledTimes(7);
            expect(device.createRenderPipeline).not.toHaveBeenCalled();
            for (const key of COMPUTE_PIPELINE_KEYS) {
                expect(theme.webgpu[key], key).toMatchObject({ sync: true });
            }
            for (const key of RENDER_PIPELINE_KEYS) {
                expect(theme.webgpu[key], key).toMatchObject({ async: true });
            }
        });

        it('a window carrying neither flag keeps both kinds async', async () => {
            stubWindow({ search: '?theme=void-ember', storage: {} });
            const device = makeDevice();
            const theme = makeTheme(device);

            await expect(theme.createPipelines()).resolves.toBe(true);
            expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
            expect(device.createRenderPipelineAsync).toHaveBeenCalledTimes(7);
            expect(device.createComputePipeline).not.toHaveBeenCalled();
            expect(device.createRenderPipeline).not.toHaveBeenCalled();
        });
    });

    describe('buildsPipelinesAsync', () => {
        // ThemeManager checks `=== true` to let a loading surface keep its motion (ADR-0020).
        it('is true by default', () => {
            const theme = Object.create(VoidEmberTheme.prototype);
            expect(theme.buildsPipelinesAsync).toBe(true); // no window under node

            stubWindow();
            expect(theme.buildsPipelinesAsync).toBe(true);
        });

        it.each([
            ['the ?themeWarmAsync=0 URL flag', { search: '?themeWarmAsync=0' }],
            ['the serenity.themeWarmAsync=0 localStorage flag', { storage: { 'serenity.themeWarmAsync': '0' } }],
        ])('is false under %s', (_label, win) => {
            stubWindow(win);
            const theme = Object.create(VoidEmberTheme.prototype);
            expect(theme.buildsPipelinesAsync).toBe(false);
        });
    });

    describe('initWebGPU', () => {
        function installGpu(device) {
            const adapter = {
                features: { has: () => false },
                requestDevice: vi.fn(async () => device),
            };
            if (!globalThis.navigator) {
                Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
            }
            globalThis.navigator.gpu = {
                requestAdapter: vi.fn(async () => adapter),
                getPreferredCanvasFormat: () => 'bgra8unorm',
            };
        }

        function makeInitTheme() {
            const theme = Object.create(VoidEmberTheme.prototype);
            theme.buildVersion = 1;
            theme.webgpu = { device: null };
            const contexts = []; // one per initWebGPU, in call order
            theme.canvas = {
                contexts,
                getContext: vi.fn(() => {
                    const context = { configure: vi.fn(), unconfigure: vi.fn() };
                    contexts.push(context);
                    return context;
                }),
            };
            theme.createOrResizeResources = vi.fn();
            theme.setupTimestampQuery = vi.fn();
            theme.setupRendererResilience = vi.fn();
            return theme;
        }

        it('finishes setup only after the async pipelines land', async () => {
            const gate = deferred();
            const device = makeDevice({ gate });
            installGpu(device);
            const theme = makeInitTheme();

            const init = theme.initWebGPU(1);
            await vi.waitFor(() => expect(device.createRenderPipelineAsync).toHaveBeenCalled());
            expect(theme.createOrResizeResources).not.toHaveBeenCalled();
            expect(theme.renderBackend).not.toBe('webgpu');

            gate.resolve();
            await expect(init).resolves.toBe(true);
            expect(theme.createOrResizeResources).toHaveBeenCalledTimes(1);
            expect(theme.renderBackend).toBe('webgpu');
            expect(device.destroy).not.toHaveBeenCalled();
        });

        it('a stop() during the compile orphans the device: destroyed, runtime cleared, false', async () => {
            const gate = deferred();
            const device = makeDevice({ gate });
            installGpu(device);
            const theme = makeInitTheme();

            const init = theme.initWebGPU(1);
            await vi.waitFor(() => expect(device.createRenderPipelineAsync).toHaveBeenCalled());
            theme.buildVersion += 1; // what stop() and createScene() do
            gate.resolve();

            await expect(init).resolves.toBe(false);
            expect(device.destroy).toHaveBeenCalledTimes(1);
            expect(theme.webgpu.device).toBeNull();
            expect(theme.createOrResizeResources).not.toHaveBeenCalled();
            expect(theme.renderBackend).not.toBe('webgpu');
        });

        describe('when the pipelines reject', () => {
            it('a current build falls back to 2D: false, teardownGPUResources releases its runtime', async () => {
                const device = makeDevice();
                failRenderPipelines(device);
                installGpu(device);
                const theme = makeInitTheme();
                const teardown = vi.spyOn(theme, 'teardownGPUResources');
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

                await expect(theme.initWebGPU(1)).resolves.toBe(false);

                expect(teardown).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledWith(expect.stringContaining('WebGPU init failed'), expect.any(Error));
                const [context] = theme.canvas.contexts;
                expect(context.unconfigure).toHaveBeenCalledTimes(1);
                expect(device.destroy).toHaveBeenCalledTimes(1);
                expect(theme.webgpu).toMatchObject({ device: null, context: null, scenePipeline: null });
                expect(theme.createOrResizeResources).not.toHaveBeenCalled();
                expect(theme.renderBackend).not.toBe('webgpu');
            });

            it('a stale build releases only its own device once a newer build owns the runtime', async () => {
                const gate = deferred();
                const staleDevice = makeDevice();
                failRenderPipelines(staleDevice, gate);
                installGpu(staleDevice);
                const theme = makeInitTheme();
                const removeResilience = vi.spyOn(theme, 'removeRendererResilience');
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

                const staleInit = theme.initWebGPU(1);
                await vi.waitFor(() => expect(staleDevice.createRenderPipelineAsync).toHaveBeenCalled());

                // createScene() rebuilds while the stale shaders compile: the newer build lands first.
                theme.buildVersion += 1;
                const newDevice = makeDevice();
                installGpu(newDevice);
                await expect(theme.initWebGPU(theme.buildVersion)).resolves.toBe(true);
                const newer = theme.webgpu;
                const [staleContext, newContext] = theme.canvas.contexts;
                expect(newer.device).toBe(newDevice);
                expect(newer.context).toBe(newContext);

                gate.resolve(); // now the stale build's compile fails
                await expect(staleInit).resolves.toBe(false);

                expect(staleDevice.destroy).toHaveBeenCalledTimes(1);
                // The newer build's runtime is untouched: same state object, device, context,
                // pipelines, and its device-loss monitor.
                expect(theme.webgpu).toBe(newer);
                expect(theme.webgpu.device).toBe(newDevice);
                expect(theme.webgpu.context).toBe(newContext);
                expect(theme.webgpu.scenePipeline).toMatchObject({ async: true });
                expect(newDevice.destroy).not.toHaveBeenCalled();
                expect(newContext.unconfigure).not.toHaveBeenCalled();
                expect(staleContext).not.toBe(newContext);
                expect(removeResilience).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
                expect(theme.renderBackend).toBe('webgpu');
            });

            it('a stale build that still owns the runtime resets it and destroys its device once', async () => {
                const gate = deferred();
                const device = makeDevice();
                failRenderPipelines(device, gate);
                installGpu(device);
                const theme = makeInitTheme();
                vi.spyOn(console, 'warn').mockImplementation(() => {});

                const init = theme.initWebGPU(1);
                await vi.waitFor(() => expect(device.createRenderPipelineAsync).toHaveBeenCalled());
                const inFlight = theme.webgpu;
                expect(inFlight.device).toBe(device);
                // stop(): renderBackend is not 'webgpu' yet, so its teardownRuntime leaves
                // this.webgpu (holding the in-flight device) in place.
                theme.buildVersion += 1;
                gate.resolve();

                await expect(init).resolves.toBe(false);
                expect(device.destroy).toHaveBeenCalledTimes(1);
                expect(theme.webgpu).not.toBe(inFlight);
                expect(theme.webgpu).toMatchObject({ device: null, context: null, scenePipeline: null });
                expect(theme.createOrResizeResources).not.toHaveBeenCalled();
                expect(theme.renderBackend).not.toBe('webgpu');
            });
        });
    });
});
