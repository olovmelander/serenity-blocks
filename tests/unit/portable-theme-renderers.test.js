import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import OceanTheme from '../../src/themes/ocean/ocean-theme.js';
import LuminousTidesTheme from '../../src/themes/luminous-tides/luminous-tides-theme.js';
import MoonlitForestTheme from '../../src/themes/moonlit-forest/moonlit-forest-theme.js';
import { OceanPost } from '../../src/themes/ocean/ocean-post.js';

const state = vi.hoisted(() => ({ instances: [], initialize: null }));
vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({
    disposeOceanGltfCache: vi.fn(), loadGltfCached: vi.fn(),
}));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL ? { isWebGLBackend: true } : { isWebGPUBackend: true };
                this.capabilities = { maxColorAttachments: 8 };
                this.shadowMap = {};
                this.domElement = { style: {} };
                this.init = vi.fn(async () => state.initialize?.(this));
                this.compute = vi.fn();
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                state.instances.push(this);
            }
        },
    };
});

function createTheme(Theme) {
    const theme = new Theme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    theme.applyQualityPreset('High');
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
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
    state.instances.length = 0;
    state.initialize = null;
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 3,
        location: { search: '' },
        settings: { effectQuality: 'Low' },
    });
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    vi.stubGlobal('navigator', { gpu: {} });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const themes = [
    ['Ocean', OceanTheme],
];

describe('portable theme renderer selection', () => {
    it.each(themes)('initializes a node renderer directly when WebGPU is absent (%s)', async (_label, Theme) => {
        vi.stubGlobal('navigator', {});
        const theme = createTheme(Theme);
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(state.instances).toHaveLength(1);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it('retains the Moonlit Forest automatic WebGL2 candidate', async () => {
        state.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = new MoonlitForestTheme();
        theme.isActive = true;
        theme.cleanupComplete = false;
        vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
        vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
        vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
            await renderer.init();
            return renderer;
        });
        expect(await theme.initRenderer({ appendChild: vi.fn() }, theme.runtimeGeneration)).toBe(true);
        expect(state.instances).toHaveLength(1);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
        expect(theme.renderer.isWebGPURenderer).toBe(true);
        expect(theme.isWebGPU).toBe(false);
    });

    it.each(themes)('retains automatic WebGL2 fallback and modern materials (%s)', async (_label, Theme) => {
        state.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = createTheme(Theme);
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(state.instances).toHaveLength(1);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.currentQuality || theme.activeQualityLevel || theme.currentQualityName).toBe('High');
    });

    it.each(themes)('retries failed GPU init on a fresh node WebGL2 renderer (%s)', async (_label, Theme) => {
        state.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Adapter unavailable');
        };
        const theme = createTheme(Theme);
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(state.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it.each(themes)('preserves the native renderer when available (%s)', async (_label, Theme) => {
        const theme = createTheme(Theme);
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(state.instances).toHaveLength(1);
        expect(theme.isWebGPU).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
    });
});

describe('portable bloom pipelines', () => {
    it('keeps Ocean node post on WebGL2 while rejecting MRT', () => {
        const renderer = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
        const post = new OceanPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), { useMRT: true });
        expect(post.useMRT).toBe(false);
        expect(post.postProcessing?.isRenderPipeline).toBe(true);
        expect(post.bloomNode).toBeTruthy();
        post.dispose();
    });
});

describe('selected theme effect quality', () => {
    it.each([['Luminous Tides', LuminousTidesTheme]])('reads the actual settings quality before the legacy alias (%s)', (_name, Theme) => {
        window.settings.graphicsQuality = 'Extreme';
        expect(Theme.prototype.getCurrentQualityLevel.call({})).toBe('Low');
        window.settings.effectQuality = 'Medium';
        expect(Theme.prototype.getCurrentQualityLevel.call({})).toBe('Medium');
        delete window.settings.effectQuality;
        expect(Theme.prototype.getCurrentQualityLevel.call({})).toBe('Extreme');
    });
});
