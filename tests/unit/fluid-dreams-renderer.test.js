import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import FluidDreamsTheme from '../../src/themes/fluid-dreams/fluid-dreams-theme.js';
import { FluidDreamsPost } from '../../src/themes/fluid-dreams/fluid-dreams-post.js';

const mocks = vi.hoisted(() => ({ instances: [], initialize: null }));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL ? { isWebGLBackend: true } : { isWebGPUBackend: true };
                this.domElement = {};
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

function runtime(quality = 'Low') {
    const theme = new FluidDreamsTheme();
    theme.isActive = true;
    theme.applyQualityPreset(quality);
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 1000);
    vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(1);
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
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
    vi.stubGlobal('navigator', { gpu: {} });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Fluid Dreams modern compatibility renderer', () => {
    const backends = ['missing WebGPU', 'forced WebGL2', 'automatic WebGL2 backend'];
    it.each(backends)('keeps the fluid hero, haze, post and reactive motes for %s', async (reason) => {
        if (reason === 'missing WebGPU') vi.stubGlobal('navigator', {});
        if (reason === 'forced WebGL2') window.location.search = '?forceWebGL=1';
        if (reason === 'automatic WebGL2 backend') {
            mocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        }
        const theme = runtime();
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(mocks.instances).toHaveLength(1);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer);
        theme.initMetaballState();
        theme.createBackground();
        theme.createHaze();
        theme.createHero();
        theme.createParticles();
        theme.setupPostProcessing();
        for (const material of [theme.backgroundMaterial, theme.hazeMaterial,
            theme.heroMaterial, theme.particleMaterial]) expect(material.isNodeMaterial).toBe(true);
        expect(theme.fallbackOrbs).toHaveLength(0);
        expect(theme.particleSystem.count).toBe(2500);
        expect(theme.particleCompute).toBeNull();
        expect(theme.post.useMRT).toBe(false);
        theme.onPieceLock();
        theme.onLineClear(4);
        theme.onCombo(5);
        theme.updateShockwave(0.1);
        expect(theme.targetParticleColorMix).toBeGreaterThan(0);
        expect(theme.heroMaterial.userData.uShockwaveStrength.value).toBeGreaterThan(0);
        const render = vi.spyOn(theme.post, 'render').mockImplementation(() => {});
        theme.renderFrame(8);
        expect(render).toHaveBeenCalledOnce();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        theme.post.dispose();
        theme.disposeParticles();
        theme.disposeHero();
        theme.disposeHaze();
        theme.backgroundMaterial.dispose();
        theme.backgroundMesh.geometry.dispose();
    });

    it('retries native initialization failure without changing renderer kind', async () => {
        mocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('GPU device unavailable');
        };
        const theme = runtime();
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('ignores an MRT request on a node WebGL2 post pipeline', () => {
        const post = new FluidDreamsPost(
            { isWebGPURenderer: true, backend: { isWebGLBackend: true } },
            new THREE.Scene(),
            new THREE.PerspectiveCamera(),
            { useMRT: true },
        );
        expect(post.useMRT).toBe(false);
        post.dispose();
    });

    it('retains native particle budgets and retires stale initialization', async () => {
        const theme = runtime('High');
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        theme.createParticles();
        expect(theme.particleSystem.count).toBe(9000);
        expect(theme.particleCompute.computeNode).toBeTruthy();
        theme.disposeParticles();
        const stale = runtime();
        mocks.initialize = () => { stale.lifecycleGeneration += 1; };
        const container = { appendChild: vi.fn() };
        expect(await stale.initRenderer(container)).toBe(false);
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(stale.disposeRenderer).toHaveBeenCalled();
    });
});
