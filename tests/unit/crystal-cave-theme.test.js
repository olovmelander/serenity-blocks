import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCrystalCaveCavern } from '../../src/themes/crystal-cave/crystal-cave-assets.js';
import CrystalCaveTheme, {
    QUALITY_PRESETS,
    readCrystalCaveEventCount,
} from '../../src/themes/crystal-cave/crystal-cave-theme.js';
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
            rendererState.candidates.push(this);
        }
    }
    return { ...actual, WebGPURenderer: TestRenderer };
});

let themes;
let container;
let rafs;
let cavern;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function stubAssets() {
    return { stub: true, geometry: { dispose: vi.fn() } };
}

function createTheme() {
    const theme = new CrystalCaveTheme();
    themes.push(theme);
    vi.spyOn(theme, 'setupGpuResilience').mockImplementation(() => {});
    theme.loadAssets = vi.fn(async () => stubAssets());
    return theme;
}

const REACTIONS = ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCombo', 'onTSpin', 'onBackToBack', 'onPerfectClear',
    'onLevelUp', 'onGameOver'];

function stubSceneBuild(theme) {
    vi.spyOn(theme, 'buildScene').mockImplementation(() => {
        const frame = { energy: 0.2, resonance: 0.3 };
        theme.scene = { clear: vi.fn() };
        theme.camera = new THREE.PerspectiveCamera(55, 1, 0.2, 320);
        theme.world = {
            group: { name: 'Crystal Cave' },
            update: vi.fn(),
            prepareCamera: vi.fn(),
            setBoard: vi.fn(),
            getDiagnostics: vi.fn(() => ({ crystals: 3 })),
            dispose: vi.fn(),
        };
        theme.reactions = {
            ...Object.fromEntries(REACTIONS.map((name) => [name, vi.fn()])),
            update: vi.fn(),
            getFrame: vi.fn(() => frame),
            dispose: vi.fn(),
        };
        theme.post = {
            useMRT: false,
            update: vi.fn(),
            render: vi.fn(),
            setSize: vi.fn(),
            dispose: vi.fn(),
            getDiagnostics: vi.fn(() => ({ disabled: false })),
        };
    });
}

function buildStubScene(theme) {
    stubSceneBuild(theme);
    theme.buildScene();
    return { world: theme.world, reactions: theme.reactions, post: theme.post };
}

function windowListener(name) {
    return window.addEventListener.mock.calls.findLast(([event]) => event === name)?.[1];
}

beforeAll(async () => {
    const bytes = readFileSync(new URL('../../src/themes/crystal-cave/assets/cavern.glb', import.meta.url));
    cavern = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
});

beforeEach(() => {
    themes = [];
    rafs = [];
    rendererState.candidates = [];
    rendererState.init = () => Promise.resolve();
    container = {
        id: 'crystal-cave-theme',
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
        getElementById: (id) => (id === 'crystal-cave-theme' ? container : null),
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

describe('Crystal Cave gameplay event normalization', () => {
    it.each([
        [{ lineCount: 4 }, ['lineCount', 'count', 'lines'], 1, 4],
        [{ detail: { lines: '3' } }, ['lineCount', 'count', 'lines'], 1, 3],
        [{ lineCount: NaN, count: 2 }, ['lineCount', 'count', 'lines'], 1, 2],
        [{ lineCount: Infinity, lines: 4 }, ['lineCount', 'count', 'lines'], 1, 4],
        [{ lineCount: true }, ['lineCount', 'count', 'lines'], 1, 1],
        [{ lineCount: [], lines: 3 }, ['lineCount', 'count', 'lines'], 1, 3],
        [{ lineCount: { valueOf: () => 4 }, lines: 2 }, ['lineCount', 'count', 'lines'], 1, 2],
        [{ lineCount: '   ' }, ['lineCount', 'count', 'lines'], 1, 1],
        [2.9, ['lineCount', 'count', 'lines'], 1, 2],
        [{ detail: '4.9' }, ['lineCount', 'count', 'lines'], 1, 4],
        [{ detail: { combo: '8' } }, ['comboCount', 'combo', 'count'], 0, 8],
        [{ comboCount: NaN, count: 6 }, ['comboCount', 'combo', 'count'], 0, 6],
        [{ detail: { count: Infinity } }, ['comboCount', 'combo', 'count'], 0, 0],
        [{ comboCount: Symbol('invalid') }, ['comboCount', 'combo', 'count'], 0, 0],
        [null, ['comboCount', 'combo', 'count'], 0, 0],
        [undefined, ['comboCount', 'combo', 'count'], 0, 0],
    ])('reads finite counts without coercing unrelated values: %j', (payload, keys, fallback, expected) => {
        expect(readCrystalCaveEventCount(payload, keys, fallback)).toBe(expected);
    });

    it('routes wrapped bus events once after repeated listener setup and unsubscribes on stop', () => {
        const theme = createTheme();
        theme.isActive = true;
        const { reactions } = buildStubScene(theme);
        theme.setupEventListeners();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.PIECE_LOCK, { detail: { piece: { x: 2 } } });
        eventBus.emit(EVENTS.LINE_CLEAR, { detail: { lines: '4', clearedRows: [20, 21, 22, 23] } });
        eventBus.emit(EVENTS.COMBO, { detail: { combo: 8 } });
        expect(reactions.onPieceLock).toHaveBeenCalledExactlyOnceWith({ piece: { x: 2 } });
        expect(reactions.onLineClear).toHaveBeenCalledExactlyOnceWith(4, { lines: '4', clearedRows: [20, 21, 22, 23] });
        expect(reactions.onCombo).toHaveBeenCalledExactlyOnceWith(8);
        theme.stop();
        theme.stop();
        eventBus.emit(EVENTS.PIECE_LOCK, {});
        eventBus.emit(EVENTS.LINE_CLEAR, { count: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 8 });
        expect(reactions.onPieceLock).toHaveBeenCalledOnce();
        expect(reactions.onLineClear).toHaveBeenCalledOnce();
        expect(reactions.onCombo).toHaveBeenCalledOnce();
        expect(theme.eventUnsubscribers).toHaveLength(0);
        expect(window.removeEventListener).toHaveBeenCalledWith('settingsChanged', expect.any(Function), undefined);
    });

    it('routes drops, flourishes and the end of a game to the director', () => {
        const theme = createTheme();
        theme.isActive = true;
        const { reactions } = buildStubScene(theme);
        theme.setupEventListeners();
        eventBus.emit(EVENTS.HARD_DROP, { piece: { x: 1 }, distance: 12 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 1 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        expect(reactions.onHardDrop).toHaveBeenCalledExactlyOnceWith({ piece: { x: 1 }, distance: 12 });
        expect(reactions.onTSpin).toHaveBeenCalledExactlyOnceWith({ lineCount: 2 });
        expect(reactions.onBackToBack).toHaveBeenCalledOnce();
        expect(reactions.onPerfectClear).toHaveBeenCalledOnce();
        expect(reactions.onLevelUp).toHaveBeenCalledOnce();
        windowListener('gameOver')();
        expect(reactions.onGameOver).toHaveBeenCalledOnce();
    });

    it.each(['inactive', 'paused', 'disabled', 'cleaned', 'hidden', 'rendering paused'])(
        'suppresses all %s scenery effects',
        (state) => {
            const theme = createTheme();
            theme.isActive = state !== 'inactive';
            theme.isPaused = state === 'paused';
            theme.cleanupComplete = state === 'cleaned';
            if (state === 'disabled') window.settings.backgroundComboEffects = false;
            if (state === 'hidden') document.hidden = true;
            if (state === 'rendering paused') window.isRenderingPaused = true;
            const { reactions } = buildStubScene(theme);
            theme.onHardDrop({ distance: 9 });
            theme.onPieceLock({});
            theme.onLineClear(4);
            theme.onCombo(8);
            theme.onFlourish('onTSpin', {});
            theme.onFlourish('onPerfectClear');
            for (const name of REACTIONS) expect(reactions[name]).not.toHaveBeenCalled();
        },
    );

    it('suppresses lock light without disabling clear or combo effects', () => {
        const theme = createTheme();
        theme.isActive = true;
        window.settings.pieceLockRipple = false;
        const { reactions } = buildStubScene(theme);
        theme.onHardDrop({ distance: 9 });
        theme.onPieceLock();
        theme.onLineClear({ count: 4 });
        theme.onCombo({ count: 8 });
        expect(reactions.onHardDrop).not.toHaveBeenCalled();
        expect(reactions.onPieceLock).not.toHaveBeenCalled();
        expect(reactions.onLineClear.mock.calls[0][0]).toBe(4);
        expect(reactions.onCombo.mock.calls[0][0]).toBe(8);
    });

    it('ignores nonpositive clears, keeps the unknown-payload default and bounds large counts', () => {
        const theme = createTheme();
        theme.isActive = true;
        const { reactions } = buildStubScene(theme);
        theme.onLineClear(0);
        theme.onLineClear({ detail: { lineCount: -2 } });
        theme.onLineClear({ lines: '0' });
        expect(reactions.onLineClear).not.toHaveBeenCalled();
        theme.onLineClear({});
        theme.onLineClear({ lineCount: 10000 });
        expect(reactions.onLineClear.mock.calls.map(([count]) => count)).toEqual([1, 4]);
    });

    it('keeps absent, zero and malformed combos quiet while bounding the largest combo', () => {
        const theme = createTheme();
        theme.isActive = true;
        const { reactions } = buildStubScene(theme);
        for (const payload of [undefined, {}, 0, -4, { combo: '0' }, { combo: Infinity }, { count: true }]) {
            theme.onCombo(payload);
        }
        expect(reactions.onCombo).not.toHaveBeenCalled();
        theme.onCombo({ detail: { comboCount: '8.9' } });
        theme.onCombo({ count: 1e12 });
        expect(reactions.onCombo.mock.calls.map(([count]) => count)).toEqual([8, 32]);
    });

    it('survives events that arrive before the scene exists', () => {
        const theme = createTheme();
        theme.isActive = true;
        expect(() => {
            theme.onHardDrop({});
            theme.onPieceLock({});
            theme.onLineClear(2);
            theme.onCombo(3);
            theme.onFlourish('onLevelUp');
            theme.onFlourish('notAMethod');
        }).not.toThrow();
    });
});

describe('Crystal Cave quality and responsive scene routing', () => {
    it.each([
        ['minimal', 'Minimal'], [' LOW ', 'Low'], ['medium', 'Medium'],
        ['high', 'High'], ['ULTRA', 'Ultra'], ['extreme', 'Extreme'],
        ['unknown', 'High'], [undefined, 'High'],
    ])('normalizes quality %s and preserves the public preset aliases', (input, expected) => {
        const theme = createTheme();
        theme.applyQualityPreset(input);
        expect(theme.quality).toBe(expected);
        expect(theme.currentQuality).toBe(expected);
        expect(theme.qualityPreset).toBe(QUALITY_PRESETS[expected]);
        expect(theme.activePreset).toBe(theme.qualityPreset);
    });

    it('reads canonical quality from effect settings before graphics settings', () => {
        const theme = createTheme();
        window.settings = { effectQuality: 'low', graphicsQuality: 'Ultra' };
        expect(theme.getCurrentQualityLevel()).toBe('Low');
        window.settings = { graphicsQuality: ' minimal ' };
        expect(theme.getCurrentQualityLevel()).toBe('Minimal');
    });

    it.each([[1440, 900], [390, 844]])('prepares hero composition and post size at viewport %sx%s', (width, height) => {
        const theme = createTheme();
        const { world, post } = buildStubScene(theme);
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        theme.resize(width, height);
        const aspect = width / height;
        expect(theme.camera.aspect).toBeCloseTo(aspect);
        expect(world.prepareCamera).toHaveBeenCalledOnce();
        expect(world.prepareCamera.mock.calls[0][0]).toBeCloseTo(aspect);
        expect(post.setSize).toHaveBeenCalledExactlyOnceWith(width, height);
        expect(theme.renderer.setSize).toHaveBeenCalledExactlyOnceWith(width, height);
        theme.resize(width, height);
        expect(world.prepareCamera).toHaveBeenCalledOnce();
        expect(theme.renderer.setSize).toHaveBeenCalledOnce();
    });

    it('coalesces a quality rebuild and cancels queued work after switching away', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.handleSettingsChanged({ detail: { type: 'effectQuality', value: 'low' } });
        theme.handleSettingsChanged({ effectQuality: 'minimal' });
        expect(theme.pendingQuality).toBe('Minimal');
        theme.stop();
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
    });

    it('defers a paused quality rebuild without doing GPU or scene work', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.isPaused = true;
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const { world, post } = buildStubScene(theme);
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        theme.handleSettingsChanged({ type: 'effectQuality', value: 'low' });
        await Promise.resolve();
        expect(theme.pendingQuality).toBe('Low');
        expect(theme.rebuildPending).toBe(true);
        expect(start).not.toHaveBeenCalled();
        expect(world.update).not.toHaveBeenCalled();
        expect(post.render).not.toHaveBeenCalled();
    });
});

describe('Crystal Cave renderer and runtime ownership', () => {
    it.each([
        ['native WebGPU', false, 'High'],
        ['node WebGL2', true, 'Low'],
    ])('builds the real cave and its bounded event pools on %s without GPU rendering', async (_label, forceWebGL, quality) => {
        window.location.search = forceWebGL ? '?forceWebGL=1' : '';
        window.settings.effectQuality = quality;
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets = vi.fn(async () => parseCrystalCaveCavern(cavern));
        // This construction probe uses a renderer mock rather than executing GPU work.
        const frame = vi.spyOn(theme, 'renderFrame').mockImplementation(() => {});
        await theme.createScene();
        expect(theme.loadAssets).toHaveBeenCalledOnce();
        expect(theme.scene.getObjectByName('Crystal Cave')).toBe(theme.world.group);
        expect(theme.getWarmupRoots()).toEqual([theme.world.group]);
        expect(theme.post.disabled).toBe(quality === 'Low');
        expect(theme.usesMrtScenePass()).toBe(false);
        // One frame through the shipped path builds every pipeline before the first lock.
        expect(frame).toHaveBeenCalledOnce();
        theme.scene.traverse((object) => {
            for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
                if (material) expect(material.isNodeMaterial).toBe(true);
            }
        });
        const diagnostics = theme.getDiagnostics();
        expect(diagnostics).toMatchObject({ quality, backend: forceWebGL ? 'WebGL2' : 'WebGPU' });
        expect(diagnostics.world.pools.sparks).toBe(QUALITY_PRESETS[quality].sparks);
        expect(diagnostics.world.crystals).toBeGreaterThan(500);
        const drawables = [];
        theme.scene.traverse((object) => { if (object.isMesh) drawables.push(object); });
        theme.onPieceLock({
            piece: {
                type: 'T', x: 2, y: 20, shape: [[1, 1, 1], [0, 1, 0]],
            },
        });
        theme.onLineClear({ lines: 4 });
        theme.onCombo({ comboCount: 8 });
        for (let step = 0; step < 30; step += 1) theme.update(0.03);
        const uniforms = theme.world.light.uniforms;
        expect(uniforms.energy.value).toBeGreaterThan(0);
        expect(uniforms.resonance.value).toBeGreaterThan(0);
        expect(theme.getDiagnostics().world.activeSparks).toBeGreaterThan(0);
        expect(theme.getDiagnostics().world.grown).toBe(4);
        expect(theme.post.getDiagnostics().exposure).toBeGreaterThanOrEqual(1.06);
        const after = [];
        theme.scene.traverse((object) => { if (object.isMesh) after.push(object); });
        expect(after).toEqual(drawables);
        expect(theme.renderer.render).not.toHaveBeenCalled();
    });

    it('keeps nothing when the cavern arrives after the theme was stopped', async () => {
        const pending = deferred();
        const theme = createTheme();
        theme.isActive = true;
        theme.lifecycleGeneration = 3;
        theme.loadAssets = vi.fn(() => pending.promise);
        const build = vi.spyOn(theme, 'buildScene');
        const starting = theme.createScene(3);
        await vi.waitFor(() => expect(theme.loadAssets).toHaveBeenCalledOnce());
        expect(theme.loadAssets.mock.calls[0][0]()).toBe(true);
        theme.stop();
        expect(theme.loadAssets.mock.calls[0][0]()).toBe(false);
        const late = stubAssets();
        pending.resolve(late);
        await starting;
        expect(late.geometry.dispose).toHaveBeenCalledOnce();
        expect(build).not.toHaveBeenCalled();
        expect(theme.assets).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(container.children).toHaveLength(0);
        expect(rafs).toHaveLength(0);
    });

    it('fails the start cleanly when the cavern cannot be loaded', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.loadAssets = vi.fn(async () => { throw new Error('cavern missing'); });
        const build = vi.spyOn(theme, 'buildScene');
        await expect(theme.createScene()).rejects.toThrow('cavern missing');
        expect(build).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
        expect(container.children).toHaveLength(0);
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
    });

    it('releases the cavern with the rest of the runtime, once', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const { assets } = theme;
        expect(assets.stub).toBe(true);
        theme.stop();
        theme.stop();
        expect(assets.geometry.dispose).toHaveBeenCalledOnce();
        expect(theme.assets).toBeNull();
    });

    it('retires renderer initialization finishing after stop without publishing a canvas', async () => {
        const pending = deferred();
        rendererState.init = () => pending.promise;
        const theme = createTheme();
        theme.isActive = true;
        theme.lifecycleGeneration = 7;
        const build = vi.spyOn(theme, 'buildScene');
        const starting = theme.createScene(7);
        await vi.waitFor(() => expect(rendererState.candidates[0]?.init).toHaveBeenCalledOnce());
        theme.stop();
        pending.resolve();
        await starting;
        expect(rendererState.candidates[0].dispose).toHaveBeenCalledOnce();
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
        expect(rafs).toHaveLength(0);
    });

    it('falls back from failed WebGPU initialization to node WebGL2 with the same artwork API', async () => {
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
        expect(theme.getWarmupRoots()).toEqual([theme.world.group]);
    });

    it('honors a bare forceWebGL URL flag without attempting a native device', async () => {
        window.location.search = '?forceWebGL';
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rendererState.candidates).toHaveLength(1);
        expect(rendererState.candidates[0].options.forceWebGL).toBe(true);
    });

    it('detaches synchronously and disposes every runtime resource once across repeated stop', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        const {
            renderer, world, reactions, post, timer,
        } = theme;
        const pending = deferred();
        renderer.dispose.mockReturnValue(pending.promise);
        const timerDispose = vi.spyOn(timer, 'dispose');
        theme.stop();
        theme.stop();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(world.dispose).toHaveBeenCalledOnce();
        expect(reactions.dispose).toHaveBeenCalledOnce();
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
        theme.cleanup();
        expect(container.parentNode.removeChild).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(0);
        expect(theme.cleanupComplete).toBe(true);
    });

    it('uses the post render path without also rendering the scene directly', () => {
        const theme = createTheme();
        const { post } = buildStubScene(theme);
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        theme.renderFrame();
        expect(post.render).toHaveBeenCalledOnce();
        expect(theme.renderer.render).not.toHaveBeenCalled();
        theme.post = null;
        theme.renderFrame();
        expect(theme.renderer.render).toHaveBeenCalledExactlyOnceWith(theme.scene, theme.camera);
    });
});

describe('Crystal Cave first frame', () => {
    it('draws one frame through the shipped post path before the loop starts, without advancing time', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(theme.post.render).toHaveBeenCalledOnce();
        expect(theme.renderer.render).not.toHaveBeenCalled();
        expect(theme.time).toBe(0);
        expect(theme.reactions.update).toHaveBeenCalledExactlyOnceWith(0);
        for (const name of REACTIONS) expect(theme.reactions[name]).not.toHaveBeenCalled();
        expect(rafs).toHaveLength(1);
    });

    it('does not start a loop for a theme that was paused while it loaded', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.isPaused = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rafs).toHaveLength(0);
        expect(theme.animationLoopStarted).toBe(false);
    });

    it('exposes itself for validation only when asked and withdraws on stop', async () => {
        const theme = createTheme();
        theme.isActive = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(window.__CRYSTAL_CAVE__).toBeUndefined();
        theme.stop();
        window.location.search = '?forceWebGL=1&themeValidation=1';
        theme.isActive = true;
        await theme.createScene();
        expect(window.__CRYSTAL_CAVE__).toBe(theme);
        theme.stop();
        expect(window.__CRYSTAL_CAVE__).toBeUndefined();
    });
});

describe('Crystal Cave animation cadence', () => {
    it('keeps scheduling skipped frames and freezes hidden simulation before clamping resumed time', () => {
        const theme = createTheme();
        theme.isActive = true;
        const { reactions, world, post } = buildStubScene(theme);
        const timer = {
            reset: vi.fn(), update: vi.fn(), getDelta: () => 0.4, dispose: vi.fn(),
        };
        theme.timer = timer;
        theme.renderer = new THREE.WebGPURenderer({ forceWebGL: true });
        const gate = vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(false);
        theme.startAnimation();
        rafs[0](1000);
        expect(rafs).toHaveLength(2);
        expect(timer.update).not.toHaveBeenCalled();
        expect(reactions.update).not.toHaveBeenCalled();
        expect(post.render).not.toHaveBeenCalled();
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
        expect(reactions.update).toHaveBeenCalledExactlyOnceWith(0.05);
        expect(world.update).toHaveBeenCalledExactlyOnceWith(0.05, 0.05, reactions, theme.smoothedPointer);
        expect(post.update).toHaveBeenCalledExactlyOnceWith({ energy: 0.2, resonance: 0.3 });
        expect(post.render).toHaveBeenCalledOnce();
    });

    it('keeps malformed frame deltas finite and nonnegative', () => {
        const theme = createTheme();
        const { reactions, world } = buildStubScene(theme);
        for (const delta of [NaN, Infinity, -1, undefined, 10]) theme.update(delta);
        expect(theme.time).toBe(0.05);
        expect(reactions.update.mock.calls.map(([delta]) => delta)).toEqual([0, 0, 0, 0, 0.05]);
        expect(world.update.mock.calls.every(([time, delta]) => Number.isFinite(delta) && Number.isFinite(time))).toBe(true);
    });

    it('follows the board card a few times a second, not every frame', () => {
        const theme = createTheme();
        const { world } = buildStubScene(theme);
        for (let frame = 0; frame < 60; frame += 1) theme.update(1 / 60);
        expect(world.setBoard.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(world.setBoard.mock.calls.length).toBeLessThanOrEqual(3);
        expect(world.setBoard).toHaveBeenCalledWith(null);
    });

    it('eases the pointer toward its target instead of snapping', () => {
        const theme = createTheme();
        theme.isActive = true;
        buildStubScene(theme);
        theme.setupEventListeners();
        windowListener('pointermove')({ clientX: 1440, clientY: 0, pointerType: 'mouse' });
        expect(theme.pointer).toEqual({ x: 1, y: -1 });
        theme.update(0.016);
        expect(theme.smoothedPointer.x).toBeGreaterThan(0);
        expect(theme.smoothedPointer.x).toBeLessThan(0.2);
        windowListener('pointermove')({ clientX: 0, clientY: 900, pointerType: 'touch' });
        expect(theme.pointer).toEqual({ x: 1, y: -1 });
    });

    it('resumes a single loop after pause even when the manager also restarts rendering', async () => {
        const theme = createTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        stubSceneBuild(theme);
        await theme.createScene();
        expect(rafs).toHaveLength(1);
        expect(theme.pause()).toBe(true);
        expect(theme.animationLoopStarted).toBe(false);
        const { reactions, post } = theme;
        reactions.update.mockClear();
        post.render.mockClear();
        rafs[0](1000);
        expect(reactions.update).not.toHaveBeenCalled();
        expect(post.render).not.toHaveBeenCalled();
        expect(theme.resume()).toBe(true);
        theme.restartRenderLoop();
        expect(rafs).toHaveLength(2);
        expect(theme.animationLoopStarted).toBe(true);
    });
});
