import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import StellarDriftTheme, { readStellarDriftEventCount } from '../../src/themes/stellar-drift/stellar-drift-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

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
            this.compute = vi.fn();
            rendererState.candidates.push(this);
        }
    }
    return { ...actual, WebGPURenderer: TestRenderer };
});

let themes;
let container;
let rafs;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createTheme() {
    const theme = new StellarDriftTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    return theme;
}

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'setupPostProcessing').mockImplementation(() => {});
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        theme.scene = { clear: vi.fn() };
        theme.camera = { aspect: 1, updateProjectionMatrix: vi.fn() };
        theme.atmosphere = { update: vi.fn(), prepareCamera: vi.fn(), dispose: vi.fn() };
        theme.reactions = {
            onPieceLock: vi.fn(),
            onLineClear: vi.fn(),
            onCombo: vi.fn(),
            update: vi.fn(),
            reset: vi.fn(),
            getFrame: () => ({ rim: 0.2 }),
        };
        theme.postProcessing = {
            update: vi.fn(), render: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
        };
    });
}

beforeEach(() => {
    themes = [];
    rafs = [];
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    container = {
        id: 'stellar-drift-theme',
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
        getElementById: (id) => (id === 'stellar-drift-theme' ? container : null),
        querySelector: () => null,
        querySelectorAll: () => [container],
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

describe('Stellar Drift gameplay payloads', () => {
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
        expect(readStellarDriftEventCount(payload, keys, fallback)).toBe(expected);
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

    it.each(['inactive', 'paused', 'disabled'])('suppresses all %s reactions', (state) => {
        const theme = createTheme();
        theme.isActive = state !== 'inactive';
        theme.isPaused = state === 'paused';
        if (state === 'disabled') window.settings.backgroundComboEffects = false;
        stubSceneBuild(theme);
        theme.buildScene();
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
        theme.onPieceLock();
        theme.onLineClear(4);
        theme.onCombo(8);
        expect(theme.reactions.onPieceLock).not.toHaveBeenCalled();
        expect(theme.reactions.onLineClear).toHaveBeenCalledOnce();
        expect(theme.reactions.onCombo).toHaveBeenCalledOnce();
    });

    it('ignores malformed and nonpositive clears before forwarding a valid canonical count', () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        theme.buildScene();
        theme.onLineClear(0);
        theme.onLineClear({ detail: { lineCount: -2 } });
        theme.onLineClear({ lines: '0' });
        theme.onLineClear({});
        theme.onLineClear(false);
        theme.onLineClear();
        theme.onLineClear({ lineCount: true });
        theme.onLineClear({ lineCount: { valueOf: () => 4 } });
        expect(theme.reactions.onLineClear).not.toHaveBeenCalled();
        theme.onLineClear({ lineCount: 1 });
        expect(theme.reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(1, { lineCount: 1 });
    });
});

describe('Stellar Drift renderer ownership', () => {
    it.each([
        ['node WebGL2', true, 'Low'],
        ['native WebGPU', false, 'High'],
    ])(
        'builds the actual atmosphere, director and postProcessing on %s without GPU rendering',
        async (_label, forceWebGL, quality) => {
            window.location.search = forceWebGL ? '?forceWebGL=1' : '';
            window.settings.effectQuality = quality;
            rendererState.init = (renderer) => {
                if (!forceWebGL) renderer.backend.device = { limits: { maxColorAttachments: 8 } };
                return Promise.resolve();
            };
            const theme = createTheme();
            theme.isActive = true;
            await theme.createScene();
            expect(theme.scene.getObjectByName('stellar-drift-orbital-voyage')).toBe(theme.atmosphere.group);
            expect(theme.atmosphere.rng.seed).toBe(187);
            expect(theme.getWarmupRoots()).toEqual([theme.atmosphere.group]);
            expect(theme.postProcessing.disabled).toBe(quality === 'Low');
            expect(theme.usesMrtScenePass()).toBe(!forceWebGL);
            expect(theme.capabilities.compute).toBe(false);
            theme.atmosphere.group.traverse((object) => {
                if (object.material) expect(object.material.isNodeMaterial).toBe(true);
            });
            const debris = theme.scene.getObjectByName('stellar-drift-ice-debris');
            const seeds = debris.geometry.getAttribute('aSeed').array;
            expect(seeds.length).toBe(theme.qualityPreset.meteorCount * 4);
            expect(Array.from(seeds).every(Number.isFinite)).toBe(true);
            theme.onPieceLock({ detail: { position: { x: 3 } } });
            theme.update(0.05);
            expect(theme.reactions.getFrame().arcs.length).toBeGreaterThan(0);
            expect(theme.atmosphere.time.value).toBe(0.05);
            expect(theme.renderer.compute).not.toHaveBeenCalled();
        },
    );

    it('reports the active scene-pass MRT contract independently from renderer capabilities', () => {
        const theme = createTheme();
        theme.isWebGPU = true;
        expect(theme.usesMrtScenePass()).toBe(false);
        theme.postProcessing = { useMRT: false };
        expect(theme.usesMrtScenePass()).toBe(false);
        theme.isWebGPU = false;
        theme.postProcessing.useMRT = true;
        expect(theme.usesMrtScenePass()).toBe(true);
    });

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

    it('honors forceWebGL=0 as a native request instead of treating presence as true', async () => {
        window.location.search = '?forceWebGL=0';
        const theme = createTheme();
        theme.isActive = true;
        expect(await theme.initRenderer(container)).toBe(true);
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(false);
    });

    it('rejects current initialization failure so BaseTheme cannot publish a running empty scene', async () => {
        rendererState.init = () => Promise.reject(new Error('backend unavailable'));
        const theme = createTheme();
        await expect(theme.start({ loadTheme: vi.fn() })).rejects.toThrow('could not initialize node WebGL2');
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.isActive).toBe(false);
        expect(container.children).toHaveLength(0);
        expect(rafs).toHaveLength(0);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
    });

    it('does not publish a renderer finishing under an older runtime in the same lifecycle', async () => {
        const pending = deferred();
        rendererState.init = () => pending.promise;
        const theme = createTheme();
        theme.isActive = true;
        const init = theme.initRenderer(container, theme.lifecycleGeneration, theme.runtimeGeneration);
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        theme.runtimeGeneration += 1;
        pending.resolve();
        expect(await init).toBe(false);
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
    });

    it('detaches synchronously while observing asynchronous renderer disposal', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const {
            renderer, atmosphere, postProcessing, timer,
        } = theme;
        const pending = deferred();
        renderer.dispose.mockReturnValue(pending.promise);
        const timerDispose = vi.spyOn(timer, 'dispose');
        theme.stop();
        theme.stop();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(atmosphere.dispose).toHaveBeenCalledOnce();
        expect(postProcessing.dispose).toHaveBeenCalledOnce();
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
        theme.cleanup();
        expect(container.parentNode.removeChild).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(theme.cleanupComplete).toBe(true);
    });
});

describe('Stellar Drift cadence and restart', () => {
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
        rafs[0](1000);
        expect(rafs).toHaveLength(2);
        expect(timer.update).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(timer.reset).toHaveBeenCalledOnce();
        gate.mockReturnValue(true);
        document.hidden = true;
        rafs[1](1100);
        expect(rafs).toHaveLength(3);
        expect(timer.reset).toHaveBeenCalledTimes(2);
        expect(theme.time).toBe(0);
        document.hidden = false;
        rafs[2](1200);
        expect(rafs).toHaveLength(4);
        expect(theme.time).toBe(0.05);
        expect(theme.reactions.update).toHaveBeenCalledExactlyOnceWith(0.05);
        expect(theme.atmosphere.update).toHaveBeenCalledExactlyOnceWith(0.05, 0.05, { rim: 0.2 });
        expect(render).toHaveBeenCalledOnce();
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

    it('defers a paused quality change until resume and queues one fresh start', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        expect(theme.pause()).toBe(true);
        theme.handleSettingsChanged({ detail: { effectQuality: 'Low' } });
        await Promise.resolve();
        expect(theme.rebuildPending).toBe(true);
        expect(start).not.toHaveBeenCalled();
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(start).toHaveBeenCalledOnce();
        expect(theme.pendingQuality).toBe('Low');
    });

    it('cancels a deferred quality request when paused settings return to the active tier', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        expect(theme.pause()).toBe(true);
        theme.handleSettingsChanged({ effectQuality: 'Low' });
        await Promise.resolve();
        expect(theme.rebuildPending).toBe(true);
        theme.handleSettingsChanged({ effectQuality: 'High' });
        expect(theme.pendingQuality).toBeNull();
        expect(theme.rebuildPending).toBe(false);
        expect(theme.resume()).toBe(true);
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        expect(theme.animationLoopStarted).toBe(true);
    });
});
