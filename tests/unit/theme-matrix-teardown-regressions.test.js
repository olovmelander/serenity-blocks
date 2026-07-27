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
    it('removes every Chromatic Impasto-owned child and disposes its simulator once', () => {
        installThemeDom('chromatic-impasto');
        const theme = new ChromaticImpastoTheme();
        const simulator = { cleanup: vi.fn() };
        const canvas = makeOwnedNode();
        const texture = makeOwnedNode();
        theme.simulator = simulator;
        theme.canvas = canvas.node;
        theme.canvasTexture = texture.node;
        theme.isActive = true;
        theme.lifecycleState = 'running';

        theme.cleanup();
        theme.cleanup();

        expect(simulator.cleanup).toHaveBeenCalledTimes(1);
        expect(canvas.parentNode.removeChild).toHaveBeenCalledWith(canvas.node);
        expect(texture.parentNode.removeChild).toHaveBeenCalledWith(texture.node);
        expect(theme.simulator).toBeNull();
        expect(theme.canvas).toBeNull();
        expect(theme.canvasTexture).toBeNull();
        expect(theme.cleanupComplete).toBe(true);
    });

    it('releases Lunara camera and light references on repeated stop', () => {
        installThemeDom('lunara');
        const theme = new LunaraTheme();
        theme.camera = {};
        theme.directionalPrimary = {};
        theme.directionalCompanion = {};
        theme.isActive = true;
        theme.lifecycleState = 'running';

        theme.stop();
        theme.stop();

        expect(theme.camera).toBeNull();
        expect(theme.directionalPrimary).toBeNull();
        expect(theme.directionalCompanion).toBeNull();
        expect(theme.lifecycleState).toBe('stopped');
    });

    it('keeps Lunara under the heavy-GPU lifecycle policy', () => {
        expect(getThemeMeta('lunara')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });
});
