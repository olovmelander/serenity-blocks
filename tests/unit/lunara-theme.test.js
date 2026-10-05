/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import LunaraTheme from '../../src/themes/lunara/lunara-theme.js';
import { LUNARA_TETROMINOS } from '../../src/themes/lunara/lunara-tetrominos.js';
import { REST_RIG, fovForAspect } from '../../src/themes/lunara/lunara-world.js';
import { LUNARA_PALETTES } from '../../src/themes/lunara/lunara-core.js';
import { QUALITY_NAMES } from '../../src/themes/lunara/lunara-quality.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'lunara',
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
    const theme = new LunaraTheme();
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
        getElementById: (id) => (id === 'lunara-theme' ? container : null),
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

describe('Lunara theme: one node renderer on both backends', () => {
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

    it('is registered under its id with its own icon', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'lunara');
        expect(entry).toMatchObject({
            displayName: 'Lunara',
            module: './lunara/lunara-theme.js',
            icon: './lunara/lunara-theme-icon.png',
        });
        expect(new LunaraTheme().name).toBe('lunara');
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
        }
        // The theme it replaces is gone: its GLSL twins, its compute pass, its texture sets.
        for (const retired of ['assets', 'compute', 'materials', 'noise', 'reaction-particles']) {
            expect(names).not.toContain(`lunara-${retired}.js`);
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

    it.each(['?forceWebGL=1', '?lunaraForceWebGL', '?lunaraForceWebGL=true'])(
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
        expect(theme.renderer.setClearColor).toHaveBeenCalledWith(0x020109, 1);
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
        expect(theme.getTetrominoConfig()).toBe(LUNARA_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({
            backend: 'WebGPU',
            quality: 'High',
            droppedEvents: 0,
            reducedMotion: false,
            world: { quality: 'High', combo: 0, palette: LUNARA_PALETTES[0].name },
        });
        // The camera stands on the rig the valley is composed for, and sees the wisps' layer
        // the flats' mirror skips.
        expect(theme.camera.fov).toBeCloseTo(fovForAspect(1280 / 720), 3);
        expect(theme.camera.near).toBe(REST_RIG.near);
        expect(theme.camera.far).toBe(REST_RIG.far);
        expect(theme.camera.layers.mask & 2).toBe(2);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(10);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // The loop is running.
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        expect(theme.isWebGPU).toBe(false);
        expect(theme.getDiagnostics().backend).toBe('WebGL2');
        expect(theme.post).toBeTruthy();
        expect(theme.world.reflection).toBeTruthy();
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
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('has a cap for every tier the world defines, rising with the tier', () => {
        expect(PIXEL_RATIO_CAPS.map(([quality]) => quality)).toEqual(QUALITY_NAMES);
        for (let i = 1; i < PIXEL_RATIO_CAPS.length; i++) {
            expect(PIXEL_RATIO_CAPS[i][1]).toBeGreaterThan(PIXEL_RATIO_CAPS[i - 1][1]);
        }
    });

    it('starts without waiting for the moon map and survives its failing to load', async () => {
        stubBrowser({ quality: 'Low' });
        const theme = createTheme();
        // The stubbed document cannot decode an image: the loader throws, the moons stay smooth.
        await expect(theme.createScene(theme.lifecycleGeneration)).resolves.toBeUndefined();
        await Promise.resolve();
        expect(theme.world.mapReady).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('The moon map failed to load'));
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('says nothing when the map arrives, or when the world it was for has gone', async () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load')
            .mockImplementation((url, onLoad) => onLoad(new THREE.Texture()));
        const { theme } = await startTheme({ quality: 'Low' });
        await Promise.resolve();
        expect(load).toHaveBeenCalledOnce();
        expect(load.mock.calls[0][0]).toBe('./textures/2k_moon.jpg');
        expect(theme.world.mapReady).toBe(true);
        expect(console.warn).not.toHaveBeenCalled();

        // A map still on its way when the theme is torn down fails quietly.
        let arrive = null;
        load.mockImplementation((url, onLoad) => { arrive = onLoad; });
        await theme.createScene(theme.lifecycleGeneration);
        theme.disposeRuntime();
        arrive(new THREE.Texture());
        await Promise.resolve();
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
        expect(theme.world.counts).toMatchObject({ locks: 0, clears: 0 }); // staged, not yet applied
        theme.stepFrame(16);
        expect(theme.world.counts).toMatchObject({ locks: 1, clears: 1 });
        expect(theme.world.counts.wisps).toBeGreaterThan(0);
        expect(theme.world.combo).toBe(1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(theme.world.counts.locks).toBe(1);
    });

    it('carries a hard drop, a four-line clear and a new level through the director to the valley', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const lock = vi.spyOn(theme.world, 'onLock');
        const clear = vi.spyOn(theme.world, 'onClear');
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        theme.stepFrame(16);
        // One harder lock, in the piece's colour, at its column and row.
        expect(lock).toHaveBeenCalledOnce();
        expect(lock.mock.calls[0][0]).toMatchObject({
            hardDrop: true, color: LUNARA_TETROMINOS.colors.I, rows: [19], player: 0,
        });
        expect(lock.mock.calls[0][0].u).toBeCloseTo(0.8, 6);
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 4, rows: [19, 18, 17, 16] });
        expect(theme.world.counts).toMatchObject({ locks: 1, clears: 1, quads: 1 });
        expect(theme.world.getState()).toMatchObject({ level: 3, palette: LUNARA_PALETTES[2].name, combo: 1 });
        // The post follows the valley: the kick of the drop, the clock for its grain.
        expect(theme.post.uKick.value).toBeGreaterThan(0);
        expect(theme.post.uTime.value).toBe(theme.time);
        expect(theme.post.uHeart.value.x).toBeCloseTo(theme.world.heart.x, 9);
    });

    it('charges the valley to the longest chain on any board', async () => {
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
        expect(theme.world.counts.locks).toBe(0);
        theme.handleSettingsChanged({ detail: { backgroundComboEffects: true, pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        theme.stepFrame(32);
        expect(theme.world.counts).toMatchObject({ locks: 0, clears: 1 });
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
        // The camera stands still.
        stepFrames(system.theme, 30);
        expect(system.theme.camera.position.toArray()).toEqual([0, REST_RIG.height, 0]);
    });

    it('puts the valley back at rest when a run ends', async () => {
        const { theme, listeners } = await startTheme({ quality: 'High' });
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        const { orbit } = theme.world;
        listeners.get('gameOver')();
        expect(theme.world.getState()).toMatchObject({
            combo: 0, power: 0, held: 0, counts: { locks: 0, clears: 0, quads: 0 },
        });
        expect(theme.combos.size).toBe(0);
        expect(theme.world.orbit).toBe(orbit); // the sky keeps turning
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
        await vi.waitFor(() => expect(theme.world?.getState().quality).toBe('Minimal'), { timeout: 4000 });
        expect(theme.quality).toBe('Minimal');
        expect(theme.world).not.toBe(first);
        expect(first.disposed).toBe(true);
        expect(theme.pendingQuality).toBeNull();
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        // One set of listeners, not two: a lock lands once.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(16);
        expect(theme.world.counts.locks).toBe(1);
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
        // The first frame back does not jump by the time spent parked.
        const before = theme.time;
        theme.stepFrame(600000);
        expect(theme.time - before).toBeCloseTo(1 / 60, 9);
        // A theme with nothing built cannot resume: the manager restarts it.
        theme.disposeRuntime();
        expect(theme.resume()).toBe(false);
    });

    it('follows a resize once and tells the valley, the post and the director', async () => {
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
    });

    it('re-applies its pixel ratio when the render scale changes', async () => {
        const { theme } = await startTheme({ quality: 'High' });
        const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.6);
        theme.handleSettingsChanged({ detail: { renderScale: 0.6 } });
        expect(theme.renderer.setPixelRatio).not.toHaveBeenCalledWith(0.6); // deferred a microtask
        await Promise.resolve();
        expect(ratio).toHaveBeenCalled();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.6);
        expect(theme.world.u.viewport.value.toArray()).toEqual([Math.floor(1280 * 0.6), Math.floor(720 * 0.6)]);
    });

    it('reads the board on frame time, aims the valley at it and calms the post over the card', async () => {
        const { theme, page, win } = await startTheme({ quality: 'High' });
        const manager = { handlers: new Map(), off: vi.fn() };
        manager.on = vi.fn((name, handler) => {
            manager.handlers.set(name, handler);
            return manager.off;
        });
        win.serenityBlocks = { gameModeManager: manager };
        // Nothing on screen: the valley aims at where the solo board would stand, the post is not calmed.
        stepFrames(theme, 2);
        expect(theme.world.getState().layoutLive).toBe(false);
        expect(theme.layout).toMatchObject({ applied: null, live: false });
        expect(theme.post.uCalmStrength.value).toBe(0);
        // The mode manager turned up after the build: the theme subscribes once.
        expect([...manager.handlers.keys()].sort()).toEqual(['modeActivated', 'modeStarted', 'modeStopped']);

        // A mode starts: a card, its board and the HUD appear.
        page.cards = [box(440, 40, 400, 640)];
        page.canvas = box(490, 150, 300, 500);
        page.hud = box(900, 200, 140, 320);
        stepFrames(theme, 5);
        expect(theme.world.getState().layoutLive).toBe(false); // no polling: the next read is on a schedule
        manager.handlers.get('modeStarted')();
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(true);
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
        // A lock's wisp now leaves the card where the card really is.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        stepFrames(theme, 1);
        expect(theme.world.counts.locks).toBe(1);
        const from = theme.world.wisps.geometry.getAttribute('aFrom').array;
        const start = new THREE.Vector3(from[0], from[1], from[2]).project(theme.camera);
        expect(start.x * 0.5 + 0.5).toBeCloseTo(440 / 1280, 2);

        // The mode ends: the run is forgotten, the board is gone, the calm zones fade on the last rects.
        page.cards = [];
        page.canvas = null;
        page.hud = null;
        const reset = vi.spyOn(theme.world, 'resetSession');
        manager.handlers.get('modeStopped')();
        expect(reset).toHaveBeenCalledOnce();
        stepFrames(theme, 1);
        expect(theme.world.getState().layoutLive).toBe(false);
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
        const rest = theme.camera.position.x;
        const move = listeners.get('pointermove');
        move({ clientX: 1280, clientY: 360, pointerType: 'mouse' });
        expect(theme.pointer).toMatchObject({ x: 1, y: 0 });
        stepFrames(theme, 60);
        // Eased, never snapped.
        expect(theme.pointer.sx).toBeGreaterThan(0.5);
        expect(theme.pointer.sx).toBeLessThan(1);
        expect(theme.camera.position.x).toBeGreaterThan(rest + 0.2);
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
            quality: 'Low', search: '?lunaraTime=42&lunaraParts=sky,water&lunaraFalseColor=1',
        });
        expect(theme.flags).toMatchObject({
            time: 42, fixedDt: null, parts: ['sky', 'water'], falseColor: true, forceWebGL: false,
        });
        expect(theme.world.time).toBe(42);
        expect(theme.world.capture).toBe(true);
        expect(theme.world.parts.crystals.mesh.visible).toBe(false);
        expect(theme.world.parts.moon.mesh.visible).toBe(false);
        expect(theme.world.parts.water.mesh.visible).toBe(true);
        expect(theme.world.parts.sky.mesh.visible).toBe(true);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.time).toBe(42);
        expect(theme.post.uTime.value).toBe(42);
        // Gameplay still lands on a frozen frame (the layout watch runs on wall time).
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.stepFrame(1032);
        expect(theme.world.counts.locks).toBe(1);
    });

    it('steps a fixed frame when asked, whatever the wall clock does', async () => {
        const { theme } = await startTheme({ quality: 'Low', search: '?lunaraFixedDt=20' });
        expect(theme.flags).toMatchObject({ time: null, fixedDt: 0.02, parts: null });
        expect(theme.world.capture).toBe(true);
        theme.stepFrame(0);
        theme.stepFrame(3);
        theme.stepFrame(5000);
        expect(theme.world.time).toBeCloseTo(0.06, 12);
    });

    it('ignores capture flags that make no sense, and runs on the wall clock without them', async () => {
        const { theme } = await startTheme({
            quality: 'Low', search: '?lunaraTime=-3&lunaraFixedDt=abc&lunaraParts=&lunaraFalseColor=0',
        });
        expect(theme.flags).toEqual({
            forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
        });
        expect(theme.world.capture).toBe(false);
        expect(Object.values(theme.world.parts).every((part) => part.mesh.visible)).toBe(true);
        theme.stepFrame(1000);
        theme.stepFrame(1010);
        expect(theme.world.time).toBeCloseTo(1 / 60 + 0.01, 9);
        // A stall is clamped: the valley never jumps.
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
        expect(registration.label).toBe('lunara');
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
        expect(() => {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'Low' } });
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480 });
            theme.stepFrame(16);
            theme.resize(640, 480);
            theme.resetSession();
        }).not.toThrow();
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
    });
});
