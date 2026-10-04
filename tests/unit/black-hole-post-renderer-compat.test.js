import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import BlackHoleTheme from '../../src/themes/black-hole/black-hole-theme.js';

let frames;
beforeEach(() => {
    frames = [];
    vi.stubGlobal('window', {
        location: { search: '' },
        settings: { targetFrameRate: 30 },
        matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        frames.push(callback);
        return frames.length;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function createTheme(backend, usePost = true) {
    const theme = new BlackHoleTheme();
    theme.isActive = true;
    theme.isWebGPU = backend === 'WebGPU';
    theme.renderer = {
        backend: backend === 'WebGL2' ? { isWebGLBackend: true } : { isWebGPUBackend: true },
        autoClear: false,
        clear: vi.fn(),
        render: vi.fn(),
    };
    theme.camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 100000);
    theme.camera.position.set(0, 105, 1040);
    theme.camera.lookAt(0, 0, 0);
    theme.camera.updateMatrixWorld();
    theme.scene = new THREE.Scene();
    theme.flags.usePost = usePost;
    theme.clock.getDelta = () => 1 / 60;
    theme.shouldRenderFrame = () => true;
    theme.updateDynamicResolution = vi.fn();
    theme.updateNaturalCamera = vi.fn();
    theme.sampleRenderGpuTiming = vi.fn();
    theme.postProcessing = usePost ? { render: vi.fn(), update: vi.fn() } : null;
    return theme;
}

describe('Black Hole node WebGL2 post framebuffer ownership', () => {
    it('lets the post pipeline bind and clear its scene target on a live WebGL2 frame', () => {
        const theme = createTheme('WebGL2');
        theme.postProcessing.render.mockImplementation(() => expect(theme.renderer.autoClear).toBe(true));
        theme.startAnimation();
        frames.shift()();
        expect(theme.postProcessing.render).toHaveBeenCalledOnce();
        expect(theme.renderer.clear).not.toHaveBeenCalled();
        expect(theme.renderer.render).not.toHaveBeenCalled();
        expect(theme.renderer.autoClear).toBe(false);
    });

    it('preserves the native WebGPU explicit clear and renderer settings', () => {
        const theme = createTheme('WebGPU');
        theme.postProcessing.render.mockImplementation(() => expect(theme.renderer.autoClear).toBe(false));
        theme.startAnimation();
        frames.shift()();
        expect(theme.renderer.clear).toHaveBeenCalledOnce();
        expect(theme.postProcessing.render).toHaveBeenCalledOnce();
        expect(theme.renderer.autoClear).toBe(false);
    });

    it('keeps the direct WebGL2 render clear when post effects are disabled', () => {
        const theme = createTheme('WebGL2', false);
        theme.startAnimation();
        frames.shift()();
        expect(theme.renderer.clear).toHaveBeenCalledOnce();
        expect(theme.renderer.render).toHaveBeenCalledWith(theme.scene, theme.camera);
        expect(theme.renderer.autoClear).toBe(false);
    });

    it('restores the WebGL2 clear setting if a live post render throws', () => {
        const theme = createTheme('WebGL2');
        theme.postProcessing.render.mockImplementation(() => { throw new Error('pipeline failure'); });
        theme.startAnimation();
        expect(() => frames.shift()()).toThrow('pipeline failure');
        expect(theme.renderer.clear).not.toHaveBeenCalled();
        expect(theme.renderer.autoClear).toBe(false);
    });

    it.each(['WebGL2', 'WebGPU'])('uses the same clear policy when warming the %s pipeline', async (backend) => {
        const theme = createTheme(backend);
        theme.postProcessing.render.mockImplementation(() => {
            expect(theme.renderer.autoClear).toBe(backend === 'WebGL2');
        });
        await theme.prewarmPipelines();
        expect(theme.postProcessing.render).toHaveBeenCalledOnce();
        expect(theme.renderer.clear).not.toHaveBeenCalled();
        expect(theme.renderer.autoClear).toBe(false);
    });

    it('restores the WebGL2 clear setting after a nonfatal warmup failure', async () => {
        const theme = createTheme('WebGL2');
        theme.postProcessing.render.mockImplementation(() => { throw new Error('warmup failure'); });
        await expect(theme.prewarmPipelines()).resolves.toBeUndefined();
        expect(theme.renderer.autoClear).toBe(false);
    });
});
