import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import FallTheme, { readFallEventCount } from '../../src/themes/fall/fall-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { setGlobalRenderScale } from '../../src/themes/base-theme.js';

vi.mock('../../src/utils/viewport.js', () => ({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));

const rendererState = vi.hoisted(() => ({ candidates: [], init: () => Promise.resolve() }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    class TestRenderer {
        constructor(options) {
            this.options = options;
            this.isWebGPURenderer = true;
            this.backend = { isWebGPUBackend: !options.forceWebGL };
            this.domElement = {
                style: {}, setAttribute: vi.fn(), parentNode: null,
            };
            this.init = vi.fn(() => rendererState.init(this));
            this.dispose = vi.fn(() => Promise.resolve());
            this.setAnimationLoop = vi.fn();
            this.setClearColor = vi.fn();
            this.setPixelRatio = vi.fn();
            this.setSize = vi.fn();
            this.render = vi.fn();
            rendererState.candidates.push(this);
        }
    }
    return { ...actual, WebGPURenderer: TestRenderer };
});

let themes;
let container;
let rafs;
let liveRafs;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function runFrame(index, timestamp) {
    liveRafs.delete(index + 1);
    rafs[index](timestamp);
}

function createTheme() {
    const theme = new FallTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    return theme;
}

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240);
        theme.camera.position.set(0, 4, 18);
        theme.camera.lookAt(0, 4, -35);
        theme.world = {
            group: new THREE.Group(),
            update: vi.fn(),
            prepareCamera: vi.fn(),
            dispose: vi.fn(),
        };
        theme.reactions = {
            onPieceLock: vi.fn(),
            onLineClear: vi.fn(),
            onCombo: vi.fn(),
            update: vi.fn(),
            reset: vi.fn(),
            dispose: vi.fn(),
            getFrame: () => ({ pulse: 0.2 }),
        };
        theme.post = {
            update: vi.fn(), render: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
        };
    });
}

beforeEach(() => {
    themes = [];
    rafs = [];
    liveRafs = new Map();
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    container = {
        id: 'fall-theme',
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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
        hidden: false,
        getElementById: (id) => (id === 'fall-theme' ? container : null),
        querySelector: () => null,
        querySelectorAll: () => [container],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { gpu: {} });
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        rafs.push(callback);
        liveRafs.set(rafs.length, callback);
        return rafs.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => liveRafs.delete(id)));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setGlobalRenderScale(1);
});

afterEach(() => {
    themes.forEach((theme) => theme.stop());
    setGlobalRenderScale(1);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Fall gameplay payloads', () => {
    it.each([
        [{ lineCount: 4 }, ['lineCount', 'count', 'lines'], 1, 4],
        [{ detail: { lines: 3 } }, ['lineCount', 'count', 'lines'], 1, 3],
        [{ detail: { combo: '8' } }, ['comboCount', 'combo', 'count'], 0, 8],
        [{ comboCount: NaN, count: 6 }, ['comboCount', 'combo', 'count'], 0, 6],
        [{ detail: { count: Infinity } }, ['comboCount', 'combo', 'count'], 0, 0],
        [{ lineCount: true }, ['lineCount', 'count', 'lines'], 1, 1],
        [{ lineCount: [], lines: 3 }, ['lineCount', 'count', 'lines'], 1, 3],
        [{ lineCount: { valueOf: () => 4 }, lines: 2 }, ['lineCount', 'count', 'lines'], 1, 2],
        [{ lineCount: '   ' }, ['lineCount', 'count', 'lines'], 1, 1],
        [2.9, ['lineCount', 'count', 'lines'], 1, 2],
    ])('normalizes count %j', (payload, keys, fallback, expected) => {
        expect(readFallEventCount(payload, keys, fallback)).toBe(expected);
    });

    it('routes wrapped events once after listeners are rebuilt', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.PIECE_LOCK, { detail: { position: { x: 2 } } });
        eventBus.emit(EVENTS.LINE_CLEAR, { detail: { lines: '4' } });
        eventBus.emit(EVENTS.COMBO, { detail: { combo: 8 } });
        expect(theme.reactions.onPieceLock).toHaveBeenCalledOnce();
        expect(theme.reactions.onPieceLock).toHaveBeenCalledWith({ position: { x: 2 } });
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(4, { lines: '4' });
        expect(theme.reactions.onCombo).toHaveBeenCalledExactlyOnceWith(8, { combo: 8 });
        theme.stop();
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        expect(eventBus.listeners.get(EVENTS.COMBO)?.size || 0).toBe(0);
    });

    const suppressedStates = ['inactive', 'paused', 'disabled', 'hidden', 'rendering-paused'];
    it.each(suppressedStates)('suppresses all %s reactions', (state) => {
        const theme = createTheme();
        theme.isActive = state !== 'inactive';
        theme.isPaused = state === 'paused';
        if (state === 'disabled') window.settings.backgroundComboEffects = false;
        if (state === 'hidden') document.hidden = true;
        if (state === 'rendering-paused') window.isRenderingPaused = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        theme.onPieceLock();
        theme.onLineClear(4);
        theme.onCombo(8);
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();
        expect(theme.reactions.onCombo).not.toHaveBeenCalled();
    });

    it('keeps clears and combos enabled when only the lock ripple is disabled', () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.pieceLockRipple = false;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.setupEventListeners();
        theme.onPieceLock();
        theme.onLineClear(4);
        theme.onCombo(8);
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).toHaveBeenCalledOnce();
        expect(theme.reactions.onCombo).toHaveBeenCalledOnce();
    });

    it('ignores explicit nonpositive clears while retaining the unknown-payload default', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.onLineClear(0);
        theme.onLineClear({ detail: { lineCount: -2 } });
        theme.onLineClear({ lines: '0' });
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();
        theme.onLineClear({});
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(1, {});
    });

    it('bounds large event counts and preserves origin metadata', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        const clear = { lineCount: 200, viewportOrigin: { x: 0.2, y: 0.8 }, player: 2 };
        const combo = { comboCount: 100, position: { x: 0.75, y: 0.4 }, source: 'odyssey' };
        theme.onLineClear({ detail: clear });
        theme.onCombo(combo);
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(4, clear);
        expect(theme.reactions.onCombo).toHaveBeenCalledExactlyOnceWith(32, combo);
    });

    it('applies live effect toggles immediately and discards queued celebrations when disabled', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { detail: { changed: { backgroundComboEffects: 'false' } } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        expect(theme.reactions.reset).toHaveBeenCalledOnce();
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();
        expect(theme.reactions.onCombo).not.toHaveBeenCalled();

        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { backgroundComboEffects: true, pieceLockRipple: 'off' } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(2, { lineCount: 2 });
        expect(theme.reactions.onCombo).toHaveBeenCalledExactlyOnceWith(3, { comboCount: 3 });

        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'pieceLockRipple', value: true });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2 } });
        expect(theme.reactions.onPieceLock).toHaveBeenCalledExactlyOnceWith({ piece: { x: 2 } });
    });
});

describe('Fall renderer ownership', () => {
    it('retires initialization finishing after stop without publishing a canvas or scene', async () => {
        const pending = deferred();
        rendererState.init = () => pending.promise;
        const theme = createTheme();
        theme.isActive = true;
        theme.lifecycleGeneration = 7;
        const build = vi.spyOn(theme, 'buildScene');
        const start = theme.createScene(7);
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        theme.stop();
        pending.resolve();
        await start;
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
        expect(rafs).toHaveLength(0);
    });

    it('falls back to the node WebGL2 renderer after native initialization fails', async () => {
        window.location.search = '';
        rendererState.init = (renderer) => (renderer.options.forceWebGL
            ? Promise.resolve() : Promise.reject(new Error('native unavailable')));
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates.map((renderer) => renderer.options.forceWebGL)).toEqual([false, true]);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(container.children).toHaveLength(1);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
    });

    it('honors a bare forceWebGL URL flag without attempting native initialization', async () => {
        window.location.search = '?forceWebGL';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
        expect(rendererState.candidates[0].init).toHaveBeenCalledOnce();
    });

    it('detaches synchronously while observing asynchronous renderer disposal', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const {
            renderer, world, post, timer,
        } = theme;
        const pending = deferred();
        renderer.dispose.mockReturnValue(pending.promise);
        const timerDispose = vi.spyOn(timer, 'dispose');
        theme.stop();
        theme.stop();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(post.dispose).toHaveBeenCalledOnce();
        expect(timerDispose).toHaveBeenCalledOnce();
        expect(container.children).toHaveLength(0);
        expect(theme.renderer).toBeNull();
        expect(theme.scene).toBeNull();
        expect(theme.timer).toBeNull();
        pending.resolve();
        await pending.promise;
    });

    it('preserves the static registry container through terminal cleanup', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(theme.containers).toEqual([]);
        theme.cleanup();
        expect(container.parentNode.removeChild).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(theme.cleanupComplete).toBe(true);
    });

    it('does not let late initialization dispose or replace a newer runtime', async () => {
        const pending = deferred();
        rendererState.init = (renderer) => (rendererState.candidates.indexOf(renderer) === 0
            ? pending.promise : Promise.resolve());
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        const firstGeneration = theme.lifecycleGeneration;
        const firstStart = theme.createScene(firstGeneration);
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        theme.stop();
        theme.isActive = true;
        await theme.createScene(theme.lifecycleGeneration);
        const activeRenderer = theme.renderer;
        const activeWorld = theme.world;
        pending.resolve();
        await firstStart;
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(activeRenderer.dispose).not.toHaveBeenCalled();
        expect(theme.renderer).toBe(activeRenderer);
        expect(theme.world).toBe(activeWorld);
        expect(container.children).toEqual([activeRenderer.domElement]);
        expect(liveRafs.size).toBe(1);
    });

    it('releases every owned resource and subscription once through repeated stop and cleanup', async () => {
        window.location.search = '?forceWebGL=1&themeValidation=1';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const {
            renderer, world, post, reactions, timer,
        } = theme;
        const timerDispose = vi.spyOn(timer, 'dispose');
        expect(window.__FALL__).toBe(theme);
        expect(theme.getWarmupRoots()).toEqual([world.group]);
        expect(theme.usesMrtScenePass()).toBe(false);
        theme.stop();
        theme.stop();
        theme.cleanup();
        theme.cleanup();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(post.dispose).toHaveBeenCalledOnce();
        expect(reactions.dispose).toHaveBeenCalledOnce();
        expect(timerDispose).toHaveBeenCalledOnce();
        expect(container.children).toEqual([]);
        expect(liveRafs.size).toBe(0);
        expect(theme.animationIds).toEqual([]);
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(theme._eventListeners).toEqual([]);
        for (const key of ['renderer', 'world', 'post', 'reactions', 'timer', 'scene', 'camera']) {
            expect(theme[key]).toBeNull();
        }
        expect(window.__FALL__).toBeUndefined();
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(reactions.onCombo).not.toHaveBeenCalled();
    });
});

describe('Fall cadence and restart', () => {
    it('keeps scheduling skipped frames, freezes hidden simulation and clamps resumed time', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        const timer = {
            reset: vi.fn(), update: vi.fn(), getDelta: () => 0.4, dispose: vi.fn(),
        };
        theme.timer = timer;
        const render = vi.spyOn(theme, 'renderFrame').mockImplementation(() => {});
        const gate = vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(false);
        theme.startAnimation();
        runFrame(0, 1000);
        expect(rafs).toHaveLength(2);
        expect(timer.update).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(timer.reset).toHaveBeenCalledOnce();
        gate.mockReturnValue(true);
        document.hidden = true;
        runFrame(1, 1100);
        expect(rafs).toHaveLength(3);
        expect(timer.reset).toHaveBeenCalledTimes(2);
        expect(theme.time).toBe(0);
        document.hidden = false;
        runFrame(2, 1200);
        expect(rafs).toHaveLength(4);
        expect(theme.time).toBe(0.05);
        expect(theme.reactions.update).toHaveBeenCalledExactlyOnceWith(0.05);
        expect(theme.world.update).toHaveBeenCalledExactlyOnceWith(0.05, 0.05, { pulse: 0.2 });
        expect(render).toHaveBeenCalledOnce();
        expect(liveRafs.size).toBe(1);
    });

    it('resumes one loop after pause even when the manager also restarts it', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rafs).toHaveLength(1);
        expect(theme.pause()).toBe(true);
        expect(theme.animationLoopStarted).toBe(false);
        expect(theme.resume()).toBe(true);
        theme.restartRenderLoop();
        expect(rafs).toHaveLength(2);
        expect(theme.animationLoopStarted).toBe(true);
        expect(liveRafs.size).toBe(1);
    });

    it('cancels a queued quality rebuild when the theme is switched away', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        theme.stop();
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
    });

    it('parks quality changes during pause and requests one rebuild on resume', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.pause();
        theme.handleSettingsChanged({ detail: { settings: { effectQuality: 'Low' } } });
        theme.handleSettingsChanged({ changed: { effectQuality: 'Minimal' } });
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        expect(theme.pendingQuality).toBe('Minimal');
        expect(theme.rebuildPending).toBe(true);
        expect(liveRafs.size).toBe(0);
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(theme.rebuildPending).toBe(false);
        // The replacement start owns restarting; no obsolete scene loop resumes.
        expect(liveRafs.size).toBe(0);
    });

    it('coalesces rapid quality changes and keeps canonical settings ahead of legacy aliases', async () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.effectQuality = 'High';
        stubSceneBuild(theme);
        await theme.createScene();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.handleSettingsChanged({ type: 'graphicsQuality', value: 'Extreme' });
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        theme.handleSettingsChanged({ detail: { changed: { effectQuality: 'Minimal' } } });
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBe('Minimal');
    });

    it('changes internal pixel ratio on renderScale updates with unchanged viewport dimensions', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { renderer, world, post } = theme;
        renderer.setPixelRatio.mockClear();
        renderer.setSize.mockClear();
        world.prepareCamera.mockClear();
        post.setSize.mockClear();
        theme.resize(1440, 900);
        expect(renderer.setSize).not.toHaveBeenCalled();
        theme.handleSettingsChanged({ detail: { renderScale: 0.5 } });
        // Shared settings apply after the dispatch; the adapter reads them in its microtask.
        setGlobalRenderScale(0.5);
        await Promise.resolve();
        expect(renderer.setPixelRatio).toHaveBeenCalledExactlyOnceWith(0.5);
        expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(post.setSize).toHaveBeenCalledExactlyOnceWith(1440, 900);
        expect(world.prepareCamera).toHaveBeenCalledExactlyOnceWith(1440 / 900);
    });

    it('does not apply an obsolete quality target when the player immediately restores the current tier', async () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.effectQuality = 'High';
        stubSceneBuild(theme);
        await theme.createScene();
        const requestedTiers = [];
        vi.spyOn(theme, 'start').mockImplementation(async () => {
            requestedTiers.push(theme.pendingQuality ?? theme.quality);
        });
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'Low' });
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'High' });
        await Promise.resolve();
        // Cancelling the rebuild or rebuilding High are both valid; selecting Low is not.
        expect(requestedTiers.every((tier) => tier === 'High')).toBe(true);
        expect(theme.pendingQuality).not.toBe('Low');
    });

    it('builds the latest tier when quality is reversed during renderer initialization', async () => {
        const pending = deferred();
        rendererState.init = () => pending.promise;
        window.settings.effectQuality = 'Low';
        const theme = createTheme();
        theme.isActive = true;
        theme.pendingQuality = 'Low';
        stubSceneBuild(theme);
        const builtTiers = [];
        const buildScene = theme.buildScene.getMockImplementation();
        theme.buildScene.mockImplementation(() => {
            builtTiers.push(theme.quality);
            buildScene();
        });
        const start = theme.createScene();
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        expect(theme.renderer).toBeNull();
        expect(theme.quality).toBe('Low');
        window.settings.effectQuality = 'High';
        // No runtime listener can observe this dispatch until initialization ends.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'High' });
        pending.resolve();
        await start;
        expect(builtTiers).toEqual(['High']);
        expect(theme.quality).toBe('High');
        expect(theme.pendingQuality).toBeNull();
        expect(theme.rebuildPending).toBe(false);
        expect(container.children).toHaveLength(1);
        expect(liveRafs.size).toBe(1);
    });

    it('retains an explicit pending quality when global settings stay unchanged during initialization', async () => {
        const pending = deferred();
        rendererState.init = () => pending.promise;
        window.settings.effectQuality = 'High';
        const theme = createTheme();
        theme.isActive = true;
        theme.pendingQuality = 'Low';
        stubSceneBuild(theme);
        const start = theme.createScene();
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        pending.resolve();
        await start;
        expect(theme.buildScene).toHaveBeenCalledOnce();
        expect(theme.quality).toBe('Low');
        expect(theme.pendingQuality).toBeNull();
    });

    it('ignores stale renderScale work and frame callbacks after a replacement runtime is published', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const obsoleteFrame = rafs[0];
        theme.handleSettingsChanged({ type: 'renderScale', value: 0.5 });
        theme.stop();
        theme.isActive = true;
        await theme.createScene(theme.lifecycleGeneration);
        const { renderer, world } = theme;
        const sizes = renderer.setSize.mock.calls.length;
        const callbacks = rafs.length;
        obsoleteFrame(1000);
        await Promise.resolve();
        expect(renderer.setSize).toHaveBeenCalledTimes(sizes);
        expect(rafs).toHaveLength(callbacks);
        expect(world.update).toHaveBeenCalledExactlyOnceWith(0, 0, { pulse: 0.2 });
        expect(liveRafs.size).toBe(1);
    });
});
