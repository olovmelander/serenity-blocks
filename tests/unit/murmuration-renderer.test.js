import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import MurmurationTheme from '../../src/themes/murmuration/murmuration-theme.js';
import { initializeThemeNodeRenderer } from '../../src/themes/shared/node-renderer.js';
import { FLUID_BUDGETS, NATIVE_FLUID_COUNTS } from '../../src/themes/murmuration/sim/fluid-particles.js';

vi.mock('../../src/themes/shared/node-renderer.js', () => ({ initializeThemeNodeRenderer: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Murmuration portable hero composition', () => {
    // WebGL2 steps the swarm on the CPU and keeps the CPU budget; WebGPU compute carries the native count.
    it.each([
        [false, 'Low', FLUID_BUDGETS.Low.count],
        [false, 'High', FLUID_BUDGETS.High.count],
        [true, 'High', NATIVE_FLUID_COUNTS.High],
    ])('keeps the selected %s/%s hero and post (%s particles)', async (native, quality, count) => {
        const container = {
            appendChild: vi.fn(), classList: { remove: vi.fn() }, style: { removeProperty: vi.fn() },
        };
        vi.stubGlobal('window', {
            innerWidth: 390,
            innerHeight: 844,
            devicePixelRatio: 3,
            settings: { effectQuality: quality },
            location: { search: '' },
        });
        vi.stubGlobal('document', { getElementById: () => container, querySelectorAll: () => [] });
        const renderer = {
            isWebGPURenderer: true,
            backend: native ? { isWebGPUBackend: true } : { isWebGLBackend: true },
            domElement: {},
            setPixelRatio: vi.fn(),
            setSize: vi.fn(),
            compute: vi.fn(),
        };
        initializeThemeNodeRenderer.mockResolvedValue(renderer);
        const theme = new MurmurationTheme();
        theme.isActive = true;
        theme._computeFailedOnce = true;
        vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
        vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
        vi.spyOn(theme, '_setupEventListeners').mockImplementation(() => {});
        vi.spyOn(theme, '_setupResize').mockImplementation(() => {});
        vi.spyOn(theme, '_startAnimation').mockImplementation(() => {});
        await theme.init();
        await theme.createScene();
        expect(theme.renderer).toBe(renderer);
        expect(theme.fluidSim.count).toBe(count);
        expect(theme.fluidSim.isCPU).toBe(!native);
        expect(Boolean(theme.fluidSim.computeNode)).toBe(native);
        expect(theme.fluidRenderer.mesh.material.isNodeMaterial).toBe(true);
        expect(theme.postPipeline.isEnabled()).toBe(true);
        expect(theme.postPipeline.mrtEnabled).toBe(native);
        expect(theme._computeFailedOnce).toBe(false);
        expect(renderer.setPixelRatio).toHaveBeenCalledWith(theme.getEffectivePixelRatio(2));
        expect(container.appendChild).toHaveBeenCalledWith(renderer.domElement);
        theme.stop();
    });
});
