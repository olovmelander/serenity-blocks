import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import TornadoTheme from '../../src/themes/tornado/tornado-theme.js';
import SakuraTwilightTheme from '../../src/themes/sakura-twilight/sakura-twilight-theme.js';
import SkyChildrenV2Theme from '../../src/themes/sky-children-v2/sky-children-v2-theme.js';

const loaderMocks = vi.hoisted(() => ({
    loadAsync: vi.fn(),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class MockGLTFLoader {
        loadAsync(...args) {
            return loaderMocks.loadAsync(...args);
        }
    },
}));

vi.mock('@utils/helpers.js', () => ({
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
}));

function installLifecycleGlobals() {
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        location: { search: '' },
        settings: null,
        setTimeout,
        clearTimeout,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

beforeEach(() => {
    installLifecycleGlobals();
});

afterEach(() => {
    loaderMocks.loadAsync.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('theme async lifecycle cancellation', () => {
    it('does not let Tornado resume when BaseTheme rejects the resume', () => {
        vi.spyOn(BaseTheme.prototype, 'resume').mockReturnValue(false);
        const theme = new TornadoTheme();
        const setAnimationLoop = vi.fn();

        theme.renderer = { setAnimationLoop };
        theme.scene = {};
        theme.camera = {};
        theme.renderLoop = vi.fn();
        theme.resizeHandler = vi.fn();
        theme.setupSettingsListener = vi.fn();
        theme.setupComboListener = vi.fn();
        theme.handleResize = vi.fn();

        expect(theme.resume()).toBe(false);
        expect(setAnimationLoop).not.toHaveBeenCalled();
        expect(theme.setupSettingsListener).not.toHaveBeenCalled();
    });

    it.each([
        ['forest', 'loadModelAndCreateForest'],
        ['foxes', 'loadFoxes'],
    ])('disposes a Sakura %s GLTF root that resolves after invalidation', async (_label, method) => {
        const geometry = { dispose: vi.fn() };
        const material = { dispose: vi.fn() };
        const root = {
            traverse: vi.fn((visit) => visit({ geometry, material })),
        };
        loaderMocks.loadAsync.mockResolvedValueOnce({
            scene: root,
            animations: [],
        });

        const theme = new SakuraTwilightTheme();
        theme.isActive = true;
        const generation = theme.lifecycleGeneration;
        const load = theme[method](generation);

        theme.isActive = false;
        theme.lifecycleGeneration += 1;

        await expect(load).resolves.toBe(false);
        expect(root.traverse).toHaveBeenCalledTimes(1);
        expect(geometry.dispose).toHaveBeenCalledTimes(1);
        expect(material.dispose).toHaveBeenCalledTimes(1);
    });

    it('resolves canceled async turns for sky-children', async () => {
        const theme = new SkyChildrenV2Theme();
        theme.isActive = true;
        theme.lifecycleState = 'running';
        const generation = theme.lifecycleGeneration;
        const pendingTurn = theme.waitForAsyncTurn(60_000, generation);

        theme.stop();

        await expect(pendingTurn).resolves.toBe(false);
        expect(theme._asyncTimeouts.size).toBe(0);
        expect(theme._asyncWaitResolvers.size).toBe(0);
    });
});
