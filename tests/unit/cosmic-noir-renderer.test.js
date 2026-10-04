import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import CosmicNoirTheme from '../../src/themes/cosmic-noir/cosmic-noir-theme.js';

const mocks = vi.hoisted(() => ({ instances: [], initialize: null }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL
                    ? { isWebGLBackend: true }
                    : { isWebGPUBackend: true, device: { limits: { maxColorAttachments: 4 } } };
                this.domElement = { style: {} };
                this.init = vi.fn(async () => mocks.initialize?.(this));
                this.compute = vi.fn();
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                this.getPixelRatio = () => 1;
                this.clear = vi.fn();
                this.render = vi.fn();
                this.onDeviceLost = vi.fn();
                mocks.instances.push(this);
            }
        },
    };
});

function runtime() {
    const theme = new CosmicNoirTheme();
    theme.isActive = true;
    theme.applyQualityPreset('High');
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'configurePerformanceInstrumentation').mockImplementation(() => {});
    vi.spyOn(theme, 'getRendererPixelRatio').mockReturnValue(1);
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        try {
            await renderer.init();
            return renderer;
        } catch (error) {
            await theme.disposeRenderer(renderer, { nullInstance: false });
            throw error;
        }
    });
    return theme;
}

beforeEach(() => {
    mocks.instances.length = 0;
    mocks.initialize = null;
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 3,
        location: { search: '' },
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { gpu: {} });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Cosmic Noir node renderer compatibility', () => {
    it.each(['missing WebGPU', 'forced WebGL2', 'automatic WebGL2 backend'])(
        'retains modern materials and post for %s without enabling compute or MRT',
        async (reason) => {
            if (reason === 'missing WebGPU') vi.stubGlobal('navigator', {});
            if (reason === 'automatic WebGL2 backend') {
                mocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
            }
            const theme = runtime();
            theme.flags.forceWebGL = reason === 'forced WebGL2';
            expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
            theme.probeCapabilities();
            theme.updateCapabilityFlags();
            expect(mocks.instances).toHaveLength(1);
            expect(theme.usesNodeMaterials).toBe(true);
            expect(theme.isWebGPU).toBe(false);
            expect(theme.flags).toMatchObject({ usePost: true, useCompute: false, useMRT: false });

            vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
            theme.createStarfield();
            theme.createNebulaClouds();
            theme.createAmbientDust();
            theme.createPlanet();
            theme.createAtmosphere();
            theme.createVoidSparks();
            theme.createGasSwirlParticles();
            const wave = theme.acquireCosmicWave({ radius: 288, tube: 1.3 });
            const materials = [];
            theme.scene.traverse((object) => {
                if (object.material) materials.push(object.material);
            });
            expect(materials.length).toBeGreaterThan(10);
            expect(materials.every((material) => material.isNodeMaterial === true)).toBe(true);
            expect(theme.sparkCompute).toBeNull();
            expect(theme.unifiedSparkData.count).toBeGreaterThan(0);
            theme.setupPostProcessing();
            theme.normalizeRuntimeFeatureFlags();
            expect(theme.postProcessing.useMRT).toBe(false);
            expect(theme.postProcessing.uLensingStrength.value).toBeGreaterThan(0);
            const render = vi.spyOn(theme.postProcessing, 'render').mockImplementation(() => {});
            theme.renderFrame();
            expect(render).toHaveBeenCalledOnce();
            expect(theme.renderer.compute).not.toHaveBeenCalled();
            theme.releaseCosmicWave(wave);
            theme.disposeRuntimeResources({ removeCanvas: false });
        },
    );

    it('retries a native initialization failure on the node WebGL2 backend', async () => {
        const theme = runtime();
        mocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Device unavailable');
        };
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it.each([false, true])('safely ignores late backend loss after disposal (forceWebGL=%s)', async (forceWebGL) => {
        const theme = runtime();
        theme.flags.forceWebGL = forceWebGL;
        const handleDeviceLoss = vi.spyOn(theme, 'handleDeviceLoss').mockImplementation(() => {});
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        const { renderer } = theme;
        const liveCallback = renderer.onDeviceLost;
        if (!forceWebGL) {
            liveCallback({ api: 'WebGPU' });
            expect(handleDeviceLoss).toHaveBeenCalledOnce();
            handleDeviceLoss.mockClear();
        }

        theme.disposeRendererResources(false);
        expect(renderer.onDeviceLost).toBeTypeOf('function');
        expect(renderer.onDeviceLost).not.toBe(liveCallback);
        expect(() => renderer.onDeviceLost({ api: forceWebGL ? 'WebGL' : 'WebGPU' })).not.toThrow();
        expect(handleDeviceLoss).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
    });

    it('keeps native capabilities and retires initialization after lifecycle invalidation', async () => {
        const theme = runtime();
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        theme.probeCapabilities();
        theme.updateCapabilityFlags();
        expect(theme.flags.usePost).toBe(true);
        expect(theme.capabilities.supportsCompute).toBe(true);
        expect(theme.capabilities.maxColorAttachments).toBe(4);

        const stale = runtime();
        mocks.initialize = () => { stale.lifecycleGeneration += 1; };
        const container = { appendChild: vi.fn() };
        expect(await stale.initRenderer(container)).toBe(false);
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(stale.disposeRenderer).toHaveBeenCalled();
    });
});
