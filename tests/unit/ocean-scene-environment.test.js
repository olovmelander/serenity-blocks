import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { resetRendererState } from 'three/src/renderers/common/RendererUtils.js';
import OceanTheme from '../../src/themes/ocean/ocean-theme.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({
    disposeOceanGltfCache: vi.fn(),
    loadGltfCached: vi.fn(),
}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function rendererStateHarness() {
    const clearColor = new THREE.Color(0x075a74);
    let clearAlpha = 1;
    return {
        autoClear: true,
        getRenderTarget: () => null,
        getActiveCubeFace: () => 0,
        getActiveMipmapLevel: () => 0,
        getRenderObjectFunction: () => null,
        getPixelRatio: () => 1,
        getMRT: () => null,
        getClearColor: (target) => target.copy(clearColor),
        getClearAlpha: () => clearAlpha,
        getScissorTest: () => false,
        setMRT: vi.fn(),
        setRenderObjectFunction: vi.fn(),
        setClearColor: (value, alpha = 1) => {
            clearColor.set(value);
            clearAlpha = alpha;
        },
    };
}

async function createProductionScene(quality) {
    const container = { innerHTML: '', style: {} };
    vi.stubGlobal('window', {
        location: { search: '' }, innerWidth: 1600, innerHeight: 732,
    });
    vi.stubGlobal('document', { getElementById: () => container });
    const theme = new OceanTheme();
    const renderer = rendererStateHarness();
    theme.getGraphicsQuality = () => quality;
    theme.setupQualityListener = vi.fn();
    theme.initRenderer = vi.fn(async () => {
        theme.renderer = renderer;
        theme.isWebGPU = true;
        return true;
    });
    // Exercise the real createScene/environment ownership path while avoiding
    // browser rendering, asset requests, event subscriptions and animation.
    for (const method of [
        'setupRendererResilience', 'buildScene', 'setupEventListeners',
        'installSignoffHelper', 'handleResize', 'startAnimation',
    ]) theme[method] = vi.fn();
    await theme.createScene();
    return { theme, renderer };
}

describe('Ocean production scene environment', () => {
    it.each(['High', 'Ultra', 'Extreme'])('preserves %s water through a nested post reset', async (tier) => {
        const { theme, renderer } = await createProductionScene(tier);
        expect(theme.buildScene).toHaveBeenCalledTimes(1);
        expect(theme.scene.background?.isColor).toBe(true);
        expect(theme.scene.background.getHex()).toBe(0x06474b);
        expect(theme.scene.fogNode?.isNode).toBe(true);
        expect(theme.camera.aspect).toBeCloseTo(1600 / 732);

        const background = theme.scene.background.clone();
        // This is the real r186 reset used by RTTNode/BloomNode before nested
        // scene-pass evaluation. The renderer clears black until restored.
        resetRendererState(renderer);
        expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x000000);
        expect(renderer.getClearAlpha()).toBe(1);
        expect(theme.scene.background.equals(background)).toBe(true);
        expect(theme.scene.background.getHex()).toBe(0x06474b);
    });

    it('retains its scene-owned background across quality rebuilds', async () => {
        const { theme, renderer } = await createProductionScene('Extreme');
        const originalScene = theme.scene;
        const { background } = originalScene;
        theme.isActive = true;
        resetRendererState(renderer);
        for (const tier of ['High', 'Ultra', 'Low']) {
            theme.applyQualityPreset(tier);
            expect(theme.scene).toBe(originalScene);
            expect(theme.scene.background).toBe(background);
            expect(theme.scene.background.getHex()).toBe(0x06474b);
            expect(theme.currentQuality).toBe(tier);
        }
        expect(theme.buildScene).toHaveBeenCalledTimes(4);
    });
});
