import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import WinterTheme from '../../src/themes/winter/winter-theme.js';
import StarlightTheme from '../../src/themes/starlight/starlight-theme.js';
import { BaseTheme } from '../../src/themes/base-theme.js';

const rendererMocks = vi.hoisted(() => ({ instances: [], initialize: null }));

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
                    : { isWebGPUBackend: true };
                this.domElement = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
                this.init = vi.fn(async () => rendererMocks.initialize?.(this));
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                this.setClearColor = vi.fn();
                this.compute = vi.fn();
                rendererMocks.instances.push(this);
            }
        },
    };
});

function themeReady(Theme) {
    const theme = new Theme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
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
    rendererMocks.instances.length = 0;
    rendererMocks.initialize = null;
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 3,
        location: { search: '' },
        addEventListener: vi.fn(),
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

describe.each([
    ['Winter', WinterTheme, 'initRenderer'],
    ['Starlight', StarlightTheme, '_initRenderer'],
])('%s node renderer fallback', (_name, Theme, initMethod) => {
    it('retains the automatic WebGL2 node backend', async () => {
        rendererMocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = themeReady(Theme);

        expect(await theme[initMethod]({ appendChild: vi.fn() })).toBe(true);
        expect(rendererMocks.instances).toHaveLength(1);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
    });

    it('uses a fresh forced-WebGL2 candidate after native initialization rejects', async () => {
        rendererMocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('adapter request failed');
        };
        const theme = themeReady(Theme);

        expect(await theme[initMethod]({ appendChild: vi.fn() })).toBe(true);
        expect(rendererMocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(rendererMocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(rendererMocks.instances[0], { nullInstance: false });
    });
});

describe('Winter node WebGL2 scene', () => {
    it.each([false, true])('registers context recovery with actual native capability %s', async (native) => {
        const device = { label: 'winter-test-device' };
        rendererMocks.initialize = (renderer) => {
            renderer.backend = native ? { isWebGPUBackend: true, device } : { isWebGLBackend: true };
        };
        const theme = themeReady(WinterTheme);

        await theme.initRenderer({ appendChild: vi.fn() });

        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: native ? device : null,
        });
    });

    it('retires Winter context monitors exactly once when stopping or stopping again', () => {
        const theme = new WinterTheme();
        const unmonitor = vi.fn();
        theme._resilienceUnsubs = [unmonitor];
        vi.spyOn(BaseTheme.prototype, 'stop').mockImplementation(() => {});

        theme.stop();
        theme.stop();

        expect(unmonitor).toHaveBeenCalledOnce();
        expect(theme._resilienceUnsubs).toBeNull();
    });

    it('keeps diagnostic sky/moon materials and post compatible with the node renderer', async () => {
        rendererMocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = themeReady(WinterTheme);
        await theme.initRenderer({ appendChild: vi.fn() });

        theme.createSkyBackground();
        theme.createMoon();
        theme.setupPostProcessing();

        const materials = [];
        theme.scene.traverse((object) => {
            if (object.material) {
                const list = Array.isArray(object.material) ? object.material : [object.material];
                materials.push(...list);
            }
        });
        expect(materials.length).toBeGreaterThan(2);
        expect(materials.every((material) => material.isNodeMaterial === true)).toBe(true);
        expect(theme.composer).toBeNull();
        expect(theme.post.useMRT).toBe(false);
        expect(theme.snowCompute).toBeNull();
        theme.post.dispose();
    });
});
