/**
 * Rapid theme changes (Serenity's arrows, Random, a burst of picks) end on a theme that runs and
 * can be seen.
 *
 * The real ThemeManager and real BaseTheme subclasses whose scene takes 300 ms to build, with a fake
 * WebGPU backend so an in-play switch builds the incoming theme behind the playing one and
 * crossfades (as tests/unit/theme-switch-behind.test.js does).
 *
 * - Switching back to a theme still fading out from the last switch built a fresh instance in the
 *   same container; the old instance's delayed disposal then stopped, and hid, that container: the
 *   new theme ran behind a blank background until the next switch.
 * - A press made while the stepper's previous switch was still running was swallowed: that switch's
 *   completion took the newer target with it.
 * - A behind build that failed never ended its async-pipeline session.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import {
    isAsyncPipelineBackend,
    preloadAsyncRenderPipelines,
    resetAsyncRenderPipelinesForTests,
} from '../../src/rendering/async-render-pipelines.js';
import { DELAY_MS, SerenityWorldStepper } from '../../src/ui/serenity-mode/serenity-world-stepper.js';

const FRAME_MS = 16;

class FakeWebGPUBackend {
    constructor(renderer) {
        this.isWebGPUBackend = true;
        this.renderer = renderer;
        this.data = new WeakMap();
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
            promises.push(new Promise((resolve) => {
                setTimeout(() => { pipelineData.pipeline = { ready: true }; resolve(); }, 50);
            }));
            return;
        }
        pipelineData.pipeline = { ready: true };
    }
}

function element(id) {
    const names = new Set();
    return {
        id,
        children: [],
        dataset: {},
        style: { removeProperty() {}, setProperty() {} },
        classList: {
            add: (name) => names.add(name),
            remove: (name) => names.delete(name),
            contains: (name) => names.has(name),
        },
        appendChild(child) { this.children.push(child); },
        insertBefore(child) { this.children.push(child); },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); },
        contains(child) { return this.children.includes(child); },
        setAttribute() {},
        getAttribute() { return null; },
        get firstChild() { return this.children[0] || null; },
    };
}

let containers;

/** Whether the theme's registry-owned container is the one shown. */
const shown = (name) => containers.get(`${name}-theme`)?.classList.contains('active') === true;

beforeEach(async () => {
    vi.useFakeTimers();
    containers = new Map();
    vi.stubGlobal('document', {
        hidden: false,
        getElementById(id) {
            if (!containers.has(id) && id.endsWith('-theme')) containers.set(id, element(id));
            return containers.get(id) || null;
        },
        querySelectorAll: (selector) => (selector === '.theme-container' ? [...containers.values()] : []),
        createElement: () => element('div'),
        body: element('body'),
        addEventListener() {},
        removeEventListener() {},
    });
    vi.stubGlobal('window', {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search: '' },
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), FRAME_MS));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    await preloadAsyncRenderPipelines(() => ({ WebGPUBackend: FakeWebGPUBackend }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await preloadAsyncRenderPipelines(() => null);
    resetAsyncRenderPipelinesForTests();
});

/** @param {string} name @param {{ startMs?: number, fail?: boolean }} [options] */
function themeClass(name, { startMs = 300, fail = false } = {}) {
    return class FakeTheme extends BaseTheme {
        constructor() {
            super(name);
        }

        async createScene() {
            await new Promise((resolve) => { setTimeout(resolve, startMs); });
            if (fail) throw new Error(`${name} could not build`);
            const renderer = {
                render() {}, dispose() {}, setAnimationLoop() {}, domElement: null,
            };
            renderer.backend = new FakeWebGPUBackend(renderer);
            this.renderer = renderer;
            this.scene = { children: [{ id: 1 }, { id: 2 }, { id: 3 }] };
            this.camera = {};
        }
    };
}

/** @param {(id: string) => { startMs?: number, fail?: boolean }} [optionsFor] */
function makeManager(optionsFor = () => ({})) {
    vi.spyOn(ThemeManager.prototype, 'initializeRegistry').mockImplementation(() => {});
    const shared = { cleanup: vi.fn(), clearThemeResources: vi.fn(), loadTheme: vi.fn() };
    const manager = new ThemeManager(shared, { assetManager: {}, audioManager: null });
    THEME_REGISTRY.forEach(({ id }) => {
        manager.themeRegistry.set(id, async () => ({ default: themeClass(id, optionsFor(id)) }));
    });
    // As main.js does once boot's deferred services are ready.
    manager.releaseStartupPreload(0);
    manager.themesSuspended = false;
    return manager;
}

async function advance(ms) {
    for (let t = 0; t < ms; t += FRAME_MS) {
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(FRAME_MS);
    }
}

/** A theme playing, as the player sees it before the presses. */
async function playing(manager, name) {
    const switched = manager.switchTheme(name);
    await advance(500);
    await switched;
    expect(manager.activeThemeName).toBe(name);
    expect(shown(name)).toBe(true);
}

/** What the player sees in the end: the active theme running, in its container, shown. */
function onScreen(manager) {
    const theme = manager.activeTheme;
    return {
        name: manager.activeThemeName,
        running: Boolean(theme?.isActive === true && theme.lifecycleState === 'running'),
        shown: theme ? shown(manager.activeThemeName) : false,
        switching: manager.isTransitioning,
    };
}

describe('rapid theme changes', () => {
    it('shows a theme switched back to while it is still fading out', async () => {
        const manager = makeManager();
        await playing(manager, 'ocean');

        const toForest = manager.switchTheme('forest');
        await advance(700);
        await toForest;
        const backToOcean = manager.switchTheme('ocean'); // inside the crossfade
        await advance(700);
        await backToOcean;
        await advance(3000); // past every fade-out

        expect(onScreen(manager)).toEqual({
            name: 'ocean', running: true, shown: true, switching: false,
        });
    });

    it('ends on a theme that can be seen after a back-and-forth burst (Random with two themes)', async () => {
        const manager = makeManager();
        await playing(manager, 'forest');
        const outcomes = [];
        for (const name of ['ocean', 'forest', 'ocean', 'forest', 'ocean']) {
            outcomes.push(manager.switchTheme(name));
            // eslint-disable-next-line no-await-in-loop
            await advance(600);
        }
        await advance(4000);
        await Promise.all(outcomes);

        expect(onScreen(manager)).toEqual({
            name: 'ocean', running: true, shown: true, switching: false,
        });
    });

    it('takes an arrow press made while the previous step is still switching', async () => {
        const manager = makeManager();
        await playing(manager, 'forest');
        const asked = [];
        const switchTheme = manager.switchTheme.bind(manager);
        manager.switchTheme = (name, ...rest) => {
            asked.push(name);
            return switchTheme(name, ...rest);
        };
        const settled = [];
        const stepper = new SerenityWorldStepper({
            themeManager: manager,
            onSettled: (id, ok) => settled.push([id, ok]),
        });

        const first = stepper.step(1);
        await advance(DELAY_MS + 300); // its switch is building
        expect(manager.isTransitioning).toBe(true);
        const second = stepper.step(1); // the bar names the next one
        await advance(400); // the first switch finishes before the second press's delay is up
        await advance(DELAY_MS + 3000);

        expect(asked).toEqual([first, second]);
        expect(settled).toEqual([[second, true]]);
        expect(onScreen(manager)).toEqual({
            name: second, running: true, shown: true, switching: false,
        });
    });

    it('ends the async-pipeline session of a behind build that failed', async () => {
        const manager = makeManager((id) => ({ fail: id === 'galaxy' }));
        await playing(manager, 'aurora');
        const probe = new FakeWebGPUBackend({});

        const failed = manager.switchTheme('galaxy');
        await advance(1500);
        await failed;
        await advance(60000);

        expect(manager.activeThemeName).toBe('aurora');
        expect(shown('aurora')).toBe(true);
        // No session left behind: the async pipeline patch is uninstalled once none is active.
        expect(isAsyncPipelineBackend(probe)).toBe(false);
    });
});
