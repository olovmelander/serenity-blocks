/* eslint-disable max-classes-per-file */
/**
 * Void Ember — the theme shell.
 *
 * The world and the post stack are replaced by doubles that keep exactly the contract the theme
 * relies on (the module exports and the methods it calls, with what it hands them), so this file
 * pins the shell: lifecycle, renderer choice, frame order, gameplay wiring, layout watch, settings,
 * capture flags and teardown. What the ember looks like and does is the world's own tests' subject.
 * The last block holds the real modules to the same contract (it needs no GPU: nothing is built).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import VoidEmberTheme from '../../src/themes/void-ember/void-ember-theme.js';
import { VOID_EMBER_TETROMINOS } from '../../src/themes/void-ember/void-ember-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/void-ember/void-ember-world.js';
import { POST_LOOK } from '../../src/themes/void-ember/void-ember-post.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'themes');
const themeDir = path.join(themesDir, 'void-ember');
const QUALITY_NAMES = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

/** The world's and the post stack's public contract: what VoidEmberTheme calls, plus restCamera(). */
const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'restCamera', 'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'getPostState', 'getState',
    'dispose',
];
const POST_METHODS = ['update', 'setCalmRects', 'setSize', 'render', 'dispose'];

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
    /** The order of what a frame does: world, sink and post calls by name. */
    log: [],
}));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        // Only the real post stack (the last block) builds one: nothing here has a GPU to render with.
        RenderPipeline: class {
            constructor() {
                this.render = vi.fn();
                this.dispose = vi.fn();
            }
        },
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
vi.mock('../../src/themes/void-ember/void-ember-world.js', () => {
    const rig = Object.freeze({ near: 0.5, far: 6000 });
    const fov = (aspect) => Math.max(24, Math.min(64, 72 / Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9)));
    class VoidEmberWorld {
        constructor({
            scene, quality = 'High', renderer = null, capture = false, seed,
        } = {}) {
            Object.assign(this, {
                scene, quality, renderer, capture, seed,
            });
            this.built = false;
            this.disposed = false;
            this.reducedMotion = false;
            this.time = 0;
            this.combo = 0;
            this.level = 1;
            this.aspect = 16 / 9;
            this.viewport = null;
            this.layout = null;
            this.layoutLive = false;
            this.parts = null;
            this.camera = null;
            this.seeks = [];
            this.sessions = 0;
            this.counts = { locks: 0, clears: 0 };
            this.locks = [];
            this.clears = [];
            this.levels = [];
            this.cameraSims = [];
            this.sims = [];
            this.postState = { flash: 0, kick: 0, exposure: 1 };
            /** What the post's heat haze reads. */
            this.noiseTexture = { isTexture: true, name: 'fbm' };
            mocks.worlds.push(this);
        }

        build() {
            if (mocks.failWorld > 0) {
                mocks.failWorld -= 1;
                throw new Error('world unavailable');
            }
            this.built = true;
            return this;
        }

        bindCamera(camera) {
            this.camera = camera;
        }

        showOnlyParts(names) {
            this.parts = [...names];
        }

        setViewport(bufferWidth, bufferHeight, aspect) {
            this.viewport = [bufferWidth, bufferHeight, aspect];
            this.aspect = aspect;
        }

        setLayout(rects, aspect) {
            this.layout = rects;
            this.layoutLive = Boolean(rects);
            if (aspect !== undefined) this.aspect = aspect;
        }

        setReducedMotion(reduced) {
            this.reducedMotion = reduced === true;
        }

        seek(time) {
            this.time = time;
            this.seeks.push(time);
        }

        resetSession() {
            this.sessions += 1;
            this.combo = 0;
            this.counts = { locks: 0, clears: 0 };
        }

        restCamera() {
            return this.camera;
        }

        updateCamera(camera, sim) {
            mocks.log.push('updateCamera');
            this.cameraSims.push({ camera, ...sim });
        }

        // The director reuses its context objects: a sink copies what it keeps.
        onLock(context) {
            mocks.log.push('onLock');
            this.counts.locks += 1;
            this.locks.push({ ...context, rows: [...context.rows] });
            this.postState.kick = context.hardDrop ? 0.5 : 0.1;
        }

        onClear(context) {
            mocks.log.push('onClear');
            this.counts.clears += 1;
            this.clears.push({ ...context, rows: [...context.rows] });
            this.postState.flash = 0.2 * context.lines;
        }

        onCombo(combo) {
            mocks.log.push('onCombo');
            this.combo = combo;
        }

        levelUp(level, options) {
            mocks.log.push('levelUp');
            this.level = level;
            this.levels.push([level, options]);
        }

        update(sim, camera) {
            mocks.log.push('update');
            this.time = sim.time;
            this.sims.push({ camera, reduced: this.reducedMotion, ...sim });
        }

        getPostState() {
            return this.postState;
        }

        getState() {
            return {
                quality: this.quality,
                time: this.time,
                combo: this.combo,
                level: this.level,
                counts: { ...this.counts },
                layoutLive: this.layoutLive,
            };
        }

        dispose() {
            this.disposed = true;
        }
    }
    return { VoidEmberWorld, REST_RIG: rig, fovForAspect: fov };
});
vi.mock('../../src/themes/void-ember/void-ember-post.js', () => {
    const look = Object.freeze(Object.fromEntries(
        ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'].map((tier) => [tier, Object.freeze({ tier })]),
    ));
    class VoidEmberPost {
        constructor(renderer, scene, camera, params = {}) {
            if (mocks.failPost > 0) {
                mocks.failPost -= 1;
                throw new Error('post unavailable');
            }
            Object.assign(this, {
                renderer, scene, camera, params,
            });
            this.state = {};
            this.updates = [];
            this.calm = { rects: [], strength: 0 };
            this.size = null;
            this.renders = 0;
            this.disposed = 0;
            mocks.posts.push(this);
        }

        update(state) {
            mocks.log.push('post.update');
            this.updates.push(state);
            Object.assign(this.state, state);
        }

        setCalmRects(rects, strength) {
            this.calm = { rects: rects.map((rect) => ({ ...rect })), strength };
        }

        setSize(width, height, bufferWidth, bufferHeight) {
            this.size = [width, height, bufferWidth, bufferHeight];
        }

        render() {
            mocks.log.push('post.render');
            this.renders += 1;
        }

        dispose() {
            this.disposed += 1;
        }
    }
    function createPassThroughPipeline(renderer, scene, camera) {
        if (mocks.failPassThrough > 0) {
            mocks.failPassThrough -= 1;
            throw new Error('pipeline unavailable');
        }
        const pipeline = {
            renderer, scene, camera, render: vi.fn(), dispose: vi.fn(),
        };
        mocks.passThroughs.push(pipeline);
        return pipeline;
    }
    return { POST_LOOK: look, VoidEmberPost, createPassThroughPipeline };
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
/** A theme nothing was started on (its bus subscriptions are still let go after the test). */
function bareTheme() {
    const theme = new VoidEmberTheme();
    owners.push(theme);
    return theme;
}

function createTheme() {
    const theme = new VoidEmberTheme();
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
    const win = {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search },
        settings: { effectQuality: quality, graphicsQuality: quality, ...settings },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'void-ember-theme' ? container : null),
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
        container, listeners, page, win,
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

describe('Void Ember theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
        mocks.surfaces.length = 0;
        mocks.worlds.length = 0;
        mocks.posts.length = 0;
        mocks.passThroughs.length = 0;
        mocks.log.length = 0;
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

    it('is registered under its id, with an icon that exists', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'void-ember');
        expect(entry).toMatchObject({
            displayName: 'Void Ember',
            module: './void-ember/void-ember-theme.js',
            icon: './void-ember/void-ember-theme-icon.png', // its own; it borrowed Black Hole's before
        });
        expect(existsSync(path.join(themesDir, entry.icon)), entry.icon).toBe(true);
        expect(bareTheme().name).toBe('void-ember');
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        const sources = names.map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(names).toEqual(expect.arrayContaining([
            'void-ember-theme.js', 'void-ember-director.js', 'void-ember-composition.js', 'void-ember-tetrominos.js',
        ]));
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
        }
    });

    it('leaves nothing of the theme it replaces: no raw WebGPU, no raw WebGL2, no conductor', () => {
        const left = readdirSync(themeDir);
        for (const gone of [
            'wgsl', 'glsl', 'post', 'rendering', 'sim', 'composition',
            'void-ember-presets.js', 'void-ember-uniforms.js', 'void-ember-webgl2.js',
        ]) {
            expect(left, gone).not.toContain(gone);
        }
        expect(left.filter((name) => /\.(wgsl|glsl)$/.test(name))).toEqual([]);
        const source = readFileSync(path.join(themeDir, 'void-ember-theme.js'), 'utf8');
        // An ordinary three theme: the manager's own async session covers its pipelines (ADR-0020).
        expect(source).not.toMatch(/buildsPipelinesAsync|create(Render|Compute)Pipeline(Async)?\s*\(/);
        expect(source).not.toMatch(/getContext\s*\(|localStorage|StellarConductor/);
        expect(Object.getOwnPropertyDescriptor(VoidEmberTheme.prototype, 'buildsPipelinesAsync')).toBeUndefined();
        expect(bareTheme().buildsPipelinesAsync).toBeUndefined();
    });

    it('lists its capture flags in the URL parameter reference, and only those', () => {
        const mine = THEME_URL_PARAMETERS.filter((entry) => entry.scope === 'Void Ember');
        expect(mine.map((entry) => entry.name).sort()).toEqual(
            ['voidEmberFalseColor', 'voidEmberFixedDt', 'voidEmberForceWebGL', 'voidEmberParts', 'voidEmberTime'],
        );
        const source = readFileSync(path.join(themeDir, 'void-ember-theme.js'), 'utf8');
        for (const entry of mine) {
            expect(entry.sources, entry.name).toContain('src/themes/void-ember/void-ember-theme.js');
            // The reference documents what the theme reads, under the name it reads it by.
            expect(source, entry.name).toContain(`'${entry.name}'`);
        }
        const parts = mine.find((entry) => entry.name === 'voidEmberParts');
        expect(parts.sources).toContain('src/themes/void-ember/void-ember-world.js');
        // The debug overlay's switch went with the overlay.
        expect(THEME_URL_PARAMETERS.some((entry) => entry.name === 'voidEmber')).toBe(false);
        expect(source).not.toMatch(/['"]voidEmber['"]/);
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?voidEmberForceWebGL', '?voidEmberForceWebGL=true'])(
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
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x020103, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The canvas only receives the output quad: the scene pass owns depth.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        // One world, built once, for this scene, this renderer and this tier, on the wall clock.
        expect(mocks.worlds).toHaveLength(1);
        expect(theme.world).toBe(mocks.worlds[0]);
        expect(theme.world).toMatchObject({
            built: true, scene: theme.scene, renderer: theme.renderer, quality: 'High', capture: false, parts: null,
        });
        // The post stack, on the same scene and camera, with the tier's look.
        expect(mocks.posts).toHaveLength(1);
        expect(theme.post).toBe(mocks.posts[0]);
        expect(theme.post).toMatchObject({ renderer: theme.renderer, scene: theme.scene, camera: theme.camera });
        expect(theme.post.params).toEqual({
            look: POST_LOOK.High, noise: theme.world.noiseTexture, falseColor: false,
        });
        expect(theme.post.params.noise).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(VOID_EMBER_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: { quality: 'High', combo: 0 },
        });
        // The camera stands on the rig the ember is composed for, and the world is handed it.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 3);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.world.camera).toBe(theme.camera);
        // The first frame is posed before the loop starts: at t = 0, camera first.
        expect(theme.world.seeks).toEqual([0]);
        expect(mocks.log).toEqual(['updateCamera', 'update']);
        expect(theme.world.sims[0]).toMatchObject({ time: 0, delta: 0, camera: theme.camera });
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.world.built).toBe(true);
        expect(theme.post).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.post.renders).toBe(1);
        // The post stack draws the frame: the renderer is never asked for a bare one, or to compute.
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
        expect(theme.world.quality).toBe(quality);
        expect(theme.post.params.look).toBe(POST_LOOK[quality]);
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(QUALITY_NAMES);
        expect(Object.keys(POST_LOOK)).toEqual(QUALITY_NAMES);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(theme.passThrough).toBe(mocks.passThroughs[0]);
        expect(theme.passThrough).toMatchObject({ renderer: theme.renderer, scene: theme.scene, camera: theme.camera });
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        expect(console.warn).toHaveBeenCalledOnce();
        const { render, dispose } = theme.passThrough;
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        // The world still runs every frame.
        expect(theme.world.sims).toHaveLength(4);
        theme.disposeRuntime();
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose world cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failWorld = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/world unavailable/);
        expect(console.error).toHaveBeenCalledOnce();
        // Whatever the half-built world had made is let go: the theme owned it before it built.
        expect(mocks.worlds[0]).toMatchObject({ built: false, disposed: true });
        expect(theme.world).toBeNull();
        expect(theme.post).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.director).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('rejects a start that can build neither the post stack nor its pass-through, disposing the world', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPost = 1;
        mocks.failPassThrough = 1;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(mocks.worlds[0].disposed).toBe(true);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(theme.world.counts).toEqual({ locks: 0, clears: 0 }); // staged, not yet applied
        theme.stepFrame(16);
        expect(theme.world.counts).toEqual({ locks: 1, clears: 1 });
        expect(theme.world.combo).toBe(1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(theme.world.counts.locks).toBe(1);
    });

    it('runs a frame in order: camera, the gameplay staged since the last one, the world, the post', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        mocks.log.length = 0;
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        expect(mocks.log).toEqual([]);
        theme.stepFrame(16);
        // The camera first (events aim through it); a clear reaches the world before its combo.
        expect(mocks.log).toEqual([
            'updateCamera', 'levelUp', 'onLock', 'onClear', 'onCombo', 'update',
            'post.update', 'post.update', 'post.render',
        ]);
        // The camera and the world are handed the same clock and the same camera.
        const frame = theme.world.sims[theme.world.sims.length - 1];
        const aimed = theme.world.cameraSims[theme.world.cameraSims.length - 1];
        expect(frame).toMatchObject({ time: theme.time, delta: 1 / 60, camera: theme.camera });
        expect(aimed).toMatchObject({ time: theme.time, delta: 1 / 60, camera: theme.camera });
        // A frame with nothing staged calls no sink.
        mocks.log.length = 0;
        stepFrames(theme, 1);
        expect(mocks.log).toEqual(['updateCamera', 'update', 'post.update', 'post.update', 'post.render']);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the world', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 4 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(theme.world.locks).toHaveLength(1);
        expect(theme.world.locks[0]).toEqual({
            player: 0, rows: [19], u: 0.8, hardDrop: true, color: VOID_EMBER_TETROMINOS.colors.I, screen: null,
        });
        expect(theme.world.clears).toHaveLength(1);
        expect(theme.world.clears[0]).toEqual({
            player: 0,
            rows: [19, 18, 17, 16],
            lines: 4,
            combo: 1,
            cascade: 1,
            tspin: true,
            perfect: false,
            b2b: true,
            screen: null,
        });
        // The level is announced, not silenced.
        expect(theme.world.levels).toEqual([[3, undefined]]);
        expect(theme.world.combo).toBe(1);
        expect(theme.getDiagnostics().world).toMatchObject({ level: 3, combo: 1, counts: { locks: 1, clears: 1 } });
    });

    it('hands the post what the world asks of it, then the clock, each frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.post.updates).toHaveLength(0); // nothing is drawn before the loop's first frame
        theme.stepFrame(16);
        // Two calls a frame: what the world says (its own reused object), then the clock.
        expect(theme.post.updates).toHaveLength(2);
        expect(theme.post.updates[0]).toBe(theme.world.getPostState());
        expect(theme.post.updates[1]).toEqual({ time: theme.time });
        expect(theme.post.renders).toBe(1);
        eventBus.emit(EVENTS.HARD_DROP, { piece: I });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        // What the events did to the world's post state reaches the post on that same frame.
        expect(theme.post.state).toMatchObject({ kick: 0.5, flash: 0.4, time: theme.time });
        expect(theme.post.renders).toBe(2);
    });

    it('answers the longest chain on any board', async () => {
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
        expect(theme.world.clears.map((c) => c.player)).toEqual([1, 2, 1, 1]);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.counts.locks).toBe(0);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(theme.world.counts).toEqual({ locks: 0, clears: 1 });
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(theme.world.reducedMotion).toBe(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(theme.world.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(theme.world.reducedMotion).toBe(true);
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
        // The world is told before its first frame is posed, so nothing moves even once.
        expect(system.theme.world.sims).toHaveLength(1);
        expect(system.theme.world.sims[0].reduced).toBe(true);
    });

    it('puts the ember back at rest when a run ends', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        // A lock staged on the run's last tick must not land in the next run.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        mocks.log.length = 0;
        listeners.get('gameOver')();
        // The chain is let go first (the world hears the break), then the session is reset.
        expect(mocks.log).toEqual(['onCombo']);
        expect(theme.world.sessions).toBe(1);
        expect(theme.world.combo).toBe(0);
        expect(theme.combos.size).toBe(0);
        expect(theme.director.slots.every((slot) => !slot.assigned && !slot.pending)).toBe(true);
        theme.stepFrame(64);
        expect(theme.world.counts).toEqual({ locks: 0, clears: 0 });
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(80);
        expect(theme.world.combo).toBe(1);
        expect(theme.world.clears[theme.world.clears.length - 1].combo).toBe(1);
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
        // The rebuild is queued a microtask later and builds a whole world: wait for it.
        await vi.waitFor(() => expect(theme.world?.quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.disposed).toBe(true);
        expect(firstPost.disposed).toBe(1);
        expect(theme.post.params.look).toBe(POST_LOOK.Minimal);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.counts.locks).toBe(1);
        expect(first.counts.locks).toBe(0);
    });

    it('a scene rebuilt mid-run takes the level up again, silently; a new run starts on level one', async () => {
        const { theme, win, listeners } = await startTheme({ quality: 'High' });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        theme.stepFrame(16);
        expect(theme.world.levels).toEqual([[4, undefined]]); // announced: the world sends its ring
        const rebuildAs = async (quality) => {
            mocks.log.length = 0;
            win.settings.effectQuality = quality;
            theme.handleSettingsChanged({ detail: { effectQuality: quality } });
            await vi.waitFor(() => expect(theme.world?.quality).toBe(quality), { timeout: 4000 });
            await vi.waitFor(() => expect(theme.director).toBeTruthy(), { timeout: 4000 });
        };
        await rebuildAs('Low');
        // The new world is put on the level before its first frame is posed, with no ring.
        expect(theme.world.levels).toEqual([[4, { silent: true }]]);
        expect(mocks.log).toEqual(['levelUp', 'updateCamera', 'update']);
        expect(theme.getDiagnostics().world.level).toBe(4);
        // The run ends: the next scene is built on level one, with nothing to restore.
        listeners.get('gameOver')();
        await rebuildAs('Medium');
        expect(theme.world.levels).toEqual([]);
        expect(mocks.log).toEqual(['updateCamera', 'update']);
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
        expect(mocks.worlds).toHaveLength(1);
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        expect(world.viewport[2]).toBeCloseTo(900 / 700, 9);
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
        // The world is told the drawing buffer (pixel-sized content) and the frame's shape.
        expect(viewport).toHaveBeenCalledOnce();
        expect(viewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, {}); // no size on the event: the viewport is asked
        expect(renderer.setSize).toHaveBeenLastCalledWith(1280, 720, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
    });

    it('follows a drawing buffer someone else resized', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 1);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 1);
        expect(viewport).not.toHaveBeenCalled(); // nothing changed: nothing is told
        theme.renderer.size = { width: 640, height: 360 };
        stepFrames(theme, 1);
        const ratio = theme.renderer.getPixelRatio();
        expect(viewport).toHaveBeenCalledOnce();
        expect(viewport).toHaveBeenCalledWith(Math.floor(640 * ratio), Math.floor(360 * ratio), 1280 / 720);
        expect(post).toHaveBeenCalledWith(1280, 720, Math.floor(640 * ratio), Math.floor(360 * ratio));
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        expect(theme.world.viewport).toEqual([Math.floor(1280 * 0.6), Math.floor(720 * 0.6), 1280 / 720]);
        expect(theme.post.size).toEqual([1280, 720, Math.floor(1280 * 0.6), Math.floor(720 * 0.6)]);
        expect(mocks.worlds).toHaveLength(1); // a pixel ratio is not a rebuild
    });

    it('reads the board on frame time, aims the world at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        const layout = vi.spyOn(theme.world, 'setLayout');
        // Nothing on screen: the world is told so (it aims at where the solo board would hang), and
        // the post is not calmed.
        stepFrames(theme, 2);
        expect(layout).toHaveBeenCalledOnce();
        expect(layout).toHaveBeenCalledWith(null);
        expect(theme.world.layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.calm).toEqual({ rects: [], strength: 0 });
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(theme.world.layoutLive).toBe(false); // no polling: the next read is on a schedule
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(theme.world.layoutLive).toBe(true);
        expect(theme.world.layout.cardCount).toBe(1);
        expect(theme.world.layout.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        expect(theme.getDiagnostics().world.layoutLive).toBe(true);
        // The calm zones ease in over the card and the HUD.
        expect(theme.post.calm.rects).toEqual([
            {
                x0: 440 / 1280, y0: 40 / 720, x1: 840 / 1280, y1: 680 / 720,
            },
            {
                x0: 900 / 1280, y0: 200 / 720, x1: 1040 / 1280, y1: 520 / 720,
            },
        ]);
        const easing = theme.post.calm.strength;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(theme.post.calm.strength).toBeGreaterThan(0.99);
        // No polling: the build's first read, then this trigger's three (0 s, +0.5 s, +1.5 s), which
        // replaced the two the build still had pending.
        expect(layout).toHaveBeenCalledTimes(4);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        manager.handlers.get('modeStopped')();
        expect(theme.world.sessions).toBe(1);
        stepFrames(theme, 1);
        expect(theme.world.layoutLive).toBe(false);
        expect(theme.world.layout).toBeNull();
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(theme.post.calm.rects[0].x1).toBeCloseTo(840 / 1280, 9);
        expect(theme.post.calm.strength).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(theme.post.calm.strength).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('calms the post over every local-multiplayer card, up to four', async () => {
        const { theme, page } = await startTheme({ quality: 'High' });
        page.cards = [0, 1, 2, 3, 4].map((i) => box(20 + i * 250, 100, 230, 500));
        theme.scheduleLayoutReads();
        stepFrames(theme, 1);
        expect(theme.world.layout.cardCount).toBe(5);
        // Four boards is the most a screen holds; with no solo stats bar there is no HUD rect.
        expect(theme.post.calm.rects).toHaveLength(4);
        expect(theme.post.calm.rects[3].x0).toBeCloseTo((20 + 3 * 250) / 1280, 9);
    });

    it('passes the pointer on, eased, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        const last = () => theme.world.sims[theme.world.sims.length - 1];
        expect(last()).toMatchObject({ pointerX: 0, pointerY: 0 });
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped; the camera and the world are handed the same eased value.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(last().pointerX).toBe(theme.pointer.sx);
        expect(theme.world.cameraSims[theme.world.cameraSims.length - 1].pointerX).toBe(theme.pointer.sx);
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
        move({ clientX: 900, clientY: 100 });
        listeners.get('pointerleave')();
        expect(theme.pointer.x).toBe(0);
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
        const { theme } = await startTheme({
            quality: 'Low', search: '?voidEmberTime=42&voidEmberParts=sky, star&voidEmberFalseColor=1',
        });
        expect(theme.flags).toEqual({
            time: 42, fixedDt: null, parts: ['sky', 'star'], falseColor: true, forceWebGL: false,
        });
        expect(theme.world.capture).toBe(true);
        expect(theme.world.parts).toEqual(['sky', 'star']);
        expect(theme.post.params.falseColor).toBe(true);
        // The world is put at the capture time before its first frame is posed.
        expect(theme.world.seeks).toEqual([42]);
        expect(theme.world.sims[0]).toMatchObject({ time: 42, delta: 0 });
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.time).toBe(42);
        expect(theme.world.sims[theme.world.sims.length - 1]).toMatchObject({ time: 42, delta: 0 });
        expect(theme.post.state.time).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(theme.world.counts.locks).toBe(1);
        expect(theme.layoutClock).toBeGreaterThan(0);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?voidEmberFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.time).toBeCloseTo(0.06, 12);
        expect(theme.world.sims[theme.world.sims.length - 1].delta).toBe(0.02);
        // A step of one second or less is read as seconds.
        theme.disposeRuntime();
        const seconds = await startTheme({ quality: 'Low', search: '?voidEmberFixedDt=0.025' });
        expect(seconds.theme.flags.fixedDt).toBe(0.025);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?voidEmberTime=-3&voidEmberFixedDt=abc&voidEmberParts=&voidEmberFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(theme.world.parts).toBeNull(); // showOnlyParts was never called: everything is drawn
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the ember never jumps.
        theme.stepFrame(9000);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('void-ember');
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBe(mocks.worlds[1]);
        expect(mocks.worlds[0].disposed).toBe(true);
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
        const listening = win.addEventListener.mock.calls.length;
        expect(listening).toBeGreaterThan(0);
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(post.disposed).toBe(1);
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
        mocks.log.length = 0;
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
        }).not.toThrow();
        expect(mocks.log).toEqual([]);
        expect(mocks.worlds).toHaveLength(1);
    });

    it('keeps tearing down when the post or the world throws on dispose', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        vi.spyOn(theme.post, 'dispose').mockImplementation(() => { throw new Error('post dispose'); });
        vi.spyOn(theme.world, 'dispose').mockImplementation(() => { throw new Error('world dispose'); });
        expect(() => theme.disposeRuntime()).not.toThrow();
        expect(console.warn).toHaveBeenCalledTimes(2);
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
        expect(mocks.worlds).toHaveLength(0); // no world was built for a start nobody is waiting for
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
        expect(mocks.worlds).toHaveLength(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});

// ── the real world and post, held to the contract the doubles above stand in for ──────────────
const worldFile = path.join(themeDir, 'void-ember-world.js');
const postFile = path.join(themeDir, 'void-ember-post.js');

describe.skipIf(!existsSync(worldFile) || !existsSync(postFile))('Void Ember theme: the real world and post', () => {
    it('export what the theme imports and implement every method it calls', async () => {
        const world = await vi.importActual('../../src/themes/void-ember/void-ember-world.js');
        const post = await vi.importActual('../../src/themes/void-ember/void-ember-post.js');
        expect(world.VoidEmberWorld).toBeTypeOf('function');
        for (const method of WORLD_METHODS) {
            expect(world.VoidEmberWorld.prototype[method], `VoidEmberWorld.${method}`).toBeTypeOf('function');
        }
        expect(world.REST_RIG.near).toBeGreaterThan(0);
        expect(world.REST_RIG.far).toBeGreaterThan(world.REST_RIG.near);
        for (const aspect of [0.46, 1, 16 / 9, 21 / 9]) {
            const fov = world.fovForAspect(aspect);
            expect(fov, `fovForAspect(${aspect})`).toBeGreaterThan(1);
            expect(fov, `fovForAspect(${aspect})`).toBeLessThan(179);
        }
        expect(post.VoidEmberPost).toBeTypeOf('function');
        for (const method of POST_METHODS) {
            expect(post.VoidEmberPost.prototype[method], `VoidEmberPost.${method}`).toBeTypeOf('function');
        }
        expect(post.createPassThroughPipeline).toBeTypeOf('function');
        // A look for every tier the theme can be asked to build.
        expect(Object.keys(post.POST_LOOK)).toEqual(expect.arrayContaining(QUALITY_NAMES));
    });

    it('draw the parts the URL parameter reference lists for ?voidEmberParts', async () => {
        const world = await vi.importActual('../../src/themes/void-ember/void-ember-world.js');
        const entry = THEME_URL_PARAMETERS.find(({ name }) => name === 'voidEmberParts');
        const listed = entry.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        // The world names its parts (as GalaxyWorld does with GALAXY_PARTS).
        expect(world.VOID_EMBER_PARTS, 'void-ember-world.js exports VOID_EMBER_PARTS').toBeInstanceOf(Array);
        expect(listed.sort()).toEqual([...world.VOID_EMBER_PARTS].sort());
    });

    // No GPU is needed: the node graphs are built, never compiled (the pipeline is a double).
    it.each(QUALITY_NAMES)('take a %s start, frames of gameplay and a teardown, called as the theme calls them', async (
        quality,
    ) => {
        const { VoidEmberWorld, REST_RIG: rig, fovForAspect: fov } = await vi.importActual(
            '../../src/themes/void-ember/void-ember-world.js',
        );
        const { VoidEmberPost, POST_LOOK: looks, createPassThroughPipeline } = await vi.importActual(
            '../../src/themes/void-ember/void-ember-post.js',
        );
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        const renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fov(16 / 9), 16 / 9, rig.near, rig.far);
        const sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        try {
            // createScene: build, bind, post, size, settings, the first pose.
            const world = new VoidEmberWorld({
                scene, quality, capture: false, renderer,
            });
            expect(world.build()).toBe(world);
            world.bindCamera(camera);
            const post = new VoidEmberPost(renderer, scene, camera, { look: looks[quality], falseColor: false });
            world.setViewport(1280, 720, 16 / 9);
            post.setSize(1280, 720, 1280, 720);
            world.setReducedMotion(false);
            world.seek(0);
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            // What it draws is node materials only, and nothing was asked of the network.
            const materials = [];
            scene.traverse((object) => { if (object.material) materials.push(object.material); });
            expect(materials.length).toBeGreaterThan(0);
            expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
            // stepFrame: layout, camera, the director's sink (its contexts, in its order), world, post.
            world.setLayout(null);
            const postState = world.getPostState();
            for (let frame = 1; frame <= 3; frame++) {
                sim.time = frame / 60;
                sim.delta = 1 / 60;
                world.updateCamera(camera, sim);
                if (frame === 1) {
                    world.levelUp(2);
                    world.onLock({
                        player: 0,
                        rows: [19],
                        u: 0.8,
                        hardDrop: true,
                        color: VOID_EMBER_TETROMINOS.colors.I,
                        screen: null,
                    });
                    world.onClear({
                        player: 0,
                        rows: [19, 18, 17, 16],
                        lines: 4,
                        combo: 1,
                        cascade: 1,
                        tspin: true,
                        perfect: false,
                        b2b: false,
                        screen: null,
                    });
                    world.onCombo(1);
                }
                world.update(sim, camera);
                post.setCalmRects([{
                    x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
                }], 0.5);
                expect(world.getPostState()).toBe(postState); // one reused object, never a new one per frame
                post.update(postState);
                post.update({ time: sim.time });
                post.render();
            }
            expect(world.getState()).toMatchObject({ quality });
            // Captures and a new run.
            world.showOnlyParts(['sky']);
            world.resetSession();
            world.restCamera();
            expect(load).not.toHaveBeenCalled();
            expect(request).not.toHaveBeenCalled();
            // disposeRuntime: the post, then the world.
            post.dispose();
            world.dispose();
            // The fallback the theme draws through when the post stack cannot be built.
            const passThrough = createPassThroughPipeline(renderer, scene, camera);
            expect(passThrough.render).toBeTypeOf('function');
            expect(passThrough.dispose).toBeTypeOf('function');
            passThrough.dispose();
        } finally {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });
});
