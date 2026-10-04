import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

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
                this.domElement = {
                    style: {},
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                };
                this.outputColorSpace = actual.SRGBColorSpace;
                this.init = vi.fn(async () => rendererMocks.initialize?.(this));
                this.compute = vi.fn();
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                rendererMocks.instances.push(this);
            }
        },
    };
});

function createTheme(quality = 'High') {
    const theme = new WolfhourTheme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    theme.applyQualityPreset(quality);
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

describe('Wolfhour renderer backend parity', () => {
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

    it.each([
        ['browser without WebGPU', false, false],
        ['explicit WebGL2 fallback', true, true],
    ])('keeps the node renderer for a %s', async (_label, hasGPU, forceWebGL) => {
        vi.stubGlobal('navigator', hasGPU ? { gpu: {} } : {});
        const theme = createTheme('Low');
        theme.flags.forceWebGL = forceWebGL;
        const container = { appendChild: vi.fn() };

        expect(await theme.initRenderer(container)).toBe(true);
        expect(rendererMocks.instances).toHaveLength(1);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.isWebGL).toBe(true);
        expect(theme.capabilities).toMatchObject({
            supportsPost: true,
            supportsCompute: false,
            supportsMRT: false,
        });
        expect(theme.flags.useCompute).toBe(false);
        expect(theme.flags.useMRT).toBe(false);
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
    });

    it('retains the node renderer when native adapter acquisition falls back to WebGL2', async () => {
        rendererMocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = createTheme();

        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(rendererMocks.instances).toHaveLength(1);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGL).toBe(true);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
        expect(theme.flags.usePost).toBe(true);
        expect(theme.flags.useCompute).toBe(false);
        expect(theme.flags.useMRT).toBe(false);
    });

    it('retries a failed native renderer with the node WebGL2 backend', async () => {
        rendererMocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Native device unavailable');
        };
        const theme = createTheme();

        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(rendererMocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(rendererMocks.instances[0], { nullInstance: false });
        expect(theme.renderer).toBe(rendererMocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.capabilities.supportsCompute).toBe(false);
    });

    it('preserves native WebGPU capabilities on desktop', async () => {
        const theme = createTheme();

        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.renderer.options.forceWebGL).toBe(false);
        expect(theme.isWebGPU).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.flags.useCompute).toBe(true);
        expect(theme.flags.useMRT).toBe(true);
        expect(theme.flags.usePost).toBe(true);
    });

    it('does not append a late renderer after the theme loses lifecycle ownership', async () => {
        const theme = createTheme();
        rendererMocks.initialize = () => { theme.lifecycleGeneration += 1; };
        const container = { appendChild: vi.fn() };

        expect(await theme.initRenderer(container)).toBe(false);
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(rendererMocks.instances[0], { nullInstance: false });
    });
});
