import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import SpringTheme from '../../src/themes/spring/spring-theme.js';

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
    it('retains the Spring automatic WebGL2 candidate', async () => {
        // A GPU is offered, but the node renderer settles on its own WebGL2 backend during init.
        state.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = new SpringTheme();
        theme.isActive = true;
        theme.cleanupComplete = false;
        vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
        vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
            await renderer.init();
            return renderer;
        });
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(state.instances).toHaveLength(1);
        expect(renderer).toBe(state.instances[0]);
        expect(renderer.options.forceWebGL).toBe(false); // the automatic candidate, not a forced retry
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
        expect(renderer.isWebGPURenderer).toBe(true);
        // createScene records the backend the candidate settled on: WebGL2, so not WebGPU.
        expect(renderer.backend.isWebGPUBackend === true).toBe(false);
    });
});
