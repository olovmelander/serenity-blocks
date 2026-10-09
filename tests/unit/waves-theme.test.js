/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import WavesTheme from '../../src/themes/waves/waves-theme.js';
import { WAVES_TETROMINOS } from '../../src/themes/waves/waves-tetrominos.js';
import {
    REST_RIG, WavesWorld, aimPlunge, aimStain, fovForAspect,
} from '../../src/themes/waves/waves-world.js';
import { boardPoint, fallbackLayout } from '../../src/themes/waves/waves-composition.js';
import { QUALITY_NAMES } from '../../src/themes/waves/waves-quality.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

vi.setConfig({ testTimeout: 30_000 }); // every start builds a whole wave, on a machine that may be busy

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'waves',
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
                this.render = vi.fn();
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
    const theme = new WavesTheme();
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
        getElementById: (id) => (id === 'waves-theme' ? container : null),
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

/** What decides the picture of a world, as plain numbers. */
function picture(world) {
    const { U } = world;
    return {
        state: world.getState(),
        post: world.getPostState(),
        rings: world.ringRows.slice(0, world.ringCount).map((row) => row.toArray()),
        ribbons: world.ribbonRows.slice(0, world.ribbonCount * 2).map((row) => row.toArray()),
        bands: world.bandRows.map((row) => row.toArray()),
        uniforms: [U.time.value, U.open.value, U.warm.value, U.glow.value, U.tear.value, ...U.bulge.value.toArray()],
        lens: [world.state.yaw, world.state.pitch],
    };
}

/** Whether a world has been retired: out of its scene, its camera let go. */
const retired = (world) => world.camera === null && world.group.parent === null;

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The flags the theme reads from the URL (besides the shared ?forceWebGL). */
const FLAGS = ['wavesForceWebGL', 'wavesTime', 'wavesFixedDt', 'wavesParts', 'wavesFalseColor'];

describe('Waves theme: one node renderer on both backends', () => {
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

    it('is registered under its id with its own icon, as a heavy GPU theme', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'waves');
        expect(entry).toMatchObject({
            displayName: 'Waves',
            module: './waves/waves-theme.js',
            icon: './waves/waves-theme-icon.png',
            // The manager copies this onto every instance it builds; the class does not set it.
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
        expect(THEME_REGISTRY.filter(({ id }) => id === 'waves')).toHaveLength(1);
        expect(existsSync(path.join(themeDir, 'waves-theme-icon.png'))).toBe(true);
        expect(new WavesTheme().name).toBe('waves');
    });

    it('ships no classic shader material, no legacy WebGL renderer, no MaterialX noise and no asset file', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        const sources = names.map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(sources.length).toBeGreaterThan(8);
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets|hdri)\//);
            // The wave is generated: nothing is fetched, decoded or imported as a URL.
            expect(source).not.toMatch(/\?url['"]|GLTFLoader|DRACOLoader|TextureLoader|\bfetch\s*\(/);
        }
        // The theme it replaces is gone: its ocean and its reactions.
        expect(names).not.toContain('waves-ocean.js');
        expect(names).not.toContain('waves-reactions.js');
        // Nothing but code and the icon lives in the folder.
        const others = readdirSync(themeDir).filter((name) => !name.endsWith('.js'));
        expect(others).toEqual(['waves-theme-icon.png']);
    });

    it('lists every part the world can draw in the URL parameter reference, and nothing else', () => {
        const entry = THEME_URL_PARAMETERS.find(({ name }) => name === 'wavesParts');
        expect(entry).toBeTruthy();
        const listed = entry.values.replace('Comma-separated names: ', '').split(', ');
        const world = new WavesWorld({ scene: new THREE.Scene(), quality: 'Extreme' }).build();
        expect([...listed].sort()).toEqual(Object.keys(world.parts).sort());
        expect(new Set(listed).size).toBe(listed.length);
        world.dispose();
        for (const name of FLAGS) {
            expect(THEME_URL_PARAMETERS.filter((item) => item.name === name), name).toHaveLength(1);
        }
        // The flags of the theme this one replaces are no longer documented, because nothing reads them.
        const documented = THEME_URL_PARAMETERS.map((item) => item.name).filter((name) => /^waves[A-Z]/.test(name));
        expect(documented.sort()).toEqual([...FLAGS].sort());
        // And the theme reads every one of the flags the reference gives it.
        const source = readFileSync(path.join(themeDir, 'waves-theme.js'), 'utf8');
        for (const name of FLAGS) expect(source, name).toContain(`'${name}'`);
    });

    // SUSPECTED BUG (src/ui/url-parameters/theme-parameters.js): the `themeValidation` entry still names
    // Waves in its scope ("... Stellar Drift, Summer, Waves"), but the rebuilt theme exposes no validation
    // handle and reads no such flag: 'waves' was taken out of `validationIds`, the label was left behind.
    it('documents no flag for Waves that the theme does not read', () => {
        const source = readFileSync(path.join(themeDir, 'waves-theme.js'), 'utf8');
        const unread = THEME_URL_PARAMETERS
            .filter(({ scope }) => /\bWaves\b/.test(scope))
            .map(({ name }) => name)
            .filter((name) => !source.includes(`'${name}'`));
        expect(unread).toEqual([]);
    });

    it('uses the WebGL2 backend of the node renderer when there is no GPU', async () => {
        stubBrowser();
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
        expect(renderer.isWebGPURenderer).toBe(true);
    });

    it.each(['?forceWebGL=1', '?wavesForceWebGL', '?wavesForceWebGL=true'])(
        'honours %s even when a GPU is present',
        async (search) => {
            stubBrowser({ gpu: true, search });
            const theme = createTheme();
            const renderer = await theme.createRenderer(theme.lifecycleGeneration);
            expect(mocks.instances).toHaveLength(1);
            expect(renderer.options.forceWebGL).toBe(true);
        },
    );

    it('takes the GPU when there is one and nothing says otherwise', async () => {
        stubBrowser({ gpu: true, search: '?wavesForceWebGL=0' });
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(false);
        expect(renderer.options.powerPreference).toBe('high-performance');
    });

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
        expect(theme.renderer.setClearColor).toHaveBeenCalledExactlyOnceWith(expect.any(Number), 1);
        expect(theme.renderer.domElement.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        // Tone mapping happens once, in the post stack.
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The canvas only receives the output quad: the scene pass owns depth.
        expect(theme.renderer.options).toMatchObject({ antialias: false, depth: false, alpha: false });
        expect(theme.world).toBeTruthy();
        expect(theme.post).toBeTruthy();
        expect(theme.passThrough).toBeNull();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(WAVES_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: {
                quality: 'High', combo: 0, time: 0, clock: 0,
            },
        });
        // The camera rides on the rig the wave is composed for.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 3);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.world.camera).toBe(theme.camera);
        expect(theme.scene.children).toEqual([theme.world.group]);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(4);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // A live start is not a capture, and the loop is running.
        expect(theme.world.capture).toBe(false);
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.post.pipeline.render).toHaveBeenCalledOnce();
        // Nothing is computed and nothing is drawn but the picture.
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        expect(theme.renderer.render).not.toHaveBeenCalled();
        expect(mocks.surfaces).toHaveLength(0); // WebGL2 recovers through the context-restored restart
    });

    it('aims the lens, lands the staged gameplay and moves the world before it draws, every frame', async () => {
        const { theme } = await startTheme({ quality: 'Low' });
        const { world, post } = theme;
        const update = vi.spyOn(world, 'update');
        const updateCamera = vi.spyOn(world, 'updateCamera');
        const flush = vi.spyOn(theme.director, 'flush');
        stepFrames(theme, 3);
        expect(update).toHaveBeenCalledTimes(3);
        expect(post.pipeline.render).toHaveBeenCalledTimes(3);
        for (let frame = 0; frame < 3; frame++) {
            // The camera, then the gameplay staged since the last frame, then the world, then the picture.
            const order = [updateCamera, flush, update, post.pipeline.render]
                .map((spy) => spy.mock.invocationCallOrder[frame]);
            expect(order).toEqual([...order].sort((a, b) => a - b));
            expect(update.mock.calls[frame][1]).toBe(theme.camera);
            expect(updateCamera.mock.calls[frame][0]).toBe(theme.camera);
        }
        expect(theme.time).toBeCloseTo(3 / 60, 9);
        expect(world.time).toBe(theme.time);
        expect(world.clock).toBeCloseTo(theme.time, 9);
        // The post follows the wave: its clock for the grain, the sun for the shafts.
        const told = world.getPostState();
        expect(post.uTime.value).toBe(theme.time);
        expect(post.uFlash.value).toBe(told.flash);
        expect(post.uBloomBoost.value).toBe(told.bloomBoost);
        expect(post.uWarm.value).toBe(told.warm);
        expect(post.uShafts.value).toBe(told.shafts);
        expect(post.uSun.value.toArray()).toEqual([told.sunX, told.sunY]);
    });

    it('builds every tier, under a pixel-ratio cap that never falls for a dearer tier', async () => {
        const caps = [];
        for (const quality of QUALITY_NAMES) {
            stubBrowser({ quality });
            const theme = createTheme();
            const ratio = vi.spyOn(theme, 'getEffectivePixelRatio');
            // One tier after another: each build stubs its own browser.
            // eslint-disable-next-line no-await-in-loop
            await theme.createScene(theme.lifecycleGeneration);
            expect(theme.quality).toBe(quality);
            expect(theme.world.getState().quality).toBe(quality);
            const [cap, owner] = ratio.mock.calls[0];
            expect(owner).toBe('theme');
            expect(cap, quality).toBeGreaterThan(0);
            expect(theme.renderer.setPixelRatio).toHaveBeenCalledWith(ratio.mock.results[0].value);
            expect(theme.renderer.getPixelRatio(), quality).toBeLessThanOrEqual(cap);
            expect(() => theme.stepFrame(16)).not.toThrow();
            caps.push(cap);
            theme.disposeRuntime();
        }
        for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
        expect(caps[caps.length - 1]).toBeGreaterThan(caps[0]);
        expect(mocks.instances).toHaveLength(QUALITY_NAMES.length);
    });

    it('starts without loading anything', async () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const fetched = vi.fn();
        vi.stubGlobal('fetch', fetched);
        const { theme } = await startTheme({ quality: 'Low' });
        stepFrames(theme, 2);
        expect(load).not.toHaveBeenCalled();
        expect(fetched).not.toHaveBeenCalled();
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
        expect(console.warn).toHaveBeenCalled();
        const render = vi.spyOn(theme.passThrough, 'render');
        expect(() => stepFrames(theme, 3)).not.toThrow();
        expect(render).toHaveBeenCalledTimes(3);
        // The wave still runs: the fallback only changes how it is drawn.
        expect(theme.world.time).toBeCloseTo(3 / 60, 9);
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
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(theme.world.getState()).toMatchObject({ locks: 0, clears: 0 }); // staged, not yet applied
        theme.stepFrame(16);
        expect(theme.world.getState()).toMatchObject({
            locks: 1, clears: 1, rings: 1, ribbons: 1,
        });
        expect(theme.world.combo).toBe(1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(theme.world.getState().locks).toBe(1);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the wave', async () => {
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
            hardDrop: true, color: WAVES_TETROMINOS.colors.I, rows: [19], player: 0,
        });
        expect(lock.mock.calls[0][0].u).toBeCloseTo(0.8, 6);
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 4, rows: [19, 18, 17, 16] });
        expect(level).toHaveBeenCalledWith(3);
        // The wave holds for the four lines, and a set wave is on its way down the tube.
        expect(theme.world.getState()).toMatchObject({
            locks: 1, clears: 1, level: 3, combo: 1, holding: true,
        });
        expect(theme.world.U.bulge.value.y).toBeGreaterThan(0);
        // The post follows the wave: the flash of the drop, the clock for its grain.
        expect(theme.post.uFlash.value).toBeGreaterThan(0);
        expect(theme.post.uFlash.value).toBe(theme.world.getPostState().flash);
        expect(theme.post.uTime.value).toBe(theme.time);
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
    });

    it('honours the reaction settings', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.getState().locks).toBe(0);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(theme.world.getState()).toMatchObject({ locks: 0, clears: 1 });
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
        // The lens stands still at the rider's eye.
        stepFrames(system.theme, 30);
        const { position } = system.theme.camera;
        expect(position.x).toBeCloseTo(REST_RIG.eye.x, 12);
        expect(position.y).toBeCloseTo(REST_RIG.eye.y, 12);
        expect(position.z).toBeCloseTo(REST_RIG.eye.z, 12);
    });

    it('ends the chain and empties the water when a run ends', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        expect(theme.world.getState()).toMatchObject({ rings: 3, ribbons: 3 });
        const { time } = theme.world;
        listeners.get('gameOver')();
        expect(theme.world.getState()).toMatchObject({
            combo: 0, rings: 0, ribbons: 0, airborne: 0, holding: false, time,
        });
        expect(theme.combos.size).toBe(0);
        expect(theme.director.slots.every((slot) => !slot.assigned)).toBe(true);
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
        win.settings.effectQuality = 'Minimal';
        theme.handleSettingsChanged({ detail: { effectQuality: 'Minimal' } });
        // The rebuild is queued a microtask later and builds a whole world: wait for it.
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 20_000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(retired(first)).toBe(true);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(theme.renderer).toBe(mocks.instances[1]);
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.getState().locks).toBe(1);
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
        // The first frame back does not jump by the time spent parked: one frame of the wave, not hours.
        const before = theme.time;
        const { clock } = world;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        expect(world.clock - clock).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the wave, the post and the director', async () => {
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
        expect(theme.world.aspect).toBeCloseTo(800 / 600, 12);
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(800 / 600), 9);
        expect(theme.director.viewportWidth).toBe(800);
        expect(theme.director.viewportHeight).toBe(600);
        // Through the bus as well; nonsense is clamped to a pixel.
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1024, height: 768 });
        expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
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
        expect(theme.world.viewport).toEqual({ w: Math.floor(1280 * 0.6), h: Math.floor(720 * 0.6) });
        expect(theme.post.uViewport.value.toArray()).toEqual([Math.floor(1280 * 0.6), Math.floor(720 * 0.6)]);
    });

    it('reads the board on frame time, aims the wave at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        // Nothing on screen: the wave aims at where the solo board would hang, the post is not calmed.
        stepFrames(theme, 2);
        expect(theme.world.hasBoard).toBe(false);
        expect(theme.world.layout).toBeNull();
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.uCalmStrength.value).toBe(0);
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);

        // A mode starts: a card, its board and the HUD appear, well left of where the solo board hangs.
        page.cards = [box(100, 40, 400, 640)];
        page.canvas = box(150, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(theme.world.hasBoard).toBe(false); // no polling: the next read is on a schedule
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(theme.world.hasBoard).toBe(true);
        expect(theme.world.layout.boards[0].x0).toBeCloseTo(150 / 1280, 9);
        expect(theme.layout.live).toBe(true);
        // The calm zones ease in over the card and the HUD.
        expect(theme.post.calmRects[0].toArray()).toEqual([100 / 1280, 40 / 720, 500 / 1280, 680 / 720]);
        expect(theme.post.calmRects[1].toArray()).toEqual([900 / 1280, 200 / 720, 1040 / 1280, 520 / 720]);
        expect(theme.post.calmRects[2].toArray()).toEqual([0, 0, 0, 0]);
        const easing = theme.post.uCalmStrength.value;
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(0.5);
        stepFrames(theme, 240);
        expect(theme.post.uCalmStrength.value).toBeGreaterThan(0.99);
        // A lock now goes into the water where the board really is, not where the solo board would be.
        const cast = vi.spyOn(theme.world, 'castScreen');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(theme.world.getState().locks).toBe(1);
        expect(cast).toHaveBeenCalledTimes(2);
        const { cards: [card], boards: [board] } = theme.world.layout;
        const u = (3 + 1.5) / 10;
        const piece = boardPoint(board, u, 19); // the T's rows are 18 and 19: the middle one of them
        const stain = aimStain(card, piece, u, 19);
        const plunge = aimPlunge(card, piece, u);
        expect(cast.mock.calls[0][0]).toBeCloseTo(stain.x, 9);
        expect(cast.mock.calls[0][1]).toBeCloseTo(stain.y, 9);
        expect(cast.mock.calls[1][0]).toBeCloseTo(plunge.x, 9);
        expect(cast.mock.calls[1][1]).toBeCloseTo(plunge.y, 9);
        const solo = fallbackLayout(1280, 720);
        const elsewhere = aimPlunge(solo.cards[0], boardPoint(solo.boards[0], u, 19), u);
        expect(Math.hypot(plunge.x - elsewhere.x, plunge.y - elsewhere.y)).toBeGreaterThan(0.02);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const reset = vi.spyOn(theme.world, 'resetSession');
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledOnce();
        stepFrames(theme, 1);
        expect(theme.world.hasBoard).toBe(false);
        expect(theme.layout.live).toBe(false);
        expect(theme.layout.applied).toBeTruthy();
        expect(theme.post.calmRects[0].z).toBeCloseTo(500 / 1280, 9);
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
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        // The lens is where the world puts it for that lean: right of where it would be without one.
        const leaning = theme.camera.position.x;
        theme.world.updateCamera(theme.camera, {
            time: theme.time, delta: 0, pointerX: 0, pointerY: 0,
        });
        expect(leaning).toBeGreaterThan(theme.camera.position.x);
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

    it('plays the wave up to a capture time, then freezes it', async () => {
        const seek = vi.spyOn(WavesWorld.prototype, 'seek');
        const { theme } = await startTheme({
            quality: 'Low', search: '?wavesTime=42&wavesParts=sky,water&wavesFalseColor=1',
        });
        expect(theme.flags).toMatchObject({
            time: 42, fixedDt: null, parts: ['sky', 'water'], falseColor: true, forceWebGL: false,
        });
        const { world } = theme;
        expect(theme.time).toBe(42);
        expect(world.time).toBe(42);
        expect(world.clock).toBeCloseTo(42, 6);
        expect(world.capture).toBe(true);
        expect(world.parts.dolphins.mesh.visible).toBe(false);
        expect(world.parts.spray.mesh.visible).toBe(false);
        expect(world.parts.water.mesh.visible).toBe(true);
        expect(world.parts.sky.mesh.visible).toBe(true);
        // Played, not jumped: the world was put a little before the time and run up to it.
        expect(seek).toHaveBeenCalledOnce();
        const [start] = seek.mock.calls[0];
        expect(start).toBeLessThan(42);
        expect(start).toBeGreaterThan(0);

        // Frozen from here: frames pass, the clock stands.
        const frozen = picture(world);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(world.time).toBe(42);
        expect(picture(world)).toEqual(frozen);
        expect(theme.post.uTime.value).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(world.getState()).toMatchObject({ locks: 1, rings: 1, time: 42 });
        expect(world.ringRows[0].z).toBe(world.clock);
    });

    it('reproduces a captured frame: the same time gives the same wave, whatever the screen did before', async () => {
        const first = await startTheme({ quality: 'Low', search: '?wavesTime=20.5' });
        const frame = picture(first.theme.world);
        expect(frame.state).toMatchObject({ time: 20.5, locks: 0, clears: 0 });
        // The same wave, disturbed and rebuilt.
        eventBus.emit(EVENTS.HARD_DROP, { piece: I });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20] });
        stepFrames(first.theme, 3);
        expect(picture(first.theme.world)).not.toEqual(frame);
        await first.theme.createScene(first.theme.lifecycleGeneration);
        expect(picture(first.theme.world)).toEqual(frame);
        first.theme.disposeRuntime();

        const second = await startTheme({ quality: 'Low', search: '?wavesTime=20.5' });
        expect(picture(second.theme.world)).toEqual(frame);
        // Another time is another frame; the wave runs on the capture's own clock.
        second.theme.playTo(21);
        expect(second.theme.world.U.time.value).toBeCloseTo(21, 6);
        expect(second.theme.world.getState().time).toBe(21);
        expect(picture(second.theme.world)).not.toEqual(frame);
        // And back again.
        second.theme.playTo(20.5);
        expect(picture(second.theme.world).uniforms).toEqual(frame.uniforms);
    });

    it('replays in equal steps from a little before the time, camera first, and ends on a held frame', async () => {
        const { theme } = await startTheme({ quality: 'Minimal' });
        const { world } = theme;
        const seek = vi.spyOn(world, 'seek');
        const sims = [];
        const cameraTimes = [];
        vi.spyOn(world, 'updateCamera').mockImplementation((camera, sim) => { cameraTimes.push(sim.time); });
        vi.spyOn(world, 'update').mockImplementation((sim, camera) => {
            sims.push([sim.time, sim.delta]);
            expect(camera).toBe(theme.camera);
        });
        theme.playTo(100);
        // The lead the eased state is given to settle, and the step it is played in.
        expect(seek).toHaveBeenCalledOnce();
        const lead = 100 - seek.mock.calls[0][0];
        expect(lead).toBeGreaterThan(0.5);
        expect(lead).toBeLessThan(60);
        const step = sims[0][1];
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThanOrEqual(1 / 30 + 1e-9);
        const steps = sims.length - 1;
        expect(steps).toBe(Math.floor(lead / step + 1e-6));
        expect(cameraTimes).toEqual(sims.map(([time]) => time));
        for (let i = 0; i < steps; i++) {
            expect(sims[i][1]).toBe(step);
            expect(sims[i][0]).toBeCloseTo(100 - lead + (i + 1) * step, 9);
        }
        expect(sims[steps]).toEqual([100, 0]);
        expect(theme.time).toBe(100);

        // Any time: from at most the lead before it, in whole steps, the clock landing on the time itself.
        for (const time of [5, 0.5, 0, lead + 0.01, 30.26, 3.99, lead - step / 2]) {
            seek.mockClear();
            sims.length = 0;
            theme.playTo(time);
            const start = Math.max(0, time - lead);
            expect(seek, `${time}`).toHaveBeenCalledExactlyOnceWith(start);
            // Whole steps only: a last fraction of a step is not played.
            expect(sims, `${time}`).toHaveLength(Math.floor((time - start) / step + 1e-6) + 1);
            expect(sims[sims.length - 1], `${time}`).toEqual([time, 0]);
            expect(sims.slice(0, -1).every(([, delta]) => delta === step), `${time}`).toBe(true);
            expect(theme.time, `${time}`).toBe(time);
        }
    });

    it.each(['5', '0.5', '0', '30.26'])('lands the clock on wavesTime=%s and holds it there', async (value) => {
        stubBrowser({ quality: 'Minimal', search: `?wavesTime=${value}` });
        const theme = createTheme();
        const play = vi.spyOn(WavesTheme.prototype, 'playTo');
        await theme.createScene(theme.lifecycleGeneration);
        expect(play).toHaveBeenCalledExactlyOnceWith(Number(value));
        const { world } = theme;
        expect(world.time).toBe(Number(value));
        expect(theme.time).toBe(Number(value));
        expect(world.clock).toBeCloseTo(Number(value), 6);
        expect(world.capture).toBe(true);
        const { clock } = world;
        theme.stepFrame(16);
        theme.stepFrame(5000);
        expect(world.time).toBe(Number(value));
        expect(world.clock).toBe(clock);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?wavesFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.time).toBeCloseTo(0.06, 12);
        expect(theme.world.clock).toBeCloseTo(0.06, 12);
        // A step of seconds (a value of 1 or less) is taken as it is.
        theme.disposeRuntime();
        const slow = await startTheme({ quality: 'Low', search: '?wavesFixedDt=0.5' });
        expect(slow.theme.flags.fixedDt).toBe(0.5);
        slow.theme.stepFrame(0);
        expect(slow.theme.world.time).toBe(0.5);
        expect(slow.theme.world.clock).toBe(0.5);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?wavesTime=-3&wavesFixedDt=abc&wavesParts=&wavesFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(theme.world.time).toBe(0); // nothing is replayed for a live start
        expect(Object.values(theme.world.parts).every((part) => part.mesh.visible)).toBe(true);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the wave never jumps.
        const before = theme.world.time;
        theme.stepFrame(9000);
        expect(theme.world.time - before).toBeGreaterThan(0);
        expect(theme.world.time - before).toBeLessThan(0.25);
        // Nor does it run backwards when the clock it is handed does.
        const later = theme.world.time;
        theme.stepFrame(100);
        expect(theme.world.time).toBe(later);
    });

    it('retries once on the WebGL2 backend when the GPU device is lost', async () => {
        const { theme } = await startTheme({ gpu: true, quality: 'Low' });
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(theme.renderer, {
            webgpuDevice: theme.renderer.backend.device,
        });
        expect(mocks.surfaces).toHaveLength(1);
        const [registration] = mocks.surfaces;
        expect(registration.label).toBe('waves');
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
        // A second loss is not retried: the coordinator routes out.
        await expect(registration.surface.recover()).rejects.toThrow(/already attempted/);
        expect(mocks.instances).toHaveLength(2);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        const { theme, win } = await startTheme({ gpu: true, quality: 'High' });
        const published = theme.renderer;
        const { world, post, scene } = theme;
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
        // The post and the world go before the renderer that draws them.
        const [rendererGone] = theme.disposeRenderer.mock.invocationCallOrder;
        expect(disposePost.mock.invocationCallOrder[0]).toBeLessThan(rendererGone);
        expect(disposeWorld.mock.invocationCallOrder[0]).toBeLessThan(rendererGone);
        expect(retired(world)).toBe(true);
        expect(scene.children).toHaveLength(0);
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
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20] });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
            theme.reportCombo(4, 0);
        }).not.toThrow();
    });

    it('stops and cleans up through the lifecycle, leaving nothing running', async () => {
        const { theme, container } = await startTheme({ gpu: true, quality: 'Low' });
        const { world } = theme;
        theme.lifecycleState = 'running';
        theme.stop();
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(retired(world)).toBe(true);
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
        expect(retired(winner)).toBe(false);
        expect(winner.group.parent).toBe(theme.scene);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
    });
});
