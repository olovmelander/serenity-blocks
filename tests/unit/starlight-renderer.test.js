import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import StarlightTheme from '../../src/themes/starlight/starlight-theme.js';

// Winter shared this file while it had an `initRenderer` of its own. Since its rebuild it starts
// its renderer the way the other rebuilt themes do, and the same coverage (the automatic WebGL2
// backend, the fresh forced-WebGL2 candidate, the recovery registration, monitors retired once,
// node materials only) lives in winter-theme.test.js.

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
