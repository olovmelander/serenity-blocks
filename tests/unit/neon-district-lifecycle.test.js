import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import NeonDistrictTheme from '../../src/themes/neon-district/neon-district-theme.js';
import { NeonDistrictAssets } from '../../src/themes/neon-district/neon-district-assets.js';

function installThemeDom() {
    const container = {
        appendChild: vi.fn(),
        classList: { remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => container),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        location: { search: '' },
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return container;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Neon District lifecycle ownership', () => {
    it('joins concurrent scene creation and ignores a renderer completion after stop', async () => {
        installThemeDom();
        const theme = new NeonDistrictTheme();
        theme.isActive = true;

        let resolveRenderer;
        theme.initRenderer = vi.fn(() => new Promise((resolve) => {
            resolveRenderer = resolve;
        }));
        const setRenderer = vi.spyOn(theme.assets, 'setRenderer');

        const firstCreation = theme.createScene();
        const joinedCreation = theme.createScene();
        expect(theme.initRenderer).toHaveBeenCalledTimes(1);

        theme.stop();
        resolveRenderer(true);
        await Promise.all([firstCreation, joinedCreation]);

        expect(setRenderer).not.toHaveBeenCalled();
        expect(theme.sceneInitialized).toBe(false);
        expect(theme.sceneCreationPromise).toBeNull();
        theme.assets.dispose();
    });

    it('runs stop and the base cleanup safety net even when runtime disposal throws', () => {
        installThemeDom();
        const theme = new NeonDistrictTheme();
        const order = [];
        theme.stop = vi.fn(() => {
            order.push('stop');
        });
        theme.disposeRuntimeResources = vi.fn(() => {
            order.push('runtime');
            throw new Error('dispose failed');
        });
        theme.releaseInactiveResources = vi.fn(() => {
            order.push('base');
        });

        expect(() => theme.cleanup()).toThrow('dispose failed');
        expect(order).toEqual(['stop', 'runtime', 'base']);
        expect(theme.cleanupComplete).toBe(true);

        theme.cleanup();
        expect(theme.stop).toHaveBeenCalledTimes(1);
        expect(theme.disposeRuntimeResources).toHaveBeenCalledTimes(1);
    });

    it('disposes textures that finish after the asset owner is disposed', async () => {
        const assets = new NeonDistrictAssets();
        assets.ktx2Ready = true;
        assets.ktx2Loader.dispose = vi.fn();

        const pendingLoads = [];
        assets.textureLoader.load = vi.fn((_url, onLoad) => {
            pendingLoads.push(onLoad);
        });

        const firstLoad = assets.loadAllTextures();
        const joinedLoad = assets.loadAllTextures();
        expect(pendingLoads.length).toBeGreaterThan(0);

        assets.dispose();
        const lateTextures = pendingLoads.map(() => ({ dispose: vi.fn() }));
        pendingLoads.forEach((onLoad, index) => onLoad(lateTextures[index]));

        await expect(firstLoad).resolves.toBe(false);
        await expect(joinedLoad).resolves.toBe(false);
        lateTextures.forEach((texture) => {
            expect(texture.dispose).toHaveBeenCalledTimes(1);
        });
        expect(assets.textures).toEqual({});
        expect(assets.materials).toEqual({});
        expect(assets.loaded).toBe(false);
    });
});
