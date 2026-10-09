/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import StillwaterTheme from '../../src/themes/stillwater/stillwater-theme.js';
import { STILLWATER_TETROMINOS } from '../../src/themes/stillwater/stillwater-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/stillwater/stillwater-world.js';
import { POST_LOOK } from '../../src/themes/stillwater/stillwater-post.js';
import { THEME_REGISTRY, getThemeMeta } from '../../src/themes/theme-registry.js';
import { normalizeQuality } from '../../src/utils/quality.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'stillwater',
);
const themeSource = () => readFileSync(path.join(themeDir, 'stillwater-theme.js'), 'utf8');

/**
 * The theme is tested against the CONTRACT it calls its world, its post stack and its core by,
 * not against the real ones: the three modules are replaced whole, so this file passes whatever
 * state they are in (and before they exist). Each double has exactly the contract's methods, every
 * one a spy, so a call the contract does not name throws. What the real world does with these
 * calls belongs to its own tests.
 *
 * Each world and post built is recorded with what it was built from; `fail*` makes the next
 * construction throw; `gameOverHook: false` builds a world without the optional onGameOver;
 * `prepare` stands in for the load of the world's assets (it is handed the world, and what it
 * returns or throws is what that world's prepare() does; left null, the assets are in at once).
 */
const mocks = vi.hoisted(() => {
    const state = {
        initialize: null,
        prepare: null,
        instances: [],
        surfaces: [],
        worlds: [],
        rigs: [],
        posts: [],
        passThroughs: [],
        failWorld: 0,
        failPost: 0,
        failPassThrough: 0,
        gameOverHook: true,
        /** Every call the theme makes on its world, `build` first (it is chained on the constructor). */
        WORLD_CONTRACT: [
            'build', 'prepare', 'bindCamera', 'showOnlyParts', 'setReducedMotion', 'setViewport', 'setLayout',
            'updateCamera', 'update', 'seek', 'onLock', 'onClear', 'onCombo', 'levelUp', 'resetSession',
            'getPostState', 'getState', 'dispose',
        ],
        /** The one call the world may leave out. */
        WORLD_OPTIONAL: ['onGameOver'],
        POST_CONTRACT: ['setSize', 'setCalmRects', 'update', 'render', 'dispose'],
        PASS_THROUGH_CONTRACT: ['render', 'dispose'],
    };

    // The lens of a rig that holds its horizontal field of view: the theme takes the clip planes
    // from it and asks for the vertical field of view its frame needs.
    const rig = Object.freeze({ hFov: 68, near: 0.15, far: 1200 });
    const degrees = 180 / Math.PI;
    state.worldModule = {
        REST_RIG: rig,
        // Taller in an upright frame, within limits.
        fovForAspect: (aspect) => Math.max(30, Math.min(
            60,
            2 * Math.atan(Math.tan(rig.hFov / degrees / 2) / aspect) * degrees,
        )),
        StillwaterWorld: class {
            constructor(params) {
                if (state.failWorld > 0) {
                    state.failWorld -= 1;
                    throw new Error('world unavailable');
                }
                state.WORLD_CONTRACT.forEach((name) => { this[name] = vi.fn(); });
                if (state.gameOverHook) state.WORLD_OPTIONAL.forEach((name) => { this[name] = vi.fn(); });
                this.build.mockImplementation(() => this);
                // The world's assets: in at once, unless a test stands in for the load.
                this.prepare.mockImplementation(() => (state.prepare
                    ? state.prepare(this)
                    : Promise.resolve(true)));
                // The camera as the theme hands it over, before any rig moves it.
                this.bindCamera.mockImplementation((camera) => {
                    state.rigs.push({
                        fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
                    });
                });
                // The director reuses the objects it hands over: a world copies what it keeps.
                this.locks = [];
                this.clears = [];
                this.onLock.mockImplementation((c) => { this.locks.push({ ...c, rows: [...c.rows] }); });
                this.onClear.mockImplementation((c) => {
                    this.clears.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null });
                });
                this.postState = Object.freeze({ fromTheWorld: true });
                this.getPostState.mockImplementation(() => this.postState);
                this.getState.mockImplementation(() => ({
                    quality: params.quality, locks: this.locks.length, clears: this.clears.length,
                }));
                state.worlds.push({ world: this, params });
            }
        },
    };
    state.postModule = {
        POST_LOOK: Object.freeze(Object.fromEntries(
            ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'].map((tier) => [tier, Object.freeze({ tier })]),
        )),
        StillwaterPost: class {
            constructor(renderer, scene, camera, params) {
                if (state.failPost > 0) {
                    state.failPost -= 1;
                    throw new Error('post unavailable');
                }
                state.POST_CONTRACT.forEach((name) => { this[name] = vi.fn(); });
                state.posts.push({
                    post: this, renderer, scene, camera, params,
                });
            }
        },
        createPassThroughPipeline: (renderer, scene, camera) => {
            if (state.failPassThrough > 0) {
                state.failPassThrough -= 1;
                throw new Error('pass-through unavailable');
            }
            const pipeline = { renderer, scene, camera };
            state.PASS_THROUGH_CONTRACT.forEach((name) => { pipeline[name] = vi.fn(); });
            state.passThroughs.push(pipeline);
            return pipeline;
        },
    };
    state.coreModule = {
        /** Frame-rate independent easing: the share of the way to cover in `dt` seconds at `rate`. */
        approach: (rate, dt) => 1 - Math.exp(-rate * dt),
    };
    return state;
});
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL
                    ? { isWebGLBackend: true }
                    : { isWebGPUBackend: true, device: { limits: { maxColorAttachments: 8 } } };
                this.domElement = {
                    style: {}, setAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
                };
                this.pixelRatio = 1;
                this.size = { width: 1280, height: 720 };
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn((ratio) => { this.pixelRatio = ratio; });
                this.getPixelRatio = () => this.pixelRatio;
                this.setSize = vi.fn((width, height) => { this.size = { width, height }; });
                this.getDrawingBufferSize = (target) => target.set(
                    Math.floor(this.size.width * this.pixelRatio),
                    Math.floor(this.size.height * this.pixelRatio),
                );
                this.render = vi.fn();
                this.compute = vi.fn();
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
});
// Each double is registered under two spellings. Vitest keys a mock by the file it resolves to,
// and while that file does not exist, by the specifier as written: the path from this test only
// matches this test's own imports then, and the theme's `./…` import needs its own entry. With the
// file there, the first entry covers every importer and the second matches nothing.
vi.mock('../../src/themes/stillwater/stillwater-world.js', () => mocks.worldModule);
vi.mock('./stillwater-world.js', () => mocks.worldModule);
vi.mock('../../src/themes/stillwater/stillwater-post.js', () => mocks.postModule);
vi.mock('./stillwater-post.js', () => mocks.postModule);
vi.mock('../../src/themes/stillwater/stillwater-core.js', () => mocks.coreModule);
vi.mock('./stillwater-core.js', () => mocks.coreModule);
// The viewport broadcaster keeps the first window it saw; every test here stubs a new one.
vi.mock('../../src/utils/viewport.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));
vi.mock('../../src/utils/gpu-loss-coordinator.js', () => ({
    initGpuLossCoordinator: vi.fn(),
    registerGpuSurface: (label, surface) => {
        const registration = { label, surface, unregister: vi.fn() };
        mocks.surfaces.push(registration);
        return registration.unregister;
    },
}));

const owners = [];
function createTheme() {
    const theme = new StillwaterTheme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience');
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        try {
            await renderer.init();
            return renderer;
        } catch (error) {
            await theme.disposeRenderer(renderer, { nullInstance: false });
            throw error;
        }
    });
    owners.push(theme);
    return theme;
}

/** A DOM element double with a rect (CSS px). */
const box = (left, top, width, height) => ({
    getBoundingClientRect: () => ({
        left, top, right: left + width, bottom: top + height, width, height,
    }),
});

function stubBrowser({
    gpu = false, search = '', quality = 'Low', reducedMotion = false, settings = {},
} = {}) {
    const listeners = new Map();
    const mediaListeners = new Map();
    const container = {
        replaceChildren: vi.fn(),
        appendChild: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    // What the layout watch finds on screen: nothing, until a test puts a board there.
    const page = { cards: [], canvas: null, hud: null };
    // The system's reduced-motion preference: one query object, as a browser hands out.
    const media = {
        matches: reducedMotion,
        addEventListener: vi.fn((type, handler) => mediaListeners.set(type, handler)),
        removeEventListener: vi.fn(),
    };
    const win = {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search },
        settings: { effectQuality: quality, graphicsQuality: quality, ...settings },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => media,
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'stillwater-theme' ? container : null),
        querySelector: (selector) => {
            if (selector === '#main-game-canvas') return page.canvas;
            if (selector === '.single-player-stats-bar') return page.hud;
            return null;
        },
        querySelectorAll: (selector) => (selector === '.player-card[data-player]' ? page.cards : []),
    });
    vi.stubGlobal('navigator', gpu ? { gpu: {}, userAgent: 'Linux' } : {});
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return {
        container, listeners, media, mediaListeners, page, win,
    };
}

async function startTheme(options) {
    const browser = stubBrowser(options);
    const theme = createTheme();
    await theme.createScene(theme.lifecycleGeneration);
    return { theme, ...browser };
}

/** Run `frames` frames of 1/60 s from the theme's last frame time. */
function stepFrames(theme, frames) {
    let now = theme.lastFrameMs ?? 0;
    for (let i = 0; i < frames; i++) {
        now += 1000 / 60;
        theme.stepFrame(now);
    }
}

/**
 * Wait for a rebuild the theme started on its own (a microtask after a settings change): its
 * `count`-th world built AND the build finished. A world exists some turns before its build is
 * through, since the build waits for the world's assets in between.
 */
const whenRebuilt = (theme, count) => vi.waitFor(() => {
    expect(mocks.worlds).toHaveLength(count);
    expect(theme.director).toBeTruthy();
}, { timeout: 4000 });

/**
 * Stand in for the clock the wait for the world's assets runs on. `fire()` lets the time run out;
 * `set` and `clear` are the spies the theme's setTimeout / clearTimeout calls land on.
 */
function stubTimers() {
    const pending = new Map();
    let last = 100;
    const set = vi.fn((callback, ms) => {
        last += 1;
        pending.set(last, { callback, ms });
        return last;
    });
    const clear = vi.fn((id) => { pending.delete(id); });
    vi.stubGlobal('setTimeout', set);
    vi.stubGlobal('clearTimeout', clear);
    return {
        set,
        clear,
        pending,
        fire() {
            const [[id, timer]] = [...pending];
            pending.delete(id);
            timer.callback();
            return id;
        },
    };
}

/** A promise a test settles when it chooses. */
function deferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let every promise turn that is already due run (a macrotask later, the microtasks are drained). */
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

/** Where in the order of every spied call a spy's call fell (the last one by default). */
const callOrder = (spy, index = -1) => spy.mock.invocationCallOrder.at(index);
/** The arguments of a spy's last call. */
const lastCall = (spy) => spy.mock.calls.at(-1);

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The pixel-ratio cap each quality tier renders under (the render scale and DPR still apply). */
const PIXEL_RATIO_CAPS = [
    ['Minimal', 0.7], ['Low', 0.85], ['Medium', 1.0], ['High', 1.15], ['Ultra', 1.35], ['Extreme', 1.6],
];

describe('Stillwater theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.prepare = null;
        for (const list of ['instances', 'surfaces', 'worlds', 'rigs', 'posts', 'passThroughs']) mocks[list].length = 0;
        mocks.failWorld = 0;
        mocks.failPost = 0;
        mocks.failPassThrough = 0;
        mocks.gameOverHook = true;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const theme of owners.splice(0)) {
            theme._contextRestoreUnsub?.();
            theme._contextRestoreUnsub = null;
            theme.disposeRuntime();
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('is registered under its id with its own icon, as a heavy-GPU theme', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'stillwater');
        expect(entry).toMatchObject({
            displayName: 'Stillwater',
            module: './stillwater/stillwater-theme.js',
            icon: './stillwater/stillwater-theme-icon.png',
        });
        expect(getThemeMeta('stillwater')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
        const theme = new StillwaterTheme();
        expect(theme.name).toBe('stillwater');
        // The manager releases a heavy theme's GPU resources when it goes inactive. The class says
        // so itself, for a theme that is built without the manager.
        expect(theme.resourceProfile).toBe('heavy-gpu');
        // Each runtime owns its renderer: there is no pool shared between instances for the
        // manager to drain (the implementation this one replaces had one).
        expect(StillwaterTheme.disposeSharedResources).toBeUndefined();
        expect(themeSource()).not.toMatch(/^\s*static\s/m);
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        expect(names).toEqual(expect.arrayContaining(
            ['composition', 'director', 'tetrominos', 'theme'].map((part) => `stillwater-${part}.js`),
        ));
        // Every module in the folder, whoever wrote it and whenever it lands.
        for (const name of names) {
            const source = readFileSync(path.join(themeDir, name), 'utf8');
            expect(source, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source, name).not.toMatch(/EffectComposer|UnrealBloomPass|ShaderPass/);
            expect(source, name).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source, name).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source, name).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            // The world lives here and the playground effect mounts it, never the other way
            // round: nothing that ships imports from the playground.
            expect(source, name).not.toMatch(/from\s+['"][^'"]*\/playground\//);
        }
    });

    it('reaches its world, its post stack and its core only through their contract', () => {
        const source = themeSource();
        const imported = (part) => new RegExp(`import \\{([^}]+)\\} from '\\./stillwater-${part}\\.js'`)
            .exec(source)[1].split(',').map((name) => name.trim()).sort();
        expect(imported('world')).toEqual(['REST_RIG', 'StillwaterWorld', 'fovForAspect']);
        expect(imported('post')).toEqual(['POST_LOOK', 'StillwaterPost', 'createPassThroughPipeline']);
        expect(imported('core')).toEqual(['approach']);
        // Every method the theme calls on them is one the doubles above have: a new call here is a
        // change to the contract the real world and post stack are written to.
        const called = (object) => [...new Set(
            [...source.matchAll(new RegExp(`\\b${object}\\??\\.(\\w+)(?:\\?\\.)?\\(`, 'g'))].map((m) => m[1]),
        )].sort();
        expect(source).toMatch(/new StillwaterWorld\(\{[^}]+\}\)\.build\(\)/);
        expect(['build', ...called('world')].sort()).toEqual([...mocks.WORLD_CONTRACT, ...mocks.WORLD_OPTIONAL].sort());
        expect(called('post')).toEqual([...mocks.POST_CONTRACT].sort());
        expect(called('passThrough')).toEqual([...mocks.PASS_THROUGH_CONTRACT].sort());
        // The optional call is the only one made through `?.()`.
        expect([...source.matchAll(/\bworld\??\.(\w+)\?\.\(/g)].map((m) => m[1])).toEqual(mocks.WORLD_OPTIONAL);
        // The assets are asked for in one place, and of the rig only the clip planes are read.
        expect(source.match(/\.prepare\(/g)).toHaveLength(1);
        const rigFields = [...source.matchAll(/\bREST_RIG\.(\w+)/g)].map((m) => m[1]);
        expect([...new Set(rigFields)].sort()).toEqual(['far', 'near']);
        // And it is the doubles this file runs against, never the modules on disk.
        expect(REST_RIG).toBe(mocks.worldModule.REST_RIG);
        expect(fovForAspect).toBe(mocks.worldModule.fovForAspect);
        expect(POST_LOOK).toBe(mocks.postModule.POST_LOOK);
    });

    it('reads its five capture flags and the fleet\'s forceWebGL from the URL, and nothing else', () => {
        // The Settings reference documents a theme's URL flags and is checked against the names
        // its source reads. What is pinned here is that source: the flags it reads, each written
        // out as a literal the reference's own test can find, and no other way in.
        const own = ['FalseColor', 'FixedDt', 'ForceWebGL', 'Parts', 'Time'].map((flag) => `stillwater${flag}`);
        const source = themeSource();
        const read = [...source.matchAll(/\b(?:bool|num|params\.get|params\.has)\('(\w+)'\)/g)].map((m) => m[1]);
        expect([...new Set(read)].sort()).toEqual(['forceWebGL', ...own]);
        // One parse of the query string, in readFlags; every other read of `params` goes through
        // the two helpers, which take the name they are handed.
        expect(source.match(/new URLSearchParams\(/g)).toHaveLength(1);
        expect(source).toMatch(/new URLSearchParams\(window\.location\?\.search \|\| ''\)/);
        const reads = [...source.matchAll(/\bparams\.(\w+)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`);
        expect([...new Set(reads)].sort()).toEqual(["get('stillwaterParts')", 'get(k)', 'has(k)']);
        // The helpers are called with literals only: a computed name would escape the reference.
        const helperArguments = [...source.matchAll(/\b(?:bool|num)\(([^)]*)\)/g)].map((m) => m[1]);
        expect(helperArguments.length).toBeGreaterThan(0);
        for (const argument of helperArguments) expect(argument).toMatch(/^'\w+'$/);
        // Nothing reads the address any other way.
        expect(source.match(/\blocation\b/g)).toHaveLength(1);
        expect(source).not.toMatch(/\b(?:searchParams|location\.hash|location\.href|localStorage|sessionStorage)\b/);
        // The renderer switch takes the spellings the fleet's does.
        expect(source).toContain("['', '1', 'true', 'yes', 'on'].includes((params.get(k) || '').toLowerCase())");
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each([
        '?forceWebGL=1', '?stillwaterForceWebGL', '?stillwaterForceWebGL=true',
        '?stillwaterForceWebGL=on', '?stillwaterForceWebGL=YES',
    ])('honours %s even when a GPU is present', async (search) => {
        stubBrowser({ gpu: true, search });
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
    });

    it.each(['', '?stillwaterForceWebGL=0', '?forceWebGL=off', '?stillwaterForceWebGL=no'])(
        'starts on WebGPU with "%s" when a GPU is present',
        async (search) => {
            stubBrowser({ gpu: true, search });
            const theme = createTheme();
            const renderer = await theme.createRenderer(theme.lifecycleGeneration);
            expect(mocks.instances).toHaveLength(1);
            expect(renderer.options.forceWebGL).toBe(false);
            expect(renderer.options.powerPreference).toBe('high-performance');
        },
    );

    it('retries a failed native init on the WebGL2 backend with a fresh renderer', async () => {
        stubBrowser({ gpu: true });
        mocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Device unavailable');
        };
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(renderer).toBe(mocks.instances[1]);
        expect(renderer.options.forceWebGL).toBe(true);
    });

    it('reports a cancelled start as no renderer, never as a failure', async () => {
        stubBrowser({ gpu: true });
        const theme = createTheme();
        mocks.initialize = () => {
            theme.lifecycleGeneration += 1; // a newer start took over during init
            throw new Error('superseded');
        };
        await expect(theme.createRenderer(theme.lifecycleGeneration)).resolves.toBeNull();
        expect(mocks.instances).toHaveLength(1);
    });

    it('fails loudly when neither backend can start', async () => {
        stubBrowser({ gpu: true });
        mocks.initialize = () => { throw new Error('no adapter'); };
        const theme = createTheme();
        await expect(theme.createRenderer(theme.lifecycleGeneration)).rejects.toThrow(/WebGPU or WebGL2/);
    });

    it('fails a start that has nowhere to mount', async () => {
        stubBrowser();
        vi.stubGlobal('document', { getElementById: () => null });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/container not found/);
        expect(mocks.instances).toHaveLength(0);
    });

    it('builds the scene on its world and its post stack, and declares nothing to warm', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.renderer.domElement.id).toBe('stillwater-renderer');
        expect(theme.renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        // Pure black, opaque, set once by the theme and before the world is built (what the world
        // does with the clear colour for its own passes while it stands is the world's business).
        expect(theme.renderer.setClearColor).toHaveBeenCalledOnce();
        expect(callOrder(theme.renderer.setClearColor)).toBeLessThan(callOrder(mocks.worlds[0].world.build));
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x000000, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(theme.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
        // The canvas only receives the output quad: the post stack's scene pass owns depth.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });

        // One world, built from this scene, this renderer and this tier and nothing else; live.
        expect(mocks.worlds).toHaveLength(1);
        const [{ world, params }] = mocks.worlds;
        expect(theme.world).toBe(world);
        expect(world).toBeInstanceOf(mocks.worldModule.StillwaterWorld);
        expect(Object.keys(params).sort()).toEqual(['capture', 'quality', 'renderer', 'scene']);
        expect(params.scene).toBe(theme.scene);
        expect(params.scene).toBeInstanceOf(THREE.Scene);
        expect(params.renderer).toBe(theme.renderer);
        expect(params.quality).toBe('High');
        expect(params.capture).toBe(false);
        expect(world.build).toHaveBeenCalledOnce();
        expect(world.bindCamera).toHaveBeenCalledOnce();
        expect(world.bindCamera).toHaveBeenCalledWith(theme.camera);
        expect(world.showOnlyParts).not.toHaveBeenCalled();
        // Its assets are asked for once, and nothing is handed over with the request.
        expect(world.prepare).toHaveBeenCalledOnce();
        expect(world.prepare).toHaveBeenCalledWith();
        expect(console.warn).not.toHaveBeenCalled();
        expect(world.seek).toHaveBeenCalledOnce();
        expect(world.seek).toHaveBeenCalledWith(0);
        expect(world.levelUp).not.toHaveBeenCalled();
        // The camera is handed over standing on the rig the world is composed for.
        expect(theme.camera).toBeInstanceOf(THREE.PerspectiveCamera);
        expect(mocks.rigs).toEqual([{
            fov: fovForAspect(1280 / 720), aspect: 1280 / 720, near: REST_RIG.near, far: REST_RIG.far,
        }]);
        // The world is told its size and the motion setting before its first frame is laid out,
        // and that frame's state is in place before the loop starts: camera, then world.
        const buffer = [1280, 720].map((side) => Math.floor(side * theme.renderer.getPixelRatio()));
        expect(world.setViewport).toHaveBeenCalledOnce();
        expect(world.setViewport).toHaveBeenCalledWith(...buffer, 1280 / 720);
        expect(world.setReducedMotion).toHaveBeenCalledWith(false);
        expect(world.updateCamera).toHaveBeenCalledOnce();
        expect(world.update).toHaveBeenCalledOnce();
        expect(lastCall(world.updateCamera)[0]).toBe(theme.camera);
        expect(lastCall(world.updateCamera)[1]).toMatchObject({
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        });
        expect(lastCall(world.update)).toEqual([lastCall(world.updateCamera)[1], theme.camera]);
        // The assets come in between: after the world is built and bound, before it is laid out.
        const order = [
            'build', 'bindCamera', 'prepare', 'setViewport', 'setReducedMotion', 'seek', 'updateCamera', 'update',
        ].map((name) => callOrder(world[name]));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // Never from the build: the board is read on frame time.
        expect(world.setLayout).not.toHaveBeenCalled();

        // One post stack over that scene and camera, in the tier's look, told its size.
        expect(mocks.posts).toHaveLength(1);
        const [built] = mocks.posts;
        expect(theme.post).toBe(built.post);
        expect(built.post).toBeInstanceOf(mocks.postModule.StillwaterPost);
        expect(built.renderer).toBe(theme.renderer);
        expect(built.scene).toBe(theme.scene);
        expect(built.camera).toBe(theme.camera);
        expect(built.params).toEqual({ look: POST_LOOK.High, falseColor: false });
        expect(built.post.setSize).toHaveBeenCalledWith(1280, 720, ...buffer);
        expect(theme.passThrough).toBeNull();
        expect(mocks.passThroughs).toHaveLength(0);

        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(STILLWATER_TETROMINOS);
        const diagnostics = theme.getDiagnostics();
        expect(diagnostics).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            pixelRatio: theme.renderer.getPixelRatio(),
            droppedEvents: 0,
            reducedMotion: false,
        });
        expect(diagnostics.world).toEqual(world.getState());
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(console.log).toHaveBeenCalledWith('[Stillwater] Scene ready (WebGPU, High)');
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        expect(mocks.posts[0].params.look).toBe(POST_LOOK.High);
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.post.render).toHaveBeenCalledOnce();
        expect(theme.renderer.render).not.toHaveBeenCalled(); // the post stack draws, not the theme
        expect(mocks.surfaces).toHaveLength(0); // WebGL2 recovers through the context-restored restart
    });

    it.each(PIXEL_RATIO_CAPS)('builds the %s tier and caps its pixel ratio at %s', async (quality, cap) => {
        stubBrowser({ quality });
        const theme = createTheme();
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.quality).toBe(quality);
        expect(mocks.worlds[0].params.quality).toBe(quality);
        expect(POST_LOOK[quality]).toBeTruthy();
        expect(mocks.posts[0].params.look).toBe(POST_LOOK[quality]);
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier the game offers, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS).toHaveLength(6);
        for (const [quality] of PIXEL_RATIO_CAPS) expect(normalizeQuality(quality)).toBe(quality);
        expect(new Set(PIXEL_RATIO_CAPS.map(([quality]) => quality)).size).toBe(6);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('builds the tier the settings name however they spell it, and High when they name none', async () => {
        const spelt = await startTheme({ quality: ' ultra ' });
        expect(spelt.theme.quality).toBe('Ultra');
        expect(mocks.worlds[0].params.quality).toBe('Ultra');
        spelt.theme.disposeRuntime();
        const none = await startTheme({ settings: { effectQuality: undefined } });
        expect(none.theme.quality).toBe('High');
        expect(mocks.posts[1].params.look).toBe(POST_LOOK.High);
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(mocks.passThroughs).toHaveLength(1);
        const [passThrough] = mocks.passThroughs;
        expect(theme.passThrough).toBe(passThrough);
        expect(passThrough.renderer).toBe(theme.renderer);
        expect(passThrough.scene).toBe(theme.scene);
        expect(passThrough.camera).toBe(theme.camera);
        // With no post stack to do it, the renderer tone-maps.
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Post stack failed'), expect.any(Error));
        // The fallback stands: the world's assets are asked for all the same, and that is no warning.
        expect(theme.world.prepare).toHaveBeenCalledOnce();
        expect(console.warn).toHaveBeenCalledOnce();
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(passThrough.render).toHaveBeenCalledTimes(3);
        // The world still runs, with nothing to calm.
        expect(theme.world.update).toHaveBeenCalledTimes(4);
        theme.disposeRuntime();
        expect(passThrough.dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose world cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failWorld = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/world unavailable/);
        for (const key of ['world', 'renderer', 'scene', 'camera', 'post', 'passThrough', 'director']) {
            expect(theme[key], key).toBeNull();
        }
        expect(mocks.posts).toHaveLength(0);
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('[Stillwater] Scene creation failed:', expect.any(Error));
    });

    it('rejects a start that can build neither the post stack nor its fallback, and lets the world go', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        mocks.failPassThrough = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pass-through unavailable/);
        expect(mocks.worlds).toHaveLength(1);
        expect(mocks.worlds[0].world.dispose).toHaveBeenCalledOnce();
        // A world that is not going to be drawn is not asked to load anything.
        expect(mocks.worlds[0].world.prepare).not.toHaveBeenCalled();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        // Staged, not yet applied.
        expect(world.onLock).not.toHaveBeenCalled();
        expect(world.onClear).not.toHaveBeenCalled();
        theme.stepFrame(16);
        expect(world.onLock).toHaveBeenCalledOnce();
        expect(world.onClear).toHaveBeenCalledOnce();
        expect(world.onCombo).toHaveBeenLastCalledWith(1);
        // The camera first (events aim through it), then the gameplay, then the world.
        expect(callOrder(world.updateCamera)).toBeLessThan(callOrder(world.onLock));
        expect(callOrder(world.onLock)).toBeLessThan(callOrder(world.onClear));
        expect(callOrder(world.onClear)).toBeLessThan(callOrder(world.update));

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(world.onLock).toHaveBeenCalledOnce();
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the world', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world, post } = theme;
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(world.onLock).toHaveBeenCalledOnce();
        expect(world.locks[0]).toMatchObject({
            hardDrop: true, color: STILLWATER_TETROMINOS.colors.I, rows: [19], player: 0, screen: null,
        });
        expect(world.locks[0].u).toBeCloseTo(0.8, 6);
        expect(world.onClear).toHaveBeenCalledOnce();
        expect(world.clears[0]).toMatchObject({
            lines: 4, rows: [19, 18, 17, 16], combo: 1, cascade: 1, player: 0, screen: null,
        });
        expect(world.clears[0]).toMatchObject({ tspin: false, perfect: false, b2b: false });
        expect(world.onCombo).toHaveBeenLastCalledWith(1);
        // The level, with its ceremony, and remembered for a rebuild.
        expect(world.levelUp).toHaveBeenCalledOnce();
        expect(world.levelUp).toHaveBeenCalledWith(3);
        expect(theme.level).toBe(3);
        // The post follows the world (whatever it reports) and gets the clock for its grain.
        expect(post.update).toHaveBeenCalledTimes(2);
        expect(post.update).toHaveBeenNthCalledWith(1, world.postState);
        expect(post.update).toHaveBeenLastCalledWith({ time: theme.time });
        expect(post.render).toHaveBeenCalledOnce();
        expect(callOrder(world.update)).toBeLessThan(callOrder(post.update, 0));
        expect(callOrder(post.update)).toBeLessThan(callOrder(post.render));
    });

    it('carries a T-spin, a perfect clear and a back-to-back on the clear', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        theme.stepFrame(16);
        expect(theme.world.clears).toHaveLength(1);
        expect(theme.world.clears[0]).toMatchObject({
            lines: 2, rows: [19, 18], tspin: true, perfect: true, b2b: true,
        });
    });

    it('does not replay gameplay the world threw on', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world, post } = theme;
        world.onLock.mockImplementationOnce(() => { throw new Error('the world choked'); });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        // The frame is lost (the loop's guard counts it), the event is not kept for the next one.
        expect(() => theme.stepFrame(16)).toThrow(/the world choked/);
        expect(post.render).not.toHaveBeenCalled();
        expect(() => theme.stepFrame(32)).not.toThrow();
        expect(world.onLock).toHaveBeenCalledOnce();
        expect(post.render).toHaveBeenCalledOnce();
    });

    it('tells the world the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(world.onCombo).toHaveBeenLastCalledWith(5);
        theme.reportCombo(0, 2);
        expect(world.onCombo).toHaveBeenLastCalledWith(2);
        theme.reportCombo(0, 1);
        expect(world.onCombo).toHaveBeenLastCalledWith(0);
        // And through the bus: two boards, each with its own chain.
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: I, player: 1 });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], player: 1 });
            if (i === 0) {
                eventBus.emit(EVENTS.PIECE_LOCK, { piece: T, player: 2 });
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], player: 2 });
            }
            stepFrames(theme, 1);
        }
        expect(theme.combos.get(1)).toBe(3);
        expect(theme.combos.get(2)).toBe(1);
        expect(world.onCombo).toHaveBeenLastCalledWith(3);
        // Every board's locks and clears reached the world, each under its own player.
        expect(world.onLock).toHaveBeenCalledTimes(4);
        expect(world.onClear).toHaveBeenCalledTimes(4);
        expect(world.locks.map((c) => c.player)).toEqual([1, 2, 1, 1]);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(world.onLock).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(world.onLock).not.toHaveBeenCalled();
        expect(world.onClear).toHaveBeenCalledOnce();
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(true);
        // None of that is a reason to build a new world.
        expect(mocks.worlds).toHaveLength(1);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const saved = await startTheme({ quality: 'Low', settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.reducedMotion).toBe(true);
        expect(saved.theme.world.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(saved.theme.director.lockRipple).toBe(false);
        expect(saved.theme.director.enabled).toBe(true);
        saved.theme.disposeRuntime();

        const system = await startTheme({ quality: 'Low', reducedMotion: true });
        expect(system.theme.reducedMotion).toBe(true);
        // Told before its first frame was laid out.
        const { world } = system.theme;
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(callOrder(world.setReducedMotion)).toBeLessThan(callOrder(world.updateCamera, 0));
        // The setting cannot switch off what the system asks for.
        system.theme.handleSettingsChanged({ detail: { reducedMotion: false } });
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(true);
        // And the pointer does not lean a view that is to stand still.
        system.listeners.get('pointermove')({ clientX: 1280, clientY: 0, pointerType: 'mouse' });
        expect(system.theme.pointer).toMatchObject({ x: 0, y: 0 });
        // When the system's preference changes, the theme follows without a settings event.
        system.media.matches = false;
        system.mediaListeners.get('change')();
        expect(system.theme.reducedMotion).toBe(false);
        expect(world.setReducedMotion).toHaveBeenLastCalledWith(false);
    });

    it('lets the world mark the end of a run, then puts it back at rest', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        const { world } = theme;
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(world.onCombo).toHaveBeenLastCalledWith(3);
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        theme.stepFrame(64);
        expect(theme.level).toBe(4);
        // What the world can still see of the run when it is told the run is over.
        let seen = null;
        world.onGameOver.mockImplementation(() => {
            seen = { level: theme.level, chains: theme.combos.size, reset: world.resetSession.mock.calls.length };
        });
        listeners.get('gameOver')({ detail: { score: 1200 } });
        expect(world.onGameOver).toHaveBeenCalledOnce();
        expect(world.onGameOver).toHaveBeenCalledWith(); // the hook takes nothing
        expect(seen).toEqual({ level: 4, chains: 1, reset: 0 });
        // Then the chain is let go and the world is put back at rest, in that order.
        expect(world.onCombo).toHaveBeenLastCalledWith(0);
        expect(world.resetSession).toHaveBeenCalledOnce();
        expect(callOrder(world.onGameOver)).toBeLessThan(callOrder(world.onCombo));
        expect(callOrder(world.onCombo)).toBeLessThan(callOrder(world.resetSession));
        expect(theme.combos.size).toBe(0);
        expect(theme.level).toBe(0);
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(96);
        expect(world.onCombo).toHaveBeenLastCalledWith(1);
    });

    it('resets the session when the world has no ending to mark, and when its ending throws', async () => {
        mocks.gameOverHook = false;
        const bare = await startTheme({ quality: 'Low' });
        expect(bare.theme.world.onGameOver).toBeUndefined();
        bare.theme.level = 2;
        expect(() => bare.listeners.get('gameOver')()).not.toThrow();
        expect(bare.theme.world.resetSession).toHaveBeenCalledOnce();
        expect(bare.theme.level).toBe(0);
        bare.theme.disposeRuntime();

        mocks.gameOverHook = true;
        const failing = await startTheme({ quality: 'Low' });
        failing.theme.world.onGameOver.mockImplementation(() => { throw new Error('ending failed'); });
        failing.theme.level = 2;
        // The failure is not swallowed, and the run is still let go.
        expect(() => failing.listeners.get('gameOver')()).toThrow(/ending failed/);
        expect(failing.theme.world.resetSession).toHaveBeenCalledOnce();
        expect(failing.theme.level).toBe(0);
    });

    it('rebuilds on a quality change and not on an unrelated setting', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { musicVolume: 0.2 } });
        theme.handleSettingsChanged({ detail: { effectQuality: 'High' } }); // the tier it already has
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.pendingQuality).toBe('Low');
    });

    it('builds the new tier on a quality change', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        const first = theme.world;
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later: wait for it.
        await whenRebuilt(theme, 2);
        expect(theme.quality).toBe('Minimal');
        expect(mocks.worlds[1].params.quality).toBe('Minimal');
        expect(mocks.posts[1].params.look).toBe(POST_LOOK.Minimal);
        expect(theme.world).toBe(mocks.worlds[1].world);
        expect(theme.world).not.toBe(first);
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(mocks.posts[0].post.dispose).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once, on the world that is there now.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.onLock).toHaveBeenCalledOnce();
        expect(first.onLock).not.toHaveBeenCalled();
    });

    it('reports a rebuild that fails to the manager', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        theme.onRuntimeFailure = vi.fn();
        mocks.failWorld = 1;
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await vi.waitFor(() => expect(theme.onRuntimeFailure).toHaveBeenCalledOnce(), { timeout: 4000 });
        expect(theme.onRuntimeFailure.mock.calls[0][0].message).toMatch(/world unavailable/);
        expect(console.error).toHaveBeenCalledWith('[Stillwater] Settings rebuild failed:', expect.any(Error));
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
    });

    it('comes back from a rebuild in the middle of a run at the run\'s level', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        theme.stepFrame(16);
        expect(theme.world.levelUp).toHaveBeenCalledWith(4);
        win.settings.effectQuality = 'Low';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await whenRebuilt(theme, 2);
        // The new world takes up level 4 without the level-up's ceremony, before its first frame.
        const rebuilt = theme.world;
        expect(rebuilt.levelUp).toHaveBeenCalledOnce();
        expect(rebuilt.levelUp).toHaveBeenCalledWith(4, { silent: true });
        expect(callOrder(rebuilt.seek)).toBeLessThan(callOrder(rebuilt.levelUp));
        expect(callOrder(rebuilt.levelUp)).toBeLessThan(callOrder(rebuilt.update, 0));
        // Once the run has ended there is no level to come back to.
        theme.resetSession();
        await theme.createScene(theme.lifecycleGeneration);
        expect(mocks.worlds).toHaveLength(3);
        expect(theme.world.levelUp).not.toHaveBeenCalled();
    });

    // The night moves on by the clock whatever the level: a rebuild in place must not turn it back.
    it('keeps the night\'s clock across a rebuild in place, and forgets it when the theme stops', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        expect(theme.world.seek).toHaveBeenCalledWith(0);
        theme.time = 250; // some four minutes of drift: more than two hours of the night
        win.settings.effectQuality = 'Low';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await whenRebuilt(theme, 2);
        // The new world is found at the hour the old one had drifted to.
        expect(theme.world.seek).toHaveBeenCalledOnce();
        expect(theme.world.seek).toHaveBeenCalledWith(250);
        expect(theme.time).toBe(250);
        theme.stop();
        expect(theme.time).toBe(0);
    });

    it('builds the tier that is saved when the renderer is ready, not the one it set out with', async () => {
        const { win } = stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        let release = null;
        mocks.initialize = () => new Promise((resolve) => { release = resolve; });
        const building = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        // Nobody listens for settings while the renderer initialises: the change only reaches
        // the saved settings.
        win.settings.effectQuality = 'Low';
        release();
        await building;
        expect(theme.quality).toBe('Low');
        expect(mocks.worlds).toHaveLength(1);
        expect(mocks.worlds[0].params.quality).toBe('Low');
        expect(mocks.posts[0].params.look).toBe(POST_LOOK.Low);
    });

    it('asks for a restart, not a resume, when the tier changed behind the menu', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        theme.hasStarted = true;
        expect(theme.pause()).toBe(true);
        expect(theme.lastFrameMs).toBeNull();
        const build = vi.spyOn(theme, 'createScene');
        win.settings.effectQuality = 'Low';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        // Never behind the menu.
        expect(build).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);
        // The manager's quick resume is refused, and the theme does not rebuild on its own: the
        // manager restarts it, once.
        expect(theme.resume()).toBe(false);
        await Promise.resolve();
        expect(build).not.toHaveBeenCalled();
        expect(theme.isPaused).toBe(true);
        await theme.start(null);
        expect(build).toHaveBeenCalledTimes(1);
        expect(mocks.worlds).toHaveLength(2);
        expect(mocks.worlds[0].world.dispose).toHaveBeenCalledOnce();
        expect(mocks.worlds[1].params.quality).toBe('Low');
        expect(theme.quality).toBe('Low');
        expect(theme.rebuildPending).toBe(false);
        expect(theme.pendingQuality).toBeNull();
        expect(theme.lifecycleState).toBe('running');
        // After that a pause and a resume are just that.
        expect(theme.pause()).toBe(true);
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(build).toHaveBeenCalledTimes(1);
        expect(mocks.worlds).toHaveLength(2);
    });

    it('pauses and resumes without rebuilding, and catches up on a resize it missed', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        theme.hasStarted = true;
        const { world, renderer } = theme;
        stepFrames(theme, 2);
        expect(theme.pause()).toBe(true);
        expect(theme.pause()).toBe(false);
        expect(theme.lifecycleState).toBe('paused');
        win.innerWidth = 900;
        win.innerHeight = 700;
        expect(theme.resume()).toBe(true);
        expect(theme.world).toBe(world);
        expect(theme.renderer).toBe(renderer);
        expect(mocks.worlds).toHaveLength(1);
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        expect(lastCall(world.setViewport)[2]).toBeCloseTo(900 / 700, 12);
        // The manager restarts the loop after a resume: the theme's guard lets it.
        requestAnimationFrame.mockClear();
        theme.animate();
        theme.animate();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the world, the post and the director', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { renderer, world, post } = theme;
        renderer.setSize.mockClear();
        world.setViewport.mockClear();
        post.setSize.mockClear();
        theme.resize(800, 600);
        theme.resize(800, 600);
        theme.resize(800.4, 599.6); // the same size in whole pixels
        expect(renderer.setSize).toHaveBeenCalledTimes(1);
        expect(renderer.setSize).toHaveBeenCalledWith(800, 600, false);
        expect(theme.camera.aspect).toBeCloseTo(800 / 600, 9);
        const ratio = renderer.getPixelRatio();
        expect(world.setViewport).toHaveBeenCalledTimes(1);
        expect(world.setViewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post.setSize).toHaveBeenCalledTimes(1);
        expect(post.setSize).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        // Other code may resize the renderer behind the theme's back: the next frame follows the
        // buffer that is really there.
        renderer.pixelRatio = 0.5;
        theme.stepFrame(16);
        expect(world.setViewport).toHaveBeenLastCalledWith(512, 384, 1024 / 768);
        expect(post.setSize).toHaveBeenLastCalledWith(1024, 768, 512, 384);
        // Nonsense is clamped to a pixel.
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        const buffer = [Math.floor(1280 * 0.6), Math.floor(720 * 0.6)];
        expect(theme.world.setViewport).toHaveBeenLastCalledWith(...buffer, 1280 / 720);
        expect(theme.post.setSize).toHaveBeenLastCalledWith(1280, 720, ...buffer);
        expect(mocks.worlds).toHaveLength(1); // a new pixel ratio is not a new world
    });

    it('reads the board on frame time, aims the world at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const { world, post } = theme;
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        // Nothing on screen: the world aims at where the solo board would stand, the post is not calmed.
        expect(world.setLayout).not.toHaveBeenCalled(); // never from the build: on frame time
        stepFrames(theme, 2);
        expect(world.setLayout).toHaveBeenCalledOnce();
        expect(world.setLayout).toHaveBeenLastCalledWith(null, 1280 / 720);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(post.setCalmRects).toHaveBeenLastCalledWith([], 0);
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);
        expect(manager.on).toHaveBeenCalledTimes(3);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(world.setLayout).toHaveBeenCalledOnce(); // no polling: the next read is on a schedule
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(world.setLayout).toHaveBeenCalledTimes(2);
        const [rects, aspect] = lastCall(world.setLayout);
        expect(aspect).toBe(1280 / 720);
        expect(rects.cardCount).toBe(1);
        expect(rects.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(rects.boards[0].y1).toBeCloseTo(650 / 720, 9);
        expect(rects.hud.x1).toBeCloseTo(1040 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        expect(theme.layout.applied).toBe(rects);
        // The calm zones ease in over the card and the HUD.
        expect(lastCall(post.setCalmRects)[0]).toEqual([
            {
                x0: 440 / 1280, y0: 40 / 720, x1: 840 / 1280, y1: 680 / 720,
            },
            {
                x0: 900 / 1280, y0: 200 / 720, x1: 1040 / 1280, y1: 520 / 720,
            },
        ]);
        const easing = lastCall(post.setCalmRects)[1];
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(lastCall(post.setCalmRects)[1]).toBeGreaterThan(0.99);
        // It read again half a second and a second and a half after the mode started, and found
        // the same board.
        expect(world.setLayout).toHaveBeenCalledTimes(4);
        expect(lastCall(world.setLayout)[0].boards[0].x0).toBeCloseTo(490 / 1280, 9);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        manager.handlers.get('modeStopped')();
        expect(world.resetSession).toHaveBeenCalledOnce();
        expect(world.onGameOver).not.toHaveBeenCalled(); // a mode that is stopped is not a game over
        stepFrames(theme, 1);
        expect(world.setLayout).toHaveBeenLastCalledWith(null, 1280 / 720);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(lastCall(post.setCalmRects)[0][0].x1).toBeCloseTo(840 / 1280, 9);
        expect(lastCall(post.setCalmRects)[1]).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(lastCall(post.setCalmRects)[1]).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('calms the post over at most four cards and the HUD', async () => {
        const { theme, page } = await startTheme({ quality: 'Low' });
        page.cards = [0, 1, 2, 3, 4].map((i) => box(20 + i * 250, 100, 220, 500));
        page.hud = box(900, 620, 140, 80);
        stepFrames(theme, 1);
        const [zones] = lastCall(theme.post.setCalmRects);
        expect(lastCall(theme.world.setLayout)[0].cardCount).toBe(5);
        expect(zones).toHaveLength(5); // four cards and the HUD: the post's budget
        expect(zones[4].y0).toBeCloseTo(620 / 720, 9);
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped; and it is the eased lean the world's rig is given.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        const [camera, sim] = lastCall(theme.world.updateCamera);
        expect(camera).toBe(theme.camera);
        expect(sim.pointerX).toBe(theme.pointer.sx);
        expect(sim.pointerY).toBe(theme.pointer.sy);
        expect(lastCall(theme.world.update)).toEqual([sim, theme.camera]);
        move({ clientX: -400, clientY: 9000, pointerType: 'pen' });
        expect(theme.pointer).toMatchObject({ x: -1, y: 1 });
        // Each of these lets the view fall back to rest.
        move({ clientX: 900, clientY: 100, pointerType: 'touch' });
        expect(theme.pointer).toMatchObject({ x: 0, y: 0 });
        move({ clientX: 900, clientY: 100, pointerType: 'mouse' });
        move({ clientX: 900, clientY: 100, isPrimary: false });
        expect(theme.pointer.x).toBe(0);
        move({ clientX: 900, clientY: 100 });
        move({ clientX: NaN, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
        // The pointer leaving the page: a pointerout that names nowhere it went to. One between
        // two elements of the page is not that.
        move({ clientX: 900, clientY: 100 });
        listeners.get('pointerout')({ relatedTarget: {} });
        expect(theme.pointer.x).not.toBe(0);
        listeners.get('pointerout')({ relatedTarget: null });
        expect(theme.pointer.x).toBe(0);
        expect(listeners.has('pointerleave')).toBe(false); // never dispatched at the window
        move({ clientX: 900, clientY: 100 });
        listeners.get('blur')();
        expect(theme.pointer.x).toBe(0);
        theme.isPaused = true;
        move({ clientX: 900, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
        theme.isPaused = false;
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        move({ clientX: 900, clientY: 100 });
        expect(theme.pointer.x).toBe(0);
    });

    it('reads its capture flags from the URL and freezes the simulation on a fixed time', async () => {
        const parts = ['sky', 'water'];
        const { theme } = await startTheme({
            quality: 'Low',
            search: `?stillwaterTime=42&stillwaterParts=${parts.join(',%20')}&stillwaterFalseColor=1`,
        });
        expect(theme.flags).toEqual({
            time: 42, fixedDt: null, parts, falseColor: true, forceWebGL: false,
        });
        const { world, post } = theme;
        expect(mocks.worlds[0].params.capture).toBe(true);
        expect(mocks.posts[0].params.falseColor).toBe(true);
        // The names go to the world as they were written: which of them exist is the world's to say.
        expect(world.showOnlyParts).toHaveBeenCalledOnce();
        expect(world.showOnlyParts).toHaveBeenCalledWith(parts);
        expect(callOrder(world.bindCamera)).toBeLessThan(callOrder(world.showOnlyParts));
        // A capture waits for the world's assets like any other start: the frame it freezes has them.
        expect(callOrder(world.showOnlyParts)).toBeLessThan(callOrder(world.prepare));
        expect(callOrder(world.prepare)).toBeLessThan(callOrder(world.seek));
        expect(world.seek).toHaveBeenCalledWith(42);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.time).toBe(42);
        expect(lastCall(world.update)[0]).toMatchObject({ time: 42, delta: 0 });
        expect(post.update).toHaveBeenLastCalledWith({ time: 42 });
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        expect(world.setLayout).toHaveBeenCalled();
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(world.onLock).toHaveBeenCalledOnce();
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?stillwaterFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(mocks.worlds[0].params.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.time).toBeCloseTo(0.06, 12);
        expect(lastCall(theme.world.update)[0].delta).toBe(0.02);
        expect(lastCall(theme.world.update)[0].time).toBeCloseTo(0.06, 12);
        // A step of one or less is taken as seconds.
        stubBrowser({ search: '?stillwaterFixedDt=0.01' });
        expect(new StillwaterTheme().flags.fixedDt).toBe(0.01);
        // A fixed time wins over a fixed step: the frame stays frozen.
        const frozen = await startTheme({ search: '?stillwaterTime=3&stillwaterFixedDt=20' });
        frozen.theme.stepFrame(16);
        frozen.theme.stepFrame(32);
        expect(frozen.theme.time).toBe(3);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low',
            search: '?stillwaterTime=-3&stillwaterFixedDt=abc&stillwaterParts='
                + '&stillwaterFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(mocks.worlds[0].params.capture).toBe(false);
        expect(mocks.posts[0].params.falseColor).toBe(false);
        expect(theme.world.showOnlyParts).not.toHaveBeenCalled();
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the world never jumps.
        theme.stepFrame(9000);
        expect(theme.time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
        expect(lastCall(theme.world.update)[0].delta).toBeCloseTo(0.05, 12);
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('stillwater');
        theme.level = 2; // the run goes on across the loss
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(mocks.worlds).toHaveLength(2);
        expect(theme.world).toBe(mocks.worlds[1].world);
        expect(theme.world.levelUp).toHaveBeenCalledWith(2, { silent: true });
        expect(mocks.worlds[0].world.dispose).toHaveBeenCalledOnce();
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        // A second loss is not retried: the coordinator routes out.
        await expect(registration.surface.recover()).rejects.toThrow(/already attempted/);
        expect(mocks.instances).toHaveLength(2);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        const {
            theme, win, media,
        } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        const { world, post } = theme;
        const listening = win.addEventListener.mock.calls.length;
        expect(listening).toBeGreaterThan(0);
        expect(media.addEventListener).toHaveBeenCalledOnce();
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(post.dispose).toHaveBeenCalledOnce();
        // The post goes before the world it draws, and both before the device.
        expect(callOrder(post.dispose)).toBeLessThan(callOrder(world.dispose));
        expect(callOrder(world.dispose)).toBeLessThan(callOrder(theme.disposeRenderer));
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        // Every listener it added is removed again: the window's, and the reduced-motion query's.
        expect(win.removeEventListener).toHaveBeenCalledTimes(listening);
        expect(media.removeEventListener).toHaveBeenCalledOnce();
        expect(cancelAnimationFrame).toHaveBeenCalled();
        for (const key of ['renderer', 'scene', 'camera', 'world', 'post', 'passThrough', 'director', 'modeManager']) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.isWebGPU).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({ world: null, pixelRatio: null, droppedEvents: 0 });
        // A late bus event, a late frame or a late resize after retirement is harmless.
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
            theme.handleGameOver();
        }).not.toThrow();
        expect(world.onLock).not.toHaveBeenCalled();
        expect(world.resetSession).not.toHaveBeenCalled();
        expect(world.onGameOver).not.toHaveBeenCalled();
        expect(mocks.worlds).toHaveLength(1);
    });

    it('lets the world go even when the post stack fails to dispose, and the device after both', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { world, post } = theme;
        post.dispose.mockImplementation(() => { throw new Error('post stuck'); });
        world.dispose.mockImplementation(() => { throw new Error('world stuck'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith('[Stillwater] Post dispose failed:', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[Stillwater] World dispose failed:', expect.any(Error));
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.renderer).toBeNull();
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const { world } = theme;
        theme.lifecycleState = 'running';
        // A run in progress and a rebuild queued behind the menu, when the theme is stopped.
        theme.level = 3;
        theme.pendingQuality = 'High';
        theme.rebuildPending = true;
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(container.classList.remove).toHaveBeenCalledWith('active');
        // Neither is carried into the next start: it reads the saved tier and begins a new run.
        expect(theme.level).toBe(0);
        expect(theme.pendingQuality).toBeNull();
        expect(theme.rebuildPending).toBe(false);
        expect(() => theme.stop()).not.toThrow();
        theme.cleanup();
        theme.cleanup();
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(world.dispose).toHaveBeenCalledOnce();
        // A cleaned-up theme does not start again.
        await expect(theme.start(null)).rejects.toThrow(/cannot restart/);
    });

    it('drops a scene whose start was superseded while the renderer initialised', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        const generation = theme.lifecycleGeneration;
        mocks.initialize = () => { theme.lifecycleGeneration += 1; };
        await theme.createScene(generation);
        expect(theme.renderer).toBeNull();
        expect(theme.world).toBeNull();
        expect(mocks.worlds).toHaveLength(0);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('lets the newest of two overlapping starts win', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        let release = null;
        mocks.initialize = (renderer) => (renderer === mocks.instances[0]
            ? new Promise((resolve) => { release = resolve; })
            : undefined);
        // A tier queued for whichever build ends up current.
        theme.pendingQuality = 'Ultra';
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        // A second build (a quality change, a recovery) starts while the first is still initialising.
        await theme.createScene(theme.lifecycleGeneration);
        const winner = theme.world;
        expect(theme.renderer).toBe(mocks.instances[1]);
        // The build that was overtaken did not use up the queued tier: the one that stands has it.
        expect(mocks.worlds[0].params.quality).toBe('Ultra');
        expect(theme.pendingQuality).toBeNull();
        release();
        await first;
        // The late renderer is retired, never mounted over the running scene.
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.world).toBe(winner);
        expect(mocks.worlds).toHaveLength(1);
        expect(winner.dispose).not.toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    describe('the wait for the world\'s assets', () => {
        const RUNTIME_FIELDS = ['world', 'renderer', 'scene', 'camera', 'post', 'passThrough', 'director'];
        /** What a build does to its world once the assets are in. */
        const AFTER_THE_WAIT = ['setViewport', 'setReducedMotion', 'seek', 'updateCamera', 'update'];
        const sceneReadyLines = () => console.log.mock.calls.filter(([line]) => String(line).includes('Scene ready'));

        /** Start a build and hold it where it waits for its world's assets. */
        async function holdAtAssets(options = { gpu: true, quality: 'High' }, prime = null) {
            const browser = stubBrowser(options);
            const theme = createTheme();
            prime?.(theme);
            const load = deferred();
            mocks.prepare = () => load.promise;
            const building = theme.createScene(theme.lifecycleGeneration);
            await settle();
            const [{ world }] = mocks.worlds;
            expect(world.prepare).toHaveBeenCalledOnce();
            return {
                theme, load, building, world, post: mocks.posts[0].post, renderer: mocks.instances[0], ...browser,
            };
        }

        it('holds the build there: no director, no listener and no frame until they are in', async () => {
            const {
                theme, load, building, world, post, win,
            } = await holdAtAssets();
            // What stands when the assets are asked for: the world built and bound, the post stack
            // up, the device watched.
            expect(theme.world).toBe(world);
            expect(theme.post).toBe(post);
            expect(callOrder(world.build)).toBeLessThan(callOrder(world.bindCamera));
            expect(callOrder(world.bindCamera)).toBeLessThan(callOrder(world.prepare));
            expect(world.prepare).toHaveBeenCalledWith();
            expect(theme.setupRendererResilience).toHaveBeenCalledOnce();
            expect(mocks.surfaces).toHaveLength(1);
            // And what does not, until they are in.
            expect(theme.director).toBeNull();
            for (const name of [...AFTER_THE_WAIT, 'setLayout', 'levelUp']) {
                expect(world[name], name).not.toHaveBeenCalled();
            }
            expect(post.setSize).not.toHaveBeenCalled();
            expect(win.addEventListener).not.toHaveBeenCalled();
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            expect(sceneReadyLines()).toHaveLength(0);
            // Gameplay in the meantime has nobody to stage it, and is not kept for later.
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            // The manager restarts a theme's loop when the tab comes back, whatever the theme is
            // in the middle of: a runtime still waiting for its assets is not drawn, and is not
            // reported ready for a first frame.
            expect(theme.built).toBe(false);
            theme.restartRenderLoop();
            theme.animate();
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            expect(theme.animationLoopStarted).toBe(false);
            expect(await theme.whenCriticalReady()).toBe(false);
            for (const name of AFTER_THE_WAIT) expect(world[name], name).not.toHaveBeenCalled();

            load.resolve(true);
            await building;
            expect(theme.built).toBe(true);
            expect(await theme.whenCriticalReady()).toBe(true);
            expect(theme.director).toBeTruthy();
            expect(world.prepare).toHaveBeenCalledOnce();
            const order = ['prepare', ...AFTER_THE_WAIT].map((name) => callOrder(world[name], 0));
            expect(order).toEqual([...order].sort((a, b) => a - b));
            expect(win.addEventListener).toHaveBeenCalled();
            expect(requestAnimationFrame).toHaveBeenCalledOnce();
            expect(sceneReadyLines()).toHaveLength(1);
            expect(console.warn).not.toHaveBeenCalled();
            theme.stepFrame(16);
            expect(world.onLock).not.toHaveBeenCalled();
        });

        it('lays the scene out for the window as it stands once they are in', async () => {
            const {
                theme, load, building, world, win,
            } = await holdAtAssets({ quality: 'High' });
            // The camera was built for the frame the build set out in.
            expect(mocks.rigs).toHaveLength(1);
            expect(mocks.rigs[0].aspect).toBeCloseTo(1280 / 720, 12);
            // A resize that reaches the theme during the wait is followed there and then.
            theme.resize(1000, 500);
            expect(theme.renderer.setSize).toHaveBeenLastCalledWith(1000, 500, false);
            expect(lastCall(world.setViewport)[2]).toBe(2);
            // And the size the window has when the assets are in is the one the scene starts on,
            // not the one read before the wait.
            win.innerWidth = 900;
            win.innerHeight = 700;
            load.resolve(true);
            await building;
            expect(theme.renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
            expect(theme.camera.aspect).toBeCloseTo(900 / 700, 12);
            expect(lastCall(world.setViewport)[2]).toBeCloseTo(900 / 700, 12);
            expect(theme.director.viewportWidth).toBe(900);
            expect(theme.director.viewportHeight).toBe(700);
        });

        it('finds a tier that was saved meanwhile, and builds it next', async () => {
            const {
                theme, load, building, world: first, win,
            } = await holdAtAssets({ gpu: true, quality: 'High' });
            expect(mocks.worlds[0].params.quality).toBe('High');
            // Nobody listens for settings during the wait (the last runtime's listeners went with
            // it, this one's are not attached yet): the change only reaches the saved settings.
            win.settings.effectQuality = 'Low';
            mocks.prepare = null;
            load.resolve(true);
            await building;
            // The build it was on finished as it set out, and the tier is built next, once.
            expect(sceneReadyLines()).toEqual([['[Stillwater] Scene ready (WebGPU, High)']]);
            await whenRebuilt(theme, 2);
            expect(mocks.worlds[1].params.quality).toBe('Low');
            expect(mocks.posts[1].params.look).toBe(POST_LOOK.Low);
            expect(theme.quality).toBe('Low');
            expect(theme.world).toBe(mocks.worlds[1].world);
            expect(first.dispose).toHaveBeenCalledOnce();
            expect(theme.pendingQuality).toBeNull();
            await settle();
            expect(mocks.worlds).toHaveLength(2);
        });

        it('does not build a tier twice because the saved settings caught up with it meanwhile', async () => {
            // A tier an event named, queued for this build while the saved settings still held the
            // old one; they catch up during the wait.
            const {
                theme, load, building, win,
            } = await holdAtAssets(
                { gpu: true, quality: 'High' },
                (starting) => { starting.pendingQuality = 'Low'; },
            );
            expect(mocks.worlds[0].params.quality).toBe('Low');
            win.settings.effectQuality = 'Low';
            load.resolve(true);
            await building;
            await settle();
            expect(mocks.worlds).toHaveLength(1);
            expect(theme.quality).toBe('Low');
            expect(theme.pendingQuality).toBeNull();
            expect(theme.world.dispose).not.toHaveBeenCalled();
        });

        it.each([
            ['at once', () => Promise.resolve(true)],
            ['with nothing to wait for (no promise at all)', () => undefined],
        ])('lets go of its clock when the assets are in %s', async (_, prepare) => {
            const timers = stubTimers();
            stubBrowser({ gpu: true, quality: 'High' });
            const theme = createTheme();
            mocks.prepare = prepare;
            await theme.createScene(theme.lifecycleGeneration);
            // One timer, for 4 000 ms, cleared again.
            expect(timers.set).toHaveBeenCalledOnce();
            expect(timers.set).toHaveBeenCalledWith(expect.any(Function), 4000);
            expect(timers.clear).toHaveBeenCalledOnce();
            expect(timers.clear).toHaveBeenCalledWith(timers.set.mock.results[0].value);
            expect(timers.pending.size).toBe(0);
            expect(console.warn).not.toHaveBeenCalled();
            expect(theme.director).toBeTruthy();
        });

        it.each([
            ['reject', (failure) => () => Promise.reject(failure)],
            ['throw', (failure) => () => { throw failure; }],
        ])('survives assets that %s, with one warning', async (_, failing) => {
            const timers = stubTimers();
            stubBrowser({ gpu: true, quality: 'High' });
            const theme = createTheme();
            const failure = new Error('troll-lod1.glb: 404');
            mocks.prepare = failing(failure);
            await expect(theme.createScene(theme.lifecycleGeneration)).resolves.toBeUndefined();
            expect(console.warn).toHaveBeenCalledOnce();
            expect(console.warn).toHaveBeenCalledWith('[Stillwater] World assets failed to load (not fatal):', failure);
            // The build went on with the world as it stands: nothing was retired, the loop runs.
            const [{ world }] = mocks.worlds;
            expect(theme.world).toBe(world);
            expect(world.dispose).not.toHaveBeenCalled();
            expect(theme.disposeRenderer).not.toHaveBeenCalled();
            expect(theme.director).toBeTruthy();
            expect(world.update).toHaveBeenCalledOnce();
            expect(requestAnimationFrame).toHaveBeenCalledOnce();
            expect(sceneReadyLines()).toHaveLength(1);
            expect(await theme.whenCriticalReady()).toBe(true);
            expect(() => stepFrames(theme, 2)).not.toThrow();
            // The clock is let go of on this way out too.
            expect(timers.clear).toHaveBeenCalledWith(timers.set.mock.results[0].value);
            expect(timers.pending.size).toBe(0);
        });

        it.each([
            ['turn up late', (load) => load.resolve(true)],
            ['fail late', (load) => load.reject(new Error('troll-lod1.glb: connection reset'))],
            ['never come', () => {}],
        ])('goes on after 4 000 ms without assets that %s, with one warning', async (_, late) => {
            const timers = stubTimers();
            const {
                theme, load, building, world,
            } = await holdAtAssets();
            let finished = false;
            const done = building.then(() => { finished = true; });
            expect(timers.set).toHaveBeenCalledOnce();
            expect(timers.set).toHaveBeenCalledWith(expect.any(Function), 4000);
            await settle();
            expect(finished).toBe(false);
            expect(theme.director).toBeNull();
            expect(console.warn).not.toHaveBeenCalled();

            const id = timers.fire();
            await done;
            expect(finished).toBe(true);
            expect(console.warn).toHaveBeenCalledOnce();
            expect(console.warn).toHaveBeenCalledWith(
                '[Stillwater] World assets not ready after 4000 ms; no longer waiting.',
            );
            expect(timers.clear).toHaveBeenCalledWith(id);
            expect(timers.pending.size).toBe(0);
            // The build went on with the world as it stands.
            expect(theme.world).toBe(world);
            expect(world.dispose).not.toHaveBeenCalled();
            expect(theme.director).toBeTruthy();
            expect(requestAnimationFrame).toHaveBeenCalledOnce();
            expect(sceneReadyLines()).toHaveLength(1);
            // What the load does after that is the world's business: the theme says nothing more,
            // builds nothing again, and a late failure is nobody's unhandled rejection.
            late(load);
            await settle();
            expect(console.warn).toHaveBeenCalledOnce();
            expect(mocks.worlds).toHaveLength(1);
            expect(world.prepare).toHaveBeenCalledOnce();
            expect(() => stepFrames(theme, 2)).not.toThrow();
        });

        it('stands down when a newer build took over meanwhile: one runtime is left, the newer one', async () => {
            const {
                theme, load, building, world: stale, post: stalePost, renderer: staleRenderer,
            } = await holdAtAssets();
            // A second build (a new tier, a device loss) starts while the first waits; its assets
            // are in at once.
            mocks.prepare = null;
            await theme.createScene(theme.lifecycleGeneration);
            const {
                world: winner, director, renderer, post,
            } = theme;
            expect(winner).toBe(mocks.worlds[1].world);
            expect(renderer).toBe(mocks.instances[1]);
            expect(director).toBeTruthy();
            // It retired the runtime it overtook: world, post and renderer, each once.
            expect(stale.dispose).toHaveBeenCalledOnce();
            expect(stalePost.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(theme.disposeRenderer).toHaveBeenCalledWith(staleRenderer, { nullInstance: false });
            expect(requestAnimationFrame).toHaveBeenCalledOnce();

            load.resolve(true);
            await building;
            // The overtaken build found nothing of its own left and touched nothing: no second
            // director, no second loop, no second set of listeners, nothing disposed twice.
            expect(theme.world).toBe(winner);
            expect(theme.director).toBe(director);
            expect(theme.renderer).toBe(renderer);
            expect(theme.post).toBe(post);
            expect(requestAnimationFrame).toHaveBeenCalledOnce();
            expect(sceneReadyLines()).toHaveLength(1);
            expect(stale.dispose).toHaveBeenCalledOnce();
            expect(stalePost.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(winner.dispose).not.toHaveBeenCalled();
            expect(post.dispose).not.toHaveBeenCalled();
            for (const name of [...AFTER_THE_WAIT, 'levelUp', 'setLayout']) {
                expect(stale[name], name).not.toHaveBeenCalled();
            }
            // Exactly one live runtime: one world, one post stack, one renderer, one watched device.
            expect(mocks.worlds.filter(({ world }) => world.dispose.mock.calls.length === 0)).toHaveLength(1);
            expect(mocks.posts.filter((built) => built.post.dispose.mock.calls.length === 0)).toHaveLength(1);
            expect(mocks.instances).toHaveLength(2);
            expect(mocks.surfaces.filter(({ unregister }) => unregister.mock.calls.length === 0)).toHaveLength(1);
            // A lock lands once, on the world that stands.
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            theme.stepFrame(16);
            expect(winner.onLock).toHaveBeenCalledOnce();
            expect(stale.onLock).not.toHaveBeenCalled();
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('stands down when the theme was stopped meanwhile: nothing is left, nothing disposed twice', async () => {
            const {
                theme, load, building, world, post, renderer, win,
            } = await holdAtAssets();
            theme.stop();
            expect(world.dispose).toHaveBeenCalledOnce();
            expect(post.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(theme.disposeRenderer).toHaveBeenCalledWith(renderer, { nullInstance: false });

            load.resolve(true);
            await building;
            for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
            expect(world.dispose).toHaveBeenCalledOnce();
            expect(post.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
            for (const name of AFTER_THE_WAIT) expect(world[name], name).not.toHaveBeenCalled();
            expect(win.addEventListener).not.toHaveBeenCalled();
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            expect(sceneReadyLines()).toHaveLength(0);
            expect(mocks.worlds).toHaveLength(1);
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('does not leave a stopped build hanging on assets that never come', async () => {
            const timers = stubTimers();
            const { theme, building, world } = await holdAtAssets();
            let finished = false;
            const done = building.then(() => { finished = true; });
            theme.stop();
            await settle();
            // A stop clears the timers the theme tracks. The wait's own clock is not one of them:
            // it is still due, and it is what ends the build.
            expect(finished).toBe(false);
            expect(timers.pending.size).toBe(1);
            timers.fire();
            await done;
            expect(finished).toBe(true);
            expect(timers.pending.size).toBe(0);
            for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
            expect(world.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            expect(sceneReadyLines()).toHaveLength(0);
        });

        it('retires its own runtime when its start was superseded and nobody else retired it', async () => {
            stubBrowser({ gpu: true, quality: 'High' });
            const theme = createTheme();
            const generation = theme.lifecycleGeneration;
            // The lifecycle moves on during the wait, and nothing goes through disposeRuntime().
            mocks.prepare = () => {
                theme.lifecycleGeneration += 1;
                return Promise.resolve(true);
            };
            await theme.createScene(generation);
            const [{ world }] = mocks.worlds;
            const [{ post }] = mocks.posts;
            // The renderer is not left attached with a world nobody runs: the build takes its own
            // runtime down, once.
            expect(world.dispose).toHaveBeenCalledOnce();
            expect(post.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
            expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
            expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
            expect(theme.removeRendererResilience).toHaveBeenCalled();
            for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
            for (const name of AFTER_THE_WAIT) expect(world[name], name).not.toHaveBeenCalled();
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            expect(sceneReadyLines()).toHaveLength(0);
        });

        it('finishes a build that was paused meanwhile, and leaves its loop for the resume', async () => {
            const {
                theme, load, building, world,
            } = await holdAtAssets();
            theme.isPaused = true;
            load.resolve(true);
            await building;
            // Built and laid out, its first frame's state in place, but not running behind the menu.
            expect(theme.director).toBeTruthy();
            expect(world.update).toHaveBeenCalledOnce();
            expect(requestAnimationFrame).not.toHaveBeenCalled();
            theme.isPaused = false;
            theme.animate();
            expect(requestAnimationFrame).toHaveBeenCalledOnce();
        });

        it('reports the theme running only once they are in, and a start stopped meanwhile as stale', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            stubBrowser({ gpu: true, quality: 'High' });
            const theme = createTheme();
            theme.isActive = false; // a start from rest, through the lifecycle
            const load = deferred();
            mocks.prepare = () => load.promise;
            const starting = theme.start(null);
            await settle();
            expect(mocks.worlds[0].world.prepare).toHaveBeenCalledOnce();
            expect(theme.lifecycleState).toBe('starting');
            load.resolve(true);
            await expect(starting).resolves.toBeUndefined();
            expect(theme.lifecycleState).toBe('running');
            expect(theme.director).toBeTruthy();

            // The same start, stopped while it waits: it ends as a stale start (false), with the
            // runtime retired once by the stop and nothing left for the lifecycle's sweep.
            const again = deferred();
            mocks.prepare = () => again.promise;
            const restarting = theme.start(null);
            await settle();
            const second = mocks.worlds[1].world;
            expect(second.prepare).toHaveBeenCalledOnce();
            const disposals = theme.disposeRenderer.mock.calls.length;
            theme.stop();
            again.resolve(true);
            await expect(restarting).resolves.toBe(false);
            expect(theme.lifecycleState).toBe('stopped');
            expect(second.dispose).toHaveBeenCalledOnce();
            expect(theme.disposeRenderer).toHaveBeenCalledTimes(disposals + 1);
            for (const key of RUNTIME_FIELDS) expect(theme[key], key).toBeNull();
        });
    });
});
