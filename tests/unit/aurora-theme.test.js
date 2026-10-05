import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import AuroraTheme, { QUALITY_PRESETS } from '../../src/themes/aurora/aurora-theme.js';
import { readBoardSpans } from '../../src/themes/aurora/aurora-board-rects.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const rendererState = vi.hoisted(() => ({ candidates: [], init: () => Promise.resolve() }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    class TestRenderer {
        constructor(options) {
            this.options = options;
            this.isWebGPURenderer = true;
            this.backend = { isWebGPUBackend: !options.forceWebGL };
            this.domElement = { style: {}, setAttribute: vi.fn(), parentNode: null };
            this.init = vi.fn(() => rendererState.init(this));
            this.dispose = vi.fn(() => Promise.resolve());
            this.setAnimationLoop = vi.fn();
            this.setClearColor = vi.fn();
            this.setPixelRatio = vi.fn();
            this.setSize = vi.fn();
            this.getDrawingBufferSize = vi.fn((target) => target.set(1280, 720));
            this.render = vi.fn();
            rendererState.candidates.push(this);
        }
    }
    return { ...actual, WebGPURenderer: TestRenderer };
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
    const theme = new AuroraTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = { clear: vi.fn() };
        theme.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 12000);
        const director = {
            activity: 0.4, surge: 0.1,
        };
        for (const handler of ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCascade', 'onTSpin',
            'onBackToBack', 'onPerfectClear', 'onLevelUp', 'calm']) director[handler] = vi.fn();
        theme.world = {
            director,
            update: vi.fn(),
            renderBuffers: vi.fn(),
            prepareCamera: vi.fn(),
            setViewport: vi.fn(),
            setBoardSpan: vi.fn(),
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
    mediaQuery = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    container = {
        id: 'aurora-theme',
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
        getElementById: (id) => (id === 'aurora-theme' ? container : null),
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

describe('Aurora theme lifecycle', () => {
    it('starts on the node renderer, honours forceWebGL and adopts the static container', async () => {
        const theme = await started();
        expect(rendererState.candidates).toHaveLength(1);
        const [renderer] = rendererState.candidates;
        expect(renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.resourceProfile).toBe('heavy-gpu');
        expect(container.children).toEqual([renderer.domElement]);
        expect(theme.containers).toHaveLength(0);
        expect(theme.usesMrtScenePass()).toBe(false);
        expect(theme.lifecycleState).toBe('running');
        expect(rafs).toHaveLength(1);
        expect(theme.world.prepareCamera).toHaveBeenCalledWith(1440 / 900);
        expect(theme.world.setViewport).toHaveBeenCalledWith(1280, 720);
        expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(theme.getEffectivePixelRatio(QUALITY_PRESETS.High.pixelRatio));
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

    it('advances the world and renders the curtain buffer before the scene, skipping hidden frames', async () => {
        const theme = await started();
        const order = [];
        theme.world.renderBuffers.mockImplementation(() => order.push('buffers'));
        theme.post.render.mockImplementation(() => order.push('scene'));
        theme.world.update.mockClear();
        rafs.at(-1)(1000);
        rafs.at(-1)(1016);
        expect(order.slice(0, 2)).toEqual(['buffers', 'scene']);
        expect(theme.world.update).toHaveBeenCalled();
        const [time, delta, pointer] = theme.world.update.mock.calls.at(-1);
        expect(time).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThanOrEqual(0.05);
        expect(pointer).toBe(theme.pointer);
        expect(theme.post.update).toHaveBeenLastCalledWith({ activity: 0.4, surge: 0.1 });

        const frames = theme.world.update.mock.calls.length;
        document.hidden = true;
        rafs.at(-1)(1032);
        expect(theme.world.update).toHaveBeenCalledTimes(frames);
    });

    it('routes every gameplay event to the director', async () => {
        const theme = await started();
        const { director } = theme.world;
        const lock = { piece: { x: 3, shape: [[1]], color: '#6cf5ff' } };
        eventBus.emit(EVENTS.HARD_DROP, { distance: 9 });
        eventBus.emit(EVENTS.PIECE_LOCK, lock);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22] });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(director.onHardDrop).toHaveBeenCalledWith({ distance: 9 });
        expect(director.onPieceLock).toHaveBeenCalledWith(lock, true);
        expect(director.onLineClear).toHaveBeenCalledWith({ lineCount: 2, clearedRows: [23, 22] });
        expect(director.onCascade).toHaveBeenCalledWith({ comboCount: 3 });
        expect(director.onTSpin).toHaveBeenCalledTimes(1);
        expect(director.onBackToBack).toHaveBeenCalledTimes(1);
        expect(director.onPerfectClear).toHaveBeenCalledTimes(1);
        expect(director.onLevelUp).toHaveBeenCalledWith({ level: 2 });
    });

    it('honours the effect settings: no visible lock, or no background effects at all', async () => {
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
                    left: 576, right: 864, top: 90, bottom: 820, width: 288, height: 730,
                }),
            }),
        };
        document.querySelectorAll = () => [card];
        theme.scheduleBoardReads();
        theme.update(0.016);
        expect(theme.world.setBoardSpan).toHaveBeenLastCalledWith(0, 0.4, 0.6);
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

describe('Aurora board spans', () => {
    const rect = (left, right, top = 100, bottom = 800) => ({
        left, right, top, bottom, width: right - left, height: bottom - top,
    });
    const card = (player, box, visible = true) => ({
        getAttribute: () => player,
        checkVisibility: () => visible,
        querySelector: () => ({ getBoundingClientRect: () => box }),
    });
    const read = (cards) => readBoardSpans({ querySelectorAll: () => cards }, { innerWidth: 1000, innerHeight: 900 });

    it('reports the solo board as slot 0', () => {
        expect(read([card('solo', rect(400, 600))])).toEqual([{ slot: 0, left: 0.4, right: 0.6 }]);
    });

    it('gives each multiplayer board its slot and slot 0 their combined span', () => {
        expect(read([card('1', rect(100, 300)), card('2', rect(700, 900))])).toEqual([
            { slot: 0, left: 0.1, right: 0.9 },
            { slot: 1, left: 0.1, right: 0.3 },
            { slot: 2, left: 0.7, right: 0.9 },
        ]);
    });

    it('ignores hidden, collapsed, off-screen and unknown boards', () => {
        expect(read([
            card('1', rect(100, 300), false),
            card('2', rect(100, 110)),
            card('3', rect(1200, 1500)),
            card('lobby', rect(100, 300)),
            card('9', rect(100, 300)),
        ])).toEqual([]);
        expect(readBoardSpans(null, null)).toEqual([]);
        expect(readBoardSpans({ querySelectorAll: () => [] }, { innerWidth: 0, innerHeight: 0 })).toEqual([]);
    });
});
