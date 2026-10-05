/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import { CHIRAL_GOLD_TETROMINOS } from '../../src/themes/chiral-gold/chiral-gold-tetrominos.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'chiral-gold',
);

// A High scene bakes a 1024-wide studio; the build machine is often busy with other sessions.
vi.setConfig({ testTimeout: 30000 });

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
    const theme = new ChiralGoldTheme();
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

function stubBrowser({
    gpu = false, search = '', quality = 'Low', width = 1280, height = 720,
} = {}) {
    const listeners = new Map();
    const container = { replaceChildren: vi.fn(), appendChild: vi.fn() };
    vi.stubGlobal('window', {
        innerWidth: width,
        innerHeight: height,
        devicePixelRatio: 1,
        location: { search },
        settings: { effectQuality: quality, graphicsQuality: quality },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'chiral-gold-theme' ? container : null),
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

describe('Chiral Gold theme: one node renderer on both backends', () => {
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
        const entry = THEME_REGISTRY.find(({ id }) => id === 'chiral-gold');
        expect(entry).toMatchObject({
            displayName: 'Chiral Gold',
            module: './chiral-gold/chiral-gold-theme.js',
            icon: './chiral-gold/chiral-gold-theme-icon.png',
        });
    });

    it('ships no classic shader material, no legacy renderer, no compute and no MaterialX noise', () => {
        const names = readdirSync(themeDir).filter((name) => name.endsWith('.js'));
        const sources = names.map((name) => readFileSync(path.join(themeDir, name), 'utf8'));
        expect(names.length).toBeGreaterThan(12);
        // The modules of the theme this one replaced are gone.
        for (const gone of ['compute', 'materials', 'particles', 'sculpture', 'shaders']) {
            expect(names).not.toContain(`chiral-gold-${gone}.js`);
        }
        for (const source of sources) {
            expect(source).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(source).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(source).not.toMatch(/EffectComposer|UnrealBloomPass/);
            expect(source).not.toMatch(/\bmx_\w+\s*[(,]/); // a DXC compile pathology
            expect(source).not.toMatch(/from 'three'/);
            expect(source).not.toMatch(/renderer\.compute\w*\(|instancedArray\(|\.compute\(\s*\w+\s*\)/);
            // Nothing is fetched: absolute asset paths would also break under file:// (packaged Electron).
            expect(source).not.toMatch(/['"`]\/(textures|assets)\//);
            expect(source).not.toMatch(/TextureLoader|GLTFLoader|fetch\(/);
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
        expect(theme.getTetrominoConfig()).toBe(CHIRAL_GOLD_TETROMINOS);
        expect(theme.getDiagnostics()).toMatchObject({ backend: 'WebGPU', quality: 'High', droppedEvents: 0 });
        // The camera sees the layer the water's mirror skips.
        expect(theme.camera.layers.mask & 2).toBe(2);
        const materials = [];
        theme.scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(12);
        expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
        // Every drawable is in the scene from the first frame: nothing is added at event time.
        expect(materials.every((m) => m.visible !== false)).toBe(true);
    });

    it('builds the same scene on the WebGL2 backend, mirror and all', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.post).toBeTruthy();
        expect(theme.world.reflection).toBeTruthy();
        expect(() => theme.stepFrame(16)).not.toThrow();
        expect(theme.renderer.compute).not.toHaveBeenCalled();
    });

    it.each(['Minimal', 'Low'])('keeps the second render and the bloom off at %s', async (quality) => {
        stubBrowser({ quality, width: 390, height: 844 });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.quality).toBe(quality);
        expect(theme.world.reflection).toBeNull();
        expect(theme.post.bloomNode).toBeNull();
        expect(theme.post.look.msaa).toBe(0);
        expect(() => theme.stepFrame(16)).not.toThrow();
        // A phone held upright (the manager's resize funnel reports its shape): the lens is wide
        // and the towers are slender, not short.
        theme.resize(390, 844);
        theme.world.applyLayout(true);
        expect(theme.world.fov).toBe(60);
        expect(theme.world.place.scale).toBeLessThan(0.6);
        expect(theme.world.place.scaleY).toBeGreaterThanOrEqual(0.8);
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

    it('strikes on four lines and pours the next alloy on a level-up', async () => {
        stubBrowser({ quality: 'High' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [20, 21, 22, 23], cascadeCount: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        theme.stepFrame(16);
        expect(theme.world.counts.strikes).toBe(1);
        expect(theme.world.level).toBe(2);
    });

    it('takes the heat of the longest chain on any board', async () => {
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

    it('lets the music move the hall, and not when motion is reduced', async () => {
        stubBrowser({ quality: 'Low' });
        const theme = createTheme();
        theme.audioManager = {
            getAudioAnalysis: vi.fn(() => ({
                bassEnergy: 0.9, midEnergy: 0.4, trebleEnergy: 0.2, overallEnergy: 0.5, beatDetected: true,
            })),
        };
        await theme.createScene(theme.lifecycleGeneration);
        for (let i = 1; i <= 30; i++) theme.stepFrame(i * 16);
        const audio = theme.world.u.audio.value;
        expect(audio.x).toBeGreaterThan(0.8);
        expect(audio.x).toBeLessThanOrEqual(1);
        expect(audio.y).toBeGreaterThan(0.2);
        expect(audio.w).toBe(1);
        theme.handleSettingsChanged({ detail: { reducedMotion: true } });
        for (let i = 31; i <= 400; i++) theme.stepFrame(i * 16);
        expect(theme.world.u.audio.value.x).toBeLessThan(0.01);
        expect(theme.world.u.audio.value.w).toBeLessThan(0.01);
        // A theme without an audio manager is silent, not broken.
        theme.audioManager = null;
        expect(() => theme.stepFrame(401 * 16)).not.toThrow();
    });

    it('puts the hall back at rest when a run ends', async () => {
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
        expect(theme.world.getState()).toMatchObject({ combo: 0, counts: { locks: 3, clears: 3, strikes: 0 } });
        expect(theme.world.heat).toBe(0);
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
        stubBrowser({ quality: 'Low', search: '?chiralGoldTime=42&chiralGoldParts=sky,water' });
        const theme = createTheme();
        await theme.createScene(theme.lifecycleGeneration);
        expect(theme.world.time).toBe(42);
        expect(theme.world.groups.towers.every((g) => g.visible === false)).toBe(true);
        expect(theme.world.groups.water[0].visible).toBe(true);
        theme.stepFrame(16);
        theme.stepFrame(1016);
        expect(theme.world.time).toBe(42);
        // A capture ignores the music: the same frame every time.
        expect(theme.world.capture).toBe(true);
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
