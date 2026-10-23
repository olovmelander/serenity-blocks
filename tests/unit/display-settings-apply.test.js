/**
 * Display settings re-apply the window mode only when it changes (audit 2026-10-13:
 * UI-01). Render quality, anti-aliasing and the FPS counter share this apply path. Each
 * of their changes used to call setDisplayMode again, which resized and re-centred the
 * window on every slider tick and dropped a fullscreen entered with F. The app's apply
 * path runs here against a real DisplayManager whose Electron calls are stubbed.
 */
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Game: class {}, WEBGL: 'webgl', AUTO: 'auto', Scale: { FIT: 1, CENTER_BOTH: 1 }, Scene: class {},
    },
}));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class {} }));

let SerenityBlocks;
let DisplayManager;
let getGlobalRenderScale;
let applyGlobalRenderScale;

beforeAll(async () => {
    // main.js reads a few browser globals while it loads.
    const element = () => ({
        style: {},
        classList: {
            add() {}, remove() {}, contains: () => false, toggle() {},
        },
        addEventListener() {},
        appendChild() {},
        setAttribute() {},
        querySelector: () => null,
        querySelectorAll: () => [],
    });
    vi.stubGlobal('document', {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: element,
        addEventListener() {},
        removeEventListener() {},
        body: element(),
        documentElement: element(),
        head: element(),
        readyState: 'loading',
        hidden: false,
    });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('removeEventListener', () => {});
    vi.stubGlobal('dispatchEvent', () => true);
    vi.stubGlobal('location', {
        search: '', hash: '', href: 'http://localhost/', protocol: 'http:', pathname: '/',
    });
    const storage = { getItem: () => null, setItem() {}, removeItem() {} };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('navigator', { userAgent: 'node', getGamepads: () => [] });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    ({ SerenityBlocks } = await import('../../src/main.js'));
    ({ DisplayManager } = await import('../../src/core/display-manager.js'));
    ({ applyGlobalRenderScale, getGlobalRenderScale } = await import('../../src/themes/base-theme.js'));
});

function createApp({ setDisplayMode = vi.fn(async () => true) } = {}) {
    const displayManager = Object.assign(new DisplayManager(), {
        getAvailableDisplays: async () => [{ workArea: { width: 1920, height: 1080 } }],
        setDisplayMode,
    });
    const app = {
        getResolvedDesktopSettings: (settings) => settings,
        displayManager,
        webglRenderer: { setInternalResolution: vi.fn() },
        showFPSCounter: vi.fn(),
        hideFPSCounter: vi.fn(),
        themeManager: { resize: vi.fn() },
    };
    const apply = (settings) => SerenityBlocks.prototype.applyDisplaySettings.call(app, {
        displayMode: 'windowed', renderScale: 1, enableAntialiasing: true, showFPSCounter: false, ...settings,
    });
    return { app, apply };
}

describe('applyDisplaySettings', () => {
    it('applies the window mode at boot, then only when the mode changes', async () => {
        const { app, apply } = createApp();
        const { setDisplayMode } = app.displayManager;

        await apply({});
        expect(setDisplayMode).toHaveBeenCalledExactlyOnceWith('windowed', { width: 1920, height: 1080 });

        await apply({ renderScale: 0.75 }); // a render-quality slider tick
        await apply({ renderScale: 0.75, enableAntialiasing: false });
        await apply({ renderScale: 0.75, enableAntialiasing: false, showFPSCounter: true });
        expect(setDisplayMode).toHaveBeenCalledOnce();
        expect(app.webglRenderer.setInternalResolution).toHaveBeenCalledTimes(4); // still rescaled
        expect(app.showFPSCounter).toHaveBeenCalledOnce();

        await apply({ displayMode: 'fullscreen' });
        expect(setDisplayMode).toHaveBeenCalledTimes(2);
        expect(setDisplayMode).toHaveBeenLastCalledWith('fullscreen', { width: 1920, height: 1080 });
    });

    it('hands a new render scale to the active theme, and only a new one', async () => {
        // A theme reads the scale when it sizes its canvas, and the desktop policy's changes (the
        // dynamic resolution loop, a GPU health update) come with no settings event.
        vi.stubGlobal('innerWidth', 1280);
        vi.stubGlobal('innerHeight', 720);
        const { app, apply } = createApp();
        await apply({ renderScale: 1 });
        app.themeManager.resize.mockClear();
        await apply({ renderScale: 0.75 });
        expect(app.themeManager.resize).toHaveBeenCalledExactlyOnceWith(1280, 720);
        await apply({ renderScale: 0.75, showFPSCounter: true });
        expect(app.themeManager.resize).toHaveBeenCalledOnce();
        applyGlobalRenderScale(0.5, app.themeManager); // as the desktop policy does
        expect(getGlobalRenderScale()).toBe(0.5);
        expect(app.themeManager.resize).toHaveBeenCalledTimes(2);
    });

    it('tries again next time when applying the mode failed', async () => {
        const setDisplayMode = vi.fn(async () => false);
        const { apply } = createApp({ setDisplayMode });
        await apply({});
        await apply({ renderScale: 0.5 });
        expect(setDisplayMode).toHaveBeenCalledTimes(2);
    });
});
