import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import BlackHoleTheme, { QUALITY_PRESETS } from '../../src/themes/black-hole/black-hole-theme.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const rendererState = vi.hoisted(() => ({ candidates: [], init: () => Promise.resolve(), timestamps: false }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    class TestRenderer {
        constructor(options) {
            this.options = options;
            this.isWebGPURenderer = true;
            this.backend = { isWebGPUBackend: !options.forceWebGL, trackTimestamp: false };
            this.domElement = { style: {}, setAttribute: vi.fn(), parentNode: null };
            this.init = vi.fn(() => rendererState.init(this));
            this.dispose = vi.fn(() => Promise.resolve());
            this.setAnimationLoop = vi.fn();
            this.setClearColor = vi.fn();
            this.setPixelRatio = vi.fn();
            this.setSize = vi.fn();
            this.getDrawingBufferSize = vi.fn((target) => target.set(1280, 720));
            this.render = vi.fn();
            this.hasFeature = vi.fn(() => rendererState.timestamps);
            this.resolveTimestampsAsync = vi.fn(() => Promise.resolve(4));
            rendererState.candidates.push(this);
        }
    }
    return { ...actual, WebGPURenderer: TestRenderer };
});

// The galaxy bake is exercised in black-hole-world.test.js; here it only has to arrive.
vi.mock('../../src/themes/black-hole/black-hole-world.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, bakeBlackHoleTexturesAsync: vi.fn(() => Promise.resolve({ baked: true })) };
});

let themes;
let container;
let rafs;
let mediaQuery;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createTheme() {
    const theme = new BlackHoleTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'buildScene').mockImplementation((bakes) => {
        theme.builtWith = bakes;
        theme.scene = { clear: vi.fn() };
        theme.camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
        const director = { energy: 0.4, flash: 0.1 };
        for (const handler of ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCascade', 'onTSpin',
            'onPerfectClear', 'onLevelUp', 'calm']) director[handler] = vi.fn();
        const group = new THREE.Group();
        const parked = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicNodeMaterial());
        parked.visible = false;
        group.add(parked);
        theme.world = {
            director,
            matter: { group, parked },
            ripples: [{
                x: 0.5, y: 0.5, radius: 0, strength: 0,
            }],
            update: vi.fn(),
            prepareCamera: vi.fn(),
            setViewport: vi.fn(),
            setBoardRect: vi.fn(),
            setReducedMotion: vi.fn(),
            getDiagnostics: vi.fn(() => ({})),
            dispose: vi.fn(),
        };
        theme.post = {
            useMRT: false,
            update: vi.fn(),
            render: vi.fn(),
            setSize: vi.fn(),
            getDiagnostics: vi.fn(() => ({})),
            dispose: vi.fn(),
        };
        theme.applyMotionPreference();
    });
    return theme;
}

async function started() {
    const theme = createTheme();
    await theme.start({ loadTheme: vi.fn() });
    return theme;
}

beforeEach(() => {
    themes = [];
    rafs = [];
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    rendererState.timestamps = false;
    mediaQuery = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    container = {
        id: 'black-hole-theme',
        children: [],
        dataset: { themeRegistryOwned: 'true' },
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { removeProperty: vi.fn() },
        parentNode: { removeChild: vi.fn() },
        appendChild: vi.fn((canvas) => { container.children.push(canvas); canvas.parentNode = container; }),
        removeChild: vi.fn((canvas) => {
            container.children = container.children.filter((child) => child !== canvas);
            canvas.parentNode = null;
        }),
    };
    vi.stubGlobal('window', {
        settings: {},
        location: { search: '?forceWebGL=1' },
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 1,
        matchMedia: vi.fn(() => mediaQuery),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
        hidden: false,
        getElementById: (id) => (id === 'black-hole-theme' ? container : null),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { gpu: {} });
    vi.stubGlobal('requestAnimationFrame', (callback) => { rafs.push(callback); return rafs.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    themes.forEach((theme) => theme.stop());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Black Hole theme lifecycle', () => {
    it('starts on the node renderer, honours forceWebGL and adopts the static container', async () => {
        const theme = await started();
        expect(rendererState.candidates).toHaveLength(1);
        const [renderer] = rendererState.candidates;
        expect(renderer.options).toMatchObject({ forceWebGL: true, antialias: false, alpha: false });
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.resourceProfile).toBe('heavy-gpu');
        expect(container.children).toEqual([renderer.domElement]);
        expect(theme.containers).toHaveLength(0);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.lifecycleState).toBe('running');
        expect(rafs).toHaveLength(1);
        expect(theme.builtWith).toEqual({ baked: true });
        expect(theme.world.prepareCamera).toHaveBeenCalledWith(1440 / 900);
        expect(theme.world.setViewport).toHaveBeenCalledWith(1280, 720);
        const ratio = theme.getEffectivePixelRatio(QUALITY_PRESETS.High.pixelRatio);
        expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(ratio);
    });

    it('prefers WebGPU and falls back to WebGL2 when it fails to initialise', async () => {
        window.location.search = '';
        rendererState.init = (renderer) => (renderer.options.forceWebGL
            ? Promise.resolve() : Promise.reject(new Error('no adapter')));
        const theme = await started();
        expect(rendererState.candidates.map((renderer) => renderer.options.forceWebGL)).toEqual([false, true]);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalled();
        expect(theme.renderer).toBe(rendererState.candidates[1]);
    });

    it('retires a renderer whose initialisation outlives the start that asked for it', async () => {
        const gate = deferred();
        rendererState.init = () => gate.promise;
        const theme = createTheme();
        const pending = theme.start({ loadTheme: vi.fn() });
        await Promise.resolve();
        theme.stop();
        gate.resolve();
        await pending;
        expect(theme.renderer).toBeNull();
        expect(theme.world).toBeNull();
        expect(container.children).toHaveLength(0);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalled();
    });

    it('draws the parked event layers once before the first frame, then parks them again', async () => {
        const theme = createTheme();
        let visibleAtWarm = null;
        const original = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation((bakes) => {
            original(bakes);
            theme.post.render.mockImplementation(() => {
                if (visibleAtWarm === null) visibleAtWarm = theme.world.matter.parked.visible;
            });
        });
        await theme.start({ loadTheme: vi.fn() });
        expect(visibleAtWarm).toBe(true);
        expect(theme.world.matter.parked.visible).toBe(false);
        expect(theme.getWarmupRoots()).toEqual([theme.world.matter.group]);
        expect(theme.post.render).toHaveBeenCalledTimes(1);
    });

    it('advances the world, feeds the post chain and renders, skipping hidden frames', async () => {
        const theme = await started();
        theme.world.update.mockClear();
        theme.post.render.mockClear();
        rafs.at(-1)(1000);
        rafs.at(-1)(1016);
        expect(theme.post.render).toHaveBeenCalled();
        const [time, delta, pointer] = theme.world.update.mock.calls.at(-1);
        expect(time).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThanOrEqual(0.05);
        expect(pointer).toBe(theme.pointer);
        expect(theme.post.update).toHaveBeenLastCalledWith({ energy: 0.4, flash: 0.1, ripples: theme.world.ripples });

        const frames = theme.world.update.mock.calls.length;
        document.hidden = true;
        rafs.at(-1)(1032);
        expect(theme.world.update).toHaveBeenCalledTimes(frames);
    });

    it('routes every gameplay event to the director', async () => {
        const theme = await started();
        const { director } = theme.world;
        const lock = {
            piece: {
                x: 3, y: 20, shape: [[1]], color: '#62ffe0',
            },
        };
        eventBus.emit(EVENTS.HARD_DROP, { distance: 9 });
        eventBus.emit(EVENTS.PIECE_LOCK, lock);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22] });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(director.onHardDrop).toHaveBeenCalledWith({ distance: 9 });
        expect(director.onPieceLock).toHaveBeenCalledWith(lock, true);
        expect(director.onLineClear).toHaveBeenCalledWith({ lineCount: 2, clearedRows: [23, 22] });
        expect(director.onCascade).toHaveBeenCalledWith({ comboCount: 3 });
        expect(director.onTSpin).toHaveBeenCalledTimes(1);
        expect(director.onPerfectClear).toHaveBeenCalledTimes(1);
        expect(director.onLevelUp).toHaveBeenCalledWith({ level: 2 });
    });

    it('honours the effect settings: no visible feed, or no background effects at all', async () => {
        const theme = await started();
        const { director } = theme.world;
        window.settings.pieceLockRipple = false;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 1 } });
        expect(director.onPieceLock).toHaveBeenLastCalledWith({ piece: { x: 1 } }, false);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(director.onLineClear).toHaveBeenCalledTimes(1);

        window.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 1 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, {});
        expect(director.onPieceLock).toHaveBeenCalledTimes(1);
        expect(director.onLineClear).toHaveBeenCalledTimes(1);
        expect(director.onPerfectClear).not.toHaveBeenCalled();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { backgroundComboEffects: false } });
        expect(director.calm).toHaveBeenCalled();
    });

    it('stops reacting while paused and after it has stopped', async () => {
        const theme = await started();
        const { director } = theme.world;
        theme.pause();
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(director.onLineClear).not.toHaveBeenCalled();
        theme.stop();
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(director.onLineClear).not.toHaveBeenCalled();
    });

    it('follows reduced-motion preference and re-reads the boards after a layout change', async () => {
        mediaQuery.matches = true;
        const theme = await started();
        expect(theme.world.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(mediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function), undefined);

        const card = {
            getAttribute: () => 'solo',
            querySelector: () => ({
                getBoundingClientRect: () => ({
                    left: 576, right: 864, top: 90, bottom: 810, width: 288, height: 720,
                }),
            }),
        };
        document.querySelectorAll = () => [card];
        theme.scheduleBoardReads();
        theme.update(0.016);
        expect(theme.world.setBoardRect).toHaveBeenLastCalledWith(0, {
            slot: 0, left: 0.4, right: 0.6, top: 0.1, bottom: 0.9,
        });
    });

    it('rebuilds on a real tier change only', async () => {
        const theme = await started();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { effectQuality: 'High' } });
        await Promise.resolve();
        expect(rendererState.candidates).toHaveLength(1);

        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'Minimum' });
        await vi.waitFor(() => expect(rendererState.candidates).toHaveLength(2));
        await vi.waitFor(() => expect(theme.lifecycleState).toBe('running'));
        expect(theme.quality).toBe('Minimal');
        expect(theme.qualityPreset).toBe(QUALITY_PRESETS.Minimal);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalled();
        expect(container.children).toEqual([rendererState.candidates[1].domElement]);
    });

    it('resizes once per real change, at the tier pixel ratio', async () => {
        const theme = await started();
        const [renderer] = rendererState.candidates;
        const calls = renderer.setSize.mock.calls.length;
        theme.resize(1440, 900);
        expect(renderer.setSize).toHaveBeenCalledTimes(calls);
        theme.resize(390, 844);
        expect(renderer.setSize).toHaveBeenLastCalledWith(390, 844);
        expect(theme.world.prepareCamera).toHaveBeenLastCalledWith(390 / 844);
        expect(theme.post.setSize).toHaveBeenLastCalledWith(390, 844);
        theme.resize(390, 844);
        expect(renderer.setSize).toHaveBeenCalledTimes(calls + 1);
        // Without usable numbers it falls back to the live viewport.
        theme.resize(0, NaN);
        expect(renderer.setSize).toHaveBeenLastCalledWith(1440, 900);
    });

    it('releases everything on stop and survives repeated teardown', async () => {
        const theme = await started();
        const { world, post } = theme;
        const [renderer] = rendererState.candidates;
        theme.stop();
        theme.stop();
        theme.dispose();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        expect(post.dispose).toHaveBeenCalledTimes(1);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(0);
        expect(theme.world).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.eventUnsubscribers).toHaveLength(0);
    });

    it('chains terminal cleanup through dispose to BaseTheme exactly once', async () => {
        const theme = await started();
        const base = vi.spyOn(BaseTheme.prototype, 'cleanup');
        const dispose = vi.spyOn(theme, 'dispose');
        theme.cleanup();
        theme.cleanup();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(base).toHaveBeenCalledTimes(1);
        expect(theme.cleanupComplete).toBe(true);
        await expect(theme.start({ loadTheme: vi.fn() })).rejects.toThrow(/terminal cleanup/);
    });

    it('selects the cheapest tier for the legacy label and exposes the tier table', () => {
        const theme = createTheme();
        window.settings.effectQuality = 'Minimum';
        expect(theme.getGraphicsQuality()).toBe('Minimal');
        window.settings.effectQuality = undefined;
        window.settings.graphicsQuality = 'ultra';
        expect(theme.getGraphicsQuality()).toBe('Ultra');
        expect(theme.qualityPresets).toBe(QUALITY_PRESETS);
        expect(theme.getTetrominoConfig().colors).toHaveProperty('I');
    });
});

describe('Black Hole dynamic resolution wiring', () => {
    it('applies a new render scale as a pixel ratio without re-reading the boards', async () => {
        const theme = await started();
        const [renderer] = rendererState.candidates;
        const base = theme.getEffectivePixelRatio(QUALITY_PRESETS.High.pixelRatio);
        theme.boardReads = [];
        vi.spyOn(theme.resolution, 'update').mockImplementation(() => {
            theme.resolution.scale = 0.8;
            return true;
        });
        theme.update(0.016);
        expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(Math.round(base * 0.8 * 100) / 100);
        expect(theme.world.setViewport).toHaveBeenCalledTimes(2);
        expect(theme.boardReads).toHaveLength(0);
    });

    it('reads load from the browser\'s frame cadence, not from the frames it chose to draw', async () => {
        const theme = await started();
        const update = vi.spyOn(theme.resolution, 'update').mockReturnValue(false);
        // Two animation frames are skipped to hold the frame-rate cap; the third is drawn.
        const draws = [false, false, true];
        vi.spyOn(theme, 'shouldRenderFrame').mockImplementation(() => draws.shift() ?? true);
        theme.framesSinceDraw = 0;
        rafs.at(-1)(1000);
        rafs.at(-1)(1007);
        expect(update).not.toHaveBeenCalled();
        rafs.at(-1)(1014);
        const [delta, , cadence] = update.mock.calls.at(-1);
        expect(cadence).toBeCloseTo(delta / 3, 9);
        rafs.at(-1)(1021);
        const [next, , nextCadence] = update.mock.calls.at(-1);
        expect(nextCadence).toBeCloseTo(next, 9);
        // A hidden page delivers no frames worth counting.
        document.hidden = true;
        rafs.at(-1)(1028);
        expect(theme.framesSinceDraw).toBe(0);
    });

    it('holds the frame-rate target to what the display can show', async () => {
        const theme = await started();
        window.settings.targetFrameRate = 120;
        window.serenityBlocks = { frameRateController: { monitorRefreshRate: 50 } };
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { targetFrameRate: 120 } });
        expect(theme.resolution.targetMs).toBeCloseTo(1000 / 50, 6);
        window.serenityBlocks.frameRateController.monitorRefreshRate = 144;
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { targetFrameRate: 120 } });
        expect(theme.resolution.targetMs).toBeCloseTo(1000 / 120, 6);
        window.serenityBlocks = undefined;
        window.settings.targetFrameRate = undefined;
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: {} });
        expect(theme.resolution.targetMs).toBeCloseTo(1000 / 60, 6);
    });

    it('samples GPU render time only where the backend reports it', async () => {
        const theme = await started();
        expect(theme.gpuTiming.enabled).toBe(false);
        expect(rendererState.candidates[0].backend.trackTimestamp).toBe(false);
        theme.sampleGpuTiming();
        expect(rendererState.candidates[0].resolveTimestampsAsync).not.toHaveBeenCalled();

        window.location.search = '';
        rendererState.timestamps = true;
        const native = await started();
        const renderer = rendererState.candidates.at(-1);
        expect(native.isWebGPU).toBe(true);
        expect(native.gpuTiming.enabled).toBe(true);
        expect(renderer.backend.trackTimestamp).toBe(true);
        native.time = 1;
        native.sampleGpuTiming();
        native.sampleGpuTiming();
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(native.resolution.gpu).toMatchObject({ valid: true, ms: 4, at: 1 });
        expect(native.gpuTiming.pending).toBe(false);
    });

    it('never publishes a render time that resolves after the runtime it measured is gone', async () => {
        window.location.search = '';
        rendererState.timestamps = true;
        const theme = await started();
        const renderer = rendererState.candidates.at(-1);
        const query = deferred();
        renderer.resolveTimestampsAsync.mockImplementation(() => query.promise);
        const { resolution, gpuTiming } = theme;
        theme.time = 1;
        theme.sampleGpuTiming();
        expect(gpuTiming.pending).toBe(true);

        theme.stop();
        expect(renderer.backend.trackTimestamp).toBe(false);
        query.resolve(12);
        await query.promise;
        await Promise.resolve();
        expect(resolution.gpu.valid).toBe(false);
        expect(theme.gpuTiming).not.toBe(gpuTiming);
        expect(theme.gpuTiming).toMatchObject({ enabled: false, pending: false });
    });
});
