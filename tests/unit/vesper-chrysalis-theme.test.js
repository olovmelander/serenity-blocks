/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import VesperChrysalisTheme from '../../src/themes/vesper-chrysalis/vesper-chrysalis-theme.js';
import { VESPER_CHRYSALIS_TETROMINOS } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';
import { POST_LOOK } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-post.js';
import { THEME_REGISTRY, getThemeMeta } from '../../src/themes/theme-registry.js';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';
import { normalizeQuality } from '../../src/utils/quality.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'vesper-chrysalis',
);
const themeSource = () => readFileSync(path.join(themeDir, 'vesper-chrysalis-theme.js'), 'utf8');

/**
 * The theme is tested against the CONTRACT it calls its world, its post stack and its core by,
 * not against the real ones: the three modules are replaced whole, so this file passes whatever
 * state they are in (and before they exist). Each double has exactly the contract's methods, every
 * one a spy, so a call the contract does not name throws. What the real world does with these
 * calls belongs to its own tests.
 *
 * Each world and post built is recorded with what it was built from; `fail*` makes the next
 * construction throw; `gameOverHook: false` builds a world without the optional onGameOver.
 */
const mocks = vi.hoisted(() => {
    const state = {
        initialize: null,
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
            'build', 'bindCamera', 'showOnlyParts', 'setReducedMotion', 'setViewport', 'setLayout', 'updateCamera',
            'update', 'seek', 'onLock', 'onClear', 'onCombo', 'levelUp', 'resetSession', 'getPostState', 'getState',
            'dispose',
        ],
        /** The one call the world may leave out. */
        WORLD_OPTIONAL: ['onGameOver'],
        POST_CONTRACT: ['setSize', 'setCalmRects', 'update', 'render', 'dispose'],
        PASS_THROUGH_CONTRACT: ['render', 'dispose'],
    };

    const rig = Object.freeze({ fov: 46, near: 0.5, far: 4000 });
    state.worldModule = {
        REST_RIG: rig,
        // Wider in an upright frame, as a rig built for a card in the middle of the picture is.
        fovForAspect: (aspect) => (aspect >= 1 ? rig.fov : rig.fov + (1 - aspect) * 30),
        VesperWorld: class {
            constructor(params) {
                if (state.failWorld > 0) {
                    state.failWorld -= 1;
                    throw new Error('world unavailable');
                }
                state.WORLD_CONTRACT.forEach((name) => { this[name] = vi.fn(); });
                if (state.gameOverHook) state.WORLD_OPTIONAL.forEach((name) => { this[name] = vi.fn(); });
                this.build.mockImplementation(() => this);
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
        VesperPost: class {
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
vi.mock('../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js', () => mocks.worldModule);
vi.mock('./vesper-chrysalis-world.js', () => mocks.worldModule);
vi.mock('../../src/themes/vesper-chrysalis/vesper-chrysalis-post.js', () => mocks.postModule);
vi.mock('./vesper-chrysalis-post.js', () => mocks.postModule);
vi.mock('../../src/themes/vesper-chrysalis/vesper-chrysalis-core.js', () => mocks.coreModule);
vi.mock('./vesper-chrysalis-core.js', () => mocks.coreModule);
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
    const theme = new VesperChrysalisTheme();
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
        getElementById: (id) => (id === 'vesper-chrysalis-theme' ? container : null),
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

describe('Vesper Chrysalis theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
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
        const entry = THEME_REGISTRY.find(({ id }) => id === 'vesper-chrysalis');
        expect(entry).toMatchObject({
            displayName: 'Vesper Chrysalis',
            module: './vesper-chrysalis/vesper-chrysalis-theme.js',
            icon: './vesper-chrysalis/vesper-chrysalis-theme-icon.png',
        });
        expect(getThemeMeta('vesper-chrysalis')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
        const theme = new VesperChrysalisTheme();
        expect(theme.name).toBe('vesper-chrysalis');
        // The manager releases a heavy theme's GPU resources when it goes inactive. The class says
        // so itself, for a theme that is built without the manager.
        expect(theme.resourceProfile).toBe('heavy-gpu');
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        expect(names).toEqual(expect.arrayContaining(
            ['composition', 'director', 'tetrominos', 'theme'].map((part) => `vesper-chrysalis-${part}.js`),
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
            // The theme this one replaces mounted the playground effect. The world lives here now
            // and the effect mounts it: nothing that ships imports from the playground.
            expect(source, name).not.toMatch(/from\s+['"][^'"]*\/playground\//);
        }
    });

    it('reaches its world, its post stack and its core only through their contract', () => {
        const source = themeSource();
        const imported = (part) => new RegExp(`import \\{([^}]+)\\} from '\\./vesper-chrysalis-${part}\\.js'`)
            .exec(source)[1].split(',').map((name) => name.trim()).sort();
        expect(imported('world')).toEqual(['REST_RIG', 'VesperWorld', 'fovForAspect']);
        expect(imported('post')).toEqual(['POST_LOOK', 'VesperPost', 'createPassThroughPipeline']);
        expect(imported('core')).toEqual(['approach']);
        // Every method the theme calls on them is one the doubles above have: a new call here is a
        // change to the contract the real world and post stack are written to.
        const called = (object) => [...new Set(
            [...source.matchAll(new RegExp(`\\b${object}\\??\\.(\\w+)(?:\\?\\.)?\\(`, 'g'))].map((m) => m[1]),
        )].sort();
        expect(source).toMatch(/new VesperWorld\(\{[^}]+\}\)\.build\(\)/);
        expect(['build', ...called('world')].sort()).toEqual([...mocks.WORLD_CONTRACT, ...mocks.WORLD_OPTIONAL].sort());
        expect(called('post')).toEqual([...mocks.POST_CONTRACT].sort());
        expect(called('passThrough')).toEqual([...mocks.PASS_THROUGH_CONTRACT].sort());
        // The optional call is the only one made through `?.()`.
        expect([...source.matchAll(/\bworld\??\.(\w+)\?\.\(/g)].map((m) => m[1])).toEqual(mocks.WORLD_OPTIONAL);
        // And it is the doubles this file runs against, never the modules on disk.
        expect(REST_RIG).toBe(mocks.worldModule.REST_RIG);
        expect(fovForAspect).toBe(mocks.worldModule.fovForAspect);
        expect(POST_LOOK).toBe(mocks.postModule.POST_LOOK);
    });

    it('lists its URL flags in the Settings reference', () => {
        const own = ['FalseColor', 'FixedDt', 'ForceWebGL', 'Parts', 'Time'].map((flag) => `vesperChrysalis${flag}`);
        const listed = URL_PARAMETER_CATALOG
            .filter(({ category, scope }) => category === 'Themes' && scope === 'Vesper Chrysalis');
        expect(listed.map(({ name }) => name).sort()).toEqual(own);
        for (const entry of listed) {
            expect(entry.sources, entry.name).toContain('src/themes/vesper-chrysalis/vesper-chrysalis-theme.js');
        }
        // Every flag the theme reads from the URL is one of them (or the fleet's forceWebGL).
        const read = [...themeSource().matchAll(/\b(?:bool|num|params\.get|params\.has)\('(\w+)'\)/g)].map((m) => m[1]);
        expect([...new Set(read)].sort()).toEqual(['forceWebGL', ...own]);
        // The renderer switch is documented once, with the spellings the theme really accepts.
        const force = URL_PARAMETER_CATALOG.filter(({ name }) => name === 'vesperChrysalisForceWebGL');
        expect(force).toHaveLength(1);
        expect(force[0].values).toBe('1, true, yes, on, or an empty value; other values disable (case-insensitive)');
        // ?vesperChrysalisParts= takes the names the world gives its parts: the reference points
        // at the world for them, and its example is the first one.
        const parts = listed.find(({ name }) => name === 'vesperChrysalisParts');
        expect(parts.sources).toContain('src/themes/vesper-chrysalis/vesper-chrysalis-world.js');
        expect(parts.values).toMatch(/^Comma-separated names: \w+(, \w+)*$/);
        const partNames = parts.values.replace('Comma-separated names: ', '').split(', ');
        expect(new Set(partNames).size).toBe(partNames.length);
        expect(parts.example).toBe(`vesperChrysalisParts=${partNames[0]}`);
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
        '?forceWebGL=1', '?vesperChrysalisForceWebGL', '?vesperChrysalisForceWebGL=true',
        '?vesperChrysalisForceWebGL=on', '?vesperChrysalisForceWebGL=YES',
    ])('honours %s even when a GPU is present', async (search) => {
        stubBrowser({ gpu: true, search });
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
    });

    it.each(['', '?vesperChrysalisForceWebGL=0', '?forceWebGL=off', '?vesperChrysalisForceWebGL=no'])(
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
        expect(theme.renderer.domElement.id).toBe('vesper-chrysalis-renderer');
        expect(theme.renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        // Pure black, opaque: the world's mirror pass relies on it.
        expect(theme.renderer.setClearColor).toHaveBeenCalledOnce();
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
        expect(world).toBeInstanceOf(mocks.worldModule.VesperWorld);
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
        const order = ['build', 'bindCamera', 'setViewport', 'setReducedMotion', 'seek', 'updateCamera', 'update']
            .map((name) => callOrder(world[name]));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // Never from the build: the board is read on frame time.
        expect(world.setLayout).not.toHaveBeenCalled();

        // One post stack over that scene and camera, in the tier's look, told its size.
        expect(mocks.posts).toHaveLength(1);
        const [built] = mocks.posts;
        expect(theme.post).toBe(built.post);
        expect(built.post).toBeInstanceOf(mocks.postModule.VesperPost);
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
        expect(theme.getTetrominoConfig()).toBe(VESPER_CHRYSALIS_TETROMINOS);
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
        expect(console.log).toHaveBeenCalledWith('[VesperChrysalis] Scene ready (WebGPU, High)');
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
        expect(console.error).toHaveBeenCalledWith('[VesperChrysalis] Scene creation failed:', expect.any(Error));
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
            hardDrop: true, color: VESPER_CHRYSALIS_TETROMINOS.colors.I, rows: [19], player: 0, screen: null,
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
        await vi.waitFor(() => expect(mocks.worlds).toHaveLength(2), { timeout: 4000 });
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
        expect(console.error).toHaveBeenCalledWith('[VesperChrysalis] Settings rebuild failed:', expect.any(Error));
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
        await vi.waitFor(() => expect(mocks.worlds).toHaveLength(2), { timeout: 4000 });
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
        const parts = ['sky', 'lake'];
        const { theme } = await startTheme({
            quality: 'Low',
            search: `?vesperChrysalisTime=42&vesperChrysalisParts=${parts.join(',%20')}&vesperChrysalisFalseColor=1`,
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
        const { theme } = await startTheme({ quality: 'Low', search: '?vesperChrysalisFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(mocks.worlds[0].params.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.time).toBeCloseTo(0.06, 12);
        expect(lastCall(theme.world.update)[0].delta).toBe(0.02);
        expect(lastCall(theme.world.update)[0].time).toBeCloseTo(0.06, 12);
        // A step of one or less is taken as seconds.
        stubBrowser({ search: '?vesperChrysalisFixedDt=0.01' });
        expect(new VesperChrysalisTheme().flags.fixedDt).toBe(0.01);
        // A fixed time wins over a fixed step: the frame stays frozen.
        const frozen = await startTheme({ search: '?vesperChrysalisTime=3&vesperChrysalisFixedDt=20' });
        frozen.theme.stepFrame(16);
        frozen.theme.stepFrame(32);
        expect(frozen.theme.time).toBe(3);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low',
            search: '?vesperChrysalisTime=-3&vesperChrysalisFixedDt=abc&vesperChrysalisParts='
                + '&vesperChrysalisFalseColor=0',
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
        expect(registration.label).toBe('vesper-chrysalis');
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
        expect(console.warn).toHaveBeenCalledWith('[VesperChrysalis] Post dispose failed:', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[VesperChrysalis] World dispose failed:', expect.any(Error));
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
});
