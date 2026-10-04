import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { StarlightPostPipeline, getStarlightPostProfile } from '../../src/themes/starlight/post/render-pipeline.js';
import StarlightTheme from '../../src/themes/starlight/starlight-theme.js';
import SingingBowlTheme from '../../src/themes/singing-bowl/singing-bowl-theme.js';
import { BaseTheme } from '../../src/themes/base-theme.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('phone visual compatibility', () => {
    it('keeps the live stardust hero and authored Low count in the actual WebGL2 theme', () => {
        const theme = new StarlightTheme();
        theme.usesNodeMaterials = true;
        theme.isWebGPU = false;
        theme.qualityName = 'Low';
        theme.scene = new THREE.Scene();
        theme.renderer = { compute: vi.fn() };
        theme._setupStardust();
        const positions = theme.stardustRenderer.mesh.geometry.getAttribute('aDustPosition');
        const startAge = positions.getW(0);
        const startVersion = positions.version;

        theme._updateStardust(1 / 60, 1);

        expect(theme.stardustRenderer.mesh.count).toBe(6000);
        expect(theme.scene.children).toContain(theme.stardustRenderer.mesh);
        expect(positions.isInstancedBufferAttribute).toBe(true);
        expect(positions.getW(0)).not.toBe(startAge);
        expect(positions.version).toBeGreaterThan(startVersion);
        expect(theme.stardustSim.computeNode).toBeNull();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        theme._teardownStardust();
        expect(theme.scene.children).toHaveLength(0);
    });

    it('removes Starlight context monitors before disposing the renderer on stop', () => {
        const theme = new StarlightTheme();
        theme.renderer = {};
        vi.spyOn(BaseTheme.prototype, 'stop').mockImplementation(() => {});
        const remove = vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
        const dispose = vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});

        theme.stop();

        expect(remove).toHaveBeenCalledOnce();
        expect(remove.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    });

    it('enables the modern Starlight post in the actual theme on WebGL2', () => {
        const theme = new StarlightTheme();
        theme.renderer = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
        theme.usesNodeMaterials = true;
        theme.isWebGPU = false;
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera();
        theme.postProfile = getStarlightPostProfile('High');

        theme._setupPost();

        expect(theme.postPipeline.isEnabled()).toBe(true);
        expect(theme.postPipeline.mrtEnabled).toBe(false);
        theme.postPipeline.dispose();
    });
    it('retains the Starlight grade and bloom graph on the node WebGL2 renderer without MRT', () => {
        const renderer = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
        const pipeline = new StarlightPostPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), {
            useMRT: true,
            contrast: 1.14,
            saturation: 1.14,
        });

        expect(pipeline.isEnabled()).toBe(true);
        expect(pipeline.mrtEnabled).toBe(false);
        expect(pipeline.bloomNode).toBeDefined();
        expect(pipeline.uContrast.value).toBe(1.14);
        expect(pipeline.uSaturation.value).toBe(1.14);
        expect(pipeline.postProcessing.outputNode).toBeDefined();
        pipeline.dispose();
    });

    it('keeps native Starlight selective bloom', () => {
        const pipeline = new StarlightPostPipeline({
            isWebGPURenderer: true,
            backend: { isWebGPUBackend: true },
        }, new THREE.Scene(), new THREE.PerspectiveCamera(), { useMRT: true });

        expect(pipeline.isEnabled()).toBe(true);
        expect(pipeline.mrtEnabled).toBe(true);
        pipeline.dispose();
    });

    it('releases the Starlight scene target and fullscreen material exactly once', () => {
        const pipeline = new StarlightPostPipeline({
            isWebGPURenderer: true,
            backend: { isWebGLBackend: true },
        }, new THREE.Scene(), new THREE.PerspectiveCamera());
        const sceneDispose = vi.spyOn(pipeline.scenePass, 'dispose');
        const postDispose = vi.spyOn(pipeline.postProcessing, 'dispose');

        pipeline.dispose();
        pipeline.dispose();

        expect(sceneDispose).toHaveBeenCalledOnce();
        expect(postDispose).toHaveBeenCalledOnce();
        expect(pipeline.isEnabled()).toBe(false);
    });

    it('preserves the Singing Bowl phone pixel budget when the viewport rotates', () => {
        vi.stubGlobal('window', { innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 });
        const theme = new SingingBowlTheme();
        theme.camera = new THREE.PerspectiveCamera();
        theme.renderer = { setPixelRatio: vi.fn(), setSize: vi.fn() };
        theme.composer = { setPixelRatio: vi.fn(), setSize: vi.fn() };
        vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.75);

        theme.onWindowResize();

        expect(theme.camera.aspect).toBe(844 / 390);
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(0.75);
        expect(theme.composer.setPixelRatio).toHaveBeenCalledWith(0.75);
    });
});
