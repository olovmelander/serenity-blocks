import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import {
    preloadAsyncRenderPipelines,
    resetAsyncRenderPipelinesForTests,
} from '../../src/rendering/async-render-pipelines.js';

/**
 * An in-play theme switch (a level-up in the default Level background mode, the Random timer, a
 * pick during play) disposed the playing theme first and then built the new one, whose first frame
 * compiled every render pipeline synchronously: the GPU process, and the board with it, froze for
 * the whole compile (2-6 s on the RTX for a theme not seen before). The incoming theme is now built
 * hidden behind the playing one, its pipelines created async, and the two crossfade.
 *
 * The theme doubles render through a fake three WebGPUBackend whose createRenderPipeline lives on
 * the prototype (what rendering/async-render-pipelines.js wraps), as in theme-prewarm-async.test.js.
 */

const FRAME_MS = 16;

function makeBackendClass({ compileMs = 300 } = {}) {
    return class FakeWebGPUBackend {
        constructor(renderer) {
            this.isWebGPUBackend = true;
            this.renderer = renderer;
            this.data = new WeakMap();
            this.syncCreates = 0;
            this.asyncCreates = 0;
        }

        get(object) {
            let entry = this.data.get(object);
            if (!entry) {
                entry = {};
                this.data.set(object, entry);
            }
            return entry;
        }

        createRenderPipeline(renderObject, promises) {
            const pipelineData = this.get(renderObject.pipeline);
            if (promises) {
                this.asyncCreates += 1;
                promises.push(compileMs === Infinity
                    ? new Promise(() => {})
                    : new Promise((resolve) => {
                        setTimeout(() => {
                            pipelineData.pipeline = { ready: true };
                            resolve();
                        }, compileMs);
                    }));
                return;
            }
            this.syncCreates += 1;
            pipelineData.pipeline = { ready: true };
        }
    };
}

function installFrameDriver() {
    const callbacks = [];
    const renderers = new Set();
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        callbacks.push(callback);
        return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    setInterval(() => {
        renderers.forEach((render) => render());
        callbacks.splice(0).forEach((callback) => callback(performance.now()));
    }, FRAME_MS);
    return { renderers };
}

function makeTheme(BackendClass, driver, name) {
    const theme = {
        name,
        hasStarted: false,
        isActive: false,
        isPaused: false,
        lifecycleState: 'initialized',
        scene: { children: [] },
        camera: {},
        renderer: null,
        renderObjects: [],
        hiddenAtStart: null,
    };
    theme.renderFrame = () => {
        if (!theme.isActive || !theme.renderer) return;
        theme.renderObjects.forEach((renderObject) => {
            if (renderObject.requested) return;
            renderObject.requested = true;
            theme.renderer.backend.createRenderPipeline(renderObject, null);
        });
    };
    theme.start = vi.fn(async () => {
        theme.hiddenAtStart = theme._prewarmHidden === true;
        const renderer = {};
        renderer.backend = new BackendClass(renderer);
        theme.renderer = renderer;
        for (let id = 0; id < 3; id += 1) {
            theme.renderObjects.push({ id, pipeline: { id: `p${id}` }, context: { renderTarget: null } });
            theme.scene.children.push({ id });
        }
        theme.hasStarted = true;
        theme.isActive = true;
        theme.lifecycleState = 'running';
        driver.renderers.add(theme.renderFrame);
        return true;
    });
    theme.pause = vi.fn(() => {
        theme.isPaused = true;
        theme.lifecycleState = 'paused';
        return true;
    });
    theme.cleanup = vi.fn(() => {
        theme.isActive = false;
        theme.lifecycleState = 'stopped';
        theme.cleanupComplete = true;
        driver.renderers.delete(theme.renderFrame);
    });
    return theme;
}

function classList(initial = []) {
    const names = new Set(initial);
    return { add: (n) => names.add(n), remove: (n) => names.delete(n), contains: (n) => names.has(n) };
}

function container(id, classes) {
    return {
        id,
        classList: classList(classes),
        style: { removeProperty(name) { delete this[name]; } },
    };
}

/** A manager playing `ocean`, with `forest` to switch to. */
async function playing({ compileMs } = {}) {
    vi.useFakeTimers();
    const driver = installFrameDriver();
    const Backend = makeBackendClass({ compileMs });
    await preloadAsyncRenderPipelines(() => ({ WebGPUBackend: Backend }));
    const containers = [
        container('ocean-theme', ['theme-container', 'active']),
        container('forest-theme', ['theme-container']),
    ];
    vi.stubGlobal('document', {
        hidden: false,
        getElementById: (id) => containers.find((c) => c.id === id) || null,
        querySelectorAll: () => containers,
        createElement: () => container('created', []),
        body: { appendChild: () => {} },
    });
    vi.spyOn(ThemeManager.prototype, 'initializeRegistry').mockImplementation(() => {});
    const sharedRenderer = { cleanup: vi.fn(), clearThemeResources: vi.fn(), loadTheme: vi.fn() };
    const manager = new ThemeManager(sharedRenderer, { assetManager: {}, audioManager: null });
    const ocean = makeTheme(Backend, driver, 'ocean');
    const forest = makeTheme(Backend, driver, 'forest');
    await ocean.start();
    manager.themeInstances.set('ocean', ocean);
    manager.activeTheme = ocean;
    manager.activeThemeName = 'ocean';
    manager.themesSuspended = false;
    manager.loadTheme = vi.fn(async (name) => {
        if (name === 'forest') {
            manager.themeInstances.set('forest', forest);
            return forest;
        }
        return ocean;
    });
    const byId = (id) => containers.find((c) => c.id === id);
    return {
        manager, ocean, forest, byId,
    };
}

async function frames(ms) {
    for (let t = 0; t < ms; t += FRAME_MS) {
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(FRAME_MS);
    }
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await preloadAsyncRenderPipelines(() => null);
    resetAsyncRenderPipelinesForTests();
});

describe('an in-play theme switch builds the incoming theme behind the playing one', () => {
    it('keeps the playing theme until the incoming one has compiled, async, then crossfades', async () => {
        const {
            manager, ocean, forest, byId,
        } = await playing({ compileMs: 300 });
        const switched = manager.switchTheme('forest');
        await frames(150);

        // Mid-build: ocean still plays and is visible; forest is running hidden, compiling async.
        expect(manager.activeTheme).toBe(ocean);
        expect(ocean.cleanup).not.toHaveBeenCalled();
        expect(forest.hiddenAtStart).toBe(true);
        expect(byId('forest-theme').classList.contains('active')).toBe(false);
        expect(byId('ocean-theme').classList.contains('active')).toBe(true);
        expect(forest.renderer.backend.syncCreates).toBe(0);
        expect(forest.renderer.backend.asyncCreates).toBe(3);

        await frames(1500);
        await switched;
        expect(manager.activeTheme).toBe(forest);
        expect(manager.activeThemeName).toBe('forest');
        expect(byId('forest-theme').classList.contains('active')).toBe(true);
        expect(byId('ocean-theme').classList.contains('active')).toBe(false);
        expect(forest._prewarmHidden).toBe(false);
        // Ocean draws on under the 2.5 s fade, out of the cache, then is disposed.
        expect(ocean.cleanup).not.toHaveBeenCalled();
        expect(manager.themeInstances.get('ocean')).toBeUndefined();
        await frames(2600);
        expect(ocean.cleanup).toHaveBeenCalledOnce();
    });

    it('a mode exit during the hidden build disposes the incoming theme and parks the playing one', async () => {
        const { manager, ocean, forest } = await playing({ compileMs: Infinity });
        const switched = manager.switchTheme('forest');
        await frames(200);
        expect(manager.activeTheme).toBe(ocean);

        manager.suspendThemes();
        await frames(200);
        await switched;
        expect(forest.cleanup).toHaveBeenCalled();
        expect(ocean.cleanup).not.toHaveBeenCalled();
        expect(manager.pendingThemeInstance).toBe(ocean);
        expect(ocean.pause).toHaveBeenCalledOnce();
        expect(manager.activeTheme).toBeNull();
    });

    it('a fading theme is disposed at once when the player leaves for the menu', async () => {
        const { manager, ocean, forest } = await playing({ compileMs: 100 });
        const switched = manager.switchTheme('forest');
        await frames(1500);
        await switched;
        expect(manager.activeTheme).toBe(forest);
        expect(ocean.cleanup).not.toHaveBeenCalled();
        manager.suspendThemes();
        expect(ocean.cleanup).toHaveBeenCalledOnce();
        expect(manager.pendingThemeInstance).toBe(forest);
    });

    it('takes the classic path on the menu, under a loading surface, or for a theme not playing', async () => {
        const { manager, ocean } = await playing();
        expect(manager._canSwitchBehindActive(ocean, 'ocean', 'forest')).toBe(true);
        expect(manager._canSwitchBehindActive(ocean, 'ocean', 'ocean')).toBe(false);
        manager.themesSuspended = true;
        expect(manager._canSwitchBehindActive(ocean, 'ocean', 'forest')).toBe(false);
        manager.themesSuspended = false;
        manager._loadingSurfaceCovering = 1;
        expect(manager._canSwitchBehindActive(ocean, 'ocean', 'forest')).toBe(false);
        manager._loadingSurfaceCovering = 0;
        ocean.isPaused = true;
        expect(manager._canSwitchBehindActive(ocean, 'ocean', 'forest')).toBe(false);
        ocean.isPaused = false;
        expect(manager._canSwitchBehindActive(null, null, 'forest')).toBe(false);
    });
});
