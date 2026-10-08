/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import AetherTidesTheme from '../../src/themes/aether-tides/aether-tides-theme.js';
import { AETHER_TIDES_TETROMINOS } from '../../src/themes/aether-tides/aether-tides-tetrominos.js';
import { AetherTidesWorld, REST_RIG } from '../../src/themes/aether-tides/aether-tides-world.js';
import { AETHER_PALETTES, SIM_DT, SPLAT_CELL } from '../../src/themes/aether-tides/aether-tides-core.js';
import { BOARD_GRID, rectToTide } from '../../src/themes/aether-tides/aether-tides-composition.js';
import { QUALITY_NAMES } from '../../src/themes/aether-tides/aether-tides-quality.js';
import { THEME_REGISTRY, getThemeMeta } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themeDir = path.join(repoRoot, 'src', 'themes', 'aether-tides');

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
        // The node renderer as the theme and the world use it: its size, and the state the fluid's
        // passes save and restore round themselves. Every pass drawn is recorded by its material.
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
                this.autoClear = true;
                this.target = null;
                this.clearColor = new actual.Color(0, 0, 0);
                this.passes = [];
                this.setClearColor = vi.fn((color) => { this.clearColor.set(color); });
                this.getClearColor = (out) => out.copy(this.clearColor);
                this.getClearAlpha = () => 1;
                this.setPixelRatio = vi.fn((ratio) => { this.pixelRatio = ratio; });
                this.getPixelRatio = () => this.pixelRatio;
                this.setSize = vi.fn((width, height) => { this.size = { width, height }; });
                this.getDrawingBufferSize = (target) => target.set(
                    Math.floor(this.size.width * this.pixelRatio),
                    Math.floor(this.size.height * this.pixelRatio),
                );
                this.getRenderTarget = () => this.target;
                this.setRenderTarget = (target) => { this.target = target; };
                this.getActiveCubeFace = () => 0;
                this.getActiveMipmapLevel = () => 0;
                this.getRenderObjectFunction = () => null;
                this.setRenderObjectFunction = () => {};
                this.getMRT = () => null;
                this.setMRT = () => {};
                this.getScissorTest = () => false;
                this.setScissorTest = () => {};
                this.render = (object) => { this.passes.push(object?.material?.name ?? 'scene'); };
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
    const theme = new AetherTidesTheme();
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
        getElementById: (id) => (id === 'aether-tides-theme' ? container : null),
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

/** The cells a lock poured into the fluid (the echo of the piece). */
const cellSplats = (world) => world.events.splats.filter((splat) => splat.kind === SPLAT_CELL && splat.t0 > -1e5);

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The pixel-ratio cap each quality tier renders under (the render scale and DPR still apply). */
const PIXEL_RATIO_CAPS = [
    ['Minimal', 0.7], ['Low', 0.85], ['Medium', 1.0], ['High', 1.15], ['Ultra', 1.3], ['Extreme', 1.5],
];

describe('Aether Tides theme: one node renderer on both backends', () => {
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

    it('is registered under its id with its own icon, under the heavy-GPU lifecycle policy', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'aether-tides');
        expect(entry).toMatchObject({
            displayName: 'Aether Tides',
            module: './aether-tides/aether-tides-theme.js',
            icon: './aether-tides/aether-tides-theme-icon.png',
        });
        expect(existsSync(path.join(themeDir, 'aether-tides-theme-icon.png'))).toBe(true);
        expect(new AetherTidesTheme().name).toBe('aether-tides');
        // It owns a GPU device and a fluid solver: the manager gives it the long lifecycle
        // timeout (a failed WebGPU init and its WebGL2 retry need it), never preloads it beside
        // another theme and never boots into it.
        expect(getThemeMeta('aether-tides')).toMatchObject({
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        const sources = names.map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(sources.length).toBeGreaterThan(12);
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            // No raw GL: the fluid is solved by the node renderer's own passes.
            expect(source).not.toMatch(/getContext\(\s*['"`](webgl|experimental-webgl)/);
            expect(source).not.toMatch(/utils\/webgl\//);
            expect(source).not.toMatch(/gl\.(createProgram|createShader|bindFramebuffer)\(/);
        }
        // The theme it replaces is gone: its raw-WebGL fluid simulator.
        expect(existsSync(path.join(repoRoot, 'src', 'utils', 'webgl', 'aether-tides-simulator.js'))).toBe(false);
        // The shared simulator it extended stays: other themes still use it.
        expect(existsSync(path.join(repoRoot, 'src', 'utils', 'webgl', 'fluid-simulator.js'))).toBe(true);
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?aetherForceWebGL', '?aetherForceWebGL=true'])(
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
    });

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'High' });
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.replaceChildren).toHaveBeenCalledOnce(); // the container starts empty
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(theme.renderer.domElement.style.cssText).toContain('pointer-events:none');
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x02030a, 1);
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(theme.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
        // The canvas only receives the output quad: the picture is drawn in clip space.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        expect(theme.world).toBeInstanceOf(AetherTidesWorld);
        // The world solves its fluid on the theme's own renderer.
        expect(theme.world.renderer).toBe(theme.renderer);
        expect(theme.world.capture).toBe(false);
        expect(theme.post).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(AETHER_TIDES_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: {
                quality: 'High', combo: 0, locks: 0, palette: AETHER_PALETTES[0].name,
            },
        });
        // A plain camera on the rig the post stack's scene pass is given.
        expect(theme.camera.isPerspectiveCamera).toBe(true);
        expect(theme.camera.fov).toBe(REST_RIG.fov);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.camera.aspect).toBeCloseTo(1280 / 720, 9);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThanOrEqual(4);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // The resting nebula is laid out in the build, on the instant the theme starts at.
        expect(theme.time).toBe(0);
        expect(theme.world.now).toBe(0);
        expect(theme.renderer.passes.some((name) => /dye/.test(name))).toBe(true);
        // The canvas itself was never drawn to: the post stack does that, on the frame.
        expect(theme.renderer.getRenderTarget()).toBeNull();
        expect(theme.post.pipeline.render).not.toHaveBeenCalled();
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('builds the same scene on the WebGL2 backend, and solves the fluid there with the same passes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        theme.renderer.passes.length = 0;
        expect(() => theme.stepFrame(16)).not.toThrow();
        // One fixed step of the solver, the light, then the post stack draws the frame.
        for (const pass of ['velocity', 'divergence', 'pressure', 'project', 'dye', 'weave']) {
            expect(theme.renderer.passes.some((name) => name.includes(pass)), pass).toBe(true);
        }
        expect(theme.world.getState().fluid.steps).toBe(1);
        expect(theme.post.pipeline.render).toHaveBeenCalledOnce();
        expect(theme.renderer.getRenderTarget()).toBeNull();
        // No compute shader anywhere: the WebGL2 backend runs everything the WebGPU one does.
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
        expect(() => theme.stepFrame(16)).not.toThrow();
        // The solver's passes leave the pixel ratio the theme set alone.
        expect(theme.renderer.getPixelRatio()).toBe(ratio.mock.results[0].value);
    });

    it('has a cap for every tier the world defines, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(QUALITY_NAMES);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('starts without loading anything', async () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const loadTextures = vi.spyOn(AetherTidesWorld.prototype, 'loadTextures');
        const fetching = vi.fn();
        vi.stubGlobal('fetch', fetching);
        const { theme } = await startTheme({ quality: 'Low' });
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(load).not.toHaveBeenCalled();
        expect(loadTextures).not.toHaveBeenCalled();
        expect(fetching).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('falls back to a pass-through pipeline when the post stack cannot be built', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 1;
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.post).toBeNull();
        expect(theme.passThrough).toBeTruthy();
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        const render = vi.spyOn(theme.passThrough, 'render');
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        // The fluid's passes hand the tone mapping back as the fallback set it.
        expect(theme.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        const dispose = vi.spyOn(theme.passThrough, 'dispose');
        theme.disposeRuntime();
        expect(dispose).toHaveBeenCalledOnce();
        expect(theme.passThrough).toBeNull();
    });

    it('rejects a start whose world cannot be built, leaving nothing behind', async () => {
        stubBrowser({ quality: 'High' });
        mocks.failPipelines = 2; // the post stack and its pass-through fallback
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).rejects.toThrow(/pipeline unavailable/);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const clear = vi.spyOn(theme.world, 'onClear');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        // Staged, not yet applied.
        expect(theme.world.lockCount).toBe(0);
        expect(clear).not.toHaveBeenCalled();
        expect(cellSplats(theme.world)).toHaveLength(0);
        theme.stepFrame(16);
        expect(theme.world.lockCount).toBe(1);
        expect(clear).toHaveBeenCalledOnce();
        // The piece's own four cells were poured into the fluid.
        expect(cellSplats(theme.world)).toHaveLength(4);
        expect(theme.world.combo).toBe(1);
        expect(theme.getDiagnostics().world).toMatchObject({ locks: 1, combo: 1 });

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(theme.world.lockCount).toBe(1);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the nebula', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        const seen = [];
        lock.mockImplementation(function record(c) {
            // The director reuses what it hands over: keep a copy.
            seen.push({ ...c, cells: c.cells.map((cell) => [...cell]), rows: [...c.rows] });
            return AetherTidesWorld.prototype.onLock.call(this, c);
        });
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, with the cells it stands in.
        expect(lock).toHaveBeenCalledOnce();
        expect(seen[0]).toMatchObject({
            hardDrop: true,
            color: AETHER_TIDES_TETROMINOS.colors.I,
            cells: [[6, 19], [7, 19], [8, 19], [9, 19]],
            rows: [19],
            player: 0,
        });
        expect(seen[0].u).toBeCloseTo(0.8, 6);
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 4, rows: [19, 18, 17, 16] });
        expect(theme.world.level).toBe(3);
        expect(theme.world.getState()).toMatchObject({ locks: 1, palette: AETHER_PALETTES[2].name, combo: 1 });
        // The nebula holds its breath: the post's iris closes a little, and nothing flashes yet.
        expect(theme.post.uExposure.value).toBeLessThan(1);
        expect(theme.post.uTime.value).toBe(theme.time);
        // Then everything fires: the post follows the world's flash and kick, and its clock.
        stepFrames(theme, 24);
        expect(theme.post.uFlash.value).toBeGreaterThan(0.2);
        expect(theme.post.uKick.value).toBeGreaterThan(0);
        expect(theme.post.uBloomBoost.value).toBeGreaterThan(0);
        expect(theme.post.uFlash.value).toBe(theme.world.getPostState().flash);
        expect(theme.post.uKick.value).toBe(theme.world.getPostState().kick);
        expect(theme.post.uTime.value).toBe(theme.time);
    });

    it('opens the maelstrom to the longest chain on any board', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(theme.world.combo).toBe(5);
        expect(theme.world.wellAim).toBeGreaterThan(0);
        theme.reportCombo(0, 2);
        expect(theme.world.combo).toBe(2);
        theme.reportCombo(0, 1);
        expect(theme.world.combo).toBe(0);
        expect(theme.world.wellAim).toBe(0);
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
        stepFrames(theme, 30);
        expect(theme.world.wellOpen).toBeGreaterThan(0);
        expect(theme.getDiagnostics().world.well).toBeGreaterThan(0);
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const clear = vi.spyOn(theme.world, 'onClear');
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(16);
        expect(theme.world.lockCount).toBe(0);
        expect(clear).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(theme.world.lockCount).toBe(0);
        expect(clear).toHaveBeenCalledOnce();
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
        // The view stands still: no drift, and the pointer is not followed.
        system.listeners.get('pointermove')({ clientX: 1280, clientY: 0, pointerType: 'mouse' });
        stepFrames(system.theme, 30);
        expect(system.theme.world.picture.view.value.toArray()).toEqual([0, 0]);
    });

    it('forgets the chain when a run ends, and lets the nebula flow on', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        expect(theme.world.wellAim).toBeGreaterThan(0);
        const { clock } = theme.world.fluid;
        const { steps } = theme.world.getState().fluid;
        const reset = vi.spyOn(theme.world, 'resetSession');
        listeners.get('gameOver')();
        expect(reset).toHaveBeenCalledOnce();
        expect(theme.world.getState()).toMatchObject({ combo: 0 });
        expect(theme.world.wellAim).toBe(0);
        expect(theme.combos.size).toBe(0);
        expect(theme.director.slots.every((slot) => !slot.assigned)).toBe(true);
        // The gas is not reset: the sky keeps moving.
        expect(theme.world.fluid.clock).toBe(clock);
        expect(theme.world.getState().fluid.steps).toBe(steps);
        // The next run's first clear is a chain of one again.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        theme.stepFrame(64);
        expect(theme.world.combo).toBe(1);
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
        const { grid } = first.getState().fluid;
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later and builds a whole world: wait for it.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.fluid).toBeNull(); // the old world was disposed
        expect(theme.world.getState().fluid.grid).not.toBe(grid); // a coarser grid
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(theme.world.renderer).toBe(mocks.instances[1]);
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.lockCount).toBe(1);
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
        expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
        expect(theme.camera.aspect).toBeCloseTo(900 / 700, 9);
        expect(theme.world.aspect).toBeCloseTo(900 / 700, 9);
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the nebula, the post and the director', async () => {
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
        // The fluid's grid is cut to the new frame, and the next frame solves on it.
        expect(theme.world.aspect).toBeCloseTo(800 / 600, 9);
        expect(theme.world.tide.screen.value.x).toBeCloseTo(800 / 600, 9);
        expect(() => stepFrames(theme, 2)).not.toThrow();
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
        expect(() => theme.resize(NaN, -5)).not.toThrow();
        expect(renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
        expect(theme.world.aspect).toBe(1);
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });

    it('follows a buffer that somebody else resized', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        const viewport = vi.spyOn(theme.world, 'setViewport');
        const post = vi.spyOn(theme.post, 'setSize');
        stepFrames(theme, 2);
        expect(viewport).not.toHaveBeenCalled();
        // The adaptive scaler changes the drawing buffer behind the theme's back.
        theme.renderer.pixelRatio = 0.5;
        stepFrames(theme, 1);
        expect(viewport).toHaveBeenCalledOnce();
        expect(viewport).toHaveBeenCalledWith(640, 360, 1280 / 720);
        expect(post).toHaveBeenCalledWith(1280, 720, 640, 360);
        expect(theme.world.picture.pixels.value).toBe(180);
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        // Stars are sized in pixels: the picture is told the real buffer's height.
        expect(theme.world.picture.pixels.value).toBe(Math.floor(720 * 0.6) / 2);
        expect(theme.post.uViewport.value.toArray()).toEqual([Math.floor(1280 * 0.6), Math.floor(720 * 0.6)]);
    });

    it('reads the board on frame time, aims the nebula at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        // Nothing on screen: the nebula aims at where the solo board would stand, the post is not calmed.
        stepFrames(theme, 2);
        expect(theme.world.layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.uCalmStrength.value).toBe(0);
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
        expect(theme.world.layout.boards[0].x0).toBeCloseTo(490 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        // The calm zones ease in over the card and the HUD.
        expect(theme.post.calmRects[0].toArray()).toEqual([440 / 1280, 40 / 720, 840 / 1280, 680 / 720]);
        expect(theme.post.calmRects[1].toArray()).toEqual([900 / 1280, 200 / 720, 1040 / 1280, 520 / 720]);
        expect(theme.post.calmRects[2].toArray()).toEqual([0, 0, 0, 0]);
        const easing = theme.post.uCalmStrength.value;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(theme.post.uCalmStrength.value).toBeGreaterThan(0.99);
        // A lock's echo is now poured beside the card, where the card really is.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(theme.world.lockCount).toBe(1);
        const aspect = 1280 / 720;
        const card = rectToTide({
            x0: 440 / 1280, y0: 40 / 720, x1: 840 / 1280, y1: 680 / 720,
        }, aspect);
        const board = rectToTide({
            x0: 490 / 1280, y0: 150 / 720, x1: 790 / 1280, y1: 650 / 720,
        }, aspect);
        const cell = (board.x1 - board.x0) / BOARD_GRID.columns;
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        const poured = cellSplats(theme.world);
        expect(poured).toHaveLength(4);
        for (const splat of poured) {
            // Left of the card's real edge (the T stands left of the board's middle), on screen.
            expect(splat.ax + cell / 2).toBeLessThan(card.x0);
            expect(splat.ax - cell / 2).toBeGreaterThan(-aspect);
        }
        // At the height of the rows it locked in on the real board.
        expect(Math.max(...poured.map((splat) => splat.ay))).toBeCloseTo(board.y0 + 19.5 * row, 9);
        expect(Math.min(...poured.map((splat) => splat.ay))).toBeCloseTo(board.y0 + 18.5 * row, 9);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const reset = vi.spyOn(theme.world, 'resetSession');
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledOnce();
        stepFrames(theme, 1);
        expect(theme.world.layoutLive).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(theme.post.calmRects[0].z).toBeCloseTo(840 / 1280, 9);
        expect(theme.post.uCalmStrength.value).toBeLessThan(1);
        stepFrames(theme, 300);
        expect(theme.post.uCalmStrength.value).toBeLessThan(0.01);
        // Teardown lets go of the manager.
        theme.disposeRuntime();
        expect(manager.off).toHaveBeenCalledTimes(3);
        expect(theme.modeManager).toBeNull();
    });

    it('leans the view with the pointer, but not for a touch, a paused theme or reduced motion', async () => {
        const { theme, listeners } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 1);
        const rest = theme.world.picture.view.value.x;
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(theme.world.picture.view.value.x).toBeGreaterThan(rest + 0.1);
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
            quality: 'Low', search: '?aetherTime=42&aetherParts=nebula,stars&aetherFalseColor=1',
        });
        expect(theme.flags).toMatchObject({
            time: 42, fixedDt: null, parts: ['nebula', 'stars'], falseColor: true, forceWebGL: false,
        });
        expect(theme.time).toBe(42);
        expect(theme.world.now).toBe(42);
        expect(theme.world.capture).toBe(true);
        expect(theme.world.parts.nebula.visible).toBe(true);
        expect(theme.world.parts.stars.visible).toBe(true);
        expect(theme.world.parts.beams.visible).toBe(false);
        expect(theme.world.parts.stardust.visible).toBe(false);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.now).toBe(42);
        expect(theme.world.getState().fluid.steps).toBe(0);
        expect(theme.post.uTime.value).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(theme.world.lockCount).toBe(1);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?aetherFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.time).toBeCloseTo(0.06, 12);
        expect(theme.world.now).toBeCloseTo(0.06, 9);
        // Whole steps of the solver, the rest carried: nothing is dropped in a capture.
        expect(theme.world.getState().fluid.steps).toBe(Math.floor(0.06 / SIM_DT + 1e-9));
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?aetherTime=-3&aetherFixedDt=abc&aetherParts=&aetherFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(Object.values(theme.world.parts).every((part) => part.visible)).toBe(true);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.time).toBeCloseTo(1 / 60 + 0.01, 9);
        expect(theme.world.now).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the nebula never jumps.
        theme.stepFrame(9000);
        expect(theme.time).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
        expect(theme.world.now).toBeCloseTo(1 / 60 + 0.01 + 0.05, 9);
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('aether-tides');
        const lost = theme.world;
        await registration.surface.recover();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.world).toBeTruthy();
        expect(theme.world).not.toBe(lost);
        expect(theme.world.renderer).toBe(mocks.instances[1]);
        expect(registration.unregister).toHaveBeenCalledOnce();
        // On WebGL2 there is no device to watch and no second surface to register.
        expect(theme.setupRendererResilience).toHaveBeenLastCalledWith(theme.renderer, { webgpuDevice: null });
        expect(mocks.surfaces).toHaveLength(1);
        expect(() => stepFrames(theme, 2)).not.toThrow();
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
        const drawn = published.passes.length;
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
            theme.reportCombo(3, 0);
        }).not.toThrow();
        expect(published.passes).toHaveLength(drawn); // nothing more is drawn on a retired renderer
    });

    it('releases its camera, world and renderer on a repeated stop, and takes its canvas out of the page', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { renderer, world } = theme;
        const parentNode = { removeChild: vi.fn() };
        renderer.domElement.parentNode = parentNode;
        const dispose = vi.spyOn(world, 'dispose');
        theme.lifecycleState = 'running';
        theme.stop();
        theme.stop();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(renderer, { nullInstance: false });
        expect(parentNode.removeChild).toHaveBeenCalledWith(renderer.domElement);
        expect(theme.camera).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.lifecycleState).toBe('stopped');
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const { world } = theme;
        theme.lifecycleState = 'running';
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(world.fluid).toBeNull(); // the world was disposed, its targets with it
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
        // Nothing was ever drawn on the renderer that lost.
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
        expect(winner.fluid).toBeTruthy(); // still whole
        expect(winner.renderer).toBe(mocks.instances[1]);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(mocks.instances[0].passes).toHaveLength(0);
        expect(() => stepFrames(theme, 2)).not.toThrow();
    });
});
