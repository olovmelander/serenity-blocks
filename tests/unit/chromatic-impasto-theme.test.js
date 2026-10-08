/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import ChromaticImpastoTheme from '../../src/themes/chromatic-impasto/chromatic-impasto-theme.js';
import { CHROMATIC_IMPASTO_TETROMINOS } from '../../src/themes/chromatic-impasto/chromatic-impasto-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/chromatic-impasto/chromatic-impasto-world.js';
import { IMPASTO_PERIODS } from '../../src/themes/chromatic-impasto/chromatic-impasto-core.js';
import { QUALITY_NAMES } from '../../src/themes/chromatic-impasto/chromatic-impasto-quality.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'chromatic-impasto',
);

const mocks = vi.hoisted(() => ({
    initialize: null, instances: [], failPipelines: 0, surfaces: [],
}));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        RenderPipeline: class {
            constructor() {
                if (mocks.failPipelines > 0) {
                    mocks.failPipelines -= 1;
                    throw new Error('pipeline unavailable');
                }
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
                // The world paints into its own render targets from inside a frame: every draw is
                // noted with the target and the autoClear it was made under. QuadMesh stays real
                // (its render() swaps a vertex node in and calls renderer.render()).
                this.autoClear = true;
                this.renderTarget = null;
                this.passes = [];
                this.getRenderTarget = () => this.renderTarget;
                this.setRenderTarget = vi.fn((target) => { this.renderTarget = target; });
                this.render = vi.fn(() => {
                    this.passes.push({ target: this.renderTarget, autoClear: this.autoClear });
                });
                this.compute = vi.fn();
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
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
    const theme = new ChromaticImpastoTheme();
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
        getElementById: (id) => (id === 'chromatic-impasto-theme' ? container : null),
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

/** A mode manager double: `handlers` holds what the theme subscribed to, `off` counts what it let go of. */
function installModeManager(win) {
    const manager = { handlers: new Map(), off: vi.fn() };
    manager.on = vi.fn((name, handler) => {
        manager.handlers.set(name, handler);
        return manager.off;
    });
    win.serenityBlocks = { gameModeManager: manager };
    return manager;
}

const partNames = (theme) => Object.keys(theme.world.parts).sort();

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

/** Every tier keeps the canvas and the thrown paint; the dust in the lamp's beam starts at Medium. */
const PARTS = ['canvas', 'droplets', 'motes', 'shadows'];
const PARTS_WITHOUT_DUST = ['canvas', 'droplets', 'shadows'];
const DUST_TIERS = ['Medium', 'High', 'Ultra', 'Extreme'];

describe('Chromatic Impasto theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
        mocks.surfaces.length = 0;
        mocks.failPipelines = 0;
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

    it('is registered once, under its id, as a heavy-GPU theme with its own icon', () => {
        const entries = THEME_REGISTRY.filter(({ id }) => id === 'chromatic-impasto');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            displayName: 'Chromatic Impasto',
            module: './chromatic-impasto/chromatic-impasto-theme.js',
            icon: './chromatic-impasto/chromatic-impasto-theme-icon.png',
            resourceProfile: 'heavy-gpu',
        });
        expect(existsSync(path.join(themeDir, path.basename(entries[0].module)))).toBe(true);
        expect(existsSync(path.join(themeDir, path.basename(entries[0].icon)))).toBe(true);
        expect(new ChromaticImpastoTheme().name).toBe('chromatic-impasto');
    });

    it('ships no classic shader material, no legacy WebGL renderer, no MaterialX noise, no compute, no assets', () => {
        const entries = readdirSync(themeDir);
        const names = entries.filter((name) => name.endsWith('.js'));
        const sources = names.map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(sources.length).toBeGreaterThan(8);
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // The paint is drawn with render passes: no compute pass, so the WebGL2 backend runs it all.
            expect(source).not.toMatch(/\.compute(Async)?\s*\(/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            // The painting is generated: no loader is built and no image or model is named.
            expect(source).not.toMatch(/new\s+[\w$.]*Loader\s*\(/);
            expect(source).not.toMatch(/\.(png|jpe?g|webp|ktx2|hdr|exr|glb|gltf)['"`?]/i);
        }
        // Modules and the icon the registry names: no texture, no model, no baked data beside them.
        expect(names.every((name) => name.startsWith('chromatic-impasto-'))).toBe(true);
        for (const module of ['theme', 'world', 'post', 'director', 'tetrominos']) {
            expect(names).toContain(`chromatic-impasto-${module}.js`);
        }
        expect(entries.filter((name) => !name.endsWith('.js'))).toEqual(['chromatic-impasto-theme-icon.png']);
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?chromaticImpastoForceWebGL', '?chromaticImpastoForceWebGL=true'])(
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
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('[ChromaticImpasto] WebGPU init failed'),
            expect.any(Error),
        );
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
        expect(mocks.instances).toHaveLength(2);
    });

    it('fails a start that has nowhere to mount', async () => {
        stubBrowser();
        vi.stubGlobal('document', { getElementById: () => null });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/container not found/);
        expect(mocks.instances).toHaveLength(0);
    });

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        // The canvas sits behind the game and never takes a click.
        expect(theme.renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(theme.renderer.domElement.style.cssText).toContain('pointer-events:none');
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x0b0908, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The canvas only receives the output quad: the scene pass owns depth and MSAA.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        expect(theme.world).toBeTruthy();
        expect(theme.post).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(CHROMATIC_IMPASTO_TETROMINOS);
        // The first of the five periods is on the easel.
        expect(IMPASTO_PERIODS.map(({ name }) => name)).toEqual(['lindstrom', 'fauve', 'nocturne', 'ember', 'spring']);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: { quality: 'High', combo: 0, period: IMPASTO_PERIODS[0].name },
        });
        // The camera stands on the rig the canvas is framed for.
        expect(theme.camera.fov).toBe(fovForAspect(1280 / 720));
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.camera.aspect).toBeCloseTo(1280 / 720, 9);
        expect(theme.camera.position.z).toBeCloseTo(REST_RIG.distance, 1);
        // The canvas, the thrown paint, its shadows and the dust: node materials, every one.
        expect(partNames(theme)).toEqual(PARTS);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThanOrEqual(PARTS.length);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        expect(partNames(theme)).toEqual(PARTS);
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.post.pipeline.render).toHaveBeenCalledOnce();
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
        expect(ratio).toHaveBeenCalledWith(cap, 'theme');
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
        expect(theme.renderer.getPixelRatio()).toBeLessThanOrEqual(cap);
        expect(partNames(theme)).toEqual(DUST_TIERS.includes(quality) ? PARTS : PARTS_WITHOUT_DUST);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier the world defines, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(QUALITY_NAMES);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('frames the canvas two units tall with one field of view, whatever the shape of the window', async () => {
        expect(Object.keys(REST_RIG).sort()).toEqual(['distance', 'far', 'fov', 'near']);
        for (const aspect of [0.45, 1, 16 / 9, 3.2]) {
            expect(fovForAspect(aspect)).toBe(REST_RIG.fov);
        }
        expect(2 * REST_RIG.distance * Math.tan(THREE.MathUtils.degToRad(REST_RIG.fov / 2))).toBeCloseTo(2, 9);
        const { theme } = await startTheme({ quality: 'Low' });
        for (const [width, height] of [[500, 900], [2560, 720]]) {
            theme.resize(width, height);
            stepFrames(theme, 1);
            expect(theme.camera.aspect).toBeCloseTo(width / height, 9);
            expect(theme.camera.fov).toBe(REST_RIG.fov);
        }
    });

    it('starts from nothing but code: no file is loaded, nothing is warned about', async () => {
        const loads = ['TextureLoader', 'ImageLoader', 'ImageBitmapLoader', 'FileLoader']
            .map((name) => vi.spyOn(THREE[name].prototype, 'load').mockImplementation(() => {}));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { theme } = await startTheme({ gpu: true, quality: 'Extreme' });
        stepFrames(theme, 3);
        for (const load of loads) expect(load).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith('[ChromaticImpasto] Scene ready (WebGPU, Extreme)');
    });

    it('paints into its own targets from inside a frame and hands the renderer back as it found it', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { renderer } = theme;
        const offscreen = () => renderer.passes.filter(({ target }) => target?.isRenderTarget).length;
        // The start already laid the ground: off screen, and without clearing what is there.
        const laid = offscreen();
        expect(laid).toBeGreaterThan(0);
        expect(renderer.getRenderTarget()).toBeNull();
        expect(renderer.autoClear).toBe(true);
        // The painter is at work through the first seconds: frames keep drawing into the paint.
        stepFrames(theme, 30);
        expect(offscreen()).toBeGreaterThan(laid);
        // The screen itself is only ever drawn by the post stack.
        expect(renderer.passes).toHaveLength(offscreen());
        expect(renderer.passes.every(({ autoClear }) => autoClear === false)).toBe(true);
        expect(theme.post.pipeline.render).toHaveBeenCalledTimes(30);
        expect(renderer.getRenderTarget()).toBeNull();
        expect(renderer.autoClear).toBe(true);
        // Whatever was bound when a frame began is bound when it ends.
        const outer = new THREE.RenderTarget(4, 4);
        renderer.setRenderTarget(outer);
        renderer.autoClear = false;
        const before = renderer.passes.length;
        stepFrames(theme, 30);
        expect(renderer.passes.length).toBeGreaterThan(before);
        expect(renderer.passes.some(({ target }) => target === outer)).toBe(false);
        expect(renderer.getRenderTarget()).toBe(outer);
        expect(renderer.autoClear).toBe(false);
        outer.dispose();
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(theme.passThrough).toBeTruthy();
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('[ChromaticImpasto] Post stack failed'),
            expect.any(Error),
        );
        const render = vi.spyOn(theme.passThrough, 'render');
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        const dispose = vi.spyOn(theme.passThrough, 'dispose');
        theme.disposeRuntime();
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose scene cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 2; // the post stack and its pass-through fallback
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        // Staged, not yet applied.
        expect(lock).not.toHaveBeenCalled();
        expect(clear).not.toHaveBeenCalled();
        expect(theme.world.getState().counts).toMatchObject({ locks: 0, clears: 0 });
        theme.stepFrame(16);
        expect(lock).toHaveBeenCalledOnce();
        expect(clear).toHaveBeenCalledOnce();
        expect(theme.world.getState()).toMatchObject({ combo: 1, counts: { locks: 1, clears: 1 } });
        // Landed once: the next frame has nothing left to land.
        theme.stepFrame(32);
        expect(lock).toHaveBeenCalledOnce();
        expect(clear).toHaveBeenCalledOnce();

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(48);
        expect(lock).toHaveBeenCalledOnce();
    });

    it('runs a frame in order: the layout, the camera, the staged gameplay, the world, the post', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const steps = [
            vi.spyOn(theme.world, 'setLayout'),
            vi.spyOn(theme.world, 'updateCamera'),
            vi.spyOn(theme.world, 'onLock'),
            vi.spyOn(theme.world, 'update'),
            vi.spyOn(theme.post, 'setCalmRects'),
            vi.spyOn(theme.post, 'update'),
            vi.spyOn(theme.post, 'render'),
        ];
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        const order = steps.map((step) => step.mock.invocationCallOrder[0]);
        expect(order.every(Number.isFinite)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // The post is told what the world's frame came to, then the clock for its grain.
        const [, , , update, , post] = steps;
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ time: theme.time, delta: 1 / 60 }), theme.camera);
        expect(post).toHaveBeenNthCalledWith(1, theme.world.getPostState());
        expect(post).toHaveBeenNthCalledWith(2, { time: theme.time });
        expect(theme.post.uTime.value).toBe(theme.time);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the canvas', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        const level = vi.spyOn(theme.world, 'levelUp');
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(lock).toHaveBeenCalledOnce();
        expect(lock.mock.calls[0][0]).toMatchObject({
            hardDrop: true, color: CHROMATIC_IMPASTO_TETROMINOS.colors.I, rows: [19], player: 0,
        });
        expect(lock.mock.calls[0][0].u).toBeCloseTo(0.8, 6);
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 4, rows: [19, 18, 17, 16] });
        expect(level).toHaveBeenCalledOnce();
        expect(level.mock.calls[0][0]).toBe(3);
        expect(theme.world.getState()).toMatchObject({
            level: 3, period: IMPASTO_PERIODS[2].name, combo: 1, counts: { locks: 1, clears: 1, quads: 1 },
        });
        // The post follows the canvas: what the frame came to, and the clock for its grain.
        const state = theme.world.getPostState();
        expect(theme.post.uKick.value).toBe(state.kick);
        expect(theme.post.uFlash.value).toBe(state.flash);
        expect(theme.post.uExposure.value).toBe(state.exposure);
        expect(theme.post.uTime.value).toBe(theme.time);
    });

    it('turns the canvas to the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const combo = vi.spyOn(theme.world, 'onCombo');
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(combo).toHaveBeenLastCalledWith(5);
        expect(theme.world.getState().combo).toBe(5);
        theme.reportCombo(0, 2);
        expect(combo).toHaveBeenLastCalledWith(2);
        theme.reportCombo(0, 1);
        expect(combo).toHaveBeenLastCalledWith(0);
        expect(theme.world.getState().combo).toBe(0);
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
        expect(combo).toHaveBeenLastCalledWith(3);
        expect(theme.world.getState().combo).toBe(3);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        const still = vi.spyOn(theme.world, 'setReducedMotion');
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(lock).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(lock).not.toHaveBeenCalled();
        expect(clear).toHaveBeenCalledOnce();
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        expect(still).toHaveBeenLastCalledWith(true);
        expect(theme.reducedMotion).toBe(true);
        expect(theme.getDiagnostics().reducedMotion).toBe(true);
        // Every shape a settings payload arrives in.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(still).toHaveBeenLastCalledWith(false);
        expect(theme.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(still).toHaveBeenLastCalledWith(true);
        expect(theme.reducedMotion).toBe(true);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const saved = await startTheme({ quality: 'Low', settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.reducedMotion).toBe(true);
        expect(saved.theme.world.reducedMotion).toBe(true);
        expect(saved.theme.director.lockRipple).toBe(false);
        expect(saved.theme.director.enabled).toBe(true);
        saved.theme.disposeRuntime();

        const system = await startTheme({ quality: 'Low', reducedMotion: true });
        expect(system.theme.reducedMotion).toBe(true);
        expect(system.theme.world.reducedMotion).toBe(true);
        // The setting cannot switch off what the system asks for.
        system.theme.handleSettingsChanged({ detail: { reducedMotion: false } });
        expect(system.theme.reducedMotion).toBe(true);
        expect(system.theme.world.reducedMotion).toBe(true);
        // The camera stands still, on its rig.
        stepFrames(system.theme, 30);
        const [x, y, z] = system.theme.camera.position.toArray();
        expect(x).toBeCloseTo(0, 12);
        expect(y).toBeCloseTo(0, 12);
        expect(z).toBeCloseTo(REST_RIG.distance, 12);
        system.theme.disposeRuntime();

        // The system's preference can change while the theme runs.
        const live = await startTheme({ quality: 'Low' });
        const query = live.theme.reducedMotionQuery;
        const [, onChange] = query.addEventListener.mock.calls.find(([type]) => type === 'change');
        expect(live.theme.reducedMotion).toBe(false);
        query.matches = true;
        onChange();
        expect(live.theme.reducedMotion).toBe(true);
        expect(live.theme.world.reducedMotion).toBe(true);
        query.matches = false;
        onChange();
        expect(live.theme.reducedMotion).toBe(false);
    });

    it('ends the chain when a run ends, and keeps the painting', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        const { world } = theme;
        expect(world.getState()).toMatchObject({ combo: 3, counts: { locks: 3, clears: 3 } });
        const reset = vi.spyOn(world, 'resetSession');
        const fresh = vi.spyOn(world, 'freshCanvas');
        const forget = vi.spyOn(theme.director, 'reset');
        listeners.get('gameOver')();
        expect(forget).toHaveBeenCalledOnce();
        expect(reset).toHaveBeenCalledOnce();
        expect(theme.combos.size).toBe(0);
        // The chain is over; the canvas is not scraped and the world is not rebuilt.
        expect(fresh).not.toHaveBeenCalled();
        expect(theme.world).toBe(world);
        expect(world.getState()).toMatchObject({ combo: 0, counts: { locks: 3, clears: 3 } });
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(64);
        expect(world.getState().combo).toBe(1);
    });

    it('starts every new game on a fresh canvas, and only a new game', async () => {
        const { theme, win, listeners } = await startTheme({ quality: 'Low' });
        const manager = installModeManager(win);
        stepFrames(theme, 1); // the frame the theme finds the manager on
        const fresh = vi.spyOn(theme.world, 'freshCanvas');
        const reset = vi.spyOn(theme.world, 'resetSession');
        const relayout = vi.spyOn(theme, 'scheduleLayoutReads');
        manager.handlers.get('modeStarted')();
        expect(fresh).toHaveBeenCalledOnce();
        // The canvas first, then the layout is re-read (on the next frame, never in the handler).
        expect(relayout).toHaveBeenCalledOnce();
        expect(fresh.mock.invocationCallOrder[0]).toBeLessThan(relayout.mock.invocationCallOrder[0]);
        // Coming back to a mode re-reads the layout; leaving one, or losing, ends the chain. Neither scrapes.
        manager.handlers.get('modeActivated')();
        expect(relayout).toHaveBeenCalledTimes(2);
        expect(reset).not.toHaveBeenCalled();
        manager.handlers.get('modeStopped')();
        listeners.get('gameOver')();
        expect(reset).toHaveBeenCalledTimes(2);
        expect(relayout).toHaveBeenCalledTimes(4);
        expect(fresh).toHaveBeenCalledOnce();
        // The game after that starts fresh too.
        manager.handlers.get('modeStarted')();
        expect(fresh).toHaveBeenCalledTimes(2);
        // A start that arrives while the world is away (a rebuild in flight) is remembered.
        theme.disposeRuntime();
        expect(() => manager.handlers.get('modeStarted')()).not.toThrow();
        expect(fresh).toHaveBeenCalledTimes(2);
        expect(theme.freshPending).toBe(true);
        theme.stop();
        expect(theme.freshPending).toBe(false);
    });

    it('starts a new game in the first period', async () => {
        const { theme, win } = await startTheme({ quality: 'Low' });
        const manager = installModeManager(win);
        stepFrames(theme, 1);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        stepFrames(theme, 1);
        expect(theme.world.getState()).toMatchObject({ level: 3, period: IMPASTO_PERIODS[2].name });
        manager.handlers.get('modeStopped')();
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(theme.world.getState()).toMatchObject({ level: 1, period: IMPASTO_PERIODS[0].name });
    });

    it('keeps the painting a game has made through a rebuild of its world', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        stepFrames(theme, 2);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        stepFrames(theme, 3);
        const before = theme.world;
        const clock = theme.time;
        const tags = before.painter.log.map((s) => s.tag);
        expect(tags).toContain('lock');
        expect(tags).toContain('sweep');
        theme.pendingQuality = 'Low';
        await theme.createScene();
        expect(theme.world).not.toBe(before);
        expect(theme.quality).toBe('Low');
        // The same strokes, to be laid again on the new world's canvas; the clock runs on.
        expect(theme.world.painter.log.map((s) => s.tag)).toEqual(tags);
        expect(theme.time).toBeCloseTo(clock, 6);
        expect(theme.world.getState()).toMatchObject({ level: 2, period: IMPASTO_PERIODS[1].name });
        expect(theme.world.getState().counts).toMatchObject({ locks: 1, clears: 1 });
        stepFrames(theme, 30);
        expect(theme.world.painter.log.filter((s) => s.tag === 'lock' && s.done)).toHaveLength(1);
    });

    it('gives a game that starts during a rebuild its fresh canvas once the new world is there', async () => {
        const { theme, win } = await startTheme({ quality: 'High' });
        const manager = installModeManager(win);
        stepFrames(theme, 2);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        stepFrames(theme, 2);
        expect(theme.world.getState().period).toBe(IMPASTO_PERIODS[2].name);
        // The quality changes; while the new renderer is still coming up, the next game starts.
        let release;
        mocks.initialize = () => new Promise((resolve) => { release = resolve; });
        theme.pendingQuality = 'Low';
        const rebuilt = theme.createScene();
        await Promise.resolve();
        expect(theme.world).toBeNull();
        manager.handlers.get('modeStarted')();
        expect(theme.freshPending).toBe(true);
        release();
        await rebuilt;
        mocks.initialize = null;
        // The old game's painting was carried over, then scraped for the new game.
        expect(theme.freshPending).toBe(false);
        const tags = new Set(theme.world.painter.log.map((s) => s.tag));
        expect(tags.has('lock')).toBe(true);
        expect(tags.has('scrape')).toBe(true);
        expect(theme.world.getState()).toMatchObject({ level: 1, period: IMPASTO_PERIODS[0].name });
        expect(manager.on).toHaveBeenCalledTimes(3); // still the one subscription
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
        const listening = win.addEventListener.mock.calls.length;
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later and builds a whole world: wait for it.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.disposed).toBe(true);
        expect(partNames(theme)).toEqual(PARTS_WITHOUT_DUST);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: on the window, and on the bus (an event is staged once).
        expect(win.addEventListener.mock.calls.length - win.removeEventListener.mock.calls.length).toBe(listening);
        const staged = vi.spyOn(theme.director, 'onPieceLock');
        const lock = vi.spyOn(theme.world, 'onLock');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(staged).toHaveBeenCalledOnce();
        expect(lock).toHaveBeenCalledOnce();
    });

    it('hands a failed rebuild to the manager, and drops one a teardown overtook', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const failure = new Error('rebuild failed');
        const rebuild = vi.spyOn(theme, 'createScene').mockRejectedValue(failure);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        theme.onRuntimeFailure = vi.fn();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await vi.waitFor(() => expect(theme.onRuntimeFailure).toHaveBeenCalledWith(failure));
        expect(rebuild).toHaveBeenCalledTimes(1);

        theme.handleSettingsChanged({ detail: { effectQuality: 'Medium' } });
        theme.disposeRuntime();
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.rebuildQueued).toBe(false);
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
        expect(cancelAnimationFrame).toHaveBeenCalled();
        win.innerWidth = 900;
        win.innerHeight = 700;
        const manager = installModeManager(win); // a mode manager that turned up while it was parked
        requestAnimationFrame.mockClear();
        expect(theme.resume()).toBe(true);
        expect(theme.world).toBe(world);
        expect(theme.renderer).toBe(renderer);
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        expect(manager.on).toHaveBeenCalledTimes(3);
        // The manager restarts the loop after a resume: the pause left it free to start again.
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        theme.restartRenderLoop();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the canvas, the post and the director', async () => {
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
        expect(viewport).toHaveBeenCalledWith(Math.floor(800 * ratio), Math.floor(600 * ratio), 800 / 600);
        expect(post).toHaveBeenCalledWith(800, 600, Math.floor(800 * ratio), Math.floor(600 * ratio));
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
        // The canvas is repainted at its new shape on the next frame.
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('follows a buffer that something else resized, on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 1);
        expect(viewport).not.toHaveBeenCalled();
        theme.renderer.size = { width: 640, height: 400 };
        stepFrames(theme, 1);
        const ratio = theme.renderer.getPixelRatio();
        const buffer = [Math.floor(640 * ratio), Math.floor(400 * ratio)];
        expect(viewport).toHaveBeenCalledWith(...buffer, 1280 / 720);
        expect(post).toHaveBeenCalledWith(1280, 720, ...buffer);
        stepFrames(theme, 1);
        expect(viewport).toHaveBeenCalledTimes(1);
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        expect(viewport).toHaveBeenLastCalledWith(Math.floor(1280 * 0.6), Math.floor(720 * 0.6), 1280 / 720);
        // The adaptive downscale re-emits it on the bus.
        ratio.mockReturnValue(0.5);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: 0.5 });
        await Promise.resolve();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.5);
        expect(viewport).toHaveBeenLastCalledWith(Math.floor(1280 * 0.5), Math.floor(720 * 0.5), 1280 / 720);
    });

    it('reads the board on frame time, aims the canvas at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = installModeManager(win);
        const aim = vi.spyOn(theme.world, 'setLayout');
        const fresh = vi.spyOn(theme.world, 'freshCanvas');
        const reset = vi.spyOn(theme.world, 'resetSession');
        const lock = vi.spyOn(theme.world, 'onLock');
        // Nothing on screen: the canvas aims at where the solo board would stand, the post is not calmed.
        stepFrames(theme, 2);
        expect(aim).toHaveBeenCalledOnce();
        expect(aim).toHaveBeenLastCalledWith(null);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.uCalmStrength.value).toBe(0);
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);
        expect(manager.on).toHaveBeenCalledTimes(3);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(aim).toHaveBeenCalledOnce(); // no polling: the next read is on a schedule
        expect(theme.layout.live).toBe(false);
        manager.handlers.get('modeStarted')();
        // A new game starts on a fresh canvas; the board is read on the frame, never in the handler.
        expect(fresh).toHaveBeenCalledOnce();
        expect(aim).toHaveBeenCalledOnce();
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(aim).toHaveBeenCalledTimes(2);
        expect(aim).toHaveBeenLastCalledWith(theme.layout.applied);
        expect(theme.layout.live).toBe(true);
        expect(theme.layout.applied.cardCount).toBe(1);
        expect(theme.layout.applied.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.world.getState().layoutLive).toBe(true);
        // The lock staged for that frame already aims at the board the frame found.
        expect(lock).toHaveBeenCalledOnce();
        expect(aim.mock.invocationCallOrder[1]).toBeLessThan(lock.mock.invocationCallOrder[0]);
        // The calm zones ease in over the card and the HUD.
        expect(theme.post.calmRects[0].toArray()).toEqual([440 / 1280, 40 / 720, 840 / 1280, 680 / 720]);
        expect(theme.post.calmRects[1].toArray()).toEqual([900 / 1280, 200 / 720, 1040 / 1280, 520 / 720]);
        expect(theme.post.calmRects[2].toArray()).toEqual([0, 0, 0, 0]);
        const easing = theme.post.uCalmStrength.value;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(theme.post.uCalmStrength.value).toBeGreaterThan(0.99);
        // Coming back to the mode only re-reads the board.
        const reads = aim.mock.calls.length;
        manager.handlers.get('modeActivated')();
        stepFrames(theme, 1);
        expect(aim).toHaveBeenCalledTimes(reads + 1);
        expect(fresh).toHaveBeenCalledOnce();

        // The mode ends: the chain is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const ended = reset.mock.calls.length;
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledTimes(ended + 1);
        expect(fresh).toHaveBeenCalledOnce();
        stepFrames(theme, 1);
        expect(aim).toHaveBeenLastCalledWith(null);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(theme.post.calmRects[0].z).toBeCloseTo(840 / 1280, 9);
        expect(theme.post.uCalmStrength.value).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(theme.post.uCalmStrength.value).toBeLessThan(0.01);
        // A rebuild of the runtime keeps the subscription; stopping the theme lets go of it.
        theme.disposeRuntime();
        expect(manager.off).not.toHaveBeenCalled();
        theme.stop();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        // A held clock takes the painter's own sway out of the picture: only the pointer moves the eye.
        const { theme, listeners } = await startTheme({ quality: 'Low', search: '?chromaticImpastoTime=12' });
        const eye = vi.spyOn(theme.world, 'updateCamera');
        stepFrames(theme, 1);
        const rest = theme.camera.position.clone();
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(eye.mock.lastCall[0]).toBe(theme.camera);
        expect(eye.mock.lastCall[1]).toMatchObject({ pointerX: theme.pointer.sx, pointerY: theme.pointer.sy });
        expect(theme.camera.position.distanceTo(rest)).toBeGreaterThan(1e-3);
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
        stepFrames(theme, 300);
        expect(theme.camera.position.distanceTo(rest)).toBeLessThan(1e-4);
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
            quality: 'Medium',
            search: '?chromaticImpastoTime=42&chromaticImpastoParts=canvas,droplets&chromaticImpastoFalseColor=1',
        });
        expect(theme.flags).toMatchObject({
            time: 42, fixedDt: null, parts: ['canvas', 'droplets'], falseColor: true, forceWebGL: false,
        });
        expect(theme.world.getState().time).toBe(42);
        expect(theme.world.capture).toBe(true);
        expect(theme.world.parts.canvas.mesh.visible).toBe(true);
        expect(theme.world.parts.droplets.mesh.visible).toBe(true);
        expect(theme.world.parts.shadows.mesh.visible).toBe(false);
        expect(theme.world.parts.motes.mesh.visible).toBe(false);
        const aim = vi.spyOn(theme.world, 'setLayout');
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.time).toBe(42);
        expect(theme.world.getState().time).toBe(42);
        expect(theme.post.uTime.value).toBe(42);
        // The layout watch runs on wall time: it still reads the board on a frozen frame.
        expect(aim).toHaveBeenCalledOnce();
        // And gameplay still lands on one.
        const lock = vi.spyOn(theme.world, 'onLock');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(lock).toHaveBeenCalledOnce();
        expect(theme.world.getState().time).toBe(42);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?chromaticImpastoFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.getState().time).toBeCloseTo(0.06, 12);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Medium',
            search: '?chromaticImpastoTime=-3&chromaticImpastoFixedDt=abc&chromaticImpastoParts='
                + '&chromaticImpastoFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(partNames(theme)).toEqual(PARTS);
        expect(Object.values(theme.world.parts).every((part) => part.mesh.visible)).toBe(true);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.getState().time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the painter never jumps.
        theme.stepFrame(9000);
        expect(theme.world.getState().time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('drives its frames from one loop that skips a throttled frame and outlives a bad one', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const allow = vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(true);
        const step = vi.spyOn(theme, 'stepFrame');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const [[loop]] = requestAnimationFrame.mock.calls;
        loop(16);
        expect(step).toHaveBeenCalledWith(16);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(2); // the next frame is asked for
        // Starting it again while it runs is a no-op.
        theme.animate();
        expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
        // A throttled frame (a hidden tab, the frame-rate cap) is skipped, and the loop goes on.
        allow.mockReturnValue(false);
        loop(32);
        expect(step).toHaveBeenCalledTimes(1);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
        // A frame that throws does not end the loop...
        allow.mockReturnValue(true);
        step.mockImplementationOnce(() => { throw new Error('bad frame'); });
        expect(() => loop(48)).not.toThrow();
        loop(64);
        expect(step).toHaveBeenCalledTimes(3);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
        // ...three in a row do.
        step.mockImplementation(() => { throw new Error('bad frame'); });
        loop(80);
        loop(96);
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
        loop(112);
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
        // A stopped theme asks for no further frame.
        theme.isActive = false;
        requestAnimationFrame.mockClear();
        step.mockClear();
        loop(128);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(step).not.toHaveBeenCalled();
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('chromatic-impasto');
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBeTruthy();
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        // The rebuilt canvas paints and draws.
        expect(() => stepFrames(theme, 2)).not.toThrow();
        expect(theme.post.pipeline.render).toHaveBeenCalledTimes(2);
        // A second loss is not retried: the coordinator routes out.
        await expect(registration.surface.recover()).rejects.toThrow(/already attempted/);
        expect(mocks.instances).toHaveLength(2);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        const { theme, win } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        const { world, post } = theme;
        const query = theme.reducedMotionQuery;
        const disposeWorld = vi.spyOn(world, 'dispose');
        const disposePost = vi.spyOn(post, 'dispose');
        const listening = win.addEventListener.mock.calls.length;
        expect(listening).toBeGreaterThan(0);
        expect(query.addEventListener).toHaveBeenCalledOnce();
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(disposePost).toHaveBeenCalledOnce();
        expect(world.disposed).toBe(true);
        expect(mocks.surfaces[0].unregister).toHaveBeenCalledOnce();
        // Every listener it added, on the window and on the media query, is removed again.
        expect(win.removeEventListener).toHaveBeenCalledTimes(listening);
        expect(query.removeEventListener).toHaveBeenCalledOnce();
        expect(cancelAnimationFrame).toHaveBeenCalled();
        for (const key of ['renderer', 'scene', 'camera', 'world', 'post', 'passThrough', 'director', 'modeManager']) {
            expect(theme[key], key).toBeNull();
        }
        expect(theme.isWebGPU).toBe(false);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(await theme.whenCriticalReady()).toBe(false);
        expect(theme.getDiagnostics()).toMatchObject({ world: null, pixelRatio: null, droppedEvents: 0 });
        // A late bus event, a late frame or a late resize after retirement is harmless.
        const draws = published.passes.length;
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
            theme.reportCombo(3, 0);
        }).not.toThrow();
        expect(published.passes).toHaveLength(draws);
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
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // Nothing was painted with the renderer that was thrown away.
        expect(mocks.instances[0].passes).toHaveLength(0);
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
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(mocks.instances[0].passes).toHaveLength(0);
    });
});
