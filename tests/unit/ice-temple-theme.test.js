/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import IceTempleTheme from '../../src/themes/ice-temple/ice-temple-theme.js';
import { ICE_TEMPLE_TETROMINOS } from '../../src/themes/ice-temple/ice-temple-tetrominos.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'ice-temple',
);

const mocks = vi.hoisted(() => ({ initialize: null, instances: [] }));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
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
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.getPixelRatio = () => 1;
                this.setSize = vi.fn();
                this.getDrawingBufferSize = (target) => target.set(1280, 720);
                this.render = vi.fn();
                this.compute = vi.fn();
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
});

const owners = [];
function createTheme() {
    const theme = new IceTempleTheme();
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

function stubBrowser({ gpu = false, search = '', quality = 'Low' } = {}) {
    const listeners = new Map();
    const container = { replaceChildren: vi.fn(), appendChild: vi.fn() };
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search },
        settings: { effectQuality: quality, graphicsQuality: quality },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'ice-temple-theme' ? container : null),
        querySelector: () => null,
        querySelectorAll: () => [],
    });
    vi.stubGlobal('navigator', gpu ? { gpu: {}, userAgent: 'Linux' } : {});
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return { container, listeners };
}

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};

// Every test here builds the whole temple (55,000 triangles and a baked noise texture). Alone
// that is a fraction of a second; in the full suite on a loaded machine it can be several.
vi.setConfig({ testTimeout: 20000 });

describe('Ice Temple theme: one node renderer on both backends', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
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
        const entry = THEME_REGISTRY.find(({ id }) => id === 'ice-temple');
        expect(entry).toMatchObject({
            displayName: 'Ice Temple',
            module: './ice-temple/ice-temple-theme.js',
            icon: './ice-temple/ice-temple-theme-icon.png',
        });
    });

    it('ships no classic shader material, no legacy WebGL renderer and no MaterialX noise', () => {
        const sources = readdirSync(themeDir).filter((name) => name.endsWith('.js'))
            .map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(sources.length).toBeGreaterThan(12);
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            // Absolute asset paths resolve to the filesystem root under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets)\//);
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

    it('honours ?forceWebGL even when a GPU is present', async () => {
        stubBrowser({ gpu: true, search: '?forceWebGL=1' });
        const theme = createTheme();
        const renderer = await theme.createRenderer(theme.lifecycleGeneration);
        expect(mocks.instances).toHaveLength(1);
        expect(renderer.options.forceWebGL).toBe(true);
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

    it('builds the scene, keeps a single-output scene pass and parks nothing to warm', async () => {
        const { container } = stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.renderer).toBe(mocks.instances[0]);
        expect(theme.isWebGPU).toBe(true);
        expect(container.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
        expect(theme.world).toBeTruthy();
        expect(theme.post).toBeTruthy();
        expect(theme.director).toBeTruthy();
        expect(await theme.whenCriticalReady()).toBe(true);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([]);
        expect(theme.getTetrominoConfig()).toBe(ICE_TEMPLE_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({ backend: 'WebGPU', quality: 'High', droppedEvents: 0 });
        // The camera sees the weather layer the ice floor's mirror skips.
        expect(theme.camera.layers.mask & 2).toBe(2);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
    });

    it('builds the same scene on the WebGL2 backend', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.post).toBeTruthy();
        expect(theme.world.reflection).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
    });

    it('loads nothing: the temple is generated, and the lens frost reads the noise the world baked', async () => {
        stubBrowser({ quality: 'Low' });
        const theme = createTheme();
        await expect(theme.createScene(theme.lifecycleGeneration)).resolves.toBeUndefined();
        expect(theme.world.textures).toHaveLength(1);
        expect(theme.world.noise.isDataTexture).toBe(true);
        expect(() => theme.stepFrame(16)).not.toThrow();
    });

    it('stages gameplay on the bus and lands it on the next frame', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        expect(theme.world.counts).toMatchObject({ locks: 0, clears: 0 }); // staged, not yet applied
        theme.stepFrame(16);
        expect(theme.world.counts).toMatchObject({ locks: 1, clears: 1 });
        expect(theme.world.combo).toBe(1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        theme.stepFrame(32);
        expect(theme.world.counts.locks).toBe(1);
    });

    it('resonates to the longest chain on any board', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        theme.reportCombo(2, 1);
        theme.reportCombo(5, 2);
        expect(theme.world.combo).toBe(5);
        theme.reportCombo(0, 2);
        expect(theme.world.combo).toBe(2);
        theme.reportCombo(0, 1);
        expect(theme.world.combo).toBe(0);
    });

    it('honours the reaction settings', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
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
    });

    it('puts the temple back at rest when a run ends', async () => {
        const { listeners } = stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        for (let i = 0; i < 3; i++) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.stepFrame(16 * (i + 1));
        }
        expect(theme.world.combo).toBe(3);
        listeners.get('gameOver')();
        expect(theme.world.getState()).toMatchObject({ combo: 0, resonance: 0, counts: { locks: 0, clears: 0, quads: 0 } });
        expect(theme.combos.size).toBe(0);
    });

    it('rebuilds on a quality change and not on an unrelated setting', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { musicVolume: 0.2 } });
        await Promise.resolve();
        expect(rebuild).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(theme.pendingQuality).toBe('Low');
    });

    it('reads its capture flags from the URL and freezes the simulation on a fixed time', async () => {
        stubBrowser({ quality: 'Low', search: '?iceTempleTime=42&iceTempleParts=sky,floor' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.world.time).toBe(42);
        expect(theme.world.parts.architecture.mesh.visible).toBe(false);
        expect(theme.world.parts.floor.mesh.visible).toBe(true);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.time).toBe(42);
    });

    it('retires its renderer and its monitors exactly once, and survives a second stop', async () => {
        stubBrowser({ gpu: true, quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        const published = theme.renderer;
        const { world } = theme;
        const disposeWorld = vi.spyOn(world, 'dispose');
        theme.disposeRuntime();
        theme.disposeRuntime();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(published, { nullInstance: false });
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(theme.renderer).toBeNull();
        expect(theme.world).toBeNull();
        expect(theme.director).toBeNull();
        // A late bus event after retirement is harmless.
        expect(() => eventBus.emit(EVENTS.PIECE_LOCK, { piece: T })).not.toThrow();
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
});
