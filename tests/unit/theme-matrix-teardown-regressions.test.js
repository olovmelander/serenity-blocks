import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import ChromaticImpastoTheme from '../../src/themes/chromatic-impasto/chromatic-impasto-theme.js';
import LunaraTheme from '../../src/themes/lunara/lunara-theme.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';

function installThemeDom(themeId) {
    const container = {
        classList: { remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    vi.stubGlobal('document', {
        getElementById: vi.fn((id) => (id === `${themeId}-theme` ? container : null)),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('window', {
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return container;
}

function makeOwnedNode() {
    const node = {};
    const parentNode = {
        removeChild: vi.fn((child) => {
            child.parentNode = null;
        }),
    };
    node.parentNode = parentNode;
    return { node, parentNode };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('all-theme matrix teardown regressions', () => {
    it('releases Chromatic Impasto camera, world and renderer references on repeated stop', () => {
        installThemeDom('chromatic-impasto');
        const theme = new ChromaticImpastoTheme();
        const world = { dispose: vi.fn() };
        const canvas = makeOwnedNode();
        const renderer = { domElement: canvas.node };
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
        theme.camera = {};
        theme.world = world;
        theme.renderer = renderer;
        theme.isActive = true;
        theme.lifecycleState = 'running';

        theme.cleanup();
        theme.cleanup();

        expect(world.dispose).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(canvas.parentNode.removeChild).toHaveBeenCalledWith(canvas.node);
        expect(theme.camera).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.cleanupComplete).toBe(true);
    });

    it('releases Lunara camera, world and renderer references on repeated stop', () => {
        installThemeDom('lunara');
        const theme = new LunaraTheme();
        const world = { dispose: vi.fn() };
        const canvas = makeOwnedNode();
        const renderer = { domElement: canvas.node };
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
        theme.camera = {};
        theme.world = world;
        theme.renderer = renderer;
        theme.isActive = true;
        theme.lifecycleState = 'running';

        theme.stop();
        theme.stop();

        expect(world.dispose).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(renderer, { nullInstance: false });
        expect(canvas.parentNode.removeChild).toHaveBeenCalledWith(canvas.node);
        expect(theme.camera).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.lifecycleState).toBe('stopped');
    });

    it('keeps Chromatic Impasto under the heavy-GPU lifecycle policy', () => {
        expect(getThemeMeta('chromatic-impasto')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('keeps Lunara under the heavy-GPU lifecycle policy', () => {
        expect(getThemeMeta('lunara')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });
});
