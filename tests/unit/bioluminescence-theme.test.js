/* eslint-disable max-classes-per-file */
/**
 * The Bioluminescence theme class against the world / post CONTRACT.
 *
 * The world (bioluminescence-world.js) and the post stack (bioluminescence-post.js) are replaced
 * here by small doubles that implement the public API the theme calls and record what they are
 * told, so this file tests the adapter — lifecycle, renderer selection, settings, the layout
 * watch, the frame order, capture flags, GPU-loss recovery — without compiling a shader. What the
 * grotto does with a lock or a clear is the world's own test file's business.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import BioluminescenceTheme from '../../src/themes/bioluminescence/bioluminescence-theme.js';
import { BIOLUMINESCENCE_TETROMINOS } from '../../src/themes/bioluminescence/bioluminescence-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/bioluminescence/bioluminescence-world.js';
import { POST_LOOK } from '../../src/themes/bioluminescence/bioluminescence-post.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';
import { normalizeQuality } from '../../src/utils/quality.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'bioluminescence',
);

const mocks = vi.hoisted(() => ({
    initialize: null,
    instances: [],
    surfaces: [],
    worlds: [],
    posts: [],
    passThroughs: [],
    failWorld: 0,
    failPost: 0,
    failPassThrough: 0,
}));
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
/**
 * The world double: the public API of BioluminescenceWorld and nothing else (there is no
 * loadTextures: the theme must not ask for one). Every call is logged by name, in order.
 */
vi.mock('../../src/themes/bioluminescence/bioluminescence-world.js', () => {
    const REST = Object.freeze({
        height: 1.5, pitch: 0.06, hFov: 82, minFov: 42, maxFov: 72, near: 0.25, far: 900,
    });
    const fov = (aspect) => {
        const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
        const v = (2 * Math.atan(Math.tan((REST.hFov * Math.PI) / 360) / a) * 180) / Math.PI;
        return Math.max(REST.minFov, Math.min(REST.maxFov, v));
    };
    class BioluminescenceWorld {
        constructor(params = {}) {
            if (mocks.failWorld > 0) {
                mocks.failWorld -= 1;
                throw new Error('world unavailable');
            }
            this.params = params;
            this.quality = params.quality ?? 'High';
            this.capture = params.capture === true;
            this.log = [];
            this.disposed = false;
            this.camera = null;
            this.parts = null;
            this.viewport = null;
            this.layout = null;
            this.layoutLive = false;
            this.layoutCalls = 0;
            this.reducedMotion = false;
            this.seeks = [];
            this.sessions = 0;
            this.time = 0;
            this.sim = null;
            this.cameraSim = null;
            this.combo = 0;
            this.level = 1;
            this.locks = [];
            this.clears = [];
            this.post = {
                heart: { x: 0.5, y: 0.62 }, flash: 0, kick: 0, bloomBoost: 0, exposure: 1,
            };
            mocks.worlds.push(this);
        }

        build() {
            this.log.push('build');
            return this;
        }

        bindCamera(camera) {
            this.log.push('bindCamera');
            this.camera = camera;
        }

        showOnlyParts(names) {
            this.log.push('showOnlyParts');
            this.parts = [...names];
        }

        setViewport(bufferWidth, bufferHeight, aspect) {
            this.log.push('setViewport');
            this.viewport = { bufferWidth, bufferHeight, aspect };
        }

        setLayout(rects) {
            this.log.push('setLayout');
            this.layoutCalls += 1;
            this.layout = rects;
            this.layoutLive = Boolean(rects);
        }

        setReducedMotion(reduced) {
            this.log.push('setReducedMotion');
            this.reducedMotion = reduced === true;
        }

        seek(time) {
            this.log.push('seek');
            this.seeks.push(time);
            this.time = time;
        }

        resetSession() {
            this.log.push('resetSession');
            this.sessions += 1;
        }

        updateCamera(camera, sim) {
            this.log.push('updateCamera');
            this.cameraSim = { camera, ...sim };
        }

        // The real world's frame takes the sim alone (the camera was bound once, and is handed
        // to updateCamera): anything more the theme passes is counted.
        update(sim, ...more) {
            this.log.push('update');
            this.sim = { ...sim };
            this.updateArity = 1 + more.length;
            this.time = sim.time;
        }

        // The director reuses its context objects: a sink copies what it keeps.
        onLock(c) {
            this.log.push('onLock');
            this.locks.push({ ...c, rows: [...c.rows] });
            this.post.kick = c.hardDrop ? 1 : 0.4;
        }

        onClear(c) {
            this.log.push('onClear');
            this.clears.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null });
        }

        onCombo(n) {
            this.log.push('onCombo');
            this.combo = n;
        }

        levelUp(level) {
            this.log.push('levelUp');
            this.level = level;
        }

        getPostState() {
            return this.post;
        }

        getState() {
            return {
                quality: this.quality,
                time: this.time,
                combo: this.combo,
                level: this.level,
                layoutLive: this.layoutLive,
                counts: { locks: this.locks.length, clears: this.clears.length },
            };
        }

        dispose() {
            this.log.push('dispose');
            this.disposed = true;
        }
    }
    return { BioluminescenceWorld, REST_RIG: REST, fovForAspect: fov };
});
/** The post double: the public API of BioluminescencePost and of the pass-through pipeline. */
vi.mock('../../src/themes/bioluminescence/bioluminescence-post.js', () => {
    const tiers = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
    const LOOK = Object.freeze(Object.fromEntries(tiers.map((name) => [name, Object.freeze({ name })])));
    class BioluminescencePost {
        constructor(renderer, scene, camera, params = {}) {
            if (mocks.failPost > 0) {
                mocks.failPost -= 1;
                throw new Error('pipeline unavailable');
            }
            this.renderer = renderer;
            this.scene = scene;
            this.camera = camera;
            this.look = params.look;
            this.falseColor = params.falseColor === true;
            this.values = {};
            this.updates = [];
            this.calm = { rects: [], strength: 0 };
            this.size = null;
            this.renders = 0;
            this.disposed = false;
            mocks.posts.push(this);
        }

        update(values = {}) {
            this.updates.push(values);
            Object.assign(this.values, values);
        }

        // The theme hands over a list it reuses every frame: copy it.
        setCalmRects(rects, strength) {
            this.calm = { rects: rects.map((r) => ({ ...r })), strength };
        }

        setSize(width, height, bufferWidth, bufferHeight) {
            this.size = {
                width, height, bufferWidth, bufferHeight,
            };
        }

        render() {
            this.renders += 1;
        }

        dispose() {
            this.disposed = true;
        }
    }
    const createPassThroughPipeline = (renderer, scene, camera) => {
        if (mocks.failPassThrough > 0) {
            mocks.failPassThrough -= 1;
            throw new Error('pipeline unavailable');
        }
        const pipeline = {
            renderer, scene, camera, render: vi.fn(), update() {}, setCalmRects() {}, setSize() {}, dispose: vi.fn(),
        };
        mocks.passThroughs.push(pipeline);
        return pipeline;
    };
    return { POST_LOOK: LOOK, BioluminescencePost, createPassThroughPipeline };
});
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
    const theme = new BioluminescenceTheme();
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
    const container = {
        replaceChildren: vi.fn(),
        appendChild: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    // What the layout watch finds on screen: nothing, until a test puts a board there.
    const page = { cards: [], canvas: null, hud: null };
    // The system's reduced-motion preference: one query object, so a test can flip it.
    const media = { matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() };
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
        getElementById: (id) => (id === 'bioluminescence-theme' ? container : null),
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
        container, listeners, media, page, win,
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

/** What the world was told during `run`, by name and in order. */
function told(world, run) {
    const from = world.log.length;
    run();
    return world.log.slice(from);
}

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The six tiers the game's quality setting names. */
const TIERS = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

/** The pixel-ratio cap each quality tier renders under (the render scale and DPR still apply). */
const PIXEL_RATIO_CAPS = [
    ['Minimal', 0.7], ['Low', 0.85], ['Medium', 1.0], ['High', 1.15], ['Ultra', 1.35], ['Extreme', 1.6],
];

describe('Bioluminescence theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
        mocks.surfaces.length = 0;
        mocks.worlds.length = 0;
        mocks.posts.length = 0;
        mocks.passThroughs.length = 0;
        mocks.failWorld = 0;
        mocks.failPost = 0;
        mocks.failPassThrough = 0;
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

    it('is registered under its id with its own icon', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'bioluminescence');
        expect(entry).toMatchObject({
            displayName: 'Bioluminescence',
            module: './bioluminescence/bioluminescence-theme.js',
            icon: './bioluminescence/bioluminescence-theme-icon.png',
        });
        expect(new BioluminescenceTheme().name).toBe('bioluminescence');
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        // The adapter stack; the world's modules join it as they are written.
        expect(names).toEqual(expect.arrayContaining([
            'bioluminescence-theme.js',
            'bioluminescence-director.js',
            'bioluminescence-composition.js',
            'bioluminescence-tetrominos.js',
        ]));
        for (const name of names) {
            const source = readFileSync(path.join(themeDir, name), 'utf8');
            expect(source, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source, name).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source, name).not.toMatch(/from 'three'/);
            // The theme it replaces drew through the classic composer and the classic Water.
            expect(source, name).not.toMatch(/EffectComposer|UnrealBloomPass|objects\/Water\.js/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source, name).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
        }
    });

    it('keeps the director and the composition free of three, the world and the post', () => {
        for (const name of ['bioluminescence-director.js', 'bioluminescence-composition.js']) {
            const source = readFileSync(path.join(themeDir, name), 'utf8');
            expect(source, name).not.toMatch(/from 'three/);
            expect(source, name).not.toMatch(/bioluminescence-(world|post|tsl)\.js/);
        }
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?biolumForceWebGL', '?biolumForceWebGL=true'])(
        'honours %s even when a GPU is present',
        async (search) => {
            stubBrowser({ gpu: true, search });
            const theme = createTheme();
            const renderer = await theme.createRenderer(theme.lifecycleGeneration);
            expect(mocks.instances).toHaveLength(1);
            expect(renderer.options.forceWebGL).toBe(true);
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
        expect(mocks.worlds).toHaveLength(0);
    });

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        const { renderer, world, post } = theme;
        expect(renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(renderer.domElement);
        expect(renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(renderer.domElement.style.cssText).toContain('pointer-events:none');
        expect(renderer.setClearColor).toHaveBeenCalledWith(0x010506, 1);
        // Tone mapping happens once, in the post stack.
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
        // The canvas only receives the output quad: the scene pass owns depth and MSAA.
        expect(renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });

        // One world, built for this tier on this renderer, told which camera draws it.
        expect(mocks.worlds).toEqual([world]);
        expect(world.params.scene).toBe(theme.scene);
        expect(world.params.renderer).toBe(renderer);
        expect(world.params.quality).toBe('High');
        expect(world.params.capture).toBe(false);
        expect(world.camera).toBe(theme.camera);
        expect(world.parts).toBeNull();
        // Sized and settled before the clock is set; the first frame's state is in place
        // before the loop starts.
        expect(world.log).toEqual([
            'build', 'bindCamera', 'setViewport', 'setReducedMotion', 'seek', 'updateCamera', 'update',
        ]);
        expect(world.seeks).toEqual([0]);
        // One post stack, in this tier's look, over the same scene and camera.
        expect(mocks.posts).toEqual([post]);
        expect(post.renderer).toBe(renderer);
        expect(post.scene).toBe(theme.scene);
        expect(post.camera).toBe(theme.camera);
        expect(post.look).toBe(POST_LOOK.High);
        expect(post.falseColor).toBe(false);
        expect(theme.passThrough).toBeNull();
        expect(mocks.passThroughs).toHaveLength(0);

        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(BIOLUMINESCENCE_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            pixelRatio: renderer.getPixelRatio(),
            droppedEvents: 0,
            reducedMotion: false,
            world: { quality: 'High', combo: 0, layoutLive: false },
        });
        // The camera stands on the rig the grotto is composed for.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 3);
        expect(theme.camera.aspect).toBeCloseTo(1280 / 720, 9);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(console.log).toHaveBeenCalledWith('[Bioluminescence] Scene ready (WebGPU, High)');
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.world.params.renderer).toBe(theme.renderer);
        expect(theme.post).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        // The post draws the frame, never the bare renderer; nothing uses compute.
        expect(theme.post.renders).toBe(1);
        expect(theme.renderer.render).not.toHaveBeenCalled();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        expect(mocks.surfaces).toHaveLength(0); // WebGL2 recovers through the context-restored restart
    });

    it.each(PIXEL_RATIO_CAPS)('builds the %s tier and caps its pixel ratio at %s', async (quality, cap) => {
        stubBrowser({ quality });
        const theme = createTheme();
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.quality).toBe(quality);
        expect(theme.world.getState().quality).toBe(quality);
        expect(theme.post.look).toBe(POST_LOOK[quality]);
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier the game names, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(TIERS);
        for (const name of TIERS) expect(normalizeQuality(name)).toBe(name);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('falls back to the High look and cap for a tier it does not know', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        theme.pendingQuality = 'Cinematic';
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post.look).toBe(POST_LOOK.High);
        expect(ratio).toHaveBeenCalledWith(1.15, 'theme');
    });

    it('loads nothing: the first frame waits for no asset', async () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const fetched = vi.fn();
        vi.stubGlobal('fetch', fetched);
        const { theme } = await startTheme({ quality: 'Low' });
        await Promise.resolve();
        expect(load).not.toHaveBeenCalled();
        expect(fetched).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
        expect(() => theme.stepFrame(16)).not.toThrow();
        // The class has no asset step left over from the theme it is modelled on.
        const source = readFileSync(path.join(themeDir, 'bioluminescence-theme.js'), 'utf8');
        expect(source).not.toMatch(/loadTextures|TextureLoader|GLTFLoader|\.load\(/);
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        const { passThrough } = theme;
        expect(passThrough).toBe(mocks.passThroughs[0]);
        expect(passThrough.renderer).toBe(theme.renderer);
        expect(passThrough.scene).toBe(theme.scene);
        expect(passThrough.camera).toBe(theme.camera);
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Post stack failed'), expect.any(Error));
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(passThrough.render).toHaveBeenCalledTimes(3);
        expect(theme.renderer.render).not.toHaveBeenCalled();
        // The world still runs under it.
        expect(theme.world.log.filter((name) => name === 'update')).toHaveLength(4);
        theme.disposeRuntime();
        expect(passThrough.dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose post stack and its fallback cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        mocks.failPassThrough = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Scene creation failed'), expect.any(Error));
        // The world that was already built is let go of.
        expect(mocks.worlds).toHaveLength(1);
        expect(mocks.worlds[0].disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.director).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('rejects a start whose world cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failWorld = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/world unavailable/);
        expect(mocks.posts).toHaveLength(0);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.camera).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // The next attempt starts clean.
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.world).toBe(mocks.worlds[0]);
        expect(theme.renderer).toBe(mocks.instances[1]);
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(world.getState().counts).toEqual({ locks: 0, clears: 0 }); // staged, not yet applied
        // The camera first (events aim through it), then the gameplay, then the world.
        expect(told(world, () => theme.stepFrame(16))).toEqual([
            'setLayout', 'updateCamera', 'onLock', 'onClear', 'onCombo', 'update',
        ]);
        expect(world.getState().counts).toEqual({ locks: 1, clears: 1 });
        expect(world.locks[0]).toMatchObject({
            hardDrop: false, color: BIOLUMINESCENCE_TETROMINOS.colors.T, rows: [18, 19], player: 0,
        });
        expect(world.combo).toBe(1);
        // A quiet frame is the camera and the world, nothing else.
        expect(told(world, () => theme.stepFrame(32))).toEqual(['updateCamera', 'update']);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(48);
        expect(world.locks).toHaveLength(1);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the grotto', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world, post } = theme;
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        const order = told(world, () => theme.stepFrame(16));
        expect(order.filter((name) => name !== 'setLayout')).toEqual([
            'updateCamera', 'levelUp', 'onLock', 'onClear', 'onCombo', 'update',
        ]);
        // One harder lock, in the piece's colour, at its column and row.
        expect(world.locks).toHaveLength(1);
        expect(world.locks[0]).toMatchObject({
            hardDrop: true, color: BIOLUMINESCENCE_TETROMINOS.colors.I, rows: [19], player: 0, screen: null,
        });
        expect(world.locks[0].u).toBeCloseTo(0.8, 6);
        expect(world.clears).toHaveLength(1);
        expect(world.clears[0]).toMatchObject({
            lines: 4, rows: [19, 18, 17, 16], combo: 1, cascade: 1, tspin: false, perfect: false, player: 0,
        });
        expect(world.level).toBe(3);
        expect(world.combo).toBe(1);
        // The post follows the grotto: what the world reports this frame, then the clock.
        expect(post.updates).toHaveLength(2);
        expect(post.updates[0]).toBe(world.getPostState());
        expect(post.updates[1]).toEqual({ time: theme.time });
        expect(post.values.kick).toBe(1);
        expect(post.values.heart).toBe(world.post.heart);
        expect(post.values.time).toBe(theme.time);
        expect(post.renders).toBe(1);
    });

    it('carries a T-spin and a perfect clear on the clear', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        theme.stepFrame(16);
        expect(theme.world.clears).toHaveLength(1);
        expect(theme.world.clears[0]).toMatchObject({
            lines: 2, tspin: true, b2b: true, perfect: true,
        });
    });

    it('wakes the grotto to the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(theme.world.combo).toBe(5);
        theme.reportCombo(0, 2);
        expect(theme.world.combo).toBe(2);
        theme.reportCombo(0, 1);
        expect(theme.world.combo).toBe(0);
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
        expect(theme.world.combo).toBe(3);
        // Each board's lock went to the world under its own player.
        expect(theme.world.locks.map((c) => c.player).sort()).toEqual([1, 1, 1, 2]);
    });

    it('keeps the grotto awake between a meditation mode\'s clicks, and lets it rest when they stop', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        const combos = vi.spyOn(world, 'onCombo');
        const click = (comboCount) => {
            const position = { x: 320, y: 540 };
            eventBus.emit(EVENTS.LINE_CLEAR, {
                lineCount: 2, clearedRows: [], cascadeCount: 1, comboCount, source: 'serenity-interaction', position,
            });
            eventBus.emit(EVENTS.COMBO, { comboCount, source: 'serenity-interaction', position });
        };
        click(3);
        stepFrames(theme, 1);
        expect(world.combo).toBe(3);
        // The click is a clear at the place it landed, with no board behind it.
        expect(world.clears).toHaveLength(1);
        expect(world.clears[0]).toMatchObject({ combo: 3, screen: { x: 320 / 1280, y: 540 / 720 } });
        expect(world.locks).toHaveLength(0);
        // A second of frames with nothing on the bus: the chain has not broken.
        stepFrames(theme, 60);
        expect(world.combo).toBe(3);
        expect(combos).toHaveBeenCalledTimes(1);
        click(4);
        stepFrames(theme, 1);
        expect(world.combo).toBe(4);
        // No more clicks: after the hold the world is told once that the chain is over.
        stepFrames(theme, 60);
        expect(world.combo).toBe(4);
        stepFrames(theme, 90);
        expect(world.combo).toBe(0);
        expect(combos.mock.calls.map(([n]) => n)).toEqual([3, 4, 0]);
        expect(theme.combos.size).toBe(0);
    });

    it('runs the director\'s hold on the wall clock, so it ends while a capture freezes the simulation', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?biolumTime=30' });
        eventBus.emit(EVENTS.LINE_CLEAR, {
            lineCount: 1, clearedRows: [], comboCount: 5, position: { x: 100, y: 100 },
        });
        stepFrames(theme, 1);
        expect(theme.world.combo).toBe(5);
        expect(theme.world.time).toBe(30);
        stepFrames(theme, 150);
        expect(theme.world.time).toBe(30);
        expect(theme.world.combo).toBe(0);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { world } = theme;
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(world.locks).toHaveLength(0);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(world.getState().counts).toEqual({ locks: 0, clears: 1 });
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(world.reducedMotion).toBe(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(world.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(world.reducedMotion).toBe(true);
        theme.handleSettingsChanged({ changed: { reducedMotion: 'off' } });
        expect(world.reducedMotion).toBe(false);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const saved = await startTheme({ quality: 'Low', settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.world.reducedMotion).toBe(true);
        expect(saved.theme.director.lockRipple).toBe(false);
        expect(saved.theme.director.enabled).toBe(true);
        saved.theme.disposeRuntime();

        const system = await startTheme({ quality: 'Low', reducedMotion: true });
        expect(system.theme.reducedMotion).toBe(true);
        expect(system.theme.world.reducedMotion).toBe(true);
        // The setting cannot switch off what the system asks for.
        system.theme.handleSettingsChanged({ detail: { reducedMotion: false } });
        expect(system.theme.world.reducedMotion).toBe(true);
        // The view does not lean: the world is handed a pointer at rest.
        system.listeners.get('pointermove')({ clientX: 1280, clientY: 0, pointerType: 'mouse' });
        stepFrames(system.theme, 30);
        expect(system.theme.world.cameraSim).toMatchObject({ pointerX: 0, pointerY: 0 });
    });

    it('follows the system\'s reduced-motion preference when it changes mid-run', async () => {
        const { theme, media } = await startTheme({ quality: 'Low' });
        expect(theme.world.reducedMotion).toBe(false);
        const [, onChange] = media.addEventListener.mock.calls.find(([type]) => type === 'change');
        media.matches = true;
        onChange();
        expect(theme.reducedMotion).toBe(true);
        expect(theme.world.reducedMotion).toBe(true);
        media.matches = false;
        onChange();
        expect(theme.world.reducedMotion).toBe(false);
        // Teardown stops listening to it.
        theme.disposeRuntime();
        expect(media.removeEventListener).toHaveBeenCalledWith('change', onChange, undefined);
    });

    it('puts the grotto back at rest when a run ends', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        const { world } = theme;
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(world.combo).toBe(3);
        // The chain is let go of first, then the world is told the run is over.
        expect(told(world, () => listeners.get('gameOver')())).toEqual(['onCombo', 'resetSession']);
        expect(world.sessions).toBe(1);
        expect(world.combo).toBe(0);
        expect(theme.combos.size).toBe(0);
        expect(theme.director.slots.every((slot) => !slot.assigned)).toBe(true);
        // The same world carries on: a run ending rebuilds nothing.
        expect(theme.world).toBe(world);
        expect(world.disposed).toBe(false);
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(64);
        expect(world.combo).toBe(1);
        expect(world.clears[world.clears.length - 1].combo).toBe(1);
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
        const firstPost = theme.post;
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later: wait for it.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.disposed).toBe(true);
        expect(firstPost.disposed).toBe(true);
        expect(theme.post.look).toBe(POST_LOOK.Minimal);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.locks).toHaveLength(1);
        expect(first.locks).toHaveLength(0);
    });

    it('reports a failed settings rebuild to the manager', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('rebuild failed');
        vi.spyOn(theme, 'createScene').mockRejectedValue(failure);
        theme.onRuntimeFailure = vi.fn();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await vi.waitFor(() => expect(theme.onRuntimeFailure).toHaveBeenCalledWith(failure));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Settings rebuild failed'), failure);
    });

    it('waits for the menu to close before rebuilding a paused theme', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.hasStarted = true;
        expect(theme.pause()).toBe(true);
        expect(theme.lastFrameMs).toBeNull();
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.rebuildPending).toBe(false);
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
        expect(world.disposed).toBe(false);
        expect(mocks.worlds).toHaveLength(1);
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        expect(world.viewport.aspect).toBeCloseTo(900 / 700, 9);
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the grotto, the post and the director', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const { renderer } = theme;
        renderer.setSize.mockClear();
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        theme.resize(800, 600);
        theme.resize(800, 600);
        theme.resize(800.4, 599.6); // the same size in whole pixels
        expect(renderer.setSize).toHaveBeenCalledTimes(1);
        expect(renderer.setSize).toHaveBeenCalledWith(800, 600, false);
        expect(theme.camera.aspect).toBeCloseTo(800 / 600, 9);
        const ratio = renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledTimes(1);
        expect(viewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
        // A bus resize that names no size reads the window.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, {});
        expect(renderer.setSize).toHaveBeenLastCalledWith(1280, 720, false);
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        expect(theme.world.viewport).toEqual({
            bufferWidth: Math.floor(1280 * 0.6), bufferHeight: Math.floor(720 * 0.6), aspect: 1280 / 720,
        });
        expect(theme.post.size).toEqual({
            width: 1280, height: 720, bufferWidth: Math.floor(1280 * 0.6), bufferHeight: Math.floor(720 * 0.6),
        });
    });

    it('follows a drawing buffer that something else resized', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 1);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const size = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 1);
        expect(viewport).not.toHaveBeenCalled();
        expect(size).not.toHaveBeenCalled();
        // The buffer changes under the theme (another system called setSize on its renderer).
        theme.renderer.size = { width: 640, height: 360 };
        stepFrames(theme, 1);
        const ratio = theme.renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledTimes(1);
        expect(viewport).toHaveBeenCalledWith(Math.floor(640 * ratio), Math.floor(360 * ratio), 1280 / 720);
        expect(size).toHaveBeenCalledWith(1280, 720, Math.floor(640 * ratio), Math.floor(360 * ratio));
        stepFrames(theme, 1);
        expect(viewport).toHaveBeenCalledTimes(1);
    });

    it('reads the board on frame time, aims the grotto at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const { world, post } = theme;
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        // Nothing on screen: the grotto aims at where the solo board would stand, the post is not calmed.
        stepFrames(theme, 2);
        expect(world.layoutCalls).toBe(1);
        expect(world.layout).toBeNull();
        expect(world.getState().layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(post.calm).toEqual({ rects: [], strength: 0 });
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);
        expect(manager.on).toHaveBeenCalledTimes(3);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(world.layoutCalls).toBe(1); // no polling: the next read is on a schedule
        expect(world.getState().layoutLive).toBe(false);
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(world.layoutCalls).toBe(2);
        expect(world.getState().layoutLive).toBe(true);
        expect(world.layout.cardCount).toBe(1);
        expect(world.layout.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        expect(theme.layout.applied).toBe(world.layout);
        // The calm zones ease in over the card and the HUD.
        expect(post.calm.rects).toEqual([
            {
                x0: 440 / 1280, y0: 40 / 720, x1: 840 / 1280, y1: 680 / 720,
            },
            {
                x0: 900 / 1280, y0: 200 / 720, x1: 1040 / 1280, y1: 520 / 720,
            },
        ]);
        const easing = post.calm.strength;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(post.calm.strength).toBeGreaterThan(0.99);
        // The layout is read again half a second and a second and a half after the trigger.
        expect(world.layoutCalls).toBe(4);
        // The manager is not subscribed to twice.
        expect(manager.on).toHaveBeenCalledTimes(3);
        // A lock lands while the board is up.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(world.locks).toHaveLength(1);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        manager.handlers.get('modeStopped')();
        expect(world.sessions).toBe(1);
        stepFrames(theme, 1);
        expect(world.layout).toBeNull();
        expect(world.getState().layoutLive).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(post.calm.rects[0].x1).toBeCloseTo(840 / 1280, 9);
        expect(post.calm.strength).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(post.calm.strength).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('calms the post over at most four cards and the HUD', async () => {
        const { theme, page } = await startTheme({ quality: 'High' });
        page.cards = [0, 1, 2, 3, 4].map((i) => box(20 + i * 250, 100, 200, 500));
        page.hud = box(600, 620, 140, 80);
        stepFrames(theme, 1);
        expect(theme.world.layout.cardCount).toBe(5);
        expect(theme.post.calm.rects).toHaveLength(5);
        expect(theme.post.calm.rects[3].x0).toBeCloseTo(770 / 1280, 9);
        expect(theme.post.calm.rects[4]).toEqual({
            x0: 600 / 1280, y0: 620 / 720, x1: 740 / 1280, y1: 700 / 720,
        });
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        expect(theme.world.cameraSim).toMatchObject({ pointerX: 0, pointerY: 0 });
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped; the world's camera and its update are handed the same lean.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(theme.world.cameraSim.pointerX).toBe(theme.pointer.sx);
        expect(theme.world.sim.pointerX).toBe(theme.pointer.sx);
        expect(theme.world.cameraSim.camera).toBe(theme.camera);
        expect(theme.world.updateArity).toBe(1);
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
        // The pointer leaves the window: `pointerout` reaches the window with nowhere to go to.
        // (`pointerleave` does not bubble: a window listener for it would never run.)
        expect(listeners.has('pointerleave')).toBe(false);
        const out = listeners.get('pointerout');
        move({ clientX: 900, clientY: 100 });
        out({ relatedTarget: null });
        expect(theme.pointer.x).toBe(0);
        move({ clientX: 900, clientY: 100 });
        out({});
        expect(theme.pointer.x).toBe(0);
        // Moving from one element to another inside the page is not leaving it.
        move({ clientX: 900, clientY: 100 });
        const there = theme.pointer.x;
        expect(there).not.toBe(0);
        out({ relatedTarget: { nodeName: 'CANVAS' } });
        expect(theme.pointer.x).toBe(there);
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
        const { theme } = await startTheme({
            quality: 'Low', search: '?biolumTime=42&biolumParts=pool,%20mushrooms&biolumFalseColor=1',
        });
        const { world, post } = theme;
        expect(theme.flags).toEqual({
            time: 42, fixedDt: null, parts: ['pool', 'mushrooms'], falseColor: true, forceWebGL: false,
        });
        expect(world.capture).toBe(true);
        // Only the named parts are drawn, and the post shows its debug view.
        expect(world.parts).toEqual(['pool', 'mushrooms']);
        expect(world.log.slice(0, 3)).toEqual(['build', 'bindCamera', 'showOnlyParts']);
        expect(post.falseColor).toBe(true);
        expect(world.seeks).toEqual([42]);
        expect(world.time).toBe(42);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(world.time).toBe(42);
        expect(world.sim).toMatchObject({ time: 42, delta: 0 });
        expect(post.values.time).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        expect(theme.layoutClock).toBeGreaterThan(0);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(world.locks).toHaveLength(1);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?biolumFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.time).toBeCloseTo(0.06, 12);
        expect(theme.world.sim.delta).toBe(0.02);
        // A step of a second or less is read as seconds, a larger one as milliseconds.
        stubBrowser({ search: '?biolumFixedDt=0.25' });
        expect(new BioluminescenceTheme().flags.fixedDt).toBe(0.25);
        stubBrowser({ search: '?biolumFixedDt=16.6667' });
        expect(new BioluminescenceTheme().flags.fixedDt).toBeCloseTo(1 / 60, 6);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?biolumTime=-3&biolumFixedDt=abc&biolumParts=&biolumFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(theme.world.parts).toBeNull();
        expect(theme.post.falseColor).toBe(false);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the grotto never jumps.
        theme.stepFrame(9000);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('does not answer to another theme\'s capture flags', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?lunaraTime=42&lunaraParts=sky&lunaraFalseColor=1&lunaraForceWebGL=1&gpu=1',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('bioluminescence');
        const lost = theme.world;
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBeTruthy();
        expect(theme.world).not.toBe(lost);
        expect(lost.disposed).toBe(true);
        expect(theme.world.params.renderer).toBe(mocks.instances[1]);
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        // A second loss is not retried: the coordinator routes out.
        await expect(registration.surface.recover()).rejects.toThrow(/already attempted/);
        expect(mocks.instances).toHaveLength(2);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        const { theme, win } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        const { world, post } = theme;
        const disposeWorld = vi.spyOn(world, 'dispose');
        const disposePost = vi.spyOn(post, 'dispose');
        const listening = win.addEventListener.mock.calls.length;
        expect(listening).toBeGreaterThan(0);
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(disposePost).toHaveBeenCalledOnce();
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        // Every window listener it added is removed again.
        expect(win.removeEventListener).toHaveBeenCalledTimes(listening);
        expect(cancelAnimationFrame).toHaveBeenCalled();
        for (const key of ['renderer', 'scene', 'camera', 'world', 'post', 'passThrough', 'director', 'modeManager']) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.isWebGPU).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({ world: null, pixelRatio: null, droppedEvents: 0 });
        // A late bus event, a late frame or a late resize after retirement is harmless.
        const quiet = world.log.length;
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
        }).not.toThrow();
        expect(world.log).toHaveLength(quiet);
        expect(post.renders).toBe(0);
    });

    it('keeps tearing down when the post or the world fails to dispose', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        vi.spyOn(theme.post, 'dispose').mockImplementation(() => { throw new Error('post stuck'); });
        vi.spyOn(theme.world, 'dispose').mockImplementation(() => { throw new Error('world stuck'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Post dispose failed'), expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('World dispose failed'), expect.any(Error));
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const { world } = theme;
        theme.lifecycleState = 'running';
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(world.disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(container.classList.remove).toHaveBeenCalledWith('active');
        expect(() => theme.stop()).not.toThrow();
        theme.cleanup();
        theme.cleanup();
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
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
        expect(mocks.worlds).toHaveLength(0); // nothing was built for the stale start
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('lets the newest of two overlapping starts win', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        let release = null;
        mocks.initialize = (renderer) => (renderer === mocks.instances[0]
            ? new Promise((resolve) => { release = resolve; })
            : undefined);
        const first = theme.createScene(theme.lifecycleGeneration);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        // A second build (a quality change, a recovery) starts while the first is still initialising.
        await theme.createScene(theme.lifecycleGeneration);
        const winner = theme.world;
        expect(theme.renderer).toBe(mocks.instances[1]);
        release();
        await first;
        // The late renderer is retired, never mounted over the running scene.
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.world).toBe(winner);
        expect(winner.disposed).toBe(false);
        expect(mocks.worlds).toEqual([winner]);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});

describe('Bioluminescence theme: the Settings URL reference', () => {
    const entries = URL_PARAMETER_CATALOG.filter((entry) => entry.scope === 'Bioluminescence');
    const partsEntry = entries.find((entry) => entry.name === 'biolumParts');

    it('documents every flag the theme reads, and no flag it does not', () => {
        const documented = entries.map((entry) => entry.name).sort();
        expect(documented).toEqual([
            'biolumFalseColor', 'biolumFixedDt', 'biolumForceWebGL', 'biolumParts', 'biolumTime',
        ]);
        // The catalog's own test sees only literal URLSearchParams reads; the theme reads most of
        // its flags through helpers, so the names are checked against its source here.
        const source = readFileSync(path.join(themeDir, 'bioluminescence-theme.js'), 'utf8');
        const read = [...new Set(source.match(/'biolum[A-Z]\w*'/g))].map((name) => name.slice(1, -1)).sort();
        expect(read).toEqual(documented);
        for (const entry of entries) {
            expect(entry.sources, entry.name).toContain('src/themes/bioluminescence/bioluminescence-theme.js');
        }
    });

    it('lists exactly the parts the world can draw, in the world\'s order', () => {
        // Read from the world's source, not its module: this file runs without the shaders.
        const world = readFileSync(path.join(themeDir, 'bioluminescence-world.js'), 'utf8');
        const literal = /const PARTS = \[([^\]]*)\]/.exec(world);
        expect(literal, 'bioluminescence-world.js names its parts in a PARTS array').toBeTruthy();
        const parts = literal[1].match(/'[^']+'/g).map((name) => name.slice(1, -1));
        expect(parts.length).toBeGreaterThan(0);
        const listed = partsEntry.values.replace('Comma-separated names: ', '').split(',').map((name) => name.trim());
        expect(listed, 'update the bioluminescence row of captureThemes in theme-parameters.js').toEqual(parts);
        expect(partsEntry.example).toBe(`biolumParts=${parts[0]}`);
        expect(partsEntry.sources).toContain('src/themes/bioluminescence/bioluminescence-world.js');
    });
});
