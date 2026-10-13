import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import MoonlitForestTheme from '../../src/themes/moonlit-forest/moonlit-forest-theme.js';

const state = vi.hoisted(() => ({ instances: [], initialize: null }));
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

describe('portable theme renderer selection', () => {
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
});
