import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { SwarmPostPipeline } from '../../src/themes/murmuration/post/render-pipeline.js';
import MurmurationTheme from '../../src/themes/murmuration/murmuration-theme.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const pipelines = [['Murmuration', SwarmPostPipeline]];
describe.each(pipelines)('%s common node post', (_label, Pipeline) => {
    it.each([false, true])('keeps post on GL2 and native while isolating MRT (native=%s)', (native) => {
        const renderer = {
            isWebGPURenderer: true,
            backend: native ? { isWebGPUBackend: true } : { isWebGLBackend: true },
        };
        const pipeline = new Pipeline(renderer, new Scene(), new PerspectiveCamera(), { useMRT: true });
        expect(pipeline.isEnabled()).toBe(true);
        expect(pipeline.mrtEnabled).toBe(native);
        expect(pipeline.postProcessing.outputNode).toBeTruthy();
        pipeline.dispose();
    });
    it('retires scene targets and the fullscreen pipeline once across repeated disposal', () => {
        const pipeline = new Pipeline(
            { isWebGPURenderer: true, backend: { isWebGLBackend: true } },
            new Scene(),
            new PerspectiveCamera(),
        );
        const targetDispose = vi.spyOn(pipeline.scenePass, 'dispose');
        const pipelineDispose = vi.spyOn(pipeline.postProcessing, 'dispose');
        const bloomDispose = vi.spyOn(pipeline.bloomNode, 'dispose');
        pipeline.dispose();
        pipeline.dispose();
        expect(targetDispose).toHaveBeenCalledOnce();
        expect(pipelineDispose).toHaveBeenCalledOnce();
        expect(bloomDispose).toHaveBeenCalledOnce();
        expect(pipeline.isEnabled()).toBe(false);
    });
});

const themes = [['Murmuration', MurmurationTheme]];
it.each(themes)('releases %s monitors on direct stop before renderer disposal', (_label, Theme) => {
    vi.stubGlobal('window', { cancelAnimationFrame: vi.fn() });
    vi.stubGlobal('document', { getElementById: () => null });
    const theme = new Theme();
    theme.renderer = {};
    const removeMonitor = vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
    const dispose = vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
    theme.stop();
    expect(removeMonitor).toHaveBeenCalledOnce();
    expect(removeMonitor.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(theme.renderer).toBeNull();
});

it('steps Murmuration CPU particles without dispatching WebGL2 storage compute', () => {
    const theme = new MurmurationTheme();
    theme.renderer = { compute: vi.fn() };
    theme.fluidSim = { isCPU: true, stepCPU: vi.fn() };
    theme._safeFluidCompute();
    expect(theme.fluidSim.stepCPU).toHaveBeenCalledOnce();
    expect(theme.renderer.compute).not.toHaveBeenCalled();
    theme.fluidSim = { isCPU: false, computeNode: {} };
    theme._safeFluidCompute();
    expect(theme.renderer.compute).toHaveBeenCalledWith(theme.fluidSim.computeNode);
});

it('frames the visible phone board rather than a hidden board canvas', () => {
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
    vi.stubGlobal('document', {
        querySelectorAll: vi.fn(() => [
            { getBoundingClientRect: () => ({ width: 0, height: 0 }) },
            {
                getBoundingClientRect: () => ({
                    left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
                }),
            },
        ]),
    });
    const theme = new MurmurationTheme();
    theme.postPipeline = { setBoardHalo: vi.fn() };
    theme._updateBoardZone();
    const halo = theme.postPipeline.setBoardHalo.mock.calls[0][0];
    expect(halo.center.x).toBeCloseTo(0.5);
    expect(halo.center.y).toBeCloseTo(400 / 844);
    expect(halo.halfSize.x).toBeCloseTo(0.4 * 1.04);
    expect(halo.halfSize.y).toBeCloseTo((300 / 844) * 1.02);
});
