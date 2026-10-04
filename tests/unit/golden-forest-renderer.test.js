import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import GoldenForestTheme from '../../src/themes/golden-forest/golden-forest-theme.js';

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
                this.shadowMap = {};
                this.init = vi.fn(async () => mocks.initialize?.(this));
                this.compute = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                this.getPixelRatio = () => 1;
                this.render = vi.fn();
                mocks.instances.push(this);
            }
        },
    };
});

function runtime() {
    const theme = new GoldenForestTheme();
    theme.isActive = true;
    theme.applyQualityPreset('High');
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.PerspectiveCamera(55, 390 / 844, 0.1, 800);
    theme.camera.position.set(0, 8, 30);
    theme.mainGroup = new THREE.Group();
    theme.scene.add(theme.mainGroup);
    vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(1);
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'registerContainer').mockImplementation(() => {});
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        try { await renderer.init(); } catch (error) {
            await theme.disposeRenderer(renderer, { nullInstance: false });
            throw error;
        }
        return renderer;
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
    vi.stubGlobal('navigator', { gpu: {}, userAgent: 'Android' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Golden Forest modern compatibility renderer', () => {
    const backends = ['missing WebGPU', 'forced WebGL2', 'automatic WebGL2 backend'];
    it.each(backends)('keeps the golden lake, forest atmosphere and birds for %s', async (reason) => {
        if (reason === 'missing WebGPU') vi.stubGlobal('navigator', {});
        if (reason === 'automatic WebGL2 backend') {
            mocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        }
        const theme = runtime();
        theme.flags.forceWebGL = reason === 'forced WebGL2';
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(mocks.instances).toHaveLength(1);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer);
        expect(theme.flags).toMatchObject({ usePost: true, useCompute: false, useMRT: false });
        theme.flags.forceMRT = true;
        theme.updateFeatureFlags();
        expect(theme.flags.useMRT).toBe(false);
        theme.createSkyDome();
        theme.createHazeLayers();
        theme.createForestFloor();
        theme.createLake();
        theme.createShoreFoam();
        theme.createFireflySystem();
        theme.onPieceLock();
        expect(theme.fireflyBoostUniform.value).toBe(1);
        expect(theme.fireflyInstancedMesh.count).toBe(theme.qualityPreset.fireflyCount);
        await theme.initBirds();
        theme.applyReflectionLayer();
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(7);
        expect(materials.every((material) => material.isNodeMaterial)).toBe(true);
        expect(theme.waterReflection).toBeTruthy();
        expect(theme.lakeMesh.layers.isEnabled(2)).toBe(false);
        expect(theme.skyDome.layers.isEnabled(2)).toBe(true);
        expect(theme.birds.mesh.count).toBe(theme.qualityPreset.birdCount);
        expect(theme.birds.gpuCompute).toBeNull();
        expect(theme.birds.birdCompute).toBeNull();
        theme.birds.update(8, 1 / 60);
        expect(theme.birds.compatibilityTime.value).toBe(8);
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        theme.setupPostProcessing();
        expect(theme.postComposer.useMRT).toBe(false);
        expect(theme.postComposer.uExposure.value).toBe(0.97);
        theme.disposePostProcessing();
        theme.birds.dispose();
        theme.waterReflection.dispose();
        theme.scene.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    });

    it('retries native initialization on a fresh node WebGL2 renderer', async () => {
        mocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Device unavailable');
        };
        const theme = runtime();
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    const tiers = [['Minimal', 0, false], ['Low', 64, false], ['Medium', 128, true]];
    it.each(tiers)('preserves %s tier budgets', async (quality, count, post) => {
        const theme = runtime();
        theme.applyQualityPreset(quality);
        theme.flags.forceWebGL = true;
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.flags.usePost).toBe(post);
        expect(theme.flags.useCompute).toBe(false);
        await theme.initBirds();
        expect(theme.birds?.mesh?.count ?? 0).toBe(count);
        theme.birds?.dispose();
    });

    it('keeps native capabilities and retires stale initialization', async () => {
        const theme = runtime();
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.flags.useCompute).toBe(true);
        theme.flags.forceMRT = true;
        theme.updateFeatureFlags();
        expect(theme.flags.useMRT).toBe(true);
        const stale = runtime();
        mocks.initialize = () => { stale.lifecycleGeneration += 1; };
        const container = { appendChild: vi.fn() };
        expect(await stale.initRenderer(container)).toBe(false);
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(stale.disposeRenderer).toHaveBeenCalled();
    });
});
