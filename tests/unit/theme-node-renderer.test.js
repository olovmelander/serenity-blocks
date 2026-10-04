import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { initializeThemeNodeRenderer } from '../../src/themes/shared/node-renderer.js';

const state = vi.hoisted(() => ({ renderers: [] }));
vi.mock('three/webgpu', () => ({
    WebGPURenderer: class {
        constructor(options) {
            this.options = options;
            this.domElement = {};
            this.isWebGPURenderer = true;
            this.backend = options.forceWebGL ? { isWebGLBackend: true } : { isWebGPUBackend: true };
            state.renderers.push(this);
        }
    },
}));

const makeOwner = () => ({
    name: 'test-theme',
    lifecycleGeneration: 4,
    isActive: true,
    cleanupComplete: false,
    initializeRendererCandidate: vi.fn(async (renderer) => renderer),
    disposeRenderer: vi.fn(),
});
beforeEach(() => {
    state.renderers.length = 0;
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('navigator', { gpu: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('shared node renderer initialization', () => {
    const forcedCases = [['missing WebGPU', '', false], ['forced WebGL2', '?forceWebGL=1', true]];
    it.each(forcedCases)('uses the same node renderer with %s', async (_label, search, hasGPU) => {
        window.location.search = search;
        vi.stubGlobal('navigator', hasGPU ? { gpu: {} } : {});
        const owner = makeOwner();
        const renderer = await initializeThemeNodeRenderer(owner, { alpha: false });
        expect(renderer.isWebGPURenderer).toBe(true);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(state.renderers).toHaveLength(1);
        expect(owner.disposeRenderer).not.toHaveBeenCalled();
    });
    it('retains successful automatic fallback without disposing its canvas', async () => {
        const owner = makeOwner();
        owner.initializeRendererCandidate.mockImplementation(async (renderer) => {
            renderer.backend = { isWebGLBackend: true };
        });
        const renderer = await initializeThemeNodeRenderer(owner, {});
        expect(renderer).toBe(state.renderers[0]);
        expect(owner.disposeRenderer).not.toHaveBeenCalled();
    });
    it('uses a fresh canvas and bounded forced candidate after native failure', async () => {
        const owner = makeOwner();
        owner.initializeRendererCandidate.mockRejectedValueOnce(new Error('adapter failed'));
        const renderer = await initializeThemeNodeRenderer(owner, {}, { timeoutMs: 1500 });
        expect(state.renderers).toHaveLength(2);
        expect(renderer.domElement).not.toBe(state.renderers[0].domElement);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(owner.initializeRendererCandidate).toHaveBeenLastCalledWith(
            renderer,
            expect.objectContaining({ timeoutMs: 1500, ownerGeneration: 4 }),
        );
    });
    it('does not construct a retry after the owner stops', async () => {
        const owner = makeOwner();
        owner.initializeRendererCandidate.mockImplementation(async () => {
            owner.isActive = false;
            throw new Error('cancelled');
        });
        expect(await initializeThemeNodeRenderer(owner, {})).toBeNull();
        expect(state.renderers).toHaveLength(1);
    });
    it('surfaces an unavailable forced WebGL2 backend', async () => {
        window.location.search = '?forceWebGL=1';
        const owner = makeOwner();
        owner.initializeRendererCandidate.mockRejectedValue(new Error('WebGL2 unavailable'));
        await expect(initializeThemeNodeRenderer(owner, {})).rejects.toThrow('WebGL2 unavailable');
        expect(state.renderers).toHaveLength(1);
    });
});
